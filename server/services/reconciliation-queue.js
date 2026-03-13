function asMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function nowIso() {
  return new Date().toISOString();
}

function toDateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function ageDays(value) {
  const dateKey = toDateKey(value);
  if (!dateKey) return 0;
  const stamp = new Date(`${dateKey}T00:00:00Z`).getTime();
  return Math.max(Math.floor((Date.now() - stamp) / 86400000), 0);
}

function daysUntil(value) {
  const dateKey = toDateKey(value);
  if (!dateKey) return null;
  const stamp = new Date(`${dateKey}T00:00:00Z`).getTime();
  return Math.floor((stamp - Date.now()) / 86400000);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displaySubject(tx) {
  return tx.description || tx.counterparty || tx.account || tx.reference || tx.id;
}

function findSourceAccount(db, sourceAccountId) {
  return (db.accounts || []).find((row) => String(row.id) === String(sourceAccountId)) || null;
}

function findUser(db, userId) {
  if (!userId) return null;
  return (db.users || []).find((row) => String(row.id) === String(userId)) || null;
}

function normalizeReviewTrail(tx) {
  if (!Array.isArray(tx.reconciliationReviewTrail)) tx.reconciliationReviewTrail = [];
  return tx.reconciliationReviewTrail;
}

function defaultCategoryForDecision(decision) {
  const normalized = String(decision || '').toUpperCase();
  if (normalized === 'NEEDS_REMITTANCE') return 'REMITTANCE';
  if (normalized === 'IGNORE_DUPLICATE') return 'DUPLICATE';
  if (normalized === 'DEFERRED') return 'DEFERRED';
  if (normalized === 'FOLLOW_UP_REQUIRED') return 'CUSTOMER_FOLLOW_UP';
  if (normalized === 'REVIEWED_PENDING') return 'ALLOCATION_REVIEW';
  return 'EXCEPTION';
}

function reviewStatusForDecision(decision, tx) {
  const normalized = String(decision || '').toUpperCase();
  if (normalized === 'IGNORE_DUPLICATE') return 'RESOLVED';
  if (normalized === 'NEEDS_REMITTANCE') return 'FOLLOW_UP_REQUIRED';
  if (normalized === 'FOLLOW_UP_REQUIRED') return 'FOLLOW_UP_REQUIRED';
  if (normalized === 'DEFERRED') return 'DEFERRED';
  if (normalized === 'REVIEWED_PENDING') return 'REVIEWED_PENDING';
  if (normalized === 'CLEAR_REVIEW') return tx?.reconciled ? 'RESOLVED' : 'OPEN';
  return 'OPEN';
}

function appendReviewTrail(tx, entry) {
  const trail = normalizeReviewTrail(tx);
  trail.push({
    id: `${Date.now()}-${trail.length + 1}`,
    createdAt: nowIso(),
    ...entry
  });
  tx.reconciliationReviewTrail = trail.slice(-25);
}

export function clearReconciliationReview(tx, actor, action = 'CLEAR_REVIEW') {
  tx.reconciliationDecision = null;
  tx.reconciliationReviewStatus = tx.reconciled ? 'RESOLVED' : 'OPEN';
  tx.reconciliationReviewNote = null;
  tx.reconciliationCategory = null;
  tx.reconciliationDeferredUntil = null;
  tx.reconciliationFollowUpOwnerUserId = null;
  tx.reconciliationReviewedAt = nowIso();
  tx.reconciliationReviewedByUserId = actor?.sub || null;
  appendReviewTrail(tx, {
    action,
    actorUserId: actor?.sub || null,
    actorRole: actor?.role || null,
    note: null,
    category: null,
    deferredUntil: null,
    followUpOwnerUserId: null
  });
}

export function applyReconciliationReviewDecision(tx, payload = {}, actor = null) {
  const decision = String(payload.decision || '').toUpperCase();
  const note = String(payload.note || '').trim() || null;
  const category = String(payload.category || defaultCategoryForDecision(decision)).toUpperCase();
  const deferredUntil = toDateKey(payload.deferredUntil);
  const followUpOwnerUserId = payload.followUpOwnerUserId || actor?.sub || null;

  if (decision === 'CLEAR_REVIEW') {
    clearReconciliationReview(tx, actor, 'CLEAR_REVIEW');
    tx.updatedAt = nowIso();
    return tx;
  }

  tx.reconciliationDecision = decision;
  tx.reconciliationReviewStatus = reviewStatusForDecision(decision, tx);
  tx.reconciliationReviewNote = note;
  tx.reconciliationCategory = category || null;
  tx.reconciliationDeferredUntil = tx.reconciliationReviewStatus === 'DEFERRED' ? deferredUntil : null;
  tx.reconciliationFollowUpOwnerUserId = ['FOLLOW_UP_REQUIRED', 'DEFERRED', 'NEEDS_REMITTANCE', 'REVIEWED_PENDING', 'FLAG_EXCEPTION'].includes(decision)
    ? followUpOwnerUserId
    : null;
  tx.reconciliationReviewedAt = nowIso();
  tx.reconciliationReviewedByUserId = actor?.sub || null;
  appendReviewTrail(tx, {
    action: decision,
    actorUserId: actor?.sub || null,
    actorRole: actor?.role || null,
    note,
    category,
    deferredUntil: tx.reconciliationDeferredUntil,
    followUpOwnerUserId: tx.reconciliationFollowUpOwnerUserId
  });
  tx.updatedAt = nowIso();
  return tx;
}

function buildOpenInvoices(db) {
  return (db.invoices || [])
    .map((invoice) => {
      const outstanding = asMoney(Math.max(Number(invoice.total || 0) - Number(invoice.amountPaid || 0), 0));
      if (outstanding <= 0) return null;
      if (!['APPROVED', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase())) return null;
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        entity: invoice.entity || null,
        clientId: invoice.clientId || null,
        clientName: invoice.clientName || null,
        currency: invoice.currency || 'USD',
        dueDate: invoice.dueDate || null,
        outstanding,
        searchableText: normalizeText(`${invoice.invoiceNumber || ''} ${invoice.clientName || ''} ${invoice.description || ''}`)
      };
    })
    .filter(Boolean);
}

