import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SALES_PLATFORM_FOUNDATION_ITEM_KEY,
  calculateSalesModularProposal,
  type SalesModularProposalInput,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot
} from '../src/utils/salesModularProposal';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  buildFrozenStripeCheckoutPlan
} from '../src/utils/salesCommercialEvolution';
import {
  DEFAULT_SALES_PROFITABILITY_POLICY
} from '../src/utils/salesModularEconomics';
import type {
  SalesModularDriverKey,
  SalesModularDriverValue
} from '../src/utils/salesModularCostDrivers';
import {
  PACKAGE_TIERS,
  modularAssumptionsFixture,
  modularCatalogFixture,
  proposalInputFixture
} from './fixtures/salesModularFixture';

const effectiveAt = '2026-08-04T00:00:00.000Z';
const driver = (value: number): SalesModularDriverValue => ({
  value,
  source: 'estimated',
  sourceDetail: 'Driver versionado do teste da Fundação Verto.',
  effectiveAt,
  version: 1
});

const financeDrivers: SalesModularDriverKey[] = [
  'financialEntries',
  'financialReports',
  'recurringProcesses'
];
const financeProfile = {
  financialEntries: driver(100),
  financialReports: driver(5),
  recurringProcesses: driver(10)
};

const financeItem: SalesPricingCatalogItem = {
  id: 'finance-item',
  itemKey: 'financial_management',
  publicName: 'Financeiro e Gestão',
  internalName: 'Financeiro e Gestão',
  description: 'Módulo financeiro independente do módulo clínico.',
  pricingMode: 'flat_monthly',
  billingInterval: 'monthly',
  unitName: 'módulo',
  includedQuantity: null,
  maximumQuantity: null,
  recurringAmountCents: 9_900,
  oneTimeAmountCents: 0,
  sortOrder: 20,
  isRequired: false,
  isPublic: true,
  isActive: true,
  compatibleBasePackages: [],
  metadata: {},
  tiers: [],
  costModel: {
    id: 'finance-cost-v1',
    itemId: 'finance-item',
    version: 1,
    directFixedMonthlyCostCents: 0,
    directCostPerPatientCents: 0,
    directCostPerClinicCents: 0,
    directCostPerUsageUnitCents: 0,
    storageCostPerGbCents: 0,
    egressCostPerGbCents: 0,
    notificationCostPerUnitCents: 0,
    processingCostPerUnitCents: 0,
    otherVariableCostCents: 0,
    supportFixedMonthlyCostCents: 625,
    supportCostPerPatientCents: 0,
    operationalFixedMonthlyCostCents: 623,
    onboardingCostCents: 0,
    sharedCostAllocationWeight: 1,
    costSource: 'manual',
    sourceDetail: 'Custo financeiro versionado do teste.',
    effectiveAt,
    driverConfig: {
      schemaVersion: 2,
      requiredDrivers: financeDrivers,
      profiles: {
        light: financeProfile,
        standard: financeProfile,
        intensive: financeProfile
      },
      unitCostsCents: {
        financialEntries: 0,
        financialReports: 0,
        recurringProcesses: 0
      }
    }
  }
};

const catalogFixture = (): SalesPricingCatalogSnapshot => ({
  ...structuredClone(modularCatalogFixture),
  id: 'catalog-foundation-v1',
  version: 10,
  customCapacityPolicy: {
    ...DEFAULT_CUSTOM_CAPACITY_POLICY,
    blockSizePatients: 10
  },
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: {
    ...structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
    recurringTargetEbitdaMarginBasisPoints: 7000,
    postPromotionMinimumEbitdaMarginBasisPoints: 7000
  },
  hasVersionedProfitabilityPolicy: true,
  items: [
    ...structuredClone(modularCatalogFixture.items),
    structuredClone(financeItem)
  ]
});

const financeOnlyInput = (
  foundationMode: 'automatic_target' | 'manual' = 'automatic_target',
  foundationAmountCents: number | null = null
): SalesModularProposalInput => ({
  ...proposalInputFixture(10, PACKAGE_TIERS.upTo10.id),
  commercialPricingMode: 'manual_module_prices',
  platformFoundationPricingMode: foundationMode,
  platformFoundationMonthlyAmountCents: foundationAmountCents,
  offerStartsAt: effectiveAt,
  lines: [
    {
      itemKey: 'financial_management',
      tierId: null,
      quantity: 10,
      itemDiscountBasisPoints: 0,
      customRecurringAmountCents: 9_900,
      pricingEditMode: 'monthly_total'
    }
  ]
});

