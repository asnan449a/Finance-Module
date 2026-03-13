import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonRequest, login, startIsolatedFinanceApp } from './helpers/http-app.js';

const app = await startIsolatedFinanceApp();
test.after(async () => {
  await app.stop();
});
const accountantToken = await login(app.baseUrl, 'accountant@telerelation.local', 'account123');

test('browser shell routes and critical workspace assets load', async () => {
  const shellPaths = [
    '/',
    '/control-tower',
    '/billing',
    '/payables',
    '/banking',
    '/approvals',
    '/close',
    '/reports',
    '/journals',
    '/admin'
  ];

  for (const pathname of shellPaths) {
    const response = await fetch(`${app.baseUrl}${pathname}`);
    assert.equal(response.status, 200, `Expected shell route ${pathname} to load`);
    const html = await response.text();
    assert.match(html, /<div id="app"><\/div>/, `Expected app root for ${pathname}`);
  }

  const assetPaths = [
    '/app.js',
    '/js/app.js',
    '/js/pages/banking.js',
    '/js/pages/reports.js',
    '/js/pages/approvals.js',
    '/js/pages/close.js'
  ];

  for (const pathname of assetPaths) {
    const response = await fetch(`${app.baseUrl}${pathname}`);
    assert.equal(response.status, 200, `Expected asset ${pathname} to load`);
  }
});

test('critical operator APIs load coherently for browser-facing workflows', async () => {
  const endpoints = [
    '/api/finance/bootstrap',
    '/api/approvals/queue',
    '/api/reconciliation/queue',
    '/api/payables/bills',
    '/api/invoices',
    '/api/journals',
    '/api/close/periods?months=3',
    '/api/reports/balance-sheet',
    '/api/reports/pl'
  ];

  for (const endpoint of endpoints) {
    const response = await jsonRequest(app.baseUrl, endpoint, { token: accountantToken });
    assert.equal(response.status, 200, `Expected ${endpoint} to return 200`);
  }
});
