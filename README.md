# Telerelation Finance ERP

A clean standalone financial ERP application focused on finance workflows only.

## Included Modules

- Role-based auth (Admin, Accountant, Partner, Project Manager, Employee, Viewer)
- Google login endpoint support (ID token flow) with production verification when `GOOGLE_CLIENT_ID` is set
- Projects and PM time tracking
- Invoice lifecycle: draft, submit, approve/reject, send, preview, payment state updates
- QuickBooks integration skeleton: OAuth connect, callback, webhook, sync logs, manual invoice push, polling hook
- QuickBooks full pull sync: customers, chart of accounts, invoices, payments, and multi-object transaction ingestion
- Transactions import + classification + invoice matching
- Multi-invoice allocation support for single bank receipts
- Management accounting layer with reclass adjustments
- Reconciliation board + auto-match workflow
- Expenses ledger
- Poncho settlements
- Payroll runs
- ASAR Tower capex tracker + depreciation snapshot
- Partner draws
- Reports: statutory P&L/Cash Flow/Balance Sheet/AR Aging/Utilisation + management consolidated reports
- QBO-first finance workspace UI with `Home / Work / Manage` mega-menu navigation
- Billing workspace UI:
  - create invoice
  - submit/approve/reject/send
  - manual payment recording
  - QBO sync trigger
  - reconciliation board + auto-match
- Banking Hub workspace UI:
  - Meezan / Wise / BOFA / Chase cash rails
  - statement intake with default entity/account mapping
  - reconciliation queue visibility
- Ventures workspace UI:
  - Poncho settlement tracker
  - ASAR tower capex register
- Reports workspace UI:
  - statutory reports (P&L, cash flow, balance sheet, AR aging, utilisation)
  - management reports (LOS, management P&L, treasury, upwork)

### UI Navigation

- `Work -> Client Billing`: full AR and invoice lifecycle.
- `Work -> Banking Hub`: cash intake and reconciliation workflow.
- `Work -> Expenses`: expense capture and reimbursement queue.
- `Work -> Ventures`: Poncho and ASAR portfolio views.
- `Work -> Reports`: accounting-style report pack + management analytics.
- Finance dashboard KPIs + PM dashboard
- Audit log + notification queue processing

## Tech

- Backend: Node.js + Express
- Frontend: Vanilla JS SPA + custom CSS
- Storage: JSON file DB (`data/finance-db.json`) for easy local testing
- Optional persistence hardening: PostgreSQL-backed core finance domains
  - `users`
  - `approvalMatrixVersions`
  - `approvalEvents`
  - `evidenceRecords`
  - `journals`
  - `closePeriods`

## Quick Start

1. `cd "/Users/muhammadashfaq/Documents/New project/Telerelation-ERP/telerelation-finance"`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`
5. Open [http://localhost:4100](http://localhost:4100)

## PostgreSQL Mode

This project can now run in a hybrid migration mode where core finance domains are sourced from PostgreSQL while the remaining domains stay on the JSON store until a later migration sprint.

### Required environment

- `TR_PERSISTENCE_MODE=postgres`
- `TR_DATABASE_URL=postgresql://...`
- optional: `TR_PSQL_BIN=/path/to/psql`

### Bootstrap PostgreSQL

```bash
cd "/Users/muhammadashfaq/Documents/New project/Telerelation-ERP/telerelation-finance"
TR_PERSISTENCE_MODE=postgres TR_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/telerelation_finance" npm run db:init
```

### Start with PostgreSQL-backed core finance domains

```bash
cd "/Users/muhammadashfaq/Documents/New project/Telerelation-ERP/telerelation-finance"
TR_PERSISTENCE_MODE=postgres TR_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/telerelation_finance" npm run start:postgres
```

### What is PostgreSQL-backed now

- users / auth hydration
- approval matrix versions
- approval history events
- evidence metadata
- journals
- close periods

The remaining operational source records still use the JSON store in this sprint.

## Demo Users

- `admin@telerelation.local` / `admin123`
- `accountant@telerelation.local` / `account123`
- `partner@telerelation.local` / `partner123`
- `pm@telerelation.local` / `pm123`
- `employee@telerelation.local` / `employee123`
- `viewer@telerelation.local` / `viewer123`

## Important Notes

- This project is intentionally isolated from other modules and can be deployed independently.
- Data persists in `data/finance-db.json`; delete that file to reset seed data.
- Without SMTP configuration, notifications are simulated as sent.
- Without QBO credentials, QBO endpoints remain available but invoice push will log sync failures instead of connecting.
- `QBO_ENVIRONMENT=sandbox` requires at least one Intuit sandbox company on the connected Intuit user.
- QuickBooks production OAuth requires an HTTPS redirect URI on a deployed host; `localhost` is valid for sandbox development only.
- Without `GOOGLE_CLIENT_ID`, Google token login uses local decode fallback intended for development only.

