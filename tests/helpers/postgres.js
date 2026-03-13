import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const POSTGRES_BIN_DIR = '/opt/homebrew/opt/postgresql@16/bin';
const CREATEDB_BIN = process.env.TR_CREATEDB_BIN || path.join(POSTGRES_BIN_DIR, 'createdb');
const DROPDB_BIN = process.env.TR_DROPDB_BIN || path.join(POSTGRES_BIN_DIR, 'dropdb');
const PSQL_BIN = process.env.TR_PSQL_BIN || path.join(POSTGRES_BIN_DIR, 'psql');
const PG_HOST = process.env.TR_TEST_DATABASE_HOST || '127.0.0.1';
const PG_PORT = Number(process.env.TR_TEST_DATABASE_PORT || 5432);
const PG_USER = process.env.TR_TEST_DATABASE_USER || 'postgres';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
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

function randomDatabaseName() {
  return `telerelation_finance_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function assertServerAvailable() {
  await run(PSQL_BIN, ['-h', PG_HOST, '-p', String(PG_PORT), '-U', PG_USER, '-d', 'postgres', '-c', 'SELECT 1;']);
}

export async function startTempPostgres() {
  for (const bin of [CREATEDB_BIN, DROPDB_BIN, PSQL_BIN]) {
    if (!fs.existsSync(bin)) {
      throw new Error(`Missing PostgreSQL binary: ${bin}`);
    }
  }

  await assertServerAvailable();
  const databaseName = randomDatabaseName();
  await run(CREATEDB_BIN, ['-h', PG_HOST, '-p', String(PG_PORT), '-U', PG_USER, databaseName]);

  return {
    databaseName,
    psqlBin: PSQL_BIN,
    databaseUrl: `postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${databaseName}`,
    async stop() {
      await run(DROPDB_BIN, ['-h', PG_HOST, '-p', String(PG_PORT), '-U', PG_USER, '--if-exists', databaseName]);
    }
  };
}
