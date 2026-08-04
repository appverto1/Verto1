import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateSalesModularProposal,
  salesModularProposalRequiresVersionedProfitabilityPolicy,
  type SalesModularProposalInput
} from '../src/utils/salesModularProposal';
import {
  PACKAGE_TIERS,
  modularAssumptionsFixture,
  modularCatalogFixture
} from './fixtures/salesModularFixture';

const input: SalesModularProposalInput = {
  commercialPricingMode: 'manual_module_prices',
  patientQuantity: 8,
  expectedPatientQuantity12Months: 8,
  basePackageTierId: PACKAGE_TIERS.upTo10.id,
  basePackageSelectionMode: 'manual',
  customBasePackageLimit: null,
  customCapacityBlocks: null,
  customCapacitySelectionMode: 'automatic',
  lines: [{
    itemKey: 'clinical_core',
    tierId: PACKAGE_TIERS.upTo10.id,
    quantity: 8,
    itemDiscountBasisPoints: 0,
    pricingEditMode: 'monthly_total',
    proposedPricePerPatientCents: null,
    customRecurringAmountCents: 25_000,
    customOneTimeAmountCents: null
  }],
  globalDiscountBasisPoints: 1_000,
  discountDurationMonths: 6,
  offerValidityDays: 14,
  onboardingInstallments: 1,
  usageProfile: 'intensive',
  driverOverrides: {}
};

const result = calculateSalesModularProposal(
  input,
  structuredClone(modularCatalogFixture),
  structuredClone(modularAssumptionsFixture)
);
assert.equal(result.commercialPricing.enabled, true);
assert.equal(result.input.commercialPricingMode, 'manual_module_prices');
assert.equal(result.input.usageProfile, 'intensive');
assert.equal(result.lines[0].commercialPricing.editMode, 'monthly_total');
assert.equal(result.lines[0].grossRecurringRevenueCents, 25_000);
assert.equal(result.promotionalRecurringRevenueCents, 22_500);
assert.notEqual(result.promotional.totalEstimatedCostCents, null);
assert.notEqual(result.promotional.netIncomeCents, null);
assert.notEqual(result.promotional.netMarginBasisPoints, null);
assert.equal(salesModularProposalRequiresVersionedProfitabilityPolicy(input, modularCatalogFixture), true);

const builderSource = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
assert.doesNotMatch(builderSource, /Previsão de uso por driver/);
assert.doesNotMatch(builderSource, />\s*Perfil de uso\s*</);
assert.match(builderSource, /commercialPricingMode:\s*'manual_module_prices'/);
assert.match(builderSource, /usageProfile:\s*'intensive'/);
assert.match(builderSource, /Resultado por módulo/);
assert.match(builderSource, /Faturamento após descontos/);
assert.match(builderSource, /Lucro líquido/);
assert.match(builderSource, /Margem líquida/);
assert.match(builderSource, /Todas as simulações usam as premissas intensivas versionadas/);
console.log('salesManualModulePricingIntensive.test.ts: OK');
