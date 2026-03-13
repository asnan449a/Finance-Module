function collection(db) {
  if (!Array.isArray(db.closePeriods)) db.closePeriods = [];
  return db.closePeriods;
}

export function listClosePeriods(db) {
  return [...collection(db)];
}

export function getClosePeriodByKey(db, periodKey) {
  return collection(db).find((row) => row.periodKey === periodKey) || null;
}

export function getClosedClosePeriod(db, periodKey) {
  return collection(db).find((row) => row.periodKey === periodKey && String(row.status || '').toUpperCase() === 'CLOSED') || null;
}

export function saveClosePeriod(db, period) {
  const rows = collection(db);
  const index = rows.findIndex((row) => row.periodKey === period.periodKey);
  if (index === -1) rows.push(period);
  else rows[index] = period;
  return period;
}

