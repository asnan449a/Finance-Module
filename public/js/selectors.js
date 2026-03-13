import { money } from './utils/format.js';

export function bootstrapData(state) {
  return state.data.bootstrap || { users: [], clients: [], vendors: [], projects: [], accounts: [], classificationRules: [] };
}

export function sourceAccounts(state) {
  return state.data.financeModel?.sourceAccounts || bootstrapData(state).accounts || [];
}

export function globalAccounts(state) {
  return state.data.financeModel?.globalChartAccounts || [];
}

export function accountMappings(state) {
  return state.data.financeModel?.accountMappings || [];
}

export function entityOptions(state) {
  const model = state.data.financeModel?.dimensions?.entities;
  return Array.isArray(model) && model.length ? model : ['US', 'UK', 'PK'];
}

export function businessUnitOptions(state) {
  const values = state.data.financeModel?.dimensions?.businessUnits;
  return Array.isArray(values) && values.length ? values : ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER'];
}

export function categoryOptions(state) {
  const values = state.data.financeModel?.dimensions?.categories;
  if (Array.isArray(values) && values.length) return values;
  return ['Operating Expense', 'Payroll', 'Bank Fee', 'Capex', 'Treasury'];
}

export function employeeOptions(state) {
  return (bootstrapData(state).users || [])
    .filter((user) => ['ADMIN', 'ACCOUNTANT', 'PARTNER', 'PROJECT_MANAGER', 'EMPLOYEE'].includes(String(user.role || '').toUpperCase()))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function openInvoiceQueue(invoices) {
  return [...(invoices || [])]
    .filter((invoice) => ['APPROVED', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase()))
    .map((invoice) => ({
      ...invoice,
      outstanding: Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0)
    }))
    .filter((invoice) => invoice.outstanding > 0)
    .sort((a, b) => String(a.dueDate || a.issueDate || '').localeCompare(String(b.dueDate || b.issueDate || '')));
}

export function invoiceStats(invoices) {
  const rows = invoices || [];
  const summary = {
    draft: 0,
    pending: 0,
    approved: 0,
    sent: 0,
    overdue: 0,
    partial: 0,
    paid: 0,
    totalBilled: 0,
    totalCollected: 0,
    openAr: 0
  };
  for (const invoice of rows) {
    const status = String(invoice.status || '').toUpperCase();
    const total = Number(invoice.total || 0);
    const paid = Number(invoice.amountPaid || 0);
    summary.totalBilled += total;
    summary.totalCollected += paid;
    summary.openAr += Math.max(total - paid, 0);
    if (status === 'DRAFT') summary.draft += 1;
    if (status === 'PENDING_APPROVAL') summary.pending += 1;
    if (status === 'APPROVED') summary.approved += 1;
    if (status === 'SENT') summary.sent += 1;
    if (status === 'OVERDUE') summary.overdue += 1;
    if (status === 'PARTIAL') summary.partial += 1;
    if (status === 'PAID') summary.paid += 1;
  }
  return summary;
}

export function billStats(payables) {
  const summary = payables?.summary || {};
  return {
    openAp: Number(summary.totalOutstanding || 0),
    pending: Number(summary.pendingApprovalCount || 0),
    overdue: Number(summary.overdueCount || 0),
    totalBills: Number(summary.totalBills || 0),
    paidThisMonth: Number(summary.paidThisMonth || 0)
  };
}

export function railSummaries(state) {
  const accounts = sourceAccounts(state)
    .filter((row) => String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount));
  const transactions = state.data.transactions || [];
  return accounts.map((account) => {
    const rows = transactions.filter((tx) => String(tx.sourceAccountId || '') === String(account.id));
    const inflow = rows.filter((tx) => String(tx.type || '').toUpperCase() === 'CREDIT').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const outflow = rows.filter((tx) => String(tx.type || '').toUpperCase() === 'DEBIT').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const unmatched = rows.filter((tx) => Number(tx.remainingAmount || Math.abs(Number(tx.amount || 0))) > 0 && Number(tx.amount || 0) > 0).length;
    return {
      ...account,
      inflow,
      outflow,
      unmatched,
      rowCount: rows.length,
      rows
    };
  });
}

export function reconciliationQueueItems(state) {
  return state.data.reconciliationQueue?.items || [];
}

