/**
 * Actual Budget Rule Refinement System
 * CLI entry point — dispatches to audit, suggest, gaps, or full run commands.
 *
 * Usage:
 *   node src/index.js audit           — analyse existing rules
 *   node src/index.js suggest         — AI-powered rule refinement proposals
 *   node src/index.js gaps            — find uncategorized transactions, propose rules
 *   node src/index.js run             — full pipeline (gaps + suggest + review + apply + confirm)
 *
 * Flags:
 *   --dry-run          simulate writes (default: env DRY_RUN)
 *   --confirm          required to actually write to Actual Budget
 *   --days=<N>         lookback window for transactions (default: 90)
 *   --account=<id>     restrict to one account
 *   --ai=<backend>     override AI_BACKEND ('anthropic' | 'ollama')
 *   --no-ai            skip AI, only rule-engine analysis
 *   --verbose          print full rule/transaction details
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import chalk from 'chalk';

import { initClient, shutdownClient } from './utils/client.js';
import { fetchMetadata } from './extractors/metadata.js';
import { fetchRules, enrichRules } from './extractors/rules.js';
import { fetchAllTransactions, filterUncategorized, enrichTransaction, groupByPayee } from './extractors/transactions.js';
import { auditRules } from './analyzers/ruleAuditor.js';
import { matchTransactionsToRules, summarizeMatchReport } from './analyzers/transactionMatcher.js';
import { getAuditSuggestions, getGapSuggestions } from './analyzers/aiAdvisor.js';
import { reviewProposals, confirmApply } from './ui/reviewer.js';
import { applyProposals, buildUpdatedRuleSet } from './updaters/ruleApplier.js';
import { applyTransactionChanges, snapshotTransactions } from './updaters/transactionApplier.js';
import { formatRule, formatAuditReport, formatConfirmationReport, formatTransaction } from './utils/formatter.js';
import { runRulesAgainstAll } from './utils/ruleEngine.js';

// ── Env loader ─────────────────────────────────────────────────────────────────

function loadDotEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env file optional
  }
}

// ── Arg parsing ────────────────────────────────────────────────────────────────

function parseArgs() {
  const raw = minimist(process.argv.slice(2), {
    boolean: ['dry-run', 'confirm', 'no-ai', 'verbose', 'help'],
    string: ['account', 'ai'],
    default: { 'dry-run': null },
  });

  const command = raw._[0];
  const dryRun = raw['confirm']
    ? false
    : raw['dry-run'] !== null
    ? raw['dry-run']
    : (process.env.DRY_RUN ?? 'true') !== 'false';

  return {
    command,
    dryRun,
    confirm: raw['confirm'] ?? false,
    days: parseInt(raw['days'] ?? process.env.LOOKBACK_DAYS ?? '90', 10),
    accountId: raw['account'] ?? null,
    aiBackend: raw['ai'] ?? process.env.AI_BACKEND ?? 'ollama',
    noAi: raw['no-ai'] ?? false,
    verbose: raw['verbose'] ?? false,
    help: raw['help'] ?? false,
  };
}

// ── Shared pipeline steps ──────────────────────────────────────────────────────

async function loadBaseData(opts) {
  process.stdout.write('Loading metadata...');
  const meta = await fetchMetadata();
  process.stdout.write(` ${meta.accounts.length} accounts, ${meta.categories.length} categories, ${meta.payees.length} payees\n`);

  process.stdout.write('Loading rules...');
  const rawRules = await fetchRules();
  const enrichedRules = enrichRules(rawRules, meta);
  process.stdout.write(` ${enrichedRules.length} rules\n`);

  return { meta, enrichedRules };
}

async function loadTransactions(meta, opts) {
  process.stdout.write(`Loading transactions (last ${opts.days} days)...`);
  const allTxns = await fetchAllTransactions(meta, { days: opts.days, accountId: opts.accountId });
  const uncategorized = filterUncategorized(allTxns, meta).map(t => enrichTransaction(t, meta));
  process.stdout.write(` ${allTxns.length} total, ${uncategorized.length} uncategorized\n`);
  return { allTxns, uncategorized };
}

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdAudit(opts) {
  const { meta, enrichedRules } = await loadBaseData(opts);

  console.log('\nAnalysing rules...');
  const report = auditRules(enrichedRules, meta);
  console.log(formatAuditReport(report, enrichedRules));

  if (opts.verbose) {
    console.log(chalk.bold('\nAll rules:'));
    for (const rule of enrichedRules) {
      console.log('  ' + formatRule(rule, { verbose: true }));
    }
  }

  if (!opts.noAi) {
    console.log('\nFetching AI suggestions for rule improvements...');
    const aiConfig = { backend: opts.aiBackend };
    try {
      const proposals = await getAuditSuggestions(enrichedRules, meta, aiConfig);
      if (proposals.length === 0) {
        console.log(chalk.dim('  AI found no suggestions.'));
      } else {
        console.log(chalk.bold(`\nAI suggested ${proposals.length} improvement(s):`));
        const { approved } = await reviewProposals(proposals, enrichedRules, meta);

        if (approved.length > 0) {
          const ok = await confirmApply(approved, { dryRun: opts.dryRun });
          if (ok) {
            console.log('\nApplying rule changes...');
            await applyProposals(approved, enrichedRules, { dryRun: opts.dryRun });
          }
        }
      }
    } catch (err) {
      console.error(chalk.red(`AI error: ${err.message}`));
    }
  }
}

async function cmdSuggest(opts) {
  const { meta, enrichedRules } = await loadBaseData(opts);

  if (opts.noAi) {
    console.log(chalk.yellow('--no-ai flag set; nothing to do for suggest command.'));
    return;
  }

  console.log('\nFetching AI suggestions for rule improvements...');
  const aiConfig = { backend: opts.aiBackend };
  const proposals = await getAuditSuggestions(enrichedRules, meta, aiConfig);

  if (proposals.length === 0) {
    console.log(chalk.dim('  AI found no suggestions.'));
    return;
  }

  const { approved } = await reviewProposals(proposals, enrichedRules, meta);
  if (approved.length === 0) return;

  const ok = await confirmApply(approved, { dryRun: opts.dryRun });
  if (ok) {
    console.log('\nApplying rule changes...');
    await applyProposals(approved, enrichedRules, { dryRun: opts.dryRun });
  }
}

async function cmdGaps(opts) {
  const { meta, enrichedRules } = await loadBaseData(opts);
  const { uncategorized } = await loadTransactions(meta, opts);

  if (uncategorized.length === 0) {
    console.log(chalk.green('\n✓ No uncategorized transactions found.'));
    return;
  }

  console.log('\nRunning rules against uncategorized transactions...');
  const matchReport = matchTransactionsToRules(enrichedRules, uncategorized);
  console.log(summarizeMatchReport(matchReport, { verbose: opts.verbose }));

  if (matchReport.unmatched.length === 0) {
    console.log(chalk.green('\n✓ All uncategorized transactions are covered by existing rules.'));
    return;
  }

  const groups = groupByPayee(matchReport.unmatched);
  console.log(chalk.bold(`\n${groups.length} uncategorized payee group(s):`));
  for (const g of groups.slice(0, 20)) {
    console.log(`  • ${g.importedPayee ?? g.payeeName} (${g.count} transactions)`);
  }
  if (groups.length > 20) console.log(chalk.dim(`  ... and ${groups.length - 20} more`));

  if (opts.noAi) return;

  console.log('\nFetching AI rule proposals for gaps...');
  const aiConfig = { backend: opts.aiBackend };
  const proposals = await getGapSuggestions(groups, enrichedRules, meta, matchReport.nearMisses, aiConfig);

  if (proposals.length === 0) {
    console.log(chalk.dim('  AI found no proposals.'));
    return;
  }

  const { approved } = await reviewProposals(proposals, enrichedRules, meta);
  if (approved.length === 0) return;

  const ok = await confirmApply(approved, { dryRun: opts.dryRun });
  if (ok) {
    console.log('\nApplying rule changes...');
    await applyProposals(approved, enrichedRules, { dryRun: opts.dryRun });
  }
}

async function cmdRun(opts) {
  const { meta, enrichedRules } = await loadBaseData(opts);
  const { uncategorized } = await loadTransactions(meta, opts);

  // Snapshot before state for verification
  const snapshot = await snapshotTransactions(uncategorized);

  // ── Step 1: Audit existing rules ──
  console.log('\n' + chalk.bold('Step 1/4: Auditing existing rules...'));
  const auditReport = auditRules(enrichedRules, meta);
  console.log(formatAuditReport(auditReport, enrichedRules));

  // ── Step 2: Gap analysis ──
  console.log(chalk.bold('Step 2/4: Analysing uncategorized transactions...'));
  const matchReport = matchTransactionsToRules(enrichedRules, uncategorized);
  console.log(summarizeMatchReport(matchReport, { verbose: opts.verbose }));

  if (matchReport.fullyMatched.length > 0) {
    console.log(chalk.dim(`  ${matchReport.fullyMatched.length} transaction(s) are already covered by existing rules.`));
  }

  // ── Step 3: AI suggestions (both audit refinements and gap proposals) ──
  let allProposals = [];

  if (!opts.noAi) {
    console.log(chalk.bold('\nStep 3/4: Getting AI suggestions...'));
    const aiConfig = { backend: opts.aiBackend };

    try {
      const [auditProposals, gapProposals] = await Promise.all([
        enrichedRules.length > 0
          ? getAuditSuggestions(enrichedRules, meta, aiConfig)
          : Promise.resolve([]),
        matchReport.unmatched.length > 0
          ? getGapSuggestions(groupByPayee(matchReport.unmatched), enrichedRules, meta, matchReport.nearMisses, aiConfig)
          : Promise.resolve([]),
      ]);

      allProposals = [...auditProposals, ...gapProposals];
      console.log(`  ${auditProposals.length} refinement proposal(s), ${gapProposals.length} gap-filling proposal(s)`);
    } catch (err) {
      console.error(chalk.red(`AI error: ${err.message}`));
      console.log(chalk.yellow('Continuing without AI suggestions...'));
    }
  } else {
    console.log(chalk.bold('\nStep 3/4: (AI skipped)'));
  }

  // ── Step 4: Review + Apply ──
  console.log(chalk.bold('\nStep 4/4: Review & apply'));

  let currentRules = enrichedRules;

  if (allProposals.length === 0 && matchReport.fullyMatched.length === 0) {
    console.log(chalk.dim('  No rule proposals and no transactions covered by existing rules. Nothing to do.'));
    return;
  }

  let applyResult = { created: [], updated: [], deleted: [], failed: [], rollbackLog: [] };

  if (allProposals.length > 0) {
    const { approved } = await reviewProposals(allProposals, enrichedRules, meta);

    if (approved.length > 0) {
      const ok = await confirmApply(approved, { dryRun: opts.dryRun });
      if (ok) {
        console.log('\nApplying rule changes...');
        applyResult = await applyProposals(approved, enrichedRules, { dryRun: opts.dryRun });
        // Build updated rule list for running against transactions
        if (!opts.dryRun) {
          currentRules = buildUpdatedRuleSet(enrichedRules, applyResult);
        }
      }
    }
  }

  // ── Run rules against uncategorized transactions ──
  console.log('\nRunning rules against uncategorized transactions...');
  const { matched: txnMatches } = runRulesAgainstAll(currentRules, uncategorized);

  if (txnMatches.length === 0) {
    console.log(chalk.dim('  No transactions matched by any rule.'));
    return;
  }

  console.log(`  ${txnMatches.length} transaction(s) would be affected.`);

  if (opts.verbose) {
    for (const { txn, finalChanges } of txnMatches.slice(0, 20)) {
      console.log('  ' + formatTransaction(txn) + chalk.dim(' → ' + JSON.stringify(finalChanges)));
    }
  }

  const { applied: txnApplied } = await applyTransactionChanges(txnMatches, { dryRun: opts.dryRun });

  // ── Confirmation report ──
  const txnChanges = {
    applied: txnApplied,
    unexpected: [],
  };

  console.log(formatConfirmationReport(applyResult, txnChanges, meta));
}

// ── Help ───────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${chalk.bold('Actual Budget Rule Refinement System')}

${chalk.bold('Commands:')}
  audit     Analyse existing rules for issues + AI refinement suggestions
  suggest   AI-powered suggestions to improve existing rules
  gaps      Find uncategorized transactions + propose new rules
  run       Full pipeline: audit → gaps → AI → review → apply → confirm

${chalk.bold('Flags:')}
  --dry-run       Simulate writes (no changes made). Default: true unless --confirm
  --confirm       Apply changes to Actual Budget (overrides --dry-run)
  --days=<N>      Lookback window in days for transactions (default: 90)
  --account=<id>  Restrict to one account
  --ai=<backend>  AI backend: 'anthropic' or 'ollama' (default: env AI_BACKEND)
  --no-ai         Skip AI, only rule-engine analysis
  --verbose       Print full rule and transaction details
  --help          Show this help

${chalk.bold('Environment (.env):')}
  ACTUAL_DATA_DIR        Path to local budget file directory
  ACTUAL_SERVER_URL      Actual Budget server URL
  ACTUAL_PASSWORD        Server password
  ACTUAL_SYNC_ID         Budget sync ID
  AI_BACKEND             'anthropic' | 'ollama' (default: ollama)
  ANTHROPIC_API_KEY      API key for Anthropic Claude
  ANTHROPIC_MODEL        Claude model (default: claude-opus-4-7)
  OLLAMA_BASE_URL        Ollama base URL (default: http://localhost:11434)
  OLLAMA_MODEL           Ollama model (default: llama3.2)
  DRY_RUN                'true' | 'false' (default: true)
  LOOKBACK_DAYS          Days of transactions to examine (default: 90)
`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main() {
  loadDotEnv();
  const opts = parseArgs();

  if (opts.help || !opts.command) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  const COMMANDS = { audit: cmdAudit, suggest: cmdSuggest, gaps: cmdGaps, run: cmdRun };

  if (!COMMANDS[opts.command]) {
    console.error(chalk.red(`Unknown command: '${opts.command}'\n`));
    printHelp();
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(chalk.yellow('Running in DRY-RUN mode. Pass --confirm to apply changes.\n'));
  }

  await initClient();

  try {
    await COMMANDS[opts.command](opts);
  } finally {
    await shutdownClient();
  }
}

main().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
