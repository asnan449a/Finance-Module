import { request } from './api.js';
import { state, commit } from './store.js';

function reportQuery() {
  const filters = state.ui.filters.reports || {};
  const params = new URLSearchParams();
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.entity) params.set('entity', filters.entity);
  return params.toString();
}

async function loadBootstrap() {
  const bootstrap = await request('/api/finance/bootstrap');
  state.data.bootstrap = bootstrap;
  state.data.vendors = bootstrap.vendors || [];
  return bootstrap;
}

async function loadFinanceModel() {
  try {
    state.data.financeModel = await request('/api/settings/finance-model');
  } catch {
    state.data.financeModel = null;
  }
}

async function loadInvoices() {
  const payload = await request('/api/invoices');
  state.data.invoices = payload.invoices || [];
}

async function loadApprovalsQueue() {
  const payload = await request('/api/approvals/queue');
  state.data.approvals = {
    summary: payload.summary || null,
    items: payload.items || []
  };
}

async function loadPayables() {
  const payload = await request('/api/payables/bills');
  state.data.payables = {
    summary: payload.summary || null,
    aging: payload.aging || null,
    byVendor: payload.byVendor || [],
    bills: payload.bills || []
  };
}

async function loadTransactions() {
  const payload = await request('/api/transactions');
  state.data.transactions = payload.transactions || [];
}

async function loadReconciliation() {
  state.data.reconciliation = await request('/api/reconciliation/board');
}

async function loadReconciliationQueue() {
  const payload = await request('/api/reconciliation/queue');
  state.data.reconciliationQueue = {
    summary: payload.summary || null,
    items: payload.items || []
  };
}

async function loadTreasuryLedger() {
  const payload = await request('/api/intercompany/ledger');
  state.data.treasury = {
    summary: payload.summary || null,
    byPair: payload.byPair || [],
    entries: payload.entries || []
  };
}

async function loadExpenses() {
  const payload = await request('/api/expenses');
  state.data.expenses = payload.expenses || [];
}

async function loadReimbursements() {
  const payload = await request('/api/reimbursements');
  state.data.reimbursements = {
    summary: payload.summary || null,
    reimbursements: payload.reimbursements || [],
    byEmployee: payload.byEmployee || []
  };
}

async function loadClosePeriods() {
  const months = Number(state.ui.filters.close?.months || 8);
  const payload = await request(`/api/close/periods?months=${months}`);
  state.data.closePeriods = payload.periods || [];
  const focus = [...(state.data.closePeriods || [])].sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')))[0] || null;
  if (!focus?.periodKey) {
    state.data.closeRelatedParty = null;
    return;
  }
  state.data.closeRelatedParty = await request(`/api/close/related-party-reconciliation?periodKey=${focus.periodKey}`).catch(() => null);
}

async function loadJournals() {
  const filters = state.ui.filters.journals || {};
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.journalType && filters.journalType !== 'ALL') params.set('journalType', filters.journalType);
  if (filters.entity) params.set('entity', filters.entity);
  const payload = await request(`/api/journals${params.toString() ? `?${params.toString()}` : ''}`);
  state.data.journals = {
    summary: payload.summary || null,
    journals: payload.journals || []
  };
}

async function loadAccountingIntegrity() {
  state.data.accountingIntegrity = await request('/api/accounting/integrity?limit=75');
}

