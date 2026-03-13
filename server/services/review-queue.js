const PRIORITY_SCORES = {
  URGENT: 3,
  HIGH: 2,
  NORMAL: 1,
  LOW: 0
};

function toUpper(value) {
  return String(value || '').toUpperCase();
}

function ageDays(dateValue) {
  if (!dateValue) return 0;
  const stamp = new Date(dateValue).getTime();
  if (!Number.isFinite(stamp)) return 0;
  return Math.max(Math.floor((Date.now() - stamp) / 86400000), 0);
}

function evidenceReady(item) {
  if (item.evidenceReady != null) return Boolean(item.evidenceReady);
  const qualified = Number(item.qualifiedEvidenceCount ?? item.evidenceCount ?? 0);
  const required = Number(item.evidenceRequiredCount || 0);
  return qualified >= required;
}

function blocked(item) {
  return Array.isArray(item.blockedReasons) && item.blockedReasons.length > 0;
}

function inferPriority(item) {
  if (item.priority) return toUpper(item.priority);
  const state = toUpper(item.reviewState);
  const isBlocked = blocked(item);
  const itemAge = Number(item.ageDays || 0);
  const amount = Number(item.amount || 0);

  if (isBlocked && ['CLOSE_PERIOD', 'REOPEN_PERIOD'].includes(toUpper(item.documentType))) return 'URGENT';
  if (isBlocked && Number(item.issueCount || 0) > 0) return 'URGENT';
  if (isBlocked && itemAge > 7) return 'HIGH';
  if (state === 'READY_TO_CLOSE') return 'URGENT';
  if (['READY_TO_POST', 'READY_TO_SETTLE'].includes(state) && itemAge > 3) return 'HIGH';
  if (state === 'PENDING_APPROVAL' && itemAge > 3) return 'HIGH';
  if (state === 'READY_TO_RELEASE' && amount > 5000) return 'HIGH';
  if (isBlocked) return 'HIGH';
  if (itemAge > 14) return 'HIGH';
  return 'NORMAL';
}

function normalizeItem(item = {}) {
  const referenceAgeDate =
    item.ageDate ||
    item.referenceDate ||
    item.createdAt ||
    item.postingDate ||
    item.periodDate ||
    item.dueDate;
  const normalizedAgeDays = Number(item.ageDays ?? ageDays(referenceAgeDate));
  const priority = inferPriority({ ...item, ageDays: normalizedAgeDays });
  const ready = evidenceReady(item);
  const isBlocked = blocked(item);
  const documentType = toUpper(item.documentType);
  const queueBucket = String(item.queueBucket || 'other').toLowerCase();
  return {
    ...item,
    documentType,
    queueBucket,
    ageDays: normalizedAgeDays,
    evidenceReady: ready,
    isBlocked,
    priority,
    priorityScore: PRIORITY_SCORES[priority] ?? 0,
    blockedReasons: Array.isArray(item.blockedReasons) ? item.blockedReasons : [],
    approvalStatus: toUpper(item.approvalStatus || 'OPEN'),
    accountingStatus: toUpper(item.accountingStatus || 'UNKNOWN'),
    reviewState: toUpper(item.reviewState || 'ATTENTION_REQUIRED')
  };
}

function compareItems(a, b) {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (b.isBlocked !== a.isBlocked) return Number(b.isBlocked) - Number(a.isBlocked);
  if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
  if (Number(b.amount || 0) !== Number(a.amount || 0)) return Number(b.amount || 0) - Number(a.amount || 0);
  return String(a.reference || a.id || '').localeCompare(String(b.reference || b.id || ''));
}

export function buildReviewQueue(candidates = []) {
  const items = (candidates || []).map(normalizeItem).sort(compareItems);
  const byBucket = {};
  const byDocumentType = {};
  for (const item of items) {
    byBucket[item.queueBucket] = Number(byBucket[item.queueBucket] || 0) + 1;
    byDocumentType[item.documentType] = Number(byDocumentType[item.documentType] || 0) + 1;
  }
  return {
    summary: {
      total: items.length,
      blocked: items.filter((item) => item.isBlocked).length,
      urgent: items.filter((item) => item.priority === 'URGENT').length,
      pendingApproval: items.filter((item) => item.reviewState === 'PENDING_APPROVAL').length,
      readyNow: items.filter((item) => ['READY_TO_SETTLE', 'READY_TO_POST', 'READY_TO_CLOSE', 'READY_TO_RELEASE'].includes(item.reviewState)).length,
      byBucket,
      byDocumentType
    },
    items
  };
}
