import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveJournal,
  createManualJournal,
  postJournal,
  submitJournal,
  syncOperationalJournals
} from '../server/services/journals.js';
import {
  buildBalanceSheet,
  buildIntercompanyExposure,
  buildProfitAndLoss,
  buildStatementDrilldown,
  buildTrialBalanceDrilldown,
  buildTrialBalance
} from '../server/services/statements.js';
import { generateIntercompanyEliminationJournals } from '../server/services/related-party-close.js';
import { makeDb } from './helpers/finance-fixture.js';

function post(db, payload, {
  creatorId = 'USR-2',
  approver = { id: 'USR-1', role: 'ADMIN' },
  poster = { id: 'USR-2', role: 'ACCOUNTANT' }
} = {}) {
  const created = createManualJournal(db, payload, creatorId);
  submitJournal(db, created.id, creatorId);
  approveJournal(db, created.id, approver);
  return postJournal(db, created.id, poster);
}

test('trial balance and statements translate foreign-currency journals into reporting currency', () => {
  const db = makeDb({
    settings: {
      reportingCurrency: 'USD',
      entityBaseCurrencies: { US: 'USD', UK: 'GBP', PK: 'PKR' },
      fxRatesToUSD: { USD: 1, GBP: 1.25, PKR: 0.0035 }
    }
  });

  post(db, {
    postingDate: '2026-03-05',
    entity: 'UK',
    currency: 'GBP',
    memo: 'UK revenue recognition',
    lines: [
      { globalAccountCode: '1000', debit: 1000, credit: 0, description: 'Cash receipt' },
      { globalAccountCode: '4000', debit: 0, credit: 1000, description: 'Service revenue' }
    ]
  });

  const tb = buildTrialBalance(db, { asOfDate: '2026-03-31', entity: 'UK' });
  const cash = tb.rows.find((row) => row.code === '1000');
  const revenue = tb.rows.find((row) => row.code === '4000');
  assert.equal(tb.reportingCurrency, 'USD');
  assert.equal(cash.debit, 1250);
  assert.equal(revenue.credit, 1250);
  assert.equal(tb.totals.debit, 1250);
  assert.equal(tb.totals.credit, 1250);

  const pl = buildProfitAndLoss(db, {
    fromDate: '2026-03-01',
    toDate: '2026-03-31',
    entity: 'UK'
  });
  assert.equal(pl.statement.revenueRecognized, 1250);
  assert.equal(pl.statement.netProfit, 1250);

  const bs = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'UK' });
  assert.equal(bs.assets.cash, 1250);
  assert.equal(bs.equity.currentEarnings, 1250);
  assert.equal(bs.assets.totalAssets, 1250);
  assert.equal(bs.equity.totalEquity, 1250);
});

test('entity balance sheets show directional intercompany due-from and due-to exposure', () => {
  const db = makeDb({
    intercompanyEntries: [
      { id: 'IC-1', date: '2026-03-01', fromEntity: 'US', toEntity: 'UK', amount: 100, currency: 'USD', status: 'OPEN', reference: 'US-UK' },
      { id: 'IC-2', date: '2026-03-02', fromEntity: 'UK', toEntity: 'PK', amount: 50, currency: 'USD', status: 'OPEN', reference: 'UK-PK' },
      { id: 'IC-3', date: '2026-03-03', fromEntity: 'PK', toEntity: 'US', amount: 25, currency: 'USD', status: 'SETTLED', reference: 'PK-US' }
    ]
  });

  const ukExposure = buildIntercompanyExposure(db, { asOfDate: '2026-03-31', entity: 'UK' });
  assert.equal(ukExposure.grossDueFrom, 50);
  assert.equal(ukExposure.grossDueTo, 100);
  assert.equal(ukExposure.netConsolidatedExposure, -50);

  const usBalanceSheet = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'US' });
  const ukBalanceSheet = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'UK' });
  const consolidated = buildBalanceSheet(db, { asOfDate: '2026-03-31' });

  assert.equal(usBalanceSheet.assets.dueFromRelatedParties, 100);
  assert.equal(usBalanceSheet.liabilities.dueToRelatedParties, 0);
  assert.equal(ukBalanceSheet.assets.dueFromRelatedParties, 50);
  assert.equal(ukBalanceSheet.liabilities.dueToRelatedParties, 100);
  assert.equal(consolidated.assets.dueFromRelatedParties, 0);
  assert.equal(consolidated.liabilities.dueToRelatedParties, 0);
});

