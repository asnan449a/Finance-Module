import { pageHero } from '../components/layout.js';
import {
  tableCard,
  dataTable,
  filterBar,
  filterChips,
  metricGrid,
  workspaceTabs,
  badge,
  emptyState,
  workspaceSplit,
  sideStack,
  listCard,
  insightRow,
  callout
} from '../components/primitives.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

function filteredExpenses(state) {
  const filters = state.ui.filters.spend || {};
  const query = String(filters.query || '').toLowerCase();
  return (state.data.expenses || []).filter((expense) => {
    if (filters.entity && String(expense.entity || '').toUpperCase() !== String(filters.entity).toUpperCase()) return false;
    if (filters.status !== 'ALL' && ![
      String(expense.status || '').toUpperCase(),
      String(expense.reimbursementStatus || '').toUpperCase(),
      String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase()
    ].includes(String(filters.status || '').toUpperCase())) return false;
    const hay = `${expense.description || ''} ${expense.account || ''} ${expense.category || ''} ${expense.employeeId || ''}`.toLowerCase();
    return !query || hay.includes(query);
  });
}

function filteredReimbursements(state) {
  const filters = state.ui.filters.spend || {};
  const query = String(filters.query || '').toLowerCase();
  return (state.data.reimbursements?.reimbursements || []).filter((expense) => {
    if (filters.entity && String(expense.entity || '').toUpperCase() !== String(filters.entity).toUpperCase()) return false;
    if (filters.status !== 'ALL' && ![
      String(expense.reimbursementStatus || '').toUpperCase(),
      String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase()
    ].includes(String(filters.status || '').toUpperCase())) return false;
    const hay = `${expense.description || ''} ${expense.employeeId || ''} ${expense.account || ''}`.toLowerCase();
    return !query || hay.includes(query);
  });
}

function approvalTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'APPROVED') return 'success';
  if (normalized === 'REJECTED') return 'danger';
  return 'warning';
}

function expenseRegister(rows) {
  return tableCard({
    title: 'Expense register',
    subtitle: 'Company-paid and employee-paid spend in one controlled register, with approval, evidence, and reimbursement visibility.',
    table: rows.length
      ? dataTable({
          columns: [
            { label: 'Date' },
            { label: 'Description' },
            { label: 'Entity' },
            { label: 'Account' },
            { label: 'Category' },
            { label: 'Approval' },
            { label: 'Evidence' },
            { label: 'Reimbursement' },
            { label: 'Amount' }
          ],
          rows: rows.map((expense) => `
            <tr data-open-drawer="expense:${expense.id}">
              <td>${escapeHtml(shortDate(expense.date))}</td>
              <td><strong>${escapeHtml(expense.description || expense.id)}</strong>${expense.employeeId ? `<br/><span class="muted-copy">${escapeHtml(expense.employeeId)}</span>` : ''}</td>
              <td>${escapeHtml(expense.entity || '—')}</td>
              <td>${escapeHtml(expense.account || expense.sourceAccountName || '—')}</td>
              <td>${escapeHtml(expense.category || 'Unclassified')}</td>
              <td>${badge(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING', approvalTone(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING'))}</td>
              <td>${badge(`${expense.approval?.qualifiedEvidenceCount ?? expense.evidenceRecords?.length ?? 0}/${expense.approval?.minEvidenceCount || 0}`, (expense.approval?.evidenceSatisfied || (expense.evidenceRecords || []).length > 0) ? 'success' : 'warning')}</td>
              <td>${badge(expense.reimbursementStatus || expense.status || 'PAID')}</td>
              <td>${money(expense.amount || 0, expense.currency || 'USD')}</td>
            </tr>
          `),
          empty: 'No expenses found.'
        })
      : emptyState('No expenses found', 'Record an expense to populate the spend register.', '<button class="button button--primary" data-action="open-expense-create">Record expense</button>')
  });
}

function approvalQueue(rows) {
  const pending = rows.filter((expense) => String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase() === 'PENDING');
  return tableCard({
    title: 'Approval queue',
    subtitle: 'Expense items waiting for finance review before they can progress to settlement or closed spend.',
    toolbar: `<span class="toolbar-count">${pending.length} items waiting for approval</span>`,
    table: pending.length
      ? dataTable({
          columns: [
            { label: 'Date' },
            { label: 'Description' },
            { label: 'Employee / payer' },
            { label: 'Entity' },
            { label: 'Evidence' },
            { label: 'Amount' },
            { label: 'Action' }
          ],
          rows: pending.map((expense) => `
            <tr data-open-drawer="expense:${expense.id}">
              <td>${escapeHtml(shortDate(expense.date))}</td>
              <td><strong>${escapeHtml(expense.description || expense.id)}</strong><br/><span class="muted-copy">${escapeHtml(expense.category || 'Operating Expense')}</span></td>
              <td>${escapeHtml(expense.employeeId || expense.sourceAccountName || 'Company-paid')}</td>
              <td>${escapeHtml(expense.entity || '—')}</td>
              <td>${badge(`${expense.approval?.qualifiedEvidenceCount ?? expense.evidenceRecords?.length ?? 0}/${expense.approval?.minEvidenceCount || 0}`, expense.approval?.evidenceSatisfied ? 'success' : 'warning')}</td>
              <td>${money(expense.amount || 0, expense.currency || 'USD')}</td>
              <td><button class="button button--ghost" data-open-drawer="expense:${expense.id}">Review</button></td>
            </tr>
          `),
          empty: 'No approval items.'
        })
      : emptyState('No pending expense approvals', 'Expense approvals are currently clear.')
  });
}

