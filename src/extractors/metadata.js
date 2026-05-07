import { api } from '../utils/client.js';

export async function fetchMetadata() {
  const [rawAccounts, rawCategories, rawPayees] = await Promise.all([
    api.getAccounts(),
    api.getCategories(),
    api.getPayees(),
  ]);

  // getCategories() returns a flat array of both group entities and leaf entities.
  // Leaves have group_id; groups have a categories array.
  const categoryGroups = rawCategories.filter(c => c.categories !== undefined);
  const categories = rawCategories.filter(c => c.group_id !== undefined);

  const categoriesById = new Map(categories.map(c => [c.id, c]));
  const categoryGroupsById = new Map(categoryGroups.map(g => [g.id, g]));
  const payeesById = new Map(rawPayees.map(p => [p.id, p]));
  const accountsById = new Map(rawAccounts.map(a => [a.id, a]));

  return {
    accounts: rawAccounts,
    accountsById,
    categories,
    categoryGroups,
    categoriesById,
    categoryGroupsById,
    payees: rawPayees,
    payeesById,
  };
}
