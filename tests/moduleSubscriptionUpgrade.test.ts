import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('services/moduleSubscriptionUpgradeRoutes.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260919110400_module_subscription_upgrade_intents_v1.sql', 'utf8');
const wiring = readFileSync('services/modulePurchaseEligibilityRoutes.ts', 'utf8');

assert.match(route, /currentClinicId\(req\.session\?\.user\)/);
assert.match(route, /requireClinicCapability\('clinic\.settings\.edit'\)/);
assert.match(route, /MODULE_UPGRADE_DEMO_FORBIDDEN/);
assert.match(route, /MODULE_UPGRADE_OFFER_TENANT_MISMATCH/);
assert.match(route, /MODULE_UPGRADE_OFFER_MODULE_SET_STALE/);
assert.match(route, /acquire_module_subscription_upgrade_intent_v1/);
assert.match(route, /requiresAuthoritativeStripeConfirmation: true/);
assert.match(route, /entitlementGranted: false/);
assert.doesNotMatch(route, /stripe\.subscriptions\.create/);
assert.doesNotMatch(route, /checkout\.sessions\.create/);
assert.doesNotMatch(route, /apply_sales_offer_module_entitlements_v1/);

assert.match(migration, /unique \(organization_id, idempotency_key\)/);
assert.match(migration, /module_subscription_upgrade_one_live_per_subscription/);
assert.match(migration, /STALE_ACCESS_PROFILE/);
assert.match(migration, /BILLING_NOT_ACTIVE/);
assert.match(migration, /STALE_STRIPE_EVENT/);
assert.match(wiring, /registerModuleSubscriptionUpgradeRoutes/);
console.log('moduleSubscriptionUpgrade: ok');
