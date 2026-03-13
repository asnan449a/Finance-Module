export function buildDefaultApprovalMatrix() {
  return {
    rules: [
      {
        documentType: 'INVOICE',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: [],
        requiredEvidenceCategories: []
      },
      {
        documentType: 'INVOICE',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: [],
        requiredEvidenceCategories: []
      },
      {
        documentType: 'VENDOR_BILL',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT']
      },
      {
        documentType: 'VENDOR_BILL',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['VENDOR_INVOICE', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'US',
        minAmount: 0,
        maxAmount: 1000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'US',
        minAmount: 1000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'UK',
        minAmount: 0,
        maxAmount: 1000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'UK',
        minAmount: 1000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'PK',
        minAmount: 0,
        maxAmount: 250000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'EXPENSE',
        entity: 'PK',
        minAmount: 250000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT']
      },
      {
        documentType: 'CUSTOMER_RECEIPT',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        posterRoles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'CUSTOMER_RECEIPT',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'REMITTANCE', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'VENDOR_PAYMENT',
        entity: '*',
        minAmount: 0,
        maxAmount: 5000,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'VENDOR_PAYMENT',
        entity: '*',
        minAmount: 5000.01,
        maxAmount: null,
        approverRoles: ['ADMIN', 'PARTNER'],
        posterRoles: ['ADMIN', 'PARTNER'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['POST'],
        requiredEvidenceCategories: ['BANK_PROOF', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'REIMBURSEMENT',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['SETTLE'],
        requiredEvidenceCategories: ['RECEIPT', 'SUPPORT', 'PAYMENT_SUPPORT']
      },
      {
        documentType: 'JOURNAL',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: true,
        minEvidenceCount: 0,
        evidenceRequiredActions: [],
        requiredEvidenceCategories: []
      },
      {
        documentType: 'CLOSE_PERIOD',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['APPROVE'],
        requiredEvidenceCategories: ['CLOSE_SUPPORT', 'CLOSE_MEMO']
      },
      {
        documentType: 'REOPEN_PERIOD',
        entity: '*',
        minAmount: 0,
        maxAmount: null,
        approverRoles: ['ADMIN', 'ACCOUNTANT'],
        posterRoles: ['ADMIN', 'ACCOUNTANT'],
        makerChecker: false,
        minEvidenceCount: 1,
        evidenceRequiredActions: ['REOPEN'],
        requiredEvidenceCategories: ['REOPEN_SUPPORT', 'CLOSE_SUPPORT']
      }
    ]
  };
}

function normalizeRule(rule) {
  return {
    documentType: String(rule?.documentType || '').toUpperCase(),
    entity: String(rule?.entity || '*').toUpperCase(),
    minAmount: Number(rule?.minAmount || 0),
    maxAmount: rule?.maxAmount == null || rule.maxAmount === '' ? null : Number(rule.maxAmount),
    approverRoles: Array.isArray(rule?.approverRoles) ? rule.approverRoles.map((role) => String(role).toUpperCase()) : [],
    posterRoles: Array.isArray(rule?.posterRoles) ? rule.posterRoles.map((role) => String(role).toUpperCase()) : [],
    makerChecker: rule?.makerChecker !== false,
    minEvidenceCount: Math.max(Number(rule?.minEvidenceCount || 0), 0),
    evidenceRequiredActions: Array.isArray(rule?.evidenceRequiredActions)
      ? rule.evidenceRequiredActions.map((action) => String(action).toUpperCase())
      : [],
    requiredEvidenceCategories: Array.isArray(rule?.requiredEvidenceCategories)
      ? rule.requiredEvidenceCategories.map((category) => String(category).toUpperCase())
      : []
  };
}

function normalizeApprovalMatrixVersion(version) {
  return {
    id: version?.id || null,
    versionNumber: Number(version?.versionNumber || 1),
    effectiveAt: version?.effectiveAt || null,
    status: String(version?.status || 'ACTIVE').toUpperCase(),
    changedByUserId: version?.changedByUserId || null,
    changeReason: version?.changeReason || '',
    rules: Array.isArray(version?.rules) ? version.rules.map(normalizeRule) : []
  };
}

function currentApprovalMatrixSource(db) {
  const versions = Array.isArray(db?.approvalMatrixVersions) ? db.approvalMatrixVersions : [];
  const activeId = db?.settings?.activeApprovalMatrixVersionId || null;
  const activeVersion = versions.find((row) => row.id === activeId && String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
    || versions
      .filter((row) => String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
      .sort((left, right) => Number(right.versionNumber || 0) - Number(left.versionNumber || 0))[0]
    || null;

  if (activeVersion) return normalizeApprovalMatrixVersion(activeVersion);
  return {
    id: null,
    versionNumber: 1,
    effectiveAt: null,
    status: 'ACTIVE',
    changedByUserId: null,
    changeReason: 'Default policy',
    rules: buildDefaultApprovalMatrix().rules.map(normalizeRule)
  };
}

export function getApprovalMatrix(db) {
  return currentApprovalMatrixSource(db);
}

export function resolveApprovalPolicy(db, { documentType, entity = '*', amount = 0 }) {
  const targetType = String(documentType || '').toUpperCase();
  const targetEntity = String(entity || '*').toUpperCase();
  const numericAmount = Math.abs(Number(amount || 0));
  const matrix = getApprovalMatrix(db);
  const rules = matrix.rules.filter((rule) => {
    if (rule.documentType !== targetType) return false;
    if (!(rule.entity === '*' || rule.entity === targetEntity)) return false;
    if (numericAmount < rule.minAmount) return false;
    if (rule.maxAmount != null && numericAmount > rule.maxAmount) return false;
    return true;
  });
  rules.sort((left, right) => {
    if (left.entity !== right.entity) return left.entity === '*' ? 1 : -1;
    return Number(left.minAmount || 0) - Number(right.minAmount || 0);
  });
  if (!rules[0]) return null;
  return {
    ...rules[0],
    policyVersionId: matrix.id,
    policyVersionNumber: matrix.versionNumber,
    policyEffectiveAt: matrix.effectiveAt
  };
}

export function assertApprovalAction(db, {
  documentType,
  action,
  entity = '*',
  amount = 0,
  actorRole,
  actorUserId = null,
  createdByUserId = null,
  approvedByUserId = null,
  evidenceCount = 0,
  qualifiedEvidenceCount = null
}) {
  const policy = resolveApprovalPolicy(db, { documentType, entity, amount });
  if (!policy) return null;

  const normalizedAction = String(action || '').toUpperCase();
  const role = String(actorRole || '').toUpperCase();
  const rolePool = normalizedAction === 'POST' ? (policy.posterRoles.length ? policy.posterRoles : policy.approverRoles) : policy.approverRoles;

  if (!rolePool.includes(role)) {
    return `Role ${role || 'UNKNOWN'} cannot ${String(action || '').toLowerCase()} ${String(documentType || '').toLowerCase()}.`;
  }

  if (policy.makerChecker && actorUserId && createdByUserId && actorUserId === createdByUserId && ['APPROVE', 'REJECT'].includes(normalizedAction)) {
    return 'Maker-checker control: creator cannot approve or reject their own record.';
  }

  if (
    policy.makerChecker
    && normalizedAction === 'POST'
    && actorUserId
    && createdByUserId
    && actorUserId === createdByUserId
    && (!approvedByUserId || approvedByUserId === actorUserId)
  ) {
    return 'Maker-checker control: creator cannot post their own record without an independent approval.';
  }

  if (
    policy.minEvidenceCount > 0
    && policy.evidenceRequiredActions.includes(normalizedAction)
    && Number(
      Array.isArray(policy.requiredEvidenceCategories) && policy.requiredEvidenceCategories.length
        ? (qualifiedEvidenceCount == null ? evidenceCount : qualifiedEvidenceCount)
        : evidenceCount
    ) < Number(policy.minEvidenceCount || 0)
  ) {
    const evidenceLabel = Array.isArray(policy.requiredEvidenceCategories) && policy.requiredEvidenceCategories.length
      ? `${policy.requiredEvidenceCategories.join(', ')} evidence`
      : 'evidence attachment(s)';
    return `At least ${policy.minEvidenceCount} ${evidenceLabel} are required before ${String(action || '').toLowerCase()} ${String(documentType || '').toLowerCase()}.`;
  }

  return null;
}
