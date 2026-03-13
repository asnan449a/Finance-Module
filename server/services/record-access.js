import { role } from '../store.js';

function normalizeEntity(value) {
  const entity = String(value || '').toUpperCase().trim();
  return ['US', 'UK', 'PK'].includes(entity) ? entity : null;
}

function normalizeEntityType(value) {
  return String(value || '').toUpperCase().trim();
}

function getUser(db, userId) {
  return (db.users || []).find((row) => row.id === userId) || null;
}

function getProject(db, projectId) {
  return (db.projects || []).find((row) => row.id === projectId) || null;
}

function getInvoice(db, invoiceId) {
  return (db.invoices || []).find((row) => row.id === invoiceId) || null;
}

function getVendorBill(db, billId) {
  return (db.vendorBills || []).find((row) => row.id === billId) || null;
}

function getExpense(db, expenseId) {
  return (db.expenses || []).find((row) => row.id === expenseId) || null;
}

function getJournal(db, journalId) {
  return (db.journals || []).find((row) => row.id === journalId) || null;
}

function getClosePeriod(db, periodKey) {
  return (db.closePeriods || []).find((row) => row.periodKey === periodKey || row.id === periodKey) || null;
}

function findVendorPayment(db, paymentId) {
  for (const bill of db.vendorBills || []) {
    for (const payment of bill.payments || []) {
      if (String(payment.id || '') === String(paymentId || '')) {
        return { bill, payment };
      }
    }
  }
  return null;
}

function getCustomerReceipt(db, paymentId) {
  return (db.payments || []).find((row) => row.id === paymentId) || null;
}

function isPrivilegedFinanceRole(userRole) {
  return [role.ADMIN, role.ACCOUNTANT, role.PARTNER].includes(String(userRole || '').toUpperCase());
}

function userAllowedEntities(user) {
  const direct = Array.isArray(user?.allowedEntities) ? user.allowedEntities : [];
  return direct.map((value) => normalizeEntity(value)).filter(Boolean);
}

function userHasEntityAccess(user, entity) {
  const normalizedEntity = normalizeEntity(entity);
  if (!normalizedEntity) return true;
  const allowed = userAllowedEntities(user);
  if (!allowed.length) return true;
  return allowed.includes(normalizedEntity);
}

function projectVisibleToUser(db, project, user) {
  if (!project || !user) return false;
  if (isPrivilegedFinanceRole(user.role)) return userHasEntityAccess(user, project.entity);
  if (user.role === role.PROJECT_MANAGER) {
    return project.projectManagerId === user.id && userHasEntityAccess(user, project.entity);
  }
  if (user.role === role.EMPLOYEE) {
    const linked = (db.timeEntries || []).some((entry) => entry.projectId === project.id && entry.userId === user.id);
    return linked && userHasEntityAccess(user, project.entity);
  }
  if (user.role === role.VIEWER) return userHasEntityAccess(user, project.entity);
  return false;
}

function invoiceVisibleToUser(db, invoice, user) {
  if (!invoice || !user) return false;
  if (isPrivilegedFinanceRole(user.role)) return userHasEntityAccess(user, invoice.entity);
  const project = getProject(db, invoice.projectId);
  if (user.role === role.PROJECT_MANAGER) {
    return project?.projectManagerId === user.id && userHasEntityAccess(user, invoice.entity);
  }
  if (user.role === role.EMPLOYEE) {
    return invoice.createdByUserId === user.id && userHasEntityAccess(user, invoice.entity);
  }
  if (user.role === role.VIEWER) return userHasEntityAccess(user, invoice.entity);
  return false;
}

function financeRecordVisibleToUser(user, entity) {
  if (!user) return false;
  if (!isPrivilegedFinanceRole(user.role)) return false;
  return userHasEntityAccess(user, entity);
}

