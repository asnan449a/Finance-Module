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
import { escapeHtml, money, shortDate } from '../utils/format.js';

const TAB_BUCKETS = ['all', 'invoices', 'bills', 'cash', 'spend', 'journals', 'close', 'blocked'];

function queueItems(state) {
  return state.data.approvals?.items || [];
}

function summary(state) {
  return state.data.approvals?.summary || { total: 0, blocked: 0, urgent: 0, pendingApproval: 0, readyNow: 0, byBucket: {}, byDocumentType: {} };
}

function approvalTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (['APPROVED', 'AUTO_APPROVED', 'POSTED', 'READY'].includes(normalized)) return 'success';
  if (['REJECTED', 'BLOCKED', 'ATTENTION_REQUIRED'].includes(normalized)) return 'danger';
  if (['PENDING', 'OPEN'].includes(normalized)) return 'warning';
  return 'neutral';
}

function priorityTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'URGENT') return 'danger';
  if (normalized === 'HIGH') return 'warning';
  return 'neutral';
}

function reviewTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (['READY_TO_CLOSE', 'READY_TO_POST', 'READY_TO_SETTLE', 'READY_TO_RELEASE'].includes(normalized)) return 'success';
  if (normalized === 'BLOCKED') return 'danger';
  return 'warning';
}

