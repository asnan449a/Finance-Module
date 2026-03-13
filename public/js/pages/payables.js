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
import { billStats } from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

function filteredBills(state) {
  const filters = state.ui.filters.payables;
  const query = String(filters.query || '').toLowerCase();
  return (state.data.payables?.bills || []).filter((bill) => {
    if (filters.status !== 'ALL' && String(bill.status || '').toUpperCase() !== filters.status) return false;
    if (filters.entity && String(bill.entity || '').toUpperCase() !== String(filters.entity).toUpperCase()) return false;
    const hay = `${bill.billNumber || ''} ${bill.vendorName || ''} ${bill.status || ''} ${bill.entity || ''}`.toLowerCase();
    return !query || hay.includes(query);
  });
}

function payablesCurrency(rows = []) {
  return rows.find((row) => row.currency)?.currency || 'USD';
}

function approvalQueue(rows = []) {
  return rows.filter((row) => ['DRAFT', 'PENDING_APPROVAL'].includes(String(row.status || '').toUpperCase()));
}

function readyToPayQueue(rows = []) {
  return rows.filter((row) => ['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE'].includes(String(row.status || '').toUpperCase()) && Number(row.outstanding || 0) > 0);
}

function topVendorRows(rows = [], currency = 'USD') {
  return rows.slice(0, 6).map((vendor) => insightRow({
    title: vendor.vendor,
    meta: `${vendor.billCount} bills · ${money(vendor.overdueAmount || 0, currency)} overdue`,
    value: `<span>${money(vendor.outstanding || 0, currency)}</span>`
  }));
}

function selectionToolbar(state) {
  const selected = state.ui.selections.payables || [];
  return `
    <div class="toolbar-group">
      <span class="toolbar-count">${selected.length} selected</span>
      <button class="button button--ghost" data-action="bulk-payables-submit" ${selected.length ? '' : 'disabled'}>Bulk submit</button>
      <button class="button button--ghost" data-action="bulk-payables-approve" ${selected.length ? '' : 'disabled'}>Bulk approve</button>
    </div>
  `;
}

function registerTable(state, rows) {
  return tableCard({
    title: 'Vendor bill register',
    subtitle: 'Primary AP work surface with release controls, evidence, and outstanding balances in one register.',
    toolbar: selectionToolbar(state),
    table: rows.length
      ? dataTable({
          columns: [
            { label: '' },
            { label: 'Bill' },
            { label: 'Vendor' },
            { label: 'Bill date' },
            { label: 'Due date' },
            { label: 'Entity' },
            { label: 'Status' },
            { label: 'Approval' },
            { label: 'Evidence' },
            { label: 'Total' },
            { label: 'Outstanding' }
          ],
          rows: rows.map((bill) => `
            <tr data-open-drawer="bill:${bill.id}">
              <td><input type="checkbox" data-action="toggle-selection" data-scope="payables" data-id="${bill.id}" ${(state.ui.selections.payables || []).includes(bill.id) ? 'checked' : ''} /></td>
              <td><strong>${escapeHtml(bill.billNumber || bill.id)}</strong></td>
              <td>${escapeHtml(bill.vendorName || 'Unknown vendor')}</td>
              <td>${escapeHtml(shortDate(bill.billDate))}</td>
              <td>${escapeHtml(shortDate(bill.dueDate))}</td>
              <td>${escapeHtml(bill.entity || '—')}</td>
              <td>${badge(bill.status)}</td>
              <td>${badge(bill.approval?.approvalStatus || bill.approvalStatus || 'PENDING', String(bill.approval?.approvalStatus || bill.approvalStatus || '').toUpperCase() === 'APPROVED' ? 'success' : 'warning')}</td>
              <td>${badge(String((bill.evidenceRecords || []).length), (bill.evidenceRecords || []).length ? 'success' : 'warning')}</td>
              <td>${money(bill.total, bill.currency)}</td>
              <td>${money(bill.outstanding || 0, bill.currency)}</td>
            </tr>
          `),
          empty: 'No bills in the current filter set.'
        })
      : emptyState('No vendor bills found', 'Adjust filters or create a new vendor bill.', '<button class="button button--primary" data-action="open-bill-create">Create vendor bill</button>')
  });
}

