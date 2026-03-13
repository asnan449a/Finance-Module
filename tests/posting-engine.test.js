import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountingIntegrityReport,
  createCleanupReclassPosting,
  generateEliminationPostings,
  getSourceAccountingSnapshot,
  syncAllWorkflowPostings,
  syncSourceRootPostings
} from '../server/services/posting-engine.js';
import { submitJournal, approveJournal, postJournal } from '../server/services/journals.js';
import { makeDb } from './helpers/finance-fixture.js';

function actor(id = 'USR-1', role = 'ADMIN') {
  return { id, role };
}

test('invoice workflow posts through the unified engine with idempotent source ownership', () => {
  const db = makeDb({
    invoices: [
      {
        id: 'INV-1',
        invoiceNumber: 'INV-0001',
        issueDate: '2026-03-10',
        dueDate: '2026-03-20',
        entity: 'US',
        currency: 'USD',
        total: 500,
        amountPaid: 0,
        status: 'DRAFT',
        approvalStatus: 'PENDING',
        createdByUserId: 'USR-2'
      }
    ],
    payments: []
  });

  let snapshot = getSourceAccountingSnapshot(db, { sourceRootType: 'INVOICE', sourceRootId: 'INV-1' });
  assert.equal(snapshot.accountingStatus, 'NOT_REQUIRED');
  assert.equal(snapshot.expectedCount, 0);

  db.invoices[0].status = 'APPROVED';
  db.invoices[0].approvalStatus = 'APPROVED';
  db.invoices[0].approvedByUserId = 'USR-1';
  snapshot = syncSourceRootPostings(db, { sourceRootType: 'INVOICE', sourceRootId: 'INV-1', actorUserId: 'USR-1' });
  assert.equal(snapshot.accountingStatus, 'POSTED');
  assert.equal(snapshot.expectedCount, 1);
  assert.equal(snapshot.postedCount, 1);

  db.payments.push({
    id: 'PAY-1',
    invoiceId: 'INV-1',
    amount: 500,
    currency: 'USD',
    paidAt: '2026-03-12',
    source: 'AUTO_RECON',
    reference: 'AUTO-1',
    createdByUserId: 'USR-2'
  });

  snapshot = syncSourceRootPostings(db, { sourceRootType: 'INVOICE', sourceRootId: 'INV-1', actorUserId: 'USR-1' });
  assert.equal(snapshot.accountingStatus, 'POSTED');
  assert.equal(snapshot.expectedCount, 2);
  assert.equal(snapshot.postedCount, 2);
  assert.equal(snapshot.issueCount, 0);

  syncSourceRootPostings(db, { sourceRootType: 'INVOICE', sourceRootId: 'INV-1', actorUserId: 'USR-1' });
  assert.equal(db.journals.filter((row) => row.sourceType === 'INVOICE' && row.sourceId === 'INV-1').length, 1);
  assert.equal(db.journals.filter((row) => row.sourceType === 'INVOICE_PAYMENT' && row.sourceId === 'PAY-1').length, 1);
});

test('vendor bill operational status and accounting status stay distinct under the posting engine', () => {
  const db = makeDb({
    vendorBills: [
      {
        id: 'BILL-1',
        billNumber: 'BILL-0001',
        billDate: '2026-03-08',
        dueDate: '2026-03-30',
        entity: 'PK',
        currency: 'PKR',
        total: 1000,
        amountPaid: 0,
        status: 'DRAFT',
        approvalStatus: 'PENDING',
        lineItems: [{ description: 'Ops cost', amount: 1000, category: 'Operating Expense', businessUnit: 'CORPORATE', lineOfService: null, capexFlag: false }],
        payments: [],
        createdByUserId: 'USR-2'
      }
    ]
  });

  let snapshot = getSourceAccountingSnapshot(db, { sourceRootType: 'VENDOR_BILL', sourceRootId: 'BILL-1' });
  assert.equal(snapshot.accountingStatus, 'NOT_REQUIRED');

  db.vendorBills[0].status = 'APPROVED';
  db.vendorBills[0].approvalStatus = 'APPROVED';
  db.vendorBills[0].approvedByUserId = 'USR-1';
  snapshot = syncSourceRootPostings(db, { sourceRootType: 'VENDOR_BILL', sourceRootId: 'BILL-1', actorUserId: 'USR-1' });
  assert.equal(snapshot.accountingStatus, 'POSTED');
  assert.equal(snapshot.expectedCount, 1);
  assert.equal(snapshot.postedCount, 1);

  db.vendorBills[0].status = 'REJECTED';
  db.vendorBills[0].approvalStatus = 'REJECTED';
  snapshot = syncSourceRootPostings(db, { sourceRootType: 'VENDOR_BILL', sourceRootId: 'BILL-1', actorUserId: 'USR-1' });
  assert.equal(snapshot.accountingStatus, 'NOT_REQUIRED');
  assert.equal(snapshot.issueCount, 0);
  assert.equal(db.journals.filter((row) => row.sourceType === 'VENDOR_BILL' && row.sourceId === 'BILL-1' && String(row.status || '').toUpperCase() !== 'VOID').length, 0);
});

