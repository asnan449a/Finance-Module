import { asMoney, normalizeCurrency, normalizeEntity } from './fx.js';

export const INTERCOMPANY_STATUS = {
  OPEN: 'OPEN',
  PARTIAL_REPAID: 'PARTIAL_REPAID',
  REPAID: 'REPAID'
};

export function normalizeIntercompanyStatus(status) {
  const value = String(status || '').toUpperCase();
  if (['SETTLED', 'CLOSED', 'REPAID'].includes(value)) return INTERCOMPANY_STATUS.REPAID;
  if (['PARTIAL', 'PARTIAL_REPAID'].includes(value)) return INTERCOMPANY_STATUS.PARTIAL_REPAID;
  return INTERCOMPANY_STATUS.OPEN;
}

export function intercompanyRepaidAmount(entry) {
  const eventAmount = (entry?.repaymentEvents || []).reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const explicit = Number(entry?.repaidAmount || 0);
  const normalizedStatus = normalizeIntercompanyStatus(entry?.status);
  const legacySettledAmount = normalizedStatus === INTERCOMPANY_STATUS.REPAID && eventAmount <= 0 && explicit <= 0
    ? Number(entry?.amount || 0)
    : 0;
  return asMoney(Math.max(eventAmount, explicit, legacySettledAmount));
}

export function intercompanyOutstandingAmount(entry) {
  return asMoney(Math.max(Number(entry?.amount || 0) - intercompanyRepaidAmount(entry), 0));
}

export function syncIntercompanyStatus(entry) {
  const outstanding = intercompanyOutstandingAmount(entry);
  const repaid = intercompanyRepaidAmount(entry);
  entry.repaidAmount = repaid;
  if (outstanding <= 0.01) entry.status = INTERCOMPANY_STATUS.REPAID;
  else if (repaid > 0) entry.status = INTERCOMPANY_STATUS.PARTIAL_REPAID;
  else entry.status = INTERCOMPANY_STATUS.OPEN;
  return entry.status;
}

export function buildRepaymentEvent({
  id,
  date,
  amount,
  currency,
  sourceAccountId = null,
  receivingSourceAccountId = null,
  reference = null,
  description = '',
  createdByUserId = null,
  createdAt
}) {
  return {
    id,
    date,
    amount: asMoney(amount || 0),
    currency: normalizeCurrency(currency || 'USD'),
    sourceAccountId,
    receivingSourceAccountId,
    reference,
    description,
    createdByUserId,
    createdAt
  };
}

export function applyRepaymentEvent(entry, repaymentEvent) {
  if (!Array.isArray(entry.repaymentEvents)) entry.repaymentEvents = [];
  entry.repaymentEvents.push(repaymentEvent);
  entry.repaymentDate = repaymentEvent.date;
  entry.repaymentReference = repaymentEvent.reference || entry.repaymentReference || null;
  entry.repaymentSourceAccountId = repaymentEvent.sourceAccountId || entry.repaymentSourceAccountId || null;
  entry.repaymentReceivingAccountId = repaymentEvent.receivingSourceAccountId || entry.repaymentReceivingAccountId || null;
  syncIntercompanyStatus(entry);
  return entry;
}

export function hydrateIntercompanyEntry(entry) {
  const normalized = {
    ...entry,
    fromEntity: normalizeEntity(entry?.fromEntity) || null,
    toEntity: normalizeEntity(entry?.toEntity) || null,
    currency: normalizeCurrency(entry?.currency || 'USD'),
    amount: asMoney(entry?.amount || 0),
    repaymentEvents: Array.isArray(entry?.repaymentEvents) ? [...entry.repaymentEvents].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))) : []
  };
  normalized.repaidAmount = intercompanyRepaidAmount(normalized);
  normalized.outstandingAmount = intercompanyOutstandingAmount(normalized);
  normalized.status = normalizeIntercompanyStatus(normalized.status);
  if (normalized.outstandingAmount <= 0.01) normalized.status = INTERCOMPANY_STATUS.REPAID;
  else if (normalized.repaidAmount > 0) normalized.status = INTERCOMPANY_STATUS.PARTIAL_REPAID;
  return normalized;
}
