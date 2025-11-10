# Actual Budget API Integration

A Node.js application for extracting, analyzing, and updating financial data from [Actual Budget](https://actualbudget.org/) using their official API.

## Overview

This project provides tools to programmatically interact with Actual Budget data for:
- **Data Extraction**: Export transactions, categories, accounts, and budgets
- **Analysis**: Generate insights, trends, and categorization suggestions
- **AI Integration**: Prepare data for AI-powered financial analysis and recommendations
- **Data Updates**: Programmatically update transactions, categories, and budgets

## Features (Planned)

- 📊 Extract transaction data with flexible filtering
- 🏷️ Smart transaction categorization using pattern matching and AI
- 📈 Budget analysis and trend reporting
- 🤖 AI-ready data export formats (JSON, CSV)
- ✍️ Bulk transaction updates
- 🔄 Automated category suggestions based on transaction history

## Prerequisites

- Node.js 18.0.0 or higher
- An Actual Budget installation (server or local file)
- Access to your Actual Budget data (sync ID and password for server, or file path for local)

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd actual-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your Actual Budget credentials
   ```

## Configuration

Edit `.env` file with your Actual Budget settings:

### Server-based Setup
```env
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_SYNC_ID=your_sync_id
```

### File-based Setup
```env
ACTUAL_DATA_DIR=./actual-data
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## Project Structure

```
actual-api/
├── src/
│   ├── index.js           # Main entry point
│   ├── extractors/        # Data extraction modules
│   ├── analyzers/         # Analysis and reporting
│   ├── updaters/          # Data modification functions
│   └── utils/             # Shared utilities
├── exports/               # Generated reports and exports
├── PLAN.md               # Detailed implementation plan
└── .github/
    └── copilot-instructions.md  # AI coding agent guidelines
```

## Documentation

- [Implementation Plan](PLAN.md) - Detailed roadmap and architecture
- [Actual Budget API Docs](https://actualbudget.org/docs/api/) - Official API reference
- [Copilot Instructions](.github/copilot-instructions.md) - Guidelines for AI assistance

## Development Roadmap

See [PLAN.md](PLAN.md) for detailed implementation phases and tasks.

## Contributing

Contributions welcome! Please read the implementation plan and follow the project conventions outlined in `.github/copilot-instructions.md`.

## License

MIT

## Resources

- [Actual Budget](https://actualbudget.org/)
- [Actual Budget API Documentation](https://actualbudget.org/docs/api/)
- [@actual-app/api NPM Package](https://www.npmjs.com/package/@actual-app/api)
