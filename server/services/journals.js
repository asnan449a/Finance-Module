import { nextId, nowIso } from '../store.js';
import { findJournalBySource, getJournalById, listJournals, listJournalsBySourceRoot, saveJournal } from '../repositories/journalRepository.js';
import { findIntercompanyRepaymentEventById } from '../repositories/intercompanyRepository.js';
import { asMoney, inferEntityFromCurrency, normalizeCurrency, normalizeEntity, rateToReporting } from './fx.js';
import { assertApprovalAction } from './approvals.js';
import { buildApprovalSnapshot, evidenceCountForEntity } from './approval-workflow.js';
import { listLinkedEvidence } from './evidence.js';
import { hydrateIntercompanyEntry, intercompanyOutstandingAmount } from './intercompany.js';
import { buildEvidenceControlState } from './record-access.js';

export const JOURNAL_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  REJECTED: 'REJECTED',
  REVERSED: 'REVERSED',
  VOID: 'VOID'
};

function defaultMemo(sourceType, sourceId) {
  return `${String(sourceType || 'journal').replace(/_/g, ' ')} ${sourceId || ''}`.trim();
}

function getGlobalAccountById(db, globalAccountId) {
  return (db.globalChartAccounts || []).find((row) => row.id === globalAccountId) || null;
}

function getGlobalAccountByCode(db, code) {
  return (db.globalChartAccounts || []).find((row) => String(row.code || '') === String(code || '')) || null;
}

function getSourceAccountById(db, sourceAccountId) {
  return (db.accounts || []).find((row) => row.id === sourceAccountId) || null;
}

function findSourceAccountByName(db, name, entity = null, currency = null) {
  const lookup = String(name || '').trim().toLowerCase();
  if (!lookup) return null;
  return (db.accounts || []).find((row) => {
    const matchesName = [row.name, row.externalName, row.externalCode].filter(Boolean).some((value) => String(value).trim().toLowerCase() === lookup);
    if (!matchesName) return false;
    if (entity && String(row.entity || '').toUpperCase() !== String(entity).toUpperCase()) return false;
    if (currency && String(row.currency || '').toUpperCase() !== String(currency).toUpperCase()) return false;
    return true;
  }) || null;
}

function businessUnitIsProduct(value) {
  const text = String(value || '').toUpperCase();
  return ['PONCHO', 'APP', 'PRODUCT', 'VENTURE'].some((token) => text.includes(token));
}

function sourceAccountRole(sourceAccount) {
  return String(sourceAccount?.accountRole || '').toUpperCase();
}

function cashOrSettlementGlobalCode(sourceAccount) {
  const role = sourceAccountRole(sourceAccount);
  if (role === 'CREDIT_CARD') return '2100';
  if (role === 'BANK' || role === 'WALLET') return '1000';
  return '1010';
}

function expenseGlobalCode(category, { capexFlag = false } = {}) {
  const text = String(category || '').toLowerCase();
  if (capexFlag || text.includes('capex') || text.includes('asset') || text.includes('tower')) return '1500';
  if (text.includes('payroll') || text.includes('salary') || text.includes('wage')) return '5100';
  if (text.includes('bank fee') || text.includes('fx') || text.includes('charge')) return '5200';
  return '5000';
}

function ensureJournalCollection(db) {
  if (!Array.isArray(db.journals)) db.journals = [];
}

function journalNumber(db) {
  db.sequences = db.sequences || {};
  const configured = Number(db.sequences.JOURNAL_NUMBER);
  const seed = Number.isFinite(configured) && configured > 0
    ? configured
    : Math.max(Number(db.sequences.JOURNAL || 100) - 1, 100);
  db.sequences.JOURNAL_NUMBER = seed + 1;
  return `JRN-${String(db.sequences.JOURNAL_NUMBER).padStart(5, '0')}`;
}

