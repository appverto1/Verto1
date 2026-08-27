export type SimulationValueSource =
  | 'actual'
  | 'calculated'
  | 'estimated'
  | 'manual'
  | 'unavailable';

export type SalesUsageProfile = 'light' | 'standard' | 'intensive' | 'custom';
export type FixedCostAllocationMethod = 'per_patient' | 'per_clinic' | 'none' | 'custom';
export type OfferProfitabilityRating =
  | 'healthy'
  | 'attention'
  | 'not_recommended'
  | 'insufficient_data';

export type SalesAssumptionValues = {
  officialUnitAmountCents: number;
  meiDasMonthlyCents?: number | null;
  supabaseMonthlyCostCents?: number | null;
  railwayMonthlyCostCents?: number | null;
  currentOperatingMarginTargetBasisPoints?: number | null;
  stripeFeeBasisPoints: number | null;
  stripeFixedFeeCents: number | null;
  revenueTaxBasisPoints: number | null;
  estimatedDelinquencyBasisPoints: number | null;
  refundChargebackBasisPoints: number | null;
  variablePatientCostCents: number | null;
  variableClinicCostCents: number | null;
  storageCostCents: number | null;
  egressCostCents: number | null;
  processingCostCents: number | null;
  notificationCostCents: number | null;
  otherVariableCostCents: number | null;
  monthlySupportClinicCostCents: number | null;
  supportPatientCostCents: number | null;
  monthlyOperationalCostCents: number | null;
  defaultOnboardingCostCents: number | null;
  commercialCommissionBasisPoints: number | null;
  fixedMonthlyEligibleCostCents: number | null;
  fixedAllocationMethod: FixedCostAllocationMethod;
  fixedAllocationPatientCount: number | null;
  fixedAllocationClinicCount: number | null;
  customFixedAllocationCents: number | null;
  depreciationAmortizationCents: number | null;
  financialExpensesCents: number | null;
  profitTaxBasisPoints: number | null;
  otherBelowEbitdaCents: number | null;
  minimumMarginBasisPoints: number | null;
  healthyMarginBasisPoints: number | null;
  attentionMarginBasisPoints: number | null;
  usageProfiles?: Partial<Record<Exclude<SalesUsageProfile, 'custom'>, Partial<SalesAssumptionValues>>>;
};

export type SalesAssumptionSnapshot = {
  id: string;
  version: number;
  name: string;
  effectiveAt: string;
  values: SalesAssumptionValues;
  sources: Partial<Record<keyof SalesAssumptionValues, SimulationValueSource>>;
  sourceDetails?: Partial<Record<keyof SalesAssumptionValues, string>>;
};


export type SalesPortfolioCostAllocation = {
  modelVersion: '2026-08-portfolio-fixed-v2';
  taxRegime: 'mei';
  existingOperationalClinicCount: number;
  allocatedClinicCount: number;
  fixedCostPoolCents: number | null;
  allocatedFixedCostCents: number | null;
  complete: boolean;
};

