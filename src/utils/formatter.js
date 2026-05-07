import chalk from 'chalk';

// ── Amount helpers ─────────────────────────────────────────────────────────────

export function amountToDollars(cents) {
  if (cents == null) return '$0.00';
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '+';
  return `${sign}$${abs.toFixed(2)}`;
}

// ── Rule formatting ────────────────────────────────────────────────────────────

export function formatRule(rule, { verbose = false } = {}) {
  const stage = rule.stage ? chalk.dim(`[${rule.stage.toUpperCase()}] `) : '';
  const op = rule.conditionsOp === 'any' ? chalk.yellow(' OR ') : chalk.yellow(' AND ');

  const conditions = rule._humanConditions
    ? rule._humanConditions.map(c => chalk.cyan(c.displayStr)).join(op)
    : rule.conditions.map(c => chalk.cyan(`${c.field} ${c.op} '${c.value}'`)).join(op);

  const actions = rule._humanActions
    ? rule._humanActions.map(a => chalk.green(a.displayStr)).join(', ')
    : rule.actions.map(a => chalk.green(`${a.op} ${a.field ?? ''}`)).join(', ');

  const id = verbose ? chalk.dim(` (${rule.id})`) : '';
  return `${stage}IF ${conditions} → ${actions}${id}`;
}

export function formatRuleCompact(rule) {
  return rule._displayName ?? `rule ${rule.id?.slice(0, 8)}`;
}

// ── Transaction formatting ─────────────────────────────────────────────────────

export function formatTransaction(txn, { verbose = false } = {}) {
  const date = chalk.dim(txn.date);
  const payee = chalk.bold(txn.payeeName ?? txn.imported_payee ?? '(unknown)');
  const amount = txn.amount < 0
    ? chalk.red(amountToDollars(txn.amount))
    : chalk.green(amountToDollars(txn.amount));
  const account = chalk.dim(txn.accountName ?? txn.account ?? '');
  const notes = txn.notes ? chalk.dim(` | ${txn.notes}`) : '';
  const id = verbose ? chalk.dim(` [${txn.id}]`) : '';
  return `${date} | ${payee} | ${amount} | ${account}${notes}${id}`;
}

// ── Proposal formatting ────────────────────────────────────────────────────────

export function formatProposal(proposal, meta, { index, total } = {}) {
  const header = index != null
    ? chalk.bold(`\n${'─'.repeat(60)}\nPROPOSAL ${index} of ${total}  `)
    : chalk.bold(`\n${'─'.repeat(60)}\n`);

  const typeLabel = {
    create_rule: chalk.green('[CREATE RULE]'),
    modify_rule: chalk.yellow('[MODIFY RULE]'),
    delete_rule: chalk.red('[DELETE RULE]'),
  }[proposal.type] ?? proposal.type;

  const confidence = proposal.confidence != null
    ? chalk.dim(`  confidence: ${Math.round(proposal.confidence * 100)}%`)
    : '';

  const reason = chalk.italic(`Reason: ${proposal.reason ?? '(none)'}`);

  const lines = [
    `${header}${typeLabel}${confidence}`,
    `${'─'.repeat(60)}`,
    reason,
  ];

  if (proposal._currentRule) {
    lines.push('');
    lines.push(chalk.bold('CURRENT RULE:'));
    lines.push('  ' + formatRule(proposal._currentRule));
  }

  if (proposal.newRule) {
    lines.push('');
    const label = proposal.type === 'create_rule' ? 'NEW RULE:' : 'PROPOSED CHANGE:';
    lines.push(chalk.bold(label));
    lines.push('  ' + formatProposedRule(proposal.newRule, meta));
  }

  if (proposal.type === 'delete_rule' && proposal._currentRule) {
    lines.push('');
    lines.push(chalk.red('  This rule will be deleted.'));
  }

  if (proposal._affectedCount != null) {
    lines.push('');
    lines.push(chalk.dim(`  Would affect ~${proposal._affectedCount} transactions.`));
  }

  return lines.join('\n');
}

