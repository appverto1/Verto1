import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const migration = fs.readFileSync(
  'supabase/migrations/20260814190000_module_entitlement_stale_event_fence.sql',
  'utf8',
);

assert.match(migration, /create or replace function public\.apply_sales_offer_module_entitlements_v1/);
assert.match(migration, /add column if not exists last_stripe_event_created_at timestamptz/);
assert.match(migration, /create or replace function public\.apply_sales_offer_module_entitlements_v2/);
assert.match(migration, /older_event_for_current_subscription/);
assert.match(migration, /p_stripe_event_created_at < profile_row\.last_stripe_event_created_at/);
assert.match(server, /apply_sales_offer_module_entitlements_v2/);
assert.match(server, /p_stripe_event_created_at: params\.stripeEventCreatedAt/);
assert.match(server, /stripeEventCreatedAt: new Date\(event\.created \* 1000\)\.toISOString\(\)/);
assert.match(migration, /organization_module_access_profiles[\s\S]*?for update/);
assert.match(migration, /terminal_event_for_non_current_subscription/);
assert.match(migration, /event_for_superseded_offer/);
assert.match(migration, /duplicate_or_older_subscription_for_offer/);
assert.match(migration, /sales_checkout_links[\s\S]*?stripe_subscription_id/);
assert.match(migration, /'STALE_IGNORED'/);
assert.match(migration, /'ignoredStaleEvent', true/);
assert.match(migration, /incoming_offer_effective_at <= current_offer_effective_at/);
assert.doesNotMatch(migration, /delete\s+from/i, 'stale-event fence must never delete business data');
assert.doesNotMatch(migration, /truncate\s+/i, 'stale-event fence must never truncate business data');

console.log('moduleEntitlementStaleEventFence.test.mjs: ok');
