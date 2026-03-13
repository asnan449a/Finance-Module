import { listIntercompanyEntries } from '../repositories/intercompanyRepository.js';
import { buildRelatedPartyEliminations } from './eliminations.js';
import { postedJournalLines, lineNetByType, groupTrialBalanceRows } from './accounting-ledger.js';
import { asMoney, normalizeEntity, toReportingAmount } from './fx.js';
import { hydrateIntercompanyEntry } from './intercompany.js';

function eliminationJournalRows(lines = []) {
  return lines.filter((line) => Boolean(line.consolidationOnly) && (
    String(line.journalType || '').toUpperCase() === 'ELIMINATION'
    || String(line.sourceType || '').toUpperCase() === 'INTERCOMPANY_ELIMINATION'
  ));
}

function summarizeEliminationJournals(lines = []) {
  const rows = eliminationJournalRows(lines);
  const grouped = new Map();
  for (const line of rows) {
    const key = String(line.eliminationKey || line.sourceId || line.journalId || 'UNSCOPED');
    if (!grouped.has(key)) {
      grouped.set(key, {
        eliminationKey: line.eliminationKey || null,
        sourceId: line.sourceId || null,
        journalId: line.journalId,
        journalNumber: line.journalNumber,
        periodKey: line.periodKey || null,
        scope: line.eliminationScope || null,
        debit: 0,
        credit: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.debit = asMoney(bucket.debit + Number(line.reportingDebit || 0));
    bucket.credit = asMoney(bucket.credit + Number(line.reportingCredit || 0));
  }

  const summaryRows = [...grouped.values()].map((row) => ({
    ...row,
    amount: asMoney(Math.max(row.debit, row.credit))
  })).sort((a, b) => `${a.periodKey || ''} ${a.eliminationKey || ''}`.localeCompare(`${b.periodKey || ''} ${b.eliminationKey || ''}`));

  return {
    journalCount: new Set(rows.map((row) => row.journalId)).size,
    eliminationAmount: asMoney(summaryRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    rows: summaryRows
  };
}

function previewEliminationsFromEntityBooks(lines = []) {
  const grouped = groupTrialBalanceRows(lines.filter((line) => !line.consolidationOnly));
  return buildRelatedPartyEliminations(grouped);
}

function baseTrialBalance(db, { asOfDate = null, entity = null } = {}) {
  const rows = postedJournalLines(db, { toDate: asOfDate, entity });
  const groupedRows = groupTrialBalanceRows(rows);
  return {
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    asOfDate,
    entity: normalizeEntity(entity) || null,
    totals: {
      debit: asMoney(groupedRows.reduce((sum, row) => sum + Number(row.debit || 0), 0)),
      credit: asMoney(groupedRows.reduce((sum, row) => sum + Number(row.credit || 0), 0))
    },
    rows: groupedRows,
    journalLineCount: rows.length,
    lineRows: rows
  };
}

function supportBucketForLine(line) {
  const sourceType = String(line.sourceType || '').toUpperCase();
  const journalType = String(line.journalType || '').toUpperCase();
  if (journalType === 'ELIMINATION' || sourceType === 'INTERCOMPANY_ELIMINATION') return 'ELIMINATION';
  if (sourceType === 'RELATED_PARTY_CLEANUP') return 'ADJUSTMENT';
  if (sourceType === 'INTERCOMPANY_REPAYMENT_IN' || sourceType === 'INTERCOMPANY_REPAYMENT_OUT') return 'REPAYMENT';
  if (sourceType === 'INTERCOMPANY_FUNDING_IN' || sourceType === 'INTERCOMPANY_FUNDING_OUT') return 'SOURCE';
  if (journalType === 'ADJUSTMENT' || journalType === 'MANUAL' || journalType === 'REVERSAL') return 'ADJUSTMENT';
  return 'SOURCE';
}

const STATEMENT_LINE_MAP = {
  'balance-sheet': {
    cash: { label: 'Cash', accountCodes: ['1000', '1010'], scope: 'balance-sheet' },
    accountsReceivable: { label: 'Accounts receivable', accountCodes: ['1100'], scope: 'balance-sheet' },
    dueFromRelatedParties: { label: 'Due from related parties', accountCodes: ['1200'], scope: 'balance-sheet' },
    capitalProjects: { label: 'Capital projects', accountCodes: ['1500'], scope: 'balance-sheet' },
    accountsPayable: { label: 'Accounts payable', accountCodes: ['2000'], scope: 'balance-sheet' },
    creditCards: { label: 'Credit cards', accountCodes: ['2100'], scope: 'balance-sheet' },
    dueToRelatedParties: { label: 'Due to related parties', accountCodes: ['2200'], scope: 'balance-sheet' },
    partnerCapital: { label: 'Partner capital', accountCodes: ['3000'], scope: 'balance-sheet' }
  },
  'profit-and-loss': {
    revenueRecognized: { label: 'Revenue recognized', accountCodes: ['4000', '4100'], scope: 'profit-and-loss' },
    operatingExpenses: { label: 'Operating expenses', accountCodes: ['5000'], scope: 'profit-and-loss' },
    payrollCost: { label: 'Payroll cost', accountCodes: ['5100'], scope: 'profit-and-loss' },
    treasuryExpense: { label: 'Treasury expense', accountCodes: ['5200'], scope: 'profit-and-loss' }
  }
};

export function buildTrialBalance(db, { asOfDate = null, entity = null } = {}) {
  const targetEntity = normalizeEntity(entity) || null;
  const base = baseTrialBalance(db, { asOfDate, entity: targetEntity });
  return {
    reportingCurrency: base.reportingCurrency,
    asOfDate,
    entity: targetEntity,
    totals: base.totals,
    rows: base.rows,
    consolidatedRows: [...base.rows],
    journalLineCount: base.journalLineCount,
    eliminations: summarizeEliminationJournals(base.lineRows),
    eliminationPreview: targetEntity ? buildRelatedPartyEliminations(base.rows) : previewEliminationsFromEntityBooks(base.lineRows)
  };
}

export function buildTrialBalanceDrilldown(db, { accountCode, asOfDate = null, entity = null } = {}) {
  const normalizedCode = String(accountCode || '').trim();
  if (!normalizedCode) {
    throw new Error('accountCode is required for trial balance drilldown.');
  }

  const rows = postedJournalLines(db, { toDate: asOfDate, entity })
    .filter((line) => String(line.globalAccountCode || '') === normalizedCode)
    .sort((a, b) => `${b.postingDate || ''} ${b.journalNumber || ''} ${b.lineNumber || 0}`.localeCompare(`${a.postingDate || ''} ${a.journalNumber || ''} ${a.lineNumber || 0}`));

  const accountMeta = (db.globalChartAccounts || []).find((row) => String(row.code || '') === normalizedCode) || null;
  const tb = buildTrialBalance(db, { asOfDate, entity });
  const supportBuckets = new Map();
  for (const row of rows) {
    const key = supportBucketForLine(row);
    supportBuckets.set(key, asMoney((supportBuckets.get(key) || 0) + Math.abs(lineNetByType(row))));
  }

  return {
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    asOfDate,
    entity: normalizeEntity(entity) || null,
    accountCode: normalizedCode,
    accountName: rows[0]?.globalAccountName || accountMeta?.name || null,
    accountType: rows[0]?.globalAccountType || accountMeta?.type || null,
    totals: {
      debit: asMoney(rows.reduce((sum, row) => sum + Number(row.reportingDebit || 0), 0)),
      credit: asMoney(rows.reduce((sum, row) => sum + Number(row.reportingCredit || 0), 0)),
      net: asMoney(rows.reduce((sum, row) => sum + lineNetByType(row), 0))
    },
    eliminationContext: ['1200', '2200'].includes(normalizedCode) ? tb.eliminations : null,
    supportBuckets: [...supportBuckets.entries()].map(([bucket, amount]) => ({ bucket, amount })),
    rows: rows.map((row) => ({
      journalId: row.journalId,
      journalNumber: row.journalNumber,
      journalType: row.journalType,
      journalStatus: row.journalStatus,
      postingDate: row.postingDate,
      entity: row.entity,
      currency: row.currency,
      description: row.description,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceRootType: row.sourceRootType,
      sourceRootId: row.sourceRootId,
      sourceStage: row.sourceStage,
      lineId: row.lineId,
      lineNumber: row.lineNumber,
      reference: row.reference,
      debit: row.debit,
      credit: row.credit,
      reportingDebit: row.reportingDebit,
      reportingCredit: row.reportingCredit,
      supportBucket: supportBucketForLine(row)
    }))
  };
}

export function buildStatementDrilldown(db, {
  statement,
  lineKey,
  fromDate = null,
  toDate = null,
  entity = null
} = {}) {
  const statementKey = String(statement || '').trim().toLowerCase();
  const normalizedLineKey = String(lineKey || '').trim();
  if (statementKey === 'trial-balance') {
    return buildTrialBalanceDrilldown(db, {
      accountCode: normalizedLineKey,
      asOfDate: toDate || null,
      entity
    });
  }

  const definition = STATEMENT_LINE_MAP[statementKey]?.[normalizedLineKey];
  if (!definition) {
    throw new Error('Unsupported statement drilldown line.');
  }

  const rows = postedJournalLines(db, {
    fromDate: statementKey === 'profit-and-loss' ? fromDate : null,
    toDate: toDate || null,
    entity
  })
    .filter((line) => definition.accountCodes.includes(String(line.globalAccountCode || '')))
    .sort((a, b) => `${b.postingDate || ''} ${b.journalNumber || ''} ${b.lineNumber || 0}`.localeCompare(`${a.postingDate || ''} ${a.journalNumber || ''} ${a.lineNumber || 0}`));

  const supportBuckets = new Map();
  for (const row of rows) {
    const key = supportBucketForLine(row);
    supportBuckets.set(key, asMoney((supportBuckets.get(key) || 0) + Math.abs(lineNetByType(row))));
  }

  return {
    statement: statementKey,
    lineKey: normalizedLineKey,
    label: definition.label,
    accountCodes: definition.accountCodes,
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    fromDate,
    toDate,
    entity: normalizeEntity(entity) || null,
    totals: {
      debit: asMoney(rows.reduce((sum, row) => sum + Number(row.reportingDebit || 0), 0)),
      credit: asMoney(rows.reduce((sum, row) => sum + Number(row.reportingCredit || 0), 0)),
      net: asMoney(rows.reduce((sum, row) => sum + lineNetByType(row), 0))
    },
    supportBuckets: [...supportBuckets.entries()].map(([bucket, amount]) => ({ bucket, amount })),
    rows: rows.map((row) => ({
      journalId: row.journalId,
      journalNumber: row.journalNumber,
      journalType: row.journalType,
      journalStatus: row.journalStatus,
      postingDate: row.postingDate,
      entity: row.entity,
      currency: row.currency,
      description: row.description,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceRootType: row.sourceRootType,
      sourceRootId: row.sourceRootId,
      sourceStage: row.sourceStage,
      lineId: row.lineId,
      lineNumber: row.lineNumber,
      reference: row.reference,
      reportingDebit: row.reportingDebit,
      reportingCredit: row.reportingCredit,
      supportBucket: supportBucketForLine(row)
    }))
  };
}

export function buildProfitAndLoss(db, { fromDate = null, toDate = null, entity = null } = {}) {
  const rows = postedJournalLines(db, { fromDate, toDate, entity });
  const lines = rows.filter((row) => ['INCOME', 'EXPENSE'].includes(String(row.globalAccountType || '').toUpperCase()));
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
        amount: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.amount = asMoney(bucket.amount + lineNetByType(line));
  }

  const detail = [...grouped.values()].sort((a, b) => `${a.code || ''} ${a.name || ''}`.localeCompare(`${b.code || ''} ${b.name || ''}`));
  const revenue = asMoney(detail.filter((row) => String(row.type || '').toUpperCase() === 'INCOME').reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const expenses = asMoney(detail.filter((row) => String(row.type || '').toUpperCase() === 'EXPENSE').reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0));
  const operatingExpenses = asMoney(detail.filter((row) => ['5000'].includes(String(row.code || ''))).reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0));
  const payrollCost = asMoney(detail.filter((row) => String(row.code || '') === '5100').reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0));
  const treasuryExpense = asMoney(detail.filter((row) => String(row.code || '') === '5200').reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0));
  const partnerDraws = asMoney(rows
    .filter((row) => String(row.globalAccountCode || '') === '3000')
    .reduce((sum, row) => sum + Math.max(Number(row.reportingDebit || 0) - Number(row.reportingCredit || 0), 0), 0));
  const capex = asMoney(rows
    .filter((row) => String(row.globalAccountCode || '') === '1500')
    .reduce((sum, row) => sum + Math.max(Number(row.reportingDebit || 0) - Number(row.reportingCredit || 0), 0), 0));
  const cashCollected = asMoney((db.payments || [])
    .filter((row) => (!fromDate || String(row.paidAt || '') >= String(fromDate)) && (!toDate || String(row.paidAt || '') <= String(toDate)))
    .reduce((sum, row) => sum + toReportingAmount(db, row.amount || 0, row.currency || db.settings?.reportingCurrency || 'USD'), 0));
  const netProfit = asMoney(revenue - expenses);

  return {
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    period: { fromDate, toDate, entity: normalizeEntity(entity) || null },
    statement: {
      revenueRecognized: revenue,
      operatingExpenses,
      payrollCost,
      treasuryExpense,
      partnerDraws,
      capex,
      grossProfit: asMoney(revenue - operatingExpenses - payrollCost - treasuryExpense),
      cashCollected,
      netCashProfit: asMoney(cashCollected - operatingExpenses - payrollCost - treasuryExpense),
      netProfit
    },
    detail
  };
}