function normalizeLine(db, line, { journalCurrency, entity, lineNumber }) {
  const globalAccount = line.globalAccountId
    ? getGlobalAccountById(db, line.globalAccountId)
    : line.globalAccountCode
      ? getGlobalAccountByCode(db, line.globalAccountCode)
      : null;
  if (!globalAccount) {
    throw new Error(`Global account is required for journal line ${lineNumber}.`);
  }

  const debit = asMoney(line.debit || 0);
  const credit = asMoney(line.credit || 0);
  if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
    throw new Error(`Journal line ${lineNumber} must contain either a debit or a credit.`);
  }

  return {
    id: line.id || nextId(db, 'JOURNAL_LINE', 'JRL'),
    lineNumber,
    globalAccountId: globalAccount.id,
    globalAccountCode: globalAccount.code,
    globalAccountName: globalAccount.name,
    globalAccountType: globalAccount.type,
    description: line.description || globalAccount.name,
    entity: normalizeEntity(line.entity) || normalizeEntity(entity) || null,
    currency: normalizeCurrency(line.currency || journalCurrency),
    sourceAccountId: line.sourceAccountId || null,
    reference: line.reference || null,
    debit,
    credit,
    reportingRate: rateToReporting(db, line.currency || journalCurrency),
    createdAt: line.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function journalTotals(lines) {
  const totalDebit = asMoney((lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const totalCredit = asMoney((lines || []).reduce((sum, line) => sum + Number(line.credit || 0), 0));
  return {
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) <= 0.01
  };
}

function hydrateJournal(db, journal) {
  const lines = (journal.lines || []).map((line) => {
    const global = getGlobalAccountById(db, line.globalAccountId) || getGlobalAccountByCode(db, line.globalAccountCode);
    return {
      ...line,
      globalAccountCode: line.globalAccountCode || global?.code || null,
      globalAccountName: line.globalAccountName || global?.name || null,
      globalAccountType: line.globalAccountType || global?.type || null
    };
  }).sort((a, b) => Number(a.lineNumber || 0) - Number(b.lineNumber || 0));
  const totals = journalTotals(lines);
  return {
    ...journal,
    sourceRootType: journal.sourceRootType || journal.sourceType || 'MANUAL',
    sourceRootId: journal.sourceRootId || journal.sourceId || null,
    sourceStage: journal.sourceStage || null,
    consolidationOnly: Boolean(journal.consolidationOnly),
    periodKey: journal.periodKey || null,
    eliminationKey: journal.eliminationKey || null,
    eliminationScope: journal.eliminationScope || null,
    cleanupKey: journal.cleanupKey || null,
    postingKey: journal.postingKey || (journal.sourceType && journal.sourceId ? `${journal.sourceType}:${journal.sourceId}` : null),
    approvalStatus: ['POSTED', 'APPROVED', 'REVERSED'].includes(String(journal.status || '').toUpperCase())
      ? 'APPROVED'
      : (String(journal.status || '').toUpperCase() === 'REJECTED' ? 'REJECTED'
        : (String(journal.status || '').toUpperCase() === 'PENDING_APPROVAL' ? 'PENDING' : 'DRAFT')),
    lines,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
    balanced: totals.balanced,
    lineCount: lines.length
  };
}

function buildJournalHistory(journal) {
  return [
    journal.createdAt ? { key: 'created', label: 'Created', at: journal.createdAt, userId: journal.createdByUserId || null } : null,
    journal.submittedAt ? { key: 'submitted', label: 'Submitted', at: journal.submittedAt, userId: journal.createdByUserId || null } : null,
    journal.approvedAt ? { key: 'approved', label: 'Approved', at: journal.approvedAt, userId: journal.approvedByUserId || null } : null,
    journal.postedAt ? { key: 'posted', label: 'Posted', at: journal.postedAt, userId: journal.postedByUserId || null } : null,
    journal.reversedAt ? { key: 'reversed', label: 'Reversed', at: journal.reversedAt, userId: null } : null,
    journal.rejectedByUserId ? { key: 'rejected', label: 'Rejected', at: journal.updatedAt || journal.createdAt || null, userId: journal.rejectedByUserId || null, note: journal.rejectionReason || null } : null
  ].filter(Boolean);
}

function decorateJournalDetail(db, journal) {
  const hydrated = hydrateJournal(db, journal);
  const related = listJournalsBySourceRoot(db, {
    sourceRootType: hydrated.sourceRootType,
    sourceRootId: hydrated.sourceRootId
  }).filter((row) => row.id !== hydrated.id).map((row) => hydrateJournal(db, row));

  return {
    ...hydrated,
    evidenceRecords: listLinkedEvidence(db, { entityType: 'JOURNAL', entityId: hydrated.id }),
    evidenceControl: buildEvidenceControlState(db, { entityType: 'JOURNAL', entityId: hydrated.id }),
    approval: buildApprovalSnapshot(db, {
      documentType: 'JOURNAL',
      entityType: 'JOURNAL',
      entityId: hydrated.id,
      entity: hydrated.entity,
      amount: Math.max(Number(hydrated.totalDebit || 0), Number(hydrated.totalCredit || 0)),
      operationalStatus: hydrated.status,
      approvalStatus: hydrated.approvalStatus,
      createdByUserId: hydrated.createdByUserId,
      approvedByUserId: hydrated.approvedByUserId
    }),
    statusHistory: buildJournalHistory(hydrated),
    sourceLinkage: {
      sourceType: hydrated.sourceType,
      sourceId: hydrated.sourceId,
      sourceRootType: hydrated.sourceRootType,
      sourceRootId: hydrated.sourceRootId,
      sourceStage: hydrated.sourceStage
    },
    relatedJournals: related
  };
}

function persistJournal(db, journal) {
  ensureJournalCollection(db);
  journal.updatedAt = nowIso();
  saveJournal(db, journal);
  return hydrateJournal(db, journal);
}

export function listJournalRegister(db, filters = {}) {
  return listJournals(db, filters).map((journal) => ({
    ...hydrateJournal(db, journal),
    evidenceRecords: listLinkedEvidence(db, { entityType: 'JOURNAL', entityId: journal.id }),
    evidenceControl: buildEvidenceControlState(db, { entityType: 'JOURNAL', entityId: journal.id })
  }));
}

export function getJournalDetail(db, journalId) {
  const journal = getJournalById(db, journalId);
  return journal ? decorateJournalDetail(db, journal) : null;
}

export function createManualJournal(db, payload, actorUserId) {
  ensureJournalCollection(db);
  const postingDate = String(payload.postingDate || '').trim();
  if (!postingDate) throw new Error('postingDate is required.');
  const currency = normalizeCurrency(payload.currency || db.settings?.reportingCurrency || 'USD');
  const entity = normalizeEntity(payload.entity) || inferEntityFromCurrency(db, currency) || 'US';
  const lines = (payload.lines || []).map((line, index) => normalizeLine(db, line, {
    journalCurrency: currency,
    entity,
    lineNumber: index + 1
  }));
  if (lines.length < 2) throw new Error('At least two journal lines are required.');
  const totals = journalTotals(lines);
  if (!totals.balanced) throw new Error('Journal is not balanced.');

  const row = {
    id: nextId(db, 'JOURNAL', 'JRN'),
    journalNumber: journalNumber(db),
    journalType: String(payload.journalType || 'MANUAL').toUpperCase(),
    sourceType: payload.sourceType || 'MANUAL',
    sourceId: payload.sourceId || null,
    sourceRootType: payload.sourceRootType || payload.sourceType || 'MANUAL',
    sourceRootId: payload.sourceRootId || payload.sourceId || null,
    sourceStage: payload.sourceStage || null,
    consolidationOnly: Boolean(payload.consolidationOnly),
    periodKey: payload.periodKey || null,
    eliminationKey: payload.eliminationKey || null,
    eliminationScope: payload.eliminationScope || null,
    cleanupKey: payload.cleanupKey || null,
    postingKey: payload.postingKey || ((payload.sourceType || payload.sourceId) ? `${payload.sourceType || 'MANUAL'}:${payload.sourceId || 'UNSCOPED'}` : null),
    entity,
    currency,
    postingDate,
    memo: payload.memo || '',
    status: JOURNAL_STATUS.DRAFT,
    createdByUserId: actorUserId,
    approvedByUserId: null,
    postedByUserId: null,
    rejectedByUserId: null,
    rejectionReason: null,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    reversedAt: null,
    sourceJournalId: payload.sourceJournalId || null,
    autoGenerated: false,
    lines,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    submittedAt: null,
    approvedAt: null,
    postedAt: null
  };

  return persistJournal(db, row);
}

export function createAutoPostedJournal(db, payload, actorUserId) {
  ensureJournalCollection(db);
  const postingDate = String(payload.postingDate || '').trim();
  if (!postingDate) throw new Error('postingDate is required.');
  const currency = normalizeCurrency(payload.currency || db.settings?.reportingCurrency || 'USD');
  const entity = normalizeEntity(payload.entity) || null;
  const lines = (payload.lines || []).map((line, index) => normalizeLine(db, line, {
    journalCurrency: currency,
    entity,
    lineNumber: index + 1
  }));
  if (lines.length < 2) throw new Error('At least two journal lines are required.');
  const totals = journalTotals(lines);
  if (!totals.balanced) throw new Error('Journal is not balanced.');

  const row = {
    id: nextId(db, 'JOURNAL', 'JRN'),
    journalNumber: journalNumber(db),
    journalType: String(payload.journalType || 'SYSTEM').toUpperCase(),
    sourceType: payload.sourceType || 'SYSTEM',
    sourceId: payload.sourceId || null,
    sourceRootType: payload.sourceRootType || payload.sourceType || 'SYSTEM',
    sourceRootId: payload.sourceRootId || payload.sourceId || null,
    sourceStage: payload.sourceStage || null,
    sourceJournalId: payload.sourceJournalId || null,
    consolidationOnly: Boolean(payload.consolidationOnly),
    periodKey: payload.periodKey || null,
    eliminationKey: payload.eliminationKey || null,
    eliminationScope: payload.eliminationScope || null,
    cleanupKey: payload.cleanupKey || null,
    postingKey: payload.postingKey || ((payload.sourceType || payload.sourceId) ? `${payload.sourceType || 'SYSTEM'}:${payload.sourceId || 'UNSCOPED'}` : null),
    entity,
    currency,
    postingDate,
    memo: payload.memo || '',
    status: JOURNAL_STATUS.POSTED,
    createdByUserId: actorUserId || null,
    approvedByUserId: actorUserId || null,
    postedByUserId: actorUserId || null,
    rejectedByUserId: null,
    rejectionReason: null,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    reversedAt: null,
    autoGenerated: payload.autoGenerated !== undefined ? Boolean(payload.autoGenerated) : true,
    lines,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    submittedAt: nowIso(),
    approvedAt: nowIso(),
    postedAt: nowIso()
  };

  return persistJournal(db, row);
}

export function submitJournal(db, journalId, actorUserId) {
  const journal = getJournalById(db, journalId);
  if (!journal) throw new Error('Journal not found.');
  if (![JOURNAL_STATUS.DRAFT, JOURNAL_STATUS.REJECTED].includes(String(journal.status || '').toUpperCase())) {
    throw new Error('Only draft or rejected journals can be submitted.');
  }
  journal.status = JOURNAL_STATUS.PENDING_APPROVAL;
  journal.rejectionReason = null;
  journal.rejectedByUserId = null;
  journal.submittedAt = nowIso();
  journal.updatedAt = nowIso();
  return persistJournal(db, journal);
}

export function rejectJournal(db, journalId, actor, reason = 'Needs correction') {
  const journal = getJournalById(db, journalId);
  if (!journal) throw new Error('Journal not found.');
  const evidenceCount = evidenceCountForEntity(db, { entityType: 'JOURNAL', entityId: journal.id });
  const approvalError = assertApprovalAction(db, {
    documentType: 'JOURNAL',
    action: 'REJECT',
    entity: journal.entity,
    amount: Math.max(Number(hydrateJournal(db, journal).totalDebit || 0), Number(hydrateJournal(db, journal).totalCredit || 0)),
    actorRole: actor.role,
    actorUserId: actor.id,
    createdByUserId: journal.createdByUserId,
    approvedByUserId: journal.approvedByUserId,
    evidenceCount
  });
  if (approvalError) throw new Error(approvalError);
  journal.status = JOURNAL_STATUS.REJECTED;
  journal.rejectedByUserId = actor.id;
  journal.rejectionReason = reason;
  journal.updatedAt = nowIso();
  return persistJournal(db, journal);
}

export function approveJournal(db, journalId, actor) {
  const journal = getJournalById(db, journalId);
  if (!journal) throw new Error('Journal not found.');
  if (!['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(String(journal.status || '').toUpperCase())) {
    throw new Error('Journal is not awaiting approval.');
  }
  const totals = journalTotals(journal.lines || []);
  const evidenceCount = evidenceCountForEntity(db, { entityType: 'JOURNAL', entityId: journal.id });
  const approvalError = assertApprovalAction(db, {
    documentType: 'JOURNAL',
    action: 'APPROVE',
    entity: journal.entity,
    amount: Math.max(totals.totalDebit, totals.totalCredit),
    actorRole: actor.role,
    actorUserId: actor.id,
    createdByUserId: journal.createdByUserId,
    approvedByUserId: journal.approvedByUserId,
    evidenceCount
  });
  if (approvalError) throw new Error(approvalError);
  journal.status = JOURNAL_STATUS.APPROVED;
  journal.approvedByUserId = actor.id;
  journal.approvedAt = nowIso();
  journal.rejectionReason = null;
  return persistJournal(db, journal);
}

export function postJournal(db, journalId, actor) {
  const journal = getJournalById(db, journalId);
  if (!journal) throw new Error('Journal not found.');
  if (String(journal.status || '').toUpperCase() !== JOURNAL_STATUS.APPROVED) {
    throw new Error('Only approved journals can be posted.');
  }
  const totals = journalTotals(journal.lines || []);
  if (!totals.balanced) throw new Error('Cannot post an unbalanced journal.');
  const evidenceCount = evidenceCountForEntity(db, { entityType: 'JOURNAL', entityId: journal.id });
  const approvalError = assertApprovalAction(db, {
    documentType: 'JOURNAL',
    action: 'POST',
    entity: journal.entity,
    amount: Math.max(totals.totalDebit, totals.totalCredit),
    actorRole: actor.role,
    actorUserId: actor.id,
    createdByUserId: journal.createdByUserId,
    approvedByUserId: journal.approvedByUserId,
    evidenceCount
  });
  if (approvalError) throw new Error(approvalError);
  journal.status = JOURNAL_STATUS.POSTED;
  journal.postedByUserId = actor.id;
  journal.postedAt = nowIso();
  return persistJournal(db, journal);
}

export function reverseJournal(db, journalId, actor, { postingDate, memo = '' } = {}) {
  const original = getJournalById(db, journalId);
  if (!original) throw new Error('Journal not found.');
  if (String(original.status || '').toUpperCase() !== JOURNAL_STATUS.POSTED) {
    throw new Error('Only posted journals can be reversed.');
  }
  if (original.reversedByJournalId) throw new Error('Journal has already been reversed.');

  const reverseDate = String(postingDate || original.postingDate || '').trim();
  if (!reverseDate) throw new Error('postingDate is required for reversal.');

  const lines = (original.lines || []).map((line, index) => ({
    ...line,
    id: nextId(db, 'JOURNAL_LINE', 'JRL'),
    lineNumber: index + 1,
    debit: asMoney(line.credit || 0),
    credit: asMoney(line.debit || 0),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));

  const reversal = {
    id: nextId(db, 'JOURNAL', 'JRN'),
    journalNumber: journalNumber(db),
    journalType: 'REVERSAL',
    sourceType: 'JOURNAL_REVERSAL',
    sourceId: original.id,
    sourceJournalId: original.id,
    entity: original.entity,
    currency: original.currency,
    postingDate: reverseDate,
    memo: memo || `Reversal of ${original.journalNumber}`,
    status: JOURNAL_STATUS.POSTED,
    createdByUserId: actor.id,
    approvedByUserId: actor.id,
    postedByUserId: actor.id,
    rejectedByUserId: null,
    rejectionReason: null,
    reversalOfJournalId: original.id,
    reversedByJournalId: null,
    reversedAt: null,
    autoGenerated: false,
    lines,
    submittedAt: nowIso(),
    approvedAt: nowIso(),
    postedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  original.reversedByJournalId = reversal.id;
  original.reversedAt = nowIso();
  original.status = JOURNAL_STATUS.REVERSED;
  persistJournal(db, original);
  const saved = persistJournal(db, reversal);
  return { original: hydrateJournal(db, original), reversal: saved };
}

function buildLineFromCode(db, { code, debit = 0, credit = 0, description, entity, currency, sourceAccountId = null }) {
  const global = getGlobalAccountByCode(db, code);
  if (!global) throw new Error(`Global account code ${code} not found.`);
  return {
    id: nextId(db, 'JOURNAL_LINE', 'JRL'),
    lineNumber: 0,
    globalAccountId: global.id,
    globalAccountCode: global.code,
    globalAccountName: global.name,
    globalAccountType: global.type,
    description: description || global.name,
    entity: normalizeEntity(entity) || null,
    currency: normalizeCurrency(currency),
    sourceAccountId,
    reference: null,
    debit: asMoney(debit),
    credit: asMoney(credit),
    reportingRate: rateToReporting(db, currency),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export function buildJournalLineFromCode(db, spec) {
  return buildLineFromCode(db, spec);
}

function finalizeSystemLines(lines) {
  return lines
    .map((line, index) => ({ ...line, lineNumber: index + 1, updatedAt: nowIso() }))
    .filter((line) => Number(line.debit || 0) > 0 || Number(line.credit || 0) > 0);
}

function invoiceJournalSpec(db, invoice) {
  if (!invoice || !['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase())) return null;
  const revenueCode = businessUnitIsProduct(invoice.businessUnit) ? '4100' : '4000';
  const amount = asMoney(invoice.total || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'INVOICE',
    sourceId: invoice.id,
    sourceRootType: 'INVOICE',
    sourceRootId: invoice.id,
    sourceStage: 'REVENUE_RECOGNITION',
    journalType: 'SYSTEM',
    entity: normalizeEntity(invoice.entity) || inferEntityFromCurrency(db, invoice.currency) || 'US',
    currency: normalizeCurrency(invoice.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: invoice.issueDate,
    memo: `Invoice ${invoice.invoiceNumber || invoice.id}`,
    createdByUserId: invoice.createdByUserId || null,
    approvedByUserId: invoice.approvedByUserId || invoice.createdByUserId || null,
    postedByUserId: invoice.approvedByUserId || invoice.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '1100', debit: amount, description: `AR ${invoice.invoiceNumber || invoice.id}`, entity: invoice.entity, currency: invoice.currency }),
      buildLineFromCode(db, { code: revenueCode, credit: amount, description: `Revenue ${invoice.invoiceNumber || invoice.id}`, entity: invoice.entity, currency: invoice.currency })
    ])
  };
}

function paymentJournalSpec(db, payment) {
  if (!payment) return null;
  const invoice = (db.invoices || []).find((row) => row.id === payment.invoiceId);
  if (!invoice) return null;
  const sourceAccount = payment.sourceAccountId ? getSourceAccountById(db, payment.sourceAccountId) : null;
  const cashCode = cashOrSettlementGlobalCode(sourceAccount);
  const amount = asMoney(payment.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'INVOICE_PAYMENT',
    sourceId: payment.id,
    sourceRootType: 'INVOICE',
    sourceRootId: invoice.id,
    sourceStage: 'CASH_APPLICATION',
    journalType: 'SYSTEM',
    entity: normalizeEntity(invoice.entity) || inferEntityFromCurrency(db, payment.currency || invoice.currency) || 'US',
    currency: normalizeCurrency(payment.currency || invoice.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: payment.paidAt,
    memo: `Receipt ${invoice.invoiceNumber || invoice.id}`,
    createdByUserId: payment.createdByUserId || invoice.createdByUserId || null,
    approvedByUserId: payment.createdByUserId || invoice.approvedByUserId || invoice.createdByUserId || null,
    postedByUserId: payment.createdByUserId || invoice.approvedByUserId || invoice.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: cashCode, debit: amount, description: `Receipt ${payment.reference || payment.id}`, entity: invoice.entity, currency: payment.currency || invoice.currency, sourceAccountId: sourceAccount?.id || null }),
      buildLineFromCode(db, { code: '1100', credit: amount, description: `AR clearance ${invoice.invoiceNumber || invoice.id}`, entity: invoice.entity, currency: payment.currency || invoice.currency })
    ])
  };
}

function vendorBillJournalSpec(db, bill) {
  if (!bill || !['APPROVED', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE'].includes(String(bill.status || '').toUpperCase())) return null;
  const lines = [];
  const billLines = Array.isArray(bill.lineItems) && bill.lineItems.length
    ? bill.lineItems
    : [{ description: bill.billNumber || bill.id, amount: bill.total || 0, category: bill.category, capexFlag: false }];
  for (const line of billLines) {
    const amount = asMoney(line.amount || 0);
    if (amount <= 0) continue;
    lines.push(buildLineFromCode(db, {
      code: expenseGlobalCode(line.category || bill.category, { capexFlag: Boolean(line.capexFlag) }),
      debit: amount,
      description: line.description || `Bill ${bill.billNumber || bill.id}`,
      entity: bill.entity,
      currency: bill.currency
    }));
  }
  const total = asMoney((billLines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0) || bill.total || 0);
  if (total <= 0 || !lines.length) return null;
  lines.push(buildLineFromCode(db, {
    code: '2000',
    credit: total,
    description: `AP ${bill.billNumber || bill.id}`,
    entity: bill.entity,
    currency: bill.currency
  }));
  return {
    sourceType: 'VENDOR_BILL',
    sourceId: bill.id,
    sourceRootType: 'VENDOR_BILL',
    sourceRootId: bill.id,
    sourceStage: 'OBLIGATION_RECOGNITION',
    journalType: 'SYSTEM',
    entity: normalizeEntity(bill.entity) || inferEntityFromCurrency(db, bill.currency) || 'US',
    currency: normalizeCurrency(bill.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: bill.billDate,
    memo: `Vendor bill ${bill.billNumber || bill.id}`,
    createdByUserId: bill.createdByUserId || null,
    approvedByUserId: bill.approvedByUserId || bill.createdByUserId || null,
    postedByUserId: bill.approvedByUserId || bill.createdByUserId || null,
    lines: finalizeSystemLines(lines)
  };
}

function vendorPaymentJournalSpec(db, bill, payment) {
  if (!bill || !payment) return null;
  const sourceAccount = payment.sourceAccountId ? getSourceAccountById(db, payment.sourceAccountId) : null;
  const cashCode = cashOrSettlementGlobalCode(sourceAccount);
  const amount = asMoney(payment.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'VENDOR_PAYMENT',
    sourceId: payment.id,
    sourceRootType: 'VENDOR_BILL',
    sourceRootId: bill.id,
    sourceStage: 'SETTLEMENT',
    journalType: 'SYSTEM',
    entity: normalizeEntity(bill.entity) || inferEntityFromCurrency(db, payment.currency || bill.currency) || 'US',
    currency: normalizeCurrency(payment.currency || bill.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: payment.date,
    memo: `Vendor payment ${bill.billNumber || bill.id}`,
    createdByUserId: payment.createdByUserId || bill.createdByUserId || null,
    approvedByUserId: payment.createdByUserId || bill.approvedByUserId || bill.createdByUserId || null,
    postedByUserId: payment.createdByUserId || bill.approvedByUserId || bill.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '2000', debit: amount, description: `AP settlement ${bill.billNumber || bill.id}`, entity: bill.entity, currency: payment.currency || bill.currency }),
      buildLineFromCode(db, { code: cashCode, credit: amount, description: `Cash payment ${payment.reference || payment.id}`, entity: bill.entity, currency: payment.currency || bill.currency, sourceAccountId: sourceAccount?.id || null })
    ])
  };
}

function expenseJournalSpec(db, expense) {
  if (!expense) return null;
  if (String(expense.approvalStatus || '').toUpperCase() !== 'APPROVED') return null;
  const amount = asMoney(expense.amount || 0);
  if (amount <= 0) return null;
  const sourceAccount = expense.sourceAccountId ? getSourceAccountById(db, expense.sourceAccountId) : null;
  const creditCode = expense.reimbursementNeeded || expense.employeeId ? '2000' : cashOrSettlementGlobalCode(sourceAccount);
  return {
    sourceType: 'EXPENSE',
    sourceId: expense.id,
    sourceRootType: 'EXPENSE',
    sourceRootId: expense.id,
    sourceStage: 'RECOGNITION',
    journalType: 'SYSTEM',
    entity: normalizeEntity(expense.entity) || inferEntityFromCurrency(db, expense.currency) || 'US',
    currency: normalizeCurrency(expense.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: expense.date,
    memo: expense.description || defaultMemo('expense', expense.id),
    createdByUserId: expense.createdByUserId || null,
    approvedByUserId: expense.createdByUserId || null,
    postedByUserId: expense.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: expenseGlobalCode(expense.category, { capexFlag: Boolean(expense.capexFlag) }), debit: amount, description: expense.description, entity: expense.entity, currency: expense.currency }),
      buildLineFromCode(db, { code: creditCode, credit: amount, description: `Offset ${expense.id}`, entity: expense.entity, currency: expense.currency, sourceAccountId: sourceAccount?.id || null })
    ])
  };
}

