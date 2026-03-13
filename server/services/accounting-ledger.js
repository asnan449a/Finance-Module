import { postedJournals } from '../repositories/journalRepository.js';
import { asMoney, normalizeCurrency, normalizeEntity, toReportingAmount } from './fx.js';

function globalById(db) {
  return new Map((db.globalChartAccounts || []).map((row) => [row.id, row]));
}

function journalScopeFilters({ fromDate = null, toDate = null, entity = null } = {}) {
  return {
    fromDate: fromDate ? String(fromDate) : null,
    toDate: toDate ? String(toDate) : null,
    entity: normalizeEntity(entity) || null
  };
}

export function postedJournalLines(db, { fromDate = null, toDate = null, entity = null } = {}) {
  const globals = globalById(db);
  const scope = journalScopeFilters({ fromDate, toDate, entity });
  const rows = [];

  for (const journal of postedJournals(db)) {
    if (scope.fromDate && String(journal.postingDate || '') < scope.fromDate) continue;
    if (scope.toDate && String(journal.postingDate || '') > scope.toDate) continue;
    for (const line of journal.lines || []) {
      const lineEntity = normalizeEntity(line.entity) || normalizeEntity(journal.entity) || null;
      if (scope.entity && lineEntity !== scope.entity) continue;
      const global = globals.get(line.globalAccountId) || null;
      rows.push({
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        journalType: journal.journalType,
        journalStatus: journal.status,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        sourceRootType: journal.sourceRootType || journal.sourceType || 'MANUAL',
        sourceRootId: journal.sourceRootId || journal.sourceId || null,
        sourceStage: journal.sourceStage || null,
        postingDate: journal.postingDate,
        memo: journal.memo || null,
        entity: lineEntity,
        currency: normalizeCurrency(line.currency || journal.currency || db.settings?.reportingCurrency || 'USD'),
        globalAccountId: line.globalAccountId,
        globalAccountCode: line.globalAccountCode || global?.code || null,
        globalAccountName: line.globalAccountName || global?.name || null,
        globalAccountType: line.globalAccountType || global?.type || null,
        reportingGroup: global?.reportingGroup || null,
        lineId: line.id,
        lineNumber: Number(line.lineNumber || 0),
        description: line.description || journal.memo || null,
        sourceAccountId: line.sourceAccountId || null,
        reference: line.reference || null,
        debit: asMoney(line.debit || 0),
        credit: asMoney(line.credit || 0),
        reportingDebit: toReportingAmount(db, line.debit || 0, line.currency || journal.currency),
        reportingCredit: toReportingAmount(db, line.credit || 0, line.currency || journal.currency),
        consolidationOnly: Boolean(journal.consolidationOnly),
        periodKey: journal.periodKey || null,
        eliminationKey: journal.eliminationKey || null,
        eliminationScope: journal.eliminationScope || null,
        cleanupKey: journal.cleanupKey || null
      });
    }
  }

  return rows;
}

export function lineNetByType(line) {
  const type = String(line.globalAccountType || '').toUpperCase();
  if (['ASSET', 'EXPENSE'].includes(type)) {
    return asMoney(Number(line.reportingDebit || 0) - Number(line.reportingCredit || 0));
  }
  return asMoney(Number(line.reportingCredit || 0) - Number(line.reportingDebit || 0));
}

export function groupTrialBalanceRows(lines) {
  const grouped = new Map();
  for (const line of lines) {
    const key = String(line.globalAccountId || line.globalAccountCode || 'UNMAPPED');
    if (!grouped.has(key)) {
      grouped.set(key, {
        globalAccountId: line.globalAccountId,
        code: line.globalAccountCode,
        name: line.globalAccountName,
        type: line.globalAccountType,
        reportingGroup: line.reportingGroup || null,
        debit: 0,
        credit: 0,
        net: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.debit = asMoney(bucket.debit + Number(line.reportingDebit || 0));
    bucket.credit = asMoney(bucket.credit + Number(line.reportingCredit || 0));
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      net: ['ASSET', 'EXPENSE'].includes(String(row.type || '').toUpperCase())
        ? asMoney(row.debit - row.credit)
        : asMoney(row.credit - row.debit)
    }))
    .sort((a, b) => `${a.code || ''} ${a.name || ''}`.localeCompare(`${b.code || ''} ${b.name || ''}`));
}