export function buildIntercompanyExposure(db, { asOfDate = null, entity = null } = {}) {
  const targetEntity = normalizeEntity(entity) || null;
  const entries = listIntercompanyEntries(db, {
    asOfDate,
    entity: targetEntity
  })
    .map((entry) => hydrateIntercompanyEntry(entry))
    .filter((entry) => Number(entry.outstandingAmount || 0) > 0.01 || Number(entry.repaidAmount || 0) > 0);

  const exposures = entries.map((entry) => {
    const reportingAmount = toReportingAmount(db, entry.amount || 0, entry.currency || db.settings?.reportingCurrency || 'USD');
    const reportingOutstandingAmount = toReportingAmount(db, entry.outstandingAmount || 0, entry.currency || db.settings?.reportingCurrency || 'USD');
    const reportingRepaidAmount = toReportingAmount(db, entry.repaidAmount || 0, entry.currency || db.settings?.reportingCurrency || 'USD');
    return {
      id: entry.id,
      date: entry.date,
      fromEntity: normalizeEntity(entry.fromEntity),
      toEntity: normalizeEntity(entry.toEntity),
      currency: String(entry.currency || db.settings?.reportingCurrency || 'USD').toUpperCase(),
      amount: asMoney(entry.amount || 0),
      repaidAmount: asMoney(entry.repaidAmount || 0),
      outstandingAmount: asMoney(entry.outstandingAmount || 0),
      reportingAmount,
      reportingRepaidAmount,
      reportingOutstandingAmount,
      reference: entry.reference || null,
      status: entry.status || 'OPEN',
      repaymentEvents: entry.repaymentEvents || []
    };
  }).filter((entry) => !targetEntity || entry.fromEntity === targetEntity || entry.toEntity === targetEntity);

  const grossDueFrom = asMoney(exposures.reduce((sum, row) => sum + Number(row.reportingOutstandingAmount || 0), 0));
  const grossDueTo = grossDueFrom;

  if (targetEntity) {
    const dueFrom = asMoney(exposures.filter((row) => row.fromEntity === targetEntity).reduce((sum, row) => sum + Number(row.reportingOutstandingAmount || 0), 0));
    const dueTo = asMoney(exposures.filter((row) => row.toEntity === targetEntity).reduce((sum, row) => sum + Number(row.reportingOutstandingAmount || 0), 0));
    return {
      reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
      entity: targetEntity,
      grossDueFrom: dueFrom,
      grossDueTo: dueTo,
      eliminationCandidate: 0,
      netConsolidatedExposure: asMoney(dueFrom - dueTo),
      byEntity: [{ entity: targetEntity, dueFrom, dueTo, net: asMoney(dueFrom - dueTo) }],
      entries: exposures
    };
  }

  const entityMap = new Map();
  for (const entry of exposures) {
    if (!entityMap.has(entry.fromEntity)) entityMap.set(entry.fromEntity, { entity: entry.fromEntity, dueFrom: 0, dueTo: 0, net: 0 });
    if (!entityMap.has(entry.toEntity)) entityMap.set(entry.toEntity, { entity: entry.toEntity, dueFrom: 0, dueTo: 0, net: 0 });
    const fromBucket = entityMap.get(entry.fromEntity);
    const toBucket = entityMap.get(entry.toEntity);
    fromBucket.dueFrom = asMoney(fromBucket.dueFrom + Number(entry.reportingOutstandingAmount || 0));
    toBucket.dueTo = asMoney(toBucket.dueTo + Number(entry.reportingOutstandingAmount || 0));
    fromBucket.net = asMoney(fromBucket.dueFrom - fromBucket.dueTo);
    toBucket.net = asMoney(toBucket.dueFrom - toBucket.dueTo);
  }

  return {
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    entity: null,
    grossDueFrom,
    grossDueTo,
    eliminationCandidate: asMoney(Math.min(grossDueFrom, grossDueTo)),
    netConsolidatedExposure: asMoney(grossDueFrom - Math.min(grossDueFrom, grossDueTo)),
    byEntity: [...entityMap.values()].sort((a, b) => String(a.entity || '').localeCompare(String(b.entity || ''))),
    entries: exposures
  };
}