function reimbursementJournalSpec(db, expense) {
  if (!expense || String(expense.reimbursementStatus || '').toUpperCase() !== 'REIMBURSED') return null;
  if (String(expense.approvalStatus || '').toUpperCase() !== 'APPROVED') return null;
  const amount = asMoney(expense.amount || 0);
  if (amount <= 0) return null;
  const sourceAccount = expense.reimbursementAccount
    ? findSourceAccountByName(db, expense.reimbursementAccount, expense.entity, expense.currency)
    : null;
  const cashCode = cashOrSettlementGlobalCode(sourceAccount);
  return {
    sourceType: 'REIMBURSEMENT',
    sourceId: expense.id,
    sourceRootType: 'EXPENSE',
    sourceRootId: expense.id,
    sourceStage: 'SETTLEMENT',
    journalType: 'SYSTEM',
    entity: normalizeEntity(expense.entity) || inferEntityFromCurrency(db, expense.currency) || 'US',
    currency: normalizeCurrency(expense.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: expense.reimbursedAt || expense.date,
    memo: `Reimbursement ${expense.id}`,
    createdByUserId: expense.createdByUserId || null,
    approvedByUserId: expense.createdByUserId || null,
    postedByUserId: expense.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '2000', debit: amount, description: `Reimbursement payable ${expense.id}`, entity: expense.entity, currency: expense.currency }),
      buildLineFromCode(db, { code: cashCode, credit: amount, description: `Reimbursement cash ${expense.id}`, entity: expense.entity, currency: expense.currency, sourceAccountId: sourceAccount?.id || null })
    ])
  };
}

