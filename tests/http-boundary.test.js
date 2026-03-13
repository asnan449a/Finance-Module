import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonRequest, login, startIsolatedFinanceApp } from './helpers/http-app.js';

const app = await startIsolatedFinanceApp();
test.after(async () => {
  await app.stop();
});
const accountantToken = await login(app.baseUrl, 'accountant@telerelation.local', 'account123');
const partnerToken = await login(app.baseUrl, 'partner@telerelation.local', 'partner123');
const viewerToken = await login(app.baseUrl, 'viewer@telerelation.local', 'viewer123');

test('seeded demo data exposes realistic finance workspaces over HTTP', async () => {
  const bootstrap = await jsonRequest(app.baseUrl, '/api/finance/bootstrap', {
    token: accountantToken
  });

  assert.equal(bootstrap.status, 200);
  assert.ok((bootstrap.json.clients || []).length >= 2);
  assert.ok((bootstrap.json.vendorBills || []).length >= 2);
  assert.ok((bootstrap.json.expenses || []).length >= 2);

  const invoices = await jsonRequest(app.baseUrl, '/api/invoices', { token: accountantToken });
  const payables = await jsonRequest(app.baseUrl, '/api/payables/bills', { token: accountantToken });
  const queue = await jsonRequest(app.baseUrl, '/api/reconciliation/queue', { token: accountantToken });

  assert.equal(invoices.status, 200);
  assert.ok((invoices.json.invoices || []).length >= 3);
  assert.equal(payables.status, 200);
  assert.ok((payables.json.bills || []).length >= 2);
  assert.equal(queue.status, 200);
  assert.ok(Number(queue.json.summary?.total || 0) >= 4);
});

test('finance HTTP boundaries enforce record-aware access and hide public invoice files', async () => {
  const billsResponse = await jsonRequest(app.baseUrl, '/api/payables/bills', { token: accountantToken });
  assert.equal(billsResponse.status, 200);
  const ukBill = (billsResponse.json.bills || []).find((row) => row.entity === 'UK');
  const usBill = (billsResponse.json.bills || []).find((row) => row.entity === 'US');
  assert.ok(ukBill);
  assert.ok(usBill);

  const ukEvidence = await jsonRequest(app.baseUrl, `/api/evidence?entityType=VENDOR_BILL&entityId=${ukBill.id}`, {
    token: accountantToken
  });
  assert.equal(ukEvidence.status, 200);
  assert.ok((ukEvidence.json.evidence || []).length >= 1);

  const partnerUkEvidence = await jsonRequest(app.baseUrl, `/api/evidence?entityType=VENDOR_BILL&entityId=${ukBill.id}`, {
    token: partnerToken
  });
  assert.equal(partnerUkEvidence.status, 403);

  const evidenceDownload = await fetch(`${app.baseUrl}/api/evidence/${ukEvidence.json.evidence[0].id}/download`, {
    headers: { Authorization: `Bearer ${accountantToken}` }
  });
  assert.equal(evidenceDownload.status, 200);

  const unauthorizedDownload = await fetch(`${app.baseUrl}/api/evidence/${ukEvidence.json.evidence[0].id}/download`, {
    headers: { Authorization: `Bearer ${partnerToken}` }
  });
  assert.equal(unauthorizedDownload.status, 403);

  const partnerBills = await jsonRequest(app.baseUrl, '/api/payables/bills', { token: partnerToken });
  assert.equal(partnerBills.status, 200);
  assert.ok((partnerBills.json.bills || []).every((row) => row.entity === 'US'));

  const viewerBills = await jsonRequest(app.baseUrl, '/api/payables/bills', { token: viewerToken });
  assert.equal(viewerBills.status, 403);

  const removalAttempt = await jsonRequest(app.baseUrl, `/api/evidence/${ukEvidence.json.evidence[0].id}`, {
    method: 'DELETE',
    token: accountantToken,
    body: { note: 'Should fail on protected record' }
  });
  assert.equal(removalAttempt.status, 409);

  const invoices = await jsonRequest(app.baseUrl, '/api/invoices', { token: accountantToken });
  const approvedInvoice = (invoices.json.invoices || []).find((row) => row.approvalStatus === 'APPROVED' && row.pdfUrl);
  assert.ok(approvedInvoice);

  const publicInvoicePath = new URL(approvedInvoice.pdfUrl, app.baseUrl);
  const publicResponse = await fetch(publicInvoicePath);
  assert.equal(publicResponse.status, 401);

  const secureDocument = await fetch(`${app.baseUrl}/api/invoices/${approvedInvoice.id}/document`, {
    headers: { Authorization: `Bearer ${accountantToken}` }
  });
  assert.equal(secureDocument.status, 200);
  assert.match(secureDocument.headers.get('content-type') || '', /text\/html/);
});

test('close and journal endpoints stay controlled with seeded demo data', async () => {
  const currentPeriodKey = new Date().toISOString().slice(0, 7);
  const closeAttempt = await jsonRequest(app.baseUrl, `/api/close/periods/${currentPeriodKey}/close`, {
    method: 'POST',
    token: accountantToken,
    body: {}
  });
  assert.equal(closeAttempt.status, 409);
  assert.match(closeAttempt.json.error || '', /close support|evidence|required/i);

  const journalsAccountant = await jsonRequest(app.baseUrl, '/api/journals', { token: accountantToken });
  assert.equal(journalsAccountant.status, 200);
  assert.ok((journalsAccountant.json.journals || []).length >= 3);
  assert.ok((journalsAccountant.json.journals || []).some((row) => row.entity === 'UK'));

  const journalsPartner = await jsonRequest(app.baseUrl, '/api/journals', { token: partnerToken });
  assert.equal(journalsPartner.status, 200);
  assert.ok((journalsPartner.json.journals || []).every((row) => !row.entity || row.entity === 'US'));

  const partnerApprovalQueue = await jsonRequest(app.baseUrl, '/api/approvals/queue', { token: partnerToken });
  assert.equal(partnerApprovalQueue.status, 200);
  assert.ok((partnerApprovalQueue.json.items || []).every((row) => !row.entity || row.entity === 'US'));
});
