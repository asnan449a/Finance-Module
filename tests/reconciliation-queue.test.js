import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './helpers/finance-fixture.js';
import {
  applyReconciliationReviewDecision,
  buildImportedReconciliationSummary,
  buildReconciliationQueue,
  eligibleForBulkAction,
  findQuickMatchCandidate,
  summarizeBulkEligibility
} from '../server/services/reconciliation-queue.js';

test('reconciliation queue classifies high-confidence matches, duplicates, and remittance gaps', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-1', name: 'Wise GBP Main', entity: 'UK', currency: 'GBP', accountRole: 'BANK', status: 'ACTIVE', showInBankingHub: true }
    ],
    invoices: [
      {
        id: 'INV-1',
        invoiceNumber: 'INV-1001',
        clientName: 'Alpha Capital',
        entity: 'UK',
        currency: 'GBP',
        total: 2000,
        amountPaid: 0,
        status: 'SENT',
        dueDate: '2026-03-18'
      }
    ],
    transactions: [
      {
        id: 'TX-1',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 2000,
        description: 'Alpha Capital remittance INV-1001',
        reference: 'INV-1001',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-2',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 1750,
        description: 'Unknown receipt',
        reference: 'DUP-REF-1',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-3',
        date: '2026-03-21',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 850,
        description: 'Payment',
        reference: '',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-4',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 1750,
        description: 'Unknown receipt',
        reference: 'DUP-REF-1',
        matchedAmount: 0,
        reconciled: false
      }
    ]
  });

  const queue = buildReconciliationQueue(db);
  const quickMatch = queue.items.find((row) => row.transactionId === 'TX-1');
  const duplicate = queue.items.find((row) => row.transactionId === 'TX-2');
  const remittanceGap = queue.items.find((row) => row.transactionId === 'TX-3');

  assert.equal(quickMatch.quickMatchAvailable, true);
  assert.equal(quickMatch.queueBucket, 'suggested');
  assert.equal(duplicate.queueBucket, 'duplicates');
  assert.equal(duplicate.duplicateSuspect, true);
  assert.equal(remittanceGap.queueBucket, 'exceptions');
  assert.equal(remittanceGap.needsRemittance, true);
  assert.equal(queue.summary.duplicates, 2);
  assert.equal(queue.summary.needsRemittance, 1);
});

test('findQuickMatchCandidate returns only high-confidence cash application rows', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-1', name: 'Wise GBP Main', entity: 'UK', currency: 'GBP', accountRole: 'BANK', status: 'ACTIVE' }
    ],
    invoices: [
      {
        id: 'INV-1',
        invoiceNumber: 'INV-1001',
        clientName: 'Alpha Capital',
        entity: 'UK',
        currency: 'GBP',
        total: 2000,
        amountPaid: 0,
        status: 'SENT',
        dueDate: '2026-03-18'
      }
    ],
    transactions: [
      {
        id: 'TX-1',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 2000,
        description: 'Alpha Capital remittance INV-1001',
        reference: 'INV-1001',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-2',
        date: '2026-03-22',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 1500,
        description: 'Payment',
        reference: '',
        matchedAmount: 0,
        reconciled: false
      }
    ]
  });

  const candidate = findQuickMatchCandidate(db, 'TX-1');
  assert.equal(candidate.invoiceId, 'INV-1');
  assert.equal(candidate.amount, 2000);

  const none = findQuickMatchCandidate(db, 'TX-2');
  assert.equal(none, null);
});

test('imported reconciliation summary exposes duplicate and manual review counts', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-1', name: 'Meezan Main PKR', entity: 'PK', currency: 'PKR', accountRole: 'BANK', status: 'ACTIVE' }
    ],
    transactions: [
      {
        id: 'TX-1',
        date: '2026-03-12',
        sourceAccountId: 'ACC-1',
        entity: 'PK',
        currency: 'PKR',
        amount: 450000,
        description: 'Client receipt',
        reference: 'ABC-1',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-2',
        date: '2026-03-12',
        sourceAccountId: 'ACC-1',
        entity: 'PK',
        currency: 'PKR',
        amount: 450000,
        description: 'Client receipt',
        reference: 'ABC-1',
        matchedAmount: 0,
        reconciled: false
      }
    ]
  });

  const summary = buildImportedReconciliationSummary(db, ['TX-1', 'TX-2']);
  assert.equal(summary.imported, 2);
  assert.equal(summary.duplicateSuspects, 2);
  assert.equal(summary.suggestedMatches, 0);
  assert.equal(summary.manualReview, 0);
});

