import { request } from './api.js';
import { loginWithGoogle, loginWithPassword, hydrateSession, logout } from './auth.js';
import { drawerView, appShell, loginView, modalView } from './components/layout.js';
import { badge } from './components/primitives.js';
import { getRouteByPath, getAllowedRoutes, getDefaultPath } from './config/routes.js';
import { loadWorkspace } from './data.js';
import { ensureRouteForRole, getCurrentRoute, initRouter, navigate } from './router.js';
import {
  adjacentReconciliationQueueItem,
  sourceAccounts,
  globalAccounts,
  accountMappings,
  entityOptions,
  businessUnitOptions,
  categoryOptions,
  employeeOptions,
  bootstrapData,
  filteredReconciliationQueue
} from './selectors.js';
import {
  state,
  subscribe,
  mutate,
  commit,
  setNotice,
  setError,
  clearFeedback,
  resetSelections
} from './store.js';
import { downloadCsv, escapeHtml, money, number, rowOrDash, shortDate } from './utils/format.js';
import { renderAdmin } from './pages/admin.js';
import { renderApprovals } from './pages/approvals.js';
import { renderBanking } from './pages/banking.js';
import { renderBilling } from './pages/billing.js';
import { renderClose } from './pages/close.js';
import { renderControlTower } from './pages/controlTower.js';
import { renderJournals } from './pages/journals.js';
import { renderPayables } from './pages/payables.js';
import { renderReports } from './pages/reports.js';
import { renderSpend } from './pages/spend.js';
import { renderTreasury } from './pages/treasury.js';

const pages = {
  controlTower: renderControlTower,
  approvals: renderApprovals,
  billing: renderBilling,
  payables: renderPayables,
  banking: renderBanking,
  treasury: renderTreasury,
  spend: renderSpend,
  close: renderClose,
  journals: renderJournals,
  reports: renderReports,
  admin: renderAdmin
};

let root = null;
let workspaceRequestId = 0;
const financeManageRoles = ['ADMIN', 'ACCOUNTANT'];
const financeApproveRoles = ['ADMIN', 'ACCOUNTANT', 'PARTNER'];
const billingCreateRoles = ['ADMIN', 'ACCOUNTANT', 'PROJECT_MANAGER'];

function activeRouteId() {
  return getCurrentRoute().id;
}

function currentRouteMeta() {
  return getCurrentRoute();
}

function financeModel() {
  return state.data.financeModel || { settings: {}, dimensions: {}, sourceAccounts: [], globalChartAccounts: [], accountMappings: [] };
}

function clients() {
  return bootstrapData(state).clients || [];
}

function vendors() {
  return state.data.vendors || bootstrapData(state).vendors || [];
}

function projects() {
  return bootstrapData(state).projects || [];
}

function users() {
  return bootstrapData(state).users || [];
}

function findInvoice(invoiceId) {
  return (state.data.invoices || []).find((row) => String(row.id) === String(invoiceId)) || null;
}

function findBill(billId) {
  return (state.data.payables?.bills || []).find((row) => String(row.id) === String(billId)) || null;
}

function findCustomerReceipt(paymentId) {
  return (state.data.invoices || [])
    .flatMap((invoice) => invoice.payments || [])
    .find((row) => String(row.id) === String(paymentId)) || null;
}

function findVendorPayment(paymentId) {
  return (state.data.payables?.bills || [])
    .flatMap((bill) => bill.payments || [])
    .find((row) => String(row.id) === String(paymentId)) || null;
}

function findTransaction(transactionId) {
  return (state.data.transactions || []).find((row) => String(row.id) === String(transactionId)) || null;
}

function findReconciliationQueueItem(transactionId) {
  return (state.data.reconciliationQueue?.items || []).find((row) => String(row.transactionId || row.id) === String(transactionId)) || null;
}

function currentBankingQueueRows() {
  return filteredReconciliationQueue(state);
}

function findAdjacentBankingQueueItem(transactionId, offset = 1) {
  return adjacentReconciliationQueueItem(state, transactionId, offset);
}

function findExpense(expenseId) {
  return (state.data.expenses || []).find((row) => String(row.id) === String(expenseId))
    || (state.data.reimbursements?.reimbursements || []).find((row) => String(row.id) === String(expenseId))
    || null;
}

function findIntercompany(entryId) {
  return (state.data.treasury?.entries || []).find((row) => String(row.id) === String(entryId)) || null;
}

function findClosePeriod(periodKey) {
  return (state.data.closePeriods || []).find((row) => String(row.periodKey) === String(periodKey)) || null;
}

function findCloseCleanupException(exceptionId) {
  return (state.data.closeRelatedParty?.cleanupExceptions || []).find((row) => String(row.id) === String(exceptionId)) || null;
}

function findJournal(journalId) {
  return (state.data.journals?.journals || []).find((row) => String(row.id) === String(journalId)) || null;
}

function findSourceAccount(accountId) {
  return sourceAccounts(state).find((row) => String(row.id) === String(accountId)) || null;
}

function findGlobalAccount(globalAccountId) {
  return globalAccounts(state).find((row) => String(row.id) === String(globalAccountId)) || null;
}

function findAccountMapping(mappingId) {
  return accountMappings(state).find((row) => String(row.id) === String(mappingId)) || null;
}

function findEvidenceRecord(evidenceId) {
  const all = [
    ...(state.data.invoices || []).flatMap((row) => row.evidenceRecords || []),
    ...(state.data.invoices || []).flatMap((row) => (row.payments || []).flatMap((payment) => payment.evidenceRecords || [])),
    ...((state.data.payables?.bills || []).flatMap((row) => row.evidenceRecords || [])),
    ...((state.data.payables?.bills || []).flatMap((row) => (row.payments || []).flatMap((payment) => payment.evidenceRecords || []))),
    ...(state.data.expenses || []).flatMap((row) => row.evidenceRecords || []),
    ...((state.data.reimbursements?.reimbursements || []).flatMap((row) => row.evidenceRecords || [])),
    ...((state.data.closePeriods || []).flatMap((row) => row.evidenceRecords || [])),
    ...((state.data.journals?.journals || []).flatMap((row) => row.evidenceRecords || []))
  ];
  return all.find((row) => String(row.id) === String(evidenceId)) || null;
}

function allowedSourceAccounts({ entity = '', currency = '', roles = [] } = {}) {
  return sourceAccounts(state)
    .filter((row) => String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .filter((row) => !entity || String(row.entity || '').toUpperCase() === String(entity).toUpperCase())
    .filter((row) => !currency || String(row.currency || '').toUpperCase() === String(currency).toUpperCase())
    .filter((row) => !roles.length || roles.includes(String(row.accountRole || '').toUpperCase()));
}

function cashRailsForBanking(entity = '', currency = '') {
  return allowedSourceAccounts({ entity, currency }).filter((row) => Boolean(row.showInBankingHub) || Boolean(row.isCashAccount));
}

function openInvoicesForMatching(transaction) {
  const currency = String(transaction?.currency || '').toUpperCase();
  const queueItem = findReconciliationQueueItem(transaction?.id);
  const rankedSuggestions = new Map((queueItem?.suggestions || []).map((row, index) => [row.invoiceId, index]));
  return (state.data.invoices || [])
    .filter((invoice) => ['APPROVED', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase()))
    .filter((invoice) => !currency || String(invoice.currency || '').toUpperCase() === currency)
    .map((invoice) => ({
      ...invoice,
      outstanding: Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0),
      suggestionRank: rankedSuggestions.has(invoice.id) ? rankedSuggestions.get(invoice.id) : null,
      suggestion: (queueItem?.suggestions || []).find((row) => row.invoiceId === invoice.id) || null
    }))
    .filter((invoice) => invoice.outstanding > 0)
    .sort((a, b) => {
      if (a.suggestionRank != null && b.suggestionRank == null) return -1;
      if (a.suggestionRank == null && b.suggestionRank != null) return 1;
      if (a.suggestionRank != null && b.suggestionRank != null) return a.suggestionRank - b.suggestionRank;
      return String(a.dueDate || a.issueDate || '').localeCompare(String(b.dueDate || b.issueDate || ''));
    });
}

function selectedIds(scope) {
  return state.ui.selections[scope] || [];
}

function setModal(modal) {
  state.ui.modal = modal;
  commit();
}

function closeModal() {
  state.ui.modal = null;
  commit();
}

function setDrawer(drawer) {
  state.ui.drawer = drawer;
  commit();
}

function closeDrawer() {
  state.ui.drawer = null;
  commit();
}

function infoGrid(items) {
  return `
    <dl class="info-grid">
      ${items.map((item) => `
        <div class="info-grid__item">
          <dt>${escapeHtml(item.label)}</dt>
          <dd>${item.value}</dd>
        </div>
      `).join('')}
    </dl>
  `;
}

function detailSection(title, content) {
  return `
    <section class="detail-section">
      <h4>${escapeHtml(title)}</h4>
      ${content}
    </section>
  `;
}

