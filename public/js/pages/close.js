import { pageHero } from '../components/layout.js';
import {
  tableCard,
  dataTable,
  metricGrid,
  badge,
  emptyState,
  workspaceSplit,
  sideStack,
  listCard,
  insightRow,
  callout
} from '../components/primitives.js';
import { latestClosePeriod } from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

function relatedPartyStatusTone(summary = {}) {
  return Number(summary.closeBlockerCount || 0) > 0 ? 'warning' : 'success';
}

function focusEvidenceCount(focus) {
  return (focus?.evidenceRecords || []).length;
}

export function renderClose(state) {
  const periods = [...(state.data.closePeriods || [])].sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')));
  const focus = latestClosePeriod(state);
  const useSnapshot = String(focus?.status || '').toUpperCase() === 'CLOSED';
  const checks = useSnapshot ? (focus?.checklistSnapshot || []) : (focus?.checklist?.checks || []);
  const metrics = useSnapshot ? (focus?.metricsSnapshot || {}) : (focus?.checklist?.metrics || {});
  const relatedParty = useSnapshot ? (focus?.relatedPartySnapshot || null) : (state.data.closeRelatedParty || focus?.checklist?.relatedParty || null);
  const openCount = periods.filter((period) => String(period.status || '').toUpperCase() !== 'CLOSED').length;
  const closedCount = periods.filter((period) => String(period.status || '').toUpperCase() === 'CLOSED').length;
  const blockerCount = checks.filter((item) => !item.pass).length;

  const checklistCard = focus
    ? tableCard({
        title: `${focus.periodKey} close checklist`,
        subtitle: useSnapshot ? 'Stored close snapshot for the selected period.' : 'Live blockers and readiness checks for the selected period.',
        toolbar: `
          <div class="toolbar-group">
            ${String(focus.status || '').toUpperCase() === 'CLOSED'
              ? `<button class="button button--ghost" data-action="open-period-reopen" data-id="${focus.periodKey}">Reopen period</button>`
              : `<button class="button button--primary" data-action="open-period-close" data-id="${focus.periodKey}">Close period</button>`}
          </div>
        `,
        table: dataTable({
          columns: [{ label: 'Check' }, { label: 'Detail' }, { label: 'Status' }],
          rows: checks.map((check) => `
            <tr>
              <td><strong>${escapeHtml(check.label)}</strong></td>
              <td>${escapeHtml(check.detail || '—')}</td>
              <td>${badge(check.pass ? 'PASS' : 'BLOCKED', check.pass ? 'success' : 'warning')}</td>
            </tr>
          `),
          empty: 'No checklist for this period.'
        })
      })
    : emptyState('No close period loaded', 'Open periods will appear here once the close workspace loads period data.');

  const relatedPartyCard = relatedParty
    ? tableCard({
        title: 'Related-party reconciliation',
        subtitle: useSnapshot ? 'Stored period-end related-party snapshot.' : 'Pair-level reconciliation, elimination readiness, and period-end close blockers.',
        toolbar: !useSnapshot && focus
          ? `<div class="toolbar-group"><button class="button button--ghost" data-action="generate-related-party-eliminations" data-id="${focus.periodKey}">Generate eliminations</button></div>`
          : '',
        table: (relatedParty.pairs || []).length
          ? dataTable({
              columns: [{ label: 'Pair' }, { label: 'Funding' }, { label: 'Repaid' }, { label: 'Outstanding' }, { label: 'Journal due from' }, { label: 'Journal due to' }, { label: 'Status' }, { label: 'Elimination' }],
              rows: (relatedParty.pairs || []).map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.pairLabel || row.pairKey)}</strong><br/><span class="muted-copy">${escapeHtml((row.currencies || []).join(', ') || '—')}</span></td>
                  <td>${money(row.fundingTotal || 0, relatedParty.reportingCurrency || 'USD')}</td>
                  <td>${money(row.repaymentTotal || 0, relatedParty.reportingCurrency || 'USD')}</td>
                  <td>${money(row.outstandingBalance || 0, relatedParty.reportingCurrency || 'USD')}</td>
                  <td>${money(row.journalDueFromBalance || 0, relatedParty.reportingCurrency || 'USD')}</td>
                  <td>${money(row.journalDueToBalance || 0, relatedParty.reportingCurrency || 'USD')}</td>
                  <td>${badge(row.reconciles ? 'RECONCILED' : 'MISMATCH', row.reconciles ? 'success' : 'warning')}</td>
                  <td>${row.eliminationStatus === 'GENERATED'
                    ? `${badge('GENERATED', 'success')}<br/><span class="muted-copy">${escapeHtml(row.eliminationJournalNumber || '—')}</span>`
                    : row.eliminationStatus === 'READY'
                      ? badge('READY', 'neutral')
                      : row.eliminationStatus === 'STALE'
                        ? badge('STALE', 'warning')
                        : row.eliminationStatus === 'BLOCKED_MISMATCH'
                          ? badge('BLOCKED', 'danger')
                          : badge('N/A', 'neutral')}</td>
                </tr>
              `),
              empty: 'No related-party pairs in scope.'
            })
          : emptyState('No related-party pairs', 'There are no intercompany balances to reconcile for this period.')
      })
    : emptyState('No related-party reconciliation loaded', 'Close-time related-party controls will appear here when the period data loads.');

  const cleanupCard = relatedParty
    ? tableCard({
        title: 'Historical balance cleanup',
        subtitle: 'Legacy related-party balances that do not pair cleanly and should be cleared through a controlled adjustment journal.',
        table: (relatedParty.cleanupExceptions || []).length
          ? dataTable({
              columns: [{ label: 'Entity' }, { label: 'Account' }, { label: 'Currency' }, { label: 'Net balance' }, { label: 'Support' }, { label: 'Action' }],
              rows: (relatedParty.cleanupExceptions || []).map((row) => `
                <tr>
                  <td>${escapeHtml(row.entity || '—')}</td>
                  <td><strong>${escapeHtml(`${row.accountCode || '—'} | ${row.accountName || 'Unknown account'}`)}</strong></td>
                  <td>${escapeHtml(row.currency || '—')}</td>
                  <td>${money(row.netNative || 0, row.currency || 'USD')}</td>
                  <td>${row.support?.length || 0} journal(s)</td>
                  <td>${useSnapshot ? 'Snapshot only' : `<button class="button button--ghost" data-action="open-related-party-cleanup" data-id="${row.id}">Create cleanup journal</button>`}</td>
                </tr>
              `),
              empty: 'No cleanup exceptions.'
            })
          : emptyState('No cleanup exceptions', 'No historical related-party balances are flagged for cleanup in this period.')
      })
    : '';

  const side = sideStack([
    callout({
      tone: blockerCount ? 'warning' : 'success',
      title: focus ? `${focus.periodKey} is ${String(focus.status || 'OPEN').toLowerCase()}` : 'No active close period',
      description: focus
        ? blockerCount
          ? `${blockerCount} checklist blockers still need action before close can complete.`
          : 'Checklist blockers are clear for the current focus period.'
        : 'Load period data to review close readiness.'
    }),
    listCard({
      title: 'Close readiness',
      subtitle: 'Operational summary of the current period.',
      items: [
        insightRow({ title: 'Current period', meta: 'Focus register', value: `<span>${escapeHtml(focus?.periodKey || '—')}</span>` }),
        insightRow({ title: 'Checklist blockers', meta: 'Checks that still fail', value: `<span>${blockerCount}</span>`, tone: blockerCount ? 'warning' : 'success' }),
        insightRow({ title: 'Close evidence', meta: 'Files and support notes linked to the period', value: `<span>${focusEvidenceCount(focus)}</span>`, tone: focusEvidenceCount(focus) ? 'success' : 'warning' }),
        insightRow({ title: 'RP blockers', meta: 'Mismatches, missing eliminations, cleanup items', value: `<span>${relatedParty?.summary?.closeBlockerCount || 0}</span>`, tone: relatedPartyStatusTone(relatedParty?.summary) })
      ]
    }),
    focus
      ? listCard({
          title: 'Period support',
          subtitle: 'Evidence, signoff, and operational balances tied to the focus period.',
          items: [
            insightRow({ title: 'Approval status', meta: 'Period workflow state', value: badge(focus.approval?.approvalStatus || focus.closeApprovalSnapshot?.approvalStatus || 'PENDING', ['APPROVED', 'POSTED'].includes(String(focus.approval?.approvalStatus || focus.closeApprovalSnapshot?.approvalStatus || '').toUpperCase()) ? 'success' : 'warning') }),
            insightRow({ title: 'Open AR', meta: 'Customer balances in period scope', value: `<span>${money(metrics.openAr || 0)}</span>` }),
            insightRow({ title: 'Open AP', meta: 'Outstanding liabilities in period scope', value: `<span>${money(metrics.openAp || 0)}</span>` }),
            insightRow({ title: 'RP outstanding', meta: 'Open intercompany exposure', value: `<span>${money(relatedParty?.summary?.outstandingBalance || metrics.openIntercompany || 0, relatedParty?.reportingCurrency || 'USD')}</span>` })
          ]
        })
      : '',
    tableCard({
      title: 'Period register',
      subtitle: 'Open and closed periods with evidence visibility.',
      table: periods.length
        ? dataTable({
            columns: [{ label: 'Period' }, { label: 'Status' }, { label: 'Evidence' }, { label: 'Action' }],
            rows: periods.map((period) => `
              <tr data-open-drawer="period:${period.periodKey}">
                <td><strong>${escapeHtml(period.periodKey)}</strong></td>
                <td>${badge(period.status)}</td>
                <td>${badge(String((period.evidenceRecords || []).length), (period.evidenceRecords || []).length ? 'success' : 'warning')}</td>
                <td>${String(period.status || '').toUpperCase() === 'CLOSED'
                  ? `<button class="button button--ghost" data-action="open-period-reopen" data-id="${period.periodKey}">Reopen</button>`
                  : `<button class="button button--ghost" data-action="open-period-close" data-id="${period.periodKey}">Close</button>`}</td>
              </tr>
            `),
            empty: 'No periods found.'
          })
        : emptyState('No periods found', 'There are no month-end periods in the current dataset.')
    })
  ].filter(Boolean));

  const main = `
    <div class="workspace-stack">
      ${checklistCard}
      ${relatedPartyCard}
      ${cleanupCard}
    </div>
  `;

  return `
    ${pageHero({
      eyebrow: 'Period governance',
      title: 'Month-end close',
      description: 'Review blockers, validate related-party balances, confirm evidence-backed signoff, and keep reopen decisions controlled.',
      actions: focus && String(focus.status || '').toUpperCase() !== 'CLOSED'
        ? `<button class="button button--primary" data-action="open-period-close" data-id="${focus.periodKey}">Close current period</button>`
        : '',
      meta: focus ? `<span class="hero-meta-item">Current period ${focus.periodKey}</span><span class="hero-meta-item">Status ${focus.status}</span><span class="hero-meta-item">Evidence ${focusEvidenceCount(focus)}</span>` : ''
    })}
    ${metricGrid([
      { label: 'Open periods', value: String(openCount), detail: 'Periods still accepting postings' },
      { label: 'Closed periods', value: String(closedCount), detail: 'Locked periods in the register' },
      { label: 'Open AR', value: money(metrics.openAr || 0), detail: 'Current period customer balances' },
      { label: 'Open AP', value: money(metrics.openAp || 0), detail: 'Current period liabilities still outstanding' },
      { label: 'RP blockers', value: String(relatedParty?.summary?.closeBlockerCount || 0), detail: 'Mismatches, missing eliminations, and cleanup exceptions' },
      { label: 'Close evidence', value: String(focusEvidenceCount(focus)), detail: 'Files and support notes linked to this period' }
    ])}
    ${workspaceSplit({ main, side })}
  `;
}
