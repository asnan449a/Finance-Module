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
import {
  filteredReconciliationQueue,
  railSummaries,
  reconciliationQueueItems,
  reconciliationQueueSummary,
  reconciliationTabCount
} from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

const QUEUE_TABS = ['suggested', 'unmatched', 'duplicates', 'exceptions', 'deferred', 'cleared'];

function toneForConfidence(label) {
  if (label === 'HIGH') return 'success';
  if (label === 'MEDIUM') return 'warning';
  return 'neutral';
}

function toneForReviewState(state) {
  const normalized = String(state || '').toUpperCase();
  if (normalized === 'CLEARED') return 'success';
  if (['DEFERRED'].includes(normalized)) return 'neutral';
  if (['NEEDS_REMITTANCE', 'FOLLOW_UP_REQUIRED', 'EXCEPTION_OPEN', 'REVIEWED_PENDING'].includes(normalized)) return 'warning';
  if (normalized === 'DUPLICATE_REVIEW') return 'danger';
  if (['READY_TO_MATCH'].includes(normalized)) return 'success';
  return 'neutral';
}

function queueItems(state) {
  return reconciliationQueueItems(state);
}

function queueSummary(state) {
  return reconciliationQueueSummary(state);
}

function filteredQueue(state) {
  return filteredReconciliationQueue(state);
}

function selectionToolbar(state, rows) {
  const selectedIds = state.ui.selections.banking || [];
  const selectedRows = rows.filter((row) => selectedIds.includes(row.transactionId));
  const eligibleQuick = selectedRows.filter((row) => row.safeBulkActions?.includes('QUICK_MATCH')).length;
  const eligibleDuplicate = selectedRows.filter((row) => row.safeBulkActions?.includes('IGNORE_DUPLICATE')).length;
  const eligibleRemittance = selectedRows.filter((row) => row.safeBulkActions?.includes('NEEDS_REMITTANCE')).length;
  const eligibleClear = selectedRows.filter((row) => row.safeBulkActions?.includes('CLEAR_REVIEW')).length;

  return `
    <div class="toolbar-group">
      <span class="toolbar-count">${selectedRows.length} selected</span>
      <button class="button button--ghost" data-action="select-visible-banking" ${rows.length ? '' : 'disabled'}>Select visible</button>
      <button class="button button--ghost" data-action="clear-banking-selection" ${selectedRows.length ? '' : 'disabled'}>Clear selection</button>
      <button class="button button--ghost" data-action="open-banking-bulk-action" data-bulk-action="QUICK_MATCH" ${eligibleQuick ? '' : 'disabled'}>Bulk apply best (${eligibleQuick})</button>
      <button class="button button--ghost" data-action="open-banking-bulk-action" data-bulk-action="IGNORE_DUPLICATE" ${eligibleDuplicate ? '' : 'disabled'}>Bulk ignore duplicates (${eligibleDuplicate})</button>
      <button class="button button--ghost" data-action="open-banking-bulk-action" data-bulk-action="NEEDS_REMITTANCE" ${eligibleRemittance ? '' : 'disabled'}>Bulk needs remittance (${eligibleRemittance})</button>
      <button class="button button--ghost" data-action="open-banking-bulk-action" data-bulk-action="CLEAR_REVIEW" ${eligibleClear ? '' : 'disabled'}>Bulk clear review (${eligibleClear})</button>
    </div>
  `;
}

function emptyStateForTab(tab) {
  if (tab === 'suggested') return emptyState('No suggested matches', 'High-confidence invoice candidates will appear here when the queue finds safe cash-application opportunities.', '<button class="button button--ghost" data-action="run-auto-match">Run auto-match</button>');
  if (tab === 'duplicates') return emptyState('No duplicate review queue', 'Duplicate suspects and reviewed duplicates will appear here when imported rows look materially similar.');
  if (tab === 'exceptions') return emptyState('No open cash exceptions', 'Rows needing remittance, follow-up, or investigation will appear here when routine matching is not enough.');
  if (tab === 'deferred') return emptyState('No deferred cash work', 'Use Defer inside the transaction drawer when a row cannot be resolved today but should come back later.');
  if (tab === 'cleared') return emptyState('No cleared history in scope', 'Matched and closed cash rows will appear here for operator reference.');
  return emptyState('No unmatched cash', 'Import a statement or adjust filters to bring unmatched inflows into this queue.', '<button class="button button--primary" data-action="open-bank-import">Import statement</button>');
}