function detailTable(columns, rows) {
  return `
    <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

function journalLineageSection(lineage = []) {
  if (!Array.isArray(lineage) || !lineage.length) return '<p class="muted-copy">No journals are linked to this source record yet.</p>';
  return detailTable(
    ['Journal', 'Stage', 'Date', 'Status'],
    lineage.map((journal) => `
      <tr data-open-drawer="journal:${journal.id}">
        <td><strong>${escapeHtml(journal.journalNumber || journal.id)}</strong><br/><span class="muted-copy">${escapeHtml(journal.sourceType || '—')}</span></td>
        <td>${escapeHtml(rowOrDash(journal.sourceStage))}</td>
        <td>${escapeHtml(shortDate(journal.postingDate))}</td>
        <td>${escapeHtml(rowOrDash(journal.status))}</td>
      </tr>
    `)
  );
}

function accountingSection(accounting, currency = 'USD') {
  if (!accounting) return '<p class="muted-copy">No accounting status is attached to this source record yet.</p>';
  const issueRows = (accounting.issues || []).length
    ? detailTable(
        ['Severity', 'Code', 'Message'],
        (accounting.issues || []).map((row) => `
          <tr>
            <td>${escapeHtml(row.severity || 'INFO')}</td>
            <td>${escapeHtml(row.code || 'ISSUE')}</td>
            <td>${escapeHtml(row.message || '—')}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No accounting-integrity issues are currently attached to this workflow.</p>';
  const postingRows = (accounting.postings || []).length
    ? detailTable(
        ['Posting', 'Stage', 'Accounting', 'Expected', 'Journal'],
        (accounting.postings || []).map((row) => `
          <tr>
            <td><strong>${escapeHtml(row.label || row.sourceType || 'Posting')}</strong><br/><span class="muted-copy">${escapeHtml(`${row.sourceType || '—'}:${row.sourceId || '—'}`)}</span></td>
            <td>${escapeHtml(row.sourceStage || '—')}</td>
            <td>${escapeHtml(row.accountingStatus || '—')}</td>
            <td>${money(row.expectedAmount || 0, row.currency || currency)}</td>
            <td>${row.journalId ? `<span data-open-drawer="journal:${escapeHtml(row.journalId)}"><strong>${escapeHtml(row.journalNumber || row.journalId)}</strong></span>` : '<span class="muted-copy">Missing</span>'}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No posting contracts are attached to this workflow.</p>';
  return `
    ${infoGrid([
      { label: 'Accounting status', value: escapeHtml(rowOrDash(accounting.accountingStatus)) },
      { label: 'Expected postings', value: escapeHtml(String(accounting.expectedCount || 0)) },
      { label: 'Posted postings', value: escapeHtml(String(accounting.postedCount || 0)) },
      { label: 'Missing postings', value: escapeHtml(String(accounting.missingCount || 0)) },
      { label: 'Issue count', value: escapeHtml(String(accounting.issueCount || 0)) }
    ])}
    ${detailSection('Posting contracts', postingRows)}
    ${detailSection('Integrity issues', issueRows)}
  `;
}

function reconciliationHistorySection(queueItem) {
  if (!queueItem?.reviewTrail?.length) return '<p class="muted-copy">No reconciliation review history is attached to this transaction yet.</p>';
  return detailTable(
    ['At', 'Action', 'Reviewer', 'Follow-up', 'Note'],
    queueItem.reviewTrail.map((entry) => `
      <tr>
        <td>${escapeHtml(shortDate(entry.createdAt))}</td>
        <td>${escapeHtml(String(entry.action || '').replace(/_/g, ' '))}</td>
        <td>${escapeHtml(displayUser(entry.actorUserId))}</td>
        <td>${escapeHtml([entry.category, entry.deferredUntil].filter(Boolean).join(' · ') || '—')}</td>
        <td>${escapeHtml(rowOrDash(entry.note))}</td>
      </tr>
    `)
  );
}

function currentUserRole() {
  return String(state.session.user?.role || '').toUpperCase();
}

function canWriteEvidence(entityType) {
  const userRole = currentUserRole();
  const normalized = String(entityType || '').toUpperCase();
  if (normalized === 'INVOICE') return billingCreateRoles.includes(userRole);
  if (normalized === 'CUSTOMER_RECEIPT') return financeApproveRoles.includes(userRole);
  return financeManageRoles.includes(userRole);
}

function buildDrawerRefForEntity(entityType, entityId) {
  const normalized = String(entityType || '').toUpperCase();
  if (normalized === 'INVOICE') return `invoice:${entityId}`;
  if (normalized === 'CUSTOMER_RECEIPT') return `customer-receipt:${entityId}`;
  if (normalized === 'VENDOR_BILL') return `bill:${entityId}`;
  if (normalized === 'VENDOR_PAYMENT') return `vendor-payment:${entityId}`;
  if (normalized === 'EXPENSE') return `expense:${entityId}`;
  if (normalized === 'JOURNAL') return `journal:${entityId}`;
  if (normalized === 'CLOSE_PERIOD') return `period:${entityId}`;
  return null;
}

function displayUser(userId) {
  if (!userId) return 'SYSTEM';
  const user = users().find((row) => String(row.id) === String(userId));
  return user ? `${user.name} (${user.role})` : userId;
}

function fileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function approvalSection(approval) {
  if (!approval) return '<p class="muted-copy">No approval policy is attached to this record.</p>';
  const policy = approval.policy || null;
  const history = approval.history || [];
  const evidenceTone = approval.evidenceSatisfied ? 'success' : 'warning';
  const historyMarkup = history.length
    ? `
        <div class="timeline-list">
          ${history.map((row) => `
            <article class="timeline-item">
              <div class="timeline-item__top">
                <div>
                  <strong>${escapeHtml(row.action || '—')}</strong>
                  <div class="timeline-item__meta">${escapeHtml(displayUser(row.actorUserId))} · ${escapeHtml(row.actorRole || 'SYSTEM')}</div>
                </div>
                <div class="timeline-item__meta">${escapeHtml(shortDate(row.createdAt))}</div>
              </div>
              <div class="timeline-item__support">
                ${badge(row.statusAfter || 'OPEN', ['APPROVED', 'POSTED'].includes(String(row.statusAfter || '').toUpperCase()) ? 'success' : (String(row.statusAfter || '').toUpperCase() === 'REJECTED' ? 'danger' : 'warning'))}
                ${badge(`${row.qualifiedEvidenceCount ?? row.evidenceCount ?? 0} / ${row.policySnapshot?.minEvidenceCount || 0} support`, (row.qualifiedEvidenceCount ?? row.evidenceCount ?? 0) >= Number(row.policySnapshot?.minEvidenceCount || 0) ? 'success' : 'warning')}
                <span class="filter-chip filter-chip--muted">Policy v${escapeHtml(String(row.policySnapshot?.versionNumber || '—'))}</span>
              </div>
              <div class="timeline-item__note">
                ${escapeHtml(row.note || 'No note provided.')}
                <br />
                <span class="muted-copy">${escapeHtml((row.policySnapshot?.requiredEvidenceCategories || []).join(', ') || 'No category-specific evidence rule')}</span>
              </div>
            </article>
          `).join('')}
        </div>
      `
    : '<p class="muted-copy">No approval actions have been recorded yet.</p>';

  return `
    ${infoGrid([
      { label: 'Operational status', value: escapeHtml(rowOrDash(approval.operationalStatus)) },
      { label: 'Approval status', value: badge(approval.approvalStatus || 'OPEN', ['APPROVED', 'POSTED'].includes(String(approval.approvalStatus || '').toUpperCase()) ? 'success' : (String(approval.approvalStatus || '').toUpperCase() === 'REJECTED' ? 'danger' : 'warning')) },
      { label: 'Evidence', value: `${badge(`${approval.qualifiedEvidenceCount ?? approval.evidenceCount ?? 0} / ${approval.minEvidenceCount || 0}`, evidenceTone)}${!approval.evidenceSatisfied ? '<br/><span class="muted-copy">More support is required before the next approval action.</span>' : ''}` },
      { label: 'Approver roles', value: escapeHtml(policy?.approverRoles?.join(', ') || '—') },
      { label: 'Poster roles', value: escapeHtml(policy?.posterRoles?.join(', ') || '—') },
      { label: 'Maker-checker', value: policy?.makerChecker ? 'Required' : 'Not required' },
      { label: 'Evidence categories', value: escapeHtml(policy?.requiredEvidenceCategories?.join(', ') || 'Any support') },
      { label: 'Policy version', value: escapeHtml(policy?.versionNumber ? `v${policy.versionNumber} · ${shortDate(policy.effectiveAt)}` : '—') }
    ])}
    ${detailSection('Approval history', historyMarkup)}
  `;
}

function evidenceSection(records = [], { entityType, entityId, control = null } = {}) {
  const canWrite = canWriteEvidence(entityType) && Boolean(control?.removalAllowed !== false || control?.supersedeAllowed !== false);
  const uploadAction = canWrite
    ? `<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}">Add evidence</button>`
    : '';
  const warning = control?.protectedState
    ? `<p class="notice notice--warning">${escapeHtml(control.protectedReason || 'Evidence is locked for this protected finance record.')}</p>`
    : '';
  if (!records.length) {
    return `
      <div class="stack-copy">
        ${warning}
        <p class="muted-copy">No evidence is linked to this record yet.</p>
        ${uploadAction}
      </div>
    `;
  }
  return `
    ${warning}
    ${uploadAction}
    <div class="evidence-list">
      ${records.map((record) => `
        <article class="evidence-item">
          <div class="evidence-item__top">
            <div>
              <strong>${escapeHtml(record.fileName || record.id)}</strong>
              <div class="evidence-item__meta">${escapeHtml(fileSize(record.fileSize))} · ${escapeHtml(record.mimeType || '—')}</div>
            </div>
            <div class="evidence-item__support">
              ${badge(record.category || 'SUPPORT', 'neutral')}
              ${badge(record.status || 'ACTIVE', String(record.status || '').toUpperCase() === 'ACTIVE' ? 'success' : 'warning')}
            </div>
          </div>
          <div class="evidence-item__meta">Uploaded ${escapeHtml(shortDate(record.uploadedAt))} by ${escapeHtml(displayUser(record.uploadedByUserId))}</div>
          <div class="evidence-item__note">${escapeHtml(record.note || 'No support note provided.')}</div>
          <div class="drawer-actions drawer-actions--compact">
            <button class="button button--ghost" data-action="download-evidence" data-id="${record.id}">Download</button>
            ${canWrite && control?.removalAllowed !== false ? `<button class="button button--ghost" data-action="open-evidence-remove" data-id="${record.id}" data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}">Remove</button>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read attachment.'));
    reader.readAsDataURL(file);
  });
}

async function optionalEvidencePayload(form, {
  fileFieldId,
  categoryFieldId,
  noteFieldId
} = {}) {
  const file = form.querySelector(`#${fileFieldId}`)?.files?.[0];
  if (!file) return null;
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64: await fileToBase64(file),
    category: form.querySelector(`#${categoryFieldId}`)?.value || 'SUPPORT',
    note: form.querySelector(`#${noteFieldId}`)?.value || ''
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'download.bin';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function selectOptions(rows, getValue, getLabel, selected = '', includeBlankLabel = '') {
  const options = [];
  if (includeBlankLabel) options.push(`<option value="">${escapeHtml(includeBlankLabel)}</option>`);
  for (const row of rows) {
    const value = String(getValue(row));
    options.push(`<option value="${escapeHtml(value)}" ${String(selected) === value ? 'selected' : ''}>${escapeHtml(getLabel(row))}</option>`);
  }
  return options.join('');
}

function inputField({ id, label, type = 'text', value = '', placeholder = '', step = null, min = null, required = false, hint = '' }) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input id="${id}" name="${id}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${step != null ? `step="${step}"` : ''} ${min != null ? `min="${min}"` : ''} ${required ? 'required' : ''} />
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function textAreaField({ id, label, value = '', placeholder = '', hint = '' }) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <textarea id="${id}" name="${id}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function selectField({ id, label, options, hint = '' }) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select id="${id}" name="${id}">${options}</select>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function checkboxField({ id, label, checked = false, hint = '' }) {
  return `
    <label class="checkbox-inline checkbox-inline--field">
      <input id="${id}" name="${id}" type="checkbox" ${checked ? 'checked' : ''} />
      <span>${escapeHtml(label)}</span>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function formActions(formId, submitLabel, secondary = 'Cancel') {
  return `
    <button class="button button--ghost" type="button" data-action="close-modal">${escapeHtml(secondary)}</button>
    <button class="button button--primary" type="submit" form="${formId}">${escapeHtml(submitLabel)}</button>
  `;
}

function noticeFromError(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function activeFilterQuery(routeId) {
  if (routeId === 'approvals') return state.ui.filters.approvals.query || '';
  if (routeId === 'billing') return state.ui.filters.billing.query || '';
  if (routeId === 'payables') return state.ui.filters.payables.query || '';
  if (routeId === 'banking') return state.ui.filters.banking.query || '';
  if (routeId === 'spend') return state.ui.filters.spend.query || '';
  if (routeId === 'journals') return state.ui.filters.journals.query || '';
  return state.ui.globalSearch || '';
}

function syncSearchToWorkspace(value) {
  const routeId = activeRouteId();
  const query = String(value || '');
  mutate((draft) => {
    draft.ui.globalSearch = query;
    if (routeId === 'approvals') draft.ui.filters.approvals.query = query;
    if (routeId === 'billing') draft.ui.filters.billing.query = query;
    if (routeId === 'payables') draft.ui.filters.payables.query = query;
    if (routeId === 'banking') draft.ui.filters.banking.query = query;
    if (routeId === 'spend') draft.ui.filters.spend.query = query;
    if (routeId === 'journals') draft.ui.filters.journals.query = query;
    if (routeId === 'admin') draft.ui.filters.admin.query = query;
  });
}

function currentWorkspaceRenderer() {
  const route = currentRouteMeta();
  return pages[route.id] || renderControlTower;
}

function render() {
  if (!root) return;
  if (!state.session.user) {
    root.innerHTML = loginView(state.session.authenticating);
    return;
  }

  const route = currentRouteMeta();
  const renderer = currentWorkspaceRenderer();
  const content = renderer(state);
  root.innerHTML = appShell({
    user: state.session.user,
    currentRoute: route,
    notice: state.ui.notice,
    error: state.ui.error,
    content,
    drawer: drawerView(state.ui.drawer),
    modal: modalView(state.ui.modal),
    workspaceLoading: state.ui.workspaceLoading
  });

  const search = root.querySelector('#global_search');
  if (search) search.value = activeFilterQuery(route.id);
}

function rowsForExport(scope) {
  if (scope === 'billing') {
    return (state.data.invoices || []).map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      client: invoice.clientName,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      entity: invoice.entity,
      currency: invoice.currency,
      status: invoice.status,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      outstanding: Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0)
    }));
  }
  return [];
}

async function refreshCurrentWorkspace({ notice = null, reopenDrawerRef = null } = {}) {
  const requestId = ++workspaceRequestId;
  const route = currentRouteMeta();
  try {
    await loadWorkspace(route.id);
    if (requestId !== workspaceRequestId) return;
    if (notice) setNotice(notice);
    if (reopenDrawerRef) await openDrawerByRef(reopenDrawerRef, { preserveModal: false });
  } catch (error) {
    if (requestId !== workspaceRequestId) return;
    setError(noticeFromError(error, 'Failed to refresh workspace.'));
  }
}

async function onRouteChange() {
  if (!state.session.user) {
    render();
    return;
  }
  ensureRouteForRole();
  const route = currentRouteMeta();
  state.ui.drawer = null;
  state.ui.modal = null;
  commit();
  await refreshCurrentWorkspace();
}

function invoiceDrawer(invoice) {
  const outstanding = Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0);
  const actionButtons = [];
  const role = String(state.session.user?.role || '').toUpperCase();
  if (['ADMIN', 'ACCOUNTANT', 'PROJECT_MANAGER'].includes(role) && ['DRAFT', 'REJECTED'].includes(String(invoice.status || '').toUpperCase())) {
    actionButtons.push(`<button class="button button--ghost" data-action="invoice-submit" data-id="${invoice.id}">Submit</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role) && ['DRAFT', 'PENDING_APPROVAL'].includes(String(invoice.status || '').toUpperCase())) {
    actionButtons.push(`<button class="button button--ghost" data-action="invoice-approve" data-id="${invoice.id}">Approve</button>`);
    actionButtons.push(`<button class="button button--ghost" data-action="open-invoice-reject" data-id="${invoice.id}">Reject</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role) && ['APPROVED', 'SENT', 'PARTIAL', 'OVERDUE', 'PAID'].includes(String(invoice.status || '').toUpperCase())) {
    actionButtons.push(`<button class="button button--ghost" data-action="invoice-send" data-id="${invoice.id}">Send</button>`);
    actionButtons.push(`<button class="button button--ghost" data-action="invoice-sync-qbo" data-id="${invoice.id}">Sync QBO</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role) && outstanding > 0.01) {
    actionButtons.push(`<button class="button button--primary" data-action="open-invoice-payment" data-id="${invoice.id}">Record payment</button>`);
  }
  if (canWriteEvidence('INVOICE') && invoice.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="INVOICE" data-entity-id="${invoice.id}">Add evidence</button>`);
  }
  actionButtons.push(`<button class="button button--ghost" data-action="invoice-preview" data-id="${invoice.id}">Preview</button>`);

  const paymentRows = (invoice.payments || []).length
    ? detailTable(
        ['Date', 'Source', 'Reference', 'Approval', 'Evidence', 'Amount'],
        invoice.payments.map((payment) => `
          <tr data-open-drawer="customer-receipt:${payment.id}">
            <td>${escapeHtml(shortDate(payment.paidAt))}</td>
            <td>${escapeHtml(payment.source || 'MANUAL')}</td>
            <td>${escapeHtml(rowOrDash(payment.reference))}</td>
            <td>${badge(payment.approval?.approvalStatus || payment.approvalStatus || 'PENDING', ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(String(payment.approval?.approvalStatus || payment.approvalStatus || '').toUpperCase()) ? 'success' : 'warning')}</td>
            <td>${badge(String(payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0), (payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0) > 0 ? 'success' : 'warning')}</td>
            <td>${money(payment.amount, payment.currency || invoice.currency)}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No payments have been applied yet.</p>';

  const lineRows = (invoice.lineItems || []).map((line) => `
    <tr>
      <td>${escapeHtml(line.description || 'Line item')}</td>
      <td>${number(line.qty || 0)}</td>
      <td>${money(line.rate || 0, invoice.currency)}</td>
      <td>${money(line.amount || 0, invoice.currency)}</td>
    </tr>
  `);

  const qboRows = (invoice.qboSyncLogs || []).length
    ? detailTable(
        ['At', 'Status', 'Action', 'Message'],
        invoice.qboSyncLogs.slice(-6).reverse().map((row) => `
          <tr>
            <td>${escapeHtml(shortDate(row.createdAt))}</td>
            <td>${escapeHtml(row.status || '—')}</td>
            <td>${escapeHtml(row.action || '—')}</td>
            <td>${escapeHtml(row.errorMessage || row.qboId || '—')}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No QuickBooks sync log is attached to this invoice yet.</p>';

  return {
    eyebrow: 'Billing record',
    title: invoice.invoiceNumber || invoice.id,
    subtitle: `${invoice.clientName || 'Unknown client'} · ${invoice.entity || '—'} · ${invoice.currency || '—'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Status', value: `<span>${escapeHtml(invoice.status || 'DRAFT')}</span>` },
        { label: 'Issue date', value: escapeHtml(shortDate(invoice.issueDate)) },
        { label: 'Due date', value: escapeHtml(shortDate(invoice.dueDate)) },
        { label: 'Total', value: money(invoice.total || 0, invoice.currency) },
        { label: 'Paid', value: money(invoice.amountPaid || 0, invoice.currency) },
        { label: 'Outstanding', value: money(outstanding, invoice.currency) },
        { label: 'Entity', value: escapeHtml(rowOrDash(invoice.entity)) },
        { label: 'LOS', value: escapeHtml(rowOrDash(invoice.lineOfService)) },
        { label: 'Business unit', value: escapeHtml(rowOrDash(invoice.businessUnit)) },
        { label: 'Channel', value: escapeHtml(rowOrDash(invoice.channel)) }
      ]))}
      ${detailSection('Line items', lineRows.length ? detailTable(['Description', 'Qty', 'Rate', 'Amount'], lineRows) : '<p class="muted-copy">No invoice lines found.</p>')}
      ${detailSection('Payments', paymentRows)}
      ${detailSection('Approval', approvalSection(invoice.approval))}
      ${detailSection('Evidence', evidenceSection(invoice.evidenceRecords, { entityType: 'INVOICE', entityId: invoice.id, control: invoice.evidenceControl }))}
      ${detailSection('Accounting', accountingSection(invoice.accounting, invoice.currency))}
      ${detailSection('Journal lineage', journalLineageSection(invoice.journalLineage))}
      ${detailSection('QuickBooks sync', qboRows)}
      ${invoice.notes || invoice.internalNotes ? detailSection('Notes', `
        <div class="stack-copy">
          ${invoice.notes ? `<p><strong>Customer note</strong><br/>${escapeHtml(invoice.notes)}</p>` : ''}
          ${invoice.internalNotes ? `<p><strong>Internal note</strong><br/>${escapeHtml(invoice.internalNotes)}</p>` : ''}
        </div>
      `) : ''}
    `,
    footer: `<div class="drawer-actions">${actionButtons.join('')}</div>`
  };
}

function billDrawer(bill) {
  const role = String(state.session.user?.role || '').toUpperCase();
  const actionButtons = [];
  if (['ADMIN', 'ACCOUNTANT'].includes(role) && String(bill.status || '').toUpperCase() === 'DRAFT') {
    actionButtons.push(`<button class="button button--ghost" data-action="bill-submit" data-id="${bill.id}">Submit</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role) && ['DRAFT', 'PENDING_APPROVAL'].includes(String(bill.status || '').toUpperCase())) {
    actionButtons.push(`<button class="button button--ghost" data-action="bill-approve" data-id="${bill.id}">Approve</button>`);
    actionButtons.push(`<button class="button button--ghost" data-action="open-bill-reject" data-id="${bill.id}">Reject</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT'].includes(role) && !['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'PAID'].includes(String(bill.status || '').toUpperCase()) && Number(bill.outstanding || 0) > 0.01) {
    actionButtons.push(`<button class="button button--primary" data-action="open-bill-pay" data-id="${bill.id}">Record payment</button>`);
  }
  if (canWriteEvidence('VENDOR_BILL') && bill.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="VENDOR_BILL" data-entity-id="${bill.id}">Add evidence</button>`);
  }

  const lineRows = (bill.lineItems || []).map((line) => `
    <tr>
      <td>${escapeHtml(line.description || 'Bill line')}</td>
      <td>${escapeHtml(line.category || '—')}</td>
      <td>${escapeHtml(rowOrDash(line.businessUnit))}</td>
      <td>${escapeHtml(rowOrDash(line.lineOfService))}</td>
      <td>${money(line.amount || 0, bill.currency)}</td>
    </tr>
  `);

  const paymentRows = (bill.payments || []).length
    ? detailTable(
        ['Date', 'Reference', 'Account', 'Approval', 'Evidence', 'Amount'],
        bill.payments.map((payment) => `
          <tr data-open-drawer="vendor-payment:${payment.id}">
            <td>${escapeHtml(shortDate(payment.date))}</td>
            <td>${escapeHtml(payment.reference || '—')}</td>
            <td>${escapeHtml(payment.account || '—')}</td>
            <td>${badge(payment.approval?.approvalStatus || payment.approvalStatus || 'PENDING', ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(String(payment.approval?.approvalStatus || payment.approvalStatus || '').toUpperCase()) ? 'success' : 'warning')}</td>
            <td>${badge(String(payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0), (payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0) > 0 ? 'success' : 'warning')}</td>
            <td>${money(payment.amount || 0, bill.currency)}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No bill payments recorded yet.</p>';

  return {
    eyebrow: 'Payables record',
    title: bill.billNumber || bill.id,
    subtitle: `${bill.vendorName || 'Unknown vendor'} · ${bill.entity || '—'} · ${bill.currency || '—'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Status', value: escapeHtml(bill.status || 'DRAFT') },
        { label: 'Bill date', value: escapeHtml(shortDate(bill.billDate)) },
        { label: 'Due date', value: escapeHtml(shortDate(bill.dueDate)) },
        { label: 'Entity', value: escapeHtml(rowOrDash(bill.entity)) },
        { label: 'Category', value: escapeHtml(rowOrDash(bill.category)) },
        { label: 'Business unit', value: escapeHtml(rowOrDash(bill.businessUnit)) },
        { label: 'LOS', value: escapeHtml(rowOrDash(bill.lineOfService)) },
        { label: 'Total', value: money(bill.total || 0, bill.currency) },
        { label: 'Paid', value: money(bill.amountPaid || 0, bill.currency) },
        { label: 'Outstanding', value: money(bill.outstanding || 0, bill.currency) }
      ]))}
      ${detailSection('Bill lines', lineRows.length ? detailTable(['Description', 'Category', 'BU', 'LOS', 'Amount'], lineRows) : '<p class="muted-copy">No bill lines recorded.</p>')}
      ${detailSection('Payments', paymentRows)}
      ${detailSection('Approval', approvalSection(bill.approval))}
      ${detailSection('Evidence', evidenceSection(bill.evidenceRecords, { entityType: 'VENDOR_BILL', entityId: bill.id, control: bill.evidenceControl }))}
      ${detailSection('Accounting', accountingSection(bill.accounting, bill.currency))}
      ${detailSection('Journal lineage', journalLineageSection(bill.journalLineage))}
      ${bill.notes ? detailSection('Notes', `<p class="stack-copy">${escapeHtml(bill.notes)}</p>`) : ''}
    `,
    footer: `<div class="drawer-actions">${actionButtons.join('')}</div>`
  };
}

function customerReceiptDrawer(payment) {
  const actionButtons = [];
  if (canWriteEvidence('CUSTOMER_RECEIPT') && payment.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="CUSTOMER_RECEIPT" data-entity-id="${payment.id}">Add evidence</button>`);
  }
  return {
    eyebrow: 'Customer receipt',
    title: payment.reference || payment.id,
    subtitle: `${payment.invoiceNumber || 'Unlinked invoice'} · ${payment.entity || '—'} · ${payment.currency || '—'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Operational status', value: escapeHtml(rowOrDash(payment.status || 'PAID')) },
        { label: 'Approval status', value: badge(payment.approval?.approvalStatus || payment.approvalStatus || 'PENDING', ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(String(payment.approval?.approvalStatus || payment.approvalStatus || '').toUpperCase()) ? 'success' : 'warning') },
        { label: 'Accounting status', value: badge(payment.accounting?.accountingStatus || 'UNKNOWN', String(payment.accounting?.accountingStatus || '').toUpperCase() === 'POSTED' ? 'success' : 'warning') },
        { label: 'Evidence', value: badge(`${payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0} / ${payment.approval?.minEvidenceCount || 0}`, payment.approval?.evidenceSatisfied ? 'success' : 'warning') },
        { label: 'Invoice', value: escapeHtml(rowOrDash(payment.invoiceNumber)) },
        { label: 'Client', value: escapeHtml(rowOrDash(payment.clientName)) },
        { label: 'Receipt date', value: escapeHtml(shortDate(payment.paidAt)) },
        { label: 'Source', value: escapeHtml(rowOrDash(payment.source)) },
        { label: 'Reference', value: escapeHtml(rowOrDash(payment.reference)) },
        { label: 'Amount', value: money(payment.amount || 0, payment.currency) }
      ]))}
      ${detailSection('Approval', approvalSection(payment.approval))}
      ${detailSection('Evidence', evidenceSection(payment.evidenceRecords, { entityType: 'CUSTOMER_RECEIPT', entityId: payment.id, control: payment.evidenceControl }))}
      ${detailSection('Accounting', accountingSection(payment.accounting, payment.currency))}
      ${detailSection('Journal lineage', journalLineageSection(payment.journalLineage))}
    `,
    footer: actionButtons.length ? `<div class="drawer-actions">${actionButtons.join('')}</div>` : ''
  };
}