function buildDuplicateMap(transactions = []) {
  const candidates = (transactions || []).filter((tx) => Number(tx.amount || 0) > 0);
  const exactGroups = new Map();
  const fuzzyGroups = new Map();

  for (const tx of candidates) {
    const reference = normalizeText(tx.reference || '');
    const description = normalizeText(tx.description || '');
    const amount = asMoney(Math.abs(Number(tx.amount || 0)));
    const dateKey = toDateKey(tx.date);
    const exactKey = [
      tx.sourceAccountId || 'NO_RAIL',
      tx.currency || 'USD',
      amount,
      dateKey || 'NO_DATE',
      reference || description || 'NO_TEXT'
    ].join('|');
    if (!exactGroups.has(exactKey)) exactGroups.set(exactKey, []);
    exactGroups.get(exactKey).push(tx);

    const fuzzyKey = [
      tx.sourceAccountId || 'NO_RAIL',
      tx.currency || 'USD',
      amount,
      reference || description || 'NO_TEXT'
    ].join('|');
    if (!fuzzyGroups.has(fuzzyKey)) fuzzyGroups.set(fuzzyKey, []);
    fuzzyGroups.get(fuzzyKey).push(tx);
  }

  const duplicateMap = new Map();
  for (const group of exactGroups.values()) {
    if (group.length < 2) continue;
    for (const tx of group) {
      duplicateMap.set(tx.id, group
        .filter((row) => row.id !== tx.id)
        .map((row) => ({
          transactionId: row.id,
          reference: row.reference || row.id,
          date: row.date,
          amount: asMoney(Math.abs(Number(row.amount || 0))),
          reasonCodes: ['EXACT_DUPLICATE']
        })));
    }
  }

  for (const group of fuzzyGroups.values()) {
    if (group.length < 2) continue;
    for (const tx of group) {
      const similar = group
        .filter((row) => row.id !== tx.id)
        .filter((row) => {
          const left = new Date(tx.date || '').getTime();
          const right = new Date(row.date || '').getTime();
          if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
          return Math.abs(left - right) <= 3 * 86400000;
        })
        .map((row) => ({
          transactionId: row.id,
          reference: row.reference || row.id,
          date: row.date,
          amount: asMoney(Math.abs(Number(row.amount || 0))),
          reasonCodes: ['SUSPECT_DUPLICATE']
        }));
      if (!similar.length) continue;
      const existing = duplicateMap.get(tx.id) || [];
      const merged = [...existing];
      for (const candidate of similar) {
        if (!merged.some((row) => row.transactionId === candidate.transactionId)) merged.push(candidate);
      }
      duplicateMap.set(tx.id, merged);
    }
  }

  return duplicateMap;
}

