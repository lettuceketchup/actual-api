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

export function snapshotTransactions(transactions) {
  return new Map(
    transactions.map(txn => [
      txn.id,
      { category: txn.category ?? null, notes: txn.notes ?? null, payee: txn.payee ?? null },
    ])
  );
}

export async function fetchAndVerifyUnexpected(snapshot, appliedChanges, accountIds, meta) {
  // Re-fetch the transactions that were in scope, then compare against snapshot.
  // Any field change on a transaction NOT in our applied set is unexpected.
  const expectedChangedIds = new Set(appliedChanges.map(c => c.txn.id));
  const unexpected = [];

  // Fetch a fresh copy of each affected account's transactions
  const txnsById = new Map();
  for (const accountId of accountIds) {
    try {
      const fresh = await api.getTransactions(accountId);
      for (const t of fresh) txnsById.set(t.id, t);
    } catch {
      // If a single account fetch fails, skip it — don't abort the whole verification
    }
  }

  for (const [id, original] of snapshot.entries()) {
    const current = txnsById.get(id);
    if (!current) continue; // transaction no longer exists — skip

    for (const field of ['category', 'notes', 'payee']) {
      const cur = current[field] ?? null;
      const orig = original[field];
      if (cur !== orig && !expectedChangedIds.has(id)) {
        unexpected.push({ txn: current, field, originalValue: orig, newValue: cur });
      }
    }
  }

  return unexpected;
}