function vendorPaymentDrawer(payment) {
  const actionButtons = [];
  if (canWriteEvidence('VENDOR_PAYMENT') && payment.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="VENDOR_PAYMENT" data-entity-id="${payment.id}">Add evidence</button>`);
  }
  return {
    eyebrow: 'Vendor payment',
    title: payment.reference || payment.id,
    subtitle: `${payment.currency || '—'} · ${money(payment.amount || 0, payment.currency)}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Operational status', value: escapeHtml(rowOrDash(payment.status || 'PAID')) },
        { label: 'Approval status', value: badge(payment.approval?.approvalStatus || payment.approvalStatus || 'PENDING', ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(String(payment.approval?.approvalStatus || payment.approvalStatus || '').toUpperCase()) ? 'success' : 'warning') },
        { label: 'Accounting status', value: badge(payment.accounting?.accountingStatus || 'UNKNOWN', String(payment.accounting?.accountingStatus || '').toUpperCase() === 'POSTED' ? 'success' : 'warning') },
        { label: 'Evidence', value: badge(`${payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0} / ${payment.approval?.minEvidenceCount || 0}`, payment.approval?.evidenceSatisfied ? 'success' : 'warning') },
        { label: 'Payment date', value: escapeHtml(shortDate(payment.date)) },
        { label: 'Account', value: escapeHtml(rowOrDash(payment.account)) },
        { label: 'Reference', value: escapeHtml(rowOrDash(payment.reference)) },
        { label: 'Amount', value: money(payment.amount || 0, payment.currency) }
      ]))}
      ${detailSection('Approval', approvalSection(payment.approval))}
      ${detailSection('Evidence', evidenceSection(payment.evidenceRecords, { entityType: 'VENDOR_PAYMENT', entityId: payment.id, control: payment.evidenceControl }))}
      ${detailSection('Accounting', accountingSection(payment.accounting, payment.currency))}
      ${detailSection('Journal lineage', journalLineageSection(payment.journalLineage))}
      ${payment.notes ? detailSection('Notes', `<p class="stack-copy">${escapeHtml(payment.notes)}</p>`) : ''}
    `,
    footer: actionButtons.length ? `<div class="drawer-actions">${actionButtons.join('')}</div>` : ''
  };
}

function transactionDrawer(tx) {
  const queueItem = findReconciliationQueueItem(tx.id);
  const unmatched = Number(tx.remainingAmount || Math.abs(Number(tx.amount || 0))) > 0 && Number(tx.amount || 0) > 0;
  const previousItem = findAdjacentBankingQueueItem(tx.id, -1);
  const nextItem = findAdjacentBankingQueueItem(tx.id, 1);
  const actionButtons = [];
  if (previousItem) actionButtons.push(`<button class="button button--ghost" data-action="open-adjacent-transaction" data-id="${tx.id}" data-offset="-1">Previous</button>`);
  if (nextItem) actionButtons.push(`<button class="button button--ghost" data-action="open-adjacent-transaction" data-id="${tx.id}" data-offset="1">Next item</button>`);
  if (queueItem?.quickMatchAvailable) actionButtons.push(`<button class="button button--primary" data-action="quick-transaction-match" data-id="${tx.id}">Apply best match</button>`);
  if (unmatched) actionButtons.push(`<button class="button button--primary" data-action="open-transaction-match" data-id="${tx.id}">Match cash</button>`);
  if (queueItem?.duplicateSuspect && String(queueItem.reconciliationDecision || '').toUpperCase() !== 'IGNORE_DUPLICATE') {
    actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="IGNORE_DUPLICATE">Ignore duplicate</button>`);
  }
  if (queueItem?.needsRemittance || !queueItem?.hasReference) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="NEEDS_REMITTANCE">Needs remittance</button>`);
  }
  actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="FOLLOW_UP_REQUIRED">Follow up</button>`);
  actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="DEFERRED">Defer</button>`);
  actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="REVIEWED_PENDING">Mark pending</button>`);
  actionButtons.push(`<button class="button button--ghost" data-action="open-reconciliation-review" data-id="${tx.id}" data-decision="FLAG_EXCEPTION">Flag exception</button>`);
  if (queueItem?.reconciliationDecision || ['FOLLOW_UP_REQUIRED', 'DEFERRED', 'REVIEWED_PENDING'].includes(String(queueItem?.reconciliationReviewStatus || '').toUpperCase())) {
    actionButtons.push(`<button class="button button--ghost" data-action="clear-reconciliation-review" data-id="${tx.id}">Clear review</button>`);
  }

  const suggestionRows = (queueItem?.suggestions || []).length
    ? detailTable(
        ['Invoice', 'Client', 'Outstanding', 'Suggested', 'Confidence', 'Why'],
        queueItem.suggestions.map((candidate) => [
          escapeHtml(candidate.invoiceNumber),
          escapeHtml(candidate.clientName || 'Unknown client'),
          money(candidate.outstanding, tx.currency),
          money(candidate.suggestedAmount, tx.currency),
          `${badge(candidate.confidenceLabel, candidate.confidenceScore >= 85 ? 'success' : candidate.confidenceScore >= 65 ? 'warning' : 'neutral')}<br/><span class="muted-copy">${candidate.confidenceScore}</span>`,
          escapeHtml((candidate.reasons || []).join(' · ') || 'No supporting hints')
        ])
      )
    : '<p class="muted-copy">No candidate invoices are currently strong enough to suggest automatically.</p>';

  const duplicateRows = (queueItem?.duplicateCandidates || []).length
    ? detailTable(
        ['Transaction', 'Date', 'Amount', 'Reason'],
        queueItem.duplicateCandidates.map((candidate) => [
          escapeHtml(candidate.reference || candidate.transactionId),
          escapeHtml(shortDate(candidate.date)),
          money(candidate.amount, tx.currency),
          escapeHtml((candidate.reasonCodes || []).join(' · '))
        ])
      )
    : '<p class="muted-copy">No duplicate indicators for this cash row.</p>';

  const reviewCallout = queueItem?.issueReasons?.length
    ? `<div class="callout callout--warning"><div><strong>Why this row still needs work</strong><p>${escapeHtml(queueItem.issueReasons.join(' · '))}</p></div></div>`
    : '<div class="callout callout--success"><div><strong>No blocking review issues</strong><p>This row is ready for normal matching workflow.</p></div></div>';

  return {
    eyebrow: 'Banking record',
    title: tx.reference || tx.id,
    subtitle: `${tx.account || 'Unknown account'} · ${tx.entity || '—'} · ${tx.currency || '—'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Date', value: escapeHtml(shortDate(tx.date)) },
        { label: 'Amount', value: money(tx.amount || 0, tx.currency) },
        { label: 'Type', value: escapeHtml(rowOrDash(tx.type)) },
        { label: 'Category', value: escapeHtml(rowOrDash(tx.category)) },
        { label: 'Status', value: unmatched ? 'Unmatched cash' : 'Matched / closed' },
        { label: 'Remaining', value: money(tx.remainingAmount || 0, tx.currency) },
        { label: 'Entity', value: escapeHtml(rowOrDash(tx.entity)) },
        { label: 'Source', value: escapeHtml(rowOrDash(tx.source)) },
        { label: 'Source account', value: escapeHtml(rowOrDash(tx.sourceAccountName || tx.account)) },
        { label: 'Global account', value: escapeHtml(tx.globalAccountCode ? `${tx.globalAccountCode} | ${tx.globalAccountName}` : 'UNMAPPED') },
        { label: 'LOS', value: escapeHtml(rowOrDash(tx.lineOfService)) },
        { label: 'Business unit', value: escapeHtml(rowOrDash(tx.businessUnit)) }
      ]))}
      ${detailSection('Reconciliation posture', infoGrid([
        { label: 'Queue', value: escapeHtml(queueItem?.queueBucket ? queueItem.queueBucket.toUpperCase() : 'UNMATCHED') },
        { label: 'Review state', value: badge(queueItem?.reviewState || 'MANUAL_MATCH', queueItem?.queueBucket === 'exceptions' ? 'warning' : queueItem?.queueBucket === 'cleared' ? 'success' : 'neutral') },
        { label: 'Priority', value: badge(queueItem?.priorityLabel || 'LOW', queueItem?.priorityLabel === 'HIGH' ? 'danger' : queueItem?.priorityLabel === 'MEDIUM' ? 'warning' : 'neutral') },
        { label: 'Confidence', value: queueItem?.confidenceLabel ? badge(queueItem.confidenceLabel, queueItem.confidenceScore >= 85 ? 'success' : queueItem.confidenceScore >= 65 ? 'warning' : 'neutral') : '—' },
        { label: 'Suggested matches', value: escapeHtml(String(queueItem?.suggestionCount || 0)) },
        { label: 'Duplicate signals', value: escapeHtml(String(queueItem?.duplicateCandidates?.length || 0)) },
        { label: 'Support status', value: badge(queueItem?.supportStatus || 'UNKNOWN', queueItem?.needsRemittance ? 'warning' : 'success') },
        { label: 'Next action', value: escapeHtml(queueItem?.nextAction || (unmatched ? 'Match cash' : 'Open record')) },
        { label: 'Follow-up owner', value: escapeHtml(rowOrDash(queueItem?.followUpOwnerName)) },
        { label: 'Deferred until', value: escapeHtml(rowOrDash(queueItem?.deferredUntil)) },
        { label: 'Review note', value: escapeHtml(rowOrDash(queueItem?.reconciliationReviewNote)) }
      ]))}
      ${reviewCallout}
      ${detailSection('Description', `<p class="stack-copy">${escapeHtml(tx.description || 'No description')}</p>`) }
      ${detailSection('Suggested matches', suggestionRows)}
      ${detailSection('Duplicate indicators', duplicateRows)}
      ${detailSection('Review history', reconciliationHistorySection(queueItem))}
      ${detailSection('Source lineage', infoGrid([
        { label: 'Object type', value: escapeHtml(rowOrDash(tx.sourceObjectType)) },
        { label: 'Object ID', value: escapeHtml(rowOrDash(tx.sourceObjectId)) },
        { label: 'Line ID', value: escapeHtml(rowOrDash(tx.sourceLineId)) },
        { label: 'QBO account ID', value: escapeHtml(rowOrDash(tx.qboAccountId)) },
        { label: 'Counterparty', value: escapeHtml(rowOrDash(tx.counterparty)) },
        { label: 'Mapping basis', value: escapeHtml(rowOrDash(tx.mappingBasis)) }
      ]))}
    `,
    footer: `<div class="drawer-actions">${actionButtons.join('')}</div>`
  };
}

function expenseDrawer(expense) {
  const role = currentUserRole();
  const canSettle = String(expense.reimbursementStatus || '').toUpperCase() === 'PENDING';
  const approvalStatus = String(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING').toUpperCase();
  const actionButtons = [];
  if (financeApproveRoles.includes(role) && ['PENDING', 'REJECTED'].includes(approvalStatus)) {
    actionButtons.push(`<button class="button button--ghost" data-action="expense-approve" data-id="${expense.id}">Approve</button>`);
    actionButtons.push(`<button class="button button--ghost" data-action="open-expense-reject" data-id="${expense.id}">Reject</button>`);
  }
  if (canWriteEvidence('EXPENSE') && expense.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="EXPENSE" data-entity-id="${expense.id}">Add evidence</button>`);
  }
  if (canSettle) {
    actionButtons.push(`<button class="button button--primary" data-action="open-reimbursement-settle" data-id="${expense.id}">Settle reimbursement</button>`);
  }
  return {
    eyebrow: 'Spend record',
    title: expense.description || expense.id,
    subtitle: `${expense.entity || '—'} · ${expense.currency || '—'} · ${money(expense.amount || 0, expense.currency)}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Date', value: escapeHtml(shortDate(expense.date)) },
        { label: 'Account', value: escapeHtml(rowOrDash(expense.account)) },
        { label: 'Category', value: escapeHtml(rowOrDash(expense.category)) },
        { label: 'Entity', value: escapeHtml(rowOrDash(expense.entity)) },
        { label: 'Business unit', value: escapeHtml(rowOrDash(expense.businessUnit)) },
        { label: 'LOS', value: escapeHtml(rowOrDash(expense.lineOfService)) },
        { label: 'Employee', value: escapeHtml(rowOrDash(expense.employeeId)) },
        { label: 'Reimbursement status', value: escapeHtml(rowOrDash(expense.reimbursementStatus || expense.status)) },
        { label: 'Source account', value: escapeHtml(rowOrDash(expense.sourceAccountName || expense.account)) },
        { label: 'Global account', value: escapeHtml(expense.globalAccountCode ? `${expense.globalAccountCode} | ${expense.globalAccountName}` : 'UNMAPPED') }
      ]))}
      ${detailSection('Approval', approvalSection(expense.approval))}
      ${detailSection('Evidence', evidenceSection(expense.evidenceRecords, { entityType: 'EXPENSE', entityId: expense.id, control: expense.evidenceControl }))}
      ${detailSection('Accounting', accountingSection(expense.accounting, expense.currency))}
      ${detailSection('Journal lineage', journalLineageSection(expense.journalLineage))}
      ${expense.notes ? detailSection('Notes', `<p class="stack-copy">${escapeHtml(expense.notes)}</p>`) : ''}
    `,
    footer: actionButtons.length ? `<div class="drawer-actions">${actionButtons.join('')}</div>` : ''
  };
}

function intercompanyDrawer(entry) {
  const canRepay = Number(entry.outstandingAmount || 0) > 0.01;
  const repaymentRows = (entry.repaymentEvents || []).length
    ? detailTable(
        ['Date', 'Reference', 'Amount', 'From rail', 'To rail'],
        (entry.repaymentEvents || []).map((event) => `
          <tr>
            <td>${escapeHtml(shortDate(event.date))}</td>
            <td>${escapeHtml(rowOrDash(event.reference))}</td>
            <td>${money(event.amount || 0, event.currency || entry.currency)}</td>
            <td>${escapeHtml(findSourceAccount(event.sourceAccountId)?.name || rowOrDash(event.sourceAccountId))}</td>
            <td>${escapeHtml(findSourceAccount(event.receivingSourceAccountId)?.name || rowOrDash(event.receivingSourceAccountId))}</td>
          </tr>
        `)
      )
    : '<p class="muted-copy">No repayments have been recorded yet.</p>';
  return {
    eyebrow: 'Treasury entry',
    title: entry.reference || entry.id,
    subtitle: `${entry.fromEntity || '—'} -> ${entry.toEntity || '—'} · ${money(entry.amount || 0, entry.currency)}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Status', value: escapeHtml(rowOrDash(entry.status)) },
        { label: 'Date', value: escapeHtml(shortDate(entry.date)) },
        { label: 'From entity', value: escapeHtml(rowOrDash(entry.fromEntity)) },
        { label: 'To entity', value: escapeHtml(rowOrDash(entry.toEntity)) },
        { label: 'Funded', value: money(entry.amount || 0, entry.currency) },
        { label: 'Repaid', value: money(entry.repaidAmount || 0, entry.currency) },
        { label: 'Outstanding', value: money(entry.outstandingAmount || 0, entry.currency) },
        { label: 'Currency', value: escapeHtml(rowOrDash(entry.currency)) },
        { label: 'Reason', value: escapeHtml(rowOrDash(entry.reason)) },
        { label: 'Funding rail', value: escapeHtml(findSourceAccount(entry.sourceAccountId)?.name || entry.sourceRailName || rowOrDash(entry.sourceAccountId)) },
        { label: 'Receiving rail', value: escapeHtml(findSourceAccount(entry.receivingSourceAccountId)?.name || entry.receivingSourceRailName || rowOrDash(entry.receivingSourceAccountId)) },
        { label: 'Latest repayment', value: escapeHtml(shortDate(entry.repaymentDate)) },
        { label: 'Repayment rail', value: escapeHtml(findSourceAccount(entry.repaymentSourceAccountId)?.name || entry.repaymentSourceRailName || rowOrDash(entry.repaymentSourceAccountId)) },
        { label: 'Receiving repayment rail', value: escapeHtml(findSourceAccount(entry.repaymentReceivingAccountId)?.name || entry.repaymentReceivingRailName || rowOrDash(entry.repaymentReceivingAccountId)) }
      ]))}
      ${detailSection('Repayment history', repaymentRows)}
      ${detailSection('Accounting', accountingSection(entry.accounting, entry.currency))}
      ${detailSection('Journal lineage', journalLineageSection(entry.journalLineage))}
      ${entry.description ? detailSection('Description', `<p class="stack-copy">${escapeHtml(entry.description)}</p>`) : ''}
      ${entry.notes ? detailSection('Notes', `<p class="stack-copy">${escapeHtml(entry.notes)}</p>`) : ''}
    `,
    footer: canRepay ? `<div class="drawer-actions"><button class="button button--primary" data-action="open-intercompany-repay" data-id="${entry.id}">Record repayment</button></div>` : ''
  };
}

function periodDrawer(period) {
  const checks = period.checklistSnapshot || period.checklist?.checks || [];
  const relatedParty = period.relatedPartySnapshot || null;
  const actionButtons = [
    String(period.status || '').toUpperCase() === 'CLOSED'
      ? `<button class="button button--ghost" data-action="open-period-reopen" data-id="${period.periodKey}">Reopen period</button>`
      : `<button class="button button--primary" data-action="open-period-close" data-id="${period.periodKey}">Close period</button>`
  ];
  if (canWriteEvidence('CLOSE_PERIOD') && period.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="CLOSE_PERIOD" data-entity-id="${period.periodKey}">Add evidence</button>`);
  }
  return {
    eyebrow: 'Close period',
    title: period.periodKey,
    subtitle: `Status ${period.status || 'OPEN'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Status', value: escapeHtml(rowOrDash(period.status)) },
        { label: 'Closed at', value: escapeHtml(shortDate(period.closedAt)) },
        { label: 'Reopened at', value: escapeHtml(shortDate(period.reopenedAt)) },
        { label: 'Stored checks', value: String(checks.length) },
        { label: 'Stored open AR', value: money(period.metricsSnapshot?.openAr || period.checklist?.metrics?.openAr || 0) },
        { label: 'Stored open AP', value: money(period.metricsSnapshot?.openAp || period.checklist?.metrics?.openAp || 0) },
        { label: 'Stored RP blockers', value: String(relatedParty?.summary?.closeBlockerCount || 0) },
        { label: 'Evidence count', value: String((period.evidenceRecords || []).length) },
        { label: 'Close signoff', value: badge(period.closeApprovalSnapshot?.evidenceSatisfied ? 'EVIDENCE READY' : 'MISSING SUPPORT', period.closeApprovalSnapshot?.evidenceSatisfied ? 'success' : 'warning') }
      ]))}
      ${period.closeApprovalSnapshot ? detailSection('Close signoff snapshot', approvalSection(period.closeApprovalSnapshot)) : ''}
      ${detailSection('Approval', approvalSection(period.approval))}
      ${detailSection('Evidence', evidenceSection(period.evidenceRecords, { entityType: 'CLOSE_PERIOD', entityId: period.periodKey, control: period.evidenceControl }))}
      ${detailSection('Checklist snapshot', checks.length ? detailTable(['Check', 'Detail', 'Pass'], checks.map((check) => `
        <tr>
          <td>${escapeHtml(check.label)}</td>
          <td>${escapeHtml(check.detail || '—')}</td>
          <td>${check.pass ? 'Yes' : 'No'}</td>
        </tr>
      `)) : '<p class="muted-copy">No stored checklist snapshot is available for this period.</p>')}
      ${relatedParty ? detailSection('Related-party snapshot', infoGrid([
        { label: 'Pairs', value: String(relatedParty.summary?.pairCount || 0) },
        { label: 'Outstanding', value: money(relatedParty.summary?.outstandingBalance || 0, relatedParty.reportingCurrency || 'USD') },
        { label: 'Mismatches', value: String(relatedParty.summary?.mismatchPairCount || 0) },
        { label: 'Cleanup exceptions', value: String(relatedParty.summary?.cleanupExceptionCount || 0) }
      ])) : ''}
    `,
    footer: `<div class="drawer-actions">${actionButtons.join('')}</div>`
  };
}

