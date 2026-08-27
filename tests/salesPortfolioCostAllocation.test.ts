import assert from 'node:assert/strict';
import {
  applySalesPortfolioCostAllocation,
  type SalesAssumptionSnapshot,
} from '../src/utils/salesProfitability';

const legacyCompatibilitySnapshot: SalesAssumptionSnapshot = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 12,
  name: 'Custos reais 08/2026',
  effectiveAt: '2026-08-27T00:00:00.000Z',
  values: {
    officialUnitAmountCents: 4990,
    meiDasMonthlyCents: 8605,
    supabaseMonthlyCostCents: 12874,
    railwayMonthlyCostCents: 2577,
    currentOperatingMarginTargetBasisPoints: 6000,
    stripeFeeBasisPoints: 469,
    stripeFixedFeeCents: 50,
    revenueTaxBasisPoints: 600,
    estimatedDelinquencyBasisPoints: 200,
    refundChargebackBasisPoints: 100,
    variablePatientCostCents: null,
    variableClinicCostCents: null,
    storageCostCents: null,
    egressCostCents: null,
    processingCostCents: null,
    notificationCostCents: null,
    otherVariableCostCents: null,
    monthlySupportClinicCostCents: null,
    supportPatientCostCents: null,
    monthlyOperationalCostCents: null,
    defaultOnboardingCostCents: null,
    commercialCommissionBasisPoints: 0,
    fixedMonthlyEligibleCostCents: 24405,
    fixedAllocationMethod: 'per_clinic',
    fixedAllocationPatientCount: null,
    fixedAllocationClinicCount: 1,
    customFixedAllocationCents: null,
    depreciationAmortizationCents: 10000,
    financialExpensesCents: 5000,
    profitTaxBasisPoints: 1500,
    otherBelowEbitdaCents: 7500,
    minimumMarginBasisPoints: 6000,
    healthyMarginBasisPoints: 6000,
    attentionMarginBasisPoints: 6000,
    usageProfiles: {
      intensive: {
        variablePatientCostCents: 9999,
        monthlySupportClinicCostCents: 9999,
      },
    },
  },
  sources: {},
};

const { assumptions, allocation } = applySalesPortfolioCostAllocation(
  legacyCompatibilitySnapshot,
  1,
);

assert.equal(allocation.modelVersion, '2026-08-portfolio-fixed-v2');
assert.equal(allocation.fixedCostPoolCents, 24056);
assert.equal(allocation.allocatedClinicCount, 2);
assert.equal(allocation.allocatedFixedCostCents, 12028);

assert.equal(assumptions.values.fixedMonthlyEligibleCostCents, 24056);
assert.equal(assumptions.values.fixedAllocationMethod, 'per_clinic');
assert.equal(assumptions.values.fixedAllocationClinicCount, 2);

// Histórico não pode vazar para novas propostas.
assert.equal(assumptions.values.revenueTaxBasisPoints, 0);
assert.equal(assumptions.values.estimatedDelinquencyBasisPoints, 0);
assert.equal(assumptions.values.refundChargebackBasisPoints, 0);
assert.equal(assumptions.values.monthlyOperationalCostCents, 0);
assert.equal(assumptions.values.depreciationAmortizationCents, 0);
assert.equal(assumptions.values.financialExpensesCents, 0);
assert.equal(assumptions.values.profitTaxBasisPoints, 0);
assert.equal(assumptions.values.otherBelowEbitdaCents, 0);
assert.deepEqual(assumptions.values.usageProfiles, {});

// A única referência de margem atual vem do campo operacional atual.
assert.equal(assumptions.values.minimumMarginBasisPoints, 6000);
assert.equal(assumptions.values.healthyMarginBasisPoints, 6000);
assert.equal(assumptions.values.attentionMarginBasisPoints, 6000);

const incomplete = applySalesPortfolioCostAllocation(
  {
    ...legacyCompatibilitySnapshot,
    values: {
      ...legacyCompatibilitySnapshot.values,
      railwayMonthlyCostCents: null,
    },
  },
  2,
);
assert.equal(incomplete.allocation.complete, false);
assert.equal(incomplete.assumptions.values.fixedMonthlyEligibleCostCents, null);
assert.equal(incomplete.assumptions.values.depreciationAmortizationCents, 0);
assert.equal(incomplete.assumptions.values.otherBelowEbitdaCents, 0);

console.log('salesPortfolioCostAllocation.test.ts: ok');
