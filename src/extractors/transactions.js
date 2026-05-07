import { api } from '../utils/client.js';

export async function fetchAllTransactions(meta, { days = 90, accountId = null } = {}) {
  const startDate = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .split('T')[0];

  const accounts = accountId
    ? [meta.accountsById.get(accountId)].filter(Boolean)
    : meta.accounts;

  const results = await Promise.all(
    accounts.map(account =>
      api.getTransactions(account.id, startDate, undefined)
    )
  );

  return results.flat();
}

export function filterUncategorized(transactions, meta) {
  return transactions.filter(txn => {
    if (txn.tombstone) return false;
    if (txn.is_child) return false;      // sub-transactions
    if (txn.category) return false;      // already categorized
    if (txn.transfer_id) return false;   // transfer legs

    // exclude transfer payees (payee points to another account)
    const payee = meta.payeesById.get(txn.payee);
    if (payee?.transfer_acct) return false;

    return true;
  });
}

export function enrichTransaction(txn, meta) {
  return {
    ...txn,
    payeeName: meta.payeesById.get(txn.payee)?.name ?? txn.imported_payee ?? '(unknown)',
    accountName: meta.accountsById.get(txn.account)?.name ?? txn.account,
  };
}

export function groupByPayee(transactions) {
  const groups = new Map();

  for (const txn of transactions) {
    const key = txn.imported_payee || txn.payeeName || '(unknown)';
    if (!groups.has(key)) {
      groups.set(key, {
        importedPayee: txn.imported_payee ?? null,
        payeeName: txn.payeeName,
        payeeId: txn.payee ?? null,
        transactions: [],
      });
    }
    groups.get(key).transactions.push(txn);
  }

  return Array.from(groups.values()).map(g => ({
    ...g,
    count: g.transactions.length,
    amounts: g.transactions.map(t => t.amount),
    dateRange: {
      from: g.transactions.map(t => t.date).sort()[0],
      to: g.transactions.map(t => t.date).sort().at(-1),
    },
    sampleNotes: [...new Set(g.transactions.map(t => t.notes).filter(Boolean))].slice(0, 3),
  }));
}