function journalDrawer(journal) {
  const role = String(state.session.user?.role || '').toUpperCase();
  const status = String(journal.status || '').toUpperCase();
  const actionButtons = [];
  if (['ADMIN', 'ACCOUNTANT'].includes(role) && ['DRAFT', 'REJECTED'].includes(status)) {
    actionButtons.push(`<button class="button button--ghost" data-action="journal-submit" data-id="${journal.id}">Submit</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT', 'PARTNER'].includes(role) && ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(status)) {
    actionButtons.push(`<button class="button button--ghost" data-action="journal-approve" data-id="${journal.id}">Approve</button>`);
    actionButtons.push(`<button class="button button--ghost" data-action="open-journal-reject" data-id="${journal.id}">Reject</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT'].includes(role) && status === 'APPROVED') {
    actionButtons.push(`<button class="button button--primary" data-action="journal-post" data-id="${journal.id}">Post journal</button>`);
  }
  if (['ADMIN', 'ACCOUNTANT'].includes(role) && status === 'POSTED' && !journal.reversedByJournalId) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-journal-reverse" data-id="${journal.id}">Reverse</button>`);
  }
  if (canWriteEvidence('JOURNAL') && journal.evidenceControl?.supersedeAllowed !== false) {
    actionButtons.push(`<button class="button button--ghost" data-action="open-evidence-upload" data-entity-type="JOURNAL" data-entity-id="${journal.id}">Add evidence</button>`);
  }

  const lineRows = (journal.lines || []).map((line) => `
    <tr>
      <td>${escapeHtml(String(line.lineNumber || ''))}</td>
      <td>${escapeHtml(`${line.globalAccountCode || '—'} | ${line.globalAccountName || 'Unnamed account'}`)}</td>
      <td>${escapeHtml(line.description || '—')}</td>
      <td>${money(line.debit || 0, line.currency || journal.currency)}</td>
      <td>${money(line.credit || 0, line.currency || journal.currency)}</td>
    </tr>
  `);
  const historyRows = (journal.statusHistory || []).length
    ? detailTable(['Event', 'At', 'User', 'Note'], (journal.statusHistory || []).map((item) => `
      <tr>
        <td>${escapeHtml(item.label || item.key)}</td>
        <td>${escapeHtml(shortDate(item.at))}</td>
        <td>${escapeHtml(rowOrDash(item.userId))}</td>
        <td>${escapeHtml(rowOrDash(item.note))}</td>
      </tr>
    `))
    : '<p class="muted-copy">No status history is attached to this journal.</p>';
  const relatedRows = (journal.relatedJournals || []).length
    ? detailTable(['Journal', 'Stage', 'Status', 'Date'], (journal.relatedJournals || []).map((related) => `
      <tr data-open-drawer="journal:${related.id}">
        <td><strong>${escapeHtml(related.journalNumber || related.id)}</strong></td>
        <td>${escapeHtml(rowOrDash(related.sourceStage))}</td>
        <td>${escapeHtml(rowOrDash(related.status))}</td>
        <td>${escapeHtml(shortDate(related.postingDate))}</td>
      </tr>
    `))
    : '<p class="muted-copy">No sibling journals are linked to this source record.</p>';

  return {
    eyebrow: 'Journal record',
    title: journal.journalNumber || journal.id,
    subtitle: `${journal.entity || '—'} · ${journal.currency || '—'} · ${journal.journalType || 'MANUAL'}`,
    body: `
      ${detailSection('Overview', infoGrid([
        { label: 'Status', value: escapeHtml(journal.status || 'DRAFT') },
        { label: 'Posting date', value: escapeHtml(shortDate(journal.postingDate)) },
        { label: 'Entity', value: escapeHtml(rowOrDash(journal.entity)) },
        { label: 'Currency', value: escapeHtml(rowOrDash(journal.currency)) },
        { label: 'Source type', value: escapeHtml(rowOrDash(journal.sourceType)) },
        { label: 'Source id', value: escapeHtml(rowOrDash(journal.sourceId)) },
        { label: 'Root type', value: escapeHtml(rowOrDash(journal.sourceLinkage?.sourceRootType || journal.sourceRootType)) },
        { label: 'Root id', value: escapeHtml(rowOrDash(journal.sourceLinkage?.sourceRootId || journal.sourceRootId)) },
        { label: 'Stage', value: escapeHtml(rowOrDash(journal.sourceLinkage?.sourceStage || journal.sourceStage)) },
        { label: 'Consolidation only', value: journal.consolidationOnly ? 'Yes' : 'No' },
        { label: 'Period key', value: escapeHtml(rowOrDash(journal.periodKey)) },
        { label: 'Elimination key', value: escapeHtml(rowOrDash(journal.eliminationKey)) },
        { label: 'Cleanup key', value: escapeHtml(rowOrDash(journal.cleanupKey)) },
        { label: 'Created by', value: escapeHtml(rowOrDash(journal.createdByUserId)) },
        { label: 'Approved by', value: escapeHtml(rowOrDash(journal.approvedByUserId)) },
        { label: 'Posted by', value: escapeHtml(rowOrDash(journal.postedByUserId)) },
        { label: 'Reversal of', value: escapeHtml(rowOrDash(journal.reversalOfJournalId)) },
        { label: 'Reversed by', value: escapeHtml(rowOrDash(journal.reversedByJournalId)) },
        { label: 'Total debit', value: money(journal.totalDebit || 0, journal.currency) },
        { label: 'Total credit', value: money(journal.totalCredit || 0, journal.currency) },
        { label: 'Balanced', value: journal.balanced ? 'Yes' : 'No' }
      ]))}
      ${journal.memo ? detailSection('Memo', `<p class="stack-copy">${escapeHtml(journal.memo)}</p>`) : ''}
      ${detailSection('Approval', approvalSection(journal.approval))}
      ${detailSection('Evidence', evidenceSection(journal.evidenceRecords, { entityType: 'JOURNAL', entityId: journal.id, control: journal.evidenceControl }))}
      ${detailSection('Status history', historyRows)}
      ${detailSection('Journal lines', lineRows.length ? detailTable(['#', 'Account', 'Description', 'Debit', 'Credit'], lineRows) : '<p class="muted-copy">No journal lines recorded.</p>')}
      ${detailSection('Related journals', relatedRows)}
    `,
    footer: `<div class="drawer-actions">${actionButtons.join('')}</div>`
  };
}

function trialBalanceDrilldownDrawer(drilldown) {
  const lineRows = (drilldown.rows || []).map((row) => `
    <tr data-open-drawer="journal:${row.journalId}">
      <td><strong>${escapeHtml(row.journalNumber || row.journalId)}</strong><br/><span class="muted-copy">${escapeHtml(row.sourceType || '—')}</span></td>
      <td>${escapeHtml(shortDate(row.postingDate))}</td>
      <td>${escapeHtml(row.entity || '—')}</td>
      <td>${escapeHtml(row.sourceStage || '—')}</td>
      <td>${escapeHtml(row.description || '—')}</td>
      <td>${money(row.reportingDebit || 0, drilldown.reportingCurrency || 'USD')}</td>
      <td>${money(row.reportingCredit || 0, drilldown.reportingCurrency || 'USD')}</td>
    </tr>
  `);
  return {
    eyebrow: 'Trial balance drilldown',
    title: `${drilldown.accountCode || '—'} | ${drilldown.accountName || 'Unknown account'}`,
    subtitle: `${drilldown.entity || 'Global consolidated'} · ${drilldown.accountType || '—'} · ${drilldown.reportingCurrency || 'USD'}`,
    body: `
      ${detailSection('Account control', infoGrid([
        { label: 'Debit', value: money(drilldown.totals?.debit || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Credit', value: money(drilldown.totals?.credit || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Net', value: money(drilldown.totals?.net || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'As of', value: escapeHtml(shortDate(drilldown.asOfDate)) }
      ]))}
      ${drilldown.eliminationContext?.eliminationAmount ? detailSection('Consolidation note', infoGrid([
        { label: 'Due-from before', value: money(drilldown.eliminationContext.dueFromBefore || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Due-to before', value: money(drilldown.eliminationContext.dueToBefore || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Eliminated', value: money(drilldown.eliminationContext.eliminationAmount || 0, drilldown.reportingCurrency || 'USD') }
      ])) : ''}
      ${detailSection('Supporting journal lines', lineRows.length ? detailTable(['Journal', 'Date', 'Entity', 'Stage', 'Description', 'Debit', 'Credit'], lineRows) : '<p class="muted-copy">No journal lines support this account in the selected scope.</p>')}
    `
  };
}

function statementDrilldownDrawer(drilldown) {
  const lineRows = (drilldown.rows || []).map((row) => `
    <tr data-open-drawer="journal:${row.journalId}">
      <td><strong>${escapeHtml(row.journalNumber || row.journalId)}</strong><br/><span class="muted-copy">${escapeHtml(row.sourceType || '—')}</span></td>
      <td>${escapeHtml(shortDate(row.postingDate))}</td>
      <td>${escapeHtml(row.entity || '—')}</td>
      <td>${escapeHtml(row.supportBucket || 'SOURCE')}</td>
      <td>${escapeHtml(row.sourceStage || '—')}</td>
      <td>${escapeHtml(row.description || '—')}</td>
      <td>${money(row.reportingDebit || 0, drilldown.reportingCurrency || 'USD')}</td>
      <td>${money(row.reportingCredit || 0, drilldown.reportingCurrency || 'USD')}</td>
    </tr>
  `);
  return {
    eyebrow: 'Statement drilldown',
    title: drilldown.label || `${drilldown.statement || 'Report'} ${drilldown.lineKey || ''}`.trim(),
    subtitle: `${drilldown.entity || 'Global consolidated'} · ${drilldown.reportingCurrency || 'USD'}${drilldown.toDate ? ` · Through ${shortDate(drilldown.toDate)}` : ''}`,
    body: `
      ${detailSection('Control summary', infoGrid([
        { label: 'Debit', value: money(drilldown.totals?.debit || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Credit', value: money(drilldown.totals?.credit || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Net', value: money(drilldown.totals?.net || 0, drilldown.reportingCurrency || 'USD') },
        { label: 'Accounts', value: escapeHtml((drilldown.accountCodes || []).join(', ') || '—') }
      ]))}
      ${detailSection('Support buckets', (drilldown.supportBuckets || []).length ? detailTable(
        ['Bucket', 'Amount'],
        (drilldown.supportBuckets || []).map((bucket) => `
          <tr>
            <td>${escapeHtml(bucket.bucket)}</td>
            <td>${money(bucket.amount || 0, drilldown.reportingCurrency || 'USD')}</td>
          </tr>
        `)
      ) : '<p class="muted-copy">No supporting journal activity in the selected scope.</p>')}
      ${detailSection('Supporting journal activity', lineRows.length ? detailTable(['Journal', 'Date', 'Entity', 'Bucket', 'Stage', 'Description', 'Debit', 'Credit'], lineRows) : '<p class="muted-copy">No journal lines support this statement line in the selected scope.</p>')}
    `
  };
}

function sourceAccountDrawer(account) {
  return {
    eyebrow: 'Governance record',
    title: account.name,
    subtitle: `${account.entity || '—'} · ${account.currency || '—'} · ${account.accountRole || '—'}`,
    body: detailSection('Source account', infoGrid([
      { label: 'Provider', value: escapeHtml(rowOrDash(account.provider)) },
      { label: 'Source system', value: escapeHtml(rowOrDash(account.sourceSystem)) },
      { label: 'Source ledger', value: escapeHtml(rowOrDash(account.sourceLedger)) },
      { label: 'Entity', value: escapeHtml(rowOrDash(account.entity)) },
      { label: 'Currency', value: escapeHtml(rowOrDash(account.currency)) },
      { label: 'Role', value: escapeHtml(rowOrDash(account.accountRole)) },
      { label: 'Visible in banking', value: account.showInBankingHub ? 'Yes' : 'No' },
      { label: 'Mapped global', value: escapeHtml(account.mappedGlobalAccountCode ? `${account.mappedGlobalAccountCode} | ${account.mappedGlobalAccountName}` : 'UNMAPPED') },
      { label: 'QBO account ID', value: escapeHtml(rowOrDash(account.qboAccountId)) }
    ])),
    footer: ''
  };
}

function globalAccountDrawer(account) {
  return {
    eyebrow: 'Global chart record',
    title: `${account.code} | ${account.name}`,
    subtitle: `${account.type || 'OTHER'} · ${account.reportingGroup || '—'}`,
    body: detailSection('Global account', infoGrid([
      { label: 'Code', value: escapeHtml(account.code) },
      { label: 'Name', value: escapeHtml(account.name) },
      { label: 'Type', value: escapeHtml(account.type || 'OTHER') },
      { label: 'Reporting group', value: escapeHtml(rowOrDash(account.reportingGroup)) },
      { label: 'Status', value: escapeHtml(rowOrDash(account.status)) },
      { label: 'Notes', value: escapeHtml(rowOrDash(account.notes)) }
    ]))
  };
}

function mappingDrawer(mapping) {
  const source = findSourceAccount(mapping.sourceAccountId);
  const global = findGlobalAccount(mapping.globalAccountId);
  return {
    eyebrow: 'Account mapping',
    title: mapping.id,
    subtitle: `${source?.name || mapping.sourceAccountId} -> ${global ? `${global.code} | ${global.name}` : mapping.globalAccountId}`,
    body: detailSection('Mapping', infoGrid([
      { label: 'Source account', value: escapeHtml(source?.name || rowOrDash(mapping.sourceAccountId)) },
      { label: 'Global account', value: escapeHtml(global ? `${global.code} | ${global.name}` : rowOrDash(mapping.globalAccountId)) },
      { label: 'Entity override', value: escapeHtml(rowOrDash(mapping.entityOverride)) },
      { label: 'LOS override', value: escapeHtml(rowOrDash(mapping.lineOfServiceOverride)) },
      { label: 'BU override', value: escapeHtml(rowOrDash(mapping.businessUnitOverride)) },
      { label: 'Status', value: escapeHtml(rowOrDash(mapping.status)) },
      { label: 'Notes', value: escapeHtml(rowOrDash(mapping.notes)) }
    ]))
  };
}

async function openDrawerByRef(reference, { preserveModal = true } = {}) {
  if (!reference) return;
  const [type, id] = String(reference).split(':');
  if (!preserveModal) state.ui.modal = null;
  if (type === 'invoice') {
    const invoice = findInvoice(id);
    if (invoice) setDrawer(invoiceDrawer(invoice));
    return;
  }
  if (type === 'customer-receipt') {
    const receipt = findCustomerReceipt(id);
    if (receipt) setDrawer(customerReceiptDrawer(receipt));
    return;
  }
  if (type === 'bill') {
    const bill = findBill(id);
    if (bill) setDrawer(billDrawer(bill));
    return;
  }
  if (type === 'vendor-payment') {
    const payment = findVendorPayment(id);
    if (payment) setDrawer(vendorPaymentDrawer(payment));
    return;
  }
  if (type === 'transaction') {
    const tx = findTransaction(id);
    if (tx) setDrawer(transactionDrawer(tx));
    return;
  }
  if (type === 'expense') {
    const expense = findExpense(id);
    if (expense) setDrawer(expenseDrawer(expense));
    return;
  }
  if (type === 'intercompany') {
    const entry = findIntercompany(id);
    if (entry) setDrawer(intercompanyDrawer(entry));
    return;
  }
  if (type === 'period') {
    const period = findClosePeriod(id);
    if (period) setDrawer(periodDrawer(period));
    return;
  }
  if (type === 'journal') {
    const journal = findJournal(id);
    if (journal) setDrawer(journalDrawer(journal));
    try {
      const payload = await request(`/api/journals/${id}`);
      if (payload?.journal) setDrawer(journalDrawer(payload.journal));
    } catch {
      // Keep the register snapshot drawer open if detail fetch fails.
    }
    return;
  }
  if (type === 'source-account') {
    const account = findSourceAccount(id);
    if (account) setDrawer(sourceAccountDrawer(account));
    return;
  }
  if (type === 'global-account') {
    const account = findGlobalAccount(id);
    if (account) setDrawer(globalAccountDrawer(account));
    return;
  }
  if (type === 'mapping') {
    const mapping = findAccountMapping(id);
    if (mapping) setDrawer(mappingDrawer(mapping));
  }
}

function openInvoiceCreateModal() {
  const draft = state.drafts.invoice;
  const clientOptions = selectOptions(clients(), (row) => row.id, (row) => `${row.name} · ${row.currency || 'USD'}`, draft.clientId, 'Select existing client');
  const projectOptions = selectOptions(projects(), (row) => row.id, (row) => `${row.code} · ${row.name}`, draft.projectId, 'Optional project');
  const losOptions = selectOptions(financeModel().dimensions?.lineOfService || ['TRDEV', 'TRFINANCE', 'TRBUILD'], (row) => row, (row) => row, draft.lineOfService, 'Select line of service');
  const buOptions = selectOptions(financeModel().dimensions?.businessUnit || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER'], (row) => row, (row) => row, draft.businessUnit, 'Select business unit');
  const channelOptions = selectOptions(financeModel().dimensions?.channels || ['UPWORK'], (row) => row, (row) => row, draft.channel, 'Optional channel');
  const entityList = entityOptions(state);
  setModal({
    id: 'invoice-create',
    eyebrow: 'Billing action',
    title: 'Create invoice',
    subtitle: 'Create a controlled AR document with explicit entity, currency, and line item details.',
    size: 'wide',
    body: `
      <form id="invoice-create-form" class="form-grid form-grid--three">
        ${selectField({ id: 'invoice_projectId', label: 'Project', options: projectOptions })}
        ${selectField({ id: 'invoice_clientId', label: 'Existing client', options: clientOptions })}
        ${inputField({ id: 'invoice_clientName', label: 'Or new client name', value: draft.clientName, placeholder: 'Optional if using existing client' })}
        ${inputField({ id: 'invoice_issueDate', label: 'Issue date', type: 'date', value: draft.issueDate, required: true })}
        ${inputField({ id: 'invoice_dueDate', label: 'Due date', type: 'date', value: draft.dueDate, required: true })}
        ${selectField({ id: 'invoice_entity', label: 'Entity', options: selectOptions(entityList, (row) => row, (row) => row, draft.entity) })}
        ${selectField({ id: 'invoice_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency) })}
        ${selectField({ id: 'invoice_businessUnit', label: 'Business unit', options: buOptions })}
        ${selectField({ id: 'invoice_lineOfService', label: 'Line of service', options: losOptions })}
        ${selectField({ id: 'invoice_channel', label: 'Channel', options: channelOptions })}
        ${inputField({ id: 'invoice_description', label: 'Line description', value: draft.description, required: true, placeholder: 'Monthly advisory fee' })}
        ${inputField({ id: 'invoice_qty', label: 'Quantity', type: 'number', value: String(draft.qty), min: 0.01, step: '0.01', required: true })}
        ${inputField({ id: 'invoice_rate', label: 'Unit rate', type: 'number', value: String(draft.rate), min: 0, step: '0.01', required: true })}
        ${inputField({ id: 'invoice_taxRate', label: 'Tax rate', type: 'number', value: String(draft.taxRate), min: 0, step: '0.01', hint: 'Use decimal format, e.g. 0.10 for 10%' })}
        ${textAreaField({ id: 'invoice_notes', label: 'Notes', value: draft.notes, placeholder: 'Optional internal or customer notes' })}
      </form>
    `,
    footer: formActions('invoice-create-form', 'Create invoice')
  });
}

function openInvoiceRejectModal(invoiceId) {
  const invoice = findInvoice(invoiceId);
  if (!invoice) return;
  setModal({
    id: 'invoice-reject',
    eyebrow: 'Billing approval',
    title: `Reject ${invoice.invoiceNumber}`,
    subtitle: 'Record a structured rejection reason instead of using a browser prompt.',
    body: `
      <form id="invoice-reject-form" class="form-grid form-grid--single" data-record-id="${invoice.id}">
        ${textAreaField({ id: 'invoice_reject_reason', label: 'Rejection reason', value: invoice.rejectionReason || 'Needs revision', placeholder: 'Explain what needs correction before approval' })}
      </form>
    `,
    footer: formActions('invoice-reject-form', 'Reject invoice')
  });
}

function openInvoicePaymentModal(invoiceId) {
  const invoice = findInvoice(invoiceId);
  if (!invoice) return;
  const outstanding = Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0);
  setModal({
    id: 'invoice-payment',
    eyebrow: 'Cash application',
    title: `Record payment for ${invoice.invoiceNumber}`,
    subtitle: `${invoice.clientName || 'Unknown client'} · Outstanding ${money(outstanding, invoice.currency)}`,
    body: `
      <form id="invoice-payment-form" class="form-grid form-grid--three" data-record-id="${invoice.id}">
        ${inputField({ id: 'invoice_payment_amount', label: 'Amount', type: 'number', value: String(outstanding), min: 0.01, step: '0.01', required: true })}
        ${inputField({ id: 'invoice_payment_date', label: 'Payment date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${inputField({ id: 'invoice_payment_reference', label: 'Reference', value: `MANUAL-${invoice.invoiceNumber}`, placeholder: 'Wire reference, check number, etc.' })}
        <label>
          <span>Receipt support</span>
          <input id="invoice_payment_support_file" name="invoice_payment_support_file" type="file" required />
          <small>Bank proof, remittance, or payment support is required before posting the receipt.</small>
        </label>
        ${selectField({ id: 'invoice_payment_support_category', label: 'Support category', options: selectOptions(['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT'], (row) => row, (row) => row, 'BANK_PROOF') })}
        ${textAreaField({ id: 'invoice_payment_support_note', label: 'Support note', value: '', placeholder: 'Optional note about the receipt support.' })}
      </form>
    `,
    footer: formActions('invoice-payment-form', 'Record payment')
  });
}