function billingEvidenceWriteAllowed(db, user, invoice) {
  if (!user) return false;
  const userRole = String(user.role || '').toUpperCase();
  if ([role.ADMIN, role.ACCOUNTANT].includes(userRole)) return userHasEntityAccess(user, invoice?.entity);
  if (userRole === role.PROJECT_MANAGER) {
    const project = getProject(db, invoice?.projectId);
    return Boolean(project?.projectManagerId === user.id) && userHasEntityAccess(user, invoice?.entity);
  }
  return false;
}

function invoiceProtected(invoice) {
  const status = String(invoice?.status || '').toUpperCase();
  const approvalStatus = String(invoice?.approvalStatus || '').toUpperCase();
  return Boolean(
    invoice?.approvedAt
    || invoice?.sentAt
    || ['APPROVED', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE'].includes(status)
    || ['APPROVED', 'POSTED'].includes(approvalStatus)
  );
}

function vendorBillProtected(bill) {
  const status = String(bill?.status || '').toUpperCase();
  const approvalStatus = String(bill?.approvalStatus || '').toUpperCase();
  return Boolean(
    bill?.approvedAt
    || (Array.isArray(bill?.payments) && bill.payments.length)
    || ['APPROVED', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE'].includes(status)
    || ['APPROVED', 'POSTED'].includes(approvalStatus)
  );
}

function expenseProtected(expense) {
  const approvalStatus = String(expense?.approvalStatus || '').toUpperCase();
  const reimbursementStatus = String(expense?.reimbursementStatus || '').toUpperCase();
  return Boolean(
    expense?.approvedAt
    || expense?.reimbursedAt
    || ['APPROVED', 'POSTED'].includes(approvalStatus)
    || reimbursementStatus === 'REIMBURSED'
  );
}

function journalProtected(journal) {
  const status = String(journal?.status || '').toUpperCase();
  return Boolean(
    journal?.approvedAt
    || journal?.postedAt
    || journal?.reversedAt
    || ['APPROVED', 'POSTED', 'REVERSED'].includes(status)
  );
}

function closePeriodProtected(period) {
  const status = String(period?.status || '').toUpperCase();
  return Boolean(period?.closedAt || period?.reopenedAt || status === 'CLOSED');
}

function paymentProtected(payment) {
  const approvalStatus = String(payment?.approvalStatus || '').toUpperCase();
  const status = String(payment?.status || '').toUpperCase();
  return Boolean(
    payment?.approvedAt
    || payment?.postedAt
    || ['APPROVED', 'AUTO_APPROVED', 'POSTED', 'PAID'].includes(approvalStatus)
    || ['PAID', 'POSTED'].includes(status)
  );
}

export function getLinkedRecordContext(db, { entityType, entityId } = {}) {
  const normalizedEntityType = normalizeEntityType(entityType);
  const id = String(entityId || '');
  if (!normalizedEntityType || !id) return null;

  if (normalizedEntityType === 'INVOICE') {
    const invoice = getInvoice(db, id);
    if (!invoice) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(invoice.entity),
      record: invoice,
      parentRecord: null,
      visibilityScope: 'BILLING',
      protectedState: invoiceProtected(invoice),
      protectedReason: invoiceProtected(invoice) ? 'Invoice has already been approved or issued.' : null
    };
  }

  if (normalizedEntityType === 'CUSTOMER_RECEIPT') {
    const payment = getCustomerReceipt(db, id);
    if (!payment) return null;
    const invoice = getInvoice(db, payment.invoiceId);
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(invoice?.entity),
      record: payment,
      parentRecord: invoice,
      visibilityScope: 'BILLING',
      protectedState: paymentProtected(payment),
      protectedReason: paymentProtected(payment) ? 'Customer receipt is already part of cash application history.' : null
    };
  }

  if (normalizedEntityType === 'VENDOR_BILL') {
    const bill = getVendorBill(db, id);
    if (!bill) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(bill.entity),
      record: bill,
      parentRecord: null,
      visibilityScope: 'FINANCE',
      protectedState: vendorBillProtected(bill),
      protectedReason: vendorBillProtected(bill) ? 'Vendor bill is already approved or settled.' : null
    };
  }

  if (normalizedEntityType === 'VENDOR_PAYMENT') {
    const located = findVendorPayment(db, id);
    if (!located) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(located.bill.entity),
      record: located.payment,
      parentRecord: located.bill,
      visibilityScope: 'FINANCE',
      protectedState: paymentProtected(located.payment),
      protectedReason: paymentProtected(located.payment) ? 'Vendor payment is already part of settlement history.' : null
    };
  }

  if (normalizedEntityType === 'EXPENSE') {
    const expense = getExpense(db, id);
    if (!expense) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(expense.entity),
      record: expense,
      parentRecord: null,
      visibilityScope: 'FINANCE',
      protectedState: expenseProtected(expense),
      protectedReason: expenseProtected(expense) ? 'Expense has already been approved or reimbursed.' : null
    };
  }

  if (normalizedEntityType === 'JOURNAL') {
    const journal = getJournal(db, id);
    if (!journal) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: normalizeEntity(journal.entity),
      record: journal,
      parentRecord: null,
      visibilityScope: 'FINANCE',
      protectedState: journalProtected(journal),
      protectedReason: journalProtected(journal) ? 'Journal is already approved or posted.' : null
    };
  }

  if (normalizedEntityType === 'CLOSE_PERIOD') {
    const period = getClosePeriod(db, id);
    if (!period && !/^\d{4}-\d{2}$/.test(id)) return null;
    return {
      entityType: normalizedEntityType,
      entityId: id,
      entity: null,
      record: period || { periodKey: id, status: 'OPEN', closedAt: null, reopenedAt: null },
      parentRecord: null,
      visibilityScope: 'FINANCE',
      protectedState: closePeriodProtected(period),
      protectedReason: closePeriodProtected(period) ? 'This period has already been part of a close cycle.' : null
    };
  }

  return null;
}

