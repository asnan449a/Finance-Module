import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, 'sql', '001_core_finance.sql');

const POSTGRES_BOOTSTRAP_KEY = 'core_finance_bootstrap_v1';

const DOMAIN_TABLES = {
  users: 'finance_users',
  approvalMatrixVersions: 'finance_approval_matrix_versions',
  approvalEvents: 'finance_approval_events',
  evidenceRecords: 'finance_evidence_records',
  journals: 'finance_journals',
  closePeriods: 'finance_close_periods'
};

let postgresReadyForUrl = null;

function enabled() {
  return String(process.env.TR_PERSISTENCE_MODE || 'json').toLowerCase() === 'postgres'
    && Boolean(process.env.TR_DATABASE_URL || process.env.DATABASE_URL || '');
}

function databaseUrl() {
  return process.env.TR_DATABASE_URL || process.env.DATABASE_URL || '';
}

function psqlBin() {
  return process.env.TR_PSQL_BIN || 'psql';
}

function sqlText(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlJsonLiteral(value) {
  const json = JSON.stringify(value ?? []);
  let tag = '$codex$';
  while (json.includes(tag.slice(1, -1))) {
    tag = `$codex_${Math.random().toString(36).slice(2)}$`;
  }
  return `${tag}${json}${tag}::jsonb`;
}

function runPsql(sql, { quiet = true } = {}) {
  if (!enabled()) return '';
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-At'];
  if (quiet) args.push('-q');
  args.push('-d', databaseUrl(), '-f', '-');
  return execFileSync(psqlBin(), args, {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

function loadJsonArray(sql, fallback = []) {
  const raw = runPsql(sql);
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function currentBootstrapMarker() {
  return runPsql(`SELECT COALESCE((SELECT value->>'seededAt' FROM finance_meta WHERE key = ${sqlText(POSTGRES_BOOTSTRAP_KEY)}), '');`);
}

function replaceDomainTable(db, domain) {
  const rows = Array.isArray(db?.[domain]) ? db[domain] : [];
  const payload = sqlJsonLiteral(rows);

  if (domain === 'users') {
    return `
DELETE FROM ${DOMAIN_TABLES.users};
INSERT INTO ${DOMAIN_TABLES.users} (id, email, role, allowed_entities, payload, updated_at)
SELECT
  item->>'id',
  lower(item->>'email'),
  upper(COALESCE(item->>'role', '')),
  COALESCE(item->'allowedEntities', '[]'::jsonb),
  item,
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamptz, NOW())
FROM jsonb_array_elements(${payload}) item;`;
  }

  if (domain === 'approvalMatrixVersions') {
    return `
DELETE FROM ${DOMAIN_TABLES.approvalMatrixVersions};
INSERT INTO ${DOMAIN_TABLES.approvalMatrixVersions} (id, version_number, effective_at, payload, updated_at)
SELECT
  item->>'id',
  COALESCE(NULLIF(item->>'versionNumber', '')::integer, 0),
  NULLIF(item->>'effectiveAt', '')::timestamptz,
  item,
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamptz, NOW())
FROM jsonb_array_elements(${payload}) item;`;
  }

  if (domain === 'approvalEvents') {
    return `
DELETE FROM ${DOMAIN_TABLES.approvalEvents};
INSERT INTO ${DOMAIN_TABLES.approvalEvents} (id, document_type, entity_type, entity_id, created_at, payload)
SELECT
  item->>'id',
  upper(COALESCE(item->>'documentType', '')),
  upper(COALESCE(item->>'entityType', '')),
  COALESCE(item->>'entityId', ''),
  COALESCE(NULLIF(item->>'createdAt', '')::timestamptz, NOW()),
  item
FROM jsonb_array_elements(${payload}) item;`;
  }

  if (domain === 'evidenceRecords') {
    return `
DELETE FROM ${DOMAIN_TABLES.evidenceRecords};
INSERT INTO ${DOMAIN_TABLES.evidenceRecords} (id, entity_type, entity_id, status, uploaded_at, payload, updated_at)
SELECT
  item->>'id',
  upper(COALESCE(item->>'entityType', '')),
  COALESCE(item->>'entityId', ''),
  upper(COALESCE(item->>'status', 'ACTIVE')),
  COALESCE(NULLIF(item->>'uploadedAt', '')::timestamptz, NOW()),
  item,
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamptz, NOW())
FROM jsonb_array_elements(${payload}) item;`;
  }

  if (domain === 'journals') {
    return `
DELETE FROM ${DOMAIN_TABLES.journals};
INSERT INTO ${DOMAIN_TABLES.journals} (
  id, journal_number, entity, status, posting_date, period_key, journal_type,
  source_type, source_id, source_root_type, source_root_id, consolidation_only,
  payload, updated_at
)
SELECT
  item->>'id',
  NULLIF(item->>'journalNumber', ''),
  NULLIF(item->>'entity', ''),
  upper(COALESCE(item->>'status', 'DRAFT')),
  NULLIF(item->>'postingDate', '')::date,
  NULLIF(item->>'periodKey', ''),
  NULLIF(item->>'journalType', ''),
  NULLIF(item->>'sourceType', ''),
  NULLIF(item->>'sourceId', ''),
  NULLIF(item->>'sourceRootType', ''),
  NULLIF(item->>'sourceRootId', ''),
  COALESCE((item->>'consolidationOnly')::boolean, false),
  item,
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamptz, NOW())
FROM jsonb_array_elements(${payload}) item;`;
  }

  if (domain === 'closePeriods') {
    return `
DELETE FROM ${DOMAIN_TABLES.closePeriods};
INSERT INTO ${DOMAIN_TABLES.closePeriods} (period_key, status, closed_at, payload, updated_at)
SELECT
  COALESCE(item->>'periodKey', item->>'id'),
  upper(COALESCE(item->>'status', 'OPEN')),
  NULLIF(item->>'closedAt', '')::timestamptz,
  item,
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamptz, NOW())
FROM jsonb_array_elements(${payload}) item;`;
  }

  throw new Error(`Unsupported PostgreSQL domain: ${domain}`);
}

function persistBootstrapMarker() {
  return `
INSERT INTO finance_meta (key, value, updated_at)
VALUES (
  ${sqlText(POSTGRES_BOOTSTRAP_KEY)},
  ${sqlJsonLiteral({ seededAt: new Date().toISOString(), domains: Object.keys(DOMAIN_TABLES) })},
  NOW()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;`;
}

function loadDomain(domain) {
  if (domain === 'users') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY lower(email)), '[]'::json) FROM ${DOMAIN_TABLES.users};`);
  }
  if (domain === 'approvalMatrixVersions') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY version_number ASC), '[]'::json) FROM ${DOMAIN_TABLES.approvalMatrixVersions};`);
  }
  if (domain === 'approvalEvents') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY created_at ASC), '[]'::json) FROM ${DOMAIN_TABLES.approvalEvents};`);
  }
  if (domain === 'evidenceRecords') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY uploaded_at DESC), '[]'::json) FROM ${DOMAIN_TABLES.evidenceRecords};`);
  }
  if (domain === 'journals') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY posting_date DESC NULLS LAST, journal_number ASC NULLS LAST), '[]'::json) FROM ${DOMAIN_TABLES.journals};`);
  }
  if (domain === 'closePeriods') {
    return loadJsonArray(`SELECT COALESCE(json_agg(payload ORDER BY period_key DESC), '[]'::json) FROM ${DOMAIN_TABLES.closePeriods};`);
  }
  throw new Error(`Unsupported PostgreSQL domain: ${domain}`);
}

export function postgresPersistenceEnabled() {
  return enabled();
}

export function postgresBackedDomains() {
  return Object.keys(DOMAIN_TABLES);
}

export function postgresPersistenceStatus() {
  return {
    mode: enabled() ? 'postgres' : 'json',
    databaseUrlConfigured: Boolean(databaseUrl()),
    domains: enabled() ? postgresBackedDomains() : []
  };
}

export function ensurePostgresReady(seedDb = null) {
  if (!enabled()) return false;
  if (!databaseUrl()) {
    throw new Error('TR_PERSISTENCE_MODE=postgres requires TR_DATABASE_URL or DATABASE_URL.');
  }
  if (postgresReadyForUrl !== databaseUrl()) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    runPsql(schemaSql, { quiet: false });
    postgresReadyForUrl = databaseUrl();
  }
  const bootstrapMarker = currentBootstrapMarker();
  if (!bootstrapMarker && seedDb) {
    persistMigratedDomainsToPostgres(seedDb, { markBootstrap: true });
  }
  return true;
}

export function persistMigratedDomainsToPostgres(db, { markBootstrap = false } = {}) {
  if (!enabled()) return false;
  ensurePostgresReady();
  const statements = ['BEGIN;'];
  for (const domain of postgresBackedDomains()) {
    statements.push(replaceDomainTable(db, domain));
  }
  if (markBootstrap) statements.push(persistBootstrapMarker());
  statements.push('COMMIT;');
  runPsql(statements.join('\n'), { quiet: false });
  return true;
}

export function hydrateMigratedDomainsFromPostgres(db) {
  if (!enabled()) return db;
  ensurePostgresReady(db);
  for (const domain of postgresBackedDomains()) {
    db[domain] = loadDomain(domain);
  }
  return db;
}