function partnerDrawJournalSpec(db, draw) {
  if (!draw) return null;
  const amount = asMoney(draw.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'PARTNER_DRAW',
    sourceId: draw.id,
    sourceRootType: 'PARTNER_DRAW',
    sourceRootId: draw.id,
    sourceStage: 'DRAW',
    journalType: 'SYSTEM',
    entity: normalizeEntity(draw.entity) || inferEntityFromCurrency(db, draw.currency) || 'US',
    currency: normalizeCurrency(draw.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: draw.date,
    memo: `Partner draw ${draw.id}`,
    createdByUserId: draw.createdByUserId || null,
    approvedByUserId: draw.createdByUserId || null,
    postedByUserId: draw.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '3000', debit: amount, description: `Partner draw ${draw.id}`, entity: draw.entity, currency: draw.currency }),
      buildLineFromCode(db, { code: '1000', credit: amount, description: `Cash draw ${draw.id}`, entity: draw.entity, currency: draw.currency })
    ])
  };
}

function asarCostJournalSpec(db, cost) {
  if (!cost) return null;
  const amount = asMoney(cost.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'ASAR_COST',
    sourceId: cost.id,
    sourceRootType: 'ASAR_COST',
    sourceRootId: cost.id,
    sourceStage: 'CAPITALIZATION',
    journalType: 'SYSTEM',
    entity: normalizeEntity(cost.entity) || inferEntityFromCurrency(db, cost.currency) || 'PK',
    currency: normalizeCurrency(cost.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: cost.date,
    memo: cost.description || `ASAR cost ${cost.id}`,
    createdByUserId: cost.createdByUserId || null,
    approvedByUserId: cost.createdByUserId || null,
    postedByUserId: cost.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '1500', debit: amount, description: cost.description || `ASAR ${cost.id}`, entity: cost.entity, currency: cost.currency }),
      buildLineFromCode(db, { code: '2000', credit: amount, description: `AP ${cost.id}`, entity: cost.entity, currency: cost.currency })
    ])
  };
}

