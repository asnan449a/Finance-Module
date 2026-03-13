import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveJournal,
  createManualJournal,
  getJournalDetail,
  postJournal,
  reverseJournal,
  submitJournal,
  upsertSystemJournalFromSource
} from '../server/services/journals.js';
import { buildTrialBalance } from '../server/services/statements.js';
import { makeDb } from './helpers/finance-fixture.js';

function accountant(id = 'USR-2') {
  return { id, role: 'ACCOUNTANT' };
}

function admin(id = 'USR-1') {
  return { id, role: 'ADMIN' };
}

test('manual journals move through draft, approval, post, and reversal workflow', () => {
  const db = makeDb();

  const journal = createManualJournal(db, {
    postingDate: '2026-03-10',
    entity: 'US',
    currency: 'USD',
    journalType: 'ADJUSTMENT',
    memo: 'Accrual true-up',
    lines: [
      { globalAccountCode: '5000', description: 'Accrual expense', debit: 250, credit: 0 },
      { globalAccountCode: '2000', description: 'Accrual payable', debit: 0, credit: 250 }
    ]
  }, 'USR-2');

  assert.equal(journal.status, 'DRAFT');
  assert.equal(journal.balanced, true);
  assert.equal(journal.journalType, 'ADJUSTMENT');
  assert.equal(journal.journalNumber, 'JRN-00101');

  const submitted = submitJournal(db, journal.id, 'USR-2');
  assert.equal(submitted.status, 'PENDING_APPROVAL');

  const approved = approveJournal(db, journal.id, admin());
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.approvedByUserId, 'USR-1');

  const posted = postJournal(db, journal.id, accountant());
  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.postedByUserId, 'USR-2');

  const reversal = reverseJournal(db, journal.id, admin(), {
    postingDate: '2026-03-11',
    memo: 'Reverse accrual'
  });

  assert.equal(reversal.original.status, 'REVERSED');
  assert.equal(reversal.reversal.status, 'POSTED');
  assert.equal(reversal.reversal.reversalOfJournalId, journal.id);
  assert.equal(reversal.original.reversedByJournalId, reversal.reversal.id);

  const hydratedOriginal = getJournalDetail(db, journal.id);
  assert.equal(hydratedOriginal.status, 'REVERSED');

  const trialBalance = buildTrialBalance(db, { asOfDate: '2026-03-31' });
  const opexRow = trialBalance.rows.find((row) => row.code === '5000');
  const apRow = trialBalance.rows.find((row) => row.code === '2000');

  assert.equal(opexRow.net, 0);
  assert.equal(apRow.net, 0);
});

test('journal creation rejects unbalanced lines', () => {
  const db = makeDb();

  assert.throws(() => {
    createManualJournal(db, {
      postingDate: '2026-03-12',
      entity: 'US',
      currency: 'USD',
      lines: [
        { globalAccountCode: '1000', debit: 100, credit: 0 },
        { globalAccountCode: '4000', debit: 0, credit: 90 }
      ]
    }, 'USR-2');
  }, /Journal is not balanced/);
});

test('system journal posting protects against duplicates and preserves source lineage', () => {
  const db = makeDb({
    invoices: [
      {
        id: 'INV-1',
        invoiceNumber: 'INV-0001',
        entity: 'US',
        currency: 'USD',
        issueDate: '2026-03-12',
        status: 'SENT',
        total: 500,
        createdByUserId: 'USR-2',
        approvedByUserId: 'USR-1'
      }
    ],
    payments: [
      {
        id: 'PAY-1',
        invoiceId: 'INV-1',
        amount: 500,
        currency: 'USD',
        paidAt: '2026-03-13',
        source: 'MANUAL',
        reference: 'WIRE-001',
        createdByUserId: 'USR-2'
      }
    ]
  });

  const firstInvoiceJournal = upsertSystemJournalFromSource(db, { sourceType: 'INVOICE', sourceId: 'INV-1', actorUserId: 'USR-2' });
  const secondInvoiceJournal = upsertSystemJournalFromSource(db, { sourceType: 'INVOICE', sourceId: 'INV-1', actorUserId: 'USR-2' });
  const paymentJournal = upsertSystemJournalFromSource(db, { sourceType: 'INVOICE_PAYMENT', sourceId: 'PAY-1', actorUserId: 'USR-2' });
  upsertSystemJournalFromSource(db, { sourceType: 'INVOICE_PAYMENT', sourceId: 'PAY-1', actorUserId: 'USR-2' });

  assert.equal(firstInvoiceJournal.id, secondInvoiceJournal.id);
  assert.equal(db.journals.filter((row) => row.sourceType === 'INVOICE' && row.sourceId === 'INV-1').length, 1);
  assert.equal(db.journals.filter((row) => row.sourceType === 'INVOICE_PAYMENT' && row.sourceId === 'PAY-1').length, 1);

  const detail = getJournalDetail(db, paymentJournal.id);
  assert.equal(detail.sourceLinkage.sourceRootType, 'INVOICE');
  assert.equal(detail.sourceLinkage.sourceRootId, 'INV-1');
  assert.equal(detail.sourceLinkage.sourceStage, 'CASH_APPLICATION');
  assert.equal(detail.relatedJournals.length, 1);
});