function queueTable(state, rows) {
  const tab = state.ui.activeTabs.banking || 'suggested';
  return tableCard({
    title: 'Reconciliation queue',
    subtitle: 'Work easy wins, duplicate suspects, follow-ups, and deferred cash exceptions from one review surface.',
    toolbar: selectionToolbar(state, rows),
    table: rows.length
      ? dataTable({
          columns: [
            { label: '' },
            { label: 'Transaction' },
            { label: 'Rail' },
            { label: 'Amount' },
            { label: 'Work state' },
            { label: 'Match signal' },
            { label: 'Support' },
            { label: 'Follow-up' },
            { label: 'Age' },
            { label: 'Action' }
          ],
          rows: rows.map((row) => {
            const selected = (state.ui.selections.banking || []).includes(row.transactionId);
            const followUpMeta = row.deferredUntil
              ? `Deferred until ${row.deferredUntil}`
              : row.followUpOwnerName
                ? `Owner: ${row.followUpOwnerName}`
                : row.reconciliationReviewNote || 'No follow-up note';
            return `
              <tr data-open-drawer="transaction:${row.transactionId}">
                <td><input type="checkbox" data-action="toggle-selection" data-scope="banking" data-id="${row.transactionId}" ${selected ? 'checked' : ''} /></td>
                <td>
                  <strong>${escapeHtml(row.reference || row.transactionId)}</strong>
                  <br/><span class="muted-copy">${escapeHtml(row.subject || 'No subject')}</span>
                  ${row.counterparty ? `<br/><span class="muted-copy">${escapeHtml(row.counterparty)}</span>` : ''}
                </td>
                <td>
                  ${escapeHtml(row.railName || 'Unassigned rail')}
                  <br/><span class="muted-copy">${escapeHtml(row.entity || '—')} · ${escapeHtml(row.currency || '—')}</span>
                </td>
                <td>
                  <strong>${money(row.remainingAmount || row.amount || 0, row.currency || 'USD')}</strong>
                  ${Number(row.matchedAmount || 0) > 0 ? `<br/><span class="muted-copy">${money(row.matchedAmount || 0, row.currency || 'USD')} matched</span>` : ''}
                </td>
                <td>
                  ${badge(row.reviewState || 'MANUAL_MATCH', toneForReviewState(row.reviewState))}
                  <br/><span class="muted-copy">${escapeHtml(row.priorityLabel || 'LOW')} priority</span>
                </td>
                <td>
                  ${row.topSuggestion
                    ? `${badge(row.confidenceLabel || 'LOW', toneForConfidence(row.confidenceLabel || 'LOW'))}<br/><span class="muted-copy">${escapeHtml(`${row.topSuggestion.invoiceNumber} · ${row.topSuggestion.clientName || 'Unknown client'}`)}</span>`
                    : '<span class="muted-copy">Manual review</span>'}
                </td>
                <td>
                  ${badge(row.supportStatus || 'UNKNOWN', row.needsRemittance ? 'warning' : 'success')}
                  ${row.issueReasons?.length ? `<br/><span class="muted-copy">${escapeHtml(row.issueReasons[0])}</span>` : ''}
                </td>
                <td>
                  <span class="muted-copy">${escapeHtml(followUpMeta)}</span>
                </td>
                <td>
                  ${row.ageDays || 0}d
                  <br/><span class="muted-copy">${escapeHtml(shortDate(row.date))}</span>
                </td>
                <td>
                  ${row.quickMatchAvailable
                    ? `<button class="button button--primary" data-action="quick-transaction-match" data-id="${row.transactionId}">Apply best</button>`
                    : `<button class="button button--ghost" data-open-drawer="transaction:${row.transactionId}">Review</button>`}
                </td>
              </tr>
            `;
          }),
          empty: 'No reconciliation rows match the current queue filters.'
        })
      : emptyStateForTab(tab)
  });
}

function topItems(rows, predicate, limit = 5) {
  return rows.filter(predicate).slice(0, limit);
}