const catalog = catalogFixture();
const automatic = calculateSalesModularProposal(
  financeOnlyInput(),
  catalog,
  modularAssumptionsFixture
);

assert.equal(
  automatic.lines.filter(
    (line) => line.itemKey === SALES_PLATFORM_FOUNDATION_ITEM_KEY
  ).length,
  1,
  'a Fundação Verto deve aparecer exatamente uma vez'
);
assert.equal(
  automatic.lines.some((line) => line.itemKey === 'clinical_core'),
  false,
  'Financeiro deve calcular sem contratar o módulo clínico'
);
assert.equal(
  automatic.lines.some((line) => line.itemKey === 'financial_management'),
  true
);
assert.ok(
  Math.abs(Number(automatic.postPromotion.ebitdaMarginBasisPoints) - 7000) <= 2,
  'o modo automático deve completar a receita até a meta EBITDA de 70%'
);
assert.equal(
  automatic.platformFoundation.recurringAmountCents,
  automatic.platformFoundation.recommendedRecurringAmountCents
);
assert.equal(
  automatic.lines[0].promotional.sharedPlatformCostAllocatedCents,
  modularAssumptionsFixture.values.fixedMonthlyEligibleCostCents,
  'o custo compartilhado deve ser alocado uma única vez na Fundação'
);
assert.equal(
  automatic.lines[1].promotional.sharedPlatformCostAllocatedCents,
  0,
  'o módulo não deve repetir o custo compartilhado'
);

assert.equal(
  automatic.lines[0].promotional.fixedPaymentFeeAllocatedCents,
  modularAssumptionsFixture.values.stripeFixedFeeCents,
  'a tarifa fixa de cobrança deve aparecer uma única vez na Fundação'
);
assert.equal(
  automatic.lines[1].promotional.fixedPaymentFeeAllocatedCents,
  0,
  'o módulo não deve repetir a tarifa fixa de cobrança'
);

const legacyInput = financeOnlyInput('manual', 0);
delete legacyInput.platformFoundationPricingMode;
delete legacyInput.platformFoundationMonthlyAmountCents;
const legacyWithoutFoundationFields = calculateSalesModularProposal(
  legacyInput,
  catalog,
  modularAssumptionsFixture
);
assert.equal(
  legacyWithoutFoundationFields.platformFoundation.pricingMode,
  'manual',
  'snapshot anterior sem campos de Fundação deve preservar o total histórico'
);
assert.equal(
  legacyWithoutFoundationFields.platformFoundation.recurringAmountCents,
  0
);

const discountedInput = financeOnlyInput('manual', 10_000);
discountedInput.globalDiscountBasisPoints = 1000;
discountedInput.discountDurationMonths = 6;
const discounted = calculateSalesModularProposal(
  discountedInput,
  catalog,
  modularAssumptionsFixture
);
assert.equal(
  discounted.globalDiscountCents,
  1_990,
  'o desconto global deve ser calculado uma única vez sobre Fundação e módulos'
);
assert.equal(
  discounted.promotionalRecurringRevenueCents,
  17_910
);
assert.equal(
  discounted.commercialPhases[0].recurringRevenueCents,
  17_910,
  'a fase comercial não pode reaplicar o desconto global'
);
assert.equal(
  discounted.lines.reduce(
    (sum, line) => sum + line.allocatedGlobalDiscountCents,
    0
  ),
  1_990
);

const manualBelowTarget = calculateSalesModularProposal(
  financeOnlyInput('manual', 0),
  catalog,
  modularAssumptionsFixture
);
assert.equal(manualBelowTarget.economics?.canSend, true);
assert.ok(
  Number(manualBelowTarget.postPromotion.ebitdaMarginBasisPoints) < 7000
);
assert.equal(manualBelowTarget.rating, 'attention');
assert.ok(
  manualBelowTarget.platformFoundation.recommendedRecurringAmountCents !== null
);
assert.ok(
  manualBelowTarget.platformFoundation.recommendedRecurringAmountCents! > 0
);

