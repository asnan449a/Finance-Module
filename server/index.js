import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import {
  appendAudit,
  evidenceDir,
  initStore,
  invoicesDir,
  nextId,
  nowIso,
  queueNotification,
  readDb,
  role,
  writeDb,
  withDb
} from './store.js';
import {
  currentUser,
  loginWithGoogle,
  loginWithPassword,
  requireAuth,
  requireRole,
  safeUser
} from './auth.js';
import {
  createConnectUrl,
  getQboStatus,
  handleCallback,
  pollOpenInvoicesAndSync,
  pullFullQboData,
  pushInvoiceToQbo,
  recordQboPullLog,
  verifyWebhookSignature
} from './qbo.js';
import {
  getLockedClosePeriod as getLockedClosePeriodShared,
  nextMonthPeriodKey as nextMonthPeriodKeyShared,
  periodBounds as periodBoundsShared,
  periodLockError as periodLockErrorShared,
  toPeriodKey as toPeriodKeyShared
} from './services/periods.js';
import { validateSourceAccountContext } from './services/source-account-validation.js';
import {
  asMoney as asMoneyShared,
  inferEntityFromCurrency as inferEntityFromCurrencyShared,
  normalizeEntity as normalizeEntityShared,
  toReportingAmount as toReportingAmountShared
} from './services/fx.js';
import { assertApprovalAction } from './services/approvals.js';
import {
  assertWorkflowAction,
  buildApprovalSnapshot,
  evidenceSummaryForEntity,
  recordApprovalEvent
} from './services/approval-workflow.js';
import { listApprovalMatrixVersions, upsertApprovalMatrixVersion } from './services/approval-matrix.js';
import {
  approveJournal,
  createAutoPostedJournal,
  createManualJournal,
  getJournalDetail,
  listJournalRegister,
  postJournal,
  rejectJournal,
  reverseJournal,
  submitJournal
} from './services/journals.js';
import {
  buildBalanceSheet,
  buildIntercompanyExposure,
  buildProfitAndLoss,
  buildStatementDrilldown,
  buildTrialBalanceDrilldown,
  buildTrialBalance
} from './services/statements.js';
import { buildRelatedPartyCloseReconciliation } from './services/related-party-close.js';
import { listJournalsBySource, listJournalsBySourceRoot } from './repositories/journalRepository.js';
import {
  createEvidenceRecord,
  getEvidenceDescriptor,
  listLinkedEvidence,
  removeEvidenceRecord
} from './services/evidence.js';
import { buildRepaymentEvent, applyRepaymentEvent, hydrateIntercompanyEntry, intercompanyOutstandingAmount } from './services/intercompany.js';
import {
  assertEvidenceAccess,
  assertEvidenceMutationAllowed,
  buildEvidenceControlState
} from './services/record-access.js';
import {
  buildAccountingIntegrityReport,
  createCleanupReclassPosting,
  generateEliminationPostings,
  getSourceAccountingSnapshot,
  syncAllWorkflowPostings,
  syncSourceRootPostings,
  syncSystemSourcePosting
} from './services/posting-engine.js';
import { buildReviewQueue } from './services/review-queue.js';
import {
  applyReconciliationReviewDecision,
  bulkActionLabel,
  buildImportedReconciliationSummary,
  buildReconciliationQueue,
  clearReconciliationReview,
  eligibleForBulkAction,
  findQuickMatchCandidate,
  summarizeBulkEligibility
} from './services/reconciliation-queue.js';
import {
  buildDefaultPkTaxSettings,
  buildPkTaxReport as buildPkTaxSummary,
  calculatePkPayrollItem,
  normalizePkExpenseTax,
  summarizePkPayrollRun
} from './services/pk-tax.js';
import { createOpeningBalanceBatch, listOpeningBalances } from './services/opening-balances.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const publicDir = path.resolve(appRoot, 'public');

const PORT = Number(process.env.PORT || 4100);
const HOST = process.env.HOST || 'localhost';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://${HOST}:${PORT}`;

const app = express();

const billingCreateRoles = [role.ADMIN, role.ACCOUNTANT, role.PROJECT_MANAGER];
const billingApproveRoles = [role.ADMIN, role.ACCOUNTANT, role.PARTNER];
const billingReadRoles = [role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.PROJECT_MANAGER, role.EMPLOYEE, role.VIEWER];
const settingsManageRoles = [role.ADMIN, role.ACCOUNTANT];
const financeReadRoles = [role.ADMIN, role.ACCOUNTANT, role.PARTNER];
const financeManageRoles = [role.ADMIN, role.ACCOUNTANT];
const financeApproveRoles = [role.ADMIN, role.ACCOUNTANT, role.PARTNER];

function asMoney(value) {
  return asMoneyShared(value);
}

function asRate(value) {
  return Number((Number(value || 0)).toFixed(6));
}

function toDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / 86400000);
}

function generateInvoiceNumber(db) {
  const id = nextId(db, 'INVOICE', 'INVSEQ');
  const numeric = String(id.split('-')[1] || '1').padStart(4, '0');
  const year = new Date().getUTCFullYear().toString().slice(-2);
  return `INV-${numeric}-${year}`;
}

function isPrivilegedFinance(userRole) {
  return [role.ADMIN, role.ACCOUNTANT, role.PARTNER].includes(userRole);
}

function actorFromRequest(req) {
  return {
    id: req.user?.sub || null,
    role: req.user?.role || null
  };
}

function getUser(db, userId) {
  return db.users.find((row) => row.id === userId) || null;
}

function getClient(db, clientId) {
  return db.clients.find((row) => row.id === clientId) || null;
}

function getProject(db, projectId) {
  return db.projects.find((row) => row.id === projectId) || null;
}

function getVendor(db, vendorId) {
  return (db.vendors || []).find((row) => row.id === vendorId) || null;
}

function buildSourceJournalLineage(db, sourceRootType, sourceRootId) {
  if (!sourceRootType || !sourceRootId) return [];
  return listJournalsBySourceRoot(db, { sourceRootType, sourceRootId }).map((journal) => ({
    id: journal.id,
    journalNumber: journal.journalNumber,
    journalType: journal.journalType,
    status: journal.status,
    postingDate: journal.postingDate,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    sourceStage: journal.sourceStage || null,
    reversalOfJournalId: journal.reversalOfJournalId || null,
    reversedByJournalId: journal.reversedByJournalId || null
  }));
}

function buildSourceEventJournalLineage(db, sourceType, sourceId) {
  if (!sourceType || !sourceId) return [];
  return listJournalsBySource(db, {
    sourceType,
    sourceId,
    excludeStatuses: ['VOID']
  }).map((journal) => ({
    id: journal.id,
    journalNumber: journal.journalNumber,
    journalType: journal.journalType,
    status: journal.status,
    postingDate: journal.postingDate,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    sourceStage: journal.sourceStage || null,
    reversalOfJournalId: journal.reversalOfJournalId || null,
    reversedByJournalId: journal.reversedByJournalId || null
  }));
}

function buildSourceEventAccountingSnapshot(db, sourceType, sourceId, fallbackApprovalStatus = null) {
  const lineage = buildSourceEventJournalLineage(db, sourceType, sourceId);
  const active = lineage.filter((journal) => !journal.reversedByJournalId && !['VOID', 'REVERSED'].includes(String(journal.status || '').toUpperCase()));
  const approvalStatus = String(fallbackApprovalStatus || '').toUpperCase();
  return {
    accountingStatus: active.some((journal) => String(journal.status || '').toUpperCase() === 'POSTED')
      ? 'POSTED'
      : ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(approvalStatus)
        ? 'PENDING_POSTING'
        : 'PENDING_APPROVAL',
    expectedCount: 1,
    postedCount: active.filter((journal) => String(journal.status || '').toUpperCase() === 'POSTED').length,
    issueCount: 0,
    issues: [],
    lineage
  };
}

function buildSourceAccountingSnapshot(db, sourceRootType, sourceRootId) {
  if (!sourceRootType || !sourceRootId) return null;
  try {
    return getSourceAccountingSnapshot(db, { sourceRootType, sourceRootId });
  } catch {
    return null;
  }
}

function buildEvidenceRecords(db, entityType, entityId) {
  if (!entityType || !entityId) return [];
  try {
    return listLinkedEvidence(db, { entityType, entityId }).map((record) => ({
      id: record.id,
      entityType: record.entityType,
      entityId: record.entityId,
      fileName: record.fileName,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      uploadedByUserId: record.uploadedByUserId || null,
      uploadedAt: record.uploadedAt || null,
      note: record.note || '',
      category: record.category || 'SUPPORT',
      status: record.status || 'ACTIVE',
      supersedesEvidenceId: record.supersedesEvidenceId || null,
      supersededByEvidenceId: record.supersededByEvidenceId || null,
      supersededAt: record.supersededAt || null,
      removedByUserId: record.removedByUserId || null,
      removedAt: record.removedAt || null,
      removalNote: record.removalNote || '',
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null
    }));
  } catch {
    return [];
  }
}

function buildEvidenceControl(db, entityType, entityId) {
  if (!entityType || !entityId) return null;
  try {
    return buildEvidenceControlState(db, { entityType, entityId });
  } catch {
    return null;
  }
}

function normalizeSupportingEvidence(payload) {
  const raw = payload?.supportingEvidence;
  const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return rows
    .map((row) => ({
      fileName: String(row?.fileName || '').trim(),
      mimeType: String(row?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
      contentBase64: String(row?.contentBase64 || '').trim(),
      note: String(row?.note || '').trim(),
      category: String(row?.category || 'SUPPORT').toUpperCase().trim() || 'SUPPORT',
      supersedesEvidenceId: row?.supersedesEvidenceId ? String(row.supersedesEvidenceId) : null
    }))
    .filter((row) => row.fileName && row.contentBase64);
}

function persistSupportingEvidence(db, evidencePayloads, { entityType, entityId, actorUserId } = {}) {
  const created = [];
  for (const evidencePayload of evidencePayloads || []) {
    created.push(createEvidenceRecord(db, {
      ...evidencePayload,
      entityType,
      entityId
    }, actorUserId, { baseDir: evidenceDir }));
  }
  return created;
}

function buildApprovalState(db, {
  documentType,
  entityType,
  entityId,
  entity = '*',
  amount = 0,
  operationalStatus = null,
  approvalStatus = null,
  createdByUserId = null,
  approvedByUserId = null
} = {}) {
  if (!documentType || !entityType || !entityId) return null;
  try {
    return buildApprovalSnapshot(db, {
      documentType,
      entityType,
      entityId,
      entity,
      amount,
      operationalStatus,
      approvalStatus,
      createdByUserId,
      approvedByUserId
    });
  } catch {
    return null;
  }
}

function toPeriodKey(value) {
  return toPeriodKeyShared(value);
}

function periodBounds(periodKey) {
  return periodBoundsShared(periodKey);
}

function getLockedClosePeriod(db, periodKey) {
  return getLockedClosePeriodShared(db, periodKey);
}

function periodLockError(db, dateValue) {
  return periodLockErrorShared(db, dateValue);
}

function nextMonthPeriodKey(periodKey) {
  return nextMonthPeriodKeyShared(periodKey);
}

function hydrateVendorPayment(db, payment, bill) {
  const evidenceSummary = evidenceSummaryForEntity(db, {
    entityType: 'VENDOR_PAYMENT',
    entityId: payment.id
  });
  const accounting = buildSourceEventAccountingSnapshot(db, 'VENDOR_PAYMENT', payment.id, payment.approvalStatus || 'PENDING');
  return {
    ...payment,
    approvalStatus: payment.approvalStatus || 'APPROVED',
    evidenceRecords: buildEvidenceRecords(db, 'VENDOR_PAYMENT', payment.id),
    evidenceControl: buildEvidenceControl(db, 'VENDOR_PAYMENT', payment.id),
    approval: buildApprovalState(db, {
      documentType: 'VENDOR_PAYMENT',
      entityType: 'VENDOR_PAYMENT',
      entityId: payment.id,
      entity: bill?.entity || '*',
      amount: payment.amount,
      operationalStatus: payment.status || 'PAID',
      approvalStatus: payment.approvalStatus || 'APPROVED',
      createdByUserId: payment.createdByUserId || null,
      approvedByUserId: payment.approvedByUserId || null
    }),
    evidenceSummary,
    journalLineage: accounting.lineage,
    accounting
  };
}

function hydrateVendorBill(db, bill) {
  const vendor = bill.vendorId ? getVendor(db, bill.vendorId) : null;
  const payments = Array.isArray(bill.payments) ? bill.payments.map((row) => hydrateVendorPayment(db, row, bill)) : [];
  const amountPaid = asMoney(payments.reduce((sum, row) => sum + Number(row.amount || 0), 0) || bill.amountPaid || 0);
  const total = asMoney(bill.total || bill.subtotal || 0);
  const outstanding = asMoney(Math.max(total - amountPaid, 0));
  const status = String(bill.status || 'DRAFT').toUpperCase();
  let derivedStatus = status;
  if (!['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(status)) {
    if (outstanding <= 0 && total > 0) derivedStatus = 'PAID';
    else if (amountPaid > 0) derivedStatus = 'PARTIAL';
    else if (status === 'APPROVED') derivedStatus = 'APPROVED';
    else derivedStatus = 'OPEN';
    if (['OPEN', 'APPROVED'].includes(derivedStatus) && bill.dueDate && new Date(`${bill.dueDate}T00:00:00Z`).getTime() < Date.now()) {
      derivedStatus = 'OVERDUE';
    }
  }
  return {
    ...bill,
    vendor,
    vendorName: bill.vendorName || vendor?.name || 'Unassigned Vendor',
    amountPaid,
    total,
    outstanding,
    status: derivedStatus,
    daysPastDue: bill.dueDate ? Math.max(daysBetween(bill.dueDate, toDateKey(Date.now())), 0) : 0,
    payments,
    evidenceRecords: buildEvidenceRecords(db, 'VENDOR_BILL', bill.id),
    evidenceControl: buildEvidenceControl(db, 'VENDOR_BILL', bill.id),
    approval: buildApprovalState(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      entity: bill.entity,
      amount: bill.total,
      operationalStatus: derivedStatus,
      approvalStatus: bill.approvalStatus || null,
      createdByUserId: bill.createdByUserId,
      approvedByUserId: bill.approvedByUserId
    }),
    journalLineage: buildSourceJournalLineage(db, 'VENDOR_BILL', bill.id),
    accounting: buildSourceAccountingSnapshot(db, 'VENDOR_BILL', bill.id)
  };
}

function buildPayablesSummary(db, bills) {
  const rows = (bills || []).map((bill) => hydrateVendorBill(db, bill));
  const summary = {
    totalBills: rows.length,
    pendingApprovalCount: 0,
    openCount: 0,
    overdueCount: 0,
    totalApproved: 0,
    totalOutstanding: 0,
    paidThisMonth: 0
  };
  const monthPrefix = toDateKey(Date.now()).slice(0, 7);
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 };
  const byVendorMap = new Map();

  for (const bill of rows) {
    const status = String(bill.status || '').toUpperCase();
    if (status === 'PENDING_APPROVAL') summary.pendingApprovalCount += 1;
    if (['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE'].includes(status)) summary.openCount += 1;
    if (status === 'OVERDUE') summary.overdueCount += 1;
    if (!['DRAFT', 'REJECTED'].includes(status)) summary.totalApproved = asMoney(summary.totalApproved + Number(bill.total || 0));
    summary.totalOutstanding = asMoney(summary.totalOutstanding + Number(bill.outstanding || 0));

    for (const payment of bill.payments || []) {
      if (String(payment.date || '').startsWith(monthPrefix)) {
        summary.paidThisMonth = asMoney(summary.paidThisMonth + Number(payment.amount || 0));
      }
    }

    const key = bill.vendorName || 'Unassigned Vendor';
    if (!byVendorMap.has(key)) {
      byVendorMap.set(key, {
        vendor: key,
        billCount: 0,
        approvedAmount: 0,
        outstanding: 0,
        overdueAmount: 0
      });
    }
    const vendorRow = byVendorMap.get(key);
    vendorRow.billCount += 1;
    vendorRow.approvedAmount = asMoney(vendorRow.approvedAmount + Number(bill.total || 0));
    vendorRow.outstanding = asMoney(vendorRow.outstanding + Number(bill.outstanding || 0));
    if (status === 'OVERDUE') vendorRow.overdueAmount = asMoney(vendorRow.overdueAmount + Number(bill.outstanding || 0));

    if (bill.outstanding > 0) {
      if (bill.daysPastDue <= 0) aging.current = asMoney(aging.current + bill.outstanding);
      else if (bill.daysPastDue <= 30) aging.d1_30 = asMoney(aging.d1_30 + bill.outstanding);
      else if (bill.daysPastDue <= 60) aging.d31_60 = asMoney(aging.d31_60 + bill.outstanding);
      else aging.d61_plus = asMoney(aging.d61_plus + bill.outstanding);
    }
  }

  return {
    summary,
    aging,
    byVendor: [...byVendorMap.values()].sort((a, b) => b.outstanding - a.outstanding)
  };
}

function buildIntercompanySummary(entries) {
  const rows = (entries || []).map((entry) => hydrateIntercompanyEntry(entry));
  const summary = {
    entryCount: rows.length,
    openCount: 0,
    partialCount: 0,
    settledCount: 0,
    openAmount: 0,
    repaidAmount: 0,
    settledAmount: 0
  };
  const byPairMap = new Map();

  for (const row of rows) {
    const status = String(row.status || '').toUpperCase();
    const openAmount = asMoney(row.outstandingAmount || 0);
    const repaidAmount = asMoney(row.repaidAmount || 0);
    summary.repaidAmount = asMoney(summary.repaidAmount + repaidAmount);
    if (status === 'REPAID' || openAmount <= 0.01) {
      summary.settledCount += 1;
      summary.settledAmount = asMoney(summary.settledAmount + repaidAmount);
    } else if (status === 'PARTIAL_REPAID') {
      summary.partialCount += 1;
      summary.openCount += 1;
      summary.openAmount = asMoney(summary.openAmount + openAmount);
    } else {
      summary.openCount += 1;
      summary.openAmount = asMoney(summary.openAmount + openAmount);
    }
    const key = `${row.fromEntity || 'UNK'} -> ${row.toEntity || 'UNK'}`;
    if (!byPairMap.has(key)) {
      byPairMap.set(key, { pair: key, currency: row.currency || 'USD', openAmount: 0, repaidAmount: 0, settledAmount: 0, count: 0 });
    }
    const bucket = byPairMap.get(key);
    bucket.count += 1;
    bucket.openAmount = asMoney(bucket.openAmount + openAmount);
    bucket.repaidAmount = asMoney(bucket.repaidAmount + repaidAmount);
    if (status === 'REPAID' || openAmount <= 0.01) bucket.settledAmount = asMoney(bucket.settledAmount + repaidAmount);
  }

  return {
    summary,
    byPair: [...byPairMap.values()].sort((a, b) => b.openAmount - a.openAmount)
  };
}

function intercompanyAccountName(db, sourceAccountId, fallback = null) {
  return (db.accounts || []).find((row) => row.id === sourceAccountId)?.name || fallback || null;
}

function hydrateIntercompanyLedgerEntry(db, entry) {
  const hydrated = hydrateIntercompanyEntry(entry);
  return {
    ...hydrated,
    sourceRailName: intercompanyAccountName(db, hydrated.sourceAccountId),
    receivingSourceRailName: intercompanyAccountName(db, hydrated.receivingSourceAccountId),
    repaymentSourceRailName: intercompanyAccountName(db, hydrated.repaymentSourceAccountId),
    repaymentReceivingRailName: intercompanyAccountName(db, hydrated.repaymentReceivingAccountId),
    journalLineage: buildSourceJournalLineage(db, 'INTERCOMPANY', hydrated.id),
    accounting: buildSourceAccountingSnapshot(db, 'INTERCOMPANY', hydrated.id)
  };
}

function createIntercompanyCashMovement(db, {
  date,
  entity,
  currency,
  amount,
  accountName,
  sourceAccountId,
  reference,
  description,
  counterparty,
  type,
  source,
  category
}) {
  const tx = {
    id: nextId(db, 'TRANSACTION', 'TXN'),
    date,
    account: accountName || `${entity} Treasury`,
    amount: asMoney(amount),
    currency: String(currency || db.settings?.reportingCurrency || 'USD').toUpperCase(),
    type,
    description,
    category,
    source,
    reference,
    channel: null,
    lineOfService: null,
    businessUnit: 'TREASURY',
    department: 'TREASURY',
    partnerTag: null,
    treasuryFlag: true,
    intercompanyFlag: true,
    capexFlag: false,
    entity: normalizeEntity(entity) || inferEntityFromCurrency(db, currency || 'USD') || 'US',
    sourceAccountId: sourceAccountId || null,
    reconciled: false,
    invoiceId: null,
    linkedInvoiceIds: [],
    matchedAmount: 0,
    counterparty,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  applyGovernanceStamp(db, tx, 'transaction');
  db.transactions.push(tx);
  return tx;
}

function recordIntercompanyRepayment(db, entry, payload, actorUserId) {
  const hydrated = hydrateIntercompanyEntry(entry);
  if (hydrated.outstandingAmount <= 0.01) {
    return { error: 'Entry is already fully repaid.', status: 409 };
  }

  const repaymentDate = payload.date || toDateKey(nowIso());
  const lockError = periodLockError(db, repaymentDate);
  if (lockError) return { error: lockError, status: 409 };

  const amount = asMoney(payload.amount == null ? hydrated.outstandingAmount : payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Repayment amount must be greater than zero.', status: 400 };
  if (amount - hydrated.outstandingAmount > 0.01) return { error: 'Repayment amount exceeds outstanding exposure.', status: 409 };

  const payingSourceAccount = resolveSourceAccount(db, {
    sourceAccountId: payload.sourceAccountId || null,
    account: payload.account || null,
    entity: hydrated.toEntity,
    currency: hydrated.currency,
    sourceSystem: payload.source || null
  });
  const payingSourceAccountError = validateSelectedSourceAccount(payingSourceAccount, {
    sourceAccountId: payload.sourceAccountId || null,
    entity: hydrated.toEntity,
    currency: hydrated.currency,
    allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
    fieldLabel: 'repayment rail'
  });
  if (payingSourceAccountError) return { error: payingSourceAccountError, status: 409 };

  const receivingSourceAccount = resolveSourceAccount(db, {
    sourceAccountId: payload.receivingSourceAccountId || null,
    account: payload.receivingAccount || null,
    entity: hydrated.fromEntity,
    currency: hydrated.currency,
    sourceSystem: payload.source || null
  });
  const receivingSourceAccountError = validateSelectedSourceAccount(receivingSourceAccount, {
    sourceAccountId: payload.receivingSourceAccountId || null,
    entity: hydrated.fromEntity,
    currency: hydrated.currency,
    allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
    fieldLabel: 'receiving rail'
  });
  if (receivingSourceAccountError) return { error: receivingSourceAccountError, status: 409 };

  const repaymentEvent = buildRepaymentEvent({
    id: nextId(db, 'INTERCOMPANY_REPAYMENT', 'ICR'),
    date: repaymentDate,
    amount,
    currency: hydrated.currency,
    sourceAccountId: payingSourceAccount?.id || payload.sourceAccountId || null,
    receivingSourceAccountId: receivingSourceAccount?.id || payload.receivingSourceAccountId || null,
    reference: payload.reference || `${hydrated.reference || hydrated.id}-REPAY-${Date.now()}`,
    description: payload.description || `Intercompany repayment ${hydrated.toEntity} -> ${hydrated.fromEntity}`,
    createdByUserId: actorUserId,
    createdAt: nowIso()
  });

  applyRepaymentEvent(entry, repaymentEvent);
  entry.updatedAt = nowIso();

  const transactions = [];
  if (payload.createCashMovement !== false) {
    transactions.push(createIntercompanyCashMovement(db, {
      date: repaymentEvent.date,
      entity: hydrated.toEntity,
      currency: repaymentEvent.currency,
      amount,
      accountName: payingSourceAccount?.name || payload.account || `${hydrated.toEntity} Treasury`,
      sourceAccountId: repaymentEvent.sourceAccountId,
      reference: repaymentEvent.reference,
      description: payload.description || `Intercompany repayment out ${hydrated.toEntity} -> ${hydrated.fromEntity}`,
      counterparty: hydrated.fromEntity,
      type: 'DEBIT',
      source: payload.source || 'ERP_INTERCOMPANY_REPAYMENT_OUT',
      category: 'Intercompany Repayment'
    }));
    transactions.push(createIntercompanyCashMovement(db, {
      date: repaymentEvent.date,
      entity: hydrated.fromEntity,
      currency: repaymentEvent.currency,
      amount,
      accountName: receivingSourceAccount?.name || payload.receivingAccount || `${hydrated.fromEntity} Treasury`,
      sourceAccountId: repaymentEvent.receivingSourceAccountId,
      reference: repaymentEvent.reference,
      description: payload.description || `Intercompany repayment in ${hydrated.fromEntity} <- ${hydrated.toEntity}`,
      counterparty: hydrated.toEntity,
      type: 'CREDIT',
      source: payload.source || 'ERP_INTERCOMPANY_REPAYMENT_IN',
      category: 'Intercompany Repayment'
    }));
  }

  syncSourceRootPostings(db, {
    sourceRootType: 'INTERCOMPANY',
    sourceRootId: entry.id,
    actorUserId
  });

  appendAudit(db, {
    actorUserId,
    module: 'treasury',
    action: 'intercompany_repayment_recorded',
    entityType: 'intercompany_entry',
    entityId: entry.id,
    details: JSON.stringify({
      repaymentEventId: repaymentEvent.id,
      amount,
      date: repaymentDate,
      reference: repaymentEvent.reference
    })
  });

  return {
    entry: hydrateIntercompanyLedgerEntry(db, entry),
    repaymentEvent,
    transactions
  };
}

function buildCloseChecklist(db, periodKey) {
  const bounds = periodBounds(periodKey);
  if (!bounds) return null;
  const { start, end } = bounds;
  const closeApproval = buildApprovalState(db, {
    documentType: 'CLOSE_PERIOD',
    entityType: 'CLOSE_PERIOD',
    entityId: periodKey,
    entity: '*',
    amount: 0,
    operationalStatus: 'OPEN',
    approvalStatus: 'OPEN',
    createdByUserId: null,
    approvedByUserId: null
  });
  const invoices = (db.invoices || []).filter((row) => String(row.issueDate || '') >= start && String(row.issueDate || '') <= end);
  const untaggedInvoices = invoices.filter((row) => !getInvoiceLineOfService(db, row));
  const unmatchedCash = (db.transactions || []).filter((row) => {
    if (!String(row.date || '').startsWith(periodKey)) return false;
    const absolute = Math.abs(Number(row.amount || 0));
    const remaining = Math.max(absolute - Number(row.matchedAmount || 0), 0);
    return absolute > 0 && remaining > 0;
  });
  const pendingReimbursements = (db.expenses || []).filter((row) => {
    if (!String(row.date || '').startsWith(periodKey)) return false;
    return Boolean(row.reimbursementNeeded) && String(row.reimbursementStatus || 'PENDING').toUpperCase() !== 'REIMBURSED';
  });
  const pendingBills = (db.vendorBills || []).map((row) => hydrateVendorBill(db, row)).filter((row) => {
    if (!String(row.billDate || '').startsWith(periodKey)) return false;
    return ['DRAFT', 'PENDING_APPROVAL'].includes(String(row.status || '').toUpperCase());
  });
  const relatedParty = buildRelatedPartyCloseReconciliation(db, { periodKey });

  const checks = [
    {
      key: 'qbo_pull',
      label: 'Source pull completed',
      pass: Boolean(db.qbo?.lastPullAt),
      detail: db.qbo?.lastPullAt ? `Last pull ${db.qbo.lastPullAt}` : 'No QBO full pull recorded.'
    },
    {
      key: 'invoice_tagging',
      label: 'Invoice LOS tagging complete',
      pass: untaggedInvoices.length === 0,
      detail: `${untaggedInvoices.length} untagged invoices in ${periodKey}.`
    },
    {
      key: 'cash_matching',
      label: 'Cash matching cleared',
      pass: unmatchedCash.length === 0,
      detail: `${unmatchedCash.length} unmatched cash rows in ${periodKey}.`
    },
    {
      key: 'reimbursements',
      label: 'Employee reimbursements settled',
      pass: pendingReimbursements.length === 0,
      detail: `${pendingReimbursements.length} reimbursement claims still open.`
    },
    {
      key: 'ap_approval',
      label: 'Vendor bills approved',
      pass: pendingBills.length === 0,
      detail: `${pendingBills.length} vendor bills still pending approval.`
    },
    {
      key: 'close_support_pack',
      label: 'Close support evidence is attached',
      pass: Boolean(closeApproval?.evidenceSatisfied),
      detail: closeApproval?.evidenceSatisfied
        ? `${closeApproval.qualifiedEvidenceCount || 0} close support file(s) linked to ${periodKey}.`
        : `Add ${(closeApproval?.policy?.requiredEvidenceCategories || []).join(' or ') || 'close support evidence'} before close approval.`
    },
    {
      key: 'related_party_reconciliation',
      label: 'Related-party balances reconciled',
      pass: Boolean(relatedParty.summary?.relatedPartyCloseReady),
      detail: `${relatedParty.summary?.mismatchPairCount || 0} mismatched pairs, ${relatedParty.summary?.cleanupExceptionCount || 0} cleanup exceptions, ${relatedParty.pairs?.filter((row) => row.eliminationStatus === 'READY' || row.eliminationStatus === 'STALE').length || 0} pairs still not eliminated.`
    }
  ];

  const openAr = asMoney(invoices.reduce((sum, row) => sum + Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0), 0));
  const payables = buildPayablesSummary(db, (db.vendorBills || []).filter((row) => String(row.billDate || '') <= end));
  const intercompany = buildIntercompanySummary((db.intercompanyEntries || []).filter((row) => String(row.date || '') <= end));

  return {
    periodKey,
    start,
    end,
    readyToClose: checks.every((row) => row.pass),
    checks,
    metrics: {
      invoiceCount: invoices.length,
      openAr,
      openAp: payables.summary.totalOutstanding,
      openIntercompany: relatedParty.summary?.outstandingBalance ?? intercompany.summary.openAmount
    },
    relatedParty,
    closeApproval
  };
}

function hydrateExpenseRow(db, row) {
  const governed = applyEntryGovernance(db, {
    sourceType: 'expense',
    sourceId: row.id,
    date: row.date,
    entity: row.entity || null,
    currency: row.currency || db.settings?.reportingCurrency || 'USD',
    lineOfService: row.lineOfService || null,
    businessUnit: row.businessUnit || null,
    channel: row.channel || null,
    category: row.category || null,
    amount: -Math.abs(asMoney(row.amount || 0)),
    reportingAmount: toReportingAmount(db, -Math.abs(asMoney(row.amount || 0)), row.currency || 'USD'),
    intercompanyFlag: Boolean(row.intercompanyFlag),
    treasuryFlag: Boolean(row.treasuryFlag),
    capexFlag: Boolean(row.capexFlag),
    partnerTag: row.partnerTag || null,
    account: row.account || null,
    source: row.source || null,
    sourceAccountId: row.sourceAccountId || null,
    qboAccountId: row.qboAccountId || null
  });
  return {
    ...row,
    ...governed,
    evidenceRecords: buildEvidenceRecords(db, 'EXPENSE', row.id),
    evidenceControl: buildEvidenceControl(db, 'EXPENSE', row.id),
    approval: buildApprovalState(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      entity: row.entity,
      amount: row.amount,
      operationalStatus: row.status,
      approvalStatus: row.approvalStatus || 'PENDING',
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId
    }),
    journalLineage: buildSourceJournalLineage(db, 'EXPENSE', row.id),
    accounting: buildSourceAccountingSnapshot(db, 'EXPENSE', row.id)
  };
}

function hydrateReimbursementRow(db, row) {
  const statuses = new Set(['PENDING', 'REIMBURSED', 'REJECTED', 'NOT_APPLICABLE']);
  const hydrated = hydrateExpenseRow(db, row);
  return {
    ...hydrated,
    reimbursementStatus: statuses.has(String(row.reimbursementStatus || '').toUpperCase())
      ? String(row.reimbursementStatus || '').toUpperCase()
      : (String(row.status || '').toUpperCase() === 'PAID' ? 'REIMBURSED' : 'PENDING')
  };
}

function hydrateOpeningBalanceRow(db, row) {
  return {
    ...row,
    journalLineage: buildSourceJournalLineage(db, 'OPENING_BALANCE', row.id),
    accounting: buildSourceAccountingSnapshot(db, 'OPENING_BALANCE', row.id)
  };
}

