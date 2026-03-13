import { findActiveJournalByMeta, listJournals } from '../repositories/journalRepository.js';
import { listIntercompanyEntries } from '../repositories/intercompanyRepository.js';
import { createAutoPostedJournal, createManualJournal, reverseJournal } from './journals.js';
import { postedJournalLines, lineNetByType } from './accounting-ledger.js';
import { asMoney, normalizeEntity, normalizeCurrency, toReportingAmount } from './fx.js';
import { hydrateIntercompanyEntry } from './intercompany.js';
import { periodBounds } from './periods.js';

const RELATED_PARTY_CODES = new Set(['1200', '2200']);

function pairKey(fromEntity, toEntity) {
  return `${normalizeEntity(fromEntity) || 'UNKNOWN'}->${normalizeEntity(toEntity) || 'UNKNOWN'}`;
}

function pairLabel(fromEntity, toEntity) {
  return `${normalizeEntity(fromEntity) || 'Unknown'} -> ${normalizeEntity(toEntity) || 'Unknown'}`;
}

function eliminationJournalAmount(journal) {
  return asMoney(Math.max(
    ...(journal?.lines || []).map((line) => Math.max(Number(line.debit || 0), Number(line.credit || 0))),
    0
  ));
}

function entryReportingAmounts(db, entry) {
  return {
    funding: toReportingAmount(db, entry.amount || 0, entry.currency || db.settings?.reportingCurrency || 'USD'),
    repaid: toReportingAmount(db, entry.repaidAmount || 0, entry.currency || db.settings?.reportingCurrency || 'USD'),
    outstanding: toReportingAmount(db, entry.outstandingAmount || 0, entry.currency || db.settings?.reportingCurrency || 'USD')
  };
}

function relatedPartyJournalLinesToDate(db, toDate) {
  return postedJournalLines(db, { toDate })
    .filter((line) => RELATED_PARTY_CODES.has(String(line.globalAccountCode || '')))
    .filter((line) => String(line.journalStatus || '').toUpperCase() !== 'VOID');
}

function activeEliminationJournalsByPeriod(db, periodKey) {
  const active = new Map();
  for (const journal of listJournals(db, {
    journalType: 'ELIMINATION',
    periodKey,
    excludeStatuses: ['VOID']
  })) {
    if (journal.reversedByJournalId) continue;
    if (String(journal.status || '').toUpperCase() === 'REVERSED') continue;
    if (!journal.eliminationKey) continue;
    active.set(String(journal.eliminationKey), journal);
  }
  return active;
}

