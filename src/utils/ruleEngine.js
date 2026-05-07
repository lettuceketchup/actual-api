// Client-side rule evaluation engine.
// Mirrors Actual Budget's server-side rule logic without database access.

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateMs(dateStr) {
  return dateStr ? new Date(dateStr).getTime() : NaN;
}

function globToRegex(pattern) {
  // Actual Budget glob: * matches anything, ? matches one char
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i');
}

function extractTags(notes) {
  if (!notes) return [];
  return (notes.match(/#\w+/g) ?? []).map(t => t.toLowerCase());
}

function resolveAmount(txn, options) {
  let amt = txn.amount ?? 0;
  if (options?.outflow) {
    if (amt >= 0) return null; // only match expenses
    amt = Math.abs(amt);
  } else if (options?.inflow) {
    if (amt <= 0) return null; // only match income
  }
  return amt;
}

function resolveDate(txn, options) {
  const raw = txn.date;
  if (!raw) return null;
  if (options?.month) return raw.slice(0, 7); // 'YYYY-MM'
  if (options?.year) return raw.slice(0, 4);  // 'YYYY'
  return raw;
}

// ── Condition evaluators ───────────────────────────────────────────────────────

function evalStringOp(op, txnVal, condVal) {
  if (txnVal == null) txnVal = '';
  const tv = String(txnVal).toLowerCase();
  const cv = String(condVal).toLowerCase();

  switch (op) {
    case 'is': return tv === cv;
    case 'isNot': return tv !== cv;
    case 'contains': return tv.includes(cv);
    case 'doesNotContain': return !tv.includes(cv);
    case 'matches': return globToRegex(condVal).test(txnVal ?? '');
    case 'oneOf': return Array.isArray(condVal) && condVal.some(v => String(v).toLowerCase() === tv);
    case 'notOneOf': return !Array.isArray(condVal) || !condVal.some(v => String(v).toLowerCase() === tv);
    default: return false;
  }
}

function evalIdOp(op, txnVal, condVal) {
  // IDs are exact-match strings; no case folding
  switch (op) {
    case 'is': return txnVal === condVal;
    case 'isNot': return txnVal !== condVal;
    case 'oneOf': return Array.isArray(condVal) && condVal.includes(txnVal);
    case 'notOneOf': return !Array.isArray(condVal) || !condVal.includes(txnVal);
    default: return evalStringOp(op, txnVal, condVal);
  }
}

function evalNumericOp(op, txnVal, condVal, options) {
  if (txnVal == null) return false;
  switch (op) {
    case 'is': return txnVal === condVal;
    case 'isNot': return txnVal !== condVal;
    case 'isapprox': return Math.abs(txnVal - condVal) <= Math.abs(condVal * 0.1);
    case 'isbetween': {
      if (!condVal || condVal.num1 == null || condVal.num2 == null) return false;
      const lo = Math.min(condVal.num1, condVal.num2);
      const hi = Math.max(condVal.num1, condVal.num2);
      return txnVal >= lo && txnVal <= hi;
    }
    case 'gt': return txnVal > condVal;
    case 'gte': return txnVal >= condVal;
    case 'lt': return txnVal < condVal;
    case 'lte': return txnVal <= condVal;
    default: return false;
  }
}

function evalDateOp(op, txnVal, condVal, options) {
  if (!txnVal) return false;

  if (op === 'isapprox') {
    const diff = Math.abs(toDateMs(txnVal) - toDateMs(condVal));
    return diff <= 2 * 86_400_000; // within 2 days
  }

  if (op === 'isbetween') {
    if (!condVal?.num1 || !condVal?.num2) return false;
    const tv = toDateMs(txnVal);
    return tv >= toDateMs(condVal.num1) && tv <= toDateMs(condVal.num2);
  }

  // For month/year modes, string comparison is fine since format is uniform
  const tv = txnVal;
  const cv = condVal;
  switch (op) {
    case 'is': return tv === cv;
    case 'isNot': return tv !== cv;
    case 'gt': return tv > cv;
    case 'gte': return tv >= cv;
    case 'lt': return tv < cv;
    case 'lte': return tv <= cv;
    default: return false;
  }
}

// ── Main condition evaluator ───────────────────────────────────────────────────

export function evaluateCondition(condition, txn) {
  const { field, op, value, options } = condition;

  switch (field) {
    case 'imported_payee':
      return evalStringOp(op, txn[field], value);

    case 'notes':
      if (op === 'hasTags') {
        const tags = extractTags(txn.notes);
        return tags.includes(`#${String(value).toLowerCase().replace(/^#/, '')}`);
      }
      return evalStringOp(op, txn[field], value);

    case 'payee':
    case 'category':
    case 'account':
      return evalIdOp(op, txn[field], value);

    case 'cleared':
    case 'reconciled':
    case 'saved':
      return op === 'is' ? txn[field] === value : txn[field] !== value;

    case 'amount': {
      const amt = resolveAmount(txn, options);
      if (amt === null) return false;
      return evalNumericOp(op, amt, value, options);
    }

    case 'date': {
      const dateVal = resolveDate(txn, options);
      return evalDateOp(op, dateVal, value, options);
    }

    default:
      return false;
  }
}

// ── Rule evaluator ─────────────────────────────────────────────────────────────

export function evaluateRule(rule, txn) {
  const results = rule.conditions.map(cond => ({
    condition: cond,
    passed: evaluateCondition(cond, txn),
  }));

  const matched = rule.conditionsOp === 'any'
    ? results.some(r => r.passed)
    : results.every(r => r.passed);

  return {
    matched,
    conditionResults: results,
    matchedConditions: results.filter(r => r.passed).map(r => r.condition),
    failedConditions: results.filter(r => !r.passed).map(r => r.condition),
  };
}

// ── Action simulation ──────────────────────────────────────────────────────────

export function simulateActions(rule, txn) {
  const changes = {};

  for (const action of rule.actions) {
    switch (action.op) {
      case 'set':
        changes[action.field] = action.value;
        break;
      case 'prepend-notes':
        changes.notes = `${action.value} ${changes.notes ?? txn.notes ?? ''}`.trim();
        break;
      case 'append-notes':
        changes.notes = `${changes.notes ?? txn.notes ?? ''} ${action.value}`.trim();
        break;
      case 'link-schedule':
        changes.schedule = action.value?.id ?? action.value;
        break;
      case 'set-split-amount':
        changes._splitIntent = { method: action.options?.method, value: action.value };
        break;
    }
  }

  return changes;
}

// ── Stage-ordered rule application ────────────────────────────────────────────

const STAGE_ORDER = { pre: 0, post: 2 };

function stageKey(stage) {
  return STAGE_ORDER[stage] ?? 1; // null/undefined → middle stage
}

export function applyRulesToTransaction(rules, txn) {
  const sorted = [...rules].sort((a, b) => stageKey(a.stage) - stageKey(b.stage));

  let currentTxn = { ...txn };
  const appliedRules = [];
  let finalChanges = {};

  for (const rule of sorted) {
    const { matched } = evaluateRule(rule, currentTxn);
    if (!matched) continue;

    const changes = simulateActions(rule, currentTxn);
    appliedRules.push({ rule, changes });
    finalChanges = { ...finalChanges, ...changes };
    // update the working copy so subsequent rules see the updated state
    currentTxn = { ...currentTxn, ...changes };
  }

  return { appliedRules, finalChanges };
}

// ── Batch runner ───────────────────────────────────────────────────────────────

export function runRulesAgainstAll(rules, transactions) {
  const matched = [];
  const unmatched = [];

  for (const txn of transactions) {
    const { appliedRules, finalChanges } = applyRulesToTransaction(rules, txn);

    if (appliedRules.length > 0) {
      matched.push({ txn, appliedRules, finalChanges });
    } else {
      unmatched.push(txn);
    }
  }

  return { matched, unmatched };
}

// ── Near-miss detection ────────────────────────────────────────────────────────

export function findNearMisses(rules, txn) {
  const nearMisses = [];

  for (const rule of rules) {
    if (rule.conditionsOp !== 'and') continue; // only makes sense for AND rules
    if (rule.conditions.length < 2) continue;   // single-condition rules can't near-miss

    const results = rule.conditions.map(cond => ({
      condition: cond,
      passed: evaluateCondition(cond, txn),
    }));

    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount === 1) {
      nearMisses.push({
        rule,
        failedCondition: results.find(r => !r.passed).condition,
        passedConditions: results.filter(r => r.passed).map(r => r.condition),
      });
    }
  }

  return nearMisses;
}
