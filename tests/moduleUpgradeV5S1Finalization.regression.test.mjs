import assert from 'node:assert/strict';
import fs from 'node:fs';

const eligibilityRoutes = fs.readFileSync('services/modulePurchaseEligibilityRoutes.ts', 'utf8');
const intentRoutes = fs.readFileSync('services/moduleSubscriptionUpgradeRoutes.ts', 'utf8');
const executionRoutes = fs.readFileSync('services/moduleSubscriptionUpgradeExecutionRoutes.ts', 'utf8');
const stripe = fs.readFileSync('services/moduleSubscriptionUpgradeStripe.ts', 'utf8');
const discovery = fs.readFileSync('src/components/ModuleDiscoveryInterstitial.tsx', 'utf8');
const settings = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260919110400_module_subscription_upgrade_intents_v1.sql', 'utf8');

assert.match(eligibilityRoutes, /currentClinicId\(req\.session\?\.user\)/);
assert.match(intentRoutes, /create_sales_modular_offer_v3/);
assert.match(intentRoutes, /sales_offer_simulation_items/);
assert.match(intentRoutes, /sameModules\(modulesBySimulation[\s\S]*expectedModules/);
assert.match(intentRoutes, /MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE/);
assert.match(intentRoutes, /acquire_module_subscription_upgrade_intent_v1/);
assert.doesNotMatch(intentRoutes, /stripe\./);

assert.match(executionRoutes, /requireClinicCapability\('clinic\.settings\.edit'\)/);
assert.match(executionRoutes, /currentClinicId\(req\.session\?\.user\)/);
assert.match(executionRoutes, /acceptTerms: req\.body\?\.acceptTerms === true/);
assert.match(stripe, /advance_module_subscription_upgrade_intent_v1/);
assert.match(stripe, /subscriptions\.update\(subscription\.id/);
assert.match(stripe, /proration_behavior: 'always_invoice'/);
assert.match(stripe, /payment_behavior: 'pending_if_incomplete'/);
assert.match(stripe, /subscriptionSchedules\.retrieve/);
assert.match(stripe, /subscriptionSchedules\.update/);
assert.match(stripe, /MODULE_UPGRADE_SCHEDULE_BOUNDARY_MISMATCH/);
assert.match(stripe, /existing\.trial_end/);
assert.match(stripe, /existing\.billing_cycle_anchor/);
assert.match(stripe, /invoiceItems\.create/);
assert.match(stripe, /invoices\.create/);
assert.match(stripe, /vertoUpgradeOneTimeInvoiceId/);
assert.match(stripe, /settled\.states\.every\(\(state\) => state\.status === 'paid'\)/);
assert.match(stripe, /apply_sales_offer_module_entitlements_v2/);
assert.doesNotMatch(stripe, /subscriptions\.create/);
assert.doesNotMatch(stripe, /checkout\.sessions\.create/);

assert.match(migration, /unique \(organization_id, idempotency_key\)/);
assert.match(migration, /module_subscription_upgrade_one_live_per_subscription/);
assert.match(migration, /STALE_STRIPE_EVENT/);

assert.match(settings, /Módulos e recursos/);
assert.match(settings, /ModuleDiscoveryInterstitial/);
assert.doesNotMatch(settings, /R\$|baseUnitAmountCents|promotionalMonthlyAmountCents/);
assert.match(discovery, /role="dialog"/);
assert.match(discovery, /aria-modal="true"/);
assert.match(discovery, /event\.key === 'Escape'/);
assert.match(discovery, /aria-live="polite"/);
assert.match(discovery, /permission_only/);
assert.match(discovery, /legacy_full_not_sellable/);
assert.doesNotMatch(discovery, /clinical_core:\s*\{/);
assert.match(discovery, /Revisar contratação/);
assert.match(discovery, /Preparar condição/);
assert.match(discovery, /requires_action/);
assert.match(discovery, /Pagamento em processamento/);
assert.match(discovery, /entitlementGranted === true/);
assert.match(discovery, /await loadEligibility\(\)/);

console.log('moduleUpgradeV5S1Finalization.regression.test.mjs: ok');
