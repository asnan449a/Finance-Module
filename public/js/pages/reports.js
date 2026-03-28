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
  callout,
  statementCard
} from '../components/primitives.js';
import { clientAnalytics, reportHighlights } from '../selectors.js';
import { money, escapeHtml } from '../utils/format.js';

function reportCurrency(state) {
  return state.data.reports.managementPl?.reportingCurrency
    || state.data.reports.qboRevenueByLos?.reportingCurrency
    || state.data.reports.trialBalance?.reportingCurrency
    || 'USD';
}

function reportFilterChips(filters) {
  return filterChips([
    { label: 'From', value: filters.fromDate },
    { label: 'To', value: filters.toDate },
    { label: 'Entity', value: filters.entity }
  ], 'Global consolidated report scope');
}

function statementsView(state, reports) {
  const currency = reportCurrency(state);
  const pl = reports.statutoryPl?.statement || {};
  const cf = reports.statutoryCashFlow || {};
  const bs = reports.statutoryBalanceSheet || {};
  const tb = reports.trialBalance || {};

  const main = `
    <div class="workspace-stack report-grid">
      ${statementCard({
        title: 'Profit & loss',
        subtitle: 'Primary operating statement.',
        currency,
        rows: [
          { label: 'Revenue recognized', value: pl.revenueRecognized || 0, drilldownId: 'profit-and-loss:revenueRecognized' },
          { label: 'Operating expenses', value: pl.operatingExpenses || 0, drilldownId: 'profit-and-loss:operatingExpenses' },
          { label: 'Payroll cost', value: pl.payrollCost || 0, drilldownId: 'profit-and-loss:payrollCost' },
          { label: 'Treasury expense', value: pl.treasuryExpense || 0, drilldownId: 'profit-and-loss:treasuryExpense' },
          { label: 'Gross profit', value: pl.grossProfit || 0, kind: 'total' },
          { label: 'Net cash profit', value: pl.netCashProfit || 0, kind: 'total' }
        ],
        footnote: 'Click supported rows to open journal-backed drilldown.'
      })}
      ${statementCard({
        title: 'Cash flow',
        subtitle: 'Opening balance, movement, and closing cash.',
        currency,
        rows: [
          { label: 'Opening balance', value: cf.openingBalance || 0 },
          { label: 'Total inflows', value: cf.inflows?.totalInflows || 0 },
          { label: 'Total outflows', value: cf.outflows?.totalOutflows || 0 },
          { label: 'Net movement', value: cf.netMovement || 0, kind: 'total' },
          { label: 'Closing balance', value: cf.closingBalance || 0, kind: 'total' }
        ]
      })}
      ${statementCard({
        title: 'Balance sheet',
        subtitle: 'Assets, liabilities, equity, and related-party balances.',
        currency: bs.reportingCurrency || currency,
        rows: [
          { label: 'Total assets', value: bs.assets?.totalAssets || 0, kind: 'section' },
          { label: 'Cash', value: bs.assets?.cash || 0, drilldownId: 'balance-sheet:cash', indent: true },
          { label: 'Accounts receivable', value: bs.assets?.accountsReceivable || 0, drilldownId: 'balance-sheet:accountsReceivable', indent: true },
          { label: 'Due from related parties', value: bs.assets?.dueFromRelatedParties || 0, drilldownId: 'balance-sheet:dueFromRelatedParties', indent: true },
          { label: 'Total liabilities', value: bs.liabilities?.totalLiabilities || 0, kind: 'section' },
          { label: 'Due to related parties', value: bs.liabilities?.dueToRelatedParties || 0, drilldownId: 'balance-sheet:dueToRelatedParties', indent: true },
          { label: 'Total equity', value: bs.equity?.totalEquity || 0, kind: 'total' }
        ],
        footnote: 'Related-party lines reflect explicit close reconciliation and elimination handling.'
      })}
      ${tableCard({
        title: 'Trial balance in reports',
        subtitle: 'Posted-journal control register directly inside the reporting workspace.',
        table: (tb.rows || []).length
          ? dataTable({
              columns: [{ label: 'Account' }, { label: 'Type' }, { label: 'Debit' }, { label: 'Credit' }, { label: 'Net' }],
              rows: (tb.rows || []).map((row) => `
                <tr data-action="tb-drilldown" data-id="${escapeHtml(row.code || '')}">
                  <td><strong>${escapeHtml(`${row.code || '—'} | ${row.name || 'Unnamed account'}`)}</strong>${row.reportingGroup ? `<br/><span class="muted-copy">${escapeHtml(row.reportingGroup)}</span>` : ''}</td>
                  <td>${escapeHtml(row.type || '—')}</td>
                  <td>${money(row.debit || 0, tb.reportingCurrency || currency)}</td>
                  <td>${money(row.credit || 0, tb.reportingCurrency || currency)}</td>
                  <td>${money(row.net || 0, tb.reportingCurrency || currency)}</td>
                </tr>
              `),
              empty: 'No trial balance rows.'
            })
          : emptyState('No trial balance rows', 'Posted journals will populate the trial balance.')
      })}
    </div>
  `;

  const side = sideStack([
    listCard({
      title: 'Statement context',
      subtitle: 'Key report totals for the current scope.',
      items: [
        insightRow({ title: 'Management net', meta: 'Current management summary', value: `<span>${reportHighlights(state).managementNet}</span>` }),
        insightRow({ title: 'Closing cash', meta: 'Statutory cash flow', value: `<span>${reportHighlights(state).closingCash}</span>` }),
        insightRow({ title: 'Open AR', meta: 'Revenue and collections exposure', value: `<span>${reportHighlights(state).openAr}</span>` }),
        insightRow({ title: 'TB balanced', meta: 'Journal control', value: badge((tb.totals?.debit || 0) === (tb.totals?.credit || 0) ? 'YES' : 'CHECK', (tb.totals?.debit || 0) === (tb.totals?.credit || 0) ? 'success' : 'warning') })
      ]
    }),
    tableCard({
      title: 'Intercompany context',
      subtitle: 'Directional related-party exposure supporting the current balance sheet.',
      table: dataTable({
        columns: [{ label: 'Line item' }, { label: 'Amount' }],
        rows: [
          `<tr><td>Gross due from</td><td>${money(bs.intercompany?.grossDueFrom || 0, bs.reportingCurrency || currency)}</td></tr>`,
          `<tr><td>Gross due to</td><td>${money(bs.intercompany?.grossDueTo || 0, bs.reportingCurrency || currency)}</td></tr>`,
          `<tr><td>Elimination candidate</td><td>${money(bs.intercompany?.eliminationCandidate || 0, bs.reportingCurrency || currency)}</td></tr>`,
          `<tr class="report-total"><td>Net consolidated exposure</td><td>${money(bs.intercompany?.netConsolidatedExposure || 0, bs.reportingCurrency || currency)}</td></tr>`
        ],
        empty: 'No intercompany exposure data.'
      })
    }),
    callout({
      tone: state.data.qboStatus?.lastPullAt || state.data.qboStatus?.lastSyncAt ? 'success' : 'warning',
      title: 'Report freshness',
      description: state.data.qboStatus?.lastPullAt || state.data.qboStatus?.lastSyncAt || 'No recent source pull recorded for this reporting view.'
    })
  ]);

  return workspaceSplit({ main, side });
}

