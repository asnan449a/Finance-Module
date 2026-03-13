import { pageHero } from '../components/layout.js';
import { tableCard, dataTable, badge, emptyState, metricGrid, workspaceSplit, sideStack, listCard, insightRow, callout } from '../components/primitives.js';
import { controlTowerAlerts, latestClosePeriod, invoiceStats, billStats, openInvoiceQueue } from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

export function renderControlTower(state) {
  const invoices = state.data.invoices || [];
  const billing = invoiceStats(invoices);
  const payables = billStats(state.data.payables);
  const reconciliation = state.data.reconciliation?.summary || {};
  const reimbursements = state.data.reimbursements?.summary || {};
  const treasury = state.data.treasury?.summary || {};
  const qbo = state.data.qboStatus || {};
  const close = latestClosePeriod(state);
  const alerts = controlTowerAlerts(state);
  const collections = openInvoiceQueue(invoices).slice(0, 6);
  const bills = (state.data.payables?.bills || []).filter((bill) => ['PENDING_APPROVAL', 'OVERDUE'].includes(String(bill.status || '').toUpperCase())).slice(0, 6);
  const closeChecks = (close?.checklist?.checks || []).slice(0, 6);

  const approvalRows = [
    ...invoices.filter((invoice) => String(invoice.status || '').toUpperCase() === 'PENDING_APPROVAL').slice(0, 5).map((invoice) => `
      <tr data-open-drawer="invoice:${invoice.id}">
        <td>Invoice</td>
        <td>${escapeHtml(invoice.invoiceNumber)}</td>
        <td>${escapeHtml(invoice.clientName || 'Unknown client')}</td>
        <td>${money(invoice.total, invoice.currency)}</td>
        <td>${badge(invoice.status)}</td>
      </tr>
    `),
    ...bills.filter((bill) => String(bill.status || '').toUpperCase() === 'PENDING_APPROVAL').slice(0, 5).map((bill) => `
      <tr data-open-drawer="bill:${bill.id}">
        <td>Bill</td>
        <td>${escapeHtml(bill.billNumber || bill.id)}</td>
        <td>${escapeHtml(bill.vendorName || 'Unknown vendor')}</td>
        <td>${money(bill.total, bill.currency)}</td>
        <td>${badge(bill.status)}</td>
      </tr>
    `)
  ];

  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Priority alerts',
        subtitle: 'Current exceptions that need finance action right now.',
        table: alerts.length
          ? dataTable({
              columns: [{ label: 'Area' }, { label: 'Issue' }, { label: 'Severity' }, { label: 'Action' }],
              rows: alerts.map((alert) => `
                <tr>
                  <td>${escapeHtml(alert.area)}</td>
                  <td>${escapeHtml(alert.detail)}</td>
                  <td>${badge(alert.severity.toUpperCase(), alert.severity === 'danger' ? 'danger' : 'warning')}</td>
                  <td><a class="text-link" href="${alert.route}" data-route-link="${alert.route}">${escapeHtml(alert.action)}</a></td>
                </tr>
              `),
              empty: 'No active alerts.'
            })
          : emptyState('No active alerts', 'The current dataset does not show urgent finance exceptions.')
      })}
      ${tableCard({
        title: 'Approvals waiting',
        subtitle: 'Current maker-checker queue across AR and AP.',
        table: approvalRows.length
          ? dataTable({
              columns: [{ label: 'Type' }, { label: 'Reference' }, { label: 'Counterparty' }, { label: 'Amount' }, { label: 'Status' }],
              rows: approvalRows,
              empty: 'No pending approvals.'
            })
          : emptyState('No approvals waiting', 'Invoice and bill approvals are clear right now.')
      })}
    </div>
  `;

  const side = sideStack([
    callout({
      tone: qbo.connected ? 'neutral' : 'warning',
      title: qbo.connected ? 'Source sync is connected' : 'QuickBooks is not connected',
      description: qbo.connected ? `Last pull ${shortDate(qbo.lastPullAt || qbo.lastSyncAt || '')}` : 'Source health is the first blocker to clear before relying on downstream finance views.'
    }),
    listCard({
      title: 'Today’s finance posture',
      subtitle: 'Short summary of what needs attention next.',
      items: [
        insightRow({ title: 'Pending invoice approvals', meta: 'Invoices waiting for review', value: `<span>${billing.pending}</span>`, tone: billing.pending ? 'warning' : 'success' }),
        insightRow({ title: 'Open AR', meta: 'Outstanding customer balances', value: `<span>${money(billing.openAr, state.data.reports.qboRevenueByLos?.reportingCurrency || 'USD')}</span>` }),
        insightRow({ title: 'Open AP', meta: 'Outstanding vendor liabilities', value: `<span>${money(payables.openAp)}</span>` }),
        insightRow({ title: 'Unmatched cash', meta: 'Rows not yet applied', value: `<span>${reconciliation.unmatchedTransactionCount || 0}</span>`, tone: (reconciliation.unmatchedTransactionCount || 0) > 0 ? 'warning' : 'success' }),
        insightRow({ title: 'Pending reimbursements', meta: 'Employee claims waiting to settle', value: `<span>${reimbursements.pendingCount || 0}</span>`, tone: (reimbursements.pendingCount || 0) > 0 ? 'warning' : 'success' })
      ]
    }),
    listCard({
      title: 'Collections at risk',
      subtitle: 'Oldest or largest open invoices.',
      items: collections.map((invoice) => insightRow({
        title: invoice.invoiceNumber,
        meta: `${invoice.clientName || 'Unknown client'} · due ${shortDate(invoice.dueDate)}`,
        value: `<span>${money(invoice.outstanding, invoice.currency)}</span>`,
        tone: String(invoice.status || '').toUpperCase() === 'OVERDUE' ? 'warning' : 'neutral'
      })),
      emptyTitle: 'No collections risk',
      emptyDescription: 'There are no open invoices in a sent, partial, or overdue state.'
    }),
    listCard({
      title: 'Close focus',
      subtitle: close ? `${close.periodKey} · ${close.status}` : 'No period loaded',
      items: closeChecks.map((check) => insightRow({
        title: check.label,
        meta: check.detail,
        value: badge(check.pass ? 'PASS' : 'BLOCKED', check.pass ? 'success' : 'warning')
      })),
      emptyTitle: 'No close period loaded',
      emptyDescription: 'Open the close workspace to review available periods and blockers.'
    })
  ]);

  return `
    ${pageHero({
      eyebrow: 'Exception dashboard',
      title: 'Finance Control Tower',
      description: 'Start here to clear approvals, unreconciled cash, close blockers, and integration issues. This workspace stays intentionally short and action-oriented.',
      actions: `<button class="button button--primary" data-route-link="/billing">Open billing queue</button><button class="button button--ghost" data-route-link="/close">Review close blockers</button>`,
      meta: `<span class="hero-meta-item">QuickBooks ${qbo.connected ? 'connected' : 'not connected'}</span><span class="hero-meta-item">Open intercompany ${money(treasury.openAmount || 0)}</span>`
    })}
    ${metricGrid([
      { label: 'Pending invoice approvals', value: String(billing.pending), detail: 'Invoices waiting for review' },
      { label: 'Open accounts receivable', value: money(billing.openAr, state.data.reports.qboRevenueByLos?.reportingCurrency || 'USD'), detail: 'Outstanding customer balances' },
      { label: 'Open accounts payable', value: money(payables.openAp), detail: 'Outstanding vendor and reimbursement obligations' },
      { label: 'Unmatched cash', value: String(reconciliation.unmatchedTransactionCount || 0), detail: 'Incoming cash rows not yet applied' },
      { label: 'Pending reimbursements', value: String(reimbursements.pendingCount || 0), detail: 'Employee-paid claims waiting to settle' },
      { label: 'Open intercompany', value: money(treasury.openAmount || 0), detail: 'Unsettled treasury funding entries' }
    ])}
    ${workspaceSplit({ main, side })}
  `;
}
