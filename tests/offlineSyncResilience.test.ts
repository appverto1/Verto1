import assert from 'node:assert/strict';
import {
  OFFLINE_SYNC_MAX_BACKOFF_MS,
  getOfflineSyncBackoffMs,
  resolveOfflineSyncFailure,
  shouldAttemptOfflineRecord,
} from '../src/utils/offlineSyncResilience.ts';

const retryableAfterManyAttempts = resolveOfflineSyncFailure({
  currentRetryCount: 25,
  status: 503,
  error: 'service unavailable',
  now: 1_000,
});
assert.equal(retryableAfterManyAttempts.sync_status, 'pending', '5xx nunca deve virar estado terminal por esgotar tentativas');
assert.equal(retryableAfterManyAttempts.retry_count, 26);
assert.ok(Number(retryableAfterManyAttempts.next_retry_at) > 1_000);

const permanentValidationFailure = resolveOfflineSyncFailure({
  currentRetryCount: 0,
  status: 422,
  error: 'payload invalid',
  now: 1_000,
});
assert.equal(permanentValidationFailure.sync_status, 'failed', 'erro funcional 4xx deve exigir atenção em vez de retry infinito');
assert.equal(permanentValidationFailure.next_retry_at, null);

assert.equal(
  shouldAttemptOfflineRecord({ sync_status: 'pending', retry_count: 999, next_retry_at: 900 }, 1_000),
  true,
  'retry_count alto não pode matar uma pendência recuperável',
);
assert.equal(
  shouldAttemptOfflineRecord({ sync_status: 'pending', retry_count: 1, next_retry_at: 1_100 }, 1_000),
  false,
  'backoff ainda deve impedir martelamento do servidor',
);
assert.equal(getOfflineSyncBackoffMs(100), OFFLINE_SYNC_MAX_BACKOFF_MS, 'backoff deve ser limitado');

console.log('offlineSyncResilience.test.ts: ok');
