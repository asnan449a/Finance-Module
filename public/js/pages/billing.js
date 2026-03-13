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
import { invoiceStats, openInvoiceQueue, clientAnalytics } from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

function filteredInvoices(state) {
  const filters = state.ui.filters.billing;
  const query = String(filters.query || '').toLowerCase();
  return (state.data.invoices || []).filter((invoice) => {
    if (filters.status !== 'ALL' && String(invoice.status || '').toUpperCase() !== filters.status) return false;
    if (filters.entity && String(invoice.entity || '').toUpperCase() !== String(filters.entity).toUpperCase()) return false;
    if (filters.lineOfService && String(invoice.lineOfService || '').toUpperCase() !== String(filters.lineOfService).toUpperCase()) return false;
    const hay = `${invoice.invoiceNumber || ''} ${invoice.clientName || ''} ${invoice.status || ''} ${invoice.entity || ''} ${invoice.lineOfService || ''}`.toLowerCase();
    return !query || hay.includes(query);
  });
}

function billingCurrency(state) {
  return state.data.reports.qboRevenueByLos?.reportingCurrency
    || state.data.reports.managementPl?.reportingCurrency
    || 'USD';
}

function selectionToolbar(state) {
  const selected = state.ui.selections.billing || [];
  return `
    <div class="toolbar-group">
      <span class="toolbar-count">${selected.length} selected</span>
      <button class="button button--ghost" data-action="bulk-billing-submit" ${selected.length ? '' : 'disabled'}>Bulk submit</button>
      <button class="button button--ghost" data-action="bulk-billing-send" ${selected.length ? '' : 'disabled'}>Bulk send</button>
      <button class="button button--ghost" data-action="export-billing-csv">Export register</button>
    </div>
  `;
}

function customerInsightRows(analytics, currency) {
  return analytics.slice(0, 6).map((row) => insightRow({
    title: row.client,
    meta: `${row.invoiceCount} invoices · ${row.overdueCount} overdue`,
    value: `<span>${money(row.outstanding, currency)}</span>`
  }));
}

function collectionInsightRows(collections) {
  return collections.slice(0, 6).map((invoice) => insightRow({
    title: invoice.invoiceNumber,
    meta: `${invoice.clientName || 'Unknown client'} · due ${shortDate(invoice.dueDate)}`,
    value: `<span>${money(invoice.outstanding, invoice.currency)}</span>`,
    tone: String(invoice.status || '').toUpperCase() === 'OVERDUE' ? 'warning' : 'neutral'
  }));
}

function renderRegister(state, rows) {
  return tableCard({
    title: 'Invoice register',
    subtitle: 'Primary AR work surface with invoice, approval, evidence, and outstanding visibility in one register.',
    toolbar: selectionToolbar(state),
    table: rows.length
      ? dataTable({
          columns: [
            { label: '' },
            { label: 'Invoice' },
            { label: 'Client' },
            { label: 'Issue' },
            { label: 'Due' },
            { label: 'Entity' },
            { label: 'LOS' },
            { label: 'Status' },
            { label: 'Approval' },
            { label: 'Evidence' },
            { label: 'Total' },
            { label: 'Outstanding' }
          ],
          rows: rows.map((invoice) => {
            const selected = (state.ui.selections.billing || []).includes(invoice.id);
            const outstanding = Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0);
            return `
              <tr data-open-drawer="invoice:${invoice.id}">
                <td><input type="checkbox" data-action="toggle-selection" data-scope="billing" data-id="${invoice.id}" ${selected ? 'checked' : ''} /></td>
                <td><strong>${escapeHtml(invoice.invoiceNumber)}</strong></td>
                <td>${escapeHtml(invoice.clientName || 'Unknown client')}</td>
                <td>${escapeHtml(shortDate(invoice.issueDate))}</td>
                <td>${escapeHtml(shortDate(invoice.dueDate))}</td>
                <td>${escapeHtml(invoice.entity || '—')}</td>
                <td>${invoice.lineOfService ? badge(invoice.lineOfService, 'neutral') : badge('UNTAGGED', 'warning')}</td>
                <td>${badge(invoice.status)}</td>
                <td>${badge(invoice.approval?.approvalStatus || invoice.approvalStatus || 'PENDING', String(invoice.approval?.approvalStatus || invoice.approvalStatus || '').toUpperCase() === 'APPROVED' ? 'success' : 'warning')}</td>
                <td>${badge(String((invoice.evidenceRecords || []).length), (invoice.evidenceRecords || []).length ? 'success' : 'neutral')}</td>
                <td>${money(invoice.total, invoice.currency)}</td>
                <td>${money(outstanding, invoice.currency)}</td>
              </tr>
            `;
          }),
          empty: 'No invoices in the current filter set.'
        })
      : emptyState('No invoices found', 'Adjust filters or create a new invoice to populate the register.', '<button class="button button--primary" data-action="open-invoice-create">Create invoice</button>')
  });
}

