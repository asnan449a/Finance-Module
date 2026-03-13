import { listJournals, listJournalsBySource, listJournalsBySourceRoot } from '../repositories/journalRepository.js';
import { asMoney, normalizeCurrency, normalizeEntity } from './fx.js';
import { calculateJournalMagnitude, upsertSystemJournalFromSource } from './journals.js';
import { hydrateIntercompanyEntry } from './intercompany.js';
import { buildRelatedPartyCloseReconciliation, createHistoricalCleanupJournal, generateIntercompanyEliminationJournals } from './related-party-close.js';

const WORKFLOW_ROOT = {
  INVOICE: 'INVOICE',
  VENDOR_BILL: 'VENDOR_BILL',
  EXPENSE: 'EXPENSE',
  INTERCOMPANY: 'INTERCOMPANY'
};

const ISSUE_SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
};

function sourceKey(sourceType, sourceId) {
  return `${String(sourceType || '').toUpperCase()}:${String(sourceId || '')}`;
}

function systemJournalIsActive(journal) {
  const status = String(journal?.status || '').toUpperCase();
  if (String(journal?.journalType || '').toUpperCase() !== 'SYSTEM') return false;
  if (status === 'VOID' || status === 'REVERSED') return false;
  if (journal?.reversedByJournalId) return false;
  return true;
}

function issue({
  code,
  severity,
  sourceRootType,
  sourceRootId,
  sourceType = null,
  sourceId = null,
  journalId = null,
  message,
  amount = null
}) {
  return {
    code,
    severity,
    sourceRootType,
    sourceRootId,
    sourceType,
    sourceId,
    journalId,
    message,
    amount: amount == null ? null : asMoney(amount)
  };
}

function invoicePayments(db, invoiceId) {
  return (db.payments || []).filter((row) => row.invoiceId === invoiceId);
}

function vendorPaymentRows(bill) {
  return Array.isArray(bill?.payments) ? bill.payments : [];
}

function approvalStatusForVendorBill(bill) {
  if (bill?.approvalStatus) return String(bill.approvalStatus || '').toUpperCase();
  const status = String(bill?.status || '').toUpperCase();
  if (status === 'REJECTED') return 'REJECTED';
  if (['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE', 'PAID'].includes(status)) return 'APPROVED';
  return 'PENDING';
}