function managementView(state, reports) {
  const management = reports.managementPl || {};
  const currency = management.reportingCurrency || reportCurrency(state);
  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Management monthly trend',
        subtitle: 'Revenue, expense, payroll, treasury, and net by month.',
        table: (management.byMonth || []).length
          ? dataTable({
              columns: [{ label: 'Month' }, { label: 'Revenue' }, { label: 'Expense' }, { label: 'Payroll' }, { label: 'Treasury' }, { label: 'Net' }],
              rows: management.byMonth.map((row) => `
                <tr>
                  <td>${escapeHtml(row.key)}</td>
                  <td>${money(row.revenue || 0, currency)}</td>
                  <td>${money(row.expense || 0, currency)}</td>
                  <td>${money(row.payroll || 0, currency)}</td>
                  <td>${money(row.treasury || 0, currency)}</td>
                  <td>${badge(money(row.net || 0, currency), (row.net || 0) >= 0 ? 'success' : 'danger')}</td>
                </tr>
              `),
              empty: 'No monthly rows.'
            })
          : emptyState('No management trend', 'Refresh the report pack to load management trend rows.')
      })}
      ${tableCard({
        title: 'Global account view',
        subtitle: 'Management entries summarized by global account mapping.',
        table: (management.byGlobalAccount || []).length
          ? dataTable({
              columns: [{ label: 'Global account' }, { label: 'Revenue' }, { label: 'Expense' }, { label: 'Payroll' }, { label: 'Treasury' }, { label: 'Net' }],
              rows: management.byGlobalAccount.map((row) => `
                <tr>
                  <td>${escapeHtml(row.globalAccount)}</td>
                  <td>${money(row.revenue || 0, currency)}</td>
                  <td>${money(row.expense || 0, currency)}</td>
                  <td>${money(row.payroll || 0, currency)}</td>
                  <td>${money(row.treasury || 0, currency)}</td>
                  <td>${money(row.net || 0, currency)}</td>
                </tr>
              `),
              empty: 'No global account rows.'
            })
          : emptyState('No global account mapping', 'Map source accounts into the global chart to strengthen management reporting.')
      })}
    </div>
  `;

  const side = sideStack([
    listCard({
      title: 'Management summary',
      subtitle: 'Net operating picture for the selected scope.',
      items: [
        insightRow({ title: 'Revenue', meta: 'Management layer', value: `<span>${money(management.summary?.revenue || 0, currency)}</span>` }),
        insightRow({ title: 'Expense', meta: 'Management layer', value: `<span>${money(management.summary?.expense || 0, currency)}</span>` }),
        insightRow({ title: 'Payroll', meta: 'Management layer', value: `<span>${money(management.summary?.payroll || 0, currency)}</span>` }),
        insightRow({ title: 'Net', meta: 'Management result', value: `<span>${money(management.summary?.net || 0, currency)}</span>`, tone: (management.summary?.net || 0) >= 0 ? 'success' : 'warning' })
      ]
    })
  ]);

  return workspaceSplit({ main, side });
}

function workingCapitalView(state, reports) {
  const ar = reports.statutoryArAging?.buckets || {};
  const clients = clientAnalytics(state.data.invoices || []);
  const payablesAging = state.data.payables?.aging || {};
  const currency = reportCurrency(state);

  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'AR aging',
        subtitle: 'Receivable risk buckets.',
        table: dataTable({
          columns: [{ label: 'Bucket' }, { label: 'Amount' }],
          rows: [
            `<tr><td>Current</td><td>${money(ar.current || 0, currency)}</td></tr>`,
            `<tr><td>1-30</td><td>${money(ar.d1_30 || 0, currency)}</td></tr>`,
            `<tr><td>31-60</td><td>${money(ar.d31_60 || 0, currency)}</td></tr>`,
            `<tr><td>61+</td><td>${money(ar.d61_plus || 0, currency)}</td></tr>`
          ],
          empty: 'No AR aging data.'
        })
      })}
      ${tableCard({
        title: 'AP aging',
        subtitle: 'Vendor obligations by aging bucket.',
        table: dataTable({
          columns: [{ label: 'Bucket' }, { label: 'Amount' }],
          rows: [
            `<tr><td>Current</td><td>${money(payablesAging.current || 0, currency)}</td></tr>`,
            `<tr><td>1-30</td><td>${money(payablesAging.d1_30 || 0, currency)}</td></tr>`,
            `<tr><td>31-60</td><td>${money(payablesAging.d31_60 || 0, currency)}</td></tr>`,
            `<tr><td>61+</td><td>${money(payablesAging.d61_plus || 0, currency)}</td></tr>`
          ],
          empty: 'No AP aging data.'
        })
      })}
      ${tableCard({
        title: 'Customer balances',
        subtitle: 'Customer-level billed, collected, outstanding, and overdue detail.',
        table: clients.length
          ? dataTable({
              columns: [{ label: 'Customer' }, { label: 'Invoices' }, { label: 'Billed' }, { label: 'Collected' }, { label: 'Outstanding' }, { label: 'Collection %' }, { label: 'Overdue' }],
              rows: clients.map((row) => `
                <tr>
                  <td>${escapeHtml(row.client)}</td>
                  <td>${row.invoiceCount}</td>
                  <td>${money(row.totalBilled, currency)}</td>
                  <td>${money(row.totalCollected, currency)}</td>
                  <td>${money(row.outstanding, currency)}</td>
                  <td>${badge(`${row.collectionPct}%`, row.collectionPct >= 90 ? 'success' : row.collectionPct >= 70 ? 'warning' : 'danger')}</td>
                  <td>${row.overdueCount}</td>
                </tr>
              `),
              empty: 'No customer balance data.'
            })
          : emptyState('No customer balances', 'Billing data will appear here once invoices are created or synced.')
      })}
    </div>
  `;

  const side = sideStack([
    listCard({
      title: 'Working capital focus',
      subtitle: 'What deserves attention in the current scope.',
      items: [
        insightRow({ title: 'AR current', meta: 'Receivables still current', value: `<span>${money(ar.current || 0, currency)}</span>` }),
        insightRow({ title: 'AR 61+', meta: 'High-risk old receivables', value: `<span>${money(ar.d61_plus || 0, currency)}</span>`, tone: (ar.d61_plus || 0) > 0 ? 'warning' : 'success' }),
        insightRow({ title: 'AP 61+', meta: 'Old vendor liabilities', value: `<span>${money(payablesAging.d61_plus || 0, currency)}</span>`, tone: (payablesAging.d61_plus || 0) > 0 ? 'warning' : 'success' })
      ]
    })
  ]);

  return workspaceSplit({ main, side });
}

