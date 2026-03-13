export function makeApprovalMatrix() {
  return {
    rules: [
      { documentType: 'INVOICE', entity: '*', minAmount: 0, maxAmount: 5000, approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 0, evidenceRequiredActions: [], requiredEvidenceCategories: [] },
      { documentType: 'INVOICE', entity: '*', minAmount: 5000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 0, evidenceRequiredActions: [], requiredEvidenceCategories: [] },
      { documentType: 'VENDOR_BILL', entity: '*', minAmount: 0, maxAmount: 5000, approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT'] },
      { documentType: 'VENDOR_BILL', entity: '*', minAmount: 5000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'US', minAmount: 0, maxAmount: 1000, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'US', minAmount: 1000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'UK', minAmount: 0, maxAmount: 1000, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'UK', minAmount: 1000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'PK', minAmount: 0, maxAmount: 250000, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'EXPENSE', entity: 'PK', minAmount: 250000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT'] },
      { documentType: 'CUSTOMER_RECEIPT', entity: '*', minAmount: 0, maxAmount: 5000, approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'], posterRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['POST'], requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT'] },
      { documentType: 'CUSTOMER_RECEIPT', entity: '*', minAmount: 5000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'PARTNER'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['POST'], requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT'] },
      { documentType: 'VENDOR_PAYMENT', entity: '*', minAmount: 0, maxAmount: 5000, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['POST'], requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT'] },
      { documentType: 'VENDOR_PAYMENT', entity: '*', minAmount: 5000.01, maxAmount: null, approverRoles: ['ADMIN', 'PARTNER'], posterRoles: ['ADMIN', 'PARTNER'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['POST'], requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT'] },
      { documentType: 'REIMBURSEMENT', entity: '*', minAmount: 0, maxAmount: null, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['SETTLE'], requiredEvidenceCategories: ['RECEIPT', 'SUPPORT', 'PAYMENT_SUPPORT'] },
      { documentType: 'JOURNAL', entity: '*', minAmount: 0, maxAmount: null, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: true, minEvidenceCount: 0, evidenceRequiredActions: [], requiredEvidenceCategories: [] },
      { documentType: 'CLOSE_PERIOD', entity: '*', minAmount: 0, maxAmount: null, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['APPROVE'], requiredEvidenceCategories: ['CLOSE_SUPPORT', 'CLOSE_MEMO'] },
      { documentType: 'REOPEN_PERIOD', entity: '*', minAmount: 0, maxAmount: null, approverRoles: ['ADMIN', 'ACCOUNTANT'], posterRoles: ['ADMIN', 'ACCOUNTANT'], makerChecker: false, minEvidenceCount: 1, evidenceRequiredActions: ['REOPEN'], requiredEvidenceCategories: ['REOPEN_SUPPORT', 'CLOSE_SUPPORT'] }
    ]
  };
}

export function makeGlobalChart() {
  return [
    { id: 'GLA-1', code: '1000', name: 'Cash and Cash Equivalents', type: 'ASSET', reportingGroup: 'Cash' },
    { id: 'GLA-2', code: '1010', name: 'Cash Clearing / Undeposited Funds', type: 'ASSET', reportingGroup: 'Working Capital' },
    { id: 'GLA-14', code: '1020', name: 'Intercompany Clearing', type: 'ASSET', reportingGroup: 'Intercompany' },
    { id: 'GLA-3', code: '1100', name: 'Accounts Receivable', type: 'ASSET', reportingGroup: 'Working Capital' },
    { id: 'GLA-4', code: '1200', name: 'Due from Related Parties', type: 'ASSET', reportingGroup: 'Related Party' },
    { id: 'GLA-5', code: '1500', name: 'Capital Projects / Tower', type: 'ASSET', reportingGroup: 'Capex' },
    { id: 'GLA-6', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', reportingGroup: 'Working Capital' },
    { id: 'GLA-7', code: '2100', name: 'Credit Cards and Card Payables', type: 'LIABILITY', reportingGroup: 'Treasury' },
    { id: 'GLA-15', code: '2200', name: 'Due to Related Parties', type: 'LIABILITY', reportingGroup: 'Related Party' },
    { id: 'GLA-8', code: '3000', name: 'Partner Capital and Drawings', type: 'EQUITY', reportingGroup: 'Equity' },
    { id: 'GLA-9', code: '4000', name: 'Services Revenue', type: 'INCOME', reportingGroup: 'Revenue' },
    { id: 'GLA-10', code: '4100', name: 'Product / App Revenue', type: 'INCOME', reportingGroup: 'Revenue' },
    { id: 'GLA-11', code: '5000', name: 'Operating Expense', type: 'EXPENSE', reportingGroup: 'Operating Expense' },
    { id: 'GLA-12', code: '5100', name: 'Payroll Expense', type: 'EXPENSE', reportingGroup: 'Payroll' },
    { id: 'GLA-13', code: '5200', name: 'Bank Fees', type: 'EXPENSE', reportingGroup: 'Treasury' }
  ];
}

export function makeDb(overrides = {}) {
  return {
    settings: {
      reportingCurrency: 'USD',
      entityBaseCurrencies: { US: 'USD', UK: 'GBP', PK: 'PKR' },
      fxRatesToUSD: { USD: 1, GBP: 1.25, PKR: 0.0035 },
      approvalMatrix: makeApprovalMatrix(),
      activeApprovalMatrixVersionId: 'AMV-0001',
      ...(overrides.settings || {})
    },
    sequences: {
      JOURNAL: 100,
      JOURNAL_NUMBER: 100,
      JOURNAL_LINE: 100,
      EVIDENCE: 100,
      APPROVAL_EVENT: 100,
      APPROVAL_MATRIX_VERSION: 1,
      ...(overrides.sequences || {})
    },
    globalChartAccounts: overrides.globalChartAccounts || makeGlobalChart(),
    journals: [],
    invoices: [],
    payments: [],
    vendorBills: [],
    expenses: [],
    transactions: [],
    intercompanyEntries: [],
    partnerDraws: [],
    asarTowerCosts: [],
    payrollRuns: [],
    payrollItems: [],
    ponchoSettlements: [],
    accounts: [],
    closePeriods: [],
    evidenceRecords: [],
    approvalEvents: [],
    approvalMatrixVersions: [{
      id: 'AMV-0001',
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveAt: '2026-03-01T00:00:00Z',
      changedByUserId: null,
      changeReason: 'Seed default approval policy',
      rules: makeApprovalMatrix().rules,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z'
    }],
    users: [
      { id: 'USR-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN' },
      { id: 'USR-2', name: 'Accountant User', email: 'accountant@example.com', role: 'ACCOUNTANT' },
      { id: 'USR-3', name: 'Partner User', email: 'partner@example.com', role: 'PARTNER' },
      { id: 'USR-4', name: 'Project Manager', email: 'pm@example.com', role: 'PROJECT_MANAGER' }
    ],
    projects: [],
    ...overrides
  };
}
