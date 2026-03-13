function ensureApprovalMatrixVersions(db) {
  if (!Array.isArray(db.approvalMatrixVersions)) db.approvalMatrixVersions = [];
  return db.approvalMatrixVersions;
}

export function listApprovalMatrixVersionRecords(db) {
  return ensureApprovalMatrixVersions(db);
}

export function getApprovalMatrixVersionById(db, versionId) {
  return ensureApprovalMatrixVersions(db).find((row) => String(row.id || '') === String(versionId || '')) || null;
}

export function saveApprovalMatrixVersion(db, record) {
  const rows = ensureApprovalMatrixVersions(db);
  const index = rows.findIndex((row) => String(row.id || '') === String(record.id || ''));
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  return record;
}