function openBillCreateModal() {
  const draft = state.drafts.bill;
  const vendorOptions = selectOptions(vendors(), (row) => row.id, (row) => `${row.name} · ${row.defaultCurrency || 'USD'}`, draft.vendorId, 'Select existing vendor');
  const entityList = entityOptions(state);
  const buList = financeModel().dimensions?.businessUnit || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER'];
  const losList = financeModel().dimensions?.lineOfService || ['TRDEV', 'TRFINANCE', 'TRBUILD'];
  const categories = categoryOptions(state);
  setModal({
    id: 'bill-create',
    eyebrow: 'Payables action',
    title: 'Create vendor bill',
    subtitle: 'Capture a controlled AP document with entity, due date, and bill-line context.',
    size: 'wide',
    body: `
      <form id="bill-create-form" class="form-grid form-grid--three">
        ${selectField({ id: 'bill_vendorId', label: 'Existing vendor', options: vendorOptions })}
        ${inputField({ id: 'bill_vendorName', label: 'Or new vendor name', value: draft.vendorName, placeholder: 'Optional if using existing vendor' })}
        ${inputField({ id: 'bill_billNumber', label: 'Bill number', value: draft.billNumber, placeholder: 'Vendor invoice reference' })}
        ${inputField({ id: 'bill_billDate', label: 'Bill date', type: 'date', value: draft.billDate, required: true })}
        ${inputField({ id: 'bill_dueDate', label: 'Due date', type: 'date', value: draft.dueDate, required: true })}
        ${selectField({ id: 'bill_entity', label: 'Entity', options: selectOptions(entityList, (row) => row, (row) => row, draft.entity) })}
        ${selectField({ id: 'bill_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency) })}
        ${selectField({ id: 'bill_category', label: 'Category', options: selectOptions(categories, (row) => row, (row) => row, draft.category) })}
        ${selectField({ id: 'bill_businessUnit', label: 'Business unit', options: selectOptions(buList, (row) => row, (row) => row, draft.businessUnit) })}
        ${selectField({ id: 'bill_lineOfService', label: 'Line of service', options: selectOptions(losList, (row) => row, (row) => row, draft.lineOfService, 'Optional LOS') })}
        ${inputField({ id: 'bill_description', label: 'Description', value: draft.description, placeholder: 'Vendor bill description', required: true })}
        ${inputField({ id: 'bill_total', label: 'Total', type: 'number', value: String(draft.total), min: 0.01, step: '0.01', required: true })}
        ${textAreaField({ id: 'bill_notes', label: 'Notes', value: draft.notes, placeholder: 'Optional AP notes' })}
      </form>
    `,
    footer: formActions('bill-create-form', 'Create bill')
  });
}

function openBillRejectModal(billId) {
  const bill = findBill(billId);
  if (!bill) return;
  setModal({
    id: 'bill-reject',
    eyebrow: 'Payables approval',
    title: `Reject ${bill.billNumber || bill.id}`,
    subtitle: 'Capture a clear rejection reason for the vendor bill approval trail.',
    body: `
      <form id="bill-reject-form" class="form-grid form-grid--single" data-record-id="${bill.id}">
        ${textAreaField({ id: 'bill_reject_reason', label: 'Rejection reason', value: bill.rejectionReason || 'Needs correction', placeholder: 'Explain what needs to change before approval' })}
      </form>
    `,
    footer: formActions('bill-reject-form', 'Reject bill')
  });
}

function openBillPayModal(billId) {
  const bill = findBill(billId);
  if (!bill) return;
  const rails = cashRailsForBanking(bill.entity, bill.currency);
  setModal({
    id: 'bill-pay',
    eyebrow: 'Payables payment',
    title: `Pay ${bill.billNumber || bill.id}`,
    subtitle: `${bill.vendorName || 'Unknown vendor'} · Outstanding ${money(bill.outstanding || 0, bill.currency)}`,
    body: `
      <form id="bill-pay-form" class="form-grid form-grid--three" data-record-id="${bill.id}">
        ${inputField({ id: 'bill_pay_amount', label: 'Amount', type: 'number', value: String(bill.outstanding || 0), min: 0.01, step: '0.01', required: true })}
        ${inputField({ id: 'bill_pay_date', label: 'Payment date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${selectField({ id: 'bill_pay_sourceAccountId', label: 'Source rail', options: selectOptions(rails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, bill.sourceAccountId, 'Select source rail') })}
        ${inputField({ id: 'bill_pay_reference', label: 'Reference', value: `BILLPAY-${bill.id}` })}
        ${inputField({ id: 'bill_pay_notes', label: 'Notes', value: '', placeholder: 'Optional payment note' })}
        <label>
          <span>Payment support</span>
          <input id="bill_pay_support_file" name="bill_pay_support_file" type="file" required />
          <small>Attach bank proof or payment support before releasing the vendor payment.</small>
        </label>
        ${selectField({ id: 'bill_pay_support_category', label: 'Support category', options: selectOptions(['BANK_PROOF', 'PAYMENT_SUPPORT'], (row) => row, (row) => row, 'BANK_PROOF') })}
        ${textAreaField({ id: 'bill_pay_support_note', label: 'Support note', value: '', placeholder: 'Optional note about the payment release.' })}
      </form>
    `,
    footer: formActions('bill-pay-form', 'Record payment')
  });
}

function openBankImportModal() {
  const draft = state.drafts.bankImport;
  const rails = cashRailsForBanking();
  setModal({
    id: 'bank-import',
    eyebrow: 'Banking action',
    title: 'Import bank or card activity',
    subtitle: 'Paste CSV rows directly into the governed banking workflow for staging and reconciliation.',
    size: 'wide',
    body: `
      <form id="bank-import-form" class="form-grid form-grid--three">
        ${selectField({ id: 'bank_import_sourceAccountId', label: 'Source rail', options: selectOptions(rails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, draft.sourceAccountId, 'Select source rail') })}
        ${selectField({ id: 'bank_import_entity', label: 'Entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, draft.entity) })}
        ${selectField({ id: 'bank_import_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency) })}
        ${inputField({ id: 'bank_import_account', label: 'Fallback account name', value: draft.account, placeholder: 'Optional fallback account label' })}
        ${inputField({ id: 'bank_import_source', label: 'Source tag', value: draft.source, placeholder: 'BANK_IMPORT or other source tag' })}
        ${textAreaField({ id: 'bank_import_csv', label: 'CSV rows', value: draft.csv, placeholder: 'date,amount,description,account,currency,type\n2026-03-01,1500,Client receipt,Wise GBP Main,GBP,CREDIT', hint: 'Headers supported: date, amount, description, account, currency, type, category, reference, entity' })}
      </form>
    `,
    footer: formActions('bank-import-form', 'Import rows')
  });
}

function openTransactionMatchModal(transactionId) {
  const tx = findTransaction(transactionId);
  if (!tx) return;
  const invoices = openInvoicesForMatching(tx);
  setModal({
    id: 'transaction-match',
    eyebrow: 'Cash application',
    title: `Match ${tx.reference || tx.id}`,
    subtitle: `${money(tx.amount || 0, tx.currency)} available to allocate`,
    size: 'wide',
    body: `
      <form id="transaction-match-form" class="form-grid form-grid--single" data-record-id="${tx.id}">
        <div class="muted-copy">Enter allocation amounts against one or more open invoices. Only positive values will be submitted.</div>
        <div class="detail-table-wrap">
          <table class="detail-table detail-table--compact">
            <thead>
              <tr><th>Invoice</th><th>Client</th><th>Due</th><th>Outstanding</th><th>Allocate</th></tr>
            </thead>
            <tbody>
              ${invoices.length ? invoices.map((invoice) => `
                <tr>
                  <td>${escapeHtml(invoice.invoiceNumber)}${invoice.suggestion ? `<br/><span class="muted-copy">${escapeHtml((invoice.suggestion.reasons || []).join(' · ') || 'Suggested')}</span>` : ''}</td>
                  <td>${escapeHtml(invoice.clientName || 'Unknown client')}</td>
                  <td>${escapeHtml(shortDate(invoice.dueDate))}</td>
                  <td>${money(invoice.outstanding, invoice.currency)}${invoice.suggestion ? `<br/>${badge(invoice.suggestion.confidenceLabel, invoice.suggestion.confidenceScore >= 85 ? 'success' : invoice.suggestion.confidenceScore >= 65 ? 'warning' : 'neutral')}` : ''}</td>
                  <td><input type="number" min="0" step="0.01" data-allocation-invoice="${invoice.id}" value="${invoice.suggestion?.suggestedAmount || ''}" placeholder="0.00" /></td>
                </tr>
              `).join('') : `<tr><td colspan="5">No open invoices are available for this currency.</td></tr>`}
            </tbody>
          </table>
        </div>
      </form>
    `,
    footer: formActions('transaction-match-form', 'Apply match')
  });
}

function openReconciliationReviewModal(transactionId, decision = 'FLAG_EXCEPTION') {
  const tx = findTransaction(transactionId);
  if (!tx) return;
  const queueItem = findReconciliationQueueItem(transactionId);
  const decisionLabel = decision.replace(/_/g, ' ');
  const reviewers = employeeOptions(state);
  const categoryDefaults = {
    NEEDS_REMITTANCE: 'REMITTANCE',
    IGNORE_DUPLICATE: 'DUPLICATE',
    FOLLOW_UP_REQUIRED: 'CUSTOMER_FOLLOW_UP',
    DEFERRED: 'DEFERRED',
    REVIEWED_PENDING: 'ALLOCATION_REVIEW',
    FLAG_EXCEPTION: 'EXCEPTION'
  };
  const selectedCategory = queueItem?.followUpCategory || categoryDefaults[decision] || 'EXCEPTION';
  setModal({
    id: 'reconciliation-review',
    eyebrow: 'Reconciliation review',
    title: `${decisionLabel[0]}${decisionLabel.slice(1).toLowerCase()} · ${tx.reference || tx.id}`,
    subtitle: `${money(tx.remainingAmount || Math.abs(Number(tx.amount || 0)), tx.currency)} remaining · ${queueItem?.nextAction || 'Manual review'}`,
    body: `
      <form id="reconciliation-review-form" class="form-grid form-grid--single" data-record-id="${tx.id}" data-decision="${decision}">
        <div class="callout callout--warning">
          <strong>Review context</strong>
          <p>${escapeHtml(queueItem?.issueReasons?.[0] || 'Capture the reviewer decision and any note that should stay with this cash row.')}</p>
        </div>
        ${selectField({
          id: 'reconciliation_review_category',
          label: 'Category',
          options: selectOptions(['REMITTANCE', 'DUPLICATE', 'CUSTOMER_FOLLOW_UP', 'BANK_QUERY', 'ALLOCATION_REVIEW', 'DEFERRED', 'EXCEPTION'], (row) => row, (row) => row.replace(/_/g, ' '), selectedCategory)
        })}
        ${selectField({
          id: 'reconciliation_follow_up_owner',
          label: 'Follow-up owner',
          options: selectOptions(reviewers, (row) => row.id, (row) => `${row.name} · ${row.role}`, queueItem?.followUpOwnerUserId || state.session.user?.id || state.session.user?.sub, 'Assign owner')
        })}
        ${decision === 'DEFERRED' ? inputField({ id: 'reconciliation_deferred_until', label: 'Deferred until', type: 'date', value: queueItem?.deferredUntil || '', required: true }) : ''}
        ${textAreaField({ id: 'reconciliation_review_note', label: 'Reviewer note', value: queueItem?.reconciliationReviewNote || '', placeholder: 'Explain why this transaction needs remittance, should be ignored as a duplicate, or should stay flagged for follow-up/exception review.', hint: 'This note will remain visible in the transaction drawer and reconciliation queue.' })}
      </form>
    `,
    footer: formActions('reconciliation-review-form', 'Save review decision')
  });
}

function openBankingBulkActionModal(action) {
  const selected = selectedIds('banking');
  const rows = currentBankingQueueRows();
  const selectedRows = rows.filter((row) => selected.includes(row.transactionId));
  const labels = {
    QUICK_MATCH: 'Apply best match',
    IGNORE_DUPLICATE: 'Ignore duplicates',
    NEEDS_REMITTANCE: 'Mark needs remittance',
    CLEAR_REVIEW: 'Clear review state'
  };
  const eligibility = {
    QUICK_MATCH: selectedRows.filter((row) => row.safeBulkActions?.includes('QUICK_MATCH')),
    IGNORE_DUPLICATE: selectedRows.filter((row) => row.safeBulkActions?.includes('IGNORE_DUPLICATE')),
    NEEDS_REMITTANCE: selectedRows.filter((row) => row.safeBulkActions?.includes('NEEDS_REMITTANCE')),
    CLEAR_REVIEW: selectedRows.filter((row) => row.safeBulkActions?.includes('CLEAR_REVIEW'))
  }[action] || [];
  const ineligible = selectedRows.filter((row) => !eligibility.includes(row));

  setModal({
    id: 'banking-bulk-action',
    eyebrow: 'Cash operations',
    title: labels[action] || action,
    subtitle: `${selectedRows.length} selected · ${eligibility.length} eligible`,
    body: `
      <form id="banking-bulk-action-form" class="form-grid form-grid--single" data-action-name="${action}">
        <div class="callout ${eligibility.length ? 'callout--warning' : 'callout--danger'}">
          <div>
            <strong>${eligibility.length ? `${eligibility.length} rows will be updated` : 'No selected rows are eligible'}</strong>
            <p>${eligibility.length
              ? 'This action only runs on rows that meet the current cash-ops safety rules.'
              : 'Change the selection or queue filters before running this bulk action.'}</p>
          </div>
        </div>
        ${textAreaField({ id: 'banking_bulk_note', label: 'Reviewer note', value: '', placeholder: 'Optional note for the bulk review trail.', hint: 'Saved to each affected cash row.' })}
        ${ineligible.length ? detailSection('Skipped rows', detailTable(['Transaction', 'Why skipped'], ineligible.map((row) => `
          <tr>
            <td>${escapeHtml(row.reference || row.transactionId)}</td>
            <td>${escapeHtml(row.nextAction || 'Not eligible for this action')}</td>
          </tr>
        `))) : ''}
      </form>
    `,
    footer: formActions('banking-bulk-action-form', labels[action] || 'Run bulk action')
  });
}

function openIntercompanyCreateModal() {
  const draft = state.drafts.intercompany;
  const fundingRails = cashRailsForBanking(draft.fromEntity, draft.currency);
  const receivingRails = cashRailsForBanking(draft.toEntity, draft.currency);
  setModal({
    id: 'intercompany-create',
    eyebrow: 'Treasury action',
    title: 'Create funding entry',
    subtitle: 'Record a controlled intercompany due-to / due-from funding event.',
    body: `
      <form id="intercompany-create-form" class="form-grid form-grid--three">
        ${inputField({ id: 'ic_date', label: 'Date', type: 'date', value: draft.date, required: true })}
        ${selectField({ id: 'ic_fromEntity', label: 'From entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, draft.fromEntity) })}
        ${selectField({ id: 'ic_toEntity', label: 'To entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, draft.toEntity) })}
        ${selectField({ id: 'ic_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency) })}
        ${inputField({ id: 'ic_amount', label: 'Amount', type: 'number', value: String(draft.amount), min: 0.01, step: '0.01', required: true })}
        ${selectField({ id: 'ic_sourceAccountId', label: 'Funding rail', options: selectOptions(fundingRails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, draft.sourceAccountId, 'Optional funding rail') })}
        ${selectField({ id: 'ic_receivingSourceAccountId', label: 'Receiving rail', options: selectOptions(receivingRails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, draft.receivingSourceAccountId, 'Optional receiving rail') })}
        ${inputField({ id: 'ic_reference', label: 'Reference', value: draft.reference, placeholder: 'Treasury reference' })}
        ${inputField({ id: 'ic_reason', label: 'Reason', value: draft.reason, required: true })}
        ${textAreaField({ id: 'ic_description', label: 'Description', value: draft.description, placeholder: 'What is this funding entry for?' })}
        ${textAreaField({ id: 'ic_notes', label: 'Notes', value: draft.notes, placeholder: 'Optional treasury notes' })}
      </form>
    `,
    footer: formActions('intercompany-create-form', 'Create entry')
  });
}

function openIntercompanyRepayModal(entryId) {
  const entry = findIntercompany(entryId);
  if (!entry) return;
  const payingRails = cashRailsForBanking(entry.toEntity, entry.currency);
  const receivingRails = cashRailsForBanking(entry.fromEntity, entry.currency);
  setModal({
    id: 'intercompany-repay',
    eyebrow: 'Treasury repayment',
    title: `Repay ${entry.reference || entry.id}`,
    subtitle: `${entry.toEntity} repays ${money(entry.outstandingAmount || entry.amount || 0, entry.currency)} to ${entry.fromEntity}`,
    body: `
      <form id="intercompany-repay-form" class="form-grid form-grid--three" data-record-id="${entry.id}">
        ${inputField({ id: 'ic_repay_date', label: 'Repayment date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${inputField({ id: 'ic_repay_amount', label: 'Repayment amount', type: 'number', value: String(entry.outstandingAmount || entry.amount || 0), min: 0.01, step: '0.01', required: true })}
        ${selectField({ id: 'ic_repay_sourceAccountId', label: 'Payer rail', options: selectOptions(payingRails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, '', 'Select payer rail') })}
        ${selectField({ id: 'ic_repay_receivingSourceAccountId', label: 'Receiving rail', options: selectOptions(receivingRails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, '', 'Select receiving rail') })}
        ${inputField({ id: 'ic_repay_reference', label: 'Reference', value: `${entry.reference || entry.id}-REPAY` })}
        ${textAreaField({ id: 'ic_repay_description', label: 'Description', value: '', placeholder: 'Optional repayment description' })}
      </form>
    `,
    footer: formActions('intercompany-repay-form', 'Record repayment')
  });
}

