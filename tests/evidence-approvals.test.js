import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceRecord, getEvidenceDescriptor, listLinkedEvidence, removeEvidenceRecord } from '../server/services/evidence.js';
import { buildApprovalSnapshot, listApprovalHistory, recordApprovalEvent, assertWorkflowAction } from '../server/services/approval-workflow.js';
import { assertApprovalAction } from '../server/services/approvals.js';
import { makeDb } from './helpers/finance-fixture.js';

function tempEvidenceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tr-finance-evidence-'));
}

test('evidence metadata can be created, retrieved, and removed without public file serving', async () => {
  const dir = tempEvidenceDir();
  try {
    const db = makeDb();
    const evidence = createEvidenceRecord(db, {
      entityType: 'VENDOR_BILL',
      entityId: 'BILL-100',
      fileName: 'vendor-invoice.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('fake vendor invoice').toString('base64'),
      note: 'Primary supplier invoice',
      category: 'SUPPORT'
    }, 'USR-2', { baseDir: dir });

    assert.equal(listLinkedEvidence(db, { entityType: 'VENDOR_BILL', entityId: 'BILL-100' }).length, 1);

    const descriptor = getEvidenceDescriptor(db, evidence.id);
    assert.equal(descriptor.record.fileName, 'vendor-invoice.pdf');
    assert.equal(fs.existsSync(descriptor.filePath), true);

    await new Promise((resolve, reject) => {
      descriptor.stream.once('error', reject);
      descriptor.stream.once('data', () => {
        descriptor.stream.destroy();
        resolve();
      });
    });

    const removed = removeEvidenceRecord(db, evidence.id, 'USR-1', 'Superseded by corrected vendor invoice');
    assert.equal(removed.status, 'REMOVED');
    assert.equal(removed.removalNote, 'Superseded by corrected vendor invoice');
    assert.throws(() => getEvidenceDescriptor(db, evidence.id), /Evidence not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow approvals block evidence-required actions until support exists', () => {
  const db = makeDb();

  const billBlocked = assertWorkflowAction(db, {
    documentType: 'VENDOR_BILL',
    entityType: 'VENDOR_BILL',
    entityId: 'BILL-200',
    action: 'APPROVE',
    entity: 'US',
    amount: 450,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1',
    createdByUserId: 'USR-2'
  });
  assert.match(billBlocked, /VENDOR_INVOICE, SUPPORT evidence/);

  db.evidenceRecords.push({
    id: 'EVD-1',
    entityType: 'VENDOR_BILL',
    entityId: 'BILL-200',
    fileName: 'bill.pdf',
    mimeType: 'application/pdf',
    fileSize: 128,
    uploadedByUserId: 'USR-2',
    uploadedAt: '2026-03-12T10:00:00Z',
    note: '',
    category: 'SUPPORT',
    status: 'ACTIVE',
    storagePath: '/tmp/fake-bill.pdf',
    createdAt: '2026-03-12T10:00:00Z',
    updatedAt: '2026-03-12T10:00:00Z'
  });

  assert.equal(assertWorkflowAction(db, {
    documentType: 'VENDOR_BILL',
    entityType: 'VENDOR_BILL',
    entityId: 'BILL-200',
    action: 'APPROVE',
    entity: 'US',
    amount: 450,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1',
    createdByUserId: 'USR-2'
  }), null);

  const reopenBlocked = assertWorkflowAction(db, {
    documentType: 'REOPEN_PERIOD',
    entityType: 'CLOSE_PERIOD',
    entityId: '2026-03',
    action: 'REOPEN',
    entity: '*',
    amount: 0,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1'
  });
  assert.match(reopenBlocked, /REOPEN_SUPPORT, CLOSE_SUPPORT evidence/);

  db.evidenceRecords.push({
    id: 'EVD-2',
    entityType: 'CLOSE_PERIOD',
    entityId: '2026-03',
    fileName: 'close-pack.pdf',
    mimeType: 'application/pdf',
    fileSize: 256,
    uploadedByUserId: 'USR-1',
    uploadedAt: '2026-03-31T23:00:00Z',
    note: 'Close pack support',
    category: 'CLOSE_SUPPORT',
    status: 'ACTIVE',
    storagePath: '/tmp/fake-close-pack.pdf',
    createdAt: '2026-03-31T23:00:00Z',
    updatedAt: '2026-03-31T23:00:00Z'
  });

  assert.equal(assertWorkflowAction(db, {
    documentType: 'REOPEN_PERIOD',
    entityType: 'CLOSE_PERIOD',
    entityId: '2026-03',
    action: 'REOPEN',
    entity: '*',
    amount: 0,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1'
  }), null);
});

test('approval matrix evaluates entity-aware thresholds for expenses', () => {
  const db = makeDb();

  assert.equal(assertApprovalAction(db, {
    documentType: 'EXPENSE',
    action: 'APPROVE',
    entity: 'PK',
    amount: 100000,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1',
    createdByUserId: 'USR-2',
    evidenceCount: 1
  }), null);

  assert.equal(assertApprovalAction(db, {
    documentType: 'EXPENSE',
    action: 'APPROVE',
    entity: 'PK',
    amount: 300000,
    actorRole: 'PARTNER',
    actorUserId: 'USR-1',
    createdByUserId: 'USR-2',
    evidenceCount: 1
  }), null);

  assert.equal(assertApprovalAction(db, {
    documentType: 'EXPENSE',
    action: 'APPROVE',
    entity: 'PK',
    amount: 300000,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-1',
    createdByUserId: 'USR-2',
    evidenceCount: 1
  }), 'Role ACCOUNTANT cannot approve expense.');
});

test('approval history snapshots carry evidence counts and policy context', () => {
  const db = makeDb({
    evidenceRecords: [
      {
        id: 'EVD-10',
        entityType: 'EXPENSE',
        entityId: 'EXP-1',
        fileName: 'receipt.png',
        mimeType: 'image/png',
        fileSize: 64,
        uploadedByUserId: 'USR-2',
        uploadedAt: '2026-03-12T10:00:00Z',
        note: 'Taxi receipt',
        category: 'RECEIPT',
        status: 'ACTIVE',
        storagePath: '/tmp/receipt.png',
        createdAt: '2026-03-12T10:00:00Z',
        updatedAt: '2026-03-12T10:00:00Z'
      }
    ]
  });

  recordApprovalEvent(db, {
    documentType: 'EXPENSE',
    entityType: 'EXPENSE',
    entityId: 'EXP-1',
    action: 'CREATED',
    actorUserId: 'USR-2',
    actorRole: 'ACCOUNTANT',
    entity: 'US',
    amount: 250,
    note: 'Created for review',
    statusAfter: 'PENDING'
  });
  recordApprovalEvent(db, {
    documentType: 'EXPENSE',
    entityType: 'EXPENSE',
    entityId: 'EXP-1',
    action: 'APPROVED',
    actorUserId: 'USR-1',
    actorRole: 'ADMIN',
    entity: 'US',
    amount: 250,
    note: 'Receipt reviewed',
    statusAfter: 'APPROVED'
  });

  const history = listApprovalHistory(db, { entityType: 'EXPENSE', entityId: 'EXP-1' });
  assert.equal(history.length, 2);
  assert.equal(history[1].evidenceCount, 1);

  const snapshot = buildApprovalSnapshot(db, {
    documentType: 'EXPENSE',
    entityType: 'EXPENSE',
    entityId: 'EXP-1',
    entity: 'US',
    amount: 250,
    operationalStatus: 'PENDING_REIMBURSEMENT',
    approvalStatus: 'APPROVED',
    createdByUserId: 'USR-2',
    approvedByUserId: 'USR-1'
  });

  assert.equal(snapshot.evidenceCount, 1);
  assert.equal(snapshot.evidenceSatisfied, true);
  assert.equal(snapshot.policy.minEvidenceCount, 1);
  assert.deepEqual(snapshot.policy.approverRoles, ['ADMIN', 'ACCOUNTANT']);
  assert.equal(snapshot.history.length, 2);
});