function payrollRunJournalSpec(db, run, items) {
  if (!run) return null;
  const amount = asMoney(run.totalNet || 0);
  if (amount <= 0) return null;
  const currency = normalizeCurrency(items?.[0]?.currency || db.settings?.reportingCurrency || 'USD');
  const entity = normalizeEntity(items?.[0]?.entity) || inferEntityFromCurrency(db, currency) || 'PK';
  const postingDate = `${run.year}-${String(run.month).padStart(2, '0')}-01`;
  return {
    sourceType: 'PAYROLL_RUN',
    sourceId: run.id,
    sourceRootType: 'PAYROLL_RUN',
    sourceRootId: run.id,
    sourceStage: 'PAYROLL_ACCRUAL',
    journalType: 'SYSTEM',
    entity,
    currency,
    postingDate,
    memo: `Payroll ${run.month}/${run.year}`,
    createdByUserId: run.createdByUserId || null,
    approvedByUserId: run.createdByUserId || null,
    postedByUserId: run.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '5100', debit: amount, description: `Payroll ${run.month}/${run.year}`, entity, currency }),
      buildLineFromCode(db, { code: '2000', credit: amount, description: `Payroll payable ${run.month}/${run.year}`, entity, currency })
    ])
  };
}

function ponchoSettlementJournalSpec(db, settlement) {
  if (!settlement) return null;
  const amount = asMoney(settlement.amount || 0);
  if (!amount) return null;
  const positive = amount > 0;
  return {
    sourceType: 'PONCHO_SETTLEMENT',
    sourceId: settlement.id,
    sourceRootType: 'PONCHO_SETTLEMENT',
    sourceRootId: settlement.id,
    sourceStage: positive ? 'SETTLEMENT_INFLOW' : 'SETTLEMENT_ADJUSTMENT',
    journalType: 'SYSTEM',
    entity: normalizeEntity(settlement.entity) || inferEntityFromCurrency(db, settlement.currency) || 'UK',
    currency: normalizeCurrency(settlement.currency || db.settings?.reportingCurrency || 'USD'),
    postingDate: settlement.date,
    memo: `Poncho settlement ${settlement.reference || settlement.id}`,
    createdByUserId: settlement.createdByUserId || null,
    approvedByUserId: settlement.createdByUserId || null,
    postedByUserId: settlement.createdByUserId || null,
    lines: finalizeSystemLines(positive
      ? [
        buildLineFromCode(db, { code: '1010', debit: amount, description: `Settlement clearing ${settlement.reference || settlement.id}`, entity: settlement.entity, currency: settlement.currency }),
        buildLineFromCode(db, { code: '4100', credit: amount, description: `Product revenue ${settlement.reference || settlement.id}`, entity: settlement.entity, currency: settlement.currency })
      ]
      : [
        buildLineFromCode(db, { code: '5000', debit: Math.abs(amount), description: `Settlement adjustment ${settlement.reference || settlement.id}`, entity: settlement.entity, currency: settlement.currency }),
        buildLineFromCode(db, { code: '1010', credit: Math.abs(amount), description: `Settlement clearing ${settlement.reference || settlement.id}`, entity: settlement.entity, currency: settlement.currency })
      ])
  };
}