function listClosePeriodsWithHydration(db, months = 6) {
  const periodKeys = new Set((db.closePeriods || []).map((row) => row.periodKey).filter(Boolean));
  let cursor = new Date();
  cursor.setUTCDate(1);
  for (let index = 0; index < months; index += 1) {
    periodKeys.add(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return [...periodKeys]
    .sort((a, b) => b.localeCompare(a))
    .map((periodKey) => {
      const stored = (db.closePeriods || []).find((row) => row.periodKey === periodKey) || null;
      const live = buildCloseChecklist(db, periodKey);
      return {
        id: stored?.id || `PERIOD-${periodKey}`,
        periodKey,
        status: stored?.status || 'OPEN',
        notes: stored?.notes || '',
        closedAt: stored?.closedAt || null,
        closedByUserId: stored?.closedByUserId || null,
        reopenedAt: stored?.reopenedAt || null,
        reopenedByUserId: stored?.reopenedByUserId || null,
        checklist: live,
        checklistSnapshot: stored?.checklistSnapshot || null,
        metricsSnapshot: stored?.metricsSnapshot || null,
        relatedPartySnapshot: stored?.relatedPartySnapshot || null,
        closeEvidenceSnapshot: stored?.closeEvidenceSnapshot || null,
        closeApprovalSnapshot: stored?.closeApprovalSnapshot || null,
        evidenceRecords: buildEvidenceRecords(db, 'CLOSE_PERIOD', periodKey),
        evidenceControl: buildEvidenceControl(db, 'CLOSE_PERIOD', periodKey),
        approval: buildApprovalState(db, {
          documentType: String(stored?.status || '').toUpperCase() === 'CLOSED' ? 'REOPEN_PERIOD' : 'CLOSE_PERIOD',
          entityType: 'CLOSE_PERIOD',
          entityId: periodKey,
          entity: '*',
          amount: 0,
          operationalStatus: stored?.status || 'OPEN',
          approvalStatus: String(stored?.status || '').toUpperCase() === 'CLOSED' ? 'APPROVED' : 'OPEN',
          createdByUserId: stored?.closedByUserId || null,
          approvedByUserId: String(stored?.status || '').toUpperCase() === 'CLOSED' ? stored?.closedByUserId || null : null
        })
      };
    });
}

function buildQueueBlockedReasons({ approval = null, accounting = null, rejectionReason = '', additional = [] } = {}) {
  const reasons = [...(additional || [])];
  if (approval && !approval.evidenceSatisfied) {
    reasons.push(`Missing support (${approval.qualifiedEvidenceCount ?? approval.evidenceCount ?? 0} / ${approval.minEvidenceCount || 0}).`);
  }
  if (String(approval?.approvalStatus || '').toUpperCase() === 'REJECTED' && rejectionReason) {
    reasons.push(`Rejected: ${rejectionReason}`);
  }
  if (Number(accounting?.issueCount || 0) > 0) {
    reasons.push(`${accounting.issueCount} accounting integrity issue(s).`);
  }
  return reasons.filter(Boolean);
}

function buildApprovalsQueuePayload(db, user = null) {
  const invoices = (db.invoices || [])
    .map((invoice) => hydrateInvoice(db, updateInvoicePaymentState({ ...invoice })));
  const bills = (db.vendorBills || []).map((bill) => hydrateVendorBill(db, bill));
  const expenses = (db.expenses || []).map((row) => hydrateExpenseRow(db, row));
  const reimbursements = (db.expenses || [])
    .filter((row) => row.reimbursementNeeded === true || Boolean(row.employeeId))
    .map((row) => hydrateReimbursementRow(db, row));
  const journals = listJournalRegister(db, {}).map((journal) => getJournalDetail(db, journal.id) || journal);
  const closePeriods = listClosePeriodsWithHydration(db, 6);
  const items = [];

  for (const invoice of invoices.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const approvalStatus = String(invoice.approval?.approvalStatus || invoice.approvalStatus || invoice.status || '').toUpperCase();
    const blockedReasons = buildQueueBlockedReasons({
      approval: invoice.approval,
      accounting: invoice.accounting,
      rejectionReason: invoice.rejectionReason || ''
    });
    const pendingApproval = ['PENDING', 'OPEN'].includes(approvalStatus) || String(invoice.status || '').toUpperCase() === 'PENDING_APPROVAL';
    if (!pendingApproval && !blockedReasons.length) continue;
    items.push({
      id: `INVOICE:${invoice.id}`,
      documentType: 'INVOICE',
      queueBucket: 'invoices',
      reference: invoice.invoiceNumber || invoice.id,
      subject: invoice.clientName || 'Unknown client',
      counterparty: invoice.clientName || null,
      entity: invoice.entity || '',
      amount: Number(invoice.total || 0),
      currency: invoice.currency || 'USD',
      dueDate: invoice.dueDate || invoice.issueDate || null,
      ageDate: invoice.dueDate || invoice.issueDate || invoice.createdAt || null,
      operationalStatus: invoice.status || 'DRAFT',
      approvalStatus,
      accountingStatus: invoice.accounting?.accountingStatus || 'UNKNOWN',
      evidenceReady: invoice.approval?.evidenceSatisfied,
      evidenceCount: invoice.approval?.qualifiedEvidenceCount ?? invoice.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: invoice.approval?.minEvidenceCount || 0,
      issueCount: invoice.accounting?.issueCount || 0,
      blockedReasons,
      reviewState: pendingApproval ? 'PENDING_APPROVAL' : 'BLOCKED',
      drawerRef: `invoice:${invoice.id}`
    });
  }

  for (const bill of bills.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const approvalStatus = String(bill.approval?.approvalStatus || bill.approvalStatus || '').toUpperCase();
    const blockedReasons = buildQueueBlockedReasons({
      approval: bill.approval,
      accounting: bill.accounting,
      rejectionReason: bill.rejectionReason || ''
    });
    const pendingApproval = approvalStatus === 'PENDING' || String(bill.status || '').toUpperCase() === 'PENDING_APPROVAL';
    if (!pendingApproval && !blockedReasons.length) continue;
    items.push({
      id: `VENDOR_BILL:${bill.id}`,
      documentType: 'VENDOR_BILL',
      queueBucket: 'bills',
      reference: bill.billNumber || bill.id,
      subject: bill.vendorName || 'Unknown vendor',
      counterparty: bill.vendorName || null,
      entity: bill.entity || '',
      amount: Number(bill.total || 0),
      currency: bill.currency || 'USD',
      dueDate: bill.dueDate || bill.billDate || null,
      ageDate: bill.dueDate || bill.billDate || bill.createdAt || null,
      operationalStatus: bill.status || 'DRAFT',
      approvalStatus,
      accountingStatus: bill.accounting?.accountingStatus || 'UNKNOWN',
      evidenceReady: bill.approval?.evidenceSatisfied,
      evidenceCount: bill.approval?.qualifiedEvidenceCount ?? bill.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: bill.approval?.minEvidenceCount || 0,
      issueCount: bill.accounting?.issueCount || 0,
      blockedReasons,
      reviewState: pendingApproval ? 'PENDING_APPROVAL' : 'BLOCKED',
      drawerRef: `bill:${bill.id}`
    });
  }

  for (const bill of bills.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const readyToRelease = ['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE'].includes(String(bill.status || '').toUpperCase()) && Number(bill.outstanding || 0) > 0;
    if (!readyToRelease) continue;
    const paymentApproval = buildApprovalState(db, {
      documentType: 'VENDOR_PAYMENT',
      entityType: 'VENDOR_PAYMENT',
      entityId: `PENDING:${bill.id}`,
      entity: bill.entity,
      amount: bill.outstanding,
      operationalStatus: 'READY_TO_RELEASE',
      approvalStatus: 'PENDING',
      createdByUserId: bill.createdByUserId,
      approvedByUserId: null
    });
    items.push({
      id: `VENDOR_PAYMENT_RELEASE:${bill.id}`,
      documentType: 'VENDOR_PAYMENT',
      queueBucket: 'cash',
      reference: bill.billNumber || bill.id,
      subject: 'Vendor payment release',
      counterparty: bill.vendorName || null,
      entity: bill.entity || '',
      amount: Number(bill.outstanding || 0),
      currency: bill.currency || 'USD',
      dueDate: bill.dueDate || bill.billDate || null,
      ageDate: bill.dueDate || bill.billDate || bill.createdAt || null,
      operationalStatus: bill.status || 'APPROVED',
      approvalStatus: paymentApproval.approvalStatus || 'PENDING',
      accountingStatus: bill.accounting?.accountingStatus || 'UNKNOWN',
      evidenceReady: paymentApproval.evidenceSatisfied,
      evidenceCount: paymentApproval.qualifiedEvidenceCount ?? paymentApproval.evidenceCount ?? 0,
      evidenceRequiredCount: paymentApproval.minEvidenceCount || 0,
      issueCount: bill.accounting?.issueCount || 0,
      blockedReasons: bill.accounting?.issueCount ? [`${bill.accounting.issueCount} accounting integrity issue(s).`] : [],
      reviewState: 'READY_TO_RELEASE',
      drawerRef: `bill:${bill.id}`
    });
  }

  for (const invoice of invoices.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    for (const receipt of invoice.payments || []) {
      const approvalStatus = String(receipt.approval?.approvalStatus || receipt.approvalStatus || '').toUpperCase();
      const blockedReasons = buildQueueBlockedReasons({
        approval: receipt.approval,
        accounting: receipt.accounting
      });
      const requiresReview = !['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(approvalStatus) || blockedReasons.length > 0;
      if (!requiresReview) continue;
      items.push({
        id: `CUSTOMER_RECEIPT:${receipt.id}`,
        documentType: 'CUSTOMER_RECEIPT',
        queueBucket: 'cash',
        reference: receipt.reference || receipt.id,
        subject: invoice.invoiceNumber || receipt.invoiceId || 'Invoice receipt',
        counterparty: receipt.clientName || invoice.clientName || null,
        entity: receipt.entity || invoice.entity || '',
        amount: Number(receipt.amount || 0),
        currency: receipt.currency || invoice.currency || 'USD',
        dueDate: receipt.paidAt || null,
        ageDate: receipt.paidAt || receipt.createdAt || null,
        operationalStatus: receipt.status || 'PAID',
        approvalStatus,
        accountingStatus: receipt.accounting?.accountingStatus || 'UNKNOWN',
        evidenceReady: receipt.approval?.evidenceSatisfied,
        evidenceCount: receipt.approval?.qualifiedEvidenceCount ?? receipt.evidenceRecords?.length ?? 0,
        evidenceRequiredCount: receipt.approval?.minEvidenceCount || 0,
        issueCount: receipt.accounting?.issueCount || 0,
        blockedReasons,
        reviewState: blockedReasons.length ? 'BLOCKED' : 'PENDING_APPROVAL',
        drawerRef: `customer-receipt:${receipt.id}`
      });
    }
  }

  for (const bill of bills.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    for (const payment of bill.payments || []) {
      const approvalStatus = String(payment.approval?.approvalStatus || payment.approvalStatus || '').toUpperCase();
      const blockedReasons = buildQueueBlockedReasons({
        approval: payment.approval,
        accounting: payment.accounting
      });
      const requiresReview = !['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(approvalStatus) || blockedReasons.length > 0;
      if (!requiresReview) continue;
      items.push({
        id: `VENDOR_PAYMENT:${payment.id}`,
        documentType: 'VENDOR_PAYMENT',
        queueBucket: 'cash',
        reference: payment.reference || payment.id,
        subject: bill.billNumber || bill.id,
        counterparty: bill.vendorName || null,
        entity: bill.entity || '',
        amount: Number(payment.amount || 0),
        currency: payment.currency || bill.currency || 'USD',
        dueDate: payment.date || null,
        ageDate: payment.date || payment.createdAt || null,
        operationalStatus: payment.status || 'PAID',
        approvalStatus,
        accountingStatus: payment.accounting?.accountingStatus || 'UNKNOWN',
        evidenceReady: payment.approval?.evidenceSatisfied,
        evidenceCount: payment.approval?.qualifiedEvidenceCount ?? payment.evidenceRecords?.length ?? 0,
        evidenceRequiredCount: payment.approval?.minEvidenceCount || 0,
        issueCount: payment.accounting?.issueCount || 0,
        blockedReasons,
        reviewState: blockedReasons.length ? 'BLOCKED' : 'PENDING_APPROVAL',
        drawerRef: `vendor-payment:${payment.id}`
      });
    }
  }

  for (const expense of expenses.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const approvalStatus = String(expense.approval?.approvalStatus || expense.approvalStatus || '').toUpperCase();
    const blockedReasons = buildQueueBlockedReasons({
      approval: expense.approval,
      accounting: expense.accounting,
      rejectionReason: expense.rejectionReason || ''
    });
    const pendingApproval = approvalStatus === 'PENDING';
    if (!pendingApproval && !blockedReasons.length) continue;
    items.push({
      id: `EXPENSE:${expense.id}`,
      documentType: 'EXPENSE',
      queueBucket: 'spend',
      reference: expense.id,
      subject: expense.description || 'Expense',
      counterparty: expense.employeeId || expense.sourceAccountName || expense.account || null,
      entity: expense.entity || '',
      amount: Number(expense.amount || 0),
      currency: expense.currency || 'USD',
      dueDate: expense.date || null,
      ageDate: expense.date || expense.createdAt || null,
      operationalStatus: expense.status || 'PENDING_REIMBURSEMENT',
      approvalStatus,
      accountingStatus: expense.accounting?.accountingStatus || 'UNKNOWN',
      evidenceReady: expense.approval?.evidenceSatisfied,
      evidenceCount: expense.approval?.qualifiedEvidenceCount ?? expense.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: expense.approval?.minEvidenceCount || 0,
      issueCount: expense.accounting?.issueCount || 0,
      blockedReasons,
      reviewState: pendingApproval ? 'PENDING_APPROVAL' : 'BLOCKED',
      drawerRef: `expense:${expense.id}`
    });
  }

  for (const reimbursement of reimbursements.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const reimbursementApproval = buildApprovalState(db, {
      documentType: 'REIMBURSEMENT',
      entityType: 'EXPENSE',
      entityId: reimbursement.id,
      entity: reimbursement.entity,
      amount: reimbursement.amount,
      operationalStatus: reimbursement.reimbursementStatus,
      approvalStatus: String(reimbursement.reimbursementStatus || '').toUpperCase() === 'REIMBURSED' ? 'APPROVED' : 'PENDING',
      createdByUserId: reimbursement.createdByUserId,
      approvedByUserId: reimbursement.approvedByUserId
    });
    const blockedReasons = buildQueueBlockedReasons({
      approval: reimbursementApproval,
      accounting: reimbursement.accounting,
      additional: String(reimbursement.approval?.approvalStatus || reimbursement.approvalStatus || '').toUpperCase() === 'APPROVED'
        ? []
        : ['Expense approval must be completed before settlement.']
    });
    const readyToSettle = String(reimbursement.reimbursementStatus || '').toUpperCase() === 'PENDING' && String(reimbursement.approval?.approvalStatus || reimbursement.approvalStatus || '').toUpperCase() === 'APPROVED';
    if (!readyToSettle && !blockedReasons.length) continue;
    items.push({
      id: `REIMBURSEMENT:${reimbursement.id}`,
      documentType: 'REIMBURSEMENT',
      queueBucket: 'spend',
      reference: reimbursement.id,
      subject: reimbursement.description || 'Reimbursement',
      counterparty: reimbursement.employeeId || 'Employee claim',
      entity: reimbursement.entity || '',
      amount: Number(reimbursement.amount || 0),
      currency: reimbursement.currency || 'USD',
      dueDate: reimbursement.date || null,
      ageDate: reimbursement.date || reimbursement.createdAt || null,
      operationalStatus: reimbursement.reimbursementStatus || 'PENDING',
      approvalStatus: reimbursementApproval.approvalStatus || 'PENDING',
      accountingStatus: reimbursement.accounting?.accountingStatus || 'UNKNOWN',
      evidenceReady: reimbursementApproval.evidenceSatisfied,
      evidenceCount: reimbursementApproval.qualifiedEvidenceCount ?? reimbursementApproval.evidenceCount ?? reimbursement.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: reimbursementApproval.minEvidenceCount || 0,
      issueCount: reimbursement.accounting?.issueCount || 0,
      blockedReasons,
      reviewState: readyToSettle ? 'READY_TO_SETTLE' : 'BLOCKED',
      drawerRef: `expense:${reimbursement.id}`
    });
  }

  for (const journal of journals.filter((row) => !user || financeRecordVisibleToUser(user, row.entity))) {
    const approvalStatus = String(journal.approval?.approvalStatus || journal.status || '').toUpperCase();
    const blockedReasons = buildQueueBlockedReasons({
      approval: journal.approval,
      accounting: journal.accounting,
      rejectionReason: journal.rejectionReason || ''
    });
    const status = String(journal.status || '').toUpperCase();
    const pendingApproval = status === 'PENDING_APPROVAL';
    const readyToPost = status === 'APPROVED';
    if (!pendingApproval && !readyToPost && !blockedReasons.length) continue;
    items.push({
      id: `JOURNAL:${journal.id}`,
      documentType: 'JOURNAL',
      queueBucket: 'journals',
      reference: journal.journalNumber || journal.id,
      subject: journal.memo || `${journal.journalType || 'Journal'} entry`,
      counterparty: journal.sourceType || null,
      entity: journal.entity || '',
      amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
      currency: journal.currency || 'USD',
      dueDate: journal.postingDate || null,
      ageDate: journal.postingDate || journal.createdAt || null,
      operationalStatus: journal.status || 'DRAFT',
      approvalStatus,
      accountingStatus: journal.accounting?.accountingStatus || status,
      evidenceReady: journal.approval?.evidenceSatisfied,
      evidenceCount: journal.approval?.qualifiedEvidenceCount ?? journal.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: journal.approval?.minEvidenceCount || 0,
      issueCount: journal.accounting?.issueCount || 0,
      blockedReasons,
      reviewState: pendingApproval ? 'PENDING_APPROVAL' : readyToPost ? 'READY_TO_POST' : 'BLOCKED',
      drawerRef: `journal:${journal.id}`
    });
  }

  for (const period of closePeriods) {
    if (String(period.status || '').toUpperCase() === 'CLOSED') continue;
    const checklist = period.checklist || {};
    const checks = checklist.checks || [];
    const blockerCount = checks.filter((item) => !item.pass).length;
    const blockedReasons = checks.filter((item) => !item.pass).slice(0, 3).map((item) => item.label);
    items.push({
      id: `CLOSE_PERIOD:${period.periodKey}`,
      documentType: 'CLOSE_PERIOD',
      queueBucket: 'close',
      reference: period.periodKey,
      subject: 'Month-end close',
      counterparty: null,
      entity: null,
      amount: Number(period.relatedPartySnapshot?.summary?.outstandingBalance || checklist.metrics?.openAr || 0),
      currency: period.relatedPartySnapshot?.reportingCurrency || 'USD',
      dueDate: checklist.end || period.periodKey,
      ageDate: checklist.end || `${period.periodKey}-01`,
      operationalStatus: period.status || 'OPEN',
      approvalStatus: period.approval?.approvalStatus || 'OPEN',
      accountingStatus: blockerCount ? 'ATTENTION_REQUIRED' : 'READY',
      evidenceReady: period.approval?.evidenceSatisfied,
      evidenceCount: period.approval?.qualifiedEvidenceCount ?? period.evidenceRecords?.length ?? 0,
      evidenceRequiredCount: period.approval?.minEvidenceCount || 0,
      issueCount: blockerCount,
      blockedReasons,
      reviewState: blockerCount ? 'BLOCKED' : 'READY_TO_CLOSE',
      drawerRef: `period:${period.periodKey}`,
      priority: blockerCount ? 'URGENT' : 'HIGH'
    });
  }

  return buildReviewQueue(items);
}

function projectVisibleToUser(db, project, user) {
  if (!project || !user) return false;
  if (isPrivilegedFinance(user.role)) return true;
  if (user.role === role.PROJECT_MANAGER) return project.projectManagerId === user.id;
  if (user.role === role.EMPLOYEE) {
    return db.timeEntries.some((entry) => entry.projectId === project.id && entry.userId === user.id);
  }
  return user.role === role.VIEWER;
}

function invoiceVisibleToUser(db, invoice, user) {
  if (!invoice || !user) return false;
  if (isPrivilegedFinance(user.role)) return true;
  const project = getProject(db, invoice.projectId);
  if (user.role === role.PROJECT_MANAGER) return project?.projectManagerId === user.id;
  if (user.role === role.EMPLOYEE) return invoice.createdByUserId === user.id;
  return user.role === role.VIEWER;
}

function timeEntryVisibleToUser(db, entry, user) {
  if (!entry || !user) return false;
  if (isPrivilegedFinance(user.role)) return true;
  if (user.role === role.PROJECT_MANAGER) {
    const project = getProject(db, entry.projectId);
    return project?.projectManagerId === user.id || entry.userId === user.id;
  }
  if (user.role === role.EMPLOYEE) return entry.userId === user.id;
  return false;
}

function allowedEntitiesForUser(user) {
  return Array.isArray(user?.allowedEntities)
    ? user.allowedEntities.map((value) => String(value || '').toUpperCase().trim()).filter(Boolean)
    : [];
}

function financeRecordVisibleToUser(user, entity) {
  if (!user || !isPrivilegedFinance(user.role)) return false;
  const allowedEntities = allowedEntitiesForUser(user);
  if (!allowedEntities.length) return true;
  if (!entity) return true;
  return allowedEntities.includes(String(entity || '').toUpperCase().trim());
}

function inferEntityFromTransaction({ account = '', currency = '', sourceSystem = '' }) {
  const accountText = String(account || '').toLowerCase();
  const source = String(sourceSystem || '').toLowerCase();
  const curr = String(currency || '').toUpperCase();

  if (source.includes('qbo_uk') || source.includes('uk')) return 'UK';
  if (source.includes('qbo_us') || source.includes('us')) return 'US';
  if (source.includes('pak') || source.includes('meezan')) return 'PK';

  if (accountText.includes('wise') || accountText.includes('uk')) return 'UK';
  if (accountText.includes('meezan') || accountText.includes('pakistan') || accountText.includes('pk')) return 'PK';
  if (accountText.includes('bofa') || accountText.includes('bank of america') || accountText.includes('chase') || accountText.includes('us')) return 'US';

  if (curr === 'GBP') return 'UK';
  if (curr === 'PKR') return 'PK';
  if (curr === 'USD') return 'US';
  return null;
}

function isReimbursableExpense(tx) {
  if (tx.reimbursable === true) return true;
  const text = `${tx.description || ''} ${tx.memo || ''} ${tx.notes || ''}`.toLowerCase();
  return text.includes('#biz') || text.includes('#reimbursable') || text.includes('reimbursable');
}

function applyTransactionDefaults(db, tx, { source = 'MANUAL' } = {}) {
  const row = { ...tx };
  row.source = row.source || source;
  row.currency = String(row.currency || db.settings?.defaultCurrency || 'USD').toUpperCase();
  row.entity = row.entity || inferEntityFromTransaction({ account: row.account, currency: row.currency, sourceSystem: row.source });
  row.reimbursable = Boolean(row.reimbursable);
  row.matchedAmount = asMoney(row.matchedAmount || 0);
  row.linkedInvoiceIds = Array.isArray(row.linkedInvoiceIds) ? Array.from(new Set(row.linkedInvoiceIds.filter(Boolean))) : [];
  if (!row.channel) {
    const text = `${row.description || ''} ${row.account || ''}`.toLowerCase();
    row.channel = text.includes('upwork') ? 'UPWORK' : null;
  }
  row.lineOfService = row.lineOfService || null;
  return row;
}

function runClassifier(db, tx) {
  const accountText = String(tx.account || '').toLowerCase();
  const descriptionText = String(tx.description || '').toLowerCase();

  // Business rule: Chase card defaults to Asnan partner draw unless explicitly tagged reimbursable.
  if (accountText.includes('chase')) {
    if (isReimbursableExpense(tx)) return 'Operating Expense';
    return 'Partner Draw - Asnan';
  }

  if (descriptionText.includes('upwork')) {
    return Number(tx.amount || 0) >= 0 ? 'Revenue' : 'Upwork Fee';
  }

  const text = `${tx.description || ''} ${tx.account || ''}`.toLowerCase();
  const rule = (db.classificationRules || []).find((row) => text.includes(String(row.pattern).toLowerCase()));
  return rule?.category || tx.category || 'Unclassified';
}

function parseCsvRows(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((v) => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] || '';
    });
    rows.push(row);
  }
  return rows;
}

function buildReconciliationBoard(db) {
  const openInvoices = db.invoices
    .map((invoice) => {
      const outstanding = asMoney(Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0));
      if (outstanding <= 0) return null;
      if (!['APPROVED', 'SENT', 'PARTIAL', 'OVERDUE'].includes(invoice.status)) return null;
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientId: invoice.clientId,
        clientName: invoice.clientName,
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        status: invoice.status,
        outstanding
      };
    })
    .filter(Boolean);

  const unmatchedTransactions = db.transactions
    .filter((tx) => Number(tx.amount || 0) > 0)
    .map((tx) => {
      const absolute = asMoney(Math.abs(Number(tx.amount || 0)));
      const matchedAmount = asMoney(tx.matchedAmount || 0);
      const remaining = asMoney(Math.max(absolute - matchedAmount, 0));
      return { ...tx, remaining };
    })
    .filter((tx) => tx.remaining > 0)
    .map((tx) => ({
      id: tx.id,
      date: tx.date,
      account: tx.account,
      description: tx.description,
      amount: tx.remaining,
      originalAmount: asMoney(tx.amount),
      matchedAmount: asMoney(tx.matchedAmount || 0),
      currency: tx.currency,
      entity: tx.entity || null,
      channel: tx.channel || null
    }));

  const suggestions = [];
  for (const tx of unmatchedTransactions) {
    const candidates = openInvoices
      .filter((invoice) => invoice.currency === tx.currency)
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        outstanding: invoice.outstanding,
        diff: asMoney(Math.abs(Number(invoice.outstanding || 0) - Number(tx.amount || 0)))
      }))
      .filter((candidate) => candidate.diff <= 2)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3);
    if (candidates.length) {
      suggestions.push({
        transactionId: tx.id,
        amount: tx.amount,
        currency: tx.currency,
        candidates
      });
    }
  }

  return {
    summary: {
      openInvoiceCount: openInvoices.length,
      unmatchedTransactionCount: unmatchedTransactions.length,
      suggestedMatches: suggestions.length
    },
    openInvoices,
    unmatchedTransactions,
    suggestions
  };
}

function applyTransactionAllocations(db, transactionId, allocations, actor) {
  const tx = db.transactions.find((row) => row.id === transactionId);
  if (!tx) return { error: 'Transaction not found.' };
  if (Number(tx.amount || 0) <= 0) {
    return { error: 'Only credit/inflow transactions can be matched to invoices.' };
  }

  tx.matchedAmount = asMoney(tx.matchedAmount || 0);
  tx.linkedInvoiceIds = Array.isArray(tx.linkedInvoiceIds) ? tx.linkedInvoiceIds : [];

  const absoluteAmount = asMoney(Math.abs(Number(tx.amount || 0)));
  const remainingBefore = asMoney(Math.max(absoluteAmount - tx.matchedAmount, 0));
  if (remainingBefore <= 0) return { error: 'Transaction already fully matched.' };

  const normalizedAllocations = (allocations || []).map((row) => ({
    invoiceId: row.invoiceId,
    amount: row.amount !== undefined && row.amount !== null ? asMoney(row.amount) : null
  }));
  if (!normalizedAllocations.length) return { error: 'Provide invoiceId or allocations[].' };

  const invoiceMap = new Map();
  let requestedTotal = 0;
  for (const allocation of normalizedAllocations) {
    if (!allocation.invoiceId) return { error: 'Each allocation requires invoiceId.' };
    const invoice = db.invoices.find((row) => row.id === allocation.invoiceId || row.invoiceNumber === allocation.invoiceId);
    if (!invoice) return { error: `Invoice not found: ${allocation.invoiceId}` };
    if (invoice.currency && tx.currency && String(invoice.currency).toUpperCase() !== String(tx.currency).toUpperCase()) {
      return { error: `Currency mismatch for invoice ${invoice.invoiceNumber}.` };
    }
    const outstanding = asMoney(Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0));
    if (outstanding <= 0) return { error: `Invoice ${invoice.invoiceNumber} has no outstanding balance.` };
    invoiceMap.set(allocation.invoiceId, { invoice, outstanding });
  }

  for (const allocation of normalizedAllocations) {
    const ref = invoiceMap.get(allocation.invoiceId);
    const amount = allocation.amount == null ? ref.outstanding : allocation.amount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: `Invalid allocation amount for invoice ${ref.invoice.invoiceNumber}.` };
    }
    if (amount - ref.outstanding > 0.01) {
      return { error: `Allocation exceeds outstanding balance for invoice ${ref.invoice.invoiceNumber}.` };
    }
    allocation.amount = asMoney(amount);
    requestedTotal = asMoney(requestedTotal + allocation.amount);
  }

  if (requestedTotal - remainingBefore > 0.01) {
    return { error: `Allocation total ${requestedTotal} exceeds transaction remaining amount ${remainingBefore}.` };
  }

  const payments = [];
  const touchedInvoices = [];
  for (const allocation of normalizedAllocations) {
    const { invoice } = invoiceMap.get(allocation.invoiceId);
    const payment = {
      id: nextId(db, 'PAYMENT', 'PAY'),
      invoiceId: invoice.id,
      amount: allocation.amount,
      currency: tx.currency || invoice.currency || 'USD',
      source: 'BANK_MATCH',
      reference: `${tx.id}:${invoice.id}:${nowIso()}`,
      paidAt: tx.date,
      status: 'PAID',
      approvalStatus: 'AUTO_APPROVED',
      approvedByUserId: actor.sub,
      approvedAt: nowIso(),
      postedAt: nowIso(),
      meta: { transactionId: tx.id, allocation: true },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.payments.push(payment);
    payments.push(payment);

    invoice.amountPaid = asMoney(Number(invoice.amountPaid || 0) + Number(payment.amount || 0));
    invoice.updatedAt = nowIso();
    updateInvoicePaymentState(invoice);
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'PAID',
      actorUserId: actor.sub,
      actorRole: actor.role,
      entity: invoice.entity,
      amount: payment.amount,
      note: payment.reference || payment.source || '',
      metadata: { transactionId: tx.id, allocation: true },
      statusAfter: invoice.status
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'INVOICE',
      sourceRootId: invoice.id,
      actorUserId: actor.sub
    });
    touchedInvoices.push(hydrateInvoice(db, invoice));

    if (!tx.linkedInvoiceIds.includes(invoice.id)) tx.linkedInvoiceIds.push(invoice.id);
  }

  tx.matchedAmount = asMoney(tx.matchedAmount + requestedTotal);
  tx.reconciled = tx.matchedAmount >= absoluteAmount - 0.01;
  tx.invoiceId = tx.linkedInvoiceIds.length === 1 ? tx.linkedInvoiceIds[0] : null;
  clearReconciliationReview(tx, actor, 'MATCHED');
  tx.updatedAt = nowIso();

  appendAudit(db, {
    actorUserId: actor.sub,
    module: 'reconciliation',
    action: 'transaction_matched',
    entityType: 'transaction',
    entityId: tx.id,
    details: JSON.stringify({
      allocations: normalizedAllocations,
      matchedAmount: tx.matchedAmount,
      remainingAmount: asMoney(Math.max(absoluteAmount - tx.matchedAmount, 0))
    })
  });

  return {
    transaction: {
      ...tx,
      remainingAmount: asMoney(Math.max(absoluteAmount - tx.matchedAmount, 0))
    },
    payments,
    invoices: touchedInvoices
  };
}

function buildQboTransactionAdjustments(db, { fromDate = null, toDate = null } = {}) {
  const rows = (db.transactions || []).filter((tx) => {
    if (!String(tx.source || '').toUpperCase().startsWith('QBO')) return false;
    if (fromDate && String(tx.date || '') < fromDate) return false;
    if (toDate && String(tx.date || '') > toDate) return false;
    return true;
  });

  const totals = {
    rowCount: rows.length,
    revenueRecognized: 0,
    operatingExpenses: 0,
    payrollCost: 0,
    cashInflows: 0,
    cashOutflows: 0
  };

  for (const tx of rows) {
    const amount = asMoney(tx.amount || 0);
    const type = String(tx.type || '').toUpperCase();
    const governed = applyEntryGovernance(db, {
      sourceType: 'transaction',
      sourceId: tx.id,
      date: tx.date,
      entity: tx.entity || null,
      currency: tx.currency || db.settings?.reportingCurrency || 'USD',
      lineOfService: tx.lineOfService || null,
      businessUnit: tx.businessUnit || null,
      channel: tx.channel || null,
      category: tx.category || null,
      amount: type === 'DEBIT' ? -Math.abs(amount) : Math.abs(amount),
      reportingAmount: toReportingAmount(db, type === 'DEBIT' ? -Math.abs(amount) : Math.abs(amount), tx.currency || 'USD'),
      intercompanyFlag: Boolean(tx.intercompanyFlag),
      treasuryFlag: Boolean(tx.treasuryFlag),
      capexFlag: Boolean(tx.capexFlag),
      partnerTag: tx.partnerTag || null,
      account: tx.account || null,
      source: tx.source || null,
      sourceAccountId: tx.sourceAccountId || null,
      qboAccountId: tx.qboAccountId || null
    });
    const bucket = entryBucket(governed);

    if (type === 'CREDIT') totals.cashInflows = asMoney(totals.cashInflows + amount);
    if (type === 'DEBIT') totals.cashOutflows = asMoney(totals.cashOutflows + amount);

    if (type === 'CREDIT' && bucket === 'revenue') {
      totals.revenueRecognized = asMoney(totals.revenueRecognized + amount);
    } else if (type === 'DEBIT' && bucket === 'payroll') {
      totals.payrollCost = asMoney(totals.payrollCost + amount);
    } else if (type === 'DEBIT' && ['expense', 'treasury'].includes(bucket)) {
      totals.operatingExpenses = asMoney(totals.operatingExpenses + amount);
    }
  }

  return totals;
}

function normalizeEntity(entity) {
  return normalizeEntityShared(entity);
}

function inferEntityFromCurrency(db, currency) {
  return inferEntityFromCurrencyShared(db, currency);
}

function normalizeAccountRole(value) {
  const roleName = String(value || '').toUpperCase().replace(/\s+/g, '_');
  if (['BANK', 'CREDIT_CARD', 'WALLET', 'AR', 'AP', 'REVENUE', 'EXPENSE', 'EQUITY', 'FIXED_ASSET', 'OTHER_ASSET', 'OTHER_LIABILITY', 'TREASURY'].includes(roleName)) {
    return roleName;
  }
  return 'OTHER';
}

function normalizeSourceSystem(value) {
  const source = String(value || '').toUpperCase().trim();
  if (!source) return 'MANUAL';
  return source;
}

function buildAccountGovernance(db) {
  const globalById = new Map((db.globalChartAccounts || []).map((row) => [row.id, row]));
  const accounts = (db.accounts || [])
    .map((row) => {
      const mapping = (db.accountMappings || []).find((item) => item.sourceAccountId === row.id && String(item.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
      const global = mapping?.globalAccountId ? globalById.get(mapping.globalAccountId) : (row.globalAccountId ? globalById.get(row.globalAccountId) : null);
      return {
        ...row,
        entity: normalizeEntity(row.entity) || inferEntityFromCurrency(db, row.currency) || null,
        accountRole: normalizeAccountRole(row.accountRole),
        sourceSystem: normalizeSourceSystem(row.sourceSystem || row.provider),
        isCashAccount: Boolean(row.isCashAccount),
        showInBankingHub: Boolean(row.showInBankingHub),
        mappedGlobalAccountId: global?.id || null,
        mappedGlobalAccountCode: global?.code || null,
        mappedGlobalAccountName: global?.name || null
      };
    })
    .sort((a, b) => `${a.entity || ''} ${a.name || ''}`.localeCompare(`${b.entity || ''} ${b.name || ''}`));

  const mappings = (db.accountMappings || [])
    .map((row) => ({
      ...row,
      sourceAccount: accounts.find((account) => account.id === row.sourceAccountId) || null,
      globalAccount: row.globalAccountId ? globalById.get(row.globalAccountId) || null : null
    }))
    .sort((a, b) => `${a.sourceAccount?.name || ''} ${a.globalAccount?.code || ''}`.localeCompare(`${b.sourceAccount?.name || ''} ${b.globalAccount?.code || ''}`));

  const globalChartAccounts = [...(db.globalChartAccounts || [])]
    .sort((a, b) => `${a.code || ''} ${a.name || ''}`.localeCompare(`${b.code || ''} ${b.name || ''}`));

  return {
    accounts,
    globalChartAccounts,
    accountMappings: mappings
  };
}

function normalizeLookupText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getActiveAccountMapping(db, sourceAccountId) {
  if (!sourceAccountId) return null;
  return (db.accountMappings || []).find((row) => row.sourceAccountId === sourceAccountId && String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE') || null;
}

function getGlobalAccountById(db, globalAccountId) {
  if (!globalAccountId) return null;
  const rows = db.globalChartAccounts || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].id === globalAccountId) return rows[index];
  }
  return null;
}

