import Dexie, { Table } from 'dexie';
import { ensureFreshSession, getSupabase } from '../lib/supabase';
import {
  OFFLINE_SYNC_MAX_RETRIES,
  isIdempotentConflictPayload,
  type OfflineSyncStatus,
  resolveOfflineSyncFailure,
  shouldAttemptOfflineRecord
} from '../utils/offlineSyncResilience';

export interface OfflineRecord {
  id: string;
  data: any;
  type: 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment' | 'aba' | 'appointment';
  sync_status: OfflineSyncStatus;
  last_updated: number;
  retry_count?: number;
  last_attempt_at?: number | null;
  next_retry_at?: number | null;
  last_error?: string | null;
  method: 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
}

interface OfflineRecordStored extends Omit<OfflineRecord, 'data'> {
  data_encrypted: string;
  user_id: string;
}

export interface OfflineCacheMeta {
  endpoint: string;
  etag?: string | null;
  last_modified?: string | null;
  last_seen_updated?: number | null;
  updated_at: number;
}

export class MyDatabase extends Dexie {
  records!: Table<OfflineRecordStored>;
  cache_meta!: Table<OfflineCacheMeta>;

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

export async function saveEncryptedRecord(record: OfflineRecord) {
  const userId = await getCurrentUserIdOrNull();
  if (!userId) return false;
  const dataEncrypted = await encryptPayload(userId, record.data);
  const row: OfflineRecordStored = {
    id: record.id,
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
  persistLogBackup(row);
  await db.records.put(row);
  return true;
}

export async function markRecordSyncStatus(
  id: string,
  status: OfflineSyncStatus,
  metadata: Partial<Pick<OfflineRecord, 'retry_count' | 'last_attempt_at' | 'next_retry_at' | 'last_error'>> = {}
) {
  const row = await db.records.get(id);
  const nextLastUpdated = Date.now();
  const patch = {
    sync_status: status,
    last_updated: nextLastUpdated,
    retry_count: status === 'synced' ? 0 : metadata.retry_count ?? (row as any)?.retry_count ?? 0,
    last_attempt_at: metadata.last_attempt_at ?? (row as any)?.last_attempt_at ?? null,
    next_retry_at: status === 'synced' || status === 'failed' || status === 'conflict' ? null : metadata.next_retry_at ?? (row as any)?.next_retry_at ?? null,
    last_error: status === 'synced' ? null : metadata.last_error ?? (row as any)?.last_error ?? null
  };
  await db.records.update(id, patch);
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
  const row = await db.records.get(id);
  if (!row) return null;
  return await mapStoredToOfflineRecord(row);
}

export async function getRecordsByType(type: OfflineRecord['type']): Promise<OfflineRecord[]> {
  const rows = await db.records.where('type').equals(type).toArray();
  const decoded = await Promise.all(rows.map(mapStoredToOfflineRecord));
  return decoded.filter(Boolean) as OfflineRecord[];
}

export async function getPendingRecords(): Promise<OfflineRecord[]> {
  const rows = await db.records.where('sync_status').equals('pending').toArray();
  const currentUserId = await getCurrentUserIdOrNull();
  const backupRows = currentUserId
    ? Object.values(readLogBackups(currentUserId)).filter((row) => row.sync_status === 'pending')
    : [];
  const mergedRows = Array.from(
    new Map([...rows, ...backupRows].map((row) => [row.id, row])).values()
  );
  const decoded = await Promise.all(mergedRows.map(mapStoredToOfflineRecord));
  const now = Date.now();
  return (decoded.filter(Boolean) as OfflineRecord[]).filter((record) => shouldAttemptOfflineRecord(record, now));
}

export async function getFailedSyncRecords(): Promise<OfflineRecord[]> {
  const rows = await db.records.where('sync_status').equals('failed').toArray();
  const conflictRows = await db.records.where('sync_status').equals('conflict').toArray();
  const decoded = await Promise.all([...rows, ...conflictRows].map(mapStoredToOfflineRecord));
  return decoded.filter(Boolean) as OfflineRecord[];
}

export async function getLatestTypeUpdate(type: OfflineRecord['type']): Promise<number | null> {
  const rows = await db.records.where('type').equals(type).toArray();
  if (!rows.length) return null;
  return rows.reduce((max, row) => Math.max(max, row.last_updated || 0), 0);
}

export async function setEndpointCacheMeta(meta: Omit<OfflineCacheMeta, 'updated_at'>) {
  await db.cache_meta.put({
    endpoint: meta.endpoint,
    etag: meta.etag || null,
    last_modified: meta.last_modified || null,
    last_seen_updated: meta.last_seen_updated || null,
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
    await db.records.where('user_id').equals(safeUserId).delete();
    localStorage.removeItem(logBackupKeyForUser(safeUserId));
    localStorage.removeItem(persistentSeedKeyForUser(safeUserId));
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

    for (const record of pending) {
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
            'Authorization': token ? `Bearer ${token}` : ''
          },
          credentials: 'include',
          body: JSON.stringify(record.data)
        });

        const responsePayload = await response.json().catch(() => ({ error: 'Unknown error' }));

        if ((response.ok && responsePayload?.queued !== true) || (response.status === 409 && isIdempotentConflictPayload(responsePayload))) {
          await markRecordSyncStatus(record.id, 'synced');
          console.log(`Synced ${record.type}: ${record.id}`);
        } else if (response.ok && responsePayload?.queued === true) {
          const failure = await markRecordSyncFailure(record.id, {
            status: 503,
            error: responsePayload?.warning || 'Servidor enfileirou o sync para tentar depois.'
          });
          console.warn(`Server queued ${record.type} sync for later: ${record.id}`, failure);
        } else if (record.type === 'appointment' && response.status === 409) {
          const errorMessage = responsePayload?.error || responsePayload?.message || 'Conflito de agenda encontrado ao sincronizar.';
          await markRecordSyncStatus(record.id, 'conflict', {
            retry_count: record.retry_count || 0,
            last_attempt_at: Date.now(),
            next_retry_at: null,
            last_error: errorMessage
          });
          console.warn(`Marked appointment ${record.id} as CONFLICT during offline sync.`);
        } else {
          console.error(`Server rejected ${record.type} sync:`, responsePayload);
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          const failure = await markRecordSyncFailure(record.id, {
            status: response.status,
            retryable,
            error: responsePayload?.error || responsePayload?.message || `Server error ${response.status}`
          });
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