function revenueView(state, reports) {
  const revenue = reports.qboRevenueByLos || {};
  const currency = revenue.reportingCurrency || reportCurrency(state);
  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Revenue by line of service',
        subtitle: 'Invoice-tag-driven revenue view.',
        table: (revenue.byLineOfService || []).length
          ? dataTable({
              columns: [{ label: 'Line of service' }, { label: 'Revenue' }],
              rows: revenue.byLineOfService.map((row) => `
                <tr>
                  <td>${escapeHtml(row.lineOfService)}</td>
                  <td>${money(row.revenue || 0, currency)}</td>
                </tr>
              `),
              empty: 'No LOS data.'
            })
          : emptyState('No LOS revenue yet', 'Tag invoices with line of service to populate this view.')
      })}
      ${tableCard({
        title: 'Entity + LOS detail',
        subtitle: 'Revenue, collections, and open AR by entity and line.',
        table: (revenue.byEntityLineOfService || []).length
          ? dataTable({
              columns: [{ label: 'Entity' }, { label: 'LOS' }, { label: 'Invoices' }, { label: 'Revenue' }, { label: 'Collected' }, { label: 'Open AR' }],
              rows: revenue.byEntityLineOfService.map((row) => `
                <tr>
                  <td>${escapeHtml(row.entity)}</td>
                  <td>${escapeHtml(row.lineOfService)}</td>
                  <td>${row.invoiceCount}</td>
                  <td>${money(row.revenue || 0, currency)}</td>
                  <td>${money(row.collected || 0, currency)}</td>
                  <td>${money(row.openAr || 0, currency)}</td>
                </tr>
              `),
              empty: 'No entity + LOS rows.'
            })
          : emptyState('No entity + LOS detail', 'Entity-tagged and LOS-tagged invoices will show here.')
      })}
    </div>
  `;

  const side = sideStack([
    callout({
      tone: Number(revenue.summary?.untaggedInvoiceCount || 0) > 0 ? 'warning' : 'success',
      title: Number(revenue.summary?.untaggedInvoiceCount || 0) > 0 ? `${revenue.summary?.untaggedInvoiceCount || 0} invoices still need LOS tagging` : 'LOS revenue is clean for current scope',
      description: Number(revenue.summary?.untaggedInvoiceCount || 0) > 0 ? 'Revenue presentation depends on invoice tagging completeness.' : 'Tagged invoices are supporting the current LOS view.'
    })
  ]);

  return workspaceSplit({ main, side });
}

function treasuryView(state, reports) {
  const treasury = reports.managementTreasury || {};
  const partner = reports.managementPartner || {};
  const currency = treasury.reportingCurrency || reportCurrency(state);
  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Treasury cash balances',
        subtitle: 'Governed source accounts translated into reporting currency.',
        table: (treasury.cashBalances || []).length
          ? dataTable({
              columns: [{ label: 'Account' }, { label: 'Entity' }, { label: 'Role' }, { label: 'Native' }, { label: 'Reporting' }],
              rows: treasury.cashBalances.map((row) => `
                <tr>
                  <td>${escapeHtml(row.account)}</td>
                  <td>${escapeHtml(row.entity || '—')}</td>
                  <td>${escapeHtml(row.accountRole || '—')}</td>
                  <td>${money(row.nativeBalance || 0, row.currency || currency)}</td>
                  <td>${money(row.reportingBalance || 0, currency)}</td>
                </tr>
              `),
              empty: 'No governed cash balances.'
            })
          : emptyState('No treasury balances', 'Treasury balances will appear once governed rails are mapped and loaded.')
      })}
      ${tableCard({
        title: 'Partner ledger',
        subtitle: 'Related-party draws and supporting entries.',
        table: (partner.partnerTotals || []).length
          ? dataTable({
              columns: [{ label: 'Partner' }, { label: 'Draw amount' }, { label: 'Entries' }, { label: 'Entities' }],
              rows: partner.partnerTotals.map((row) => `
                <tr>
                  <td>${escapeHtml(row.partner)}</td>
                  <td>${money(row.drawAmount || 0, partner.reportingCurrency || currency)}</td>
                  <td>${row.entryCount}</td>
                  <td>${escapeHtml((row.entities || []).join(', '))}</td>
                </tr>
              `),
              empty: 'No partner rows.'
            })
          : emptyState('No partner ledger', 'Partner-related entries will populate this view.')
      })}
    </div>
  `;

  const side = sideStack([
    listCard({
      title: 'Treasury posture',
      subtitle: 'Cash and partner context for current scope.',
      items: [
        insightRow({ title: 'Governed balances', meta: 'Cash and card accounts in scope', value: `<span>${(treasury.cashBalances || []).length}</span>` }),
        insightRow({ title: 'Treasury inflows', meta: 'Reporting currency', value: `<span>${money(treasury.summary?.inflows || 0, currency)}</span>` }),
        insightRow({ title: 'Treasury outflows', meta: 'Reporting currency', value: `<span>${money(treasury.summary?.outflows || 0, currency)}</span>` })
      ]
    })
  ]);

  return workspaceSplit({ main, side });
}

