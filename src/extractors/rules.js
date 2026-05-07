import { api } from '../utils/client.js';

export async function fetchRules() {
  const rules = await api.getRules();
  return rules.filter(r => !r.tombstone);
}

function resolveValue(value, field, meta) {
  if (value === null || value === undefined) return { value, name: String(value) };

  if (field === 'payee') {
    if (Array.isArray(value)) {
      const names = value.map(id => meta.payeesById.get(id)?.name ?? id);
      return { value, name: names.join(', ') };
    }
    return { value, name: meta.payeesById.get(value)?.name ?? value };
  }

  if (field === 'category') {
    if (Array.isArray(value)) {
      const names = value.map(id => meta.categoriesById.get(id)?.name ?? id);
      return { value, name: names.join(', ') };
    }
    return { value, name: meta.categoriesById.get(value)?.name ?? value };
  }

  if (field === 'account') {
    if (Array.isArray(value)) {
      const names = value.map(id => meta.accountsById.get(id)?.name ?? id);
      return { value, name: names.join(', ') };
    }
    return { value, name: meta.accountsById.get(value)?.name ?? value };
  }

  return { value, name: Array.isArray(value) ? value.join(', ') : String(value) };
}

function conditionToString(cond, meta) {
  const { value, name } = resolveValue(cond.value, cond.field, meta);
  const opts = cond.options ?? {};
  let fieldStr = cond.field;
  if (opts.inflow) fieldStr += '(inflow)';
  if (opts.outflow) fieldStr += '(outflow)';
  if (opts.month) fieldStr += '(month)';
  if (opts.year) fieldStr += '(year)';

  if (cond.op === 'isbetween' && value && typeof value === 'object') {
    return `${fieldStr} is between ${value.num1} and ${value.num2}`;
  }
  return `${fieldStr} ${cond.op} '${name}'`;
}

function actionToString(action, meta) {
  if (action.op === 'set') {
    const { name } = resolveValue(action.value, action.field, meta);
    return `set ${action.field} to '${name}'`;
  }
  if (action.op === 'prepend-notes') return `prepend notes with '${action.value}'`;
  if (action.op === 'append-notes') return `append notes with '${action.value}'`;
  if (action.op === 'link-schedule') return `link to schedule '${action.value?.name ?? action.value}'`;
  if (action.op === 'set-split-amount') {
    const method = action.options?.method ?? 'fixed-amount';
    return `set split amount (${method}) = ${action.value}`;
  }
  return `${action.op} ${action.value ?? ''}`;
}

export function enrichRule(rule, meta) {
  const humanConditions = rule.conditions.map(cond => ({
    ...cond,
    displayStr: conditionToString(cond, meta),
  }));

  const humanActions = rule.actions.map(action => ({
    ...action,
    displayStr: actionToString(action, meta),
  }));

  const setAction = rule.actions.find(a => a.op === 'set' && a.field === 'category');
  const categoryName = setAction
    ? meta.categoriesById.get(setAction.value)?.name
    : null;

  const firstCond = humanConditions[0];
  const displayName = categoryName
    ? `${firstCond?.displayStr ?? '?'} → ${categoryName}`
    : (firstCond?.displayStr ?? `rule ${rule.id.slice(0, 8)}`);

  return {
    ...rule,
    _humanConditions: humanConditions,
    _humanActions: humanActions,
    _displayName: displayName,
  };
}

export function enrichRules(rules, meta) {
  return rules.map(r => enrichRule(r, meta));
}
