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

export function renderTreasury(state) {
  const report = state.data.reports.managementTreasury || state.data.treasuryReport || {};
  const summary = report.summary || state.data.treasury.summary || {};
  const cashBalances = report.cashBalances || [];
  const entries = state.data.treasury.entries || [];
  const pairs = state.data.treasury.byPair || [];
  const tab = state.ui.activeTabs.treasury;
  const currency = report.reportingCurrency || 'USD';

  const filters = filterBar(`
    <label><span>Entity</span>
      <select id="treasury_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${state.ui.filters.treasury.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <label><span>Status</span>
      <select id="treasury_status">
        <option value="ALL" ${state.ui.filters.treasury.status === 'ALL' ? 'selected' : ''}>All entries</option>
        <option value="OPEN" ${state.ui.filters.treasury.status === 'OPEN' ? 'selected' : ''}>Open only</option>
        <option value="PARTIAL_REPAID" ${state.ui.filters.treasury.status === 'PARTIAL_REPAID' ? 'selected' : ''}>Partial only</option>
        <option value="REPAID" ${state.ui.filters.treasury.status === 'REPAID' ? 'selected' : ''}>Repaid only</option>
      </select>
    </label>
    <div class="filter-bar__actions"><button class="button button--ghost" data-action="apply-treasury-filters">Apply filters</button></div>
  `);

  const chips = filterChips([
    { label: 'Entity', value: state.ui.filters.treasury.entity },
    { label: 'Status', value: state.ui.filters.treasury.status }
  ], 'All treasury activity in current scope');

  const tabs = workspaceTabs({
    scope: 'treasury',
    active: tab,
    items: [
      { value: 'cash', label: 'Cash position', count: cashBalances.length },
      { value: 'intercompany', label: 'Intercompany ledger', count: entries.length }
    ]
  });

  const filteredEntries = entries.filter((entry) => {
    if (state.ui.filters.treasury.status !== 'ALL' && String(entry.status || '').toUpperCase() !== state.ui.filters.treasury.status) return false;
    if (state.ui.filters.treasury.entity) {
      const entity = String(state.ui.filters.treasury.entity).toUpperCase();
      if (![String(entry.fromEntity || '').toUpperCase(), String(entry.toEntity || '').toUpperCase()].includes(entity)) return false;
    }
    return true;
  });

  const main = tab === 'cash'
    ? tableCard({
        title: 'Governed cash and card balances',
        subtitle: 'Source-account balances translated into reporting currency and tied back to governance mappings.',
        table: cashBalances.length
          ? dataTable({
              columns: [
                { label: 'Account' },
                { label: 'Entity' },
                { label: 'Role' },
                { label: 'Global mapping' },
                { label: 'Native balance' },
                { label: 'Reporting balance' }
              ],
              rows: cashBalances.map((balance) => `
                <tr>
                  <td><strong>${escapeHtml(balance.account)}</strong></td>
                  <td>${escapeHtml(balance.entity || '—')}</td>
                  <td>${escapeHtml(balance.accountRole || '—')}</td>
                  <td>${escapeHtml(balance.globalAccountCode ? `${balance.globalAccountCode} | ${balance.globalAccountName}` : 'UNMAPPED')}</td>
                  <td>${money(balance.nativeBalance || 0, balance.currency || currency)}</td>
                  <td>${money(balance.reportingBalance || 0, currency)}</td>
                </tr>
              `),
              empty: 'No governed cash balances available.'
            })
          : emptyState('No governed cash balances', 'Load treasury reporting or map source accounts into the global chart.')
      })
    : `
      <div class="workspace-stack">
        ${tableCard({
          title: 'Intercompany ledger',
          subtitle: 'Funding, repayment, and outstanding exposure between legal entities.',
          toolbar: `<button class="button button--primary" data-action="open-intercompany-create">New funding entry</button>`,
          table: filteredEntries.length
            ? dataTable({
                columns: [
                  { label: 'Reference' },
                  { label: 'Date' },
                  { label: 'From' },
                  { label: 'To' },
                  { label: 'Status' },
                  { label: 'Funded' },
                  { label: 'Repaid' },
                  { label: 'Outstanding' }
                ],
                rows: filteredEntries.map((entry) => `
                  <tr data-open-drawer="intercompany:${entry.id}">
                    <td><strong>${escapeHtml(entry.reference || entry.id)}</strong></td>
                    <td>${escapeHtml(shortDate(entry.date))}</td>
                    <td>${escapeHtml(entry.fromEntity)}</td>
                    <td>${escapeHtml(entry.toEntity)}</td>
                    <td>${badge(entry.status)}</td>
                    <td>${money(entry.amount, entry.currency)}</td>
                    <td>${money(entry.repaidAmount || 0, entry.currency)}</td>
                    <td>${money(entry.outstandingAmount || 0, entry.currency)}</td>
                  </tr>
                `),
                empty: 'No intercompany entries found.'
              })
            : emptyState('No intercompany entries', 'Create a funding entry to start the due-to / due-from workflow.')
        })}
        ${tableCard({
          title: 'Entity pair exposure',
          subtitle: 'Outstanding balances summarized by entity pair.',
          table: pairs.length
            ? dataTable({
                columns: [{ label: 'Pair' }, { label: 'Currency' }, { label: 'Open amount' }, { label: 'Repaid amount' }, { label: 'Entries' }],
                rows: pairs.map((pair) => `
                  <tr>
                    <td>${escapeHtml(pair.pair)}</td>
                    <td>${escapeHtml(pair.currency || currency)}</td>
                    <td>${money(pair.openAmount || 0, pair.currency || currency)}</td>
                    <td>${money(pair.repaidAmount || pair.settledAmount || 0, pair.currency || currency)}</td>
                    <td>${pair.count}</td>
                  </tr>
                `),
                empty: 'No pair exposure data.'
              })
            : emptyState('No pair exposure', 'Intercompany entries will summarize here by entity pair.')
        })}
      </div>
    `;

  const side = sideStack([
    listCard({
      title: 'Treasury posture',
      subtitle: 'Current treasury and intercompany summary.',
      items: [
        insightRow({ title: 'Open intercompany', meta: 'Unsettled funding entries', value: `<span>${money(state.data.treasury.summary?.openAmount || 0, currency)}</span>` }),
        insightRow({ title: 'Partial entries', meta: 'Partially repaid exposure', value: `<span>${summary.partialCount || 0}</span>` }),
        insightRow({ title: 'Repaid entries', meta: 'Fully settled funding', value: `<span>${summary.settledCount || 0}</span>` }),
        insightRow({ title: 'Governed balances', meta: 'Cash and card accounts in scope', value: `<span>${cashBalances.length}</span>` })
      ]
    }),
    callout({
      tone: (state.data.closeRelatedParty?.summary?.closeBlockerCount || 0) > 0 ? 'warning' : 'neutral',
      title: 'Close linkage',
      description: (state.data.closeRelatedParty?.summary?.closeBlockerCount || 0) > 0
        ? `${state.data.closeRelatedParty?.summary?.closeBlockerCount || 0} related-party blockers are still active for close.`
        : 'Treasury exposure is flowing into close reconciliation without current blockers.'
    }),
    tab === 'cash'
      ? listCard({
          title: 'Largest governed balances',
          subtitle: 'Highest reporting balances across rails.',
          items: cashBalances.slice(0, 6).map((balance) => insightRow({
            title: balance.account,
            meta: `${balance.entity || '—'} · ${balance.accountRole || '—'}`,
            value: `<span>${money(balance.reportingBalance || 0, currency)}</span>`
          })),
          emptyTitle: 'No governed balances',
          emptyDescription: 'Governed balances will appear here once treasury data loads.'
        })
      : listCard({
          title: 'Intercompany focus pairs',
          subtitle: 'Pairs with the largest open exposure.',
          items: pairs.slice(0, 6).map((pair) => insightRow({
            title: pair.pair,
            meta: `${pair.count} entries · ${pair.currency || currency}`,
            value: `<span>${money(pair.openAmount || 0, pair.currency || currency)}</span>`
          })),
          emptyTitle: 'No pair exposure',
          emptyDescription: 'Pair-level views will appear here once intercompany entries exist.'
        })
  ].filter(Boolean));

  return `
    ${pageHero({
      eyebrow: 'Treasury and intercompany',
      title: 'Treasury workspace',
      description: 'Monitor governed cash position and operate intercompany funding, repayment, and exposure review from one treasury workspace.',
      actions: `<button class="button button--primary" data-action="open-intercompany-create">New funding entry</button>`,
      meta: `<span class="hero-meta-item">Open intercompany ${money(summary.openAmount || 0, currency)}</span><span class="hero-meta-item">Partial ${summary.partialCount || 0}</span><span class="hero-meta-item">Repaid ${summary.settledCount || 0}</span>`
    })}
    ${metricGrid([
      { label: 'Treasury inflows', value: money(summary.inflows || 0, currency), detail: 'Reporting-currency inflows' },
      { label: 'Treasury outflows', value: money(summary.outflows || 0, currency), detail: 'Reporting-currency outflows' },
      { label: 'Open intercompany', value: money(state.data.treasury.summary?.openAmount || 0, currency), detail: 'Unsettled funding entries' },
      { label: 'Governed balances', value: String(cashBalances.length), detail: 'Cash and card accounts in scope' }
    ])}
    ${filters}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