export function renderBanking(state) {
  const rails = railSummaries(state);
  const summary = queueSummary(state);
  const allRows = queueItems(state);
  const rows = filteredQueue(state);
  const filters = state.ui.filters.banking || {};
  const tab = state.ui.activeTabs.banking || 'suggested';
  const selectedRail = rails.find((rail) => String(rail.id) === String(filters.rail || '')) || null;

  const tabs = workspaceTabs({
    scope: 'banking',
    active: tab,
    items: QUEUE_TABS.map((bucket) => ({
      value: bucket,
      label: bucket === 'cleared'
        ? 'Cleared history'
        : bucket === 'suggested'
          ? 'Suggested matches'
          : bucket[0].toUpperCase() + bucket.slice(1),
      count: reconciliationTabCount(state, bucket)
    }))
  });

  const filtersMarkup = filterBar(`
    <label><span>Search</span><input id="banking_query" type="search" value="${escapeHtml(filters.query || '')}" placeholder="Transaction, memo, customer, issue, note" /></label>
    <label><span>Rail</span>
      <select id="banking_rail">
        <option value="ALL">All rails</option>
        ${rails.map((rail) => `<option value="${rail.id}" ${filters.rail === rail.id ? 'selected' : ''}>${escapeHtml(`${rail.name} · ${rail.entity}/${rail.currency}`)}</option>`).join('')}
      </select>
    </label>
    <label><span>Focus</span>
      <select id="banking_focus">
        <option value="ALL" ${filters.focus === 'ALL' ? 'selected' : ''}>All queue work</option>
        <option value="EASY_WINS" ${filters.focus === 'EASY_WINS' ? 'selected' : ''}>Easy wins</option>
        <option value="URGENT" ${filters.focus === 'URGENT' ? 'selected' : ''}>Urgent</option>
        <option value="FOLLOW_UP" ${filters.focus === 'FOLLOW_UP' ? 'selected' : ''}>Follow-up</option>
        <option value="NEEDS_REMITTANCE" ${filters.focus === 'NEEDS_REMITTANCE' ? 'selected' : ''}>Needs remittance</option>
        <option value="DUPLICATES" ${filters.focus === 'DUPLICATES' ? 'selected' : ''}>Duplicates</option>
        <option value="DEFERRED" ${filters.focus === 'DEFERRED' ? 'selected' : ''}>Deferred</option>
      </select>
    </label>
    <label><span>Confidence</span>
      <select id="banking_confidence">
        <option value="ALL" ${filters.confidence === 'ALL' ? 'selected' : ''}>All confidence</option>
        ${['HIGH', 'MEDIUM', 'LOW', 'NONE', 'CLEARED'].map((row) => `<option value="${row}" ${filters.confidence === row ? 'selected' : ''}>${row}</option>`).join('')}
      </select>
    </label>
    <label><span>Issue</span>
      <select id="banking_issue">
        <option value="ALL" ${filters.issue === 'ALL' ? 'selected' : ''}>All issues</option>
        <option value="DUPLICATE" ${filters.issue === 'DUPLICATE' ? 'selected' : ''}>Duplicate suspects</option>
        <option value="REMITTANCE" ${filters.issue === 'REMITTANCE' ? 'selected' : ''}>Needs remittance</option>
        <option value="FOLLOW_UP" ${filters.issue === 'FOLLOW_UP' ? 'selected' : ''}>Follow-up</option>
        <option value="DEFERRED" ${filters.issue === 'DEFERRED' ? 'selected' : ''}>Deferred</option>
        <option value="LOW_CONFIDENCE" ${filters.issue === 'LOW_CONFIDENCE' ? 'selected' : ''}>Low confidence</option>
        <option value="NO_CANDIDATE" ${filters.issue === 'NO_CANDIDATE' ? 'selected' : ''}>No candidate</option>
        <option value="PARTIAL" ${filters.issue === 'PARTIAL' ? 'selected' : ''}>Partial remaining</option>
        <option value="FLAGGED" ${filters.issue === 'FLAGGED' ? 'selected' : ''}>Flagged</option>
      </select>
    </label>
    <label><span>Support</span>
      <select id="banking_support">
        <option value="ALL" ${filters.support === 'ALL' ? 'selected' : ''}>All support states</option>
        <option value="READY" ${filters.support === 'READY' ? 'selected' : ''}>Reference/support present</option>
        <option value="NEEDS_REMITTANCE" ${filters.support === 'NEEDS_REMITTANCE' ? 'selected' : ''}>Needs remittance</option>
      </select>
    </label>
    <label><span>Sort</span>
      <select id="banking_sort">
        <option value="priority" ${filters.sort === 'priority' ? 'selected' : ''}>Priority</option>
        <option value="followup" ${filters.sort === 'followup' ? 'selected' : ''}>Follow-up date</option>
        <option value="confidence" ${filters.sort === 'confidence' ? 'selected' : ''}>Confidence</option>
        <option value="age" ${filters.sort === 'age' ? 'selected' : ''}>Age</option>
        <option value="amount" ${filters.sort === 'amount' ? 'selected' : ''}>Amount</option>
        <option value="rail" ${filters.sort === 'rail' ? 'selected' : ''}>Rail</option>
      </select>
    </label>
    <div class="filter-bar__actions">
      <button class="button button--ghost" data-action="apply-banking-filters">Apply filters</button>
      <button class="button button--ghost" data-action="run-auto-match">Run auto-match</button>
      <button class="button button--primary" data-action="open-bank-import">Import statement</button>
    </div>
  `);

  const chips = filterChips([
    { label: 'Rail', value: selectedRail?.name || (filters.rail && filters.rail !== 'ALL' ? filters.rail : '') },
    { label: 'Focus', value: filters.focus },
    { label: 'Confidence', value: filters.confidence },
    { label: 'Issue', value: filters.issue },
    { label: 'Support', value: filters.support },
    { label: 'Search', value: filters.query }
  ], 'All reconciliation rows in scope');

  const easyWins = topItems(allRows, (row) => row.quickMatchAvailable).map((row) => insightRow({
    title: row.reference || row.transactionId,
    meta: `${row.topSuggestion?.invoiceNumber || 'Suggested invoice'} · ${money(row.remainingAmount || row.amount || 0, row.currency || 'USD')}`,
    value: `<span>${escapeHtml(row.railName || 'Unassigned rail')}</span>`,
    tone: 'success',
    action: `<button class="button button--ghost" data-action="quick-transaction-match" data-id="${row.transactionId}">Apply</button>`
  }));

  const followUpItems = topItems(allRows, (row) => ['FOLLOW_UP_REQUIRED', 'REVIEWED_PENDING', 'DEFERRED', 'NEEDS_REMITTANCE'].includes(String(row.reviewState || '').toUpperCase())).map((row) => insightRow({
    title: row.reference || row.transactionId,
    meta: row.deferredUntil ? `Deferred until ${row.deferredUntil}` : (row.reconciliationReviewNote || row.nextAction || 'Needs review follow-up'),
    value: `<span>${escapeHtml(row.followUpOwnerName || row.entity || '—')}</span>`,
    tone: row.reviewState === 'DEFERRED' ? 'neutral' : 'warning',
    action: `<button class="button button--ghost" data-open-drawer="transaction:${row.transactionId}">Review</button>`
  }));

  const exceptionItems = topItems(allRows, (row) => ['exceptions', 'duplicates'].includes(String(row.queueBucket || '').toLowerCase())).map((row) => insightRow({
    title: row.reference || row.transactionId,
    meta: row.issueReasons?.[0] || row.reviewState || 'Needs review',
    value: `<span>${escapeHtml(row.priorityLabel || 'LOW')}</span>`,
    tone: row.duplicateSuspect ? 'danger' : 'warning',
    action: `<button class="button button--ghost" data-open-drawer="transaction:${row.transactionId}">Review</button>`
  }));

  const railItems = rails.slice(0, 6).map((rail) => insightRow({
    title: rail.name,
    meta: `${rail.entity || '—'} · ${rail.currency || '—'} · ${rail.accountRole || 'ACCOUNT'}`,
    value: `<span>${rail.unmatched || 0} open</span>`,
    tone: rail.unmatched ? 'warning' : 'success'
  }));

  const side = sideStack([
    listCard({
      title: 'Cash posture',
      subtitle: 'What should move first in the current queue.',
      items: [
        insightRow({ title: 'Easy wins', meta: 'High-confidence cash matches', value: `<span>${summary.easyWins || 0}</span>`, tone: (summary.easyWins || 0) > 0 ? 'success' : 'neutral' }),
        insightRow({ title: 'Exception queue', meta: 'Needs investigation or follow-up', value: `<span>${summary.exceptions || 0}</span>`, tone: (summary.exceptions || 0) > 0 ? 'warning' : 'success' }),
        insightRow({ title: 'Deferred', meta: 'Snoozed or held cash rows', value: `<span>${summary.deferred || 0}</span>`, tone: (summary.deferred || 0) > 0 ? 'neutral' : 'success' }),
        insightRow({ title: 'Duplicate suspects', meta: 'Exact and fuzzy duplicates', value: `<span>${summary.duplicates || 0}</span>`, tone: (summary.duplicates || 0) > 0 ? 'danger' : 'success' })
      ]
    }),
    callout({
      tone: summary.easyWins ? 'success' : summary.exceptions ? 'warning' : 'neutral',
      title: summary.easyWins ? `${summary.easyWins} low-risk rows are ready to clear` : (summary.exceptions ? 'Cash exceptions now need follow-up, not more triage' : 'No cash queue in scope'),
      description: summary.easyWins
        ? 'Use Apply best or the bulk toolbar to clear straightforward rows, then work follow-up and deferred items deliberately.'
        : (summary.exceptions
          ? 'The remaining queue is dominated by remittance gaps, duplicates, and investigation work.'
          : 'Import a statement or widen the rail/date scope to create reconciliation work.')
    }),
    listCard({
      title: 'Easy wins',
      subtitle: 'Rows safe enough for fast action.',
      items: easyWins,
      emptyTitle: 'No easy wins yet',
      emptyDescription: 'High-confidence rows will appear here when memo, amount, and invoice data line up strongly.'
    }),
    listCard({
      title: 'Follow-up and deferred',
      subtitle: 'Rows that have already been reviewed but still need a deliberate next step.',
      items: followUpItems,
      emptyTitle: 'No follow-up backlog',
      emptyDescription: 'Needs-remittance, follow-up, reviewed-pending, and deferred rows will collect here.'
    }),
    listCard({
      title: 'Exceptions',
      subtitle: 'Duplicate suspects and harder investigation items.',
      items: exceptionItems,
      emptyTitle: 'No open cash exceptions',
      emptyDescription: 'Exception rows will appear here when routine matching is not enough.'
    }),
    listCard({
      title: 'Rail context',
      subtitle: selectedRail ? 'Current selected rail posture.' : 'Top governed rails by open work.',
      items: selectedRail
        ? [
            insightRow({ title: selectedRail.name, meta: `${selectedRail.entity || '—'} · ${selectedRail.currency || '—'}`, value: `<span>${selectedRail.unmatched || 0} open</span>` }),
            insightRow({ title: 'Inflows', meta: 'Current dataset', value: `<span>${money(selectedRail.inflow || 0, selectedRail.currency || 'USD')}</span>` }),
            insightRow({ title: 'Outflows', meta: 'Current dataset', value: `<span>${money(selectedRail.outflow || 0, selectedRail.currency || 'USD')}</span>` }),
            insightRow({ title: 'Net movement', meta: 'Inflows less outflows', value: `<span>${money((selectedRail.inflow || 0) - (selectedRail.outflow || 0), selectedRail.currency || 'USD')}</span>` })
          ]
        : railItems,
      emptyTitle: 'No governed rails',
      emptyDescription: 'Configure source rails in Admin before relying on banking workflows.'
    })
  ]);

  return `
    ${pageHero({
      eyebrow: 'Cash operations',
      title: 'Banking and reconciliation',
      description: 'Run the daily cash-operations queue, clear low-risk receipts quickly, and manage duplicate or follow-up exceptions deliberately.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button><button class="button button--ghost" data-action="run-auto-match">Run auto-match</button><button class="button button--primary" data-action="open-bank-import">Import statement</button>`,
      meta: `<span class="hero-meta-item">${summary.total || 0} rows in queue</span><span class="hero-meta-item">${summary.easyWins || 0} easy wins</span><span class="hero-meta-item">${summary.exceptions || 0} open exceptions</span>`
    })}
    ${metricGrid([
      { label: 'Easy wins', value: String(summary.easyWins || 0), detail: 'High-confidence rows ready for fast clearing' },
      { label: 'Needs follow-up', value: String((summary.followUpRequired || 0) + (summary.reviewedPending || 0) + (summary.needsRemittance || 0)), detail: 'Reviewed rows still waiting on support or response' },
      { label: 'Duplicate suspects', value: String(summary.duplicates || 0), detail: 'Rows needing duplicate review' },
      { label: 'Deferred / snoozed', value: String(summary.deferred || 0), detail: 'Rows parked for a future review date' }
    ])}
    ${filtersMarkup}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main: queueTable(state, rows), side })}
  `;
}
