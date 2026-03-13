function collection(db) {
  if (!Array.isArray(db.intercompanyEntries)) db.intercompanyEntries = [];
  return db.intercompanyEntries;
}

export function listIntercompanyEntries(db, filters = {}) {
  let rows = [...collection(db)];
  if (filters.statuses?.length) {
    const allowed = new Set(filters.statuses.map((value) => String(value || '').toUpperCase()));
    rows = rows.filter((row) => allowed.has(String(row.status || '').toUpperCase()));
  }
  if (filters.excludeStatuses?.length) {
    const blocked = new Set(filters.excludeStatuses.map((value) => String(value || '').toUpperCase()));
    rows = rows.filter((row) => !blocked.has(String(row.status || '').toUpperCase()));
  }
  if (filters.asOfDate) {
    rows = rows.filter((row) => String(row.date || '') <= String(filters.asOfDate));
  }
  if (filters.entity) {
    const entity = String(filters.entity || '').toUpperCase();
    rows = rows.filter((row) => {
      return String(row.fromEntity || '').toUpperCase() === entity || String(row.toEntity || '').toUpperCase() === entity;
    });
  }
  rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return rows;
}

export function getIntercompanyEntryById(db, entryId) {
  return collection(db).find((row) => row.id === entryId) || null;
}

export function saveIntercompanyEntry(db, entry) {
  const rows = collection(db);
  const index = rows.findIndex((row) => row.id === entry.id);
  if (index === -1) rows.push(entry);
  else rows[index] = entry;
  return entry;
}

export function findIntercompanyRepaymentEventById(db, eventId) {
  for (const entry of collection(db)) {
    const event = (entry.repaymentEvents || []).find((row) => row.id === eventId);
    if (event) return { entry, event };
  }
  return null;
}
