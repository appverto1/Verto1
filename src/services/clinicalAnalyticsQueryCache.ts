import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

export type ClinicalAnalyticsFamily =
  | 'clinical-outcomes-dashboard'
  | 'aba-v3-catalog-overview'
  | 'aba-v3-series-bundle'
  | 'clinical-measurement-v3-catalog'
  | 'clinical-measurement-v3-view';

export type ClinicalAnalyticsQueryScope = {
  organizationId?: string | null;
  patientId: string;
  family: ClinicalAnalyticsFamily;
  params?: Record<string, unknown>;
};

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

type QueryEntry<T = any> = {
  key: string;
  scopeHash: string;
  patientHash: string;
  family: ClinicalAnalyticsFamily;
  data: T | null;
  error: string;
  status: QueryStatus;
  updatedAt: number;
  invalidatedAt: number;
  revision: number;
  requestId: number;
  promise: Promise<T> | null;
  listeners: Set<() => void>;
};

const CACHE_VERSION = 'clinical-analytics-v3-cache-v1';
const DEFAULT_STALE_MS = 30_000;
const queryCache = new Map<string, QueryEntry>();
let broadcastChannel: BroadcastChannel | null = null;
let globalRevision = 0;

const clean = (value: unknown) => String(value || '').trim();

function stableValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableValue(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function scopeFingerprint(value: string): string {
  // FNV-1a: deterministic, synchronous and intentionally one-way for transport.
  // Broadcast messages never include raw patient/organization identifiers or clinical payloads.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `s${(hash >>> 0).toString(36)}`;
}

export function clinicalAnalyticsPatientHash(patientId: string) {
  return scopeFingerprint(`${CACHE_VERSION}:patient:${clean(patientId)}`);
}

function clinicalAnalyticsScopeHash(scope: ClinicalAnalyticsQueryScope) {
  return scopeFingerprint(`${CACHE_VERSION}:scope:${clean(scope.organizationId) || 'current'}:${clean(scope.patientId)}`);
}

export function buildClinicalAnalyticsQueryKey(scope: ClinicalAnalyticsQueryScope) {
  return [
    CACHE_VERSION,
    clean(scope.organizationId) || 'current',
    clean(scope.patientId),
    scope.family,
    stableValue(scope.params || {}),
  ].join('::');
}

function getOrCreateEntry<T>(scope: ClinicalAnalyticsQueryScope): QueryEntry<T> {
  const key = buildClinicalAnalyticsQueryKey(scope);
  const existing = queryCache.get(key) as QueryEntry<T> | undefined;
  if (existing) return existing;
  const entry: QueryEntry<T> = {
    key,
    scopeHash: clinicalAnalyticsScopeHash(scope),
    patientHash: clinicalAnalyticsPatientHash(scope.patientId),
    family: scope.family,
    data: null,
    error: '',
    status: 'idle',
    updatedAt: 0,
    invalidatedAt: 0,
    revision: 0,
    requestId: 0,
    promise: null,
    listeners: new Set(),
  };
  queryCache.set(key, entry);
  return entry;
}

function emit(entry: QueryEntry) {
  entry.revision += 1;
  for (const listener of entry.listeners) listener();
}

function ensureBroadcastChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (broadcastChannel) return broadcastChannel;
  broadcastChannel = new BroadcastChannel('verto-clinical-analytics-v3');
  broadcastChannel.addEventListener('message', (event: MessageEvent) => {
    const payload = event.data || {};
    const patientHash = clean(payload.patientHash);
    if (!patientHash) return;
    const family = clean(payload.family);
    for (const entry of queryCache.values()) {
      if (entry.patientHash !== patientHash) continue;
      if (family && family !== 'all' && entry.family !== family) continue;
      entry.invalidatedAt = Math.max(entry.invalidatedAt, Number(payload.revision || Date.now()));
      emit(entry);
    }
  });
  return broadcastChannel;
}

function broadcastInvalidation(patientHash: string, family: ClinicalAnalyticsFamily | 'all', revision: number) {
  const channel = ensureBroadcastChannel();
  if (!channel) return;
  // No PHI/clinical values: only an opaque patient scope hash, query family and monotonic revision.
  channel.postMessage({ patientHash, family, revision });
}

export function invalidateClinicalAnalyticsPatient(patientId: string, family: ClinicalAnalyticsFamily | 'all' = 'all') {
  const patientHash = clinicalAnalyticsPatientHash(patientId);
  const revision = Math.max(Date.now(), ++globalRevision);
  for (const entry of queryCache.values()) {
    if (entry.patientHash !== patientHash) continue;
    if (family !== 'all' && entry.family !== family) continue;
    entry.invalidatedAt = Math.max(entry.invalidatedAt, revision);
    emit(entry);
  }
  broadcastInvalidation(patientHash, family, revision);
}

