import Dexie, { Table } from 'dexie';
import { ensureFreshSession, getSupabase } from '../lib/supabase';

export interface OfflineRecord {
  id: string;
  data: any;
  type: 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment';
  sync_status: 'synced' | 'pending';
  last_updated: number;
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
    method: row.method,
    endpoint: row.endpoint,
    data: decrypted
  };
}

export async function saveEncryptedRecord(record: OfflineRecord) {
  const userId = await getCurrentUserId();
  const dataEncrypted = await encryptPayload(userId, record.data);
  const row: OfflineRecordStored = {
    id: record.id,
    data_encrypted: dataEncrypted,
    type: record.type,
    sync_status: record.sync_status,
    last_updated: record.last_updated,
    method: record.method,
    endpoint: record.endpoint,
    user_id: userId
  };
  persistLogBackup(row);
  await db.records.put(row);
}

export async function markRecordSyncStatus(id: string, status: 'synced' | 'pending') {
  const row = await db.records.get(id);
  const nextLastUpdated = Date.now();
  await db.records.update(id, { sync_status: status, last_updated: nextLastUpdated });
  if (row?.type === 'log' && row?.user_id) {
    if (status === 'synced') {
      removeLogBackup(row.user_id, id);
    } else {
      persistLogBackup({ ...row, sync_status: status, last_updated: nextLastUpdated });
    }
  }
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
  const currentUserId = await getCurrentUserId().catch(() => '');
  const backupRows = currentUserId
    ? Object.values(readLogBackups(currentUserId)).filter((row) => row.sync_status === 'pending')
    : [];
  const mergedRows = Array.from(
    new Map([...rows, ...backupRows].map((row) => [row.id, row])).values()
  );
  const decoded = await Promise.all(mergedRows.map(mapStoredToOfflineRecord));
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
      let success = false;
      let retries = 2;
      let delay = 1000;

      while (retries >= 0 && !success) {
        try {
          const session = await ensureFreshSession();
          const token = session?.access_token;

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

          if (response.ok && responsePayload?.queued !== true) {
            await markRecordSyncStatus(record.id, 'synced');
            console.log(`Synced ${record.type}: ${record.id}`);
            success = true;
          } else if (response.ok && responsePayload?.queued === true) {
            console.warn(`Server queued ${record.type} sync for later: ${record.id}`);
            success = true;
          } else {
            if (response.status === 429 && retries > 0) {
              console.warn(`Rate limit hit during sync of ${record.type}. Retrying in ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
              delay *= 2;
              retries--;
              continue;
            }

            console.error(`Server rejected ${record.type} sync:`, responsePayload);

            if (response.status === 404 || response.status === 400) {
              console.warn(`Marking ${record.type} ${record.id} as synced (failed permanently) to prevent retry loop.`);
              await markRecordSyncStatus(record.id, 'synced');
              success = true;
            } else {
              throw new Error(`Server error ${response.status}`);
            }
          }
        } catch (error: any) {
          if (retries > 0 && (error.name === 'TypeError' || error.message === 'Failed to fetch')) {
            console.warn(`Network error syncing ${record.type}. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            retries--;
            continue;
          }
          console.error(`Failed to sync ${record.type}:`, error);
          success = true;
        } finally {
          (record as any).data = null;
        }
      }
    }
  } finally {
    isSyncing = false;
    console.log('Offline sync finished.');
  }
};