function intercompanyFundingLenderJournalSpec(db, entry) {
  const row = hydrateIntercompanyEntry(entry);
  if (!row || String(row.status || '').toUpperCase() === 'REPAID' && Number(row.amount || 0) <= 0) return null;
  const sourceAccount = row.sourceAccountId ? getSourceAccountById(db, row.sourceAccountId) : null;
  const cashCode = cashOrSettlementGlobalCode(sourceAccount);
  const amount = asMoney(row.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'INTERCOMPANY_FUNDING_OUT',
    sourceId: row.id,
    sourceRootType: 'INTERCOMPANY',
    sourceRootId: row.id,
    sourceStage: 'FUNDING_OUT',
    journalType: 'SYSTEM',
    entity: row.fromEntity,
    currency: row.currency,
    postingDate: row.date,
    memo: `Intercompany funding out ${row.reference || row.id}`,
    createdByUserId: row.createdByUserId || null,
    approvedByUserId: row.createdByUserId || null,
    postedByUserId: row.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '1200', debit: amount, description: `Due from ${row.toEntity} ${row.reference || row.id}`, entity: row.fromEntity, currency: row.currency }),
      buildLineFromCode(db, { code: cashCode, credit: amount, description: `Funding cash ${row.reference || row.id}`, entity: row.fromEntity, currency: row.currency, sourceAccountId: sourceAccount?.id || null })
    ])
  };
}