function renderCollections(collections) {
  return tableCard({
    title: 'Collections queue',
    subtitle: 'Open invoices that still need follow-up or cash application.',
    toolbar: `<span class="toolbar-count">${collections.length} collection items</span>`,
    table: collections.length
      ? dataTable({
          columns: [
            { label: 'Invoice' },
            { label: 'Client' },
            { label: 'Due date' },
            { label: 'Status' },
            { label: 'Outstanding' }
          ],
          rows: collections.map((invoice) => `
            <tr data-open-drawer="invoice:${invoice.id}">
              <td><strong>${escapeHtml(invoice.invoiceNumber)}</strong></td>
              <td>${escapeHtml(invoice.clientName || 'Unknown client')}</td>
              <td>${escapeHtml(shortDate(invoice.dueDate))}</td>
              <td>${badge(invoice.status)}</td>
              <td>${money(invoice.outstanding, invoice.currency)}</td>
            </tr>
          `),
          empty: 'No open collections queue.'
        })
      : emptyState('No collections queue', 'All invoices are either draft, paid, or not yet in a collectable state.')
  });
}

function renderReconciliation(reconciliation) {
  return tableCard({
    title: 'Cash application suggestions',
    subtitle: 'Incoming cash rows with candidate invoice matches and matching actions.',
    toolbar: `
      <div class="toolbar-group">
        <span class="toolbar-count">${reconciliation.summary?.unmatchedTransactionCount || 0} unmatched cash rows</span>
        <button class="button button--ghost" data-action="run-auto-match">Run auto-match</button>
      </div>
    `,
    table: (reconciliation.suggestions || []).length
      ? dataTable({
          columns: [
            { label: 'Transaction' },
            { label: 'Amount' },
            { label: 'Top matches' },
            { label: 'Apply' }
          ],
          rows: reconciliation.suggestions.map((suggestion) => `
            <tr data-open-drawer="transaction:${suggestion.transactionId}">
              <td>${escapeHtml(suggestion.transactionId)}</td>
              <td>${money(suggestion.amount, suggestion.currency)}</td>
              <td>${suggestion.candidates.map((candidate) => `${escapeHtml(candidate.invoiceNumber)} (${money(candidate.outstanding, suggestion.currency)})`).join('<br/>')}</td>
              <td><button class="button button--ghost" data-action="open-transaction-match" data-id="${suggestion.transactionId}">Match</button></td>
            </tr>
          `),
          empty: 'No suggestions.'
        })
      : emptyState('No reconciliation suggestions', 'Run auto-match or import banking activity to populate cash-application suggestions.')
  });
}

