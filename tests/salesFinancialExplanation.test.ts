import assert from 'node:assert/strict';
import { buildSalesRecurringMoneyFlow } from '../src/utils/salesFinancialExplanation';
import type { SalesAssumptionSnapshot } from '../src/utils/salesProfitability';
import type { SalesModularConsolidatedPeriod } from '../src/utils/salesModularProposal';

const assumptions: SalesAssumptionSnapshot = {
  id: 'assumption-v4',
  version: 4,
  name: 'Premissas 04/08/2026',
  effectiveAt: '2026-08-04T20:16:00.991Z',
  sources: {},
  values: {
    officialUnitAmountCents: 0,
    stripeFeeBasisPoints: 399,
    stripeFixedFeeCents: 39,
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
    healthyMarginBasisPoints: 7000,
    attentionMarginBasisPoints: 6000
  }
};

const period: SalesModularConsolidatedPeriod = {
  recurringRevenueCents: 700000,
  directCostCents: 18603,
  percentageCostAllocatedCents: 90930,
  fixedPaymentFeeAllocatedCents: 39,
  transactionAndTaxCostAllocatedCents: 90969,
  sharedPlatformCostAllocatedCents: 24405,
  totalEstimatedCostCents: 133977,
  contributionMarginCents: 590428,
  contributionMarginBasisPoints: 8435,
  ebitdaCents: 566023,
  ebitdaMarginBasisPoints: 8086,
  belowEbitdaCostAllocatedCents: 22500,
  profitTaxAllocatedCents: 81528,
  netIncomeCents: 461995,
  netMarginBasisPoints: 6600,
  directCostBreakdown: {
    fixedCostCents: 0,
    patientCostCents: 12500,
    usageCostCents: 0,
    storageCostCents: 107,
    egressCostCents: 2246,
    notificationCostCents: 0,
    otherVariableCostCents: 0,
    supportCostCents: 0,
    operationalCostCents: 3750,
    includedStorageGb: 9.766,
    estimatedUsedStorageGb: 9.766,
    estimatedEgressGb: 48.828
  }
};

const flow = buildSalesRecurringMoneyFlow({
  period,
  assumptions,
  usageProfile: 'intensive',
  lines: []
});

assert.equal(flow.revenueCents, 700000);
assert.equal(flow.revenueDeductionsTotalCents, 90969);
assert.equal(flow.paymentFeesCents, 27969);
assert.equal(flow.lossProvisionCents, 21000);
assert.equal(flow.revenueTaxCents, 42000);
assert.equal(flow.totalTaxCents, 123528);
assert.equal(flow.directCostsTotalCents, 18603);
assert.equal(flow.contributionMarginCents, 590428);
assert.equal(flow.sharedOperatingCostsTotalCents, 24405);
assert.equal(flow.ebitdaCents, 566023);
assert.equal(flow.belowEbitdaExpensesTotalCents, 22500);
assert.equal(flow.profitTaxCents, 81528);
assert.equal(flow.netIncomeCents, 461995);
assert.equal(flow.totalEstimatedDeductionsCents, 238005);
assert.equal(flow.distributableCashCents, null);
assert.match(flow.distributableCashReason, /não é automaticamente dinheiro/i);
assert.equal(flow.reconciled, true);

const labels = flow.revenueDeductions.map((item) => item.label);
assert.ok(labels.includes('Impostos sobre faturamento'));
assert.ok(labels.includes('Stripe — tarifa percentual'));
assert.ok(labels.includes('Inadimplência estimada'));
assert.ok(labels.includes('Estornos e chargebacks'));

console.log('salesFinancialExplanation.test.ts: ok');