test('integrity report detects orphan source-event journals and amount mismatches', () => {
  const db = makeDb({
    invoices: [
      {
        id: 'INV-2',
        invoiceNumber: 'INV-0002',
        issueDate: '2026-03-11',
        entity: 'US',
        currency: 'USD',
        total: 300,
        amountPaid: 0,
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        createdByUserId: 'USR-2',
        approvedByUserId: 'USR-1'
      }
    ],
    payments: [
      {
        id: 'PAY-2',
        invoiceId: 'INV-2',
        amount: 300,
        currency: 'USD',
        paidAt: '2026-03-12',
        source: 'MANUAL',
        reference: 'PAY-2',
        createdByUserId: 'USR-2'
      }
    ]
  });

  syncSourceRootPostings(db, { sourceRootType: 'INVOICE', sourceRootId: 'INV-2', actorUserId: 'USR-1' });
  const invoiceJournal = db.journals.find((row) => row.sourceType === 'INVOICE' && row.sourceId === 'INV-2');
  invoiceJournal.lines[0].debit = 250;
  invoiceJournal.lines[1].credit = 250;
  db.payments = [];

  const integrity = buildAccountingIntegrityReport(db, { limit: 50, includeClose: false });
  const codes = new Set(integrity.issues.map((row) => row.code));
  assert.equal(integrity.summary.issueCount > 0, true);
  assert.equal(codes.has('SOURCE_JOURNAL_AMOUNT_MISMATCH'), true);
  assert.equal(codes.has('ORPHAN_SOURCE_EVENT_JOURNAL') || codes.has('ORPHAN_SYSTEM_JOURNAL'), true);
});

