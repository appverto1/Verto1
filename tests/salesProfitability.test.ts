import assert from 'node:assert/strict';
import {
  calculateSalesProfitability,
  validateSalesSimulationInput,
  type SalesAssumptionSnapshot,
  type SalesAssumptionValues,
  type SalesSimulationInput,
} from '../src/utils/salesProfitability';

const completeValues: SalesAssumptionValues = {
  officialUnitAmountCents: 7990,
  stripeFeeBasisPoints: 399,
  stripeFixedFeeCents: 39,
  revenueTaxBasisPoints: 600,
  estimatedDelinquencyBasisPoints: 100,
  variablePatientCostCents: 450,
  variableClinicCostCents: 500,
  storageCostCents: 120,
  egressCostCents: 80,
  processingCostCents: 200,
  notificationCostCents: 50,
  otherVariableCostCents: 0,
  monthlySupportClinicCostCents: 600,
  supportPatientCostCents: 90,
  monthlyOperationalCostCents: 700,
  defaultOnboardingCostCents: 0,
  commercialCommissionBasisPoints: 500,
  fixedMonthlyEligibleCostCents: 120_000,
  fixedAllocationMethod: 'per_patient',
  fixedAllocationPatientCount: 1_000,
  fixedAllocationClinicCount: null,
  customFixedAllocationCents: null,
  depreciationAmortizationCents: 200,
  financialExpensesCents: 100,
  profitTaxBasisPoints: 1500,
  otherBelowEbitdaCents: 0,
  minimumMarginBasisPoints: 1200,
  healthyMarginBasisPoints: 2500,
  attentionMarginBasisPoints: 1200,
};

const snapshot = (
  overrides: Partial<SalesAssumptionValues> = {}
): SalesAssumptionSnapshot => ({
  id: 'assumption-1',
  version: 1,
  name: 'Premissas de teste',
  effectiveAt: '2026-07-24T12:00:00.000Z',
  values: { ...completeValues, ...overrides },
  sources: {},
});

const input = (
  overrides: Partial<SalesSimulationInput> = {}
): SalesSimulationInput => ({
  initialActivePatientQuantity: 10,
  baseUnitAmountCents: 7990,
  discountBasisPoints: 1000,
  discountDurationMonths: 12,
  offerValidityDays: 14,
  usageProfile: 'standard',
  customMonthlyCostCents: 0,
  onboardingCostCents: 0,
  ...overrides,
});

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('valida descontos de 0, 10, 50 e 100 por cento', () => {
  for (const discountBasisPoints of [0, 1000, 5000, 10_000]) {
    const discountDurationMonths = discountBasisPoints === 0 ? 0 : 12;
    assert.deepEqual(
      validateSalesSimulationInput(input({ discountBasisPoints, discountDurationMonths })),
      []
    );
    const result = calculateSalesProfitability(
      input({ discountBasisPoints, discountDurationMonths }),
      snapshot()
    );
    assert.equal(
      result.promotionalUnitAmountCents,
      Math.round(7990 * (10_000 - discountBasisPoints) / 10_000)
    );
  }
});

test('valida duracoes promocionais de 1, 12, 24 e 36 meses', () => {
  for (const discountDurationMonths of [1, 12, 24, 36]) {
    const result = calculateSalesProfitability(
      input({ discountDurationMonths }),
      snapshot()
    );
    assert.equal(
      result.horizons['36'].promotionalMonths,
      discountDurationMonths
    );
  }
});

test('calcula quantidades de 1, 10 e 100 pacientes sem arredondamento monetario fracionario', () => {
  for (const initialActivePatientQuantity of [1, 10, 100]) {
    const result = calculateSalesProfitability(
      input({ initialActivePatientQuantity }),
      snapshot()
    );
    assert.equal(
      result.promotionalMonthlyRevenueCents,
      initialActivePatientQuantity * result.promotionalUnitAmountCents
    );
    assert.equal(Number.isInteger(result.promotional.revenueCents), true);
    assert.equal(Number.isInteger(result.promotional.stripeCostCents), true);
  }
});

test('arredonda preco promocional uma unica vez em centavos', () => {
  const result = calculateSalesProfitability(
    input({
      baseUnitAmountCents: 7990,
      discountBasisPoints: 3333,
      discountDurationMonths: 1,
    }),
    snapshot()
  );
  assert.equal(result.promotionalUnitAmountCents, 5327);
  assert.equal(result.promotionalMonthlyRevenueCents, 53_270);
});

