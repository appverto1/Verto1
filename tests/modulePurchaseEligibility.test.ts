import assert from 'node:assert/strict';
import { resolveModulePurchaseEligibility } from '../src/utils/modulePurchaseEligibility';

const capabilities = new Set<string>(['clinic.view', 'clinic.settings.edit', 'calendar.clinic.view']);

assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'clinical_core', accessMode: 'contract', entitlementStatus: null, actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'baseline_not_sellable');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'school_management', accessMode: 'legacy_full', entitlementStatus: null, actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'legacy_full_not_sellable');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'appointments_communication', accessMode: 'contract', entitlementStatus: 'active', actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'already_entitled');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'school_management', accessMode: 'contract', entitlementStatus: 'grace', actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'permission_only');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'financial_management', accessMode: 'contract', entitlementStatus: 'suspended', actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'billing_recovery');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'financial_management', accessMode: 'contract', entitlementStatus: 'cancelled', actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true }).state, 'cancelled_reactivation');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'financial_management', accessMode: 'contract', entitlementStatus: null, actorCapabilities: capabilities, isDemo: true, directOfferAvailable: true }).state, 'demo_forbidden');
assert.equal(resolveModulePurchaseEligibility({ moduleKey: 'financial_management', accessMode: 'contract', entitlementStatus: null, actorCapabilities: capabilities, isDemo: false, directOfferAvailable: false }).state, 'no_direct_price');
const eligible = resolveModulePurchaseEligibility({ moduleKey: 'financial_management', accessMode: 'contract', entitlementStatus: null, actorCapabilities: capabilities, isDemo: false, directOfferAvailable: true });
assert.equal(eligible.state, 'eligible');
assert.equal(eligible.canPurchase, true);

console.log('modulePurchaseEligibility: ok');
