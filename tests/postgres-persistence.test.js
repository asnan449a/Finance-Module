import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { startTempPostgres } from './helpers/postgres.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telerelation-finance-pg-app-'));
const dataDir = path.join(sandboxRoot, 'data');
const evidenceDir = path.join(dataDir, 'evidence');
const invoicesDir = path.join(sandboxRoot, 'invoices');
const dbPath = path.join(dataDir, 'finance-db.json');
const pgInstance = await startTempPostgres();

const baseEnv = {
  ...process.env,
  TR_PERSISTENCE_MODE: 'postgres',
  TR_DATABASE_URL: pgInstance.databaseUrl,
  TR_PSQL_BIN: pgInstance.psqlBin,
  TR_DATA_DIR: dataDir,
  TR_DB_PATH: dbPath,
  TR_EVIDENCE_DIR: evidenceDir,
  TR_INVOICES_DIR: invoicesDir,
  TR_ENABLE_DEMO_SEED: 'true'
};

function runNode(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile('node', args, {
      cwd: projectRoot,
      env: { ...baseEnv, ...extraEnv },
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function queryCount(tableName) {
  const client = new Client({ connectionString: pgInstance.databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
    return Number(result.rows[0]?.count || 0);
  } finally {
    await client.end();
  }
}

test.after(async () => {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  await pgInstance.stop();
});

test('postgres bootstrap migrates core finance domains and reports persistence status', async () => {
  const bootstrap = await runNode(['scripts/postgres-bootstrap.js']);
  const parsed = JSON.parse(bootstrap.stdout || '{}');

  assert.equal(parsed.persistence?.mode, 'postgres');
  assert.ok((parsed.persistence?.domains || []).includes('users'));
  assert.ok(parsed.counts?.users >= 6);
  assert.ok(parsed.counts?.journals >= 1);
  assert.ok(parsed.counts?.closePeriods >= 1);

  assert.ok(await queryCount('finance_users') >= 6);
  assert.ok(await queryCount('finance_approval_matrix_versions') >= 1);
  assert.ok(await queryCount('finance_approval_events') >= 1);
  assert.ok(await queryCount('finance_evidence_records') >= 1);
  assert.ok(await queryCount('finance_journals') >= 1);
  assert.ok(await queryCount('finance_close_periods') >= 1);
});

test('postgres-backed domains remain authoritative when JSON shadow copies are cleared', async () => {
  await runNode(['scripts/postgres-bootstrap.js']);

  const shadow = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  shadow.users = [];
  shadow.approvalMatrixVersions = [];
  shadow.approvalEvents = [];
  shadow.evidenceRecords = [];
  shadow.journals = [];
  shadow.closePeriods = [];
  fs.writeFileSync(dbPath, JSON.stringify(shadow, null, 2), 'utf8');

  const projection = await runNode(['-e', `
    const { readDb } = await import('./server/store.js');
    const { loginWithPassword } = await import('./server/auth.js');
    const db = readDb();
    const login = await loginWithPassword('accountant@telerelation.local', 'account123');
    process.stdout.write(JSON.stringify({
      users: db.users.length,
      approvalMatrixVersions: db.approvalMatrixVersions.length,
      approvalEvents: db.approvalEvents.length,
      evidenceRecords: db.evidenceRecords.length,
      journals: db.journals.length,
      closePeriods: db.closePeriods.length,
      loginUser: login.user.email,
      persistenceMode: db.metadata?.persistence?.mode || null
    }));
  `]);
  const parsed = JSON.parse(projection.stdout || '{}');

  assert.ok(parsed.users >= 6);
  assert.ok(parsed.approvalMatrixVersions >= 1);
  assert.ok(parsed.approvalEvents >= 1);
  assert.ok(parsed.evidenceRecords >= 1);
  assert.ok(parsed.journals >= 1);
  assert.ok(parsed.closePeriods >= 1);
  assert.equal(parsed.loginUser, 'accountant@telerelation.local');
  assert.equal(parsed.persistenceMode, 'postgres');
});