function formatProposedRule(rule, meta) {
  const stage = rule.stage ? chalk.dim(`[${rule.stage.toUpperCase()}] `) : '';
  const op = rule.conditionsOp === 'any' ? chalk.yellow(' OR ') : chalk.yellow(' AND ');

  const conditions = (rule.conditions ?? []).map(c => {
    let value = c.value;
    if (c.field === 'payee' && meta?.payeesById) {
      value = meta.payeesById.get(c.value)?.name ?? c.value;
    } else if (c.field === 'category' && meta?.categoriesById) {
      value = meta.categoriesById.get(c.value)?.name ?? c.value;
    } else if (c.field === 'account' && meta?.accountsById) {
      value = meta.accountsById.get(c.value)?.name ?? c.value;
    }
    if (c.op === 'isbetween' && value && typeof value === 'object') {
      return chalk.cyan(`${c.field} is between ${value.num1} and ${value.num2}`);
    }
    return chalk.cyan(`${c.field} ${c.op} '${Array.isArray(value) ? value.join(', ') : value}'`);
  }).join(op);

  const actions = (rule.actions ?? []).map(a => {
    if (a.op === 'set') {
      let v = a.value;
      if (a.field === 'category' && meta?.categoriesById) v = meta.categoriesById.get(a.value)?.name ?? a.value;
      if (a.field === 'payee' && meta?.payeesById) v = meta.payeesById.get(a.value)?.name ?? a.value;
      return chalk.green(`set ${a.field} to '${v}'`);
    }
    if (a.op === 'prepend-notes') return chalk.green(`prepend notes '${a.value}'`);
    if (a.op === 'append-notes') return chalk.green(`append notes '${a.value}'`);
    return chalk.green(`${a.op}`);
  }).join(', ');

  return `${stage}IF ${conditions || '(no conditions)'} → ${actions || '(no actions)'}`;
}

// ── Audit report formatting ────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
};

export function formatAuditReport(report, enrichedRules) {
  if (!report.issues.length) {
    return chalk.green('\n✓ Rule audit passed — no issues found.\n');
  }

  const lines = [
    '',
    chalk.bold('RULE AUDIT REPORT'),
    '═'.repeat(60),
    `Total rules: ${enrichedRules.length}`,
    `Issues found: ${report.issues.length}`,
    '',
  ];

  const bySeverity = { error: [], warning: [], info: [] };
  for (const issue of report.issues) {
    bySeverity[issue.severity]?.push(issue);
  }

  for (const [severity, issues] of Object.entries(bySeverity)) {
    if (!issues.length) continue;
    const color = SEVERITY_COLORS[severity] ?? chalk.white;
    lines.push(color(`── ${severity.toUpperCase()}S (${issues.length}) ──`));
    for (const issue of issues) {
      lines.push('');
      lines.push(color(`  [${issue.type}]`) + ` ${issue.message}`);
      if (issue.suggestion) lines.push(chalk.dim(`  → ${issue.suggestion}`));
      if (issue.ruleIds?.length) {
        for (const id of issue.ruleIds) {
          const rule = enrichedRules.find(r => r.id === id);
          if (rule) lines.push(chalk.dim(`    Rule: ${formatRule(rule)}`));
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Confirmation diff ──────────────────────────────────────────────────────────

export function formatConfirmationReport(applyResult, txnChanges, meta) {
  const lines = [
    '',
    chalk.bold('RESULTS SUMMARY'),
    '═'.repeat(60),
    `Rules created:   ${applyResult.created.length}`,
    `Rules modified:  ${applyResult.updated.length}`,
    `Rules deleted:   ${applyResult.deleted?.length ?? 0}`,
    `Transactions affected: ${txnChanges.applied.length}`,
    '',
  ];

  if (txnChanges.applied.length) {
    lines.push(chalk.bold('TRANSACTION CHANGES:'));
    const headerRow = ` ${'Date'.padEnd(12)}| ${'Payee'.padEnd(20)}| ${'Amount'.padEnd(10)}| ${'Field'.padEnd(10)}| Before → After`;
    lines.push(chalk.dim(headerRow));
    lines.push(chalk.dim('─'.repeat(70)));

    for (const change of txnChanges.applied) {
      const { txn, before, changes } = change;
      const date = (txn.date ?? '').padEnd(12);
      const payee = (txn.payeeName ?? txn.payee ?? '').slice(0, 18).padEnd(20);
      const amount = amountToDollars(txn.amount).padEnd(10);

      for (const [field, newVal] of Object.entries(changes)) {
        const oldVal = before[field];
        const oldName = resolveFieldName(field, oldVal, meta) ?? '(none)';
        const newName = resolveFieldName(field, newVal, meta) ?? String(newVal);
        lines.push(` ${date}| ${payee}| ${amount}| ${field.padEnd(10)}| ${chalk.dim(oldName)} → ${chalk.green(newName)}`);
      }
    }
  }

  if (txnChanges.unexpected?.length) {
    lines.push('');
    lines.push(chalk.red(`⚠ ${txnChanges.unexpected.length} UNEXPECTED CHANGES DETECTED:`));
    for (const u of txnChanges.unexpected) {
      lines.push(chalk.red(`  ${u.txn.id}: ${u.field} changed to '${u.newValue}' unexpectedly`));
    }
  } else {
    lines.push(chalk.green('\n✓ No unexpected changes detected.'));
  }

  lines.push('═'.repeat(60));
  return lines.join('\n');
}

function resolveFieldName(field, value, meta) {
  if (!value) return null;
  if (field === 'category') return meta.categoriesById.get(value)?.name;
  if (field === 'payee') return meta.payeesById.get(value)?.name;
  if (field === 'account') return meta.accountsById.get(value)?.name;
  return String(value);
}
