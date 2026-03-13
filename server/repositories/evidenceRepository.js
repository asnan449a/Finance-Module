function ensureEvidence(db) {
  if (!Array.isArray(db.evidenceRecords)) db.evidenceRecords = [];
  return db.evidenceRecords;
}

export function listEvidence(db) {
  return ensureEvidence(db);
}

export function getEvidenceById(db, evidenceId) {
  return ensureEvidence(db).find((row) => row.id === evidenceId) || null;
}

export function listEvidenceByLink(db, { entityType, entityId, includeRemoved = false } = {}) {
  const targetType = String(entityType || '').toUpperCase();
  const targetId = String(entityId || '');
  return ensureEvidence(db)
    .filter((row) => String(row.entityType || '').toUpperCase() === targetType)
    .filter((row) => String(row.entityId || '') === targetId)
    .filter((row) => includeRemoved || String(row.status || 'ACTIVE').toUpperCase() !== 'REMOVED')
    .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
}

export function saveEvidence(db, record) {
  const rows = ensureEvidence(db);
  const index = rows.findIndex((row) => row.id === record.id);
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  return record;
}