function getGlobalAccountByCode(db, code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return null;
  return (db.globalChartAccounts || []).find((row) => String(row.code || '').trim() === normalizedCode) || null;
}

function isProductBusinessUnit(value) {
  const text = String(value || '').toUpperCase();
  return ['PONCHO', 'PRODUCT', 'APP', 'APPS', 'VENTURE'].some((token) => text.includes(token));
}

function inferStarterGlobalCodeForSourceAccount(sourceAccount) {
  const roleName = normalizeAccountRole(sourceAccount?.accountRole);
  const text = `${sourceAccount?.name || ''} ${sourceAccount?.externalName || ''} ${sourceAccount?.notes || ''}`.toLowerCase();

  if (roleName === 'BANK' || roleName === 'WALLET') return '1000';
  if (roleName === 'CREDIT_CARD') return '2100';
  if (roleName === 'AR') return '1100';
  if (roleName === 'AP') return '2000';
  if (roleName === 'FIXED_ASSET') return '1500';
  if (roleName === 'EQUITY') return '3000';
  if (roleName === 'REVENUE') return (text.includes('poncho') || text.includes('product') || text.includes('app')) ? '4100' : '4000';
  if (roleName === 'EXPENSE') {
    if (text.includes('payroll') || text.includes('salary') || text.includes('wage')) return '5100';
    if (text.includes('bank fee') || text.includes('bank charge') || text.includes('merchant fee') || text.includes('processing fee') || text.includes('stripe fee') || text.includes('upwork fee') || text.includes('fx')) return '5200';
    return '5000';
  }
  if (roleName === 'OTHER_ASSET') {
    if (text.includes('undeposited') || text.includes('clearing') || text.includes('customer payment')) return '1010';
    if (text.includes('tower') || text.includes('asar') || text.includes('capex')) return '1500';
    if (text.includes('related') || text.includes('partner') || text.includes('due from') || text.includes('loan')) return '1200';
  }
  if (roleName === 'OTHER_LIABILITY') {
    if (text.includes('card') || text.includes('credit')) return '2100';
    return '2000';
  }
  return null;
}

function sourceAccountMatchesLookup(sourceAccount, normalizedAccount) {
  if (!sourceAccount || !normalizedAccount) return false;
  const candidates = [sourceAccount.name, sourceAccount.externalName, sourceAccount.externalCode]
    .filter(Boolean)
    .map((value) => normalizeLookupText(value));
  return candidates.some((value) => value === normalizedAccount || value.includes(normalizedAccount) || normalizedAccount.includes(value));
}

