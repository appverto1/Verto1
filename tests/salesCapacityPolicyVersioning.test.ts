import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql',
  'utf8'
);
const sqlTest = fs.readFileSync(
  'supabase/tests/20260728010000_sales_multidisciplinary_commercial_evolution_test.sql',
  'utf8'
);
const server = fs.readFileSync('server.ts', 'utf8');
const engine = fs.readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const catalogPanel = fs.readFileSync(
  'src/components/SalesPricingCatalogPanel.tsx',
  'utf8'
);

const schemaSection = migration.slice(
  0,
  migration.indexOf(
    'create or replace function public.clone_sales_pricing_catalog_version_v2'
  )
);
assert.doesNotMatch(
  schemaSection,
  /update\s+public\.sales_pricing_catalog_versions/i,
  'a migration não pode executar backfill em catálogos publicados'
);
assert.doesNotMatch(
  schemaSection,
  /alter column custom_capacity_policy set (default|not null)/i
);
assert.match(
  schemaSection,
  /custom_capacity_policy is null\s+or public\.sales_custom_capacity_policy_valid_v1/
);

const cloneFunction =
  migration.match(
    /create or replace function public\.clone_sales_pricing_catalog_version_v2[\s\S]*?\n\$function\$;/
  )?.[0] || '';
assert.match(
  cloneFunction,
  /custom_capacity_policy = coalesce\(\s*source\.custom_capacity_policy/
);
assert.match(cloneFunction, /target\.status = 'draft'/);
assert.doesNotMatch(
  cloneFunction,
  /update public\.sales_pricing_catalog_versions source/
);
assert.match(cloneFunction, /driver_config = source_cost\.driver_config/);
assert.match(
  cloneFunction,
  /other_variable_cost_cents = source_cost\.other_variable_cost_cents/
);

const saveFunction =
  migration.match(
    /create or replace function public\.save_sales_pricing_catalog_draft_v2[\s\S]*?\n\$function\$;/
  )?.[0] || '';
assert.match(saveFunction, /p_payload \? 'customCapacityPolicy'/);
assert.match(saveFunction, /sales_custom_capacity_policy_valid_v1/);
assert.match(saveFunction, /version_status <> 'draft'/);
assert.match(saveFunction, /PRICING_CUSTOM_CAPACITY_POLICY_INVALID/);

const publishFunction =
  migration.match(
    /create or replace function public\.publish_sales_pricing_catalog_version_v2[\s\S]*?\n\$function\$;/
  )?.[0] || '';
assert.match(publishFunction, /version_row\.custom_capacity_policy is null/);
assert.match(
  publishFunction,
  /PRICING_CATALOG_PUBLICATION_BLOCKED:CUSTOM_CAPACITY_POLICY/
);
assert.match(
  publishFunction,
  /'customCapacityPolicy', version_row\.custom_capacity_policy/
);
assert.match(publishFunction, /PRICING_CATALOG_PUBLICATION_BLOCKED:COST_OR_DRIVER/);
assert.match(publishFunction, /PRICING_CATALOG_PUBLICATION_BLOCKED:TOTAL_MISMATCH/);

const catalogMapper =
  server.match(
    /async function loadSalesPricingCatalog[\s\S]*?\n}\n\nconst SALES_MODULAR_DRIVER_KEYS/
  )?.[0] || '';
assert.match(
  catalogMapper,
  /customCapacityPolicy:[\s\S]*?\? version\.custom_capacity_policy\s*: null/
);
assert.doesNotMatch(catalogMapper, /DEFAULT_CUSTOM_CAPACITY_POLICY/);
assert.match(catalogMapper, /hasVersionedCustomCapacityPolicy/);

assert.doesNotMatch(engine, /DEFAULT_CUSTOM_CAPACITY_POLICY/);
assert.match(
  engine,
  /catalog\.status === 'active'\s*&&\s*validateCustomCapacityPolicy/
);
assert.match(
  engine,
  /let capacity = isCustomBaseTier && customCapacityPolicy/
);

assert.match(
  catalogPanel,
  /Catálogo comercial v\$\{Math\.max\([\s\S]*?— margem operacional modular/
);
assert.match(catalogPanel, /customCapacityPolicy: customCapacityPolicyDraft/);
assert.match(catalogPanel, /Blocos adicionais de capacidade/);

assert.match(sqlTest, /\bbegin;/i);
assert.match(sqlTest, /\brollback;/i);
assert.match(sqlTest, /sales_pricing_catalog_versions_immutable_v1/);
assert.match(sqlTest, /clone_sales_pricing_catalog_version_v2\(/);
assert.match(sqlTest, /save_sales_pricing_catalog_draft_v2\(/);
assert.match(sqlTest, /publish_sales_pricing_catalog_version_v2\(/);
assert.match(sqlTest, /V1_V2_CONTENT_HASH_CHANGED/);
assert.match(sqlTest, /HISTORICAL_CATALOG_POLICY_WAS_BACKFILLED/);
assert.match(sqlTest, /PUBLISHED_SNAPSHOT_POLICY_MISSING/);
assert.match(sqlTest, /ROLLBACK_DID_NOT_RESTORE_ACTIVE_CATALOG/);

console.log('salesCapacityPolicyVersioning.test.ts: ok');