function openExpenseCreateModal() {
  const draft = state.drafts.expense;
  const employees = employeeOptions(state);
  const rails = cashRailsForBanking(draft.entity, draft.currency);
  const losOptions = financeModel().dimensions?.lineOfService || ['TRDEV', 'TRFINANCE', 'TRBUILD'];
  const buOptions = financeModel().dimensions?.businessUnit || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER'];
  setModal({
    id: 'expense-create',
    eyebrow: 'Spend action',
    title: 'Record operating expense',
    subtitle: 'Capture company-paid or employee-paid spend with reimbursement intent explicitly set.',
    size: 'wide',
    body: `
      <form id="expense-create-form" class="form-grid form-grid--three">
        ${inputField({ id: 'expense_date', label: 'Date', type: 'date', value: draft.date, required: true })}
        ${inputField({ id: 'expense_description', label: 'Description', value: draft.description, required: true, placeholder: 'Expense description' })}
        ${inputField({ id: 'expense_amount', label: 'Amount', type: 'number', value: String(draft.amount), min: 0.01, step: '0.01', required: true })}
        ${selectField({ id: 'expense_entity', label: 'Entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, draft.entity) })}
        ${selectField({ id: 'expense_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency) })}
        ${selectField({ id: 'expense_sourceAccountId', label: 'Source rail', options: selectOptions(rails, (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, draft.sourceAccountId, 'Optional source rail') })}
        ${inputField({ id: 'expense_account', label: 'Account label', value: draft.account, placeholder: 'Fallback account name' })}
        ${selectField({ id: 'expense_category', label: 'Category', options: selectOptions(categoryOptions(state), (row) => row, (row) => row, draft.category) })}
        ${selectField({ id: 'expense_businessUnit', label: 'Business unit', options: selectOptions(buOptions, (row) => row, (row) => row, draft.businessUnit) })}
        ${selectField({ id: 'expense_lineOfService', label: 'Line of service', options: selectOptions(losOptions, (row) => row, (row) => row, draft.lineOfService, 'Optional LOS') })}
        ${selectField({ id: 'expense_employeeId', label: 'Employee / claimant', options: selectOptions(employees, (row) => row.id, (row) => row.name, draft.employeeId, 'No employee claimant') })}
        ${checkboxField({ id: 'expense_reimbursementNeeded', label: 'Reimbursement needed', checked: Boolean(draft.reimbursementNeeded), hint: 'Use this for employee-paid expenses that must be settled later.' })}
        ${textAreaField({ id: 'expense_notes', label: 'Notes', value: draft.notes, placeholder: 'Optional finance notes' })}
      </form>
    `,
    footer: formActions('expense-create-form', 'Record expense')
  });
}

function openReimbursementSettleModal(expenseId) {
  const expense = findExpense(expenseId);
  if (!expense) return;
  const rails = cashRailsForBanking(expense.entity, expense.currency);
  setModal({
    id: 'reimbursement-settle',
    eyebrow: 'Reimbursement action',
    title: `Settle ${expense.description || expense.id}`,
    subtitle: `${expense.employeeId || 'Employee'} · ${money(expense.amount || 0, expense.currency)}`,
    body: `
      <form id="reimbursement-settle-form" class="form-grid form-grid--three" data-record-id="${expense.id}">
        ${inputField({ id: 'reimburse_date', label: 'Settlement date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${selectField({ id: 'reimburse_account', label: 'Settlement rail', options: selectOptions(rails, (row) => row.name, (row) => `${row.name} · ${row.entity}/${row.currency}`, expense.reimbursementAccount || '', 'Select settlement rail') })}
        ${inputField({ id: 'reimburse_reference', label: 'Reference', value: `REIMB-${expense.id}` })}
        ${inputField({ id: 'reimburse_source', label: 'Source tag', value: 'ERP_REIMBURSEMENT' })}
        ${textAreaField({ id: 'reimburse_description', label: 'Description', value: `Employee reimbursement ${expense.id}: ${expense.description}` })}
      </form>
    `,
    footer: formActions('reimbursement-settle-form', 'Settle reimbursement')
  });
}

function openExpenseRejectModal(expenseId) {
  const expense = findExpense(expenseId);
  if (!expense) return;
  setModal({
    id: 'expense-reject',
    eyebrow: 'Spend approval',
    title: `Reject ${expense.description || expense.id}`,
    subtitle: 'Capture a clear reason so the expense approval trail is reviewable later.',
    body: `
      <form id="expense-reject-form" class="form-grid form-grid--single" data-record-id="${expense.id}">
        ${textAreaField({ id: 'expense_reject_reason', label: 'Rejection reason', value: expense.rejectionReason || 'Needs clarification', placeholder: 'Explain what needs to change before approval.' })}
      </form>
    `,
    footer: formActions('expense-reject-form', 'Reject expense')
  });
}

function openEvidenceUploadModal(entityType, entityId) {
  const drawerRef = buildDrawerRefForEntity(entityType, entityId);
  const normalized = String(entityType || '').toUpperCase();
  const categoriesByType = {
    INVOICE: ['SUPPORT', 'APPROVAL'],
    CUSTOMER_RECEIPT: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT'],
    VENDOR_BILL: ['VENDOR_INVOICE', 'SUPPORT'],
    VENDOR_PAYMENT: ['BANK_PROOF', 'PAYMENT_SUPPORT'],
    EXPENSE: ['RECEIPT', 'SUPPORT'],
    JOURNAL: ['SUPPORT', 'APPROVAL'],
    CLOSE_PERIOD: ['CLOSE_SUPPORT', 'CLOSE_MEMO', 'REOPEN_SUPPORT']
  };
  setModal({
    id: 'evidence-upload',
    eyebrow: 'Evidence action',
    title: `Add evidence to ${String(entityType || '').replace(/_/g, ' ')}`,
    subtitle: 'Upload supporting finance evidence through a controlled route. Files are not served publicly.',
    body: `
      <form id="evidence-upload-form" class="form-grid form-grid--single" data-entity-type="${escapeHtml(entityType)}" data-record-id="${escapeHtml(entityId)}" data-drawer-ref="${escapeHtml(drawerRef || '')}">
        <label>
          <span>Attachment</span>
          <input id="evidence_file" name="evidence_file" type="file" required />
          <small>Supported via secure app retrieval. Current limit: 2.5 MB.</small>
        </label>
        ${selectField({ id: 'evidence_category', label: 'Category', options: selectOptions(categoriesByType[normalized] || ['SUPPORT'], (row) => row, (row) => row, (categoriesByType[normalized] || ['SUPPORT'])[0]) })}
        ${textAreaField({ id: 'evidence_note', label: 'Note', value: '', placeholder: 'Why this evidence matters for review or close.' })}
      </form>
    `,
    footer: formActions('evidence-upload-form', 'Upload evidence')
  });
}

function openEvidenceRemoveModal(evidenceId, entityType, entityId) {
  const evidence = findEvidenceRecord(evidenceId);
  setModal({
    id: 'evidence-remove',
    eyebrow: 'Evidence action',
    title: `Remove ${evidence?.fileName || evidenceId}`,
    subtitle: 'This retires the evidence record and preserves traceability. Protected finance records block removal.',
    body: `
      <form id="evidence-remove-form" class="form-grid form-grid--single" data-record-id="${escapeHtml(evidenceId)}" data-entity-type="${escapeHtml(entityType || evidence?.entityType || '')}" data-entity-id="${escapeHtml(entityId || evidence?.entityId || '')}">
        ${textAreaField({ id: 'evidence_remove_note', label: 'Removal note', value: 'Superseded by updated evidence', placeholder: 'Explain why this evidence is being removed.' })}
      </form>
    `,
    footer: formActions('evidence-remove-form', 'Remove evidence')
  });
}

function openPeriodCloseModal(periodKey) {
  const period = findClosePeriod(periodKey);
  if (!period) return;
  setModal({
    id: 'period-close',
    eyebrow: 'Close action',
    title: `Close ${period.periodKey}`,
    subtitle: 'Record close notes and attach the support pack or close memo required for signoff.',
    body: `
      <form id="period-close-form" class="form-grid form-grid--single" data-record-id="${period.periodKey}">
        ${textAreaField({ id: 'close_notes', label: 'Close notes', value: '', placeholder: 'Document what was reviewed, what remains, and who approved the close.' })}
        <label>
          <span>Close support attachment (optional if already linked)</span>
          <input id="close_support_file" name="close_support_file" type="file" />
          <small>Attach the close pack or memo as part of the close signoff.</small>
        </label>
        ${selectField({ id: 'close_support_category', label: 'Support category', options: selectOptions(['CLOSE_SUPPORT', 'CLOSE_MEMO'], (row) => row, (row) => row, 'CLOSE_SUPPORT') })}
        ${textAreaField({ id: 'close_support_note', label: 'Support note', value: '', placeholder: 'What this evidence supports for close.' })}
        ${checkboxField({ id: 'close_force', label: 'Force close despite blockers', checked: false, hint: 'Use sparingly and only with deliberate approval.' })}
      </form>
    `,
    footer: formActions('period-close-form', 'Close period')
  });
}

function openPeriodReopenModal(periodKey) {
  const period = findClosePeriod(periodKey);
  if (!period) return;
  setModal({
    id: 'period-reopen',
    eyebrow: 'Reopen action',
    title: `Reopen ${period.periodKey}`,
    subtitle: 'Record a controlled reason and attach supporting evidence for reopening a closed period.',
    body: `
      <form id="period-reopen-form" class="form-grid form-grid--single" data-record-id="${period.periodKey}">
        ${textAreaField({ id: 'reopen_notes', label: 'Reopen reason', value: 'Reopen for controlled correction', placeholder: 'Explain why this closed period must be reopened.' })}
        <label>
          <span>Reopen support attachment (optional if already linked)</span>
          <input id="reopen_support_file" name="reopen_support_file" type="file" />
          <small>Attach the approval memo or other controlled support for the reopen decision.</small>
        </label>
        ${selectField({ id: 'reopen_support_category', label: 'Support category', options: selectOptions(['REOPEN_SUPPORT', 'CLOSE_SUPPORT'], (row) => row, (row) => row, 'REOPEN_SUPPORT') })}
        ${textAreaField({ id: 'reopen_support_note', label: 'Support note', value: '', placeholder: 'What this evidence supports for reopening.' })}
      </form>
    `,
    footer: formActions('period-reopen-form', 'Reopen period')
  });
}

function openRelatedPartyCleanupModal(exceptionId) {
  const exception = findCloseCleanupException(exceptionId);
  if (!exception) return;
  const focus = findClosePeriod(state.data.closeRelatedParty?.periodKey) || findClosePeriod((state.data.closePeriods || [])[0]?.periodKey);
  setModal({
    id: 'related-party-cleanup',
    eyebrow: 'Close adjustment',
    title: `Cleanup ${exception.accountCode} ${exception.entity || ''}`.trim(),
    subtitle: `${money(exception.netNative || 0, exception.currency || 'USD')} · ${exception.currency || 'USD'} · ${exception.support?.length || 0} supporting journal(s)`,
    body: `
      <form id="related-party-cleanup-form" class="form-grid form-grid--single" data-record-id="${exception.id}" data-period-key="${state.data.closeRelatedParty?.periodKey || focus?.periodKey || ''}">
        ${inputField({ id: 'rp_cleanup_postingDate', label: 'Posting date', type: 'date', value: state.data.closeRelatedParty?.end || new Date().toISOString().slice(0, 10), required: true })}
        ${selectField({ id: 'rp_cleanup_offset', label: 'Offset global account', options: selectOptions(globalAccounts(state), (row) => row.id, (row) => `${row.code} | ${row.name}`, '', 'Select offset account') })}
        ${textAreaField({ id: 'rp_cleanup_memo', label: 'Memo', value: `Cleanup historical related-party balance ${exception.id}`, placeholder: 'Explain why this cleanup journal is required.' })}
      </form>
    `,
    footer: formActions('related-party-cleanup-form', 'Create cleanup journal')
  });
}

function journalLineFieldset(index, draft = {}) {
  return `
    <div class="detail-section">
      <h4>Line ${index + 1}</h4>
      <div class="form-grid form-grid--three">
        ${selectField({
          id: `journal_line_${index}_account`,
          label: 'Global account',
          options: selectOptions(globalAccounts(state), (row) => row.id, (row) => `${row.code} | ${row.name}`, draft.globalAccountId || '', 'Select account')
        })}
        ${inputField({ id: `journal_line_${index}_description`, label: 'Description', value: draft.description || '', placeholder: 'Line memo' })}
        ${inputField({ id: `journal_line_${index}_debit`, label: 'Debit', type: 'number', value: draft.debit || '', min: 0, step: '0.01' })}
        ${inputField({ id: `journal_line_${index}_credit`, label: 'Credit', type: 'number', value: draft.credit || '', min: 0, step: '0.01' })}
      </div>
    </div>
  `;
}

function openJournalCreateModal() {
  const draft = state.drafts.journal || {};
  const lines = Array.from({ length: 4 }, () => ({}));
  setModal({
    id: 'journal-create',
    eyebrow: 'GL action',
    title: 'Create journal',
    subtitle: 'Record a balanced manual or adjustment journal with explicit posting control.',
    size: 'wide',
    body: `
      <form id="journal-create-form" class="form-grid form-grid--three">
        ${inputField({ id: 'journal_postingDate', label: 'Posting date', type: 'date', value: draft.postingDate, required: true })}
        ${selectField({ id: 'journal_entity', label: 'Entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, draft.entity || 'US') })}
        ${selectField({ id: 'journal_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, draft.currency || 'USD') })}
        ${selectField({ id: 'journal_type', label: 'Journal type', options: selectOptions(['MANUAL', 'ADJUSTMENT'], (row) => row, (row) => row, draft.journalType || 'MANUAL') })}
        ${textAreaField({ id: 'journal_memo', label: 'Memo', value: draft.memo || '', placeholder: 'Why is this journal needed?' })}
        <div class="form-grid__span-full">
          ${lines.map((line, index) => journalLineFieldset(index, line)).join('')}
        </div>
      </form>
    `,
    footer: formActions('journal-create-form', 'Create journal')
  });
}

function openJournalRejectModal(journalId) {
  const journal = findJournal(journalId);
  if (!journal) return;
  setModal({
    id: 'journal-reject',
    eyebrow: 'Journal approval',
    title: `Reject ${journal.journalNumber || journal.id}`,
    subtitle: 'Capture a reason for the accounting review trail.',
    body: `
      <form id="journal-reject-form" class="form-grid form-grid--single" data-record-id="${journal.id}">
        ${textAreaField({ id: 'journal_reject_reason', label: 'Rejection reason', value: journal.rejectionReason || 'Needs correction', placeholder: 'Explain what needs to change before approval.' })}
      </form>
    `,
    footer: formActions('journal-reject-form', 'Reject journal')
  });
}

function openJournalReverseModal(journalId) {
  const journal = findJournal(journalId);
  if (!journal) return;
  setModal({
    id: 'journal-reverse',
    eyebrow: 'Journal reversal',
    title: `Reverse ${journal.journalNumber || journal.id}`,
    subtitle: 'Create a posted reversal journal with a controlled reversal date.',
    body: `
      <form id="journal-reverse-form" class="form-grid form-grid--single" data-record-id="${journal.id}">
        ${inputField({ id: 'journal_reverse_date', label: 'Reversal date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${textAreaField({ id: 'journal_reverse_memo', label: 'Reversal memo', value: `Reversal of ${journal.journalNumber || journal.id}`, placeholder: 'Why is this reversal required?' })}
      </form>
    `,
    footer: formActions('journal-reverse-form', 'Reverse journal')
  });
}

function openSourceAccountModal() {
  setModal({
    id: 'source-account-create',
    eyebrow: 'Governance action',
    title: 'Create source account',
    subtitle: 'Add a governed source-ledger or cash-rail account visible to finance operators.',
    body: `
      <form id="source-account-form" class="form-grid form-grid--three">
        ${inputField({ id: 'source_account_name', label: 'Name', required: true, placeholder: 'Meezan Main PKR' })}
        ${inputField({ id: 'source_account_provider', label: 'Provider', value: 'MANUAL', placeholder: 'QBO, Wise, BoFA, Meezan' })}
        ${inputField({ id: 'source_account_sourceSystem', label: 'Source system', value: 'MANUAL', placeholder: 'MANUAL, QBO, etc.' })}
        ${inputField({ id: 'source_account_sourceLedger', label: 'Source ledger', value: 'MANUAL' })}
        ${selectField({ id: 'source_account_entity', label: 'Entity', options: selectOptions(entityOptions(state), (row) => row, (row) => row, 'US') })}
        ${selectField({ id: 'source_account_currency', label: 'Currency', options: selectOptions(['USD', 'GBP', 'PKR'], (row) => row, (row) => row, 'USD') })}
        ${selectField({ id: 'source_account_role', label: 'Account role', options: selectOptions(['BANK', 'CREDIT_CARD', 'AR', 'AP', 'REVENUE', 'EXPENSE', 'FIXED_ASSET', 'OTHER_ASSET', 'OTHER_LIABILITY', 'EQUITY'], (row) => row, (row) => row, 'BANK') })}
        ${checkboxField({ id: 'source_account_cash', label: 'Cash account', checked: true })}
        ${checkboxField({ id: 'source_account_visible', label: 'Show in Banking workspace', checked: true })}
        ${textAreaField({ id: 'source_account_notes', label: 'Notes', value: '', placeholder: 'Optional governance notes' })}
      </form>
    `,
    footer: formActions('source-account-form', 'Create source account')
  });
}

function openGlobalAccountModal() {
  setModal({
    id: 'global-account-create',
    eyebrow: 'Governance action',
    title: 'Create global account',
    subtitle: 'Add a consolidated reporting account to the global chart.',
    body: `
      <form id="global-account-form" class="form-grid form-grid--three">
        ${inputField({ id: 'global_account_code', label: 'Code', required: true, placeholder: '6100' })}
        ${inputField({ id: 'global_account_name', label: 'Name', required: true, placeholder: 'Professional fees' })}
        ${selectField({ id: 'global_account_type', label: 'Type', options: selectOptions(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'OTHER'], (row) => row, (row) => row, 'EXPENSE') })}
        ${inputField({ id: 'global_account_reportingGroup', label: 'Reporting group', placeholder: 'Operating Expense' })}
        ${textAreaField({ id: 'global_account_notes', label: 'Notes', value: '', placeholder: 'Optional reporting notes' })}
      </form>
    `,
    footer: formActions('global-account-form', 'Create global account')
  });
}

