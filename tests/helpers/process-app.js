import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function pickPort() {
  return 47000 + Math.floor(Math.random() * 1000);
}

async function waitForServer(baseUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for finance server at ${baseUrl}`);
}

export async function startProcessFinanceApp({ demoSeed = true, env = {} } = {}) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telerelation-finance-proc-'));
  const dataDir = path.join(sandboxRoot, 'data');
  const evidenceDir = path.join(dataDir, 'evidence');
  const invoicesDir = path.join(sandboxRoot, 'invoices');
  const dbPath = path.join(dataDir, 'finance-db.json');
  const port = pickPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn('node', ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_BASE_URL: baseUrl,
      TR_DATA_DIR: dataDir,
      TR_DB_PATH: dbPath,
      TR_EVIDENCE_DIR: evidenceDir,
      TR_INVOICES_DIR: invoicesDir,
      TR_ENABLE_DEMO_SEED: demoSeed ? 'true' : 'false',
      ...Object.fromEntries(Object.entries(env || {}).map(([key, value]) => [key, String(value)]))
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk || '');
  });
  const exitPromise = new Promise((_, reject) => {
    child.once('exit', (code) => {
      const detail = [stderr, stdout].filter(Boolean).join('\n').trim();
      reject(new Error(detail || `Finance server exited before becoming ready (code ${code ?? 'unknown'}).`));
    });
  });
  await Promise.race([waitForServer(baseUrl, 15000), exitPromise]);

  return {
    baseUrl,
    sandboxRoot,
    dataDir,
    dbPath,
    child,
    async stop() {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 3000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    },
    get stderr() {
      return [stderr, stdout].filter(Boolean).join('\n');
    }
  };
}
