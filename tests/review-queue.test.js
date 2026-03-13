import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewQueue } from '../server/services/review-queue.js';

test('buildReviewQueue summarizes queue buckets and document types', () => {
  const payload = buildReviewQueue([
    {
      id: 'A',
      documentType: 'INVOICE',
      queueBucket: 'invoices',
      reference: 'INV-1001',
      subject: 'Client invoice',
      entity: 'US',
      amount: 2500,
      currency: 'USD',
      reviewState: 'PENDING_APPROVAL',
      approvalStatus: 'PENDING',
      evidenceReady: true,
      evidenceCount: 0,
      evidenceRequiredCount: 0,
      ageDays: 2,
      drawerRef: 'invoice:INV-1001'
    },
    {
      id: 'B',
      documentType: 'EXPENSE',
      queueBucket: 'spend',
      reference: 'EXP-2001',
      subject: 'Laptop purchase',
      entity: 'PK',
      amount: 125000,
      currency: 'PKR',
      reviewState: 'BLOCKED',
      approvalStatus: 'PENDING',
      evidenceReady: false,
      evidenceCount: 0,
      evidenceRequiredCount: 1,
      blockedReasons: ['Missing support (0 / 1).'],
      ageDays: 4,
      drawerRef: 'expense:EXP-2001'
    }
  ]);

  assert.equal(payload.summary.total, 2);
  assert.equal(payload.summary.blocked, 1);
  assert.equal(payload.summary.byBucket.invoices, 1);
  assert.equal(payload.summary.byBucket.spend, 1);
  assert.equal(payload.summary.byDocumentType.INVOICE, 1);
  assert.equal(payload.summary.byDocumentType.EXPENSE, 1);
});

test('buildReviewQueue prioritizes blocked close items ahead of normal pending work', () => {
  const payload = buildReviewQueue([
    {
      id: 'close',
      documentType: 'CLOSE_PERIOD',
      queueBucket: 'close',
      reference: '2026-03',
      subject: 'Month-end close',
      entity: '*',
      amount: 0,
      currency: 'USD',
      reviewState: 'BLOCKED',
      approvalStatus: 'OPEN',
      evidenceReady: false,
      evidenceCount: 0,
      evidenceRequiredCount: 1,
      blockedReasons: ['Close support evidence is attached'],
      ageDays: 1,
      drawerRef: 'period:2026-03'
    },
    {
      id: 'bill',
      documentType: 'VENDOR_BILL',
      queueBucket: 'bills',
      reference: 'BILL-10',
      subject: 'Vendor bill',
      entity: 'US',
      amount: 300,
      currency: 'USD',
      reviewState: 'PENDING_APPROVAL',
      approvalStatus: 'PENDING',
      evidenceReady: true,
      evidenceCount: 1,
      evidenceRequiredCount: 1,
      ageDays: 1,
      drawerRef: 'bill:BILL-10'
    }
  ]);

  assert.equal(payload.items[0].documentType, 'CLOSE_PERIOD');
  assert.equal(payload.items[0].priority, 'URGENT');
  assert.equal(payload.items[1].priority, 'NORMAL');
});

test('buildReviewQueue marks ready-to-settle and ready-to-post items as ready now', () => {
  const payload = buildReviewQueue([
    {
      id: 'R',
      documentType: 'REIMBURSEMENT',
      queueBucket: 'spend',
      reference: 'EXP-3001',
      subject: 'Employee claim',
      entity: 'PK',
      amount: 5500,
      currency: 'PKR',
      reviewState: 'READY_TO_SETTLE',
      approvalStatus: 'PENDING',
      evidenceReady: true,
      evidenceCount: 1,
      evidenceRequiredCount: 1,
      ageDays: 5,
      drawerRef: 'expense:EXP-3001'
    },
    {
      id: 'J',
      documentType: 'JOURNAL',
      queueBucket: 'journals',
      reference: 'JRN-0010',
      subject: 'Accrual entry',
      entity: 'UK',
      amount: 900,
      currency: 'GBP',
      reviewState: 'READY_TO_POST',
      approvalStatus: 'APPROVED',
      evidenceReady: true,
      evidenceCount: 0,
      evidenceRequiredCount: 0,
      ageDays: 2,
      drawerRef: 'journal:JRN-0010'
    }
  ]);

  assert.equal(payload.summary.readyNow, 2);
  assert.equal(payload.items[0].priority, 'HIGH');
});