function resolveSourceAccount(db, {
  sourceAccountId = null,
  qboAccountId = null,
  account = null,
  entity = null,
  currency = null,
  sourceSystem = null
} = {}) {
  const accounts = (db.accounts || []).filter((row) => String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE');
  const explicitById = sourceAccountId ? accounts.find((row) => row.id === sourceAccountId) || null : null;
  if (explicitById && !account) return explicitById;
  if (qboAccountId) {
    const byQboId = accounts.find((row) => String(row.qboAccountId || '') === String(qboAccountId));
    if (byQboId) return byQboId;
  }

  const normalizedAccount = normalizeLookupText(account);
  if (!normalizedAccount) return explicitById;
  const normalizedEntity = normalizeEntity(entity);
  const normalizedCurrency = String(currency || '').toUpperCase().trim();
  const normalizedSource = normalizeSourceSystem(sourceSystem);

  const candidates = accounts
    .map((row) => {
      const names = [row.name, row.externalName, row.externalCode]
        .filter(Boolean)
        .map((value) => normalizeLookupText(value));
      let score = 0;
      if (names.some((value) => value === normalizedAccount)) score += 10;
      else if (names.some((value) => value.includes(normalizedAccount) || normalizedAccount.includes(value))) score += 6;
      if (normalizedEntity && normalizeEntity(row.entity) === normalizedEntity) score += 3;
      if (normalizedCurrency && String(row.currency || '').toUpperCase() === normalizedCurrency) score += 2;
      if (normalizedSource && normalizeSourceSystem(row.sourceSystem || row.provider) === normalizedSource) score += 1;
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const bestByName = candidates[0]?.row || null;
  if (!explicitById) return bestByName;
  if (sourceAccountMatchesLookup(explicitById, normalizedAccount)) return explicitById;
  return bestByName || explicitById;
}

function validateSelectedSourceAccount(account, {
  sourceAccountId = null,
  entity = null,
  currency = null,
  allowedRoles = [],
  fieldLabel = 'source account'
} = {}) {
  if (!sourceAccountId) return null;
  if (!account) return `Selected ${fieldLabel} was not found in account governance.`;
  return validateSourceAccountContext(account, { entity, currency, allowedRoles, fieldLabel });
}

function resolveMappedGlobalAccount(db, sourceAccount) {
  if (!sourceAccount) return null;
  const mapping = getActiveAccountMapping(db, sourceAccount.id);
  if (mapping?.globalAccountId) return getGlobalAccountById(db, mapping.globalAccountId);
  if (sourceAccount.globalAccountId) return getGlobalAccountById(db, sourceAccount.globalAccountId);
  const starterCode = inferStarterGlobalCodeForSourceAccount(sourceAccount);
  return starterCode ? getGlobalAccountByCode(db, starterCode) : null;
}

function inferGlobalCodeForEntry(entry, sourceAccount = null) {
  const sourceType = String(entry.sourceType || '').toLowerCase();
  const category = String(entry.category || '').toLowerCase();
  const businessUnit = String(entry.businessUnit || '').toUpperCase();
  const channel = String(entry.channel || '').toUpperCase();
  const accountText = `${entry.account || ''} ${sourceAccount?.name || ''} ${sourceAccount?.externalName || ''}`.toLowerCase();

  if (entry.capexFlag || sourceType === 'asar_cost' || category.includes('capex') || category.includes('asset') || accountText.includes('tower') || accountText.includes('asar')) return '1500';
  if (sourceType === 'partner_draw' || category.includes('partner draw') || category.includes('withdraw') || entry.partnerTag) return '3000';
  if (sourceType === 'invoice') return isProductBusinessUnit(businessUnit) ? '4100' : '4000';
  if (sourceType === 'poncho_settlement') return Number(entry.amount || 0) >= 0 ? '4100' : '5000';
  if (sourceType.startsWith('payroll') || category.includes('payroll') || category.includes('salary') || category.includes('wage')) return '5100';
  if (category.includes('bank fee') || category.includes('upwork fee') || category.includes('fx') || (category.includes('fee') && (entry.treasuryFlag || channel === 'UPWORK'))) return '5200';
  if (category.includes('revenue') || category.includes('income')) return isProductBusinessUnit(businessUnit) ? '4100' : '4000';
  if (category.includes('expense') || category.includes('cost')) return '5000';

  const sourceRole = normalizeAccountRole(sourceAccount?.accountRole);
  if (sourceRole === 'AR') return '1100';
  if (sourceRole === 'AP') return '2000';
  if (sourceRole === 'CREDIT_CARD') return '2100';
  if (sourceRole === 'BANK' || sourceRole === 'WALLET') return '1000';

  return inferStarterGlobalCodeForSourceAccount(sourceAccount);
}

function applyEntryGovernance(db, entry) {
  const sourceAccount = resolveSourceAccount(db, {
    sourceAccountId: entry.sourceAccountId,
    qboAccountId: entry.qboAccountId,
    account: entry.account,
    entity: entry.entity,
    currency: entry.currency,
    sourceSystem: entry.source || entry.sourceSystem
  });
  const mappedGlobal = resolveMappedGlobalAccount(db, sourceAccount);
  const sourceRole = normalizeAccountRole(sourceAccount?.accountRole);
  const inferredCode = inferGlobalCodeForEntry(entry, sourceAccount);
  const inferredGlobal = inferredCode ? getGlobalAccountByCode(db, inferredCode) : null;
  const sourceType = String(entry.sourceType || '').toLowerCase();
  const category = String(entry.category || '').toLowerCase();
  const forceRuleBasedMapping = Boolean(
    entry.capexFlag
    || sourceType === 'partner_draw'
    || sourceType === 'asar_cost'
    || sourceType.startsWith('payroll')
    || category.includes('partner draw')
    || category.includes('withdraw')
    || category.includes('salary')
    || category.includes('wage')
    || category.includes('payroll')
    || category.includes('capex')
    || category.includes('asset')
  );
  const sourceMappingSuitable = mappedGlobal && !forceRuleBasedMapping && !['BANK', 'CREDIT_CARD', 'WALLET'].includes(sourceRole);

  let globalAccount = sourceMappingSuitable ? mappedGlobal : null;
  let mappingBasis = sourceMappingSuitable ? 'SOURCE_MAPPING' : 'UNMAPPED';

  if (!globalAccount) {
    if (inferredGlobal) {
      globalAccount = inferredGlobal;
      mappingBasis = mappedGlobal && inferredGlobal.id === mappedGlobal.id ? 'SOURCE_MAPPING' : 'RULE';
    }
  }
  if (!globalAccount && mappedGlobal) {
    globalAccount = mappedGlobal;
    mappingBasis = 'SOURCE_MAPPING';
  }

  return {
    ...entry,
    sourceAccountId: sourceAccount?.id || entry.sourceAccountId || null,
    sourceAccountName: sourceAccount?.name || entry.account || null,
    sourceAccountRole: sourceRole || entry.sourceAccountRole || null,
    globalAccountId: globalAccount?.id || entry.globalAccountId || null,
    globalAccountCode: globalAccount?.code || null,
    globalAccountName: globalAccount?.name || null,
    globalAccountType: globalAccount?.type || null,
    globalReportingGroup: globalAccount?.reportingGroup || null,
    mappingBasis,
    mappingStatus: globalAccount ? 'MAPPED' : 'UNMAPPED'
  };
}

function applyGovernanceStamp(db, row, sourceType) {
  const governed = applyEntryGovernance(db, {
    sourceType,
    sourceId: row.id,
    date: row.date || null,
    entity: row.entity || null,
    currency: row.currency || db.settings?.reportingCurrency || 'USD',
    businessUnit: row.businessUnit || null,
    channel: row.channel || null,
    category: row.category || null,
    amount: row.amount || 0,
    capexFlag: Boolean(row.capexFlag),
    treasuryFlag: Boolean(row.treasuryFlag),
    partnerTag: row.partnerTag || null,
    account: row.account || null,
    source: row.source || null,
    sourceAccountId: row.sourceAccountId || null,
    qboAccountId: row.qboAccountId || null
  });
  row.sourceAccountId = governed.sourceAccountId || null;
  row.globalAccountId = governed.globalAccountId || null;
  return row;
}

function toReportingAmount(db, amount, currency) {
  return toReportingAmountShared(db, amount, currency);
}

function isTransferLikeTransaction(tx) {
  const category = String(tx.category || '').toLowerCase();
  const text = `${tx.description || ''} ${tx.account || ''} ${tx.reference || ''}`.toLowerCase();
  return category.includes('cash inflow')
    || category.includes('cash outflow')
    || category.includes('transfer')
    || text.includes('transfer')
    || text.includes('intercompany')
    || text.includes('sweep')
    || text.includes('funding');
}

function getInvoiceLineOfService(db, invoice) {
  if (!invoice) return null;
  if (invoice.lineOfService) return invoice.lineOfService;
  const project = invoice.projectId ? getProject(db, invoice.projectId) : null;
  return project?.lineOfService || null;
}

function buildManagementEntries(db, { fromDate = null, toDate = null } = {}) {
  const entries = [];
  const inRange = (dateValue) => (!fromDate || String(dateValue || '') >= fromDate) && (!toDate || String(dateValue || '') <= toDate);
  const reportingCurrency = String(db.settings?.reportingCurrency || 'USD').toUpperCase();

  for (const invoice of db.invoices || []) {
    if (!['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(invoice.status)) continue;
    if (!inRange(invoice.issueDate)) continue;

    const entity = normalizeEntity(invoice.entity) || inferEntityFromCurrency(db, invoice.currency) || 'US';
    const lineOfService = getInvoiceLineOfService(db, invoice);
    const businessUnit = invoice.businessUnit || 'SERVICES';
    const amount = asMoney(invoice.total || 0);
    const reportingAmount = toReportingAmount(db, amount, invoice.currency || reportingCurrency);

    entries.push({
      sourceType: 'invoice',
      sourceId: invoice.id,
      date: invoice.issueDate,
      entity,
      currency: String(invoice.currency || reportingCurrency).toUpperCase(),
      lineOfService,
      businessUnit,
      channel: invoice.channel || null,
      category: 'Revenue',
      amount,
      reportingAmount,
      intercompanyFlag: false,
      treasuryFlag: false,
      capexFlag: false,
      partnerTag: null,
      account: null,
      source: 'ERP_INVOICE',
      sourceAccountId: null,
      qboAccountId: null
    });
  }

  for (const expense of db.expenses || []) {
    if (!inRange(expense.date)) continue;
    const amount = -Math.abs(asMoney(expense.amount || 0));
    const entity = normalizeEntity(expense.entity) || inferEntityFromTransaction({
      account: expense.account,
      currency: expense.currency,
      sourceSystem: expense.source || ''
    }) || inferEntityFromCurrency(db, expense.currency) || 'US';
    entries.push({
      sourceType: 'expense',
      sourceId: expense.id,
      date: expense.date,
      entity,
      currency: String(expense.currency || reportingCurrency).toUpperCase(),
      lineOfService: expense.lineOfService || null,
      businessUnit: expense.businessUnit || 'CORPORATE',
      channel: expense.channel || null,
      category: expense.category || 'Operating Expense',
      amount,
      reportingAmount: toReportingAmount(db, amount, expense.currency || reportingCurrency),
      intercompanyFlag: Boolean(expense.intercompanyFlag),
      treasuryFlag: Boolean(expense.treasuryFlag),
      capexFlag: Boolean(expense.capexFlag) || String(expense.category || '').toLowerCase().includes('capex'),
      partnerTag: expense.partnerTag || null,
      account: expense.account || null,
      source: expense.source || 'ERP_EXPENSE',
      sourceAccountId: expense.sourceAccountId || null,
      qboAccountId: expense.qboAccountId || null
    });
  }

  for (const bill of db.vendorBills || []) {
    const hydrated = hydrateVendorBill(db, bill);
    if (!['OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'APPROVED'].includes(String(hydrated.status || '').toUpperCase())) continue;
    if (!inRange(hydrated.billDate)) continue;
    const entity = normalizeEntity(hydrated.entity) || inferEntityFromCurrency(db, hydrated.currency) || 'US';
    const lines = Array.isArray(hydrated.lineItems) && hydrated.lineItems.length
      ? hydrated.lineItems
      : [{
        description: hydrated.notes || hydrated.billNumber || hydrated.vendorName || 'Vendor bill',
        amount: hydrated.total || 0,
        category: hydrated.category || 'Operating Expense',
        businessUnit: hydrated.businessUnit || 'CORPORATE',
        lineOfService: hydrated.lineOfService || null,
        capexFlag: false
      }];

    for (const line of lines) {
      const amount = -Math.abs(asMoney(line.amount || 0));
      entries.push({
        sourceType: 'vendor_bill',
        sourceId: hydrated.id,
        date: hydrated.billDate,
        entity,
        currency: String(hydrated.currency || reportingCurrency).toUpperCase(),
        lineOfService: line.lineOfService || hydrated.lineOfService || null,
        businessUnit: line.businessUnit || hydrated.businessUnit || 'CORPORATE',
        channel: null,
        category: line.category || hydrated.category || 'Operating Expense',
        amount,
        reportingAmount: toReportingAmount(db, amount, hydrated.currency || reportingCurrency),
        intercompanyFlag: false,
        treasuryFlag: false,
        capexFlag: Boolean(line.capexFlag),
        partnerTag: null,
        account: hydrated.account || null,
        source: hydrated.source || 'ERP_AP',
        sourceAccountId: hydrated.sourceAccountId || null,
        qboAccountId: hydrated.qboAccountId || null
      });
    }
  }

  for (const settlement of db.ponchoSettlements || []) {
    if (!inRange(settlement.date)) continue;
    const amount = asMoney(settlement.amount || 0);
    const entity = normalizeEntity(settlement.entity) || inferEntityFromCurrency(db, settlement.currency) || 'UK';
    entries.push({
      sourceType: 'poncho_settlement',
      sourceId: settlement.id,
      date: settlement.date,
      entity,
      currency: String(settlement.currency || reportingCurrency).toUpperCase(),
      lineOfService: null,
      businessUnit: String(settlement.businessUnit || 'PONCHO').toUpperCase(),
      channel: settlement.channel || null,
      category: amount >= 0 ? 'Revenue' : 'Operating Expense',
      amount,
      reportingAmount: toReportingAmount(db, amount, settlement.currency || reportingCurrency),
      intercompanyFlag: false,
      treasuryFlag: false,
      capexFlag: false,
      partnerTag: null,
      account: null,
      source: 'ERP_PONCHO',
      sourceAccountId: null,
      qboAccountId: null
    });
  }

  for (const capex of db.asarTowerCosts || []) {
    if (!inRange(capex.date)) continue;
    const amount = -Math.abs(asMoney(capex.amount || 0));
    const entity = normalizeEntity(capex.entity) || inferEntityFromCurrency(db, capex.currency) || 'PK';
    entries.push({
      sourceType: 'asar_cost',
      sourceId: capex.id,
      date: capex.date,
      entity,
      currency: String(capex.currency || reportingCurrency).toUpperCase(),
      lineOfService: null,
      businessUnit: String(capex.businessUnit || 'TOWER').toUpperCase(),
      channel: null,
      category: capex.category || 'Capex',
      amount,
      reportingAmount: toReportingAmount(db, amount, capex.currency || reportingCurrency),
      intercompanyFlag: false,
      treasuryFlag: false,
      capexFlag: true,
      partnerTag: null,
      account: null,
      source: 'ERP_CAPEX',
      sourceAccountId: null,
      qboAccountId: null
    });
  }

  const payrollItemByRun = new Map();
  for (const item of db.payrollItems || []) {
    if (!payrollItemByRun.has(item.runId)) payrollItemByRun.set(item.runId, []);
    payrollItemByRun.get(item.runId).push(item);
  }

  for (const run of db.payrollRuns || []) {
    const runDate = `${run.year}-${String(run.month).padStart(2, '0')}-01`;
    if (!inRange(runDate)) continue;
    const items = payrollItemByRun.get(run.id) || [];
    if (!items.length) {
      const amount = -Math.abs(asMoney(run.totalNet || 0));
      entries.push({
        sourceType: 'payroll',
        sourceId: run.id,
        date: runDate,
        entity: 'PK',
        currency: reportingCurrency,
        lineOfService: null,
        businessUnit: 'CORPORATE',
        channel: null,
        category: 'Payroll',
        amount,
        reportingAmount: toReportingAmount(db, amount, reportingCurrency),
        intercompanyFlag: false,
        treasuryFlag: false,
        capexFlag: false,
        partnerTag: null,
        account: null,
        source: 'ERP_PAYROLL',
        sourceAccountId: null,
        qboAccountId: null
      });
      continue;
    }
    for (const item of items) {
      const amount = -Math.abs(asMoney(item.netPay || 0));
      const entity = normalizeEntity(item.entity) || inferEntityFromCurrency(db, item.currency) || 'PK';
      entries.push({
        sourceType: 'payroll_item',
        sourceId: item.id,
        date: runDate,
        entity,
        currency: String(item.currency || reportingCurrency).toUpperCase(),
        lineOfService: item.lineOfService || null,
        businessUnit: item.businessUnit || 'CORPORATE',
        channel: null,
        category: 'Payroll',
        amount,
        reportingAmount: toReportingAmount(db, amount, item.currency || reportingCurrency),
        intercompanyFlag: Boolean(item.intercompanyFlag),
        treasuryFlag: false,
        capexFlag: false,
        partnerTag: null,
        account: null,
        source: 'ERP_PAYROLL',
        sourceAccountId: null,
        qboAccountId: null
      });
    }
  }

  for (const draw of db.partnerDraws || []) {
    if (!inRange(draw.date)) continue;
    const amount = -Math.abs(asMoney(draw.amount || 0));
    const partner = getUser(db, draw.userId);
    const entity = normalizeEntity(draw.entity) || inferEntityFromCurrency(db, draw.currency) || 'US';
    entries.push({
      sourceType: 'partner_draw',
      sourceId: draw.id,
      date: draw.date,
      entity,
      currency: String(draw.currency || reportingCurrency).toUpperCase(),
      lineOfService: null,
      businessUnit: 'CORPORATE',
      channel: null,
      category: 'Partner Draw',
      amount,
      reportingAmount: toReportingAmount(db, amount, draw.currency || reportingCurrency),
      intercompanyFlag: false,
      treasuryFlag: true,
      capexFlag: false,
      partnerTag: partner?.name || draw.userId || null,
      account: null,
      source: 'ERP_PARTNER_DRAW',
      sourceAccountId: null,
      qboAccountId: null
    });
  }

  const supplementalCategories = [
    'bank fee',
    'upwork fee',
    'partner draw',
    'treasury',
    'fx ',
    'revenue adjustment',
    'expense reversal',
    'equity movement',
    'asset movement'
  ];

  for (const tx of db.transactions || []) {
    if (!inRange(tx.date)) continue;
    const category = String(tx.category || '').trim();
    const categoryLower = category.toLowerCase();
    const include = supplementalCategories.some((needle) => categoryLower.includes(needle))
      || Boolean(tx.treasuryFlag)
      || Boolean(tx.intercompanyFlag)
      || categoryLower.includes('cash inflow')
      || categoryLower.includes('cash outflow');
    if (!include) continue;

    const signedAmount = String(tx.type || '').toUpperCase() === 'DEBIT'
      ? -Math.abs(asMoney(tx.amount || 0))
      : Math.abs(asMoney(tx.amount || 0));
    const entity = normalizeEntity(tx.entity) || inferEntityFromTransaction({
      account: tx.account,
      currency: tx.currency,
      sourceSystem: tx.source
    }) || inferEntityFromCurrency(db, tx.currency) || 'US';
    const intercompanyFlag = Boolean(tx.intercompanyFlag) || isTransferLikeTransaction(tx);
    const treasuryFlag = Boolean(tx.treasuryFlag) || categoryLower.includes('bank fee') || categoryLower.includes('fx') || categoryLower.includes('cash ');

    entries.push({
      sourceType: 'transaction',
      sourceId: tx.id,
      date: tx.date,
      entity,
      currency: String(tx.currency || reportingCurrency).toUpperCase(),
      lineOfService: tx.lineOfService || null,
      businessUnit: tx.businessUnit || null,
      channel: tx.channel || null,
      category: category || 'Unclassified',
      amount: signedAmount,
      reportingAmount: toReportingAmount(db, signedAmount, tx.currency || reportingCurrency),
      intercompanyFlag,
      treasuryFlag,
      capexFlag: Boolean(tx.capexFlag),
      partnerTag: tx.partnerTag || (categoryLower.includes('partner draw') ? 'Asnan' : null),
      account: tx.account || null,
      source: tx.source || null,
      sourceAccountId: tx.sourceAccountId || null,
      qboAccountId: tx.qboAccountId || null
    });
  }

  for (const adj of db.managementAdjustments || []) {
    if (String(adj.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
    const effectiveDate = adj.effectiveDate || adj.date || toDateKey(nowIso());
    if (!inRange(effectiveDate)) continue;
    const amount = Math.abs(asMoney(adj.amount || 0));
    if (!amount) continue;
    const currency = String(adj.currency || reportingCurrency).toUpperCase();
    const sourceTx = adj.sourceTransactionId ? db.transactions.find((row) => row.id === adj.sourceTransactionId) : null;
    const entity = normalizeEntity(adj.entity) || sourceTx?.entity || inferEntityFromCurrency(db, currency) || 'US';
    const lineOfService = adj.lineOfService ?? sourceTx?.lineOfService ?? null;
    const businessUnit = adj.businessUnit ?? sourceTx?.businessUnit ?? null;
    const channel = adj.channel ?? sourceTx?.channel ?? null;

    if (adj.fromCategory) {
      const entryAmount = -amount;
      entries.push({
        sourceType: 'management_adjustment',
        sourceId: adj.id,
        date: effectiveDate,
        entity,
        currency,
        lineOfService,
        businessUnit,
        channel,
        category: adj.fromCategory,
        amount: entryAmount,
        reportingAmount: toReportingAmount(db, entryAmount, currency),
        intercompanyFlag: false,
        treasuryFlag: false,
        capexFlag: false,
        partnerTag: adj.partnerTag || null,
        account: sourceTx?.account || null,
        source: 'MANAGEMENT_ADJUSTMENT',
        sourceAccountId: sourceTx?.sourceAccountId || null,
        qboAccountId: sourceTx?.qboAccountId || null
      });
    }
    if (adj.toCategory) {
      const entryAmount = amount;
      entries.push({
        sourceType: 'management_adjustment',
        sourceId: adj.id,
        date: effectiveDate,
        entity,
        currency,
        lineOfService,
        businessUnit,
        channel,
        category: adj.toCategory,
        amount: entryAmount,
        reportingAmount: toReportingAmount(db, entryAmount, currency),
        intercompanyFlag: false,
        treasuryFlag: false,
        capexFlag: false,
        partnerTag: adj.partnerTag || null,
        account: sourceTx?.account || null,
        source: 'MANAGEMENT_ADJUSTMENT',
        sourceAccountId: sourceTx?.sourceAccountId || null,
        qboAccountId: sourceTx?.qboAccountId || null
      });
    }
  }

  return entries.map((entry) => applyEntryGovernance(db, entry));
}

function entryBucket(entry) {
  const globalType = String(entry.globalAccountType || '').toUpperCase();
  const reportingGroup = String(entry.globalReportingGroup || '').toUpperCase();
  const globalCode = String(entry.globalAccountCode || '').trim();
  const globalName = String(entry.globalAccountName || '').toUpperCase();
  const category = String(entry.category || '').toLowerCase();
  if (entry.sourceType === 'partner_draw' || category.includes('partner draw') || category.includes('withdraw')) return 'partnerDraw';
  if (globalCode === '1500' || reportingGroup === 'CAPEX') return 'capex';
  if (globalCode === '5100' || globalName.includes('PAYROLL')) return 'payroll';
  if (globalType === 'INCOME') return 'revenue';
  if (globalType === 'EXPENSE' && reportingGroup === 'TREASURY') return 'treasury';
  if (globalType === 'EXPENSE') return 'expense';
  if (['ASSET', 'LIABILITY', 'EQUITY'].includes(globalType)) return 'balanceSheet';
  if (category.includes('revenue')) return 'revenue';
  if (category.includes('payroll')) return 'payroll';
  if (category.includes('partner draw')) return 'partnerDraw';
  if (category.includes('bank fee') || category.includes('treasury') || category.includes('fx') || category.includes('cash inflow') || category.includes('cash outflow')) return 'treasury';
  if (category.includes('capex') || category.includes('asset')) return 'capex';
  return 'expense';
}

function summarizeManagementEntries(entries) {
  const summary = {
    revenue: 0,
    expense: 0,
    payroll: 0,
    partnerDraw: 0,
    treasury: 0,
    capex: 0,
    net: 0
  };
  for (const entry of entries) {
    const bucket = entryBucket(entry);
    const value = asMoney(entry.reportingAmount || 0);
    if (bucket === 'revenue') summary.revenue = asMoney(summary.revenue + value);
    else if (bucket === 'payroll') summary.payroll = asMoney(summary.payroll + Math.abs(value));
    else if (bucket === 'partnerDraw') summary.partnerDraw = asMoney(summary.partnerDraw + Math.abs(value));
    else if (bucket === 'treasury') summary.treasury = asMoney(summary.treasury + Math.abs(value));
    else if (bucket === 'capex') summary.capex = asMoney(summary.capex + Math.abs(value));
    else if (bucket === 'balanceSheet') continue;
    else summary.expense = asMoney(summary.expense + Math.abs(value));
  }
  summary.net = asMoney(summary.revenue - summary.expense - summary.payroll - summary.partnerDraw - summary.treasury);
  return summary;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const text = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'y'].includes(text)) return true;
  if (['0', 'false', 'no', 'n'].includes(text)) return false;
  return defaultValue;
}

function pushSummaryValue(summary, bucket, numeric) {
  const value = asMoney(numeric || 0);
  if (bucket === 'revenue') summary.revenue = asMoney(summary.revenue + value);
  else if (bucket === 'payroll') summary.payroll = asMoney(summary.payroll + Math.abs(value));
  else if (bucket === 'partnerDraw') summary.partnerDraw = asMoney(summary.partnerDraw + Math.abs(value));
  else if (bucket === 'treasury') summary.treasury = asMoney(summary.treasury + Math.abs(value));
  else if (bucket === 'capex') summary.capex = asMoney(summary.capex + Math.abs(value));
  else if (bucket === 'balanceSheet') return;
  else summary.expense = asMoney(summary.expense + Math.abs(value));
}

function createSummarySeed() {
  return {
    revenue: 0,
    expense: 0,
    payroll: 0,
    partnerDraw: 0,
    treasury: 0,
    capex: 0,
    net: 0
  };
}

function finalizeSummary(summary) {
  summary.net = asMoney(summary.revenue - summary.expense - summary.payroll - summary.partnerDraw - summary.treasury);
  return summary;
}

function summarizeBy(entries, keySelector) {
  const buckets = new Map();
  for (const entry of entries) {
    const keyRaw = keySelector(entry);
    const key = keyRaw == null || keyRaw === '' ? 'UNSPECIFIED' : String(keyRaw);
    if (!buckets.has(key)) buckets.set(key, createSummarySeed());
    const current = buckets.get(key);
    pushSummaryValue(current, entryBucket(entry), asMoney(entry.reportingAmount || 0));
  }
  return [...buckets.entries()]
    .map(([key, summary]) => ({ key, ...finalizeSummary(summary) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

function summarizeMonthly(entries) {
  return summarizeBy(entries, (entry) => String(entry.date || '').slice(0, 7))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function summarizeMappingCoverage(entries) {
  const summary = {
    totalEntries: entries.length,
    mappedEntries: 0,
    sourceMappedEntries: 0,
    ruleMappedEntries: 0,
    unmappedEntries: 0
  };
  for (const entry of entries) {
    if (entry.mappingStatus === 'MAPPED') {
      summary.mappedEntries += 1;
      if (entry.mappingBasis === 'SOURCE_MAPPING') summary.sourceMappedEntries += 1;
      else summary.ruleMappedEntries += 1;
    } else {
      summary.unmappedEntries += 1;
    }
  }
  summary.coveragePct = summary.totalEntries ? asMoney((summary.mappedEntries / summary.totalEntries) * 100) : 100;
  return summary;
}

function buildQboTransactionFeed(
  db,
  {
    fromDate = null,
    toDate = null,
    entity = null,
    objectType = null,
    search = '',
    limit = 500
  } = {}
) {
  const normalizedEntity = entity ? String(entity).toUpperCase() : null;
  const normalizedObjectType = objectType ? String(objectType).toUpperCase() : null;
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const maxRows = Math.max(1, Math.min(Number(limit || 500), 5000));

  let rows = (db.transactions || []).filter((row) => String(row.source || '').toUpperCase().startsWith('QBO'));
  if (fromDate) rows = rows.filter((row) => String(row.date || '') >= String(fromDate));
  if (toDate) rows = rows.filter((row) => String(row.date || '') <= String(toDate));
  if (normalizedEntity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === normalizedEntity);
  if (normalizedObjectType) rows = rows.filter((row) => String(row.sourceObjectType || '').toUpperCase() === normalizedObjectType);
  if (normalizedSearch) {
    rows = rows.filter((row) => {
      const hay = [
        row.id,
        row.reference,
        row.account,
        row.description,
        row.category,
        row.sourceObjectType,
        row.sourceObjectId,
        row.sourceLineId,
        row.qboAccountId,
        row.counterparty
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return hay.includes(normalizedSearch);
    });
  }

  rows = rows.map((row) => applyEntryGovernance(db, {
    sourceType: 'transaction',
    sourceId: row.id,
    date: row.date,
    entity: row.entity || null,
    currency: row.currency || db.settings?.reportingCurrency || 'USD',
    lineOfService: row.lineOfService || null,
    businessUnit: row.businessUnit || null,
    channel: row.channel || null,
    category: row.category || null,
    amount: String(row.type || '').toUpperCase() === 'DEBIT' ? -Math.abs(asMoney(row.amount || 0)) : Math.abs(asMoney(row.amount || 0)),
    reportingAmount: toReportingAmount(db, String(row.type || '').toUpperCase() === 'DEBIT' ? -Math.abs(asMoney(row.amount || 0)) : Math.abs(asMoney(row.amount || 0)), row.currency || 'USD'),
    intercompanyFlag: Boolean(row.intercompanyFlag),
    treasuryFlag: Boolean(row.treasuryFlag),
    capexFlag: Boolean(row.capexFlag),
    partnerTag: row.partnerTag || null,
    account: row.account || null,
    source: row.source || null,
    sourceAccountId: row.sourceAccountId || null,
    qboAccountId: row.qboAccountId || null,
    sourceObjectType: row.sourceObjectType || null,
    sourceObjectId: row.sourceObjectId || null,
    sourceLineId: row.sourceLineId || null,
    reference: row.reference || null,
    counterparty: row.counterparty || null,
    type: row.type || null
  }));

  rows.sort((a, b) => {
    const dateA = String(a.date || '');
    const dateB = String(b.date || '');
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    return String(a.updatedAt || '') < String(b.updatedAt || '') ? 1 : -1;
  });

  const inflows = rows
    .filter((row) => String(row.type || '').toUpperCase() === 'CREDIT')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outflows = rows
    .filter((row) => String(row.type || '').toUpperCase() === 'DEBIT')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const requiredFields = [
    'date',
    'account',
    'amount',
    'currency',
    'type',
    'category',
    'source',
    'reference',
    'entity',
    'sourceObjectType',
    'sourceObjectId',
    'sourceLineId'
  ];
  const fieldCoverage = requiredFields.map((field) => {
    const missing = rows.filter((row) => row[field] === undefined || row[field] === null || row[field] === '').length;
    return {
      field,
      present: rows.length - missing,
      missing,
      completenessPct: rows.length ? asMoney(((rows.length - missing) / rows.length) * 100) : 100
    };
  });

  const byObjectMap = new Map();
  const byEntityMap = new Map();
  const bySourceMap = new Map();
  for (const row of rows) {
    const objectKey = String(row.sourceObjectType || 'UNKNOWN');
    const entityKey = String(row.entity || 'UNSPECIFIED');
    const sourceKey = String(row.source || 'UNSPECIFIED');

    if (!byObjectMap.has(objectKey)) byObjectMap.set(objectKey, { objectType: objectKey, count: 0, inflow: 0, outflow: 0 });
    if (!byEntityMap.has(entityKey)) byEntityMap.set(entityKey, { entity: entityKey, count: 0, inflow: 0, outflow: 0 });
    if (!bySourceMap.has(sourceKey)) bySourceMap.set(sourceKey, { source: sourceKey, count: 0, inflow: 0, outflow: 0 });

    const objectRow = byObjectMap.get(objectKey);
    const entityRow = byEntityMap.get(entityKey);
    const sourceRow = bySourceMap.get(sourceKey);
    objectRow.count += 1;
    entityRow.count += 1;
    sourceRow.count += 1;

    if (String(row.type || '').toUpperCase() === 'CREDIT') {
      objectRow.inflow = asMoney(objectRow.inflow + Number(row.amount || 0));
      entityRow.inflow = asMoney(entityRow.inflow + Number(row.amount || 0));
      sourceRow.inflow = asMoney(sourceRow.inflow + Number(row.amount || 0));
    } else if (String(row.type || '').toUpperCase() === 'DEBIT') {
      objectRow.outflow = asMoney(objectRow.outflow + Number(row.amount || 0));
      entityRow.outflow = asMoney(entityRow.outflow + Number(row.amount || 0));
      sourceRow.outflow = asMoney(sourceRow.outflow + Number(row.amount || 0));
    }
  }

  const byObject = [...byObjectMap.values()].sort((a, b) => b.count - a.count);
  const byEntity = [...byEntityMap.values()].sort((a, b) => b.count - a.count);
  const bySource = [...bySourceMap.values()].sort((a, b) => b.count - a.count);
  const rowsWithSourceLinks = rows.filter((row) => row.sourceObjectType && row.sourceObjectId).length;

  return {
    filters: {
      fromDate,
      toDate,
      entity: normalizedEntity,
      objectType: normalizedObjectType,
      search: normalizedSearch || null,
      limit: maxRows
    },
    summary: {
      rowCount: rows.length,
      returnedRows: Math.min(rows.length, maxRows),
      inflows: asMoney(inflows),
      outflows: asMoney(outflows),
      net: asMoney(inflows - outflows),
      sourceLinkedRows: rowsWithSourceLinks,
      sourceLinkedPct: rows.length ? asMoney((rowsWithSourceLinks / rows.length) * 100) : 0
    },
    byObject,
    byEntity,
    bySource,
    fieldCoverage,
    transactions: rows.slice(0, maxRows)
  };
}

function computeInvoiceAmounts(lineItems, taxRate) {
  const normalizedLines = (lineItems || []).map((line) => {
    const qty = Number(line.qty ?? line.quantity ?? 0);
    const rate = Number(line.rate ?? line.unitRate ?? 0);
    const amount = asMoney(qty * rate);
    return {
      description: line.description || 'Service line',
      qty,
      rate,
      amount,
      timeEntryIds: Array.isArray(line.timeEntryIds) ? line.timeEntryIds : []
    };
  });
  const subtotal = asMoney(normalizedLines.reduce((sum, row) => sum + row.amount, 0));
  const appliedTaxRate = Number(taxRate || 0);
  const taxAmount = asMoney(subtotal * appliedTaxRate);
  const total = asMoney(subtotal + taxAmount);
  return { normalizedLines, subtotal, taxAmount, total, appliedTaxRate };
}

function updateInvoicePaymentState(invoice) {
  const paid = asMoney(invoice.amountPaid || 0);
  const total = asMoney(invoice.total || 0);
  if (paid <= 0) {
    if (invoice.status === 'OVERDUE') return invoice;
    if (['SENT', 'APPROVED', 'PARTIAL'].includes(invoice.status)) {
      const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
      if (due && due.getTime() < Date.now()) {
        invoice.status = 'OVERDUE';
      }
    }
    return invoice;
  }
  if (paid >= total) {
    invoice.status = 'PAID';
    invoice.paymentDate = toDateKey(Date.now());
    return invoice;
  }
  invoice.status = 'PARTIAL';
  return invoice;
}

function getInvoicePayments(db, invoiceId) {
  return db.payments.filter((row) => row.invoiceId === invoiceId);
}

function hydrateCustomerReceipt(db, payment, invoice = null) {
  const linkedInvoice = invoice || getInvoice(db, payment.invoiceId);
  const evidenceSummary = evidenceSummaryForEntity(db, {
    entityType: 'CUSTOMER_RECEIPT',
    entityId: payment.id
  });
  const accounting = buildSourceEventAccountingSnapshot(db, 'INVOICE_PAYMENT', payment.id, payment.approvalStatus || 'PENDING');
  return {
    ...payment,
    entity: linkedInvoice?.entity || null,
    approvalStatus: payment.approvalStatus || 'AUTO_APPROVED',
    evidenceRecords: buildEvidenceRecords(db, 'CUSTOMER_RECEIPT', payment.id),
    evidenceControl: buildEvidenceControl(db, 'CUSTOMER_RECEIPT', payment.id),
    approval: buildApprovalState(db, {
      documentType: 'CUSTOMER_RECEIPT',
      entityType: 'CUSTOMER_RECEIPT',
      entityId: payment.id,
      entity: linkedInvoice?.entity || '*',
      amount: payment.amount,
      operationalStatus: payment.status || 'PAID',
      approvalStatus: payment.approvalStatus || 'AUTO_APPROVED',
      createdByUserId: payment.createdByUserId || null,
      approvedByUserId: payment.approvedByUserId || null
    }),
    evidenceSummary,
    journalLineage: accounting.lineage,
    accounting
  };
}

function hydrateInvoice(db, invoice) {
  const project = getProject(db, invoice.projectId);
  const client = getClient(db, invoice.clientId);
  const createdBy = getUser(db, invoice.createdByUserId);
  const approvedBy = getUser(db, invoice.approvedByUserId);
  const payments = getInvoicePayments(db, invoice.id).map((row) => hydrateCustomerReceipt(db, row, invoice));
  const qboLogs = (db.qbo.syncLogs || []).filter((row) => row.entityType === 'INVOICE' && row.entityId === invoice.id);
  return {
    ...invoice,
    project,
    client,
    createdBy: createdBy ? safeUser(createdBy) : null,
    approvedBy: approvedBy ? safeUser(approvedBy) : null,
    payments,
    qboSyncLogs: qboLogs,
    evidenceRecords: buildEvidenceRecords(db, 'INVOICE', invoice.id),
    evidenceControl: buildEvidenceControl(db, 'INVOICE', invoice.id),
    approval: buildApprovalState(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      entity: invoice.entity,
      amount: invoice.total,
      operationalStatus: invoice.status,
      approvalStatus: invoice.approvalStatus || null,
      createdByUserId: invoice.createdByUserId,
      approvedByUserId: invoice.approvedByUserId
    }),
    journalLineage: buildSourceJournalLineage(db, 'INVOICE', invoice.id),
    accounting: buildSourceAccountingSnapshot(db, 'INVOICE', invoice.id)
  };
}

function buildProjectSummary(db, project) {
  const entries = db.timeEntries.filter((row) => row.projectId === project.id);
  const billableEntries = entries.filter((row) => row.billable);
  const billedEntries = billableEntries.filter((row) => row.invoiceId);
  const unbilledEntries = billableEntries.filter((row) => !row.invoiceId);
  const invoices = db.invoices.filter((row) => row.projectId === project.id);
  const totalBilled = asMoney(invoices.reduce((sum, row) => sum + Number(row.total || 0), 0));
  const budget = Number(project.budgetAmount || 0);
  const budgetPct = budget > 0 ? asMoney((totalBilled / budget) * 100) : null;

  return {
    project,
    summary: {
      hoursLogged: asMoney(entries.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      billableHours: asMoney(billableEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      billedHours: asMoney(billedEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      unbilledHours: asMoney(unbilledEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      invoiceCount: invoices.length,
      totalBilled,
      budget,
      budgetCurrency: project.budgetCurrency || 'USD',
      budgetUtilizationPct: budgetPct
    }
  };
}

function buildInvoiceHtml({ invoice, project, client, companyName }) {
  const lines = (invoice.lineItems || [])
    .map((line, idx) => `<tr><td>${idx + 1}. ${line.description}</td><td>${line.qty}</td><td>${line.rate}</td><td>${line.amount}</td></tr>`)
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${invoice.invoiceNumber}</title>
<style>
body { font-family: 'Segoe UI', sans-serif; color: #0f172a; margin: 28px; }
h1 { margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
th { background: #f8fafc; }
.footer { margin-top: 16px; }
</style>
</head>
<body>
<h1>${companyName}</h1>
<div>Invoice: ${invoice.invoiceNumber}</div>
<div>Client: ${client?.name || invoice.clientName}</div>
<div>Project: ${project?.name || '-'}</div>
<div>Issue Date: ${invoice.issueDate}</div>
<div>Due Date: ${invoice.dueDate || '-'}</div>
<table>
<thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
<tbody>${lines}</tbody>
</table>
<div class="footer">
<div>Subtotal: ${invoice.subtotal}</div>
<div>Tax: ${invoice.taxAmount}</div>
<div><strong>Total: ${invoice.total} ${invoice.currency}</strong></div>
</div>
</body>
</html>`;
}

async function sendQueuedNotifications(db, { force = false } = {}) {
  const pending = db.notificationQueue.filter((row) => row.status === 'QUEUED' || (force && row.status === 'FAILED'));
  if (!pending.length) return { processed: 0 };

  const smtpHost = process.env.SMTP_HOST || '';
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';
  const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@telerelation.local';

  if (!smtpHost) {
    pending.forEach((item) => {
      item.status = 'SENT';
      item.attempts += 1;
      item.sentAt = nowIso();
      item.updatedAt = nowIso();
      item.lastError = null;
    });
    return { processed: pending.length, simulated: true };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined
  });

  let processed = 0;
  for (const item of pending) {
    try {
      await transporter.sendMail({
        from: smtpFrom,
        to: item.recipient,
        subject: item.subject,
        text: item.body
      });
      item.status = 'SENT';
      item.attempts += 1;
      item.sentAt = nowIso();
      item.updatedAt = nowIso();
      item.lastError = null;
      processed += 1;
    } catch (error) {
      item.status = 'FAILED';
      item.attempts += 1;
      item.updatedAt = nowIso();
      item.lastError = error instanceof Error ? error.message : 'Notification send failed';
    }
  }

  return { processed, simulated: false };
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.post('/api/qbo/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const signature = req.get('intuit-signature');
  const verified = verifyWebhookSignature(rawBody, signature);
  if (!verified.ok) return res.status(401).json({ error: verified.reason });

  let payload = null;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload.' });
  }

  let processed = 0;
  withDb((db) => {
    const notifications = Array.isArray(payload.eventNotifications) ? payload.eventNotifications : [];
    for (const notification of notifications) {
      const entities = notification?.dataChangeEvent?.entities || [];
      for (const entity of entities) {
        if (String(entity.name || '').toLowerCase() !== 'payment') continue;
        const paymentAmount = Number(entity.amount || entity.TotalAmt || notification.total || 0);
        const linkedTxns = Array.isArray(entity.linkedInvoices)
          ? entity.linkedInvoices
          : Array.isArray(entity.LinkedTxn)
            ? entity.LinkedTxn
            : [];

        if (!linkedTxns.length && entity.invoiceQboId) {
          linkedTxns.push({ TxnId: entity.invoiceQboId, Amount: paymentAmount });
        }

        for (const link of linkedTxns) {
          const qboInvoiceId = String(link.TxnId || link.txnId || '').trim();
          if (!qboInvoiceId) continue;
          const invoice = db.invoices.find((row) => String(row.qboInvoiceId || '') === qboInvoiceId);
          if (!invoice) continue;

          const amount = asMoney(link.Amount || paymentAmount || 0);
          if (!amount) continue;

          const paymentId = nextId(db, 'PAYMENT', 'PAY');
          db.payments.push({
            id: paymentId,
            invoiceId: invoice.id,
            amount,
            currency: invoice.currency,
            source: 'QBO',
            reference: String(entity.id || paymentId),
            paidAt: toDateKey(Date.now()),
            status: 'PAID',
            approvalStatus: 'AUTO_APPROVED',
            approvedByUserId: null,
            approvedAt: nowIso(),
            postedAt: nowIso(),
            meta: { webhook: true, realmId: notification.realmId || null },
            createdAt: nowIso(),
            updatedAt: nowIso()
          });

          invoice.amountPaid = asMoney(Number(invoice.amountPaid || 0) + amount);
          invoice.updatedAt = nowIso();
          updateInvoicePaymentState(invoice);
          syncSourceRootPostings(db, {
            sourceRootType: 'INVOICE',
            sourceRootId: invoice.id,
            actorUserId: null
          });
          processed += 1;

          recordQboPullLog({
            entityType: 'PAYMENT',
            entityId: invoice.id,
            qboId: String(entity.id || ''),
            requestPayload: entity,
            responsePayload: { amount, invoiceId: invoice.id },
            status: 'SUCCESS'
          });

          appendAudit(db, {
            actorUserId: null,
            module: 'qbo',
            action: 'payment_webhook_applied',
            entityType: 'invoice',
            entityId: invoice.id,
            details: JSON.stringify({ amount, qboInvoiceId })
          });
        }
      }
    }
  });

  return res.json({ ok: true, processed });
});

app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  const db = readDb();
  res.json({ ok: true, app: 'telerelation-finance', version: db.metadata?.version, now: nowIso() });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const session = await loginWithPassword(email, password);
  if (!session) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json(session);
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const idToken = req.body?.idToken;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });
    const session = await loginWithGoogle(idToken);
    return res.json(session);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Google login failed' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
});

app.get('/api/settings/clients', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  return res.json({ clients: db.clients });
});

app.post('/api/settings/clients', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const { name, email, currency = 'USD', status = 'ACTIVE' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const created = withDb((db) => {
    const id = nextId(db, 'CLIENT', 'CLI');
    const row = {
      id,
      name,
      email: email || null,
      currency,
      qboCustomerId: null,
      status,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.clients.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'client_created',
      entityType: 'client',
      entityId: id,
      details: name
    });
    return row;
  });

  return res.status(201).json({ client: created });
});

app.get('/api/settings/team', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const db = readDb();
  return res.json({ users: db.users.map((row) => safeUser(row)) });
});

app.get('/api/settings/categories', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json({ categories: db.categories || [] });
});

app.get('/api/settings/classification-rules', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json({ rules: db.classificationRules || [] });
});

app.post('/api/settings/classification-rules', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const pattern = String(req.body?.pattern || '').trim();
  const category = String(req.body?.category || '').trim();
  if (!pattern || !category) return res.status(400).json({ error: 'pattern and category are required.' });

  const created = withDb((db) => {
    const row = {
      id: nextId(db, 'RULE', 'RULE'),
      pattern,
      category,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.classificationRules.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'classifier',
      action: 'classification_rule_created',
      entityType: 'classification_rule',
      entityId: row.id,
      details: `${pattern} => ${category}`
    });
    return row;
  });
  return res.status(201).json({ rule: created });
});

app.get('/api/settings/finance-model', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const entityBaseCurrencies = db.settings?.entityBaseCurrencies || { US: 'USD', UK: 'GBP', PK: 'PKR' };
  const fxRatesToUSD = db.settings?.fxRatesToUSD || { USD: 1, GBP: 1.27, PKR: 0.0036 };
  const reportingCurrency = String(db.settings?.reportingCurrency || 'USD').toUpperCase();
  const governance = buildAccountGovernance(db);
  const approvalMatrixVersions = listApprovalMatrixVersions(db);
  const activeApprovalMatrixVersion = approvalMatrixVersions.find((row) => row.isActive) || null;

  const lineOfServiceOptions = new Set(['TRDEV', 'TRFINANCE', 'TRBUILD']);
  const businessUnitOptions = new Set(['SERVICES', 'PONCHO', 'CORPORATE', 'TREASURY', 'TOWER']);
  const channelOptions = new Set(['UPWORK']);
  const categoryOptions = new Set((db.categories || []).map((row) => row.name).filter(Boolean));
  for (const project of db.projects || []) {
    if (project.lineOfService) lineOfServiceOptions.add(String(project.lineOfService).toUpperCase());
    if (project.businessUnit) businessUnitOptions.add(String(project.businessUnit).toUpperCase());
  }
  for (const invoice of db.invoices || []) {
    if (invoice.lineOfService) lineOfServiceOptions.add(String(invoice.lineOfService).toUpperCase());
    if (invoice.businessUnit) businessUnitOptions.add(String(invoice.businessUnit).toUpperCase());
    if (invoice.channel) channelOptions.add(String(invoice.channel).toUpperCase());
  }
  for (const tx of db.transactions || []) {
    if (tx.lineOfService) lineOfServiceOptions.add(String(tx.lineOfService).toUpperCase());
    if (tx.businessUnit) businessUnitOptions.add(String(tx.businessUnit).toUpperCase());
    if (tx.channel) channelOptions.add(String(tx.channel).toUpperCase());
    if (tx.category) categoryOptions.add(tx.category);
  }
  for (const expense of db.expenses || []) {
    if (expense.lineOfService) lineOfServiceOptions.add(String(expense.lineOfService).toUpperCase());
    if (expense.businessUnit) businessUnitOptions.add(String(expense.businessUnit).toUpperCase());
    if (expense.channel) channelOptions.add(String(expense.channel).toUpperCase());
    if (expense.category) categoryOptions.add(expense.category);
  }

  return res.json({
    settings: {
      reportingCurrency,
      entityBaseCurrencies,
      fxRatesToUSD,
      pkTax: db.settings?.pkTax || buildDefaultPkTaxSettings(),
      approvalMatrix: activeApprovalMatrixVersion
        ? {
            rules: activeApprovalMatrixVersion.rules || [],
            activeVersionId: activeApprovalMatrixVersion.id,
            activeVersionNumber: activeApprovalMatrixVersion.versionNumber,
            activeVersionEffectiveAt: activeApprovalMatrixVersion.effectiveAt
          }
        : (db.settings?.approvalMatrix || null)
    },
    approvalMatrixVersions,
    dimensions: {
      entities: ['US', 'UK', 'PK'],
      lineOfService: [...lineOfServiceOptions].sort(),
      businessUnit: [...businessUnitOptions].sort(),
      channels: [...channelOptions].sort(),
      categories: [...categoryOptions].sort()
    },
    sourceAccounts: governance.accounts,
    globalChartAccounts: governance.globalChartAccounts,
    accountMappings: governance.accountMappings
  });
});

app.patch('/api/settings/finance-model', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const nextEntityCurrencies = { ...(db.settings?.entityBaseCurrencies || { US: 'USD', UK: 'GBP', PK: 'PKR' }) };
    if (payload.entityBaseCurrencies && typeof payload.entityBaseCurrencies === 'object') {
      for (const [entity, currency] of Object.entries(payload.entityBaseCurrencies)) {
        const normalizedEntity = normalizeEntity(entity);
        if (!normalizedEntity) continue;
        nextEntityCurrencies[normalizedEntity] = String(currency || '').toUpperCase().trim() || nextEntityCurrencies[normalizedEntity];
      }
    }

    const nextFxRates = { ...(db.settings?.fxRatesToUSD || { USD: 1, GBP: 1.27, PKR: 0.0036 }) };
    if (payload.fxRatesToUSD && typeof payload.fxRatesToUSD === 'object') {
      for (const [currency, rate] of Object.entries(payload.fxRatesToUSD)) {
        const code = String(currency || '').toUpperCase().trim();
        if (!code) continue;
        const numeric = Number(rate);
        if (Number.isFinite(numeric) && numeric > 0) {
          nextFxRates[code] = asRate(numeric);
        }
      }
    }

    const reportingCurrency = payload.reportingCurrency
      ? String(payload.reportingCurrency).toUpperCase().trim()
      : String(db.settings?.reportingCurrency || 'USD').toUpperCase();
    if (!nextFxRates[reportingCurrency]) nextFxRates[reportingCurrency] = 1;
    if (!nextFxRates.USD) nextFxRates.USD = 1;

    db.settings.reportingCurrency = reportingCurrency;
    db.settings.entityBaseCurrencies = nextEntityCurrencies;
    db.settings.fxRatesToUSD = nextFxRates;
    if (payload.pkTax && typeof payload.pkTax === 'object') {
      const defaults = buildDefaultPkTaxSettings();
      const nextPkTax = {
        ...defaults,
        ...(db.settings?.pkTax || {}),
        ...payload.pkTax,
        deductibilityDefaults: {
          ...defaults.deductibilityDefaults,
          ...(db.settings?.pkTax?.deductibilityDefaults || {}),
          ...(payload.pkTax.deductibilityDefaults || {})
        },
        statutoryDeductions: {
          ...defaults.statutoryDeductions,
          ...(db.settings?.pkTax?.statutoryDeductions || {}),
          ...(payload.pkTax.statutoryDeductions || {})
        },
        salaryComponents: Array.isArray(payload.pkTax.salaryComponents) && payload.pkTax.salaryComponents.length
          ? payload.pkTax.salaryComponents
          : (Array.isArray(db.settings?.pkTax?.salaryComponents) && db.settings.pkTax.salaryComponents.length
            ? db.settings.pkTax.salaryComponents
            : defaults.salaryComponents),
        salaryTaxSlabs: Array.isArray(payload.pkTax.salaryTaxSlabs) && payload.pkTax.salaryTaxSlabs.length
          ? payload.pkTax.salaryTaxSlabs
          : (Array.isArray(db.settings?.pkTax?.salaryTaxSlabs) && db.settings.pkTax.salaryTaxSlabs.length
            ? db.settings.pkTax.salaryTaxSlabs
            : defaults.salaryTaxSlabs),
        references: Array.isArray(db.settings?.pkTax?.references) && db.settings.pkTax.references.length
          ? db.settings.pkTax.references
          : defaults.references
      };
      nextPkTax.entityType = String(nextPkTax.entityType || defaults.entityType).toUpperCase();
      nextPkTax.payrollEnabled = nextPkTax.payrollEnabled !== false;
      nextPkTax.payrollFrequency = String(nextPkTax.payrollFrequency || defaults.payrollFrequency).toUpperCase();
      nextPkTax.withholdingSection = String(nextPkTax.withholdingSection || defaults.withholdingSection);
      nextPkTax.taxYearLabel = String(nextPkTax.taxYearLabel || defaults.taxYearLabel);
      nextPkTax.deductibilityDefaults.defaultExpenseTreatment = String(nextPkTax.deductibilityDefaults.defaultExpenseTreatment || defaults.deductibilityDefaults.defaultExpenseTreatment).toUpperCase();
      nextPkTax.deductibilityDefaults.payrollTreatment = String(nextPkTax.deductibilityDefaults.payrollTreatment || defaults.deductibilityDefaults.payrollTreatment).toUpperCase();
      db.settings.pkTax = nextPkTax;
    }
    let approvalMatrixChange = { version: null, changed: false };
    if (payload.approvalMatrix && Array.isArray(payload.approvalMatrix.rules) && payload.approvalMatrix.rules.length) {
      approvalMatrixChange = upsertApprovalMatrixVersion(db, {
        rules: payload.approvalMatrix.rules,
        actorUserId: req.user.sub,
        reason: payload.approvalMatrixReason || 'Finance model approval policy updated'
      });
      if (approvalMatrixChange.changed && approvalMatrixChange.version) {
        appendAudit(db, {
          actorUserId: req.user.sub,
          module: 'approvals',
          action: 'approval_matrix_version_created',
          entityType: 'approval_matrix_version',
          entityId: approvalMatrixChange.version.id,
          details: JSON.stringify({
            versionNumber: approvalMatrixChange.version.versionNumber,
            effectiveAt: approvalMatrixChange.version.effectiveAt,
            changeReason: approvalMatrixChange.version.changeReason
          })
        });
      }
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'finance_model_updated',
      entityType: 'settings',
      entityId: 'finance-model',
      details: JSON.stringify({
        reportingCurrency,
        entityBaseCurrencies: nextEntityCurrencies,
        fxRatesToUSD: nextFxRates,
        pkTax: db.settings.pkTax,
        approvalMatrixVersionId: approvalMatrixChange.version?.id || db.settings?.activeApprovalMatrixVersionId || null,
        approvalMatrixChanged: Boolean(approvalMatrixChange.changed)
      })
    });

    const approvalMatrixVersions = listApprovalMatrixVersions(db);
    const activeApprovalMatrixVersion = approvalMatrixVersions.find((row) => row.isActive) || null;

    return {
      reportingCurrency,
      entityBaseCurrencies: nextEntityCurrencies,
      fxRatesToUSD: nextFxRates,
      pkTax: db.settings.pkTax,
      approvalMatrix: activeApprovalMatrixVersion
        ? {
            rules: activeApprovalMatrixVersion.rules || [],
            activeVersionId: activeApprovalMatrixVersion.id,
            activeVersionNumber: activeApprovalMatrixVersion.versionNumber,
            activeVersionEffectiveAt: activeApprovalMatrixVersion.effectiveAt
          }
        : null,
      approvalMatrixVersions
    };
  });

  return res.json({ settings: result });
});

app.get('/api/opening-balances', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const rows = listOpeningBalances(db, { entity: req.query.entity || null }).map((row) => hydrateOpeningBalanceRow(db, row));
  return res.json({ openingBalances: rows });
});

app.post('/api/opening-balances', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    try {
      const row = createOpeningBalanceBatch(db, payload, req.user.sub);
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'opening_balances',
        action: 'opening_balance_batch_created',
        entityType: 'opening_balance',
        entityId: row.id,
        details: JSON.stringify({
          asOfDate: row.asOfDate,
          entity: row.entity,
          currency: row.currency,
          lineCount: (row.lines || []).length
        })
      });
      return { openingBalance: hydrateOpeningBalanceRow(db, row) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Opening balance creation failed.' };
    }
  });
  if (result.error) return res.status(409).json({ error: result.error });
  return res.status(201).json(result);
});

app.get('/api/evidence', requireAuth, (req, res) => {
  const entityType = String(req.query.entityType || '').toUpperCase();
  const entityId = String(req.query.entityId || '');
  if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId are required.' });
  const db = readDb();
  try {
    assertEvidenceAccess(db, req.user, { entityType, entityId, mode: 'read' });
    return res.json({
      evidence: buildEvidenceRecords(db, entityType, entityId),
      evidenceControl: buildEvidenceControl(db, entityType, entityId)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evidence access denied.';
    return res.status(message.includes('not found') ? 404 : 403).json({ error: message });
  }
});

app.post('/api/evidence', requireAuth, (req, res) => {
  const payload = req.body || {};
  const entityType = String(payload.entityType || '').toUpperCase();
  const entityId = String(payload.entityId || '');
  if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId are required.' });

  const result = withDb((db) => {
    try {
      assertEvidenceMutationAllowed(db, req.user, { entityType, entityId });
      const evidence = createEvidenceRecord(db, payload, req.user.sub, { baseDir: evidenceDir });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'evidence',
        action: 'evidence_uploaded',
        entityType: String(payload.entityType || '').toLowerCase(),
        entityId,
        details: JSON.stringify({ evidenceId: evidence.id, fileName: evidence.fileName, category: evidence.category })
      });
      return { evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evidence upload failed.';
      const status = message.includes('not found')
        ? 404
        : message.includes('denied')
          ? 403
          : 409;
      return { error: message, status };
    }
  });

  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.status(201).json(result);
});

app.get('/api/evidence/:evidenceId/download', requireAuth, (req, res) => {
  const db = readDb();
  try {
    const descriptor = getEvidenceDescriptor(db, req.params.evidenceId);
    assertEvidenceAccess(db, req.user, {
      entityType: descriptor.record.entityType,
      entityId: descriptor.record.entityId,
      mode: 'read'
    });
    res.setHeader('Content-Type', descriptor.record.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=\"${descriptor.record.fileName}\"`);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'evidence',
      action: 'evidence_downloaded',
      entityType: String(descriptor.record.entityType || '').toLowerCase(),
      entityId: descriptor.record.entityId,
      details: descriptor.record.id
    });
    writeDb(db);
    return descriptor.stream.pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evidence not found.';
    const status = message.includes('denied') ? 403 : 404;
    return res.status(status).json({ error: message });
  }
});

app.delete('/api/evidence/:evidenceId', requireAuth, (req, res) => {
  const result = withDb((db) => {
    try {
      const descriptor = getEvidenceDescriptor(db, req.params.evidenceId);
      assertEvidenceMutationAllowed(db, req.user, {
        entityType: descriptor.record.entityType,
        entityId: descriptor.record.entityId
      });
      const evidence = removeEvidenceRecord(db, req.params.evidenceId, req.user.sub, req.body?.note || '');
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'evidence',
        action: 'evidence_removed',
        entityType: String(evidence.entityType || '').toLowerCase(),
        entityId: evidence.entityId,
        details: JSON.stringify({ evidenceId: evidence.id, note: evidence.removalNote || '' })
      });
      return { evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evidence removal failed.';
      const status = message.includes('not found')
        ? 404
        : message.includes('locked')
          ? 409
          : 403;
      return { error: message, status };
    }
  });
  if (result.error) return res.status(result.status || 404).json({ error: result.error });
  return res.json(result);
});

app.get('/api/settings/account-governance', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json(buildAccountGovernance(db));
});

app.post('/api/settings/accounts', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const created = withDb((db) => {
    const row = {
      id: nextId(db, 'ACCOUNT', 'ACC'),
      name,
      provider: String(payload.provider || payload.sourceSystem || 'MANUAL').trim() || 'MANUAL',
      sourceSystem: normalizeSourceSystem(payload.sourceSystem || payload.provider),
      sourceLedger: String(payload.sourceLedger || payload.sourceSystem || payload.provider || 'MANUAL').toUpperCase(),
      entity: normalizeEntity(payload.entity) || inferEntityFromCurrency(db, payload.currency || db.settings?.defaultCurrency || 'USD') || null,
      currency: String(payload.currency || db.settings?.defaultCurrency || 'USD').toUpperCase(),
      accountRole: normalizeAccountRole(payload.accountRole),
      isCashAccount: payload.isCashAccount === undefined ? false : Boolean(payload.isCashAccount),
      showInBankingHub: payload.showInBankingHub === undefined ? Boolean(payload.isCashAccount) : Boolean(payload.showInBankingHub),
      externalCode: payload.externalCode || null,
      externalName: payload.externalName || name,
      qboAccountId: payload.qboAccountId || null,
      accountType: payload.accountType || null,
      accountSubType: payload.accountSubType || null,
      globalAccountId: payload.globalAccountId || null,
      notes: payload.notes || '',
      status: String(payload.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      currentBalance: asMoney(payload.currentBalance || 0),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.accounts.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'source_account_created',
      entityType: 'account',
      entityId: row.id,
      details: JSON.stringify({ name: row.name, entity: row.entity, sourceSystem: row.sourceSystem })
    });
    return row;
  });

  return res.status(201).json({ account: created });
});

app.patch('/api/settings/accounts/:accountId', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const updated = withDb((db) => {
    const row = (db.accounts || []).find((item) => item.id === req.params.accountId);
    if (!row) return { error: 'Source account not found.' };
    if (payload.name !== undefined) row.name = String(payload.name || row.name).trim() || row.name;
    if (payload.provider !== undefined) row.provider = String(payload.provider || row.provider || 'MANUAL').trim() || row.provider;
    if (payload.sourceSystem !== undefined) row.sourceSystem = normalizeSourceSystem(payload.sourceSystem || row.sourceSystem || row.provider);
    if (payload.sourceLedger !== undefined) row.sourceLedger = String(payload.sourceLedger || row.sourceLedger || row.sourceSystem || 'MANUAL').toUpperCase();
    if (payload.entity !== undefined) row.entity = normalizeEntity(payload.entity) || row.entity || null;
    if (payload.currency !== undefined) row.currency = String(payload.currency || row.currency || 'USD').toUpperCase();
    if (payload.accountRole !== undefined) row.accountRole = normalizeAccountRole(payload.accountRole);
    if (payload.isCashAccount !== undefined) row.isCashAccount = Boolean(payload.isCashAccount);
    if (payload.showInBankingHub !== undefined) row.showInBankingHub = Boolean(payload.showInBankingHub);
    if (payload.externalCode !== undefined) row.externalCode = payload.externalCode || null;
    if (payload.externalName !== undefined) row.externalName = payload.externalName || row.name;
    if (payload.globalAccountId !== undefined) row.globalAccountId = payload.globalAccountId || null;
    if (payload.notes !== undefined) row.notes = payload.notes || '';
    if (payload.status !== undefined) row.status = String(payload.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    row.updatedAt = nowIso();

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'source_account_updated',
      entityType: 'account',
      entityId: row.id,
      details: JSON.stringify(payload)
    });
    return { account: row };
  });
  if (updated.error) return res.status(404).json(updated);
  return res.json(updated);
});

app.post('/api/settings/global-chart-accounts', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const code = String(payload.code || '').trim();
  const name = String(payload.name || '').trim();
  if (!code || !name) return res.status(400).json({ error: 'code and name are required.' });

  const created = withDb((db) => {
    const row = {
      id: nextId(db, 'GLOBAL_ACCOUNT', 'GLA'),
      code,
      name,
      type: String(payload.type || 'OTHER').toUpperCase(),
      reportingGroup: payload.reportingGroup || null,
      notes: payload.notes || '',
      status: String(payload.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.globalChartAccounts.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'global_chart_account_created',
      entityType: 'global_chart_account',
      entityId: row.id,
      details: JSON.stringify({ code: row.code, name: row.name })
    });
    return row;
  });
  return res.status(201).json({ globalAccount: created });
});

app.patch('/api/settings/global-chart-accounts/:globalAccountId', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const updated = withDb((db) => {
    const row = (db.globalChartAccounts || []).find((item) => item.id === req.params.globalAccountId);
    if (!row) return { error: 'Global chart account not found.' };
    if (payload.code !== undefined) row.code = String(payload.code || row.code).trim() || row.code;
    if (payload.name !== undefined) row.name = String(payload.name || row.name).trim() || row.name;
    if (payload.type !== undefined) row.type = String(payload.type || row.type || 'OTHER').toUpperCase();
    if (payload.reportingGroup !== undefined) row.reportingGroup = payload.reportingGroup || null;
    if (payload.notes !== undefined) row.notes = payload.notes || '';
    if (payload.status !== undefined) row.status = String(payload.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    row.updatedAt = nowIso();
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'global_chart_account_updated',
      entityType: 'global_chart_account',
      entityId: row.id,
      details: JSON.stringify(payload)
    });
    return { globalAccount: row };
  });
  if (updated.error) return res.status(404).json(updated);
  return res.json(updated);
});

app.post('/api/settings/account-mappings', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.sourceAccountId || !payload.globalAccountId) {
    return res.status(400).json({ error: 'sourceAccountId and globalAccountId are required.' });
  }

  const created = withDb((db) => {
    const source = (db.accounts || []).find((row) => row.id === payload.sourceAccountId);
    const globalAccount = (db.globalChartAccounts || []).find((row) => row.id === payload.globalAccountId);
    if (!source) return { error: 'Source account not found.' };
    if (!globalAccount) return { error: 'Global chart account not found.' };

    const row = {
      id: nextId(db, 'ACCOUNT_MAPPING', 'MAP'),
      sourceAccountId: source.id,
      globalAccountId: globalAccount.id,
      entityOverride: normalizeEntity(payload.entityOverride) || null,
      lineOfServiceOverride: payload.lineOfServiceOverride ? String(payload.lineOfServiceOverride).toUpperCase() : null,
      businessUnitOverride: payload.businessUnitOverride ? String(payload.businessUnitOverride).toUpperCase() : null,
      notes: payload.notes || '',
      status: String(payload.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.accountMappings.push(row);
    source.globalAccountId = globalAccount.id;
    source.updatedAt = nowIso();
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'account_mapping_created',
      entityType: 'account_mapping',
      entityId: row.id,
      details: JSON.stringify({ sourceAccountId: row.sourceAccountId, globalAccountId: row.globalAccountId })
    });
    return { mapping: row };
  });
  if (created.error) return res.status(404).json(created);
  return res.status(201).json(created);
});

app.patch('/api/settings/account-mappings/:mappingId', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const updated = withDb((db) => {
    const row = (db.accountMappings || []).find((item) => item.id === req.params.mappingId);
    if (!row) return { error: 'Account mapping not found.' };
    if (payload.globalAccountId !== undefined) {
      const globalAccount = (db.globalChartAccounts || []).find((item) => item.id === payload.globalAccountId);
      if (!globalAccount) return { error: 'Global chart account not found.' };
      row.globalAccountId = globalAccount.id;
      const source = (db.accounts || []).find((item) => item.id === row.sourceAccountId);
      if (source) {
        source.globalAccountId = globalAccount.id;
        source.updatedAt = nowIso();
      }
    }
    if (payload.entityOverride !== undefined) row.entityOverride = normalizeEntity(payload.entityOverride) || null;
    if (payload.lineOfServiceOverride !== undefined) row.lineOfServiceOverride = payload.lineOfServiceOverride ? String(payload.lineOfServiceOverride).toUpperCase() : null;
    if (payload.businessUnitOverride !== undefined) row.businessUnitOverride = payload.businessUnitOverride ? String(payload.businessUnitOverride).toUpperCase() : null;
    if (payload.notes !== undefined) row.notes = payload.notes || '';
    if (payload.status !== undefined) row.status = String(payload.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    row.updatedAt = nowIso();
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'account_mapping_updated',
      entityType: 'account_mapping',
      entityId: row.id,
      details: JSON.stringify(payload)
    });
    return { mapping: row };
  });
  if (updated.error) return res.status(404).json(updated);
  return res.json(updated);
});

app.post('/api/settings/team', requireAuth, requireRole([role.ADMIN]), (req, res) => {
  const { name, email, roleName, password } = req.body || {};
  if (!name || !email || !roleName || !password) {
    return res.status(400).json({ error: 'name, email, roleName, password are required' });
  }

  const created = withDb((db) => {
    if (db.users.some((row) => String(row.email).toLowerCase() === String(email).toLowerCase())) {
      return { error: 'User email already exists.' };
    }
    const id = nextId(db, 'USER', 'USR');
    const row = {
      id,
      name,
      email,
      role: roleName,
      passwordHash: password ? bcrypt.hashSync(password, 10) : null,
      googleSub: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.users.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'settings',
      action: 'user_created',
      entityType: 'user',
      entityId: id,
      details: roleName
    });
    return { user: safeUser(row) };
  });

  if (created.error) return res.status(409).json(created);
  return res.status(201).json(created);
});

app.post('/api/projects', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const required = ['name', 'clientId', 'projectManagerId', 'businessUnit', 'type'];
  const missing = required.filter((field) => !payload[field]);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  const created = withDb((db) => {
    const client = getClient(db, payload.clientId);
    const pm = getUser(db, payload.projectManagerId);
    if (!client) return { error: 'Client not found' };
    if (!pm) return { error: 'Project manager not found' };

    const id = nextId(db, 'PROJECT', 'PRJ');
    const row = {
      id,
      code: payload.code || id,
      name: payload.name,
      clientId: payload.clientId,
      projectManagerId: payload.projectManagerId,
      businessUnit: String(payload.businessUnit || 'SERVICES').toUpperCase(),
      lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null,
      entity: normalizeEntity(payload.entity) || normalizeEntity(inferEntityFromCurrency(db, payload.budgetCurrency || client.currency || 'USD')),
      type: payload.type,
      budgetAmount: Number(payload.budgetAmount || 0),
      budgetCurrency: payload.budgetCurrency || 'USD',
      hourlyRate: Number(payload.hourlyRate || 100),
      startDate: payload.startDate || toDateKey(Date.now()),
      endDate: payload.endDate || null,
      status: payload.status || 'ACTIVE',
      qboCustomerId: payload.qboCustomerId || null,
      description: payload.description || '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.projects.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'projects',
      action: 'project_created',
      entityType: 'project',
      entityId: id,
      details: row.name
    });
    return { project: row };
  });

  if (created.error) return res.status(404).json(created);
  return res.status(201).json(created);
});