test('reconciliation queue surfaces follow-up and deferred review states explicitly', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-1', name: 'BoFA Operating USD', entity: 'US', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE', showInBankingHub: true }
    ],
    users: [
      { id: 'USR-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN' },
      { id: 'USR-2', name: 'Accountant User', email: 'accountant@example.com', role: 'ACCOUNTANT' }
    ],
    transactions: [
      {
        id: 'TX-1',
        date: '2026-03-20',
        sourceAccountId: 'ACC-1',
        entity: 'US',
        currency: 'USD',
        amount: 1200,
        description: 'Receipt needs backup',
        reference: '',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-2',
        date: '2026-03-20',
        sourceAccountId: 'ACC-1',
        entity: 'US',
        currency: 'USD',
        amount: 700,
        description: 'Hold until customer replies',
        reference: 'FOLLOW-1',
        matchedAmount: 0,
        reconciled: false
      }
    ]
  });

  applyReconciliationReviewDecision(db.transactions[0], {
    decision: 'FOLLOW_UP_REQUIRED',
    note: 'Ask client for remittance advice.',
    category: 'CUSTOMER_FOLLOW_UP',
    followUpOwnerUserId: 'USR-2'
  }, { sub: 'USR-1', role: 'ADMIN' });

  applyReconciliationReviewDecision(db.transactions[1], {
    decision: 'DEFERRED',
    note: 'Wait until Friday bank confirmation.',
    category: 'DEFERRED',
    deferredUntil: '2026-03-28',
    followUpOwnerUserId: 'USR-2'
  }, { sub: 'USR-1', role: 'ADMIN' });

  const queue = buildReconciliationQueue(db);
  const followUp = queue.items.find((row) => row.transactionId === 'TX-1');
  const deferred = queue.items.find((row) => row.transactionId === 'TX-2');

  assert.equal(followUp.reviewState, 'FOLLOW_UP_REQUIRED');
  assert.equal(followUp.queueBucket, 'exceptions');
  assert.equal(followUp.followUpOwnerName, 'Accountant User');
  assert.equal(deferred.reviewState, 'DEFERRED');
  assert.equal(deferred.queueBucket, 'deferred');
  assert.equal(deferred.deferredUntil, '2026-03-28');
});

test('bulk eligibility only permits low-risk reconciliation actions', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-1', name: 'Wise GBP Main', entity: 'UK', currency: 'GBP', accountRole: 'BANK', status: 'ACTIVE' }
    ],
    invoices: [
      {
        id: 'INV-1',
        invoiceNumber: 'INV-2001',
        clientName: 'Zenith LLP',
        entity: 'UK',
        currency: 'GBP',
        total: 1900,
        amountPaid: 0,
        status: 'SENT',
        dueDate: '2026-03-18'
      }
    ],
    transactions: [
      {
        id: 'TX-1',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 1900,
        description: 'Zenith LLP remittance INV-2001',
        reference: 'INV-2001',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-2',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 900,
        description: 'Duplicate candidate',
        reference: 'DUP-900',
        matchedAmount: 0,
        reconciled: false
      },
      {
        id: 'TX-3',
        date: '2026-03-19',
        sourceAccountId: 'ACC-1',
        entity: 'UK',
        currency: 'GBP',
        amount: 900,
        description: 'Duplicate candidate',
        reference: 'DUP-900',
        matchedAmount: 0,
        reconciled: false
      }
    ]
  });

  const queue = buildReconciliationQueue(db);
  const quick = queue.items.find((row) => row.transactionId === 'TX-1');
  const duplicate = queue.items.find((row) => row.transactionId === 'TX-2');

  assert.equal(eligibleForBulkAction(quick, 'QUICK_MATCH'), true);
  assert.equal(eligibleForBulkAction(duplicate, 'IGNORE_DUPLICATE'), true);
  assert.equal(eligibleForBulkAction(duplicate, 'QUICK_MATCH'), false);

  const summary = summarizeBulkEligibility(queue, 'IGNORE_DUPLICATE', ['TX-1', 'TX-2']);
  assert.equal(summary.eligibleCount, 1);
  assert.equal(summary.ineligibleCount, 1);
});
