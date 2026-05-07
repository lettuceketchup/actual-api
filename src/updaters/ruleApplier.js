import { api } from '../utils/client.js';
import chalk from 'chalk';

export async function applyProposals(approved, enrichedRules, { dryRun = true } = {}) {
  const ruleById = new Map(enrichedRules.map(r => [r.id, r]));
  const created = [];
  const updated = [];
  const deleted = [];
  const failed = [];
  const rollbackLog = [];

  for (const proposal of approved) {
    try {
      if (proposal.type === 'create_rule') {
        if (dryRun) {
          console.log(chalk.dim(`  [dry-run] Would create rule: ${JSON.stringify(proposal.newRule)}`));
          created.push({ proposal, rule: proposal.newRule, dryRun: true });
        } else {
          const created_rule = await api.createRule(proposal.newRule);
          rollbackLog.push({ type: 'delete', id: created_rule.id });
          created.push({ proposal, rule: created_rule });
          console.log(chalk.green(`  ✓ Created rule ${created_rule.id}`));
        }
      } else if (proposal.type === 'modify_rule') {
        const original = ruleById.get(proposal.targetRuleId);
        if (!original) {
          failed.push({ proposal, error: `Rule ${proposal.targetRuleId} not found` });
          continue;
        }
        if (dryRun) {
          console.log(chalk.dim(`  [dry-run] Would update rule ${proposal.targetRuleId}`));
          updated.push({ proposal, original, newRule: proposal.newRule, dryRun: true });
        } else {
          const newRule = await api.updateRule({ id: proposal.targetRuleId, ...proposal.newRule });
          rollbackLog.push({ type: 'restore', rule: original });
          updated.push({ proposal, original, newRule });
          console.log(chalk.green(`  ✓ Updated rule ${proposal.targetRuleId}`));
        }
      } else if (proposal.type === 'delete_rule') {
        const original = ruleById.get(proposal.targetRuleId);
        if (!original) {
          failed.push({ proposal, error: `Rule ${proposal.targetRuleId} not found` });
          continue;
        }
        if (dryRun) {
          console.log(chalk.dim(`  [dry-run] Would delete rule ${proposal.targetRuleId}`));
          deleted.push({ proposal, original, dryRun: true });
        } else {
          await api.deleteRule(proposal.targetRuleId);
          rollbackLog.push({ type: 'recreate', rule: original });
          deleted.push({ proposal, original });
          console.log(chalk.green(`  ✓ Deleted rule ${proposal.targetRuleId}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`  ✗ Failed: ${err.message}`));
      failed.push({ proposal, error: err.message });
    }
  }

  if (failed.length) {
    console.warn(chalk.yellow(`\n  ${failed.length} proposal(s) failed to apply.`));
  }

  return { created, updated, deleted, failed, rollbackLog };
}

export async function rollbackChanges(rollbackLog) {
  console.log(chalk.yellow(`\nRolling back ${rollbackLog.length} change(s)...`));

  // Rollback in reverse order
  for (const entry of [...rollbackLog].reverse()) {
    try {
      if (entry.type === 'delete') {
        await api.deleteRule(entry.id);
        console.log(chalk.dim(`  Deleted created rule ${entry.id}`));
      } else if (entry.type === 'restore') {
        await api.updateRule(entry.rule);
        console.log(chalk.dim(`  Restored rule ${entry.rule.id}`));
      } else if (entry.type === 'recreate') {
        await api.createRule(entry.rule);
        console.log(chalk.dim(`  Recreated rule ${entry.rule.id}`));
      }
    } catch (err) {
      console.error(chalk.red(`  Rollback failed for ${entry.type}: ${err.message}`));
      console.error(chalk.dim('  Manual rollback data:'), JSON.stringify(entry));
    }
  }
}

export function buildUpdatedRuleSet(enrichedRules, applyResult) {
  // Return a merged rule list that includes newly created rules and excludes deleted ones
  const deletedIds = new Set(applyResult.deleted.map(d => d.proposal.targetRuleId));
  const updatedIds = new Map(applyResult.updated.map(u => [u.proposal.targetRuleId, u.newRule]));

  const surviving = enrichedRules
    .filter(r => !deletedIds.has(r.id))
    .map(r => updatedIds.has(r.id) ? { ...updatedIds.get(r.id), id: r.id } : r);

  const newRules = applyResult.created
    .filter(c => !c.dryRun && c.rule?.id)
    .map(c => c.rule);

  return [...surviving, ...newRules];
}