app.get('/api/projects', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const projects = db.projects.filter((project) => projectVisibleToUser(db, project, user));
  return res.json({ projects });
});

app.get('/api/projects/:projectId/summary', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const project = getProject(db, req.params.projectId);
  if (!project || !projectVisibleToUser(db, project, user)) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }
  return res.json(buildProjectSummary(db, project));
});

app.post('/api/time-entries', requireAuth, requireRole(billingCreateRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.projectId || !payload.date || !payload.hours || !payload.description) {
    return res.status(400).json({ error: 'projectId, date, hours, description are required' });
  }

  const result = withDb((db) => {
    const user = getUser(db, req.user.sub);
    const project = getProject(db, payload.projectId);
    if (!project) return { error: 'Project not found' };
    if (!projectVisibleToUser(db, project, user) && !isPrivilegedFinance(user.role)) {
      return { error: 'Project access denied' };
    }

    const employeeId = payload.employeeId && isPrivilegedFinance(user.role) ? payload.employeeId : user.id;
    const employee = getUser(db, employeeId);
    if (!employee) return { error: 'Employee not found' };

    const id = nextId(db, 'TIME_ENTRY', 'TE');
    const rate = Number(payload.hourlyRate || project.hourlyRate || 100);
    const entry = {
      id,
      projectId: project.id,
      userId: employee.id,
      date: payload.date,
      hours: Number(payload.hours),
      description: payload.description,
      hourlyRate: rate,
      amount: asMoney(Number(payload.hours) * rate),
      currency: payload.currency || project.budgetCurrency || 'USD',
      billable: payload.billable !== false,
      invoiceId: null,
      invoicedAt: null,
      notes: payload.notes || '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.timeEntries.push(entry);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'time',
      action: 'time_entry_created',
      entityType: 'time_entry',
      entityId: id,
      details: `${entry.hours}h on ${entry.date}`
    });
    return { timeEntry: entry };
  });

  if (result.error) return res.status(403).json(result);
  return res.status(201).json(result);
});

app.get('/api/time-entries', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  let entries = [...db.timeEntries];

  if (req.query.projectId) entries = entries.filter((row) => row.projectId === String(req.query.projectId));
  if (req.query.employeeId) entries = entries.filter((row) => row.userId === String(req.query.employeeId));
  if (req.query.fromDate) entries = entries.filter((row) => row.date >= String(req.query.fromDate));
  if (req.query.toDate) entries = entries.filter((row) => row.date <= String(req.query.toDate));

  entries = entries.filter((entry) => timeEntryVisibleToUser(db, entry, user));

  if (String(req.query.unbilled || '').toLowerCase() === 'true') {
    entries = entries.filter((entry) => entry.billable && !entry.invoiceId);
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : -1));

  return res.json({ entries });
});

app.get('/api/time-entries/unbilled', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  let entries = db.timeEntries.filter((row) => row.billable && !row.invoiceId && timeEntryVisibleToUser(db, row, user));
  if (req.query.projectId) entries = entries.filter((row) => row.projectId === String(req.query.projectId));
  return res.json({ entries });
});

app.patch('/api/time-entries/:timeEntryId', requireAuth, requireRole(billingCreateRoles), (req, res) => {
  const result = withDb((db) => {
    const user = getUser(db, req.user.sub);
    const entry = db.timeEntries.find((row) => row.id === req.params.timeEntryId);
    if (!entry || !timeEntryVisibleToUser(db, entry, user)) {
      return { error: 'Time entry not found or access denied' };
    }
    if (entry.invoiceId) return { error: 'Cannot edit invoiced time entry' };

    if (req.body?.delete === true) {
      db.timeEntries = db.timeEntries.filter((row) => row.id !== entry.id);
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'time',
        action: 'time_entry_deleted',
        entityType: 'time_entry',
        entityId: entry.id,
        details: null
      });
      return { deleted: true, timeEntryId: entry.id };
    }

    if (req.body.projectId) entry.projectId = req.body.projectId;
    if (req.body.date) entry.date = req.body.date;
    if (req.body.hours !== undefined) entry.hours = Number(req.body.hours);
    if (req.body.description !== undefined) entry.description = req.body.description;
    if (req.body.hourlyRate !== undefined) entry.hourlyRate = Number(req.body.hourlyRate);
    if (req.body.billable !== undefined) entry.billable = Boolean(req.body.billable);
    if (req.body.notes !== undefined) entry.notes = req.body.notes;
    entry.amount = asMoney(Number(entry.hours) * Number(entry.hourlyRate));
    entry.updatedAt = nowIso();

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'time',
      action: 'time_entry_updated',
      entityType: 'time_entry',
      entityId: entry.id,
      details: null
    });
    return { timeEntry: entry };
  });

  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

app.post('/api/invoices', requireAuth, requireRole(billingCreateRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.projectId && !payload.clientId && !payload.clientName) {
    return res.status(400).json({ error: 'Provide projectId or client context to create invoice.' });
  }

  const result = withDb((db) => {
    const lockError = periodLockError(db, payload.issueDate || toDateKey(Date.now()));
    if (lockError) return { error: lockError };
    const user = getUser(db, req.user.sub);
    const project = payload.projectId ? getProject(db, payload.projectId) : null;
    if (project && !projectVisibleToUser(db, project, user) && !isPrivilegedFinance(user.role)) {
      return { error: 'Project access denied.' };
    }

    const client = project
      ? getClient(db, project.clientId)
      : payload.clientId
        ? getClient(db, payload.clientId)
        : db.clients.find((row) => String(row.name).toLowerCase() === String(payload.clientName || '').toLowerCase()) || null;

    if (!client && !payload.clientName) {
      return { error: 'Client not found. Provide a valid clientId/clientName.' };
    }

    const selectedEntries = (payload.timeEntryIds || [])
      .map((id) => db.timeEntries.find((row) => row.id === id))
      .filter(Boolean)
      .filter((entry) => timeEntryVisibleToUser(db, entry, user));

    if (selectedEntries.some((entry) => entry.invoiceId)) {
      return { error: 'One or more selected time entries are already invoiced.' };
    }

    const timeLines = selectedEntries.map((entry) => ({
      description: entry.description,
      qty: Number(entry.hours),
      rate: Number(entry.hourlyRate),
      timeEntryIds: [entry.id]
    }));

    const manualLines = (payload.manualLines || []).map((line) => ({
      description: line.description,
      qty: Number(line.qty || line.quantity || 0),
      rate: Number(line.rate || line.unitRate || 0),
      timeEntryIds: []
    }));

    const composedLines = [...timeLines, ...manualLines].filter((line) => line.qty > 0 && line.rate >= 0 && line.description);
    if (!composedLines.length) {
      return { error: 'No billable line items found.' };
    }

    const { normalizedLines, subtotal, taxAmount, total, appliedTaxRate } = computeInvoiceAmounts(composedLines, payload.taxRate || 0);

    const id = nextId(db, 'INVOICE', 'INV');
    const invoiceNumber = generateInvoiceNumber(db);

    const invoice = {
      id,
      invoiceNumber,
      projectId: project?.id || null,
      clientId: client?.id || null,
      clientName: client?.name || payload.clientName,
      createdByUserId: user.id,
      approvedByUserId: null,
      businessUnit: String(payload.businessUnit || project?.businessUnit || 'SERVICES').toUpperCase(),
      lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : (project?.lineOfService ? String(project.lineOfService).toUpperCase() : null),
      entity: normalizeEntity(payload.entity) || normalizeEntity(project?.entity) || normalizeEntity(inferEntityFromCurrency(db, payload.currency || client?.currency || project?.budgetCurrency || 'USD')),
      channel: payload.channel ? String(payload.channel).toUpperCase() : null,
      issueDate: payload.issueDate || toDateKey(Date.now()),
      dueDate: payload.dueDate || null,
      currency: payload.currency || client?.currency || project?.budgetCurrency || 'USD',
      subtotal,
      taxRate: appliedTaxRate,
      taxAmount,
      total,
      amountPaid: 0,
      status: 'DRAFT',
      approvalStatus: 'PENDING',
      approvedAt: null,
      sentAt: null,
      pdfUrl: null,
      lineItems: normalizedLines,
      qboInvoiceId: null,
      qboSyncStatus: 'NOT_SYNCED',
      qboSyncedAt: null,
      paymentDate: null,
      notes: payload.notes || '',
      internalNotes: payload.internalNotes || '',
      rejectionReason: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    db.invoices.push(invoice);
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'CREATED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: invoice.total,
      note: invoice.notes || '',
      statusAfter: invoice.approvalStatus
    });
    for (const entry of selectedEntries) {
      entry.invoiceId = invoice.id;
      entry.invoicedAt = nowIso();
      entry.updatedAt = nowIso();
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_created',
      entityType: 'invoice',
      entityId: invoice.id,
      details: `${invoice.invoiceNumber} total ${invoice.total}`
    });

    return { invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(409).json(result);
  return res.status(201).json(result);
});

app.post('/api/invoices/:invoiceId/submit', requireAuth, requireRole(billingCreateRoles), (req, res) => {
  const result = withDb((db) => {
    const user = getUser(db, req.user.sub);
    const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
    if (!invoice || !invoiceVisibleToUser(db, invoice, user)) {
      return { error: 'Invoice not found or access denied.' };
    }
    if (!['DRAFT', 'REJECTED'].includes(invoice.status)) {
      return { error: 'Only draft/rejected invoices can be submitted.' };
    }
    invoice.status = 'PENDING_APPROVAL';
    invoice.approvalStatus = 'PENDING';
    invoice.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'SUBMITTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: invoice.total,
      note: invoice.notes || '',
      statusAfter: invoice.approvalStatus
    });

    const approvers = db.users.filter((row) => [role.ACCOUNTANT, role.PARTNER, role.ADMIN].includes(row.role));
    for (const approver of approvers) {
      queueNotification(db, {
        recipient: approver.email,
        subject: `Invoice ${invoice.invoiceNumber} awaiting approval`,
        body: `${invoice.invoiceNumber} for ${invoice.clientName} requires your approval.`,
        referenceType: 'invoice',
        referenceId: invoice.id
      });
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_submitted',
      entityType: 'invoice',
      entityId: invoice.id,
      details: null
    });

    return { invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

app.post('/api/invoices/:invoiceId/reject', requireAuth, requireRole(billingApproveRoles), (req, res) => {
  const reason = req.body?.reason || 'Needs revision';
  const result = withDb((db) => {
    const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
    if (!invoice) return { error: 'Invoice not found.' };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'REJECT',
      entity: invoice.entity,
      amount: invoice.total,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: invoice.createdByUserId,
      approvedByUserId: invoice.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };
    invoice.status = 'REJECTED';
    invoice.approvalStatus = 'REJECTED';
    invoice.rejectedByUserId = req.user.sub;
    invoice.rejectionReason = reason;
    invoice.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'REJECTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: invoice.total,
      note: reason,
      statusAfter: invoice.approvalStatus
    });

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_rejected',
      entityType: 'invoice',
      entityId: invoice.id,
      details: reason
    });

    syncSourceRootPostings(db, {
      sourceRootType: 'INVOICE',
      sourceRootId: invoice.id,
      actorUserId: req.user.sub
    });

    return { invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(result.status || 404).json(result);
  return res.json(result);
});

app.post('/api/invoices/:invoiceId/send', requireAuth, requireRole(billingApproveRoles), (req, res) => {
  const result = withDb((db) => {
    const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
    if (!invoice) return { error: 'Invoice not found.' };
    if (!['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(invoice.status)) {
      return { error: 'Invoice must be approved before sending.' };
    }

    invoice.status = invoice.status === 'PAID' ? 'PAID' : invoice.status === 'PARTIAL' ? 'PARTIAL' : 'SENT';
    invoice.sentAt = nowIso();
    invoice.updatedAt = nowIso();

    const client = invoice.clientId ? getClient(db, invoice.clientId) : null;
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'SENT',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: invoice.total,
      note: client?.email || invoice.clientName || '',
      statusAfter: invoice.status
    });
    if (client?.email) {
      queueNotification(db, {
        recipient: client.email,
        subject: `Invoice ${invoice.invoiceNumber} from Telerelation`,
        body: `Your invoice ${invoice.invoiceNumber} amount ${invoice.total} ${invoice.currency} is available.`,
        referenceType: 'invoice',
        referenceId: invoice.id
      });
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_sent',
      entityType: 'invoice',
      entityId: invoice.id,
      details: client?.email || invoice.clientName
    });

    return { invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

app.post('/api/invoices/:invoiceId/approve', requireAuth, requireRole(billingApproveRoles), async (req, res) => {
  const approved = withDb((db) => {
    const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
    if (!invoice) return { error: 'Invoice not found.' };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'APPROVE',
      entity: invoice.entity,
      amount: invoice.total,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: invoice.createdByUserId,
      approvedByUserId: invoice.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };

    invoice.status = 'APPROVED';
    invoice.approvalStatus = 'APPROVED';
    invoice.approvedByUserId = req.user.sub;
    invoice.approvedAt = nowIso();
    invoice.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'APPROVED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: invoice.total,
      note: req.body?.note || '',
      statusAfter: invoice.approvalStatus
    });

    const project = invoice.projectId ? getProject(db, invoice.projectId) : null;
    const client = invoice.clientId ? getClient(db, invoice.clientId) : null;

    const html = buildInvoiceHtml({
      invoice,
      project,
      client,
      companyName: db.settings.companyName || 'Telerelation LLC'
    });

    const fileName = `${invoice.invoiceNumber}.html`;
    const filePath = path.resolve(invoicesDir, fileName);
    fs.writeFileSync(filePath, html, 'utf8');
    invoice.pdfUrl = `/api/invoices/${invoice.id}/document`;

    if (db.settings.autoSendBelowThreshold || Number(invoice.total) <= Number(db.settings.invoiceApprovalThreshold || 0)) {
      invoice.status = 'SENT';
      invoice.sentAt = nowIso();
      if (client?.email) {
        queueNotification(db, {
          recipient: client.email,
          subject: `Invoice ${invoice.invoiceNumber} from Telerelation`,
          body: `Invoice ${invoice.invoiceNumber} has been issued for ${invoice.total} ${invoice.currency}.`,
          referenceType: 'invoice',
          referenceId: invoice.id
        });
      }
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_approved',
      entityType: 'invoice',
      entityId: invoice.id,
      details: `${invoice.total} ${invoice.currency}`
    });

    syncSourceRootPostings(db, {
      sourceRootType: 'INVOICE',
      sourceRootId: invoice.id,
      actorUserId: req.user.sub
    });

    return { invoice: { ...invoice }, clientEmail: client?.email || null };
  });

  if (approved.error) return res.status(approved.status || 404).json(approved);

  const qboResult = await pushInvoiceToQbo(approved.invoice, req.user.sub);

  const response = withDb((db) => {
    const current = db.invoices.find((row) => row.id === approved.invoice.id);
    return {
      invoice: hydrateInvoice(db, current),
      qbo: qboResult
    };
  });

  return res.json(response);
});

app.get('/api/invoices', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const rows = db.invoices
    .filter((invoice) => invoiceVisibleToUser(db, invoice, user))
    .map((invoice) => hydrateInvoice(db, updateInvoicePaymentState({ ...invoice })))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return res.json({ invoices: rows });
});

app.get('/api/invoices/:invoiceId', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
  if (!invoice || !invoiceVisibleToUser(db, invoice, user)) {
    return res.status(404).json({ error: 'Invoice not found or access denied.' });
  }
  return res.json({ invoice: hydrateInvoice(db, invoice) });
});

app.patch('/api/invoices/:invoiceId/tags', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
    if (!invoice) return { error: 'Invoice not found.' };

    if (payload.lineOfService !== undefined) {
      invoice.lineOfService = payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null;
    }
    if (payload.businessUnit !== undefined) {
      invoice.businessUnit = payload.businessUnit ? String(payload.businessUnit).toUpperCase() : null;
    }
    if (payload.entity !== undefined) {
      invoice.entity = payload.entity ? normalizeEntity(payload.entity) : null;
    }
    if (payload.channel !== undefined) {
      invoice.channel = payload.channel ? String(payload.channel).toUpperCase() : null;
    }
    if (payload.notes !== undefined) {
      invoice.internalNotes = payload.notes;
    }

    invoice.updatedAt = nowIso();
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'invoices',
      action: 'invoice_tags_updated',
      entityType: 'invoice',
      entityId: invoice.id,
      details: JSON.stringify({
        lineOfService: invoice.lineOfService,
        businessUnit: invoice.businessUnit,
        entity: invoice.entity,
        channel: invoice.channel
      })
    });

    return { invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(404).json(result);
  return res.json(result);
});

app.get('/api/invoices/:invoiceId/preview', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
  if (!invoice || !invoiceVisibleToUser(db, invoice, user)) {
    return res.status(404).json({ error: 'Invoice not found or access denied.' });
  }
  const project = invoice.projectId ? getProject(db, invoice.projectId) : null;
  const client = invoice.clientId ? getClient(db, invoice.clientId) : null;
  const html = buildInvoiceHtml({
    invoice,
    project,
    client,
    companyName: db.settings.companyName || 'Telerelation LLC'
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

app.get('/api/invoices/:invoiceId/document', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
  if (!invoice || !invoiceVisibleToUser(db, invoice, user)) {
    return res.status(404).json({ error: 'Invoice not found or access denied.' });
  }
  const fileName = `${invoice.invoiceNumber}.html`;
  const filePath = path.resolve(invoicesDir, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Invoice document is not available.' });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  return fs.createReadStream(filePath).pipe(res);
});

app.post('/api/payments', requireAuth, requireRole(billingApproveRoles), (req, res) => {
  const {
    invoiceId,
    amount,
    source = 'MANUAL',
    reference = null,
    paidAt = toDateKey(Date.now()),
    supportingEvidence
  } = req.body || {};
  if (!invoiceId || !amount) return res.status(400).json({ error: 'invoiceId and amount are required.' });

  const result = withDb((db) => {
    const lockError = periodLockError(db, paidAt);
    if (lockError) return { error: lockError };
    const invoice = db.invoices.find((row) => row.id === invoiceId);
    if (!invoice) return { error: 'Invoice not found.' };
    const normalizedEvidence = normalizeSupportingEvidence({ supportingEvidence });
    const approvalError = assertWorkflowAction(db, {
      documentType: 'CUSTOMER_RECEIPT',
      entityType: 'CUSTOMER_RECEIPT',
      entityId: `PENDING:${invoice.id}`,
      action: 'POST',
      entity: invoice.entity,
      amount,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: req.user.sub,
      approvedByUserId: req.user.sub,
      pendingEvidence: normalizedEvidence
    });
    if (approvalError) return { error: approvalError, status: 409 };

    const id = nextId(db, 'PAYMENT', 'PAY');
    const payment = {
      id,
      invoiceId,
      amount: asMoney(amount),
      currency: invoice.currency,
      source,
      reference,
      paidAt,
      status: 'PAID',
      approvalStatus: 'APPROVED',
      approvedByUserId: req.user.sub,
      approvedAt: nowIso(),
      createdByUserId: req.user.sub,
      postedAt: nowIso(),
      meta: { manual: true },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.payments.push(payment);
    const evidence = persistSupportingEvidence(db, normalizedEvidence, {
      entityType: 'CUSTOMER_RECEIPT',
      entityId: payment.id,
      actorUserId: req.user.sub
    });

    invoice.amountPaid = asMoney(Number(invoice.amountPaid || 0) + Number(payment.amount));
    invoice.updatedAt = nowIso();
    updateInvoicePaymentState(invoice);
    recordApprovalEvent(db, {
      documentType: 'CUSTOMER_RECEIPT',
      entityType: 'CUSTOMER_RECEIPT',
      entityId: payment.id,
      action: 'POSTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: payment.amount,
      note: payment.reference || payment.source || '',
      metadata: { invoiceId: invoice.id },
      statusAfter: payment.approvalStatus
    });
    recordApprovalEvent(db, {
      documentType: 'INVOICE',
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'PAID',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: invoice.entity,
      amount: payment.amount,
      note: payment.reference || payment.source || '',
      statusAfter: invoice.status
    });

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payments',
      action: 'payment_recorded',
      entityType: 'payment',
      entityId: payment.id,
      details: JSON.stringify({ invoiceId, amount: payment.amount, source, evidenceCount: evidence.length })
    });

    syncSourceRootPostings(db, {
      sourceRootType: 'INVOICE',
      sourceRootId: invoice.id,
      actorUserId: req.user.sub
    });

    return { payment: hydrateCustomerReceipt(db, payment, invoice), invoice: hydrateInvoice(db, invoice) };
  });

  if (result.error) return res.status(result.status || 404).json(result);
  return res.status(201).json(result);
});

app.post('/api/qbo/connect', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const connect = createConnectUrl({
    actorUserId: req.user.sub,
    entityId: req.body?.entityId || null
  });
  if (connect.error) return res.status(500).json(connect);
  return res.json(connect);
});

app.get('/api/qbo/callback', async (req, res) => {
  const { code, state, realmId, error, error_description: errorDescription } = req.query || {};
  if (error) {
    return res.status(400).send(`QuickBooks OAuth failed: ${errorDescription || error}`);
  }
  if (!code || !state) {
    return res.status(400).send('Missing code/state in callback.');
  }

  try {
    await handleCallback({ code, state, realmId });
    return res.status(200).send('QuickBooks connected. You can close this tab.');
  } catch (err) {
    return res.status(400).send(err instanceof Error ? err.message : 'QuickBooks callback failed.');
  }
});

app.get('/api/qbo/status', requireAuth, requireRole(billingReadRoles), (req, res) => {
  return res.json({ status: getQboStatus() });
});

app.get('/api/qbo/checklist', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const status = getQboStatus();
  return res.json({
    checklist: status.lastPullChecklist || null,
    lastPullAt: status.lastPullAt || null,
    lastPullSummary: status.lastPullSummary || null
  });
});

app.get('/api/qbo/transactions', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const payload = buildQboTransactionFeed(db, {
    fromDate: req.query.fromDate || null,
    toDate: req.query.toDate || null,
    entity: req.query.entity || null,
    objectType: req.query.objectType || null,
    search: req.query.search || '',
    limit: Number(req.query.limit || 800)
  });
  return res.json(payload);
});

app.post('/api/qbo/pull/full', requireAuth, requireRole(financeManageRoles), async (req, res) => {
  try {
    const options = req.body?.options || {};
    const result = await pullFullQboData(req.user.sub, {
      includeCustomers: options.includeCustomers !== false,
      includeInvoices: options.includeInvoices !== false,
      includePayments: options.includePayments !== false,
      includeAccounts: options.includeAccounts !== false,
      includeTransactions: options.includeTransactions !== false,
      fromDate: options.fromDate || null,
      toDate: options.toDate || null
    });
    withDb((db) => {
      syncAllWorkflowPostings(db, req.user.sub);
      return db;
    });
    return res.status(result.partial ? 207 : 200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'QBO full pull failed.' });
  }
});

app.post('/api/qbo/sync/:invoiceId', requireAuth, requireRole(billingApproveRoles), async (req, res) => {
  const db = readDb();
  const invoice = db.invoices.find((row) => row.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  const result = await pushInvoiceToQbo(invoice, req.user.sub);
  const refreshed = readDb().invoices.find((row) => row.id === req.params.invoiceId);
  return res.json({ result, invoice: refreshed });
});

app.post('/api/transactions/import', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : parseCsvRows(payload.csv || '');
  if (!rows.length) return res.status(400).json({ error: 'No transaction rows found.' });

  const imported = withDb((db) => {
    const created = [];
    for (const row of rows) {
      const postingDate = row.date || payload.date || toDateKey(Date.now());
      const lockError = periodLockError(db, postingDate);
      if (lockError) return { error: lockError, status: 409 };
    }
    for (const row of rows) {
      const postingDate = row.date || payload.date || toDateKey(Date.now());
      const selectedSourceAccount = resolveSourceAccount(db, {
        sourceAccountId: row.sourceAccountId || payload.sourceAccountId || null,
        account: row.account || payload.account || null,
        entity: row.entity || payload.entity || null,
        currency: row.currency || payload.currency || null,
        sourceSystem: row.source || payload.source || null
      });
      const sourceAccountError = validateSelectedSourceAccount(selectedSourceAccount, {
        sourceAccountId: row.sourceAccountId || payload.sourceAccountId || null,
        entity: row.entity || payload.entity || null,
        currency: row.currency || payload.currency || null,
        allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
        fieldLabel: 'banking rail'
      });
      if (sourceAccountError) return { error: sourceAccountError, status: 409 };
      const id = nextId(db, 'TRANSACTION', 'TXN');
      const baseTx = {
        id,
        date: postingDate,
        account: row.account || selectedSourceAccount?.name || payload.account || 'Unknown',
        amount: asMoney(Number(row.amount || 0)),
        currency: row.currency || selectedSourceAccount?.currency || payload.currency || 'USD',
        type: row.type || payload.type || (Number(row.amount || 0) >= 0 ? 'CREDIT' : 'DEBIT'),
        description: row.description || row.memo || 'Imported transaction',
        category: row.category || payload.category || null,
        reimbursable: row.reimbursable === true || String(row.reimbursable || '').toLowerCase() === 'true',
        source: row.source || selectedSourceAccount?.sourceSystem || payload.source || 'MANUAL_IMPORT',
        reference: row.reference || null,
        channel: row.channel || payload.channel || null,
        lineOfService: row.lineOfService || row.line_of_service || payload.lineOfService || null,
        businessUnit: row.businessUnit || row.business_unit || payload.businessUnit || null,
        department: row.department || payload.department || null,
        partnerTag: row.partnerTag || row.partner_tag || payload.partnerTag || null,
        treasuryFlag: parseBool(row.treasuryFlag ?? row.treasury_flag, false),
        intercompanyFlag: parseBool(row.intercompanyFlag ?? row.intercompany_flag, false),
        capexFlag: parseBool(row.capexFlag ?? row.capex_flag, false),
        entity: row.entity || selectedSourceAccount?.entity || payload.entity || null,
        sourceAccountId: selectedSourceAccount?.id || row.sourceAccountId || payload.sourceAccountId || null,
        reconciled: false,
        invoiceId: null,
        linkedInvoiceIds: [],
        matchedAmount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      const tx = applyTransactionDefaults(db, baseTx, { source: baseTx.source });
      tx.category = runClassifier(db, tx);
      applyGovernanceStamp(db, tx, 'transaction');
      db.transactions.push(tx);
      created.push(tx);
    }

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'transactions',
      action: 'transactions_imported',
      entityType: 'batch',
      entityId: null,
      details: `${created.length} rows`
    });

    return {
      transactions: created,
      reviewSummary: buildImportedReconciliationSummary(db, created.map((row) => row.id))
    };
  });

  if (imported.error) return res.status(imported.status || 409).json({ error: imported.error });
  return res.status(201).json({
    imported: imported.transactions.length,
    transactions: imported.transactions,
    reviewSummary: imported.reviewSummary
  });
});

app.get('/api/transactions', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  let rows = db.transactions.map((row) => {
    const governed = applyEntryGovernance(db, {
      sourceType: 'transaction',
      sourceId: row.id,
      date: row.date,
      entity: row.entity || null,
      currency: row.currency || db.settings?.reportingCurrency || 'USD',
      lineOfService: row.lineOfService || null,
      businessUnit: row.businessUnit || null,
      channel: row.channel || null,
      category: row.category || null,
      amount: String(row.type || '').toUpperCase() === 'DEBIT' ? -Math.abs(asMoney(row.amount || 0)) : Math.abs(asMoney(row.amount || 0)),
      reportingAmount: toReportingAmount(db, String(row.type || '').toUpperCase() === 'DEBIT' ? -Math.abs(asMoney(row.amount || 0)) : Math.abs(asMoney(row.amount || 0)), row.currency || 'USD'),
      intercompanyFlag: Boolean(row.intercompanyFlag),
      treasuryFlag: Boolean(row.treasuryFlag),
      capexFlag: Boolean(row.capexFlag),
      partnerTag: row.partnerTag || null,
      account: row.account || null,
      source: row.source || null,
      sourceAccountId: row.sourceAccountId || null,
      qboAccountId: row.qboAccountId || null
    });
    const absolute = asMoney(Math.abs(Number(row.amount || 0)));
    const matched = asMoney(row.matchedAmount || 0);
    const remainingAmount = asMoney(Math.max(absolute - matched, 0));
    return { ...row, ...governed, remainingAmount };
  });
  if (req.query.category) rows = rows.filter((row) => String(row.category).toLowerCase() === String(req.query.category).toLowerCase());
  if (req.query.reconciled) rows = rows.filter((row) => Boolean(row.reconciled) === (String(req.query.reconciled).toLowerCase() === 'true'));
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.channel) rows = rows.filter((row) => String(row.channel || '').toLowerCase() === String(req.query.channel).toLowerCase());
  if (req.query.fromDate) rows = rows.filter((row) => row.date >= String(req.query.fromDate));
  if (req.query.toDate) rows = rows.filter((row) => row.date <= String(req.query.toDate));
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return res.json({ transactions: rows });
});

