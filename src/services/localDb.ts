import Dexie, { Table } from 'dexie';
import { ensureFreshSession, getSupabase } from '../lib/supabase';
import {
  OFFLINE_SYNC_MAX_RETRIES,
  isIdempotentConflictPayload,
  isRecoverableFailedOfflineSyncRecord,
  type OfflineSyncStatus,
  resolveOfflineSyncFailure,
  shouldAttemptOfflineRecord
} from '../utils/offlineSyncResilience';

export interface OfflineRecord {
  id: string;
  entity_id?: string;
  data: any;
  type: 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment' | 'aba' | 'aba_v3' | 'appointment' | 'clinic_state' | 'patient_record' | 'assigned_task';
  sync_status: OfflineSyncStatus;
  last_updated: number;
  retry_count?: number;
  last_attempt_at?: number | null;
  next_retry_at?: number | null;
  last_error?: string | null;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  endpoint: string;
}

interface OfflineRecordStored extends Omit<OfflineRecord, 'data'> {
  data_encrypted: string;
  user_id: string;
}

interface OfflineTombstone {
  key: string;
  user_id: string;
  type: OfflineRecord['type'];
  entity_id: string;
  deleted_at: number;
}

export interface OfflineCacheMeta {
  endpoint: string;
  etag?: string | null;
  last_modified?: string | null;
  last_seen_updated?: number | null;
  snapshot_count?: number | null;
  updated_at: number;
}

export class MyDatabase extends Dexie {
  records!: Table<OfflineRecordStored>;
  cache_records!: Table<OfflineRecordStored>;
  cache_meta!: Table<OfflineCacheMeta>;
  tombstones!: Table<OfflineTombstone>;

  constructor() {
    super('OfflineVertoDB');
    this.version(2).stores({
      records: 'id, type, sync_status, last_updated, [type+last_updated], user_id',
      cache_meta: 'endpoint, updated_at'
    });
    this.version(3).stores({
      records: 'id, type, sync_status, last_updated, [type+last_updated], user_id',
      cache_meta: 'endpoint, updated_at'
    });
    this.version(4).stores({
      records: 'id, type, sync_status, last_updated, [type+last_updated], user_id',
      cache_meta: 'endpoint, updated_at'
    });
    this.version(5).stores({
      records: 'id, entity_id, type, sync_status, last_updated, [type+last_updated], user_id',
      cache_records: 'id, entity_id, type, last_updated, [type+last_updated], user_id',
      cache_meta: 'endpoint, updated_at',
      tombstones: 'key, user_id, type, entity_id, deleted_at'
    }).upgrade(async (transaction) => {
      const records = await transaction.table('records').toArray();
      const syncedRows = records
        .filter((row: any) => row?.sync_status === 'synced')
        .map((row: any) => ({ ...row, entity_id: row?.entity_id || row?.id }));
      if (syncedRows.length > 0) {
        await transaction.table('cache_records').bulkPut(syncedRows);
        await transaction.table('records').bulkDelete(syncedRows.map((row: any) => row.id));
      }
      const unsyncedRows = records.filter((row: any) => row?.sync_status !== 'synced');
      for (const row of unsyncedRows) {
        if (!row?.entity_id) {
          await transaction.table('records').update(row.id, { entity_id: row.id });
        }
      }
    });
  }
}

export const db = new MyDatabase();
export const generateId = () => crypto.randomUUID();

const SESSION_SEED_KEY = 'verto.offline.crypto.seed';
const PERSISTENT_SEED_PREFIX = 'verto.offline.crypto.seed.persisted';
const LOG_BACKUP_PREFIX = 'verto.offline.log.backup';
const SEED_VERSION = 'v1';
const PBKDF2_ITERATIONS = 210_000;
const BASE_SALT = `verto-offline-aes-gcm-${SEED_VERSION}`;
const IV_LENGTH = 12;

let derivedKeyCache: { cacheId: string; key: CryptoKey } | null = null;
let seedInFlight: Promise<void> | null = null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(input: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < input.byteLength; i++) raw += String.fromCharCode(input[i]);
  return btoa(raw);
}

