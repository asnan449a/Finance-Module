import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { buildDefaultPkTaxSettings } from './services/pk-tax.js';
import {
  ensurePostgresReady,
  hydrateMigratedDomainsFromPostgres,
  persistMigratedDomainsToPostgres,
  postgresPersistenceEnabled,
  postgresPersistenceStatus
} from './persistence/postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configuredDbPath = process.env.TR_DB_PATH ? path.resolve(process.env.TR_DB_PATH) : null;
const dataDir = path.resolve(
  process.env.TR_DATA_DIR
    || (configuredDbPath ? path.dirname(configuredDbPath) : path.resolve(__dirname, '..', 'data'))
);
const invoicesDir = path.resolve(process.env.TR_INVOICES_DIR || path.resolve(__dirname, '..', 'invoices'));
const evidenceDir = path.resolve(process.env.TR_EVIDENCE_DIR || path.resolve(dataDir, 'evidence'));
const dbPath = configuredDbPath || path.resolve(dataDir, 'finance-db.json');
const DEMO_SEED_VERSION = 1;

const role = {
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  PARTNER: 'PARTNER',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  VIEWER: 'VIEWER'
};

const defaultRules = [
  { id: 'RULE-1', pattern: 'stripe', category: 'Revenue' },
  { id: 'RULE-2', pattern: 'salary', category: 'Payroll' },
  { id: 'RULE-3', pattern: 'rent', category: 'Operating Expense' },
  { id: 'RULE-4', pattern: 'wise', category: 'Revenue' },
  { id: 'RULE-5', pattern: 'fee', category: 'Bank Fee' }
];

const defaultCategories = [
  { id: 'CAT-1', code: 'REV', name: 'Revenue', type: 'INCOME' },
  { id: 'CAT-2', code: 'PAY', name: 'Payroll', type: 'EXPENSE' },
  { id: 'CAT-3', code: 'OPEX', name: 'Operating Expense', type: 'EXPENSE' },
  { id: 'CAT-4', code: 'CAPEX', name: 'Capital Expenditure', type: 'ASSET' },
  { id: 'CAT-5', code: 'FEE', name: 'Bank Fee', type: 'EXPENSE' }
];

function buildDefaultFxRatesToUsd() {
  return {
    USD: 1,
    GBP: 1.27,
    PKR: 0.0036
  };
}