app.patch('/api/transactions/:transactionId', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const result = withDb((db) => {
    const tx = db.transactions.find((row) => row.id === req.params.transactionId);
    if (!tx) return { error: 'Transaction not found.' };
    if (req.body.category !== undefined) tx.category = req.body.category;
    if (req.body.reconciled !== undefined) tx.reconciled = Boolean(req.body.reconciled);
    if (req.body.description !== undefined) tx.description = req.body.description;
    if (req.body.reimbursable !== undefined) tx.reimbursable = Boolean(req.body.reimbursable);
    if (req.body.channel !== undefined) tx.channel = req.body.channel || null;
    if (req.body.lineOfService !== undefined) tx.lineOfService = req.body.lineOfService || null;
    if (req.body.businessUnit !== undefined) tx.businessUnit = req.body.businessUnit || null;
    if (req.body.department !== undefined) tx.department = req.body.department || null;
    if (req.body.partnerTag !== undefined) tx.partnerTag = req.body.partnerTag || null;
    if (req.body.intercompanyFlag !== undefined) tx.intercompanyFlag = Boolean(req.body.intercompanyFlag);
    if (req.body.treasuryFlag !== undefined) tx.treasuryFlag = Boolean(req.body.treasuryFlag);
    if (req.body.capexFlag !== undefined) tx.capexFlag = Boolean(req.body.capexFlag);
    if (req.body.entity !== undefined) tx.entity = req.body.entity || null;
    if (req.body.source !== undefined) tx.source = req.body.source || tx.source || 'MANUAL';
    if (req.body.sourceAccountId !== undefined) tx.sourceAccountId = req.body.sourceAccountId || null;
    if (req.body.reference !== undefined) tx.reference = req.body.reference || null;
    if (req.body.reimburseTag === true) tx.reimbursable = true;
    if (req.body.reimburseTag === false) tx.reimbursable = false;

    if (req.body.autoClassify === true || req.body.reimbursable !== undefined || req.body.reimburseTag !== undefined) {
      tx.category = runClassifier(db, tx);
    }

    const absolute = asMoney(Math.abs(Number(tx.amount || 0)));
    tx.matchedAmount = asMoney(Math.min(Math.max(Number(tx.matchedAmount || 0), 0), absolute));
    tx.reconciled = tx.matchedAmount >= absolute && absolute > 0;
    applyGovernanceStamp(db, tx, 'transaction');
    tx.updatedAt = nowIso();
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'transactions',
      action: 'transaction_updated',
      entityType: 'transaction',
      entityId: tx.id,
      details: JSON.stringify(req.body || {})
    });
    return { transaction: tx };
  });
  if (result.error) return res.status(404).json(result);
  return res.json(result);
});

app.post('/api/transactions/:transactionId/match', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const body = req.body || {};
  const allocations = Array.isArray(body.allocations) && body.allocations.length
    ? body.allocations
    : body.invoiceId
      ? [{ invoiceId: body.invoiceId, amount: body.amount }]
      : [];
  if (!allocations.length) return res.status(400).json({ error: 'Provide invoiceId or allocations[].' });

  const result = withDb((db) => applyTransactionAllocations(db, req.params.transactionId, allocations, req.user));

  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

app.get('/api/reconciliation/queue', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json(buildReconciliationQueue(db));
});

app.post('/api/reconciliation/bulk', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const action = String(req.body?.action || '').toUpperCase();
  const transactionIds = Array.isArray(req.body?.transactionIds)
    ? Array.from(new Set(req.body.transactionIds.map((row) => String(row)).filter(Boolean)))
    : [];
  const note = String(req.body?.note || '').trim();

  if (!transactionIds.length) return res.status(400).json({ error: 'Provide transactionIds[].' });

  const result = withDb((db) => {
    const queue = buildReconciliationQueue(db);
    const eligibility = summarizeBulkEligibility(queue, action, transactionIds);
    if (!eligibility.eligibleCount) {
      return { error: `No selected transactions are eligible for ${bulkActionLabel(action).toLowerCase()}.`, eligibility };
    }

    const processed = [];
    for (const transactionId of eligibility.eligibleIds) {
      if (action === 'QUICK_MATCH') {
        const candidate = findQuickMatchCandidate(db, transactionId);
        if (!candidate) continue;
        const matchResult = applyTransactionAllocations(db, transactionId, [
          { invoiceId: candidate.invoiceId, amount: candidate.amount }
        ], req.user);
        if (matchResult.error) continue;
        processed.push({ transactionId, action, paymentId: matchResult.payments?.[0]?.id || null });
        appendAudit(db, {
          actorUserId: req.user.sub,
          module: 'reconciliation',
          action: 'transaction_bulk_quick_matched',
          entityType: 'transaction',
          entityId: transactionId,
          details: JSON.stringify({ invoiceId: candidate.invoiceId, amount: candidate.amount })
        });
        continue;
      }

      const tx = db.transactions.find((row) => row.id === transactionId);
      if (!tx) continue;
      if (!eligibleForBulkAction(buildReconciliationQueue(db, { transactionIds: [transactionId] }).items[0] || {}, action)) continue;
      applyReconciliationReviewDecision(tx, {
        decision: action === 'CLEAR_REVIEW' ? 'CLEAR_REVIEW' : action,
        note: note || null
      }, req.user);
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'reconciliation',
        action: 'transaction_bulk_review_updated',
        entityType: 'transaction',
        entityId: transactionId,
        details: JSON.stringify({ decision: action, note: note || null })
      });
      processed.push({ transactionId, action });
    }

    return {
      action,
      processed,
      eligibility,
      queue: buildReconciliationQueue(db)
    };
  });

  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

app.post('/api/reconciliation/transactions/:transactionId/quick-match', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const result = withDb((db) => {
    const candidate = findQuickMatchCandidate(db, req.params.transactionId);
    if (!candidate) return { error: 'No high-confidence quick match is available for this transaction.' };
    return applyTransactionAllocations(db, req.params.transactionId, [
      { invoiceId: candidate.invoiceId, amount: candidate.amount }
    ], req.user);
  });
  if (result.error) return res.status(409).json(result);
  return res.json({ quickMatched: true, ...result });
});

app.post('/api/reconciliation/transactions/:transactionId/review', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const decision = String(req.body?.decision || '').toUpperCase();
  const note = String(req.body?.note || '').trim();
  const category = String(req.body?.category || '').trim();
  const deferredUntil = req.body?.deferredUntil || null;
  const followUpOwnerUserId = req.body?.followUpOwnerUserId || null;
  const allowedDecisions = ['FLAG_EXCEPTION', 'NEEDS_REMITTANCE', 'IGNORE_DUPLICATE', 'FOLLOW_UP_REQUIRED', 'DEFERRED', 'REVIEWED_PENDING', 'CLEAR_REVIEW'];
  if (!allowedDecisions.includes(decision)) {
    return res.status(400).json({ error: 'Unsupported reconciliation decision.' });
  }

  const result = withDb((db) => {
    const tx = db.transactions.find((row) => row.id === req.params.transactionId);
    if (!tx) return { error: 'Transaction not found.' };
    if (decision === 'DEFERRED' && !deferredUntil) {
      return { error: 'Deferred review requires deferredUntil.' };
    }
    applyReconciliationReviewDecision(tx, {
      decision,
      note,
      category,
      deferredUntil,
      followUpOwnerUserId
    }, req.user);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'reconciliation',
      action: 'transaction_review_updated',
      entityType: 'transaction',
      entityId: tx.id,
      details: JSON.stringify({ decision, note: note || null, category: category || null, deferredUntil, followUpOwnerUserId })
    });
    return { transaction: tx };
  });
  if (result.error) return res.status(404).json(result);
  return res.json(result);
});

app.get('/api/reconciliation/board', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json(buildReconciliationBoard(db));
});

app.post('/api/reconciliation/auto-match', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const matched = withDb((db) => {
    const queue = buildReconciliationQueue(db);
    const processed = [];
    for (const item of queue.items.filter((row) => row.quickMatchAvailable && row.topSuggestion)) {
      const result = applyTransactionAllocations(db, item.transactionId, [
        { invoiceId: item.topSuggestion.invoiceId, amount: item.topSuggestion.suggestedAmount }
      ], req.user);
      if (result.error) continue;
      const payment = result.payments?.[0];
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'reconciliation',
        action: 'transaction_auto_matched',
        entityType: 'transaction',
        entityId: item.transactionId,
        details: JSON.stringify({
          invoiceId: item.topSuggestion.invoiceId,
          paymentId: payment?.id || null,
          confidenceScore: item.topSuggestion.confidenceScore,
          matchedAmount: item.topSuggestion.suggestedAmount
        })
      });
      processed.push({
        transactionId: item.transactionId,
        invoiceId: item.topSuggestion.invoiceId,
        paymentId: payment?.id || null,
        matchedAmount: item.topSuggestion.suggestedAmount,
        remainingAmount: result.transaction?.remainingAmount || 0
      });
    }
    return processed;
  });

  return res.json({ matched: matched.length, rows: matched });
});

app.get('/api/expenses', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = db.expenses.map((row) => hydrateExpenseRow(db, row));
  if (req.query.category) rows = rows.filter((row) => String(row.category || '').toLowerCase() === String(req.query.category).toLowerCase());
  if (req.query.status) rows = rows.filter((row) => String(row.status || '').toLowerCase() === String(req.query.status).toLowerCase());
  if (req.query.reimbursementStatus) rows = rows.filter((row) => String(row.reimbursementStatus || '').toUpperCase() === String(req.query.reimbursementStatus).toUpperCase());
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.employeeId) rows = rows.filter((row) => String(row.employeeId || '') === String(req.query.employeeId));
  if (req.query.businessUnit) rows = rows.filter((row) => String(row.businessUnit || '').toUpperCase() === String(req.query.businessUnit).toUpperCase());
  if (req.query.channel) rows = rows.filter((row) => String(row.channel || '').toUpperCase() === String(req.query.channel).toUpperCase());
  if (req.query.fromDate) rows = rows.filter((row) => row.date >= String(req.query.fromDate));
  if (req.query.toDate) rows = rows.filter((row) => row.date <= String(req.query.toDate));
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return res.json({ expenses: rows });
});

app.post('/api/expenses', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.date || payload.amount === undefined || !payload.description) {
    return res.status(400).json({ error: 'date, amount and description are required.' });
  }

  const expense = withDb((db) => {
    const lockError = periodLockError(db, payload.date);
    if (lockError) return { error: lockError };
    const employeeId = payload.employeeId || null;
    if (employeeId) {
      const employee = getUser(db, employeeId);
      if (!employee) return { error: 'Employee not found.' };
    }
    const selectedSourceAccount = resolveSourceAccount(db, {
      sourceAccountId: payload.sourceAccountId || null,
      account: payload.account || null,
      entity: payload.entity || null,
      currency: payload.currency || null,
      sourceSystem: payload.source || null
    });
    const sourceAccountError = validateSelectedSourceAccount(selectedSourceAccount, {
      sourceAccountId: payload.sourceAccountId || null,
      entity: payload.entity || null,
      currency: payload.currency || null,
      allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
      fieldLabel: 'expense source account'
    });
    if (sourceAccountError) return { error: sourceAccountError };
    const reimbursementNeeded = payload.reimbursementNeeded === undefined
      ? Boolean(employeeId)
      : Boolean(payload.reimbursementNeeded);
    const reimbursementStatus = reimbursementNeeded
      ? String(payload.reimbursementStatus || 'PENDING').toUpperCase()
      : 'NOT_APPLICABLE';
    const defaultStatus = reimbursementStatus === 'REIMBURSED' ? 'PAID' : (reimbursementNeeded ? 'PENDING_REIMBURSEMENT' : 'PAID');
    const taxFields = normalizePkExpenseTax({
      ...payload,
      amount: payload.amount
    }, db.settings?.pkTax);

    const row = {
      id: nextId(db, 'EXPENSE', 'EXP'),
      date: payload.date,
      description: payload.description,
      account: payload.account || selectedSourceAccount?.name || 'General',
      amount: asMoney(payload.amount),
      currency: String(payload.currency || selectedSourceAccount?.currency || 'USD').toUpperCase(),
      category: payload.category || 'Operating Expense',
      businessUnit: String(payload.businessUnit || 'CORPORATE').toUpperCase(),
      lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null,
      entity: normalizeEntity(payload.entity) || selectedSourceAccount?.entity || normalizeEntity(inferEntityFromCurrency(db, payload.currency || 'USD')) || 'US',
      channel: payload.channel ? String(payload.channel).toUpperCase() : null,
      department: payload.department || null,
      partnerTag: payload.partnerTag || null,
      intercompanyFlag: Boolean(payload.intercompanyFlag),
      treasuryFlag: Boolean(payload.treasuryFlag),
      capexFlag: Boolean(payload.capexFlag),
      sourceAccountId: selectedSourceAccount?.id || payload.sourceAccountId || null,
      globalAccountId: null,
      status: payload.status || defaultStatus,
      employeeId,
      reimbursementNeeded,
      reimbursementStatus,
      reimbursedAt: reimbursementStatus === 'REIMBURSED' ? (payload.reimbursedAt || payload.date) : null,
      reimbursementAccount: payload.reimbursementAccount || null,
      taxTreatment: taxFields.taxTreatment,
      deductiblePercent: taxFields.deductiblePercent,
      nonDeductibleAmount: taxFields.nonDeductibleAmount,
      taxNote: taxFields.taxNote,
      source: payload.source || null,
      notes: payload.notes || '',
      approvalStatus: String(payload.approvalStatus || 'PENDING').toUpperCase(),
      approvedByUserId: null,
      approvedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    applyGovernanceStamp(db, row, 'expense');
    db.expenses.push(row);
    recordApprovalEvent(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'CREATED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: row.entity,
      amount: row.amount,
      note: row.notes || '',
      statusAfter: row.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'expenses',
      action: 'expense_recorded',
      entityType: 'expense',
      entityId: row.id,
      details: `${row.amount} ${row.currency}`
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'EXPENSE',
      sourceRootId: row.id,
      actorUserId: req.user.sub
    });
    return row;
  });

  if (expense.error) return res.status(404).json(expense);
  return res.status(201).json({ expense });
});

app.patch('/api/expenses/:expenseId', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const updated = withDb((db) => {
    const row = (db.expenses || []).find((item) => item.id === req.params.expenseId);
    if (!row) return { error: 'Expense not found.' };
    const nextDate = payload.date !== undefined ? (payload.date || row.date) : row.date;
    const lockError = periodLockError(db, nextDate);
    if (lockError) return { error: lockError };
    const approvalSensitiveFields = ['date', 'description', 'account', 'amount', 'currency', 'category', 'businessUnit', 'lineOfService', 'entity', 'channel', 'department', 'partnerTag', 'intercompanyFlag', 'treasuryFlag', 'capexFlag', 'employeeId', 'reimbursementNeeded', 'reimbursementStatus', 'source', 'sourceAccountId', 'taxTreatment', 'deductiblePercent', 'taxNote'];
    const needsReapproval = approvalSensitiveFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field));

    if (payload.date !== undefined) row.date = payload.date || row.date;
    if (payload.description !== undefined) row.description = payload.description || row.description;
    if (payload.account !== undefined) row.account = payload.account || row.account;
    if (payload.amount !== undefined) row.amount = asMoney(payload.amount);
    if (payload.currency !== undefined) row.currency = String(payload.currency || row.currency || 'USD').toUpperCase();
    if (payload.category !== undefined) row.category = payload.category || row.category;
    if (payload.businessUnit !== undefined) row.businessUnit = payload.businessUnit ? String(payload.businessUnit).toUpperCase() : null;
    if (payload.lineOfService !== undefined) row.lineOfService = payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null;
    if (payload.entity !== undefined) row.entity = normalizeEntity(payload.entity) || row.entity;
    if (payload.channel !== undefined) row.channel = payload.channel ? String(payload.channel).toUpperCase() : null;
    if (payload.department !== undefined) row.department = payload.department || null;
    if (payload.partnerTag !== undefined) row.partnerTag = payload.partnerTag || null;
    if (payload.intercompanyFlag !== undefined) row.intercompanyFlag = Boolean(payload.intercompanyFlag);
    if (payload.treasuryFlag !== undefined) row.treasuryFlag = Boolean(payload.treasuryFlag);
    if (payload.capexFlag !== undefined) row.capexFlag = Boolean(payload.capexFlag);
    if (payload.status !== undefined) row.status = payload.status || row.status;
    if (payload.employeeId !== undefined) {
      if (!payload.employeeId) {
        row.employeeId = null;
      } else {
        const employee = getUser(db, payload.employeeId);
        if (!employee) return { error: 'Employee not found.' };
        row.employeeId = employee.id;
      }
    }
    if (payload.reimbursementNeeded !== undefined) row.reimbursementNeeded = Boolean(payload.reimbursementNeeded);
    if (payload.reimbursementStatus !== undefined) row.reimbursementStatus = String(payload.reimbursementStatus || row.reimbursementStatus || 'PENDING').toUpperCase();
    if (payload.reimbursedAt !== undefined) row.reimbursedAt = payload.reimbursedAt || null;
    if (payload.reimbursementAccount !== undefined) row.reimbursementAccount = payload.reimbursementAccount || null;
    if (payload.taxTreatment !== undefined) row.taxTreatment = String(payload.taxTreatment || row.taxTreatment || 'DEDUCTIBLE').toUpperCase();
    if (payload.deductiblePercent !== undefined) row.deductiblePercent = asMoney(payload.deductiblePercent);
    if (payload.taxNote !== undefined) row.taxNote = payload.taxNote || '';
    if (payload.source !== undefined) row.source = payload.source || null;
    if (payload.notes !== undefined) row.notes = payload.notes || '';
    if (payload.sourceAccountId !== undefined) {
      const nextSourceAccount = resolveSourceAccount(db, {
        sourceAccountId: payload.sourceAccountId || null,
        account: payload.account || row.account || null,
        entity: payload.entity || row.entity || null,
        currency: payload.currency || row.currency || null,
        sourceSystem: payload.source || row.source || null
      });
      const sourceAccountError = validateSelectedSourceAccount(nextSourceAccount, {
        sourceAccountId: payload.sourceAccountId || null,
        entity: payload.entity || row.entity || null,
        currency: payload.currency || row.currency || null,
        allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
        fieldLabel: 'expense source account'
      });
      if (sourceAccountError) return { error: sourceAccountError };
      row.sourceAccountId = nextSourceAccount?.id || null;
    }
    const normalizedTax = normalizePkExpenseTax({
      taxTreatment: row.taxTreatment,
      deductiblePercent: row.deductiblePercent,
      taxNote: row.taxNote,
      amount: row.amount
    }, db.settings?.pkTax);
    row.taxTreatment = normalizedTax.taxTreatment;
    row.deductiblePercent = normalizedTax.deductiblePercent;
    row.nonDeductibleAmount = normalizedTax.nonDeductibleAmount;
    row.taxNote = normalizedTax.taxNote;
    applyGovernanceStamp(db, row, 'expense');
    if (needsReapproval && String(row.approvalStatus || '').toUpperCase() === 'APPROVED') {
      row.approvalStatus = 'PENDING';
      row.approvedByUserId = null;
      row.approvedAt = null;
    }
    row.updatedAt = nowIso();

    recordApprovalEvent(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'UPDATED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: row.entity,
      amount: row.amount,
      note: JSON.stringify(payload),
      statusAfter: row.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'expenses',
      action: 'expense_updated',
      entityType: 'expense',
      entityId: row.id,
      details: JSON.stringify(payload)
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'EXPENSE',
      sourceRootId: row.id,
      actorUserId: req.user.sub
    });
    return { expense: row };
  });
  if (updated.error) return res.status(404).json(updated);
  return res.json(updated);
});

app.post('/api/expenses/:expenseId/approve', requireAuth, requireRole(financeApproveRoles), (req, res) => {
  const result = withDb((db) => {
    const row = (db.expenses || []).find((item) => item.id === req.params.expenseId);
    if (!row) return { error: 'Expense not found.', status: 404 };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'APPROVE',
      entity: row.entity,
      amount: row.amount,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };
    row.approvalStatus = 'APPROVED';
    row.approvedByUserId = req.user.sub;
    row.approvedAt = nowIso();
    row.rejectedByUserId = null;
    row.rejectionReason = null;
    row.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'APPROVED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: row.entity,
      amount: row.amount,
      note: req.body?.note || '',
      statusAfter: row.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'expenses',
      action: 'expense_approved',
      entityType: 'expense',
      entityId: row.id,
      details: `${row.amount} ${row.currency}`
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'EXPENSE',
      sourceRootId: row.id,
      actorUserId: req.user.sub
    });
    return { expense: row };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/expenses/:expenseId/reject', requireAuth, requireRole(financeApproveRoles), (req, res) => {
  const reason = req.body?.reason || 'Needs correction';
  const result = withDb((db) => {
    const row = (db.expenses || []).find((item) => item.id === req.params.expenseId);
    if (!row) return { error: 'Expense not found.', status: 404 };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'REJECT',
      entity: row.entity,
      amount: row.amount,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };
    row.approvalStatus = 'REJECTED';
    row.rejectedByUserId = req.user.sub;
    row.rejectionReason = reason;
    row.approvedByUserId = null;
    row.approvedAt = null;
    row.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'EXPENSE',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'REJECTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: row.entity,
      amount: row.amount,
      note: reason,
      statusAfter: row.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'expenses',
      action: 'expense_rejected',
      entityType: 'expense',
      entityId: row.id,
      details: reason
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'EXPENSE',
      sourceRootId: row.id,
      actorUserId: req.user.sub
    });
    return { expense: row };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.get('/api/reimbursements', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = (db.expenses || []).filter((row) => row.reimbursementNeeded === true || Boolean(row.employeeId));
  rows = rows.map((row) => hydrateReimbursementRow(db, row));
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.employeeId) rows = rows.filter((row) => String(row.employeeId || '') === String(req.query.employeeId));
  if (req.query.status) rows = rows.filter((row) => String(row.reimbursementStatus || '').toUpperCase() === String(req.query.status).toUpperCase());
  if (req.query.fromDate) rows = rows.filter((row) => String(row.date || '') >= String(req.query.fromDate));
  if (req.query.toDate) rows = rows.filter((row) => String(row.date || '') <= String(req.query.toDate));

  const byEmployee = new Map();
  let pendingAmount = 0;
  let reimbursedAmount = 0;
  for (const row of rows) {
    const user = row.employeeId ? getUser(db, row.employeeId) : null;
    const key = row.employeeId || 'UNASSIGNED';
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employeeId: row.employeeId || null,
        employeeName: user?.name || 'Unassigned',
        pendingAmount: 0,
        reimbursedAmount: 0,
        count: 0
      });
    }
    const bucket = byEmployee.get(key);
    bucket.count += 1;
    if (String(row.reimbursementStatus || '').toUpperCase() === 'REIMBURSED') {
      bucket.reimbursedAmount = asMoney(bucket.reimbursedAmount + Number(row.amount || 0));
      reimbursedAmount = asMoney(reimbursedAmount + Number(row.amount || 0));
    } else if (String(row.reimbursementStatus || '').toUpperCase() === 'PENDING') {
      bucket.pendingAmount = asMoney(bucket.pendingAmount + Number(row.amount || 0));
      pendingAmount = asMoney(pendingAmount + Number(row.amount || 0));
    }
  }

  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return res.json({
    summary: {
      count: rows.length,
      pendingCount: rows.filter((row) => String(row.reimbursementStatus || '').toUpperCase() === 'PENDING').length,
      reimbursedCount: rows.filter((row) => String(row.reimbursementStatus || '').toUpperCase() === 'REIMBURSED').length,
      pendingAmount: asMoney(pendingAmount),
      reimbursedAmount: asMoney(reimbursedAmount)
    },
    byEmployee: [...byEmployee.values()].sort((a, b) => b.pendingAmount - a.pendingAmount),
    reimbursements: rows
  });
});

app.post('/api/reimbursements/:expenseId/settle', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const settled = withDb((db) => {
    const row = (db.expenses || []).find((item) => item.id === req.params.expenseId);
    if (!row) return { error: 'Expense not found.' };
    const currentStatus = String(row.reimbursementStatus || '').toUpperCase();
    if (!(row.reimbursementNeeded === true || row.employeeId)) {
      return { error: 'Expense is not marked as reimbursable.' };
    }
    if (String(row.approvalStatus || '').toUpperCase() !== 'APPROVED') {
      return { error: 'Approve the expense before settling reimbursement.' };
    }
    if (currentStatus === 'REIMBURSED') {
      return { error: 'Expense is already reimbursed.' };
    }
    const settlementDate = payload.date || toDateKey(nowIso());
    const lockError = periodLockError(db, settlementDate);
    if (lockError) return { error: lockError };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'REIMBURSEMENT',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'SETTLE',
      entity: row.entity,
      amount: row.amount,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId
    });
    if (approvalError) return { error: approvalError };

    row.reimbursementNeeded = true;
    row.reimbursementStatus = 'REIMBURSED';
    row.reimbursedAt = settlementDate;
    row.reimbursementAccount = payload.account || row.reimbursementAccount || row.account || 'Meezan PKR';
    row.status = 'PAID';
    row.source = payload.source || row.source || 'ERP_REIMBURSEMENT';
    row.updatedAt = nowIso();

    const tx = {
      id: nextId(db, 'TRANSACTION', 'TXN'),
      date: row.reimbursedAt,
      account: row.reimbursementAccount,
      amount: asMoney(Math.abs(Number(row.amount || 0))),
      currency: String(row.currency || 'PKR').toUpperCase(),
      type: 'DEBIT',
      description: payload.description || `Employee reimbursement ${row.id}: ${row.description}`,
      category: row.category || 'Operating Expense',
      reimbursable: true,
      source: payload.source || 'ERP_REIMBURSEMENT',
      reference: payload.reference || `REIMB-${row.id}`,
      channel: row.channel || null,
      lineOfService: row.lineOfService || null,
      businessUnit: row.businessUnit || 'CORPORATE',
      department: row.department || null,
      partnerTag: row.partnerTag || null,
      treasuryFlag: false,
      intercompanyFlag: Boolean(row.intercompanyFlag),
      capexFlag: Boolean(row.capexFlag),
      entity: normalizeEntity(row.entity) || normalizeEntity(inferEntityFromCurrency(db, row.currency || 'PKR')) || 'PK',
      reconciled: false,
      invoiceId: null,
      linkedInvoiceIds: [],
      matchedAmount: 0,
      counterparty: row.employeeId ? (getUser(db, row.employeeId)?.name || row.employeeId) : null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    applyGovernanceStamp(db, tx, 'transaction');
    db.transactions.push(tx);

    recordApprovalEvent(db, {
      documentType: 'REIMBURSEMENT',
      entityType: 'EXPENSE',
      entityId: row.id,
      action: 'SETTLED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: row.entity,
      amount: row.amount,
      note: payload.description || payload.reference || '',
      statusAfter: row.reimbursementStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'reimbursements',
      action: 'reimbursement_settled',
      entityType: 'expense',
      entityId: row.id,
      details: JSON.stringify({
        reimbursementAccount: row.reimbursementAccount,
        reimbursedAt: row.reimbursedAt,
        transactionId: tx.id
      })
    });

    syncSourceRootPostings(db, {
      sourceRootType: 'EXPENSE',
      sourceRootId: row.id,
      actorUserId: req.user.sub
    });

    return { expense: row, transaction: tx };
  });
  if (settled.error) return res.status(409).json(settled);
  return res.json(settled);
});

app.get('/api/vendors', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = [...(db.vendors || [])].filter((row) => financeRecordVisibleToUser(req.user, row.entity));
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(req.query.status).toUpperCase());
  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return res.json({ vendors: rows });
});

app.post('/api/vendors', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Vendor name is required.' });

  const result = withDb((db) => {
    const existing = (db.vendors || []).find((row) => String(row.name || '').toLowerCase() === name.toLowerCase());
    if (existing) return { vendor: existing, duplicate: true };
    const vendor = {
      id: nextId(db, 'VENDOR', 'VEN'),
      name,
      email: payload.email || null,
      defaultCurrency: String(payload.defaultCurrency || payload.currency || 'USD').toUpperCase(),
      entity: normalizeEntity(payload.entity) || inferEntityFromCurrency(db, payload.defaultCurrency || payload.currency || 'USD') || 'US',
      status: String(payload.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      notes: payload.notes || '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.vendors.push(vendor);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_created',
      entityType: 'vendor',
      entityId: vendor.id,
      details: vendor.name
    });
    return { vendor, duplicate: false };
  });

  return res.status(result.duplicate ? 200 : 201).json(result);
});

app.get('/api/payables/bills', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = (db.vendorBills || [])
    .filter((row) => financeRecordVisibleToUser(req.user, row.entity))
    .map((row) => hydrateVendorBill(db, row));
  if (req.query.status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(req.query.status).toUpperCase());
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.vendorId) rows = rows.filter((row) => String(row.vendorId || '') === String(req.query.vendorId));
  if (req.query.fromDate) rows = rows.filter((row) => String(row.billDate || '') >= String(req.query.fromDate));
  if (req.query.toDate) rows = rows.filter((row) => String(row.billDate || '') <= String(req.query.toDate));
  rows.sort((a, b) => String(b.billDate || '').localeCompare(String(a.billDate || '')));
  const summary = buildPayablesSummary(db, rows);
  return res.json({
    summary: summary.summary,
    aging: summary.aging,
    byVendor: summary.byVendor,
    bills: rows
  });
});

app.post('/api/payables/bills', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.billDate || !payload.dueDate || payload.total === undefined || (!payload.vendorId && !payload.vendorName)) {
    return res.status(400).json({ error: 'billDate, dueDate, total, and vendor are required.' });
  }

  const result = withDb((db) => {
    const lockError = periodLockError(db, payload.billDate);
    if (lockError) return { error: lockError, status: 409 };

    let vendorId = payload.vendorId || null;
    let vendorName = payload.vendorName || null;
    if (vendorId) {
      const vendor = getVendor(db, vendorId);
      if (!vendor) return { error: 'Vendor not found.', status: 404 };
      vendorName = vendor.name;
    } else {
      const vendor = {
        id: nextId(db, 'VENDOR', 'VEN'),
        name: String(payload.vendorName || '').trim(),
        email: payload.vendorEmail || null,
        defaultCurrency: String(payload.currency || 'USD').toUpperCase(),
        entity: normalizeEntity(payload.entity) || inferEntityFromCurrency(db, payload.currency || 'USD') || 'US',
        status: 'ACTIVE',
        notes: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.vendors.push(vendor);
      vendorId = vendor.id;
      vendorName = vendor.name;
    }

    const lineItems = Array.isArray(payload.lineItems) && payload.lineItems.length
      ? payload.lineItems.map((line) => ({
        description: line.description || 'Vendor bill line',
        amount: asMoney(line.amount || 0),
        category: line.category || payload.category || 'Operating Expense',
        businessUnit: String(line.businessUnit || payload.businessUnit || 'CORPORATE').toUpperCase(),
        lineOfService: line.lineOfService ? String(line.lineOfService).toUpperCase() : (payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null),
        capexFlag: Boolean(line.capexFlag)
      }))
      : [{
        description: payload.description || payload.notes || 'Vendor bill',
        amount: asMoney(payload.total || 0),
        category: payload.category || 'Operating Expense',
        businessUnit: String(payload.businessUnit || 'CORPORATE').toUpperCase(),
        lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null,
        capexFlag: Boolean(payload.capexFlag)
      }];

    const subtotal = asMoney(lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const bill = {
      id: nextId(db, 'VENDOR_BILL', 'BILL'),
      vendorId,
      vendorName,
      billNumber: payload.billNumber || `BILL-${String(Date.now()).slice(-6)}`,
      billDate: payload.billDate,
      dueDate: payload.dueDate,
      currency: String(payload.currency || 'USD').toUpperCase(),
      entity: normalizeEntity(payload.entity) || inferEntityFromCurrency(db, payload.currency || 'USD') || 'US',
      category: payload.category || lineItems[0]?.category || 'Operating Expense',
      account: payload.account || null,
      businessUnit: String(payload.businessUnit || lineItems[0]?.businessUnit || 'CORPORATE').toUpperCase(),
      lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null,
      subtotal,
      total: asMoney(payload.total || subtotal),
      amountPaid: 0,
      status: String(payload.status || 'DRAFT').toUpperCase(),
      approvalStatus: String(payload.status || 'DRAFT').toUpperCase() === 'REJECTED'
        ? 'REJECTED'
        : (['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE', 'PAID'].includes(String(payload.status || '').toUpperCase()) ? 'APPROVED' : 'PENDING'),
      notes: payload.notes || '',
      source: payload.source || 'ERP_AP',
      sourceAccountId: payload.sourceAccountId || null,
      globalAccountId: null,
      lineItems,
      payments: [],
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.vendorBills.push(bill);
    recordApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'CREATED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount: bill.total,
      note: bill.notes || '',
      statusAfter: bill.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_bill_created',
      entityType: 'vendor_bill',
      entityId: bill.id,
      details: JSON.stringify({ vendorId: bill.vendorId, total: bill.total, currency: bill.currency })
    });
    return { bill: hydrateVendorBill(db, bill) };
  });

  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.status(201).json(result);
});