export function canAccessLinkedRecord(user, context, mode = 'read', db = null) {
  if (!user || !context) return false;
  if (context.visibilityScope === 'BILLING') {
    if (context.entityType === 'INVOICE') {
      if (mode === 'write') return billingEvidenceWriteAllowed(db, user, context.record);
      return invoiceVisibleToUser(db, context.record, user);
    }
    if (context.entityType === 'CUSTOMER_RECEIPT') {
      if (!context.parentRecord) return false;
      if (mode === 'write') return [role.ADMIN, role.ACCOUNTANT, role.PARTNER].includes(String(user.role || '').toUpperCase()) && invoiceVisibleToUser(db, context.parentRecord, user);
      return invoiceVisibleToUser(db, context.parentRecord, user);
    }
  }
  if (context.visibilityScope === 'FINANCE') {
    if (mode === 'write' && ![role.ADMIN, role.ACCOUNTANT].includes(String(user.role || '').toUpperCase())) return false;
    return financeRecordVisibleToUser(user, context.entity);
  }
  return false;
}

export function assertEvidenceAccess(db, user, { entityType, entityId, mode = 'read' } = {}) {
  const context = getLinkedRecordContext(db, { entityType, entityId });
  if (!context) throw new Error('Linked finance record not found.');
  if (!canAccessLinkedRecord(user, context, mode, db)) {
    throw new Error('Evidence access denied.');
  }
  return context;
}

export function assertEvidenceMutationAllowed(db, user, { entityType, entityId } = {}) {
  const context = assertEvidenceAccess(db, user, { entityType, entityId, mode: 'write' });
  if (context.protectedState) {
    const protectedReason = context.protectedReason || 'record is already in a protected state.';
    throw new Error(`Evidence is locked: ${protectedReason}`);
  }
  return context;
}

export function buildEvidenceControlState(db, { entityType, entityId } = {}) {
  const context = getLinkedRecordContext(db, { entityType, entityId });
  if (!context) return null;
  return {
    entityType: context.entityType,
    entityId: context.entityId,
    protectedState: Boolean(context.protectedState),
    protectedReason: context.protectedReason || null,
    supersedeAllowed: !context.protectedState,
    removalAllowed: !context.protectedState
  };
}