function intercompanyFundingBorrowerJournalSpec(db, entry) {
  const row = hydrateIntercompanyEntry(entry);
  const sourceAccount = row.receivingSourceAccountId ? getSourceAccountById(db, row.receivingSourceAccountId) : null;
  const cashCode = sourceAccount ? cashOrSettlementGlobalCode(sourceAccount) : '1010';
  const amount = asMoney(row.amount || 0);
  if (amount <= 0) return null;
  return {
    sourceType: 'INTERCOMPANY_FUNDING_IN',
    sourceId: row.id,
    sourceRootType: 'INTERCOMPANY',
    sourceRootId: row.id,
    sourceStage: 'FUNDING_IN',
    journalType: 'SYSTEM',
    entity: row.toEntity,
    currency: row.currency,
    postingDate: row.date,
    memo: `Intercompany funding in ${row.reference || row.id}`,
    createdByUserId: row.createdByUserId || null,
    approvedByUserId: row.createdByUserId || null,
    postedByUserId: row.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: cashCode, debit: amount, description: `Funding receipt ${row.reference || row.id}`, entity: row.toEntity, currency: row.currency, sourceAccountId: sourceAccount?.id || null }),
      buildLineFromCode(db, { code: '2200', credit: amount, description: `Due to ${row.fromEntity} ${row.reference || row.id}`, entity: row.toEntity, currency: row.currency })
    ])
  };
}

function intercompanyRepaymentOutJournalSpec(db, event, entry) {
  const row = hydrateIntercompanyEntry(entry);
  const payment = event || null;
  if (!payment) return null;
  const amount = asMoney(payment.amount || 0);
  if (amount <= 0) return null;
  const sourceAccount = payment.sourceAccountId ? getSourceAccountById(db, payment.sourceAccountId) : null;
  const cashCode = cashOrSettlementGlobalCode(sourceAccount);
  return {
    sourceType: 'INTERCOMPANY_REPAYMENT_OUT',
    sourceId: payment.id,
    sourceRootType: 'INTERCOMPANY',
    sourceRootId: row.id,
    sourceStage: 'REPAYMENT_OUT',
    journalType: 'SYSTEM',
    entity: row.toEntity,
    currency: payment.currency || row.currency,
    postingDate: payment.date,
    memo: `Intercompany repayment out ${payment.reference || payment.id}`,
    createdByUserId: payment.createdByUserId || row.createdByUserId || null,
    approvedByUserId: payment.createdByUserId || row.createdByUserId || null,
    postedByUserId: payment.createdByUserId || row.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: '2200', debit: amount, description: `Repay ${row.fromEntity} ${payment.reference || payment.id}`, entity: row.toEntity, currency: payment.currency || row.currency }),
      buildLineFromCode(db, { code: cashCode, credit: amount, description: `Repayment cash ${payment.reference || payment.id}`, entity: row.toEntity, currency: payment.currency || row.currency, sourceAccountId: sourceAccount?.id || null })
    ])
  };
}

function intercompanyRepaymentInJournalSpec(db, event, entry) {
  const row = hydrateIntercompanyEntry(entry);
  const receipt = event || null;
  if (!receipt) return null;
  const amount = asMoney(receipt.amount || 0);
  if (amount <= 0) return null;
  const receivingAccount = receipt.receivingSourceAccountId ? getSourceAccountById(db, receipt.receivingSourceAccountId) : null;
  const cashCode = receivingAccount ? cashOrSettlementGlobalCode(receivingAccount) : '1010';
  return {
    sourceType: 'INTERCOMPANY_REPAYMENT_IN',
    sourceId: receipt.id,
    sourceRootType: 'INTERCOMPANY',
    sourceRootId: row.id,
    sourceStage: 'REPAYMENT_IN',
    journalType: 'SYSTEM',
    entity: row.fromEntity,
    currency: receipt.currency || row.currency,
    postingDate: receipt.date,
    memo: `Intercompany repayment in ${receipt.reference || receipt.id}`,
    createdByUserId: receipt.createdByUserId || row.createdByUserId || null,
    approvedByUserId: receipt.createdByUserId || row.createdByUserId || null,
    postedByUserId: receipt.createdByUserId || row.createdByUserId || null,
    lines: finalizeSystemLines([
      buildLineFromCode(db, { code: cashCode, debit: amount, description: `Repayment receipt ${receipt.reference || receipt.id}`, entity: row.fromEntity, currency: receipt.currency || row.currency, sourceAccountId: receivingAccount?.id || null }),
      buildLineFromCode(db, { code: '1200', credit: amount, description: `Clear due from ${row.toEntity} ${receipt.reference || receipt.id}`, entity: row.fromEntity, currency: receipt.currency || row.currency })
    ])
  };
}

function systemSpecForSource(db, sourceType, sourceId) {
  const type = String(sourceType || '').toUpperCase();
  if (type === 'INVOICE') return invoiceJournalSpec(db, (db.invoices || []).find((row) => row.id === sourceId));
  if (type === 'INVOICE_PAYMENT') return paymentJournalSpec(db, (db.payments || []).find((row) => row.id === sourceId));
  if (type === 'VENDOR_BILL') return vendorBillJournalSpec(db, (db.vendorBills || []).find((row) => row.id === sourceId));
  if (type === 'VENDOR_PAYMENT') {
    for (const bill of db.vendorBills || []) {
      const payment = (bill.payments || []).find((row) => row.id === sourceId);
      if (payment) return vendorPaymentJournalSpec(db, bill, payment);
    }
    return null;
  }
  if (type === 'EXPENSE') return expenseJournalSpec(db, (db.expenses || []).find((row) => row.id === sourceId));
  if (type === 'REIMBURSEMENT') return reimbursementJournalSpec(db, (db.expenses || []).find((row) => row.id === sourceId));
  if (type === 'PARTNER_DRAW') return partnerDrawJournalSpec(db, (db.partnerDraws || []).find((row) => row.id === sourceId));
  if (type === 'ASAR_COST') return asarCostJournalSpec(db, (db.asarTowerCosts || []).find((row) => row.id === sourceId));
  if (type === 'PAYROLL_RUN') {
    const run = (db.payrollRuns || []).find((row) => row.id === sourceId);
    return payrollRunJournalSpec(db, run, (db.payrollItems || []).filter((row) => row.runId === sourceId));
  }
  if (type === 'PONCHO_SETTLEMENT') return ponchoSettlementJournalSpec(db, (db.ponchoSettlements || []).find((row) => row.id === sourceId));
  if (type === 'INTERCOMPANY_FUNDING_OUT') return intercompanyFundingLenderJournalSpec(db, (db.intercompanyEntries || []).find((row) => row.id === sourceId));
  if (type === 'INTERCOMPANY_FUNDING_IN') return intercompanyFundingBorrowerJournalSpec(db, (db.intercompanyEntries || []).find((row) => row.id === sourceId));
  if (type === 'INTERCOMPANY_REPAYMENT_OUT' || type === 'INTERCOMPANY_REPAYMENT_IN') {
    const match = findIntercompanyRepaymentEventById(db, sourceId);
    if (!match) return null;
    return type === 'INTERCOMPANY_REPAYMENT_OUT'
      ? intercompanyRepaymentOutJournalSpec(db, match.event, match.entry)
      : intercompanyRepaymentInJournalSpec(db, match.event, match.entry);
  }
  return null;
}

