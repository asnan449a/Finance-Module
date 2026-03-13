import { escapeHtml, badgeTone, money } from '../utils/format.js';

export function badge(label, tone = null) {
  const finalTone = tone || badgeTone(label);
  return `<span class="status-badge status-badge--${finalTone}">${escapeHtml(label)}</span>`;
}

export function panel({ title, subtitle = '', body = '', actions = '' }) {
  return `
    <section class="panel-card">
      <div class="panel-card__head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${actions ? `<div class="panel-card__actions">${actions}</div>` : ''}
      </div>
      <div class="panel-card__body">${body}</div>
    </section>
  `;
}

export function workspaceTabs({ scope, active, items }) {
  return `
    <div class="workspace-tabs" role="tablist" aria-label="${escapeHtml(scope)} tabs">
      ${items.map((item) => `
        <button class="workspace-tab ${active === item.value ? 'is-active' : ''}" data-tab-scope="${scope}" data-tab-value="${item.value}">
          <span>${escapeHtml(item.label)}</span>
          ${item.count != null ? `<strong>${escapeHtml(String(item.count))}</strong>` : ''}
        </button>
      `).join('')}
    </div>
  `;
}

export function metricGrid(items) {
  return `
    <div class="metric-grid">
      ${items.map((item) => `
        <article class="metric-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.value}</strong>
          ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}
        </article>
      `).join('')}
    </div>
  `;
}

export function filterBar(content) {
  return `<div class="filter-bar">${content}</div>`;
}

export function filterChips(items = [], emptyLabel = 'All records in scope') {
  const active = (items || []).filter((item) => item && item.value != null && item.value !== '' && item.value !== 'ALL');
  if (!active.length) {
    return `<div class="filter-chip-bar"><span class="filter-chip filter-chip--muted">${escapeHtml(emptyLabel)}</span></div>`;
  }
  return `
    <div class="filter-chip-bar">
      ${active.map((item) => `<span class="filter-chip">${escapeHtml(item.label)}: <strong>${escapeHtml(String(item.value))}</strong></span>`).join('')}
    </div>
  `;
}

export function emptyState(title, description, action = '', eyebrow = 'No data') {
  return `
    <div class="empty-state">
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${action ? `<div class="empty-state__action">${action}</div>` : ''}
    </div>
  `;
}

export function callout({ tone = 'neutral', title, description, action = '' }) {
  return `
    <div class="callout callout--${tone}">
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
      ${action ? `<div class="callout__action">${action}</div>` : ''}
    </div>
  `;
}

export function tableCard({ title, subtitle = '', toolbar = '', table, footnote = '', flush = false }) {
  return `
    <section class="table-card ${flush ? 'table-card--flush' : ''}">
      <div class="table-card__head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${toolbar ? `<div class="table-card__toolbar">${toolbar}</div>` : ''}
      </div>
      <div class="table-card__body">${table}</div>
      ${footnote ? `<div class="table-card__footnote">${footnote}</div>` : ''}
    </section>
  `;
}

export function dataTable({ columns, rows, empty }) {
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>${columns.map((column) => `<th class="${column.className || ''}">${escapeHtml(column.label)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.length ? rows.join('') : `<tr><td colspan="${columns.length}" class="data-table__empty">${empty}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

export function workspaceSplit({ main, side = '', sideSticky = true }) {
  return `
    <div class="workspace-split">
      <div class="workspace-split__main">${main}</div>
      <aside class="workspace-split__side ${sideSticky ? 'is-sticky' : ''}">${side}</aside>
    </div>
  `;
}

export function sideStack(items = []) {
  return `<div class="workspace-side-stack">${items.join('')}</div>`;
}

export function listCard({ title, subtitle = '', items = [], emptyTitle = 'Nothing to review', emptyDescription = 'No items in this queue right now.', action = '' }) {
  const body = items.length
    ? `<div class="insight-list">${items.join('')}</div>`
    : emptyState(emptyTitle, emptyDescription, action, 'Queue');
  return panel({ title, subtitle, body });
}

export function insightRow({ title, meta = '', value = '', tone = 'neutral', action = '' }) {
  return `
    <div class="insight-row insight-row--${tone}">
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
      </div>
      <div class="insight-row__value">
        ${value}
        ${action || ''}
      </div>
    </div>
  `;
}

export function statementCard({ title, subtitle = '', rows = [], currency = 'USD', footnote = '' }) {
  const rowMarkup = rows.length
    ? rows.map((row) => {
        const classes = [
          'statement-row',
          row.kind ? `statement-row--${row.kind}` : '',
          row.drilldownId ? 'is-clickable' : ''
        ].filter(Boolean).join(' ');
        const attrs = row.drilldownId ? ` data-action="report-drilldown" data-id="${escapeHtml(row.drilldownId)}"` : '';
        const value = typeof row.value === 'string' ? row.value : money(row.value || 0, row.currency || currency);
        return `
          <tr class="${classes}"${attrs}>
            <td>
              <div class="statement-row__label ${row.indent ? 'is-indented' : ''}">
                <strong>${escapeHtml(row.label)}</strong>
                ${row.note ? `<span>${escapeHtml(row.note)}</span>` : ''}
              </div>
            </td>
            <td>${value}</td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="2" class="data-table__empty">No statement lines available.</td></tr>`;

  return `
    <section class="statement-card">
      <div class="statement-card__head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <span class="statement-card__currency">${escapeHtml(currency)}</span>
      </div>
      <div class="statement-card__body">
        <div class="data-table-wrap">
          <table class="statement-table">
            <thead>
              <tr><th>Line item</th><th>Amount</th></tr>
            </thead>
            <tbody>${rowMarkup}</tbody>
          </table>
        </div>
        ${footnote ? `<div class="statement-card__footnote">${footnote}</div>` : ''}
      </div>
    </section>
  `;
}
