import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchExternalWithTimeout, ExternalRequestTimeoutError } from '../src/utils/externalRequestTimeout';

const calls: RequestInit[] = [];
const slowFetch: typeof fetch = async (_url, init) => {
  calls.push(init || {});
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
};
const started = Date.now();
await assert.rejects(
  fetchExternalWithTimeout('https://example.invalid/create', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body: '{"summary":"test"}'
  }, { timeoutMs: 20, request: slowFetch }),
  (err: unknown) => err instanceof ExternalRequestTimeoutError && /Confira se a ação foi concluída/.test(err.message),
);
assert.equal(calls.length, 1, 'non-idempotent calendar write MUST NOT retry');
assert.equal(calls[0].method, 'POST');
assert.ok(calls[0].signal?.aborted, 'timeout must abort the underlying fetch');
assert.ok(Date.now() - started < 500, 'timeout must resolve quickly');

const success = await fetchExternalWithTimeout('https://example.invalid/create', {
  method: 'POST',
  body: '{"summary":"test"}'
}, { timeoutMs: 2000, request: async () => new Response('{"id":"event-1"}', { status: 201 }) });
assert.equal(success.status, 201);
assert.equal((await success.json()).id, 'event-1');
const caller = new AbortController();
caller.abort();
await assert.rejects(
  fetchExternalWithTimeout('https://example.invalid/create', { method: 'POST', signal: caller.signal },
    { timeoutMs: 100, request: async (_url, init) => {
      assert.ok(init?.signal?.aborted);
      throw new DOMException('Aborted', 'AbortError');
    }}),
  (err: any) => err?.name === 'AbortError',
);
const source = readFileSync('src/services/googleCalendarService.ts','utf8');
assert.match(source, /fetchExternalWithTimeout\(/);
assert.match(source, /timeoutMs: 8_000/);
assert.doesNotMatch(source, /retry|setInterval/);
console.log('externalRequestTimeout: PASS');