function invoiceContracts(db, invoice) {
  if (!invoice) return [];
  const operationalStatus = String(invoice.status || 'DRAFT').toUpperCase();
  const approvalStatus = String(invoice.approvalStatus || (operationalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING')).toUpperCase();
  const shouldPostRevenue = ['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(operationalStatus);
  const contracts = [{
    label: `Invoice ${invoice.invoiceNumber || invoice.id}`,
    sourceType: 'INVOICE',
    sourceId: invoice.id,
    sourceRootType: WORKFLOW_ROOT.INVOICE,
    sourceRootId: invoice.id,
    sourceStage: 'REVENUE_RECOGNITION',
    shouldPost: shouldPostRevenue,
    expectedAmount: asMoney(invoice.total || 0),
    postingDate: invoice.issueDate || null,
    currency: normalizeCurrency(invoice.currency || db.settings?.reportingCurrency || 'USD'),
    entity: normalizeEntity(invoice.entity) || null,
    operationalStatus,
    approvalStatus
  }];
  for (const payment of invoicePayments(db, invoice.id)) {
    const paymentApprovalStatus = String(payment.approvalStatus || (payment.source === 'MANUAL' ? 'PENDING' : 'AUTO_APPROVED')).toUpperCase();
    contracts.push({
      label: `Receipt ${payment.reference || payment.id}`,
      sourceType: 'INVOICE_PAYMENT',
      sourceId: payment.id,
      sourceRootType: WORKFLOW_ROOT.INVOICE,
      sourceRootId: invoice.id,
      sourceStage: 'CASH_APPLICATION',
      shouldPost: ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(paymentApprovalStatus),
      expectedAmount: asMoney(payment.amount || 0),
      postingDate: payment.paidAt || null,
      currency: normalizeCurrency(payment.currency || invoice.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(invoice.entity) || null,
      operationalStatus: String(payment.status || 'PAID').toUpperCase(),
      approvalStatus: paymentApprovalStatus
    });
  }
  return contracts;
}

function vendorBillContracts(db, bill) {
  if (!bill) return [];
  const operationalStatus = String(bill.status || 'DRAFT').toUpperCase();
  const approvalStatus = approvalStatusForVendorBill(bill);
  const shouldPostBill = ['APPROVED', 'OPEN', 'PARTIAL', 'OVERDUE', 'PAID'].includes(operationalStatus);
  const contracts = [{
    label: `Vendor bill ${bill.billNumber || bill.id}`,
    sourceType: 'VENDOR_BILL',
    sourceId: bill.id,
    sourceRootType: WORKFLOW_ROOT.VENDOR_BILL,
    sourceRootId: bill.id,
    sourceStage: 'OBLIGATION_RECOGNITION',
    shouldPost: shouldPostBill,
    expectedAmount: asMoney(bill.total || 0),
    postingDate: bill.billDate || null,
    currency: normalizeCurrency(bill.currency || db.settings?.reportingCurrency || 'USD'),
    entity: normalizeEntity(bill.entity) || null,
    operationalStatus,
    approvalStatus
  }];
  for (const payment of vendorPaymentRows(bill)) {
    const paymentApprovalStatus = String(payment.approvalStatus || 'PENDING').toUpperCase();
    contracts.push({
      label: `Vendor payment ${payment.reference || payment.id}`,
      sourceType: 'VENDOR_PAYMENT',
      sourceId: payment.id,
      sourceRootType: WORKFLOW_ROOT.VENDOR_BILL,
      sourceRootId: bill.id,
      sourceStage: 'SETTLEMENT',
      shouldPost: ['APPROVED', 'AUTO_APPROVED', 'POSTED'].includes(paymentApprovalStatus),
      expectedAmount: asMoney(payment.amount || 0),
      postingDate: payment.date || null,
      currency: normalizeCurrency(payment.currency || bill.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(bill.entity) || null,
      operationalStatus: 'PAID',
      approvalStatus: paymentApprovalStatus
    });
  }
  return contracts;
}

function expenseContracts(db, expense) {
  if (!expense) return [];
  const operationalStatus = String(expense.status || 'PAID').toUpperCase();
  const reimbursementStatus = String(expense.reimbursementStatus || (expense.reimbursementNeeded ? 'PENDING' : 'NOT_APPLICABLE')).toUpperCase();
  const contracts = [{
    label: `Expense ${expense.description || expense.id}`,
    sourceType: 'EXPENSE',
    sourceId: expense.id,
    sourceRootType: WORKFLOW_ROOT.EXPENSE,
    sourceRootId: expense.id,
    sourceStage: 'RECOGNITION',
    shouldPost: Number(expense.amount || 0) > 0,
    expectedAmount: asMoney(expense.amount || 0),
    postingDate: expense.date || null,
    currency: normalizeCurrency(expense.currency || db.settings?.reportingCurrency || 'USD'),
    entity: normalizeEntity(expense.entity) || null,
    operationalStatus,
    approvalStatus: 'NOT_REQUIRED'
  }];
  contracts.push({
    label: `Reimbursement ${expense.id}`,
    sourceType: 'REIMBURSEMENT',
    sourceId: expense.id,
    sourceRootType: WORKFLOW_ROOT.EXPENSE,
    sourceRootId: expense.id,
    sourceStage: 'SETTLEMENT',
    shouldPost: reimbursementStatus === 'REIMBURSED',
    expectedAmount: asMoney(expense.amount || 0),
    postingDate: expense.reimbursedAt || expense.date || null,
    currency: normalizeCurrency(expense.currency || db.settings?.reportingCurrency || 'USD'),
    entity: normalizeEntity(expense.entity) || null,
    operationalStatus: reimbursementStatus,
    approvalStatus: 'NOT_REQUIRED'
  });
  return contracts;
}

function intercompanyContracts(db, entry) {
  const hydrated = hydrateIntercompanyEntry(entry);
  if (!hydrated) return [];
  const contracts = [
    {
      label: `Funding out ${hydrated.reference || hydrated.id}`,
      sourceType: 'INTERCOMPANY_FUNDING_OUT',
      sourceId: hydrated.id,
      sourceRootType: WORKFLOW_ROOT.INTERCOMPANY,
      sourceRootId: hydrated.id,
      sourceStage: 'FUNDING_OUT',
      shouldPost: Number(hydrated.amount || 0) > 0,
      expectedAmount: asMoney(hydrated.amount || 0),
      postingDate: hydrated.date || null,
      currency: normalizeCurrency(hydrated.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(hydrated.fromEntity) || null,
      operationalStatus: String(hydrated.status || 'OPEN').toUpperCase(),
      approvalStatus: 'AUTO_APPROVED'
    },
    {
      label: `Funding in ${hydrated.reference || hydrated.id}`,
      sourceType: 'INTERCOMPANY_FUNDING_IN',
      sourceId: hydrated.id,
      sourceRootType: WORKFLOW_ROOT.INTERCOMPANY,
      sourceRootId: hydrated.id,
      sourceStage: 'FUNDING_IN',
      shouldPost: Number(hydrated.amount || 0) > 0,
      expectedAmount: asMoney(hydrated.amount || 0),
      postingDate: hydrated.date || null,
      currency: normalizeCurrency(hydrated.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(hydrated.toEntity) || null,
      operationalStatus: String(hydrated.status || 'OPEN').toUpperCase(),
      approvalStatus: 'AUTO_APPROVED'
    }
  ];
  for (const repayment of hydrated.repaymentEvents || []) {
    contracts.push({
      label: `Repayment out ${repayment.reference || repayment.id}`,
      sourceType: 'INTERCOMPANY_REPAYMENT_OUT',
      sourceId: repayment.id,
      sourceRootType: WORKFLOW_ROOT.INTERCOMPANY,
      sourceRootId: hydrated.id,
      sourceStage: 'REPAYMENT_OUT',
      shouldPost: Number(repayment.amount || 0) > 0,
      expectedAmount: asMoney(repayment.amount || 0),
      postingDate: repayment.date || null,
      currency: normalizeCurrency(repayment.currency || hydrated.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(hydrated.toEntity) || null,
      operationalStatus: 'POSTED',
      approvalStatus: 'AUTO_APPROVED'
    });
    contracts.push({
      label: `Repayment in ${repayment.reference || repayment.id}`,
      sourceType: 'INTERCOMPANY_REPAYMENT_IN',
      sourceId: repayment.id,
      sourceRootType: WORKFLOW_ROOT.INTERCOMPANY,
      sourceRootId: hydrated.id,
      sourceStage: 'REPAYMENT_IN',
      shouldPost: Number(repayment.amount || 0) > 0,
      expectedAmount: asMoney(repayment.amount || 0),
      postingDate: repayment.date || null,
      currency: normalizeCurrency(repayment.currency || hydrated.currency || db.settings?.reportingCurrency || 'USD'),
      entity: normalizeEntity(hydrated.fromEntity) || null,
      operationalStatus: 'POSTED',
      approvalStatus: 'AUTO_APPROVED'
    });
  }
  return contracts;
}

export function buildPostingContractsForRoot(db, { sourceRootType, sourceRootId }) {
  const rootType = String(sourceRootType || '').toUpperCase();
  if (rootType === WORKFLOW_ROOT.INVOICE) {
    return invoiceContracts(db, (db.invoices || []).find((row) => row.id === sourceRootId));
  }
  if (rootType === WORKFLOW_ROOT.VENDOR_BILL) {
    return vendorBillContracts(db, (db.vendorBills || []).find((row) => row.id === sourceRootId));
  }
  if (rootType === WORKFLOW_ROOT.EXPENSE) {
    return expenseContracts(db, (db.expenses || []).find((row) => row.id === sourceRootId));
  }
  if (rootType === WORKFLOW_ROOT.INTERCOMPANY) {
    return intercompanyContracts(db, (db.intercompanyEntries || []).find((row) => row.id === sourceRootId));
  }
  return [];
}

function rootExists(db, sourceRootType, sourceRootId) {
  const rootType = String(sourceRootType || '').toUpperCase();
  if (rootType === WORKFLOW_ROOT.INVOICE) return (db.invoices || []).some((row) => row.id === sourceRootId);
  if (rootType === WORKFLOW_ROOT.VENDOR_BILL) return (db.vendorBills || []).some((row) => row.id === sourceRootId);
  if (rootType === WORKFLOW_ROOT.EXPENSE) return (db.expenses || []).some((row) => row.id === sourceRootId);
  if (rootType === WORKFLOW_ROOT.INTERCOMPANY) return (db.intercompanyEntries || []).some((row) => row.id === sourceRootId);
  return true;
}

function managedSourceExists(db, sourceType, sourceId) {
  const type = String(sourceType || '').toUpperCase();
  if (type === 'INVOICE') return (db.invoices || []).some((row) => row.id === sourceId);
  if (type === 'INVOICE_PAYMENT') return (db.payments || []).some((row) => row.id === sourceId);
  if (type === 'VENDOR_BILL') return (db.vendorBills || []).some((row) => row.id === sourceId);
  if (type === 'VENDOR_PAYMENT') {
    return (db.vendorBills || []).some((bill) => vendorPaymentRows(bill).some((payment) => payment.id === sourceId));
  }
  if (type === 'EXPENSE' || type === 'REIMBURSEMENT') return (db.expenses || []).some((row) => row.id === sourceId);
  if (type === 'INTERCOMPANY_FUNDING_OUT' || type === 'INTERCOMPANY_FUNDING_IN') return (db.intercompanyEntries || []).some((row) => row.id === sourceId);
  if (type === 'INTERCOMPANY_REPAYMENT_OUT' || type === 'INTERCOMPANY_REPAYMENT_IN') {
    return (db.intercompanyEntries || []).some((row) => (row.repaymentEvents || []).some((event) => event.id === sourceId));
  }
  return true;
}

function deriveAccountingStatus({ expectedCount, missingCount, issueCount, postedCount }) {
  if (issueCount > 0) return 'ATTENTION_REQUIRED';
  if (expectedCount <= 0) return 'NOT_REQUIRED';
  if (postedCount <= 0) return 'PENDING_POSTING';
  if (missingCount > 0 || postedCount < expectedCount) return 'PARTIAL';
  return 'POSTED';
}

export function getSourceAccountingSnapshot(db, { sourceRootType, sourceRootId }) {
  const contracts = buildPostingContractsForRoot(db, { sourceRootType, sourceRootId });
  const lineage = listJournalsBySourceRoot(db, { sourceRootType, sourceRootId });
  const activeSystem = lineage.filter((journal) => systemJournalIsActive(journal));
  const byKey = new Map();
  for (const journal of activeSystem) {
    const key = sourceKey(journal.sourceType, journal.sourceId);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(journal);
  }

  const issues = [];
  const postings = contracts.map((contract) => {
    const key = sourceKey(contract.sourceType, contract.sourceId);
    const matches = byKey.get(key) || [];
    const primary = matches[0] || null;
    const contractIssues = [];
    if (contract.shouldPost && !matches.length) {
      contractIssues.push(issue({
        code: 'MISSING_EXPECTED_JOURNAL',
        severity: ISSUE_SEVERITY.CRITICAL,
        sourceRootType,
        sourceRootId,
        sourceType: contract.sourceType,
        sourceId: contract.sourceId,
        message: `${contract.label} is missing its expected journal.`,
        amount: contract.expectedAmount
      }));
    }
    if (matches.length > 1) {
      contractIssues.push(issue({
        code: 'DUPLICATE_SYSTEM_JOURNAL',
        severity: ISSUE_SEVERITY.CRITICAL,
        sourceRootType,
        sourceRootId,
        sourceType: contract.sourceType,
        sourceId: contract.sourceId,
        journalId: primary?.id || null,
        message: `${contract.label} has duplicate active system journals.`,
        amount: contract.expectedAmount
      }));
    }
    if (!contract.shouldPost && matches.length) {
      contractIssues.push(issue({
        code: 'STALE_SYSTEM_JOURNAL',
        severity: ISSUE_SEVERITY.WARNING,
        sourceRootType,
        sourceRootId,
        sourceType: contract.sourceType,
        sourceId: contract.sourceId,
        journalId: primary?.id || null,
        message: `${contract.label} is not expected to post in its current state, but an active system journal remains.`,
        amount: contract.expectedAmount
      }));
    }
    const actualAmount = primary ? calculateJournalMagnitude(primary) : 0;
    if (contract.shouldPost && primary && Math.abs(Number(actualAmount || 0) - Number(contract.expectedAmount || 0)) > 0.01) {
      contractIssues.push(issue({
        code: 'SOURCE_JOURNAL_AMOUNT_MISMATCH',
        severity: ISSUE_SEVERITY.CRITICAL,
        sourceRootType,
        sourceRootId,
        sourceType: contract.sourceType,
        sourceId: contract.sourceId,
        journalId: primary.id,
        message: `${contract.label} journal amount does not match the source record.`,
        amount: actualAmount
      }));
    }
    issues.push(...contractIssues);
    return {
      ...contract,
      postingKey: sourceKey(contract.sourceType, contract.sourceId),
      journalId: primary?.id || null,
      journalNumber: primary?.journalNumber || null,
      journalStatus: primary?.status || null,
      journalCount: matches.length,
      actualAmount: asMoney(actualAmount || 0),
      accountingStatus: contractIssues.length
        ? 'ATTENTION_REQUIRED'
        : contract.shouldPost
          ? (primary ? 'POSTED' : 'PENDING_POSTING')
          : (primary ? 'STALE' : 'NOT_REQUIRED'),
      issues: contractIssues
    };
  });

  const expectedKeys = new Set(postings.map((row) => row.postingKey));
  for (const journal of activeSystem) {
    const key = sourceKey(journal.sourceType, journal.sourceId);
    if (expectedKeys.has(key)) continue;
    issues.push(issue({
      code: 'ORPHAN_SYSTEM_JOURNAL',
      severity: ISSUE_SEVERITY.CRITICAL,
      sourceRootType,
      sourceRootId,
      sourceType: journal.sourceType,
      sourceId: journal.sourceId,
      journalId: journal.id,
      message: `System journal ${journal.journalNumber || journal.id} is active but no current workflow contract owns it.`,
      amount: calculateJournalMagnitude(journal)
    }));
  }

  const expectedCount = postings.filter((row) => row.shouldPost).length;
  const missingCount = postings.filter((row) => row.shouldPost && !row.journalId).length;
  const postedCount = postings.filter((row) => row.shouldPost && row.journalId && row.issues.length === 0).length;
  if (String(sourceRootType || '').toUpperCase() === WORKFLOW_ROOT.INTERCOMPANY) {
    const entry = hydrateIntercompanyEntry((db.intercompanyEntries || []).find((row) => row.id === sourceRootId));
    if (entry) {
      const eventRepaidAmount = asMoney((entry.repaymentEvents || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
      if (Math.abs(Number(entry.repaidAmount || 0) - Number(eventRepaidAmount || 0)) > 0.01) {
        issues.push(issue({
          code: 'INTERCOMPANY_REPAYMENT_LINEAGE_GAP',
          severity: ISSUE_SEVERITY.CRITICAL,
          sourceRootType,
          sourceRootId,
          sourceType: 'INTERCOMPANY',
          sourceId: sourceRootId,
          message: 'Intercompany repayment status does not reconcile to explicit repayment events and journals.',
          amount: asMoney(Number(entry.repaidAmount || 0) - Number(eventRepaidAmount || 0))
        }));
      }
    }
  }
  return {
    sourceRootType,
    sourceRootId,
    accountingStatus: deriveAccountingStatus({
      expectedCount,
      missingCount,
      issueCount: issues.length,
      postedCount
    }),
    expectedCount,
    postedCount,
    missingCount,
    issueCount: issues.length,
    postings,
    issues,
    journalCount: activeSystem.length
  };
}

export function syncSystemSourcePosting(db, { sourceType, sourceId, actorUserId = null }) {
  return upsertSystemJournalFromSource(db, { sourceType, sourceId, actorUserId });
}

export function syncSourceRootPostings(db, { sourceRootType, sourceRootId, actorUserId = null }) {
  const contracts = buildPostingContractsForRoot(db, { sourceRootType, sourceRootId });
  for (const contract of contracts) {
    syncSystemSourcePosting(db, {
      sourceType: contract.sourceType,
      sourceId: contract.sourceId,
      actorUserId
    });
  }
  return getSourceAccountingSnapshot(db, { sourceRootType, sourceRootId });
}

export function syncAllWorkflowPostings(db, actorUserId = null) {
  for (const invoice of db.invoices || []) {
    syncSourceRootPostings(db, { sourceRootType: WORKFLOW_ROOT.INVOICE, sourceRootId: invoice.id, actorUserId });
  }
  for (const bill of db.vendorBills || []) {
    syncSourceRootPostings(db, { sourceRootType: WORKFLOW_ROOT.VENDOR_BILL, sourceRootId: bill.id, actorUserId });
  }
  for (const expense of db.expenses || []) {
    syncSourceRootPostings(db, { sourceRootType: WORKFLOW_ROOT.EXPENSE, sourceRootId: expense.id, actorUserId });
  }
  for (const entry of db.intercompanyEntries || []) {
    syncSourceRootPostings(db, { sourceRootType: WORKFLOW_ROOT.INTERCOMPANY, sourceRootId: entry.id, actorUserId });
  }
  for (const draw of db.partnerDraws || []) {
    syncSystemSourcePosting(db, { sourceType: 'PARTNER_DRAW', sourceId: draw.id, actorUserId });
  }
  for (const cost of db.asarTowerCosts || []) {
    syncSystemSourcePosting(db, { sourceType: 'ASAR_COST', sourceId: cost.id, actorUserId });
  }
  for (const run of db.payrollRuns || []) {
    syncSystemSourcePosting(db, { sourceType: 'PAYROLL_RUN', sourceId: run.id, actorUserId });
  }
  for (const settlement of db.ponchoSettlements || []) {
    syncSystemSourcePosting(db, { sourceType: 'PONCHO_SETTLEMENT', sourceId: settlement.id, actorUserId });
  }
}

function mostRelevantClosePeriodKey(db) {
  const explicit = (db.closePeriods || [])
    .map((row) => row.periodKey)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)));
  if (explicit.length) return explicit[0];
  return new Date().toISOString().slice(0, 7);
}

export function buildAccountingIntegrityReport(db, { limit = 100, includeClose = true } = {}) {
  const rootSnapshots = [];
  for (const invoice of db.invoices || []) {
    rootSnapshots.push({
      rootType: WORKFLOW_ROOT.INVOICE,
      rootId: invoice.id,
      label: invoice.invoiceNumber || invoice.id,
      snapshot: getSourceAccountingSnapshot(db, { sourceRootType: WORKFLOW_ROOT.INVOICE, sourceRootId: invoice.id })
    });
  }
  for (const bill of db.vendorBills || []) {
    rootSnapshots.push({
      rootType: WORKFLOW_ROOT.VENDOR_BILL,
      rootId: bill.id,
      label: bill.billNumber || bill.id,
      snapshot: getSourceAccountingSnapshot(db, { sourceRootType: WORKFLOW_ROOT.VENDOR_BILL, sourceRootId: bill.id })
    });
  }
  for (const expense of db.expenses || []) {
    rootSnapshots.push({
      rootType: WORKFLOW_ROOT.EXPENSE,
      rootId: expense.id,
      label: expense.description || expense.id,
      snapshot: getSourceAccountingSnapshot(db, { sourceRootType: WORKFLOW_ROOT.EXPENSE, sourceRootId: expense.id })
    });
  }
  for (const entry of db.intercompanyEntries || []) {
    rootSnapshots.push({
      rootType: WORKFLOW_ROOT.INTERCOMPANY,
      rootId: entry.id,
      label: entry.reference || entry.id,
      snapshot: getSourceAccountingSnapshot(db, { sourceRootType: WORKFLOW_ROOT.INTERCOMPANY, sourceRootId: entry.id })
    });
  }

  const issues = [];
  for (const root of rootSnapshots) {
    for (const row of root.snapshot.issues || []) {
      issues.push({
        ...row,
        rootLabel: root.label,
        accountingStatus: root.snapshot.accountingStatus
      });
    }
  }

  for (const journal of listJournals(db, { journalType: 'SYSTEM', excludeStatuses: ['VOID'] })) {
    if (!systemJournalIsActive(journal)) continue;
    if (!rootExists(db, journal.sourceRootType, journal.sourceRootId)) {
      issues.push(issue({
        code: 'ORPHAN_SOURCE_ROOT_JOURNAL',
        severity: ISSUE_SEVERITY.CRITICAL,
        sourceRootType: journal.sourceRootType,
        sourceRootId: journal.sourceRootId,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        journalId: journal.id,
        message: `System journal ${journal.journalNumber || journal.id} points to a root record that no longer exists.`,
        amount: calculateJournalMagnitude(journal)
      }));
    }
    if (!managedSourceExists(db, journal.sourceType, journal.sourceId)) {
      issues.push(issue({
        code: 'ORPHAN_SOURCE_EVENT_JOURNAL',
        severity: ISSUE_SEVERITY.CRITICAL,
        sourceRootType: journal.sourceRootType,
        sourceRootId: journal.sourceRootId,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        journalId: journal.id,
        message: `System journal ${journal.journalNumber || journal.id} points to a source event that no longer exists.`,
        amount: calculateJournalMagnitude(journal)
      }));
    }
  }

  let relatedParty = null;
  if (includeClose) {
    try {
      relatedParty = buildRelatedPartyCloseReconciliation(db, { periodKey: mostRelevantClosePeriodKey(db) });
      for (const pair of relatedParty.pairs || []) {
        if (!pair.closeBlocker) continue;
        issues.push(issue({
          code: pair.reconciles ? 'STALE_RELATED_PARTY_ELIMINATION' : 'RELATED_PARTY_RECON_MISMATCH',
          severity: pair.reconciles ? ISSUE_SEVERITY.WARNING : ISSUE_SEVERITY.CRITICAL,
          sourceRootType: 'CLOSE_PERIOD',
          sourceRootId: relatedParty.periodKey,
          sourceType: 'RELATED_PARTY_RECON',
          sourceId: pair.pairKey,
          journalId: pair.eliminationJournalId || null,
          message: `${pair.pairLabel} is not close-ready (${pair.eliminationStatus}).`,
          amount: pair.outstandingBalance
        }));
      }
      for (const cleanup of relatedParty.cleanupExceptions || []) {
        issues.push(issue({
          code: 'RELATED_PARTY_CLEANUP_REQUIRED',
          severity: ISSUE_SEVERITY.CRITICAL,
          sourceRootType: 'RELATED_PARTY_RECON',
          sourceRootId: relatedParty.periodKey,
          sourceType: 'RELATED_PARTY_CLEANUP',
          sourceId: cleanup.id,
          journalId: null,
          message: `Historical related-party cleanup is required for ${cleanup.entity || 'UNSCOPED'} ${cleanup.accountCode}.`,
          amount: cleanup.amount
        }));
      }
    } catch {
      relatedParty = null;
    }
  }

  const issueRows = issues
    .sort((a, b) => {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      const left = severityOrder[String(a.severity || '').toUpperCase()] ?? 9;
      const right = severityOrder[String(b.severity || '').toUpperCase()] ?? 9;
      if (left !== right) return left - right;
      return `${a.sourceRootType || ''}:${a.sourceRootId || ''}`.localeCompare(`${b.sourceRootType || ''}:${b.sourceRootId || ''}`);
    })
    .slice(0, Math.max(Number(limit || 100), 0));

  return {
    summary: {
      rootsReviewed: rootSnapshots.length,
      issueCount: issues.length,
      criticalCount: issues.filter((row) => row.severity === ISSUE_SEVERITY.CRITICAL).length,
      warningCount: issues.filter((row) => row.severity === ISSUE_SEVERITY.WARNING).length,
      okRoots: rootSnapshots.filter((row) => row.snapshot.issueCount === 0).length,
      attentionRoots: rootSnapshots.filter((row) => row.snapshot.issueCount > 0).length
    },
    roots: rootSnapshots.map((row) => ({
      rootType: row.rootType,
      rootId: row.rootId,
      label: row.label,
      accountingStatus: row.snapshot.accountingStatus,
      expectedCount: row.snapshot.expectedCount,
      postedCount: row.snapshot.postedCount,
      issueCount: row.snapshot.issueCount
    })),
    issues: issueRows,
    relatedParty
  };
}

export function createCleanupReclassPosting(db, payload) {
  return createHistoricalCleanupJournal(db, payload);
}

export function generateEliminationPostings(db, payload) {
  return generateIntercompanyEliminationJournals(db, payload);
}