function openAccountMappingModal() {
  setModal({
    id: 'account-mapping-create',
    eyebrow: 'Governance action',
    title: 'Create account mapping',
    subtitle: 'Map a source account into the global chart, with optional overrides.',
    body: `
      <form id="account-mapping-form" class="form-grid form-grid--three">
        ${selectField({ id: 'mapping_sourceAccountId', label: 'Source account', options: selectOptions(sourceAccounts(state), (row) => row.id, (row) => `${row.name} · ${row.entity}/${row.currency}`, '', 'Select source account') })}
        ${selectField({ id: 'mapping_globalAccountId', label: 'Global account', options: selectOptions(globalAccounts(state), (row) => row.id, (row) => `${row.code} | ${row.name}`, '', 'Select global account') })}
        ${selectField({ id: 'mapping_entityOverride', label: 'Entity override', options: selectOptions(entityOptions(state), (row) => row, (row) => row, '', 'No entity override') })}
        ${selectField({ id: 'mapping_lineOfServiceOverride', label: 'LOS override', options: selectOptions(financeModel().dimensions?.lineOfService || ['TRDEV', 'TRFINANCE', 'TRBUILD'], (row) => row, (row) => row, '', 'No LOS override') })}
        ${selectField({ id: 'mapping_businessUnitOverride', label: 'BU override', options: selectOptions(financeModel().dimensions?.businessUnit || ['SERVICES', 'CORPORATE', 'TREASURY', 'PONCHO', 'TOWER'], (row) => row, (row) => row, '', 'No BU override') })}
        ${textAreaField({ id: 'mapping_notes', label: 'Notes', value: '', placeholder: 'Optional mapping notes' })}
      </form>
    `,
    footer: formActions('account-mapping-form', 'Create mapping')
  });
}

