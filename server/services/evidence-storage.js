import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { evidenceDir } from '../store.js';

function ensureBaseDir(baseDir) {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
}

function normalizeStoredFileName(value) {
  const cleaned = String(value || 'attachment.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'attachment.bin';
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveLocalPath(record, baseDir = evidenceDir) {
  if (record.storagePath) return record.storagePath;
  const storageKey = record.storageKey || record.storedFileName || (record.storagePath ? path.basename(record.storagePath) : null);
  if (!storageKey) return null;
  return path.resolve(baseDir, storageKey);
}

export function normalizeEvidenceStorageMetadata(record, { baseDir = evidenceDir } = {}) {
  const storageProvider = String(record.storageProvider || 'local').toLowerCase();
  const storageKey = record.storageKey || record.storedFileName || (record.storagePath ? path.basename(record.storagePath) : null);
  const storagePath = record.storagePath || (storageProvider === 'local' && storageKey ? path.resolve(baseDir, storageKey) : null);
  return {
    ...record,
    storageProvider,
    storageKey,
    storagePath,
    checksumSha256: record.checksumSha256 || null,
    originalExtension: record.originalExtension || path.extname(record.fileName || record.storedFileName || '') || null
  };
}

export function storeEvidenceBlob({ evidenceId, fileName, buffer, baseDir = evidenceDir } = {}) {
  ensureBaseDir(baseDir);
  const storedFileName = `${evidenceId}-${normalizeStoredFileName(fileName)}`;
  const absolutePath = path.resolve(baseDir, storedFileName);
  fs.writeFileSync(absolutePath, buffer);
  return {
    storageProvider: 'local',
    storageKey: storedFileName,
    storedFileName,
    storagePath: absolutePath,
    checksumSha256: checksum(buffer),
    originalExtension: path.extname(fileName || '') || null
  };
}

export function getEvidenceStorageDescriptor(record, { baseDir = evidenceDir } = {}) {
  const normalized = normalizeEvidenceStorageMetadata(record, { baseDir });
  if (normalized.storageProvider !== 'local') {
    throw new Error(`Evidence storage provider ${normalized.storageProvider} is not supported by this environment.`);
  }
  const filePath = resolveLocalPath(normalized, baseDir);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Evidence file is missing from storage.');
  }
  return {
    record: normalized,
    filePath,
    stream: fs.createReadStream(filePath)
  };
}