function buildCandidatesForTransaction(tx, openInvoices = []) {
  const remainingAmount = asMoney(tx.remainingAmount != null ? tx.remainingAmount : Math.abs(Number(tx.amount || 0)));
  const referenceText = normalizeText(`${tx.reference || ''} ${tx.description || ''} ${tx.counterparty || ''}`);
  return openInvoices
    .filter((invoice) => String(invoice.currency || '').toUpperCase() === String(tx.currency || '').toUpperCase())
    .filter((invoice) => !tx.entity || !invoice.entity || String(invoice.entity).toUpperCase() === String(tx.entity).toUpperCase())
    .map((invoice) => {
      const diff = asMoney(Math.abs(Number(invoice.outstanding || 0) - remainingAmount));
      let confidence = 40;
      const reasons = [];
      if (diff <= 0.01) {
        confidence += 30;
        reasons.push('Exact amount match');
      } else if (diff <= 1.5) {
        confidence += 20;
        reasons.push('Within tolerance');
      } else if (diff <= Math.max(remainingAmount * 0.1, 25)) {
        confidence += 10;
        reasons.push('Near amount match');
      }
      if (referenceText && referenceText.includes(normalizeText(invoice.invoiceNumber))) {
        confidence += 18;
        reasons.push('Invoice number found in memo');
      }
      if (referenceText && normalizeText(invoice.clientName).length > 3 && referenceText.includes(normalizeText(invoice.clientName))) {
        confidence += 14;
        reasons.push('Client name found in memo');
      }
      if (tx.date && invoice.dueDate) {
        const txStamp = new Date(tx.date).getTime();
        const dueStamp = new Date(invoice.dueDate).getTime();
        if (Number.isFinite(txStamp) && Number.isFinite(dueStamp) && Math.abs(txStamp - dueStamp) <= 45 * 86400000) {
          confidence += 6;
          reasons.push('Timing aligns with due date');
        }
      }
      confidence = Math.min(confidence, 99);
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        dueDate: invoice.dueDate,
        outstanding: invoice.outstanding,
        suggestedAmount: asMoney(Math.min(remainingAmount, Number(invoice.outstanding || 0))),
        diff,
        confidenceScore: confidence,
        confidenceLabel: confidence >= 85 ? 'HIGH' : confidence >= 65 ? 'MEDIUM' : 'LOW',
        reasons
      };
    })
    .sort((a, b) => {
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return a.diff - b.diff;
    })
    .slice(0, 5);
}

function supportSnapshot(tx) {
  const hasReference = Boolean(normalizeText(tx.reference).length);
  const hasDescription = Boolean(normalizeText(tx.description).length);
  const genericDescription = ['payment', 'deposit', 'receipt', 'bank transfer', 'transfer', 'credit'].includes(normalizeText(tx.description));
  const needsRemittance = !hasReference && (!hasDescription || genericDescription);
  return {
    hasReference,
    hasDescription,
    genericDescription,
    needsRemittance,
    supportStatus: needsRemittance ? 'NEEDS_REMITTANCE' : (hasReference || hasDescription ? 'HAS_SUPPORT' : 'MISSING_SUPPORT')
  };
}

