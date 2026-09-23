import assert from 'node:assert/strict';
import fs from 'node:fs';

const execution = fs.readFileSync('services/moduleSubscriptionUpgradeStripe.ts', 'utf8');
const executionRoutes = fs.readFileSync('services/moduleSubscriptionUpgradeExecutionRoutes.ts', 'utf8');
const wiring = fs.readFileSync('services/modulePurchaseEligibilityRoutes.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260919110400_module_subscription_upgrade_intents_v1.sql', 'utf8');

assert.match(execution, /subscriptions\.retrieve\(subscriptionId/);
assert.match(execution, /subscriptions\.update\(subscription\.id/);
assert.match(execution, /proration_behavior: 'always_invoice'/);
assert.match(execution, /payment_behavior: 'pending_if_incomplete'/);
assert.match(execution, /advance_module_subscription_upgrade_intent_v1/);
assert.match(execution, /apply_sales_offer_module_entitlements_v2/);
assert.match(execution, /settled\.states\.every\(\(state\) => state\.status === 'paid'\)/);
assert.match(execution, /entitlementGranted: true/);
assert.match(execution, /MODULE_UPGRADE_SCHEDULE_BOUNDARY_MISMATCH/);
assert.match(execution, /MODULE_UPGRADE_STRIPE_ITEM_IDENTITY_STALE/);
assert.match(execution, /buildFrozenStripeCheckoutPlan/);
assert.match(execution, /modular_snapshot/);
assert.doesNotMatch(execution, /subscriptions\.create\(/);
assert.doesNotMatch(execution, /checkout\.sessions\.create\(/);

assert.match(executionRoutes, /upgrade-intents\/:intentId\/execute/);
assert.match(executionRoutes, /requireClinicCapability\('clinic\.settings\.edit'\)/);
assert.match(executionRoutes, /currentClinicId\(req\.session\?\.user\)/);
assert.match(executionRoutes, /requiresAuthoritativeStripeConfirmation/);
assert.doesNotMatch(executionRoutes, /subscriptionId:/);
assert.match(wiring, /registerModuleSubscriptionUpgradeExecutionRoutes/);

assert.match(migration, /module_subscription_upgrade_one_live_per_subscription/);
assert.match(migration, /STALE_ACCESS_PROFILE/);
assert.match(migration, /STALE_STRIPE_EVENT/);
console.log('moduleSubscriptionUpgradeExecution: ok');
