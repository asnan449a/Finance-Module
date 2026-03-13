function ensureApprovalEvents(db) {
  if (!Array.isArray(db.approvalEvents)) db.approvalEvents = [];
  return db.approvalEvents;
}

export function listApprovalEvents(db) {
  return ensureApprovalEvents(db);
}

export function listApprovalEventsByLink(db, { entityType, entityId } = {}) {
  const targetType = String(entityType || '').toUpperCase();
  const targetId = String(entityId || '');
  return ensureApprovalEvents(db)
    .filter((row) => String(row.entityType || '').toUpperCase() === targetType)
    .filter((row) => String(row.entityId || '') === targetId)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function saveApprovalEvent(db, record) {
  const rows = ensureApprovalEvents(db);
  const index = rows.findIndex((row) => row.id === record.id);
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  return record;
}
