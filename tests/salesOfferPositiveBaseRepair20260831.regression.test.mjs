import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const offerRoutes = readFileSync('services/ownerSalesOfferCreationRoutes.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260831040000_sales_modular_offer_positive_base_repair.sql',
  'utf8',
);

const ownerFinance = server.match(
  /const resolveOwnerOfferPhase = [\s\S]*?const loadOwnerAssumptionSets = async/,
)?.[0] || '';
const modularOfferPreparation = offerRoutes.match(
  /const prepareSalesModularOffer = async[\s\S]*?const prepareSalesOfferFromSimulation = async/,
)?.[0] || '';

// Root-cause repair: the customer-facing v2+ offer must never use the zero-value
// internal Foundation line as the structural positive base.
assert.match(migration, /create or replace function public\.create_sales_modular_offer_v1/);
assert.match(migration, /commercialPresentationVersion/);
assert.match(migration, /if presentation_version >= 2 then/);
assert.match(migration, /item\.item_key not in \('platform_foundation', 'onboarding'\)/);
assert.match(migration, /coalesce\(item\.gross_recurring_amount_cents, 0\) > 0/);
assert.match(migration, /case when item\.item_key = 'clinical_core' then 0 else 1 end/);
assert.match(migration, /base_line\.gross_recurring_amount_cents/);
assert.match(migration, /PROPOSAL_INTERNAL_ITEM_NONZERO/);

// Keep the positive invariant for new data, but do not rewrite immutable historical
// offers merely to validate a renamed constraint.
assert.match(migration, /drop constraint if exists sales_offers_amount_positive/);
assert.match(migration, /add constraint sales_offers_base_amount_check[\s\S]*base_unit_amount_cents > 0[\s\S]*not valid/);
assert.match(migration, /if not exists \([\s\S]*where base_unit_amount_cents <= 0[\s\S]*validate constraint sales_offers_base_amount_check/);
assert.doesNotMatch(migration, /update\s+public\.sales_offers\s+set\s+base_unit_amount_cents/i);
assert.match(migration, /create_sales_modular_offer_v2\(uuid,uuid,uuid,text,text,text,timestamptz\)/);
assert.match(migration, /notify pgrst, 'reload schema'/);

// Owner Finance must not depend on a sales_offers.discount_ends_at column that is
// absent from the canonical sales_offers schema. Historical fallback is derived from
// the frozen offer duration + accepted/created anchor; commercialPhases remain first.
assert.doesNotMatch(ownerFinance, /offer\?\.discount_ends_at/);
assert.doesNotMatch(ownerFinance, /post_discount_monthly_amount_cents,discount_ends_at/);
assert.match(ownerFinance, /discount_duration_months/);
assert.match(ownerFinance, /offer\?\.accepted_at \|\| offer\?\.created_at/);
assert.match(ownerFinance, /setUTCMonth\(end\.getUTCMonth\(\) \+ discountDurationMonths\)/);

// Until the SQL lands, surface the exact positive-base drift as a migration problem
// instead of another opaque 500.
assert.match(modularOfferPreparation, /positiveBaseSchemaDrift/);
assert.match(modularOfferPreparation, /sales_offers_\(\?:amount_positive\|base_amount_check\)/);
assert.match(modularOfferPreparation, /PROPOSAL_SCHEMA_MIGRATION_REQUIRED/);

console.log('salesOfferPositiveBaseRepair20260831.regression.test.mjs: OK');
