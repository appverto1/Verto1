import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('async function finalizeSalesActivationForUser');
const end = server.indexOf('const mutationActionLabel', start);
assert.ok(start >= 0 && end > start, 'finalizeSalesActivationForUser section not found');
const section = server.slice(start, end);

assert.match(
  section,
  /getStripe\(\)\.subscriptions\.retrieve/,
  'activation must reconcile the current Stripe subscription before releasing contracted modules',
);
assert.match(section, /\.eq\("status", "paid"\)/, 'activation must be linked to a persisted paid offer');
assert.match(section, /stripe_subscription_id/, 'the persisted Stripe subscription id must be the activation linkage');
assert.match(section, /sales_lead_events/);
assert.match(section, /stripeSubscriptionToEntitlementStatus\(\s*subscription\.status/);
assert.match(section, /applyModularEntitlementsForOrganization/);
assert.match(section, /provisionModularCapacityBillingContract/);
assert.match(section, /verifySalesDirectorContractAccess/);
assert.match(section, /\.update\(\{ used: true \}\)/);
assert.match(section, /SALES_SUBSCRIPTION_NOT_ACTIVE/);
const verifyIndex = section.indexOf('await verifySalesDirectorContractAccess');
const consumeIndex = section.indexOf('.update({ used: true })');
assert.ok(verifyIndex >= 0 && consumeIndex > verifyIndex, 'activation token must be consumed only after director/module verification');

console.log('salesActivationPersistedStripeState.test.mjs: ok');
