import { api } from '../utils/client.js';
import chalk from 'chalk';

export async function applyTransactionChanges(matchResults, { dryRun = true } = {}) {
  const applied = [];
  const skipped = [];
  const failed = [];

  for (const { txn, finalChanges } of matchResults) {
    // Only write fields that differ from current values
    const diffChanges = {};
    for (const [field, newVal] of Object.entries(finalChanges)) {
      if (field.startsWith('_')) continue; // internal markers like _splitIntent
      if (txn[field] !== newVal) {
        diffChanges[field] = newVal;
      }
    }

    if (Object.keys(diffChanges).length === 0) {
      skipped.push({ txn, reason: 'no change needed' });
      continue;
    }

    const before = {};
    for (const field of Object.keys(diffChanges)) {
      before[field] = txn[field] ?? null;
    }

    if (dryRun) {
      console.log(chalk.dim(`  [dry-run] ${txn.id}: ${JSON.stringify(diffChanges)}`));
      applied.push({ txn, before, changes: diffChanges, dryRun: true });
    } else {
      try {
        await api.updateTransaction(txn.id, diffChanges);
        applied.push({ txn, before, changes: diffChanges });
      } catch (err) {
        console.error(chalk.red(`  ✗ Failed to update transaction ${txn.id}: ${err.message}`));
        failed.push({ txn, error: err.message });
      }
    }
  }

  return { applied, skipped, failed };
}

export async function snapshotTransactions(transactions) {
  // Capture relevant fields before rules run so we can detect unexpected changes
  return new Map(
    transactions.map(txn => [
      txn.id,
      { category: txn.category, notes: txn.notes, payee: txn.payee },
    ])
  );
}

export function detectUnexpectedChanges(snapshot, appliedChanges, transactions) {
  const expectedChangedIds = new Set(appliedChanges.map(c => c.txn.id));
  const unexpected = [];

  for (const txn of transactions) {
    const original = snapshot.get(txn.id);
    if (!original) continue;

    for (const field of ['category', 'notes', 'payee']) {
      if (txn[field] !== original[field] && !expectedChangedIds.has(txn.id)) {
        unexpected.push({ txn, field, originalValue: original[field], newValue: txn[field] });
      }
    }
  }

  return unexpected;
}