app.post('/api/payables/bills/:billId/submit', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const result = withDb((db) => {
    const bill = (db.vendorBills || []).find((row) => row.id === req.params.billId);
    if (!bill) return { error: 'Vendor bill not found.', status: 404 };
    if (String(bill.status || '').toUpperCase() !== 'DRAFT') return { error: 'Only draft bills can be submitted.', status: 409 };
    bill.status = 'PENDING_APPROVAL';
    bill.approvalStatus = 'PENDING';
    bill.submittedAt = nowIso();
    bill.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'SUBMITTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount: bill.total,
      note: bill.notes || '',
      statusAfter: bill.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_bill_submitted',
      entityType: 'vendor_bill',
      entityId: bill.id,
      details: bill.billNumber || bill.id
    });
    return { bill: hydrateVendorBill(db, bill) };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/payables/bills/:billId/approve', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER]), (req, res) => {
  const result = withDb((db) => {
    const bill = (db.vendorBills || []).find((row) => row.id === req.params.billId);
    if (!bill) return { error: 'Vendor bill not found.', status: 404 };
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(String(bill.status || '').toUpperCase())) return { error: 'Bill is not awaiting approval.', status: 409 };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'APPROVE',
      entity: bill.entity,
      amount: bill.total,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: bill.createdByUserId,
      approvedByUserId: bill.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };
    bill.status = 'APPROVED';
    bill.approvalStatus = 'APPROVED';
    bill.approvedAt = nowIso();
    bill.approvedByUserId = req.user.sub;
    bill.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'APPROVED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount: bill.total,
      note: req.body?.note || '',
      statusAfter: bill.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_bill_approved',
      entityType: 'vendor_bill',
      entityId: bill.id,
      details: bill.billNumber || bill.id
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'VENDOR_BILL',
      sourceRootId: bill.id,
      actorUserId: req.user.sub
    });
    return { bill: hydrateVendorBill(db, bill) };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/payables/bills/:billId/reject', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER]), (req, res) => {
  const result = withDb((db) => {
    const bill = (db.vendorBills || []).find((row) => row.id === req.params.billId);
    if (!bill) return { error: 'Vendor bill not found.', status: 404 };
    const approvalError = assertWorkflowAction(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'REJECT',
      entity: bill.entity,
      amount: bill.total,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: bill.createdByUserId,
      approvedByUserId: bill.approvedByUserId
    });
    if (approvalError) return { error: approvalError, status: 409 };
    bill.status = 'REJECTED';
    bill.approvalStatus = 'REJECTED';
    bill.rejectedByUserId = req.user.sub;
    bill.rejectionReason = req.body?.reason || 'Rejected';
    bill.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'REJECTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount: bill.total,
      note: bill.rejectionReason,
      statusAfter: bill.approvalStatus
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_bill_rejected',
      entityType: 'vendor_bill',
      entityId: bill.id,
      details: bill.rejectionReason
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'VENDOR_BILL',
      sourceRootId: bill.id,
      actorUserId: req.user.sub
    });
    return { bill: hydrateVendorBill(db, bill) };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/payables/bills/:billId/pay', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const bill = (db.vendorBills || []).find((row) => row.id === req.params.billId);
    if (!bill) return { error: 'Vendor bill not found.', status: 404 };
    const hydrated = hydrateVendorBill(db, bill);
    if (['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(String(hydrated.status || '').toUpperCase())) {
      return { error: 'Approve the bill before recording payment.', status: 409 };
    }
    const payDate = payload.date || toDateKey(nowIso());
    const lockError = periodLockError(db, payDate);
    if (lockError) return { error: lockError, status: 409 };

    const amount = asMoney(payload.amount == null ? hydrated.outstanding : payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Payment amount must be greater than zero.', status: 400 };
    if (amount - hydrated.outstanding > 0.01) return { error: 'Payment exceeds outstanding balance.', status: 409 };
    const normalizedEvidence = normalizeSupportingEvidence(payload);
    const approvalError = assertWorkflowAction(db, {
      documentType: 'VENDOR_PAYMENT',
      entityType: 'VENDOR_PAYMENT',
      entityId: `PENDING:${bill.id}`,
      action: 'POST',
      entity: bill.entity,
      amount,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: req.user.sub,
      approvedByUserId: req.user.sub,
      pendingEvidence: normalizedEvidence
    });
    if (approvalError) return { error: approvalError, status: 409 };

    const sourceAccount = resolveSourceAccount(db, {
      sourceAccountId: payload.sourceAccountId || bill.sourceAccountId || null,
      account: payload.account || null,
      entity: bill.entity,
      currency: bill.currency,
      sourceSystem: payload.source || null
    });
    const sourceAccountError = validateSelectedSourceAccount(sourceAccount, {
      sourceAccountId: payload.sourceAccountId || bill.sourceAccountId || null,
      entity: bill.entity,
      currency: bill.currency,
      allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
      fieldLabel: 'payment rail'
    });
    if (sourceAccountError) return { error: sourceAccountError, status: 409 };
    const payment = {
      id: nextId(db, 'VENDOR_PAYMENT', 'BPAY'),
      date: payDate,
      amount,
      currency: String(bill.currency || 'USD').toUpperCase(),
      sourceAccountId: sourceAccount?.id || payload.sourceAccountId || null,
      account: sourceAccount?.name || payload.account || null,
      reference: payload.reference || `BILLPAY-${bill.id}`,
      notes: payload.notes || '',
      approvalStatus: 'APPROVED',
      approvedByUserId: req.user.sub,
      approvedAt: nowIso(),
      postedAt: nowIso(),
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    bill.payments = Array.isArray(bill.payments) ? bill.payments : [];
    bill.payments.push(payment);
    const evidence = persistSupportingEvidence(db, normalizedEvidence, {
      entityType: 'VENDOR_PAYMENT',
      entityId: payment.id,
      actorUserId: req.user.sub
    });
    bill.amountPaid = asMoney((bill.payments || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
    bill.status = bill.amountPaid >= Number(bill.total || 0) - 0.01 ? 'PAID' : 'PARTIAL';
    bill.updatedAt = nowIso();

    const tx = {
      id: nextId(db, 'TRANSACTION', 'TXN'),
      date: payDate,
      account: sourceAccount?.name || payload.account || bill.account || 'Accounts Payable',
      amount,
      currency: String(bill.currency || 'USD').toUpperCase(),
      type: 'DEBIT',
      description: payload.description || `Vendor payment ${bill.billNumber || bill.id} - ${hydrated.vendorName}`,
      category: bill.category || bill.lineItems?.[0]?.category || 'Operating Expense',
      source: payload.source || 'ERP_AP_PAYMENT',
      reference: payment.reference,
      channel: null,
      lineOfService: bill.lineOfService || null,
      businessUnit: bill.businessUnit || 'CORPORATE',
      department: null,
      partnerTag: null,
      treasuryFlag: false,
      intercompanyFlag: false,
      capexFlag: Boolean((bill.lineItems || []).some((row) => row.capexFlag)),
      entity: normalizeEntity(bill.entity) || inferEntityFromCurrency(db, bill.currency || 'USD') || 'US',
      sourceAccountId: sourceAccount?.id || null,
      reconciled: false,
      invoiceId: null,
      linkedInvoiceIds: [],
      matchedAmount: 0,
      counterparty: hydrated.vendorName,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    applyGovernanceStamp(db, tx, 'transaction');
    db.transactions.push(tx);

    recordApprovalEvent(db, {
      documentType: 'VENDOR_PAYMENT',
      entityType: 'VENDOR_PAYMENT',
      entityId: payment.id,
      action: 'POSTED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount,
      note: payment.reference,
      metadata: { billId: bill.id, transactionId: tx.id },
      statusAfter: payment.approvalStatus
    });
    recordApprovalEvent(db, {
      documentType: 'VENDOR_BILL',
      entityType: 'VENDOR_BILL',
      entityId: bill.id,
      action: 'PAID',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: bill.entity,
      amount,
      note: payment.reference,
      statusAfter: bill.status
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payables',
      action: 'vendor_bill_paid',
      entityType: 'vendor_bill',
      entityId: bill.id,
      details: JSON.stringify({ paymentId: payment.id, amount, transactionId: tx.id, evidenceCount: evidence.length })
    });
    syncSourceRootPostings(db, {
      sourceRootType: 'VENDOR_BILL',
      sourceRootId: bill.id,
      actorUserId: req.user.sub
    });
    return { bill: hydrateVendorBill(db, bill), payment: hydrateVendorPayment(db, payment, bill), transaction: tx };
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.get('/api/intercompany/ledger', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = (db.intercompanyEntries || []).map((row) => hydrateIntercompanyLedgerEntry(db, row));
  if (req.query.status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(req.query.status).toUpperCase());
  if (req.query.entity) rows = rows.filter((row) => String(row.fromEntity || '').toUpperCase() === String(req.query.entity).toUpperCase() || String(row.toEntity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const summary = buildIntercompanySummary(rows);
  return res.json({ summary: summary.summary, byPair: summary.byPair, entries: rows });
});

app.post('/api/intercompany/entries', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.date || !payload.fromEntity || !payload.toEntity || payload.amount === undefined) {
    return res.status(400).json({ error: 'date, fromEntity, toEntity, and amount are required.' });
  }
  if (String(payload.fromEntity).toUpperCase() === String(payload.toEntity).toUpperCase()) {
    return res.status(400).json({ error: 'fromEntity and toEntity must differ.' });
  }

  const result = withDb((db) => {
    const lockError = periodLockError(db, payload.date);
    if (lockError) return { error: lockError, status: 409 };
    const sourceAccount = resolveSourceAccount(db, {
      sourceAccountId: payload.sourceAccountId || null,
      account: payload.account || null,
      entity: payload.fromEntity,
      currency: payload.currency || null,
      sourceSystem: payload.source || null
    });
    const sourceAccountError = validateSelectedSourceAccount(sourceAccount, {
      sourceAccountId: payload.sourceAccountId || null,
      entity: payload.fromEntity,
      currency: payload.currency || null,
      allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
      fieldLabel: 'funding rail'
    });
    if (sourceAccountError) return { error: sourceAccountError, status: 409 };
    const receivingSourceAccount = resolveSourceAccount(db, {
      sourceAccountId: payload.receivingSourceAccountId || null,
      account: payload.receivingAccount || null,
      entity: payload.toEntity,
      currency: payload.currency || null,
      sourceSystem: payload.receivingSource || payload.source || null
    });
    const receivingSourceAccountError = validateSelectedSourceAccount(receivingSourceAccount, {
      sourceAccountId: payload.receivingSourceAccountId || null,
      entity: payload.toEntity,
      currency: payload.currency || null,
      allowedRoles: ['BANK', 'CREDIT_CARD', 'WALLET'],
      fieldLabel: 'receiving rail'
    });
    if (receivingSourceAccountError) return { error: receivingSourceAccountError, status: 409 };
    const entry = {
      id: nextId(db, 'INTERCOMPANY', 'IC'),
      date: payload.date,
      fromEntity: normalizeEntity(payload.fromEntity),
      toEntity: normalizeEntity(payload.toEntity),
      amount: asMoney(payload.amount),
      currency: String(payload.currency || sourceAccount?.currency || 'USD').toUpperCase(),
      reason: payload.reason || 'Intercompany Funding',
      reference: payload.reference || `IC-${Date.now()}`,
      description: payload.description || '',
      status: 'OPEN',
      sourceAccountId: sourceAccount?.id || payload.sourceAccountId || null,
      receivingSourceAccountId: receivingSourceAccount?.id || payload.receivingSourceAccountId || null,
      settlementSourceAccountId: null,
      settlementDate: null,
      settlementReference: null,
      repaidAmount: 0,
      repaymentDate: null,
      repaymentReference: null,
      repaymentSourceAccountId: null,
      repaymentReceivingAccountId: null,
      repaymentEvents: [],
      notes: payload.notes || '',
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.intercompanyEntries.push(entry);

    if (payload.createCashMovement !== false) {
      createIntercompanyCashMovement(db, {
        date: entry.date,
        entity: entry.fromEntity,
        currency: entry.currency,
        amount: entry.amount,
        accountName: sourceAccount?.name || payload.account || `${entry.fromEntity} Treasury`,
        sourceAccountId: entry.sourceAccountId,
        reference: entry.reference,
        description: payload.description || `Intercompany funding out ${entry.fromEntity} -> ${entry.toEntity}`,
        counterparty: entry.toEntity,
        type: 'DEBIT',
        source: payload.source || 'ERP_INTERCOMPANY_FUNDING_OUT',
        category: 'Intercompany Funding'
      });
      createIntercompanyCashMovement(db, {
        date: entry.date,
        entity: entry.toEntity,
        currency: entry.currency,
        amount: entry.amount,
        accountName: receivingSourceAccount?.name || payload.receivingAccount || `${entry.toEntity} Treasury`,
        sourceAccountId: entry.receivingSourceAccountId,
        reference: entry.reference,
        description: payload.description || `Intercompany funding in ${entry.toEntity} <- ${entry.fromEntity}`,
        counterparty: entry.fromEntity,
        type: 'CREDIT',
        source: payload.receivingSource || payload.source || 'ERP_INTERCOMPANY_FUNDING_IN',
        category: 'Intercompany Funding'
      });
    }

    syncSourceRootPostings(db, {
      sourceRootType: 'INTERCOMPANY',
      sourceRootId: entry.id,
      actorUserId: req.user.sub
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'treasury',
      action: 'intercompany_entry_created',
      entityType: 'intercompany_entry',
      entityId: entry.id,
      details: JSON.stringify({ fromEntity: entry.fromEntity, toEntity: entry.toEntity, amount: entry.amount, receivingSourceAccountId: entry.receivingSourceAccountId })
    });
    return { entry: hydrateIntercompanyLedgerEntry(db, entry) };
  });

  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.status(201).json(result);
});

app.post('/api/intercompany/entries/:entryId/repay', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const entry = (db.intercompanyEntries || []).find((row) => row.id === req.params.entryId);
    if (!entry) return { error: 'Intercompany entry not found.', status: 404 };
    return recordIntercompanyRepayment(db, entry, payload, req.user.sub);
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/intercompany/entries/:entryId/settle', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const entry = (db.intercompanyEntries || []).find((row) => row.id === req.params.entryId);
    if (!entry) return { error: 'Intercompany entry not found.', status: 404 };
    return recordIntercompanyRepayment(db, entry, {
      ...payload,
      amount: payload.amount == null ? intercompanyOutstandingAmount(entry) : payload.amount
    }, req.user.sub);
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.get('/api/close/periods', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const months = Math.max(3, Math.min(Number(req.query.months || 6), 24));
  const periods = listClosePeriodsWithHydration(db, months);
  return res.json({ periods });
});

app.post('/api/close/periods/:periodKey/close', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const periodKey = String(req.params.periodKey || '');
  const checklistResult = withDb((db) => {
    const checklist = buildCloseChecklist(db, periodKey);
    if (!checklist) return { error: 'Invalid period key.', status: 400 };
    const normalizedEvidence = normalizeSupportingEvidence(req.body || {});
    const approvalError = assertWorkflowAction(db, {
      documentType: 'CLOSE_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      action: 'APPROVE',
      entity: '*',
      amount: 0,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: null,
      approvedByUserId: null,
      pendingEvidence: normalizedEvidence
    });
    if (approvalError) return { error: approvalError, status: 409 };
    if (!checklist.readyToClose && req.body?.force !== true) {
      return { error: 'Checklist has open blockers. Resolve them or use force close deliberately.', status: 409, checklist };
    }
    let row = (db.closePeriods || []).find((item) => item.periodKey === periodKey);
    if (!row) {
      row = {
        id: nextId(db, 'CLOSE_PERIOD', 'CLS'),
        periodKey,
        status: 'OPEN',
        notes: '',
        checklistSnapshot: null,
        metricsSnapshot: null,
        closedAt: null,
        closedByUserId: null,
        reopenedAt: null,
        reopenedByUserId: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.closePeriods.push(row);
    }
    const createdEvidence = persistSupportingEvidence(db, normalizedEvidence, {
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      actorUserId: req.user.sub
    });
    row.status = 'CLOSED';
    row.notes = req.body?.notes || row.notes || '';
    row.checklistSnapshot = checklist.checks;
    row.metricsSnapshot = checklist.metrics;
    row.relatedPartySnapshot = checklist.relatedParty || null;
    row.closeEvidenceSnapshot = buildEvidenceRecords(db, 'CLOSE_PERIOD', periodKey).map((evidence) => ({
      id: evidence.id,
      fileName: evidence.fileName,
      category: evidence.category,
      uploadedAt: evidence.uploadedAt,
      uploadedByUserId: evidence.uploadedByUserId,
      status: evidence.status
    }));
    row.closeApprovalSnapshot = buildApprovalState(db, {
      documentType: 'CLOSE_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      entity: '*',
      amount: 0,
      operationalStatus: 'CLOSED',
      approvalStatus: 'APPROVED',
      createdByUserId: req.user.sub,
      approvedByUserId: req.user.sub
    });
    row.closedAt = nowIso();
    row.closedByUserId = req.user.sub;
    row.updatedAt = nowIso();
    recordApprovalEvent(db, {
      documentType: 'CLOSE_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      action: 'CLOSED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: '*',
      amount: 0,
      note: req.body?.notes || '',
      metadata: {
        force: Boolean(req.body?.force),
        blockers: (checklist.checks || []).filter((item) => !item.pass).length,
        evidenceCount: createdEvidence.length
      },
      statusAfter: row.status
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'close',
      action: 'period_closed',
      entityType: 'close_period',
      entityId: row.id,
      details: JSON.stringify({ periodKey, force: Boolean(req.body?.force) })
    });
    return { period: row, checklist };
  });

  if (checklistResult.error) return res.status(checklistResult.status || 409).json(checklistResult);
  return res.json(checklistResult);
});

app.post('/api/close/periods/:periodKey/reopen', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const periodKey = String(req.params.periodKey || '');
  const result = withDb((db) => {
    const row = (db.closePeriods || []).find((item) => item.periodKey === periodKey);
    if (!row) return { error: 'Closed period not found.', status: 404 };
    const normalizedEvidence = normalizeSupportingEvidence(req.body || {});
    const approvalError = assertWorkflowAction(db, {
      documentType: 'REOPEN_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      action: 'REOPEN',
      entity: '*',
      amount: 0,
      actorRole: req.user.role,
      actorUserId: req.user.sub,
      createdByUserId: row.closedByUserId,
      approvedByUserId: row.closedByUserId,
      pendingEvidence: normalizedEvidence
    });
    if (approvalError) return { error: approvalError, status: 409 };
    const createdEvidence = persistSupportingEvidence(db, normalizedEvidence, {
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      actorUserId: req.user.sub
    });
    row.status = 'OPEN';
    row.reopenedAt = nowIso();
    row.reopenedByUserId = req.user.sub;
    row.updatedAt = nowIso();
    row.notes = req.body?.notes || row.notes || '';
    recordApprovalEvent(db, {
      documentType: 'REOPEN_PERIOD',
      entityType: 'CLOSE_PERIOD',
      entityId: periodKey,
      action: 'REOPENED',
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      entity: '*',
      amount: 0,
      note: req.body?.notes || '',
      metadata: { evidenceCount: createdEvidence.length },
      statusAfter: row.status
    });
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'close',
      action: 'period_reopened',
      entityType: 'close_period',
      entityId: row.id,
      details: JSON.stringify({ periodKey })
    });
    return { period: row };
  });
  if (result.error) return res.status(result.status || 409).json(result);
  return res.json(result);
});

app.get('/api/close/related-party-reconciliation', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const periodKey = String(req.query.periodKey || '');
  if (!periodKey) return res.status(400).json({ error: 'periodKey is required.' });
  const db = readDb();
  try {
    return res.json(buildRelatedPartyCloseReconciliation(db, { periodKey }));
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Related-party reconciliation failed.' });
  }
});

app.post('/api/close/periods/:periodKey/eliminations/generate', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const periodKey = String(req.params.periodKey || '');
  const result = withDb((db) => {
    try {
      const period = (db.closePeriods || []).find((row) => row.periodKey === periodKey);
      if (period && String(period.status || '').toUpperCase() === 'CLOSED') {
        return { error: `Period ${periodKey} is closed. Reopen it before regenerating eliminations.`, status: 409 };
      }
      const payload = generateEliminationPostings(db, {
        periodKey,
        actor: actorFromRequest(req)
      });
      for (const journal of payload.journals || []) {
        recordApprovalEvent(db, {
          documentType: 'JOURNAL',
          entityType: 'JOURNAL',
          entityId: journal.id,
          action: 'GENERATED',
          actorUserId: req.user.sub,
          actorRole: req.user.role,
          entity: journal.entity,
          amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
          note: journal.memo || '',
          metadata: { eliminationKey: journal.eliminationKey || null },
          statusAfter: journal.status
        });
      }
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'close',
        action: 'related_party_eliminations_generated',
        entityType: 'close_period',
        entityId: periodKey,
        details: JSON.stringify(payload.summary)
      });
      return payload;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Elimination generation failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/close/periods/:periodKey/related-party-cleanup', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const periodKey = String(req.params.periodKey || '');
  const payload = req.body || {};
  const result = withDb((db) => {
    const cleanupPostingDate = payload.postingDate || periodBounds(periodKey)?.end || null;
    const lockError = periodLockError(db, cleanupPostingDate);
    if (lockError) return { error: lockError, status: 409 };
    try {
      const cleanup = createCleanupReclassPosting(db, {
        periodKey,
        exceptionId: payload.exceptionId,
        offsetGlobalAccountId: payload.offsetGlobalAccountId || null,
        offsetGlobalAccountCode: payload.offsetGlobalAccountCode || null,
        postingDate: cleanupPostingDate,
        memo: payload.memo || '',
        actorUserId: req.user.sub
      });
      if (!cleanup.duplicate) {
        recordApprovalEvent(db, {
          documentType: 'JOURNAL',
          entityType: 'JOURNAL',
          entityId: cleanup.journal.id,
          action: 'CREATED',
          actorUserId: req.user.sub,
          actorRole: req.user.role,
          entity: cleanup.journal.entity,
          amount: Math.max(Number(cleanup.journal.totalDebit || 0), Number(cleanup.journal.totalCredit || 0)),
          note: cleanup.journal.memo || '',
          metadata: { cleanupKey: cleanup.journal.cleanupKey || null },
          statusAfter: cleanup.journal.status
        });
      }
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'close',
        action: cleanup.duplicate ? 'related_party_cleanup_reused' : 'related_party_cleanup_created',
        entityType: 'journal',
        entityId: cleanup.journal.id,
        details: JSON.stringify({ periodKey, exceptionId: payload.exceptionId, cleanupKey: cleanup.journal.cleanupKey || payload.exceptionId })
      });
      return cleanup;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Cleanup journal creation failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.status(result.duplicate ? 200 : 201).json(result);
});

app.get('/api/partner-draws', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const rows = db.partnerDraws
    .filter((row) => req.user.role !== role.PARTNER || row.userId === req.user.sub)
    .filter((row) => !req.query.entity || String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase())
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return res.json({ partnerDraws: rows });
});

app.post('/api/partner-draws', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.userId || !payload.date || payload.amount === undefined) {
    return res.status(400).json({ error: 'userId, date and amount are required.' });
  }

  const created = withDb((db) => {
    const lockError = periodLockError(db, payload.date);
    if (lockError) return { error: lockError };
    const partner = getUser(db, payload.userId);
    if (!partner || partner.role !== role.PARTNER) return { error: 'Partner user not found.' };

    const row = {
      id: nextId(db, 'PARTNER_DRAW', 'DRAW'),
      userId: payload.userId,
      date: payload.date,
      amount: asMoney(payload.amount),
      currency: String(payload.currency || 'USD').toUpperCase(),
      entity: normalizeEntity(payload.entity) || normalizeEntity(inferEntityFromCurrency(db, payload.currency || 'USD')) || 'US',
      partnerTag: payload.partnerTag || partner.name || null,
      status: payload.status || 'POSTED',
      notes: payload.notes || '',
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.partnerDraws.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'partner_draws',
      action: 'partner_draw_recorded',
      entityType: 'partner_draw',
      entityId: row.id,
      details: JSON.stringify({ userId: row.userId, amount: row.amount })
    });
    syncSystemSourcePosting(db, { sourceType: 'PARTNER_DRAW', sourceId: row.id, actorUserId: req.user.sub });
    return { partnerDraw: row };
  });

  if (created.error) return res.status(404).json(created);
  return res.status(201).json(created);
});

app.get('/api/asar-tower/costs', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const rows = [...db.asarTowerCosts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalCapex = asMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const monthlyDepreciation = asMoney(rows.reduce((sum, row) => {
    const months = Number(row.usefulLifeMonths || 0);
    return sum + (months > 0 ? Number(row.amount || 0) / months : 0);
  }, 0));
  return res.json({
    costs: rows,
    summary: {
      totalCapex,
      monthlyDepreciation
    }
  });
});

app.post('/api/asar-tower/costs', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.date || !payload.description || payload.amount === undefined) {
    return res.status(400).json({ error: 'date, description and amount are required.' });
  }
  const created = withDb((db) => {
    const lockError = periodLockError(db, payload.date);
    if (lockError) return { error: lockError };
    const row = {
      id: nextId(db, 'ASAR_COST', 'ASAR'),
      date: payload.date,
      vendor: payload.vendor || '',
      description: payload.description,
      amount: asMoney(payload.amount),
      currency: String(payload.currency || 'USD').toUpperCase(),
      entity: normalizeEntity(payload.entity) || normalizeEntity(inferEntityFromCurrency(db, payload.currency || 'USD')) || 'PK',
      businessUnit: String(payload.businessUnit || 'TOWER').toUpperCase(),
      category: payload.category || 'Capex',
      usefulLifeMonths: Number(payload.usefulLifeMonths || 60),
      status: payload.status || 'CAPITALIZED',
      notes: payload.notes || '',
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.asarTowerCosts.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'asar_tower',
      action: 'asar_cost_recorded',
      entityType: 'asar_cost',
      entityId: row.id,
      details: row.description
    });
    syncSystemSourcePosting(db, { sourceType: 'ASAR_COST', sourceId: row.id, actorUserId: req.user.sub });
    return row;
  });
  return res.status(201).json({ cost: created });
});

app.post('/api/poncho/settlements', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.date || !payload.amount || !payload.reference) {
    return res.status(400).json({ error: 'date, amount, reference are required.' });
  }
  const settlement = withDb((db) => {
    const lockError = periodLockError(db, payload.date);
    if (lockError) return { error: lockError };
    const id = nextId(db, 'SETTLEMENT', 'PON');
    const row = {
      id,
      date: payload.date,
      amount: asMoney(payload.amount),
      currency: String(payload.currency || 'USD').toUpperCase(),
      entity: normalizeEntity(payload.entity) || normalizeEntity(inferEntityFromCurrency(db, payload.currency || 'USD')) || 'UK',
      channel: payload.channel ? String(payload.channel).toUpperCase() : null,
      businessUnit: 'PONCHO',
      reference: payload.reference,
      notes: payload.notes || '',
      invoiceId: payload.invoiceId || null,
      matched: Boolean(payload.invoiceId),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.ponchoSettlements.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'poncho',
      action: 'settlement_recorded',
      entityType: 'settlement',
      entityId: id,
      details: payload.reference
    });
    syncSystemSourcePosting(db, { sourceType: 'PONCHO_SETTLEMENT', sourceId: id, actorUserId: req.user.sub });
    return row;
  });
  return res.status(201).json({ settlement });
});

app.get('/api/poncho/settlements', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const settlements = [...db.ponchoSettlements].sort((a, b) => (a.date < b.date ? 1 : -1));
  const unmatchedTotal = asMoney(settlements.filter((row) => !row.matched).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  return res.json({
    settlements,
    summary: {
      totalSettlements: settlements.length,
      unmatchedTotal
    }
  });
});

app.post('/api/payroll/runs', requireAuth, requireRole(settingsManageRoles), (req, res) => {
  const payload = req.body || {};
  if (!payload.month || !payload.year || !Array.isArray(payload.items)) {
    return res.status(400).json({ error: 'month, year, items[] are required.' });
  }

  const run = withDb((db) => {
    const runId = nextId(db, 'PAYROLL', 'PAYRUN');
    const rows = [];
    const pkTaxSettings = db.settings?.pkTax || buildDefaultPkTaxSettings();
    for (const item of payload.items) {
      const rowId = nextId(db, 'PAYROLL', 'PAYITEM');
      const currency = String(item.currency || 'USD').toUpperCase();
      const entity = normalizeEntity(item.entity) || normalizeEntity(payload.entity) || normalizeEntity(inferEntityFromCurrency(db, currency)) || 'PK';
      const computed = entity === 'PK'
        ? calculatePkPayrollItem(item, pkTaxSettings)
        : {
            grossPay: asMoney(item.grossPay || 0),
            taxablePay: asMoney(item.grossPay || 0),
            annualizedTaxablePay: asMoney((item.grossPay || 0) * 12),
            annualTax: 0,
            withholdingTax: asMoney(item.withholdingTax || 0),
            otherDeductions: asMoney(item.otherDeductions != null ? item.otherDeductions : item.deductions || 0),
            totalDeductions: asMoney((item.withholdingTax || 0) + (item.otherDeductions != null ? item.otherDeductions : item.deductions || 0)),
            netPay: asMoney((item.grossPay || 0) - ((item.withholdingTax || 0) + (item.otherDeductions != null ? item.otherDeductions : item.deductions || 0))),
            withholdingSection: null,
            taxYearLabel: null,
            components: {
              basicPay: asMoney(item.grossPay || 0),
              allowances: 0,
              bonus: 0,
              overtime: 0,
              taxableReimbursements: 0,
              nonTaxableReimbursements: 0
            }
          };
      rows.push({
        id: rowId,
        runId,
        userId: item.userId,
        grossPay: computed.grossPay,
        taxablePay: computed.taxablePay,
        annualizedTaxablePay: computed.annualizedTaxablePay,
        annualTax: computed.annualTax,
        withholdingTax: computed.withholdingTax,
        otherDeductions: computed.otherDeductions,
        deductions: computed.totalDeductions,
        netPay: computed.netPay,
        currency,
        entity,
        lineOfService: item.lineOfService ? String(item.lineOfService).toUpperCase() : null,
        businessUnit: item.businessUnit ? String(item.businessUnit).toUpperCase() : 'CORPORATE',
        intercompanyFlag: Boolean(item.intercompanyFlag),
        components: computed.components,
        withholdingSection: computed.withholdingSection,
        taxYearLabel: computed.taxYearLabel,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    }

    db.payrollItems.push(...rows);
    const totals = summarizePkPayrollRun(rows);
    const runRow = {
      id: runId,
      month: payload.month,
      year: payload.year,
      entity: normalizeEntity(payload.entity) || normalizeEntity(rows[0]?.entity) || 'PK',
      currency: String(payload.currency || rows[0]?.currency || 'PKR').toUpperCase(),
      status: payload.status || 'PUBLISHED',
      totalGross: totals.totalGross,
      totalTaxablePay: totals.totalTaxablePay,
      totalWithholdingTax: totals.totalWithholdingTax,
      totalOtherDeductions: totals.totalOtherDeductions,
      totalDeductions: totals.totalDeductions,
      totalNet: totals.totalNet,
      payrollTaxSettingsVersion: pkTaxSettings.taxYearLabel || null,
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.payrollRuns.push(runRow);

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'payroll',
      action: 'payroll_run_created',
      entityType: 'payroll_run',
      entityId: runId,
      details: `${payload.month}/${payload.year}`
    });

    syncSystemSourcePosting(db, { sourceType: 'PAYROLL_RUN', sourceId: runId, actorUserId: req.user.sub });

    return {
      run: runRow,
      items: rows
    };
  });

  return res.status(201).json(run);
});

app.get('/api/payroll/runs', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const runs = [...db.payrollRuns]
    .sort((a, b) => (`${b.year}-${String(b.month).padStart(2, '0')}`).localeCompare(`${a.year}-${String(a.month).padStart(2, '0')}`))
    .map((run) => ({
      ...run,
      items: db.payrollItems.filter((item) => item.runId === run.id)
    }));
  return res.json({ runs });
});

app.get('/api/management/adjustments', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  let rows = [...(db.managementAdjustments || [])];
  if (req.query.status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(req.query.status).toUpperCase());
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.fromDate) rows = rows.filter((row) => String(row.effectiveDate || row.date || '') >= String(req.query.fromDate));
  if (req.query.toDate) rows = rows.filter((row) => String(row.effectiveDate || row.date || '') <= String(req.query.toDate));
  if (req.query.sourceTransactionId) rows = rows.filter((row) => row.sourceTransactionId === String(req.query.sourceTransactionId));
  rows.sort((a, b) => String(b.effectiveDate || b.date || '').localeCompare(String(a.effectiveDate || a.date || '')));
  return res.json({ adjustments: rows });
});

app.post('/api/management/adjustments', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  if (payload.amount === undefined || payload.amount === null || Number(payload.amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number.' });
  }
  if (!payload.fromCategory && !payload.toCategory) {
    return res.status(400).json({ error: 'Provide fromCategory and/or toCategory.' });
  }

  const created = withDb((db) => {
    const sourceTx = payload.sourceTransactionId
      ? db.transactions.find((row) => row.id === String(payload.sourceTransactionId))
      : null;
    if (payload.sourceTransactionId && !sourceTx) {
      return { error: `Source transaction not found: ${payload.sourceTransactionId}` };
    }

    const id = nextId(db, 'MGMT_ADJUSTMENT', 'MGADJ');
    const currency = String(payload.currency || sourceTx?.currency || db.settings?.reportingCurrency || 'USD').toUpperCase();
    const row = {
      id,
      date: payload.date || null,
      effectiveDate: payload.effectiveDate || payload.date || toDateKey(nowIso()),
      amount: asMoney(Math.abs(payload.amount)),
      currency,
      entity: normalizeEntity(payload.entity) || sourceTx?.entity || normalizeEntity(inferEntityFromCurrency(db, currency)) || 'US',
      lineOfService: payload.lineOfService ? String(payload.lineOfService).toUpperCase() : (sourceTx?.lineOfService || null),
      businessUnit: payload.businessUnit ? String(payload.businessUnit).toUpperCase() : (sourceTx?.businessUnit || null),
      channel: payload.channel ? String(payload.channel).toUpperCase() : (sourceTx?.channel || null),
      fromCategory: payload.fromCategory || null,
      toCategory: payload.toCategory || null,
      partnerTag: payload.partnerTag || sourceTx?.partnerTag || null,
      sourceTransactionId: sourceTx?.id || null,
      reason: payload.reason || null,
      notes: payload.notes || '',
      status: String(payload.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      createdByUserId: req.user.sub,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.managementAdjustments.push(row);
    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'management',
      action: 'management_adjustment_created',
      entityType: 'management_adjustment',
      entityId: row.id,
      details: JSON.stringify({
        fromCategory: row.fromCategory,
        toCategory: row.toCategory,
        amount: row.amount,
        currency: row.currency
      })
    });
    return { adjustment: row };
  });

  if (created.error) return res.status(404).json(created);
  return res.status(201).json(created);
});

app.patch('/api/management/adjustments/:adjustmentId', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const updated = withDb((db) => {
    const row = (db.managementAdjustments || []).find((item) => item.id === req.params.adjustmentId);
    if (!row) return { error: 'Management adjustment not found.' };

    if (payload.amount !== undefined) {
      const numeric = Number(payload.amount);
      if (!Number.isFinite(numeric) || numeric <= 0) return { error: 'amount must be a positive number.' };
      row.amount = asMoney(numeric);
    }
    if (payload.currency !== undefined) row.currency = String(payload.currency || row.currency || 'USD').toUpperCase();
    if (payload.effectiveDate !== undefined) row.effectiveDate = payload.effectiveDate || row.effectiveDate;
    if (payload.entity !== undefined) row.entity = normalizeEntity(payload.entity) || row.entity || null;
    if (payload.lineOfService !== undefined) row.lineOfService = payload.lineOfService ? String(payload.lineOfService).toUpperCase() : null;
    if (payload.businessUnit !== undefined) row.businessUnit = payload.businessUnit ? String(payload.businessUnit).toUpperCase() : null;
    if (payload.channel !== undefined) row.channel = payload.channel ? String(payload.channel).toUpperCase() : null;
    if (payload.fromCategory !== undefined) row.fromCategory = payload.fromCategory || null;
    if (payload.toCategory !== undefined) row.toCategory = payload.toCategory || null;
    if (payload.partnerTag !== undefined) row.partnerTag = payload.partnerTag || null;
    if (payload.reason !== undefined) row.reason = payload.reason || null;
    if (payload.notes !== undefined) row.notes = payload.notes || '';
    if (payload.status !== undefined) {
      row.status = String(payload.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    }
    row.updatedAt = nowIso();

    appendAudit(db, {
      actorUserId: req.user.sub,
      module: 'management',
      action: 'management_adjustment_updated',
      entityType: 'management_adjustment',
      entityId: row.id,
      details: JSON.stringify(payload)
    });
    return { adjustment: row };
  });
  if (updated.error) return res.status(404).json(updated);
  return res.json(updated);
});

