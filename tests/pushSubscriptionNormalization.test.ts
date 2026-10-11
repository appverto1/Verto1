import assert from 'node:assert/strict';
import { normalizePushSubscription as originalPublicApi } from '../services/pushNotificationService';
import { normalizePushSubscription, sanitizeText } from '../services/pushSubscriptionNormalization';

assert.strictEqual(originalPublicApi, normalizePushSubscription, 'Existing export identity must be preserved');

const valid = { endpoint: 'https://push.example/subscription', keys: { p256dh: 'p-256', auth: 'auth-key' } };
const normalized = { endpoint: valid.endpoint, keys: { p256dh: 'p-256', auth: 'auth-key' } };

const fixtures: Array<{ name: string; input: any; expected: typeof normalized | null }> = [
  { name: 'direct WebPush subscription', input: valid, expected: normalized },
  { name: 'stored flat columns', input: { endpoint: valid.endpoint, p256dh: 'p-256', auth: 'auth-key' }, expected: normalized },
  { name: 'stored nested object', input: { subscription: valid }, expected: normalized },
  { name: 'stored nested serialized JSON', input: { subscription: JSON.stringify(valid) }, expected: normalized },
  { name: 'direct serialized JSON', input: JSON.stringify(valid), expected: normalized },
  { name: 'stored JSON string with whitespace', input: { subscription: `  ${JSON.stringify(valid)}  ` }, expected: normalized },
  { name: 'invalidated subscription denied', input: { ...valid, invalidated_at: '2026-10-11T12:00:00Z' }, expected: null },
  { name: 'invalidated_at zero not treated as invalid', input: { ...valid, invalidated_at: 0 }, expected: normalized },
  { name: 'null input', input: null, expected: null },
  { name: 'undefined input', input: undefined, expected: null },
  { name: 'false input', input: false, expected: null },
  { name: 'malformed direct serialized JSON', input: '{"endpoint":', expected: null },
  { name: 'malformed nested JSON', input: { subscription: '{"keys":', endpoint: valid.endpoint }, expected: null },
  { name: 'missing auth', input: { endpoint: valid.endpoint, keys: { p256dh: 'p-256' } }, expected: null },
  { name: 'missing endpoint', input: { keys: { p256dh: 'p-256', auth: 'auth-key' } }, expected: null },
  { name: 'no keys', input: { endpoint: valid.endpoint }, expected: null },
  { name: 'empty strings', input: { endpoint: '   ', keys: { p256dh: 'x', auth: 'y' } }, expected: null },
  { name: 'nested keys override flat', input: { endpoint: 'https://other.invalid', p256dh: 'flat', auth: 'flat',
    subscription: valid }, expected: normalized },
  { name: 'nested missing fields use flat fields', input: { endpoint: valid.endpoint, p256dh: 'p-256', auth: 'auth-key',
    subscription: { keys: {} } }, expected: normalized },
  { name: 'whitespace trimming', input: { endpoint: ' https://push.example/subscription ',
    keys: { p256dh: ' p-256 ', auth: ' auth-key ' } }, expected: normalized },
  { name: 'nested invalidated wins', input: { ...valid, invalidated_at: true, subscription: valid }, expected: null },
  { name: 'array is not valid subscription', input: [], expected: null },
];
for (const fixture of fixtures) {
  assert.deepEqual(normalizePushSubscription(fixture.input), fixture.expected, fixture.name);
}
assert.equal(sanitizeText(null), '');
assert.equal(sanitizeText('  abc  ', 2), 'ab');
assert.equal(sanitizeText(123), '123');
assert.equal(sanitizeText('x'.repeat(2100), 2000).length, 2000);
assert.equal(normalizePushSubscription({ endpoint: ' x'.repeat(1300), p256dh: 'x', auth: 'y' })?.endpoint.length, 2000);
console.log('pushSubscriptionNormalization.test: PASS (22 fixtures + sanitizer cases)');
