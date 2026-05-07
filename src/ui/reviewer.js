import prompts from 'prompts';
import chalk from 'chalk';
import { formatProposal, formatRule } from '../utils/formatter.js';

export async function reviewProposals(proposals, enrichedRules, meta) {
  if (proposals.length === 0) {
    console.log(chalk.dim('\nNo proposals to review.'));
    return { approved: [], skipped: [] };
  }

  // Attach current rule to each proposal for display
  const ruleById = new Map(enrichedRules.map(r => [r.id, r]));
  const annotated = proposals.map(p => ({
    ...p,
    _currentRule: p.targetRuleId ? ruleById.get(p.targetRuleId) : null,
  }));

  console.log(chalk.bold(`\n${'═'.repeat(60)}`));
  console.log(chalk.bold(`REVIEW ${proposals.length} PROPOSAL(S)`));
  console.log(chalk.bold(`${'═'.repeat(60)}`));
  console.log(chalk.dim('For each proposal: approve, skip, or quit review.\n'));

  const approved = [];
  const skipped = [];
  let approveAll = false;

  for (let i = 0; i < annotated.length; i++) {
    const proposal = annotated[i];

    if (approveAll) {
      approved.push(proposal);
      continue;
    }

    console.log(formatProposal(proposal, meta, { index: i + 1, total: annotated.length }));
    console.log('');

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Action',
      choices: [
        { title: chalk.green('Approve'), value: 'approve' },
        { title: chalk.dim('Skip'), value: 'skip' },
        { title: chalk.cyan('View full rule JSON'), value: 'details' },
        { title: chalk.yellow('Approve all remaining'), value: 'approveAll' },
        { title: chalk.red('Quit review'), value: 'quit' },
      ],
    });

    if (action === undefined || action === 'quit') {
      console.log(chalk.dim('\nReview stopped. Changes approved so far will be applied.'));
      break;
    }

    if (action === 'approve') {
      approved.push(proposal);
      console.log(chalk.green('  ✓ Approved'));
    } else if (action === 'skip') {
      skipped.push(proposal);
      console.log(chalk.dim('  — Skipped'));
    } else if (action === 'details') {
      console.log(chalk.dim('\nFull proposal JSON:'));
      console.log(JSON.stringify(proposal, null, 2));
      // Re-prompt for this same proposal
      i--;
    } else if (action === 'approveAll') {
      approved.push(proposal);
      approveAll = true;
      console.log(chalk.green('  ✓ Approving all remaining proposals'));
    }
  }

  console.log('');
  console.log(chalk.bold(`Review complete: ${approved.length} approved, ${skipped.length} skipped.`));

  return { approved, skipped };
}

export async function confirmApply(approved, { dryRun }) {
  if (approved.length === 0) return false;

  const mode = dryRun ? chalk.yellow('DRY-RUN mode — no changes will be written') : chalk.red('LIVE mode — changes will be written to Actual Budget');
  console.log(`\n${mode}`);
  console.log(`${approved.length} proposal(s) ready to apply.`);

  if (dryRun) return true;

  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: `Apply ${approved.length} rule change(s) to Actual Budget?`,
    initial: false,
  });

  return ok === true;
}
