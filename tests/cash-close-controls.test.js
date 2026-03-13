import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEvidenceRecord, listLinkedEvidence } from '../server/services/evidence.js';
import { assertWorkflowAction, recordApprovalEvent, listApprovalHistory } from '../server/services/approval-workflow.js';
import { listApprovalMatrixVersions, upsertApprovalMatrixVersion } from '../server/services/approval-matrix.js';
import { assertEvidenceAccess, assertEvidenceMutationAllowed, buildEvidenceControlState } from '../server/services/record-access.js';
import { makeDb } from './helpers/finance-fixture.js';

function tempEvidenceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tr-finance-control-'));
}

test('protected finance records block evidence removal while unprotected records support supersede lineage', () => {
  const dir = tempEvidenceDir();
  try {
    const db = makeDb({
      vendorBills: [{
        id: 'BILL-1',
        entity: 'US',
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        total: 1200,
        payments: []
      }],
      expenses: [{
        id: 'EXP-1',
        entity: 'US',
        status: 'PENDING_REIMBURSEMENT',
        approvalStatus: 'PENDING',
        reimbursementStatus: 'PENDING',
        amount: 120,
        currency: 'USD',
        description: 'Taxi'
      }]
    });

    createEvidenceRecord(db, {
      entityType: 'VENDOR_BILL',
      entityId: 'BILL-1',
      fileName: 'bill.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('bill support').toString('base64'),
      category: 'VENDOR_INVOICE'
    }, 'USR-2', { baseDir: dir });

    assert.throws(
      () => assertEvidenceMutationAllowed(db, { id: 'USR-1', role: 'ADMIN' }, { entityType: 'VENDOR_BILL', entityId: 'BILL-1' }),
      /approved or settled/i
    );
    const billControl = buildEvidenceControlState(db, { entityType: 'VENDOR_BILL', entityId: 'BILL-1' });
    assert.equal(billControl.removalAllowed, false);

    const first = createEvidenceRecord(db, {
      entityType: 'EXPENSE',
      entityId: 'EXP-1',
      fileName: 'receipt-1.png',
      mimeType: 'image/png',
      contentBase64: Buffer.from('old receipt').toString('base64'),
      category: 'RECEIPT'
    }, 'USR-2', { baseDir: dir });

    const second = createEvidenceRecord(db, {
      entityType: 'EXPENSE',
      entityId: 'EXP-1',
      fileName: 'receipt-2.png',
      mimeType: 'image/png',
      contentBase64: Buffer.from('new receipt').toString('base64'),
      category: 'RECEIPT',
      supersedesEvidenceId: first.id
    }, 'USR-2', { baseDir: dir });

    const rows = listLinkedEvidence(db, { entityType: 'EXPENSE', entityId: 'EXP-1' });
    const superseded = rows.find((row) => row.id === first.id);
    const active = rows.find((row) => row.id === second.id);
    assert.equal(superseded.status, 'SUPERSEDED');
    assert.equal(superseded.supersededByEvidenceId, second.id);
    assert.equal(active.supersedesEvidenceId, first.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record-level evidence authorization respects linked record visibility', () => {
  const db = makeDb({
    projects: [
      { id: 'PRJ-1', entity: 'US', projectManagerId: 'USR-4' },
      { id: 'PRJ-2', entity: 'US', projectManagerId: 'USR-99' }
    ],
    invoices: [
      { id: 'INV-1', entity: 'US', projectId: 'PRJ-1', createdByUserId: 'USR-2' },
      { id: 'INV-2', entity: 'US', projectId: 'PRJ-2', createdByUserId: 'USR-2' }
    ],
    vendorBills: [
      { id: 'BILL-2', entity: 'US', status: 'DRAFT', approvalStatus: 'PENDING', total: 500, payments: [] }
    ]
  });

  const pm = { id: 'USR-4', role: 'PROJECT_MANAGER' };
  assert.doesNotThrow(() => assertEvidenceAccess(db, pm, { entityType: 'INVOICE', entityId: 'INV-1', mode: 'read' }));
  assert.throws(() => assertEvidenceAccess(db, pm, { entityType: 'INVOICE', entityId: 'INV-2', mode: 'read' }), /denied/i);
  assert.throws(() => assertEvidenceAccess(db, pm, { entityType: 'VENDOR_BILL', entityId: 'BILL-2', mode: 'read' }), /denied/i);
});

test('customer receipts and vendor payments enforce explicit evidence and threshold policies', () => {
  const db = makeDb();

  const receiptBlocked = assertWorkflowAction(db, {
    documentType: 'CUSTOMER_RECEIPT',
    entityType: 'CUSTOMER_RECEIPT',
    entityId: 'PENDING:INV-10',
    action: 'POST',
    entity: 'US',
    amount: 2500,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: []
  });
  assert.match(receiptBlocked, /BANK_PROOF, REMITTANCE, PAYMENT_SUPPORT evidence/i);

  assert.equal(assertWorkflowAction(db, {
    documentType: 'CUSTOMER_RECEIPT',
    entityType: 'CUSTOMER_RECEIPT',
    entityId: 'PENDING:INV-10',
    action: 'POST',
    entity: 'US',
    amount: 2500,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: [{ category: 'BANK_PROOF' }]
  }), null);

  assert.match(assertWorkflowAction(db, {
    documentType: 'CUSTOMER_RECEIPT',
    entityType: 'CUSTOMER_RECEIPT',
    entityId: 'PENDING:INV-10',
    action: 'POST',
    entity: 'US',
    amount: 9000,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: [{ category: 'BANK_PROOF' }]
  }), /Role ACCOUNTANT cannot post customer_receipt/i);

  assert.equal(assertWorkflowAction(db, {
    documentType: 'VENDOR_PAYMENT',
    entityType: 'VENDOR_PAYMENT',
    entityId: 'PENDING:BILL-9',
    action: 'POST',
    entity: 'PK',
    amount: 4000,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: [{ category: 'BANK_PROOF' }]
  }), null);
});

test('close actions require evidence-backed signoff and approval matrix versions preserve history', () => {
  const db = makeDb();

  const closeBlocked = assertWorkflowAction(db, {
    documentType: 'CLOSE_PERIOD',
    entityType: 'CLOSE_PERIOD',
    entityId: '2026-03',
    action: 'APPROVE',
    entity: '*',
    amount: 0,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: []
  });
  assert.match(closeBlocked, /CLOSE_SUPPORT, CLOSE_MEMO evidence/i);

  assert.equal(assertWorkflowAction(db, {
    documentType: 'CLOSE_PERIOD',
    entityType: 'CLOSE_PERIOD',
    entityId: '2026-03',
    action: 'APPROVE',
    entity: '*',
    amount: 0,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    pendingEvidence: [{ category: 'CLOSE_MEMO' }]
  }), null);

  recordApprovalEvent(db, {
    documentType: 'VENDOR_BILL',
    entityType: 'VENDOR_BILL',
    entityId: 'BILL-100',
    action: 'APPROVED',
    actorUserId: 'USR-1',
    actorRole: 'ADMIN',
    entity: 'US',
    amount: 2500,
    statusAfter: 'APPROVED'
  });

  const upgradedRules = makeDb().settings.approvalMatrix.rules.map((rule) => (
    rule.documentType === 'VENDOR_BILL'
      ? { ...rule, minEvidenceCount: 2 }
      : rule
  ));
  const change = upsertApprovalMatrixVersion(db, {
    rules: upgradedRules,
    actorUserId: 'USR-1',
    reason: 'Tighten AP evidence requirements'
  });
  assert.equal(change.changed, true);
  const versions = listApprovalMatrixVersions(db);
  assert.equal(versions[0].isActive, true);
  assert.equal(versions[0].versionNumber, 2);

  recordApprovalEvent(db, {
    documentType: 'VENDOR_BILL',
    entityType: 'VENDOR_BILL',
    entityId: 'BILL-101',
    action: 'APPROVED',
    actorUserId: 'USR-1',
    actorRole: 'ADMIN',
    entity: 'US',
    amount: 2500,
    statusAfter: 'APPROVED'
  });

  const history100 = listApprovalHistory(db, { entityType: 'VENDOR_BILL', entityId: 'BILL-100' });
  const history101 = listApprovalHistory(db, { entityType: 'VENDOR_BILL', entityId: 'BILL-101' });
  assert.equal(history100[0].policySnapshot.versionNumber, 1);
  assert.equal(history101[0].policySnapshot.versionNumber, 2);
});

test('legacy seeded approval matrices auto-upgrade into hardened cash and close policies', () => {
  const db = makeDb();
  db.approvalMatrixVersions = [{
    id: 'AMV-0001',
    versionNumber: 1,
    status: 'ACTIVE',
    effectiveAt: '2026-03-01T00:00:00.000Z',
    changedByUserId: null,
    changeReason: 'Seed default approval policy',
    rules: db.settings.approvalMatrix.rules
      .filter((rule) => !['CUSTOMER_RECEIPT', 'VENDOR_PAYMENT'].includes(rule.documentType))
      .map((rule) => (
        rule.documentType === 'CLOSE_PERIOD'
          ? { ...rule, minEvidenceCount: 0, evidenceRequiredActions: [], requiredEvidenceCategories: [] }
          : rule
      ))
  }];
  db.settings.activeApprovalMatrixVersionId = 'AMV-0001';
  db.settings.approvalMatrix = { rules: db.approvalMatrixVersions[0].rules };

  const versions = listApprovalMatrixVersions(db);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].versionNumber, 2);
  assert.equal(versions[0].changeReason, 'Baseline control hardening migration');
  assert.ok(versions[0].rules.some((rule) => rule.documentType === 'CUSTOMER_RECEIPT'));
  assert.ok(versions[0].rules.some((rule) => rule.documentType === 'VENDOR_PAYMENT'));
  const closeRule = versions[0].rules.find((rule) => rule.documentType === 'CLOSE_PERIOD');
  assert.equal(closeRule.minEvidenceCount, 1);
  assert.deepEqual(closeRule.requiredEvidenceCategories, ['CLOSE_SUPPORT', 'CLOSE_MEMO']);
});
