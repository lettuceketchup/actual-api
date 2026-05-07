import {
  evaluateRule,
  simulateActions,
  applyRulesToTransaction,
  findNearMisses,
} from '../utils/ruleEngine.js';

export function matchTransactionsToRules(rules, uncategorized) {
  const fullyMatched = [];
  const partiallyMatched = [];
  const unmatched = [];
  const nearMisses = [];

  for (const txn of uncategorized) {
    const { appliedRules, finalChanges } = applyRulesToTransaction(rules, txn);

    if (appliedRules.length === 0) {
      unmatched.push(txn);
      const misses = findNearMisses(rules, txn);
      nearMisses.push(...misses.map(m => ({ txn, ...m })));
    } else if (finalChanges.category) {
      fullyMatched.push({ txn, appliedRules, finalChanges });
    } else {
      partiallyMatched.push({ txn, appliedRules, finalChanges });
    }
  }

  return { fullyMatched, partiallyMatched, unmatched, nearMisses };
}

export function summarizeMatchReport(report, { verbose = false } = {}) {
  const lines = [];

  lines.push(`\nMatched (category assigned): ${report.fullyMatched.length}`);
  lines.push(`Matched (no category set):   ${report.partiallyMatched.length}`);
  lines.push(`Unmatched (no rule):         ${report.unmatched.length}`);
  lines.push(`Near-misses:                 ${report.nearMisses.length}`);

  if (verbose && report.nearMisses.length) {
    lines.push('\nNear-misses (rule almost matched):');
    for (const nm of report.nearMisses.slice(0, 10)) {
      const ruleName = nm.rule._displayName ?? nm.rule.id.slice(0, 8);
      const failedField = nm.failedCondition?.field ?? '?';
      const failedOp = nm.failedCondition?.op ?? '?';
      lines.push(`  • Txn "${nm.txn.payeeName}" — rule "${ruleName}" failed on: ${failedField} ${failedOp}`);
    }
  }

  return lines.join('\n');
}