test('calcula horizontes de 12, 24 e 36 meses sem reiniciar a promocao', () => {
  const result = calculateSalesProfitability(
    input({ discountDurationMonths: 12, onboardingCostCents: 10_000 }),
    snapshot()
  );
  assert.deepEqual(
    Object.keys(result.horizons),
    ['12', '24', '36']
  );
  assert.equal(result.horizons['24'].promotionalMonths, 12);
  assert.equal(result.horizons['24'].fullPriceMonths, 12);
  assert.equal(
    result.horizons['24'].revenueCents,
    result.promotional.revenueCents * 12 + result.postDiscount.revenueCents * 12
  );
});

test('classifica margem negativa como nao recomendada e exige justificativa', () => {
  const result = calculateSalesProfitability(
    input(),
    snapshot({
      variablePatientCostCents: 20_000,
      minimumMarginBasisPoints: 1200,
      healthyMarginBasisPoints: 2500,
      attentionMarginBasisPoints: 1200,
    })
  );
  assert.equal(result.rating, 'not_recommended');
  assert.equal(result.requiresJustification, true);
  assert.ok(Number(result.promotional.ebitdaCents) < 0);
});

test('retorna dados insuficientes sem transformar null em custo zero', () => {
  const result = calculateSalesProfitability(
    input(),
    snapshot({
      stripeFeeBasisPoints: null,
      revenueTaxBasisPoints: null,
      variablePatientCostCents: null,
    })
  );
  assert.equal(result.promotional.stripeCostCents, null);
  assert.equal(result.promotional.variableCostsCents, null);
  assert.equal(result.promotional.ebitdaCents, null);
  assert.equal(result.rating, 'insufficient_data');
  assert.ok(result.missingAssumptions.includes('stripeFeeBasisPoints'));
});

test('desconto integral mantem resultado matematico sem dividir por receita zero', () => {
  const result = calculateSalesProfitability(
    input({ discountBasisPoints: 10_000, discountDurationMonths: 1 }),
    snapshot()
  );
  assert.equal(result.promotionalUnitAmountCents, 0);
  assert.equal(result.promotional.revenueCents, 0);
  assert.equal(result.promotional.ebitdaMarginBasisPoints, null);
  assert.equal(result.promotional.netIncomeToEbitdaBasisPoints, null);
});

test('LL sobre EBITDA fica indisponivel quando o EBITDA nao e positivo', () => {
  const result = calculateSalesProfitability(
    input(),
    snapshot({ monthlyOperationalCostCents: 1_000_000 })
  );
  assert.ok(Number(result.promotional.ebitdaCents) < 0);
  assert.equal(result.promotional.netIncomeToEbitdaBasisPoints, null);
});

test('break-even pode ser impossivel sem inventar uma quantidade', () => {
  const result = calculateSalesProfitability(
    input(),
    snapshot({
      stripeFeeBasisPoints: 0,
      stripeFixedFeeCents: 0,
      revenueTaxBasisPoints: 0,
      variablePatientCostCents: 9000,
      variableClinicCostCents: 0,
      storageCostCents: 0,
      egressCostCents: 0,
      processingCostCents: 0,
      notificationCostCents: 0,
      otherVariableCostCents: 0,
      monthlySupportClinicCostCents: 0,
      supportPatientCostCents: 0,
      monthlyOperationalCostCents: 0,
      fixedAllocationMethod: 'none',
      fixedMonthlyEligibleCostCents: 0,
    })
  );
  assert.equal(result.breakEven.contributionPositiveQuantity, null);
  assert.equal(result.breakEven.nonNegativeEbitdaQuantity, null);
});

test('aceita custos variaveis zero sem confundir zero com dado ausente', () => {
  const result = calculateSalesProfitability(
    input(),
    snapshot({
      stripeFeeBasisPoints: 0,
      stripeFixedFeeCents: 0,
      revenueTaxBasisPoints: 0,
      estimatedDelinquencyBasisPoints: 0,
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
      fixedAllocationMethod: 'none',
      fixedMonthlyEligibleCostCents: 0,
    })
  );
  assert.equal(result.promotional.variableCostsCents, 0);
  assert.equal(result.promotional.contributionMarginCents, result.promotional.revenueCents);
  assert.equal(result.missingAssumptions.length, 0);
});