export function buildBalanceSheet(db, { asOfDate = null, entity = null } = {}) {
  const targetEntity = normalizeEntity(entity) || null;
  const tb = buildTrialBalance(db, { asOfDate, entity: targetEntity });
  const balanceByCode = new Map((tb.rows || []).map((row) => [String(row.code || ''), row]));
  const exposure = buildIntercompanyExposure(db, { asOfDate, entity: targetEntity });
  const incomeBalance = asMoney((tb.rows || [])
    .filter((row) => String(row.type || '').toUpperCase() === 'INCOME')
    .reduce((sum, row) => sum + Number(row.net || 0), 0));
  const expenseBalance = asMoney((tb.rows || [])
    .filter((row) => String(row.type || '').toUpperCase() === 'EXPENSE')
    .reduce((sum, row) => sum + Number(row.net || 0), 0));
  const currentEarnings = asMoney(incomeBalance - expenseBalance);

  const cash = asMoney((balanceByCode.get('1000')?.net || 0) + (balanceByCode.get('1010')?.net || 0));
  const ar = asMoney(balanceByCode.get('1100')?.net || 0);
  const towerCapex = asMoney(balanceByCode.get('1500')?.net || 0);
  const accountsPayable = asMoney(balanceByCode.get('2000')?.net || 0);
  const creditCards = asMoney(balanceByCode.get('2100')?.net || 0);
  const partnerCapital = asMoney(balanceByCode.get('3000')?.net || 0);
  const rawJournalDueFrom = asMoney(balanceByCode.get('1200')?.net || 0);
  const rawJournalDueTo = asMoney(balanceByCode.get('2200')?.net || 0);
  const journalDueFrom = asMoney(Math.max(rawJournalDueFrom, 0) + Math.max(-rawJournalDueTo, 0));
  const journalDueTo = asMoney(Math.max(rawJournalDueTo, 0) + Math.max(-rawJournalDueFrom, 0));

  const dueFromRelatedParties = targetEntity
    ? (Math.abs(journalDueFrom) > 0.01 ? journalDueFrom : asMoney(exposure.grossDueFrom || 0))
    : asMoney(journalDueFrom);
  const dueToRelatedParties = targetEntity
    ? (Math.abs(journalDueTo) > 0.01 ? journalDueTo : asMoney(exposure.grossDueTo || 0))
    : asMoney(journalDueTo);

  const totalAssets = asMoney(cash + ar + towerCapex + dueFromRelatedParties);
  const totalLiabilities = asMoney(accountsPayable + creditCards + dueToRelatedParties);
  const totalEquity = asMoney(partnerCapital + currentEarnings);

  return {
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    asOfDate,
    entity: targetEntity,
    assets: {
      cash,
      accountsReceivable: ar,
      dueFromRelatedParties,
      capitalProjects: towerCapex,
      totalAssets
    },
    liabilities: {
      accountsPayable,
      creditCards,
      dueToRelatedParties,
      totalLiabilities
    },
    equity: {
      partnerCapital,
      currentEarnings,
      totalEquity
    },
    intercompany: exposure,
    intercompanyControl: {
      rawJournalDueFrom,
      rawJournalDueTo,
      journalDueFrom,
      journalDueTo,
      exposureDueFrom: asMoney(exposure.grossDueFrom || 0),
      exposureDueTo: asMoney(exposure.grossDueTo || 0),
      eliminationAmount: asMoney(tb.eliminations?.eliminationAmount || 0),
      eliminationPreview: asMoney(tb.eliminationPreview?.eliminationAmount || 0)
    },
    trialBalanceControl: {
      debit: tb.totals.debit,
      credit: tb.totals.credit,
      balanced: Math.abs(Number(tb.totals.debit || 0) - Number(tb.totals.credit || 0)) <= 0.01
    },
    eliminations: tb.eliminations
  };
}