function pkTaxView(state, reports) {
  const report = reports.pkTax || {};
  const currency = 'PKR';
  const main = `
    <div class="workspace-stack">
      ${tableCard({
        title: 'Payroll withholding by month',
        subtitle: 'Monthly PK payroll, taxable pay, and salary withholding tax.',
        table: (report.payrollByMonth || []).length
          ? dataTable({
              columns: [{ label: 'Month' }, { label: 'Employees' }, { label: 'Gross pay' }, { label: 'Taxable pay' }, { label: 'Withholding tax' }, { label: 'Net pay' }],
              rows: (report.payrollByMonth || []).map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.month)}</strong></td>
                  <td>${escapeHtml(String(row.employeeCount || 0))}</td>
                  <td>${money(row.grossPay || 0, currency)}</td>
                  <td>${money(row.taxablePay || 0, currency)}</td>
                  <td>${money(row.withholdingTax || 0, currency)}</td>
                  <td>${money(row.netPay || 0, currency)}</td>
                </tr>
              `),
              empty: 'No payroll tax rows.'
            })
          : emptyState('No payroll tax rows', 'Create PK payroll runs to populate monthly withholding tax and payroll expense.')
      })}
      ${tableCard({
        title: 'Non-deductible schedule',
        subtitle: 'PK expense adjustments for non-deductible and partially deductible items.',
        table: (report.nonDeductibleSchedule || []).length
          ? dataTable({
              columns: [{ label: 'Date' }, { label: 'Description' }, { label: 'Treatment' }, { label: 'Deductible %' }, { label: 'Non-deductible amount' }],
              rows: (report.nonDeductibleSchedule || []).map((row) => `
                <tr>
                  <td>${escapeHtml(row.date || '—')}</td>
                  <td><strong>${escapeHtml(row.description || row.id)}</strong><br/><span class="muted-copy">${escapeHtml(row.category || 'Operating Expense')}</span></td>
                  <td>${badge(row.taxTreatment || 'DEDUCTIBLE', row.taxTreatment === 'NON_DEDUCTIBLE' ? 'warning' : row.taxTreatment === 'PAYROLL' ? 'neutral' : 'success')}</td>
                  <td>${escapeHtml(String(row.deductiblePercent || 0))}%</td>
                  <td>${money(row.nonDeductibleAmount || 0, currency)}</td>
                </tr>
              `),
              empty: 'No non-deductible adjustments.'
            })
          : emptyState('No non-deductible adjustments', 'Mark expenses as non-deductible or partially deductible to build the PK tax adjustment schedule.')
      })}
    </div>
  `;

  const side = sideStack([
    listCard({
      title: 'PK tax summary',
      subtitle: 'Current Pakistan payroll tax and deductibility picture.',
      items: [
        insightRow({ title: 'Payroll gross', meta: 'Selected report scope', value: `<span>${money(report.summary?.payrollGross || 0, currency)}</span>` }),
        insightRow({ title: 'Payroll withholding', meta: 'Salary tax payable', value: `<span>${money(report.summary?.payrollWithholdingTax || 0, currency)}</span>` }),
        insightRow({ title: 'Non-deductible', meta: 'Expense adjustment total', value: `<span>${money(report.summary?.nonDeductibleExpense || 0, currency)}</span>` })
      ]
    }),
    callout({
      tone: 'neutral',
      title: report.settings?.taxYearLabel || 'TY2026',
      description: `PK payroll withholding is being calculated under section ${report.settings?.withholdingSection || '149'} for a ${report.settings?.entityType || 'PVT_LTD'} setup.`
    })
  ]);

  return workspaceSplit({ main, side });
}

export function renderReports(state) {
  const filters = state.ui.filters.reports;
  const tab = state.ui.activeTabs.reports;
  const reports = state.data.reports || {};
  const highlights = reportHighlights(state);

  const filterMarkup = filterBar(`
    <label><span>From</span><input id="reports_from" type="date" value="${escapeHtml(filters.fromDate || '')}" /></label>
    <label><span>To</span><input id="reports_to" type="date" value="${escapeHtml(filters.toDate || '')}" /></label>
    <label><span>Entity</span>
      <select id="reports_entity">
        <option value="">Global consolidated</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${filters.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <div class="filter-bar__actions">
      <button class="button button--ghost" data-action="apply-report-filters">Apply filters</button>
      <button class="button button--ghost" data-action="print-reports">Print</button>
    </div>
  `);

  const tabs = workspaceTabs({
    scope: 'reports',
    active: tab,
    items: [
      { value: 'statements', label: 'Statements' },
      { value: 'management', label: 'Management' },
      { value: 'working-capital', label: 'Working capital' },
      { value: 'revenue', label: 'Revenue & LOS' },
      { value: 'treasury', label: 'Treasury & partner' },
      { value: 'pk-tax', label: 'PK tax' }
    ]
  });

  const body = tab === 'management'
    ? managementView(state, reports)
    : tab === 'working-capital'
      ? workingCapitalView(state, reports)
      : tab === 'revenue'
        ? revenueView(state, reports)
        : tab === 'treasury'
          ? treasuryView(state, reports)
          : tab === 'pk-tax'
            ? pkTaxView(state, reports)
          : statementsView(state, reports);

  return `
    ${pageHero({
      eyebrow: 'Formal reporting',
      title: 'Reports workspace',
      description: 'Review formal statements, management performance, working-capital risk, revenue mix, and treasury outputs in a reporting workspace that behaves like finance software.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button>`,
      meta: `<span class="hero-meta-item">Management net ${highlights.managementNet}</span><span class="hero-meta-item">Closing cash ${highlights.closingCash}</span><span class="hero-meta-item">Open AR ${highlights.openAr}</span>`
    })}
    ${metricGrid([
      { label: 'Management net', value: highlights.managementNet, detail: 'Consolidated management result' },
      { label: 'Closing cash', value: highlights.closingCash, detail: 'Statutory cash flow closing balance' },
      { label: 'Open AR', value: highlights.openAr, detail: 'Revenue-by-LOS report summary' },
      { label: 'Data freshness', value: escapeHtml(state.data.qboStatus?.lastPullAt || state.data.qboStatus?.lastSyncAt || 'No pull'), detail: 'Latest source sync timestamp' }
    ])}
    ${filterMarkup}
    ${reportFilterChips(filters)}
    ${tabs}
    ${body}
  `;
}
