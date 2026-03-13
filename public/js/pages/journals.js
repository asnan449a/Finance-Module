import { pageHero } from '../components/layout.js';
import {
  dataTable,
  emptyState,
  filterBar,
  filterChips,
  metricGrid,
  tableCard,
  workspaceTabs,
  badge,
  workspaceSplit,
  sideStack,
  listCard,
  insightRow,
  callout
} from '../components/primitives.js';
import { escapeHtml, money, shortDate } from '../utils/format.js';

export function renderJournals(state) {
  const tab = state.ui.activeTabs.journals || 'register';
  const filters = state.ui.filters.journals || {};
  const summary = state.data.journals?.summary || {};
  const journals = state.data.journals?.journals || [];
  const integrity = state.data.accountingIntegrity || { summary: {}, issues: [], roots: [], relatedParty: null };
  const trialBalance = state.data.reports?.trialBalance || { rows: [], totals: {} };
  const query = String(filters.query || '').trim().toLowerCase();

  const filtered = journals.filter((journal) => {
    if (filters.status && filters.status !== 'ALL' && String(journal.status || '').toUpperCase() !== String(filters.status).toUpperCase()) return false;
    if (filters.journalType && filters.journalType !== 'ALL' && String(journal.journalType || '').toUpperCase() !== String(filters.journalType).toUpperCase()) return false;
    if (filters.entity && String(journal.entity || '').toUpperCase() !== String(filters.entity).toUpperCase()) return false;
    if (!query) return true;
    return [journal.journalNumber, journal.memo, journal.sourceType, journal.sourceId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  const filterMarkup = filterBar(`
    <label><span>Status</span>
      <select id="journals_status">
        ${['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'REVERSED'].map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select>
    </label>
    <label><span>Type</span>
      <select id="journals_type">
        ${['ALL', 'MANUAL', 'ADJUSTMENT', 'SYSTEM', 'ELIMINATION', 'REVERSAL'].map((type) => `<option value="${type}" ${filters.journalType === type ? 'selected' : ''}>${type}</option>`).join('')}
      </select>
    </label>
    <label><span>Entity</span>
      <select id="journals_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK'].map((entity) => `<option value="${entity}" ${filters.entity === entity ? 'selected' : ''}>${entity}</option>`).join('')}
      </select>
    </label>
    <label><span>Search</span><input id="journals_query" type="search" value="${escapeHtml(filters.query || '')}" placeholder="Journal number, memo, source" /></label>
    <div class="filter-bar__actions">
      <button class="button button--ghost" data-action="apply-journal-filters">Apply filters</button>
      <button class="button button--primary" data-action="open-journal-create">New journal</button>
    </div>
  `);

  const tabs = workspaceTabs({
    scope: 'journals',
    active: tab,
    items: [
      { value: 'register', label: 'Journal register', count: filtered.length },
      { value: 'trial-balance', label: 'Trial balance', count: trialBalance.rows?.length || 0 },
      { value: 'integrity', label: 'Integrity', count: integrity.summary?.issueCount || 0 }
    ]
  });

  const chips = filterChips([
    { label: 'Status', value: filters.status },
    { label: 'Type', value: filters.journalType },
    { label: 'Entity', value: filters.entity },
    { label: 'Search', value: filters.query }
  ], 'All journals in current scope');

  const registerTable = filtered.length
    ? tableCard({
        title: 'Journal register',
        subtitle: 'Manual, adjustment, system, elimination, and reversal journals with row-level detail on click.',
        table: dataTable({
          columns: [
            { label: 'Journal' },
            { label: 'Date' },
            { label: 'Entity' },
            { label: 'Type' },
            { label: 'Source' },
            { label: 'Debit' },
            { label: 'Credit' },
            { label: 'Status' }
          ],
          rows: filtered.map((journal) => `
            <tr data-open-drawer="journal:${journal.id}">
              <td><strong>${escapeHtml(journal.journalNumber || journal.id)}</strong><br/><span class="muted-copy">${escapeHtml(journal.memo || 'No memo')}</span></td>
              <td>${escapeHtml(shortDate(journal.postingDate))}</td>
              <td>${escapeHtml(journal.entity || '—')}</td>
              <td>${escapeHtml(journal.journalType || '—')}</td>
              <td>${escapeHtml(journal.sourceType || 'MANUAL')}${journal.sourceId ? `<br/><span class="muted-copy">${escapeHtml(journal.sourceId)}</span>` : ''}</td>
              <td>${money(journal.totalDebit || 0, journal.currency || 'USD')}</td>
              <td>${money(journal.totalCredit || 0, journal.currency || 'USD')}</td>
              <td>${badge(journal.status || 'DRAFT')}</td>
            </tr>
          `),
          empty: 'No journals found.'
        })
      })
    : emptyState('No journals found', 'Create or sync journals to populate the register.', '<button class="button button--primary" data-action="open-journal-create">New journal</button>');

  const tbTable = (trialBalance.rows || []).length
    ? tableCard({
        title: 'Trial balance',
        subtitle: `As of ${escapeHtml(trialBalance.asOfDate || state.ui.filters.reports?.toDate || 'today')}`,
        table: dataTable({
          columns: [
            { label: 'Account' },
            { label: 'Type' },
            { label: 'Debit' },
            { label: 'Credit' },
            { label: 'Net' }
          ],
          rows: trialBalance.rows.map((row) => `
            <tr data-action="tb-drilldown" data-id="${escapeHtml(row.code || '')}">
              <td><strong>${escapeHtml(`${row.code || '—'} | ${row.name || 'Unnamed account'}`)}</strong>${row.reportingGroup ? `<br/><span class="muted-copy">${escapeHtml(row.reportingGroup)}</span>` : ''}</td>
              <td>${escapeHtml(row.type || '—')}</td>
              <td>${money(row.debit || 0, trialBalance.reportingCurrency || 'USD')}</td>
              <td>${money(row.credit || 0, trialBalance.reportingCurrency || 'USD')}</td>
              <td>${money(row.net || 0, trialBalance.reportingCurrency || 'USD')}</td>
            </tr>
          `),
          empty: 'No trial balance rows.'
        })
      })
    : emptyState('No trial balance rows', 'Posted journals will populate the trial balance.');

  const issuesTable = tableCard({
    title: 'Integrity issues',
    subtitle: 'Posting ownership, linkage, duplicate, stale, and mismatch conditions detected by the accounting engine.',
    table: (integrity.issues || []).length
      ? dataTable({
          columns: [{ label: 'Severity' }, { label: 'Issue' }, { label: 'Workflow' }, { label: 'Source' }, { label: 'Journal' }],
          rows: (integrity.issues || []).map((row) => `
            <tr>
              <td>${badge(row.severity || 'INFO', row.severity === 'CRITICAL' ? 'danger' : 'warning')}</td>
              <td><strong>${escapeHtml(row.code || 'ISSUE')}</strong><br/><span class="muted-copy">${escapeHtml(row.message || '—')}</span></td>
              <td>${escapeHtml(`${row.sourceRootType || '—'}:${row.sourceRootId || '—'}`)}</td>
              <td>${escapeHtml(row.sourceType ? `${row.sourceType}:${row.sourceId || '—'}` : '—')}</td>
              <td>${escapeHtml(row.journalId || '—')}</td>
            </tr>
          `),
          empty: 'No integrity issues.'
        })
      : emptyState('No integrity issues', 'Posting ownership, source linkage, and close-sensitive reconciliations are currently clean.')
  });

  const rootsTable = tableCard({
    title: 'Root ownership status',
    subtitle: 'Source workflows and their accounting status under the unified posting engine.',
    table: (integrity.roots || []).length
      ? dataTable({
          columns: [{ label: 'Workflow' }, { label: 'Label' }, { label: 'Accounting' }, { label: 'Expected' }, { label: 'Posted' }, { label: 'Issues' }],
          rows: (integrity.roots || []).slice(0, 24).map((row) => `
            <tr>
              <td>${escapeHtml(row.rootType || '—')}</td>
              <td>${escapeHtml(row.label || row.rootId || '—')}</td>
              <td>${badge(row.accountingStatus || 'UNKNOWN', row.issueCount ? 'warning' : 'success')}</td>
              <td>${escapeHtml(String(row.expectedCount || 0))}</td>
              <td>${escapeHtml(String(row.postedCount || 0))}</td>
              <td>${escapeHtml(String(row.issueCount || 0))}</td>
            </tr>
          `),
          empty: 'No workflow roots reviewed.'
        })
      : emptyState('No posting roots', 'Accounting integrity results will appear here after finance data loads.')
  });

  const main = tab === 'register'
    ? registerTable
    : tab === 'trial-balance'
      ? tbTable
      : `<div class="workspace-stack">${issuesTable}${rootsTable}</div>`;

  const side = sideStack([
    listCard({
      title: 'Journal posture',
      subtitle: 'Current control position of the ledger foundation.',
      items: [
        insightRow({ title: 'Total journals', meta: 'All journal records in scope', value: `<span>${summary.total || 0}</span>` }),
        insightRow({ title: 'Pending approval', meta: 'Waiting for review', value: `<span>${summary.pendingApproval || 0}</span>`, tone: (summary.pendingApproval || 0) > 0 ? 'warning' : 'success' }),
        insightRow({ title: 'Posted', meta: 'Authoritative accounting records', value: `<span>${summary.posted || 0}</span>` }),
        insightRow({ title: 'TB totals', meta: 'Debit / credit control', value: `<span>${money(trialBalance.totals?.debit || 0, trialBalance.reportingCurrency || 'USD')} / ${money(trialBalance.totals?.credit || 0, trialBalance.reportingCurrency || 'USD')}</span>` })
      ]
    }),
    callout({
      tone: (integrity.summary?.issueCount || 0) > 0 ? 'warning' : 'success',
      title: (integrity.summary?.issueCount || 0) > 0 ? `${integrity.summary?.issueCount || 0} integrity issues need review` : 'Posting integrity is clean',
      description: (integrity.summary?.issueCount || 0) > 0 ? 'Use the integrity tab to review missing postings, duplicates, stale journals, and workflow drift.' : 'The posting engine is not flagging workflow ownership or close-sensitive exceptions right now.'
    }),
    tab === 'trial-balance'
      ? tableCard({
          title: 'TB control',
          subtitle: 'Posted-journal control totals in reporting currency.',
          table: dataTable({
            columns: [{ label: 'Line item' }, { label: 'Amount' }],
            rows: [
              `<tr><td>Total debits</td><td>${money(trialBalance.totals?.debit || 0, trialBalance.reportingCurrency || 'USD')}</td></tr>`,
              `<tr><td>Total credits</td><td>${money(trialBalance.totals?.credit || 0, trialBalance.reportingCurrency || 'USD')}</td></tr>`,
              `<tr class="report-total"><td>Balanced</td><td>${(trialBalance.totals?.debit || 0) === (trialBalance.totals?.credit || 0) ? 'Yes' : 'Check register'}</td></tr>`
            ],
            empty: 'No trial balance control data.'
          })
        })
      : tableCard({
          title: 'Related-party close',
          subtitle: 'Close-sensitive related-party conditions carried into the integrity layer.',
          table: (integrity.relatedParty?.pairs || []).length
            ? dataTable({
                columns: [{ label: 'Pair' }, { label: 'Outstanding' }, { label: 'Reconcile' }, { label: 'Elimination' }, { label: 'Blocker' }],
                rows: (integrity.relatedParty?.pairs || []).slice(0, 12).map((pair) => `
                  <tr>
                    <td>${escapeHtml(pair.pairLabel || pair.pairKey || '—')}</td>
                    <td>${money(pair.outstandingBalance || 0, integrity.relatedParty?.reportingCurrency || 'USD')}</td>
                    <td>${badge(pair.reconciles ? 'RECONCILED' : 'MISMATCH', pair.reconciles ? 'success' : 'danger')}</td>
                    <td>${badge(pair.eliminationStatus || 'NOT_REQUIRED', pair.eliminationStatus === 'GENERATED' ? 'success' : (pair.eliminationStatus === 'READY' ? 'warning' : 'neutral'))}</td>
                    <td>${pair.closeBlocker ? badge('BLOCKER', 'danger') : badge('CLEAR', 'success')}</td>
                  </tr>
                `),
                empty: 'No related-party close pairs.'
              })
            : emptyState('No related-party close pairs', 'Related-party close readiness will appear here when applicable.')
        })
  ].filter(Boolean));

  return `
    ${pageHero({
      eyebrow: 'General ledger foundation',
      title: 'Journals workspace',
      description: 'Operate manual journals, review system-generated postings, inspect the trial balance, and monitor integrity issues from one finance-control workspace.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button><button class="button button--primary" data-action="open-journal-create">New journal</button>`,
      meta: `<span class="hero-meta-item">Posted ${summary.posted || 0}</span><span class="hero-meta-item">Pending ${summary.pendingApproval || 0}</span><span class="hero-meta-item">Integrity ${integrity.summary?.issueCount || 0}</span>`
    })}
    ${metricGrid([
      { label: 'Total journals', value: String(summary.total || 0), detail: 'All journal records in scope' },
      { label: 'Pending approval', value: String(summary.pendingApproval || 0), detail: 'Journals waiting for review' },
      { label: 'Posted', value: String(summary.posted || 0), detail: 'Posted accounting records' },
      { label: 'TB control', value: `${money(trialBalance.totals?.debit || 0, trialBalance.reportingCurrency || 'USD')} / ${money(trialBalance.totals?.credit || 0, trialBalance.reportingCurrency || 'USD')}`, detail: 'Debit and credit totals' },
      { label: 'Integrity issues', value: String(integrity.summary?.issueCount || 0), detail: 'Posting exceptions detected across workflows' }
    ])}
    ${filterMarkup}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