function reimbursementRegister(rows) {
  return tableCard({
    title: 'Reimbursement register',
    subtitle: 'Employee-paid claims with approval, evidence, and settlement status in one view.',
    table: rows.length
      ? dataTable({
          columns: [
            { label: 'Date' },
            { label: 'Employee' },
            { label: 'Description' },
            { label: 'Entity' },
            { label: 'Approval' },
            { label: 'Evidence' },
            { label: 'Status' },
            { label: 'Amount' }
          ],
          rows: rows.map((expense) => `
            <tr data-open-drawer="expense:${expense.id}">
              <td>${escapeHtml(shortDate(expense.date))}</td>
              <td>${escapeHtml(expense.employeeId || 'Unassigned')}</td>
              <td><strong>${escapeHtml(expense.description || expense.id)}</strong><br/><span class="muted-copy">${escapeHtml(expense.account || '—')}</span></td>
              <td>${escapeHtml(expense.entity || '—')}</td>
              <td>${badge(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING', approvalTone(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING'))}</td>
              <td>${badge(`${expense.approval?.qualifiedEvidenceCount ?? expense.evidenceRecords?.length ?? 0}/${expense.approval?.minEvidenceCount || 0}`, expense.approval?.evidenceSatisfied ? 'success' : 'warning')}</td>
              <td>${badge(expense.reimbursementStatus || 'PENDING')}</td>
              <td>${money(expense.amount || 0, expense.currency || 'USD')}</td>
            </tr>
          `),
          empty: 'No reimbursement rows.'
        })
      : emptyState('No reimbursement claims', 'Employee-paid expenses will appear here once reimbursement is needed.')
  });
}

function settlementQueue(rows) {
  const pending = rows.filter((expense) => String(expense.reimbursementStatus || '').toUpperCase() === 'PENDING');
  return tableCard({
    title: 'Settlement queue',
    subtitle: 'Approved employee claims that are ready for reimbursement settlement.',
    toolbar: `<span class="toolbar-count">${pending.length} claims ready to settle</span>`,
    table: pending.length
      ? dataTable({
          columns: [
            { label: 'Date' },
            { label: 'Employee' },
            { label: 'Description' },
            { label: 'Approval' },
            { label: 'Evidence' },
            { label: 'Status' },
            { label: 'Amount' },
            { label: 'Action' }
          ],
          rows: pending.map((expense) => `
            <tr data-open-drawer="expense:${expense.id}">
              <td>${escapeHtml(shortDate(expense.date))}</td>
              <td>${escapeHtml(expense.employeeId || 'Unassigned')}</td>
              <td><strong>${escapeHtml(expense.description || expense.id)}</strong></td>
              <td>${badge(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING', approvalTone(expense.approval?.approvalStatus || expense.approvalStatus || 'PENDING'))}</td>
              <td>${badge(`${expense.approval?.qualifiedEvidenceCount ?? expense.evidenceRecords?.length ?? 0}/${expense.approval?.minEvidenceCount || 0}`, expense.approval?.evidenceSatisfied ? 'success' : 'warning')}</td>
              <td>${badge(expense.reimbursementStatus || 'PENDING')}</td>
              <td>${money(expense.amount || 0, expense.currency || 'USD')}</td>
              <td><button class="button button--primary" data-action="open-reimbursement-settle" data-id="${expense.id}">Settle</button></td>
            </tr>
          `),
          empty: 'No settlement items.'
        })
      : emptyState('No settlement queue', 'Approved reimbursement claims will appear here once they are ready for settlement.')
  });
}

