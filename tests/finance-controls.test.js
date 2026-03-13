import test from 'node:test';
import assert from 'node:assert/strict';
import { periodLockError } from '../server/services/periods.js';
import { validateSourceAccountContext } from '../server/services/source-account-validation.js';
import { assertApprovalAction } from '../server/services/approvals.js';
import { makeDb } from './helpers/finance-fixture.js';

test('closed periods block posting dates inside the closed month', () => {
  const db = makeDb({
    closePeriods: [
      { periodKey: '2026-02', status: 'CLOSED' }
    ]
  });

  assert.equal(periodLockError(db, '2026-02-11'), 'Period 2026-02 is closed. Reopen it before posting new activity.');
  assert.equal(periodLockError(db, '2026-03-01'), null);
});

test('source account validation rejects mismatched entity, currency, and role', () => {
  const account = {
    name: 'Wise GBP Main',
    entity: 'UK',
    currency: 'GBP',
    accountRole: 'BANK'
  };

  assert.match(validateSourceAccountContext(account, {
    entity: 'US',
    currency: 'GBP',
    allowedRoles: ['BANK'],
    fieldLabel: 'funding rail'
  }), /belongs to UK, not US/);

  assert.match(validateSourceAccountContext(account, {
    entity: 'UK',
    currency: 'USD',
    allowedRoles: ['BANK'],
    fieldLabel: 'funding rail'
  }), /GBP funding rail, not USD/);

  assert.match(validateSourceAccountContext({ ...account, accountRole: 'CREDIT_CARD' }, {
    entity: 'UK',
    currency: 'GBP',
    allowedRoles: ['BANK'],
    fieldLabel: 'funding rail'
  }), /role is CREDIT_CARD/);
});

test('maker-checker blocks self approval for journals', () => {
  const db = makeDb();
  const result = assertApprovalAction(db, {
    documentType: 'JOURNAL',
    action: 'APPROVE',
    entity: 'US',
    amount: 100,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    createdByUserId: 'USR-2',
    approvedByUserId: null
  });

  assert.equal(result, 'Maker-checker control: creator cannot approve or reject their own record.');
});

test('approval matrix blocks accountants from approving high-value invoices', () => {
  const db = makeDb();
  const result = assertApprovalAction(db, {
    documentType: 'INVOICE',
    action: 'APPROVE',
    entity: 'US',
    amount: 6000,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    createdByUserId: 'USR-1',
    approvedByUserId: null
  });

  assert.equal(result, 'Role ACCOUNTANT cannot approve invoice.');
});

test('maker-checker blocks journal posting without independent approval', () => {
  const db = makeDb();
  const result = assertApprovalAction(db, {
    documentType: 'JOURNAL',
    action: 'POST',
    entity: 'US',
    amount: 2500,
    actorRole: 'ACCOUNTANT',
    actorUserId: 'USR-2',
    createdByUserId: 'USR-2',
    approvedByUserId: 'USR-2'
  });

  assert.equal(result, 'Maker-checker control: creator cannot post their own record without an independent approval.');
});