function filteredItems(state) {
  const filters = state.ui.filters.approvals || {};
  const tab = state.ui.activeTabs.approvals || 'all';
  const query = String(filters.query || '').trim().toLowerCase();
  const rows = queueItems(state).filter((item) => {
    if (tab !== 'all') {
      if (tab === 'blocked' && !item.isBlocked) return false;
      if (tab !== 'blocked' && String(item.queueBucket || '').toLowerCase() !== tab) return false;
    }
    if (filters.bucket && filters.bucket !== 'ALL' && String(item.queueBucket || '').toLowerCase() !== String(filters.bucket || '').toLowerCase()) return false;
    if (filters.documentType && filters.documentType !== 'ALL' && String(item.documentType || '').toUpperCase() !== String(filters.documentType || '').toUpperCase()) return false;
    if (filters.entity && String(item.entity || '').toUpperCase() !== String(filters.entity || '').toUpperCase()) return false;
    if (filters.priority && filters.priority !== 'ALL' && String(item.priority || '').toUpperCase() !== String(filters.priority || '').toUpperCase()) return false;
    if (filters.evidence === 'READY' && !item.evidenceReady) return false;
    if (filters.evidence === 'MISSING' && item.evidenceReady) return false;
    if (filters.approvalStatus && filters.approvalStatus !== 'ALL' && String(item.approvalStatus || '').toUpperCase() !== String(filters.approvalStatus || '').toUpperCase()) return false;
    if (filters.age === 'OVER_3' && Number(item.ageDays || 0) < 3) return false;
    if (filters.age === 'OVER_7' && Number(item.ageDays || 0) < 7) return false;
    if (filters.age === 'OVER_14' && Number(item.ageDays || 0) < 14) return false;
    if (!query) return true;
    const hay = [
      item.documentType,
      item.reference,
      item.subject,
      item.counterparty,
      item.entity,
      item.reviewState,
      ...(item.blockedReasons || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  });

  const sort = String(filters.sort || 'urgency').toLowerCase();
  return rows.sort((a, b) => {
    if (sort === 'amount') return Number(b.amount || 0) - Number(a.amount || 0);
    if (sort === 'age') return Number(b.ageDays || 0) - Number(a.ageDays || 0);
    if (sort === 'type') return String(a.documentType || '').localeCompare(String(b.documentType || ''));
    if (Number(b.priorityScore || 0) !== Number(a.priorityScore || 0)) return Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    if (Number(b.ageDays || 0) !== Number(a.ageDays || 0)) return Number(b.ageDays || 0) - Number(a.ageDays || 0);
    return Number(b.amount || 0) - Number(a.amount || 0);
  });
}

function tabCount(state, bucket) {
  const rows = queueItems(state);
  if (bucket === 'all') return rows.length;
  if (bucket === 'blocked') return rows.filter((item) => item.isBlocked).length;
  return rows.filter((item) => String(item.queueBucket || '').toLowerCase() === bucket).length;
}

function queueTable(rows) {
  return tableCard({
    title: 'Review queue',
    subtitle: 'Pending approvals, blocked reviews, and close-sensitive exceptions across finance workflows.',
    toolbar: `<span class="toolbar-count">${rows.length} items in current view</span>`,
    table: rows.length
      ? dataTable({
          columns: [
            { label: 'Queue' },
            { label: 'Record' },
            { label: 'Subject' },
            { label: 'Entity' },
            { label: 'Amount' },
            { label: 'Age' },
            { label: 'Review' },
            { label: 'Evidence' },
            { label: 'Accounting' },
            { label: 'Priority' },
            { label: 'Next' }
          ],
          rows: rows.map((item) => {
            const blocker = item.blockedReasons?.[0] || '';
            const queueLabel = String(item.queueBucket || 'queue').replace(/^\w/, (letter) => letter.toUpperCase());
            const entityLabel = item.entity === '*' ? 'Global' : (item.entity || '—');
            return `
              <tr data-open-drawer="${escapeHtml(item.drawerRef)}">
                <td>${badge(queueLabel, 'neutral')}</td>
                <td><strong>${escapeHtml(item.reference || item.id)}</strong><br/><span class="muted-copy">${escapeHtml(item.documentType || 'RECORD')}</span></td>
                <td><strong>${escapeHtml(item.subject || 'No subject')}</strong>${item.counterparty ? `<br/><span class="muted-copy">${escapeHtml(item.counterparty)}</span>` : ''}${blocker ? `<br/><span class="muted-copy">${escapeHtml(blocker)}</span>` : ''}</td>
                <td>${escapeHtml(entityLabel)}</td>
                <td>${money(item.amount || 0, item.currency || 'USD')}</td>
                <td>${item.ageDays || 0}d${item.dueDate ? `<br/><span class="muted-copy">${escapeHtml(shortDate(item.dueDate))}</span>` : ''}</td>
                <td>${badge(item.reviewState || 'ATTENTION_REQUIRED', reviewTone(item.reviewState))}</td>
                <td>${badge(item.evidenceReady ? `READY ${item.evidenceCount || 0}/${item.evidenceRequiredCount || 0}` : `MISSING ${item.evidenceCount || 0}/${item.evidenceRequiredCount || 0}`, item.evidenceReady ? 'success' : 'warning')}</td>
                <td>${badge(item.accountingStatus || 'UNKNOWN', approvalTone(item.accountingStatus))}</td>
                <td>${badge(item.priority || 'NORMAL', priorityTone(item.priority))}</td>
                <td><button class="button button--ghost" data-open-drawer="${escapeHtml(item.drawerRef)}">Review</button></td>
              </tr>
            `;
          }),
          empty: 'No review items match the current scope.'
        })
      : emptyState('Nothing is waiting for review', 'Change the queue filters or let operators continue working in module-specific workspaces until new approvals and exceptions arrive.', '<a class="button button--ghost" data-route-link="/billing" href="/billing">Open Billing</a>')
  });
}

function urgentItems(rows) {
  return rows.filter((item) => ['URGENT', 'HIGH'].includes(String(item.priority || '').toUpperCase())).slice(0, 6).map((item) => insightRow({
    title: item.reference || item.id,
    meta: `${item.subject || 'No subject'} · ${item.ageDays || 0}d old`,
    value: `${badge(item.priority, priorityTone(item.priority))}${item.isBlocked ? '<br/><span class="muted-copy">Blocked</span>' : ''}`,
    tone: item.priority === 'URGENT' ? 'danger' : 'warning'
  }));
}

function blockedItems(rows) {
  return rows.filter((item) => item.isBlocked).slice(0, 6).map((item) => insightRow({
    title: item.reference || item.id,
    meta: item.blockedReasons?.[0] || 'Needs review',
    value: `<span>${escapeHtml(item.documentType || 'RECORD')}</span>`,
    tone: 'warning'
  }));
}

export function renderApprovals(state) {
  const queueSummary = summary(state);
  const rows = filteredItems(state);
  const filters = state.ui.filters.approvals || {};
  const documentTypes = [...new Set(queueItems(state).map((item) => String(item.documentType || '').toUpperCase()).filter(Boolean))].sort();

  const tabs = workspaceTabs({
    scope: 'approvals',
    active: state.ui.activeTabs.approvals || 'all',
    items: [
      { value: 'all', label: 'All pending', count: tabCount(state, 'all') },
      { value: 'invoices', label: 'Invoices', count: tabCount(state, 'invoices') },
      { value: 'bills', label: 'Bills', count: tabCount(state, 'bills') },
      { value: 'cash', label: 'Cash', count: tabCount(state, 'cash') },
      { value: 'spend', label: 'Spend', count: tabCount(state, 'spend') },
      { value: 'journals', label: 'Journals', count: tabCount(state, 'journals') },
      { value: 'close', label: 'Close', count: tabCount(state, 'close') },
      { value: 'blocked', label: 'Blocked', count: tabCount(state, 'blocked') }
    ]
  });

  const filtersMarkup = filterBar(`
    <label><span>Search</span><input id="approvals_query" type="search" value="${escapeHtml(filters.query || '')}" placeholder="Record, subject, blocker, entity" /></label>
    <label><span>Document type</span>
      <select id="approvals_documentType">
        <option value="ALL">All document types</option>
        ${documentTypes.map((type) => `<option value="${type}" ${filters.documentType === type ? 'selected' : ''}>${type.replace(/_/g, ' ')}</option>`).join('')}
      </select>
    </label>
    <label><span>Entity</span>
      <select id="approvals_entity">
        <option value="">All entities</option>
        ${['US', 'UK', 'PK', '*'].map((entity) => `<option value="${entity}" ${filters.entity === entity ? 'selected' : ''}>${entity === '*' ? 'Global' : entity}</option>`).join('')}
      </select>
    </label>
    <label><span>Priority</span>
      <select id="approvals_priority">
        ${['ALL', 'URGENT', 'HIGH', 'NORMAL'].map((priority) => `<option value="${priority}" ${filters.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}
      </select>
    </label>
    <label><span>Evidence</span>
      <select id="approvals_evidence">
        <option value="ALL" ${filters.evidence === 'ALL' ? 'selected' : ''}>All evidence states</option>
        <option value="READY" ${filters.evidence === 'READY' ? 'selected' : ''}>Ready</option>
        <option value="MISSING" ${filters.evidence === 'MISSING' ? 'selected' : ''}>Missing / blocked</option>
      </select>
    </label>
    <label><span>Approval</span>
      <select id="approvals_approvalStatus">
        ${['ALL', 'OPEN', 'PENDING', 'APPROVED', 'AUTO_APPROVED', 'POSTED', 'REJECTED'].map((status) => `<option value="${status}" ${filters.approvalStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select>
    </label>
    <label><span>Age</span>
      <select id="approvals_age">
        <option value="ALL" ${filters.age === 'ALL' ? 'selected' : ''}>All ages</option>
        <option value="OVER_3" ${filters.age === 'OVER_3' ? 'selected' : ''}>3+ days</option>
        <option value="OVER_7" ${filters.age === 'OVER_7' ? 'selected' : ''}>7+ days</option>
        <option value="OVER_14" ${filters.age === 'OVER_14' ? 'selected' : ''}>14+ days</option>
      </select>
    </label>
    <label><span>Sort</span>
      <select id="approvals_sort">
        <option value="urgency" ${filters.sort === 'urgency' ? 'selected' : ''}>Urgency</option>
        <option value="age" ${filters.sort === 'age' ? 'selected' : ''}>Age</option>
        <option value="amount" ${filters.sort === 'amount' ? 'selected' : ''}>Amount</option>
        <option value="type" ${filters.sort === 'type' ? 'selected' : ''}>Type</option>
      </select>
    </label>
    <div class="filter-bar__actions">
      <button class="button button--ghost" data-action="apply-approvals-filters">Apply filters</button>
      <button class="button button--ghost" data-action="refresh-workspace">Refresh</button>
    </div>
  `);

  const chips = filterChips([
    { label: 'Document', value: filters.documentType },
    { label: 'Entity', value: filters.entity === '*' ? 'Global' : filters.entity },
    { label: 'Priority', value: filters.priority },
    { label: 'Evidence', value: filters.evidence },
    { label: 'Approval', value: filters.approvalStatus },
    { label: 'Age', value: filters.age },
    { label: 'Search', value: filters.query }
  ], 'All finance review items in scope');

  const side = sideStack([
    listCard({
      title: 'Review posture',
      subtitle: 'What finance reviewers should clear next.',
      items: [
        insightRow({ title: 'Pending review', meta: 'All queues', value: `<span>${queueSummary.total || 0}</span>` }),
        insightRow({ title: 'Blocked items', meta: 'Missing evidence or issue-driven', value: `<span>${queueSummary.blocked || 0}</span>`, tone: (queueSummary.blocked || 0) > 0 ? 'warning' : 'success' }),
        insightRow({ title: 'Urgent', meta: 'Age or close-sensitive priority', value: `<span>${queueSummary.urgent || 0}</span>`, tone: (queueSummary.urgent || 0) > 0 ? 'danger' : 'success' }),
        insightRow({ title: 'Ready now', meta: 'Can be settled, posted, or closed', value: `<span>${queueSummary.readyNow || 0}</span>` })
      ]
    }),
    callout({
      tone: (queueSummary.blocked || 0) > 0 ? 'warning' : 'success',
      title: (queueSummary.blocked || 0) > 0 ? `${queueSummary.blocked || 0} review items are blocked` : 'No review blockers in the queue',
      description: (queueSummary.blocked || 0) > 0 ? 'Open blocked items to see missing support, approval gaps, or accounting issues before actioning them.' : 'The current queue is clear of missing-support and blocked-state exceptions.'
    }),
    listCard({
      title: 'Urgent now',
      subtitle: 'High-priority items to review first.',
      items: urgentItems(rows),
      emptyTitle: 'No urgent items',
      emptyDescription: 'Nothing in the current filtered queue is marked urgent.'
    }),
    listCard({
      title: 'Blocked / missing',
      subtitle: 'Items held back by support gaps or workflow blockers.',
      items: blockedItems(rows),
      emptyTitle: 'No blocked items',
      emptyDescription: 'Current queue items are not blocked by missing support or control gaps.'
    })
  ]);

  return `
    ${pageHero({
      eyebrow: 'Reviewer operations',
      title: 'Approvals inbox',
      description: 'One finance-wide queue for review work across billing, payables, cash controls, spend, journals, and close-sensitive exceptions.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button>`,
      meta: `<span class="hero-meta-item">Pending ${queueSummary.total || 0}</span><span class="hero-meta-item">Blocked ${queueSummary.blocked || 0}</span><span class="hero-meta-item">Urgent ${queueSummary.urgent || 0}</span>`
    })}
    ${metricGrid([
      { label: 'Pending review', value: String(queueSummary.total || 0), detail: 'All queues in scope' },
      { label: 'Blocked', value: String(queueSummary.blocked || 0), detail: 'Missing support or unresolved blockers' },
      { label: 'Urgent', value: String(queueSummary.urgent || 0), detail: 'Age or close-sensitive priority' },
      { label: 'Ready now', value: String(queueSummary.readyNow || 0), detail: 'Actionable without more prep' }
    ])}
    ${filtersMarkup}
    ${chips}
    ${tabs}
    ${workspaceSplit({ main: queueTable(rows), side })}
  `;
}
