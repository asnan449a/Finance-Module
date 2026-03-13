import fs from 'node:fs';
import { evidenceDir, nextId, nowIso } from '../store.js';
import { getEvidenceById, listEvidenceByLink, saveEvidence } from '../repositories/evidenceRepository.js';
import { getEvidenceStorageDescriptor, normalizeEvidenceStorageMetadata, storeEvidenceBlob } from './evidence-storage.js';

const ALLOWED_ENTITY_TYPES = new Set(['INVOICE', 'CUSTOMER_RECEIPT', 'VENDOR_BILL', 'VENDOR_PAYMENT', 'EXPENSE', 'JOURNAL', 'CLOSE_PERIOD']);
const DEFAULT_MAX_BYTES = 2.5 * 1024 * 1024;

function normalizeEntityType(entityType) {
  const normalized = String(entityType || '').toUpperCase().trim();
  if (!ALLOWED_ENTITY_TYPES.has(normalized)) {
    throw new Error(`Evidence cannot be linked to ${entityType || 'UNKNOWN'}.`);
  }
  return normalized;
}

function normalizeFileName(value) {
  const cleaned = String(value || 'attachment.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'attachment.bin';
}

function decodeBase64Content(contentBase64) {
  const raw = String(contentBase64 || '').trim();
  if (!raw) throw new Error('Attachment content is required.');
  const payload = raw.includes(',') ? raw.split(',').pop() : raw;
  return Buffer.from(payload, 'base64');
}

function ensureEvidenceDir(baseDir) {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
}

export function listLinkedEvidence(db, { entityType, entityId, includeRemoved = false } = {}) {
  return listEvidenceByLink(db, { entityType: normalizeEntityType(entityType), entityId, includeRemoved })
    .map((row) => ({ ...row }));
}

export function createEvidenceRecord(db, payload, actorUserId, { baseDir = evidenceDir, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const entityType = normalizeEntityType(payload.entityType);
  const entityId = String(payload.entityId || '').trim();
  if (!entityId) throw new Error('entityId is required for evidence uploads.');

  const fileName = normalizeFileName(payload.fileName || 'attachment.bin');
  const mimeType = String(payload.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  const buffer = decodeBase64Content(payload.contentBase64);
  if (!buffer.length) throw new Error('Attachment content is empty.');
  if (buffer.length > maxBytes) throw new Error(`Attachment exceeds ${Math.round(maxBytes / (1024 * 1024) * 10) / 10} MB limit.`);

  ensureEvidenceDir(baseDir);
  const id = nextId(db, 'EVIDENCE', 'EVD');
  const storage = storeEvidenceBlob({ evidenceId: id, fileName, buffer, baseDir });

  let supersededRecord = null;
  if (payload.supersedesEvidenceId) {
    supersededRecord = getEvidenceById(db, payload.supersedesEvidenceId);
    if (!supersededRecord || String(supersededRecord.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      throw new Error('Superseded evidence record was not found.');
    }
    if (
      String(supersededRecord.entityType || '').toUpperCase() !== entityType
      || String(supersededRecord.entityId || '') !== entityId
    ) {
      throw new Error('Replacement evidence must target the same finance record.');
    }
  }

  const record = {
    id,
    entityType,
    entityId,
    fileName,
    mimeType,
    fileSize: buffer.length,
    uploadedByUserId: actorUserId || null,
    uploadedAt: nowIso(),
    note: payload.note || '',
    category: payload.category || 'SUPPORT',
    status: 'ACTIVE',
    supersedesEvidenceId: supersededRecord?.id || null,
    supersededByEvidenceId: null,
    supersededAt: null,
    storageProvider: storage.storageProvider,
    storageKey: storage.storageKey,
    storedFileName: storage.storedFileName,
    storagePath: storage.storagePath,
    checksumSha256: storage.checksumSha256,
    originalExtension: storage.originalExtension,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (supersededRecord) {
    supersededRecord.status = 'SUPERSEDED';
    supersededRecord.supersededAt = nowIso();
    supersededRecord.supersededByEvidenceId = id;
    supersededRecord.updatedAt = nowIso();
    saveEvidence(db, supersededRecord);
  }

  saveEvidence(db, record);
  return { ...record };
}

export function getEvidenceDescriptor(db, evidenceId) {
  const record = getEvidenceById(db, evidenceId);
  if (!record || ['REMOVED', 'MISSING'].includes(String(record.status || 'ACTIVE').toUpperCase())) {
    throw new Error('Evidence not found.');
  }
  return getEvidenceStorageDescriptor(record);
}

export function removeEvidenceRecord(db, evidenceId, actorUserId, note = '') {
  const record = getEvidenceById(db, evidenceId);
  if (!record || String(record.status || 'ACTIVE').toUpperCase() === 'REMOVED') {
    throw new Error('Evidence not found.');
  }
  record.status = 'REMOVED';
  record.removedByUserId = actorUserId || null;
  record.removedAt = nowIso();
  record.removalNote = note || '';
  record.updatedAt = nowIso();
  saveEvidence(db, record);
  return normalizeEvidenceStorageMetadata(record);
}
