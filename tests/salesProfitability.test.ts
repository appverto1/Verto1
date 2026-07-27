import assert from 'node:assert/strict';
import {
  calculateSalesProfitability,
  SALES_PROFITABILITY_MODEL_VERSION
} from '../src/utils/salesProfitability';
import { modularAssumptionsFixture } from './fixtures/salesModularFixture';

const result = calculateSalesProfitability(
  {
    initialActivePatientQuantity: 100,
    baseUnitAmountCents: 4000,
    discountBasisPoints: 0,
    discountDurationMonths: 0,
    offerValidityDays: 14,
    usageProfile: 'standard',
    customMonthlyCostCents: 0,
    onboardingCostCents: 0
  },
  modularAssumptionsFixture
);

assert.equal(result.modelVersion, SALES_PROFITABILITY_MODEL_VERSION);
assert.equal(result.officialMonthlyRevenueCents, 400000);
assert.equal(result.promotionalMonthlyRevenueCents, 400000);
assert.equal(result.missingAssumptions.length, 0);

console.log('salesProfitability.test.ts: OK');
