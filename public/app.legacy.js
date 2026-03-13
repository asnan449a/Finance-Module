const appEl = document.getElementById('app');

const PERSONAS = [
  { role: 'ADMIN', label: 'Admin', email: 'admin@telerelation.local', password: 'admin123' },
  { role: 'ACCOUNTANT', label: 'Accountant', email: 'accountant@telerelation.local', password: 'account123' },
  { role: 'PARTNER', label: 'Partner', email: 'partner@telerelation.local', password: 'partner123' },
  { role: 'VIEWER', label: 'Viewer', email: 'viewer@telerelation.local', password: 'viewer123' }
];

const tabs = [
  { key: 'overview', label: 'Control Tower', sub: 'Group finance cockpit' },
  { key: 'quickbooks', label: 'QuickBooks', sub: 'Connection + sync' },
  { key: 'banking', label: 'Banking Hub', sub: 'Cash, statements, reconciliation' },
  { key: 'treasury', label: 'Treasury', sub: 'Cash position + intercompany' },
  { key: 'billing', label: 'Client Billing', sub: 'AR, invoicing, collections' },
  { key: 'payables', label: 'Payables', sub: 'Vendor bills + AP control' },
  { key: 'tagging', label: 'Classification', sub: 'LOS, partner draw, capex, channels' },
  { key: 'operations', label: 'Operating Spend', sub: 'Expenses + reimbursements' },
  { key: 'ventures', label: 'Ventures', sub: 'Poncho + ASAR views' },
  { key: 'ledger', label: 'Transaction Monitor', sub: 'Ledger and source traceability' },
  { key: 'reports', label: 'Reports', sub: 'Board pack + analytics' },
  { key: 'close', label: 'Month-End Close', sub: 'Checklist + period locks' },
  { key: 'admin', label: 'Admin', sub: 'Audit, controls, workflow health' }
];

const navGroups = [
  { key: 'home', label: 'Home', tabs: ['overview'] },
  { key: 'operate', label: 'Operate', tabs: ['banking', 'treasury', 'billing', 'payables', 'operations', 'ventures'] },
  { key: 'control', label: 'Control', tabs: ['quickbooks', 'tagging', 'ledger', 'reports', 'close', 'admin'] }
];

const DEFAULT_BANKING_RAILS = [
  {
    key: 'MEEZAN',
    label: 'Meezan PKR',
    entity: 'PK',
    currency: 'PKR',
    source: 'MEEZAN_IMPORT',
    purpose: 'Pakistan operating cash and employee reimbursements',
    keywords: ['meezan', 'pakistan', 'pk']
  },
  {
    key: 'WISE',
    label: 'Wise GBP',
    entity: 'UK',
    currency: 'GBP',
    source: 'WISE_IMPORT',
    purpose: 'UK collections, Upwork receipts, and international settlements',
    keywords: ['wise', 'gbp', 'uk', 'upwork']
  },
  {
    key: 'BOFA',
    label: 'Bank of America USD',
    entity: 'US',
    currency: 'USD',
    source: 'BOFA_IMPORT',
    purpose: 'US client billings and operating cash',
    keywords: ['bofa', 'bank of america', 'checking', 'usd']
  },
  {
    key: 'CHASE',
    label: 'Chase Card',
    entity: 'US',
    currency: 'USD',
    source: 'CHASE_IMPORT',
    purpose: 'US credit card activity and partner-draw review',
    keywords: ['chase', 'credit card']
  }
];

const state = {
  token: localStorage.getItem('tr_finance_token') || null,
  user: null,
  activeTab: 'overview',
  openPrimaryNav: null,
  loading: false,
  notice: null,
  error: null,
  searchQuery: '',
  bootstrap: null,
  vendors: [],
  invoices: [],
  vendorBills: [],
  transactions: [],
  expenses: [],
  reconciliation: null,
  payables: {
    summary: null,
    aging: null,
    byVendor: [],
    bills: []
  },
  intercompany: {
    summary: null,
    byPair: [],
    entries: []
  },
  closePeriods: [],
  reimbursements: {
    summary: null,
    rows: []
  },
  qboStatus: null,
  qboChecklist: null,
  qboLineage: null,
  financeModel: null,
  managementAdjustments: [],
  admin: {
    audit: [],
    notifications: []
  },
  reportFilters: {
    fromDate: `${new Date().getFullYear()}-01-01`,
    toDate: new Date().toISOString().slice(0, 10),
    entity: ''
  },
  ledgerFilters: {
    objectType: ''
  },
  expenseDraft: {
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    currency: 'PKR',
    entity: 'PK',
    sourceAccountId: '',
    account: 'Meezan PKR',
    category: 'Operating Expense',
    businessUnit: 'CORPORATE',
    lineOfService: '',
    employeeId: '',
    reimbursementNeeded: true,
    notes: ''
  },
  billingDraft: {
    projectId: '',
    clientId: '',
    clientName: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    currency: 'USD',
    entity: 'US',
    businessUnit: 'SERVICES',
    lineOfService: '',
    channel: '',
    description: '',
    qty: 1,
    rate: '',
    taxRate: 0,
    notes: ''
  },
  bankingDraft: {
    rail: 'MEEZAN',
    sourceAccountId: '',
    entity: 'PK',
    currency: 'PKR',
    account: 'Meezan PKR',
    source: 'MEEZAN_IMPORT',
    csv: ''
  },
  ponchoDraft: {
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    currency: 'GBP',
    entity: 'UK',
    channel: 'DIRECT',
    reference: '',
    invoiceId: '',
    notes: ''
  },
  towerDraft: {
    date: new Date().toISOString().slice(0, 10),
    vendor: '',
    description: '',
    amount: '',
    currency: 'PKR',
    entity: 'PK',
    usefulLifeMonths: 60,
    status: 'CAPITALIZED',
    notes: ''
  },
  reports: {
    qboRevenueByLos: null,
    statutoryPl: null,
    statutoryCashFlow: null,
    statutoryBalanceSheet: null,
    statutoryArAging: null,
    utilisation: null,
    managementPl: null,
    managementTreasury: null,
    managementUpwork: null,
    managementPartner: null
  },
  taggingDraft: {
    invoiceId: '',
    lineOfService: '',
    businessUnit: '',
    entity: '',
    channel: '',
    notes: ''
  },
  transactionDraft: {
    transactionId: '',
    category: '',
    lineOfService: '',
    businessUnit: '',
    channel: '',
    partnerTag: '',
    entity: '',
    treasuryFlag: false,
    intercompanyFlag: false,
    capexFlag: false,
    reimbursable: false
  },
  ruleDraft: {
    pattern: '',
    category: 'Operating Expense'
  },
  accountDraft: {
    accountId: '',
    name: '',
    provider: 'MANUAL',
    sourceSystem: 'MANUAL',
    sourceLedger: 'MANUAL',
    entity: 'US',
    currency: 'USD',
    accountRole: 'BANK',
    isCashAccount: true,
    showInBankingHub: true,
    notes: ''
  },
  globalAccountDraft: {
    globalAccountId: '',
    code: '',
    name: '',
    type: 'ASSET',
    reportingGroup: 'Cash',
    notes: ''
  },
  mappingDraft: {
    mappingId: '',
    sourceAccountId: '',
    globalAccountId: '',
    entityOverride: '',
    lineOfServiceOverride: '',
    businessUnitOverride: '',
    notes: ''
  },
  vendorDraft: {
    name: '',
    email: '',
    entity: 'PK',
    defaultCurrency: 'PKR',
    notes: ''
  },
  billDraft: {
    vendorId: '',
    vendorName: '',
    billNumber: '',
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    entity: 'PK',
    currency: 'PKR',
    category: 'Operating Expense',
    businessUnit: 'CORPORATE',
    lineOfService: '',
    description: '',
    total: '',
    notes: ''
  },
  intercompanyDraft: {
    date: new Date().toISOString().slice(0, 10),
    fromEntity: 'US',
    toEntity: 'PK',
    currency: 'USD',
    amount: '',
    sourceAccountId: '',
    reference: '',
    reason: 'Intercompany Funding',
    description: '',
    notes: ''
  }
};

function canViewAdmin() {
  return ['ADMIN', 'ACCOUNTANT'].includes(state.user?.role || '');
}

function canManageFinance() {
  return ['ADMIN', 'ACCOUNTANT'].includes(state.user?.role || '');
}

function canCreateInvoices() {
  return ['ADMIN', 'ACCOUNTANT'].includes(state.user?.role || '');
}

