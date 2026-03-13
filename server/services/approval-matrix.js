import { nextId, nowIso, writeDb } from '../store.js';
import { buildDefaultApprovalMatrix, getApprovalMatrix } from './approvals.js';
import {
  getApprovalMatrixVersionById,
  listApprovalMatrixVersionRecords,
  saveApprovalMatrixVersion
} from '../repositories/approvalMatrixVersionRepository.js';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiresControlHardeningUpgrade(version) {
  const rules = Array.isArray(version?.rules) ? version.rules : [];
  const receiptRules = rules.filter((rule) => String(rule?.documentType || '').toUpperCase() === 'CUSTOMER_RECEIPT');
  const vendorPaymentRules = rules.filter((rule) => String(rule?.documentType || '').toUpperCase() === 'VENDOR_PAYMENT');
  const closeRules = rules.filter((rule) => String(rule?.documentType || '').toUpperCase() === 'CLOSE_PERIOD');

  const closeRuleHasEvidence = closeRules.some((rule) => (
    Number(rule?.minEvidenceCount || 0) >= 1
      && Array.isArray(rule?.requiredEvidenceCategories)
      && rule.requiredEvidenceCategories.length > 0
  ));

  return receiptRules.length === 0
    || vendorPaymentRules.length === 0
    || !closeRuleHasEvidence;
}

function autoUpgradeSeededMatrix(db) {
  const activeVersionId = db.settings?.activeApprovalMatrixVersionId || null;
  const activeVersion = getApprovalMatrixVersionById(db, activeVersionId);
  if (!activeVersion) return false;

  const onlySeededVersionExists = listApprovalMatrixVersionRecords(db).length === 1;
  const looksSystemSeeded = !activeVersion.changedByUserId
    && Number(activeVersion.versionNumber || 0) === 1;
  if (!onlySeededVersionExists || !looksSystemSeeded || !requiresControlHardeningUpgrade(activeVersion)) {
    return false;
  }

  const defaultRules = buildDefaultApprovalMatrix().rules;
  const defaultFingerprint = stableStringify(defaultRules);
  const activeFingerprint = stableStringify(activeVersion.rules || []);
  if (activeFingerprint === defaultFingerprint) return false;

  const version = {
    id: nextId(db, 'APPROVAL_MATRIX_VERSION', 'AMV'),
    versionNumber: Math.max(0, ...(db.approvalMatrixVersions || []).map((row) => Number(row.versionNumber || 0))) + 1,
    status: 'ACTIVE',
    effectiveAt: nowIso(),
    changedByUserId: null,
    changeReason: 'Baseline control hardening migration',
    rules: defaultRules,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  saveApprovalMatrixVersion(db, version);
  db.settings.activeApprovalMatrixVersionId = version.id;
  db.settings.approvalMatrix = { rules: defaultRules };
  writeDb(db);
  return true;
}

function ensureApprovalMatrixVersions(db) {
  listApprovalMatrixVersionRecords(db);
  if (!db.settings) db.settings = {};

  if (!listApprovalMatrixVersionRecords(db).length) {
    const seeded = {
      id: 'AMV-0001',
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveAt: nowIso(),
      changedByUserId: null,
      changeReason: 'Seed default approval policy',
      rules: buildDefaultApprovalMatrix().rules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    saveApprovalMatrixVersion(db, seeded);
    db.settings.activeApprovalMatrixVersionId = seeded.id;
    db.settings.approvalMatrix = { rules: seeded.rules };
  }

  if (!db.settings.activeApprovalMatrixVersionId) {
    const latest = [...listApprovalMatrixVersionRecords(db)].sort((left, right) => Number(right.versionNumber || 0) - Number(left.versionNumber || 0))[0];
    db.settings.activeApprovalMatrixVersionId = latest?.id || null;
  }

  autoUpgradeSeededMatrix(db);

  return listApprovalMatrixVersionRecords(db);
}

export function listApprovalMatrixVersions(db) {
  return ensureApprovalMatrixVersions(db)
    .map((row) => ({
      ...row,
      isActive: row.id === db.settings?.activeApprovalMatrixVersionId
    }))
    .sort((left, right) => Number(right.versionNumber || 0) - Number(left.versionNumber || 0));
}

export function getActiveApprovalMatrixVersion(db) {
  const matrix = getApprovalMatrix(db);
  const versions = listApprovalMatrixVersions(db);
  return versions.find((row) => row.id === matrix.id) || null;
}

export function upsertApprovalMatrixVersion(db, {
  rules,
  actorUserId = null,
  reason = ''
} = {}) {
  ensureApprovalMatrixVersions(db);
  const current = getApprovalMatrix(db);
  const normalizedRules = Array.isArray(rules) && rules.length
    ? rules
    : (current.rules || buildDefaultApprovalMatrix().rules);

  const nextFingerprint = stableStringify(normalizedRules);
  const currentFingerprint = stableStringify(current.rules || []);
  if (nextFingerprint === currentFingerprint) {
    const active = getActiveApprovalMatrixVersion(db);
    return {
      version: active,
      changed: false
    };
  }

  const versionNumber = Math.max(0, ...listApprovalMatrixVersionRecords(db).map((row) => Number(row.versionNumber || 0))) + 1;
  const version = {
    id: nextId(db, 'APPROVAL_MATRIX_VERSION', 'AMV'),
    versionNumber,
    status: 'ACTIVE',
    effectiveAt: nowIso(),
    changedByUserId: actorUserId,
    changeReason: reason || 'Approval matrix updated',
    rules: normalizedRules,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  saveApprovalMatrixVersion(db, version);
  db.settings.activeApprovalMatrixVersionId = version.id;
  db.settings.approvalMatrix = { rules: normalizedRules };

  return {
    version,
    changed: true
  };
}