function isDeferredActive(item) {
  if (String(item.reconciliationReviewStatus || '').toUpperCase() !== 'DEFERRED') return false;
  if (!item.deferredUntil) return true;
  const days = daysUntil(item.deferredUntil);
  return days == null ? true : days >= 0;
}

function reviewStateFor(item) {
  if (item.remainingAmount <= 0.01) return 'CLEARED';
  if (isDeferredActive(item)) return 'DEFERRED';
  if (String(item.reconciliationDecision || '').toUpperCase() === 'NEEDS_REMITTANCE') return 'NEEDS_REMITTANCE';
  if (String(item.reconciliationReviewStatus || '').toUpperCase() === 'FOLLOW_UP_REQUIRED') return 'FOLLOW_UP_REQUIRED';
  if (String(item.reconciliationReviewStatus || '').toUpperCase() === 'REVIEWED_PENDING') return 'REVIEWED_PENDING';
  if (item.duplicateSuspect) return 'DUPLICATE_REVIEW';
  if (item.flaggedException) return 'EXCEPTION_OPEN';
  if (item.needsRemittance) return 'NEEDS_REMITTANCE';
  if (item.topSuggestion && item.topSuggestion.confidenceScore >= 85) return 'READY_TO_MATCH';
  if (item.topSuggestion) return 'REVIEW_SUGGESTION';
  return 'MANUAL_MATCH';
}

function bucketForItem(item) {
  if (item.reviewState === 'CLEARED') return 'cleared';
  if (item.reviewState === 'DEFERRED') return 'deferred';
  if (item.reviewState === 'DUPLICATE_REVIEW') return 'duplicates';
  if (['NEEDS_REMITTANCE', 'EXCEPTION_OPEN', 'FOLLOW_UP_REQUIRED', 'REVIEWED_PENDING'].includes(item.reviewState)) return 'exceptions';
  if (['READY_TO_MATCH', 'REVIEW_SUGGESTION'].includes(item.reviewState)) return 'suggested';
  return 'unmatched';
}

function nextAction(item) {
  if (item.reviewState === 'CLEARED') return 'Open record';
  if (item.reviewState === 'DEFERRED') return item.deferredUntil ? `Resume ${item.deferredUntil}` : 'Resume later';
  if (item.reviewState === 'READY_TO_MATCH' && item.quickMatchAvailable) return 'Apply best';
  if (item.reviewState === 'DUPLICATE_REVIEW') return item.exactDuplicateSuspect ? 'Ignore duplicate' : 'Review duplicate';
  if (item.reviewState === 'NEEDS_REMITTANCE') return 'Chase remittance';
  if (item.reviewState === 'FOLLOW_UP_REQUIRED') return 'Follow up';
  if (item.reviewState === 'REVIEWED_PENDING') return 'Await response';
  if (item.reviewState === 'EXCEPTION_OPEN') return 'Investigate';
  return 'Match manually';
}

function priorityFor(item) {
  let score = 15;
  if (item.reviewState === 'CLEARED') score = -20;
  else if (item.quickMatchAvailable) score = 100;
  else if (item.reviewState === 'DUPLICATE_REVIEW' && item.exactDuplicateSuspect) score = 88;
  else if (item.reviewState === 'NEEDS_REMITTANCE') score = 72;
  else if (item.reviewState === 'FOLLOW_UP_REQUIRED') score = 68;
  else if (item.reviewState === 'EXCEPTION_OPEN') score = 62;
  else if (item.reviewState === 'REVIEWED_PENDING') score = 55;
  else if (item.reviewState === 'DEFERRED') score = item.deferDue ? 48 : 8;
  else if (item.reviewState === 'REVIEW_SUGGESTION') score = 58;
  else if (item.reviewState === 'MANUAL_MATCH') score = 40;
  score += Math.min(item.ageDays || 0, 14);
  if (item.needsRemittance) score += 4;
  if (item.duplicateSuspect) score += 3;
  if (item.deferDue) score += 14;
  const label = score >= 85 ? 'HIGH' : score >= 55 ? 'MEDIUM' : score >= 20 ? 'LOW' : 'SNOOZED';
  return { priorityScore: score, priorityLabel: label };
}