export function applySalesPortfolioCostAllocation(
  snapshot: SalesAssumptionSnapshot,
  existingOperationalClinicCount: number
): { assumptions: SalesAssumptionSnapshot; allocation: SalesPortfolioCostAllocation } {
  const existingCount = Math.max(0, Math.floor(Number(existingOperationalClinicCount || 0)));
  const allocatedClinicCount = existingCount + 1;
  const values = snapshot.values;
  const fixedParts = [
    values.meiDasMonthlyCents,
    values.supabaseMonthlyCostCents,
    values.railwayMonthlyCostCents
  ];
  const complete = fixedParts.every((value) => value !== null && value !== undefined);
  const fixedCostPoolCents = complete
    ? fixedParts.reduce<number>((sum, value) => sum + Number(value || 0), 0)
    : null;
  const allocatedFixedCostCents = fixedCostPoolCents === null
    ? null
    : Math.round(fixedCostPoolCents / allocatedClinicCount);
  const allocation: SalesPortfolioCostAllocation = {
    modelVersion: '2026-08-portfolio-fixed-v2',
    taxRegime: 'mei',
    existingOperationalClinicCount: existingCount,
    allocatedClinicCount,
    fixedCostPoolCents,
    allocatedFixedCostCents,
    complete
  };

  const currentOperatingMarginTargetBasisPoints =
    values.currentOperatingMarginTargetBasisPoints ?? null;
  const currentModelOverrides: Partial<SalesAssumptionValues> = {
    // Everything below used to live in the legacy compatibility bucket. New
    // modular quotes get technical costs from the catalog cost models instead,
    // so keeping these global amounts would double count infrastructure,
    // support/operations or historical provisions.
    revenueTaxBasisPoints: 0,
    estimatedDelinquencyBasisPoints: 0,
    refundChargebackBasisPoints: 0,
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
    defaultOnboardingCostCents: 0,
    commercialCommissionBasisPoints: 0,
    depreciationAmortizationCents: 0,
    financialExpensesCents: 0,
    profitTaxBasisPoints: 0,
    otherBelowEbitdaCents: 0,
    minimumMarginBasisPoints: currentOperatingMarginTargetBasisPoints,
    healthyMarginBasisPoints: currentOperatingMarginTargetBasisPoints,
    attentionMarginBasisPoints: currentOperatingMarginTargetBasisPoints,
    // Prevent historical light/standard/intensive overrides from re-entering
    // the new quote after the base values above have been normalized.
    usageProfiles: {}
  };
  const currentModelSources: Partial<Record<keyof SalesAssumptionValues, SimulationValueSource>> = {
    revenueTaxBasisPoints: 'calculated',
    estimatedDelinquencyBasisPoints: 'calculated',
    refundChargebackBasisPoints: 'calculated',
    variablePatientCostCents: 'calculated',
    variableClinicCostCents: 'calculated',
    storageCostCents: 'calculated',
    egressCostCents: 'calculated',
    processingCostCents: 'calculated',
    notificationCostCents: 'calculated',
    otherVariableCostCents: 'calculated',
    monthlySupportClinicCostCents: 'calculated',
    supportPatientCostCents: 'calculated',
    monthlyOperationalCostCents: 'calculated',
    defaultOnboardingCostCents: 'calculated',
    commercialCommissionBasisPoints: 'calculated',
    depreciationAmortizationCents: 'calculated',
    financialExpensesCents: 'calculated',
    profitTaxBasisPoints: 'calculated',
    otherBelowEbitdaCents: 'calculated',
    ...(currentOperatingMarginTargetBasisPoints === null
      ? {}
      : {
          minimumMarginBasisPoints: 'calculated' as const,
          healthyMarginBasisPoints: 'calculated' as const,
          attentionMarginBasisPoints: 'calculated' as const
        })
  };
  const currentModelSourceDetails: Partial<Record<keyof SalesAssumptionValues, string>> = {
    revenueTaxBasisPoints:
      'Operação atual em MEI: o DAS mensal fixo substitui o percentual histórico sobre faturamento.',
    estimatedDelinquencyBasisPoints:
      'Premissa histórica isolada: sem provisão adicional configurada no modelo operacional atual.',
    refundChargebackBasisPoints:
      'Premissa histórica isolada: sem provisão adicional configurada no modelo operacional atual.',
    monthlyOperationalCostCents:
      'Premissa histórica isolada: custos técnicos e operacionais da nova proposta vêm dos modelos de custo do catálogo.',
    depreciationAmortizationCents:
      'Premissa histórica isolada: não entra no resumo operacional de novas propostas.',
    financialExpensesCents:
      'Premissa histórica isolada: não entra no resumo operacional de novas propostas.',
    profitTaxBasisPoints:
      'Operação atual em MEI: sem percentual adicional sobre lucro no modelo atual.',
    otherBelowEbitdaCents:
      'Premissa histórica isolada: não entra no resumo operacional de novas propostas.',
    ...(currentOperatingMarginTargetBasisPoints === null
      ? {}
      : {
          minimumMarginBasisPoints:
            'Derivada da margem operacional mínima desejada da operação atual.',
          healthyMarginBasisPoints:
            'Derivada da margem operacional mínima desejada da operação atual.',
          attentionMarginBasisPoints:
            'Derivada da margem operacional mínima desejada da operação atual.'
        })
  };

  if (!complete) {
    return {
      assumptions: {
        ...snapshot,
        values: {
          ...values,
          ...currentModelOverrides,
          // New quotes must never fall back to the historical fixed-cost bucket
          // when the current shared infrastructure pool is incomplete. Null keeps
          // profitability explicitly incomplete instead of inventing margin.
          fixedMonthlyEligibleCostCents: null,
          fixedAllocationMethod: 'per_clinic',
          fixedAllocationClinicCount: allocatedClinicCount
        },
        sources: {
          ...(snapshot.sources || {}),
          ...currentModelSources,
          fixedMonthlyEligibleCostCents: 'estimated',
          fixedAllocationClinicCount: 'calculated'
        },
        sourceDetails: {
          ...(snapshot.sourceDetails || {}),
          ...currentModelSourceDetails,
          fixedMonthlyEligibleCostCents:
            'Pool compartilhado incompleto: informe DAS MEI, Supabase e Railway para calcular margem sem repetir custos fixos históricos.',
          fixedAllocationClinicCount:
            `${existingCount} clínica(s) operacional(is) existentes + 1 nova proposta.`
        }
      },
      allocation
    };
  }

  const sourceDetails = {
    ...(snapshot.sourceDetails || {}),
    ...currentModelSourceDetails,
    fixedMonthlyEligibleCostCents:
      `Pool fixo mensal compartilhado: DAS MEI + Supabase + Railway. Rateado entre ${allocatedClinicCount} clínica(s), incluindo esta proposta.`,
    fixedAllocationClinicCount:
      `${existingCount} clínica(s) operacional(is) existentes + 1 nova proposta.`,
    revenueTaxBasisPoints:
      'Regime atual configurado como MEI: o DAS mensal fixo já integra o pool compartilhado; não aplicar percentual adicional de imposto sobre faturamento.',
    profitTaxBasisPoints:
      'Regime atual configurado como MEI: sem imposto percentual adicional sobre lucro neste modelo.'
  };

  return {
    assumptions: {
      ...snapshot,
      values: {
        ...values,
        ...currentModelOverrides,
        fixedMonthlyEligibleCostCents: fixedCostPoolCents,
        fixedAllocationMethod: 'per_clinic',
        fixedAllocationClinicCount: allocatedClinicCount,
        revenueTaxBasisPoints: 0,
        profitTaxBasisPoints: 0
      },
      sources: {
        ...snapshot.sources,
        ...currentModelSources,
        fixedMonthlyEligibleCostCents: 'calculated',
        fixedAllocationClinicCount: 'calculated',
        revenueTaxBasisPoints: 'calculated',
        profitTaxBasisPoints: 'calculated'
      },
      sourceDetails
    },
    allocation
  };
}

