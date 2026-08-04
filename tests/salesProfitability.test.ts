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

const netIncomeResult = calculateSalesProfitability(
  {
    initialActivePatientQuantity: 1,
    baseUnitAmountCents: 100000,
    discountBasisPoints: 0,
    discountDurationMonths: 0,
    offerValidityDays: 14,
    usageProfile: 'standard',
    customMonthlyCostCents: 0,
    onboardingCostCents: 0
  },
  {
    ...modularAssumptionsFixture,
    values: {
      ...modularAssumptionsFixture.values,
      stripeFeeBasisPoints: 300,
      stripeFixedFeeCents: 50,
      revenueTaxBasisPoints: 500,
      estimatedDelinquencyBasisPoints: 100,
      refundChargebackBasisPoints: 50,
      variablePatientCostCents: 0,
      variableClinicCostCents: 0,
      storageCostCents: 0,
      egressCostCents: 0,
      processingCostCents: 0,
      notificationCostCents: 0,
      otherVariableCostCents: 0,
      monthlySupportClinicCostCents: 0,
      supportPatientCostCents: 0,
      monthlyOperationalCostCents: 0,
      fixedMonthlyEligibleCostCents: 0,
      fixedAllocationMethod: 'none',
      depreciationAmortizationCents: 1000,
      financialExpensesCents: 500,
      otherBelowEbitdaCents: 450,
      profitTaxBasisPoints: 1000
    }
  }
);
assert.equal(netIncomeResult.promotional.refundChargebackCents, 500);
assert.equal(netIncomeResult.promotional.ebitdaCents, 90450);
assert.equal(netIncomeResult.promotional.ebitCents, 89450);
assert.equal(netIncomeResult.promotional.preTaxIncomeCents, 88500);
assert.equal(netIncomeResult.promotional.profitTaxCents, 8850);
assert.equal(netIncomeResult.promotional.netIncomeCents, 79650);

console.log('salesProfitability.test.ts: OK');
