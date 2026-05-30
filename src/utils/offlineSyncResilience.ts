export type OfflineSyncStatus = 'synced' | 'pending' | 'failed';

export const OFFLINE_SYNC_MAX_RETRIES = 3;
export const OFFLINE_SYNC_BASE_BACKOFF_MS = 30_000;
export const OFFLINE_SYNC_MAX_BACKOFF_MS = 30 * 60_000;

export type OfflineSyncLikeRecord = {
  sync_status?: OfflineSyncStatus;
  retry_count?: number | null;
  next_retry_at?: number | null;
  last_attempt_at?: number | null;
  last_error?: string | null;
};

export function normalizeRetryCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function getOfflineSyncBackoffMs(retryCount: number): number {
  const safeRetry = Math.max(1, normalizeRetryCount(retryCount));
  const backoff = OFFLINE_SYNC_BASE_BACKOFF_MS * (2 ** (safeRetry - 1));
  return Math.min(OFFLINE_SYNC_MAX_BACKOFF_MS, backoff);
}

export function isRetryableOfflineSyncStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isPermanentOfflineSyncStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 422;
}

export function isIdempotentConflictPayload(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const code = String(payload.code || payload.error_code || '').trim().toUpperCase();
  const status = String(payload.status || '').trim().toUpperCase();
  return (
    payload.idempotent === true ||
    (payload.success === true && code.includes('IDEMPOTENT')) ||
    (payload.success === true && ['ALREADY_LINKED', 'LINKED_EXISTING_USER', 'INVITE_QUEUED', 'INVITE_PENDING'].includes(status)) ||
    code === 'PATIENT_ALREADY_EXISTS_SAME_CLINIC' ||
    code === 'PORTABILITY_REQUEST_ALREADY_EXISTS'
  );
}

export function shouldAttemptOfflineRecord(record: OfflineSyncLikeRecord, now = Date.now()): boolean {
  if (record.sync_status !== 'pending') return false;
  const nextRetryAt = Number(record.next_retry_at || 0);
  if (Number.isFinite(nextRetryAt) && nextRetryAt > now) return false;
  return normalizeRetryCount(record.retry_count) < OFFLINE_SYNC_MAX_RETRIES;
}

export function resolveOfflineSyncFailure(params: {
  currentRetryCount?: number | null;
  status?: number | null;
  error?: unknown;
  now?: number;
  maxRetries?: number;
}) {
  const now = params.now || Date.now();
  const maxRetries = params.maxRetries || OFFLINE_SYNC_MAX_RETRIES;
  const currentRetryCount = normalizeRetryCount(params.currentRetryCount);
  const status = Number(params.status || 0);
  const retryable = status ? isRetryableOfflineSyncStatus(status) : true;
  const permanent = status ? isPermanentOfflineSyncStatus(status) : false;
  const nextRetryCount = currentRetryCount + 1;
  const lastError = params.error instanceof Error
    ? params.error.message
    : typeof params.error === 'string'
      ? params.error
      : params.error && typeof params.error === 'object'
        ? JSON.stringify(params.error)
        : status
          ? `HTTP ${status}`
          : 'Erro de sincronizacao offline';

  if (permanent || !retryable || nextRetryCount >= maxRetries) {
    return {
      sync_status: 'failed' as const,
      retry_count: nextRetryCount,
      last_attempt_at: now,
      next_retry_at: null,
      last_error: lastError
    };
  }

  return {
    sync_status: 'pending' as const,
    retry_count: nextRetryCount,
    last_attempt_at: now,
    next_retry_at: now + getOfflineSyncBackoffMs(nextRetryCount),
    last_error: lastError
  };
}