export type SalesSimulationInput = {
  initialActivePatientQuantity: number;
  baseUnitAmountCents: number;
  discountBasisPoints: number;
  discountDurationMonths: number;
  offerValidityDays: number;
  usageProfile: SalesUsageProfile;
  customMonthlyCostCents: number;
  onboardingCostCents: number;
};

export type MonthlyProfitabilityResult = {
  unitAmountCents: number;
  revenueCents: number;
  estimatedDelinquencyCents: number | null;
  refundChargebackCents: number | null;
  stripeCostCents: number | null;
  revenueTaxCents: number | null;
  variableCostsCents: number | null;
  operationalCostsCents: number | null;
  fixedCostsAllocatedCents: number | null;
  contributionMarginCents: number | null;
  contributionMarginBasisPoints: number | null;
  ebitdaCents: number | null;
  ebitdaMarginBasisPoints: number | null;
  ebitCents: number | null;
  preTaxIncomeCents: number | null;
  profitTaxCents: number | null;
  netIncomeCents: number | null;
  netMarginBasisPoints: number | null;
  netIncomeToEbitdaBasisPoints: number | null;
};

export type SalesProfitabilityResult = {
  modelVersion: string;
  input: SalesSimulationInput;
  promotionalUnitAmountCents: number;
  officialMonthlyRevenueCents: number;
  promotionalMonthlyRevenueCents: number;
  monthlySavingsCents: number;
  oneTimeCommercialCostCents: number | null;
  promotional: MonthlyProfitabilityResult;
  postDiscount: MonthlyProfitabilityResult;
  horizons: Record<'12' | '24' | '36', {
    months: number;
    promotionalMonths: number;
    fullPriceMonths: number;
    revenueCents: number;
    ebitdaCents: number | null;
    netIncomeCents: number | null;
  }>;
  breakEven: {
    contributionPositiveQuantity: number | null;
    nonNegativeEbitdaQuantity: number | null;
    minimumMarginQuantity: number | null;
  };
  rating: OfferProfitabilityRating;
  ratingMetric: 'ebitda_margin' | 'contribution_margin' | 'unavailable';
  requiresJustification: boolean;
  missingAssumptions: string[];
  warnings: string[];
};