app.get('/api/journals', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const journals = listJournalRegister(db, {
    status: req.query.status || null,
    entity: req.query.entity || null,
    sourceType: req.query.sourceType || null,
    journalType: req.query.journalType || null,
    fromDate: req.query.fromDate || null,
    toDate: req.query.toDate || null
  }).filter((row) => financeRecordVisibleToUser(req.user, row.entity));
  const summary = {
    total: journals.length,
    draft: journals.filter((row) => String(row.status || '').toUpperCase() === 'DRAFT').length,
    pendingApproval: journals.filter((row) => String(row.status || '').toUpperCase() === 'PENDING_APPROVAL').length,
    approved: journals.filter((row) => String(row.status || '').toUpperCase() === 'APPROVED').length,
    posted: journals.filter((row) => String(row.status || '').toUpperCase() === 'POSTED').length,
    manual: journals.filter((row) => ['MANUAL', 'ADJUSTMENT'].includes(String(row.journalType || '').toUpperCase())).length,
    system: journals.filter((row) => String(row.journalType || '').toUpperCase() === 'SYSTEM').length
  };
  return res.json({ journals, summary });
});

app.get('/api/journals/:journalId', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const journal = getJournalDetail(db, req.params.journalId);
  if (!journal || !financeRecordVisibleToUser(req.user, journal.entity)) return res.status(404).json({ error: 'Journal not found.' });
  return res.json({ journal });
});

app.post('/api/journals', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const payload = req.body || {};
  const result = withDb((db) => {
    const lockError = periodLockError(db, payload.postingDate);
    if (lockError) return { error: lockError, status: 409 };
    try {
      const journal = createManualJournal(db, payload, req.user.sub);
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: journal.id,
        action: 'CREATED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: journal.entity,
        amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
        note: journal.memo || '',
        statusAfter: journal.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_created',
        entityType: 'journal',
        entityId: journal.id,
        details: JSON.stringify({ journalNumber: journal.journalNumber, journalType: journal.journalType, postingDate: journal.postingDate })
      });
      return { journal };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal create failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.status(201).json(result);
});

app.post('/api/journals/:journalId/submit', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const result = withDb((db) => {
    try {
      const journal = submitJournal(db, req.params.journalId, req.user.sub);
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: journal.id,
        action: 'SUBMITTED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: journal.entity,
        amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
        note: journal.memo || '',
        statusAfter: journal.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_submitted',
        entityType: 'journal',
        entityId: journal.id,
        details: journal.journalNumber
      });
      return { journal };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal submit failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/journals/:journalId/approve', requireAuth, requireRole(financeApproveRoles), (req, res) => {
  const result = withDb((db) => {
    try {
      const journal = approveJournal(db, req.params.journalId, actorFromRequest(req));
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: journal.id,
        action: 'APPROVED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: journal.entity,
        amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
        note: req.body?.note || '',
        statusAfter: journal.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_approved',
        entityType: 'journal',
        entityId: journal.id,
        details: journal.journalNumber
      });
      return { journal };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal approval failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/journals/:journalId/reject', requireAuth, requireRole(financeApproveRoles), (req, res) => {
  const result = withDb((db) => {
    try {
      const journal = rejectJournal(db, req.params.journalId, actorFromRequest(req), req.body?.reason || 'Needs correction');
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: journal.id,
        action: 'REJECTED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: journal.entity,
        amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
        note: journal.rejectionReason || '',
        statusAfter: journal.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_rejected',
        entityType: 'journal',
        entityId: journal.id,
        details: journal.rejectionReason
      });
      return { journal };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal rejection failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/journals/:journalId/post', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const result = withDb((db) => {
    const current = getJournalDetail(db, req.params.journalId);
    if (!current) return { error: 'Journal not found.', status: 404 };
    const lockError = periodLockError(db, current.postingDate);
    if (lockError) return { error: lockError, status: 409 };
    try {
      const journal = postJournal(db, req.params.journalId, actorFromRequest(req));
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: journal.id,
        action: 'POSTED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: journal.entity,
        amount: Math.max(Number(journal.totalDebit || 0), Number(journal.totalCredit || 0)),
        note: journal.memo || '',
        statusAfter: journal.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_posted',
        entityType: 'journal',
        entityId: journal.id,
        details: journal.journalNumber
      });
      return { journal };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal posting failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.post('/api/journals/:journalId/reverse', requireAuth, requireRole(financeManageRoles), (req, res) => {
  const result = withDb((db) => {
    const reverseDate = req.body?.postingDate || toDateKey(Date.now());
    const lockError = periodLockError(db, reverseDate);
    if (lockError) return { error: lockError, status: 409 };
    try {
      const reversal = reverseJournal(db, req.params.journalId, actorFromRequest(req), {
        postingDate: reverseDate,
        memo: req.body?.memo || ''
      });
      recordApprovalEvent(db, {
        documentType: 'JOURNAL',
        entityType: 'JOURNAL',
        entityId: reversal.original.id,
        action: 'REVERSED',
        actorUserId: req.user.sub,
        actorRole: req.user.role,
        entity: reversal.original.entity,
        amount: Math.max(Number(reversal.original.totalDebit || 0), Number(reversal.original.totalCredit || 0)),
        note: req.body?.memo || '',
        metadata: { reversalJournalId: reversal.reversal.id },
        statusAfter: reversal.original.status
      });
      appendAudit(db, {
        actorUserId: req.user.sub,
        module: 'journals',
        action: 'journal_reversed',
        entityType: 'journal',
        entityId: reversal.original.id,
        details: JSON.stringify({ reversalJournalId: reversal.reversal.id, postingDate: reverseDate })
      });
      return reversal;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Journal reversal failed.', status: 409 };
    }
  });
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  return res.json(result);
});

app.get('/api/accounting/integrity', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  const limit = Number(req.query.limit || 100);
  return res.json(buildAccountingIntegrityReport(db, { limit }));
});

app.get('/api/reports/trial-balance', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  return res.json(buildTrialBalance(db, {
    asOfDate: req.query.asOfDate ? String(req.query.asOfDate) : (req.query.toDate ? String(req.query.toDate) : null),
    entity: req.query.entity || null
  }));
});

app.get('/api/reports/trial-balance/drilldown', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  if (!req.query.accountCode) return res.status(400).json({ error: 'accountCode is required.' });
  const db = readDb();
  try {
    return res.json(buildTrialBalanceDrilldown(db, {
      accountCode: String(req.query.accountCode),
      asOfDate: req.query.asOfDate ? String(req.query.asOfDate) : (req.query.toDate ? String(req.query.toDate) : null),
      entity: req.query.entity || null
    }));
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Trial balance drilldown failed.' });
  }
});

app.get('/api/reports/statement-drilldown', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  if (!req.query.statement || !req.query.lineKey) {
    return res.status(400).json({ error: 'statement and lineKey are required.' });
  }
  const db = readDb();
  try {
    return res.json(buildStatementDrilldown(db, {
      statement: String(req.query.statement),
      lineKey: String(req.query.lineKey),
      fromDate: req.query.fromDate ? String(req.query.fromDate) : null,
      toDate: req.query.toDate ? String(req.query.toDate) : null,
      entity: req.query.entity || null
    }));
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Statement drilldown failed.' });
  }
});

app.get('/api/reports/intercompany-exposure', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  return res.json(buildIntercompanyExposure(db, {
    asOfDate: req.query.asOfDate ? String(req.query.asOfDate) : (req.query.toDate ? String(req.query.toDate) : null),
    entity: req.query.entity || null
  }));
});

app.get('/api/reports/management/entries', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const includeIntercompany = parseBool(req.query.includeIntercompany, true);
  const includeCapex = parseBool(req.query.includeCapex, true);
  const limit = Math.max(1, Math.min(Number(req.query.limit || 500), 5000));

  let rows = buildManagementEntries(db, { fromDate: from, toDate: to });
  if (req.query.entity) rows = rows.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.lineOfService) rows = rows.filter((row) => String(row.lineOfService || '').toUpperCase() === String(req.query.lineOfService).toUpperCase());
  if (req.query.businessUnit) rows = rows.filter((row) => String(row.businessUnit || '').toUpperCase() === String(req.query.businessUnit).toUpperCase());
  if (req.query.channel) rows = rows.filter((row) => String(row.channel || '').toUpperCase() === String(req.query.channel).toUpperCase());
  if (!includeIntercompany) rows = rows.filter((row) => !row.intercompanyFlag);
  if (!includeCapex) rows = rows.filter((row) => entryBucket(row) !== 'capex');
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to, includeIntercompany, includeCapex },
    entryCount: rows.length,
    entries: rows.slice(0, limit)
  });
});

app.get('/api/reports/management/pl', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const includeIntercompany = parseBool(req.query.includeIntercompany, false);
  const includeCapex = parseBool(req.query.includeCapex, true);

  let entries = buildManagementEntries(db, { fromDate: from, toDate: to });
  if (req.query.entity) entries = entries.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (req.query.lineOfService) entries = entries.filter((row) => String(row.lineOfService || '').toUpperCase() === String(req.query.lineOfService).toUpperCase());
  if (req.query.businessUnit) entries = entries.filter((row) => String(row.businessUnit || '').toUpperCase() === String(req.query.businessUnit).toUpperCase());
  if (req.query.channel) entries = entries.filter((row) => String(row.channel || '').toUpperCase() === String(req.query.channel).toUpperCase());
  if (!includeIntercompany) entries = entries.filter((row) => !row.intercompanyFlag);
  if (!includeCapex) entries = entries.filter((row) => entryBucket(row) !== 'capex');

  const categoryTotals = new Map();
  for (const entry of entries) {
    const key = entry.category || 'Unclassified';
    categoryTotals.set(key, asMoney((categoryTotals.get(key) || 0) + asMoney(entry.reportingAmount || 0)));
  }
  const byCategory = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount: asMoney(amount) }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to, includeIntercompany, includeCapex },
    entryCount: entries.length,
    summary: summarizeManagementEntries(entries),
    mappingCoverage: summarizeMappingCoverage(entries),
    byEntity: summarizeBy(entries, (row) => row.entity || 'UNSPECIFIED'),
    byLineOfService: summarizeBy(entries, (row) => row.lineOfService || 'UNSPECIFIED'),
    byBusinessUnit: summarizeBy(entries, (row) => row.businessUnit || 'UNSPECIFIED'),
    byChannel: summarizeBy(entries, (row) => row.channel || 'DIRECT'),
    byReportingGroup: summarizeBy(entries, (row) => row.globalReportingGroup || 'UNSPECIFIED'),
    byGlobalAccount: summarizeBy(entries, (row) => row.globalAccountCode ? `${row.globalAccountCode} | ${row.globalAccountName}` : 'UNMAPPED')
      .map((row) => ({ globalAccount: row.key, ...row })),
    byMonth: summarizeMonthly(entries),
    byCategory
  });
});

app.get('/api/reports/management/treasury', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;

  let entries = buildManagementEntries(db, { fromDate: from, toDate: to });
  if (req.query.entity) entries = entries.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  const treasuryEntries = entries.filter((row) => row.treasuryFlag || row.intercompanyFlag || entryBucket(row) === 'treasury');

  const byEntityMap = new Map();
  const byCurrencyMap = new Map();
  let inflows = 0;
  let outflows = 0;
  for (const entry of treasuryEntries) {
    const reportAmt = asMoney(entry.reportingAmount || 0);
    if (reportAmt >= 0) inflows = asMoney(inflows + reportAmt);
    else outflows = asMoney(outflows + Math.abs(reportAmt));

    const entity = entry.entity || 'UNSPECIFIED';
    if (!byEntityMap.has(entity)) byEntityMap.set(entity, { entity, inflows: 0, outflows: 0, net: 0 });
    const entityRow = byEntityMap.get(entity);
    if (reportAmt >= 0) entityRow.inflows = asMoney(entityRow.inflows + reportAmt);
    else entityRow.outflows = asMoney(entityRow.outflows + Math.abs(reportAmt));
    entityRow.net = asMoney(entityRow.inflows - entityRow.outflows);

    const curr = String(entry.currency || db.settings?.reportingCurrency || 'USD').toUpperCase();
    if (!byCurrencyMap.has(curr)) byCurrencyMap.set(curr, { currency: curr, nativeAmount: 0, reportingAmount: 0 });
    const currRow = byCurrencyMap.get(curr);
    currRow.nativeAmount = asMoney(currRow.nativeAmount + asMoney(entry.amount || 0));
    currRow.reportingAmount = asMoney(currRow.reportingAmount + reportAmt);
  }

  const transferRows = (db.transactions || [])
    .filter((tx) => (!from || String(tx.date || '') >= from) && (!to || String(tx.date || '') <= to))
    .filter((tx) => isTransferLikeTransaction(tx) || Boolean(tx.intercompanyFlag) || Boolean(tx.treasuryFlag))
    .map((tx) => {
      const sign = String(tx.type || '').toUpperCase() === 'DEBIT' ? -1 : 1;
      const amount = asMoney(sign * Math.abs(Number(tx.amount || 0)));
      return {
        id: tx.id,
        date: tx.date,
        account: tx.account,
        description: tx.description,
        category: tx.category,
        entity: tx.entity || inferEntityFromTransaction({ account: tx.account, currency: tx.currency, sourceSystem: tx.source }) || null,
        currency: tx.currency || 'USD',
        amount,
        reportingAmount: toReportingAmount(db, amount, tx.currency || 'USD'),
        intercompanyFlag: Boolean(tx.intercompanyFlag),
        treasuryFlag: Boolean(tx.treasuryFlag)
      };
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const cashBalances = (db.accounts || []).map((account) => {
    const native = asMoney(account.currentBalance || 0);
    const globalAccount = account.globalAccountId ? getGlobalAccountById(db, account.globalAccountId) : resolveMappedGlobalAccount(db, account);
    return {
      accountId: account.id,
      account: account.name,
      provider: account.provider,
      currency: String(account.currency || 'USD').toUpperCase(),
      nativeBalance: native,
      reportingBalance: toReportingAmount(db, native, account.currency || 'USD'),
      entity: inferEntityFromTransaction({ account: account.name, currency: account.currency, sourceSystem: account.provider }) || null,
      accountRole: account.accountRole || null,
      globalAccountCode: globalAccount?.code || null,
      globalAccountName: globalAccount?.name || null,
      lastPulledAt: account.lastPulledAt || null
    };
  }).filter((account) => ['BANK', 'CREDIT_CARD', 'WALLET'].includes(String(account.accountRole || '').toUpperCase()));

  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to },
    mappingCoverage: summarizeMappingCoverage(treasuryEntries),
    summary: {
      inflows,
      outflows,
      net: asMoney(inflows - outflows),
      transferCount: transferRows.length
    },
    byEntity: [...byEntityMap.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    byCurrency: [...byCurrencyMap.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency))),
    transferRows: transferRows.slice(0, 1000),
    cashBalances
  });
});

app.get('/api/reports/management/partner-ledger', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const partnerQuery = req.query.partner ? String(req.query.partner).toLowerCase() : null;

  let entries = buildManagementEntries(db, { fromDate: from, toDate: to })
    .filter((row) => entryBucket(row) === 'partnerDraw' || String(row.category || '').toLowerCase().includes('partner draw'));

  if (req.query.entity) entries = entries.filter((row) => String(row.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (partnerQuery) {
    entries = entries.filter((row) => String(row.partnerTag || '').toLowerCase().includes(partnerQuery));
  }

  const totalsByPartner = new Map();
  for (const entry of entries) {
    const partner = entry.partnerTag || 'UNASSIGNED';
    if (!totalsByPartner.has(partner)) {
      totalsByPartner.set(partner, {
        partner,
        drawAmount: 0,
        entryCount: 0,
        entities: new Set()
      });
    }
    const row = totalsByPartner.get(partner);
    row.drawAmount = asMoney(row.drawAmount + Math.abs(asMoney(entry.reportingAmount || 0)));
    row.entryCount += 1;
    row.entities.add(entry.entity || 'UNSPECIFIED');
  }

  const ledgerRows = entries
    .map((entry) => ({
      date: entry.date,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      partner: entry.partnerTag || 'UNASSIGNED',
      entity: entry.entity || null,
      currency: entry.currency,
      category: entry.category,
      amount: asMoney(entry.amount || 0),
      reportingAmount: asMoney(entry.reportingAmount || 0)
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const partnerTotals = [...totalsByPartner.values()]
    .map((row) => ({
      partner: row.partner,
      drawAmount: row.drawAmount,
      entryCount: row.entryCount,
      entities: [...row.entities].sort()
    }))
    .sort((a, b) => b.drawAmount - a.drawAmount);

  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to, partner: req.query.partner || null },
    summary: {
      totalDrawAmount: asMoney(partnerTotals.reduce((sum, row) => sum + row.drawAmount, 0)),
      partnerCount: partnerTotals.length,
      entryCount: ledgerRows.length
    },
    partnerTotals,
    ledgerRows: ledgerRows.slice(0, 1000)
  });
});

app.get('/api/reports/management/upwork', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;

  const upworkTransactions = (db.transactions || [])
    .filter((tx) => (!from || String(tx.date || '') >= from) && (!to || String(tx.date || '') <= to))
    .filter((tx) => {
      const text = `${tx.description || ''} ${tx.account || ''}`.toLowerCase();
      return String(tx.channel || '').toUpperCase() === 'UPWORK' || text.includes('upwork');
    })
    .filter((tx) => !req.query.entity || String(tx.entity || '').toUpperCase() === String(req.query.entity).toUpperCase())
    .map((tx) => {
      const absolute = asMoney(Math.abs(Number(tx.amount || 0)));
      const matchedAmount = asMoney(tx.matchedAmount || 0);
      const remainingAmount = asMoney(Math.max(absolute - matchedAmount, 0));
      const sign = String(tx.type || '').toUpperCase() === 'DEBIT' ? -1 : 1;
      const signedNative = asMoney(sign * absolute);
      const signedReporting = toReportingAmount(db, signedNative, tx.currency || 'USD');
      const linkedIds = (Array.isArray(tx.linkedInvoiceIds) && tx.linkedInvoiceIds.length)
        ? tx.linkedInvoiceIds
        : (tx.invoiceId ? [tx.invoiceId] : []);
      const linkedInvoices = linkedIds
        .map((invoiceId) => db.invoices.find((row) => row.id === invoiceId))
        .filter(Boolean)
        .map((inv) => ({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          lineOfService: inv.lineOfService || getInvoiceLineOfService(db, inv) || null,
          currency: inv.currency,
          total: inv.total,
          outstanding: asMoney(Math.max(Number(inv.total || 0) - Number(inv.amountPaid || 0), 0))
        }));
      return {
        id: tx.id,
        date: tx.date,
        entity: tx.entity || inferEntityFromTransaction({ account: tx.account, currency: tx.currency, sourceSystem: tx.source }) || null,
        account: tx.account,
        description: tx.description,
        category: tx.category,
        currency: tx.currency || 'USD',
        amount: signedNative,
        reportingAmount: signedReporting,
        matchedAmount,
        remainingAmount,
        lineOfService: tx.lineOfService || null,
        linkedInvoices
      };
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  let receipts = 0;
  let fees = 0;
  let unmatchedReceipts = 0;
  const losMap = new Map();
  const touchedInvoices = new Map();
  for (const row of upworkTransactions) {
    const isFee = String(row.category || '').toLowerCase().includes('fee') || row.reportingAmount < 0;
    if (isFee) fees = asMoney(fees + Math.abs(row.reportingAmount));
    else receipts = asMoney(receipts + row.reportingAmount);
    if (!isFee) {
      unmatchedReceipts = asMoney(unmatchedReceipts + toReportingAmount(db, row.remainingAmount, row.currency));
    }

    const lineBuckets = row.linkedInvoices.length
      ? [...new Set(row.linkedInvoices.map((inv) => inv.lineOfService || 'UNSPECIFIED'))]
      : [row.lineOfService || 'UNSPECIFIED'];

    for (const los of lineBuckets) {
      if (!losMap.has(los)) losMap.set(los, { lineOfService: los, reportingAmount: 0, receipts: 0, fees: 0 });
      const bucket = losMap.get(los);
      bucket.reportingAmount = asMoney(bucket.reportingAmount + row.reportingAmount);
      if (isFee) bucket.fees = asMoney(bucket.fees + Math.abs(row.reportingAmount));
      else bucket.receipts = asMoney(bucket.receipts + row.reportingAmount);
    }

    for (const invoice of row.linkedInvoices) touchedInvoices.set(invoice.invoiceId, invoice);
  }

  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to, entity: req.query.entity || null },
    summary: {
      transactionCount: upworkTransactions.length,
      receipts,
      fees,
      net: asMoney(receipts - fees),
      unmatchedReceipts
    },
    byLineOfService: [...losMap.values()].sort((a, b) => Math.abs(b.reportingAmount) - Math.abs(a.reportingAmount)),
    linkedInvoices: [...touchedInvoices.values()].sort((a, b) => String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || ''))),
    transactions: upworkTransactions.slice(0, 1000)
  });
});

app.get('/api/reports/qbo/revenue-by-los', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const onlyPaid = parseBool(req.query.onlyPaid, false);

  let rows = (db.invoices || []).filter((invoice) => Boolean(invoice.qboInvoiceId));
  rows = rows.filter((invoice) => (!from || String(invoice.issueDate || '') >= from) && (!to || String(invoice.issueDate || '') <= to));
  if (req.query.entity) rows = rows.filter((invoice) => String(invoice.entity || '').toUpperCase() === String(req.query.entity).toUpperCase());
  if (onlyPaid) rows = rows.filter((invoice) => String(invoice.status || '').toUpperCase() === 'PAID');

  const grouped = new Map();
  let totalRevenue = 0;
  let totalCollected = 0;
  let untaggedRevenue = 0;
  let untaggedCount = 0;

  for (const invoice of rows) {
    const los = invoice.lineOfService ? String(invoice.lineOfService).toUpperCase() : 'UNTAGGED';
    const entity = invoice.entity || inferEntityFromCurrency(db, invoice.currency) || 'US';
    const revenue = asMoney(invoice.total || 0);
    const collected = asMoney(invoice.amountPaid || 0);
    const reportingRevenue = toReportingAmount(db, revenue, invoice.currency || 'USD');
    const reportingCollected = toReportingAmount(db, collected, invoice.currency || 'USD');
    const key = `${entity}::${los}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        entity,
        lineOfService: los,
        invoiceCount: 0,
        revenue: 0,
        collected: 0,
        openAr: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.invoiceCount += 1;
    bucket.revenue = asMoney(bucket.revenue + reportingRevenue);
    bucket.collected = asMoney(bucket.collected + reportingCollected);
    bucket.openAr = asMoney(bucket.openAr + Math.max(reportingRevenue - reportingCollected, 0));

    totalRevenue = asMoney(totalRevenue + reportingRevenue);
    totalCollected = asMoney(totalCollected + reportingCollected);
    if (los === 'UNTAGGED') {
      untaggedRevenue = asMoney(untaggedRevenue + reportingRevenue);
      untaggedCount += 1;
    }
  }

  const byEntityLos = [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
  const byLos = summarizeBy(
    byEntityLos.map((row) => ({
      category: 'Revenue',
      reportingAmount: row.revenue,
      lineOfService: row.lineOfService
    })),
    (row) => row.lineOfService
  ).map((row) => ({
    lineOfService: row.key,
    revenue: row.revenue
  }));

  return res.json({
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    filters: { fromDate: from, toDate: to, entity: req.query.entity || null, onlyPaid },
    summary: {
      invoiceCount: rows.length,
      totalRevenue,
      totalCollected,
      openAr: asMoney(totalRevenue - totalCollected),
      untaggedCount,
      untaggedRevenue
    },
    byLineOfService: byLos,
    byEntityLineOfService: byEntityLos
  });
});

app.get('/api/reports/pl', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const entity = req.query.entity || null;
  const statement = buildProfitAndLoss(db, { fromDate: from, toDate: to, entity });
  return res.json({
    ...statement,
    qboAdjustments: {
      enabled: true,
      rowsUsed: 0
    },
    accountingSource: 'POSTED_JOURNALS'
  });
});

app.get('/api/reports/cash-flow', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const from = req.query.fromDate ? String(req.query.fromDate) : null;
  const to = req.query.toDate ? String(req.query.toDate) : null;
  const includeQboTransactions = String(req.query.includeQboTransactions || 'true').toLowerCase() !== 'false';

  const payments = db.payments.filter((row) => (!from || row.paidAt >= from) && (!to || row.paidAt <= to));
  const baseReceipts = asMoney(payments.reduce((sum, row) => sum + Number(row.amount || 0), 0));

  const expenses = db.expenses.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  const expenseOutflows = asMoney(expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0));

  const payrollRuns = db.payrollRuns.filter((row) => {
    const period = `${row.year}-${String(row.month).padStart(2, '0')}-01`;
    return (!from || period >= from) && (!to || period <= to);
  });
  const payrollOutflows = asMoney(payrollRuns.reduce((sum, row) => sum + Number(row.totalNet || 0), 0));

  const partnerDraws = db.partnerDraws.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  const partnerDrawOutflows = asMoney(partnerDraws.reduce((sum, row) => sum + Number(row.amount || 0), 0));

  const qboAdjustments = includeQboTransactions
    ? buildQboTransactionAdjustments(db, { fromDate: from, toDate: to })
    : { rowCount: 0, revenueRecognized: 0, operatingExpenses: 0, payrollCost: 0, cashInflows: 0, cashOutflows: 0 };

  const receipts = asMoney(baseReceipts + qboAdjustments.cashInflows);
  const qboCashOutflows = asMoney(qboAdjustments.cashOutflows);

  const opening = asMoney(Number(req.query.opening || 0));
  const totalOutflows = asMoney(expenseOutflows + payrollOutflows + partnerDrawOutflows + qboCashOutflows);
  const netMovement = asMoney(receipts - totalOutflows);
  const closing = asMoney(opening + netMovement);

  return res.json({
    period: { fromDate: from, toDate: to },
    openingBalance: opening,
    inflows: {
      clientReceipts: baseReceipts,
      qboImportedInflows: qboAdjustments.cashInflows,
      totalInflows: receipts
    },
    outflows: {
      expenses: expenseOutflows,
      payroll: payrollOutflows,
      partnerDraws: partnerDrawOutflows,
      qboImportedOutflows: qboCashOutflows,
      totalOutflows
    },
    qboAdjustments: {
      enabled: includeQboTransactions,
      rowsUsed: qboAdjustments.rowCount
    },
    netMovement,
    closingBalance: closing
  });
});

app.get('/api/reports/cashflow', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  return res.redirect(307, '/api/reports/cash-flow');
});

app.get('/api/reports/balance-sheet', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  return res.json(buildBalanceSheet(db, {
    asOfDate: req.query.asOfDate ? String(req.query.asOfDate) : (req.query.toDate ? String(req.query.toDate) : null),
    entity: req.query.entity || null
  }));
});

app.get('/api/reports/pk-tax', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  return res.json(buildPkTaxSummary(db, {
    fromDate: req.query.fromDate ? String(req.query.fromDate) : null,
    toDate: req.query.toDate ? String(req.query.toDate) : null,
    entity: req.query.entity ? String(req.query.entity) : 'PK'
  }));
});

app.get('/api/reports/ar-aging', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER, role.VIEWER]), (req, res) => {
  const db = readDb();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 };
  const today = Date.now();

  for (const invoice of db.invoices) {
    const outstanding = Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0);
    if (outstanding <= 0) continue;
    const dueTs = invoice.dueDate ? new Date(invoice.dueDate).getTime() : today;
    const daysPastDue = Math.floor((today - dueTs) / 86400000);
    if (daysPastDue <= 0) buckets.current += outstanding;
    else if (daysPastDue <= 30) buckets.d1_30 += outstanding;
    else if (daysPastDue <= 60) buckets.d31_60 += outstanding;
    else buckets.d61_plus += outstanding;
  }

  for (const key of Object.keys(buckets)) {
    buckets[key] = asMoney(buckets[key]);
  }

  return res.json({ buckets });
});

app.get('/api/reports/utilisation', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT, role.PARTNER]), (req, res) => {
  const db = readDb();
  const rows = db.projects.map((project) => {
    const entries = db.timeEntries.filter((entry) => entry.projectId === project.id);
    const pm = getUser(db, project.projectManagerId);
    const totalHours = asMoney(entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0));
    const billableHours = asMoney(entries.filter((entry) => entry.billable).reduce((sum, entry) => sum + Number(entry.hours || 0), 0));
    const budgetHours = project.hourlyRate ? asMoney(Number(project.budgetAmount || 0) / Number(project.hourlyRate || 1)) : 0;
    const utilizationPct = budgetHours > 0 ? asMoney((billableHours / budgetHours) * 100) : null;

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      projectManager: pm?.name || project.projectManagerId,
      totalHours,
      billableHours,
      budgetHours,
      utilizationPct
    };
  });
  return res.json({ utilisation: rows });
});

app.get('/api/dashboard/kpis', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const totalProjects = db.projects.length;
  const activeProjects = db.projects.filter((row) => row.status === 'ACTIVE').length;
  const pendingApprovals = db.invoices.filter((row) => row.status === 'PENDING_APPROVAL').length;
  const overdueInvoices = db.invoices.filter((row) => row.status === 'OVERDUE').length;
  const openAr = asMoney(db.invoices.reduce((sum, row) => sum + Math.max(Number(row.total || 0) - Number(row.amountPaid || 0), 0), 0));
  const monthHours = db.timeEntries
    .filter((entry) => String(entry.date).slice(0, 7) === toDateKey(Date.now()).slice(0, 7))
    .reduce((sum, row) => sum + Number(row.hours || 0), 0);

  return res.json({
    kpis: {
      totalProjects,
      activeProjects,
      pendingApprovals,
      overdueInvoices,
      openAr,
      monthHours: asMoney(monthHours)
    }
  });
});

app.get('/api/dashboard/pm', requireAuth, requireRole([role.PROJECT_MANAGER, role.ADMIN, role.ACCOUNTANT]), (req, res) => {
  const db = readDb();
  const user = getUser(db, req.user.sub);
  const projects = db.projects.filter((project) => user.role !== role.PROJECT_MANAGER || project.projectManagerId === user.id);
  const projectIds = new Set(projects.map((row) => row.id));
  const entries = db.timeEntries.filter((entry) => projectIds.has(entry.projectId));
  const invoices = db.invoices.filter((invoice) => projectIds.has(invoice.projectId));
  const monthPrefix = toDateKey(Date.now()).slice(0, 7);

  return res.json({
    summary: {
      myProjects: projects.length,
      myInvoices: invoices.length,
      myHoursThisMonth: asMoney(entries.filter((entry) => String(entry.date).startsWith(monthPrefix)).reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      myUnbilledHours: asMoney(entries.filter((entry) => entry.billable && !entry.invoiceId).reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      invoiceStatus: invoices.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {}),
      projects
    }
  });
});

app.get('/api/approvals/queue', requireAuth, requireRole(financeReadRoles), (req, res) => {
  const db = readDb();
  return res.json(buildApprovalsQueuePayload(db, req.user));
});

app.get('/api/finance/bootstrap', requireAuth, requireRole(billingReadRoles), (req, res) => {
  const db = readDb();
  const financeFilter = (row) => financeRecordVisibleToUser(req.user, row?.entity);
  return res.json({
    users: db.users.map((row) => safeUser(row)),
    clients: db.clients,
    vendors: (db.vendors || []).filter(financeFilter),
    accounts: (db.accounts || []).filter(financeFilter),
    categories: db.categories || [],
    classificationRules: db.classificationRules || [],
    projects: db.projects,
    vendorBills: (db.vendorBills || []).filter(financeFilter).map((row) => hydrateVendorBill(db, row)),
    expenses: (db.expenses || []).filter(financeFilter),
    partnerDraws: db.partnerDraws || [],
    intercompanyEntries: (db.intercompanyEntries || []).filter((row) => financeRecordVisibleToUser(req.user, row?.fromEntity) || financeRecordVisibleToUser(req.user, row?.toEntity)),
    asarTowerCosts: db.asarTowerCosts || [],
    ponchoSettlements: db.ponchoSettlements || [],
    payrollRuns: db.payrollRuns || [],
    payrollItems: db.payrollItems || [],
    openingBalances: db.openingBalances || [],
    closePeriods: db.closePeriods || [],
    managementAdjustments: db.managementAdjustments || [],
    qboTransactions: (db.transactions || []).filter((row) => String(row.source || '').toUpperCase().startsWith('QBO')).filter(financeFilter).slice(-1000),
    settings: db.settings,
    persistence: db.metadata?.persistence || { mode: 'json', domains: [] },
    qbo: getQboStatus()
  });
});

app.get('/api/admin/audit-log', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT]), (req, res) => {
  const db = readDb();
  return res.json({ events: (db.auditLog || []).slice().reverse().slice(0, 500) });
});

app.get('/api/admin/notifications', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT]), (req, res) => {
  const db = readDb();
  return res.json({ notifications: (db.notificationQueue || []).slice().reverse().slice(0, 500) });
});

app.post('/api/admin/notifications/process', requireAuth, requireRole([role.ADMIN, role.ACCOUNTANT]), async (_req, res) => {
  const db = readDb();
  const result = await sendQueuedNotifications(db);
  writeDb(db);
  return res.json({ result });
});

app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.resolve(publicDir, 'index.html'));
});

let backgroundPoller = null;
let activeServer = null;

export function bootstrapServerState() {
  initStore();
  withDb((db) => {
    syncAllWorkflowPostings(db, null);
    return db;
  });
}

function startBackgroundJobs() {
  if (backgroundPoller) return backgroundPoller;
  backgroundPoller = setInterval(async () => {
    try {
      await pollOpenInvoicesAndSync();
    } catch {
      // background job best-effort
    }
  }, 4 * 60 * 60 * 1000);
  return backgroundPoller;
}

function stopBackgroundJobs() {
  if (!backgroundPoller) return;
  clearInterval(backgroundPoller);
  backgroundPoller = null;
}

export function startServer({ port = PORT, host = HOST } = {}) {
  bootstrapServerState();
  startBackgroundJobs();
  if (activeServer) return activeServer;
  activeServer = app.listen(port, host, () => {
    const effectivePort = activeServer?.address()?.port || port;
    const effectiveBaseUrl = process.env.APP_BASE_URL || `http://${host}:${effectivePort}`;
    console.log(`telerelation-finance running on ${effectiveBaseUrl}`);
  });
  activeServer.on('close', () => {
    stopBackgroundJobs();
    activeServer = null;
  });
  return activeServer;
}

export { app };

if (process.env.TR_DISABLE_AUTOSTART !== 'true') {
  startServer();
}
