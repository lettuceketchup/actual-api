// Structural analysis of the rule set — no transactions needed.

function canonicalizeConditions(conditions) {
  return [...conditions]
    .map(c => `${c.field}|${c.op}|${JSON.stringify(c.value)}`)
    .sort()
    .join(';;');
}

function canonicalizeActions(actions) {
  return [...actions]
    .map(a => `${a.op}|${a.field ?? ''}|${JSON.stringify(a.value)}`)
    .sort()
    .join(';;');
}

function issue(type, severity, ruleIds, message, suggestion = null) {
  return { type, severity, ruleIds, message, suggestion };
}

export function auditRules(enrichedRules, meta) {
  const issues = [];

  // 1. Duplicate rules — identical conditions AND actions
  const seen = new Map();
  for (const rule of enrichedRules) {
    const key = `${canonicalizeConditions(rule.conditions)}__${canonicalizeActions(rule.actions)}`;
    if (seen.has(key)) {
      issues.push(issue(
        'duplicate_rule',
        'error',
        [seen.get(key), rule.id],
        `Rules are identical (same conditions and actions).`,
        'Delete one of the duplicate rules.'
      ));
    } else {
      seen.set(key, rule.id);
    }
  }

  // 2. Conflicting rules — same stage, overlapping conditions, same field → different value
  const byStage = {};
  for (const rule of enrichedRules) {
    const s = rule.stage ?? 'null';
    (byStage[s] ??= []).push(rule);
  }

  for (const stageRules of Object.values(byStage)) {
    for (let i = 0; i < stageRules.length; i++) {
      for (let j = i + 1; j < stageRules.length; j++) {
        const a = stageRules[i];
        const b = stageRules[j];
        const conflict = findSetConflict(a, b);
        if (conflict) {
          issues.push(issue(
            'conflicting_rules',
            'warning',
            [a.id, b.id],
            `Both rules set '${conflict.field}' but to different values ('${conflict.aVal}' vs '${conflict.bVal}'). Stage ordering determines which wins.`,
            'Review stage/order. If intentional, no action needed.'
          ));
        }
      }
    }
  }

  // 3. Shadow rules — rule A conditions ⊂ rule B conditions in same stage, same actions
  for (const stageRules of Object.values(byStage)) {
    for (let i = 0; i < stageRules.length; i++) {
      for (let j = 0; j < stageRules.length; j++) {
        if (i === j) continue;
        const a = stageRules[i]; // fewer conditions (potential shadow)
        const b = stageRules[j]; // more conditions (potentially shadowed)
        if (a.conditions.length >= b.conditions.length) continue;
        if (isConditionSubset(a.conditions, b.conditions)) {
          issues.push(issue(
            'shadow_rule',
            'info',
            [b.id, a.id],
            `Rule may be shadowed: its conditions are a superset of another rule in the same stage, which will fire first.`,
            'Consider merging the rules or adjusting stages.'
          ));
        }
      }
    }
  }

  // 4. Dead conditions
  for (const rule of enrichedRules) {
    for (const cond of rule.conditions) {
      if (cond.op === 'oneOf' && Array.isArray(cond.value) && cond.value.length === 0) {
        issues.push(issue(
          'dead_condition',
          'error',
          [rule.id],
          `Condition 'oneOf' with empty array will never match.`,
          'Add values to the condition or remove it.'
        ));
      }
      if (cond.op === 'isbetween' && cond.value?.num1 != null && cond.value.num1 === cond.value.num2) {
        issues.push(issue(
          'dead_condition',
          'warning',
          [rule.id],
          `'isbetween' condition has equal num1 and num2 — use 'is' instead.`,
          "Replace with an 'is' condition."
        ));
      }
    }
  }

  // 5. Broken references
  for (const rule of enrichedRules) {
    for (const cond of rule.conditions) {
      if (cond.field === 'payee') {
        const ids = Array.isArray(cond.value) ? cond.value : [cond.value];
        for (const id of ids) {
          if (id && !meta.payeesById.has(id)) {
            issues.push(issue(
              'broken_reference',
              'error',
              [rule.id],
              `Condition references payee ID '${id}' which no longer exists.`,
              'Remove or update this condition.'
            ));
          }
        }
      }
      if (cond.field === 'category') {
        const ids = Array.isArray(cond.value) ? cond.value : [cond.value];
        for (const id of ids) {
          if (id && !meta.categoriesById.has(id)) {
            issues.push(issue(
              'broken_reference',
              'error',
              [rule.id],
              `Condition references category ID '${id}' which no longer exists.`,
              'Remove or update this condition.'
            ));
          }
        }
      }
    }
    for (const action of rule.actions) {
      if (action.op === 'set' && action.field === 'category') {
        if (action.value && !meta.categoriesById.has(action.value)) {
          issues.push(issue(
            'broken_reference',
            'error',
            [rule.id],
            `Action sets category to ID '${action.value}' which no longer exists.`,
            'Update the action to a valid category.'
          ));
        }
      }
    }
  }

  // 6. Overly broad string conditions
  for (const rule of enrichedRules) {
    for (const cond of rule.conditions) {
      if (['notes', 'imported_payee'].includes(cond.field) && cond.op === 'contains') {
        const val = String(cond.value ?? '');
        if (val.length < 3) {
          issues.push(issue(
            'overly_broad',
            'warning',
            [rule.id],
            `'contains' match string '${val}' is very short (< 3 chars) and may match unintended transactions.`,
            "Use a more specific match string or switch to 'is'."
          ));
        }
      }
    }
  }

  // 7. Empty action rules
  for (const rule of enrichedRules) {
    if (!rule.actions || rule.actions.length === 0) {
      issues.push(issue(
        'empty_actions',
        'warning',
        [rule.id],
        'Rule has no actions — it matches transactions but does nothing.',
        'Add an action or delete the rule.'
      ));
    }
  }

  return {
    issues,
    summary: {
      total: enrichedRules.length,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
    },
  };
}

function findSetConflict(a, b) {
  // Check if both rules have a 'set' action for the same field with different values
  const aSetActions = a.actions.filter(x => x.op === 'set');
  const bSetActions = b.actions.filter(x => x.op === 'set');

  for (const aa of aSetActions) {
    const bb = bSetActions.find(x => x.field === aa.field && x.value !== aa.value);
    if (!bb) continue;

    // Check if the rules have at least one shared condition that could both match
    const aKeys = new Set(a.conditions.map(c => c.field));
    const bKeys = new Set(b.conditions.map(c => c.field));
    const shared = [...aKeys].some(k => bKeys.has(k));
    if (shared) {
      return { field: aa.field, aVal: aa.value, bVal: bb.value };
    }
  }
  return null;
}

function isConditionSubset(smaller, larger) {
  // Every condition in smaller has a matching canonical form in larger
  const largerSet = new Set(larger.map(c => `${c.field}|${c.op}|${JSON.stringify(c.value)}`));
  return smaller.every(c => largerSet.has(`${c.field}|${c.op}|${JSON.stringify(c.value)}`));
}
