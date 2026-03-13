import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepaymentEvent, applyRepaymentEvent, hydrateIntercompanyEntry } from '../server/services/intercompany.js';
import { syncOperationalJournals } from '../server/services/journals.js';
import { buildBalanceSheet, buildIntercompanyExposure } from '../server/services/statements.js';
import { makeDb } from './helpers/finance-fixture.js';

function makeAccounts() {
  return [
    { id: 'ACC-US', name: 'BoFA Operating', entity: 'US', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' },
    { id: 'ACC-UK', name: 'Wise GBP', entity: 'UK', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' }
  ];
}

test('intercompany repayment updates exposure and creates explicit funding and repayment journals', () => {
  const db = makeDb({
    accounts: makeAccounts(),
    intercompanyEntries: [
      {
        id: 'IC-1',
        date: '2026-03-01',
        fromEntity: 'US',
        toEntity: 'UK',
        amount: 200,
        currency: 'USD',
        status: 'OPEN',
        sourceAccountId: 'ACC-US',
        receivingSourceAccountId: 'ACC-UK',
        reference: 'IC-REF-1',
        repaymentEvents: []
      }
    ]
  });

  const entry = db.intercompanyEntries[0];
  syncOperationalJournals(db, 'USR-1');

  assert.equal(db.journals.filter((row) => row.sourceRootType === 'INTERCOMPANY' && row.sourceRootId === 'IC-1').length, 2);

  applyRepaymentEvent(entry, buildRepaymentEvent({
    id: 'ICR-1',
    date: '2026-03-15',
    amount: 80,
    currency: 'USD',
    sourceAccountId: 'ACC-UK',
    receivingSourceAccountId: 'ACC-US',
    reference: 'IC-REF-1-REPAY',
    createdByUserId: 'USR-2',
    createdAt: '2026-03-15T00:00:00Z'
  }));
  syncOperationalJournals(db, 'USR-2');

  const hydrated = hydrateIntercompanyEntry(entry);
  assert.equal(hydrated.status, 'PARTIAL_REPAID');
  assert.equal(hydrated.repaidAmount, 80);
  assert.equal(hydrated.outstandingAmount, 120);

  const journalSourceTypes = db.journals
    .filter((row) => row.sourceRootType === 'INTERCOMPANY' && row.sourceRootId === 'IC-1')
    .map((row) => row.sourceType)
    .sort();
  assert.deepEqual(journalSourceTypes, [
    'INTERCOMPANY_FUNDING_IN',
    'INTERCOMPANY_FUNDING_OUT',
    'INTERCOMPANY_REPAYMENT_IN',
    'INTERCOMPANY_REPAYMENT_OUT'
  ]);

  const usExposure = buildIntercompanyExposure(db, { asOfDate: '2026-03-31', entity: 'US' });
  const ukExposure = buildIntercompanyExposure(db, { asOfDate: '2026-03-31', entity: 'UK' });
  assert.equal(usExposure.grossDueFrom, 120);
  assert.equal(ukExposure.grossDueTo, 120);
});

test('fully repaid intercompany journals net out on entity and consolidated balance sheets', () => {
  const db = makeDb({
    accounts: makeAccounts(),
    intercompanyEntries: [
      {
        id: 'IC-2',
        date: '2026-03-01',
        fromEntity: 'US',
        toEntity: 'UK',
        amount: 150,
        currency: 'USD',
        status: 'OPEN',
        sourceAccountId: 'ACC-US',
        receivingSourceAccountId: 'ACC-UK',
        reference: 'IC-REF-2',
        repaymentEvents: [
          {
            id: 'ICR-2',
            date: '2026-03-20',
            amount: 150,
            currency: 'USD',
            sourceAccountId: 'ACC-UK',
            receivingSourceAccountId: 'ACC-US',
            reference: 'IC-REF-2-REPAY',
            createdByUserId: 'USR-2',
            createdAt: '2026-03-20T00:00:00Z'
          }
        ]
      }
    ]
  });

  syncOperationalJournals(db, 'USR-1');

  const usBalanceSheet = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'US' });
  const ukBalanceSheet = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'UK' });
  const consolidated = buildBalanceSheet(db, { asOfDate: '2026-03-31' });

  assert.equal(usBalanceSheet.assets.dueFromRelatedParties, 0);
  assert.equal(ukBalanceSheet.liabilities.dueToRelatedParties, 0);
  assert.equal(consolidated.assets.dueFromRelatedParties, 0);
  assert.equal(consolidated.liabilities.dueToRelatedParties, 0);
});