export function renderSpend(state) {
  const expenses = filteredExpenses(state).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const reimbursements = filteredReimbursements(state).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const summary = state.data.reimbursements?.summary || {};
  const tab = state.ui.activeTabs.spend || 'register';
  const pendingApprovals = expenses.filter((expense) => String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase() === 'PENDING');
  const readyToSettle = reimbursements.filter((expense) => String(expense.reimbursementStatus || '').toUpperCase() === 'PENDING' && String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase() === 'APPROVED');
  const missingEvidence = expenses.filter((expense) => !(expense.approval?.evidenceSatisfied)).length;
  const topEmployees = (state.data.reimbursements?.byEmployee || []).slice(0, 6).map((row) => insightRow({
    title: row.employeeName || row.employeeId || 'Unassigned',
    meta: `${row.count || 0} claims · ${money(row.reimbursedAmount || 0, 'PKR')} reimbursed`,
    value: `<span>${money(row.pendingAmount || 0, 'PKR')}</span>`,
    tone: Number(row.pendingAmount || 0) > 0 ? 'warning' : 'success'
  }));

  const filters = filterBar(`
    <label><span>Search</span><input id="spend_query" type="search" value="${escapeHtml(state.ui.filters.spend.query || '')}" placeholder="Description, account, employee" /></label>
    <label><span>Entity</span>
      <select id="spend_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${state.ui.filters.spend.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <label><span>Status</span>
      <select id="spend_status">
        <option value="ALL" ${state.ui.filters.spend.status === 'ALL' ? 'selected' : ''}>All states</option>
        ${['PENDING', 'APPROVED', 'REJECTED', 'PENDING_REIMBURSEMENT', 'REIMBURSED', 'NOT_APPLICABLE'].map((status) => `<option value="${status}" ${state.ui.filters.spend.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select>
    </label>
    <div class="filter-bar__actions">
      <button class="button button--ghost" data-action="apply-spend-filters">Apply filters</button>
      <button class="button button--primary" data-action="open-expense-create">Record expense</button>
    </div>
  `);

  const chips = filterChips([
    { label: 'Entity', value: state.ui.filters.spend.entity },
    { label: 'Status', value: state.ui.filters.spend.status },
    { label: 'Search', value: state.ui.filters.spend.query }
  ], 'All spend items in current scope');

  const tabs = workspaceTabs({
    scope: 'spend',
    active: tab,
    items: [
      { value: 'register', label: 'Expense register', count: expenses.length },
      { value: 'approval', label: 'Approval queue', count: pendingApprovals.length },
      { value: 'reimbursements', label: 'Reimbursements', count: reimbursements.length },
      { value: 'settlements', label: 'Settlement queue', count: readyToSettle.length }
    ]
  });

  const main = tab === 'approval'
    ? approvalQueue(expenses)
    : tab === 'reimbursements'
      ? reimbursementRegister(reimbursements)
      : tab === 'settlements'
        ? settlementQueue(reimbursements)
        : expenseRegister(expenses);

  const side = sideStack([
    listCard({
      title: 'Spend posture',
      subtitle: 'What the spend team should review or settle next.',
      items: [
        insightRow({ title: 'Expenses in scope', meta: 'Current register filters', value: `<span>${expenses.length}</span>` }),
        insightRow({ title: 'Pending approvals', meta: 'Expense items waiting for review', value: `<span>${pendingApprovals.length}</span>`, tone: pendingApprovals.length ? 'warning' : 'success' }),
        insightRow({ title: 'Ready to settle', meta: 'Approved employee claims', value: `<span>${readyToSettle.length}</span>` }),
        insightRow({ title: 'Pending reimbursement', meta: 'Outstanding employee exposure', value: `<span>${money(summary.pendingAmount || 0, 'PKR')}</span>`, tone: (summary.pendingAmount || 0) > 0 ? 'warning' : 'success' })
      ]
    }),
    callout({
      tone: missingEvidence ? 'warning' : 'success',
      title: missingEvidence ? `${missingEvidence} spend items are missing support` : 'Support coverage is complete for this view',
      description: missingEvidence ? 'Missing receipts or support notes slow down review and reimbursement release.' : 'Evidence is present for the current spend scope.'
    }),
    listCard({
      title: 'Employee exposure',
      subtitle: 'Pending reimbursement concentration by employee.',
      items: topEmployees,
      emptyTitle: 'No employee exposure',
      emptyDescription: 'Pending employee claims will appear here when reimbursement exposure builds.'
    })
  ]);

  return `
    ${pageHero({
      eyebrow: 'Spend operations',
      title: 'Spend workspace',
      description: 'Review operating expenses, manage approval bottlenecks, and settle employee reimbursements from one deliberate spend workspace.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button><button class="button button--primary" data-action="open-expense-create">Record expense</button>`,
      meta: `<span class="hero-meta-item">Pending approvals ${pendingApprovals.length}</span><span class="hero-meta-item">Ready to settle ${readyToSettle.length}</span><span class="hero-meta-item">Pending amount ${money(summary.pendingAmount || 0, 'PKR')}</span>`
    })}
    ${metricGrid([
      { label: 'Expenses in scope', value: String(expenses.length), detail: 'Current filtered expense set' },
      { label: 'Pending approval', value: String(pendingApprovals.length), detail: 'Expense items waiting for review' },
      { label: 'Pending reimbursement', value: money(summary.pendingAmount || 0, 'PKR'), detail: 'Outstanding employee claims' },
      { label: 'Reimbursed amount', value: money(summary.reimbursedAmount || 0, 'PKR'), detail: 'Settled in current dataset' }
    ])}
    ${filters}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