function buildCleanupExceptions(lines, periodKey) {
  const grouped = new Map();
  for (const line of lines) {
    const sourceType = String(line.sourceType || '').toUpperCase();
    const sourceRootType = String(line.sourceRootType || '').toUpperCase();
    if (line.consolidationOnly) continue;
    if (sourceRootType === 'INTERCOMPANY') continue;
    if (sourceType === 'INTERCOMPANY_ELIMINATION') continue;
    if (sourceType === 'RELATED_PARTY_CLEANUP') continue;
    const accountCode = String(line.globalAccountCode || '');
    const entity = normalizeEntity(line.entity) || null;
    const currency = normalizeCurrency(line.currency || 'USD');
    const key = `${entity || 'UNSCOPED'}:${accountCode}:${currency}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `LEGACY:${periodKey}:${entity || 'UNSCOPED'}:${accountCode}:${currency}`,
        type: 'LEGACY_RELATED_PARTY_BALANCE',
        periodKey,
        entity,
        accountCode,
        accountName: line.globalAccountName || null,
        currency,
        netNative: 0,
        netReporting: 0,
        support: []
      });
    }
    const bucket = grouped.get(key);
    const nativeNet = ['ASSET', 'EXPENSE'].includes(String(line.globalAccountType || '').toUpperCase())
      ? asMoney(Number(line.debit || 0) - Number(line.credit || 0))
      : asMoney(Number(line.credit || 0) - Number(line.debit || 0));
    bucket.netNative = asMoney(bucket.netNative + nativeNet);
    bucket.netReporting = asMoney(bucket.netReporting + lineNetByType(line));
    bucket.support.push({
      journalId: line.journalId,
      journalNumber: line.journalNumber,
      journalType: line.journalType,
      postingDate: line.postingDate,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      amount: nativeNet
    });
  }

  return [...grouped.values()]
    .filter((row) => Math.abs(Number(row.netNative || 0)) > 0.01)
    .map((row) => ({
      ...row,
      amount: asMoney(Math.abs(Number(row.netNative || 0))),
      recommendedOffsetCode: '3000',
      direction: Number(row.netNative || 0) > 0 ? 'NORMAL' : 'REVERSED',
      support: row.support.sort((a, b) => `${b.postingDate || ''} ${b.journalNumber || ''}`.localeCompare(`${a.postingDate || ''} ${a.journalNumber || ''}`))
    }))
    .sort((a, b) => `${a.entity || ''} ${a.accountCode || ''} ${a.currency || ''}`.localeCompare(`${b.entity || ''} ${b.accountCode || ''} ${b.currency || ''}`));
}

export function buildRelatedPartyCloseReconciliation(db, { periodKey } = {}) {
  const bounds = periodBounds(periodKey);
  if (!bounds) throw new Error('Valid periodKey is required.');
  const { end } = bounds;
  const reportingCurrency = String(db.settings?.reportingCurrency || 'USD').toUpperCase();

  const entries = listIntercompanyEntries(db, { asOfDate: end }).map((row) => hydrateIntercompanyEntry(row));
  const relatedPartyLines = relatedPartyJournalLinesToDate(db, end);
  const operationalJournalLinesByEntry = new Map();
  for (const line of relatedPartyLines) {
    if (String(line.sourceRootType || '').toUpperCase() !== 'INTERCOMPANY') continue;
    const key = String(line.sourceRootId || '');
    if (!operationalJournalLinesByEntry.has(key)) operationalJournalLinesByEntry.set(key, []);
    operationalJournalLinesByEntry.get(key).push(line);
  }

  const pairs = new Map();
  for (const entry of entries) {
    const key = pairKey(entry.fromEntity, entry.toEntity);
    if (!pairs.has(key)) {
      pairs.set(key, {
        pairKey: key,
        pairLabel: pairLabel(entry.fromEntity, entry.toEntity),
        fromEntity: normalizeEntity(entry.fromEntity),
        toEntity: normalizeEntity(entry.toEntity),
        fundingTotal: 0,
        repaymentTotal: 0,
        outstandingBalance: 0,
        journalDueFromBalance: 0,
        journalDueToBalance: 0,
        entryIds: [],
        currencies: new Set()
      });
    }
    const bucket = pairs.get(key);
    const amounts = entryReportingAmounts(db, entry);
    bucket.fundingTotal = asMoney(bucket.fundingTotal + amounts.funding);
    bucket.repaymentTotal = asMoney(bucket.repaymentTotal + amounts.repaid);
    bucket.outstandingBalance = asMoney(bucket.outstandingBalance + amounts.outstanding);
    bucket.entryIds.push(entry.id);
    bucket.currencies.add(entry.currency);

    for (const line of operationalJournalLinesByEntry.get(entry.id) || []) {
      const code = String(line.globalAccountCode || '');
      if (code === '1200') bucket.journalDueFromBalance = asMoney(bucket.journalDueFromBalance + lineNetByType(line));
      if (code === '2200') bucket.journalDueToBalance = asMoney(bucket.journalDueToBalance + lineNetByType(line));
    }
  }

  const activeEliminations = activeEliminationJournalsByPeriod(db, periodKey);
  const pairRows = [...pairs.values()]
    .map((row) => {
      const dueFromDifference = asMoney(Number(row.journalDueFromBalance || 0) - Number(row.outstandingBalance || 0));
      const dueToDifference = asMoney(Number(row.journalDueToBalance || 0) - Number(row.outstandingBalance || 0));
      const reconciles = Math.abs(dueFromDifference) <= 0.01 && Math.abs(dueToDifference) <= 0.01;
      const eliminationJournal = activeEliminations.get(String(row.pairKey)) || null;
      const eliminationAmount = eliminationJournal ? eliminationJournalAmount(eliminationJournal) : 0;
      let eliminationStatus = 'NOT_REQUIRED';
      if (row.outstandingBalance > 0.01) {
        if (!reconciles) eliminationStatus = 'BLOCKED_MISMATCH';
        else if (eliminationJournal && Math.abs(Number(eliminationAmount || 0) - Number(row.outstandingBalance || 0)) <= 0.01) eliminationStatus = 'GENERATED';
        else if (eliminationJournal) eliminationStatus = 'STALE';
        else eliminationStatus = 'READY';
      }
      return {
        ...row,
        currencies: [...row.currencies].sort(),
        dueFromDifference,
        dueToDifference,
        reconciles,
        eliminationStatus,
        eliminationAmount: asMoney(eliminationAmount || 0),
        eliminationJournalId: eliminationJournal?.id || null,
        eliminationJournalNumber: eliminationJournal?.journalNumber || null,
        closeBlocker: !reconciles || (row.outstandingBalance > 0.01 && eliminationStatus !== 'GENERATED')
      };
    })
    .sort((a, b) => String(a.pairKey || '').localeCompare(String(b.pairKey || '')));

  const cleanupExceptions = buildCleanupExceptions(relatedPartyLines, periodKey);
  const summary = {
    periodKey,
    reportingCurrency,
    pairCount: pairRows.length,
    mismatchPairCount: pairRows.filter((row) => !row.reconciles).length,
    eliminationReadyCount: pairRows.filter((row) => row.eliminationStatus === 'READY').length,
    eliminationGeneratedCount: pairRows.filter((row) => row.eliminationStatus === 'GENERATED').length,
    staleEliminationCount: pairRows.filter((row) => row.eliminationStatus === 'STALE').length,
    closeBlockerCount: pairRows.filter((row) => row.closeBlocker).length + cleanupExceptions.length,
    cleanupExceptionCount: cleanupExceptions.length,
    fundingTotal: asMoney(pairRows.reduce((sum, row) => sum + Number(row.fundingTotal || 0), 0)),
    repaymentTotal: asMoney(pairRows.reduce((sum, row) => sum + Number(row.repaymentTotal || 0), 0)),
    outstandingBalance: asMoney(pairRows.reduce((sum, row) => sum + Number(row.outstandingBalance || 0), 0)),
    journalDueFromBalance: asMoney(pairRows.reduce((sum, row) => sum + Number(row.journalDueFromBalance || 0), 0)),
    journalDueToBalance: asMoney(pairRows.reduce((sum, row) => sum + Number(row.journalDueToBalance || 0), 0)),
    relatedPartyCloseReady: pairRows.every((row) => !row.closeBlocker) && cleanupExceptions.length === 0
  };

  return {
    periodKey,
    start: bounds.start,
    end,
    reportingCurrency,
    summary,
    pairs: pairRows,
    cleanupExceptions,
    eliminationJournals: [...activeEliminations.values()].map((journal) => ({
      id: journal.id,
      journalNumber: journal.journalNumber,
      eliminationKey: journal.eliminationKey || null,
      eliminationScope: journal.eliminationScope || null,
      postingDate: journal.postingDate,
      amount: eliminationJournalAmount(journal)
    }))
  };
}

function eliminationLines(amount, memo, reportingCurrency) {
  return [
    { globalAccountCode: '2200', debit: amount, description: `${memo} due-to elimination`, currency: reportingCurrency },
    { globalAccountCode: '1200', credit: amount, description: `${memo} due-from elimination`, currency: reportingCurrency }
  ];
}

export function generateIntercompanyEliminationJournals(db, { periodKey, actor } = {}) {
  const bounds = periodBounds(periodKey);
  if (!bounds) throw new Error('Valid periodKey is required.');
  const reconciliation = buildRelatedPartyCloseReconciliation(db, { periodKey });
  const reportingCurrency = String(db.settings?.reportingCurrency || 'USD').toUpperCase();
  const activeEliminations = activeEliminationJournalsByPeriod(db, periodKey);
  const reused = [];
  const created = [];
  const reversed = [];
  const eligibleKeys = new Set();

  for (const pair of reconciliation.pairs) {
    if (!pair.reconciles || Number(pair.outstandingBalance || 0) <= 0.01) continue;
    const eliminationKey = String(pair.pairKey);
    eligibleKeys.add(eliminationKey);
    const existing = activeEliminations.get(eliminationKey) || null;
    const expectedAmount = asMoney(pair.outstandingBalance || 0);
    if (existing && Math.abs(eliminationJournalAmount(existing) - expectedAmount) <= 0.01) {
      reused.push(existing);
      continue;
    }
    if (existing) {
      const reversal = reverseJournal(db, existing.id, actor, {
        postingDate: bounds.end,
        memo: `Reverse stale elimination ${existing.journalNumber}`
      });
      reversed.push(reversal.reversal);
    }

    const memo = `Eliminate related-party ${pair.pairLabel} for ${periodKey}`;
    const journal = createAutoPostedJournal(db, {
      journalType: 'ELIMINATION',
      sourceType: 'INTERCOMPANY_ELIMINATION',
      sourceId: `${periodKey}:${eliminationKey}`,
      sourceRootType: 'CLOSE_PERIOD',
      sourceRootId: periodKey,
      sourceStage: 'RELATED_PARTY_ELIMINATION',
      consolidationOnly: true,
      periodKey,
      eliminationKey,
      eliminationScope: 'INTERCOMPANY_PAIR',
      entity: null,
      currency: reportingCurrency,
      postingDate: bounds.end,
      memo,
      lines: eliminationLines(expectedAmount, memo, reportingCurrency)
    }, actor.id);
    created.push(journal);
  }

  for (const [eliminationKey, existing] of activeEliminations.entries()) {
    if (eligibleKeys.has(eliminationKey)) continue;
    const reversal = reverseJournal(db, existing.id, actor, {
      postingDate: bounds.end,
      memo: `Reverse obsolete elimination ${existing.journalNumber}`
    });
    reversed.push(reversal.reversal);
  }

  return {
    periodKey,
    summary: {
      created: created.length,
      reused: reused.length,
      reversed: reversed.length,
      blockedPairs: reconciliation.pairs.filter((pair) => pair.eliminationStatus === 'BLOCKED_MISMATCH').length
    },
    created,
    reused,
    reversed,
    reconciliation: buildRelatedPartyCloseReconciliation(db, { periodKey })
  };
}

function cleanupJournalLines(exception, offsetGlobalAccountId, offsetGlobalAccountCode) {
  const amount = asMoney(Math.abs(Number(exception.netNative || 0)));
  const isPositive = Number(exception.netNative || 0) > 0;
  const clearingLine = { globalAccountCode: exception.accountCode, description: `Cleanup ${exception.accountCode} ${exception.entity || ''}`.trim() };
  if (String(exception.accountCode || '') === '1200') {
    if (isPositive) clearingLine.credit = amount;
    else clearingLine.debit = amount;
  } else {
    if (isPositive) clearingLine.debit = amount;
    else clearingLine.credit = amount;
  }

  const offsetLine = {
    globalAccountId: offsetGlobalAccountId || null,
    globalAccountCode: offsetGlobalAccountCode || null,
    description: `Cleanup offset ${exception.id}`
  };
  if (clearingLine.credit) offsetLine.debit = amount;
  else offsetLine.credit = amount;
  return [clearingLine, offsetLine];
}

export function createHistoricalCleanupJournal(db, {
  periodKey,
  exceptionId,
  offsetGlobalAccountId = null,
  offsetGlobalAccountCode = null,
  postingDate = null,
  memo = '',
  actorUserId = null
} = {}) {
  const reconciliation = buildRelatedPartyCloseReconciliation(db, { periodKey });
  const exception = (reconciliation.cleanupExceptions || []).find((row) => row.id === exceptionId);
  if (!exception) throw new Error('Cleanup exception not found.');
  if (!offsetGlobalAccountId && !offsetGlobalAccountCode) throw new Error('Offset global account is required.');

  const existing = findActiveJournalByMeta(db, {
    sourceType: 'RELATED_PARTY_CLEANUP',
    cleanupKey: exception.id
  });
  if (existing) {
    return { journal: existing, duplicate: true, exception };
  }

  const journal = createManualJournal(db, {
    postingDate: postingDate || reconciliation.end,
    entity: exception.entity,
    currency: exception.currency,
    journalType: 'ADJUSTMENT',
    sourceType: 'RELATED_PARTY_CLEANUP',
    sourceId: exception.id,
    sourceRootType: 'RELATED_PARTY_RECON',
    sourceRootId: periodKey,
    sourceStage: 'HISTORICAL_CLEANUP',
    periodKey,
    cleanupKey: exception.id,
    memo: memo || `Cleanup historical related-party balance ${exception.id}`,
    lines: cleanupJournalLines(exception, offsetGlobalAccountId, offsetGlobalAccountCode)
  }, actorUserId);

  return { journal, duplicate: false, exception };
}