export function bulkActionLabel(action) {
  const normalized = String(action || '').toUpperCase();
  if (normalized === 'QUICK_MATCH') return 'Apply best match';
  if (normalized === 'IGNORE_DUPLICATE') return 'Ignore exact duplicate';
  if (normalized === 'NEEDS_REMITTANCE') return 'Mark needs remittance';
  if (normalized === 'CLEAR_REVIEW') return 'Clear review state';
  return normalized;
}

export function eligibleForBulkAction(item, action) {
  const normalized = String(action || '').toUpperCase();
  if (normalized === 'QUICK_MATCH') return Boolean(item.quickMatchAvailable);
  if (normalized === 'IGNORE_DUPLICATE') return Boolean(item.duplicateSuspect && item.exactDuplicateSuspect && item.remainingAmount > 0.01);
  if (normalized === 'NEEDS_REMITTANCE') return Boolean(item.remainingAmount > 0.01 && !item.reconciled && !item.needsRemittance);
  if (normalized === 'CLEAR_REVIEW') return Boolean(item.reconciliationDecision || ['FOLLOW_UP_REQUIRED', 'DEFERRED', 'REVIEWED_PENDING'].includes(String(item.reconciliationReviewStatus || '').toUpperCase()));
  return false;
}

export function summarizeBulkEligibility(queue, action, selectedIds = []) {
  const selected = (queue?.items || []).filter((item) => selectedIds.includes(item.transactionId));
  const eligible = selected.filter((item) => eligibleForBulkAction(item, action));
  const ineligible = selected.filter((item) => !eligibleForBulkAction(item, action));
  return {
    action: String(action || '').toUpperCase(),
    label: bulkActionLabel(action),
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    ineligibleCount: ineligible.length,
    eligibleIds: eligible.map((item) => item.transactionId),
    ineligible: ineligible.map((item) => ({
      transactionId: item.transactionId,
      reference: item.reference || item.transactionId,
      reason: item.quickMatchAvailable ? 'Already eligible for safer quick match only.' : item.nextAction || 'Not eligible for this bulk action.'
    }))
  };
}