function approvalTable(state, queue) {
  return tableCard({
    title: 'Approval queue',
    subtitle: 'Bills that still need submission or approval before they can move toward payment.',
    toolbar: `<button class="button button--ghost" data-action="bulk-payables-approve" ${(state.ui.selections.payables || []).length ? '' : 'disabled'}>Bulk approve</button>`,
    table: queue.length
      ? dataTable({
          columns: [
            { label: '' },
            { label: 'Bill' },
            { label: 'Vendor' },
            { label: 'Bill date' },
            { label: 'Due date' },
            { label: 'Status' },
            { label: 'Evidence' },
            { label: 'Amount' }
          ],
          rows: queue.map((bill) => `
            <tr data-open-drawer="bill:${bill.id}">
              <td><input type="checkbox" data-action="toggle-selection" data-scope="payables" data-id="${bill.id}" ${(state.ui.selections.payables || []).includes(bill.id) ? 'checked' : ''} /></td>
              <td><strong>${escapeHtml(bill.billNumber || bill.id)}</strong></td>
              <td>${escapeHtml(bill.vendorName || 'Unknown vendor')}</td>
              <td>${escapeHtml(shortDate(bill.billDate))}</td>
              <td>${escapeHtml(shortDate(bill.dueDate))}</td>
              <td>${badge(bill.status)}</td>
              <td>${badge(String((bill.evidenceRecords || []).length), (bill.evidenceRecords || []).length ? 'success' : 'warning')}</td>
              <td>${money(bill.total, bill.currency)}</td>
            </tr>
          `),
          empty: 'No approval items.'
        })
      : emptyState('No approval queue', 'There are no draft or pending vendor bills right now.')
  });
}

function agingView(aging, byVendor, currency) {
  return `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Aging buckets',
        subtitle: 'Outstanding AP grouped by aging bucket.',
        table: dataTable({
          columns: [{ label: 'Bucket' }, { label: 'Amount' }],
          rows: [
            `<tr><td>Current</td><td>${money(aging.current || 0, currency)}</td></tr>`,
            `<tr><td>1-30 days</td><td>${money(aging.d1_30 || 0, currency)}</td></tr>`,
            `<tr><td>31-60 days</td><td>${money(aging.d31_60 || 0, currency)}</td></tr>`,
            `<tr><td>61+ days</td><td>${money(aging.d61_plus || 0, currency)}</td></tr>`
          ],
          empty: 'No aging data.'
        })
      })}
      ${tableCard({
        title: 'Vendor exposure',
        subtitle: 'Outstanding and overdue AP by vendor.',
        table: byVendor.length
          ? dataTable({
              columns: [{ label: 'Vendor' }, { label: 'Bills' }, { label: 'Outstanding' }, { label: 'Overdue' }],
              rows: byVendor.map((vendor) => `
                <tr>
                  <td>${escapeHtml(vendor.vendor)}</td>
                  <td>${vendor.billCount}</td>
                  <td>${money(vendor.outstanding || 0, currency)}</td>
                  <td>${money(vendor.overdueAmount || 0, currency)}</td>
                </tr>
              `),
              empty: 'No vendor exposure data.'
            })
          : emptyState('No vendor exposure', 'Create or sync bills to populate AP aging.')
      })}
    </div>
  `;
}