test('trata EBITDA zero e lucro liquido negativo sem razao enganosa', () => {
  const zeroEbitda = calculateSalesProfitability(
    input({
      initialActivePatientQuantity: 1,
      discountBasisPoints: 0,
      discountDurationMonths: 0,
    }),
    snapshot({
      stripeFeeBasisPoints: 0,
      stripeFixedFeeCents: 0,
      revenueTaxBasisPoints: 0,
      estimatedDelinquencyBasisPoints: 0,
      variablePatientCostCents: 0,
      variableClinicCostCents: 0,
      storageCostCents: 0,
      egressCostCents: 0,
      processingCostCents: 0,
      notificationCostCents: 0,
      otherVariableCostCents: 0,
      monthlySupportClinicCostCents: 0,
      supportPatientCostCents: 0,
      monthlyOperationalCostCents: 7990,
      fixedAllocationMethod: 'none',
      fixedMonthlyEligibleCostCents: 0,
      depreciationAmortizationCents: 500,
      financialExpensesCents: 0,
      profitTaxBasisPoints: 0,
      otherBelowEbitdaCents: 0,
    })
  );
  assert.equal(zeroEbitda.promotional.ebitdaCents, 0);
  assert.equal(zeroEbitda.promotional.netIncomeCents, -500);
  assert.equal(zeroEbitda.promotional.netIncomeToEbitdaBasisPoints, null);
});

test('encontra break-even positivo quando a margem unitaria cobre o custo fixo', () => {
  const result = calculateSalesProfitability(
    input({
      initialActivePatientQuantity: 1,
      discountBasisPoints: 0,
      discountDurationMonths: 0,
    }),
    snapshot({
      stripeFeeBasisPoints: 0,
      stripeFixedFeeCents: 0,
      revenueTaxBasisPoints: 0,
      estimatedDelinquencyBasisPoints: 0,
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
      fixedAllocationMethod: 'custom',
      customFixedAllocationCents: 10_000,
      fixedMonthlyEligibleCostCents: 0,
    })
  );
  assert.equal(result.breakEven.contributionPositiveQuantity, 1);
  assert.equal(result.breakEven.nonNegativeEbitdaQuantity, 2);
});

test('aplica rateio por paciente, por clinica e sem rateio de forma distinta', () => {
  const byPatient = calculateSalesProfitability(
    input(),
    snapshot({
      fixedAllocationMethod: 'per_patient',
      fixedMonthlyEligibleCostCents: 100_000,
      fixedAllocationPatientCount: 100,
    })
  );
  const byClinic = calculateSalesProfitability(
    input(),
    snapshot({
      fixedAllocationMethod: 'per_clinic',
      fixedMonthlyEligibleCostCents: 100_000,
      fixedAllocationClinicCount: 20,
    })
  );
  const withoutAllocation = calculateSalesProfitability(
    input(),
    snapshot({
      fixedAllocationMethod: 'none',
      fixedMonthlyEligibleCostCents: 100_000,
    })
  );
  assert.equal(byPatient.promotional.fixedCostsAllocatedCents, 10_000);
  assert.equal(byClinic.promotional.fixedCostsAllocatedCents, 5_000);
  assert.equal(withoutAllocation.promotional.fixedCostsAllocatedCents, 0);
});

test('desconta onboarding e comissao comercial uma unica vez por horizonte', () => {
  const result = calculateSalesProfitability(
    input({ onboardingCostCents: 10_000 }),
    snapshot({ commercialCommissionBasisPoints: 500 })
  );
  const expectedOneTimeCost =
    10_000 + Math.round(result.promotional.revenueCents * 500 / 10_000);
  assert.equal(result.oneTimeCommercialCostCents, expectedOneTimeCost);
  assert.equal(
    result.horizons['12'].ebitdaCents,
    Number(result.promotional.ebitdaCents) * 12 - expectedOneTimeCost
  );
});

test('rejeita desconto e duracao inconsistentes e limites fora do contrato', () => {
  assert.ok(validateSalesSimulationInput(
    input({ discountBasisPoints: 0, discountDurationMonths: 12 })
  ).includes('discountConsistency'));
  assert.ok(validateSalesSimulationInput(
    input({ discountBasisPoints: 1000, discountDurationMonths: 0 })
  ).includes('discountConsistency'));
  assert.ok(validateSalesSimulationInput(
    input({ discountBasisPoints: 10_001 })
  ).includes('discountBasisPoints'));
  assert.ok(validateSalesSimulationInput(
    input({ discountDurationMonths: 37 })
  ).includes('discountDurationMonths'));
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

console.log(`sales profitability tests passed: ${passed}/${tests.length}`);
