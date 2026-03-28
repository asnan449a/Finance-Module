import { nextId, nowIso } from '../store.js';
import { createAutoPostedJournal } from './journals.js';
import { asMoney, inferEntityFromCurrency, normalizeCurrency, normalizeEntity } from './fx.js';

function getGlobalAccountById(db, globalAccountId) {
  return (db.globalChartAccounts || []).find((row) => row.id === globalAccountId) || null;
}

function getGlobalAccountByCode(db, code) {
  return (db.globalChartAccounts || []).find((row) => String(row.code || '') === String(code || '')) || null;
}

function naturalSide(globalAccount) {
  const type = String(globalAccount?.type || '').toUpperCase();
  if (['ASSET', 'EXPENSE'].includes(type)) return 'DEBIT';
  return 'CREDIT';
}

function normalizeSide(value, fallback = 'DEBIT') {
  const text = String(value || fallback).toUpperCase();
  return text === 'CREDIT' ? 'CREDIT' : 'DEBIT';
}

function ensureOpeningBalanceCollection(db) {
  if (!Array.isArray(db.openingBalances)) db.openingBalances = [];
}

function normalizeOpeningBalanceLine(db, line, { currency, entity }) {
  const globalAccount = line.globalAccountId
    ? getGlobalAccountById(db, line.globalAccountId)
    : line.globalAccountCode
      ? getGlobalAccountByCode(db, line.globalAccountCode)
      : null;

  if (!globalAccount) throw new Error('Each opening balance line requires a valid global account.');
  const amount = asMoney(line.amount || 0);
  if (amount <= 0) throw new Error(`Opening balance amount for ${globalAccount.code} must be greater than zero.`);
  const side = normalizeSide(line.side, naturalSide(globalAccount));

  return {
    id: nextId(db, 'OPENING_BALANCE_LINE', 'OBL'),
    globalAccountId: globalAccount.id,
    globalAccountCode: globalAccount.code,
    globalAccountName: globalAccount.name,
    globalAccountType: globalAccount.type,
    side,
    amount,
    entity: normalizeEntity(line.entity) || entity || null,
    currency: normalizeCurrency(line.currency || currency),
    description: String(line.description || globalAccount.name || '').trim() || globalAccount.name,
    reference: String(line.reference || '').trim() || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export function listOpeningBalances(db, { entity = null } = {}) {
  ensureOpeningBalanceCollection(db);
  let rows = [...db.openingBalances];
  if (entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(entity).toUpperCase());
  rows.sort((a, b) => String(b.asOfDate || '').localeCompare(String(a.asOfDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return rows.map((row) => ({
    ...row,
    totalDebit: asMoney((row.lines || []).filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + Number(line.amount || 0), 0)),
    totalCredit: asMoney((row.lines || []).filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + Number(line.amount || 0), 0)),
    lineCount: (row.lines || []).length
  }));
}

export function createOpeningBalanceBatch(db, payload, actorUserId) {
  ensureOpeningBalanceCollection(db);
  const asOfDate = String(payload.asOfDate || '').trim();
  if (!asOfDate) throw new Error('asOfDate is required.');
  const currency = normalizeCurrency(payload.currency || db.settings?.entityBaseCurrencies?.[normalizeEntity(payload.entity)] || db.settings?.reportingCurrency || 'USD');
  const entity = normalizeEntity(payload.entity) || inferEntityFromCurrency(db, currency) || 'US';
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) throw new Error('At least one opening balance line is required.');

  const normalizedLines = lines.map((line) => normalizeOpeningBalanceLine(db, line, { currency, entity }));
  const debitTotal = asMoney(normalizedLines.filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const creditTotal = asMoney(normalizedLines.filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const difference = asMoney(Math.abs(debitTotal - creditTotal));
  if (difference > 0.01) {
    throw new Error('Opening balance lines must net to zero before migration. Add the missing asset, liability, or equity balances so the batch is complete.');
  }

  const openingId = nextId(db, 'OPENING_BALANCE', 'OB');
  const row = {
    id: openingId,
    batchNumber: `OB-${String(openingId.split('-')[1] || '1').padStart(4, '0')}`,
    asOfDate,
    entity,
    currency,
    memo: String(payload.memo || '').trim() || `Opening balances as of ${asOfDate}`,
    notes: String(payload.notes || '').trim() || '',
    createdByUserId: actorUserId || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lines: normalizedLines
  };

  const journal = createAutoPostedJournal(db, {
    journalType: 'OPENING',
    sourceType: 'OPENING_BALANCE',
    sourceId: row.id,
    sourceRootType: 'OPENING_BALANCE',
    sourceRootId: row.id,
    sourceStage: 'POSTED',
    postingKey: `OPENING_BALANCE:${row.id}`,
    entity: row.entity,
    currency: row.currency,
    postingDate: row.asOfDate,
    memo: row.memo,
    lines: normalizedLines.map((line) => ({
      globalAccountId: line.globalAccountId,
      description: line.description,
      entity: line.entity,
      currency: line.currency,
      reference: line.reference,
      debit: line.side === 'DEBIT' ? line.amount : 0,
      credit: line.side === 'CREDIT' ? line.amount : 0
    }))
  }, actorUserId);

  row.journalId = journal.id;
  db.openingBalances.push(row);
  return row;
}