## Management Rules

- Entity base currencies are configured as:
  - `US -> USD`
  - `UK -> GBP`
  - `PK -> PKR`
- Chase card default classification:
  - Account containing `Chase` => `Partner Draw - Asnan`
  - If explicitly tagged reimbursable (`reimbursable=true` or `#reimbursable` / `#biz` in description), it classifies as `Operating Expense`
- Upwork receipts:
  - Auto-tagged with `channel=UPWORK`
  - Supports matching one Wise GBP receipt to multiple invoices
- Pakistan / Meezan expenses:
  - Record via `Work -> Expenses` in UI, or `POST /api/expenses`
  - Set `entity=PK`, `currency=PKR`, `account=Meezan PKR`
- Employee reimbursements:
  - Record employee-paid expense with `employeeId` + `reimbursementNeeded=true`
  - Review queue in `Work -> Expenses`
  - Settle using `POST /api/reimbursements/:expenseId/settle` (creates cash-out transaction)

## QBO Full Pull

- API: `POST /api/qbo/pull/full`
- UI: QuickBooks view -> `Run Full Pull`
- Pulls and upserts into ERP:
  - Customers -> clients
  - Chart of accounts -> accounts
  - Invoices -> invoices (linked via `qboInvoiceId`)
  - Payments -> payments
  - Transaction objects -> ledger rows (`source=QBO_*`):
    - `JournalEntry`
    - `Purchase`
    - `Bill`
    - `BillPayment`
    - `Deposit`
    - `Transfer`
    - `SalesReceipt`
    - `VendorCredit`
    - `CreditCardPayment`
    - `CustomerPayment`
- P&L and Cash Flow include QBO imported transaction adjustments by default.
- Sync validation checklist:
  - `GET /api/qbo/checklist`
  - Includes pass/fail checks for required fields and object coverage (`fetched` vs `imported`).
- Transaction-level lineage feed:
  - `GET /api/qbo/transactions`
  - Returns full QBO-origin transaction rows with source trace fields:
    - `sourceObjectType`, `sourceObjectId`, `sourceLineId`, `reference`, `qboAccountId`
  - Supports filters: `fromDate`, `toDate`, `entity`, `objectType`, `search`, `limit`.

## QuickBooks Production Setup

To connect to actual QuickBooks production instead of sandbox:

1. Deploy this app on an HTTPS domain.
2. Set:
   - `QBO_ENVIRONMENT=production`
   - `APP_BASE_URL=https://your-domain`
   - `QBO_REDIRECT_URI=https://your-domain/api/qbo/callback`
3. Add the exact same redirect URI in the Intuit production app settings.
4. Restart the server and reconnect from `Manage -> QuickBooks`.

The app now surfaces production-readiness blockers directly in the QuickBooks workspace.

## Management Consolidation Layer

- Settings API:
  - `GET /api/settings/finance-model`
  - `PATCH /api/settings/finance-model`
- Reclass adjustments:
  - `GET /api/management/adjustments`
  - `POST /api/management/adjustments`
  - `PATCH /api/management/adjustments/:adjustmentId`
- Management reports:
  - `GET /api/reports/management/pl`
  - `GET /api/reports/management/entries`
  - `GET /api/reports/management/treasury`
  - `GET /api/reports/management/partner-ledger`
  - `GET /api/reports/management/upwork`

## QBO Tagging + LOS Reporting

- Revenue by line of service from QBO invoices:
  - `GET /api/reports/qbo/revenue-by-los`
- Update invoice reporting tags:
  - `PATCH /api/invoices/:invoiceId/tags`
- During QBO full pull, invoice tagging fields are auto-inferred where possible:
  - `lineOfService` (TRDEV/TRFINANCE/TRBUILD)
  - `businessUnit`
  - `channel`

### Management filters

- Report filters supported across management endpoints:
  - `fromDate`, `toDate`
  - `entity` (`US`, `UK`, `PK`)
  - `lineOfService`
  - `businessUnit`
  - `channel`
  - `includeIntercompany`
  - `includeCapex`

### Multi-Invoice Match API

- Endpoint: `POST /api/transactions/:transactionId/match`
- Single invoice body:
  - `{ "invoiceId": "INV-0001" }`
- Multi-invoice allocation body:
  - `{ "allocations": [{ "invoiceId": "INV-0001", "amount": 1200 }, { "invoiceId": "INV-0002", "amount": 800 }] }`
- `invoiceId` accepts either internal invoice ID or invoice number.

## Deploy Later (Suggested)

- Deploy as a Node service on Render/Fly.io/Railway or behind Nginx on a VM.
- Move from JSON DB to PostgreSQL for production scale.
- Add session hardening (rotating JWT secret, secure cookie strategy if needed, HTTPS-only).
- Configure real Google OAuth + QuickBooks OAuth + SMTP credentials in environment settings.
