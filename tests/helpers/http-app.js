import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function uniqueImportUrl(filePath) {
  return `${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function startIsolatedFinanceApp({ demoSeed = true, env = {} } = {}) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telerelation-finance-http-'));
  const dataDir = path.join(sandboxRoot, 'data');
  const evidenceDir = path.join(dataDir, 'evidence');
  const invoicesDir = path.join(sandboxRoot, 'invoices');
  const dbPath = path.join(dataDir, 'finance-db.json');

  const previousEnv = {
    TR_DISABLE_AUTOSTART: process.env.TR_DISABLE_AUTOSTART,
    TR_DATA_DIR: process.env.TR_DATA_DIR,
    TR_DB_PATH: process.env.TR_DB_PATH,
    TR_EVIDENCE_DIR: process.env.TR_EVIDENCE_DIR,
    TR_INVOICES_DIR: process.env.TR_INVOICES_DIR,
    TR_ENABLE_DEMO_SEED: process.env.TR_ENABLE_DEMO_SEED,
    TR_PERSISTENCE_MODE: process.env.TR_PERSISTENCE_MODE,
    TR_DATABASE_URL: process.env.TR_DATABASE_URL,
    TR_PSQL_BIN: process.env.TR_PSQL_BIN
  };

  process.env.TR_DISABLE_AUTOSTART = 'true';
  process.env.TR_DATA_DIR = dataDir;
  process.env.TR_DB_PATH = dbPath;
  process.env.TR_EVIDENCE_DIR = evidenceDir;
  process.env.TR_INVOICES_DIR = invoicesDir;
  process.env.TR_ENABLE_DEMO_SEED = demoSeed ? 'true' : 'false';
  Object.entries(env || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  });

  const modulePath = path.join(projectRoot, 'server', 'index.js');
  const mod = await import(uniqueImportUrl(modulePath));
  const server = mod.startServer({ host: '127.0.0.1', port: 0 });
  if (!server.listening) {
    await once(server, 'listening');
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    sandboxRoot,
    dataDir,
    dbPath,
    server,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  };
}

export async function jsonRequest(baseUrl, pathname, {
  method = 'GET',
  token = null,
  body = undefined,
  headers = {}
} = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: response.status,
    headers: response.headers,
    text,
    json
  };
}

export async function login(baseUrl, email, password) {
  const response = await jsonRequest(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status}`);
  }
  return response.json.token;
}