async function loadReports() {
  const query = reportQuery();
  const q = query ? `?${query}` : '';
  const pkTaxParams = new URLSearchParams();
  if (state.ui.filters.reports.fromDate) pkTaxParams.set('fromDate', state.ui.filters.reports.fromDate);
  if (state.ui.filters.reports.toDate) pkTaxParams.set('toDate', state.ui.filters.reports.toDate);
  pkTaxParams.set('entity', state.ui.filters.reports.entity || 'PK');
  const [
    statutoryPl,
    statutoryCashFlow,
    statutoryBalanceSheet,
    statutoryArAging,
    trialBalance,
    utilisation,
    managementPl,
    managementTreasury,
    managementUpwork,
    managementPartner,
    qboRevenueByLos,
    pkTax
  ] = await Promise.all([
    request(`/api/reports/pl${q}`),
    request(`/api/reports/cash-flow${q}`),
    request(`/api/reports/balance-sheet${q}`),
    request('/api/reports/ar-aging'),
    request(`/api/reports/trial-balance${q ? `${q}&asOfDate=${state.ui.filters.reports.toDate}` : `?asOfDate=${state.ui.filters.reports.toDate}`}`),
    request(`/api/reports/utilisation${q}`),
    request(`/api/reports/management/pl${q ? `${q}&includeIntercompany=false&includeCapex=true` : '?includeIntercompany=false&includeCapex=true'}`),
    request(`/api/reports/management/treasury${q}`),
    request(`/api/reports/management/upwork${q}`),
    request(`/api/reports/management/partner-ledger${q}`),
    request(`/api/reports/qbo/revenue-by-los${q}`),
    request(`/api/reports/pk-tax?${pkTaxParams.toString()}`).catch(() => null)
  ]);

  state.data.reports = {
      statutoryPl,
      statutoryCashFlow,
      statutoryBalanceSheet,
      statutoryArAging,
      trialBalance,
      utilisation,
      managementPl,
    managementTreasury,
    managementUpwork,
    managementPartner,
    qboRevenueByLos,
    pkTax
  };
}

async function loadQuickBooksStatus() {
  const [statusPayload, checklistPayload] = await Promise.all([
    request('/api/qbo/status'),
    request('/api/qbo/checklist').catch(() => ({ checklist: null }))
  ]);
  state.data.qboStatus = statusPayload.status || null;
  state.data.qboChecklist = checklistPayload.checklist || null;
}

async function loadQboTransactions() {
  const query = reportQuery();
  const q = query ? `?${query}&limit=1500` : '?limit=1500';
  state.data.qboTransactions = await request(`/api/qbo/transactions${q}`);
}

async function loadAdminData() {
  const [audit, notifications] = await Promise.all([
    request('/api/admin/audit-log').catch(() => ({ events: [] })),
    request('/api/admin/notifications').catch(() => ({ notifications: [] }))
  ]);
  state.data.admin = {
    audit: audit.events || [],
    notifications: notifications.notifications || []
  };
}

export async function loadWorkspace(routeId) {
  state.ui.workspaceLoading = true;
  state.ui.error = null;
  commit();

  try {
    const sharedTasks = [loadBootstrap()];
    if (['banking', 'spend', 'admin'].includes(routeId)) sharedTasks.push(loadFinanceModel());

    const workspaceTasks = {
      controlTower: [loadQuickBooksStatus(), loadInvoices(), loadPayables(), loadReconciliation(), loadReimbursements(), loadTreasuryLedger(), loadClosePeriods(), loadReports()],
      approvals: [loadBootstrap(), loadFinanceModel(), loadApprovalsQueue(), loadInvoices(), loadPayables(), loadExpenses(), loadReimbursements(), loadJournals(), loadClosePeriods()],
      billing: [loadBootstrap(), loadInvoices(), loadReconciliation(), loadQuickBooksStatus()],
      payables: [loadBootstrap(), loadPayables()],
      banking: [loadBootstrap(), loadFinanceModel(), loadTransactions(), loadReconciliation(), loadReconciliationQueue(), loadQboTransactions()],
      treasury: [loadBootstrap(), loadTreasuryLedger(), loadReports()],
      spend: [loadBootstrap(), loadFinanceModel(), loadExpenses(), loadReimbursements()],
      close: [loadBootstrap(), loadClosePeriods()],
      journals: [loadBootstrap(), loadFinanceModel(), loadJournals(), loadReports(), loadAccountingIntegrity()],
      reports: [loadBootstrap(), loadReports(), loadPayables(), loadQuickBooksStatus()],
      admin: [loadBootstrap(), loadFinanceModel(), loadQuickBooksStatus(), loadAdminData(), loadAccountingIntegrity()]
    };

    await Promise.all([...sharedTasks, ...(workspaceTasks[routeId] || [])]);
  } finally {
    state.ui.workspaceLoading = false;
    commit();
  }
}
