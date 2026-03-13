export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rowOrDash(value) {
  return value == null || value === '' ? '—' : value;
}

export function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

export function number(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

export function shortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function badgeTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (['PAID', 'SYNCED', 'APPROVED', 'ACTIVE', 'SENT', 'CONNECTED', 'PASS', 'READY', 'OPEN'].includes(normalized)) return 'success';
  if (['PARTIAL', 'PENDING_APPROVAL', 'PENDING', 'OVERDUE', 'WARN', 'DRAFT', 'QUEUED'].includes(normalized)) return 'warning';
  if (['REJECTED', 'FAILED', 'FAIL', 'INACTIVE', 'CLOSED', 'ERROR'].includes(normalized)) return 'danger';
  return 'neutral';
}

export function percentage(value, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

export function toCsv(rows, headers) {
  const escape = (value) => {
    const text = String(value == null ? '' : value);
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const head = headers.join(',');
  const body = rows.map((row) => headers.map((key) => escape(row[key])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

export function downloadCsv(name, rows, headers) {
  const blob = new Blob([toCsv(rows, headers)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