export const SALES_PROFITABILITY_MODEL_VERSION = '2026-08-04-v3';

const nullableMoneyKeys: Array<keyof SalesAssumptionValues> = [
  'stripeFeeBasisPoints',
  'stripeFixedFeeCents',
  'revenueTaxBasisPoints',
  'refundChargebackBasisPoints',
  'variablePatientCostCents',
  'variableClinicCostCents',
  'storageCostCents',
  'egressCostCents',
  'processingCostCents',
  'notificationCostCents',
  'otherVariableCostCents',
  'monthlySupportClinicCostCents',
  'supportPatientCostCents',
  'monthlyOperationalCostCents',
  'defaultOnboardingCostCents',
  'commercialCommissionBasisPoints',
  'fixedMonthlyEligibleCostCents',
  'depreciationAmortizationCents',
  'financialExpensesCents',
  'profitTaxBasisPoints',
  'otherBelowEbitdaCents'
];

const isIntegerInRange = (value: unknown, min: number, max: number): value is number => (
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max
);

const multiplyBasisPoints = (amountCents: number, basisPoints: number) =>
  Math.round((amountCents * basisPoints) / 10_000);

const ratioBasisPoints = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || denominator <= 0) return null;
  return Math.round((numerator * 10_000) / denominator);
};

const sumNullable = (values: Array<number | null>): number | null =>
  values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;

const resolveAssumptionsForProfile = (
  values: SalesAssumptionValues,
  profile: SalesUsageProfile
): SalesAssumptionValues => {
  if (profile === 'custom') return values;
  return {
    ...values,
    ...(values.usageProfiles?.[profile] || {}),
    usageProfiles: values.usageProfiles
  };
};

const resolveFixedAllocation = (
  values: SalesAssumptionValues,
  quantity: number
): number | null => {
  if (values.fixedAllocationMethod === 'none') return 0;
  if (values.fixedAllocationMethod === 'custom') {
    return values.customFixedAllocationCents;
  }
  if (values.fixedMonthlyEligibleCostCents === null) return null;
  if (values.fixedAllocationMethod === 'per_patient') {
    if (!values.fixedAllocationPatientCount || values.fixedAllocationPatientCount <= 0) return null;
    return Math.round(
      (values.fixedMonthlyEligibleCostCents * quantity) / values.fixedAllocationPatientCount
    );
  }
  if (!values.fixedAllocationClinicCount || values.fixedAllocationClinicCount <= 0) return null;
  return Math.round(
    values.fixedMonthlyEligibleCostCents / values.fixedAllocationClinicCount
  );
};