export function buildReconciliationQueue(db, { transactionIds = null } = {}) {
  const openInvoices = buildOpenInvoices(db);
  const duplicateMap = buildDuplicateMap(db.transactions || []);
  const rows = [];

  for (const tx of db.transactions || []) {
    if (transactionIds && !transactionIds.includes(tx.id)) continue;

    const absoluteAmount = asMoney(Math.abs(Number(tx.amount || 0)));
    const matchedAmount = asMoney(Number(tx.matchedAmount || 0));
    const remainingAmount = asMoney(Math.max(absoluteAmount - matchedAmount, 0));
    const sourceAccount = findSourceAccount(db, tx.sourceAccountId);
    const support = supportSnapshot(tx);
    const duplicateIgnored = String(tx.reconciliationDecision || '').toUpperCase() === 'IGNORE_DUPLICATE';
    const duplicateCandidates = (duplicateMap.get(tx.id) || []).filter(() => !duplicateIgnored);
    const duplicateSuspect = duplicateCandidates.length > 0;
    const exactDuplicateSuspect = duplicateCandidates.some((candidate) => (candidate.reasonCodes || []).includes('EXACT_DUPLICATE'));
    const suggestions = Number(tx.amount || 0) > 0 && remainingAmount > 0.01
      ? buildCandidatesForTransaction({ ...tx, remainingAmount }, openInvoices)
      : [];
    const topSuggestion = suggestions[0] || null;
    const flaggedException = ['FLAG_EXCEPTION', 'FOLLOW_UP_REQUIRED', 'REVIEWED_PENDING'].includes(String(tx.reconciliationDecision || '').toUpperCase());
    const explicitNeedsRemittance = String(tx.reconciliationDecision || '').toUpperCase() === 'NEEDS_REMITTANCE';
    const issueReasons = [];
    if (duplicateSuspect) issueReasons.push(exactDuplicateSuspect ? 'Exact duplicate suspect' : 'Duplicate suspect');
    if (support.needsRemittance || explicitNeedsRemittance) issueReasons.push('Missing remittance or reference support');
    if (!suggestions.length && remainingAmount > 0.01 && Number(tx.amount || 0) > 0) issueReasons.push('No likely invoice candidate');
    if (topSuggestion && topSuggestion.confidenceScore < 65) issueReasons.push('Low confidence suggestion');
    if (flaggedException) issueReasons.push('Flagged for manual exception review');
    if (matchedAmount > 0 && remainingAmount > 0.01) issueReasons.push('Partially matched cash remains open');

    const followUpOwner = findUser(db, tx.reconciliationFollowUpOwnerUserId);
    const reviewedBy = findUser(db, tx.reconciliationReviewedByUserId);
    const deferredUntil = toDateKey(tx.reconciliationDeferredUntil);
    const deferDays = daysUntil(deferredUntil);
    const deferDue = deferDays != null ? deferDays <= 0 : false;
    const reviewTrail = [...(tx.reconciliationReviewTrail || [])]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 8);

    const item = {
      id: tx.id,
      transactionId: tx.id,
      drawerRef: `transaction:${tx.id}`,
      reference: tx.reference || tx.id,
      subject: displaySubject(tx),
      counterparty: tx.counterparty || sourceAccount?.name || tx.account || null,
      entity: tx.entity || sourceAccount?.entity || null,
      currency: tx.currency || sourceAccount?.currency || 'USD',
      amount: absoluteAmount,
      matchedAmount,
      remainingAmount,
      date: tx.date,
      ageDays: ageDays(tx.date),
      railId: sourceAccount?.id || tx.sourceAccountId || null,
      railName: sourceAccount?.name || tx.account || 'Unassigned rail',
      railRole: sourceAccount?.accountRole || null,
      source: tx.source || null,
      description: tx.description || '',
      supportStatus: support.supportStatus,
      hasReference: support.hasReference,
      hasDescription: support.hasDescription,
      needsRemittance: support.needsRemittance || explicitNeedsRemittance,
      duplicateSuspect,
      exactDuplicateSuspect,
      duplicateCandidates,
      suggestionCount: suggestions.length,
      topSuggestion,
      suggestions,
      issueReasons,
      issueCount: issueReasons.length,
      flaggedException,
      reconciled: Boolean(tx.reconciled) || remainingAmount <= 0.01,
      reconciliationDecision: tx.reconciliationDecision || null,
      reconciliationReviewStatus: tx.reconciliationReviewStatus || 'OPEN',
      reconciliationReviewNote: tx.reconciliationReviewNote || null,
      followUpCategory: tx.reconciliationCategory || null,
      followUpOwnerUserId: tx.reconciliationFollowUpOwnerUserId || null,
      followUpOwnerName: followUpOwner?.name || null,
      deferredUntil,
      deferDays,
      deferDue,
      deferSortKey: deferDays == null ? 99999 : deferDays,
      reviewedAt: tx.reconciliationReviewedAt || null,
      reviewedByUserId: tx.reconciliationReviewedByUserId || null,
      reviewedByName: reviewedBy?.name || null,
      reviewTrail,
      followUpTrailCount: reviewTrail.length
    };

    item.reviewState = reviewStateFor(item);
    item.queueBucket = bucketForItem(item);
    item.confidenceScore = item.topSuggestion?.confidenceScore || 0;
    item.confidenceLabel = item.topSuggestion?.confidenceLabel || (item.reviewState === 'CLEARED' ? 'CLEARED' : 'NONE');
    item.quickMatchAvailable = Boolean(
      item.topSuggestion
      && item.topSuggestion.confidenceScore >= 85
      && !item.duplicateSuspect
      && !item.needsRemittance
      && !item.flaggedException
      && !['DEFERRED', 'FOLLOW_UP_REQUIRED', 'REVIEWED_PENDING', 'EXCEPTION_OPEN'].includes(item.reviewState)
      && item.remainingAmount > 0.01
    );
    const priority = priorityFor(item);
    item.priorityScore = priority.priorityScore;
    item.priorityLabel = priority.priorityLabel;
    item.nextAction = nextAction(item);
    item.safeBulkActions = ['QUICK_MATCH', 'IGNORE_DUPLICATE', 'NEEDS_REMITTANCE', 'CLEAR_REVIEW'].filter((action) => eligibleForBulkAction(item, action));
    rows.push(item);
  }

  const sorted = rows.sort((a, b) => {
    if (Number(b.priorityScore || 0) !== Number(a.priorityScore || 0)) return Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    if (Number(b.quickMatchAvailable || 0) !== Number(a.quickMatchAvailable || 0)) return Number(b.quickMatchAvailable || 0) - Number(a.quickMatchAvailable || 0);
    if (Number(b.issueCount || 0) !== Number(a.issueCount || 0)) return Number(b.issueCount || 0) - Number(a.issueCount || 0);
    if (Number(b.ageDays || 0) !== Number(a.ageDays || 0)) return Number(b.ageDays || 0) - Number(a.ageDays || 0);
    return String(a.reference || '').localeCompare(String(b.reference || ''));
  });

  const summary = {
    total: sorted.length,
    unmatched: sorted.filter((row) => row.queueBucket === 'unmatched').length,
    suggested: sorted.filter((row) => row.queueBucket === 'suggested').length,
    duplicates: sorted.filter((row) => row.queueBucket === 'duplicates').length,
    exceptions: sorted.filter((row) => row.queueBucket === 'exceptions').length,
    deferred: sorted.filter((row) => row.queueBucket === 'deferred').length,
    cleared: sorted.filter((row) => row.queueBucket === 'cleared').length,
    easyWins: sorted.filter((row) => row.quickMatchAvailable).length,
    needsRemittance: sorted.filter((row) => row.reviewState === 'NEEDS_REMITTANCE').length,
    followUpRequired: sorted.filter((row) => row.reviewState === 'FOLLOW_UP_REQUIRED').length,
    reviewedPending: sorted.filter((row) => row.reviewState === 'REVIEWED_PENDING').length,
    exactDuplicateSuspects: sorted.filter((row) => row.exactDuplicateSuspect).length,
    dueDeferred: sorted.filter((row) => row.reviewState === 'DEFERRED' && row.deferDue).length,
    byRail: sorted.reduce((acc, row) => {
      const key = row.railId || 'UNASSIGNED';
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {})
  };

  return { summary, items: sorted };
}

export function buildImportedReconciliationSummary(db, transactionIds = []) {
  const queue = buildReconciliationQueue(db, { transactionIds });
  return {
    imported: transactionIds.length,
    duplicateSuspects: queue.items.filter((row) => row.duplicateSuspect).length,
    suggestedMatches: queue.items.filter((row) => row.suggestionCount > 0).length,
    needsRemittance: queue.items.filter((row) => row.needsRemittance).length,
    manualReview: queue.items.filter((row) => ['MANUAL_MATCH', 'EXCEPTION_OPEN', 'FOLLOW_UP_REQUIRED', 'REVIEWED_PENDING'].includes(row.reviewState)).length
  };
}

export function findQuickMatchCandidate(db, transactionId) {
  const queue = buildReconciliationQueue(db, { transactionIds: [transactionId] });
  const item = queue.items[0] || null;
  if (!item?.quickMatchAvailable || !item.topSuggestion) return null;
  return {
    transactionId: item.transactionId,
    invoiceId: item.topSuggestion.invoiceId,
    amount: item.topSuggestion.suggestedAmount,
    confidenceScore: item.topSuggestion.confidenceScore
  };
}
