import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyReservationSchemaProbe, checkCriticalSchema } from '../scripts/check-critical-schema.mjs';

test('PGRST003 is a transient PostgREST pool failure, not a TISS schema mismatch', async () => {
  const poolError = {
    code: 'PGRST003',
    message: 'Timed out acquiring connection from connection pool.',
  };
  const classification = classifyReservationSchemaProbe(poolError);
  assert.equal(classification.reason, 'rpc_pool_unavailable');
  assert.equal(classification.compatible, false);
  assert.equal(classification.retryable, true);
  assert.equal(classification.failureKind, 'transient');

  const cacheError = {
    code: 'PGRST002',
    message: 'Could not query the database for the schema cache. Retrying.',
  };
  assert.equal(classifyReservationSchemaProbe(cacheError).reason, 'rpc_pool_unavailable');
  assert.equal(classifyReservationSchemaProbe(cacheError).compatible, false);

  const result = await checkCriticalSchema({
    rpc: async () => ({ data: null, error: poolError }),
  });
  assert.equal(result.reason, 'rpc_pool_unavailable');
  assert.equal(result.compatible, false);
});

test('TISS invalid legacy version, permissions, missing RPC and incorrect marker remain incompatible', async () => {
  for (const [error, expectedReason] of [
    [{ code: 'P0001', message: 'TISS_AUTHORIZATION_SCOPE_INVALID' }, 'rpc_legacy_version'],
    [{ code: '42501', message: 'permission denied' }, 'rpc_permission_mismatch'],
    [{ code: 'PGRST202', message: 'Could not find function' }, 'rpc_missing_or_signature_mismatch'],
    [{ code: 'XX000', message: 'unexpected database error' }, 'rpc_probe_failed'],
  ]) {
    const classification = classifyReservationSchemaProbe(error);
    assert.equal(classification.reason, expectedReason);
    assert.equal(classification.compatible, false);
  }

  const result = await checkCriticalSchema({
    rpc: async () => ({ data: { compatible: true, schema_version: 'incorrect-version' }, error: null }),
  });
  assert.equal(result.reason, 'rpc_version_mismatch');
  assert.equal(result.compatible, false);
});

test('Correct TISS schema marker still passes the validator', async () => {
  const result = await checkCriticalSchema({
    rpc: async () => ({ data: { compatible: true, schema_version: '20260715120000' }, error: null }),
  });
  assert.equal(result.reason, 'compatible');
  assert.equal(result.compatible, true);
});