export function upsertSystemJournalFromSource(db, { sourceType, sourceId, actorUserId = null }) {
  ensureJournalCollection(db);
  const spec = systemSpecForSource(db, sourceType, sourceId);
  const existing = findJournalBySource(db, { sourceType, sourceId, journalType: 'SYSTEM' });

  if (!spec) {
    if (existing) {
      existing.status = JOURNAL_STATUS.VOID;
      existing.updatedAt = nowIso();
      persistJournal(db, existing);
    }
    return existing ? hydrateJournal(db, existing) : null;
  }

  const row = existing || {
    id: nextId(db, 'JOURNAL', 'JRN'),
    journalNumber: journalNumber(db),
    journalType: 'SYSTEM',
    sourceType: spec.sourceType,
    sourceId: spec.sourceId,
    autoGenerated: true,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    reversedAt: null,
    submittedAt: null,
    approvedAt: null,
    postedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  row.sourceType = spec.sourceType;
  row.sourceId = spec.sourceId;
  row.sourceRootType = spec.sourceRootType || spec.sourceType;
  row.sourceRootId = spec.sourceRootId || spec.sourceId || null;
  row.sourceStage = spec.sourceStage || null;
  row.journalType = 'SYSTEM';
  row.postingKey = spec.postingKey || `${spec.sourceType}:${spec.sourceId}`;
  row.entity = spec.entity;
  row.currency = spec.currency;
  row.postingDate = spec.postingDate;
  row.memo = spec.memo || defaultMemo(spec.sourceType, spec.sourceId);
  row.status = JOURNAL_STATUS.POSTED;
  row.createdByUserId = spec.createdByUserId || actorUserId || null;
  row.approvedByUserId = spec.approvedByUserId || actorUserId || row.createdByUserId || null;
  row.postedByUserId = spec.postedByUserId || actorUserId || row.approvedByUserId || null;
  row.autoGenerated = true;
  row.lines = (spec.lines || []).map((line, index) => ({
    ...line,
    lineNumber: index + 1,
    reportingRate: rateToReporting(db, line.currency || spec.currency),
    updatedAt: nowIso()
  }));
  row.submittedAt = row.submittedAt || nowIso();
  row.approvedAt = nowIso();
  row.postedAt = nowIso();
  row.rejectionReason = null;
  row.rejectedByUserId = null;

  return persistJournal(db, row);
}

export function syncOperationalJournals(db, actorUserId = null) {
  ensureJournalCollection(db);
  for (const invoice of db.invoices || []) upsertSystemJournalFromSource(db, { sourceType: 'INVOICE', sourceId: invoice.id, actorUserId });
  for (const payment of db.payments || []) upsertSystemJournalFromSource(db, { sourceType: 'INVOICE_PAYMENT', sourceId: payment.id, actorUserId });
  for (const bill of db.vendorBills || []) {
    upsertSystemJournalFromSource(db, { sourceType: 'VENDOR_BILL', sourceId: bill.id, actorUserId });
    for (const payment of bill.payments || []) upsertSystemJournalFromSource(db, { sourceType: 'VENDOR_PAYMENT', sourceId: payment.id, actorUserId });
  }
  for (const expense of db.expenses || []) {
    upsertSystemJournalFromSource(db, { sourceType: 'EXPENSE', sourceId: expense.id, actorUserId });
    if (String(expense.reimbursementStatus || '').toUpperCase() === 'REIMBURSED') {
      upsertSystemJournalFromSource(db, { sourceType: 'REIMBURSEMENT', sourceId: expense.id, actorUserId });
    }
  }
  for (const draw of db.partnerDraws || []) upsertSystemJournalFromSource(db, { sourceType: 'PARTNER_DRAW', sourceId: draw.id, actorUserId });
  for (const entry of db.intercompanyEntries || []) {
    upsertSystemJournalFromSource(db, { sourceType: 'INTERCOMPANY_FUNDING_OUT', sourceId: entry.id, actorUserId });
    upsertSystemJournalFromSource(db, { sourceType: 'INTERCOMPANY_FUNDING_IN', sourceId: entry.id, actorUserId });
    for (const event of entry.repaymentEvents || []) {
      upsertSystemJournalFromSource(db, { sourceType: 'INTERCOMPANY_REPAYMENT_OUT', sourceId: event.id, actorUserId });
      upsertSystemJournalFromSource(db, { sourceType: 'INTERCOMPANY_REPAYMENT_IN', sourceId: event.id, actorUserId });
    }
  }
  for (const cost of db.asarTowerCosts || []) upsertSystemJournalFromSource(db, { sourceType: 'ASAR_COST', sourceId: cost.id, actorUserId });
  for (const run of db.payrollRuns || []) upsertSystemJournalFromSource(db, { sourceType: 'PAYROLL_RUN', sourceId: run.id, actorUserId });
  for (const settlement of db.ponchoSettlements || []) upsertSystemJournalFromSource(db, { sourceType: 'PONCHO_SETTLEMENT', sourceId: settlement.id, actorUserId });
  return listJournalRegister(db);
}

export function calculateJournalMagnitude(journal) {
  const hydrated = journal.lines ? hydrateJournal({ ...dbLike(journal) }, journal) : journal;
  return Math.max(Number(hydrated.totalDebit || 0), Number(hydrated.totalCredit || 0));
}

function dbLike(journal) {
  return {
    globalChartAccounts: (journal.lines || []).map((line) => ({
      id: line.globalAccountId,
      code: line.globalAccountCode,
      name: line.globalAccountName,
      type: line.globalAccountType
    }))
  };
}