const calculateMonthly = (
  quantity: number,
  unitAmountCents: number,
  values: SalesAssumptionValues,
  customMonthlyCostCents: number
): MonthlyProfitabilityResult => {
  const revenueCents = quantity * unitAmountCents;
  const estimatedDelinquencyCents = values.estimatedDelinquencyBasisPoints === null
    ? null
    : multiplyBasisPoints(revenueCents, values.estimatedDelinquencyBasisPoints);
  const refundChargebackCents = values.refundChargebackBasisPoints === null
    ? null
    : multiplyBasisPoints(revenueCents, values.refundChargebackBasisPoints);
  const stripeCostCents = values.stripeFeeBasisPoints === null || values.stripeFixedFeeCents === null
    ? null
    : multiplyBasisPoints(revenueCents, values.stripeFeeBasisPoints) + values.stripeFixedFeeCents;
  const revenueTaxCents = values.revenueTaxBasisPoints === null
    ? null
    : multiplyBasisPoints(revenueCents, values.revenueTaxBasisPoints);
  const variableCostsCents = nullableMoneyKeys
    .filter((key) => [
      'variablePatientCostCents',
      'variableClinicCostCents',
      'storageCostCents',
      'egressCostCents',
      'processingCostCents',
      'notificationCostCents',
      'otherVariableCostCents',
      'monthlySupportClinicCostCents',
      'supportPatientCostCents'
    ].includes(String(key)))
    .some((key) => values[key] === null)
    ? null
    : quantity * Number(values.variablePatientCostCents)
      + Number(values.variableClinicCostCents)
      + Number(values.storageCostCents)
      + Number(values.egressCostCents)
      + Number(values.processingCostCents)
      + Number(values.notificationCostCents)
      + Number(values.otherVariableCostCents)
      + Number(values.monthlySupportClinicCostCents)
      + quantity * Number(values.supportPatientCostCents)
      + customMonthlyCostCents;
  const operationalCostsCents = values.monthlyOperationalCostCents;
  const fixedCostsAllocatedCents = resolveFixedAllocation(values, quantity);
  const contributionDeductions = sumNullable([
    estimatedDelinquencyCents,
    refundChargebackCents,
    stripeCostCents,
    revenueTaxCents,
    variableCostsCents
  ]);
  const contributionMarginCents = contributionDeductions === null
    ? null
    : revenueCents - contributionDeductions;
  const ebitdaDeductions = sumNullable([
    contributionDeductions,
    operationalCostsCents,
    fixedCostsAllocatedCents
  ]);
  const ebitdaCents = ebitdaDeductions === null ? null : revenueCents - ebitdaDeductions;
  const ebitCents = ebitdaCents === null || values.depreciationAmortizationCents === null
    ? null
    : ebitdaCents - values.depreciationAmortizationCents;
  const preTaxDeductions = sumNullable([
    values.financialExpensesCents,
    values.otherBelowEbitdaCents
  ]);
  const preTaxIncomeCents = ebitCents === null || preTaxDeductions === null
    ? null
    : ebitCents - preTaxDeductions;
  const profitTaxCents = preTaxIncomeCents === null || values.profitTaxBasisPoints === null
    ? null
    : multiplyBasisPoints(Math.max(0, preTaxIncomeCents), values.profitTaxBasisPoints);
  const netIncomeCents = preTaxIncomeCents === null || profitTaxCents === null
    ? null
    : preTaxIncomeCents - profitTaxCents;

  return {
    unitAmountCents,
    revenueCents,
    estimatedDelinquencyCents,
    refundChargebackCents,
    stripeCostCents,
    revenueTaxCents,
    variableCostsCents,
    operationalCostsCents,
    fixedCostsAllocatedCents,
    contributionMarginCents,
    contributionMarginBasisPoints: contributionMarginCents === null
      ? null
      : ratioBasisPoints(contributionMarginCents, revenueCents),
    ebitdaCents,
    ebitdaMarginBasisPoints: ebitdaCents === null
      ? null
      : ratioBasisPoints(ebitdaCents, revenueCents),
    ebitCents,
    preTaxIncomeCents,
    profitTaxCents,
    netIncomeCents,
    netMarginBasisPoints: netIncomeCents === null
      ? null
      : ratioBasisPoints(netIncomeCents, revenueCents),
    netIncomeToEbitdaBasisPoints: netIncomeCents === null || ebitdaCents === null || ebitdaCents <= 0
      ? null
      : ratioBasisPoints(netIncomeCents, ebitdaCents)
  };
};