export function reconciliationQueueSummary(state) {
  return state.data.reconciliationQueue?.summary || {
    total: 0,
    unmatched: 0,
    suggested: 0,
    duplicates: 0,
    exceptions: 0,
    deferred: 0,
    cleared: 0,
    easyWins: 0,
    needsRemittance: 0,
    followUpRequired: 0,
    reviewedPending: 0,
    exactDuplicateSuspects: 0,
    dueDeferred: 0
  };
}

export function filteredReconciliationQueue(state) {
  const rows = reconciliationQueueItems(state);
  const filters = state.ui.filters.banking || {};
  const tab = state.ui.activeTabs.banking || 'suggested';
  const query = String(filters.query || '').trim().toLowerCase();
  const focus = String(filters.focus || 'ALL').toUpperCase();

  return rows
    .filter((row) => String(row.queueBucket || '').toLowerCase() === tab)
    .filter((row) => !filters.rail || filters.rail === 'ALL' || String(row.railId || '') === String(filters.rail))
    .filter((row) => filters.confidence === 'ALL' || String(row.confidenceLabel || '').toUpperCase() === String(filters.confidence || '').toUpperCase())
    .filter((row) => {
      if (filters.support === 'ALL') return true;
      if (filters.support === 'READY') return !row.needsRemittance;
      if (filters.support === 'NEEDS_REMITTANCE') return Boolean(row.needsRemittance);
      return true;
    })
    .filter((row) => {
      const issue = String(filters.issue || 'ALL').toUpperCase();
      if (issue === 'ALL') return true;
      if (issue === 'DUPLICATE') return Boolean(row.duplicateSuspect);
      if (issue === 'REMITTANCE') return Boolean(row.needsRemittance);
      if (issue === 'LOW_CONFIDENCE') return Number(row.confidenceScore || 0) > 0 && Number(row.confidenceScore || 0) < 65;
      if (issue === 'NO_CANDIDATE') return Number(row.suggestionCount || 0) === 0;
      if (issue === 'PARTIAL') return Number(row.matchedAmount || 0) > 0 && Number(row.remainingAmount || 0) > 0.01;
      if (issue === 'FLAGGED') return ['FLAG_EXCEPTION', 'FOLLOW_UP_REQUIRED'].includes(String(row.reconciliationDecision || '').toUpperCase());
      if (issue === 'FOLLOW_UP') return String(row.reviewState || '').toUpperCase() === 'FOLLOW_UP_REQUIRED';
      if (issue === 'DEFERRED') return String(row.reviewState || '').toUpperCase() === 'DEFERRED';
      return true;
    })
    .filter((row) => {
      if (focus === 'ALL') return true;
      if (focus === 'EASY_WINS') return Boolean(row.quickMatchAvailable);
      if (focus === 'URGENT') return String(row.priorityLabel || '').toUpperCase() === 'HIGH';
      if (focus === 'FOLLOW_UP') return String(row.reviewState || '').toUpperCase() === 'FOLLOW_UP_REQUIRED';
      if (focus === 'NEEDS_REMITTANCE') return Boolean(row.needsRemittance);
      if (focus === 'DUPLICATES') return Boolean(row.duplicateSuspect);
      if (focus === 'DEFERRED') return String(row.reviewState || '').toUpperCase() === 'DEFERRED';
      return true;
    })
    .filter((row) => {
      if (!query) return true;
      const hay = [
        row.reference,
        row.subject,
        row.counterparty,
        row.railName,
        row.entity,
        row.description,
        row.reconciliationReviewNote,
        row.followUpCategory,
        row.followUpOwnerName,
        ...(row.issueReasons || []),
        ...(row.topSuggestion?.reasons || [])
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(query);
    })
    .sort((a, b) => {
      const sort = String(filters.sort || 'priority').toLowerCase();
      if (sort === 'amount') return Number(b.remainingAmount || b.amount || 0) - Number(a.remainingAmount || a.amount || 0);
      if (sort === 'age') return Number(b.ageDays || 0) - Number(a.ageDays || 0);
      if (sort === 'confidence') return Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      if (sort === 'rail') return String(a.railName || '').localeCompare(String(b.railName || ''));
      if (sort === 'followup') {
        if (Number(a.deferSortKey || 0) !== Number(b.deferSortKey || 0)) return Number(a.deferSortKey || 0) - Number(b.deferSortKey || 0);
      }
      if (Number(b.priorityScore || 0) !== Number(a.priorityScore || 0)) return Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
      if (Number(b.quickMatchAvailable || 0) !== Number(a.quickMatchAvailable || 0)) return Number(b.quickMatchAvailable || 0) - Number(a.quickMatchAvailable || 0);
      if (Number(b.issueCount || 0) !== Number(a.issueCount || 0)) return Number(b.issueCount || 0) - Number(a.issueCount || 0);
      if (Number(b.ageDays || 0) !== Number(a.ageDays || 0)) return Number(b.ageDays || 0) - Number(a.ageDays || 0);
      return Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
    });
}

export function reconciliationTabCount(state, bucket) {
  return reconciliationQueueItems(state).filter((row) => String(row.queueBucket || '').toLowerCase() === bucket).length;
}

export function adjacentReconciliationQueueItem(state, transactionId, offset = 1) {
  const rows = filteredReconciliationQueue(state);
  const index = rows.findIndex((row) => String(row.transactionId || row.id) === String(transactionId));
  if (index === -1) return null;
  return rows[index + offset] || null;
}

export function controlTowerAlerts(state) {
  const qbo = state.data.qboStatus || {};
  const billing = invoiceStats(state.data.invoices || []);
  const payables = billStats(state.data.payables);
  const reconciliation = state.data.reconciliation?.summary || {};
  const reimbursements = state.data.reimbursements?.summary || {};
  const close = (state.data.closePeriods || [])[0] || null;
  const alerts = [];

  if (!qbo.connected) alerts.push({ area: 'QuickBooks', severity: 'danger', detail: 'QuickBooks is not connected.', action: 'Open Admin', route: '/admin' });
  if (billing.pending > 0) alerts.push({ area: 'Billing approvals', severity: 'warning', detail: `${billing.pending} invoices are waiting for approval.`, action: 'Open Billing', route: '/billing' });
  if (payables.pending > 0) alerts.push({ area: 'Payables approvals', severity: 'warning', detail: `${payables.pending} vendor bills are waiting for approval.`, action: 'Open Payables', route: '/payables' });
  if (Number(reconciliation.unmatchedTransactionCount || 0) > 0) alerts.push({ area: 'Cash matching', severity: 'warning', detail: `${reconciliation.unmatchedTransactionCount} incoming cash rows remain unmatched.`, action: 'Open Banking', route: '/banking' });
  if (Number(reimbursements.pendingCount || 0) > 0) alerts.push({ area: 'Reimbursements', severity: 'warning', detail: `${reimbursements.pendingCount} employee reimbursements are still pending.`, action: 'Open Spend', route: '/spend' });
  const blockers = (close?.checklist?.checks || []).filter((item) => !item.pass);
  if (close && blockers.length) alerts.push({ area: 'Month-end close', severity: 'warning', detail: `${blockers.length} blockers remain for ${close.periodKey}.`, action: 'Open Close', route: '/close' });

  return alerts;
}

export function clientAnalytics(invoices) {
  const map = new Map();
  for (const invoice of invoices || []) {
    const key = invoice.clientName || invoice.clientId || 'Unknown Client';
    if (!map.has(key)) {
      map.set(key, { client: key, invoiceCount: 0, totalBilled: 0, totalCollected: 0, outstanding: 0, overdueCount: 0 });
    }
    const row = map.get(key);
    const total = Number(invoice.total || 0);
    const paid = Number(invoice.amountPaid || 0);
    row.invoiceCount += 1;
    row.totalBilled += total;
    row.totalCollected += paid;
    row.outstanding += Math.max(total - paid, 0);
    if (String(invoice.status || '').toUpperCase() === 'OVERDUE') row.overdueCount += 1;
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      collectionPct: row.totalBilled > 0 ? Number(((row.totalCollected / row.totalBilled) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.totalBilled - a.totalBilled);
}

export function latestClosePeriod(state) {
  return [...(state.data.closePeriods || [])].sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')))[0] || null;
}

export function reportHighlights(state) {
  const management = state.data.reports.managementPl?.summary || {};
  const statements = state.data.reports.statutoryCashFlow || {};
  const los = state.data.reports.qboRevenueByLos?.summary || {};
  return {
    managementNet: money(management.net || 0, state.data.reports.managementPl?.reportingCurrency || 'USD'),
    closingCash: money(statements.closingBalance || 0),
    openAr: money(los.openAr || 0, state.data.reports.qboRevenueByLos?.reportingCurrency || 'USD')
  };
}