function renderAnalytics(analytics, currency) {
  return tableCard({
    title: 'Customer balances',
    subtitle: 'Billed, collected, outstanding, and overdue by customer.',
    toolbar: `<span class="toolbar-count">${analytics.length} customers</span>`,
    table: analytics.length
      ? dataTable({
          columns: [
            { label: 'Customer' },
            { label: 'Invoices' },
            { label: 'Billed' },
            { label: 'Collected' },
            { label: 'Outstanding' },
            { label: 'Collection %' },
            { label: 'Overdue' }
          ],
          rows: analytics.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.client)}</strong></td>
              <td>${row.invoiceCount}</td>
              <td>${money(row.totalBilled, currency)}</td>
              <td>${money(row.totalCollected, currency)}</td>
              <td>${money(row.outstanding, currency)}</td>
              <td>${badge(`${row.collectionPct}%`, row.collectionPct >= 90 ? 'success' : row.collectionPct >= 70 ? 'warning' : 'danger')}</td>
              <td>${row.overdueCount}</td>
            </tr>
          `),
          empty: 'No customer analytics available.'
        })
      : emptyState('No customer analytics', 'Create or sync invoices to populate customer balances.')
  });
}

export function renderBilling(state) {
  const rows = filteredInvoices(state).sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')));
  const stats = invoiceStats(rows);
  const collections = openInvoiceQueue(rows);
  const reconciliation = state.data.reconciliation || { suggestions: [], summary: {} };
  const analytics = clientAnalytics(rows);
  const tab = state.ui.activeTabs.billing;
  const currency = billingCurrency(state);
  const untagged = rows.filter((invoice) => !invoice.lineOfService).length;

  const filters = filterBar(`
    <label><span>Search</span><input id="billing_query" type="search" value="${escapeHtml(state.ui.filters.billing.query || '')}" placeholder="Invoice, client, entity, LOS" /></label>
    <label><span>Status</span>
      <select id="billing_status">
        <option value="ALL" ${state.ui.filters.billing.status === 'ALL' ? 'selected' : ''}>All statuses</option>
        ${['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'OVERDUE', 'PARTIAL', 'PAID', 'REJECTED'].map((status) => `<option value="${status}" ${state.ui.filters.billing.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select>
    </label>
    <label><span>Entity</span>
      <select id="billing_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${state.ui.filters.billing.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <label><span>LOS</span>
      <select id="billing_los">
        <option value="">All lines</option>
        ${['TRDEV', 'TRFINANCE', 'TRBUILD'].map((los) => `<option value="${los}" ${state.ui.filters.billing.lineOfService === los ? 'selected' : ''}>${los}</option>`).join('')}
      </select>
    </label>
    <div class="filter-bar__actions"><button class="button button--ghost" data-action="apply-billing-filters">Apply filters</button></div>
  `);

  const chips = filterChips([
    { label: 'Status', value: state.ui.filters.billing.status },
    { label: 'Entity', value: state.ui.filters.billing.entity },
    { label: 'LOS', value: state.ui.filters.billing.lineOfService },
    { label: 'Search', value: state.ui.filters.billing.query }
  ], 'All invoices in current scope');

  const tabs = workspaceTabs({
    scope: 'billing',
    active: tab,
    items: [
      { value: 'register', label: 'Invoice register', count: rows.length },
      { value: 'collections', label: 'Collections', count: collections.length },
      { value: 'reconciliation', label: 'Cash application', count: reconciliation.summary?.suggestedMatches || 0 },
      { value: 'analytics', label: 'Customer balances', count: analytics.length }
    ]
  });

  const main = tab === 'collections'
    ? renderCollections(collections)
    : tab === 'reconciliation'
      ? renderReconciliation(reconciliation)
      : tab === 'analytics'
        ? renderAnalytics(analytics, currency)
        : renderRegister(state, rows);

  const side = sideStack([
    listCard({
      title: 'AR posture',
      subtitle: 'What the receivables team should focus on next.',
      items: [
        insightRow({ title: 'Open receivables', meta: `${rows.length} invoices in scope`, value: `<span>${money(stats.openAr, currency)}</span>` }),
        insightRow({ title: 'Pending approvals', meta: 'Invoices waiting for release', value: `<span>${stats.pending}</span>`, tone: stats.pending ? 'warning' : 'success' }),
        insightRow({ title: 'Overdue invoices', meta: 'Collections attention', value: `<span>${stats.overdue}</span>`, tone: stats.overdue ? 'warning' : 'success' }),
        insightRow({ title: 'Collected', meta: 'Cash already applied', value: `<span>${money(stats.totalCollected, currency)}</span>` })
      ]
    }),
    callout({
      tone: untagged ? 'warning' : 'success',
      title: untagged ? `${untagged} invoices are still untagged` : 'LOS tagging is complete for this view',
      description: untagged ? 'Revenue by line of service will stay incomplete until invoice tagging is cleaned up.' : 'Line-of-service reporting is ready for the current invoice set.'
    }),
    listCard({
      title: tab === 'analytics' ? 'Largest customer balances' : 'Collections priorities',
      subtitle: tab === 'analytics' ? 'Highest open exposure by customer.' : 'Oldest and largest open invoices.',
      items: tab === 'analytics' ? customerInsightRows(analytics, currency) : collectionInsightRows(collections),
      emptyTitle: tab === 'analytics' ? 'No customer balances' : 'No collections priorities',
      emptyDescription: tab === 'analytics' ? 'Customer balance context will appear when invoices exist.' : 'There are no open invoices needing collection.'
    }),
    tab === 'reconciliation'
      ? listCard({
          title: 'Cash application posture',
          subtitle: 'Matching readiness for current banking data.',
          items: [
            insightRow({ title: 'Unmatched cash rows', meta: 'Incoming receipts still open', value: `<span>${reconciliation.summary?.unmatchedTransactionCount || 0}</span>`, tone: (reconciliation.summary?.unmatchedTransactionCount || 0) > 0 ? 'warning' : 'success' }),
            insightRow({ title: 'Suggested matches', meta: 'Auto-generated candidates', value: `<span>${reconciliation.summary?.suggestedMatches || 0}</span>` })
          ]
        })
      : ''
  ].filter(Boolean));

  return `
    ${pageHero({
      eyebrow: 'Accounts receivable',
      title: 'Billing workspace',
      description: 'Run invoice release, collections follow-up, cash application, and customer-balance review from one deliberate AR workspace.',
      actions: `
        <button class="button button--primary" data-action="open-invoice-create">New invoice</button>
        <button class="button button--ghost" data-action="refresh-workspace">Refresh</button>
      `,
      meta: `<span class="hero-meta-item">Open AR ${money(stats.openAr, currency)}</span><span class="hero-meta-item">Overdue ${stats.overdue}</span><span class="hero-meta-item">Pending ${stats.pending}</span>`
    })}
    ${metricGrid([
      { label: 'Total billed', value: money(stats.totalBilled, currency), detail: 'Current register in scope' },
      { label: 'Collected', value: money(stats.totalCollected, currency), detail: 'Cash applied to invoices' },
      { label: 'Pending approval', value: String(stats.pending), detail: 'Invoices waiting for release' },
      { label: 'Overdue', value: String(stats.overdue), detail: 'Invoices past due date' }
    ])}
    ${filters}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