function canApproveInvoices() {
  return ['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(state.user?.role || '');
}

function canReadFinance() {
  return ['ADMIN', 'ACCOUNTANT', 'PARTNER', 'VIEWER'].includes(state.user?.role || '');
}

function canAccessTab(tabKey) {
  const role = String(state.user?.role || '').toUpperCase();
  if (!role) return false;

  if (['overview', 'reports'].includes(tabKey)) return canReadFinance();
  if (['billing', 'ledger', 'payables', 'treasury', 'close'].includes(tabKey)) return ['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role);
  if (['quickbooks', 'banking', 'tagging', 'operations', 'ventures'].includes(tabKey)) return canManageFinance();
  if (tabKey === 'admin') return canViewAdmin();
  return false;
}

function setError(message) {
  state.error = message;
  state.notice = null;
}

function setNotice(message) {
  state.notice = message;
  state.error = null;
}

function rowOrDash(value) {
  return value == null || value === '' ? '-' : value;
}

function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function badgeClass(value) {
  const normalized = String(value || '').toUpperCase();
  if (['PAID', 'SYNCED', 'APPROVED', 'SENT', 'ACTIVE', 'SUCCESS', 'CONNECTED'].includes(normalized)) return 'ok';
  if (['PARTIAL', 'PENDING', 'OVERDUE', 'DRAFT', 'NOT_SYNCED', 'QUEUED', 'UNTAGGED'].includes(normalized)) return 'warn';
  if (['REJECTED', 'FAILED', 'SYNC_FAILED', 'INACTIVE'].includes(normalized)) return 'danger';
  return 'info';
}

function filteredTabs() {
  return tabs.filter((tab) => canAccessTab(tab.key));
}

function activePrimaryNavKey() {
  if (state.openPrimaryNav) {
    const openTabs = groupTabs(state.openPrimaryNav);
    if (openTabs.length) return state.openPrimaryNav;
  }
  const visible = filteredTabs();
  for (const group of navGroups) {
    if (group.tabs.includes(state.activeTab) && group.tabs.some((key) => visible.find((tab) => tab.key === key))) {
      return group.key;
    }
  }
  return 'home';
}

function groupTabs(groupKey) {
  const group = navGroups.find((item) => item.key === groupKey);
  if (!group) return [];
  const visibleTabs = filteredTabs();
  return group.tabs
    .map((key) => visibleTabs.find((tab) => tab.key === key))
    .filter(Boolean);
}

function qboInvoices() {
  return (state.invoices || []).filter((invoice) => Boolean(invoice.qboInvoiceId));
}

function qboTransactions() {
  return (state.transactions || []).filter((row) => String(row.source || '').toUpperCase().startsWith('QBO'));
}

function qboLineageRows() {
  if (Array.isArray(state.qboLineage?.transactions) && state.qboLineage.transactions.length) {
    return state.qboLineage.transactions;
  }
  return qboTransactions();
}

function qboObjectOptions() {
  const items = state.qboLineage?.byObject || [];
  if (!items.length) return [];
  return items.map((row) => row.objectType).filter(Boolean).sort();
}

function architectureWorkflowRows() {
  const qbo = state.qboStatus || {};
  const checklist = state.qboChecklist || qbo.lastPullChecklist || {};
  const lineage = state.qboLineage || {};
  const los = state.reports.qboRevenueByLos || {};
  const losSummary = los.summary || {};
  const upwork = state.reports.managementUpwork || {};
  const upworkSummary = upwork.summary || {};
  const managementPl = state.reports.managementPl || {};
  const objectRows = lineage.byObject || [];
  const requiredObjects = ['JournalEntry', 'Purchase', 'Bill', 'BillPayment', 'Deposit', 'Transfer', 'SalesReceipt', 'VendorCredit', 'CreditCardPayment', 'CustomerPayment'];
  const coveredObjects = requiredObjects.filter((name) => objectRows.find((row) => row.objectType === name));
  const sourceLinkedPct = Number(lineage.summary?.sourceLinkedPct || 0);
  const untagged = Number(losSummary.untaggedCount || 0);
  const invoiceCount = Number(losSummary.invoiceCount || 0);
  const unmatchedReceipts = Number(upworkSummary.unmatchedReceipts || 0);

  const row = (id, workflow, purpose, pass, warn, metric, output) => ({
    id,
    workflow,
    purpose,
    status: pass ? 'PASS' : warn ? 'WARN' : 'FAIL',
    metric,
    output
  });

  return [
    row(
      'wf_connection',
      'QBO Connection',
      'Ensure source ledger access is live and refreshable.',
      Boolean(qbo.connected && qbo.configured),
      false,
      `Connected=${qbo.connected ? 'Yes' : 'No'} | Realm=${rowOrDash(qbo.realmId)}`,
      'QuickBooks OAuth + environment context'
    ),
    row(
      'wf_pull',
      'QBO Full Pull',
      'Ingest customers, accounts, invoices, payments, and transaction objects.',
      Boolean(qbo.lastPullAt && Number(lineage.summary?.rowCount || 0) > 0),
      Boolean(qbo.connected && !qbo.lastPullAt),
      `Last Pull=${rowOrDash(qbo.lastPullAt)} | Tx Rows=${rowOrDash(lineage.summary?.rowCount)}`,
      'ERP normalized QBO staging data'
    ),
    row(
      'wf_objects',
      'Transaction Object Coverage',
      'Confirm each target QBO object type is represented in ERP transactions.',
      coveredObjects.length === requiredObjects.length,
      coveredObjects.length >= Math.floor(requiredObjects.length * 0.7),
      `${coveredObjects.length}/${requiredObjects.length} objects represented`,
      'Object-level ingestion assurance'
    ),
    row(
      'wf_lineage',
      'Transaction Lineage Completeness',
      'Each ERP transaction row should be traceable to source object/id/line.',
      sourceLinkedPct >= 99,
      sourceLinkedPct >= 90,
      `Linked Rows=${rowOrDash(lineage.summary?.sourceLinkedRows)} (${sourceLinkedPct.toFixed(2)}%)`,
      'Audit trace back to QBO object IDs'
    ),
    row(
      'wf_tagging',
      'Invoice LOS Tagging',
      'Tag invoices so revenue-by-line-of-service reporting is correct.',
      invoiceCount > 0 && untagged === 0,
      invoiceCount > 0 && untagged > 0,
      `Invoices=${invoiceCount} | Untagged=${untagged}`,
      'Trusted LOS profitability reports'
    ),
    row(
      'wf_upwork',
      'Upwork Receipt Matching',
      'Match Wise GBP receipts against one or multiple invoices.',
      unmatchedReceipts === 0,
      unmatchedReceipts > 0,
      `Unmatched Receipts=${money(unmatchedReceipts, upwork.reportingCurrency || 'USD')}`,
      'Clean AR and channel reporting'
    ),
    row(
      'wf_management',
      'Management Consolidation',
      'Build consolidated management P&L over normalized entries.',
      Number(managementPl.entryCount || 0) > 0,
      false,
      `Mgmt Entries=${rowOrDash(managementPl.entryCount)} | Net=${money(managementPl.summary?.net || 0, managementPl.reportingCurrency || 'USD')}`,
      'Group-level management P&L'
    )
  ];
}

function getReportQuery() {
  const params = new URLSearchParams();
  const filters = state.reportFilters || {};
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.entity) params.set('entity', filters.entity);
  return params.toString();
}

function getEntityOptions() {
  return state.financeModel?.dimensions?.entities || ['US', 'UK', 'PK'];
}

function getEmployeeOptions() {
  const users = state.bootstrap?.users || [];
  return users
    .filter((row) => ['EMPLOYEE', 'PROJECT_MANAGER', 'ACCOUNTANT', 'PARTNER', 'ADMIN'].includes(String(row.role || '').toUpperCase()))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function qboConnectReadiness() {
  return state.qboStatus?.connectReadiness || {
    configured: false,
    environment: 'sandbox',
    redirectValid: false,
    redirectHost: null,
    redirectProtocol: null,
    localRedirect: false,
    httpsRedirect: false,
    oauthConnectReady: false,
    blockers: []
  };
}

function sourceAccounts() {
  return state.financeModel?.sourceAccounts || state.bootstrap?.accounts || [];
}

function globalChartAccounts() {
  return state.financeModel?.globalChartAccounts || [];
}

function accountMappings() {
  return state.financeModel?.accountMappings || [];
}

function defaultAccountDraft() {
  return {
    accountId: '',
    name: '',
    provider: 'MANUAL',
    sourceSystem: 'MANUAL',
    sourceLedger: 'MANUAL',
    entity: 'US',
    currency: 'USD',
    accountRole: 'BANK',
    isCashAccount: true,
    showInBankingHub: true,
    notes: ''
  };
}

function defaultGlobalAccountDraft() {
  return {
    globalAccountId: '',
    code: '',
    name: '',
    type: 'ASSET',
    reportingGroup: 'Cash',
    notes: ''
  };
}

function defaultMappingDraft() {
  return {
    mappingId: '',
    sourceAccountId: '',
    globalAccountId: '',
    entityOverride: '',
    lineOfServiceOverride: '',
    businessUnitOverride: '',
    notes: ''
  };
}

function configuredBankingRails() {
  const accounts = sourceAccounts()
    .filter((row) => String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
    .filter((row) => ['BANK', 'CREDIT_CARD', 'WALLET', 'OTHER'].includes(String(row.accountRole || '').toUpperCase()) || String(row.sourceSystem || '').toUpperCase() !== 'QBO');

  if (!accounts.length) return DEFAULT_BANKING_RAILS;

  return accounts.map((row) => ({
    key: row.id,
    sourceAccountId: row.id,
    qboAccountId: row.qboAccountId || null,
    label: row.name || row.externalName,
    entity: row.entity || (row.currency === 'GBP' ? 'UK' : row.currency === 'PKR' ? 'PK' : 'US'),
    currency: row.currency || 'USD',
    source: row.sourceSystem || row.provider || 'MANUAL',
    purpose: row.notes || `${row.accountRole || 'Account'} managed in Admin`,
    keywords: [row.name, row.externalName, row.provider, row.sourceSystem, row.externalCode].filter(Boolean).map((value) => String(value).toLowerCase())
  }));
}

function loadAccountDraft(accountId) {
  const row = sourceAccounts().find((item) => item.id === accountId);
  if (!row) {
    state.accountDraft = defaultAccountDraft();
    return;
  }
  state.accountDraft = {
    accountId: row.id,
    name: row.name || '',
    provider: row.provider || row.sourceSystem || 'MANUAL',
    sourceSystem: row.sourceSystem || row.provider || 'MANUAL',
    sourceLedger: row.sourceLedger || 'MANUAL',
    entity: row.entity || 'US',
    currency: row.currency || 'USD',
    accountRole: row.accountRole || 'BANK',
    isCashAccount: Boolean(row.isCashAccount),
    showInBankingHub: Boolean(row.showInBankingHub),
    notes: row.notes || ''
  };
}

function loadGlobalAccountDraft(globalAccountId) {
  const row = globalChartAccounts().find((item) => item.id === globalAccountId);
  if (!row) {
    state.globalAccountDraft = defaultGlobalAccountDraft();
    return;
  }
  state.globalAccountDraft = {
    globalAccountId: row.id,
    code: row.code || '',
    name: row.name || '',
    type: row.type || 'ASSET',
    reportingGroup: row.reportingGroup || '',
    notes: row.notes || ''
  };
}

function loadMappingDraft(mappingId) {
  const row = accountMappings().find((item) => item.id === mappingId);
  if (!row) {
    state.mappingDraft = defaultMappingDraft();
    return;
  }
  state.mappingDraft = {
    mappingId: row.id,
    sourceAccountId: row.sourceAccountId || '',
    globalAccountId: row.globalAccountId || '',
    entityOverride: row.entityOverride || '',
    lineOfServiceOverride: row.lineOfServiceOverride || '',
    businessUnitOverride: row.businessUnitOverride || '',
    notes: row.notes || ''
  };
}

function railMatches(row, rail) {
  const text = `${row.account || ''} ${row.description || ''} ${row.source || ''} ${row.reference || ''} ${row.qboAccountId || ''}`.toLowerCase();
  const keywordMatch = (rail.keywords || []).some((value) => text.includes(String(value).toLowerCase()));
  if (rail.qboAccountId && String(row.qboAccountId || '') === String(rail.qboAccountId)) return true;
  const entityMatch = String(row.entity || '').toUpperCase() === rail.entity;
  const currencyMatch = String(row.currency || '').toUpperCase() === rail.currency;
  return keywordMatch || (entityMatch && currencyMatch && text.includes(rail.currency.toLowerCase()));
}

function bankingRailSummaries() {
  const transactions = [...(state.transactions || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return configuredBankingRails().map((rail) => {
    const rows = transactions.filter((row) => railMatches(row, rail));
    const inflow = rows
      .filter((row) => String(row.type || '').toUpperCase() === 'CREDIT')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const outflow = rows
      .filter((row) => String(row.type || '').toUpperCase() === 'DEBIT')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const unreconciled = rows.filter((row) => Number(row.remainingAmount || 0) > 0).length;
    return {
      ...rail,
      rows,
      rowCount: rows.length,
      inflow,
      outflow,
      unreconciled,
      lastActivity: rows[0]?.date || null
    };
  });
}

function selectedBankingRail() {
  return bankingRailSummaries().find((row) => row.key === state.bankingDraft.rail) || bankingRailSummaries()[0] || null;
}

function transactionById(transactionId) {
  return (state.transactions || []).find((row) => row.id === transactionId) || null;
}

function classificationQueues() {
  const transactions = [...(state.transactions || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const search = String(state.searchQuery || '').toLowerCase();
  const matchSearch = (row) => {
    const hay = `${row.date || ''} ${row.account || ''} ${row.description || ''} ${row.category || ''} ${row.entity || ''} ${row.reference || ''}`.toLowerCase();
    return !search || hay.includes(search);
  };

  const invoiceUntagged = qboInvoices()
    .filter((row) => !row.lineOfService)
    .filter((row) => {
      const hay = `${row.invoiceNumber || ''} ${row.clientName || ''} ${row.entity || ''}`.toLowerCase();
      return !search || hay.includes(search);
    })
    .sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')));

  const unclassifiedTransactions = transactions.filter((row) => {
    const category = String(row.category || '').trim().toLowerCase();
    return matchSearch(row) && (!category || category === 'unclassified');
  });

  const partnerReview = transactions.filter((row) => {
    const text = `${row.account || ''} ${row.description || ''} ${row.category || ''}`.toLowerCase();
    return matchSearch(row) && (text.includes('chase') || text.includes('partner draw') || String(row.partnerTag || '').length);
  });

  const capexReview = transactions.filter((row) => {
    const text = `${row.account || ''} ${row.description || ''} ${row.category || ''} ${row.businessUnit || ''}`.toLowerCase();
    return matchSearch(row) && (row.capexFlag || text.includes('capex') || text.includes('tower') || text.includes('asar'));
  });

  const treasuryReview = transactions.filter((row) => {
    const text = `${row.account || ''} ${row.description || ''} ${row.category || ''}`.toLowerCase();
    return matchSearch(row) && (row.treasuryFlag || text.includes('bank fee') || text.includes('cash inflow') || text.includes('cash outflow') || text.includes('transfer'));
  });

  return {
    invoiceUntagged,
    unclassifiedTransactions,
    partnerReview,
    capexReview,
    treasuryReview
  };
}

function defaultTransactionDraft() {
  const queues = classificationQueues();
  const tx = queues.unclassifiedTransactions[0] || queues.partnerReview[0] || queues.capexReview[0] || queues.treasuryReview[0] || (state.transactions || [])[0] || null;
  if (!tx) {
    return {
      transactionId: '',
      category: '',
      lineOfService: '',
      businessUnit: '',
      channel: '',
      partnerTag: '',
      entity: '',
      treasuryFlag: false,
      intercompanyFlag: false,
      capexFlag: false,
      reimbursable: false
    };
  }
  return {
    transactionId: tx.id,
    category: tx.category || '',
    lineOfService: tx.lineOfService || '',
    businessUnit: tx.businessUnit || '',
    channel: tx.channel || '',
    partnerTag: tx.partnerTag || '',
    entity: tx.entity || '',
    treasuryFlag: Boolean(tx.treasuryFlag),
    intercompanyFlag: Boolean(tx.intercompanyFlag),
    capexFlag: Boolean(tx.capexFlag),
    reimbursable: Boolean(tx.reimbursable)
  };
}

function collectionsQueueRows() {
  return [...(state.invoices || [])]
    .filter((row) => ['SENT', 'PARTIAL', 'OVERDUE'].includes(String(row.status || '').toUpperCase()))
    .map((row) => ({
      ...row,
      outstanding: Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0)
    }))
    .filter((row) => row.outstanding > 0)
    .sort((a, b) => {
      const aRank = String(a.status || '').toUpperCase() === 'OVERDUE' ? 0 : 1;
      const bRank = String(b.status || '').toUpperCase() === 'OVERDUE' ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.dueDate || a.issueDate || '').localeCompare(String(b.dueDate || b.issueDate || ''));
    });
}

function expenseCategorySummary() {
  const totals = new Map();
  for (const row of state.expenses || []) {
    const key = row.category || 'Unclassified';
    if (!totals.has(key)) {
      totals.set(key, { category: key, amount: 0, count: 0, currency: row.currency || 'PKR' });
    }
    const item = totals.get(key);
    item.amount += Number(row.amount || 0);
    item.count += 1;
  }
  return [...totals.values()]
    .map((row) => ({ ...row, amount: Number(row.amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount);
}

function recentActivityRows() {
  if ((state.admin.audit || []).length) return (state.admin.audit || []).slice(0, 12);
  const fallback = [];
  for (const row of (state.invoices || []).slice(0, 6)) {
    fallback.push({
      createdAt: row.updatedAt || row.createdAt || row.issueDate,
      module: 'invoices',
      action: row.status || 'UPDATED',
      entityType: 'invoice',
      entityId: row.id,
      actorUserId: row.createdByUserId || '-'
    });
  }
  for (const row of (state.expenses || []).slice(0, 6)) {
    fallback.push({
      createdAt: row.updatedAt || row.createdAt || row.date,
      module: 'expenses',
      action: row.reimbursementStatus || row.status || 'RECORDED',
      entityType: 'expense',
      entityId: row.id,
      actorUserId: row.createdByUserId || '-'
    });
  }
  return fallback
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12);
}

function sectionNav(items = []) {
  const visible = items.filter((item) => item && item.id && item.label);
  if (!visible.length) return '';
  return `
    <nav class="section-nav" aria-label="Section navigation">
      ${visible.map((item) => `<a class="section-link" href="#${item.id}">${item.label}</a>`).join('')}
    </nav>
  `;
}

function inDateWindow(value, fromDate, toDate) {
  const date = String(value || '');
  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function reportScopedInvoices() {
  const invoices = state.invoices || [];
  const { fromDate, toDate, entity } = state.reportFilters || {};
  return invoices.filter((row) => {
    if (!inDateWindow(row.issueDate || row.createdAt, fromDate, toDate)) return false;
    if (entity && String(row.entity || '').toUpperCase() !== String(entity).toUpperCase()) return false;
    return true;
  });
}

function clientBillingAnalytics(invoices) {
  const map = new Map();
  for (const row of invoices || []) {
    const key = row.clientName || row.clientId || 'Unknown Client';
    if (!map.has(key)) {
      map.set(key, {
        client: key,
        invoiceCount: 0,
        totalBilled: 0,
        totalCollected: 0,
        outstanding: 0,
        overdueCount: 0
      });
    }
    const item = map.get(key);
    const total = Number(row.total || 0);
    const collected = Number(row.amountPaid || 0);
    const outstanding = Math.max(total - collected, 0);
    item.invoiceCount += 1;
    item.totalBilled += total;
    item.totalCollected += collected;
    item.outstanding += outstanding;
    if (String(row.status || '').toUpperCase() === 'OVERDUE') item.overdueCount += 1;
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      totalBilled: Number(row.totalBilled.toFixed(2)),
      totalCollected: Number(row.totalCollected.toFixed(2)),
      outstanding: Number(row.outstanding.toFixed(2)),
      collectionPct: row.totalBilled > 0 ? Number(((row.totalCollected / row.totalBilled) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.totalBilled - a.totalBilled);
}

function toCsv(rows, headers) {
  const escape = (value) => {
    const text = String(value == null ? '' : value);
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const head = headers.join(',');
  const body = rows.map((row) => headers.map((key) => escape(row[key])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

function downloadCsvFile(name, rows, headers) {
  const csv = toCsv(rows, headers);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function login(email, password) {
  state.loading = true;
  render();
  try {
    const session = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    state.token = session.token;
    state.user = session.user;
    localStorage.setItem('tr_finance_token', state.token);
    state.activeTab = 'overview';
    state.openPrimaryNav = null;
    await loadAll();
    setNotice(`Signed in as ${state.user.name}.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

async function loginWithGoogleToken(idToken) {
  state.loading = true;
  render();
  try {
    const session = await api('/api/auth/google', {
      method: 'POST',
      body: { idToken }
    });
    state.token = session.token;
    state.user = session.user;
    localStorage.setItem('tr_finance_token', state.token);
    state.activeTab = 'overview';
    state.openPrimaryNav = null;
    await loadAll();
    setNotice(`Google sign-in complete for ${state.user.email}.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

async function hydrateSession() {
  if (!state.token) return;
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    await loadAll();
  } catch {
    localStorage.removeItem('tr_finance_token');
    state.token = null;
    state.user = null;
  }
}

async function loadAll() {
  if (!state.token) return;
  if (!canAccessTab(state.activeTab)) state.activeTab = 'overview';
  state.loading = true;
  render();

  const query = getReportQuery();
  const tasks = [
    api('/api/finance/bootstrap').then((r) => {
      state.bootstrap = r;
      state.vendors = r.vendors || state.vendors || [];
      state.qboStatus = r.qbo || null;
      state.managementAdjustments = r.managementAdjustments || [];
    }).catch(() => {}),
    api('/api/invoices').then((r) => { state.invoices = r.invoices || []; }).catch(() => { state.invoices = []; }),
    api('/api/vendors').then((r) => { state.vendors = r.vendors || []; }).catch(() => { state.vendors = state.vendors || []; }),
    api('/api/payables/bills').then((r) => {
      state.payables = {
        summary: r.summary || null,
        aging: r.aging || null,
        byVendor: r.byVendor || [],
        bills: r.bills || []
      };
      state.vendorBills = r.bills || [];
    }).catch(() => {
      state.payables = { summary: null, aging: null, byVendor: [], bills: [] };
      state.vendorBills = [];
    }),
    api('/api/transactions').then((r) => { state.transactions = r.transactions || []; }).catch(() => { state.transactions = []; }),
    api('/api/expenses').then((r) => { state.expenses = r.expenses || []; }).catch(() => { state.expenses = []; }),
    api('/api/intercompany/ledger').then((r) => { state.intercompany = { summary: r.summary || null, byPair: r.byPair || [], entries: r.entries || [] }; }).catch(() => { state.intercompany = { summary: null, byPair: [], entries: [] }; }),
    api('/api/close/periods?months=8').then((r) => { state.closePeriods = r.periods || []; }).catch(() => { state.closePeriods = []; }),
    api('/api/reconciliation/board').then((r) => { state.reconciliation = r; }).catch(() => { state.reconciliation = null; }),
    api('/api/reimbursements').then((r) => { state.reimbursements = { summary: r.summary || null, rows: r.reimbursements || [] }; }).catch(() => { state.reimbursements = { summary: null, rows: [] }; }),
    api('/api/qbo/status').then((r) => { state.qboStatus = r.status || state.qboStatus; }).catch(() => {}),
    api('/api/qbo/checklist').then((r) => { state.qboChecklist = r.checklist || null; }).catch(() => {}),
    api(`/api/qbo/transactions?${query}&limit=1600`).then((r) => { state.qboLineage = r; }).catch(() => { state.qboLineage = null; }),
    api('/api/settings/finance-model').then((r) => { state.financeModel = r; }).catch(() => {}),
    api('/api/management/adjustments').then((r) => { state.managementAdjustments = r.adjustments || state.managementAdjustments; }).catch(() => {}),
    api(`/api/reports/qbo/revenue-by-los?${query}`).then((r) => { state.reports.qboRevenueByLos = r; }).catch(() => { state.reports.qboRevenueByLos = null; }),
    api(`/api/reports/pl?${query}`).then((r) => { state.reports.statutoryPl = r; }).catch(() => { state.reports.statutoryPl = null; }),
    api(`/api/reports/cash-flow?${query}`).then((r) => { state.reports.statutoryCashFlow = r; }).catch(() => { state.reports.statutoryCashFlow = null; }),
    api('/api/reports/balance-sheet').then((r) => { state.reports.statutoryBalanceSheet = r; }).catch(() => { state.reports.statutoryBalanceSheet = null; }),
    api('/api/reports/ar-aging').then((r) => { state.reports.statutoryArAging = r; }).catch(() => { state.reports.statutoryArAging = null; }),
    api(`/api/reports/utilisation?${query}`).then((r) => { state.reports.utilisation = r; }).catch(() => { state.reports.utilisation = null; }),
    api(`/api/reports/management/pl?${query}&includeIntercompany=false&includeCapex=true`).then((r) => { state.reports.managementPl = r; }).catch(() => { state.reports.managementPl = null; }),
    api(`/api/reports/management/treasury?${query}`).then((r) => { state.reports.managementTreasury = r; }).catch(() => { state.reports.managementTreasury = null; }),
    api(`/api/reports/management/upwork?${query}`).then((r) => { state.reports.managementUpwork = r; }).catch(() => { state.reports.managementUpwork = null; }),
    api(`/api/reports/management/partner-ledger?${query}`).then((r) => { state.reports.managementPartner = r; }).catch(() => { state.reports.managementPartner = null; })
  ];

  if (canViewAdmin()) {
    tasks.push(api('/api/admin/audit-log').then((r) => { state.admin.audit = r.events || []; }).catch(() => {}));
    tasks.push(api('/api/admin/notifications').then((r) => { state.admin.notifications = r.notifications || []; }).catch(() => {}));
  }

  await Promise.all(tasks).catch((error) => setError(error.message));

  if (!state.taggingDraft.invoiceId && qboInvoices().length) {
    const first = qboInvoices()[0];
    state.taggingDraft = {
      invoiceId: first.id,
      lineOfService: first.lineOfService || '',
      businessUnit: first.businessUnit || '',
      entity: first.entity || '',
      channel: first.channel || '',
      notes: first.internalNotes || ''
    };
  }

  if (!state.transactionDraft.transactionId) {
    state.transactionDraft = defaultTransactionDraft();
  }

  const rails = configuredBankingRails();
  if (rails.length && !rails.find((row) => row.key === state.bankingDraft.rail)) {
    const firstRail = rails[0];
    state.bankingDraft = {
      ...state.bankingDraft,
      rail: firstRail.key,
      sourceAccountId: firstRail.sourceAccountId || firstRail.key,
      entity: firstRail.entity,
      currency: firstRail.currency,
      account: firstRail.label,
      source: firstRail.source
    };
  }

  if (!state.accountDraft.accountId && sourceAccounts().length) loadAccountDraft(sourceAccounts()[0].id);
  if (!state.globalAccountDraft.globalAccountId && globalChartAccounts().length) loadGlobalAccountDraft(globalChartAccounts()[0].id);
  if (!state.mappingDraft.mappingId && accountMappings().length) loadMappingDraft(accountMappings()[0].id);
  if (!state.expenseDraft.sourceAccountId) {
    const defaultExpenseAccount = sourceAccounts().find((row) => (
      String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
      && (Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
      && String(row.entity || '').toUpperCase() === String(state.expenseDraft.entity || '').toUpperCase()
      && String(row.currency || '').toUpperCase() === String(state.expenseDraft.currency || '').toUpperCase()
    )) || sourceAccounts().find((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount));
    if (defaultExpenseAccount) {
      state.expenseDraft = {
        ...state.expenseDraft,
        sourceAccountId: defaultExpenseAccount.id,
        account: defaultExpenseAccount.name
      };
    }
  }
  if (!state.intercompanyDraft.sourceAccountId) {
    const defaultIcAccount = sourceAccounts().find((row) => (
      String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
      && (Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
      && String(row.entity || '').toUpperCase() === String(state.intercompanyDraft.fromEntity || '').toUpperCase()
    )) || sourceAccounts().find((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount));
    if (defaultIcAccount) {
      state.intercompanyDraft = {
        ...state.intercompanyDraft,
        sourceAccountId: defaultIcAccount.id,
        currency: defaultIcAccount.currency || state.intercompanyDraft.currency
      };
    }
  }

  state.loading = false;
  render();
}

function logout() {
  localStorage.removeItem('tr_finance_token');
  state.token = null;
  state.user = null;
  state.openPrimaryNav = null;
  state.notice = 'Signed out successfully.';
  render();
}

function loginView() {
  return `
    <div class="auth-shell">
      <div class="auth-card">
        <section class="auth-brand">
          <h1>Telerelation Finance</h1>
          <p>QuickBooks-first management workspace for consolidated finance across US, UK, and PK.</p>
          <p class="small">This cleaned version focuses on value views only: connection health, tagging quality, ledger visibility, and decision-ready reports.</p>
        </section>

        <section class="auth-box">
          <h3>Role Personas</h3>
          <div class="persona-grid">
            ${PERSONAS.map((persona) => `<button class="persona-btn" data-persona="${persona.email}"><strong>${persona.label}</strong><div class="small">${persona.email}</div></button>`).join('')}
          </div>

          <div class="form-stack">
            <input class="field field--dark" id="email" placeholder="Email" value="accountant@telerelation.local" />
            <input class="field field--dark" id="password" type="password" placeholder="Password" value="account123" />
            <button class="btn btn-primary" id="loginBtn">${state.loading ? 'Signing in...' : 'Sign In'}</button>
          </div>

          <div class="form-stack">
            <input class="field field--dark" id="googleToken" placeholder="Google ID token (optional)" />
            <button class="btn btn-ghost" id="googleBtn">Sign in with Google Token</button>
          </div>

          ${state.error ? `<div class="notice error">${state.error}</div>` : ''}
          ${state.notice ? `<div class="notice success">${state.notice}</div>` : ''}
        </section>
      </div>
    </div>
  `;
}

function navTabs() {
  const activePrimary = activePrimaryNavKey();
  return navGroups
    .filter((group) => groupTabs(group.key).length > 0)
    .map((group) => `
      <button class="nav-btn ${activePrimary === group.key ? 'active' : ''}" data-primary-nav="${group.key}">
        ${group.label}
      </button>
    `).join('');
}

function headerSubnav() {
  const activeGroup = activePrimaryNavKey();
  const tabsForGroup = groupTabs(activeGroup);
  if (!tabsForGroup.length) return '';
  return `
    <nav class="header-subnav" aria-label="Workspace navigation">
      ${tabsForGroup.map((tab) => `
        <button class="subnav-btn ${state.activeTab === tab.key ? 'active' : ''}" data-tab="${tab.key}">
          <strong>${tab.label}</strong>
          <span>${tab.sub}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function appHeader() {
  const entityOptions = getEntityOptions();
  return `
    <header class="topbar">
      <div class="topbar-main">
        <div class="brand-row">
          <h1>telerelation</h1>
          <nav class="top-primary-nav">${navTabs()}</nav>
        </div>
        <div class="topbar-actions">
          <input id="global_search" class="field" style="min-width:220px;" placeholder="Search invoices/transactions..." value="${state.searchQuery || ''}" />
          <select id="global_entity" class="field" style="width:180px;">
            <option value="">Global Consolidated</option>
            ${entityOptions.map((entity) => `<option value="${entity}" ${state.reportFilters.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
          </select>
          <span class="pill">${state.user?.email || ''}</span>
          <button class="action-btn" id="reloadBtn">Refresh</button>
          <button class="action-btn" id="logoutBtn">Logout</button>
        </div>
      </div>
      ${headerSubnav()}
    </header>
  `;
}

function overviewView() {
  const qbo = state.qboStatus || {};
  const invoices = state.invoices || [];
  const losReport = state.reports.qboRevenueByLos || {};
  const summary = losReport.summary || {};
  const treasurySummary = state.reports.managementTreasury?.summary || {};
  const upworkSummary = state.reports.managementUpwork?.summary || {};
  const workflows = architectureWorkflowRows();
  const passCount = workflows.filter((row) => row.status === 'PASS').length;
  const warnCount = workflows.filter((row) => row.status === 'WARN').length;
  const failCount = workflows.filter((row) => row.status === 'FAIL').length;
  const queues = classificationQueues();
  const collections = collectionsQueueRows();
  const reimbursements = state.reimbursements?.summary || {};
  const payables = state.payables?.summary || {};
  const closeFocus = (state.closePeriods || [])[0] || null;
  const closeChecklist = closeFocus?.checklist || { checks: [], readyToClose: false };
  const intercompanySummary = state.intercompany?.summary || {};
  const recentActivity = recentActivityRows();
  const attentionRows = [
    !qbo.connected ? { workflow: 'Source Ledger', item: 'QuickBooks is not connected.', owner: 'Finance Control', severity: 'danger', tab: 'quickbooks', action: 'Fix connection' } : null,
    queues.invoiceUntagged.length ? { workflow: 'Classification', item: `${queues.invoiceUntagged.length} invoices still need LOS tagging.`, owner: 'Reporting', severity: 'warn', tab: 'tagging', action: 'Tag invoices' } : null,
    collections.filter((row) => row.status === 'OVERDUE').length ? { workflow: 'Collections', item: `${collections.filter((row) => row.status === 'OVERDUE').length} invoices are overdue.`, owner: 'Billing', severity: 'warn', tab: 'billing', action: 'Chase collections' } : null,
    Number(state.reconciliation?.summary?.unmatchedTransactionCount || 0) ? { workflow: 'Cash Matching', item: `${state.reconciliation.summary.unmatchedTransactionCount} cash transactions remain unmatched.`, owner: 'Banking', severity: 'warn', tab: 'banking', action: 'Match receipts' } : null,
    Number(payables.pendingApprovalCount || 0) ? { workflow: 'Payables', item: `${payables.pendingApprovalCount} vendor bills are waiting for approval.`, owner: 'AP Control', severity: 'warn', tab: 'payables', action: 'Approve bills' } : null,
    Number(intercompanySummary.openCount || 0) ? { workflow: 'Treasury', item: `${intercompanySummary.openCount} intercompany balances remain unsettled.`, owner: 'Treasury', severity: 'info', tab: 'treasury', action: 'Settle entries' } : null,
    Number(reimbursements.pendingCount || 0) ? { workflow: 'Reimbursements', item: `${reimbursements.pendingCount} employee claims are waiting for settlement.`, owner: 'Spend', severity: 'info', tab: 'operations', action: 'Settle claims' } : null,
    queues.partnerReview.length ? { workflow: 'Partner Review', item: `${queues.partnerReview.length} Chase / partner-draw rows need review.`, owner: 'Classification', severity: 'info', tab: 'tagging', action: 'Review Chase items' } : null,
    closeFocus && !closeChecklist.readyToClose ? { workflow: 'Month-End Close', item: `${(closeChecklist.checks || []).filter((row) => !row.pass).length} blockers remain for ${closeFocus.periodKey}.`, owner: 'Finance Control', severity: 'warn', tab: 'close', action: 'Review close' } : null
  ].filter((row) => row && canAccessTab(row.tab));
  const modules = [
    {
      tab: 'quickbooks',
      title: 'QuickBooks Source Ledger',
      detail: 'Control the accounting connection, sync objects, and review production readiness.',
      metric: qbo.connected ? `Connected to ${qbo.environment || 'sandbox'}` : 'Connection not active'
    },
    {
      tab: 'banking',
      title: 'Banking Hub',
      detail: 'Import Meezan, Wise, BOFA, and Chase activity into one reconciliation workspace.',
      metric: `${state.transactions?.length || 0} transaction rows`
    },
    {
      tab: 'treasury',
      title: 'Treasury',
      detail: 'Watch cash position and intercompany funding across US, UK, and PK.',
      metric: `${money(intercompanySummary.openAmount || 0)} open intercompany`
    },
    {
      tab: 'billing',
      title: 'Client Billing',
      detail: 'Create invoices, run approvals, record collections, and manage AR follow-up.',
      metric: `${invoices.length} invoices | ${money(summary.openAr || 0, losReport.reportingCurrency || 'USD')} open AR`
    },
    {
      tab: 'payables',
      title: 'Payables',
      detail: 'Create vendor bills, approve AP, and record disbursements from governed rails.',
      metric: `${rowOrDash(payables.openCount)} open bills | ${money(payables.totalOutstanding || 0)} AP`
    },
    {
      tab: 'operations',
      title: 'Operating Spend',
      detail: 'Record PK spend, employee-paid costs, and reimbursements.',
      metric: `${rowOrDash(reimbursements.pendingCount)} pending claims`
    },
    {
      tab: 'tagging',
      title: 'Classification',
      detail: 'Protect the reporting layer with LOS, capex, treasury, and partner tagging.',
      metric: `${queues.unclassifiedTransactions.length} unclassified rows`
    },
    {
      tab: 'reports',
      title: 'Board Pack + Analytics',
      detail: 'Statutory statements, LOS reporting, treasury visibility, and management P&L.',
      metric: `${money(summary.totalRevenue || 0, losReport.reportingCurrency || 'USD')} tagged revenue`
    },
    {
      tab: 'close',
      title: 'Month-End Close',
      detail: 'Close periods with checklist blockers and hard posting locks.',
      metric: closeFocus ? `${closeFocus.periodKey} | ${closeFocus.status}` : 'No close periods loaded'
    }
  ].filter((module) => canAccessTab(module.tab));

  const heroActions = [
    { tab: 'quickbooks', label: 'Review QuickBooks', primary: true },
    { tab: 'banking', label: 'Open Banking Hub', primary: false },
    { tab: 'payables', label: 'Open Payables', primary: false },
    { tab: 'reports', label: 'Open Board Pack', primary: false }
  ].filter((action) => canAccessTab(action.tab));
  const queueActions = [
    { tab: 'tagging', label: 'Open Classification' },
    { tab: 'billing', label: 'Open Collections' },
    { tab: 'operations', label: 'Open Reimbursements' },
    { tab: 'close', label: 'Open Close' }
  ].filter((action) => canAccessTab(action.tab));

  return `
    <section class="hero-panel hero-panel--control">
      <div class="hero-copy">
        <div class="eyebrow">Finance Operating System</div>
        <h2>Financial Control Tower</h2>
        <p>Operate the full finance cycle from one place: source-ledger control, cash intake, billing, spend, classification, and board reporting. This screen only shows active work and decision-ready summaries.</p>
        <div class="hero-actions">
          ${heroActions.map((action, index) => `
            <button class="${index === 0 ? 'btn btn-primary' : action.primary ? 'action-btn primary' : 'action-btn'}" data-tab="${action.tab}">${action.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Workflow gates</span>
          <strong>${passCount} pass / ${warnCount} warn / ${failCount} fail</strong>
        </div>
        <div class="hero-stat">
          <span>QuickBooks status</span>
          <strong>${qbo.connected ? 'Live connection' : 'Not connected'}</strong>
        </div>
        <div class="hero-stat">
          <span>Open receivables</span>
          <strong>${money(summary.openAr || 0, losReport.reportingCurrency || 'USD')}</strong>
        </div>
        <div class="hero-stat">
          <span>Open payables</span>
          <strong>${money(payables.totalOutstanding || 0)}</strong>
        </div>
      </div>
    </section>

    <section class="module-grid">
      ${modules.map((module) => `
        <button class="module-card" data-tab="${module.tab}">
          <div class="module-card__head">
            <span class="eyebrow">${tabs.find((tab) => tab.key === module.tab)?.label || module.tab}</span>
            <strong>${module.title}</strong>
          </div>
          <p>${module.detail}</p>
          <div class="module-card__foot">${module.metric}</div>
        </button>
      `).join('')}
    </section>

    <div class="kpi-grid">
      <div class="kpi"><h4>QBO Connected</h4><p>${qbo.connected ? 'Yes' : 'No'}</p></div>
      <div class="kpi"><h4>Open AR</h4><p>${money(summary.openAr || 0, losReport.reportingCurrency || 'USD')}</p></div>
      <div class="kpi"><h4>Unmatched Receipts</h4><p>${rowOrDash(state.reconciliation?.summary?.unmatchedTransactionCount)}</p></div>
      <div class="kpi"><h4>Pending Claims</h4><p>${rowOrDash(reimbursements.pendingCount)}</p></div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Needs Attention Today</h3><span class="small">Only live exceptions and queue owners</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Workflow</th><th>Issue</th><th>Owner</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                ${attentionRows.map((row) => `
                  <tr>
                    <td>${row.workflow}</td>
                    <td>${row.item}</td>
                    <td>${row.owner}</td>
                    <td><span class="badge ${row.severity}">${row.severity.toUpperCase()}</span></td>
                    <td><button class="action-btn" data-tab="${row.tab}">${row.action}</button></td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No active issues.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Report Snapshot</h3><span class="small">What the current period is saying</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Revenue</h4><p>${money(summary.totalRevenue || 0, losReport.reportingCurrency || 'USD')}</p></div>
            <div class="kpi"><h4>Collected</h4><p>${money(summary.totalCollected || 0, losReport.reportingCurrency || 'USD')}</p></div>
            <div class="kpi"><h4>Treasury Outflows</h4><p>${money(treasurySummary.outflows || 0, state.reports.managementTreasury?.reportingCurrency || 'USD')}</p></div>
            <div class="kpi"><h4>Upwork Unmatched</h4><p>${money(upworkSummary.unmatchedReceipts || 0, state.reports.managementUpwork?.reportingCurrency || 'USD')}</p></div>
          </div>
          <p class="small">Use Reports for formal statements. Use this screen to decide what workflow to open next.</p>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Open Work Queues</h3><span class="small">Operational queue summary</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Untagged Invoices</h4><p>${queues.invoiceUntagged.length}</p></div>
            <div class="kpi"><h4>Overdue Collections</h4><p>${collections.filter((row) => row.status === 'OVERDUE').length}</p></div>
            <div class="kpi"><h4>Partner Review</h4><p>${queues.partnerReview.length}</p></div>
            <div class="kpi"><h4>Capex Review</h4><p>${queues.capexReview.length}</p></div>
          </div>
          <div class="action-row">
            ${queueActions.map((action) => `<button class="action-btn" data-tab="${action.tab}">${action.label}</button>`).join('')}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Recent Finance Activity</h3><span class="small">Latest actions across the workspace</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>When</th><th>Module</th><th>Action</th><th>Record</th><th>Actor</th></tr></thead>
              <tbody>
                ${recentActivity.map((row) => `
                  <tr>
                    <td>${rowOrDash(row.createdAt)}</td>
                    <td>${row.module}</td>
                    <td>${row.action}</td>
                    <td>${row.entityType}:${row.entityId || '-'}</td>
                    <td>${rowOrDash(row.actorUserId)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No recent activity.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function quickbooksView() {
  const qbo = state.qboStatus || {};
  const pull = qbo.lastPullSummary || {};
  const checklist = state.qboChecklist || qbo.lastPullChecklist || null;
  const lineage = state.qboLineage || {};
  const objectCoverage = pull.transactionObjects || {};
  const readiness = qboConnectReadiness();
  const blockers = readiness.blockers || [];
  const productionMode = String(qbo.environment || '').toLowerCase() === 'production';
  const nav = sectionNav([
    { id: 'qbo-connection', label: 'Connection' },
    { id: 'qbo-pull', label: 'Pull Summary' },
    { id: 'qbo-checklist', label: 'Checklist' },
    { id: 'qbo-lineage', label: 'Lineage' },
    { id: 'qbo-logs', label: 'Sync Logs' }
  ]);
  return `
    <section class="hero-panel hero-panel--source">
      <div class="hero-copy">
        <div class="eyebrow">Source Ledger Integration</div>
        <h2>QuickBooks Workspace</h2>
        <p>Control the source accounting connection, run the full pull, and validate whether this deployment is actually ready for QuickBooks production OAuth.</p>
        ${canManageFinance() ? `
          <div class="hero-actions">
            <button class="btn btn-primary" id="connectQboBtn">Connect QuickBooks</button>
            <button class="action-btn primary" id="pullFullQboBtn">Run Full Pull</button>
          </div>
        ` : ''}
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Environment</span>
          <strong>${rowOrDash(qbo.environment)}</strong>
        </div>
        <div class="hero-stat">
          <span>Realm</span>
          <strong>${rowOrDash(qbo.realmId)}</strong>
        </div>
        <div class="hero-stat">
          <span>Last full pull</span>
          <strong>${rowOrDash(qbo.lastPullAt || qbo.lastSyncAt)}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <div class="grid-2 section-block" id="qbo-connection">
      <section class="card">
        <div class="card-head"><h3>Connection State</h3><span class="small">OAuth lifecycle and current redirect target</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Connected</h4><p>${qbo.connected ? 'Yes' : 'No'}</p></div>
            <div class="kpi"><h4>Realm ID</h4><p>${rowOrDash(qbo.realmId)}</p></div>
            <div class="kpi"><h4>Environment</h4><p>${rowOrDash(qbo.environment)}</p></div>
            <div class="kpi"><h4>Configured</h4><p>${qbo.configured ? 'Yes' : 'No'}</p></div>
          </div>
          <p class="small">Redirect URI: ${rowOrDash(qbo.redirectUri)}</p>
          <p class="small">Purpose: this module brings customers, accounts, invoices, payments, and transaction objects into the ERP normalization layer.</p>
          ${!canManageFinance() ? '<p class="small">Read-only for your role.</p>' : ''}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Production Readiness</h3><span class="small">Can this deployment authenticate against live QuickBooks?</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>OAuth Ready</h4><p>${readiness.oauthConnectReady ? 'Yes' : 'No'}</p></div>
            <div class="kpi"><h4>HTTPS Redirect</h4><p>${readiness.httpsRedirect ? 'Yes' : 'No'}</p></div>
            <div class="kpi"><h4>Local Redirect</h4><p>${readiness.localRedirect ? 'Yes' : 'No'}</p></div>
            <div class="kpi"><h4>Redirect Host</h4><p>${rowOrDash(readiness.redirectHost)}</p></div>
          </div>
          <div class="notice ${productionMode && !readiness.oauthConnectReady ? 'error' : 'success'}">
            ${productionMode
              ? (readiness.oauthConnectReady
                ? 'Production mode is configured correctly for OAuth.'
                : 'Production mode is selected, but this deployment is not yet valid for live QuickBooks OAuth.')
              : 'Current mode is sandbox. Sandbox is valid for localhost; production is not.'}
          </div>
          ${blockers.length ? `
            <ul class="list-plain">
              ${blockers.map((item) => `<li>${item}</li>`).join('')}
            </ul>
          ` : ''}
          <p class="small">To connect production QBO, deploy the app over HTTPS, set <code>APP_BASE_URL</code> and <code>QBO_REDIRECT_URI</code> to that domain, register the same redirect URI in Intuit production app settings, restart the server, then reconnect.</p>
        </div>
      </section>
    </div>

    <section class="card section-block" id="qbo-pull">
      <div class="card-head"><h3>Pull Summary</h3><span class="small">Last completed sync</span></div>
      <div class="card-body">
        <div class="kpi-grid">
          <div class="kpi"><h4>Customers</h4><p>${rowOrDash(pull.customers?.upserted)}</p></div>
          <div class="kpi"><h4>Accounts</h4><p>${rowOrDash(pull.accounts?.upserted)}</p></div>
          <div class="kpi"><h4>Invoices</h4><p>${rowOrDash(pull.invoices?.upserted)}</p></div>
          <div class="kpi"><h4>Payments</h4><p>${rowOrDash(pull.payments?.upserted)}</p></div>
        </div>
        <div class="small">Pulled At: ${rowOrDash(pull.pulledAt)}</div>
        <div class="small">Transactions: ${rowOrDash(pull.transactions?.upserted)}</div>
        <div class="small">Checklist: ${checklist ? `<span class="badge ${checklist.pass ? 'ok' : 'danger'}">${checklist.pass ? 'PASS' : 'FAIL'}</span>` : '-'}</div>
        ${(pull.errors && pull.errors.length) ? `<div class="notice error">Errors: ${pull.errors.map((e) => `${e.entity}: ${e.message}`).join(' | ')}</div>` : '<div class="notice success">No pull errors.</div>'}
      </div>
    </section>

    <section class="card section-block" id="qbo-checklist">
      <div class="card-head"><h3>Sync Field Checklist</h3><span class="small">Pass/fail validation from latest pull</span></div>
      <div class="card-body">
        ${checklist ? `
          <div class="kpi-grid">
            <div class="kpi"><h4>Overall</h4><p>${checklist.pass ? 'PASS' : 'FAIL'}</p></div>
            <div class="kpi"><h4>Checks</h4><p>${checklist.itemCount}</p></div>
            <div class="kpi"><h4>Fails</h4><p>${checklist.failCount}</p></div>
            <div class="kpi"><h4>Warnings</h4><p>${checklist.warnCount}</p></div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                ${(checklist.items || []).map((item) => `
                  <tr>
                    <td>${item.title}</td>
                    <td><span class="badge ${item.status === 'PASS' ? 'ok' : item.status === 'WARN' ? 'warn' : 'danger'}">${item.status}</span></td>
                    <td>${item.detail}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="small">Run a full pull to generate checklist.</p>'}
      </div>
    </section>

    <section class="card section-block" id="qbo-lineage">
      <div class="card-head"><h3>Transaction Object Coverage</h3><span class="small">Fetched vs imported by object type</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Object</th><th>Fetched</th><th>Imported</th><th>Status</th></tr></thead>
            <tbody>
              ${Object.entries(objectCoverage).map(([name, meta]) => `
                <tr>
                  <td>${name}</td>
                  <td>${meta?.fetched ?? 0}</td>
                  <td>${meta?.upserted ?? 0}</td>
                  <td><span class="badge ${(meta?.fetched || 0) === 0 || (meta?.upserted || 0) > 0 ? 'ok' : 'danger'}">${(meta?.fetched || 0) === 0 ? 'N/A' : (meta?.upserted || 0) > 0 ? 'OK' : 'MISSING'}</span></td>
                </tr>
              `).join('') || '<tr><td colspan="4" class="muted">No object coverage data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card section-block">
      <div class="card-head"><h3>Transaction Lineage Snapshot</h3><span class="small">Where ERP transaction data is coming from</span></div>
      <div class="card-body">
        <div class="kpi-grid">
          <div class="kpi"><h4>QBO Rows</h4><p>${rowOrDash(lineage.summary?.rowCount)}</p></div>
          <div class="kpi"><h4>Source Linked</h4><p>${rowOrDash(lineage.summary?.sourceLinkedRows)}</p></div>
          <div class="kpi"><h4>Lineage %</h4><p>${rowOrDash(lineage.summary?.sourceLinkedPct)}%</p></div>
          <div class="kpi"><h4>Returned</h4><p>${rowOrDash(lineage.summary?.returnedRows)}</p></div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Object</th><th>Rows</th><th>Inflows</th><th>Outflows</th></tr></thead>
            <tbody>
              ${(lineage.byObject || []).map((row) => `
                <tr>
                  <td>${row.objectType}</td>
                  <td>${row.count}</td>
                  <td>${money(row.inflow, state.reports.qboRevenueByLos?.reportingCurrency || 'USD')}</td>
                  <td>${money(row.outflow, state.reports.qboRevenueByLos?.reportingCurrency || 'USD')}</td>
                </tr>
              `).join('') || '<tr><td colspan="4" class="muted">No lineage data loaded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card section-block" id="qbo-logs">
      <div class="card-head"><h3>Sync Logs</h3><span class="small">Push + pull diagnostics</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Status</th><th>Error</th></tr></thead>
            <tbody>
              ${(qbo.syncLogs || []).slice(0, 80).map((log) => `
                <tr>
                  <td>${log.createdAt}</td>
                  <td>${log.direction}/${log.action}</td>
                  <td>${log.entityType}:${log.entityId || '-'}</td>
                  <td><span class="badge ${badgeClass(log.status)}">${log.status}</span></td>
                  <td>${rowOrDash(log.errorMessage)}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="muted">No sync logs.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function taggingView() {
  const invoices = qboInvoices();
  const draft = state.taggingDraft;
  const selected = invoices.find((row) => row.id === draft.invoiceId) || null;
  const queues = classificationQueues();
  const txDraft = state.transactionDraft || defaultTransactionDraft();
  const txSelected = transactionById(txDraft.transactionId);
  const categoryOptions = state.bootstrap?.categories || state.financeModel?.dimensions?.categories || ['Operating Expense', 'Revenue', 'Partner Draw - Asnan', 'Capex', 'Cash Inflow', 'Cash Outflow', 'Unclassified'];
  const rules = (state.bootstrap?.classificationRules || []).slice(0, 12);
  const nav = sectionNav([
    { id: 'class-invoices', label: 'Invoice Tags' },
    { id: 'class-transactions', label: 'Transaction Review' },
    { id: 'class-rules', label: 'Rules' },
    { id: 'class-review', label: 'Review Queues' },
    { id: 'class-register', label: 'Invoice Register' }
  ]);

  return `
    <section class="hero-panel hero-panel--source">
      <div class="hero-copy">
        <div class="eyebrow">Reporting Integrity</div>
        <h2>Classification Workspace</h2>
        <p>Use this screen to protect management reporting. Tag invoices for LOS, review partner-draw and capex candidates, and fix transaction rows before they distort revenue, treasury, or operating expense views.</p>
        <div class="hero-actions">
          <button class="action-btn primary" data-tab="ledger">Open Transaction Monitor</button>
          <button class="action-btn" data-tab="reports">Open Reports</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Untagged invoices</span>
          <strong>${queues.invoiceUntagged.length}</strong>
        </div>
        <div class="hero-stat">
          <span>Unclassified transactions</span>
          <strong>${queues.unclassifiedTransactions.length}</strong>
        </div>
        <div class="hero-stat">
          <span>Partner review queue</span>
          <strong>${queues.partnerReview.length}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <div class="grid-2">
      <section class="card section-block" id="class-invoices">
        <div class="card-head"><h3>Invoice Tagging Console</h3><span class="small">Set LOS and reporting dimensions for QBO invoices</span></div>
        <div class="card-body">
          <div class="inline">
            <select id="tag_invoice" class="field">
              <option value="">Select QBO Invoice</option>
              ${queues.invoiceUntagged.concat(invoices.filter((row) => row.lineOfService).slice(0, 50)).slice(0, 1200).map((row) => `<option value="${row.id}" ${draft.invoiceId === row.id ? 'selected' : ''}>${row.invoiceNumber} | ${row.clientName || '-'} | ${row.issueDate}</option>`).join('')}
            </select>
            <select id="tag_los" class="field">
              <option value="">Line of Service</option>
              <option value="TRDEV" ${draft.lineOfService === 'TRDEV' ? 'selected' : ''}>TRDEV</option>
              <option value="TRFINANCE" ${draft.lineOfService === 'TRFINANCE' ? 'selected' : ''}>TRFINANCE</option>
              <option value="TRBUILD" ${draft.lineOfService === 'TRBUILD' ? 'selected' : ''}>TRBUILD</option>
            </select>
            <select id="tag_entity" class="field">
              <option value="">Entity</option>
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${draft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
            <input id="tag_channel" class="field" placeholder="Channel (UPWORK)" value="${draft.channel || ''}" />
          </div>
          <div class="inline">
            <input id="tag_bu" class="field" placeholder="Business Unit (SERVICES/PONCHO)" value="${draft.businessUnit || ''}" />
            <input id="tag_notes" class="field" placeholder="Internal notes" value="${draft.notes || ''}" />
            <button class="btn btn-primary" id="saveTagsBtn" ${!canManageFinance() ? 'disabled' : ''}>Save Tags</button>
          </div>
          ${!canManageFinance() ? '<p class="small">Tag updates require Admin/Accountant role.</p>' : ''}
          ${selected ? `<div class="notice success">Selected: ${selected.invoiceNumber} | ${selected.clientName || '-'} | ${money(selected.total, selected.currency)}</div>` : '<p class="small">Select an invoice to tag.</p>'}
        </div>
      </section>

      <section class="card section-block" id="class-transactions">
        <div class="card-head"><h3>Transaction Review Console</h3><span class="small">Fix category, partner draw, capex, treasury, and entity tags</span></div>
        <div class="card-body">
          <div class="inline">
            <select id="tx_review_id" class="field">
              <option value="">Select transaction</option>
              ${[...queues.unclassifiedTransactions, ...queues.partnerReview, ...queues.capexReview].slice(0, 500).map((row) => `<option value="${row.id}" ${txDraft.transactionId === row.id ? 'selected' : ''}>${row.id} | ${row.date} | ${row.description}</option>`).join('')}
            </select>
            <select id="tx_category" class="field">
              <option value="">Category</option>
              ${categoryOptions.map((value) => `<option value="${value}" ${txDraft.category === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
            <select id="tx_los" class="field">
              <option value="">No LOS</option>
              <option value="TRDEV" ${txDraft.lineOfService === 'TRDEV' ? 'selected' : ''}>TRDEV</option>
              <option value="TRFINANCE" ${txDraft.lineOfService === 'TRFINANCE' ? 'selected' : ''}>TRFINANCE</option>
              <option value="TRBUILD" ${txDraft.lineOfService === 'TRBUILD' ? 'selected' : ''}>TRBUILD</option>
            </select>
            <select id="tx_entity" class="field">
              <option value="">Entity</option>
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${txDraft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
          </div>
          <div class="inline">
            <input id="tx_business_unit" class="field" placeholder="Business Unit" value="${txDraft.businessUnit || ''}" />
            <input id="tx_channel" class="field" placeholder="Channel" value="${txDraft.channel || ''}" />
            <input id="tx_partner" class="field" placeholder="Partner Tag" value="${txDraft.partnerTag || ''}" />
            <label class="small"><input id="tx_reimbursable" type="checkbox" ${txDraft.reimbursable ? 'checked' : ''} /> Reimbursable</label>
          </div>
          <div class="action-row">
            <label class="small"><input id="tx_treasury_flag" type="checkbox" ${txDraft.treasuryFlag ? 'checked' : ''} /> Treasury</label>
            <label class="small"><input id="tx_intercompany_flag" type="checkbox" ${txDraft.intercompanyFlag ? 'checked' : ''} /> Intercompany</label>
            <label class="small"><input id="tx_capex_flag" type="checkbox" ${txDraft.capexFlag ? 'checked' : ''} /> Capex</label>
            <button class="btn btn-primary" id="saveTransactionClassificationBtn" ${!canManageFinance() ? 'disabled' : ''}>Save Transaction</button>
            <button class="action-btn" id="autoClassifyTransactionBtn" ${!canManageFinance() ? 'disabled' : ''}>Auto-Classify</button>
          </div>
          ${txSelected ? `<div class="notice success">Selected: ${txSelected.id} | ${txSelected.account} | ${money(txSelected.amount, txSelected.currency)} | ${txSelected.description}</div>` : '<p class="small">Select a transaction row from a review queue.</p>'}
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card section-block">
        <div class="card-head"><h3>Untagged Invoices</h3><span class="small">Priority queue for LOS reporting</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Entity</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                ${queues.invoiceUntagged.slice(0, 300).map((row) => `
                  <tr data-tag-row="${row.id}">
                    <td>${row.invoiceNumber}</td>
                    <td>${row.clientName || '-'}</td>
                    <td>${row.issueDate}</td>
                    <td>${rowOrDash(row.entity)}</td>
                    <td>${money(row.total, row.currency)}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No untagged invoices.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="class-rules">
        <div class="card-head"><h3>Classification Rules</h3><span class="small">Pattern-based defaults for imported transactions</span></div>
        <div class="card-body">
          <div class="inline">
            <input id="rule_pattern" class="field" placeholder="Pattern (e.g. chase, upwork, meezan)" value="${state.ruleDraft.pattern || ''}" />
            <input id="rule_category" class="field" placeholder="Category" value="${state.ruleDraft.category || ''}" />
            <button class="btn btn-primary" id="createClassificationRuleBtn" ${!canManageFinance() ? 'disabled' : ''}>Create Rule</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Pattern</th><th>Category</th><th>Created</th></tr></thead>
              <tbody>
                ${rules.map((row) => `
                  <tr>
                    <td>${row.pattern}</td>
                    <td>${row.category}</td>
                    <td>${row.createdAt}</td>
                  </tr>
                `).join('') || '<tr><td colspan="3" class="muted">No classification rules configured.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="class-review">
      <section class="card">
        <div class="card-head"><h3>Partner Draw Review</h3><span class="small">Chase and related-party items requiring management treatment</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Category</th><th>Partner</th><th>Amount</th></tr></thead>
              <tbody>
                ${queues.partnerReview.slice(0, 300).map((row) => `
                  <tr data-tx-review="${row.id}">
                    <td>${row.date}</td>
                    <td>${row.account}</td>
                    <td>${row.description}</td>
                    <td>${rowOrDash(row.category)}</td>
                    <td>${rowOrDash(row.partnerTag)}</td>
                    <td>${money(row.amount, row.currency)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No partner review rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Capex + Treasury Review</h3><span class="small">Rows that can distort operating P&amp;L if left unreviewed</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Flags</th><th>Amount</th></tr></thead>
              <tbody>
                ${[...queues.capexReview, ...queues.treasuryReview].slice(0, 300).map((row) => `
                  <tr data-tx-review="${row.id}">
                    <td>${row.date}</td>
                    <td>${row.description}</td>
                    <td>${rowOrDash(row.category)}</td>
                    <td>${[
                      row.capexFlag ? 'CAPEX' : null,
                      row.treasuryFlag ? 'TREASURY' : null,
                      row.intercompanyFlag ? 'INTERCO' : null
                    ].filter(Boolean).join(' / ') || '-'}</td>
                    <td>${money(row.amount, row.currency)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No capex or treasury review rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <section class="card section-block" id="class-register">
      <div class="card-head"><h3>Searchable Invoice Tag Table</h3><span class="small">Full invoice tagging reference</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Entity</th><th>LOS</th><th>BU</th><th>Channel</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              ${invoices.slice(0, 1000).map((row) => `
                <tr data-tag-row="${row.id}">
                  <td>${row.invoiceNumber}</td>
                  <td>${row.clientName || '-'}</td>
                  <td>${row.issueDate}</td>
                  <td>${rowOrDash(row.entity)}</td>
                  <td><span class="badge ${row.lineOfService ? 'ok' : 'warn'}">${row.lineOfService || 'UNTAGGED'}</span></td>
                  <td>${rowOrDash(row.businessUnit)}</td>
                  <td>${rowOrDash(row.channel)}</td>
                  <td>${money(row.total, row.currency)}</td>
                  <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                </tr>
              `).join('') || '<tr><td colspan="9" class="muted">No QBO invoices found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function architectureView() {
  const workflows = architectureWorkflowRows();
  const lineage = state.qboLineage || {};
  const qbo = state.qboStatus || {};

  return `
    <section class="card">
      <div class="card-head"><h3>Finance Workflow Architecture</h3><span class="small">Operating design and status checks</span></div>
      <div class="card-body">
        <div class="kpi-grid">
          <div class="kpi"><h4>QBO Connected</h4><p>${qbo.connected ? 'YES' : 'NO'}</p></div>
          <div class="kpi"><h4>Last Pull</h4><p>${rowOrDash(qbo.lastPullAt)}</p></div>
          <div class="kpi"><h4>QBO Tx Rows</h4><p>${rowOrDash(lineage.summary?.rowCount)}</p></div>
          <div class="kpi"><h4>Lineage Linked</h4><p>${rowOrDash(lineage.summary?.sourceLinkedPct)}%</p></div>
        </div>
        <p class="small">Data flow: QuickBooks source objects -> ERP normalized transaction rows -> invoice/tagging enrichment -> management consolidation -> LOS/treasury/partner reporting.</p>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Workflow Gate Matrix</h3><span class="small">PASS/WARN/FAIL by critical workflow</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Workflow</th><th>Status</th><th>Purpose</th><th>Metric</th><th>Output</th></tr></thead>
            <tbody>
              ${workflows.map((row) => `
                <tr>
                  <td>${row.workflow}</td>
                  <td><span class="badge ${row.status === 'PASS' ? 'ok' : row.status === 'WARN' ? 'warn' : 'danger'}">${row.status}</span></td>
                  <td>${row.purpose}</td>
                  <td>${row.metric}</td>
                  <td>${row.output}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Source Systems</h3><span class="small">Current ERP source footprint</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Source</th><th>Rows</th><th>Inflows</th><th>Outflows</th></tr></thead>
              <tbody>
                ${(lineage.bySource || []).map((row) => `
                  <tr>
                    <td>${row.source}</td>
                    <td>${row.count}</td>
                    <td>${money(row.inflow)}</td>
                    <td>${money(row.outflow)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No source rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Field Completeness</h3><span class="small">Transaction-level required fields</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Field</th><th>Present</th><th>Missing</th><th>Completeness</th></tr></thead>
              <tbody>
                ${(lineage.fieldCoverage || []).map((row) => `
                  <tr>
                    <td>${row.field}</td>
                    <td>${row.present}</td>
                    <td>${row.missing}</td>
                    <td><span class="badge ${row.missing === 0 ? 'ok' : row.completenessPct >= 95 ? 'warn' : 'danger'}">${row.completenessPct}%</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No field coverage data.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function billingView() {
  const draft = state.billingDraft || {};
  const clients = state.bootstrap?.clients || [];
  const projects = state.bootstrap?.projects || [];
  const invoices = [...(state.invoices || [])];
  invoices.sort((a, b) => String(b.issueDate || b.createdAt || '').localeCompare(String(a.issueDate || a.createdAt || '')));
  const search = String(state.searchQuery || '').toLowerCase();
  const filtered = invoices.filter((row) => {
    const hay = `${row.invoiceNumber || ''} ${row.clientName || ''} ${row.status || ''} ${row.entity || ''} ${row.currency || ''} ${row.businessUnit || ''} ${row.lineOfService || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });
  const byClient = clientBillingAnalytics(filtered).slice(0, 200);
  const openAr = filtered.reduce((sum, row) => sum + Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0), 0);
  const draftCount = filtered.filter((row) => row.status === 'DRAFT').length;
  const pendingCount = filtered.filter((row) => row.status === 'PENDING_APPROVAL').length;
  const sentCount = filtered.filter((row) => row.status === 'SENT').length;
  const overdueCount = filtered.filter((row) => row.status === 'OVERDUE').length;
  const partialCount = filtered.filter((row) => row.status === 'PARTIAL').length;
  const paidCount = filtered.filter((row) => row.status === 'PAID').length;
  const recon = state.reconciliation || {};
  const summary = recon.summary || {};
  const collections = collectionsQueueRows();
  const reportingCurrency = state.reports.qboRevenueByLos?.reportingCurrency || filtered[0]?.currency || 'USD';
  const totalBilled = filtered.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalCollected = filtered.reduce((sum, row) => sum + Number(row.amountPaid || 0), 0);
  const overdueAmount = collections
    .filter((row) => String(row.status || '').toUpperCase() === 'OVERDUE')
    .reduce((sum, row) => sum + Number(row.outstanding || 0), 0);
  const avgCollectionPct = byClient.length
    ? Math.round(byClient.reduce((sum, row) => sum + Number(row.collectionPct || 0), 0) / byClient.length)
    : 0;
  const topClient = byClient[0] || null;
  const lifecycleRows = filtered.slice(0, 900);
  const clientRows = byClient.slice(0, 150);
  const draftSubtotal = Number(draft.qty || 0) * Number(draft.rate || 0);
  const draftTax = draftSubtotal * Number(draft.taxRate || 0);
  const draftTotal = draftSubtotal + draftTax;
  const stageRows = [
    { key: 'DRAFT', label: 'Draft', count: draftCount, amount: filtered.filter((row) => row.status === 'DRAFT').reduce((sum, row) => sum + Number(row.total || 0), 0), note: 'Needs submission' },
    { key: 'PENDING_APPROVAL', label: 'Approval', count: pendingCount, amount: filtered.filter((row) => row.status === 'PENDING_APPROVAL').reduce((sum, row) => sum + Number(row.total || 0), 0), note: 'Awaiting sign-off' },
    { key: 'SENT', label: 'Sent', count: sentCount, amount: filtered.filter((row) => row.status === 'SENT').reduce((sum, row) => sum + Number(row.total || 0), 0), note: 'Waiting on payment' },
    { key: 'OVERDUE', label: 'Overdue', count: overdueCount, amount: overdueAmount, note: 'Escalate collection' },
    { key: 'PARTIAL', label: 'Partial', count: partialCount, amount: filtered.filter((row) => row.status === 'PARTIAL').reduce((sum, row) => sum + Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0), 0), note: 'Outstanding balance' },
    { key: 'PAID', label: 'Paid', count: paidCount, amount: filtered.filter((row) => row.status === 'PAID').reduce((sum, row) => sum + Number(row.amountPaid || 0), 0), note: 'Collected fully' }
  ];
  const nav = sectionNav([
    { id: 'billing-create-form', label: 'Create Invoice' },
    { id: 'billing-pipeline', label: 'Pipeline' },
    { id: 'billing-register', label: 'Invoice Register' },
    { id: 'billing-collections', label: 'Collections' },
    { id: 'billing-reconciliation', label: 'Reconciliation' },
    { id: 'billing-analytics', label: 'Client Analytics' }
  ]);

  return `
    <section class="hero-panel hero-panel--control">
      <div class="hero-copy">
        <div class="eyebrow">Revenue Operations</div>
        <h2>Client Billing</h2>
        <p>Own the full billing lifecycle here: invoice creation, approvals, sending, payment posting, QBO sync, and collections follow-up.</p>
        <div class="hero-actions">
          <button class="action-btn primary" id="exportInvoiceRegisterBtn">Export Invoice Register</button>
          <button class="action-btn" id="exportClientArBtn">Export Client AR</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Open AR</span>
          <strong>${money(openAr, state.reports.qboRevenueByLos?.reportingCurrency || 'USD')}</strong>
        </div>
        <div class="hero-stat">
          <span>Overdue invoices</span>
          <strong>${overdueCount}</strong>
        </div>
        <div class="hero-stat">
          <span>Unmatched receipts</span>
          <strong>${rowOrDash(summary.unmatchedTransactionCount)}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="billing-overview">
      <article class="insight-card">
        <span class="eyebrow">Period billed</span>
        <strong>${money(totalBilled, reportingCurrency)}</strong>
        <p>${filtered.length} invoices in scope</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Cash collected</span>
        <strong>${money(totalCollected, reportingCurrency)}</strong>
        <p>${money(openAr, reportingCurrency)} still outstanding</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Collection health</span>
        <strong>${avgCollectionPct}%</strong>
        <p>${overdueCount} overdue invoices | ${money(overdueAmount, reportingCurrency)} overdue amount</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Top client</span>
        <strong>${topClient ? topClient.client : 'No billing data'}</strong>
        <p>${topClient ? `${money(topClient.totalBilled, reportingCurrency)} billed | ${topClient.overdueCount} overdue` : 'Create or sync invoices to populate analytics'}</p>
      </article>
    </section>

    <section class="status-rail section-block" id="billing-pipeline">
      ${stageRows.map((row) => `
        <article class="status-card">
          <div class="status-card__top">
            <span class="eyebrow">${row.label}</span>
            <span class="badge ${row.count === 0 ? 'info' : row.key === 'OVERDUE' ? 'danger' : row.key === 'PAID' ? 'ok' : 'warn'}">${row.count}</span>
          </div>
          <strong>${money(row.amount, reportingCurrency)}</strong>
          <p>${row.note}</p>
        </article>
      `).join('')}
    </section>

    <section class="card section-block" id="billing-create-form">
      <div class="card-head"><h3>Invoice Composer</h3><span class="small">Build a client invoice with commercial and reporting tags in one place</span></div>
      <div class="card-body">
        <div class="composer-grid">
          <div class="form-panel">
            <div class="field-grid-4">
              <div class="field-stack">
                <label for="bill_project">Project</label>
                <select id="bill_project" class="field">
                  <option value="">No Project</option>
                  ${projects.map((row) => `<option value="${row.id}" ${draft.projectId === row.id ? 'selected' : ''}>${row.code || row.id} | ${row.name}</option>`).join('')}
                </select>
              </div>
              <div class="field-stack">
                <label for="bill_client">Existing Client</label>
                <select id="bill_client" class="field">
                  <option value="">Select Client</option>
                  ${clients.map((row) => `<option value="${row.id}" ${draft.clientId === row.id ? 'selected' : ''}>${row.name}</option>`).join('')}
                </select>
              </div>
              <div class="field-stack">
                <label for="bill_client_name">Manual Client Name</label>
                <input id="bill_client_name" class="field" placeholder="Client name" value="${draft.clientName || ''}" />
              </div>
              <div class="field-stack">
                <label for="bill_issue_date">Issue Date</label>
                <input id="bill_issue_date" class="field" type="date" value="${draft.issueDate || ''}" />
              </div>
            </div>

            <div class="field-grid-4">
              <div class="field-stack">
                <label for="bill_due_date">Due Date</label>
                <input id="bill_due_date" class="field" type="date" value="${draft.dueDate || ''}" />
              </div>
              <div class="field-stack">
                <label for="bill_currency">Currency</label>
                <select id="bill_currency" class="field">
                  <option value="USD" ${draft.currency === 'USD' ? 'selected' : ''}>USD</option>
                  <option value="GBP" ${draft.currency === 'GBP' ? 'selected' : ''}>GBP</option>
                  <option value="PKR" ${draft.currency === 'PKR' ? 'selected' : ''}>PKR</option>
                </select>
              </div>
              <div class="field-stack">
                <label for="bill_entity">Entity</label>
                <select id="bill_entity" class="field">
                  ${getEntityOptions().map((entity) => `<option value="${entity}" ${draft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
                </select>
              </div>
              <div class="field-stack">
                <label for="bill_los">Line of Service</label>
                <select id="bill_los" class="field">
                  <option value="">No LOS</option>
                  <option value="TRDEV" ${draft.lineOfService === 'TRDEV' ? 'selected' : ''}>TRDEV</option>
                  <option value="TRFINANCE" ${draft.lineOfService === 'TRFINANCE' ? 'selected' : ''}>TRFINANCE</option>
                  <option value="TRBUILD" ${draft.lineOfService === 'TRBUILD' ? 'selected' : ''}>TRBUILD</option>
                </select>
              </div>
            </div>

            <div class="field-grid-4">
              <div class="field-stack">
                <label for="bill_description">Line Description</label>
                <input id="bill_description" class="field" placeholder="Advisory retainer - March" value="${draft.description || ''}" />
              </div>
              <div class="field-stack">
                <label for="bill_qty">Quantity</label>
                <input id="bill_qty" class="field" type="number" min="0" step="0.01" placeholder="Qty" value="${draft.qty || 1}" />
              </div>
              <div class="field-stack">
                <label for="bill_rate">Rate</label>
                <input id="bill_rate" class="field" type="number" min="0" step="0.01" placeholder="Rate" value="${draft.rate || ''}" />
              </div>
              <div class="field-stack">
                <label for="bill_tax_rate">Tax Rate</label>
                <input id="bill_tax_rate" class="field" type="number" min="0" step="0.01" placeholder="0.1 = 10%" value="${draft.taxRate || 0}" />
              </div>
            </div>

            <div class="field-grid-3">
              <div class="field-stack">
                <label for="bill_bu">Business Unit</label>
                <select id="bill_bu" class="field">
                  ${(state.financeModel?.dimensions?.businessUnits || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER']).map((value) => `<option value="${value}" ${draft.businessUnit === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
              </div>
              <div class="field-stack">
                <label for="bill_channel">Channel</label>
                <input id="bill_channel" class="field" placeholder="UPWORK / DIRECT" value="${draft.channel || ''}" />
              </div>
              <div class="field-stack">
                <label for="bill_notes">Internal Notes</label>
                <input id="bill_notes" class="field" placeholder="Narrative or ops note" value="${draft.notes || ''}" />
              </div>
            </div>
          </div>

          <aside class="summary-panel">
            <div class="summary-panel__head">
              <span class="eyebrow">Draft Preview</span>
              <strong>${money(draftTotal, draft.currency || 'USD')}</strong>
            </div>
            <div class="summary-list">
              <div class="summary-row"><span>Subtotal</span><strong>${money(draftSubtotal, draft.currency || 'USD')}</strong></div>
              <div class="summary-row"><span>Tax</span><strong>${money(draftTax, draft.currency || 'USD')}</strong></div>
              <div class="summary-row"><span>Total</span><strong>${money(draftTotal, draft.currency || 'USD')}</strong></div>
            </div>
            <div class="note-band">
              <strong>Billing workflow</strong>
              <p>Create -> Submit -> Approve -> Send -> Record payment -> QBO sync.</p>
            </div>
            <div class="note-band">
              <strong>Controls</strong>
              <p>Use LOS, entity, business unit, and channel tags here so billing and reporting stay aligned from the start.</p>
            </div>
            <button class="btn btn-primary" id="createInvoiceBtn" ${!canCreateInvoices() ? 'disabled' : ''}>Create Invoice</button>
            ${!canCreateInvoices() ? '<p class="small">Invoice creation requires Admin or Accountant role.</p>' : ''}
          </aside>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="billing-register">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Primary Register</span>
          <h3>Invoice Register</h3>
        </div>
        <div class="table-meta">${lifecycleRows.length} invoices | Search uses the global bar</div>
      </div>
      <div class="table-shell__toolbar">
        <div class="table-metrics">
          <span class="metric-chip">Open AR ${money(openAr, reportingCurrency)}</span>
          <span class="metric-chip">Pending approval ${pendingCount}</span>
          <span class="metric-chip">Overdue ${overdueCount}</span>
        </div>
        <div class="table-actions">
          <button class="action-btn" id="exportInvoiceRegisterBtnSecondary">Export Register</button>
        </div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table table-billing">
            <thead><tr><th>Invoice</th><th>Client</th><th>Issue</th><th>Due</th><th>Entity</th><th>LOS</th><th>Status</th><th>Total</th><th>Collected</th><th>Outstanding</th><th>Actions</th></tr></thead>
            <tbody>
              ${lifecycleRows.map((row) => {
                const outstanding = Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0);
                const submitBtn = (['DRAFT', 'REJECTED'].includes(String(row.status || '').toUpperCase()) && canCreateInvoices())
                  ? `<button class="action-btn" data-invoice-submit="${row.id}">Submit</button>` : '';
                const approveBtn = (String(row.status || '').toUpperCase() === 'PENDING_APPROVAL' && canApproveInvoices())
                  ? `<button class="action-btn primary" data-invoice-approve="${row.id}">Approve</button>` : '';
                const rejectBtn = (String(row.status || '').toUpperCase() === 'PENDING_APPROVAL' && canApproveInvoices())
                  ? `<button class="action-btn" data-invoice-reject="${row.id}">Reject</button>` : '';
                const sendBtn = (['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(String(row.status || '').toUpperCase()) && canApproveInvoices())
                  ? `<button class="action-btn" data-invoice-send="${row.id}">Send</button>` : '';
                const payBtn = (outstanding > 0 && canApproveInvoices())
                  ? `<button class="action-btn" data-invoice-pay="${row.id}" data-outstanding="${outstanding}">Record Payment</button>` : '';
                const syncBtn = canApproveInvoices()
                  ? `<button class="action-btn" data-invoice-sync="${row.id}">QBO Sync</button>` : '';
                return `
                  <tr>
                    <td>
                      <strong>${row.invoiceNumber}</strong>
                      <div class="small">${row.businessUnit || 'No BU'} | ${row.channel || 'No channel'}</div>
                    </td>
                    <td>${row.clientName || '-'}</td>
                    <td>${row.issueDate || '-'}</td>
                    <td>${rowOrDash(row.dueDate)}</td>
                    <td>${rowOrDash(row.entity)}</td>
                    <td>${row.lineOfService ? `<span class="badge ok">${row.lineOfService}</span>` : '<span class="badge warn">UNTAGGED</span>'}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                    <td>${money(row.total, row.currency)}</td>
                    <td>${money(row.amountPaid, row.currency)}</td>
                    <td>${money(outstanding, row.currency)}</td>
                    <td class="table-action-stack">
                      <button class="action-btn" data-invoice-preview="${row.id}">Preview</button>
                      ${submitBtn}
                      ${approveBtn}
                      ${rejectBtn}
                      ${sendBtn}
                      ${payBtn}
                      ${syncBtn}
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="11" class="muted">No invoices available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="billing-collections">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Collections</span>
          <h3>Receivables Follow-up Queue</h3>
        </div>
        <div class="table-meta">${collections.length} open items</div>
      </div>
      <div class="table-shell__toolbar">
        <div class="table-metrics">
          <span class="metric-chip">Overdue ${overdueCount}</span>
          <span class="metric-chip">Overdue amount ${money(overdueAmount, reportingCurrency)}</span>
          <span class="metric-chip">Average collection ${avgCollectionPct}%</span>
        </div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Invoice</th><th>Client</th><th>Due Date</th><th>Status</th><th>Outstanding</th><th>Next Step</th></tr></thead>
            <tbody>
              ${collections.slice(0, 200).map((row) => `
                <tr>
                  <td><strong>${row.invoiceNumber}</strong></td>
                  <td>${row.clientName || '-'}</td>
                  <td>${rowOrDash(row.dueDate)}</td>
                  <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  <td>${money(row.outstanding, row.currency)}</td>
                  <td>${String(row.status || '').toUpperCase() === 'OVERDUE' ? 'Escalate collection' : 'Monitor expected receipt'}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="muted">No open collections queue.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="billing-reconciliation">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Cash Matching</span>
          <h3>Billing Reconciliation</h3>
        </div>
        <div class="table-meta">Link open AR to incoming cash receipts</div>
      </div>
      <div class="table-shell__toolbar">
        <div class="table-metrics">
          <span class="metric-chip">Open invoices ${rowOrDash(summary.openInvoiceCount)}</span>
          <span class="metric-chip">Unmatched receipts ${rowOrDash(summary.unmatchedTransactionCount)}</span>
          <span class="metric-chip">Suggestions ${rowOrDash(summary.suggestedMatches)}</span>
        </div>
        <div class="table-actions">
          <button class="action-btn primary" id="runAutoMatchBtn" ${!canManageFinance() ? 'disabled' : ''}>Run Auto-Match</button>
        </div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Transaction</th><th>Amount</th><th>Currency</th><th>Top Suggestions</th></tr></thead>
            <tbody>
              ${(recon.suggestions || []).slice(0, 200).map((row) => `
                <tr>
                  <td>${row.transactionId}</td>
                  <td>${money(row.amount, row.currency)}</td>
                  <td>${row.currency}</td>
                  <td>${(row.candidates || []).map((c) => `${c.invoiceNumber} (${money(c.outstanding, row.currency)})`).join(' | ') || '-'}</td>
                </tr>
              `).join('') || '<tr><td colspan="4" class="muted">No suggestions.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="billing-analytics">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Analytics</span>
          <h3>Client Billing Analytics</h3>
        </div>
        <div class="table-meta">Uniform analytics view for billed value, collections, and risk</div>
      </div>
      <div class="table-shell__toolbar">
        <div class="table-metrics">
          <span class="metric-chip">Top client ${topClient ? topClient.client : 'N/A'}</span>
          <span class="metric-chip">Collected ${money(totalCollected, reportingCurrency)}</span>
          <span class="metric-chip">Open AR ${money(openAr, reportingCurrency)}</span>
        </div>
        <div class="table-actions">
          <button class="action-btn" id="exportClientArBtnSecondary">Export Client AR</button>
        </div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Client</th><th>Invoices</th><th>Billed</th><th>Collected</th><th>Outstanding</th><th>Collection %</th><th>Overdue</th></tr></thead>
            <tbody>
              ${clientRows.map((row) => `
                <tr>
                  <td><strong>${row.client}</strong></td>
                  <td>${row.invoiceCount}</td>
                  <td>${money(row.totalBilled, reportingCurrency)}</td>
                  <td>${money(row.totalCollected, reportingCurrency)}</td>
                  <td>${money(row.outstanding, reportingCurrency)}</td>
                  <td><span class="badge ${row.collectionPct >= 90 ? 'ok' : row.collectionPct >= 70 ? 'warn' : 'danger'}">${row.collectionPct}%</span></td>
                  <td>${row.overdueCount}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="muted">No client billing analytics available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function payablesView() {
  const draft = state.billDraft || {};
  const vendors = [...(state.vendors || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const rows = [...(state.payables?.bills || state.vendorBills || [])].sort((a, b) => String(b.billDate || '').localeCompare(String(a.billDate || '')));
  const summary = state.payables?.summary || {};
  const aging = state.payables?.aging || {};
  const byVendor = state.payables?.byVendor || [];
  const search = String(state.searchQuery || '').toLowerCase();
  const filtered = rows.filter((row) => {
    const hay = `${row.billNumber || ''} ${row.vendorName || ''} ${row.status || ''} ${row.entity || ''} ${row.currency || ''} ${row.category || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });
  const nav = sectionNav([
    { id: 'payables-create', label: 'Create Bill' },
    { id: 'payables-queue', label: 'Approval Queue' },
    { id: 'payables-register', label: 'AP Register' },
    { id: 'payables-aging', label: 'Vendor Aging' }
  ]);

  return `
    <section class="hero-panel hero-panel--cash">
      <div class="hero-copy">
        <div class="eyebrow">Vendor Control</div>
        <h2>Payables</h2>
        <p>Run the AP workflow here: create vendor bills, route them for approval, record payment from the correct governed cash rail, and keep outstanding AP visible by vendor and aging bucket.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Open AP</span>
          <strong>${money(summary.totalOutstanding || 0)}</strong>
        </div>
        <div class="hero-stat">
          <span>Pending approval</span>
          <strong>${rowOrDash(summary.pendingApprovalCount)}</strong>
        </div>
        <div class="hero-stat">
          <span>Overdue bills</span>
          <strong>${rowOrDash(summary.overdueCount)}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="billing-overview">
      <article class="insight-card">
        <span class="eyebrow">Approved spend</span>
        <strong>${money(summary.totalApproved || 0)}</strong>
        <p>${rowOrDash(summary.totalBills)} bills in register</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Open AP queue</span>
        <strong>${rowOrDash(summary.openCount)}</strong>
        <p>${money(summary.totalOutstanding || 0)} still outstanding</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Paid this month</span>
        <strong>${money(summary.paidThisMonth || 0)}</strong>
        <p>Cash released from governed rails</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Top vendor exposure</span>
        <strong>${byVendor[0]?.vendor || 'No vendor bills'}</strong>
        <p>${byVendor[0] ? `${money(byVendor[0].outstanding || 0)} outstanding` : 'Create or sync vendor bills to populate AP analytics.'}</p>
      </article>
    </section>

    <section class="card section-block" id="payables-create">
      <div class="card-head"><h3>Vendor Bill Composer</h3><span class="small">Create draft bills with reporting tags before approval and payment</span></div>
      <div class="card-body">
        <div class="field-grid-4">
          <div class="field-stack">
            <label for="bill_vendor_id">Existing Vendor</label>
            <select id="bill_vendor_id" class="field">
              <option value="">Select vendor</option>
              ${vendors.map((row) => `<option value="${row.id}" ${draft.vendorId === row.id ? 'selected' : ''}>${row.name}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="bill_vendor_name">Manual Vendor Name</label>
            <input id="bill_vendor_name" class="field" placeholder="Vendor name" value="${draft.vendorName || ''}" />
          </div>
          <div class="field-stack">
            <label for="bill_number">Bill Number</label>
            <input id="bill_number" class="field" placeholder="AP-2026-001" value="${draft.billNumber || ''}" />
          </div>
          <div class="field-stack">
            <label for="pay_bill_date">Bill Date</label>
            <input id="pay_bill_date" class="field" type="date" value="${draft.billDate || ''}" />
          </div>
        </div>
        <div class="field-grid-4">
          <div class="field-stack">
            <label for="pay_due_date">Due Date</label>
            <input id="pay_due_date" class="field" type="date" value="${draft.dueDate || ''}" />
          </div>
          <div class="field-stack">
            <label for="pay_entity">Entity</label>
            <select id="pay_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${draft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="pay_currency">Currency</label>
            <select id="pay_currency" class="field">
              ${['USD', 'GBP', 'PKR'].map((value) => `<option value="${value}" ${draft.currency === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="pay_total">Amount</label>
            <input id="pay_total" class="field" type="number" min="0" step="0.01" placeholder="0.00" value="${draft.total || ''}" />
          </div>
        </div>
        <div class="field-grid-4">
          <div class="field-stack">
            <label for="pay_category">Category</label>
            <input id="pay_category" class="field" placeholder="Operating Expense" value="${draft.category || 'Operating Expense'}" />
          </div>
          <div class="field-stack">
            <label for="pay_bu">Business Unit</label>
            <select id="pay_bu" class="field">
              ${(state.financeModel?.dimensions?.businessUnits || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER']).map((value) => `<option value="${value}" ${draft.businessUnit === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="pay_los">Line of Service</label>
            <select id="pay_los" class="field">
              <option value="">No LOS</option>
              <option value="TRDEV" ${draft.lineOfService === 'TRDEV' ? 'selected' : ''}>TRDEV</option>
              <option value="TRFINANCE" ${draft.lineOfService === 'TRFINANCE' ? 'selected' : ''}>TRFINANCE</option>
              <option value="TRBUILD" ${draft.lineOfService === 'TRBUILD' ? 'selected' : ''}>TRBUILD</option>
            </select>
          </div>
          <div class="field-stack">
            <label for="pay_description">Description</label>
            <input id="pay_description" class="field" placeholder="Software license / contractor fee / rent" value="${draft.description || ''}" />
          </div>
        </div>
        <div class="field-stack">
          <label for="pay_notes">Notes</label>
          <input id="pay_notes" class="field" placeholder="Approval note or internal explanation" value="${draft.notes || ''}" />
        </div>
        <div class="action-row">
          <button class="btn btn-primary" id="createVendorBillBtn" ${!canManageFinance() ? 'disabled' : ''}>Create Draft Bill</button>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="payables-queue">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Approval Workflow</span>
          <h3>Bill Queue</h3>
        </div>
        <div class="table-meta">${filtered.length} bills in scope</div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Bill</th><th>Vendor</th><th>Entity</th><th>Status</th><th>Total</th><th>Outstanding</th><th>Actions</th></tr></thead>
            <tbody>
              ${filtered.slice(0, 250).map((row) => {
                const submitBtn = String(row.status || '').toUpperCase() === 'DRAFT' && canManageFinance()
                  ? `<button class="action-btn" data-bill-submit="${row.id}">Submit</button>` : '';
                const approveBtn = ['DRAFT', 'PENDING_APPROVAL'].includes(String(row.status || '').toUpperCase()) && canApproveInvoices()
                  ? `<button class="action-btn primary" data-bill-approve="${row.id}">Approve</button>` : '';
                const rejectBtn = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(String(row.status || '').toUpperCase()) && canApproveInvoices()
                  ? `<button class="action-btn" data-bill-reject="${row.id}">Reject</button>` : '';
                const payBtn = Number(row.outstanding || 0) > 0 && canManageFinance()
                  ? `<button class="action-btn" data-bill-pay="${row.id}" data-outstanding="${row.outstanding}" data-currency="${row.currency}">Record Payment</button>` : '';
                return `
                  <tr>
                    <td><strong>${row.billNumber || row.id}</strong><div class="small">${row.billDate || '-'} due ${rowOrDash(row.dueDate)}</div></td>
                    <td>${row.vendorName || '-'}</td>
                    <td>${row.entity || '-'}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                    <td>${money(row.total || 0, row.currency || 'USD')}</td>
                    <td>${money(row.outstanding || 0, row.currency || 'USD')}</td>
                    <td class="table-action-stack">${submitBtn}${approveBtn}${rejectBtn}${payBtn}</td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="7" class="muted">No vendor bills recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div class="grid-2 section-block" id="payables-register">
      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">AP Register</span>
            <h3>Outstanding Vendor Bills</h3>
          </div>
          <div class="table-meta">${rowOrDash(summary.openCount)} open bills</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Vendor</th><th>Bill</th><th>Status</th><th>Approved</th><th>Paid</th><th>Outstanding</th><th>Days Past Due</th></tr></thead>
              <tbody>
                ${filtered.slice(0, 250).map((row) => `
                  <tr>
                    <td>${row.vendorName || '-'}</td>
                    <td>${row.billNumber || row.id}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                    <td>${money(row.total || 0, row.currency || 'USD')}</td>
                    <td>${money(row.amountPaid || 0, row.currency || 'USD')}</td>
                    <td>${money(row.outstanding || 0, row.currency || 'USD')}</td>
                    <td>${rowOrDash(row.daysPastDue)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">No AP register rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="table-shell" id="payables-aging">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Aging + Concentration</span>
            <h3>Vendor Exposure</h3>
          </div>
          <div class="table-meta">${vendors.length} vendors</div>
        </div>
        <div class="table-shell__body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Current</h4><p>${money(aging.current || 0)}</p></div>
            <div class="kpi"><h4>1-30</h4><p>${money(aging.d1_30 || 0)}</p></div>
            <div class="kpi"><h4>31-60</h4><p>${money(aging.d31_60 || 0)}</p></div>
            <div class="kpi"><h4>61+</h4><p>${money(aging.d61_plus || 0)}</p></div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Vendor</th><th>Bills</th><th>Approved</th><th>Outstanding</th><th>Overdue</th></tr></thead>
              <tbody>
                ${byVendor.slice(0, 120).map((row) => `
                  <tr>
                    <td>${row.vendor}</td>
                    <td>${row.billCount}</td>
                    <td>${money(row.approvedAmount || 0)}</td>
                    <td>${money(row.outstanding || 0)}</td>
                    <td>${money(row.overdueAmount || 0)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No vendor aging rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function bankingView() {
  const draft = state.bankingDraft || {};
  const rails = bankingRailSummaries();
  const selectedRail = rails.find((row) => row.key === draft.rail) || rails[0] || DEFAULT_BANKING_RAILS[0];
  const recon = state.reconciliation || {};
  const summary = recon.summary || {};
  const search = String(state.searchQuery || '').toLowerCase();
  const railRows = (selectedRail?.rows || []).filter((row) => {
    const hay = `${row.date || ''} ${row.account || ''} ${row.description || ''} ${row.reference || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });
  const template = `date,amount,currency,description,type\n${new Date().toISOString().slice(0, 10)},1250,${selectedRail?.currency || 'PKR'},Example bank movement,${selectedRail?.entity === 'PK' ? 'DEBIT' : 'CREDIT'}`;
  const nav = sectionNav([
    { id: 'banking-rails', label: 'Cash Rails' },
    { id: 'banking-intake', label: 'Statement Intake' },
    { id: 'banking-reconcile', label: 'Reconciliation' },
    { id: 'banking-activity', label: 'Rail Activity' }
  ]);

  return `
    <section class="hero-panel hero-panel--cash">
      <div class="hero-copy">
        <div class="eyebrow">Cash Operations</div>
        <h2>Banking Hub</h2>
        <p>Operate governed bank and card rails from Admin, import cash activity, and move it into reconciliation so receipts, spend, and receivables stay aligned.</p>
        <div class="hero-actions">
          <button class="action-btn primary" data-tab="billing">Review AR Reconciliation</button>
          <button class="action-btn" data-tab="ledger">Open Transaction Monitor</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Open invoices</span>
          <strong>${rowOrDash(summary.openInvoiceCount)}</strong>
        </div>
        <div class="hero-stat">
          <span>Unmatched receipts</span>
          <strong>${rowOrDash(summary.unmatchedTransactionCount)}</strong>
        </div>
        <div class="hero-stat">
          <span>Auto-match suggestions</span>
          <strong>${rowOrDash(summary.suggestedMatches)}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="rail-grid section-block" id="banking-rails">
      ${rails.map((rail) => `
        <button class="rail-card ${selectedRail?.key === rail.key ? 'active' : ''}" data-rail-select="${rail.key}">
          <div class="rail-card__top">
            <strong>${rail.label}</strong>
            <span>${rail.entity} / ${rail.currency}</span>
          </div>
          <p>${rail.purpose}</p>
          <div class="rail-card__metrics">
            <span>${rail.rowCount} rows</span>
            <span>${money(rail.inflow, rail.currency)} in</span>
            <span>${money(rail.outflow, rail.currency)} out</span>
          </div>
        </button>
      `).join('')}
    </section>

    <div class="grid-2">
      <section class="card section-block" id="banking-intake">
        <div class="card-head"><h3>Statement Intake</h3><span class="small">Import bank or card activity into the normalized ledger</span></div>
        <div class="card-body">
          <div class="inline">
            <input id="bank_account" class="field" value="${draft.account || selectedRail?.label || ''}" readonly />
            <select id="bank_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${(draft.entity || selectedRail?.entity) === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
            <select id="bank_currency" class="field">
              <option value="PKR" ${(draft.currency || selectedRail?.currency) === 'PKR' ? 'selected' : ''}>PKR</option>
              <option value="USD" ${(draft.currency || selectedRail?.currency) === 'USD' ? 'selected' : ''}>USD</option>
              <option value="GBP" ${(draft.currency || selectedRail?.currency) === 'GBP' ? 'selected' : ''}>GBP</option>
            </select>
            <input id="bank_source" class="field" value="${draft.source || selectedRail?.source || 'BANK_IMPORT'}" />
          </div>
          <textarea id="bank_csv" placeholder="Paste CSV with headers: date,amount,currency,description,type">${draft.csv || template}</textarea>
          <div class="action-row">
            <input id="bank_csv_file" class="field" type="file" accept=".csv,text/csv" />
            <button class="btn btn-primary" id="importBankCsvBtn" ${!canManageFinance() ? 'disabled' : ''}>Book Imported Transactions</button>
          </div>
          <p class="small">These defaults come from the governed source account selected above. If the statement file does not include account or entity columns, this intake uses those admin-defined defaults. Expected headers: <code>date, amount, currency, description, type</code> and optionally <code>account, category, lineOfService, businessUnit, channel, reference</code>.</p>
        </div>
      </section>

      <section class="card section-block" id="banking-reconcile">
        <div class="card-head"><h3>Cash Reconciliation Queue</h3><span class="small">Where imported cash meets open receivables</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Selected Rail Rows</h4><p>${selectedRail?.rowCount || 0}</p></div>
            <div class="kpi"><h4>Unreconciled</h4><p>${selectedRail?.unreconciled || 0}</p></div>
            <div class="kpi"><h4>Inflows</h4><p>${money(selectedRail?.inflow || 0, selectedRail?.currency || 'USD')}</p></div>
            <div class="kpi"><h4>Outflows</h4><p>${money(selectedRail?.outflow || 0, selectedRail?.currency || 'USD')}</p></div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Transaction</th><th>Amount</th><th>Currency</th><th>Suggested Invoices</th></tr></thead>
              <tbody>
                ${(recon.suggestions || []).slice(0, 80).map((row) => `
                  <tr>
                    <td>${row.transactionId}</td>
                    <td>${money(row.amount, row.currency)}</td>
                    <td>${row.currency}</td>
                    <td>${(row.candidates || []).map((candidate) => `${candidate.invoiceNumber} (${money(candidate.outstanding, row.currency)})`).join(' | ') || '-'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No reconciliation suggestions yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <section class="card section-block" id="banking-activity">
      <div class="card-head"><h3>${selectedRail?.label || 'Selected Rail'} Activity</h3><span class="small">Imported and synced cash-side transaction rows</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Source</th><th>Type</th><th>Amount</th><th>Matched</th><th>Reference</th></tr></thead>
            <tbody>
              ${railRows.slice(0, 800).map((row) => `
                <tr>
                  <td>${row.date}</td>
                  <td>${row.description}</td>
                  <td>${row.account}</td>
                  <td>${row.source}</td>
                  <td>${row.type}</td>
                  <td>${money(row.amount, row.currency)}</td>
                  <td>${money(row.matchedAmount || 0, row.currency)}</td>
                  <td>${rowOrDash(row.reference)}</td>
                </tr>
              `).join('') || '<tr><td colspan="8" class="muted">No cash transactions found for this rail.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function treasuryView() {
  const treasury = state.reports.managementTreasury || {};
  const summary = treasury.summary || {};
  const cashBalances = treasury.cashBalances || [];
  const intercompany = state.intercompany || {};
  const icSummary = intercompany.summary || {};
  const icDraft = state.intercompanyDraft || {};
  const rails = sourceAccounts().filter((row) => (
    String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
    && (Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
  ));
  const nav = sectionNav([
    { id: 'treasury-position', label: 'Cash Position' },
    { id: 'treasury-intercompany-create', label: 'Intercompany Entry' },
    { id: 'treasury-intercompany-open', label: 'Open Ledger' },
    { id: 'treasury-intercompany-analysis', label: 'Exposure' }
  ]);

  return `
    <section class="hero-panel hero-panel--cash">
      <div class="hero-copy">
        <div class="eyebrow">Treasury + Intercompany</div>
        <h2>Treasury Workspace</h2>
        <p>Manage governed cash rails, entity-to-entity funding, and open intercompany balances without losing the audit trail back to source accounts and treasury reports.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Treasury inflows</span>
          <strong>${money(summary.inflows || 0, treasury.reportingCurrency || 'USD')}</strong>
        </div>
        <div class="hero-stat">
          <span>Treasury outflows</span>
          <strong>${money(summary.outflows || 0, treasury.reportingCurrency || 'USD')}</strong>
        </div>
        <div class="hero-stat">
          <span>Open intercompany</span>
          <strong>${money(icSummary.openAmount || 0, icDraft.currency || treasury.reportingCurrency || 'USD')}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="table-shell section-block" id="treasury-position">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Cash Position</span>
          <h3>Governed Cash and Card Rails</h3>
        </div>
        <div class="table-meta">${cashBalances.length} governed balances</div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Account</th><th>Entity</th><th>Role</th><th>Global</th><th>Native Balance</th><th>Reporting Balance</th></tr></thead>
            <tbody>
              ${cashBalances.map((row) => `
                <tr>
                  <td>${row.account}</td>
                  <td>${rowOrDash(row.entity)}</td>
                  <td>${rowOrDash(row.accountRole)}</td>
                  <td>${row.globalAccountCode ? `${row.globalAccountCode} | ${row.globalAccountName}` : '<span class="badge warn">UNMAPPED</span>'}</td>
                  <td>${money(row.nativeBalance || 0, row.currency || 'USD')}</td>
                  <td>${money(row.reportingBalance || 0, treasury.reportingCurrency || 'USD')}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="muted">No governed cash balances available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card section-block" id="treasury-intercompany-create">
      <div class="card-head"><h3>Intercompany Funding Entry</h3><span class="small">Create and settle entity-to-entity funding with treasury traceability</span></div>
      <div class="card-body">
        <div class="field-grid-4">
          <div class="field-stack">
            <label for="ic_date">Date</label>
            <input id="ic_date" class="field" type="date" value="${icDraft.date || ''}" />
          </div>
          <div class="field-stack">
            <label for="ic_from_entity">From Entity</label>
            <select id="ic_from_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${icDraft.fromEntity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="ic_to_entity">To Entity</label>
            <select id="ic_to_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${icDraft.toEntity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="ic_currency">Currency</label>
            <select id="ic_currency" class="field">
              ${['USD', 'GBP', 'PKR'].map((value) => `<option value="${value}" ${icDraft.currency === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-grid-4">
          <div class="field-stack">
            <label for="ic_amount">Amount</label>
            <input id="ic_amount" class="field" type="number" min="0" step="0.01" placeholder="0.00" value="${icDraft.amount || ''}" />
          </div>
          <div class="field-stack">
            <label for="ic_source_account">Source Rail</label>
            <select id="ic_source_account" class="field">
              <option value="">Select source rail</option>
              ${rails.map((row) => `<option value="${row.id}" ${icDraft.sourceAccountId === row.id ? 'selected' : ''}>${row.entity || '-'} | ${row.name}</option>`).join('')}
            </select>
          </div>
          <div class="field-stack">
            <label for="ic_reference">Reference</label>
            <input id="ic_reference" class="field" placeholder="IC-FUND-001" value="${icDraft.reference || ''}" />
          </div>
          <div class="field-stack">
            <label for="ic_reason">Reason</label>
            <input id="ic_reason" class="field" placeholder="Intercompany Funding" value="${icDraft.reason || 'Intercompany Funding'}" />
          </div>
        </div>
        <div class="field-stack">
          <label for="ic_description">Description</label>
          <input id="ic_description" class="field" placeholder="US entity funding PK operating cash buffer" value="${icDraft.description || ''}" />
        </div>
        <div class="field-stack">
          <label for="ic_notes">Notes</label>
          <input id="ic_notes" class="field" placeholder="Optional treasury note" value="${icDraft.notes || ''}" />
        </div>
        <div class="action-row">
          <button class="btn btn-primary" id="createIntercompanyEntryBtn" ${!canManageFinance() ? 'disabled' : ''}>Create Intercompany Entry</button>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="treasury-intercompany-open">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Open Ledger</span>
          <h3>Intercompany Register</h3>
        </div>
        <div class="table-meta">${rowOrDash(icSummary.entryCount)} entries</div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Reference</th><th>Reason</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${(intercompany.entries || []).slice(0, 250).map((row) => `
                <tr>
                  <td>${row.date}</td>
                  <td>${row.fromEntity}</td>
                  <td>${row.toEntity}</td>
                  <td>${row.reference || '-'}</td>
                  <td>${row.reason || '-'}</td>
                  <td>${money(row.amount || 0, row.currency || 'USD')}</td>
                  <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  <td>${String(row.status || '').toUpperCase() !== 'SETTLED' && canManageFinance() ? `<button class="action-btn" data-intercompany-settle="${row.id}" data-amount="${row.amount}" data-currency="${row.currency}">Settle</button>` : '-'}</td>
                </tr>
              `).join('') || '<tr><td colspan="8" class="muted">No intercompany entries recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div class="grid-2 section-block" id="treasury-intercompany-analysis">
      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Entity Pair Exposure</span>
            <h3>By Entity Pair</h3>
          </div>
          <div class="table-meta">${rowOrDash(icSummary.openCount)} open | ${rowOrDash(icSummary.settledCount)} settled</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Pair</th><th>Open</th><th>Settled</th><th>Count</th></tr></thead>
              <tbody>
                ${(intercompany.byPair || []).map((row) => `
                  <tr>
                    <td>${row.pair}</td>
                    <td>${money(row.openAmount || 0, row.currency || 'USD')}</td>
                    <td>${money(row.settledAmount || 0, row.currency || 'USD')}</td>
                    <td>${row.count}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No intercompany exposure rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Treasury Movement</span>
            <h3>Entity Cash Movement</h3>
          </div>
          <div class="table-meta">From treasury report</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Entity</th><th>Inflows</th><th>Outflows</th><th>Net</th></tr></thead>
              <tbody>
                ${(treasury.byEntity || []).map((row) => `
                  <tr>
                    <td>${row.entity}</td>
                    <td>${money(row.inflows || 0, treasury.reportingCurrency || 'USD')}</td>
                    <td>${money(row.outflows || 0, treasury.reportingCurrency || 'USD')}</td>
                    <td>${money(row.net || 0, treasury.reportingCurrency || 'USD')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No treasury movement rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function venturesView() {
  const settlements = [...(state.bootstrap?.ponchoSettlements || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const towerCosts = [...(state.bootstrap?.asarTowerCosts || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const ponchoTotal = settlements.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const ponchoUnmatched = settlements.filter((row) => !row.matched).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const towerCapex = towerCosts.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const towerDep = towerCosts.reduce((sum, row) => {
    const months = Number(row.usefulLifeMonths || 0);
    return sum + (months > 0 ? Number(row.amount || 0) / months : 0);
  }, 0);
  const ponchoDraft = state.ponchoDraft || {};
  const towerDraft = state.towerDraft || {};
  const nav = sectionNav([
    { id: 'ventures-poncho-entry', label: 'Poncho Entry' },
    { id: 'ventures-tower-entry', label: 'Tower Capex Entry' },
    { id: 'ventures-poncho-register', label: 'Poncho Register' },
    { id: 'ventures-capex-register', label: 'Capex Register' }
  ]);

  return `
    <section class="hero-panel hero-panel--venture">
      <div class="hero-copy">
        <div class="eyebrow">Ventures + Capital Projects</div>
        <h2>Ventures Workspace</h2>
        <p>Keep Poncho settlements and ASAR tower capex separate from core services so product performance and capital investment do not distort the operating P&amp;L.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Poncho settlements</span>
          <strong>${money(ponchoTotal, settlements[0]?.currency || 'GBP')}</strong>
        </div>
        <div class="hero-stat">
          <span>Unmatched Poncho</span>
          <strong>${money(ponchoUnmatched, settlements[0]?.currency || 'GBP')}</strong>
        </div>
        <div class="hero-stat">
          <span>Tower capex</span>
          <strong>${money(towerCapex, towerCosts[0]?.currency || 'PKR')}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <div class="grid-2">
      <section class="card section-block" id="ventures-poncho-entry">
        <div class="card-head"><h3>Record Poncho Settlement</h3><span class="small">Product cash receipt or settlement intake</span></div>
        <div class="card-body">
          <div class="inline">
            <input id="pon_date" class="field" type="date" value="${ponchoDraft.date || ''}" />
            <input id="pon_amount" class="field" type="number" min="0" step="0.01" placeholder="Amount" value="${ponchoDraft.amount || ''}" />
            <select id="pon_currency" class="field">
              <option value="GBP" ${ponchoDraft.currency === 'GBP' ? 'selected' : ''}>GBP</option>
              <option value="USD" ${ponchoDraft.currency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="PKR" ${ponchoDraft.currency === 'PKR' ? 'selected' : ''}>PKR</option>
            </select>
            <select id="pon_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${ponchoDraft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
          </div>
          <div class="inline">
            <input id="pon_reference" class="field" placeholder="Reference" value="${ponchoDraft.reference || ''}" />
            <input id="pon_channel" class="field" placeholder="Channel" value="${ponchoDraft.channel || ''}" />
            <select id="pon_invoice_id" class="field">
              <option value="">Optional linked invoice</option>
              ${(state.invoices || []).slice(0, 300).map((row) => `<option value="${row.id}" ${ponchoDraft.invoiceId === row.id ? 'selected' : ''}>${row.invoiceNumber} | ${row.clientName || '-'}</option>`).join('')}
            </select>
            <input id="pon_notes" class="field" placeholder="Notes" value="${ponchoDraft.notes || ''}" />
          </div>
          <div class="action-row">
            <button class="btn btn-primary" id="savePonchoBtn" ${!canManageFinance() ? 'disabled' : ''}>Save Settlement</button>
          </div>
        </div>
      </section>

      <section class="card section-block" id="ventures-tower-entry">
        <div class="card-head"><h3>Record ASAR Tower Capex</h3><span class="small">Capital project tracker</span></div>
        <div class="card-body">
          <div class="inline">
            <input id="tower_date" class="field" type="date" value="${towerDraft.date || ''}" />
            <input id="tower_vendor" class="field" placeholder="Vendor" value="${towerDraft.vendor || ''}" />
            <input id="tower_description" class="field" placeholder="Description" value="${towerDraft.description || ''}" />
            <input id="tower_amount" class="field" type="number" min="0" step="0.01" placeholder="Amount" value="${towerDraft.amount || ''}" />
          </div>
          <div class="inline">
            <select id="tower_currency" class="field">
              <option value="PKR" ${towerDraft.currency === 'PKR' ? 'selected' : ''}>PKR</option>
              <option value="USD" ${towerDraft.currency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="GBP" ${towerDraft.currency === 'GBP' ? 'selected' : ''}>GBP</option>
            </select>
            <select id="tower_entity" class="field">
              ${getEntityOptions().map((entity) => `<option value="${entity}" ${towerDraft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
            </select>
            <input id="tower_life" class="field" type="number" min="1" step="1" placeholder="Useful life months" value="${towerDraft.usefulLifeMonths || 60}" />
            <select id="tower_status" class="field">
              <option value="CAPITALIZED" ${towerDraft.status === 'CAPITALIZED' ? 'selected' : ''}>CAPITALIZED</option>
              <option value="IN_PROGRESS" ${towerDraft.status === 'IN_PROGRESS' ? 'selected' : ''}>IN_PROGRESS</option>
            </select>
          </div>
          <input id="tower_notes" class="field" placeholder="Notes" value="${towerDraft.notes || ''}" />
          <div class="action-row">
            <button class="btn btn-primary" id="saveTowerCostBtn" ${!canManageFinance() ? 'disabled' : ''}>Save Capex</button>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card section-block" id="ventures-poncho-register">
        <div class="card-head"><h3>Poncho Settlements</h3><span class="small">Standalone product cash register</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Reference</th><th>Entity</th><th>Channel</th><th>Amount</th><th>Matched</th></tr></thead>
              <tbody>
                ${settlements.map((row) => `
                  <tr>
                    <td>${row.date}</td>
                    <td>${row.reference}</td>
                    <td>${row.entity}</td>
                    <td>${rowOrDash(row.channel)}</td>
                    <td>${money(row.amount, row.currency)}</td>
                    <td><span class="badge ${row.matched ? 'ok' : 'warn'}">${row.matched ? 'MATCHED' : 'OPEN'}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No settlements recorded.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="ventures-capex-register">
        <div class="card-head"><h3>ASAR Tower Capex Register</h3><span class="small">Capitalized project cost schedule</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Total Capex</h4><p>${money(towerCapex, towerCosts[0]?.currency || 'PKR')}</p></div>
            <div class="kpi"><h4>Monthly Depreciation</h4><p>${money(towerDep, towerCosts[0]?.currency || 'PKR')}</p></div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Useful Life</th><th>Status</th></tr></thead>
              <tbody>
                ${towerCosts.map((row) => `
                  <tr>
                    <td>${row.date}</td>
                    <td>${rowOrDash(row.vendor)}</td>
                    <td>${row.description}</td>
                    <td>${money(row.amount, row.currency)}</td>
                    <td>${row.usefulLifeMonths || '-'}</td>
                    <td><span class="badge ${String(row.status || '').toUpperCase() === 'CAPITALIZED' ? 'ok' : 'warn'}">${row.status || '-'}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No capex rows recorded.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function ledgerView() {
  const lineage = state.qboLineage || {};
  const search = String(state.searchQuery || '').toLowerCase();
  const objectType = state.ledgerFilters.objectType || '';
  const sourceRows = qboLineageRows();
  const rows = sourceRows.filter((row) => {
    if (objectType && String(row.sourceObjectType || '').toUpperCase() !== String(objectType).toUpperCase()) return false;
    const hay = `${row.account || ''} ${row.description || ''} ${row.category || ''} ${row.entity || ''} ${row.sourceObjectType || ''} ${row.sourceObjectId || ''} ${row.reference || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });

  const inflow = rows.filter((r) => String(r.type || '').toUpperCase() === 'CREDIT').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const outflow = rows.filter((r) => String(r.type || '').toUpperCase() === 'DEBIT').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const objectOptions = qboObjectOptions();

  return `
    <section class="hero-panel hero-panel--source">
      <div class="hero-copy">
        <div class="eyebrow">Audit Trail</div>
        <h2>Transaction Monitor</h2>
        <p>This is the control view for transaction-level proof. Use it to trace ERP rows back to QuickBooks objects, inspect classifications, and audit what is actually driving the reports.</p>
        <div class="hero-actions">
          <button class="action-btn primary" data-tab="tagging">Open Classification</button>
          <button class="action-btn" data-tab="reports">Open Reports</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Rows</span>
          <strong>${rows.length}</strong>
        </div>
        <div class="hero-stat">
          <span>Inflows</span>
          <strong>${money(inflow)}</strong>
        </div>
        <div class="hero-stat">
          <span>Linked %</span>
          <strong>${rowOrDash(lineage.summary?.sourceLinkedPct)}%</strong>
        </div>
      </div>
    </section>

    <section class="card section-block" id="transaction-ledger">
      <div class="card-head"><h3>QuickBooks Transaction Ledger</h3><span class="small">Transaction-level source traceability</span></div>
      <div class="card-body">
        <div class="inline inline-5">
          <select id="ledger_object_type" class="field">
            <option value="">All Object Types</option>
            ${objectOptions.map((value) => `<option value="${value}" ${objectType === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
          <div class="small">Search uses global search bar and matches object IDs/references.</div>
        </div>
        <div class="table-wrap">
          <table class="table table-compact">
            <thead><tr><th>Date</th><th>Entity</th><th>Object</th><th>Object ID</th><th>Line</th><th>Account</th><th>Global</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th><th>LOS</th><th>Channel</th><th>Counterparty</th><th>Reference</th></tr></thead>
            <tbody>
              ${rows.slice(0, 1800).map((row) => `
                <tr>
                  <td>${row.date}</td>
                  <td>${rowOrDash(row.entity)}</td>
                  <td>${rowOrDash(row.sourceObjectType)}</td>
                  <td>${rowOrDash(row.sourceObjectId)}</td>
                  <td>${rowOrDash(row.sourceLineId)}</td>
                  <td>${row.account}</td>
                  <td>${row.globalAccountCode ? `${row.globalAccountCode} | ${row.globalAccountName}` : '<span class="badge warn">UNMAPPED</span>'}</td>
                  <td>${row.description}</td>
                  <td>${row.category}</td>
                  <td>${row.type}</td>
                  <td>${money(row.amount, row.currency)}</td>
                  <td>${rowOrDash(row.lineOfService)}</td>
                  <td>${rowOrDash(row.channel)}</td>
                  <td>${rowOrDash(row.counterparty)}</td>
                  <td>${rowOrDash(row.reference)}</td>
                </tr>
              `).join('') || '<tr><td colspan="15" class="muted">No QBO transactions available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function operationsView() {
  const draft = state.expenseDraft || {};
  const expenses = state.expenses || [];
  const reimbursementSummary = state.reimbursements?.summary || {};
  const reimbursements = state.reimbursements?.rows || [];
  const employeeOptions = getEmployeeOptions();
  const search = String(state.searchQuery || '').toLowerCase();
  const filteredExpenses = expenses.filter((row) => {
    const hay = `${row.description || ''} ${row.account || ''} ${row.category || ''} ${row.entity || ''} ${row.employeeId || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });
  const filteredReimbursements = reimbursements.filter((row) => {
    const hay = `${row.description || ''} ${row.employeeId || ''} ${row.entity || ''} ${row.reimbursementStatus || ''}`.toLowerCase();
    return !search || hay.includes(search);
  });
  const categoryOptions = state.financeModel?.dimensions?.categories || ['Operating Expense', 'Payroll', 'Bank Fee', 'Capex', 'Treasury'];
  const businessUnitOptions = state.financeModel?.dimensions?.businessUnits || ['CORPORATE', 'SERVICES', 'TREASURY', 'PONCHO', 'TOWER'];
  const spendAccounts = sourceAccounts()
    .filter((row) => String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
    .filter((row) => !draft.entity || String(row.entity || '').toUpperCase() === String(draft.entity || '').toUpperCase())
    .filter((row) => !draft.currency || String(row.currency || '').toUpperCase() === String(draft.currency || '').toUpperCase());
  const selectedSpendAccount = spendAccounts.find((row) => row.id === draft.sourceAccountId)
    || spendAccounts.find((row) => String(row.name || '') === String(draft.account || ''))
    || spendAccounts[0]
    || null;
  const spendSummary = expenseCategorySummary();
  const nav = sectionNav([
    { id: 'spend-entry', label: 'Record Expense' },
    { id: 'spend-summary', label: 'Spend Summary' },
    { id: 'spend-ledger', label: 'Expense Ledger' },
    { id: 'spend-reimbursements', label: 'Reimbursements' }
  ]);

  return `
    <section class="hero-panel hero-panel--cash">
      <div class="hero-copy">
        <div class="eyebrow">Operating Spend</div>
        <h2>Expenses and Reimbursements</h2>
        <p>Use this workspace for Pakistan entity spend, Meezan-paid expenses, and employee-paid costs that need reimbursement. It is the operating-spend workflow, not a reporting view.</p>
        <div class="hero-actions">
          <button class="action-btn primary" data-refresh-reimbursements="1">Refresh queues</button>
          <button class="action-btn" data-tab="reports">Open Spend Reports</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Total expenses</span>
          <strong>${expenses.length}</strong>
        </div>
        <div class="hero-stat">
          <span>Pending claims</span>
          <strong>${rowOrDash(reimbursementSummary.pendingCount)}</strong>
        </div>
        <div class="hero-stat">
          <span>Pending amount</span>
          <strong>${money(reimbursementSummary.pendingAmount || 0, 'PKR')}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <div class="kpi-grid">
      <div class="kpi"><h4>Total Expenses</h4><p>${expenses.length}</p></div>
      <div class="kpi"><h4>Pending Claims</h4><p>${rowOrDash(reimbursementSummary.pendingCount)}</p></div>
      <div class="kpi"><h4>Pending Amount</h4><p>${money(reimbursementSummary.pendingAmount || 0, 'PKR')}</p></div>
      <div class="kpi"><h4>Reimbursed</h4><p>${money(reimbursementSummary.reimbursedAmount || 0, 'PKR')}</p></div>
    </div>

    <section class="card section-block" id="spend-entry">
      <div class="card-head"><h3>Record Expense (PK / Meezan / Employee Claim)</h3><span class="small">Use for Pakistan entity expenses and reimbursements</span></div>
      <div class="card-body">
        <div class="inline">
          <input id="exp_date" class="field" type="date" value="${draft.date || ''}" />
          <input id="exp_description" class="field" placeholder="Description" value="${draft.description || ''}" />
          <input id="exp_amount" class="field" type="number" step="0.01" min="0" placeholder="Amount" value="${draft.amount || ''}" />
          <select id="exp_currency" class="field">
            <option value="PKR" ${draft.currency === 'PKR' ? 'selected' : ''}>PKR</option>
            <option value="USD" ${draft.currency === 'USD' ? 'selected' : ''}>USD</option>
            <option value="GBP" ${draft.currency === 'GBP' ? 'selected' : ''}>GBP</option>
          </select>
        </div>
        <div class="inline">
          <select id="exp_entity" class="field">
            ${getEntityOptions().map((entity) => `<option value="${entity}" ${draft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
          </select>
          <select id="exp_source_account" class="field">
            <option value="">Select governed source account</option>
            ${spendAccounts.map((row) => `<option value="${row.id}" ${selectedSpendAccount?.id === row.id ? 'selected' : ''}>${row.entity || '-'} | ${row.name} | ${row.currency}</option>`).join('')}
          </select>
          <select id="exp_category" class="field">
            ${categoryOptions.map((value) => `<option value="${value}" ${draft.category === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
          <select id="exp_bu" class="field">
            ${businessUnitOptions.map((value) => `<option value="${value}" ${draft.businessUnit === value ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
        </div>
        <div class="inline">
          <select id="exp_los" class="field">
            <option value="">No LOS</option>
            <option value="TRDEV" ${draft.lineOfService === 'TRDEV' ? 'selected' : ''}>TRDEV</option>
            <option value="TRFINANCE" ${draft.lineOfService === 'TRFINANCE' ? 'selected' : ''}>TRFINANCE</option>
            <option value="TRBUILD" ${draft.lineOfService === 'TRBUILD' ? 'selected' : ''}>TRBUILD</option>
          </select>
          <select id="exp_employee" class="field">
            <option value="">No Employee Claim</option>
            ${employeeOptions.map((row) => `<option value="${row.id}" ${draft.employeeId === row.id ? 'selected' : ''}>${row.name} (${row.role})</option>`).join('')}
          </select>
          <label class="small"><input id="exp_reimb_needed" type="checkbox" ${draft.reimbursementNeeded ? 'checked' : ''} /> Reimbursement needed</label>
          <input id="exp_notes" class="field" placeholder="Notes" value="${draft.notes || ''}" />
        </div>
        <div class="action-row">
          <button class="btn btn-primary" id="saveExpenseBtn" ${!canManageFinance() ? 'disabled' : ''}>Save Expense</button>
          <button class="action-btn" data-refresh-reimbursements="1">Refresh</button>
        </div>
        ${!canManageFinance() ? '<p class="small">Create/settle actions require Admin or Accountant.</p>' : ''}
      </div>
    </section>

    <div class="grid-2">
      <section class="card section-block" id="spend-summary">
        <div class="card-head"><h3>Spend by Category</h3><span class="small">Where operating cash is going</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Category</th><th>Count</th><th>Amount</th></tr></thead>
              <tbody>
                ${spendSummary.slice(0, 20).map((row) => `
                  <tr>
                    <td>${row.category}</td>
                    <td>${row.count}</td>
                    <td>${money(row.amount, row.currency || 'PKR')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="3" class="muted">No spend recorded yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="spend-ledger">
        <div class="card-head"><h3>Expense Ledger</h3><span class="small">All recorded expenses</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Entity</th><th>Description</th><th>Account</th><th>Employee</th><th>Status</th><th>Amount</th></tr></thead>
              <tbody>
                ${filteredExpenses.slice(0, 800).map((row) => `
                  <tr>
                    <td>${row.date}</td>
                    <td>${rowOrDash(row.entity)}</td>
                    <td>${row.description}</td>
                    <td>${row.account || '-'}</td>
                    <td>${row.employeeId ? (employeeOptions.find((u) => u.id === row.employeeId)?.name || row.employeeId) : '-'}</td>
                    <td><span class="badge ${String(row.reimbursementStatus || '').toUpperCase() === 'PENDING' ? 'warn' : 'ok'}">${row.reimbursementStatus || row.status || '-'}</span></td>
                    <td>${money(row.amount, row.currency || 'PKR')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">No expenses recorded.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="spend-reimbursements">
        <div class="card-head"><h3>Employee Reimbursement Queue</h3><span class="small">Pending and settled claims</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Employee</th><th>Entity</th><th>Description</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                ${filteredReimbursements.slice(0, 600).map((row) => {
                  const pending = String(row.reimbursementStatus || '').toUpperCase() === 'PENDING';
                  const employee = row.employeeId ? (employeeOptions.find((u) => u.id === row.employeeId)?.name || row.employeeId) : 'Unassigned';
                  return `
                    <tr>
                      <td>${row.date}</td>
                      <td>${employee}</td>
                      <td>${rowOrDash(row.entity)}</td>
                      <td>${row.description}</td>
                      <td>${money(row.amount, row.currency || 'PKR')}</td>
                      <td><span class="badge ${pending ? 'warn' : 'ok'}">${row.reimbursementStatus || '-'}</span></td>
                      <td>${pending && canManageFinance() ? `<button class="action-btn primary" data-settle-reimbursement="${row.id}">Settle</button>` : '-'}</td>
                    </tr>
                  `;
                }).join('') || '<tr><td colspan="7" class="muted">No reimbursement rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function reportsView() {
  const los = state.reports.qboRevenueByLos || {};
  const losSummary = los.summary || {};
  const byLos = los.byLineOfService || [];
  const byEntityLos = los.byEntityLineOfService || [];
  const statPl = state.reports.statutoryPl || {};
  const statPlStatement = statPl.statement || {};
  const statCf = state.reports.statutoryCashFlow || {};
  const statCfInflows = statCf.inflows || {};
  const statCfOutflows = statCf.outflows || {};
  const statBs = state.reports.statutoryBalanceSheet || {};
  const statBsAssets = statBs.assets || {};
  const statBsLiabilities = statBs.liabilities || {};
  const statBsEquity = statBs.equity || {};
  const statAging = state.reports.statutoryArAging?.buckets || {};
  const utilisation = state.reports.utilisation?.utilisation || [];

  const mgmtPl = state.reports.managementPl || {};
  const mgmtSummary = mgmtPl.summary || {};
  const mgmtByMonth = mgmtPl.byMonth || [];
  const mgmtByGlobal = mgmtPl.byGlobalAccount || [];
  const mgmtByGroup = mgmtPl.byReportingGroup || [];
  const mgmtMapping = mgmtPl.mappingCoverage || {};
  const treasury = state.reports.managementTreasury || {};
  const treasurySummary = treasury.summary || {};
  const treasuryMapping = treasury.mappingCoverage || {};
  const treasuryCashBalances = treasury.cashBalances || [];
  const upwork = state.reports.managementUpwork || {};
  const upworkSummary = upwork.summary || {};
  const partner = state.reports.managementPartner || {};
  const partnerSummary = partner.summary || {};
  const partnerTotals = partner.partnerTotals || [];
  const scopedInvoices = reportScopedInvoices();
  const byClient = clientBillingAnalytics(scopedInvoices).slice(0, 200);
  const reportCards = [
    { title: 'Statutory Statements', detail: 'P&L, cash flow, and balance sheet for accountant-style review.' },
    { title: 'Revenue Analytics', detail: 'LOS, client, and entity cuts built from invoice tagging.' },
    { title: 'Working Capital', detail: 'AR aging, collections, and receipt matching quality.' },
    { title: 'Treasury + Channels', detail: 'Cash movement, Upwork receipts, and treasury flows.' }
  ];
  const nav = sectionNav([
    { id: 'reports-filters', label: 'Filters' },
    { id: 'reports-statements', label: 'Statements' },
    { id: 'reports-management', label: 'Management' },
    { id: 'reports-working-capital', label: 'Working Capital' },
    { id: 'reports-los', label: 'LOS + Entity' }
  ]);

  return `
    <section class="hero-panel hero-panel--reports">
      <div class="hero-copy">
        <div class="eyebrow">Board Pack</div>
        <h2>Reports and Analytics</h2>
        <p>This workspace is organized as a report pack: first the accounting statements, then management analytics, then working-capital and entity detail. The intent is to answer decision questions, not just dump tables.</p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="refreshReportPackBtn">Refresh Report Pack</button>
          <button class="action-btn" id="printReportPackBtn">Print Report Pack</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Management net</span>
          <strong>${money(mgmtSummary.net || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
        </div>
        <div class="hero-stat">
          <span>Closing cash</span>
          <strong>${money(statCf.closingBalance || 0)}</strong>
        </div>
        <div class="hero-stat">
          <span>Open AR</span>
          <strong>${money(losSummary.openAr || 0, los.reportingCurrency || 'USD')}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="report-index">
      ${reportCards.map((card) => `
        <article class="report-card">
          <span class="eyebrow">Report lane</span>
          <strong>${card.title}</strong>
          <p>${card.detail}</p>
        </article>
      `).join('')}
    </section>

    <section class="card section-block" id="reports-filters">
      <div class="card-head"><h3>Report Filters</h3><span class="small">Applies to all report widgets below</span></div>
      <div class="card-body">
        <div class="inline">
          <input id="report_from" class="field" type="date" value="${state.reportFilters.fromDate || ''}" />
          <input id="report_to" class="field" type="date" value="${state.reportFilters.toDate || ''}" />
          <select id="report_entity" class="field">
            <option value="">All Entities</option>
            ${getEntityOptions().map((entity) => `<option value="${entity}" ${state.reportFilters.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="applyReportFiltersBtn">Apply</button>
        </div>
      </div>
    </section>

    <section class="card section-block" id="reports-pack">
      <div class="card-head"><h3>Financial Report Pack</h3><span class="small">Accounting-style statements and management analytics</span></div>
      <div class="card-body">
        <p class="small">Report period: ${rowOrDash(state.reportFilters.fromDate)} to ${rowOrDash(state.reportFilters.toDate)} | Entity scope: ${state.reportFilters.entity || 'Global Consolidated'} | Reporting currency: ${mgmtPl.reportingCurrency || los.reportingCurrency || 'USD'} | Data freshness: ${rowOrDash(state.qboStatus?.lastPullAt || state.qboStatus?.lastSyncAt)}</p>
        <div class="kpi-grid">
          <div class="kpi"><h4>Revenue</h4><p>${money(mgmtSummary.revenue || 0, mgmtPl.reportingCurrency || 'USD')}</p></div>
          <div class="kpi"><h4>Expense</h4><p>${money(mgmtSummary.expense || 0, mgmtPl.reportingCurrency || 'USD')}</p></div>
          <div class="kpi"><h4>Treasury</h4><p>${money(treasurySummary.outflows || 0, treasury.reportingCurrency || 'USD')}</p></div>
          <div class="kpi"><h4>Mapped Entries</h4><p>${rowOrDash(mgmtMapping.coveragePct)}%</p></div>
        </div>
        <div class="action-row">
          <button class="action-btn" id="exportClientArReportBtn">Export Client AR CSV</button>
          <button class="action-btn" id="exportLosReportBtn">Export LOS Report CSV</button>
        </div>
      </div>
    </section>

    <div class="grid-3 section-block" id="reports-statements">
      <section class="card">
        <div class="card-head"><h3>P&L Statement</h3><span class="small">Structured statutory view</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Line Item</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Revenue Recognized</td><td>${money(statPlStatement.revenueRecognized || 0)}</td></tr>
                <tr><td>Operating Expenses</td><td>${money(statPlStatement.operatingExpenses || 0)}</td></tr>
                <tr><td>Payroll Cost</td><td>${money(statPlStatement.payrollCost || 0)}</td></tr>
                <tr><td><strong>Gross Profit</strong></td><td><strong>${money(statPlStatement.grossProfit || 0)}</strong></td></tr>
                <tr><td>Cash Collected</td><td>${money(statPlStatement.cashCollected || 0)}</td></tr>
                <tr><td><strong>Net Cash Profit</strong></td><td><strong>${money(statPlStatement.netCashProfit || 0)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Cash Flow Statement</h3><span class="small">Inflows vs outflows</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Line Item</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Total Inflows</td><td>${money(statCfInflows.totalInflows || 0)}</td></tr>
                <tr><td>Total Outflows</td><td>${money(statCfOutflows.totalOutflows || 0)}</td></tr>
                <tr><td><strong>Net Movement</strong></td><td><strong>${money(statCf.netMovement || 0)}</strong></td></tr>
                <tr><td>Opening Balance</td><td>${money(statCf.openingBalance || 0)}</td></tr>
                <tr><td><strong>Closing Balance</strong></td><td><strong>${money(statCf.closingBalance || 0)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Balance Sheet</h3><span class="small">Assets, liabilities, equity</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Line Item</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Total Assets</td><td>${money(statBsAssets.totalAssets || 0)}</td></tr>
                <tr><td>Total Liabilities</td><td>${money(statBsLiabilities.totalLiabilities || 0)}</td></tr>
                <tr><td><strong>Total Equity</strong></td><td><strong>${money(statBsEquity.totalEquity || 0)}</strong></td></tr>
                <tr><td>Cash</td><td>${money(statBsAssets.cash || 0)}</td></tr>
                <tr><td>Accounts Receivable</td><td>${money(statBsAssets.accountsReceivable || 0)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="reports-management">
      <section class="card">
        <div class="card-head"><h3>Management Trend (Monthly)</h3><span class="small">Revenue, expense, payroll, treasury, net</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Month</th><th>Revenue</th><th>Expense</th><th>Payroll</th><th>Treasury</th><th>Net</th></tr></thead>
              <tbody>
                ${mgmtByMonth.map((row) => `
                  <tr>
                    <td>${row.key}</td>
                    <td>${money(row.revenue || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.expense || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.payroll || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.treasury || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td><span class="badge ${(row.net || 0) >= 0 ? 'ok' : 'danger'}">${money(row.net || 0, mgmtPl.reportingCurrency || 'USD')}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No monthly management trend rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Global Chart Mapping</h3><span class="small">How reporting is landing in the consolidated chart</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Mapped</h4><p>${rowOrDash(mgmtMapping.mappedEntries)}</p></div>
            <div class="kpi"><h4>Source-Mapped</h4><p>${rowOrDash(mgmtMapping.sourceMappedEntries)}</p></div>
            <div class="kpi"><h4>Rule-Mapped</h4><p>${rowOrDash(mgmtMapping.ruleMappedEntries)}</p></div>
            <div class="kpi"><h4>Unmapped</h4><p>${rowOrDash(mgmtMapping.unmappedEntries)}</p></div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Global Account</th><th>Revenue</th><th>Expense</th><th>Payroll</th><th>Treasury</th><th>Net</th></tr></thead>
              <tbody>
                ${mgmtByGlobal.slice(0, 16).map((row) => `
                  <tr>
                    <td>${row.globalAccount}</td>
                    <td>${money(row.revenue || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.expense || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.payroll || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.treasury || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.net || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No global-account rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block">
      <section class="card">
        <div class="card-head"><h3>Client Revenue & AR</h3><span class="small">Client-level billing analytics</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Client</th><th>Invoices</th><th>Billed</th><th>Collected</th><th>Outstanding</th><th>Collection %</th><th>Overdue</th></tr></thead>
              <tbody>
                ${byClient.map((row) => `
                  <tr>
                    <td>${row.client}</td>
                    <td>${row.invoiceCount}</td>
                    <td>${money(row.totalBilled)}</td>
                    <td>${money(row.totalCollected)}</td>
                    <td>${money(row.outstanding)}</td>
                    <td><span class="badge ${row.collectionPct >= 90 ? 'ok' : row.collectionPct >= 70 ? 'warn' : 'danger'}">${row.collectionPct}%</span></td>
                    <td>${row.overdueCount}</td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">No client analytics rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Reporting Group View</h3><span class="small">Consolidation by global reporting group</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Reporting Group</th><th>Revenue</th><th>Expense</th><th>Payroll</th><th>Treasury</th><th>Net</th></tr></thead>
              <tbody>
                ${mgmtByGroup.slice(0, 16).map((row) => `
                  <tr>
                    <td>${row.key}</td>
                    <td>${money(row.revenue || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.expense || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.payroll || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.treasury || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                    <td>${money(row.net || 0, mgmtPl.reportingCurrency || 'USD')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No reporting-group rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-3 section-block" id="reports-highlights">
      <section class="card">
        <div class="card-head"><h3>Revenue by LOS</h3><span class="small">QBO-only invoices</span></div>
        <div class="card-body">
          <div class="small">Total Revenue</div><strong>${money(losSummary.totalRevenue || 0, los.reportingCurrency || 'USD')}</strong>
          <div class="small">Collected</div><strong>${money(losSummary.totalCollected || 0, los.reportingCurrency || 'USD')}</strong>
          <div class="small">Open AR</div><strong>${money(losSummary.openAr || 0, los.reportingCurrency || 'USD')}</strong>
          <div class="small">Untagged Invoices</div><strong>${rowOrDash(losSummary.untaggedCount)}</strong>
          <div class="small">Untagged Revenue</div><strong>${money(losSummary.untaggedRevenue || 0, los.reportingCurrency || 'USD')}</strong>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Management P&L</h3><span class="small">Consolidated view</span></div>
        <div class="card-body">
          <div class="small">Revenue</div><strong>${money(mgmtSummary.revenue || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
          <div class="small">Expense</div><strong>${money(mgmtSummary.expense || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
          <div class="small">Payroll</div><strong>${money(mgmtSummary.payroll || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
          <div class="small">Treasury</div><strong>${money(mgmtSummary.treasury || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
          <div class="small">Net</div><strong>${money(mgmtSummary.net || 0, mgmtPl.reportingCurrency || 'USD')}</strong>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Treasury & Upwork</h3><span class="small">Cash movement visibility</span></div>
        <div class="card-body">
          <div class="small">Treasury Inflows</div><strong>${money(treasurySummary.inflows || 0, treasury.reportingCurrency || 'USD')}</strong>
          <div class="small">Treasury Outflows</div><strong>${money(treasurySummary.outflows || 0, treasury.reportingCurrency || 'USD')}</strong>
          <div class="small">Treasury Mapping Coverage</div><strong>${rowOrDash(treasuryMapping.coveragePct)}%</strong>
          <div class="small">Upwork Receipts</div><strong>${money(upworkSummary.receipts || 0, upwork.reportingCurrency || 'USD')}</strong>
          <div class="small">Upwork Fees</div><strong>${money(upworkSummary.fees || 0, upwork.reportingCurrency || 'USD')}</strong>
          <div class="small">Upwork Unmatched</div><strong>${money(upworkSummary.unmatchedReceipts || 0, upwork.reportingCurrency || 'USD')}</strong>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Partner Ledger</h3><span class="small">Related-party and draw visibility</span></div>
        <div class="card-body">
          <div class="small">Total Draw Amount</div><strong>${money(partnerSummary.totalDrawAmount || 0, partner.reportingCurrency || 'USD')}</strong>
          <div class="small">Partners</div><strong>${rowOrDash(partnerSummary.partnerCount)}</strong>
          <div class="small">Entries</div><strong>${rowOrDash(partnerSummary.entryCount)}</strong>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Partner</th><th>Draw Amount</th><th>Entries</th><th>Entities</th></tr></thead>
              <tbody>
                ${partnerTotals.slice(0, 10).map((row) => `
                  <tr>
                    <td>${row.partner}</td>
                    <td>${money(row.drawAmount || 0, partner.reportingCurrency || 'USD')}</td>
                    <td>${row.entryCount}</td>
                    <td>${(row.entities || []).join(', ')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="muted">No partner-draw rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="reports-working-capital">
      <section class="card">
        <div class="card-head"><h3>AR Aging</h3><span class="small">Receivables risk buckets</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Bucket</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Current</td><td>${money(statAging.current || 0)}</td></tr>
                <tr><td>1-30</td><td>${money(statAging.d1_30 || 0)}</td></tr>
                <tr><td>31-60</td><td>${money(statAging.d31_60 || 0)}</td></tr>
                <tr><td>61+</td><td>${money(statAging.d61_plus || 0)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Project Utilisation</h3><span class="small">Billable performance</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Project</th><th>PM</th><th>Billable Hours</th><th>Budget Hours</th><th>Utilisation %</th></tr></thead>
              <tbody>
                ${utilisation.slice(0, 200).map((row) => `
                  <tr>
                    <td>${row.projectCode} | ${row.projectName}</td>
                    <td>${row.projectManager}</td>
                    <td>${row.billableHours}</td>
                    <td>${row.budgetHours}</td>
                    <td>${rowOrDash(row.utilizationPct)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No utilisation rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="reports-los">
      <section class="card">
        <div class="card-head"><h3>Revenue by Line of Service</h3><span class="small">Actionable management cut</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>LOS</th><th>Revenue</th></tr></thead>
              <tbody>
                ${byLos.map((row) => `
                  <tr>
                    <td>${row.lineOfService}</td>
                    <td>${money(row.revenue || 0, los.reportingCurrency || 'USD')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="2" class="muted">No LOS data. Tag invoices first in Data Quality view.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Entity + LOS Detail</h3><span class="small">Cross-entity line performance</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Entity</th><th>LOS</th><th>Invoices</th><th>Revenue</th><th>Collected</th><th>Open AR</th></tr></thead>
              <tbody>
                ${byEntityLos.map((row) => `
                  <tr>
                    <td>${row.entity}</td>
                    <td>${row.lineOfService}</td>
                    <td>${row.invoiceCount}</td>
                    <td>${money(row.revenue || 0, los.reportingCurrency || 'USD')}</td>
                    <td>${money(row.collected || 0, los.reportingCurrency || 'USD')}</td>
                    <td>${money(row.openAr || 0, los.reportingCurrency || 'USD')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">No entity-LOS rows.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <section class="card section-block">
      <div class="card-head"><h3>Governed Cash Balances</h3><span class="small">Cash and card rails from the mapped source-account master</span></div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Account</th><th>Entity</th><th>Role</th><th>Global</th><th>Native Balance</th><th>Reporting Balance</th><th>Last Pull</th></tr></thead>
            <tbody>
              ${treasuryCashBalances.slice(0, 40).map((row) => `
                <tr>
                  <td>${row.account}</td>
                  <td>${rowOrDash(row.entity)}</td>
                  <td>${rowOrDash(row.accountRole)}</td>
                  <td>${row.globalAccountCode ? `${row.globalAccountCode} | ${row.globalAccountName}` : '<span class="badge warn">UNMAPPED</span>'}</td>
                  <td>${money(row.nativeBalance || 0, row.currency || 'USD')}</td>
                  <td>${money(row.reportingBalance || 0, treasury.reportingCurrency || 'USD')}</td>
                  <td>${rowOrDash(row.lastPulledAt)}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="muted">No governed cash balances available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function closeView() {
  const periods = [...(state.closePeriods || [])].sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')));
  const focus = periods[0] || null;
  const checklist = focus?.checklist || { checks: [], metrics: {}, readyToClose: false };
  const metrics = checklist.metrics || {};
  const nav = sectionNav([
    { id: 'close-status', label: 'Current Status' },
    { id: 'close-checklist', label: 'Checklist' },
    { id: 'close-register', label: 'Period Register' }
  ]);

  return `
    <section class="hero-panel hero-panel--source">
      <div class="hero-copy">
        <div class="eyebrow">Period Governance</div>
        <h2>Month-End Close</h2>
        <p>Close the month with explicit blockers, snapshot metrics, and hard posting locks. This is where finance confirms the books are ready and prevents back-posting into a closed period.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Current period</span>
          <strong>${focus?.periodKey || '-'}</strong>
        </div>
        <div class="hero-stat">
          <span>Status</span>
          <strong>${focus?.status || 'OPEN'}</strong>
        </div>
        <div class="hero-stat">
          <span>Ready to close</span>
          <strong>${checklist.readyToClose ? 'YES' : 'NO'}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <section class="billing-overview" id="close-status">
      <article class="insight-card">
        <span class="eyebrow">Open AR</span>
        <strong>${money(metrics.openAr || 0)}</strong>
        <p>${rowOrDash(metrics.invoiceCount)} invoices in period</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Open AP</span>
        <strong>${money(metrics.openAp || 0)}</strong>
        <p>Outstanding vendor and reimbursement liabilities</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Open Intercompany</span>
        <strong>${money(metrics.openIntercompany || 0)}</strong>
        <p>Entity funding still unsettled as of period end</p>
      </article>
      <article class="insight-card">
        <span class="eyebrow">Locked periods</span>
        <strong>${periods.filter((row) => String(row.status || '').toUpperCase() === 'CLOSED').length}</strong>
        <p>Reopen only with finance control approval</p>
      </article>
    </section>

    <section class="table-shell section-block" id="close-checklist">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Checklist</span>
          <h3>${focus?.periodKey || 'Current'} Close Checklist</h3>
        </div>
        <div class="table-meta">${focus?.status || 'OPEN'} period</div>
      </div>
      <div class="table-shell__toolbar">
        <div class="table-metrics">
          <span class="metric-chip">${checklist.readyToClose ? 'Ready to close' : 'Blockers remain'}</span>
          <span class="metric-chip">${(checklist.checks || []).filter((row) => row.pass).length} / ${(checklist.checks || []).length} checks passed</span>
        </div>
        <div class="table-actions">
          ${canManageFinance() && focus && String(focus.status || '').toUpperCase() !== 'CLOSED' ? `<button class="action-btn primary" data-close-period="${focus.periodKey}">Close Period</button>` : ''}
          ${canManageFinance() && focus && String(focus.status || '').toUpperCase() === 'CLOSED' ? `<button class="action-btn" data-reopen-period="${focus.periodKey}">Reopen Period</button>` : ''}
        </div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>
              ${(checklist.checks || []).map((row) => `
                <tr>
                  <td>${row.label}</td>
                  <td><span class="badge ${row.pass ? 'ok' : 'danger'}">${row.pass ? 'PASS' : 'BLOCKED'}</span></td>
                  <td>${row.detail}</td>
                </tr>
              `).join('') || '<tr><td colspan="3" class="muted">No checklist available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="table-shell section-block" id="close-register">
      <div class="table-shell__head">
        <div>
          <span class="eyebrow">Period Register</span>
          <h3>Recent Close Periods</h3>
        </div>
        <div class="table-meta">${periods.length} periods loaded</div>
      </div>
      <div class="table-shell__body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Period</th><th>Status</th><th>Closed At</th><th>Open AR</th><th>Open AP</th><th>Open Intercompany</th><th>Actions</th></tr></thead>
            <tbody>
              ${periods.map((row) => `
                <tr>
                  <td><strong>${row.periodKey}</strong></td>
                  <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  <td>${rowOrDash(row.closedAt)}</td>
                  <td>${money(row.checklist?.metrics?.openAr || 0)}</td>
                  <td>${money(row.checklist?.metrics?.openAp || 0)}</td>
                  <td>${money(row.checklist?.metrics?.openIntercompany || 0)}</td>
                  <td>
                    ${!canManageFinance() ? '-' : String(row.status || '').toUpperCase() === 'CLOSED'
                      ? `<button class="action-btn" data-reopen-period="${row.periodKey}">Reopen</button>`
                      : `<button class="action-btn primary" data-close-period="${row.periodKey}">Close</button>`}
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="muted">No period-close rows available.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function adminView() {
  const model = state.financeModel || {};
  const settings = model.settings || {};
  const dimensions = model.dimensions || {};
  const accounts = sourceAccounts();
  const globals = globalChartAccounts();
  const mappings = accountMappings();
  const accountDraft = state.accountDraft || defaultAccountDraft();
  const globalDraft = state.globalAccountDraft || defaultGlobalAccountDraft();
  const mappingDraft = state.mappingDraft || defaultMappingDraft();
  const adjustments = [...(state.managementAdjustments || [])]
    .sort((a, b) => String(b.effectiveDate || b.createdAt || '').localeCompare(String(a.effectiveDate || a.createdAt || '')));
  const qboAccounts = accounts.filter((row) => String(row.sourceSystem || '').toUpperCase() === 'QBO');
  const bankingVisible = accounts.filter((row) => row.showInBankingHub);
  const mappedAccounts = accounts.filter((row) => row.mappedGlobalAccountId || row.globalAccountId);
  const dimensionCards = [
    { label: 'Reporting currency', value: settings.reportingCurrency || 'USD' },
    { label: 'Entities', value: (dimensions.entities || []).join(', ') || '-' },
    { label: 'LOS options', value: (dimensions.lineOfService || []).length || 0 },
    { label: 'Business units', value: (dimensions.businessUnit || []).length || 0 }
  ];
  const nav = sectionNav([
    { id: 'admin-systems', label: 'Source Systems' },
    { id: 'admin-accounts', label: 'Account Master' },
    { id: 'admin-global-chart', label: 'Global Chart' },
    { id: 'admin-mappings', label: 'Account Mappings' },
    { id: 'admin-audit', label: 'Audit Log' },
    { id: 'admin-notifications', label: 'Notifications' },
    { id: 'admin-finance-model', label: 'Finance Model' },
    { id: 'admin-adjustments', label: 'Adjustments' },
    { id: 'admin-health', label: 'Workflow Health' }
  ]);

  return `
    <section class="hero-panel hero-panel--control">
      <div class="hero-copy">
        <div class="eyebrow">Governance</div>
        <h2>Admin and Controls</h2>
        <p>This workspace exists for finance governance: audit trail, notification processing, finance model configuration, management-adjustment visibility, and overall workflow health.</p>
        <div class="hero-actions">
          <button class="action-btn primary" id="refreshAdminBtn">Refresh Controls</button>
          <button class="action-btn" id="processNotificationsBtn">Process Notifications</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Audit events</span>
          <strong>${(state.admin.audit || []).length}</strong>
        </div>
        <div class="hero-stat">
          <span>Queued notifications</span>
          <strong>${(state.admin.notifications || []).filter((row) => String(row.status || '').toUpperCase() !== 'SENT').length}</strong>
        </div>
        <div class="hero-stat">
          <span>Mgmt adjustments</span>
          <strong>${adjustments.length}</strong>
        </div>
        <div class="hero-stat">
          <span>Mapped accounts</span>
          <strong>${mappedAccounts.length}/${accounts.length}</strong>
        </div>
      </div>
    </section>

    ${nav}

    <div class="kpi-grid">
      ${dimensionCards.map((card) => `
        <div class="kpi">
          <h4>${card.label}</h4>
          <p>${card.value}</p>
        </div>
      `).join('')}
    </div>

    <div class="grid-2 section-block" id="admin-systems">
      <section class="card">
        <div class="card-head"><h3>Source Systems Control</h3><span class="small">Admin-owned integration and ledger governance</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>QuickBooks</h4><p>${state.qboStatus?.connected ? 'Connected' : 'Not connected'}</p></div>
            <div class="kpi"><h4>Environment</h4><p>${rowOrDash(state.qboStatus?.environment)}</p></div>
            <div class="kpi"><h4>Realm</h4><p>${rowOrDash(state.qboStatus?.realmId)}</p></div>
            <div class="kpi"><h4>Last Pull</h4><p>${rowOrDash(state.qboStatus?.lastPullAt)}</p></div>
          </div>
          <div class="action-row">
            <button class="action-btn primary" id="adminConnectQboBtn">Connect QuickBooks</button>
            <button class="action-btn" id="adminPullFullQboBtn">Run Full Pull</button>
            <button class="action-btn" data-tab="quickbooks">Open QuickBooks Workspace</button>
          </div>
          <p class="small">This is the correct place for source-system governance. Use it to manage live QBO connectivity, then govern source accounts and mappings below.</p>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Account Governance Snapshot</h3><span class="small">What feeds Banking Hub and global reporting</span></div>
        <div class="card-body">
          <div class="kpi-grid">
            <div class="kpi"><h4>Source Accounts</h4><p>${accounts.length}</p></div>
            <div class="kpi"><h4>QBO Accounts</h4><p>${qboAccounts.length}</p></div>
            <div class="kpi"><h4>Banking Hub Visible</h4><p>${bankingVisible.length}</p></div>
            <div class="kpi"><h4>Mapped to Global COA</h4><p>${mappedAccounts.length}</p></div>
          </div>
          <p class="small">Banking Hub should not be driven by hardcoded labels. It should read governed accounts from this admin master, including future renamed Meezan or other bank accounts.</p>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="admin-accounts">
      <section class="card">
        <div class="card-head"><h3>Source Account Master</h3><span class="small">Govern bank, card, wallet, and source-ledger accounts</span></div>
        <div class="card-body">
          <div class="field-grid-2">
            <div class="field-stack">
              <label for="admin_account_select">Edit Existing Account</label>
              <select id="admin_account_select" class="field">
                <option value="">Create new account</option>
                ${accounts.map((row) => `<option value="${row.id}" ${accountDraft.accountId === row.id ? 'selected' : ''}>${row.entity || '-'} | ${row.name}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_account_name">Display Name</label>
              <input id="admin_account_name" class="field" value="${accountDraft.name || ''}" placeholder="Meezan Main PKR" />
            </div>
          </div>
          <div class="field-grid-4">
            <div class="field-stack">
              <label for="admin_account_provider">Provider</label>
              <input id="admin_account_provider" class="field" value="${accountDraft.provider || ''}" placeholder="Meezan / QBO / Wise" />
            </div>
            <div class="field-stack">
              <label for="admin_account_source_system">Source System</label>
              <input id="admin_account_source_system" class="field" value="${accountDraft.sourceSystem || ''}" placeholder="QBO / MANUAL / CSV" />
            </div>
            <div class="field-stack">
              <label for="admin_account_source_ledger">Source Ledger</label>
              <input id="admin_account_source_ledger" class="field" value="${accountDraft.sourceLedger || ''}" placeholder="QBO_US / PK_BOOKS" />
            </div>
            <div class="field-stack">
              <label for="admin_account_role">Account Role</label>
              <select id="admin_account_role" class="field">
                ${['BANK', 'CREDIT_CARD', 'WALLET', 'AR', 'AP', 'REVENUE', 'EXPENSE', 'EQUITY', 'FIXED_ASSET', 'OTHER_ASSET', 'OTHER_LIABILITY', 'OTHER'].map((value) => `<option value="${value}" ${accountDraft.accountRole === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-grid-4">
            <div class="field-stack">
              <label for="admin_account_entity">Entity</label>
              <select id="admin_account_entity" class="field">
                ${getEntityOptions().map((entity) => `<option value="${entity}" ${accountDraft.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_account_currency">Currency</label>
              <select id="admin_account_currency" class="field">
                ${['USD', 'GBP', 'PKR'].map((value) => `<option value="${value}" ${accountDraft.currency === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_account_notes">Notes / Purpose</label>
              <input id="admin_account_notes" class="field" value="${accountDraft.notes || ''}" placeholder="Pakistan operating account" />
            </div>
            <div class="field-stack">
              <label>Flags</label>
              <div class="action-row">
                <label class="small"><input id="admin_account_is_cash" type="checkbox" ${accountDraft.isCashAccount ? 'checked' : ''} /> Cash account</label>
                <label class="small"><input id="admin_account_show_banking" type="checkbox" ${accountDraft.showInBankingHub ? 'checked' : ''} /> Show in Banking Hub</label>
              </div>
            </div>
          </div>
          <div class="action-row">
            <button class="btn btn-primary" id="saveSourceAccountBtn">Save Source Account</button>
            <button class="action-btn" id="newSourceAccountBtn">New Account</button>
          </div>
        </div>
      </section>

      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Source Account Register</span>
            <h3>Governed Source Accounts</h3>
          </div>
          <div class="table-meta">${accounts.length} accounts</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Account</th><th>Source</th><th>Entity</th><th>Currency</th><th>Role</th><th>Banking Hub</th><th>Global Map</th></tr></thead>
              <tbody>
                ${accounts.map((row) => `
                  <tr data-admin-account="${row.id}">
                    <td><strong>${row.name}</strong><div class="small">${row.externalCode || row.externalName || '-'}</div></td>
                    <td>${row.sourceSystem}<div class="small">${row.sourceLedger || '-'}</div></td>
                    <td>${rowOrDash(row.entity)}</td>
                    <td>${row.currency}</td>
                    <td>${row.accountRole || '-'}</td>
                    <td><span class="badge ${row.showInBankingHub ? 'ok' : 'warn'}">${row.showInBankingHub ? 'VISIBLE' : 'HIDDEN'}</span></td>
                    <td>${row.mappedGlobalAccountCode ? `${row.mappedGlobalAccountCode} | ${row.mappedGlobalAccountName}` : '<span class="badge warn">UNMAPPED</span>'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">No source accounts.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="admin-global-chart">
      <section class="card">
        <div class="card-head"><h3>Global Chart of Accounts</h3><span class="small">Define the consolidated reporting chart</span></div>
        <div class="card-body">
          <div class="field-grid-2">
            <div class="field-stack">
              <label for="admin_global_select">Edit Existing Global Account</label>
              <select id="admin_global_select" class="field">
                <option value="">Create new global account</option>
                ${globals.map((row) => `<option value="${row.id}" ${globalDraft.globalAccountId === row.id ? 'selected' : ''}>${row.code} | ${row.name}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_global_code">Global Code</label>
              <input id="admin_global_code" class="field" value="${globalDraft.code || ''}" placeholder="1000" />
            </div>
          </div>
          <div class="field-grid-3">
            <div class="field-stack">
              <label for="admin_global_name">Account Name</label>
              <input id="admin_global_name" class="field" value="${globalDraft.name || ''}" placeholder="Cash and Cash Equivalents" />
            </div>
            <div class="field-stack">
              <label for="admin_global_type">Type</label>
              <select id="admin_global_type" class="field">
                ${['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'OTHER'].map((value) => `<option value="${value}" ${globalDraft.type === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_global_group">Reporting Group</label>
              <input id="admin_global_group" class="field" value="${globalDraft.reportingGroup || ''}" placeholder="Cash / Revenue / Payroll" />
            </div>
          </div>
          <div class="field-stack">
            <label for="admin_global_notes">Notes</label>
            <input id="admin_global_notes" class="field" value="${globalDraft.notes || ''}" placeholder="Used for consolidated treasury balances" />
          </div>
          <div class="action-row">
            <button class="btn btn-primary" id="saveGlobalAccountBtn">Save Global Account</button>
            <button class="action-btn" id="newGlobalAccountBtn">New Global Account</button>
          </div>
        </div>
      </section>

      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Consolidation Chart</span>
            <h3>Global COA Register</h3>
          </div>
          <div class="table-meta">${globals.length} global accounts</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Reporting Group</th><th>Status</th></tr></thead>
              <tbody>
                ${globals.map((row) => `
                  <tr data-admin-global="${row.id}">
                    <td><strong>${row.code}</strong></td>
                    <td>${row.name}</td>
                    <td>${row.type}</td>
                    <td>${rowOrDash(row.reportingGroup)}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No global chart accounts.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2 section-block" id="admin-mappings">
      <section class="card">
        <div class="card-head"><h3>Account Mapping Matrix</h3><span class="small">Map source accounts into the global reporting chart</span></div>
        <div class="card-body">
          <div class="field-grid-2">
            <div class="field-stack">
              <label for="admin_mapping_select">Edit Existing Mapping</label>
              <select id="admin_mapping_select" class="field">
                <option value="">Create new mapping</option>
                ${mappings.map((row) => `<option value="${row.id}" ${mappingDraft.mappingId === row.id ? 'selected' : ''}>${row.sourceAccount?.name || row.sourceAccountId} -> ${row.globalAccount?.code || row.globalAccountId}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_mapping_source">Source Account</label>
              <select id="admin_mapping_source" class="field">
                <option value="">Select source account</option>
                ${accounts.map((row) => `<option value="${row.id}" ${mappingDraft.sourceAccountId === row.id ? 'selected' : ''}>${row.entity || '-'} | ${row.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-grid-4">
            <div class="field-stack">
              <label for="admin_mapping_global">Global Account</label>
              <select id="admin_mapping_global" class="field">
                <option value="">Select global account</option>
                ${globals.map((row) => `<option value="${row.id}" ${mappingDraft.globalAccountId === row.id ? 'selected' : ''}>${row.code} | ${row.name}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_mapping_entity">Entity Override</label>
              <select id="admin_mapping_entity" class="field">
                <option value="">No override</option>
                ${getEntityOptions().map((entity) => `<option value="${entity}" ${mappingDraft.entityOverride === entity ? 'selected' : ''}>${entity}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_mapping_los">LOS Override</label>
              <select id="admin_mapping_los" class="field">
                <option value="">No override</option>
                ${['TRDEV', 'TRFINANCE', 'TRBUILD'].map((value) => `<option value="${value}" ${mappingDraft.lineOfServiceOverride === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
            <div class="field-stack">
              <label for="admin_mapping_bu">BU Override</label>
              <select id="admin_mapping_bu" class="field">
                <option value="">No override</option>
                ${(dimensions.businessUnit || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER']).map((value) => `<option value="${value}" ${mappingDraft.businessUnitOverride === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-stack">
            <label for="admin_mapping_notes">Notes</label>
            <input id="admin_mapping_notes" class="field" value="${mappingDraft.notes || ''}" placeholder="Use this for Pakistan operating account mapping" />
          </div>
          <div class="action-row">
            <button class="btn btn-primary" id="saveAccountMappingBtn">Save Mapping</button>
            <button class="action-btn" id="newAccountMappingBtn">New Mapping</button>
          </div>
        </div>
      </section>

      <section class="table-shell">
        <div class="table-shell__head">
          <div>
            <span class="eyebrow">Mapping Register</span>
            <h3>Source-to-Global Mapping Register</h3>
          </div>
          <div class="table-meta">${mappings.length} mappings</div>
        </div>
        <div class="table-shell__body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Source Account</th><th>Entity</th><th>Global Account</th><th>Overrides</th><th>Status</th></tr></thead>
              <tbody>
                ${mappings.map((row) => `
                  <tr data-admin-mapping="${row.id}">
                    <td>${row.sourceAccount?.name || row.sourceAccountId}</td>
                    <td>${row.sourceAccount?.entity || rowOrDash(row.entityOverride)}</td>
                    <td>${row.globalAccount ? `${row.globalAccount.code} | ${row.globalAccount.name}` : row.globalAccountId}</td>
                    <td>${[
                      row.entityOverride ? `Entity ${row.entityOverride}` : null,
                      row.lineOfServiceOverride ? `LOS ${row.lineOfServiceOverride}` : null,
                      row.businessUnitOverride ? `BU ${row.businessUnitOverride}` : null
                    ].filter(Boolean).join(' | ') || '-'}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No account mappings configured.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card section-block" id="admin-audit">
        <div class="card-head"><h3>Audit Log</h3><span class="small">System trace of finance actions</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Time</th><th>Module</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead>
              <tbody>
                ${(state.admin.audit || []).slice(0, 120).map((event) => `
                  <tr>
                    <td>${event.createdAt}</td>
                    <td>${event.module}</td>
                    <td>${event.action}</td>
                    <td>${event.entityType}:${event.entityId || '-'}</td>
                    <td>${event.actorUserId || '-'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No audit events.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="admin-notifications">
        <div class="card-head"><h3>Notification Queue</h3><span class="small">Workflow emails and outbound notices</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Status</th><th>Recipient</th><th>Subject</th><th>Attempts</th><th>Sent At</th></tr></thead>
              <tbody>
                ${(state.admin.notifications || []).slice(0, 120).map((n) => `
                  <tr>
                    <td><span class="badge ${badgeClass(n.status)}">${n.status}</span></td>
                    <td>${n.recipient}</td>
                    <td>${n.subject}</td>
                    <td>${n.attempts}</td>
                    <td>${rowOrDash(n.sentAt)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" class="muted">No notifications.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card section-block" id="admin-finance-model">
        <div class="card-head"><h3>Finance Model</h3><span class="small">Reporting currency, entity base currencies, and FX settings</span></div>
        <div class="card-body">
          <div class="field-grid-4">
            <div class="field-stack">
              <label for="admin_reporting_currency">Reporting Currency</label>
              <select id="admin_reporting_currency" class="field">
                ${['USD', 'GBP', 'PKR'].map((value) => `<option value="${value}" ${settings.reportingCurrency === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
            ${['US', 'UK', 'PK'].map((entity) => `
              <div class="field-stack">
                <label for="admin_entity_currency_${entity}">${entity} Base Currency</label>
                <select id="admin_entity_currency_${entity}" class="field">
                  ${['USD', 'GBP', 'PKR'].map((value) => `<option value="${value}" ${String(settings.entityBaseCurrencies?.[entity] || '') === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
              </div>
            `).join('')}
          </div>
          <div class="field-grid-3">
            ${['USD', 'GBP', 'PKR'].map((currency) => `
              <div class="field-stack">
                <label for="admin_fx_${currency}">${currency} Rate to USD</label>
                <input id="admin_fx_${currency}" class="field" type="number" step="0.0001" value="${settings.fxRatesToUSD?.[currency] ?? ''}" />
              </div>
            `).join('')}
          </div>
          <div class="action-row">
            <button class="btn btn-primary" id="saveFinanceModelBtn">Save Finance Model</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Entity</th><th>Base Currency</th></tr></thead>
              <tbody>
                ${Object.entries(settings.entityBaseCurrencies || {}).map(([entity, currency]) => `
                  <tr>
                    <td>${entity}</td>
                    <td>${currency}</td>
                  </tr>
                `).join('') || '<tr><td colspan="2" class="muted">No entity currency settings.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="table-wrap" style="margin-top:18px;">
            <table class="table">
              <thead><tr><th>Currency</th><th>FX Rate to USD</th></tr></thead>
              <tbody>
                ${Object.entries(settings.fxRatesToUSD || {}).map(([currency, rate]) => `
                  <tr>
                    <td>${currency}</td>
                    <td>${rate}</td>
                  </tr>
                `).join('') || '<tr><td colspan="2" class="muted">No FX settings.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card section-block" id="admin-adjustments">
        <div class="card-head"><h3>Management Adjustment Register</h3><span class="small">Reclasses sitting above source books</span></div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Entity</th><th>From</th><th>To</th><th>Partner</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                ${adjustments.slice(0, 120).map((row) => `
                  <tr>
                    <td>${row.effectiveDate || row.date || '-'}</td>
                    <td>${rowOrDash(row.entity)}</td>
                    <td>${rowOrDash(row.fromCategory)}</td>
                    <td>${rowOrDash(row.toCategory)}</td>
                    <td>${rowOrDash(row.partnerTag)}</td>
                    <td>${money(row.amount, row.currency || settings.reportingCurrency || 'USD')}</td>
                    <td><span class="badge ${badgeClass(row.status)}">${row.status}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="7" class="muted">No management adjustments recorded.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <div class="section-block" id="admin-health">${architectureView()}</div>
  `;
}

function currentTabView() {
  if (!canAccessTab(state.activeTab)) return overviewView();
  if (state.activeTab === 'banking') return bankingView();
  if (state.activeTab === 'treasury') return treasuryView();
  if (state.activeTab === 'quickbooks') return quickbooksView();
  if (state.activeTab === 'billing') return billingView();
  if (state.activeTab === 'payables') return payablesView();
  if (state.activeTab === 'tagging') return taggingView();
  if (state.activeTab === 'operations') return operationsView();
  if (state.activeTab === 'ventures') return venturesView();
  if (state.activeTab === 'ledger') return ledgerView();
  if (state.activeTab === 'reports') return reportsView();
  if (state.activeTab === 'close') return closeView();
  if (state.activeTab === 'admin' || state.activeTab === 'architecture') return adminView();
  return overviewView();
}

function appView() {
  return `
    <div class="app-shell">
      ${appHeader()}
      <main class="main">
        ${state.error ? `<div class="notice error">${state.error}</div>` : ''}
        ${state.notice ? `<div class="notice success">${state.notice}</div>` : ''}
        ${state.loading ? '<div class="notice success">Loading QuickBooks workspace...</div>' : ''}
        ${currentTabView()}
      </main>
    </div>
  `;
}

function bindAuthActions() {
  appEl.querySelectorAll('[data-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const persona = PERSONAS.find((p) => p.email === btn.getAttribute('data-persona'));
      if (!persona) return;
      login(persona.email, persona.password);
    });
  });

  appEl.querySelector('#loginBtn')?.addEventListener('click', () => {
    const email = appEl.querySelector('#email')?.value?.trim();
    const password = appEl.querySelector('#password')?.value || '';
    login(email, password);
  });

  appEl.querySelector('#googleBtn')?.addEventListener('click', () => {
    const token = appEl.querySelector('#googleToken')?.value?.trim();
    if (!token) {
      setError('Paste a Google ID token first.');
      render();
      return;
    }
    loginWithGoogleToken(token);
  });
}

function bindTagSelection() {
  appEl.querySelector('#tag_invoice')?.addEventListener('change', () => {
    const id = appEl.querySelector('#tag_invoice')?.value || '';
    const invoice = qboInvoices().find((row) => row.id === id);
    if (!invoice) return;
    state.taggingDraft = {
      invoiceId: invoice.id,
      lineOfService: invoice.lineOfService || '',
      businessUnit: invoice.businessUnit || '',
      entity: invoice.entity || '',
      channel: invoice.channel || '',
      notes: invoice.internalNotes || ''
    };
    render();
  });

  appEl.querySelectorAll('[data-tag-row]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-tag-row');
      const invoice = qboInvoices().find((item) => item.id === id);
      if (!invoice) return;
      state.taggingDraft = {
        invoiceId: invoice.id,
        lineOfService: invoice.lineOfService || '',
        businessUnit: invoice.businessUnit || '',
        entity: invoice.entity || '',
        channel: invoice.channel || '',
        notes: invoice.internalNotes || ''
      };
      render();
    });
  });
}

function selectTransactionForReview(transactionId) {
  const tx = transactionById(transactionId);
  if (!tx) return;
  state.transactionDraft = {
    transactionId: tx.id,
    category: tx.category || '',
    lineOfService: tx.lineOfService || '',
    businessUnit: tx.businessUnit || '',
    channel: tx.channel || '',
    partnerTag: tx.partnerTag || '',
    entity: tx.entity || '',
    treasuryFlag: Boolean(tx.treasuryFlag),
    intercompanyFlag: Boolean(tx.intercompanyFlag),
    capexFlag: Boolean(tx.capexFlag),
    reimbursable: Boolean(tx.reimbursable)
  };
}

function bindAppActions() {
  appEl.querySelectorAll('[data-primary-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-primary-nav');
      state.openPrimaryNav = key;
      render();
    });
  });

  appEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.getAttribute('data-tab');
      if (!canAccessTab(state.activeTab)) {
        state.activeTab = 'overview';
        setError('You do not have access to that workspace.');
        render();
        return;
      }
      state.openPrimaryNav = null;
      state.notice = null;
      state.error = null;
      render();
    });
  });

  appEl.querySelector('#logoutBtn')?.addEventListener('click', logout);
  appEl.querySelector('#reloadBtn')?.addEventListener('click', loadAll);

  appEl.querySelector('#global_search')?.addEventListener('input', () => {
    state.searchQuery = appEl.querySelector('#global_search')?.value || '';
    render();
  });

  appEl.querySelector('#ledger_object_type')?.addEventListener('change', () => {
    state.ledgerFilters.objectType = appEl.querySelector('#ledger_object_type')?.value || '';
    render();
  });

  appEl.querySelector('#tx_review_id')?.addEventListener('change', () => {
    const transactionId = appEl.querySelector('#tx_review_id')?.value || '';
    if (!transactionId) return;
    selectTransactionForReview(transactionId);
    render();
  });

  appEl.querySelectorAll('[data-tx-review]').forEach((row) => {
    row.addEventListener('click', () => {
      const transactionId = row.getAttribute('data-tx-review');
      if (!transactionId) return;
      selectTransactionForReview(transactionId);
      render();
    });
  });

  appEl.querySelector('#global_entity')?.addEventListener('change', () => {
    state.reportFilters.entity = appEl.querySelector('#global_entity')?.value || '';
    loadAll().then(() => {
      setNotice('Entity scope updated.');
      render();
    }).catch(() => {});
  });

  appEl.querySelectorAll('[data-rail-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-rail-select');
      const rail = configuredBankingRails().find((row) => row.key === key);
      if (!rail) return;
      state.bankingDraft = {
        ...state.bankingDraft,
        rail: rail.key,
        sourceAccountId: rail.sourceAccountId || rail.key,
        entity: rail.entity,
        currency: rail.currency,
        account: rail.label,
        source: rail.source
      };
      state.activeTab = 'banking';
      render();
    });
  });

  appEl.querySelector('#bill_vendor_id')?.addEventListener('change', () => {
    const vendorId = appEl.querySelector('#bill_vendor_id')?.value || '';
    const vendor = (state.vendors || []).find((row) => row.id === vendorId);
    if (!vendor) return;
    state.billDraft = {
      ...state.billDraft,
      vendorId,
      vendorName: vendor.name || '',
      entity: vendor.entity || state.billDraft.entity,
      currency: vendor.defaultCurrency || state.billDraft.currency
    };
    render();
  });

  appEl.querySelector('#ic_from_entity')?.addEventListener('change', () => {
    const fromEntity = appEl.querySelector('#ic_from_entity')?.value || 'US';
    const defaultAccount = sourceAccounts().find((row) => (
      String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
      && (Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
      && String(row.entity || '').toUpperCase() === String(fromEntity).toUpperCase()
    ));
    state.intercompanyDraft = {
      ...state.intercompanyDraft,
      fromEntity,
      sourceAccountId: defaultAccount?.id || state.intercompanyDraft.sourceAccountId,
      currency: defaultAccount?.currency || state.intercompanyDraft.currency
    };
    render();
  });

  appEl.querySelector('#bank_csv_file')?.addEventListener('change', async () => {
    const file = appEl.querySelector('#bank_csv_file')?.files?.[0];
    if (!file) return;
    const text = await file.text();
    state.bankingDraft.csv = text;
    const area = appEl.querySelector('#bank_csv');
    if (area) area.value = text;
  });

  appEl.querySelector('#importBankCsvBtn')?.addEventListener('click', async () => {
    try {
      const csv = appEl.querySelector('#bank_csv')?.value || '';
      const selectedRail = configuredBankingRails().find((row) => row.key === (state.bankingDraft?.rail || '')) || null;
      const account = appEl.querySelector('#bank_account')?.value?.trim() || selectedRail?.label || 'Unknown';
      const entity = appEl.querySelector('#bank_entity')?.value || 'PK';
      const currency = appEl.querySelector('#bank_currency')?.value || 'USD';
      const source = appEl.querySelector('#bank_source')?.value?.trim() || 'BANK_IMPORT';
      if (!csv.trim()) throw new Error('Paste or load a CSV statement first.');
      await api('/api/transactions/import', {
        method: 'POST',
        body: {
          sourceAccountId: selectedRail?.sourceAccountId || null,
          csv,
          account,
          entity,
          currency,
          source
        }
      });
      state.bankingDraft = {
        ...state.bankingDraft,
        sourceAccountId: selectedRail?.sourceAccountId || state.bankingDraft?.sourceAccountId || '',
        account,
        entity,
        currency,
        source,
        csv: ''
      };
      setNotice(`Imported statement rows into ${account}.`);
      await loadAll();
      state.activeTab = 'banking';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#connectQboBtn')?.addEventListener('click', async () => {
    try {
      const result = await api('/api/qbo/connect', { method: 'POST', body: {} });
      window.location.href = result.url;
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#pullFullQboBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/qbo/pull/full', {
        method: 'POST',
        body: {
          options: {
            includeCustomers: true,
            includeAccounts: true,
            includeInvoices: true,
            includePayments: true,
            includeTransactions: true
          }
        }
      });
      setNotice('QuickBooks full pull completed.');
      await loadAll();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#createInvoiceBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        projectId: appEl.querySelector('#bill_project')?.value || null,
        clientId: appEl.querySelector('#bill_client')?.value || null,
        clientName: appEl.querySelector('#bill_client_name')?.value?.trim() || null,
        issueDate: appEl.querySelector('#bill_issue_date')?.value || null,
        dueDate: appEl.querySelector('#bill_due_date')?.value || null,
        currency: appEl.querySelector('#bill_currency')?.value || 'USD',
        entity: appEl.querySelector('#bill_entity')?.value || null,
        businessUnit: appEl.querySelector('#bill_bu')?.value || 'SERVICES',
        lineOfService: appEl.querySelector('#bill_los')?.value || null,
        channel: appEl.querySelector('#bill_channel')?.value?.trim() || null,
        taxRate: Number(appEl.querySelector('#bill_tax_rate')?.value || 0),
        notes: appEl.querySelector('#bill_notes')?.value?.trim() || '',
        manualLines: [
          {
            description: appEl.querySelector('#bill_description')?.value?.trim() || '',
            qty: Number(appEl.querySelector('#bill_qty')?.value || 0),
            rate: Number(appEl.querySelector('#bill_rate')?.value || 0)
          }
        ]
      };
      if (!payload.manualLines[0].description || payload.manualLines[0].qty <= 0 || payload.manualLines[0].rate < 0) {
        throw new Error('Invoice line description, qty, and rate are required.');
      }
      if (!payload.projectId && !payload.clientId && !payload.clientName) {
        throw new Error('Select a project/client or provide client name.');
      }
      await api('/api/invoices', { method: 'POST', body: payload });
      state.billingDraft = {
        ...state.billingDraft,
        description: '',
        qty: 1,
        rate: '',
        notes: ''
      };
      setNotice('Invoice created.');
      await loadAll();
      state.activeTab = 'billing';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelectorAll('[data-invoice-submit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-submit');
      if (!invoiceId) return;
      try {
        await api(`/api/invoices/${invoiceId}/submit`, { method: 'POST', body: {} });
        setNotice(`Invoice ${invoiceId} submitted.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-approve');
      if (!invoiceId) return;
      try {
        await api(`/api/invoices/${invoiceId}/approve`, { method: 'POST', body: {} });
        setNotice(`Invoice ${invoiceId} approved.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-reject');
      if (!invoiceId) return;
      try {
        const reason = window.prompt('Rejection reason', 'Needs revision') || 'Needs revision';
        await api(`/api/invoices/${invoiceId}/reject`, { method: 'POST', body: { reason } });
        setNotice(`Invoice ${invoiceId} rejected.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-send]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-send');
      if (!invoiceId) return;
      try {
        await api(`/api/invoices/${invoiceId}/send`, { method: 'POST', body: {} });
        setNotice(`Invoice ${invoiceId} sent.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-sync]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-sync');
      if (!invoiceId) return;
      try {
        await api(`/api/qbo/sync/${invoiceId}`, { method: 'POST', body: {} });
        setNotice(`QBO sync requested for ${invoiceId}.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-pay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-pay');
      if (!invoiceId) return;
      const outstanding = Number(btn.getAttribute('data-outstanding') || 0);
      try {
        const amountInput = window.prompt('Payment amount', String(outstanding || '0'));
        if (amountInput == null) return;
        const amount = Number(amountInput);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount.');
        const reference = window.prompt('Payment reference', 'Manual payment') || 'Manual payment';
        await api('/api/payments', {
          method: 'POST',
          body: {
            invoiceId,
            amount,
            source: 'MANUAL',
            reference,
            paidAt: new Date().toISOString().slice(0, 10)
          }
        });
        setNotice(`Payment recorded for ${invoiceId}.`);
        await loadAll();
        state.activeTab = 'billing';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-invoice-preview]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const invoiceId = btn.getAttribute('data-invoice-preview');
      if (!invoiceId) return;
      try {
        const response = await fetch(`/api/invoices/${invoiceId}/preview`, {
          headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
        });
        if (!response.ok) throw new Error(`Preview failed (${response.status})`);
        const html = await response.text();
        const win = window.open('', '_blank');
        if (!win) throw new Error('Popup blocked by browser.');
        win.document.open();
        win.document.write(html);
        win.document.close();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelector('#runAutoMatchBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/reconciliation/auto-match', { method: 'POST', body: { tolerance: 1.5 } });
      setNotice('Auto-match completed.');
      await loadAll();
      state.activeTab = 'billing';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#createVendorBillBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        vendorId: appEl.querySelector('#bill_vendor_id')?.value || null,
        vendorName: appEl.querySelector('#bill_vendor_name')?.value?.trim() || null,
        billNumber: appEl.querySelector('#bill_number')?.value?.trim() || null,
        billDate: appEl.querySelector('#pay_bill_date')?.value || '',
        dueDate: appEl.querySelector('#pay_due_date')?.value || '',
        entity: appEl.querySelector('#pay_entity')?.value || 'US',
        currency: appEl.querySelector('#pay_currency')?.value || 'USD',
        category: appEl.querySelector('#pay_category')?.value?.trim() || 'Operating Expense',
        businessUnit: appEl.querySelector('#pay_bu')?.value || 'CORPORATE',
        lineOfService: appEl.querySelector('#pay_los')?.value || null,
        description: appEl.querySelector('#pay_description')?.value?.trim() || '',
        total: Number(appEl.querySelector('#pay_total')?.value || 0),
        notes: appEl.querySelector('#pay_notes')?.value?.trim() || ''
      };
      if (!payload.billDate || !payload.dueDate || !payload.total || (!payload.vendorId && !payload.vendorName)) {
        throw new Error('Vendor, bill dates, and amount are required.');
      }
      await api('/api/payables/bills', { method: 'POST', body: payload });
      state.billDraft = {
        ...state.billDraft,
        vendorId: '',
        vendorName: '',
        billNumber: '',
        description: '',
        total: '',
        notes: ''
      };
      setNotice('Draft vendor bill created.');
      await loadAll();
      state.activeTab = 'payables';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelectorAll('[data-bill-submit]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const billId = btn.getAttribute('data-bill-submit');
      if (!billId) return;
      try {
        await api(`/api/payables/bills/${billId}/submit`, { method: 'POST', body: {} });
        setNotice(`Vendor bill ${billId} submitted.`);
        await loadAll();
        state.activeTab = 'payables';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-bill-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const billId = btn.getAttribute('data-bill-approve');
      if (!billId) return;
      try {
        await api(`/api/payables/bills/${billId}/approve`, { method: 'POST', body: {} });
        setNotice(`Vendor bill ${billId} approved.`);
        await loadAll();
        state.activeTab = 'payables';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-bill-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const billId = btn.getAttribute('data-bill-reject');
      if (!billId) return;
      try {
        const reason = window.prompt('Rejection reason', 'Needs correction') || 'Needs correction';
        await api(`/api/payables/bills/${billId}/reject`, { method: 'POST', body: { reason } });
        setNotice(`Vendor bill ${billId} rejected.`);
        await loadAll();
        state.activeTab = 'payables';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-bill-pay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const billId = btn.getAttribute('data-bill-pay');
      const outstanding = Number(btn.getAttribute('data-outstanding') || 0);
      if (!billId) return;
      try {
        const amountInput = window.prompt('Payment amount', String(outstanding || '0'));
        if (amountInput == null) return;
        const amount = Number(amountInput);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount.');
        const railOptions = sourceAccounts()
          .filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
          .map((row) => `${row.id} | ${row.entity || '-'} | ${row.name}`)
          .join('\n');
        const sourceAccountId = window.prompt(`Source rail ID\n${railOptions}`, state.billDraft?.sourceAccountId || '');
        if (!sourceAccountId) throw new Error('Source rail is required.');
        const reference = window.prompt('Payment reference', `BILLPAY-${billId}`) || `BILLPAY-${billId}`;
        await api(`/api/payables/bills/${billId}/pay`, {
          method: 'POST',
          body: {
            amount,
            date: new Date().toISOString().slice(0, 10),
            sourceAccountId,
            reference
          }
        });
        setNotice(`Payment recorded for ${billId}.`);
        await loadAll();
        state.activeTab = 'payables';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelector('#createIntercompanyEntryBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        date: appEl.querySelector('#ic_date')?.value || '',
        fromEntity: appEl.querySelector('#ic_from_entity')?.value || 'US',
        toEntity: appEl.querySelector('#ic_to_entity')?.value || 'PK',
        currency: appEl.querySelector('#ic_currency')?.value || 'USD',
        amount: Number(appEl.querySelector('#ic_amount')?.value || 0),
        sourceAccountId: appEl.querySelector('#ic_source_account')?.value || null,
        reference: appEl.querySelector('#ic_reference')?.value?.trim() || '',
        reason: appEl.querySelector('#ic_reason')?.value?.trim() || 'Intercompany Funding',
        description: appEl.querySelector('#ic_description')?.value?.trim() || '',
        notes: appEl.querySelector('#ic_notes')?.value?.trim() || ''
      };
      if (!payload.date || !payload.amount || payload.fromEntity === payload.toEntity) {
        throw new Error('Valid date, amount, and different from/to entities are required.');
      }
      await api('/api/intercompany/entries', { method: 'POST', body: payload });
      state.intercompanyDraft = {
        ...state.intercompanyDraft,
        amount: '',
        reference: '',
        description: '',
        notes: ''
      };
      setNotice('Intercompany funding entry created.');
      await loadAll();
      state.activeTab = 'treasury';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelectorAll('[data-intercompany-settle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entryId = btn.getAttribute('data-intercompany-settle');
      if (!entryId) return;
      try {
        const railOptions = sourceAccounts()
          .filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount))
          .map((row) => `${row.id} | ${row.entity || '-'} | ${row.name}`)
          .join('\n');
        const sourceAccountId = window.prompt(`Settlement rail ID\n${railOptions}`, '') || '';
        if (!sourceAccountId) throw new Error('Settlement rail is required.');
        const reference = window.prompt('Settlement reference', `SETTLE-${entryId}`) || `SETTLE-${entryId}`;
        await api(`/api/intercompany/entries/${entryId}/settle`, {
          method: 'POST',
          body: {
            date: new Date().toISOString().slice(0, 10),
            sourceAccountId,
            reference
          }
        });
        setNotice(`Intercompany entry ${entryId} settled.`);
        await loadAll();
        state.activeTab = 'treasury';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-close-period]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const periodKey = btn.getAttribute('data-close-period');
      if (!periodKey) return;
      try {
        await api(`/api/close/periods/${periodKey}/close`, { method: 'POST', body: {} });
        setNotice(`Period ${periodKey} closed.`);
        await loadAll();
        state.activeTab = 'close';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelectorAll('[data-reopen-period]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const periodKey = btn.getAttribute('data-reopen-period');
      if (!periodKey) return;
      try {
        const notes = window.prompt('Reason for reopening', 'Reopen for correction') || 'Reopen for correction';
        await api(`/api/close/periods/${periodKey}/reopen`, { method: 'POST', body: { notes } });
        setNotice(`Period ${periodKey} reopened.`);
        await loadAll();
        state.activeTab = 'close';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  const exportInvoiceRegister = () => {
    const rows = (state.invoices || []).map((row) => ({
      invoiceNumber: row.invoiceNumber,
      issueDate: row.issueDate,
      dueDate: row.dueDate || '',
      client: row.clientName || '',
      entity: row.entity || '',
      currency: row.currency || '',
      status: row.status || '',
      total: row.total || 0,
      amountPaid: row.amountPaid || 0,
      outstanding: Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0),
      lineOfService: row.lineOfService || '',
      businessUnit: row.businessUnit || '',
      channel: row.channel || ''
    }));
    downloadCsvFile('invoice-register.csv', rows, ['invoiceNumber', 'issueDate', 'dueDate', 'client', 'entity', 'currency', 'status', 'total', 'amountPaid', 'outstanding', 'lineOfService', 'businessUnit', 'channel']);
    setNotice('Invoice register exported.');
    render();
  };

  appEl.querySelector('#exportInvoiceRegisterBtn')?.addEventListener('click', exportInvoiceRegister);
  appEl.querySelector('#exportInvoiceRegisterBtnSecondary')?.addEventListener('click', exportInvoiceRegister);

  const exportClientAr = () => {
    const rows = clientBillingAnalytics(state.invoices || []).map((row) => ({
      client: row.client,
      invoiceCount: row.invoiceCount,
      totalBilled: row.totalBilled,
      totalCollected: row.totalCollected,
      outstanding: row.outstanding,
      collectionPct: row.collectionPct,
      overdueCount: row.overdueCount
    }));
    downloadCsvFile('client-ar.csv', rows, ['client', 'invoiceCount', 'totalBilled', 'totalCollected', 'outstanding', 'collectionPct', 'overdueCount']);
    setNotice('Client AR exported.');
    render();
  };

  appEl.querySelector('#exportClientArBtn')?.addEventListener('click', exportClientAr);
  appEl.querySelector('#exportClientArBtnSecondary')?.addEventListener('click', exportClientAr);

  appEl.querySelector('#exportClientArReportBtn')?.addEventListener('click', () => {
    const rows = clientBillingAnalytics(reportScopedInvoices()).map((row) => ({
      client: row.client,
      invoiceCount: row.invoiceCount,
      totalBilled: row.totalBilled,
      totalCollected: row.totalCollected,
      outstanding: row.outstanding,
      collectionPct: row.collectionPct,
      overdueCount: row.overdueCount
    }));
    downloadCsvFile('report-client-ar.csv', rows, ['client', 'invoiceCount', 'totalBilled', 'totalCollected', 'outstanding', 'collectionPct', 'overdueCount']);
    setNotice('Report client AR exported.');
    render();
  });

  appEl.querySelector('#exportLosReportBtn')?.addEventListener('click', () => {
    const rows = (state.reports.qboRevenueByLos?.byEntityLineOfService || []).map((row) => ({
      entity: row.entity,
      lineOfService: row.lineOfService,
      invoiceCount: row.invoiceCount,
      revenue: row.revenue,
      collected: row.collected,
      openAr: row.openAr
    }));
    downloadCsvFile('report-revenue-by-los.csv', rows, ['entity', 'lineOfService', 'invoiceCount', 'revenue', 'collected', 'openAr']);
    setNotice('LOS report exported.');
    render();
  });

  appEl.querySelector('#saveTagsBtn')?.addEventListener('click', async () => {
    try {
      const invoiceId = appEl.querySelector('#tag_invoice')?.value || '';
      if (!invoiceId) throw new Error('Select an invoice first.');

      const payload = {
        lineOfService: appEl.querySelector('#tag_los')?.value || null,
        businessUnit: appEl.querySelector('#tag_bu')?.value?.trim() || null,
        entity: appEl.querySelector('#tag_entity')?.value || null,
        channel: appEl.querySelector('#tag_channel')?.value?.trim() || null,
        notes: appEl.querySelector('#tag_notes')?.value?.trim() || ''
      };

      await api(`/api/invoices/${invoiceId}/tags`, { method: 'PATCH', body: payload });
      setNotice('Invoice tags updated.');
      await loadAll();
      state.activeTab = 'tagging';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  const refreshReports = async () => {
    state.reportFilters.fromDate = appEl.querySelector('#report_from')?.value || state.reportFilters.fromDate || '';
    state.reportFilters.toDate = appEl.querySelector('#report_to')?.value || state.reportFilters.toDate || '';
    state.reportFilters.entity = appEl.querySelector('#report_entity')?.value || '';
    await loadAll();
    state.activeTab = 'reports';
    setNotice('Report filters applied.');
    render();
  };

  appEl.querySelector('#applyReportFiltersBtn')?.addEventListener('click', refreshReports);
  appEl.querySelector('#refreshReportPackBtn')?.addEventListener('click', refreshReports);
  appEl.querySelector('#printReportPackBtn')?.addEventListener('click', () => window.print());

  appEl.querySelector('#saveExpenseBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        date: appEl.querySelector('#exp_date')?.value || '',
        description: appEl.querySelector('#exp_description')?.value?.trim() || '',
        amount: Number(appEl.querySelector('#exp_amount')?.value || 0),
        currency: appEl.querySelector('#exp_currency')?.value || 'PKR',
        entity: appEl.querySelector('#exp_entity')?.value || 'PK',
        sourceAccountId: appEl.querySelector('#exp_source_account')?.value || null,
        account: sourceAccounts().find((row) => row.id === (appEl.querySelector('#exp_source_account')?.value || ''))?.name || state.expenseDraft?.account || 'Meezan PKR',
        category: appEl.querySelector('#exp_category')?.value || 'Operating Expense',
        businessUnit: appEl.querySelector('#exp_bu')?.value || 'CORPORATE',
        lineOfService: appEl.querySelector('#exp_los')?.value || null,
        employeeId: appEl.querySelector('#exp_employee')?.value || null,
        reimbursementNeeded: Boolean(appEl.querySelector('#exp_reimb_needed')?.checked),
        notes: appEl.querySelector('#exp_notes')?.value?.trim() || '',
        source: 'ERP_MANUAL'
      };
      if (!payload.date || !payload.description || !payload.amount) {
        throw new Error('date, description, and amount are required.');
      }
      await api('/api/expenses', { method: 'POST', body: payload });
      state.expenseDraft = {
        ...state.expenseDraft,
        sourceAccountId: payload.sourceAccountId || state.expenseDraft?.sourceAccountId || '',
        account: payload.account,
        description: '',
        amount: '',
        notes: ''
      };
      setNotice('Expense recorded.');
      await loadAll();
      state.activeTab = 'operations';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelectorAll('[data-refresh-reimbursements]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await loadAll();
      state.activeTab = 'operations';
      setNotice('Expenses and reimbursement queue refreshed.');
      render();
    });
  });

  appEl.querySelectorAll('[data-settle-reimbursement]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const expenseId = btn.getAttribute('data-settle-reimbursement');
      if (!expenseId) return;
      try {
        await api(`/api/reimbursements/${expenseId}/settle`, {
          method: 'POST',
          body: {
            date: new Date().toISOString().slice(0, 10),
            account: 'Meezan PKR',
            source: 'MEEZAN_REIMBURSEMENT'
          }
        });
        setNotice(`Reimbursement settled for ${expenseId}.`);
        await loadAll();
        state.activeTab = 'operations';
        render();
      } catch (error) {
        setError(error.message);
        render();
      }
    });
  });

  appEl.querySelector('#savePonchoBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        date: appEl.querySelector('#pon_date')?.value || '',
        amount: Number(appEl.querySelector('#pon_amount')?.value || 0),
        currency: appEl.querySelector('#pon_currency')?.value || 'GBP',
        entity: appEl.querySelector('#pon_entity')?.value || 'UK',
        reference: appEl.querySelector('#pon_reference')?.value?.trim() || '',
        channel: appEl.querySelector('#pon_channel')?.value?.trim() || null,
        invoiceId: appEl.querySelector('#pon_invoice_id')?.value || null,
        notes: appEl.querySelector('#pon_notes')?.value?.trim() || ''
      };
      if (!payload.date || !payload.reference || !payload.amount) throw new Error('date, amount, and reference are required.');
      await api('/api/poncho/settlements', { method: 'POST', body: payload });
      state.ponchoDraft = {
        ...state.ponchoDraft,
        amount: '',
        reference: '',
        invoiceId: '',
        notes: ''
      };
      setNotice('Poncho settlement recorded.');
      await loadAll();
      state.activeTab = 'ventures';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#saveTowerCostBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        date: appEl.querySelector('#tower_date')?.value || '',
        vendor: appEl.querySelector('#tower_vendor')?.value?.trim() || '',
        description: appEl.querySelector('#tower_description')?.value?.trim() || '',
        amount: Number(appEl.querySelector('#tower_amount')?.value || 0),
        currency: appEl.querySelector('#tower_currency')?.value || 'PKR',
        entity: appEl.querySelector('#tower_entity')?.value || 'PK',
        usefulLifeMonths: Number(appEl.querySelector('#tower_life')?.value || 60),
        status: appEl.querySelector('#tower_status')?.value || 'CAPITALIZED',
        notes: appEl.querySelector('#tower_notes')?.value?.trim() || ''
      };
      if (!payload.date || !payload.description || !payload.amount) throw new Error('date, description, and amount are required.');
      await api('/api/asar-tower/costs', { method: 'POST', body: payload });
      state.towerDraft = {
        ...state.towerDraft,
        vendor: '',
        description: '',
        amount: '',
        notes: ''
      };
      setNotice('ASAR tower capex recorded.');
      await loadAll();
      state.activeTab = 'ventures';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#saveTransactionClassificationBtn')?.addEventListener('click', async () => {
    try {
      const transactionId = appEl.querySelector('#tx_review_id')?.value || state.transactionDraft.transactionId || '';
      if (!transactionId) throw new Error('Select a transaction first.');
      await api(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        body: {
          category: appEl.querySelector('#tx_category')?.value || null,
          lineOfService: appEl.querySelector('#tx_los')?.value || null,
          entity: appEl.querySelector('#tx_entity')?.value || null,
          businessUnit: appEl.querySelector('#tx_business_unit')?.value?.trim() || null,
          channel: appEl.querySelector('#tx_channel')?.value?.trim() || null,
          partnerTag: appEl.querySelector('#tx_partner')?.value?.trim() || null,
          reimbursable: Boolean(appEl.querySelector('#tx_reimbursable')?.checked),
          treasuryFlag: Boolean(appEl.querySelector('#tx_treasury_flag')?.checked),
          intercompanyFlag: Boolean(appEl.querySelector('#tx_intercompany_flag')?.checked),
          capexFlag: Boolean(appEl.querySelector('#tx_capex_flag')?.checked)
        }
      });
      setNotice(`Transaction ${transactionId} updated.`);
      await loadAll();
      selectTransactionForReview(transactionId);
      state.activeTab = 'tagging';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#autoClassifyTransactionBtn')?.addEventListener('click', async () => {
    try {
      const transactionId = appEl.querySelector('#tx_review_id')?.value || state.transactionDraft.transactionId || '';
      if (!transactionId) throw new Error('Select a transaction first.');
      await api(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        body: {
          autoClassify: true,
          reimbursable: Boolean(appEl.querySelector('#tx_reimbursable')?.checked),
          partnerTag: appEl.querySelector('#tx_partner')?.value?.trim() || null,
          treasuryFlag: Boolean(appEl.querySelector('#tx_treasury_flag')?.checked),
          intercompanyFlag: Boolean(appEl.querySelector('#tx_intercompany_flag')?.checked),
          capexFlag: Boolean(appEl.querySelector('#tx_capex_flag')?.checked)
        }
      });
      setNotice(`Transaction ${transactionId} auto-classified.`);
      await loadAll();
      selectTransactionForReview(transactionId);
      state.activeTab = 'tagging';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#createClassificationRuleBtn')?.addEventListener('click', async () => {
    try {
      const pattern = appEl.querySelector('#rule_pattern')?.value?.trim() || '';
      const category = appEl.querySelector('#rule_category')?.value?.trim() || '';
      if (!pattern || !category) throw new Error('Pattern and category are required.');
      await api('/api/settings/classification-rules', {
        method: 'POST',
        body: { pattern, category }
      });
      state.ruleDraft = { pattern: '', category: 'Operating Expense' };
      setNotice('Classification rule created.');
      await loadAll();
      state.activeTab = 'tagging';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#refreshAdminBtn')?.addEventListener('click', async () => {
    await loadAll();
    state.activeTab = 'admin';
    setNotice('Admin controls refreshed.');
    render();
  });
  appEl.querySelector('#processNotificationsBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/notifications/process', { method: 'POST', body: {} });
      setNotice('Notification queue processed.');
      await loadAll();
      state.activeTab = 'admin';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#adminConnectQboBtn')?.addEventListener('click', async () => {
    try {
      const result = await api('/api/qbo/connect', { method: 'POST', body: {} });
      window.location.href = result.url;
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#adminPullFullQboBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/qbo/pull/full', {
        method: 'POST',
        body: {
          options: {
            includeCustomers: true,
            includeAccounts: true,
            includeInvoices: true,
            includePayments: true,
            includeTransactions: true
          }
        }
      });
      setNotice('QuickBooks full pull completed.');
      await loadAll();
      state.activeTab = 'admin';
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#admin_account_select')?.addEventListener('change', () => {
    const accountId = appEl.querySelector('#admin_account_select')?.value || '';
    if (!accountId) state.accountDraft = defaultAccountDraft();
    else loadAccountDraft(accountId);
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelectorAll('[data-admin-account]').forEach((row) => {
    row.addEventListener('click', () => {
      const accountId = row.getAttribute('data-admin-account');
      if (!accountId) return;
      loadAccountDraft(accountId);
      state.activeTab = 'admin';
      render();
    });
  });

  appEl.querySelector('#newSourceAccountBtn')?.addEventListener('click', () => {
    state.accountDraft = defaultAccountDraft();
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelector('#saveSourceAccountBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        name: appEl.querySelector('#admin_account_name')?.value?.trim() || '',
        provider: appEl.querySelector('#admin_account_provider')?.value?.trim() || 'MANUAL',
        sourceSystem: appEl.querySelector('#admin_account_source_system')?.value?.trim() || 'MANUAL',
        sourceLedger: appEl.querySelector('#admin_account_source_ledger')?.value?.trim() || 'MANUAL',
        accountRole: appEl.querySelector('#admin_account_role')?.value || 'BANK',
        entity: appEl.querySelector('#admin_account_entity')?.value || 'US',
        currency: appEl.querySelector('#admin_account_currency')?.value || 'USD',
        notes: appEl.querySelector('#admin_account_notes')?.value?.trim() || '',
        isCashAccount: Boolean(appEl.querySelector('#admin_account_is_cash')?.checked),
        showInBankingHub: Boolean(appEl.querySelector('#admin_account_show_banking')?.checked)
      };
      if (!payload.name) throw new Error('Display name is required.');
      const accountId = state.accountDraft?.accountId || '';
      const result = accountId
        ? await api(`/api/settings/accounts/${accountId}`, { method: 'PATCH', body: payload })
        : await api('/api/settings/accounts', { method: 'POST', body: payload });
      await loadAll();
      loadAccountDraft(result.account?.id || accountId);
      state.activeTab = 'admin';
      setNotice(`Source account ${accountId ? 'updated' : 'created'}.`);
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#admin_global_select')?.addEventListener('change', () => {
    const globalAccountId = appEl.querySelector('#admin_global_select')?.value || '';
    if (!globalAccountId) state.globalAccountDraft = defaultGlobalAccountDraft();
    else loadGlobalAccountDraft(globalAccountId);
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelectorAll('[data-admin-global]').forEach((row) => {
    row.addEventListener('click', () => {
      const globalAccountId = row.getAttribute('data-admin-global');
      if (!globalAccountId) return;
      loadGlobalAccountDraft(globalAccountId);
      state.activeTab = 'admin';
      render();
    });
  });

  appEl.querySelector('#newGlobalAccountBtn')?.addEventListener('click', () => {
    state.globalAccountDraft = defaultGlobalAccountDraft();
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelector('#saveGlobalAccountBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        code: appEl.querySelector('#admin_global_code')?.value?.trim() || '',
        name: appEl.querySelector('#admin_global_name')?.value?.trim() || '',
        type: appEl.querySelector('#admin_global_type')?.value || 'ASSET',
        reportingGroup: appEl.querySelector('#admin_global_group')?.value?.trim() || null,
        notes: appEl.querySelector('#admin_global_notes')?.value?.trim() || ''
      };
      if (!payload.code || !payload.name) throw new Error('Global code and account name are required.');
      const globalAccountId = state.globalAccountDraft?.globalAccountId || '';
      const result = globalAccountId
        ? await api(`/api/settings/global-chart-accounts/${globalAccountId}`, { method: 'PATCH', body: payload })
        : await api('/api/settings/global-chart-accounts', { method: 'POST', body: payload });
      await loadAll();
      loadGlobalAccountDraft(result.globalAccount?.id || globalAccountId);
      state.activeTab = 'admin';
      setNotice(`Global chart account ${globalAccountId ? 'updated' : 'created'}.`);
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#admin_mapping_select')?.addEventListener('change', () => {
    const mappingId = appEl.querySelector('#admin_mapping_select')?.value || '';
    if (!mappingId) state.mappingDraft = defaultMappingDraft();
    else loadMappingDraft(mappingId);
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelectorAll('[data-admin-mapping]').forEach((row) => {
    row.addEventListener('click', () => {
      const mappingId = row.getAttribute('data-admin-mapping');
      if (!mappingId) return;
      loadMappingDraft(mappingId);
      state.activeTab = 'admin';
      render();
    });
  });

  appEl.querySelector('#newAccountMappingBtn')?.addEventListener('click', () => {
    state.mappingDraft = defaultMappingDraft();
    state.activeTab = 'admin';
    render();
  });

  appEl.querySelector('#saveAccountMappingBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        sourceAccountId: appEl.querySelector('#admin_mapping_source')?.value || '',
        globalAccountId: appEl.querySelector('#admin_mapping_global')?.value || '',
        entityOverride: appEl.querySelector('#admin_mapping_entity')?.value || null,
        lineOfServiceOverride: appEl.querySelector('#admin_mapping_los')?.value || null,
        businessUnitOverride: appEl.querySelector('#admin_mapping_bu')?.value || null,
        notes: appEl.querySelector('#admin_mapping_notes')?.value?.trim() || ''
      };
      if (!payload.sourceAccountId || !payload.globalAccountId) {
        throw new Error('Source account and global account are required.');
      }
      const mappingId = state.mappingDraft?.mappingId || '';
      const result = mappingId
        ? await api(`/api/settings/account-mappings/${mappingId}`, { method: 'PATCH', body: payload })
        : await api('/api/settings/account-mappings', { method: 'POST', body: payload });
      await loadAll();
      loadMappingDraft(result.mapping?.id || mappingId);
      if (payload.sourceAccountId) loadAccountDraft(payload.sourceAccountId);
      state.activeTab = 'admin';
      setNotice(`Account mapping ${mappingId ? 'updated' : 'created'}.`);
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  appEl.querySelector('#saveFinanceModelBtn')?.addEventListener('click', async () => {
    try {
      const payload = {
        reportingCurrency: appEl.querySelector('#admin_reporting_currency')?.value || 'USD',
        entityBaseCurrencies: {
          US: appEl.querySelector('#admin_entity_currency_US')?.value || 'USD',
          UK: appEl.querySelector('#admin_entity_currency_UK')?.value || 'GBP',
          PK: appEl.querySelector('#admin_entity_currency_PK')?.value || 'PKR'
        },
        fxRatesToUSD: {
          USD: Number(appEl.querySelector('#admin_fx_USD')?.value || 1),
          GBP: Number(appEl.querySelector('#admin_fx_GBP')?.value || 1.27),
          PKR: Number(appEl.querySelector('#admin_fx_PKR')?.value || 0.0036)
        }
      };
      await api('/api/settings/finance-model', { method: 'PATCH', body: payload });
      await loadAll();
      state.activeTab = 'admin';
      setNotice('Finance model updated.');
      render();
    } catch (error) {
      setError(error.message);
      render();
    }
  });

  bindTagSelection();
}

function render() {
  appEl.innerHTML = state.token && state.user ? appView() : loginView();
  if (state.token && state.user) bindAppActions();
  else bindAuthActions();
}

await hydrateSession();
render();