async function fetchClinicalAnalyticsQuery<T>(
  entry: QueryEntry<T>,
  fetcher: () => Promise<T>,
  staleMs: number,
  force = false,
) {
  const now = Date.now();
  const fresh = entry.data !== null && entry.invalidatedAt <= entry.updatedAt && now - entry.updatedAt < staleMs;
  if (!force && fresh) return entry.data;
  if (entry.promise) return entry.promise;

  const requestId = entry.requestId + 1;
  entry.requestId = requestId;
  entry.status = 'loading';
  entry.error = '';
  emit(entry);

  const promise = Promise.resolve()
    .then(fetcher)
    .then((result) => {
      // A late response is never allowed to overwrite a newer request for the same scope.
      if (entry.requestId !== requestId) return result;
      entry.data = result;
      entry.error = '';
      entry.status = 'success';
      entry.updatedAt = Date.now();
      entry.invalidatedAt = 0;
      return result;
    })
    .catch((error: any) => {
      if (entry.requestId === requestId) {
        entry.error = clean(error?.message || error?.error) || 'Não foi possível atualizar os dados clínicos.';
        entry.status = 'error';
      }
      throw error;
    })
    .finally(() => {
      if (entry.requestId === requestId) {
        entry.promise = null;
        emit(entry);
      }
    });

  entry.promise = promise;
  return promise;
}

export function useClinicalAnalyticsQuery<T>(
  scope: ClinicalAnalyticsQueryScope,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean; staleMs?: number; keepPreviousData?: boolean } = {},
) {
  const enabled = options.enabled !== false && Boolean(clean(scope.patientId));
  const staleMs = Math.max(0, Number(options.staleMs ?? DEFAULT_STALE_MS));
  const keepPreviousData = options.keepPreviousData !== false;
  const key = useMemo(() => buildClinicalAnalyticsQueryKey(scope), [
    scope.organizationId,
    scope.patientId,
    scope.family,
    stableValue(scope.params || {}),
  ]);
  const scopeHash = useMemo(() => clinicalAnalyticsScopeHash(scope), [scope.organizationId, scope.patientId]);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const entry = getOrCreateEntry<T>(scope);
  const [snapshot, setSnapshot] = useState(() => ({
    key: entry.key,
    data: entry.data,
    error: entry.error,
    status: entry.status,
    updatedAt: entry.updatedAt,
    invalidatedAt: entry.invalidatedAt,
    revision: entry.revision,
  }));
  const previousRef = useRef<{ scopeHash: string; data: T | null }>({ scopeHash, data: entry.data });
  const [isTransitionPending, startTransition] = useTransition();

  useEffect(() => {
    const currentEntry = getOrCreateEntry<T>(scope);
    const commit = () => {
      const next = {
        key: currentEntry.key,
        data: currentEntry.data,
        error: currentEntry.error,
        status: currentEntry.status,
        updatedAt: currentEntry.updatedAt,
        invalidatedAt: currentEntry.invalidatedAt,
        revision: currentEntry.revision,
      };
      startTransition(() => setSnapshot(next));
    };
    currentEntry.listeners.add(commit);
    commit();
    if (enabled) void fetchClinicalAnalyticsQuery(currentEntry, () => fetcherRef.current(), staleMs).catch(() => undefined);
    return () => {
      currentEntry.listeners.delete(commit);
    };
  }, [key, enabled, staleMs]);

  useEffect(() => {
    const currentEntry = getOrCreateEntry<T>(scope);
    if (!enabled || currentEntry.invalidatedAt <= currentEntry.updatedAt) return;
    void fetchClinicalAnalyticsQuery(currentEntry, () => fetcherRef.current(), staleMs, true).catch(() => undefined);
  }, [enabled, key, snapshot.revision, staleMs]);

  const snapshotMatchesKey = snapshot.key === key;
  if (previousRef.current.scopeHash !== scopeHash) {
    // Never carry committed clinical data across patient/organization scope changes.
    previousRef.current = { scopeHash, data: snapshotMatchesKey ? snapshot.data : null };
  } else if (snapshotMatchesKey && snapshot.data !== null) {
    previousRef.current.data = snapshot.data;
  }

  const currentData = snapshotMatchesKey ? snapshot.data : null;
  const isPreviousData = currentData === null
    && keepPreviousData
    && previousRef.current.scopeHash === scopeHash
    && previousRef.current.data !== null;
  const data = currentData !== null
    ? currentData
    : isPreviousData
      ? previousRef.current.data
      : null;
  const hasData = data !== null;

  return {
    data,
    isPreviousData,
    error: snapshot.error,
    isLoading: enabled && !hasData && (snapshot.status === 'loading' || snapshot.status === 'idle'),
    isRefreshing: enabled && hasData && (snapshot.status === 'loading' || isTransitionPending),
    isStale: hasData && snapshot.invalidatedAt > snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function clearClinicalAnalyticsQueryCache() {
  queryCache.clear();
}
