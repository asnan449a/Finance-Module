const listeners = new Set();

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export const state = {
  session: {
    token: localStorage.getItem('tr_finance_token') || null,
    user: null,
    authenticating: false
  },
  route: {
    path: window.location.pathname || '/control-tower'
  },
  ui: {
    appLoading: false,
    workspaceLoading: false,
    notice: null,
    error: null,
    globalSearch: '',
    drawer: null,
    modal: null,
    activeTabs: {
      approvals: 'all',
      billing: 'register',
      payables: 'register',
      banking: 'suggested',
      treasury: 'cash',
      spend: 'register',
      close: 'current',
      journals: 'register',
      reports: 'statements',
      admin: 'quickbooks'
    },
    selections: {
      billing: [],
      payables: [],
      banking: [],
      journals: []
    },
    filters: {
      approvals: { bucket: 'ALL', documentType: 'ALL', entity: '', priority: 'ALL', evidence: 'ALL', approvalStatus: 'ALL', age: 'ALL', sort: 'urgency', query: '' },
      billing: { status: 'ALL', entity: '', query: '', lineOfService: '' },
      payables: { status: 'ALL', entity: '', query: '' },
      banking: { rail: 'ALL', query: '', confidence: 'ALL', issue: 'ALL', support: 'ALL', focus: 'ALL', sort: 'priority' },
      treasury: { status: 'ALL', entity: '' },
      spend: { status: 'ALL', entity: 'PK', query: '' },
      close: { months: 8 },
      journals: { status: 'ALL', journalType: 'ALL', entity: '', query: '' },
      reports: { fromDate: `${new Date().getFullYear()}-01-01`, toDate: nowDate(), entity: '' },
      admin: { query: '' }
    }
  },
  data: {
    bootstrap: null,
    financeModel: null,
    qboStatus: null,
    qboChecklist: null,
    approvals: { summary: null, items: [] },
    invoices: [],
    reconciliation: null,
    reconciliationQueue: { summary: null, items: [] },
    payables: { summary: null, aging: null, byVendor: [], bills: [] },
    vendors: [],
    transactions: [],
    qboTransactions: null,
    treasury: { summary: null, byPair: [], entries: [] },
    treasuryReport: null,
    expenses: [],
    reimbursements: { summary: null, reimbursements: [], byEmployee: [] },
    closePeriods: [],
    closeRelatedParty: null,
    journals: { summary: null, journals: [] },
    accountingIntegrity: null,
    reports: {
      statutoryPl: null,
      statutoryCashFlow: null,
      statutoryBalanceSheet: null,
      statutoryArAging: null,
      trialBalance: null,
      utilisation: null,
      managementPl: null,
      managementTreasury: null,
      managementUpwork: null,
      managementPartner: null,
      qboRevenueByLos: null,
      pkTax: null
    },
    admin: {
      audit: [],
      notifications: []
    }
  },
  drafts: {
    invoice: {
      projectId: '',
      clientId: '',
      clientName: '',
      issueDate: nowDate(),
      dueDate: addDays(14),
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
    bill: {
      vendorId: '',
      vendorName: '',
      billNumber: '',
      billDate: nowDate(),
      dueDate: addDays(14),
      entity: 'PK',
      currency: 'PKR',
      category: 'Operating Expense',
      businessUnit: 'CORPORATE',
      lineOfService: '',
      description: '',
      total: '',
      notes: ''
    },
    intercompany: {
      date: nowDate(),
      fromEntity: 'US',
      toEntity: 'PK',
      currency: 'USD',
      amount: '',
      sourceAccountId: '',
      receivingSourceAccountId: '',
      reference: '',
      reason: 'Intercompany Funding',
      description: '',
      notes: ''
    },
    expense: {
      date: nowDate(),
      description: '',
      amount: '',
      currency: 'PKR',
      entity: 'PK',
      sourceAccountId: '',
      account: '',
      category: 'Operating Expense',
      businessUnit: 'CORPORATE',
      lineOfService: '',
      employeeId: '',
      reimbursementNeeded: true,
      notes: ''
    },
    journal: {
      postingDate: nowDate(),
      entity: 'US',
      currency: 'USD',
      journalType: 'MANUAL',
      memo: ''
    },
    qboPull: {
      fromDate: '',
      toDate: '',
      includeCustomers: true,
      includeInvoices: true,
      includePayments: true,
      includeAccounts: true,
      includeTransactions: true
    },
    openingBalance: {
      asOfDate: '2025-12-31',
      entity: 'PK',
      currency: 'PKR',
      memo: 'Opening balances as of 2025-12-31',
      notes: '',
      csv: 'accountCode,side,amount,description\n1000,DEBIT,0,Cash opening balance\n2010,CREDIT,0,Payroll payable opening balance'
    },
    payrollRun: {
      month: String(new Date().getMonth() + 1).padStart(2, '0'),
      year: String(new Date().getFullYear()),
      entity: 'PK',
      currency: 'PKR',
      csv: 'userId,basicPay,allowances,bonus,overtime,taxableReimbursements,nonTaxableReimbursements,otherDeductions,currency\nUSR-2,250000,25000,0,0,0,0,0,PKR'
    },
    bankImport: {
      rail: 'ALL',
      sourceAccountId: '',
      entity: 'PK',
      currency: 'PKR',
      account: '',
      source: 'BANK_IMPORT',
      csv: ''
    }
  }
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function commit() {
  listeners.forEach((listener) => listener(state));
}

export function mutate(mutator) {
  mutator(state);
  commit();
}

export function setNotice(message) {
  state.ui.notice = message;
  state.ui.error = null;
  commit();
}

export function setError(message) {
  state.ui.error = message;
  state.ui.notice = null;
  commit();
}

export function clearFeedback() {
  state.ui.notice = null;
  state.ui.error = null;
}

export function resetSelections(scope) {
  if (scope && state.ui.selections[scope]) state.ui.selections[scope] = [];
  commit();
}
