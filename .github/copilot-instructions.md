# Copilot Instructions for Actual Budget API

## Project Overview

This is a Node.js application that integrates with [Actual Budget](https://actualbudget.org/) via the `@actual-app/api` package. The project extracts financial data, performs analysis, enables AI-powered categorization, and updates budget data programmatically.

## Architecture & Code Organization

### Module Structure
- **`src/extractors/`**: Data retrieval functions (read-only operations)
- **`src/analyzers/`**: Analysis, reporting, and pattern detection
- **`src/updaters/`**: Data modification functions (write operations)
- **`src/utils/`**: Shared utilities (connection, formatting, logging)

### Separation Principle
Keep strict boundaries between extractors (read), analyzers (compute), and updaters (write). Extractors never modify data; updaters require explicit confirmation flags.

## Key Conventions

### ES Modules
This project uses ES6 modules (`"type": "module"` in package.json). Always use:
```javascript
import api from '@actual-app/api';
export { functionName };
```

### Async/Await Pattern
All Actual Budget API calls are asynchronous. Use async/await consistently:
```javascript
async function getTransactions() {
  await api.init({ ... });
  const transactions = await api.getTransactions();
  await api.shutdown();
  return transactions;
}
```

### Connection Management
Always initialize and properly shutdown the API connection:
```javascript
await api.init({
  dataDir: process.env.ACTUAL_DATA_DIR,
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
  syncId: process.env.ACTUAL_SYNC_ID
});

try {
  // Your operations here
} finally {
  await api.shutdown();
}
```

### Error Handling
Wrap all API operations in try/catch with descriptive errors:
```javascript
try {
  const result = await api.someOperation();
  return result;
} catch (error) {
  console.error('Failed to perform operation:', error.message);
  throw new Error(`Operation failed: ${error.message}`);
}
```

## Actual Budget API Specifics

### Data Access Patterns
- Use `api.getTransactions(accountId, startDate, endDate)` for filtered transaction retrieval
- Use `api.getAccounts()` to list all accounts
- Use `api.getCategories()` to fetch category hierarchy (groups and categories)
- Use `api.getPayees()` for payee list

### Transaction Structure
Transactions have this general shape:
```javascript
{
  id: 'uuid',
  account: 'account-id',
  date: 'YYYY-MM-DD',
  amount: -5000, // cents (negative = expense)
  payee: 'payee-id',
  category: 'category-id',
  notes: 'string',
  cleared: true/false
}
```

### Amount Handling
**Critical**: Amounts are in cents/smallest currency unit (e.g., $50.00 = 5000). Always convert when displaying:
```javascript
const dollars = amount / 100;
const formatted = (amount / 100).toFixed(2);
```

### Date Format
Dates are ISO strings 'YYYY-MM-DD'. Use JavaScript Date objects for manipulation:
```javascript
const today = new Date().toISOString().split('T')[0];
```

## Development Workflows

### Environment Setup
1. Copy `.env.example` to `.env`
2. Configure either server or file-based connection
3. Run `npm install` to install dependencies
4. Use `npm run dev` for development with auto-reload

### Testing Approach
- Test with a **copy** of the budget file, never production data
- Use small date ranges initially (e.g., one month)
- Implement `--dry-run` flags for all update operations
- Log all modifications before committing them

### Adding New Features
1. Follow the module structure: extractors/analyzers/updaters
2. Create focused, single-purpose functions
3. Export functions from module index if reusable
4. Update PLAN.md to check off completed tasks
5. Document function parameters and return values with JSDoc

## Common Patterns

### Filtering Transactions
```javascript
// Filter by date range
const startDate = '2024-01-01';
const endDate = '2024-01-31';
const transactions = await api.getTransactions(accountId, startDate, endDate);

// Filter by category in memory
const categoryTransactions = transactions.filter(t => t.category === categoryId);
```

### Category Hierarchy
Categories have groups. Structure is:
```javascript
{
  grouped: [
    {
      id: 'group-id',
      name: 'Group Name',
      categories: [
        { id: 'cat-id', name: 'Category Name', group_id: 'group-id' }
      ]
    }
  ]
}
```

### Updating Transactions
```javascript
await api.updateTransaction(transactionId, {
  category: newCategoryId,
  notes: 'Updated via API',
  // Only include fields you want to change
});
```

## AI Integration Guidelines

### Data Formatting for AI
When preparing transaction data for AI analysis:
- Include context: payee name, amount, date, current category
- Provide category options with descriptions
- Format as clear JSON or structured text
- Limit batch size to avoid token limits (50-100 transactions)

### Categorization Confidence
When implementing AI categorization:
- Include confidence scores (0.0-1.0)
- Only auto-apply changes above threshold (e.g., 0.85)
- Provide review list for medium confidence (0.5-0.85)
- Flag low confidence for manual review

## Performance Considerations

### Large Datasets
- Fetch in date-range chunks (3-6 months at a time)
- Process transactions in batches for updates
- Use streaming or pagination for exports
- Cache metadata (accounts, categories, payees) - they change infrequently

### Connection Reuse
For multiple operations, reuse the API connection:
```javascript
await api.init({ ... });
const accounts = await api.getAccounts();
const categories = await api.getCategories();
const transactions = await api.getTransactions();
await api.shutdown();
```

## Security & Safety

### Sensitive Data
- Never commit `.env` file (already in `.gitignore`)
- Store passwords/sync IDs as environment variables
- Don't log sensitive information (passwords, full sync IDs)

### Data Integrity
- Always validate data before updates
- Implement reversible operations where possible
- Maintain audit logs of all modifications
- Use transactions/batching for related updates

## Reference Documentation

- [Actual Budget API Docs](https://actualbudget.org/docs/api/)
- [Implementation Plan](PLAN.md) - Detailed roadmap
- [@actual-app/api on NPM](https://www.npmjs.com/package/@actual-app/api)

## Quick Start for Common Tasks

### Extract all transactions for analysis
```javascript
import api from '@actual-app/api';

await api.init({ dataDir: './actual-data' });
const accounts = await api.getAccounts();
const allTransactions = [];

for (const account of accounts) {
  const trans = await api.getTransactions(account.id);
  allTransactions.push(...trans);
}

await api.shutdown();
```

### Find uncategorized transactions
```javascript
const uncategorized = transactions.filter(t => !t.category);
```

### Get spending by category
```javascript
const categories = await api.getCategories();
const spending = {};

transactions.forEach(t => {
  if (t.amount < 0) { // Expenses are negative
    spending[t.category] = (spending[t.category] || 0) + Math.abs(t.amount);
  }
});
```
