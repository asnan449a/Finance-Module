function ensureUsers(db) {
  if (!Array.isArray(db.users)) db.users = [];
  return db.users;
}

export function listUsers(db) {
  return ensureUsers(db);
}

export function findUserById(db, userId) {
  return ensureUsers(db).find((row) => String(row.id || '') === String(userId || '')) || null;
}

export function findUserByEmail(db, email) {
  const target = String(email || '').trim().toLowerCase();
  return ensureUsers(db).find((row) => String(row.email || '').trim().toLowerCase() === target) || null;
}

export function saveUser(db, record) {
  const rows = ensureUsers(db);
  const index = rows.findIndex((row) => String(row.id || '') === String(record.id || ''));
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  return record;
}