function buildDefaultApprovalMatrix() {
  return {
    rules: [
      {
        documentType: 'INVOICE',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: []
      },
      {
        documentType: 'INVOICE',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: []
      },
      {
        documentType: 'VENDOR_BILL',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT']
      },
      {
        documentType: 'VENDOR_BILL',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'US',
        minAmount: 0,
        maxAmount: 1000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'US',
        minAmount: 1000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'UK',
        minAmount: 0,
        maxAmount: 1000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'UK',
        minAmount: 1000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'PK',
        minAmount: 0,
        maxAmount: 250000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'PK',
        minAmount: 250000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'CUSTOMER_RECEIPT',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'CUSTOMER_RECEIPT',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'VENDOR_PAYMENT',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'VENDOR_PAYMENT',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'REIMBURSEMENT',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['SETTLE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'JOURNAL',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: [],
        requiredEvidenceCategories: []
      },
      {
        documentType: 'CLOSE_PERIOD',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['CLOSE_SUPPORT', 'CLOSE_MEMO']
      },
      {
        documentType: 'REOPEN_PERIOD',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['REOPEN'],
        requiredEvidenceCategories: ['REOPEN_SUPPORT', 'CLOSE_SUPPORT']
      }
    ]
  };
}

function buildDefaultGlobalChartAccounts() {
  return [
    { id: 'GLA-1', code: '1000', name: 'Cash and Cash Equivalents', type: 'ASSET', reportingGroup: 'Cash', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-2', code: '1010', name: 'Cash Clearing / Undeposited Funds', type: 'ASSET', reportingGroup: 'Working Capital', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-14', code: '1020', name: 'Intercompany Clearing', type: 'ASSET', reportingGroup: 'Intercompany', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-3', code: '1100', name: 'Accounts Receivable', type: 'ASSET', reportingGroup: 'Working Capital', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-4', code: '1200', name: 'Due from Related Parties', type: 'ASSET', reportingGroup: 'Related Party', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-5', code: '1500', name: 'Capital Projects / Tower', type: 'ASSET', reportingGroup: 'Capex', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-6', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', reportingGroup: 'Working Capital', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-16', code: '2010', name: 'Payroll Payable', type: 'LIABILITY', reportingGroup: 'Payroll', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-17', code: '2020', name: 'Withholding Tax Payable', type: 'LIABILITY', reportingGroup: 'Tax', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-18', code: '2030', name: 'Other Payroll Deductions Payable', type: 'LIABILITY', reportingGroup: 'Payroll', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-7', code: '2100', name: 'Credit Cards and Card Payables', type: 'LIABILITY', reportingGroup: 'Treasury', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-15', code: '2200', name: 'Due to Related Parties', type: 'LIABILITY', reportingGroup: 'Related Party', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-8', code: '3000', name: 'Partner Capital and Drawings', type: 'EQUITY', reportingGroup: 'Equity', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-19', code: '3900', name: 'Opening Balance Equity', type: 'EQUITY', reportingGroup: 'Equity', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-9', code: '4000', name: 'Services Revenue', type: 'INCOME', reportingGroup: 'Revenue', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-10', code: '4100', name: 'Product / App Revenue', type: 'INCOME', reportingGroup: 'Revenue', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-11', code: '5000', name: 'Operating Expense', type: 'EXPENSE', reportingGroup: 'Operating Expense', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-12', code: '5100', name: 'Payroll Expense', type: 'EXPENSE', reportingGroup: 'Payroll', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'GLA-13', code: '5200', name: 'Bank Fees', type: 'EXPENSE', reportingGroup: 'Treasury', status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() }
  ];
}

function buildDefaultManualSourceAccountTemplates() {
  return [
    {
      name: 'BoFA Operating USD',
      provider: 'BoFA',
      sourceSystem: 'MANUAL',
      sourceLedger: 'US_BOOKS',
      entity: 'US',
      currency: 'USD',
      accountRole: 'BANK',
      isCashAccount: true,
      showInBankingHub: true,
      status: 'ACTIVE',
      notes: 'US operating bank account'
    },
    {
      name: 'Wise GBP Main',
      provider: 'Wise',
      sourceSystem: 'MANUAL',
      sourceLedger: 'UK_BOOKS',
      entity: 'UK',
      currency: 'GBP',
      accountRole: 'BANK',
      isCashAccount: true,
      showInBankingHub: true,
      status: 'ACTIVE',
      notes: 'UK collection and settlement account'
    },
    {
      name: 'Meezan Main PKR',
      provider: 'Meezan',
      sourceSystem: 'MANUAL',
      sourceLedger: 'PK_BOOKS',
      entity: 'PK',
      currency: 'PKR',
      accountRole: 'BANK',
      isCashAccount: true,
      showInBankingHub: true,
      status: 'ACTIVE',
      notes: 'Pakistan operating bank account'
    },
    {
      name: 'Chase Corporate Card',
      provider: 'Chase',
      sourceSystem: 'MANUAL',
      sourceLedger: 'US_BOOKS',
      entity: 'US',
      currency: 'USD',
      accountRole: 'CREDIT_CARD',
      isCashAccount: true,
      showInBankingHub: true,
      status: 'ACTIVE',
      notes: 'US credit card and partner-draw review rail'
    }
  ];
}

function normalizeLookupText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function inferStarterGlobalCodeForSourceAccount(account) {
  const roleName = String(account?.accountRole || '').toUpperCase();
  const text = `${account?.name || ''} ${account?.externalName || ''} ${account?.notes || ''}`.toLowerCase();

  if (roleName === 'BANK' || roleName === 'WALLET') return '1000';
  if (roleName === 'CREDIT_CARD') return '2100';
  if (roleName === 'AR') return '1100';
  if (roleName === 'AP') return '2000';
  if (roleName === 'FIXED_ASSET') return '1500';
  if (roleName === 'EQUITY') return '3000';
  if (roleName === 'REVENUE') {
    if (text.includes('poncho') || text.includes('product') || text.includes('app')) return '4100';
    return '4000';
  }
  if (roleName === 'EXPENSE') {
    if (text.includes('payroll') || text.includes('salary') || text.includes('wage')) return '5100';
    if (text.includes('bank fee') || text.includes('bank charge') || text.includes('merchant fee') || text.includes('processing fee') || text.includes('stripe fee') || text.includes('upwork fee') || text.includes('fx')) return '5200';
    return '5000';
  }
  if (roleName === 'OTHER_ASSET') {
    if (text.includes('undeposited') || text.includes('clearing') || text.includes('customer payment')) return '1010';
    if (text.includes('tower') || text.includes('asar') || text.includes('capex')) return '1500';
    if (text.includes('related') || text.includes('partner') || text.includes('due from') || text.includes('loan')) return '1200';
  }
  if (roleName === 'OTHER_LIABILITY') {
    if (text.includes('card') || text.includes('credit')) return '2100';
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function buildSeedApprovalMatrixVersions() {
  return [
    {
      id: 'AMV-0001',
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveAt: nowIso(),
      changedByUserId: null,
      changeReason: 'Seed default approval policy',
      rules: buildDefaultApprovalMatrix().rules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dateOffsetDays(offset) {
  const current = new Date();
  current.setUTCDate(current.getUTCDate() + Number(offset || 0));
  return toDateKey(current);
}

function attachmentSafeName(value) {
  const cleaned = String(value || 'attachment.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'attachment.txt';
}

function fileChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pushDemoEvidenceRecord(db, {
  entityType,
  entityId,
  category = 'SUPPORT',
  note = '',
  fileName = 'attachment.txt',
  mimeType = 'text/plain',
  uploadedByUserId = null,
  content = ''
} = {}) {
  ensureDirs();
  const id = nextId(db, 'EVIDENCE', 'EVD');
  const safeName = `${id}-${attachmentSafeName(fileName)}`;
  const storagePath = path.resolve(evidenceDir, safeName);
  const buffer = Buffer.from(String(content || ''), 'utf8');
  fs.writeFileSync(storagePath, buffer);
  const uploadedAt = nowIso();
  const record = {
    id,
    entityType: String(entityType || '').toUpperCase(),
    entityId: String(entityId || ''),
    fileName: attachmentSafeName(fileName),
    storedFileName: safeName,
    mimeType,
    fileSize: buffer.length,
    uploadedByUserId,
    uploadedAt,
    note,
    category: String(category || 'SUPPORT').toUpperCase(),
    status: 'ACTIVE',
    supersedesEvidenceId: null,
    supersededByEvidenceId: null,
    supersededAt: null,
    storageProvider: 'local',
    storageKey: safeName,
    storagePath,
    checksumSha256: fileChecksum(buffer),
    originalExtension: path.extname(fileName || '') || null,
    removedByUserId: null,
    removedAt: null,
    removalNote: '',
    createdAt: uploadedAt,
    updatedAt: uploadedAt
  };
  db.evidenceRecords.push(record);
  return record;
}

function pushDemoApprovalEvent(db, {
  documentType,
  entityType,
  entityId,
  action,
  actorUserId = null,
  actorRole = null,
  note = '',
  statusAfter = null,
  policySnapshot = null
} = {}) {
  db.approvalEvents.push({
    id: nextId(db, 'APPROVAL_EVENT', 'APV'),
    documentType: String(documentType || '').toUpperCase(),
    entityType: String(entityType || '').toUpperCase(),
    entityId: String(entityId || ''),
    action: String(action || '').toUpperCase(),
    actorUserId,
    actorRole,
    note,
    metadata: null,
    evidenceCount: 0,
    qualifiedEvidenceCount: 0,
    statusAfter,
    policySnapshot,
    createdAt: nowIso()
  });
}

function ensureDemoInvoiceDocument(invoice) {
  if (!invoice?.invoiceNumber) return;
  const fileName = `${invoice.invoiceNumber}.html`;
  const filePath = path.resolve(invoicesDir, fileName);
  if (!fs.existsSync(filePath)) {
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    const lineRows = lineItems.map((line) => {
      const description = String(line.description || 'Line item');
      const amount = Number(line.amount || 0).toFixed(2);
      return `<tr><td>${description}</td><td style="text-align:right;">${amount}</td></tr>`;
    }).join('');
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${invoice.invoiceNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      .meta { color: #4b5563; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { padding: 10px 0; border-bottom: 1px solid #d1d5db; }
      th { text-align: left; color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
      .total { margin-top: 24px; font-size: 18px; font-weight: 700; text-align: right; }
    </style>
  </head>
  <body>
    <h1>Invoice ${invoice.invoiceNumber}</h1>
    <div class="meta">
      <div>Client: ${invoice.clientName || 'Unknown client'}</div>
      <div>Entity: ${invoice.entity || 'N/A'}</div>
      <div>Issue date: ${invoice.issueDate || 'N/A'}</div>
      <div>Due date: ${invoice.dueDate || 'N/A'}</div>
      <div>Currency: ${invoice.currency || 'USD'}</div>
    </div>
    <table>
      <thead>
        <tr><th>Description</th><th style="text-align:right;">Amount</th></tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="total">Total ${invoice.currency || 'USD'} ${Number(invoice.total || 0).toFixed(2)}</div>
  </body>
</html>`;
    fs.writeFileSync(filePath, html, 'utf8');
  }
  invoice.pdfUrl = `/api/invoices/${invoice.id}/document`;
}

function coreFinanceCollectionsAreSparse(db) {
  return !((db.clients || []).length || (db.invoices || []).length || (db.vendorBills || []).length || (db.transactions || []).length || (db.expenses || []).length || (db.journals || []).length);
}

function ensureDemoUser(db, { email, roleName, name, password, allowedEntities = null }) {
  let user = (db.users || []).find((row) => String(row.email || '').toLowerCase() === String(email || '').toLowerCase());
  if (!user) {
    user = {
      id: nextId(db, 'USER', 'USR'),
      name,
      email,
      role: roleName,
      passwordHash: bcrypt.hashSync(password, 10),
      googleSub: null,
      allowedEntities: allowedEntities ? [...allowedEntities] : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.users.push(user);
    return user;
  }
  user.name = user.name || name;
  user.role = user.role || roleName;
  user.passwordHash = user.passwordHash || bcrypt.hashSync(password, 10);
  if (allowedEntities) user.allowedEntities = [...allowedEntities];
  user.updatedAt = nowIso();
  return user;
}

function ensureDemoFinanceScenario(db, { force = false } = {}) {
  if (process.env.TR_ENABLE_DEMO_SEED === 'false') return false;
  if (!db.metadata || typeof db.metadata !== 'object') db.metadata = {};
  if (!force && Number(db.metadata.demoSeedVersion || 0) >= DEMO_SEED_VERSION && !coreFinanceCollectionsAreSparse(db)) {
    return false;
  }
  if (!force && !coreFinanceCollectionsAreSparse(db) && Number(db.metadata.demoSeedVersion || 0) >= DEMO_SEED_VERSION) {
    return false;
  }
  if (!force && !coreFinanceCollectionsAreSparse(db) && Number(db.metadata.demoSeedVersion || 0) === 0) {
    return false;
  }

  const admin = ensureDemoUser(db, {
    email: 'admin@telerelation.local',
    roleName: role.ADMIN,
    name: 'Admin',
    password: 'admin123'
  });
  const accountant = ensureDemoUser(db, {
    email: 'accountant@telerelation.local',
    roleName: role.ACCOUNTANT,
    name: 'Accountant',
    password: 'account123'
  });
  const partner = ensureDemoUser(db, {
    email: 'partner@telerelation.local',
    roleName: role.PARTNER,
    name: 'Partner',
    password: 'partner123',
    allowedEntities: ['US']
  });
  const projectManager = ensureDemoUser(db, {
    email: 'pm@telerelation.local',
    roleName: role.PROJECT_MANAGER,
    name: 'Project Manager',
    password: 'pm123',
    allowedEntities: ['US', 'UK']
  });
  const employee = ensureDemoUser(db, {
    email: 'employee@telerelation.local',
    roleName: role.EMPLOYEE,
    name: 'Employee',
    password: 'employee123',
    allowedEntities: ['PK']
  });
  ensureDemoUser(db, {
    email: 'viewer@telerelation.local',
    roleName: role.VIEWER,
    name: 'Viewer',
    password: 'viewer123',
    allowedEntities: ['US']
  });

  const clientRain = (db.clients || []).find((row) => String(row.name || '').toLowerCase() === 'rain partners') || (() => {
    const row = {
      id: nextId(db, 'CLIENT', 'CLI'),
      name: 'Rain Partners',
      email: 'finance@rainpartners.example',
      currency: 'USD',
      qboCustomerId: null,
      status: 'ACTIVE',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.clients.push(row);
    return row;
  })();
  const clientMeridian = (db.clients || []).find((row) => String(row.name || '').toLowerCase() === 'meridian advisory') || (() => {
    const row = {
      id: nextId(db, 'CLIENT', 'CLI'),
      name: 'Meridian Advisory',
      email: 'ap@meridianadvisory.example',
      currency: 'GBP',
      qboCustomerId: null,
      status: 'ACTIVE',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.clients.push(row);
    return row;
  })();

  const vendorTech = (db.vendors || []).find((row) => String(row.name || '').toLowerCase() === 'techsolutions ltd') || (() => {
    const row = {
      id: nextId(db, 'VENDOR', 'VEN'),
      name: 'TechSolutions Ltd',
      email: 'ap@techsolutions.example',
      defaultCurrency: 'PKR',
      entity: 'PK',
      status: 'ACTIVE',
      notes: 'Pakistan technology vendor',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.vendors.push(row);
    return row;
  })();
  const vendorWise = (db.vendors || []).find((row) => String(row.name || '').toLowerCase() === 'wise platform services') || (() => {
    const row = {
      id: nextId(db, 'VENDOR', 'VEN'),
      name: 'Wise Platform Services',
      email: 'billing@wise.example',
      defaultCurrency: 'GBP',
      entity: 'UK',
      status: 'ACTIVE',
      notes: 'International payment platform vendor',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.vendors.push(row);
    return row;
  })();
  const vendorBofa = (db.vendors || []).find((row) => String(row.name || '').toLowerCase() === 'bank of america card services') || (() => {
    const row = {
      id: nextId(db, 'VENDOR', 'VEN'),
      name: 'Bank of America Card Services',
      email: 'statements@bofa.example',
      defaultCurrency: 'USD',
      entity: 'US',
      status: 'ACTIVE',
      notes: 'US payment release demo vendor',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.vendors.push(row);
    return row;
  })();

  const projectRain = (db.projects || []).find((row) => String(row.code || '').toUpperCase() === 'RAIN-OPS') || (() => {
    const row = {
      id: nextId(db, 'PROJECT', 'PRJ'),
      code: 'RAIN-OPS',
      name: 'Rain Operations Advisory',
      clientId: clientRain.id,
      clientName: clientRain.name,
      projectManagerId: projectManager.id,
      businessUnit: 'TRFinance',
      lineOfService: 'TRFinance',
      type: 'TM',
      budgetAmount: 85000,
      budgetCurrency: 'USD',
      hourlyRate: 140,
      startDate: dateOffsetDays(-45),
      endDate: null,
      status: 'ACTIVE',
      entity: 'US',
      qboCustomerId: null,
      description: 'Monthly finance advisory and systems work',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.projects.push(row);
    return row;
  })();
  const projectMeridian = (db.projects || []).find((row) => String(row.code || '').toUpperCase() === 'MER-DEV') || (() => {
    const row = {
      id: nextId(db, 'PROJECT', 'PRJ'),
      code: 'MER-DEV',
      name: 'Meridian Build Sprint',
      clientId: clientMeridian.id,
      clientName: clientMeridian.name,
      projectManagerId: projectManager.id,
      businessUnit: 'TRDev',
      lineOfService: 'TRDev',
      type: 'FIXED',
      budgetAmount: 32000,
      budgetCurrency: 'GBP',
      hourlyRate: 110,
      startDate: dateOffsetDays(-28),
      endDate: null,
      status: 'ACTIVE',
      entity: 'UK',
      qboCustomerId: null,
      description: 'Product engineering support',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.projects.push(row);
    return row;
  })();

  const usBank = (db.accounts || []).find((row) => String(row.entity || '').toUpperCase() === 'US' && String(row.accountRole || '').toUpperCase() === 'BANK') || null;
  const ukBank = (db.accounts || []).find((row) => String(row.entity || '').toUpperCase() === 'UK' && String(row.accountRole || '').toUpperCase() === 'BANK') || null;
  const pkBank = (db.accounts || []).find((row) => String(row.entity || '').toUpperCase() === 'PK' && String(row.accountRole || '').toUpperCase() === 'BANK') || null;
  const usCard = (db.accounts || []).find((row) => String(row.entity || '').toUpperCase() === 'US' && String(row.accountRole || '').toUpperCase() === 'CREDIT_CARD') || null;

  const invoicePending = {
    id: nextId(db, 'INVOICE', 'INV'),
    invoiceNumber: 'TR-AR-1001',
    clientId: clientRain.id,
    clientName: clientRain.name,
    projectId: projectRain.id,
    projectCode: projectRain.code,
    issueDate: dateOffsetDays(-4),
    dueDate: dateOffsetDays(10),
    currency: 'USD',
    entity: 'US',
    total: 3800,
    subtotal: 3800,
    taxRate: 0,
    amountPaid: 0,
    status: 'PENDING_APPROVAL',
    approvalStatus: 'PENDING',
    lineItems: [{ description: 'Monthly advisory retainer', quantity: 1, rate: 3800, amount: 3800 }],
    lineOfService: null,
    businessUnit: 'TRFinance',
    channel: 'DIRECT',
    createdByUserId: accountant.id,
    approvedByUserId: null,
    approvedAt: null,
    notes: 'Awaiting partner review',
    internalNotes: 'High-value client billing pack',
    pdfUrl: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const invoiceOverdue = {
    id: nextId(db, 'INVOICE', 'INV'),
    invoiceNumber: 'TR-AR-1002',
    clientId: clientRain.id,
    clientName: clientRain.name,
    projectId: projectRain.id,
    projectCode: projectRain.code,
    issueDate: dateOffsetDays(-24),
    dueDate: dateOffsetDays(-9),
    currency: 'USD',
    entity: 'US',
    total: 7200,
    subtotal: 7200,
    taxRate: 0,
    amountPaid: 0,
    status: 'OVERDUE',
    approvalStatus: 'APPROVED',
    lineItems: [{ description: 'Operations control sprint', quantity: 1, rate: 7200, amount: 7200 }],
    lineOfService: 'TRFinance',
    businessUnit: 'TRFinance',
    channel: 'DIRECT',
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-23)}T14:00:00.000Z`,
    sentAt: `${dateOffsetDays(-23)}T14:30:00.000Z`,
    notes: 'Collections follow-up required',
    internalNotes: 'Customer has requested remittance detail',
    pdfUrl: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const invoicePartial = {
    id: nextId(db, 'INVOICE', 'INV'),
    invoiceNumber: 'TR-AR-1003',
    clientId: clientMeridian.id,
    clientName: clientMeridian.name,
    projectId: projectMeridian.id,
    projectCode: projectMeridian.code,
    issueDate: dateOffsetDays(-11),
    dueDate: dateOffsetDays(-2),
    currency: 'GBP',
    entity: 'UK',
    total: 6400,
    subtotal: 6400,
    taxRate: 0,
    amountPaid: 2400,
    status: 'PARTIAL',
    approvalStatus: 'APPROVED',
    lineItems: [{ description: 'Build sprint milestone 2', quantity: 1, rate: 6400, amount: 6400 }],
    lineOfService: 'TRDev',
    businessUnit: 'TRDev',
    channel: 'DIRECT',
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-10)}T11:00:00.000Z`,
    sentAt: `${dateOffsetDays(-10)}T11:20:00.000Z`,
    notes: 'Partial settlement received',
    internalNotes: '',
    pdfUrl: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const invoicePaid = {
    id: nextId(db, 'INVOICE', 'INV'),
    invoiceNumber: 'TR-AR-1004',
    clientId: clientRain.id,
    clientName: clientRain.name,
    projectId: projectRain.id,
    projectCode: projectRain.code,
    issueDate: dateOffsetDays(-38),
    dueDate: dateOffsetDays(-24),
    currency: 'USD',
    entity: 'US',
    total: 2500,
    subtotal: 2500,
    taxRate: 0,
    amountPaid: 2500,
    status: 'PAID',
    approvalStatus: 'APPROVED',
    lineItems: [{ description: 'January advisory retainer true-up', quantity: 1, rate: 2500, amount: 2500 }],
    lineOfService: 'TRFinance',
    businessUnit: 'TRFinance',
    channel: 'DIRECT',
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-37)}T15:00:00.000Z`,
    sentAt: `${dateOffsetDays(-37)}T15:30:00.000Z`,
    notes: 'Settled',
    internalNotes: '',
    pdfUrl: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!(db.invoices || []).length) db.invoices.push(invoicePending, invoiceOverdue, invoicePartial, invoicePaid);
  for (const invoice of db.invoices || []) {
    if (String(invoice.approvalStatus || '').toUpperCase() === 'APPROVED') {
      ensureDemoInvoiceDocument(invoice);
    }
  }

  const paymentPartial = {
    id: nextId(db, 'PAYMENT', 'PAY'),
    invoiceId: invoicePartial.id,
    amount: 2400,
    currency: 'GBP',
    source: 'MANUAL',
    reference: 'WISE-2400-MER',
    paidAt: dateOffsetDays(-6),
    status: 'PAID',
    approvalStatus: 'APPROVED',
    approvedByUserId: accountant.id,
    approvedAt: `${dateOffsetDays(-6)}T13:00:00.000Z`,
    createdByUserId: accountant.id,
    postedAt: `${dateOffsetDays(-6)}T13:05:00.000Z`,
    meta: { manual: true },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const paymentPaid = {
    id: nextId(db, 'PAYMENT', 'PAY'),
    invoiceId: invoicePaid.id,
    amount: 2500,
    currency: 'USD',
    source: 'MANUAL',
    reference: 'BOFA-2500-RAIN',
    paidAt: dateOffsetDays(-26),
    status: 'PAID',
    approvalStatus: 'APPROVED',
    approvedByUserId: accountant.id,
    approvedAt: `${dateOffsetDays(-26)}T10:00:00.000Z`,
    createdByUserId: accountant.id,
    postedAt: `${dateOffsetDays(-26)}T10:10:00.000Z`,
    meta: { manual: true },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!(db.payments || []).length) db.payments.push(paymentPartial, paymentPaid);

  const billPending = {
    id: nextId(db, 'VENDOR_BILL', 'BILL'),
    vendorId: vendorTech.id,
    vendorName: vendorTech.name,
    billNumber: 'PK-TS-0312',
    billDate: dateOffsetDays(-6),
    dueDate: dateOffsetDays(7),
    currency: 'PKR',
    entity: 'PK',
    category: 'Operating Expense',
    account: 'Technology & Software',
    businessUnit: 'CORPORATE',
    lineOfService: null,
    subtotal: 185000,
    total: 185000,
    amountPaid: 0,
    status: 'PENDING_APPROVAL',
    approvalStatus: 'PENDING',
    notes: 'Awaiting support review',
    qboBillId: null,
    source: 'ERP_AP',
    sourceAccountId: pkBank?.id || null,
    globalAccountId: null,
    lineItems: [{ description: 'Technology vendor retainer', amount: 185000, category: 'Operating Expense', businessUnit: 'CORPORATE', lineOfService: null, capexFlag: false }],
    payments: [],
    createdByUserId: accountant.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const billReady = {
    id: nextId(db, 'VENDOR_BILL', 'BILL'),
    vendorId: vendorBofa.id,
    vendorName: vendorBofa.name,
    billNumber: 'US-BOFA-0301',
    billDate: dateOffsetDays(-11),
    dueDate: dateOffsetDays(-2),
    currency: 'USD',
    entity: 'US',
    category: 'Operating Expense',
    account: 'Card Settlement',
    businessUnit: 'CORPORATE',
    lineOfService: null,
    subtotal: 4800,
    total: 4800,
    amountPaid: 0,
    status: 'OVERDUE',
    approvalStatus: 'APPROVED',
    notes: 'Ready for payment release',
    qboBillId: null,
    source: 'ERP_AP',
    sourceAccountId: usCard?.id || usBank?.id || null,
    globalAccountId: null,
    lineItems: [{ description: 'Corporate card settlement', amount: 4800, category: 'Operating Expense', businessUnit: 'CORPORATE', lineOfService: null, capexFlag: false }],
    payments: [],
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-9)}T09:00:00.000Z`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const billPartial = {
    id: nextId(db, 'VENDOR_BILL', 'BILL'),
    vendorId: vendorWise.id,
    vendorName: vendorWise.name,
    billNumber: 'UK-WISE-0220',
    billDate: dateOffsetDays(-21),
    dueDate: dateOffsetDays(-5),
    currency: 'GBP',
    entity: 'UK',
    category: 'Operating Expense',
    account: 'Platform Services',
    businessUnit: 'CORPORATE',
    lineOfService: null,
    subtotal: 3200,
    total: 3200,
    amountPaid: 1200,
    status: 'PARTIAL',
    approvalStatus: 'APPROVED',
    notes: 'Partially settled',
    qboBillId: null,
    source: 'ERP_AP',
    sourceAccountId: ukBank?.id || null,
    globalAccountId: null,
    lineItems: [{ description: 'Wise platform charges', amount: 3200, category: 'Operating Expense', businessUnit: 'CORPORATE', lineOfService: null, capexFlag: false }],
    payments: [{
      id: nextId(db, 'VENDOR_PAYMENT', 'BPAY'),
      date: dateOffsetDays(-14),
      amount: 1200,
      currency: 'GBP',
      sourceAccountId: ukBank?.id || null,
      account: ukBank?.name || 'Wise GBP Main',
      reference: 'WISE-PARTIAL-1200',
      notes: 'Partial release',
      approvalStatus: 'APPROVED',
      approvedByUserId: accountant.id,
      approvedAt: `${dateOffsetDays(-14)}T11:30:00.000Z`,
      postedAt: `${dateOffsetDays(-14)}T11:35:00.000Z`,
      createdByUserId: accountant.id,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }],
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-18)}T12:00:00.000Z`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!(db.vendorBills || []).length) db.vendorBills.push(billPending, billReady, billPartial);

  const expensePending = {
    id: nextId(db, 'EXPENSE', 'EXP'),
    date: dateOffsetDays(-5),
    entity: 'PK',
    currency: 'PKR',
    amount: 45000,
    description: 'Employee internet reimbursement',
    category: 'Operating Expense',
    account: 'Technology & Software',
    source: 'MANUAL',
    sourceAccountId: pkBank?.id || null,
    businessUnit: 'CORPORATE',
    lineOfService: null,
    reimbursementNeeded: true,
    reimbursementStatus: 'PENDING',
    approvalStatus: 'PENDING',
    employeeId: employee.id,
    employeeName: employee.name,
    createdByUserId: employee.id,
    approvedByUserId: null,
    approvedAt: null,
    notes: 'Receipt uploaded, waiting approval',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const expenseApproved = {
    id: nextId(db, 'EXPENSE', 'EXP'),
    date: dateOffsetDays(-7),
    entity: 'US',
    currency: 'USD',
    amount: 620,
    description: 'Design software renewal',
    category: 'Operating Expense',
    account: 'Technology & Software',
    source: 'MANUAL',
    sourceAccountId: usCard?.id || usBank?.id || null,
    businessUnit: 'CORPORATE',
    lineOfService: null,
    reimbursementNeeded: false,
    reimbursementStatus: 'NOT_APPLICABLE',
    approvalStatus: 'APPROVED',
    createdByUserId: accountant.id,
    approvedByUserId: partner.id,
    approvedAt: `${dateOffsetDays(-6)}T16:00:00.000Z`,
    notes: 'Renewal approved',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const expenseSettlement = {
    id: nextId(db, 'EXPENSE', 'EXP'),
    date: dateOffsetDays(-8),
    entity: 'PK',
    currency: 'PKR',
    amount: 22000,
    description: 'Field travel reimbursement',
    category: 'Operating Expense',
    account: 'Travel',
    source: 'MANUAL',
    sourceAccountId: pkBank?.id || null,
    businessUnit: 'CORPORATE',
    lineOfService: null,
    reimbursementNeeded: true,
    reimbursementStatus: 'PENDING',
    approvalStatus: 'APPROVED',
    employeeId: employee.id,
    employeeName: employee.name,
    createdByUserId: employee.id,
    approvedByUserId: accountant.id,
    approvedAt: `${dateOffsetDays(-7)}T09:30:00.000Z`,
    notes: 'Ready for settlement',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!(db.expenses || []).length) db.expenses.push(expensePending, expenseApproved, expenseSettlement);

  const txQuickMatch = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: dateOffsetDays(-2),
    amount: 4000,
    currency: 'GBP',
    description: 'Meridian payment TR-AR-1003',
    reference: 'TR-AR-1003',
    counterparty: clientMeridian.name,
    entity: 'UK',
    source: 'BANK_IMPORT',
    sourceAccountId: ukBank?.id || null,
    matchedAmount: 0,
    reconciled: false,
    linkedInvoiceIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const txDuplicate = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: txQuickMatch.date,
    amount: 4000,
    currency: 'GBP',
    description: txQuickMatch.description,
    reference: txQuickMatch.reference,
    counterparty: clientMeridian.name,
    entity: 'UK',
    source: 'BANK_IMPORT',
    sourceAccountId: ukBank?.id || null,
    matchedAmount: 0,
    reconciled: false,
    linkedInvoiceIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const txNeedsRemittance = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: dateOffsetDays(-1),
    amount: 7200,
    currency: 'USD',
    description: 'Deposit',
    reference: '',
    counterparty: 'Unknown receipt',
    entity: 'US',
    source: 'BANK_IMPORT',
    sourceAccountId: usBank?.id || null,
    matchedAmount: 0,
    reconciled: false,
    linkedInvoiceIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const txException = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: dateOffsetDays(-4),
    amount: 5100,
    currency: 'USD',
    description: 'Wire incoming - no invoice reference',
    reference: 'WIRE-5100',
    counterparty: 'Unmapped payer',
    entity: 'US',
    source: 'BANK_IMPORT',
    sourceAccountId: usBank?.id || null,
    matchedAmount: 0,
    reconciled: false,
    linkedInvoiceIds: [],
    reconciliationDecision: 'FOLLOW_UP_REQUIRED',
    reconciliationReviewStatus: 'FOLLOW_UP_REQUIRED',
    reconciliationReviewNote: 'Waiting for customer remittance email',
    reconciliationCategory: 'CUSTOMER_FOLLOW_UP',
    reconciliationFollowUpOwnerUserId: accountant.id,
    reconciliationReviewedByUserId: accountant.id,
    reconciliationReviewedAt: nowIso(),
    reconciliationReviewTrail: [{
      id: `seed-${Date.now()}`,
      createdAt: nowIso(),
      action: 'FOLLOW_UP_REQUIRED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Waiting for customer remittance email',
      category: 'CUSTOMER_FOLLOW_UP',
      deferredUntil: null,
      followUpOwnerUserId: accountant.id
    }],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const txDeferred = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: dateOffsetDays(-3),
    amount: 950,
    currency: 'USD',
    description: 'Pending portal payout',
    reference: 'UPW-950',
    counterparty: 'Upwork Holding',
    entity: 'US',
    source: 'BANK_IMPORT',
    sourceAccountId: usBank?.id || null,
    matchedAmount: 0,
    reconciled: false,
    linkedInvoiceIds: [],
    reconciliationDecision: 'DEFERRED',
    reconciliationReviewStatus: 'DEFERRED',
    reconciliationReviewNote: 'Wait for platform payout breakdown',
    reconciliationCategory: 'DEFERRED',
    reconciliationDeferredUntil: dateOffsetDays(3),
    reconciliationFollowUpOwnerUserId: accountant.id,
    reconciliationReviewedByUserId: accountant.id,
    reconciliationReviewedAt: nowIso(),
    reconciliationReviewTrail: [{
      id: `seed-${Date.now()}-deferred`,
      createdAt: nowIso(),
      action: 'DEFERRED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Wait for platform payout breakdown',
      category: 'DEFERRED',
      deferredUntil: dateOffsetDays(3),
      followUpOwnerUserId: accountant.id
    }],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const txCleared = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date: dateOffsetDays(-20),
    amount: 2500,
    currency: 'USD',
    description: 'Rain Partners payment',
    reference: 'TR-AR-1004',
    counterparty: clientRain.name,
    entity: 'US',
    source: 'BANK_IMPORT',
    sourceAccountId: usBank?.id || null,
    matchedAmount: 2500,
    reconciled: true,
    linkedInvoiceIds: [invoicePaid.id],
    reconciliationReviewStatus: 'RESOLVED',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!(db.transactions || []).length) db.transactions.push(txQuickMatch, txDuplicate, txNeedsRemittance, txException, txDeferred, txCleared);

  if (!(db.journals || []).length) {
    const journalId = nextId(db, 'JOURNAL', 'JRN');
    db.journals.push({
      id: journalId,
      journalNumber: `JRN-${String(db.sequences.JOURNAL_NUMBER = Number(db.sequences.JOURNAL_NUMBER || 0) + 1).padStart(4, '0')}`,
      journalType: 'ADJUSTMENT',
      sourceType: 'MANUAL',
      sourceId: journalId,
      sourceRootType: 'JOURNAL',
      sourceRootId: journalId,
      sourceStage: 'DRAFT',
      sourceJournalId: null,
      consolidationOnly: false,
      periodKey: toDateKey(new Date()).slice(0, 7),
      eliminationKey: null,
      eliminationScope: null,
      cleanupKey: null,
      postingKey: `JOURNAL:${journalId}`,
      entity: 'US',
      currency: 'USD',
      postingDate: dateOffsetDays(-2),
      memo: 'Month-end accrual adjustment',
      status: 'PENDING_APPROVAL',
      createdByUserId: accountant.id,
      approvedByUserId: null,
      postedByUserId: null,
      rejectedByUserId: null,
      rejectionReason: null,
      reversalOfJournalId: null,
      reversedByJournalId: null,
      reversedAt: null,
      autoGenerated: false,
      submittedAt: nowIso(),
      approvedAt: null,
      postedAt: null,
      lines: [
        {
          id: nextId(db, 'JOURNAL_LINE', 'JRL'),
          lineNumber: 1,
          globalAccountId: 'GLA-11',
          globalAccountCode: '5000',
          globalAccountName: 'Operating Expense',
          globalAccountType: 'EXPENSE',
          description: 'Accrue platform costs',
          entity: 'US',
          currency: 'USD',
          sourceAccountId: null,
          reference: null,
          debit: 1200,
          credit: 0,
          reportingRate: 1,
          createdAt: nowIso(),
          updatedAt: nowIso()
        },
        {
          id: nextId(db, 'JOURNAL_LINE', 'JRL'),
          lineNumber: 2,
          globalAccountId: 'GLA-6',
          globalAccountCode: '2000',
          globalAccountName: 'Accounts Payable',
          globalAccountType: 'LIABILITY',
          description: 'Accrue platform costs',
          entity: 'US',
          currency: 'USD',
          sourceAccountId: null,
          reference: null,
          debit: 0,
          credit: 1200,
          reportingRate: 1,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  const previousPeriodKey = (() => {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - 1, 1);
    return date.toISOString().slice(0, 7);
  })();
  if (!(db.closePeriods || []).some((row) => row.periodKey === previousPeriodKey)) {
    db.closePeriods.push({
      id: nextId(db, 'CLOSE_PERIOD', 'CLP'),
      periodKey: previousPeriodKey,
      status: 'CLOSED',
      notes: 'Seeded closed period for demo drilldown',
      checklistSnapshot: { readyToClose: true, checks: [] },
      metricsSnapshot: { invoiceCount: 2, openAr: 0, openAp: 1200, openIntercompany: 0 },
      relatedPartySnapshot: { summary: { relatedPartyCloseReady: true, mismatchPairCount: 0, cleanupExceptionCount: 0 } },
      closeEvidenceSnapshot: { evidenceCount: 2, categories: ['CLOSE_SUPPORT', 'CLOSE_MEMO'] },
      closeApprovalSnapshot: { approvalStatus: 'APPROVED', evidenceSatisfied: true },
      closedAt: `${dateOffsetDays(-5)}T18:00:00.000Z`,
      closedByUserId: accountant.id,
      reopenedAt: null,
      reopenedByUserId: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  if (!(db.evidenceRecords || []).length) {
    pushDemoEvidenceRecord(db, {
      entityType: 'VENDOR_BILL',
      entityId: billPending.id,
      category: 'VENDOR_INVOICE',
      note: 'Supplier invoice received',
      fileName: 'techsolutions-invoice.txt',
      uploadedByUserId: accountant.id,
      content: 'TechSolutions Ltd invoice support for PK-TS-0312.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'VENDOR_BILL',
      entityId: billReady.id,
      category: 'VENDOR_INVOICE',
      note: 'Card settlement statement',
      fileName: 'bofa-bill.txt',
      uploadedByUserId: accountant.id,
      content: 'Bank of America card settlement support.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'VENDOR_BILL',
      entityId: billPartial.id,
      category: 'VENDOR_INVOICE',
      note: 'Wise supplier bill support',
      fileName: 'wise-bill.txt',
      uploadedByUserId: accountant.id,
      content: 'Wise platform invoice support for UK vendor bill.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'EXPENSE',
      entityId: expensePending.id,
      category: 'RECEIPT',
      note: 'Expense receipt image',
      fileName: 'expense-pending.txt',
      uploadedByUserId: employee.id,
      content: 'Employee receipt support for internet reimbursement.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'EXPENSE',
      entityId: expenseSettlement.id,
      category: 'RECEIPT',
      note: 'Travel receipt packet',
      fileName: 'travel-receipt.txt',
      uploadedByUserId: employee.id,
      content: 'Travel receipt support for reimbursement settlement.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'CUSTOMER_RECEIPT',
      entityId: paymentPartial.id,
      category: 'BANK_PROOF',
      note: 'Wise bank confirmation',
      fileName: 'receipt-wise.txt',
      uploadedByUserId: accountant.id,
      content: 'Wise settlement proof for partial Meridian receipt.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'VENDOR_PAYMENT',
      entityId: billPartial.payments[0].id,
      category: 'BANK_PROOF',
      note: 'Payment release proof',
      fileName: 'vendor-payment-proof.txt',
      uploadedByUserId: accountant.id,
      content: 'Bank release proof for partial vendor settlement.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'JOURNAL',
      entityId: db.journals[0].id,
      category: 'SUPPORT',
      note: 'Accrual support memo',
      fileName: 'journal-support.txt',
      uploadedByUserId: accountant.id,
      content: 'Month-end accrual memo for platform cost true-up.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'CLOSE_PERIOD',
      entityId: previousPeriodKey,
      category: 'CLOSE_SUPPORT',
      note: 'Close support binder',
      fileName: 'close-support.txt',
      uploadedByUserId: accountant.id,
      content: 'February close support binder.'
    });
    pushDemoEvidenceRecord(db, {
      entityType: 'CLOSE_PERIOD',
      entityId: previousPeriodKey,
      category: 'CLOSE_MEMO',
      note: 'Close memo',
      fileName: 'close-memo.txt',
      uploadedByUserId: accountant.id,
      content: 'February close memo and reviewer signoff.'
    });
  }

  if (!(db.approvalEvents || []).length) {
    pushDemoApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoicePending.id,
      action: 'SUBMITTED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Awaiting approval',
      statusAfter: invoicePending.approvalStatus
    });
    pushDemoApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoiceOverdue.id,
      action: 'APPROVED',
      actorUserId: partner.id,
      actorRole: partner.role,
      note: 'Approved and released',
      statusAfter: invoiceOverdue.approvalStatus
    });
    pushDemoApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: billPending.id,
      action: 'SUBMITTED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Pending vendor bill review',
      statusAfter: billPending.approvalStatus
    });
    pushDemoApprovalEvent(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: expenseSettlement.id,
      action: 'APPROVED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Ready for reimbursement settlement',
      statusAfter: expenseSettlement.approvalStatus
    });
    pushDemoApprovalEvent(db, {
      documentType: 'JOURNAL',
      entityType: 'JOURNAL',
      entityId: db.journals[0].id,
      action: 'SUBMITTED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Month-end accrual submitted',
      statusAfter: db.journals[0].status
    });
    pushDemoApprovalEvent(db, {
      documentType: 'CLOSE_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: previousPeriodKey,
      action: 'APPROVED',
      actorUserId: accountant.id,
      actorRole: accountant.role,
      note: 'Prior period close approved',
      statusAfter: 'APPROVED'
    });
  }

  db.metadata.demoSeedVersion = DEMO_SEED_VERSION;
  db.metadata.demoSeededAt = nowIso();
  return true;
}

function createSeedDb() {
  const users = [
    { id: 'USR-1', name: 'Admin', email: 'admin@telerelation.local', role: role.ADMIN, passwordHash: bcrypt.hashSync('admin123', 10), googleSub: null },
    { id: 'USR-2', name: 'Accountant', email: 'accountant@telerelation.local', role: role.ACCOUNTANT, passwordHash: bcrypt.hashSync('account123', 10), googleSub: null },
    { id: 'USR-3', name: 'Partner', email: 'partner@telerelation.local', role: role.PARTNER, passwordHash: bcrypt.hashSync('partner123', 10), googleSub: null },
    { id: 'USR-4', name: 'Project Manager', email: 'pm@telerelation.local', role: role.PROJECT_MANAGER, passwordHash: bcrypt.hashSync('pm123', 10), googleSub: null },
    { id: 'USR-5', name: 'Employee', email: 'employee@telerelation.local', role: role.EMPLOYEE, passwordHash: bcrypt.hashSync('employee123', 10), googleSub: null },
    { id: 'USR-6', name: 'Viewer', email: 'viewer@telerelation.local', role: role.VIEWER, passwordHash: bcrypt.hashSync('viewer123', 10), googleSub: null }
  ];

  const clients = [
    { id: 'CLI-1', name: 'Rain Partners', email: 'ap@rainpartners.com', currency: 'USD', qboCustomerId: null, status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'CLI-2', name: 'Enko Fund Managers', email: 'finance@enko.example', currency: 'USD', qboCustomerId: null, status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso() }
  ];

  const projects = [
    {
      id: 'PRJ-1',
      code: 'RAIN-001',
      name: 'Rain Operations Optimization',
      clientId: 'CLI-1',
      projectManagerId: 'USR-4',
      businessUnit: 'CONSULT',
      type: 'TM',
      budgetAmount: 85000,
      budgetCurrency: 'USD',
      hourlyRate: 140,
      startDate: '2026-01-01',
      endDate: null,
      status: 'ACTIVE',
      qboCustomerId: null,
      description: 'Monthly advisory and systems enablement',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];

  const timeEntries = [
    {
      id: 'TE-1',
      projectId: 'PRJ-1',
      userId: 'USR-4',
      date: '2026-03-01',
      hours: 6,
      description: 'Sprint planning and stakeholder review',
      hourlyRate: 140,
      amount: 840,
      currency: 'USD',
      billable: true,
      invoiceId: null,
      invoicedAt: null,
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];

  const db = {
    metadata: {
      appName: 'telerelation-finance',
      version: '1.0.0',
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    sequences: {
      USER: 100,
      CLIENT: 100,
      VENDOR: 100,
      PROJECT: 100,
      TIME_ENTRY: 100,
      INVOICE: 100,
      PAYMENT: 100,
      VENDOR_BILL: 100,
      VENDOR_PAYMENT: 100,
      TRANSACTION: 100,
      EXPENSE: 100,
      ACCOUNT: 100,
      ASAR_COST: 100,
      PARTNER_DRAW: 100,
      PAYROLL: 100,
      MGMT_ADJUSTMENT: 100,
      INTERCOMPANY: 100,
      INTERCOMPANY_REPAYMENT: 100,
      OPENING_BALANCE: 100,
      OPENING_BALANCE_LINE: 100,
      CLOSE_PERIOD: 100,
      JOURNAL: 100,
      JOURNAL_NUMBER: 100,
      JOURNAL_LINE: 100,
      AUDIT: 100,
      QBO_LOG: 100,
      NOTIFICATION: 100,
      EVIDENCE: 100,
      APPROVAL_EVENT: 100,
      APPROVAL_MATRIX_VERSION: 1,
      RULE: 100,
      SETTLEMENT: 100,
      GLOBAL_ACCOUNT: 100,
      ACCOUNT_MAPPING: 100
    },
    settings: {
      companyName: 'Telerelation LLC',
      defaultCurrency: 'USD',
      reportingCurrency: 'USD',
      entityBaseCurrencies: {
        US: 'USD',
        UK: 'GBP',
        PK: 'PKR'
      },
      fxRatesToUSD: buildDefaultFxRatesToUsd(),
      invoiceApprovalThreshold: 5000,
      autoSendBelowThreshold: false,
      invoiceEmailEnabled: true,
      qboPollingEnabled: true
      ,
      approvalMatrix: buildDefaultApprovalMatrix(),
      activeApprovalMatrixVersionId: 'AMV-0001',
      pkTax: buildDefaultPkTaxSettings()
    },
    users,
    clients,
    vendors: [
      { id: 'VEN-1', name: 'TechSolutions Ltd', email: 'ap@techsolutions.example', defaultCurrency: 'PKR', entity: 'PK', status: 'ACTIVE', notes: 'Pakistan technology vendor', createdAt: nowIso(), updatedAt: nowIso() },
      { id: 'VEN-2', name: 'Wise Platform Services', email: 'billing@wise.example', defaultCurrency: 'GBP', entity: 'UK', status: 'ACTIVE', notes: 'International payment and platform costs', createdAt: nowIso(), updatedAt: nowIso() },
      { id: 'VEN-3', name: 'Bank of America Card Services', email: 'statements@bofa.example', defaultCurrency: 'USD', entity: 'US', status: 'ACTIVE', notes: 'US treasury and card services', createdAt: nowIso(), updatedAt: nowIso() }
    ],
    accounts: [
      {
        id: 'ACC-1',
        name: 'BoFA Operating',
        provider: 'BoFA',
        sourceSystem: 'MANUAL',
        sourceLedger: 'US_BOOKS',
        entity: 'US',
        currency: 'USD',
        accountRole: 'BANK',
        isCashAccount: true,
        showInBankingHub: true,
        status: 'ACTIVE',
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      {
        id: 'ACC-2',
        name: 'Wise GBP',
        provider: 'Wise',
        sourceSystem: 'MANUAL',
        sourceLedger: 'UK_BOOKS',
        entity: 'UK',
        currency: 'GBP',
        accountRole: 'BANK',
        isCashAccount: true,
        showInBankingHub: true,
        status: 'ACTIVE',
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      {
        id: 'ACC-3',
        name: 'Meezan PKR',
        provider: 'Meezan',
        sourceSystem: 'MANUAL',
        sourceLedger: 'PK_BOOKS',
        entity: 'PK',
        currency: 'PKR',
        accountRole: 'BANK',
        isCashAccount: true,
        showInBankingHub: true,
        status: 'ACTIVE',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ],
    globalChartAccounts: buildDefaultGlobalChartAccounts(),
    accountMappings: [
      { id: 'MAP-1', sourceAccountId: 'ACC-1', globalAccountId: 'GLA-1', status: 'ACTIVE', notes: 'US operating bank', createdAt: nowIso(), updatedAt: nowIso() },
      { id: 'MAP-2', sourceAccountId: 'ACC-2', globalAccountId: 'GLA-1', status: 'ACTIVE', notes: 'UK collection account', createdAt: nowIso(), updatedAt: nowIso() },
      { id: 'MAP-3', sourceAccountId: 'ACC-3', globalAccountId: 'GLA-1', status: 'ACTIVE', notes: 'Pakistan operating bank', createdAt: nowIso(), updatedAt: nowIso() }
    ],
    categories: defaultCategories,
    projects,
    timeEntries,
    invoices: [],
    payments: [],
    vendorBills: [],
    transactions: [],
    expenses: [],
    asarTowerCosts: [],
    partnerDraws: [],
    managementAdjustments: [],
    intercompanyEntries: [],
    journals: [],
    payrollRuns: [],
    payrollItems: [],
    openingBalances: [],
    ponchoSettlements: [],
    closePeriods: [],
    approvalMatrixVersions: buildSeedApprovalMatrixVersions(),
    evidenceRecords: [],
    approvalEvents: [],
    classificationRules: defaultRules,
    auditLog: [],
    notificationQueue: [],
    qbo: {
      connected: false,
      realmId: null,
      selectedEntity: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null,
      lastSyncAt: null,
      lastPullAt: null,
      lastPullSummary: null,
      lastPullChecklist: null,
      lastPullError: null,
      syncLogs: []
    },
    oauthState: []
  };
  ensureDemoFinanceScenario(db, { force: true });
  return db;
}

function ensureDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir, { recursive: true });
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
}

function ensureShape(db) {
  db.sequences = db.sequences || {};
  const sequenceDefaults = {
    USER: 100,
    CLIENT: 100,
    VENDOR: 100,
    PROJECT: 100,
    TIME_ENTRY: 100,
    INVOICE: 100,
    PAYMENT: 100,
    VENDOR_BILL: 100,
    VENDOR_PAYMENT: 100,
    TRANSACTION: 100,
    EXPENSE: 100,
    ACCOUNT: 100,
    ASAR_COST: 100,
    PARTNER_DRAW: 100,
    PAYROLL: 100,
    MGMT_ADJUSTMENT: 100,
    INTERCOMPANY: 100,
    INTERCOMPANY_REPAYMENT: 100,
    OPENING_BALANCE: 100,
    OPENING_BALANCE_LINE: 100,
    CLOSE_PERIOD: 100,
    JOURNAL: 100,
    JOURNAL_NUMBER: 100,
    JOURNAL_LINE: 100,
    AUDIT: 100,
    QBO_LOG: 100,
    NOTIFICATION: 100,
    EVIDENCE: 100,
    APPROVAL_EVENT: 100,
    APPROVAL_MATRIX_VERSION: 1,
    RULE: 100,
    SETTLEMENT: 100,
    GLOBAL_ACCOUNT: 100,
    ACCOUNT_MAPPING: 100
  };
  Object.entries(sequenceDefaults).forEach(([key, value]) => {
    if (db.sequences[key] === undefined) db.sequences[key] = value;
  });
  if (db.sequences.JOURNAL_NUMBER === undefined) {
    db.sequences.JOURNAL_NUMBER = Number(db.sequences.JOURNAL || 100);
  }

  const collectionDefaults = {
    users: [],
    clients: [],
    vendors: [],
    accounts: [],
    globalChartAccounts: [],
    accountMappings: [],
    categories: defaultCategories,
    projects: [],
    timeEntries: [],
    invoices: [],
    payments: [],
    vendorBills: [],
    transactions: [],
    expenses: [],
    asarTowerCosts: [],
    partnerDraws: [],
    managementAdjustments: [],
    intercompanyEntries: [],
    journals: [],
    payrollRuns: [],
    payrollItems: [],
    openingBalances: [],
    ponchoSettlements: [],
    closePeriods: [],
    approvalMatrixVersions: buildSeedApprovalMatrixVersions(),
    evidenceRecords: [],
    approvalEvents: [],
    classificationRules: defaultRules,
    auditLog: [],
    notificationQueue: [],
    oauthState: []
  };
  Object.entries(collectionDefaults).forEach(([key, value]) => {
    if (!Array.isArray(db[key])) db[key] = Array.isArray(value) ? [...value] : value;
  });

  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = {
      companyName: 'Telerelation LLC',
      defaultCurrency: 'USD',
      reportingCurrency: 'USD',
      entityBaseCurrencies: {
        US: 'USD',
        UK: 'GBP',
        PK: 'PKR'
      },
      fxRatesToUSD: buildDefaultFxRatesToUsd(),
      invoiceApprovalThreshold: 5000,
      autoSendBelowThreshold: false,
      invoiceEmailEnabled: true,
      qboPollingEnabled: true,
      approvalMatrix: buildDefaultApprovalMatrix(),
      activeApprovalMatrixVersionId: 'AMV-0001',
      pkTax: buildDefaultPkTaxSettings()
    };
  }
  if (!db.settings.entityBaseCurrencies || typeof db.settings.entityBaseCurrencies !== 'object') {
    db.settings.entityBaseCurrencies = {
      US: 'USD',
      UK: 'GBP',
      PK: 'PKR'
    };
  }
  if (!db.settings.reportingCurrency) db.settings.reportingCurrency = 'USD';
  if (!db.settings.fxRatesToUSD || typeof db.settings.fxRatesToUSD !== 'object') {
    db.settings.fxRatesToUSD = buildDefaultFxRatesToUsd();
  }
  if (!db.settings.approvalMatrix || !Array.isArray(db.settings.approvalMatrix.rules) || !db.settings.approvalMatrix.rules.length) {
    db.settings.approvalMatrix = buildDefaultApprovalMatrix();
  }
  if (!Array.isArray(db.approvalMatrixVersions) || !db.approvalMatrixVersions.length) {
    db.approvalMatrixVersions = buildSeedApprovalMatrixVersions();
  }
  if (!db.settings.activeApprovalMatrixVersionId) {
    db.settings.activeApprovalMatrixVersionId = db.approvalMatrixVersions[0]?.id || 'AMV-0001';
  }
  if (!db.settings.pkTax || typeof db.settings.pkTax !== 'object') {
    db.settings.pkTax = buildDefaultPkTaxSettings();
  } else {
    const defaults = buildDefaultPkTaxSettings();
    db.settings.pkTax = {
      ...defaults,
      ...db.settings.pkTax,
      deductibilityDefaults: {
        ...defaults.deductibilityDefaults,
        ...(db.settings.pkTax.deductibilityDefaults || {})
      },
      statutoryDeductions: {
        ...defaults.statutoryDeductions,
        ...(db.settings.pkTax.statutoryDeductions || {})
      },
      salaryComponents: Array.isArray(db.settings.pkTax.salaryComponents) && db.settings.pkTax.salaryComponents.length
        ? db.settings.pkTax.salaryComponents
        : defaults.salaryComponents,
      salaryTaxSlabs: Array.isArray(db.settings.pkTax.salaryTaxSlabs) && db.settings.pkTax.salaryTaxSlabs.length
        ? db.settings.pkTax.salaryTaxSlabs
        : defaults.salaryTaxSlabs,
      references: Array.isArray(db.settings.pkTax.references) && db.settings.pkTax.references.length
        ? db.settings.pkTax.references
        : defaults.references
    };
  }
  const defaultFxRatesToUsd = buildDefaultFxRatesToUsd();
  for (const [currency, rate] of Object.entries(defaultFxRatesToUsd)) {
    const numeric = Number(db.settings.fxRatesToUSD[currency]);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      db.settings.fxRatesToUSD[currency] = rate;
    }
  }

  if (!db.qbo || typeof db.qbo !== 'object') {
    db.qbo = {
      connected: false,
      realmId: null,
      selectedEntity: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null,
      lastSyncAt: null,
      lastPullAt: null,
      lastPullSummary: null,
      lastPullChecklist: null,
      lastPullError: null,
      syncLogs: []
    };
  }
  if (!Array.isArray(db.qbo.syncLogs)) db.qbo.syncLogs = [];
  if (db.qbo.lastPullAt === undefined) db.qbo.lastPullAt = null;
  if (db.qbo.lastPullSummary === undefined) db.qbo.lastPullSummary = null;
  if (db.qbo.lastPullChecklist === undefined) db.qbo.lastPullChecklist = null;
  if (db.qbo.lastPullError === undefined) db.qbo.lastPullError = null;

  db.users = (db.users || []).map((user) => ({
    ...user,
    allowedEntities: Array.isArray(user.allowedEntities) ? user.allowedEntities : [],
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || nowIso()
  }));

  db.invoices = (db.invoices || []).map((invoice) => ({
    ...invoice,
    approvalStatus: invoice.approvalStatus
      || (String(invoice.status || '').toUpperCase() === 'REJECTED' ? 'REJECTED'
        : (['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase()) ? 'APPROVED' : 'PENDING')),
    approvedByUserId: invoice.approvedByUserId || null,
    approvedAt: invoice.approvedAt || null,
    rejectedByUserId: invoice.rejectedByUserId || null,
    rejectionReason: invoice.rejectionReason || null,
    notes: invoice.notes || '',
    internalNotes: invoice.internalNotes || ''
  }));

  db.payments = (db.payments || []).map((payment) => ({
    ...payment,
    status: payment.status || 'PAID',
    approvalStatus: payment.approvalStatus || (String(payment.source || '').toUpperCase().includes('QBO') ? 'AUTO_APPROVED' : 'PENDING'),
    approvedByUserId: payment.approvedByUserId || null,
    approvedAt: payment.approvedAt || null,
    postedAt: payment.postedAt || null,
    createdByUserId: payment.createdByUserId || null,
    meta: payment.meta || null,
    createdAt: payment.createdAt || nowIso(),
    updatedAt: payment.updatedAt || nowIso()
  }));

  db.transactions = db.transactions.map((tx) => {
    const normalized = { ...tx };
    const absoluteAmount = Number(Math.abs(Number(normalized.amount || 0)).toFixed(2));
    if (normalized.matchedAmount === undefined || normalized.matchedAmount === null) {
      normalized.matchedAmount = normalized.reconciled ? absoluteAmount : 0;
    }
    normalized.matchedAmount = Number(Math.min(Math.max(Number(normalized.matchedAmount || 0), 0), absoluteAmount).toFixed(2));
    if (normalized.reconciled === undefined) {
      normalized.reconciled = normalized.matchedAmount >= absoluteAmount && absoluteAmount > 0;
    } else {
      normalized.reconciled = Boolean(normalized.reconciled);
    }
    if (!Array.isArray(normalized.linkedInvoiceIds)) {
      normalized.linkedInvoiceIds = normalized.invoiceId ? [normalized.invoiceId] : [];
    }
    normalized.linkedInvoiceIds = Array.from(new Set(normalized.linkedInvoiceIds.filter(Boolean)));
    if (normalized.reimbursable === undefined) normalized.reimbursable = false;
    if (normalized.intercompanyFlag === undefined) normalized.intercompanyFlag = false;
    if (normalized.treasuryFlag === undefined) normalized.treasuryFlag = false;
    if (normalized.capexFlag === undefined) normalized.capexFlag = false;
    if (normalized.businessUnit === undefined) normalized.businessUnit = null;
    if (normalized.department === undefined) normalized.department = null;
    if (normalized.partnerTag === undefined) normalized.partnerTag = null;
    if (!normalized.source) normalized.source = 'MANUAL';
    if (normalized.reference === undefined) normalized.reference = null;
    if (normalized.entity === undefined) normalized.entity = null;
    if (normalized.lineOfService === undefined) normalized.lineOfService = null;
    if (normalized.channel === undefined) normalized.channel = null;
    if (normalized.sourceAccountId === undefined) normalized.sourceAccountId = null;
    if (normalized.globalAccountId === undefined) normalized.globalAccountId = null;
    if (normalized.reconciliationDecision === undefined) normalized.reconciliationDecision = null;
    if (normalized.reconciliationReviewStatus === undefined) normalized.reconciliationReviewStatus = 'OPEN';
    if (normalized.reconciliationReviewNote === undefined) normalized.reconciliationReviewNote = null;
    if (normalized.reconciliationCategory === undefined) normalized.reconciliationCategory = null;
    if (normalized.reconciliationDeferredUntil === undefined) normalized.reconciliationDeferredUntil = null;
    if (normalized.reconciliationFollowUpOwnerUserId === undefined) normalized.reconciliationFollowUpOwnerUserId = null;
    if (normalized.reconciliationReviewedAt === undefined) normalized.reconciliationReviewedAt = null;
    if (normalized.reconciliationReviewedByUserId === undefined) normalized.reconciliationReviewedByUserId = null;
    if (!Array.isArray(normalized.reconciliationReviewTrail)) normalized.reconciliationReviewTrail = [];
    return normalized;
  });

  db.expenses = (db.expenses || []).map((expense) => ({
    ...expense,
    approvalStatus: expense.approvalStatus || 'PENDING',
    approvedByUserId: expense.approvedByUserId || null,
    approvedAt: expense.approvedAt || null,
    rejectedByUserId: expense.rejectedByUserId || null,
    rejectionReason: expense.rejectionReason || null,
    sourceAccountId: expense.sourceAccountId || null,
    globalAccountId: expense.globalAccountId || null
  }));

  db.vendors = (db.vendors || []).map((vendor) => ({
    ...vendor,
    email: vendor.email || null,
    defaultCurrency: vendor.defaultCurrency || vendor.currency || 'USD',
    entity: vendor.entity || null,
    status: vendor.status || 'ACTIVE',
    notes: vendor.notes || '',
    createdAt: vendor.createdAt || nowIso(),
    updatedAt: vendor.updatedAt || nowIso()
  }));

  db.vendorBills = (db.vendorBills || []).map((bill) => ({
    ...bill,
    vendorId: bill.vendorId || null,
    vendorName: bill.vendorName || null,
    billNumber: bill.billNumber || null,
    billDate: bill.billDate || bill.date || null,
    dueDate: bill.dueDate || bill.billDate || bill.date || null,
    currency: bill.currency || db.settings.reportingCurrency || 'USD',
    entity: bill.entity || null,
    category: bill.category || 'Operating Expense',
    account: bill.account || null,
    businessUnit: bill.businessUnit || 'CORPORATE',
    lineOfService: bill.lineOfService || null,
    subtotal: Number(bill.subtotal || 0),
    total: Number(bill.total || bill.subtotal || 0),
    amountPaid: Number(bill.amountPaid || 0),
    status: bill.status || 'DRAFT',
    approvalStatus: bill.approvalStatus
      || (['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE', 'PAID'].includes(String(bill.status || '').toUpperCase()) ? 'APPROVED'
        : String(bill.status || '').toUpperCase() === 'REJECTED' ? 'REJECTED'
          : 'PENDING'),
    notes: bill.notes || '',
    qboBillId: bill.qboBillId || null,
    source: bill.source || 'ERP_AP',
    sourceAccountId: bill.sourceAccountId || null,
    globalAccountId: bill.globalAccountId || null,
    lineItems: Array.isArray(bill.lineItems) ? bill.lineItems.map((line) => ({
      description: line.description || 'Bill line',
      amount: Number(line.amount || 0),
      category: line.category || bill.category || 'Operating Expense',
      businessUnit: line.businessUnit || bill.businessUnit || 'CORPORATE',
      lineOfService: line.lineOfService || bill.lineOfService || null,
      capexFlag: Boolean(line.capexFlag)
    })) : [],
    payments: Array.isArray(bill.payments) ? bill.payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount || 0),
      status: payment.status || 'PAID',
      approvalStatus: payment.approvalStatus || 'PENDING',
      approvedByUserId: payment.approvedByUserId || null,
      approvedAt: payment.approvedAt || null,
      postedAt: payment.postedAt || null,
      sourceAccountId: payment.sourceAccountId || null,
      createdAt: payment.createdAt || nowIso(),
      updatedAt: payment.updatedAt || nowIso()
    })) : [],
    createdAt: bill.createdAt || nowIso(),
    updatedAt: bill.updatedAt || nowIso()
  }));

  db.intercompanyEntries = (db.intercompanyEntries || []).map((entry) => ({
    ...entry,
    date: entry.date || null,
    fromEntity: entry.fromEntity || null,
    toEntity: entry.toEntity || null,
    amount: Number(entry.amount || 0),
    currency: entry.currency || db.settings.reportingCurrency || 'USD',
    reason: entry.reason || 'Intercompany Funding',
    reference: entry.reference || null,
    description: entry.description || '',
    status: ['SETTLED', 'CLOSED'].includes(String(entry.status || '').toUpperCase()) ? 'REPAID' : (entry.status || 'OPEN'),
    sourceAccountId: entry.sourceAccountId || null,
    receivingSourceAccountId: entry.receivingSourceAccountId || null,
    settlementSourceAccountId: entry.settlementSourceAccountId || null,
    settlementDate: entry.settlementDate || null,
    settlementReference: entry.settlementReference || null,
    repaidAmount: Number(entry.repaidAmount || (['SETTLED', 'CLOSED', 'REPAID'].includes(String(entry.status || '').toUpperCase()) ? entry.amount || 0 : 0)),
    repaymentDate: entry.repaymentDate || entry.settlementDate || null,
    repaymentReference: entry.repaymentReference || entry.settlementReference || null,
    repaymentSourceAccountId: entry.repaymentSourceAccountId || entry.settlementSourceAccountId || null,
    repaymentReceivingAccountId: entry.repaymentReceivingAccountId || null,
    repaymentEvents: Array.isArray(entry.repaymentEvents) ? entry.repaymentEvents.map((event) => ({
      id: event.id || nextId(db, 'INTERCOMPANY_REPAYMENT', 'ICR'),
      date: event.date || null,
      amount: Number(event.amount || 0),
      currency: event.currency || entry.currency || db.settings.reportingCurrency || 'USD',
      sourceAccountId: event.sourceAccountId || null,
      receivingSourceAccountId: event.receivingSourceAccountId || null,
      reference: event.reference || null,
      description: event.description || '',
      createdByUserId: event.createdByUserId || null,
      createdAt: event.createdAt || nowIso()
    })) : [],
    notes: entry.notes || '',
    createdAt: entry.createdAt || nowIso(),
    updatedAt: entry.updatedAt || nowIso()
  }));

  db.closePeriods = (db.closePeriods || []).map((period) => ({
    ...period,
    periodKey: period.periodKey || null,
    status: period.status || 'OPEN',
    notes: period.notes || '',
    checklistSnapshot: period.checklistSnapshot || null,
    metricsSnapshot: period.metricsSnapshot || null,
    relatedPartySnapshot: period.relatedPartySnapshot || null,
    closeEvidenceSnapshot: period.closeEvidenceSnapshot || null,
    closeApprovalSnapshot: period.closeApprovalSnapshot || null,
    closedAt: period.closedAt || null,
    closedByUserId: period.closedByUserId || null,
    reopenedAt: period.reopenedAt || null,
    reopenedByUserId: period.reopenedByUserId || null,
    createdAt: period.createdAt || nowIso(),
    updatedAt: period.updatedAt || nowIso()
  }));

  db.evidenceRecords = (db.evidenceRecords || []).map((record) => ({
    ...record,
    entityType: record.entityType || null,
    entityId: record.entityId || null,
    fileName: record.fileName || 'attachment.bin',
    storedFileName: record.storedFileName || null,
    mimeType: record.mimeType || 'application/octet-stream',
    fileSize: Number(record.fileSize || 0),
    uploadedByUserId: record.uploadedByUserId || null,
    uploadedAt: record.uploadedAt || record.createdAt || nowIso(),
    note: record.note || '',
    category: record.category || 'SUPPORT',
    status: record.status || 'ACTIVE',
    supersedesEvidenceId: record.supersedesEvidenceId || null,
    supersededByEvidenceId: record.supersededByEvidenceId || null,
    supersededAt: record.supersededAt || null,
    storageProvider: record.storageProvider || 'local',
    storageKey: record.storageKey || record.storedFileName || (record.storagePath ? path.basename(record.storagePath) : null),
    storagePath: record.storagePath || null,
    checksumSha256: record.checksumSha256 || null,
    originalExtension: record.originalExtension || path.extname(record.fileName || record.storedFileName || '') || null,
    removedByUserId: record.removedByUserId || null,
    removedAt: record.removedAt || null,
    removalNote: record.removalNote || '',
    createdAt: record.createdAt || nowIso(),
    updatedAt: record.updatedAt || nowIso()
  }));

  db.approvalEvents = (db.approvalEvents || []).map((event) => ({
    ...event,
    documentType: event.documentType || null,
    entityType: event.entityType || null,
    entityId: event.entityId || null,
    action: event.action || null,
    actorUserId: event.actorUserId || null,
    actorRole: event.actorRole || null,
    note: event.note || '',
    metadata: event.metadata || null,
    evidenceCount: Number(event.evidenceCount || 0),
    qualifiedEvidenceCount: Number(event.qualifiedEvidenceCount || event.evidenceCount || 0),
    statusAfter: event.statusAfter || null,
    policySnapshot: event.policySnapshot || null,
    createdAt: event.createdAt || nowIso()
  }));

  db.approvalMatrixVersions = (db.approvalMatrixVersions || []).map((version, index) => ({
    ...version,
    id: version.id || `AMV-${String(index + 1).padStart(4, '0')}`,
    versionNumber: Number(version.versionNumber || (index + 1)),
    status: String(version.status || 'ACTIVE').toUpperCase(),
    effectiveAt: version.effectiveAt || version.createdAt || nowIso(),
    changedByUserId: version.changedByUserId || null,
    changeReason: version.changeReason || '',
    rules: Array.isArray(version.rules) && version.rules.length ? version.rules : buildDefaultApprovalMatrix().rules,
    createdAt: version.createdAt || nowIso(),
    updatedAt: version.updatedAt || nowIso()
  }));

  db.managementAdjustments = (db.managementAdjustments || []).map((adj) => ({
    ...adj,
    status: adj.status || 'ACTIVE',
    amount: Number(adj.amount || 0),
    currency: adj.currency || db.settings.reportingCurrency || 'USD',
    entity: adj.entity || null,
    lineOfService: adj.lineOfService || null,
    businessUnit: adj.businessUnit || null,
    channel: adj.channel || null,
    sourceTransactionId: adj.sourceTransactionId || null
  }));

  db.journals = (db.journals || []).map((journal) => ({
    ...journal,
    journalNumber: journal.journalNumber || journal.id || null,
    journalType: journal.journalType || 'MANUAL',
    sourceType: journal.sourceType || 'MANUAL',
    sourceId: journal.sourceId || null,
    sourceRootType: journal.sourceRootType || journal.sourceType || 'MANUAL',
    sourceRootId: journal.sourceRootId || journal.sourceId || null,
    sourceStage: journal.sourceStage || null,
    sourceJournalId: journal.sourceJournalId || null,
    consolidationOnly: Boolean(journal.consolidationOnly),
    periodKey: journal.periodKey || null,
    eliminationKey: journal.eliminationKey || null,
    eliminationScope: journal.eliminationScope || null,
    cleanupKey: journal.cleanupKey || null,
    postingKey: journal.postingKey || ((journal.sourceType || journal.sourceId) ? `${journal.sourceType || 'MANUAL'}:${journal.sourceId || 'UNSCOPED'}` : null),
    entity: journal.entity || null,
    currency: journal.currency || db.settings.reportingCurrency || 'USD',
    postingDate: journal.postingDate || null,
    memo: journal.memo || '',
    status: journal.status || 'DRAFT',
    createdByUserId: journal.createdByUserId || null,
    approvedByUserId: journal.approvedByUserId || null,
    postedByUserId: journal.postedByUserId || null,
    rejectedByUserId: journal.rejectedByUserId || null,
    rejectionReason: journal.rejectionReason || null,
    reversalOfJournalId: journal.reversalOfJournalId || null,
    reversedByJournalId: journal.reversedByJournalId || null,
    reversedAt: journal.reversedAt || null,
    autoGenerated: Boolean(journal.autoGenerated),
    submittedAt: journal.submittedAt || null,
    approvedAt: journal.approvedAt || null,
    postedAt: journal.postedAt || null,
    lines: Array.isArray(journal.lines) ? journal.lines.map((line, index) => ({
      id: line.id || nextId(db, 'JOURNAL_LINE', 'JRL'),
      lineNumber: Number(line.lineNumber || index + 1),
      globalAccountId: line.globalAccountId || null,
      globalAccountCode: line.globalAccountCode || null,
      globalAccountName: line.globalAccountName || null,
      globalAccountType: line.globalAccountType || null,
      description: line.description || '',
      entity: line.entity || journal.entity || null,
      currency: line.currency || journal.currency || db.settings.reportingCurrency || 'USD',
      sourceAccountId: line.sourceAccountId || null,
      reference: line.reference || null,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      reportingRate: Number(line.reportingRate || 1),
      createdAt: line.createdAt || nowIso(),
      updatedAt: line.updatedAt || nowIso()
    })) : [],
    createdAt: journal.createdAt || nowIso(),
    updatedAt: journal.updatedAt || nowIso()
  }));

  db.accounts = (db.accounts || []).map((account) => {
    const normalized = { ...account };
    normalized.provider = normalized.provider || normalized.sourceSystem || 'MANUAL';
    normalized.sourceSystem = normalized.sourceSystem || (normalized.qboAccountId ? 'QBO' : 'MANUAL');
    normalized.sourceLedger = normalized.sourceLedger || (normalized.sourceSystem === 'QBO' ? 'QBO' : 'MANUAL');
    normalized.entity = normalized.entity || null;
    normalized.currency = normalized.currency || db.settings?.defaultCurrency || 'USD';
    normalized.accountRole = normalized.accountRole || null;
    normalized.isCashAccount = normalized.isCashAccount === undefined
      ? ['BANK', 'CREDIT_CARD', 'WALLET'].includes(String(normalized.accountRole || '').toUpperCase())
      : Boolean(normalized.isCashAccount);
    normalized.showInBankingHub = normalized.showInBankingHub === undefined
      ? Boolean(normalized.isCashAccount)
      : Boolean(normalized.showInBankingHub);
    normalized.externalCode = normalized.externalCode || null;
    normalized.externalName = normalized.externalName || normalized.name || null;
    normalized.globalAccountId = normalized.globalAccountId || null;
    normalized.notes = normalized.notes || '';
    return normalized;
  });
  for (const template of buildDefaultManualSourceAccountTemplates()) {
    const exists = db.accounts.some((row) => (
      String(row.sourceLedger || '').toUpperCase() === String(template.sourceLedger || '').toUpperCase()
      && normalizeLookupText(row.name) === normalizeLookupText(template.name)
    ));
    if (exists) continue;
    db.accounts.push({
      id: nextId(db, 'ACCOUNT', 'ACC'),
      ...template,
      externalCode: null,
      externalName: template.name,
      globalAccountId: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  db.globalChartAccounts = (db.globalChartAccounts || []).map((row) => ({
    ...row,
    code: row.code || null,
    name: row.name || 'Unnamed Global Account',
    type: row.type || 'OTHER',
    reportingGroup: row.reportingGroup || null,
    status: row.status || 'ACTIVE',
    notes: row.notes || '',
    createdAt: row.createdAt || nowIso(),
    updatedAt: row.updatedAt || nowIso()
  }));
  if (!db.globalChartAccounts.length) {
    db.globalChartAccounts = buildDefaultGlobalChartAccounts();
  } else {
    const existingCodes = new Set(db.globalChartAccounts.map((row) => String(row.code || '').trim()).filter(Boolean));
    for (const row of buildDefaultGlobalChartAccounts()) {
      if (existingCodes.has(String(row.code || '').trim())) continue;
      db.globalChartAccounts.push(row);
    }
  }

  db.accountMappings = (db.accountMappings || []).map((row) => ({
    ...row,
    sourceAccountId: row.sourceAccountId || null,
    globalAccountId: row.globalAccountId || null,
    status: row.status || 'ACTIVE',
    entityOverride: row.entityOverride || null,
    lineOfServiceOverride: row.lineOfServiceOverride || null,
    businessUnitOverride: row.businessUnitOverride || null,
    notes: row.notes || '',
    createdAt: row.createdAt || nowIso(),
    updatedAt: row.updatedAt || nowIso()
  }));
  const globalByCode = new Map(db.globalChartAccounts.map((row) => [String(row.code || '').trim(), row]));
  for (const account of db.accounts) {
    const code = inferStarterGlobalCodeForSourceAccount(account);
    const existingMapping = (db.accountMappings || []).find((row) => row.sourceAccountId === account.id && String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
    if (existingMapping && String(existingMapping.notes || '').toLowerCase().includes('starter auto-map')) {
      const nextGlobal = code ? globalByCode.get(code) : null;
      if (nextGlobal && existingMapping.globalAccountId !== nextGlobal.id) {
        existingMapping.globalAccountId = nextGlobal.id;
        existingMapping.updatedAt = nowIso();
        account.globalAccountId = nextGlobal.id;
        account.updatedAt = nowIso();
      }
    }
  }
  const mappedSourceIds = new Set(
    db.accountMappings
      .filter((row) => String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
      .map((row) => row.sourceAccountId)
      .filter(Boolean)
  );
  for (const account of db.accounts) {
    if (!account?.id || mappedSourceIds.has(account.id)) continue;
    const code = inferStarterGlobalCodeForSourceAccount(account);
    const globalAccount = code ? globalByCode.get(code) : null;
    if (!globalAccount) continue;
    const mapping = {
      id: nextId(db, 'ACCOUNT_MAPPING', 'MAP'),
      sourceAccountId: account.id,
      globalAccountId: globalAccount.id,
      status: 'ACTIVE',
      entityOverride: null,
      lineOfServiceOverride: null,
      businessUnitOverride: null,
      notes: 'Starter auto-map',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.accountMappings.push(mapping);
    account.globalAccountId = globalAccount.id;
    account.updatedAt = nowIso();
    mappedSourceIds.add(account.id);
  }
}

export function initStore() {
  ensureDirs();
  if (!fs.existsSync(dbPath)) {
    const seed = createSeedDb();
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2), 'utf8');
    if (postgresPersistenceEnabled()) {
      ensurePostgresReady(seed);
      hydrateMigratedDomainsFromPostgres(seed);
      fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2), 'utf8');
    }
    return;
  }
  const raw = fs.readFileSync(dbPath, 'utf8');
  const current = JSON.parse(raw);
  if (!current.sequences || !current.users) {
    const seed = createSeedDb();
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2), 'utf8');
    if (postgresPersistenceEnabled()) {
      ensurePostgresReady(seed);
      hydrateMigratedDomainsFromPostgres(seed);
      fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2), 'utf8');
    }
    return;
  }
  ensureShape(current);
  ensureDemoFinanceScenario(current);
  if (postgresPersistenceEnabled()) {
    ensurePostgresReady(current);
    hydrateMigratedDomainsFromPostgres(current);
  }
  fs.writeFileSync(dbPath, JSON.stringify(current, null, 2), 'utf8');
}

export function readDb() {
  ensureDirs();
  const raw = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(raw);
  ensureShape(db);
  if (postgresPersistenceEnabled()) {
    ensurePostgresReady(db);
    hydrateMigratedDomainsFromPostgres(db);
    db.metadata = db.metadata || {};
    db.metadata.persistence = {
      ...(db.metadata.persistence || {}),
      ...postgresPersistenceStatus()
    };
  }
  if (db.__volatileDirty) {
    delete db.__volatileDirty;
    writeDb(db);
  }
  return db;
}

export function writeDb(db) {
  ensureDirs();
  db.metadata = db.metadata || {};
  db.metadata.updatedAt = nowIso();
  if (postgresPersistenceEnabled()) {
    persistMigratedDomainsToPostgres(db);
    db.metadata.persistence = {
      ...(db.metadata.persistence || {}),
      ...postgresPersistenceStatus(),
      updatedAt: nowIso()
    };
  }
  const tempPath = `${dbPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, dbPath);
}

export function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

export function nextId(db, key, prefix) {
  db.sequences[key] = Number(db.sequences[key] || 0) + 1;
  return `${prefix}-${String(db.sequences[key]).padStart(4, '0')}`;
}

export function appendAudit(db, {
  actorUserId = null,
  module = 'finance',
  action,
  entityType,
  entityId = null,
  details = null
}) {
  const id = nextId(db, 'AUDIT', 'AUD');
  db.auditLog.push({
    id,
    actorUserId,
    module,
    action,
    entityType,
    entityId,
    details,
    createdAt: nowIso()
  });
  return id;
}

export function queueNotification(db, { channel = 'email', recipient, subject, body, referenceType = null, referenceId = null }) {
  const id = nextId(db, 'NOTIFICATION', 'NTF');
  db.notificationQueue.push({
    id,
    channel,
    recipient,
    subject,
    body,
    referenceType,
    referenceId,
    status: 'QUEUED',
    attempts: 0,
    lastError: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sentAt: null
  });
  return id;
}

export { dbPath, evidenceDir, invoicesDir, nowIso, role };
