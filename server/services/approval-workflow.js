import { nextId, nowIso } from '../store.js';
import { listApprovalEventsByLink, saveApprovalEvent } from '../repositories/approvalEventRepository.js';
import { listEvidenceByLink } from '../repositories/evidenceRepository.js';
import { assertApprovalAction, resolveApprovalPolicy } from './approvals.js';

function normalizeEntityType(entityType) {
  return String(entityType || '').toUpperCase().trim();
}

export function listApprovalHistory(db, { entityType, entityId } = {}) {
  return listApprovalEventsByLink(db, { entityType: normalizeEntityType(entityType), entityId }).map((row) => ({ ...row }));
}

export function evidenceCountForEntity(db, { entityType, entityId } = {}) {
  return evidenceSummaryForEntity(db, { entityType, entityId }).evidenceCount;
}

export function evidenceSummaryForEntity(db, {
  entityType,
  entityId,
  requiredCategories = []
} = {}) {
  const activeRecords = listEvidenceByLink(db, { entityType: normalizeEntityType(entityType), entityId })
    .filter((row) => String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  const normalizedCategories = (requiredCategories || []).map((value) => String(value || '').toUpperCase()).filter(Boolean);
  const qualified = normalizedCategories.length
    ? activeRecords.filter((row) => normalizedCategories.includes(String(row.category || '').toUpperCase()))
    : activeRecords;
  return {
    evidenceCount: activeRecords.length,
    qualifiedEvidenceCount: qualified.length,
    requiredCategories: normalizedCategories
  };
}

export function buildApprovalSnapshot(db, {
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
  const policy = resolveApprovalPolicy(db, { documentType, entity, amount });
  const evidenceSummary = evidenceSummaryForEntity(db, {
    entityType,
    entityId,
    requiredCategories: policy?.requiredEvidenceCategories || []
  });
  const minEvidenceCount = Number(policy?.minEvidenceCount || 0);
  const history = listApprovalHistory(db, { entityType, entityId });
  return {
    documentType: String(documentType || '').toUpperCase(),
    operationalStatus: operationalStatus || null,
    approvalStatus: approvalStatus || null,
    evidenceCount: evidenceSummary.evidenceCount,
    qualifiedEvidenceCount: evidenceSummary.qualifiedEvidenceCount,
    minEvidenceCount,
    requiredEvidenceCategories: policy?.requiredEvidenceCategories || [],
    evidenceSatisfied: evidenceSummary.qualifiedEvidenceCount >= minEvidenceCount,
    policy: policy
      ? {
          versionId: policy.policyVersionId || null,
          versionNumber: policy.policyVersionNumber || null,
          effectiveAt: policy.policyEffectiveAt || null,
          documentType: policy.documentType,
          entity: policy.entity,
          minAmount: policy.minAmount,
          maxAmount: policy.maxAmount,
          approverRoles: policy.approverRoles,
          posterRoles: policy.posterRoles,
          makerChecker: policy.makerChecker,
          minEvidenceCount,
          evidenceRequiredActions: policy.evidenceRequiredActions || [],
          requiredEvidenceCategories: policy.requiredEvidenceCategories || []
        }
      : null,
    history
  };
}

export function assertWorkflowAction(db, {
  documentType,
  entityType,
  entityId,
  action,
  entity = '*',
  amount = 0,
  actorRole,
  actorUserId = null,
  createdByUserId = null,
  approvedByUserId = null,
  pendingEvidence = []
} = {}) {
  const policy = resolveApprovalPolicy(db, { documentType, entity, amount });
  const evidenceSummary = evidenceSummaryForEntity(db, {
    entityType,
    entityId,
    requiredCategories: policy?.requiredEvidenceCategories || []
  });
  const pendingRecords = Array.isArray(pendingEvidence) ? pendingEvidence : [];
  const pendingQualified = (policy?.requiredEvidenceCategories || []).length
    ? pendingRecords.filter((row) => (policy.requiredEvidenceCategories || []).includes(String(row?.category || '').toUpperCase())).length
    : pendingRecords.length;
  return assertApprovalAction(db, {
    documentType,
    action,
    entity,
    amount,
    actorRole,
    actorUserId,
    createdByUserId,
    approvedByUserId,
    evidenceCount: evidenceSummary.evidenceCount + pendingRecords.length,
    qualifiedEvidenceCount: evidenceSummary.qualifiedEvidenceCount + pendingQualified
  });
}

export function recordApprovalEvent(db, {
  documentType,
  entityType,
  entityId,
  action,
  actorUserId = null,
  actorRole = null,
  entity = '*',
  amount = 0,
  note = '',
  metadata = null,
  statusAfter = null
} = {}) {
  const normalizedEntityType = normalizeEntityType(entityType);
  const policy = resolveApprovalPolicy(db, { documentType, entity, amount });
  const evidenceSummary = evidenceSummaryForEntity(db, {
    entityType: normalizedEntityType,
    entityId,
    requiredCategories: policy?.requiredEvidenceCategories || []
  });
  const record = {
    id: nextId(db, 'APPROVAL_EVENT', 'APV'),
    documentType: String(documentType || '').toUpperCase(),
    entityType: normalizedEntityType,
    entityId: String(entityId || ''),
    action: String(action || '').toUpperCase(),
    actorUserId,
    actorRole: String(actorRole || '').toUpperCase() || null,
    note: note || '',
    metadata: metadata || null,
    evidenceCount: evidenceSummary.evidenceCount,
    qualifiedEvidenceCount: evidenceSummary.qualifiedEvidenceCount,
    statusAfter: statusAfter || null,
    policySnapshot: policy
      ? {
          versionId: policy.policyVersionId || null,
          versionNumber: policy.policyVersionNumber || null,
          effectiveAt: policy.policyEffectiveAt || null,
          entity: policy.entity,
          minAmount: policy.minAmount,
          maxAmount: policy.maxAmount,
          approverRoles: policy.approverRoles,
          posterRoles: policy.posterRoles,
          makerChecker: policy.makerChecker,
          minEvidenceCount: policy.minEvidenceCount || 0,
          evidenceRequiredActions: policy.evidenceRequiredActions || [],
          requiredEvidenceCategories: policy.requiredEvidenceCategories || []
        }
      : null,
    createdAt: nowIso()
  };
  saveApprovalEvent(db, record);
  return { ...record };
}
