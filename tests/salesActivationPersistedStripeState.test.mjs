import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('async function finalizeSalesActivationForUser');
const end = server.indexOf('const mutationActionLabel', start);
assert.ok(start >= 0 && end > start, 'finalizeSalesActivationForUser section not found');
const section = server.slice(start, end);

assert.doesNotMatch(
  section,
  /getStripe\(\)\.subscriptions\.retrieve/,
  'first access must not depend on an outbound Stripe retrieve',
);
assert.match(section, /sales_lead_events/);
assert.match(section, /subscription_status/);
assert.match(section, /payment_confirmed_at/);
assert.match(section, /trial_days/);
assert.match(section, /applyModularEntitlementsForOrganization/);
assert.match(section, /provisioning_status:\s*"completed"/);
assert.match(section, /provisioning_status:\s*"failed"/);
assert.match(section, /SALES_SUBSCRIPTION_NOT_ACTIVE/);

console.log('salesActivationPersistedStripeState.test.mjs: ok');
