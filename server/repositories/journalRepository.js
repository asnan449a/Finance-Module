function collection(db) {
  if (!Array.isArray(db.journals)) db.journals = [];
  return db.journals;
}

export function listJournals(db, filters = {}) {
  let rows = [...collection(db)];
  if (filters.status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(filters.status).toUpperCase());
  if (filters.excludeStatuses?.length) {
    const blocked = new Set(filters.excludeStatuses.map((value) => String(value || '').toUpperCase()));
    rows = rows.filter((row) => !blocked.has(String(row.status || '').toUpperCase()));
  }
  if (filters.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(filters.entity).toUpperCase());
  if (filters.sourceType) rows = rows.filter((row) => String(row.sourceType || '').toUpperCase() === String(filters.sourceType).toUpperCase());
  if (filters.journalType) rows = rows.filter((row) => String(row.journalType || '').toUpperCase() === String(filters.journalType).toUpperCase());
  if (filters.periodKey) rows = rows.filter((row) => String(row.periodKey || '') === String(filters.periodKey || ''));
  if (filters.eliminationKey) rows = rows.filter((row) => String(row.eliminationKey || '') === String(filters.eliminationKey || ''));
  if (filters.cleanupKey) rows = rows.filter((row) => String(row.cleanupKey || '') === String(filters.cleanupKey || ''));
  if (filters.consolidationOnly !== undefined) rows = rows.filter((row) => Boolean(row.consolidationOnly) === Boolean(filters.consolidationOnly));
  if (filters.fromDate) rows = rows.filter((row) => String(row.postingDate || '') >= String(filters.fromDate));
  if (filters.toDate) rows = rows.filter((row) => String(row.postingDate || '') <= String(filters.toDate));
  rows.sort((a, b) => `${b.postingDate || ''} ${b.journalNumber || ''}`.localeCompare(`${a.postingDate || ''} ${a.journalNumber || ''}`));
  return rows;
}

export function getJournalById(db, journalId) {
  return collection(db).find((row) => row.id === journalId) || null;
}

export function findJournalBySource(db, { sourceType, sourceId, journalType = null }) {
  return collection(db).find((row) => {
    if (String(row.sourceType || '').toUpperCase() !== String(sourceType || '').toUpperCase()) return false;
    if (String(row.sourceId || '') !== String(sourceId || '')) return false;
    if (journalType && String(row.journalType || '').toUpperCase() !== String(journalType).toUpperCase()) return false;
    return true;
  }) || null;
}

export function listJournalsBySource(db, { sourceType, sourceId, journalType = null, excludeStatuses = [] } = {}) {
  const blocked = new Set((excludeStatuses || []).map((value) => String(value || '').toUpperCase()));
  return collection(db)
    .filter((row) => {
      if (String(row.sourceType || '').toUpperCase() !== String(sourceType || '').toUpperCase()) return false;
      if (String(row.sourceId || '') !== String(sourceId || '')) return false;
      if (journalType && String(row.journalType || '').toUpperCase() !== String(journalType).toUpperCase()) return false;
      if (blocked.size && blocked.has(String(row.status || '').toUpperCase())) return false;
      return true;
    })
    .sort((a, b) => `${a.postingDate || ''} ${a.journalNumber || ''}`.localeCompare(`${b.postingDate || ''} ${b.journalNumber || ''}`));
}

export function findActiveJournalByMeta(db, {
  sourceType = null,
  journalType = null,
  periodKey = null,
  eliminationKey = null,
  cleanupKey = null
} = {}) {
  const rows = listJournals(db, {
    sourceType,
    journalType,
    periodKey,
    eliminationKey,
    cleanupKey,
    excludeStatuses: ['VOID']
  });
  return rows.find((row) => !row.reversedByJournalId && String(row.status || '').toUpperCase() !== 'REVERSED') || null;
}

export function listJournalsBySourceRoot(db, { sourceRootType, sourceRootId }) {
  return collection(db).filter((row) => {
    if (String(row.sourceRootType || row.sourceType || '').toUpperCase() !== String(sourceRootType || '').toUpperCase()) return false;
    if (String(row.sourceRootId || row.sourceId || '') !== String(sourceRootId || '')) return false;
    return true;
  }).sort((a, b) => `${a.postingDate || ''} ${a.journalNumber || ''}`.localeCompare(`${b.postingDate || ''} ${b.journalNumber || ''}`));
}

export function saveJournal(db, journal) {
  const rows = collection(db);
  const index = rows.findIndex((row) => row.id === journal.id);
  if (index === -1) rows.push(journal);
  else rows[index] = journal;
  return journal;
}

export function postedJournals(db, filters = {}) {
  const rows = listJournals(db, filters);
  return rows.filter((row) => ['POSTED', 'REVERSED'].includes(String(row.status || '').toUpperCase()));
}
