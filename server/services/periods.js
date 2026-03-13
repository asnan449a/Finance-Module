import { getClosedClosePeriod } from '../repositories/closePeriodRepository.js';

export function toPeriodKey(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date.slice(0, 7);
}

export function periodBounds(periodKey) {
  const key = String(periodKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const [year, month] = key.split('-').map(Number);
  const start = `${key}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function getLockedClosePeriod(db, periodKey) {
  return getClosedClosePeriod(db, periodKey);
}

export function periodLockError(db, dateValue) {
  const periodKey = toPeriodKey(dateValue);
  if (!periodKey) return null;
  const period = getLockedClosePeriod(db, periodKey);
  if (!period) return null;
  return `Period ${periodKey} is closed. Reopen it before posting new activity.`;
}

export function nextMonthPeriodKey(periodKey) {
  const bounds = periodBounds(periodKey);
  if (!bounds) return null;
  const base = new Date(`${bounds.start}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + 1);
  return base.toISOString().slice(0, 7);
}