const findFirstQuantity = (predicate: (quantity: number) => boolean): number | null => {
  if (!predicate(100_000)) return null;
  let low = 1;
  let high = 100_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (predicate(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
};

export function validateSalesSimulationInput(input: SalesSimulationInput): string[] {
  const errors: string[] = [];
  if (!isIntegerInRange(input.initialActivePatientQuantity, 1, 100_000)) {
    errors.push('initialActivePatientQuantity');
  }
  if (!isIntegerInRange(input.baseUnitAmountCents, 1, 100_000_000)) {
    errors.push('baseUnitAmountCents');
  }
  if (!isIntegerInRange(input.discountBasisPoints, 0, 10_000)) {
    errors.push('discountBasisPoints');
  }
  if (!isIntegerInRange(input.discountDurationMonths, 0, 36)) {
    errors.push('discountDurationMonths');
  }
  if (
    (input.discountBasisPoints === 0 && input.discountDurationMonths !== 0)
    || (input.discountBasisPoints > 0 && input.discountDurationMonths === 0)
  ) {
    errors.push('discountConsistency');
  }
  if (!isIntegerInRange(input.offerValidityDays, 1, 90)) {
    errors.push('offerValidityDays');
  }
  if (!['light', 'standard', 'intensive', 'custom'].includes(input.usageProfile)) {
    errors.push('usageProfile');
  }
  if (!isIntegerInRange(input.customMonthlyCostCents, 0, 100_000_000)) {
    errors.push('customMonthlyCostCents');
  }
  if (!isIntegerInRange(input.onboardingCostCents, 0, 100_000_000)) {
    errors.push('onboardingCostCents');
  }
  return errors;
}

export function calculateSalesProfitability(
  input: SalesSimulationInput,
  assumptionSnapshot: SalesAssumptionSnapshot
): SalesProfitabilityResult {
  const invalidFields = validateSalesSimulationInput(input);
  if (invalidFields.length > 0) {
    throw new Error(`SIMULATION_INPUT_INVALID:${invalidFields.join(',')}`);
  }

  const values = resolveAssumptionsForProfile(assumptionSnapshot.values, input.usageProfile);
  const promotionalUnitAmountCents = Math.round(
    (input.baseUnitAmountCents * (10_000 - input.discountBasisPoints)) / 10_000
  );
  const officialMonthlyRevenueCents =
    input.initialActivePatientQuantity * input.baseUnitAmountCents;
  const promotionalMonthlyRevenueCents =
    input.initialActivePatientQuantity * promotionalUnitAmountCents;
  const promotional = calculateMonthly(
    input.initialActivePatientQuantity,
    promotionalUnitAmountCents,
    values,
    input.customMonthlyCostCents
  );
  const postDiscount = calculateMonthly(
    input.initialActivePatientQuantity,
    input.baseUnitAmountCents,
    values,
    input.customMonthlyCostCents
  );

  const horizons = [12, 24, 36].reduce<SalesProfitabilityResult['horizons']>(
    (accumulator, months) => {
      const promotionalMonths = Math.min(input.discountDurationMonths, months);
      const fullPriceMonths = months - promotionalMonths;
      const oneTimeCommercialCostCents =
        values.commercialCommissionBasisPoints === null
          ? null
          : input.onboardingCostCents
            + multiplyBasisPoints(
                promotional.revenueCents,
                values.commercialCommissionBasisPoints
              );
      const combine = (
        promotionalValue: number | null,
        fullPriceValue: number | null
      ) => promotionalValue === null
        || fullPriceValue === null
        || oneTimeCommercialCostCents === null
        ? null
        : promotionalValue * promotionalMonths
          + fullPriceValue * fullPriceMonths
          - oneTimeCommercialCostCents;
      accumulator[String(months) as '12' | '24' | '36'] = {
        months,
        promotionalMonths,
        fullPriceMonths,
        revenueCents:
          promotional.revenueCents * promotionalMonths
          + postDiscount.revenueCents * fullPriceMonths,
        ebitdaCents: combine(promotional.ebitdaCents, postDiscount.ebitdaCents),
        netIncomeCents: combine(promotional.netIncomeCents, postDiscount.netIncomeCents)
      };
      return accumulator;
    },
    {} as SalesProfitabilityResult['horizons']
  );

  const monthlyForQuantity = (quantity: number) => calculateMonthly(
    quantity,
    promotionalUnitAmountCents,
    values,
    input.customMonthlyCostCents
  );
  const minimumMargin = values.minimumMarginBasisPoints;
  const breakEven = {
    contributionPositiveQuantity: findFirstQuantity((quantity) => {
      const result = monthlyForQuantity(quantity).contributionMarginCents;
      return result !== null && result > 0;
    }),
    nonNegativeEbitdaQuantity: findFirstQuantity((quantity) => {
      const result = monthlyForQuantity(quantity).ebitdaCents;
      return result !== null && result >= 0;
    }),
    minimumMarginQuantity: minimumMargin === null
      ? null
      : findFirstQuantity((quantity) => {
          const result = monthlyForQuantity(quantity).ebitdaMarginBasisPoints;
          return result !== null && result >= minimumMargin;
        })
  };

  const ratingMargin = promotional.ebitdaMarginBasisPoints
    ?? promotional.contributionMarginBasisPoints;
  const ratingMetric = promotional.ebitdaMarginBasisPoints !== null
    ? 'ebitda_margin'
    : promotional.contributionMarginBasisPoints !== null
      ? 'contribution_margin'
      : 'unavailable';
  const targetMargin = values.healthyMarginBasisPoints;
  const rating: OfferProfitabilityRating =
    ratingMargin === null || targetMargin === null
      ? 'insufficient_data'
      : ratingMargin >= targetMargin
        ? 'healthy'
        : ratingMargin >= 0
          ? 'attention'
          : 'not_recommended';
  const requiredAssumptionKeys: Array<keyof SalesAssumptionValues> = [
    'stripeFeeBasisPoints',
    'stripeFixedFeeCents',
    'revenueTaxBasisPoints',
    'estimatedDelinquencyBasisPoints',
    'refundChargebackBasisPoints',
    'variablePatientCostCents',
    'variableClinicCostCents',
    'storageCostCents',
    'egressCostCents',
    'processingCostCents',
    'notificationCostCents',
    'otherVariableCostCents',
    'monthlySupportClinicCostCents',
    'supportPatientCostCents',
    'monthlyOperationalCostCents',
    'commercialCommissionBasisPoints',
    'depreciationAmortizationCents',
    'financialExpensesCents',
    'profitTaxBasisPoints',
    'otherBelowEbitdaCents',
    'minimumMarginBasisPoints',
    'healthyMarginBasisPoints',
    'attentionMarginBasisPoints',
  ];
  if (values.fixedAllocationMethod === 'custom') {
    requiredAssumptionKeys.push('customFixedAllocationCents');
  } else if (values.fixedAllocationMethod === 'per_patient') {
    requiredAssumptionKeys.push(
      'fixedMonthlyEligibleCostCents',
      'fixedAllocationPatientCount'
    );
  } else if (values.fixedAllocationMethod === 'per_clinic') {
    requiredAssumptionKeys.push(
      'fixedMonthlyEligibleCostCents',
      'fixedAllocationClinicCount'
    );
  }
  const missingAssumptions = requiredAssumptionKeys
    .filter((key) => values[key] === null)
    .map(String);
  const warnings: string[] = [];
  if (promotionalUnitAmountCents === 0) {
    warnings.push('A receita unitária promocional é zero.');
  }
  if (promotional.contributionMarginCents !== null && promotional.contributionMarginCents < 0) {
    warnings.push('O custo mensal estimado supera a receita promocional.');
  }
  if (values.estimatedDelinquencyBasisPoints === null) {
    warnings.push('A inadimplência não foi incluída por ausência de premissa.');
  }
  if (values.refundChargebackBasisPoints === null) {
    warnings.push('Estornos e chargebacks não foram incluídos por ausência de premissa.');
  }
  if (missingAssumptions.length > 0) {
    warnings.push('Dados insuficientes para calcular todas as margens.');
  }
  if (
    ratingMargin !== null
    && targetMargin !== null
    && ratingMargin < targetMargin
  ) {
    warnings.push(
      `A margem EBITDA atribuída está abaixo da meta de ${(targetMargin / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}%. Este aviso não bloqueia a proposta.`
    );
  }
  if (ratingMargin !== null && ratingMargin < 0) {
    warnings.push('O EBITDA atribuído está negativo no cenário atual.');
  }

  return {
    modelVersion: SALES_PROFITABILITY_MODEL_VERSION,
    input,
    promotionalUnitAmountCents,
    officialMonthlyRevenueCents,
    promotionalMonthlyRevenueCents,
    monthlySavingsCents: officialMonthlyRevenueCents - promotionalMonthlyRevenueCents,
    oneTimeCommercialCostCents:
      values.commercialCommissionBasisPoints === null
        ? null
        : input.onboardingCostCents
          + multiplyBasisPoints(
              promotional.revenueCents,
              values.commercialCommissionBasisPoints
            ),
    promotional,
    postDiscount,
    horizons,
    breakEven,
    rating,
    ratingMetric,
    // A meta de margem é informativa; apenas dados técnicos incompletos bloqueiam.
    requiresJustification: false,
    missingAssumptions,
    warnings
  };
}
