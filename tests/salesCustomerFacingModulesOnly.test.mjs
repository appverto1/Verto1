import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const builder = readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
const draftInput = readFileSync('src/utils/salesModularProposalBuilderInput.ts', 'utf8');
const publicOffer = readFileSync(
  'src/components/PublicSalesOffer.tsx',
  'utf8'
);
const offerDetails = readFileSync('src/components/ModularPublicOfferDetails.tsx','utf8');
const migration = readFileSync(
  'supabase/migrations/20260814154500_sales_customer_facing_modules_only.sql',
  'utf8'
);

const modularSimulationSave =
  server.match(
    /app\.post\(\s*"\/api\/owner\/sales\/leads\/:leadId\/modular-simulations"[\s\S]*?app\.patch\(/
  )?.[0] || '';
const publicOfferRoute =
  server.match(
    /app\.get\(\s*"\/api\/public\/sales-offers\/:token"[\s\S]*?app\.post\(\s*"\/api\/public\/sales-offers\/:token\/accept"/
  )?.[0] || '';
const modularCheckout =
  server.match(
    /const createOrReuseModularCheckout = async[\s\S]*?app\.post\(\s*"\/api\/owner\/sales\/offers\/:offerId\/modular-checkout"/
  )?.[0] || '';

assert.match(builder, /platformFoundationPricingMode: 'manual'/);
assert.match(builder, /platformFoundationMonthlyAmountCents: 0/);
assert.match(draftInput, /const SALES_FUNCTIONAL_MODULE_KEYS = \[/);
assert.match(builder, /isSalesFunctionalModuleItemKey/);
assert.match(builder, /Custos compartilhados da plataforma/);
assert.match(builder, /não são vendidos como módulo/);
assert.doesNotMatch(
  builder,
  /SALES_PLATFORM_FOUNDATION_PUBLIC_NAME/,
  'o construtor novo não deve depender do nome comercial da fundação'
);

assert.match(modularSimulationSave, /PROPOSAL_ITEM_NOT_CUSTOMER_FACING/);
assert.match(
  modularSimulationSave,
  /platformFoundationPricingMode: "manual"[\s\S]*platformFoundationMonthlyAmountCents: 0/
);
assert.match(
  modularSimulationSave,
  /commercialPresentationVersion:[\s\S]*SALES_CUSTOMER_FACING_PRESENTATION_VERSION/
);
assert.match(
  modularSimulationSave,
  /!isSalesInternalCommercialItemKey\(line\.itemKey\)[\s\S]*line\.grossRecurringRevenueCents > 0/
);
assert.match(modularSimulationSave, /PROPOSAL_RECURRING_REVENUE_REQUIRED/);

assert.match(publicOfferRoute, /salesOfferUsesCustomerFacingModulesOnly/);
assert.match(publicOfferRoute, /customerFacingItems/);
assert.match(publicOfferRoute, /!isSalesInternalCommercialItemKey\(item\?\.item_key\)/);
assert.match(publicOfferRoute, /customerFacingCommercialPhases/);
assert.match(publicOfferRoute, /internalItemHasBillableValue/);

assert.match(modularCheckout, /internalStoredItemHasBillableValue/);
assert.match(modularCheckout, /internalPhaseHasBillableValue/);
assert.match(modularCheckout, /MODULAR_CHECKOUT_INTERNAL_LINE_NONZERO/);
assert.match(modularCheckout, /phases: checkoutPhases/);

assert.match(migration, /sales_offer_simulations_amount_check/);
assert.match(migration, /check \(\s*base_unit_amount_cents > 0/);
assert.match(migration, /SALES_SIMULATION_POSITIVE_BASE_REPAIR_REQUIRED/);
assert.match(migration, /SALES_OFFER_POSITIVE_BASE_REPAIR_REQUIRED/);
assert.match(migration, /presentation_version integer := 1/);
assert.match(migration, /commercialPresentationVersion/);
assert.match(migration, /item\.item_key = 'onboarding'/);
assert.match(migration, /PROPOSAL_INTERNAL_ITEM_NOT_ALLOWED/);
assert.match(migration, /PROPOSAL_INTERNAL_ITEM_NONZERO/);
assert.match(
  migration,
  /item\.item_key not in \('platform_foundation', 'onboarding'\)/
);
assert.match(migration, /item\.item_key = 'clinical_core'/);
assert.match(
  migration,
  /Historical behavior|historical behavior|Immutable historical behavior/
);

assert.match(offerDetails, /hasPlatformFoundation/);
assert.match(
  publicOffer,
  /Comece com os módulos necessários hoje/,
  'propostas v2 devem ter texto público sem Fundação Verto'
);

console.log('salesCustomerFacingModulesOnly.test.mjs: OK');