function openModalByAction(action, id = null, context = {}) {
  if (action === 'open-invoice-create') return openInvoiceCreateModal();
  if (action === 'open-invoice-reject') return openInvoiceRejectModal(id);
  if (action === 'open-invoice-payment') return openInvoicePaymentModal(id);
  if (action === 'open-bill-create') return openBillCreateModal();
  if (action === 'open-bill-reject') return openBillRejectModal(id);
  if (action === 'open-bill-pay') return openBillPayModal(id);
  if (action === 'open-bank-import') return openBankImportModal();
  if (action === 'open-transaction-match') return openTransactionMatchModal(id);
  if (action === 'open-reconciliation-review') return openReconciliationReviewModal(id, context.decision || 'FLAG_EXCEPTION');
  if (action === 'open-intercompany-create') return openIntercompanyCreateModal();
  if (action === 'open-intercompany-settle' || action === 'open-intercompany-repay') return openIntercompanyRepayModal(id);
  if (action === 'open-expense-create') return openExpenseCreateModal();
  if (action === 'open-expense-reject') return openExpenseRejectModal(id);
  if (action === 'open-reimbursement-settle') return openReimbursementSettleModal(id);
  if (action === 'open-evidence-upload') return openEvidenceUploadModal(context.entityType, context.entityId || id);
  if (action === 'open-evidence-remove') return openEvidenceRemoveModal(id, context.entityType, context.entityId);
  if (action === 'open-period-close') return openPeriodCloseModal(id);
  if (action === 'open-period-reopen') return openPeriodReopenModal(id);
  if (action === 'open-related-party-cleanup') return openRelatedPartyCleanupModal(id);
  if (action === 'open-journal-create') return openJournalCreateModal();
  if (action === 'open-journal-reject') return openJournalRejectModal(id);
  if (action === 'open-journal-reverse') return openJournalReverseModal(id);
  if (action === 'open-source-account-modal') return openSourceAccountModal();
  if (action === 'open-global-account-modal') return openGlobalAccountModal();
  if (action === 'open-account-mapping-modal') return openAccountMappingModal();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function checkboxValue(form, id) {
  return Boolean(form.querySelector(`#${id}`)?.checked);
}

function numberValue(form, id) {
  const value = Number(form.querySelector(`#${id}`)?.value);
  return Number.isFinite(value) ? value : 0;
}

async function submitInvoiceCreate(form) {
  const values = formValues(form);
  const payload = {
    projectId: values.invoice_projectId || null,
    clientId: values.invoice_clientId || null,
    clientName: values.invoice_clientName || null,
    issueDate: values.invoice_issueDate,
    dueDate: values.invoice_dueDate,
    entity: values.invoice_entity,
    currency: values.invoice_currency,
    businessUnit: values.invoice_businessUnit,
    lineOfService: values.invoice_lineOfService || null,
    channel: values.invoice_channel || null,
    taxRate: Number(values.invoice_taxRate || 0),
    notes: values.invoice_notes || '',
    manualLines: [{
      description: values.invoice_description,
      qty: Number(values.invoice_qty || 0),
      rate: Number(values.invoice_rate || 0)
    }]
  };
  const response = await request('/api/invoices', { method: 'POST', body: payload });
  closeModal();
  await refreshCurrentWorkspace({ notice: `Invoice ${response.invoice.invoiceNumber} created.`, reopenDrawerRef: `invoice:${response.invoice.id}` });
}

async function submitInvoiceReject(form) {
  const invoiceId = form.dataset.recordId;
  await request(`/api/invoices/${invoiceId}/reject`, {
    method: 'POST',
    body: { reason: form.querySelector('#invoice_reject_reason')?.value || 'Needs revision' }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Invoice rejected.', reopenDrawerRef: `invoice:${invoiceId}` });
}

async function submitInvoicePayment(form) {
  const invoiceId = form.dataset.recordId;
  const supportingEvidence = await optionalEvidencePayload(form, {
    fileFieldId: 'invoice_payment_support_file',
    categoryFieldId: 'invoice_payment_support_category',
    noteFieldId: 'invoice_payment_support_note'
  });
  await request('/api/payments', {
    method: 'POST',
    body: {
      invoiceId,
      amount: numberValue(form, 'invoice_payment_amount'),
      reference: form.querySelector('#invoice_payment_reference')?.value || null,
      paidAt: form.querySelector('#invoice_payment_date')?.value || new Date().toISOString().slice(0, 10),
      supportingEvidence: supportingEvidence ? [supportingEvidence] : []
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Payment recorded.', reopenDrawerRef: `invoice:${invoiceId}` });
}

async function submitBillCreate(form) {
  const values = formValues(form);
  const response = await request('/api/payables/bills', {
    method: 'POST',
    body: {
      vendorId: values.bill_vendorId || null,
      vendorName: values.bill_vendorName || null,
      billNumber: values.bill_billNumber || null,
      billDate: values.bill_billDate,
      dueDate: values.bill_dueDate,
      entity: values.bill_entity,
      currency: values.bill_currency,
      category: values.bill_category,
      businessUnit: values.bill_businessUnit,
      lineOfService: values.bill_lineOfService || null,
      description: values.bill_description,
      total: Number(values.bill_total || 0),
      notes: values.bill_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: `Vendor bill ${response.bill.billNumber || response.bill.id} created.`, reopenDrawerRef: `bill:${response.bill.id}` });
}

async function submitBillReject(form) {
  const billId = form.dataset.recordId;
  await request(`/api/payables/bills/${billId}/reject`, {
    method: 'POST',
    body: { reason: form.querySelector('#bill_reject_reason')?.value || 'Needs correction' }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Vendor bill rejected.', reopenDrawerRef: `bill:${billId}` });
}

async function submitBillPay(form) {
  const billId = form.dataset.recordId;
  const supportingEvidence = await optionalEvidencePayload(form, {
    fileFieldId: 'bill_pay_support_file',
    categoryFieldId: 'bill_pay_support_category',
    noteFieldId: 'bill_pay_support_note'
  });
  await request(`/api/payables/bills/${billId}/pay`, {
    method: 'POST',
    body: {
      amount: numberValue(form, 'bill_pay_amount'),
      date: form.querySelector('#bill_pay_date')?.value || new Date().toISOString().slice(0, 10),
      sourceAccountId: form.querySelector('#bill_pay_sourceAccountId')?.value || null,
      reference: form.querySelector('#bill_pay_reference')?.value || null,
      notes: form.querySelector('#bill_pay_notes')?.value || '',
      supportingEvidence: supportingEvidence ? [supportingEvidence] : []
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Vendor payment recorded.', reopenDrawerRef: `bill:${billId}` });
}

async function submitBankImport(form) {
  const values = formValues(form);
  const response = await request('/api/transactions/import', {
    method: 'POST',
    body: {
      sourceAccountId: values.bank_import_sourceAccountId || null,
      entity: values.bank_import_entity || null,
      currency: values.bank_import_currency || null,
      account: values.bank_import_account || null,
      source: values.bank_import_source || 'BANK_IMPORT',
      csv: values.bank_import_csv || ''
    }
  });
  closeModal();
  const reviewSummary = response.reviewSummary || {};
  const suffix = [
    reviewSummary.duplicateSuspects ? `${reviewSummary.duplicateSuspects} duplicate suspects` : '',
    reviewSummary.suggestedMatches ? `${reviewSummary.suggestedMatches} rows with suggested matches` : '',
    reviewSummary.needsRemittance ? `${reviewSummary.needsRemittance} rows needing remittance support` : ''
  ].filter(Boolean).join(' · ');
  await refreshCurrentWorkspace({
    notice: `${response.imported || 0} bank rows imported.${suffix ? ` ${suffix}.` : ''}`
  });
}

async function submitTransactionMatch(form) {
  const transactionId = form.dataset.recordId;
  const allocations = [...form.querySelectorAll('[data-allocation-invoice]')]
    .map((input) => ({ invoiceId: input.dataset.allocationInvoice, amount: Number(input.value || 0) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
  if (!allocations.length) throw new Error('Enter at least one positive allocation amount.');
  await request(`/api/transactions/${transactionId}/match`, {
    method: 'POST',
    body: { allocations }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Cash application saved.', reopenDrawerRef: `transaction:${transactionId}` });
}

async function submitReconciliationReview(form) {
  const transactionId = form.dataset.recordId;
  const decision = form.dataset.decision;
  await request(`/api/reconciliation/transactions/${transactionId}/review`, {
    method: 'POST',
    body: {
      decision,
      note: form.querySelector('#reconciliation_review_note')?.value || '',
      category: form.querySelector('#reconciliation_review_category')?.value || '',
      deferredUntil: form.querySelector('#reconciliation_deferred_until')?.value || null,
      followUpOwnerUserId: form.querySelector('#reconciliation_follow_up_owner')?.value || null
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Reconciliation review updated.', reopenDrawerRef: `transaction:${transactionId}` });
}

async function submitBankingBulkAction(form) {
  const action = form.dataset.actionName;
  const transactionIds = selectedIds('banking');
  const response = await request('/api/reconciliation/bulk', {
    method: 'POST',
    body: {
      action,
      transactionIds,
      note: form.querySelector('#banking_bulk_note')?.value || ''
    }
  });
  closeModal();
  resetSelections('banking');
  const processed = response.processed?.length || 0;
  const skipped = response.eligibility?.ineligibleCount || 0;
  await refreshCurrentWorkspace({
    notice: `${processed} cash rows updated.${skipped ? ` ${skipped} rows were skipped because they were not eligible.` : ''}`
  });
}

async function submitIntercompanyCreate(form) {
  const values = formValues(form);
  const response = await request('/api/intercompany/entries', {
    method: 'POST',
    body: {
      date: values.ic_date,
      fromEntity: values.ic_fromEntity,
      toEntity: values.ic_toEntity,
      currency: values.ic_currency,
      amount: Number(values.ic_amount || 0),
      sourceAccountId: values.ic_sourceAccountId || null,
      receivingSourceAccountId: values.ic_receivingSourceAccountId || null,
      reference: values.ic_reference || null,
      reason: values.ic_reason || 'Intercompany Funding',
      description: values.ic_description || '',
      notes: values.ic_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Intercompany funding entry created.', reopenDrawerRef: `intercompany:${response.entry.id}` });
}

async function submitIntercompanyRepay(form) {
  const entryId = form.dataset.recordId;
  await request(`/api/intercompany/entries/${entryId}/repay`, {
    method: 'POST',
    body: {
      date: form.querySelector('#ic_repay_date')?.value || new Date().toISOString().slice(0, 10),
      amount: numberValue(form, 'ic_repay_amount'),
      sourceAccountId: form.querySelector('#ic_repay_sourceAccountId')?.value || null,
      receivingSourceAccountId: form.querySelector('#ic_repay_receivingSourceAccountId')?.value || null,
      reference: form.querySelector('#ic_repay_reference')?.value || null,
      description: form.querySelector('#ic_repay_description')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Intercompany repayment recorded.', reopenDrawerRef: `intercompany:${entryId}` });
}

async function submitExpenseCreate(form) {
  const values = formValues(form);
  const response = await request('/api/expenses', {
    method: 'POST',
    body: {
      date: values.expense_date,
      description: values.expense_description,
      amount: Number(values.expense_amount || 0),
      entity: values.expense_entity,
      currency: values.expense_currency,
      sourceAccountId: values.expense_sourceAccountId || null,
      account: values.expense_account || null,
      category: values.expense_category,
      businessUnit: values.expense_businessUnit,
      lineOfService: values.expense_lineOfService || null,
      employeeId: values.expense_employeeId || null,
      reimbursementNeeded: checkboxValue(form, 'expense_reimbursementNeeded'),
      notes: values.expense_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Expense recorded.', reopenDrawerRef: `expense:${response.expense.id}` });
}

async function submitExpenseReject(form) {
  const expenseId = form.dataset.recordId;
  await request(`/api/expenses/${expenseId}/reject`, {
    method: 'POST',
    body: {
      reason: form.querySelector('#expense_reject_reason')?.value || 'Needs clarification'
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Expense rejected.', reopenDrawerRef: `expense:${expenseId}` });
}

async function submitReimbursementSettle(form) {
  const expenseId = form.dataset.recordId;
  await request(`/api/reimbursements/${expenseId}/settle`, {
    method: 'POST',
    body: {
      date: form.querySelector('#reimburse_date')?.value || new Date().toISOString().slice(0, 10),
      account: form.querySelector('#reimburse_account')?.value || null,
      reference: form.querySelector('#reimburse_reference')?.value || null,
      source: form.querySelector('#reimburse_source')?.value || 'ERP_REIMBURSEMENT',
      description: form.querySelector('#reimburse_description')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Reimbursement settled.', reopenDrawerRef: `expense:${expenseId}` });
}

async function submitEvidenceUpload(form) {
  const entityType = form.dataset.entityType;
  const entityId = form.dataset.recordId;
  const drawerRef = form.dataset.drawerRef || buildDrawerRefForEntity(entityType, entityId);
  const fileInput = form.querySelector('#evidence_file');
  const file = fileInput?.files?.[0];
  if (!file) throw new Error('Select an attachment before uploading.');
  const contentBase64 = await fileToBase64(file);
  await request('/api/evidence', {
    method: 'POST',
    body: {
      entityType,
      entityId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
      category: form.querySelector('#evidence_category')?.value || 'SUPPORT',
      note: form.querySelector('#evidence_note')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Evidence uploaded.', reopenDrawerRef: drawerRef });
}

async function submitEvidenceRemove(form) {
  const evidenceId = form.dataset.recordId;
  const entityType = form.dataset.entityType;
  const entityId = form.dataset.entityId;
  await request(`/api/evidence/${evidenceId}`, {
    method: 'DELETE',
    body: {
      note: form.querySelector('#evidence_remove_note')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Evidence removed.', reopenDrawerRef: buildDrawerRefForEntity(entityType, entityId) });
}

async function submitPeriodClose(form) {
  const periodKey = form.dataset.recordId;
  const supportingEvidence = await optionalEvidencePayload(form, {
    fileFieldId: 'close_support_file',
    categoryFieldId: 'close_support_category',
    noteFieldId: 'close_support_note'
  });
  await request(`/api/close/periods/${periodKey}/close`, {
    method: 'POST',
    body: {
      notes: form.querySelector('#close_notes')?.value || '',
      force: checkboxValue(form, 'close_force'),
      supportingEvidence: supportingEvidence ? [supportingEvidence] : []
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: `Period ${periodKey} closed.`, reopenDrawerRef: `period:${periodKey}` });
}

async function submitPeriodReopen(form) {
  const periodKey = form.dataset.recordId;
  const supportingEvidence = await optionalEvidencePayload(form, {
    fileFieldId: 'reopen_support_file',
    categoryFieldId: 'reopen_support_category',
    noteFieldId: 'reopen_support_note'
  });
  await request(`/api/close/periods/${periodKey}/reopen`, {
    method: 'POST',
    body: {
      notes: form.querySelector('#reopen_notes')?.value || '',
      supportingEvidence: supportingEvidence ? [supportingEvidence] : []
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: `Period ${periodKey} reopened.`, reopenDrawerRef: `period:${periodKey}` });
}

async function submitRelatedPartyCleanup(form) {
  const periodKey = form.dataset.periodKey;
  const exceptionId = form.dataset.recordId;
  const payload = await request(`/api/close/periods/${periodKey}/related-party-cleanup`, {
    method: 'POST',
    body: {
      exceptionId,
      postingDate: form.querySelector('#rp_cleanup_postingDate')?.value || '',
      offsetGlobalAccountId: form.querySelector('#rp_cleanup_offset')?.value || null,
      memo: form.querySelector('#rp_cleanup_memo')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({
    notice: payload.duplicate ? 'Existing cleanup journal reused.' : 'Cleanup journal created.',
    reopenDrawerRef: `journal:${payload.journal.id}`
  });
}

async function submitJournalCreate(form) {
  const lines = Array.from({ length: 4 }, (_, index) => ({
    globalAccountId: form.querySelector(`#journal_line_${index}_account`)?.value || '',
    description: form.querySelector(`#journal_line_${index}_description`)?.value || '',
    debit: Number(form.querySelector(`#journal_line_${index}_debit`)?.value || 0),
    credit: Number(form.querySelector(`#journal_line_${index}_credit`)?.value || 0)
  })).filter((line) => line.globalAccountId && (line.debit > 0 || line.credit > 0));

  const response = await request('/api/journals', {
    method: 'POST',
    body: {
      postingDate: form.querySelector('#journal_postingDate')?.value || new Date().toISOString().slice(0, 10),
      entity: form.querySelector('#journal_entity')?.value || 'US',
      currency: form.querySelector('#journal_currency')?.value || 'USD',
      journalType: form.querySelector('#journal_type')?.value || 'MANUAL',
      memo: form.querySelector('#journal_memo')?.value || '',
      lines
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: `Journal ${response.journal.journalNumber} created.`, reopenDrawerRef: `journal:${response.journal.id}` });
}

async function submitJournalReject(form) {
  const journalId = form.dataset.recordId;
  await request(`/api/journals/${journalId}/reject`, {
    method: 'POST',
    body: { reason: form.querySelector('#journal_reject_reason')?.value || 'Needs correction' }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Journal rejected.', reopenDrawerRef: `journal:${journalId}` });
}

async function submitJournalReverse(form) {
  const journalId = form.dataset.recordId;
  await request(`/api/journals/${journalId}/reverse`, {
    method: 'POST',
    body: {
      postingDate: form.querySelector('#journal_reverse_date')?.value || new Date().toISOString().slice(0, 10),
      memo: form.querySelector('#journal_reverse_memo')?.value || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Journal reversed.', reopenDrawerRef: `journal:${journalId}` });
}

async function submitSourceAccount(form) {
  const values = formValues(form);
  await request('/api/settings/accounts', {
    method: 'POST',
    body: {
      name: values.source_account_name,
      provider: values.source_account_provider,
      sourceSystem: values.source_account_sourceSystem,
      sourceLedger: values.source_account_sourceLedger,
      entity: values.source_account_entity,
      currency: values.source_account_currency,
      accountRole: values.source_account_role,
      isCashAccount: checkboxValue(form, 'source_account_cash'),
      showInBankingHub: checkboxValue(form, 'source_account_visible'),
      notes: values.source_account_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Source account created.' });
}

async function submitGlobalAccount(form) {
  const values = formValues(form);
  await request('/api/settings/global-chart-accounts', {
    method: 'POST',
    body: {
      code: values.global_account_code,
      name: values.global_account_name,
      type: values.global_account_type,
      reportingGroup: values.global_account_reportingGroup || null,
      notes: values.global_account_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Global account created.' });
}

async function submitAccountMapping(form) {
  const values = formValues(form);
  await request('/api/settings/account-mappings', {
    method: 'POST',
    body: {
      sourceAccountId: values.mapping_sourceAccountId,
      globalAccountId: values.mapping_globalAccountId,
      entityOverride: values.mapping_entityOverride || null,
      lineOfServiceOverride: values.mapping_lineOfServiceOverride || null,
      businessUnitOverride: values.mapping_businessUnitOverride || null,
      notes: values.mapping_notes || ''
    }
  });
  closeModal();
  await refreshCurrentWorkspace({ notice: 'Account mapping created.' });
}

async function handleFormSubmit(form) {
  if (form.id === 'login-form') {
    const email = form.querySelector('#login_email')?.value || '';
    const password = form.querySelector('#login_password')?.value || '';
    await loginWithPassword(email, password);
    return;
  }
  if (form.id === 'google-form') {
    const token = form.querySelector('#google_token')?.value || '';
    await loginWithGoogle(token);
    return;
  }
  if (form.id === 'invoice-create-form') return submitInvoiceCreate(form);
  if (form.id === 'invoice-reject-form') return submitInvoiceReject(form);
  if (form.id === 'invoice-payment-form') return submitInvoicePayment(form);
  if (form.id === 'bill-create-form') return submitBillCreate(form);
  if (form.id === 'bill-reject-form') return submitBillReject(form);
  if (form.id === 'bill-pay-form') return submitBillPay(form);
  if (form.id === 'bank-import-form') return submitBankImport(form);
  if (form.id === 'transaction-match-form') return submitTransactionMatch(form);
  if (form.id === 'reconciliation-review-form') return submitReconciliationReview(form);
  if (form.id === 'banking-bulk-action-form') return submitBankingBulkAction(form);
  if (form.id === 'intercompany-create-form') return submitIntercompanyCreate(form);
  if (form.id === 'intercompany-repay-form') return submitIntercompanyRepay(form);
  if (form.id === 'expense-create-form') return submitExpenseCreate(form);
  if (form.id === 'expense-reject-form') return submitExpenseReject(form);
  if (form.id === 'reimbursement-settle-form') return submitReimbursementSettle(form);
  if (form.id === 'evidence-upload-form') return submitEvidenceUpload(form);
  if (form.id === 'evidence-remove-form') return submitEvidenceRemove(form);
  if (form.id === 'period-close-form') return submitPeriodClose(form);
  if (form.id === 'period-reopen-form') return submitPeriodReopen(form);
  if (form.id === 'related-party-cleanup-form') return submitRelatedPartyCleanup(form);
  if (form.id === 'journal-create-form') return submitJournalCreate(form);
  if (form.id === 'journal-reject-form') return submitJournalReject(form);
  if (form.id === 'journal-reverse-form') return submitJournalReverse(form);
  if (form.id === 'source-account-form') return submitSourceAccount(form);
  if (form.id === 'global-account-form') return submitGlobalAccount(form);
  if (form.id === 'account-mapping-form') return submitAccountMapping(form);
}

async function applyImmediateAction(action, id = null, context = {}) {
  if (action === 'refresh-workspace') {
    await refreshCurrentWorkspace({ notice: 'Workspace refreshed.' });
    return;
  }
  if (action === 'connect-qbo') {
    const response = await request('/api/qbo/connect', { method: 'POST', body: {} });
    window.location.href = response.url;
    return;
  }
  if (action === 'pull-qbo-full') {
    await request('/api/qbo/pull/full', { method: 'POST', body: { options: {} } });
    await refreshCurrentWorkspace({ notice: 'QuickBooks full pull completed.' });
    return;
  }
  if (action === 'run-auto-match') {
    await request('/api/reconciliation/auto-match', { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Auto-match completed.' });
    return;
  }
  if (action === 'quick-transaction-match') {
    await request(`/api/reconciliation/transactions/${id}/quick-match`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Best match applied.', reopenDrawerRef: `transaction:${id}` });
    return;
  }
  if (action === 'open-adjacent-transaction') {
    const adjacent = findAdjacentBankingQueueItem(id, Number(context.offset || 1));
    if (adjacent) await openDrawerByRef(`transaction:${adjacent.transactionId}`);
    return;
  }
  if (action === 'select-visible-banking') {
    mutate((draft) => {
      draft.ui.selections.banking = currentBankingQueueRows().map((row) => row.transactionId);
    });
    return;
  }
  if (action === 'clear-banking-selection') {
    resetSelections('banking');
    return;
  }
  if (action === 'open-banking-bulk-action') {
    openBankingBulkActionModal(String(context.bulkAction || '').toUpperCase());
    return;
  }
  if (action === 'clear-reconciliation-review') {
    await request(`/api/reconciliation/transactions/${id}/review`, {
      method: 'POST',
      body: { decision: 'CLEAR_REVIEW', note: '' }
    });
    await refreshCurrentWorkspace({ notice: 'Reconciliation review cleared.', reopenDrawerRef: `transaction:${id}` });
    return;
  }
  if (action === 'process-notifications') {
    await request('/api/admin/notifications/process', { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Notification queue processed.' });
    return;
  }
  if (action === 'generate-related-party-eliminations') {
    await request(`/api/close/periods/${id}/eliminations/generate`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: `Related-party eliminations generated for ${id}.` });
    return;
  }
  if (action === 'print-reports') {
    window.print();
    return;
  }
  if (action === 'tb-drilldown') {
    const filters = state.ui.filters.reports || {};
    const journalFilters = state.ui.filters.journals || {};
    const params = new URLSearchParams();
    params.set('accountCode', id || '');
    if (journalFilters.entity || filters.entity) params.set('entity', journalFilters.entity || filters.entity);
    if (filters.toDate) params.set('asOfDate', filters.toDate);
    const payload = await request(`/api/reports/trial-balance/drilldown?${params.toString()}`);
    setDrawer(trialBalanceDrilldownDrawer(payload));
    return;
  }
  if (action === 'report-drilldown') {
    const [statement, lineKey] = String(id || '').split(':');
    const filters = state.ui.filters.reports || {};
    const params = new URLSearchParams();
    params.set('statement', statement || '');
    params.set('lineKey', lineKey || '');
    if (filters.entity) params.set('entity', filters.entity);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    const payload = await request(`/api/reports/statement-drilldown?${params.toString()}`);
    setDrawer(statementDrilldownDrawer(payload));
    return;
  }
  if (action === 'invoice-preview') {
    window.open(`/api/invoices/${id}/preview`, '_blank', 'noopener');
    return;
  }
  if (action === 'invoice-submit') {
    await request(`/api/invoices/${id}/submit`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Invoice submitted.', reopenDrawerRef: `invoice:${id}` });
    return;
  }
  if (action === 'invoice-approve') {
    await request(`/api/invoices/${id}/approve`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Invoice approved.', reopenDrawerRef: `invoice:${id}` });
    return;
  }
  if (action === 'invoice-send') {
    await request(`/api/invoices/${id}/send`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Invoice sent.', reopenDrawerRef: `invoice:${id}` });
    return;
  }
  if (action === 'invoice-sync-qbo') {
    await request(`/api/qbo/sync/${id}`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Invoice synced to QuickBooks.', reopenDrawerRef: `invoice:${id}` });
    return;
  }
  if (action === 'expense-approve') {
    await request(`/api/expenses/${id}/approve`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Expense approved.', reopenDrawerRef: `expense:${id}` });
    return;
  }
  if (action === 'bill-submit') {
    await request(`/api/payables/bills/${id}/submit`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Vendor bill submitted.', reopenDrawerRef: `bill:${id}` });
    return;
  }
  if (action === 'bill-approve') {
    await request(`/api/payables/bills/${id}/approve`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Vendor bill approved.', reopenDrawerRef: `bill:${id}` });
    return;
  }
  if (action === 'journal-submit') {
    await request(`/api/journals/${id}/submit`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Journal submitted.', reopenDrawerRef: `journal:${id}` });
    return;
  }
  if (action === 'journal-approve') {
    await request(`/api/journals/${id}/approve`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Journal approved.', reopenDrawerRef: `journal:${id}` });
    return;
  }
  if (action === 'journal-post') {
    await request(`/api/journals/${id}/post`, { method: 'POST', body: {} });
    await refreshCurrentWorkspace({ notice: 'Journal posted.', reopenDrawerRef: `journal:${id}` });
    return;
  }
  if (action === 'download-evidence') {
    const response = await request(`/api/evidence/${id}/download`, { raw: true });
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const nameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
    downloadBlob(blob, nameMatch?.[1] || `${id}.bin`);
    setNotice('Evidence downloaded.');
    return;
  }
  if (action === 'save-finance-model') {
    const form = root.querySelector('#finance-model-form');
    if (!form) throw new Error('Finance model form not found.');
    const payload = {
      reportingCurrency: form.querySelector('#admin_reporting_currency')?.value || 'USD',
      entityBaseCurrencies: {
        US: form.querySelector('#admin_entity_currency_US')?.value || 'USD',
        UK: form.querySelector('#admin_entity_currency_UK')?.value || 'GBP',
        PK: form.querySelector('#admin_entity_currency_PK')?.value || 'PKR'
      },
      fxRatesToUSD: {
        USD: Number(form.querySelector('#admin_fx_USD')?.value || 1),
        GBP: Number(form.querySelector('#admin_fx_GBP')?.value || 1.27),
        PKR: Number(form.querySelector('#admin_fx_PKR')?.value || 0.0036)
      },
      approvalMatrix: state.data.financeModel?.settings?.approvalMatrix || state.data.bootstrap?.settings?.approvalMatrix || null
    };
    await request('/api/settings/finance-model', { method: 'PATCH', body: payload });
    await refreshCurrentWorkspace({ notice: 'Finance model saved.' });
    return;
  }
  if (action === 'export-billing-csv') {
    const rows = rowsForExport('billing');
    downloadCsv('billing-register.csv', rows, ['invoiceNumber', 'client', 'issueDate', 'dueDate', 'entity', 'currency', 'status', 'total', 'amountPaid', 'outstanding']);
    setNotice('Billing register exported to CSV.');
    return;
  }
  if (action === 'bulk-billing-submit') {
    const ids = selectedIds('billing');
    await Promise.all(ids.map((recordId) => request(`/api/invoices/${recordId}/submit`, { method: 'POST', body: {} }).catch(() => null)));
    resetSelections('billing');
    await refreshCurrentWorkspace({ notice: 'Bulk invoice submit completed.' });
    return;
  }
  if (action === 'bulk-billing-send') {
    const ids = selectedIds('billing');
    await Promise.all(ids.map((recordId) => request(`/api/invoices/${recordId}/send`, { method: 'POST', body: {} }).catch(() => null)));
    resetSelections('billing');
    await refreshCurrentWorkspace({ notice: 'Bulk invoice send completed.' });
    return;
  }
  if (action === 'bulk-payables-submit') {
    const ids = selectedIds('payables');
    await Promise.all(ids.map((recordId) => request(`/api/payables/bills/${recordId}/submit`, { method: 'POST', body: {} }).catch(() => null)));
    resetSelections('payables');
    await refreshCurrentWorkspace({ notice: 'Bulk bill submit completed.' });
    return;
  }
  if (action === 'bulk-payables-approve') {
    const ids = selectedIds('payables');
    await Promise.all(ids.map((recordId) => request(`/api/payables/bills/${recordId}/approve`, { method: 'POST', body: {} }).catch(() => null)));
    resetSelections('payables');
    await refreshCurrentWorkspace({ notice: 'Bulk bill approval completed.' });
  }
}

function applyFilters(action) {
  if (action === 'apply-billing-filters') {
    mutate((draft) => {
      draft.ui.filters.billing.query = root.querySelector('#billing_query')?.value || '';
      draft.ui.filters.billing.status = root.querySelector('#billing_status')?.value || 'ALL';
      draft.ui.filters.billing.entity = root.querySelector('#billing_entity')?.value || '';
      draft.ui.filters.billing.lineOfService = root.querySelector('#billing_los')?.value || '';
    });
    return;
  }
  if (action === 'apply-approvals-filters') {
    mutate((draft) => {
      draft.ui.filters.approvals.query = root.querySelector('#approvals_query')?.value || '';
      draft.ui.filters.approvals.documentType = root.querySelector('#approvals_documentType')?.value || 'ALL';
      draft.ui.filters.approvals.entity = root.querySelector('#approvals_entity')?.value || '';
      draft.ui.filters.approvals.priority = root.querySelector('#approvals_priority')?.value || 'ALL';
      draft.ui.filters.approvals.evidence = root.querySelector('#approvals_evidence')?.value || 'ALL';
      draft.ui.filters.approvals.approvalStatus = root.querySelector('#approvals_approvalStatus')?.value || 'ALL';
      draft.ui.filters.approvals.age = root.querySelector('#approvals_age')?.value || 'ALL';
      draft.ui.filters.approvals.sort = root.querySelector('#approvals_sort')?.value || 'urgency';
    });
    return;
  }
  if (action === 'apply-payables-filters') {
    mutate((draft) => {
      draft.ui.filters.payables.query = root.querySelector('#payables_query')?.value || '';
      draft.ui.filters.payables.status = root.querySelector('#payables_status')?.value || 'ALL';
      draft.ui.filters.payables.entity = root.querySelector('#payables_entity')?.value || '';
    });
    return;
  }
  if (action === 'apply-banking-filters') {
    mutate((draft) => {
      draft.ui.filters.banking.query = root.querySelector('#banking_query')?.value || '';
      draft.ui.filters.banking.rail = root.querySelector('#banking_rail')?.value || 'ALL';
      draft.ui.filters.banking.confidence = root.querySelector('#banking_confidence')?.value || 'ALL';
      draft.ui.filters.banking.issue = root.querySelector('#banking_issue')?.value || 'ALL';
      draft.ui.filters.banking.support = root.querySelector('#banking_support')?.value || 'ALL';
      draft.ui.filters.banking.focus = root.querySelector('#banking_focus')?.value || 'ALL';
      draft.ui.filters.banking.sort = root.querySelector('#banking_sort')?.value || 'priority';
    });
    return;
  }
  if (action === 'apply-treasury-filters') {
    mutate((draft) => {
      draft.ui.filters.treasury.entity = root.querySelector('#treasury_entity')?.value || '';
      draft.ui.filters.treasury.status = root.querySelector('#treasury_status')?.value || 'ALL';
    });
    return;
  }
  if (action === 'apply-spend-filters') {
    mutate((draft) => {
      draft.ui.filters.spend.query = root.querySelector('#spend_query')?.value || '';
      draft.ui.filters.spend.entity = root.querySelector('#spend_entity')?.value || '';
      draft.ui.filters.spend.status = root.querySelector('#spend_status')?.value || 'ALL';
    });
    return;
  }
  if (action === 'apply-journal-filters') {
    mutate((draft) => {
      draft.ui.filters.journals.query = root.querySelector('#journals_query')?.value || '';
      draft.ui.filters.journals.status = root.querySelector('#journals_status')?.value || 'ALL';
      draft.ui.filters.journals.journalType = root.querySelector('#journals_type')?.value || 'ALL';
      draft.ui.filters.journals.entity = root.querySelector('#journals_entity')?.value || '';
    });
    refreshCurrentWorkspace({ notice: 'Journal register refreshed.' });
    return;
  }
  if (action === 'apply-report-filters') {
    mutate((draft) => {
      draft.ui.filters.reports.fromDate = root.querySelector('#reports_from')?.value || draft.ui.filters.reports.fromDate;
      draft.ui.filters.reports.toDate = root.querySelector('#reports_to')?.value || draft.ui.filters.reports.toDate;
      draft.ui.filters.reports.entity = root.querySelector('#reports_entity')?.value || '';
    });
    refreshCurrentWorkspace({ notice: 'Reports refreshed with new filters.' });
  }
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const routeLink = event.target.closest('[data-route-link]');
    if (routeLink) {
      event.preventDefault();
      const path = routeLink.getAttribute('data-route-link') || routeLink.getAttribute('href');
      if (path) navigate(path);
      return;
    }

    const tab = event.target.closest('[data-tab-scope][data-tab-value]');
    if (tab) {
      const scope = tab.getAttribute('data-tab-scope');
      const value = tab.getAttribute('data-tab-value');
      mutate((draft) => {
        draft.ui.activeTabs[scope] = value;
      });
      return;
    }

    const checkbox = event.target.closest('[data-action="toggle-selection"]');
    if (checkbox) {
      event.stopPropagation();
      const scope = checkbox.getAttribute('data-scope');
      const id = checkbox.getAttribute('data-id');
      mutate((draft) => {
        const current = new Set(draft.ui.selections[scope] || []);
        if (checkbox.checked) current.add(id);
        else current.delete(id);
        draft.ui.selections[scope] = [...current];
      });
      return;
    }

    const drawerRef = event.target.closest('[data-open-drawer]');
    const clickableControl = event.target.closest('button, input, select, textarea, a');
    if (drawerRef && (!clickableControl || drawerRef === clickableControl)) {
      await openDrawerByRef(drawerRef.getAttribute('data-open-drawer'));
      return;
    }

    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;

    const action = actionTarget.getAttribute('data-action');
    const id = actionTarget.getAttribute('data-id');
    const context = {
      entityType: actionTarget.getAttribute('data-entity-type'),
      entityId: actionTarget.getAttribute('data-entity-id'),
      decision: actionTarget.getAttribute('data-decision'),
      bulkAction: actionTarget.getAttribute('data-bulk-action'),
      offset: actionTarget.getAttribute('data-offset')
    };

    try {
      clearFeedback();
      if (action === 'persona-login') {
        await loginWithPassword(actionTarget.getAttribute('data-email') || '', actionTarget.getAttribute('data-password') || '');
        return;
      }
      if (action === 'logout') {
        logout();
        return;
      }
      if (action === 'close-modal') {
        closeModal();
        return;
      }
      if (action === 'close-drawer') {
        closeDrawer();
        return;
      }
      if (action === 'set-rail-filter') {
        mutate((draft) => {
          draft.ui.filters.banking.rail = id || 'ALL';
        });
        return;
      }
      if (action.startsWith('open-')) {
        openModalByAction(action, id, context);
        return;
      }
      if (action.startsWith('apply-')) {
        applyFilters(action);
        return;
      }
      await applyImmediateAction(action, id, context);
    } catch (error) {
      setError(noticeFromError(error, 'Action failed.'));
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    try {
      clearFeedback();
      await handleFormSubmit(form);
    } catch (error) {
      setError(noticeFromError(error, 'Form submission failed.'));
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target?.id === 'global_search') {
      syncSearchToWorkspace(target.value || '');
    }
  });
}

export async function startApp(appRoot) {
  root = appRoot;
  subscribe(render);
  initRouter(onRouteChange);
  bindEvents();
  render();

  await hydrateSession();
  if (!state.session.user) {
    const fallback = getRouteByPath(window.location.pathname);
    if (!fallback) {
      window.history.replaceState({}, '', '/');
      state.route.path = '/';
      commit();
    }
    render();
    return;
  }

  const allowed = getAllowedRoutes(state.session.user.role);
  if (!allowed.find((route) => route.path === state.route.path)) {
    navigate(getDefaultPath(state.session.user.role), { replace: true });
    return;
  }

  await onRouteChange();
}