const clinicalAndFinanceInput = financeOnlyInput();
clinicalAndFinanceInput.lines.unshift({
  itemKey: 'clinical_core',
  tierId: PACKAGE_TIERS.upTo10.id,
  quantity: 10,
  itemDiscountBasisPoints: 0,
  customRecurringAmountCents: 19_900,
  pricingEditMode: 'monthly_total'
});
const combined = calculateSalesModularProposal(
  clinicalAndFinanceInput,
  catalog,
  modularAssumptionsFixture
);
assert.equal(
  combined.lines.filter(
    (line) => line.itemKey === SALES_PLATFORM_FOUNDATION_ITEM_KEY
  ).length,
  1
);
assert.equal(
  combined.lines.reduce(
    (sum, line) =>
      sum + Number(line.postPromotion.sharedPlatformCostAllocatedCents || 0),
    0
  ),
  modularAssumptionsFixture.values.fixedMonthlyEligibleCostCents
);
assert.equal(
  combined.commercialPricing.capacityBlockPhases.every((phase) =>
    phase.modules.every(
      (module) => module.itemKey !== SALES_PLATFORM_FOUNDATION_ITEM_KEY
    )
  ),
  true,
  'a Fundação não deve ser cobrada de novo nos blocos de capacidade'
);
assert.equal(
  combined.commercialPhases.every(
    (phase) =>
      phase.lines.filter(
        (line) => line.itemKey === SALES_PLATFORM_FOUNDATION_ITEM_KEY
      ).length === 1
  ),
  true,
  'todas as fases devem preservar uma única linha de Fundação'
);

const checkoutPlan = buildFrozenStripeCheckoutPlan({
  phases: automatic.commercialPhases,
  capacity: automatic.basePackage.capacity,
  effectiveAt
});
assert.equal(
  checkoutPlan.initialLineItems.some(
    (line) => line.itemKey === SALES_PLATFORM_FOUNDATION_ITEM_KEY
  ),
  true,
  'o Checkout deve espelhar a Fundação como item próprio'
);
assert.equal(
  checkoutPlan.schedulePhases.every((phase) =>
    phase.items.some(
      (line) => line.itemKey === SALES_PLATFORM_FOUNDATION_ITEM_KEY
    )
  ),
  true
);
assert.equal(
  checkoutPlan.initialLineItems.reduce(
    (sum, line) => sum + line.unitAmountCents,
    0
  ),
  checkoutPlan.initialAmountCents
);

const migration = fs.readFileSync(
  'supabase/migrations/20260804010000_sales_platform_foundation_modularity.sql',
  'utf8'
);
assert.match(migration, /^--[\s\S]*\nbegin;/i);
assert.match(migration, /item_key in \('platform_foundation', 'clinical_core'\)/);
assert.match(migration, /when 'platform_foundation' then 0/);
assert.match(migration, /'platformFoundation', result->'platformFoundation'/);
assert.match(migration, /notify pgrst, 'reload schema';\s*\n\s*commit;/i);
assert.doesNotMatch(migration, /\b(update|delete)\s+public\.sales_offer_simulation_items\b/i);

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(
  server,
  /line\.itemKey === "platform_foundation"[\s\S]*line\.itemKey === "clinical_core"/
);
assert.match(
  server,
  /line\.itemKey === "platform_foundation"[\s\S]*\? -100/
);

assert.match(
  server,
  /canGeneratePublicOffer:\s*review\.canGeneratePublicOfferWithoutApproval/
);
assert.match(
  server,
  /stored\.platformFoundation\?\.schemaVersion/
);
assert.match(
  server,
  /stored\.platformFoundation\?\.publicName/
);
assert.match(
  server,
  /stored\.platformFoundation\?\.moduleRecurringRevenueCents/
);
assert.match(
  server,
  /stored\.platformFoundation\?\.fixedPaymentFeeCents/
);
assert.match(
  server,
  /stored\.platformFoundation\?\.automaticAmountAvailable/
);

const builder = fs.readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
assert.match(
  builder,
  /disabled=\{item\.isRequired && item\.itemKey !== 'clinical_core'\}/,
  'o módulo clínico legado deve poder ser removido mesmo marcado como required no catálogo'
);
assert.match(
  builder,
  /platformFoundationPricingMode: 'automatic_target'[\s\S]*platformFoundationMonthlyAmountCents: null/,
  'duplicar um cenário histórico deve modernizá-lo explicitamente'
);

console.log('salesPlatformFoundationModularity.test.ts: OK');
