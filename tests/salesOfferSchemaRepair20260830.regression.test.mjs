import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260830183000_sales_offer_owner_finance_schema_repair.sql',
  'utf8'
);

const ownerFinanceLoader = server.match(
  /const loadOwnerSaasClients = async[\s\S]*?const loadOwnerAssumptionSets = async/
)?.[0] || '';
const modularOfferPreparation = server.match(
  /const prepareSalesModularOffer = async[\s\S]*?const prepareSalesOfferFromSimulation = async/
)?.[0] || '';

// Runtime compatibility: Owner Finance must not 500 during a staggered deploy
// merely because users.billing_source has not landed yet.
assert.match(ownerFinanceLoader, /loadOwnerRowsForFinance/);
assert.match(ownerFinanceLoader, /extractMissingColumnName\(primary\.error\) !== 'billing_source'/);
assert.match(ownerFinanceLoader, /billing_source: null/);
assert.match(ownerFinanceLoader, /users\.billing_source ausente/);

// The modular-offer route must expose an actionable schema-pending code and log
// the real DB/RPC diagnostic instead of collapsing everything into an opaque 500.
assert.match(modularOfferPreparation, /PROPOSAL_SCHEMA_MIGRATION_REQUIRED/);
assert.match(modularOfferPreparation, /create_sales_modular_offer_v3\|contract_email\|schema cache/);
assert.match(modularOfferPreparation, /Falha ao preparar proposta modular/);
assert.match(modularOfferPreparation, /extractMissingColumnName\(error\) === 'contract_email'/);

// Idempotent DB repair: add the missing Owner Finance metadata and restore the
// atomic v3 offer wrapper + contract identity boundary. No historical backfill.
assert.match(migration, /add column if not exists billing_source text/);
assert.match(migration, /add column if not exists complimentary_plan_granted_at timestamptz/);
assert.match(migration, /add column if not exists contract_email text/);
assert.match(migration, /create or replace function public\.create_sales_modular_offer_v3/);
assert.match(migration, /public\.create_sales_modular_offer_v2/);
assert.match(migration, /new\.contract_email is distinct from old\.contract_email/);
assert.match(migration, /notify pgrst, 'reload schema'/);
assert.doesNotMatch(migration, /update\s+public\.users\s+set\s+billing_source/i);
assert.doesNotMatch(migration, /update\s+public\.sales_offers\s+set\s+contract_email\s*=\s*[^\n]*from/i);

console.log('salesOfferSchemaRepair20260830.regression.test.mjs: OK');
