import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260728020000_sales_modular_profitability_policy.sql',
  'utf8'
);
const sqlTest = readFileSync(
  'supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql',
  'utf8'
);
const server = readFileSync('server.ts', 'utf8');
const engine = readFileSync(
  'src/utils/salesModularProposal.ts',
  'utf8'
);
const economics = readFileSync(
  'src/utils/salesModularEconomics.ts',
  'utf8'
);
const builder = readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
const catalogPanel = readFileSync(
  'src/components/SalesPricingCatalogPanel.tsx',
  'utf8'
);
const requiresPolicyHelper = engine.slice(
  engine.indexOf(
    'export function salesModularProposalRequiresVersionedProfitabilityPolicy'
  ),
  engine.indexOf('export const salesPackageDemand')
);

assert.match(
  migration,
  /add column if not exists profitability_policy jsonb/
);
assert.match(
  migration,
  /alter column profitability_policy drop not null/
);
assert.match(
  migration,
  /profitability_policy is null\s+or public\.sales_profitability_policy_valid_v1/
);
assert.doesNotMatch(
  migration,
  /update public\.sales_pricing_catalog_versions\s+set profitability_policy[\s\S]*where status in \('active','archived'\)/i,
  'migration não pode fazer backfill de catálogos publicados'
);
assert.match(
  migration,
  /where target\.id = created_id[\s\S]*target\.status = 'draft'/
);
assert.match(
  migration,
  /create trigger sales_pricing_catalog_profitability_publish_v1/
);
assert.match(
  migration,
  /jsonb_set\([\s\S]*'\{profitabilityPolicy\}'/
);
assert.match(
  migration,
  /clone_sales_pricing_catalog_version_v3/
);
assert.match(
  migration,
  /save_sales_pricing_catalog_draft_v3/
);
assert.match(
  migration,
  /publish_sales_pricing_catalog_version_v3/
);
assert.match(
  migration,
  /"clinicMinimumEbitdaMarginBasisPoints":6000/
);
assert.match(
  migration,
  /"recurringTargetEbitdaMarginBasisPoints":7000/
);
assert.match(
  migration,
  /"moduleMinimumIncrementalMarginBasisPoints":7500/
);
assert.match(
  migration,
  /"moduleTargetIncrementalMarginBasisPoints":8000/
);

assert.match(sqlTest, /\bbegin;/i);
assert.match(sqlTest, /\brollback;/i);
assert.match(sqlTest, /clone_sales_pricing_catalog_version_v3\(/);
assert.match(sqlTest, /save_sales_pricing_catalog_draft_v3\(/);
assert.match(sqlTest, /publish_sales_pricing_catalog_version_v3\(/);
assert.match(sqlTest, /PROFITABILITY_POLICY_MISSING_FROM_SNAPSHOT/);
assert.match(sqlTest, /HISTORICAL_SNAPSHOT_CHANGED/);
assert.match(sqlTest, /CHECKOUT_OR_ACTIVATION_CHANGED/);
assert.match(sqlTest, /HISTORICAL_CATALOG_WAS_BACKFILLED/);
assert.doesNotMatch(sqlTest, /PUBLISHED_CATALOG_WAS_BACKFILLED/);
assert.match(
  sqlTest,
  /"clinicMinimumEbitdaMarginBasisPoints":5500/
);
assert.match(
  sqlTest,
  /"postPromotionMinimumEbitdaMarginBasisPoints":6500/
);
assert.match(
  sqlTest,
  /"moduleMinimumIncrementalMarginBasisPoints":7000/
);
assert.match(
  sqlTest,
  /"moduleTargetIncrementalMarginBasisPoints":7500/
);
assert.match(sqlTest, /clone_default_policy jsonb :=/);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"clinicMinimumEbitdaMarginBasisPoints":6000/
);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"recurringTargetEbitdaMarginBasisPoints":7000/
);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"moduleTargetIncrementalMarginBasisPoints":8000/
);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"moduleMinimumIncrementalMarginBasisPoints":7500/
);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"capacityMinimumIncrementalMarginBasisPoints":7500/
);
assert.match(
  sqlTest,
  /clone_default_policy[\s\S]*"postPromotionMinimumEbitdaMarginBasisPoints":7000/
);
assert.match(
  sqlTest,
  /expected_clone_policy := coalesce\(source_policy, clone_default_policy\)/
);
assert.match(
  sqlTest,
  /result->'profitability_policy' is distinct from expected_clone_policy/
);
assert.match(
  sqlTest,
  /'profitabilityPolicy',policy[\s\S]*PROFITABILITY_POLICY_NOT_PERSISTED/
);

