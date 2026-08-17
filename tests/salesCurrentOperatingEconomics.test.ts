import assert from 'node:assert/strict';
import {
  calculateSalesCurrentOperatingSummary,
  filterSalesCurrentOperatingTechnicalBlockers,
  salesSnapshotUsesCurrentOperatingModel,
} from '../src/utils/salesCurrentOperatingEconomics';
import type { SalesAssumptionSnapshot } from '../src/utils/salesProfitability';

const assumptions: SalesAssumptionSnapshot = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 5,
  name: 'Custos reais 08/2026',
  effectiveAt: '2026-08-14T00:00:00.000Z',
  values: {
    officialUnitAmountCents: 100,
    meiDasMonthlyCents: 8605,
    supabaseMonthlyCostCents: 15000,
    railwayMonthlyCostCents: 12000,
    currentOperatingMarginTargetBasisPoints: 7000,
    stripeFeeBasisPoints: 399,
    stripeFixedFeeCents: 39,
    revenueTaxBasisPoints: 9999,
    estimatedDelinquencyBasisPoints: 9999,
    refundChargebackBasisPoints: 9999,
    variablePatientCostCents: 9999,
    variableClinicCostCents: 9999,
    storageCostCents: 9999,
    egressCostCents: 9999,
    processingCostCents: 9999,
    notificationCostCents: 9999,
    otherVariableCostCents: 9999,
    monthlySupportClinicCostCents: 9999,
    supportPatientCostCents: 9999,
    monthlyOperationalCostCents: 9999,
    defaultOnboardingCostCents: 9999,
    commercialCommissionBasisPoints: 9999,
    fixedMonthlyEligibleCostCents: 9999,
    fixedAllocationMethod: 'none',
    fixedAllocationPatientCount: null,
    fixedAllocationClinicCount: null,
    customFixedAllocationCents: null,
    depreciationAmortizationCents: 9999,
    financialExpensesCents: 9999,
    profitTaxBasisPoints: 9999,
    otherBelowEbitdaCents: 9999,
    minimumMarginBasisPoints: 0,
    healthyMarginBasisPoints: 9000,
    attentionMarginBasisPoints: 0,
    usageProfiles: {},
  },
  sources: {},
};

const result = calculateSalesCurrentOperatingSummary(230100, assumptions);
assert.equal(result.stripeFeeCents, 9220);
assert.equal(result.totalOperatingCostsCents, 44825);
assert.equal(result.operatingResultCents, 185275);
assert.equal(result.operatingMarginBasisPoints, 8052);
assert.equal(result.rating, 'healthy');
assert.deepEqual(result.missingFields, []);

// O modelo atual ignora propositalmente impostos percentuais, perdas, custos
// diretos por módulo, rateios e despesas contábeis do motor histórico.
assert.equal(result.operatingResultCents, 230100 - 8605 - 9220 - 15000 - 12000);

const incomplete = calculateSalesCurrentOperatingSummary(230100, {
  ...assumptions,
  values: {
    ...assumptions.values,
    supabaseMonthlyCostCents: null,
  },
});
assert.equal(incomplete.operatingResultCents, null);
assert.equal(incomplete.operatingMarginBasisPoints, null);
assert.equal(incomplete.rating, 'incomplete');
assert.ok(incomplete.missingFields.includes('supabaseMonthlyCostCents'));


assert.equal(
  salesSnapshotUsesCurrentOperatingModel({ currentOperatingSummary: result }),
  true
);
assert.equal(
  salesSnapshotUsesCurrentOperatingModel({
    currentOperatingSummary: { ...result, modelVersion: 'legacy-v1' },
  }),
  false
);


assert.deepEqual(
  filterSalesCurrentOperatingTechnicalBlockers([
    'PRICING_COST_MODEL_MISSING:clinical_core',
    'REQUIRED_DRIVER_MISSING:school_management:messages',
    'ECONOMICS_INSUFFICIENT_DATA',
    'COMMERCIAL_PRICE_PER_PATIENT_MISSING:clinical_core',
    'PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:financial_management',
    'PRICING_TOTAL_MISMATCH',
  ]),
  [
    'COMMERCIAL_PRICE_PER_PATIENT_MISSING:clinical_core',
    'PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:financial_management',
    'PRICING_TOTAL_MISMATCH',
  ]
);

console.log('salesCurrentOperatingEconomics.test.ts: ok');
