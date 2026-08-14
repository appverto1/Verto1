import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

const route = server.match(
  /app\.post\(\s*["']\/api\/owner\/sales\/offers\/:offerId\/resend-activation["'][\s\S]*?app\.post\(['"]\/api\/admin\/billing\/sync-stripe-plans['"]/,
)?.[0] || '';

assert.ok(route, 'manual activation resend route must exist');
assert.match(
  route,
  /idempotencyKey:\s*`sales-activation-reissue:\$\{activation\.id\}:attempt-\$\{attempts \+ 1\}`/,
  'each explicit resend must use a fresh logical delivery key based on the persisted attempt number',
);
assert.doesNotMatch(
  route,
  /idempotencyKey:\s*`sales-activation-reissue:\$\{activation\.id\}:\$\{reissueTokenHash\.slice\(0, 16\)\}`/,
  'the deterministic activation token must not also make every resend share one Resend idempotency key',
);
assert.match(
  route,
  /activation_email_attempts:\s*attempts \+ 1/,
  'successful/failed delivery bookkeeping must advance the persisted attempt used for the next resend key',
);
assert.match(route, /providerMessageId = sanitizeString\(emailResult\.data\?\.id/, 'provider delivery id must be captured for production diagnostics');
assert.match(route, /delivery_attempt:\s*attempts \+ 1/, 'audit metadata must record which explicit resend produced the provider delivery');
assert.match(route, /provider_message_id:\s*providerMessageId/, 'audit metadata must retain the Resend message id without a new database column');
assert.match(route, /idempotency_key:\s*`activation-reissued:\$\{activation\.id\}:attempt-\$\{attempts \+ 1\}`/, 'each manual resend must also produce its own idempotent audit event');
assert.match(route, /deriveSalesActivationToken\(checkoutSessionId\)/, 'activation credential itself remains deterministic');
assert.doesNotMatch(route, /checkout\.sessions\.create|subscriptions\.update/, 'resend must never mutate Stripe billing');

console.log('salesActivationManualResendDelivery.test.mjs: OK');