assert.match(
  server,
  /profitabilityPolicy: validateSalesProfitabilityPolicy\([\s\S]*\? version\.profitability_policy\s*: null/
);
assert.match(server, /clone_sales_pricing_catalog_version_v3/);
assert.match(server, /save_sales_pricing_catalog_draft_v3/);
assert.match(server, /publish_sales_pricing_catalog_version_v3/);
assert.match(server, /PROPOSAL_MARGIN_POLICY_REVIEW_REQUIRED/);
assert.match(server, /MODULAR_CHECKOUT_MARGIN_POLICY_REVIEW_REQUIRED/);
assert.match(server, /SALES_PROFITABILITY_POLICY_REQUIRED_CODE/);
assert.match(
  server,
  /salesCatalogHasVersionedProfitabilityPolicy\(catalog\)/
);
assert.match(
  engine,
  /export function salesModularProposalRequiresVersionedProfitabilityPolicy/
);
assert.match(
  engine,
  /item\.itemKey === 'clinical_core' && item\.isActive/
);
assert.match(
  engine,
  /tier\.id === input\.basePackageTierId/
);
assert.match(
  engine,
  /selectedTier\.isCustom \|\| selectedTier\.maximumQuantity === null/
);
assert.doesNotMatch(
  requiresPolicyHelper,
  /patientQuantity|expectedPatientQuantity12Months|supabase|fetch\(|\.from\(|\.rpc\(/
);
assert.match(
  server,
  /salesModularProposalRequiresVersionedProfitabilityPolicy\(\s*input,\s*catalog,?\s*\)[\s\S]*!salesCatalogHasVersionedProfitabilityPolicy\(catalog\)/
);
assert.match(
  server,
  /const input = normalizeSalesModularProposalRequest\(\s*simulation\.modular_input_snapshot,[\s\S]*const requiresVersionedProfitabilityPolicy =[\s\S]*salesModularProposalRequiresVersionedProfitabilityPolicy\(\s*input,\s*catalog,?\s*\)/
);
assert.match(
  server,
  /!historicalPublishedOffer[\s\S]*&& requiresVersionedProfitabilityPolicy[\s\S]*!salesCatalogHasVersionedProfitabilityPolicy\(catalog\)[\s\S]*!hasVersionedEconomicSnapshot/
);
assert.match(server, /historicalPublishedOffer/);
assert.match(
  server,
  /if \(historicalPublishedOffer\) \{[\s\S]*\.from\("sales_offers"\)[\s\S]*\.eq\("simulation_id", simulationId\)[\s\S]*deriveSalesOfferPublicToken\([\s\S]*return res\.status\(200\)\.json/
);
const publishedOfferRecovery = server.slice(
  server.indexOf('if (historicalPublishedOffer) {'),
  server.indexOf('const [catalog, assumptionResult] = await Promise.all([')
);
assert.doesNotMatch(
  publishedOfferRecovery,
  /loadSalesPricingCatalog|calculateSalesModularProposal|create_sales_modular_offer_v1|\.update\(|\.upsert\(|\.insert\(/
);
assert.match(server, /hasVersionedEconomicSnapshot/);
assert.match(server, /sendSalesProfitabilityPolicyRequired\(res\)/);
assert.doesNotMatch(
  server,
  /if \(!salesCatalogHasVersionedProfitabilityPolicy\(catalog\)\) \{\s*return sendSalesProfitabilityPolicyRequired\(res\);/
);
assert.match(server, /policyHash: salesCommercialApprovalPolicyHash/);
assert.doesNotMatch(server, /PROPOSAL_EBITDA_POLICY_BLOCKED/);
assert.doesNotMatch(server, /MODULAR_CHECKOUT_EBITDA_POLICY_BLOCKED/);
assert.match(
  server,
  /const frozenResults =[\s\S]*const frozenReview = classifySalesProposalReview\(frozenResults\)/
);

assert.match(
  engine,
  /sharedPlatformCosts: profitabilityPolicy[\s\S]*'base_package'/
);
assert.match(
  engine,
  /stripeFixed: profitabilityPolicy[\s\S]*'base_package'/
);
assert.match(engine, /SALES_MODULAR_ECONOMICS_MODEL_VERSION/);
assert.match(engine, /economics\?\.requiresJustification/);
assert.match(engine, /CLINIC_MARGIN_BELOW_MINIMUM/);
assert.match(engine, /POST_PROMOTION_MARGIN_BELOW_MINIMUM/);
assert.match(engine, /MODULE_MARGIN_BELOW_MINIMUM:/);
assert.match(engine, /CAPACITY_MARGIN_BELOW_MINIMUM/);
assert.match(engine, /EXPANSION_MARGIN_BELOW_MINIMUM:/);
assert.doesNotMatch(engine, /CLINIC_MARGIN_BELOW_60/);
assert.doesNotMatch(engine, /POST_PROMOTION_MARGIN_BELOW_70/);
assert.doesNotMatch(engine, /MODULE_MARGIN_BELOW_75/);
assert.doesNotMatch(engine, /CAPACITY_MARGIN_BELOW_75/);
assert.doesNotMatch(engine, /EXPANSION_MARGIN_BELOW_75/);
assert.match(engine, /ECONOMICS_INSUFFICIENT_DATA/);
assert.match(engine, /catalog\.status !== 'archived'/);
assert.match(engine, /formatSalesBasisPointsPercent/);

assert.match(
  economics,
  /1 - targetEbitdaMargin|denominatorBasisPoints/
);
assert.match(economics, /calculateSalesDriverExpansion/);
assert.match(economics, /calculateSalesModuleEffect/);
assert.match(economics, /SALES_EXPANSION_DRIVER_BY_ITEM/);
assert.match(economics, /classifyModuleIncrementalMargin/);
assert.match(economics, /formatSalesIncrementalMarginStatusLabel/);
assert.match(economics, /CLINIC_MARGIN_BELOW_TARGET/);
assert.match(economics, /PRICING_PROFITABILITY_POLICY_REQUIRED/);
assert.match(
  economics,
  /Publique uma nova versão do catálogo com a política de margem antes de criar propostas personalizadas\./
);
assert.match(economics, /Compatibilidade exclusiva para leitura de snapshots históricos/);

assert.match(builder, /Economia da clínica/);
assert.match(builder, /Simular escala e módulos/);
assert.match(builder, /\[150, 160, 170, 200\]/);
assert.match(builder, /Apenas Verto Clínica/);
assert.match(builder, /profitabilityThresholdColumns/);
assert.match(builder, /formatSalesIncrementalMarginStatusLabel/);
assert.match(builder, /profitabilityPolicyRequired/);
assert.match(
  builder,
  /proposalRequiresVersionedProfitabilityPolicy =[\s\S]*salesModularProposalRequiresVersionedProfitabilityPolicy\(input, catalog\)/
);
assert.match(
  builder,
  /catalog\?\.status === 'active' &&[\s\S]*proposalRequiresVersionedProfitabilityPolicy &&[\s\S]*!hasValidVersionedProfitabilityPolicy/
);
assert.match(
  builder,
  /selectedSimulationRequiresVersionedProfitabilityPolicy/
);
assert.match(
  builder,
  /!selectedSimulation\.offer &&[\s\S]*selectedSimulationRequiresVersionedProfitabilityPolicy &&[\s\S]*!selectedSimulationHasVersionedEconomics/
);
assert.match(
  builder,
  /propostas padrão salvas permanecem disponíveis/
);
assert.match(builder, /SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE/);
assert.match(builder, /Clone.*publique.*nova versão/is);
assert.match(
  builder,
  /if \(!input \|\| !catalog \|\| !assumptions \|\| profitabilityPolicyRequired\)/
);
assert.doesNotMatch(
  builder,
  /catalog\?\.status === 'active' && !hasValidVersionedProfitabilityPolicy/
);
assert.doesNotMatch(builder, /Mín\.\s*(?:55|60|65|70|75|80)%/);
assert.doesNotMatch(
  `${engine}\n${builder}`,
  /margem mínima de 60%|pelo menos 70%|margem incremental mínima de 75%/i
);
assert.match(catalogPanel, /Política de margem operacional atribuída/);
assert.match(catalogPanel, /Franquias e excedentes por driver/);
assert.match(catalogPanel, /margem operacional modular/);

console.log('salesProfitabilityPolicyVersioning.test.ts: OK');