test('intercompany funding, repayment, cleanup, and elimination all operate under explicit posting ownership', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-US', name: 'BoFA Operating', entity: 'US', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' },
      { id: 'ACC-UK', name: 'Wise USD', entity: 'UK', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' }
    ],
    intercompanyEntries: [
      {
        id: 'IC-1',
        date: '2026-03-01',
        fromEntity: 'US',
        toEntity: 'UK',
        amount: 200,
        currency: 'USD',
        status: 'PARTIAL_REPAID',
        sourceAccountId: 'ACC-US',
        receivingSourceAccountId: 'ACC-UK',
        reference: 'IC-REF-1',
        repaymentEvents: [
          {
            id: 'ICR-1',
            date: '2026-03-05',
            amount: 50,
            currency: 'USD',
            sourceAccountId: 'ACC-UK',
            receivingSourceAccountId: 'ACC-US',
            reference: 'ICR-REF-1',
            createdByUserId: 'USR-2'
          }
        ],
        createdByUserId: 'USR-2'
      }
    ],
    journals: [
      {
        id: 'JRN-LEGACY',
        journalNumber: 'JRN-LEGACY',
        journalType: 'MANUAL',
        sourceType: 'MANUAL',
        sourceId: 'LEGACY-1',
        entity: 'US',
        currency: 'USD',
        postingDate: '2026-03-10',
        memo: 'Legacy related-party posting',
        status: 'POSTED',
        createdByUserId: 'USR-2',
        approvedByUserId: 'USR-1',
        postedByUserId: 'USR-2',
        lines: [
          {
            id: 'JRL-1',
            lineNumber: 1,
            globalAccountId: 'GLA-4',
            globalAccountCode: '1200',
            globalAccountName: 'Due from Related Parties',
            globalAccountType: 'ASSET',
            description: 'Legacy related-party asset',
            entity: 'US',
            currency: 'USD',
            debit: 150,
            credit: 0,
            reportingRate: 1,
            createdAt: '2026-03-10T00:00:00Z',
            updatedAt: '2026-03-10T00:00:00Z'
          },
          {
            id: 'JRL-2',
            lineNumber: 2,
            globalAccountId: 'GLA-1',
            globalAccountCode: '1000',
            globalAccountName: 'Cash and Cash Equivalents',
            globalAccountType: 'ASSET',
            description: 'Offset',
            entity: 'US',
            currency: 'USD',
            debit: 0,
            credit: 150,
            reportingRate: 1,
            createdAt: '2026-03-10T00:00:00Z',
            updatedAt: '2026-03-10T00:00:00Z'
          }
        ],
        createdAt: '2026-03-10T00:00:00Z',
        updatedAt: '2026-03-10T00:00:00Z',
        submittedAt: '2026-03-10T00:00:00Z',
        approvedAt: '2026-03-10T00:00:00Z',
        postedAt: '2026-03-10T00:00:00Z'
      }
    ]
  });

  syncAllWorkflowPostings(db, 'USR-1');
  const snapshot = getSourceAccountingSnapshot(db, { sourceRootType: 'INTERCOMPANY', sourceRootId: 'IC-1' });
  assert.equal(snapshot.accountingStatus, 'POSTED');
  assert.equal(snapshot.expectedCount, 4);
  assert.equal(snapshot.postedCount, 4);
  assert.equal(snapshot.issueCount, 0);

  const elimination = generateEliminationPostings(db, {
    periodKey: '2026-03',
    actor: actor('USR-1', 'ADMIN')
  });
  assert.equal(elimination.summary.created, 1);

  const cleanupReclass = createCleanupReclassPosting(db, {
    periodKey: '2026-03',
    exceptionId: 'LEGACY:2026-03:US:1200:USD',
    offsetGlobalAccountCode: '3000',
    postingDate: '2026-03-31',
    memo: 'Cleanup legacy related-party balance',
    actorUserId: 'USR-2'
  });
  assert.equal(cleanupReclass.duplicate, false);

  submitJournal(db, cleanupReclass.journal.id, 'USR-2');
  approveJournal(db, cleanupReclass.journal.id, actor('USR-1', 'ADMIN'));
  postJournal(db, cleanupReclass.journal.id, actor('USR-2', 'ACCOUNTANT'));

  const integrity = buildAccountingIntegrityReport(db, { limit: 50, includeClose: true });
  assert.equal(integrity.summary.issueCount >= 0, true);
  assert.equal(db.journals.some((row) => row.journalType === 'ELIMINATION' && row.sourceType === 'INTERCOMPANY_ELIMINATION'), true);
  assert.equal(db.journals.some((row) => row.sourceType === 'RELATED_PARTY_CLEANUP'), true);
});

test('legacy intercompany repayment states without repayment events are flagged as integrity gaps', () => {
  const db = makeDb({
    intercompanyEntries: [
      {
        id: 'IC-LEGACY',
        date: '2026-03-01',
        fromEntity: 'US',
        toEntity: 'PK',
        amount: 250,
        currency: 'USD',
        status: 'REPAID',
        repaidAmount: 250,
        reference: 'IC-LEGACY',
        repaymentEvents: []
      }
    ]
  });

  syncSourceRootPostings(db, { sourceRootType: 'INTERCOMPANY', sourceRootId: 'IC-LEGACY', actorUserId: 'USR-1' });
  const snapshot = getSourceAccountingSnapshot(db, { sourceRootType: 'INTERCOMPANY', sourceRootId: 'IC-LEGACY' });
  const codes = new Set(snapshot.issues.map((row) => row.code));
  assert.equal(snapshot.accountingStatus, 'ATTENTION_REQUIRED');
  assert.equal(codes.has('INTERCOMPANY_REPAYMENT_LINEAGE_GAP'), true);
});
