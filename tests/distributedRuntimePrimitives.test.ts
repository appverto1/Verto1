import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256, asDate } from '../services/distributedRuntimePrimitives';
import {
  hashRuntimeSessionToken,
  SupabaseRateLimitStore,
} from '../services/distributedRuntimeState';

const cases: unknown[] = [
  null, undefined, '', ' abc ', 0, 42, false, true, -1,
  [], ['one', 'two'], {}, { id: 5 }, '\0', 'Árvore', '🐈', 'z'.repeat(4000),
];
for (const item of cases) {
  const text = String(item ?? '');
  const expected = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  assert.equal(sha256(item), expected, 'SHA-256 canonical string changed');
  assert.equal(sha256(item).length, 64);
}
for (const token of [null, undefined, '', 'token-a', ' token ', 0, 123, false, true]) {
  const expected = crypto.createHash('sha256')
    .update(String(String(token || '') ?? ''), 'utf8').digest('hex');
  assert.equal(hashRuntimeSessionToken(token), expected, 'Public token hash semantics changed');
}
assert.equal(asDate('2026-10-11T12:00:00.000Z', 1000).toISOString(), '2026-10-11T12:00:00.000Z');
assert.equal(asDate('2025-01-01T00:00:00Z', 1000).toISOString(), '2025-01-01T00:00:00.000Z');
for (const invalid of [null, undefined, '', 0, false, 'not-a-date']) {
  const before = Date.now();
  const parsed = asDate(invalid, 4200);
  const after = Date.now();
  assert.ok(parsed.getTime() >= before + 4200 && parsed.getTime() <= after + 4200, 'Invalid date fallback changed');
}
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const fakeSupabase = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: { total_hits: 3, reset_at: '2026-10-11T12:15:00.000Z' }, error: null };
  },
};
const store = new SupabaseRateLimitStore({ supabase: fakeSupabase as any, scope: 'case-scope', windowMs: 60_000 });
const count = await store.increment('external-key');
assert.equal(count.totalHits, 3);
assert.equal(count.resetTime.toISOString(), '2026-10-11T12:15:00.000Z');
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].name, 'runtime_rate_limit_increment_v1');
assert.equal(rpcCalls[0].args.p_key_hash, crypto.createHash('sha256').update('case-scope:external-key', 'utf8').digest('hex'));
assert.equal(rpcCalls[0].args.p_window_ms, 60_000);
console.log('distributedRuntimePrimitives.test: PASS');