export function renderPayables(state) {
  const rows = filteredBills(state).sort((a, b) => String(b.billDate || '').localeCompare(String(a.billDate || '')));
  const stats = billStats(state.data.payables);
  const tab = state.ui.activeTabs.payables;
  const aging = state.data.payables?.aging || {};
  const byVendor = state.data.payables?.byVendor || [];
  const queue = approvalQueue(rows);
  const readyToPay = readyToPayQueue(rows);
  const currency = payablesCurrency(rows);
  const missingEvidence = rows.filter((bill) => !(bill.evidenceRecords || []).length).length;

  const filters = filterBar(`
    <label><span>Search</span><input id="payables_query" type="search" value="${escapeHtml(state.ui.filters.payables.query || '')}" placeholder="Bill number or vendor" /></label>
    <label><span>Status</span>
      <select id="payables_status">
        <option value="ALL" ${state.ui.filters.payables.status === 'ALL' ? 'selected' : ''}>All statuses</option>
        ${['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE', 'PAID', 'REJECTED'].map((status) => `<option value="${status}" ${state.ui.filters.payables.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select>
    </label>
    <label><span>Entity</span>
      <select id="payables_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${state.ui.filters.payables.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <div class="filter-bar__actions"><button class="button button--ghost" data-action="apply-payables-filters">Apply filters</button></div>
  `);

  const chips = filterChips([
    { label: 'Status', value: state.ui.filters.payables.status },
    { label: 'Entity', value: state.ui.filters.payables.entity },
    { label: 'Search', value: state.ui.filters.payables.query }
  ], 'All vendor bills in current scope');

  const tabs = workspaceTabs({
    scope: 'payables',
    active: tab,
    items: [
      { value: 'register', label: 'Bill register', count: rows.length },
      { value: 'approval', label: 'Approval queue', count: queue.length },
      { value: 'aging', label: 'Aging', count: byVendor.length }
    ]
  });

  const main = tab === 'approval'
    ? approvalTable(state, queue)
    : tab === 'aging'
      ? agingView(aging, byVendor, currency)
      : registerTable(state, rows);

  const side = sideStack([
    listCard({
      title: 'AP posture',
      subtitle: 'Where the payables team should focus next.',
      items: [
        insightRow({ title: 'Open AP', meta: `${rows.length} bills in scope`, value: `<span>${money(stats.openAp, currency)}</span>` }),
        insightRow({ title: 'Pending approval', meta: 'Bills awaiting release', value: `<span>${stats.pending}</span>`, tone: stats.pending ? 'warning' : 'success' }),
        insightRow({ title: 'Ready to pay', meta: 'Approved obligations with balance', value: `<span>${readyToPay.length}</span>` }),
        insightRow({ title: 'Overdue bills', meta: 'Past due vendor obligations', value: `<span>${stats.overdue}</span>`, tone: stats.overdue ? 'warning' : 'success' })
      ]
    }),
    callout({
      tone: missingEvidence ? 'warning' : 'success',
      title: missingEvidence ? `${missingEvidence} bills are missing evidence` : 'Evidence coverage is complete for this view',
      description: missingEvidence ? 'Bills without support files are harder to review and slower to release.' : 'Every bill in the current scope carries supporting evidence.'
    }),
    listCard({
      title: tab === 'aging' ? 'Largest vendor exposure' : 'Ready-to-pay queue',
      subtitle: tab === 'aging' ? 'Where AP concentration is highest.' : 'Approved items that are most likely to move next.',
      items: tab === 'aging'
        ? topVendorRows(byVendor, currency)
        : readyToPay.slice(0, 6).map((bill) => insightRow({
            title: bill.billNumber || bill.id,
            meta: `${bill.vendorName || 'Unknown vendor'} · due ${shortDate(bill.dueDate)}`,
            value: `<span>${money(bill.outstanding || 0, bill.currency)}</span>`,
            tone: String(bill.status || '').toUpperCase() === 'OVERDUE' ? 'warning' : 'neutral'
          })),
      emptyTitle: tab === 'aging' ? 'No vendor exposure' : 'No ready-to-pay items',
      emptyDescription: tab === 'aging' ? 'Vendor concentration appears here once bills exist.' : 'Approved obligations will appear here once they are ready for release.'
    })
  ]);

  return `
    ${pageHero({
      eyebrow: 'Accounts payable',
      title: 'Payables workspace',
      description: 'Manage bill intake, approval, release readiness, and vendor exposure from one deliberate AP workspace.',
      actions: `
        <button class="button button--primary" data-action="open-bill-create">New bill</button>
        <button class="button button--ghost" data-action="refresh-workspace">Refresh</button>
      `,
      meta: `<span class="hero-meta-item">Open AP ${money(stats.openAp, currency)}</span><span class="hero-meta-item">Pending ${stats.pending}</span><span class="hero-meta-item">Overdue ${stats.overdue}</span>`
    })}
    ${metricGrid([
      { label: 'Open AP', value: money(stats.openAp, currency), detail: 'Outstanding vendor liabilities' },
      { label: 'Pending approval', value: String(stats.pending), detail: 'Bills waiting for sign-off' },
      { label: 'Overdue bills', value: String(stats.overdue), detail: 'Bills beyond due date' },
      { label: 'Paid this month', value: money(stats.paidThisMonth, currency), detail: 'Disbursed from governed rails' }
    ])}
    ${filters}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