function fromBase64(input: string): Uint8Array {
  const raw = atob(input);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function sha256Base64(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return toBase64(new Uint8Array(hash));
}

function persistentSeedKeyForUser(userId: string) {
  return `${PERSISTENT_SEED_PREFIX}:${userId}:${SEED_VERSION}`;
}

function logBackupKeyForUser(userId: string) {
  return `${LOG_BACKUP_PREFIX}:${userId}`;
}

function readLogBackups(userId: string): Record<string, OfflineRecordStored> {
  try {
    const raw = localStorage.getItem(logBackupKeyForUser(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLogBackups(userId: string, backups: Record<string, OfflineRecordStored>) {
  try {
    localStorage.setItem(logBackupKeyForUser(userId), JSON.stringify(backups));
  } catch (error) {
    console.warn('[offline-cache] failed to persist log backup:', error);
  }
}

function persistLogBackup(row: OfflineRecordStored) {
  if (row.type !== 'log') return;
  const backups = readLogBackups(row.user_id);
  if (row.sync_status === 'pending') {
    backups[row.id] = row;
  } else {
    delete backups[row.id];
  }
  writeLogBackups(row.user_id, backups);
}

function removeLogBackup(userId: string, id: string) {
  const backups = readLogBackups(userId);
  if (!backups[id]) return;
  delete backups[id];
  writeLogBackups(userId, backups);
}

async function ensureSessionSeed() {
  if (seedInFlight) {
    await seedInFlight;
    return;
  }

  seedInFlight = (async () => {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      throw new Error('Sessao ausente para criptografia offline.');
    }

    const persistentKey = persistentSeedKeyForUser(userId);
    const existingPersistent = localStorage.getItem(persistentKey);
    if (existingPersistent) {
      sessionStorage.setItem(SESSION_SEED_KEY, existingPersistent);
      return;
    }

    const existingSession = sessionStorage.getItem(SESSION_SEED_KEY);
    if (existingSession) {
      localStorage.setItem(persistentKey, existingSession);
      return;
    }

    const randomSeedBytes = crypto.getRandomValues(new Uint8Array(32));
    const randomSeed = toBase64(randomSeedBytes);
    const seed = await sha256Base64(`${userId}:${randomSeed}:${SEED_VERSION}`);
    localStorage.setItem(persistentKey, seed);
    sessionStorage.setItem(SESSION_SEED_KEY, seed);
  })();

  try {
    await seedInFlight;
  } finally {
    seedInFlight = null;
  }
}

async function getCurrentUserId(): Promise<string> {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('Usuario nao autenticado para cache criptografado.');
  return userId;
}

async function getCurrentUserIdOrNull(): Promise<string | null> {
  try {
    return await getCurrentUserId();
  } catch {
    return null;
  }
}

async function deriveSessionKey(userId: string): Promise<CryptoKey> {
  await ensureSessionSeed();
  const seed = sessionStorage.getItem(SESSION_SEED_KEY) || localStorage.getItem(persistentSeedKeyForUser(userId));
  if (!seed) throw new Error('Falha ao obter seed criptografica da sessao.');

  const cacheId = `${userId}:${seed}`;
  if (derivedKeyCache?.cacheId === cacheId) return derivedKeyCache.key;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(seed),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(`${BASE_SALT}:${userId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  derivedKeyCache = { cacheId, key };
  return key;
}

async function encryptPayload(userId: string, payload: any): Promise<string> {
  const key = await deriveSessionKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = textEncoder.encode(JSON.stringify(payload ?? {}));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const encryptedBytes = new Uint8Array(encrypted);
  return `${toBase64(iv)}.${toBase64(encryptedBytes)}`;
}

async function decryptPayload(userId: string, encryptedBlob: string): Promise<any | null> {
  try {
    const [ivPart, dataPart] = encryptedBlob.split('.');
    if (!ivPart || !dataPart) return null;
    const iv = fromBase64(ivPart);
    const encryptedBytes = fromBase64(dataPart);
    const key = await deriveSessionKey(userId);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedBytes
    );
    const decoded = textDecoder.decode(decrypted);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function mapStoredToOfflineRecord(row: OfflineRecordStored): Promise<OfflineRecord | null> {
  const decrypted = await decryptPayload(row.user_id, row.data_encrypted);
  if (decrypted == null) return null;
  return {
    id: row.id,
    entity_id: row.entity_id || row.id,
    type: row.type,
    sync_status: row.sync_status,
    last_updated: row.last_updated,
    retry_count: Number((row as any).retry_count || 0),
    last_attempt_at: Number((row as any).last_attempt_at || 0) || null,
    next_retry_at: Number((row as any).next_retry_at || 0) || null,
    last_error: typeof (row as any).last_error === 'string' ? (row as any).last_error : null,
    method: row.method,
    endpoint: row.endpoint,
    data: decrypted
  };
}

function entityIdForRecord(record: Pick<OfflineRecord, 'id' | 'entity_id' | 'data'>): string {
  return String(record.entity_id || record?.data?.id || record.id || '').trim();
}

function tombstoneKey(userId: string, type: OfflineRecord['type'], entityId: string) {
  return `${userId}:${type}:${entityId}`;
}

async function setTombstone(userId: string, type: OfflineRecord['type'], entityId: string) {
  if (!userId || !entityId) return;
  await db.tombstones.put({
    key: tombstoneKey(userId, type, entityId),
    user_id: userId,
    type,
    entity_id: entityId,
    deleted_at: Date.now()
  });
}

async function removeTombstone(userId: string, type: OfflineRecord['type'], entityId: string) {
  if (!userId || !entityId) return;
  await db.tombstones.delete(tombstoneKey(userId, type, entityId));
}

async function isTombstoned(userId: string, type: OfflineRecord['type'], entityId: string) {
  if (!userId || !entityId) return false;
  return Boolean(await db.tombstones.get(tombstoneKey(userId, type, entityId)));
}

export async function saveEncryptedRecord(record: OfflineRecord) {
  const userId = await getCurrentUserIdOrNull();
  if (!userId) return false;
  const entityId = entityIdForRecord(record);
  if (!entityId) return false;
  const dataEncrypted = await encryptPayload(userId, record.data);
  const row: OfflineRecordStored = {
    id: record.id,
    entity_id: entityId,
    data_encrypted: dataEncrypted,
    type: record.type,
    sync_status: record.sync_status,
    last_updated: record.last_updated,
    retry_count: record.retry_count || 0,
    last_attempt_at: record.last_attempt_at || null,
    next_retry_at: record.next_retry_at || null,
    last_error: record.last_error || null,
    method: record.method,
    endpoint: record.endpoint,
    user_id: userId
  };
  if (record.sync_status === 'synced') {
    const cacheRow = { ...row, id: entityId, entity_id: entityId, sync_status: 'synced' as OfflineSyncStatus };
    await db.cache_records.put(cacheRow);
    // A server snapshot can be briefly stale after a confirmed DELETE. Keep any
    // tombstone until an explicit successful create/update mutation removes it.
    await db.records
      .where('entity_id')
      .equals(entityId)
      .and((candidate) => candidate.user_id === userId && candidate.type === record.type && candidate.sync_status === 'synced')
      .delete();
  } else {
    if (record.method === 'DELETE') await setTombstone(userId, record.type, entityId);
    persistLogBackup(row);
    await db.records.put(row);
  }
  return true;
}

function mergeOfflineEntityData(
  type: OfflineRecord['type'],
  base: any,
  next: any,
  method?: OfflineRecord['method']
) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return next;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;

  // patient_record mutations carry a partial clinical payload nested under `payload`.
  // Preserve fields that were not part of the current mutation.
  if (type === 'patient_record') {
    const basePayload = base?.payload && typeof base.payload === 'object' && !Array.isArray(base.payload) ? base.payload : {};
    const nextPayload = next?.payload && typeof next.payload === 'object' && !Array.isArray(next.payload) ? next.payload : {};
    return {
      ...base,
      ...next,
      payload: { ...basePayload, ...nextPayload }
    };
  }

  // clinic_state is persisted as section-level POSTs; those POSTs are patches, not
  // replacements. PATCH mutations for other entities follow the same merge rule.
  if (method === 'PATCH' || type === 'clinic_state') return { ...base, ...next };
  return next;
}

export async function markRecordSyncStatus(
  id: string,
  status: OfflineSyncStatus,
  metadata: Partial<Pick<OfflineRecord, 'retry_count' | 'last_attempt_at' | 'next_retry_at' | 'last_error'>> = {}
) {
  const row = await db.records.get(id);
  if (!row) return;
  // `last_updated` is the mutation's causal-order timestamp. Retry/ACK state
  // transitions must never rewrite it, otherwise a failed older write can appear
  // newer than a later queued write and allow the later mutation to overtake it.
  const nextLastUpdated = Number(row.last_updated || 0) || Date.now();
  const patch = {
    sync_status: status,
    last_updated: nextLastUpdated,
    retry_count: status === 'synced' ? 0 : metadata.retry_count ?? (row as any)?.retry_count ?? 0,
    last_attempt_at: metadata.last_attempt_at ?? (row as any)?.last_attempt_at ?? null,
    next_retry_at: status === 'synced' || status === 'failed' || status === 'conflict' ? null : metadata.next_retry_at ?? (row as any)?.next_retry_at ?? null,
    last_error: status === 'synced' ? null : metadata.last_error ?? (row as any)?.last_error ?? null
  };
  if (status === 'synced') {
    const decoded = await decryptPayload(row.user_id, row.data_encrypted);
    const entityId = String(row.entity_id || row.id || '').trim();
    if (row.method === 'DELETE') {
      await db.cache_records.delete(entityId);
      await setTombstone(row.user_id, row.type, entityId);
    } else if (decoded != null) {
      const existingCache = await db.cache_records.get(entityId);
      const existingData = existingCache ? await decryptPayload(existingCache.user_id, existingCache.data_encrypted) : null;
      const mergedData = mergeOfflineEntityData(row.type, existingData, decoded, row.method);
      const encrypted = await encryptPayload(row.user_id, mergedData);
      await db.cache_records.put({
        ...row,
        id: entityId,
        entity_id: entityId,
        data_encrypted: encrypted,
        sync_status: 'synced',
        last_updated: nextLastUpdated,
        retry_count: 0,
        next_retry_at: null,
        last_error: null
      });
      await removeTombstone(row.user_id, row.type, entityId);
    }
    await db.records.delete(id);
  } else {
    await db.records.update(id, patch);
  }
  if (row?.type === 'log' && row?.user_id) {
    if (status === 'synced') {
      removeLogBackup(row.user_id, id);
    } else {
      persistLogBackup({ ...row, ...patch });
    }
  }
}

export async function markRecordSyncFailure(id: string, params: { status?: number | null; error?: unknown; retryable?: boolean } = {}) {
  const row = await db.records.get(id);
  const resolved = resolveOfflineSyncFailure({
    currentRetryCount: (row as any)?.retry_count || 0,
    status: params.retryable === false ? 400 : params.status,
    error: params.error,
    maxRetries: OFFLINE_SYNC_MAX_RETRIES
  });
  await markRecordSyncStatus(id, resolved.sync_status, resolved);
  if (row?.method === 'DELETE' && resolved.sync_status === 'failed') {
    await removeTombstone(row.user_id, row.type, String(row.entity_id || row.id || '').trim());
  }
  return resolved;
}

export async function resetFailedSyncRecord(id: string) {
  await markRecordSyncStatus(id, 'pending', {
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    last_error: null
  });
}

export async function getRecordById(id: string): Promise<OfflineRecord | null> {
  const currentUserId = await getCurrentUserIdOrNull();
  if (!currentUserId) return null;
  const cached = await db.cache_records.get(id);
  let base = cached?.user_id === currentUserId ? await mapStoredToOfflineRecord(cached) : null;
  const queuedRows = (await db.records.where('entity_id').equals(id).toArray())
    .filter((row) =>
      row.user_id === currentUserId &&
      (row.sync_status !== 'failed' || isRecoverableFailedOfflineSyncRecord(row))
    )
    .sort((a, b) => a.last_updated - b.last_updated);
  for (const row of queuedRows) {
    const queued = await mapStoredToOfflineRecord(row);
    if (!queued) continue;
    if (queued.method === 'DELETE') return null;
    base = {
      ...queued,
      id,
      entity_id: id,
      data: mergeOfflineEntityData(queued.type, base?.data, queued.data, queued.method)
    };
  }
  if (!base) {
    const legacy = await db.records.get(id);
    if (
      legacy?.user_id === currentUserId &&
      (legacy.sync_status !== 'failed' || isRecoverableFailedOfflineSyncRecord(legacy))
    ) {
      base = await mapStoredToOfflineRecord(legacy);
    }
  }
  if (base && await isTombstoned(currentUserId, base.type, id)) return null;
  return base;
}

export async function discardFailedOfflineEntityMutations(type: OfflineRecord['type'], entityId: string): Promise<number> {
  const currentUserId = await getCurrentUserIdOrNull();
  const safeEntityId = String(entityId || '').trim();
  if (!currentUserId || !safeEntityId) return 0;

  const rows = (await db.records.where('entity_id').equals(safeEntityId).toArray())
    .filter((row) =>
      row.user_id === currentUserId &&
      row.type === type &&
      (row.sync_status === 'failed' || row.sync_status === 'conflict')
    );
  if (rows.length === 0) return 0;
  await db.records.bulkDelete(rows.map((row) => row.id));
  return rows.length;
}

export async function getRecordsByType(type: OfflineRecord['type']): Promise<OfflineRecord[]> {
  const currentUserId = await getCurrentUserIdOrNull();
  if (!currentUserId) return [];
  const cachedRows = (await db.cache_records.where('type').equals(type).toArray())
    .filter((row) => row.user_id === currentUserId);
  const queuedRows = (await db.records.where('type').equals(type).toArray())
    .filter((row) =>
      row.user_id === currentUserId &&
      (row.sync_status !== 'failed' || isRecoverableFailedOfflineSyncRecord(row))
    )
    .sort((a, b) => a.last_updated - b.last_updated);
  const [cachedDecoded, queuedDecoded] = await Promise.all([
    Promise.all(cachedRows.map(mapStoredToOfflineRecord)),
    Promise.all(queuedRows.map(mapStoredToOfflineRecord))
  ]);
  const merged = new Map<string, OfflineRecord>();
  for (const record of cachedDecoded.filter(Boolean) as OfflineRecord[]) {
    const entityId = entityIdForRecord(record);
    if (entityId) merged.set(entityId, { ...record, id: entityId, entity_id: entityId });
  }
  for (const record of queuedDecoded.filter(Boolean) as OfflineRecord[]) {
    const entityId = entityIdForRecord(record);
    if (!entityId) continue;
    if (record.method === 'DELETE') {
      merged.delete(entityId);
      continue;
    }
    const existing = merged.get(entityId);
    merged.set(entityId, {
      ...record,
      id: entityId,
      entity_id: entityId,
      data: mergeOfflineEntityData(record.type, existing?.data, record.data, record.method)
    });
  }
  const tombstones = (await db.tombstones.where('type').equals(type).toArray())
    .filter((row) => row.user_id === currentUserId);
  for (const tombstone of tombstones) merged.delete(tombstone.entity_id);
  return Array.from(merged.values());
}

export async function getPendingRecords(): Promise<OfflineRecord[]> {
  const currentUserId = await getCurrentUserIdOrNull();
  if (!currentUserId) return [];
  const [pendingRows, failedRows, conflictRows] = await Promise.all([
    db.records.where('sync_status').equals('pending').toArray(),
    db.records.where('sync_status').equals('failed').toArray(),
    db.records.where('sync_status').equals('conflict').toArray()
  ]);
  const rows = pendingRows.filter((row) => row.user_id === currentUserId);
  const blockers = [
    ...failedRows.filter((row) => isRecoverableFailedOfflineSyncRecord(row)),
    ...conflictRows,
  ].filter((row) => row.user_id === currentUserId);
  const backupRows = Object.values(readLogBackups(currentUserId)).filter((row) => row.sync_status === 'pending');
  const mergedRows = Array.from(
    new Map([...rows, ...backupRows].map((row) => [row.id, row])).values()
  );
  const decoded = await Promise.all(mergedRows.map(mapStoredToOfflineRecord));
  const now = Date.now();
  return (decoded.filter(Boolean) as OfflineRecord[]).filter((record) => {
    if (!shouldAttemptOfflineRecord(record, now)) return false;
    const entityId = entityIdForRecord(record);
    // Never let a newer mutation overtake an unresolved older mutation for the
    // same entity. This preserves causal ordering across reloads/relogins.
    return !blockers.some((blocker) =>
      blocker.type === record.type &&
      String(blocker.entity_id || blocker.id || '').trim() === entityId &&
      Number(blocker.last_updated || 0) <= Number(record.last_updated || 0)
    );
  });
}

export async function getFailedSyncRecords(): Promise<OfflineRecord[]> {
  const currentUserId = await getCurrentUserIdOrNull();
  if (!currentUserId) return [];
  const rows = (await db.records.where('sync_status').equals('failed').toArray())
    .filter((row) => row.user_id === currentUserId);
  const conflictRows = (await db.records.where('sync_status').equals('conflict').toArray())
    .filter((row) => row.user_id === currentUserId);
  const decoded = await Promise.all([...rows, ...conflictRows].map(mapStoredToOfflineRecord));
  return decoded.filter(Boolean) as OfflineRecord[];
}

export async function getLatestTypeUpdate(type: OfflineRecord['type']): Promise<number | null> {
  const currentUserId = await getCurrentUserIdOrNull();
  if (!currentUserId) return null;
  const rows = [
    ...(await db.cache_records.where('type').equals(type).toArray()),
    ...(await db.records.where('type').equals(type).toArray())
  ].filter((row) => row.user_id === currentUserId);
  if (!rows.length) return null;
  return rows.reduce((max, row) => Math.max(max, row.last_updated || 0), 0);
}

export async function setEndpointCacheMeta(meta: Omit<OfflineCacheMeta, 'updated_at'>) {
  await db.cache_meta.put({
    endpoint: meta.endpoint,
    etag: meta.etag || null,
    last_modified: meta.last_modified || null,
    last_seen_updated: meta.last_seen_updated || null,
    snapshot_count: Number.isFinite(meta.snapshot_count) ? Number(meta.snapshot_count) : null,
    updated_at: Date.now()
  });
}

export async function getEndpointCacheMeta(endpoint: string): Promise<OfflineCacheMeta | null> {
  const row = await db.cache_meta.get(endpoint);
  return row || null;
}

export async function clearSensitiveOfflineCacheForUser(userId?: string | null) {
  const safeUserId = String(userId || '').trim();
  if (safeUserId) {
    const userRows = await db.records.where('user_id').equals(safeUserId).toArray();
    const syncedLegacyIds = userRows.filter((row) => row.sync_status === 'synced').map((row) => row.id);
    if (syncedLegacyIds.length > 0) await db.records.bulkDelete(syncedLegacyIds);

    // Never destroy the canonical cache/crypto material required to replay or
    // reconstruct an unconfirmed mutation. Logout only clears fully-synced data.
    const hasUnsynced = userRows.some((row) => row.sync_status !== 'synced');
    if (!hasUnsynced) {
      await db.cache_records.where('user_id').equals(safeUserId).delete();
      await db.tombstones.where('user_id').equals(safeUserId).delete();
      localStorage.removeItem(logBackupKeyForUser(safeUserId));
      localStorage.removeItem(persistentSeedKeyForUser(safeUserId));
    }
  }
  await db.cache_meta.clear();
  sessionStorage.removeItem(SESSION_SEED_KEY);
  derivedKeyCache = null;
  seedInFlight = null;
}

let isSyncing = false;
let lastSyncAttempt = 0;
const SYNC_COOLDOWN = 5000;

export const syncOfflineData = async () => {
  const now = Date.now();
  if (!navigator.onLine || isSyncing || now - lastSyncAttempt < SYNC_COOLDOWN) return;

  isSyncing = true;
  lastSyncAttempt = now;
  console.log('Starting offline sync...');

  try {
    const pending = await getPendingRecords();

    if (pending.length === 0) {
      console.log('No pending records to sync.');
      return;
    }

    pending.sort((a, b) => a.last_updated - b.last_updated);
    const blockedEntities = new Set<string>();

    for (const record of pending) {
      const syncEntityKey = `${record.type}:${entityIdForRecord(record)}`;
      if (blockedEntities.has(syncEntityKey)) {
        (record as any).data = null;
        continue;
      }
      try {
        const session = await ensureFreshSession();
        const token = session?.access_token;
        await markRecordSyncStatus(record.id, 'pending', {
          retry_count: record.retry_count || 0,
          last_attempt_at: Date.now(),
          next_retry_at: null,
          last_error: record.last_error || null
        });

        const response = await fetch(record.endpoint, {
          method: record.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            ...(record?.data?.idempotencyKey ? { 'X-Idempotency-Key': String(record.data.idempotencyKey) } : {})
          },
          credentials: 'include',
          body: JSON.stringify(record.data)
        });

        const responsePayload = await response.json().catch(() => ({ error: 'Unknown error' }));

        if ((response.ok && responsePayload?.queued !== true && responsePayload?.success !== false) || (response.status === 409 && isIdempotentConflictPayload(responsePayload))) {
          await markRecordSyncStatus(record.id, 'synced');
          console.log(`Synced ${record.type}: ${record.id}`);
        } else if (response.ok && (responsePayload?.queued === true || responsePayload?.success === false)) {
          const failure = await markRecordSyncFailure(record.id, {
            status: responsePayload?.queued === true ? 503 : 400,
            retryable: responsePayload?.queued === true,
            error: responsePayload?.warning || 'Servidor enfileirou o sync para tentar depois.'
          });
          blockedEntities.add(syncEntityKey);
          console.warn(`Server queued ${record.type} sync for later: ${record.id}`, failure);
        } else if (response.status === 409 && (responsePayload?.conflict === true || record.type === 'appointment')) {
          const errorMessage = responsePayload?.error || responsePayload?.message || 'Conflito de persistência encontrado ao sincronizar.';
          await markRecordSyncStatus(record.id, 'conflict', {
            retry_count: record.retry_count || 0,
            last_attempt_at: Date.now(),
            next_retry_at: null,
            last_error: errorMessage
          });
          blockedEntities.add(syncEntityKey);
          console.warn(`Marked ${record.type} ${record.id} as CONFLICT during offline sync.`);
        } else {
          console.error(`Server rejected ${record.type} sync:`, responsePayload);
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          const failure = await markRecordSyncFailure(record.id, {
            status: response.status,
            retryable,
            error: responsePayload?.error || responsePayload?.message || `Server error ${response.status}`
          });
          blockedEntities.add(syncEntityKey);
          if (failure.sync_status === 'failed') {
            console.warn(`Marked ${record.type} ${record.id} as FAILED after ${failure.retry_count} attempt(s).`);
          }
        }
      } catch (error: any) {
        const retryable = error?.name === 'TypeError' || error?.message === 'Failed to fetch';
        const failure = await markRecordSyncFailure(record.id, {
          retryable,
          error: error?.message || error
        });
        blockedEntities.add(syncEntityKey);
        console.error(`Failed to sync ${record.type}:`, error);
        if (failure.sync_status === 'failed') {
          console.warn(`Marked ${record.type} ${record.id} as FAILED after ${failure.retry_count} attempt(s).`);
        }
      } finally {
        (record as any).data = null;
      }
    }
  } finally {
    isSyncing = false;
    console.log('Offline sync finished.');
  }
};