test('explicit elimination journals clear consolidated related-party balances and support drilldown', () => {
  const db = makeDb({
    accounts: [
      { id: 'ACC-US', name: 'BoFA Operating', entity: 'US', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' },
      { id: 'ACC-UK', name: 'Wise USD', entity: 'UK', currency: 'USD', accountRole: 'BANK', status: 'ACTIVE' }
    ],
    intercompanyEntries: [
      {
        id: 'IC-1',
        date: '2026-03-07',
        fromEntity: 'US',
        toEntity: 'UK',
        amount: 300,
        currency: 'USD',
        status: 'OPEN',
        sourceAccountId: 'ACC-US',
        receivingSourceAccountId: 'ACC-UK',
        reference: 'IC-REF-1',
        repaymentEvents: []
      }
    ]
  });

  syncOperationalJournals(db, 'USR-1');
  const before = buildTrialBalance(db, { asOfDate: '2026-03-31' });
  assert.equal(before.rows.find((row) => row.code === '1200').net, 300);
  assert.equal(before.rows.find((row) => row.code === '2200').net, 300);
  assert.equal(before.eliminations.eliminationAmount, 0);
  assert.equal(before.eliminationPreview.eliminationAmount, 300);

  generateIntercompanyEliminationJournals(db, {
    periodKey: '2026-03',
    actor: { id: 'USR-1', role: 'ADMIN' }
  });

  const consolidatedTb = buildTrialBalance(db, { asOfDate: '2026-03-31' });
  const dueFrom = consolidatedTb.rows.find((row) => row.code === '1200');
  const dueTo = consolidatedTb.rows.find((row) => row.code === '2200');

  assert.equal(consolidatedTb.eliminations.eliminationAmount, 300);
  assert.equal(dueFrom.net, 0);
  assert.equal(dueTo.net, 0);

  const drilldown = buildTrialBalanceDrilldown(db, { accountCode: '1200', asOfDate: '2026-03-31' });
  assert.equal(drilldown.rows.length, 2);
  assert.equal(drilldown.rows.some((row) => row.supportBucket === 'ELIMINATION'), true);
  assert.equal(drilldown.eliminationContext.eliminationAmount, 300);
});

test('balance sheet reclassifies opposite-sign related-party balances directionally', () => {
  const db = makeDb();

  post(db, {
    postingDate: '2026-03-10',
    entity: 'US',
    currency: 'USD',
    memo: 'Misclassified related-party credit in due-from',
    lines: [
      { globalAccountCode: '1000', debit: 200, credit: 0, description: 'Cash received' },
      { globalAccountCode: '1200', debit: 0, credit: 200, description: 'Should present as due to related party' }
    ]
  });

  const bs = buildBalanceSheet(db, { asOfDate: '2026-03-31', entity: 'US' });
  assert.equal(bs.assets.dueFromRelatedParties, 0);
  assert.equal(bs.liabilities.dueToRelatedParties, 200);
  assert.equal(bs.intercompanyControl.rawJournalDueFrom, -200);
  assert.equal(bs.intercompanyControl.journalDueTo, 200);
});

test('statement drilldown returns supporting journal activity for formal reports', () => {
  const db = makeDb();

  post(db, {
    postingDate: '2026-03-12',
    entity: 'US',
    currency: 'USD',
    memo: 'Service revenue',
    lines: [
      { globalAccountCode: '1100', debit: 800, credit: 0, description: 'AR' },
      { globalAccountCode: '4000', debit: 0, credit: 800, description: 'Revenue' }
    ]
  });

  const drilldown = buildStatementDrilldown(db, {
    statement: 'profit-and-loss',
    lineKey: 'revenueRecognized',
    fromDate: '2026-03-01',
    toDate: '2026-03-31'
  });

  assert.equal(drilldown.label, 'Revenue recognized');
  assert.equal(drilldown.rows.length, 1);
  assert.equal(drilldown.rows[0].sourceType, 'MANUAL');
  assert.equal(drilldown.supportBuckets[0].bucket, 'ADJUSTMENT');
});
