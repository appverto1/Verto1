import type {
  OfferProfitabilityRating,
  SalesAssumptionSnapshot,
  SalesAssumptionValues,
  SalesUsageProfile,
  SimulationValueSource
} from './salesProfitability';

export type SalesPricingMode =
  | 'package_limit'
  | 'flat_monthly'
  | 'usage_tier'
  | 'storage_block'
  | 'one_time'
  | 'custom';

export type SalesSharedAllocationMethod =
  | 'net_revenue'
  | 'gross_revenue'
  | 'configured_weight'
  | 'base_package'
  | 'none'
  | 'custom';

export type SalesPricingCatalogTier = {
  id: string;
  itemId: string;
  tierKey: string;
  publicName: string;
  minimumQuantity: number;
  maximumQuantity: number | null;
  includedQuantity: number | null;
  recurringAmountCents: number | null;
  oneTimeAmountCents: number | null;
  sortOrder: number;
  isCustom: boolean;
  metadata?: Record<string, any>;
};

export type SalesPricingCostModel = {
  id: string;
  itemId: string;
  version: number;
  directFixedMonthlyCostCents: number | null;
  directCostPerPatientCents: number | null;
  directCostPerClinicCents: number | null;
  directCostPerUsageUnitCents: number | null;
  storageCostPerGbCents: number | null;
  egressCostPerGbCents: number | null;
  notificationCostPerUnitCents: number | null;
  processingCostPerUnitCents: number | null;
  supportFixedMonthlyCostCents: number | null;
  supportCostPerPatientCents: number | null;
  operationalFixedMonthlyCostCents: number | null;
  onboardingCostCents: number | null;
  sharedCostAllocationWeight: number;
  costSource: SimulationValueSource;
  sourceDetail: string;
  effectiveAt: string;
};

export type SalesPricingCatalogItem = {
  id: string;
  itemKey: string;
  publicName: string;
  internalName: string;
  description: string;
  pricingMode: SalesPricingMode;
  billingInterval: 'monthly' | 'one_time' | 'custom';
  unitName: string;
  includedQuantity: number | null;
  maximumQuantity: number | null;
  recurringAmountCents: number | null;
  oneTimeAmountCents: number | null;
  sortOrder: number;
  isRequired: boolean;
  isPublic: boolean;
  isActive: boolean;
  compatibleBasePackages: string[];
  metadata?: Record<string, any>;
  tiers: SalesPricingCatalogTier[];
  costModel: SalesPricingCostModel | null;
};

export type SalesPricingCatalogSnapshot = {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  effectiveAt: string;
  allocationSettings: {
    stripePercentage: SalesSharedAllocationMethod;
    stripeFixed: SalesSharedAllocationMethod;
    revenueTax: SalesSharedAllocationMethod;
    delinquency: SalesSharedAllocationMethod;
    sharedPlatformCosts: SalesSharedAllocationMethod;
    belowEbitda: SalesSharedAllocationMethod;
  };
  items: SalesPricingCatalogItem[];
};

export type SalesModularLineSelection = {
  itemKey: string;
  tierId?: string | null;
  quantity: number;
  itemDiscountBasisPoints?: number;
  customRecurringAmountCents?: number | null;
  customOneTimeAmountCents?: number | null;
};

export type SalesModularProposalInput = {
  patientQuantity: number;
  expectedPatientQuantity12Months: number;
  basePackageTierId: string;
  lines: SalesModularLineSelection[];
  globalDiscountBasisPoints: number;
  discountDurationMonths: number;
  offerValidityDays: number;
  onboardingInstallments?: number;
  usageProfile: SalesUsageProfile;
  internalNotes?: string;
  publicNotes?: string;
};

export type SalesModularPeriodLineResult = {
  netRevenueCents: number;
  directCostCents: number | null;
  transactionAndTaxCostAllocatedCents: number | null;
  sharedPlatformCostAllocatedCents: number | null;
  contributionMarginCents: number | null;
  contributionMarginBasisPoints: number | null;
  ebitdaCents: number | null;
  ebitdaMarginBasisPoints: number | null;
  belowEbitdaCostAllocatedCents: number | null;
  profitTaxAllocatedCents: number | null;
  netIncomeCents: number | null;
  netMarginBasisPoints: number | null;
};

export type SalesModularProposalLineResult = {
  lineKey: string;
  catalogItemId: string;
  tierId: string | null;
  itemKey: string;
  publicName: string;
  description: string;
  pricingMode: SalesPricingMode;
  quantity: number;
  limitQuantity: number | null;
  includedQuantity: number | null;
  grossRecurringRevenueCents: number;
  grossOneTimeRevenueCents: number;
  itemDiscountBasisPoints: number;
  itemDiscountCents: number;
  oneTimeDiscountCents: number;
  allocatedGlobalDiscountCents: number;
  promotionalRecurringRevenueCents: number;
  postPromotionRecurringRevenueCents: number;
  oneTimeRevenueCents: number;
  oneTimeDirectCostCents: number | null;
  oneTimeContributionMarginCents: number | null;
  promotional: SalesModularPeriodLineResult;
  postPromotion: SalesModularPeriodLineResult;
  costSource: SimulationValueSource;
  costSourceDetail: string;
  costModelSnapshot: SalesPricingCostModel | null;
  minimumRecommendedRevenueCents: number | null;
  maximumRecommendedDiscountBasisPoints: number | null;
  breakEvenQuantity: number | null;
  warnings: string[];
  publicMetadata: Record<string, any>;
};

export type SalesModularConsolidatedPeriod = {
  recurringRevenueCents: number;
  directCostCents: number | null;
  transactionAndTaxCostAllocatedCents: number | null;
  sharedPlatformCostAllocatedCents: number | null;
  totalEstimatedCostCents: number | null;
  contributionMarginCents: number | null;
  contributionMarginBasisPoints: number | null;
  ebitdaCents: number | null;
  ebitdaMarginBasisPoints: number | null;
  belowEbitdaCostAllocatedCents: number | null;
  profitTaxAllocatedCents: number | null;
  netIncomeCents: number | null;
  netMarginBasisPoints: number | null;
};

export type SalesModularProposalResult = {
  modelVersion: string;
  catalogVersionId: string;
  catalogVersion: number;
  input: SalesModularProposalInput;
  basePackage: {
    itemKey: 'clinical_core';
    tierId: string;
    name: string;
    limitQuantity: number | null;
    includedStorageMb: number | null;
    occupiedQuantity: number;
    availableQuantity: number | null;
  };
  lines: SalesModularProposalLineResult[];
  promotional: SalesModularConsolidatedPeriod;
  postPromotion: SalesModularConsolidatedPeriod;
  grossRecurringRevenueCents: number;
  itemDiscountCents: number;
  oneTimeDiscountCents: number;
  globalDiscountCents: number;
  promotionalRecurringRevenueCents: number;
  postPromotionRecurringRevenueCents: number;
  oneTimeRevenueCents: number;
  oneTimeDirectCostCents: number | null;
  oneTimeContributionMarginCents: number | null;
  minimumRecommendedRecurringRevenueCents: number | null;
  maximumRecommendedDiscountBasisPoints: number | null;
  rating: OfferProfitabilityRating;
  requiresJustification: boolean;
  missingCosts: string[];
  warnings: string[];
  horizons: Record<'12' | '24' | '36', {
    months: number;
    promotionalMonths: number;
    fullPriceMonths: number;
    recurringRevenueCents: number;
    oneTimeRevenueCents: number;
    ebitdaCents: number | null;
    netIncomeCents: number | null;
    discountImpactCents: number;
  }>;
};

export const SALES_MODULAR_PROPOSAL_MODEL_VERSION = '2026-07-27-v1';

const integer = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const nonNegativeInteger = (value: unknown, fallback = 0) =>
  Math.max(0, integer(value, fallback));

const multiplyBasisPoints = (amountCents: number, basisPoints: number) =>
  Math.round((amountCents * basisPoints) / 10_000);

const ratioBasisPoints = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator * 10_000) / denominator) : null;

const nullableSum = (values: Array<number | null>): number | null =>
  values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + Number(value), 0)
    : null;

const lineIdentity = (selection: SalesModularLineSelection) =>
  `${selection.itemKey}:${selection.tierId || 'item'}`;

export function allocateSalesCents(
  totalCents: number,
  weights: number[],
  baseIndex: number
): number[] {
  const safeTotal = nonNegativeInteger(totalCents);
  if (weights.length === 0) return [];
  const normalized = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightTotal = normalized.reduce((sum, weight) => sum + weight, 0);
  const allocation = normalized.map((weight) =>
    weightTotal > 0 ? Math.floor((safeTotal * weight) / weightTotal) : 0
  );
  const allocated = allocation.reduce((sum, value) => sum + value, 0);
  const safeBaseIndex =
    Number.isInteger(baseIndex) && baseIndex >= 0 && baseIndex < allocation.length
      ? baseIndex
      : 0;
  allocation[safeBaseIndex] += safeTotal - allocated;
  return allocation;
}

export function recommendSalesPackageTier(
  catalog: SalesPricingCatalogSnapshot,
  patientQuantity: number
): SalesPricingCatalogTier | null {
  const clinicalCore = catalog.items.find(
    (item) => item.itemKey === 'clinical_core' && item.isActive
  );
  if (!clinicalCore) return null;
  const quantity = Math.max(1, integer(patientQuantity, 1));
  const ordered = [...clinicalCore.tiers].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      (left.maximumQuantity ?? Number.MAX_SAFE_INTEGER) -
        (right.maximumQuantity ?? Number.MAX_SAFE_INTEGER)
  );
  return (
    ordered.find(
      (tier) =>
        !tier.isCustom &&
        tier.maximumQuantity !== null &&
        quantity <= tier.maximumQuantity
    ) ||
    ordered.find((tier) => tier.isCustom || tier.maximumQuantity === null) ||
    null
  );
}

export function validateSalesModularProposalInput(
  input: SalesModularProposalInput
): string[] {
  const errors: string[] = [];
  if (
    !Number.isInteger(input.patientQuantity) ||
    input.patientQuantity < 1 ||
    input.patientQuantity > 100_000
  ) {
    errors.push('patientQuantity');
  }
  if (
    !Number.isInteger(input.expectedPatientQuantity12Months) ||
    input.expectedPatientQuantity12Months < input.patientQuantity ||
    input.expectedPatientQuantity12Months > 100_000
  ) {
    errors.push('expectedPatientQuantity12Months');
  }
  if (!input.basePackageTierId) errors.push('basePackageTierId');
  if (
    !Number.isInteger(input.globalDiscountBasisPoints) ||
    input.globalDiscountBasisPoints < 0 ||
    input.globalDiscountBasisPoints > 10_000
  ) {
    errors.push('globalDiscountBasisPoints');
  }
  if (
    !Number.isInteger(input.discountDurationMonths) ||
    input.discountDurationMonths < 0 ||
    input.discountDurationMonths > 36 ||
    (input.globalDiscountBasisPoints === 0 &&
      input.discountDurationMonths !== 0) ||
    (input.globalDiscountBasisPoints > 0 &&
      input.discountDurationMonths === 0)
  ) {
    errors.push('discountDurationMonths');
  }
  if (
    !Number.isInteger(input.offerValidityDays) ||
    input.offerValidityDays < 1 ||
    input.offerValidityDays > 90
  ) {
    errors.push('offerValidityDays');
  }
  if (
    !Number.isInteger(input.onboardingInstallments ?? 1) ||
    Number(input.onboardingInstallments ?? 1) < 1 ||
    Number(input.onboardingInstallments ?? 1) > 36
  ) {
    errors.push('onboardingInstallments');
  }
  if (!['light', 'standard', 'intensive', 'custom'].includes(input.usageProfile)) {
    errors.push('usageProfile');
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) {
    errors.push('lines');
  } else {
    input.lines.forEach((line, index) => {
      if (!line.itemKey || line.itemKey.length > 80) {
        errors.push(`lines.${index}.itemKey`);
      }
      if (
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 1_000_000
      ) {
        errors.push(`lines.${index}.quantity`);
      }
      const discount = line.itemDiscountBasisPoints ?? 0;
      if (
        !Number.isInteger(discount) ||
        discount < 0 ||
        discount > 10_000
      ) {
        errors.push(`lines.${index}.itemDiscountBasisPoints`);
      }
      for (const [field, amount] of [
        ['customRecurringAmountCents', line.customRecurringAmountCents],
        ['customOneTimeAmountCents', line.customOneTimeAmountCents]
      ] as const) {
        if (
          amount !== null &&
          amount !== undefined &&
          (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000)
        ) {
          errors.push(`lines.${index}.${field}`);
        }
      }
    });
  }
  return errors;
}

const resolveProfileAssumptions = (
  snapshot: SalesAssumptionSnapshot,
  profile: SalesUsageProfile
): SalesAssumptionValues => {
  if (profile === 'custom') return snapshot.values;
  return {
    ...snapshot.values,
    ...(snapshot.values.usageProfiles?.[profile] || {}),
    usageProfiles: snapshot.values.usageProfiles
  };
};

const fixedAllocationCents = (
  values: SalesAssumptionValues,
  patientQuantity: number
): number | null => {
  if (values.fixedAllocationMethod === 'none') return 0;
  if (values.fixedAllocationMethod === 'custom') {
    return values.customFixedAllocationCents;
  }
  if (values.fixedMonthlyEligibleCostCents === null) return null;
  if (values.fixedAllocationMethod === 'per_patient') {
    if (!values.fixedAllocationPatientCount) return null;
    return Math.round(
      (values.fixedMonthlyEligibleCostCents * patientQuantity) /
        values.fixedAllocationPatientCount
    );
  }
  if (!values.fixedAllocationClinicCount) return null;
  return Math.round(
    values.fixedMonthlyEligibleCostCents /
      values.fixedAllocationClinicCount
  );
};

const resolveItemTier = (
  item: SalesPricingCatalogItem,
  selection: SalesModularLineSelection
) =>
  selection.tierId
    ? item.tiers.find((tier) => tier.id === selection.tierId) || null
    : null;

const resolveGrossAmounts = (
  item: SalesPricingCatalogItem,
  tier: SalesPricingCatalogTier | null,
  selection: SalesModularLineSelection
) => {
  const quantity = Math.max(1, integer(selection.quantity, 1));
  const customPriceAllowed =
    item.pricingMode === 'custom' || Boolean(tier?.isCustom);
  const recurringUnit = customPriceAllowed
    ? nonNegativeInteger(selection.customRecurringAmountCents)
    : nonNegativeInteger(tier?.recurringAmountCents ?? item.recurringAmountCents);
  const oneTimeUnit = customPriceAllowed || item.itemKey === 'onboarding'
    ? nonNegativeInteger(
        selection.customOneTimeAmountCents ??
          tier?.oneTimeAmountCents ??
          item.oneTimeAmountCents
      )
    : nonNegativeInteger(tier?.oneTimeAmountCents ?? item.oneTimeAmountCents);
  const recurringMultiplier =
    item.pricingMode === 'storage_block' ? quantity : 1;
  return {
    recurringAmountCents: recurringUnit * recurringMultiplier,
    oneTimeAmountCents: oneTimeUnit,
    quantity
  };
};

const storageGigabytes = (
  item: SalesPricingCatalogItem,
  tier: SalesPricingCatalogTier | null,
  quantity: number
) => {
  if (item.pricingMode !== 'storage_block') return 0;
  const perBlock = Number(
    tier?.metadata?.gigabytes ??
      (tier?.includedQuantity ? tier.includedQuantity / 1024 : 0)
  );
  return Math.max(0, perBlock) * quantity;
};

const directMonthlyCost = (
  item: SalesPricingCatalogItem,
  tier: SalesPricingCatalogTier | null,
  selectionQuantity: number,
  patientQuantity: number
): number | null => {
  const model = item.costModel;
  if (!model || !isSalesCostModelComplete(item)) return null;
  if (item.billingInterval === 'one_time') return 0;
  return (
    nonNegativeInteger(model.directFixedMonthlyCostCents) +
    nonNegativeInteger(model.directCostPerPatientCents) * patientQuantity +
    nonNegativeInteger(model.directCostPerClinicCents) +
    nonNegativeInteger(model.directCostPerUsageUnitCents) * selectionQuantity +
    Math.round(
      nonNegativeInteger(model.storageCostPerGbCents) *
        storageGigabytes(item, tier, selectionQuantity)
    ) +
    Math.round(
      nonNegativeInteger(model.egressCostPerGbCents) *
        storageGigabytes(item, tier, selectionQuantity)
    ) +
    nonNegativeInteger(model.notificationCostPerUnitCents) *
      selectionQuantity +
    nonNegativeInteger(model.processingCostPerUnitCents) *
      selectionQuantity +
    nonNegativeInteger(model.supportFixedMonthlyCostCents) +
    nonNegativeInteger(model.supportCostPerPatientCents) * patientQuantity +
    nonNegativeInteger(model.operationalFixedMonthlyCostCents)
  );
};

const requiredCostFieldsByItem: Record<
  string,
  Array<keyof SalesPricingCostModel>
> = {
  clinical_core: [
    'directFixedMonthlyCostCents',
    'directCostPerPatientCents',
    'directCostPerClinicCents',
    'supportFixedMonthlyCostCents',
    'supportCostPerPatientCents',
    'operationalFixedMonthlyCostCents'
  ],
  appointments_communication: [
    'directFixedMonthlyCostCents',
    'directCostPerPatientCents',
    'directCostPerClinicCents',
    'notificationCostPerUnitCents',
    'supportFixedMonthlyCostCents',
    'operationalFixedMonthlyCostCents'
  ],
  financial_management: [
    'directFixedMonthlyCostCents',
    'directCostPerClinicCents',
    'supportFixedMonthlyCostCents',
    'operationalFixedMonthlyCostCents'
  ],
  insurance_tiss: [
    'directFixedMonthlyCostCents',
    'directCostPerUsageUnitCents',
    'processingCostPerUnitCents',
    'supportFixedMonthlyCostCents',
    'operationalFixedMonthlyCostCents'
  ],
  school_management: [
    'directFixedMonthlyCostCents',
    'directCostPerPatientCents',
    'supportFixedMonthlyCostCents',
    'operationalFixedMonthlyCostCents'
  ],
  additional_storage: [
    'directFixedMonthlyCostCents',
    'storageCostPerGbCents',
    'egressCostPerGbCents',
    'operationalFixedMonthlyCostCents'
  ],
  onboarding: ['onboardingCostCents']
};

const isSalesCostModelComplete = (item: SalesPricingCatalogItem) => {
  const model = item.costModel;
  if (!model || model.costSource === 'unavailable') return false;
  const requiredFields = requiredCostFieldsByItem[item.itemKey] || [
    'directFixedMonthlyCostCents',
    'operationalFixedMonthlyCostCents'
  ];
  return requiredFields.every((field) => model[field] !== null);
};

const directOneTimeCost = (item: SalesPricingCatalogItem): number | null => {
  if (item.billingInterval !== 'one_time') return 0;
  if (!isSalesCostModelComplete(item)) return null;
  return nonNegativeInteger(item.costModel?.onboardingCostCents);
};

const sharedPlatformCosts = (
  values: SalesAssumptionValues,
  patientQuantity: number
): number | null => {
  const variableKeys: Array<keyof SalesAssumptionValues> = [
    'variablePatientCostCents',
    'variableClinicCostCents',
    'storageCostCents',
    'egressCostCents',
    'processingCostCents',
    'notificationCostCents',
    'otherVariableCostCents',
    'monthlySupportClinicCostCents',
    'supportPatientCostCents',
    'monthlyOperationalCostCents'
  ];
  if (variableKeys.some((key) => values[key] === null)) return null;
  const fixed = fixedAllocationCents(values, patientQuantity);
  if (fixed === null) return null;
  return (
    patientQuantity * Number(values.variablePatientCostCents) +
    Number(values.variableClinicCostCents) +
    Number(values.storageCostCents) +
    Number(values.egressCostCents) +
    Number(values.processingCostCents) +
    Number(values.notificationCostCents) +
    Number(values.otherVariableCostCents) +
    Number(values.monthlySupportClinicCostCents) +
    patientQuantity * Number(values.supportPatientCostCents) +
    Number(values.monthlyOperationalCostCents) +
    fixed
  );
};

const allocationWeights = (
  method: SalesSharedAllocationMethod,
  lines: Array<{
    grossRevenueCents: number;
    netRevenueCents: number;
    weight: number;
    isBase: boolean;
  }>
) => {
  if (method === 'none') return lines.map(() => 0);
  if (method === 'base_package') return lines.map((line) => line.isBase ? 1 : 0);
  if (method === 'gross_revenue') {
    return lines.map((line) => line.grossRevenueCents);
  }
  if (method === 'configured_weight' || method === 'custom') {
    return lines.map((line) => line.weight);
  }
  return lines.map((line) => line.netRevenueCents);
};

const resolvedAllocationMethod = (
  value: unknown,
  fallback: SalesSharedAllocationMethod
): SalesSharedAllocationMethod =>
  [
    'net_revenue',
    'gross_revenue',
    'configured_weight',
    'base_package',
    'none',
    'custom'
  ].includes(String(value))
    ? value as SalesSharedAllocationMethod
    : fallback;

const allocateByMethod = (
  totalCents: number,
  method: SalesSharedAllocationMethod,
  lines: Array<{
    grossRevenueCents: number;
    netRevenueCents: number;
    weight: number;
    isBase: boolean;
  }>,
  baseIndex: number
) =>
  method === 'none'
    ? lines.map(() => 0)
    : allocateSalesCents(
        totalCents,
        allocationWeights(method, lines),
        baseIndex
      );

type MutablePeriodLine = {
  netRevenueCents: number;
  grossRevenueCents: number;
  directCostCents: number | null;
  weight: number;
  isBase: boolean;
  transactionAndTaxCostAllocatedCents: number | null;
  sharedPlatformCostAllocatedCents: number | null;
  contributionMarginCents: number | null;
  ebitdaCents: number | null;
  belowEbitdaCostAllocatedCents: number | null;
  profitTaxAllocatedCents: number | null;
  netIncomeCents: number | null;
};

const calculatePeriod = (
  sourceLines: Array<{
    netRevenueCents: number;
    grossRevenueCents: number;
    directCostCents: number | null;
    weight: number;
    isBase: boolean;
  }>,
  values: SalesAssumptionValues,
  allocation: SalesPricingCatalogSnapshot['allocationSettings'],
  patientQuantity: number
) => {
  const lines: MutablePeriodLine[] = sourceLines.map((line) => ({
    ...line,
    transactionAndTaxCostAllocatedCents: 0,
    sharedPlatformCostAllocatedCents: 0,
    contributionMarginCents: null,
    ebitdaCents: null,
    belowEbitdaCostAllocatedCents: 0,
    profitTaxAllocatedCents: 0,
    netIncomeCents: null
  }));
  const baseIndex = Math.max(0, lines.findIndex((line) => line.isBase));
  const revenue = lines.reduce((sum, line) => sum + line.netRevenueCents, 0);
  const stripeFixed = values.stripeFixedFeeCents;
  const percentageComponents = [
    {
      basisPoints: values.stripeFeeBasisPoints,
      method: resolvedAllocationMethod(
        allocation.stripePercentage,
        'net_revenue'
      )
    },
    {
      basisPoints: values.revenueTaxBasisPoints,
      method: resolvedAllocationMethod(allocation.revenueTax, 'net_revenue')
    },
    {
      basisPoints: values.estimatedDelinquencyBasisPoints,
      method: resolvedAllocationMethod(allocation.delinquency, 'net_revenue')
    }
  ];
  if (
    percentageComponents.some((component) => component.basisPoints === null) ||
    stripeFixed === null
  ) {
    lines.forEach((line) => {
      line.transactionAndTaxCostAllocatedCents = null;
    });
  } else {
    const allocatedComponents = percentageComponents.map((component) =>
      allocateByMethod(
        multiplyBasisPoints(revenue, Number(component.basisPoints)),
        component.method,
        lines,
        baseIndex
      )
    );
    const fixedAllocation = allocateByMethod(
      stripeFixed,
      resolvedAllocationMethod(allocation.stripeFixed, 'base_package'),
      lines,
      baseIndex
    );
    lines.forEach((line, index) => {
      line.transactionAndTaxCostAllocatedCents =
        allocatedComponents.reduce(
          (sum, component) => sum + component[index],
          fixedAllocation[index]
        );
    });
  }

  const platformTotal = sharedPlatformCosts(values, patientQuantity);
  if (platformTotal === null) {
    lines.forEach((line) => {
      line.sharedPlatformCostAllocatedCents = null;
    });
  } else {
    const platformAllocation = allocateByMethod(
      platformTotal,
      resolvedAllocationMethod(
        allocation.sharedPlatformCosts,
        'configured_weight'
      ),
      lines,
      baseIndex
    );
    lines.forEach((line, index) => {
      line.sharedPlatformCostAllocatedCents = platformAllocation[index];
    });
  }

  lines.forEach((line) => {
    const contributionDeductions = nullableSum([
      line.directCostCents,
      line.transactionAndTaxCostAllocatedCents
    ]);
    line.contributionMarginCents =
      contributionDeductions === null
        ? null
        : line.netRevenueCents - contributionDeductions;
    line.ebitdaCents =
      line.contributionMarginCents === null ||
      line.sharedPlatformCostAllocatedCents === null
        ? null
        : line.contributionMarginCents -
          line.sharedPlatformCostAllocatedCents;
  });

  const belowEbitdaTotal = nullableSum([
    values.depreciationAmortizationCents,
    values.financialExpensesCents,
    values.otherBelowEbitdaCents
  ]);
  if (belowEbitdaTotal === null) {
    lines.forEach((line) => {
      line.belowEbitdaCostAllocatedCents = null;
    });
  } else {
    const belowAllocation = allocateByMethod(
      belowEbitdaTotal,
      resolvedAllocationMethod(allocation.belowEbitda, 'configured_weight'),
      lines,
      baseIndex
    );
    lines.forEach((line, index) => {
      line.belowEbitdaCostAllocatedCents = belowAllocation[index];
    });
  }

  const totalEbitda = nullableSum(lines.map((line) => line.ebitdaCents));
  const profitTaxTotal =
    totalEbitda === null || values.profitTaxBasisPoints === null
      ? null
      : multiplyBasisPoints(
          Math.max(0, totalEbitda),
          values.profitTaxBasisPoints
        );
  if (profitTaxTotal === null) {
    lines.forEach((line) => {
      line.profitTaxAllocatedCents = null;
    });
  } else {
    const taxAllocation = allocateSalesCents(
      profitTaxTotal,
      lines.map((line) => Math.max(0, line.ebitdaCents || 0)),
      baseIndex
    );
    lines.forEach((line, index) => {
      line.profitTaxAllocatedCents = taxAllocation[index];
    });
  }

  lines.forEach((line) => {
    const deductions = nullableSum([
      line.belowEbitdaCostAllocatedCents,
      line.profitTaxAllocatedCents
    ]);
    line.netIncomeCents =
      line.ebitdaCents === null || deductions === null
        ? null
        : line.ebitdaCents - deductions;
  });

  const mapped: SalesModularPeriodLineResult[] = lines.map((line) => ({
    netRevenueCents: line.netRevenueCents,
    directCostCents: line.directCostCents,
    transactionAndTaxCostAllocatedCents:
      line.transactionAndTaxCostAllocatedCents,
    sharedPlatformCostAllocatedCents:
      line.sharedPlatformCostAllocatedCents,
    contributionMarginCents: line.contributionMarginCents,
    contributionMarginBasisPoints:
      line.contributionMarginCents === null
        ? null
        : ratioBasisPoints(
            line.contributionMarginCents,
            line.netRevenueCents
          ),
    ebitdaCents: line.ebitdaCents,
    ebitdaMarginBasisPoints:
      line.ebitdaCents === null
        ? null
        : ratioBasisPoints(line.ebitdaCents, line.netRevenueCents),
    belowEbitdaCostAllocatedCents: line.belowEbitdaCostAllocatedCents,
    profitTaxAllocatedCents: line.profitTaxAllocatedCents,
    netIncomeCents: line.netIncomeCents,
    netMarginBasisPoints:
      line.netIncomeCents === null
        ? null
        : ratioBasisPoints(line.netIncomeCents, line.netRevenueCents)
  }));

  const consolidated: SalesModularConsolidatedPeriod = {
    recurringRevenueCents: mapped.reduce(
      (sum, line) => sum + line.netRevenueCents,
      0
    ),
    directCostCents: nullableSum(mapped.map((line) => line.directCostCents)),
    transactionAndTaxCostAllocatedCents: nullableSum(
      mapped.map((line) => line.transactionAndTaxCostAllocatedCents)
    ),
    sharedPlatformCostAllocatedCents: nullableSum(
      mapped.map((line) => line.sharedPlatformCostAllocatedCents)
    ),
    totalEstimatedCostCents: null,
    contributionMarginCents: nullableSum(
      mapped.map((line) => line.contributionMarginCents)
    ),
    contributionMarginBasisPoints: null,
    ebitdaCents: nullableSum(mapped.map((line) => line.ebitdaCents)),
    ebitdaMarginBasisPoints: null,
    belowEbitdaCostAllocatedCents: nullableSum(
      mapped.map((line) => line.belowEbitdaCostAllocatedCents)
    ),
    profitTaxAllocatedCents: nullableSum(
      mapped.map((line) => line.profitTaxAllocatedCents)
    ),
    netIncomeCents: nullableSum(mapped.map((line) => line.netIncomeCents)),
    netMarginBasisPoints: null
  };
  consolidated.totalEstimatedCostCents = nullableSum([
    consolidated.directCostCents,
    consolidated.transactionAndTaxCostAllocatedCents,
    consolidated.sharedPlatformCostAllocatedCents
  ]);
  consolidated.contributionMarginBasisPoints =
    consolidated.contributionMarginCents === null
      ? null
      : ratioBasisPoints(
          consolidated.contributionMarginCents,
          consolidated.recurringRevenueCents
        );
  consolidated.ebitdaMarginBasisPoints =
    consolidated.ebitdaCents === null
      ? null
      : ratioBasisPoints(
          consolidated.ebitdaCents,
          consolidated.recurringRevenueCents
        );
  consolidated.netMarginBasisPoints =
    consolidated.netIncomeCents === null
      ? null
      : ratioBasisPoints(
          consolidated.netIncomeCents,
          consolidated.recurringRevenueCents
        );
  return { lines: mapped, consolidated };
};

const minimumRevenueForMargin = (
  period: SalesModularConsolidatedPeriod,
  minimumMarginBasisPoints: number | null
) => {
  if (
    period.totalEstimatedCostCents === null ||
    minimumMarginBasisPoints === null ||
    minimumMarginBasisPoints >= 10_000
  ) {
    return null;
  }
  return Math.ceil(
    (period.totalEstimatedCostCents * 10_000) /
      (10_000 - minimumMarginBasisPoints)
  );
};

export function calculateSalesModularProposal(
  input: SalesModularProposalInput,
  catalog: SalesPricingCatalogSnapshot,
  assumptionSnapshot: SalesAssumptionSnapshot
): SalesModularProposalResult {
  const invalidFields = validateSalesModularProposalInput(input);
  if (invalidFields.length > 0) {
    if (
      invalidFields.some(
        (field) =>
          field === 'globalDiscountBasisPoints' ||
          field.endsWith('.itemDiscountBasisPoints')
      )
    ) {
      throw new Error('PRICING_INVALID_DISCOUNT');
    }
    throw new Error(`PROPOSAL_SIMULATION_INVALID:${invalidFields.join(',')}`);
  }
  if (catalog.status !== 'active' && catalog.status !== 'draft') {
    throw new Error('PRICING_CATALOG_INACTIVE');
  }

  const itemsByKey = new Map(
    catalog.items
      .filter((item) => item.isActive)
      .map((item) => [item.itemKey, item])
  );
  const clinicalCore = itemsByKey.get('clinical_core');
  if (!clinicalCore) throw new Error('PRICING_ITEM_NOT_FOUND:clinical_core');
  const baseTier = clinicalCore.tiers.find(
    (tier) => tier.id === input.basePackageTierId
  );
  if (!baseTier) throw new Error('PRICING_TIER_NOT_FOUND:clinical_core');
  if (
    baseTier.maximumQuantity !== null &&
    input.patientQuantity > baseTier.maximumQuantity
  ) {
    throw new Error('PRICING_PACKAGE_LIMIT_EXCEEDED');
  }

  const selections = [...input.lines];
  const coreSelections = selections.filter(
    (selection) => selection.itemKey === 'clinical_core'
  );
  if (coreSelections.length !== 1) {
    throw new Error('PROPOSAL_SIMULATION_INVALID:clinical_core');
  }
  coreSelections[0] = {
    ...coreSelections[0],
    tierId: baseTier.id,
    quantity: input.patientQuantity
  };
  const duplicateNonStorage = new Set<string>();
  const resolved = selections.map((selection) => {
    const item = itemsByKey.get(selection.itemKey);
    if (!item) throw new Error(`PRICING_ITEM_NOT_FOUND:${selection.itemKey}`);
    if (item.pricingMode !== 'storage_block') {
      if (duplicateNonStorage.has(item.itemKey)) {
        throw new Error(`PROPOSAL_SIMULATION_INVALID:${item.itemKey}`);
      }
      duplicateNonStorage.add(item.itemKey);
    }
    const effectiveSelection =
      item.itemKey === 'clinical_core'
        ? {
            ...selection,
            tierId: baseTier.id,
            quantity: input.patientQuantity
          }
        : selection;
    const tier = resolveItemTier(item, effectiveSelection);
    if (
      ['package_limit', 'usage_tier', 'storage_block'].includes(
        item.pricingMode
      ) &&
      !tier
    ) {
      throw new Error(`PRICING_TIER_NOT_FOUND:${item.itemKey}`);
    }
    if (
      tier?.maximumQuantity !== null &&
      item.pricingMode !== 'storage_block' &&
      effectiveSelection.quantity > Number(tier?.maximumQuantity)
    ) {
      throw new Error(`PRICING_PACKAGE_LIMIT_EXCEEDED:${item.itemKey}`);
    }
    const amounts = resolveGrossAmounts(item, tier, effectiveSelection);
    if (
      item.billingInterval !== 'one_time' &&
      amounts.recurringAmountCents <= 0
    ) {
      throw new Error(`PRICING_TIER_NOT_FOUND:${item.itemKey}`);
    }
    const discountBasisPoints = nonNegativeInteger(
      effectiveSelection.itemDiscountBasisPoints
    );
    if (discountBasisPoints > 10_000) {
      throw new Error(`PRICING_INVALID_DISCOUNT:${item.itemKey}`);
    }
    const itemDiscountCents = multiplyBasisPoints(
      amounts.recurringAmountCents,
      discountBasisPoints
    );
    const oneTimeDiscountCents = multiplyBasisPoints(
      amounts.oneTimeAmountCents,
      discountBasisPoints
    );
    const directCost = directMonthlyCost(
      item,
      tier,
      amounts.quantity,
      input.patientQuantity
    );
    const oneTimeDirectCostCents = directOneTimeCost(item);
    return {
      item,
      tier,
      selection: effectiveSelection,
      quantity: amounts.quantity,
      grossRecurringRevenueCents: amounts.recurringAmountCents,
      grossOneTimeRevenueCents: amounts.oneTimeAmountCents,
      itemDiscountBasisPoints: discountBasisPoints,
      itemDiscountCents,
      oneTimeDiscountCents,
      postPromotionRecurringRevenueCents:
        amounts.recurringAmountCents - itemDiscountCents,
      oneTimeRevenueCents:
        amounts.oneTimeAmountCents - oneTimeDiscountCents,
      directCostCents: directCost,
      oneTimeDirectCostCents
    };
  });

  const baseIndex = Math.max(
    0,
    resolved.findIndex((line) => line.item.itemKey === 'clinical_core')
  );
  const globalDiscountBase = resolved.reduce(
    (sum, line) => sum + line.postPromotionRecurringRevenueCents,
    0
  );
  const globalDiscountTotal = multiplyBasisPoints(
    globalDiscountBase,
    input.globalDiscountBasisPoints
  );
  const globalAllocations = allocateSalesCents(
    globalDiscountTotal,
    resolved.map((line) => line.postPromotionRecurringRevenueCents),
    baseIndex
  );
  const values = resolveProfileAssumptions(
    assumptionSnapshot,
    input.usageProfile
  );
  const allocationSettings = {
    stripePercentage: resolvedAllocationMethod(
      catalog.allocationSettings?.stripePercentage,
      'net_revenue'
    ),
    stripeFixed: resolvedAllocationMethod(
      catalog.allocationSettings?.stripeFixed,
      'base_package'
    ),
    revenueTax: resolvedAllocationMethod(
      catalog.allocationSettings?.revenueTax,
      'net_revenue'
    ),
    delinquency: resolvedAllocationMethod(
      catalog.allocationSettings?.delinquency,
      'net_revenue'
    ),
    sharedPlatformCosts: resolvedAllocationMethod(
      catalog.allocationSettings?.sharedPlatformCosts,
      'configured_weight'
    ),
    belowEbitda: resolvedAllocationMethod(
      catalog.allocationSettings?.belowEbitda,
      'configured_weight'
    )
  };

  const promotionalPeriod = calculatePeriod(
    resolved.map((line, index) => ({
      netRevenueCents:
        line.postPromotionRecurringRevenueCents -
        globalAllocations[index],
      grossRevenueCents: line.grossRecurringRevenueCents,
      directCostCents: line.directCostCents,
      weight: line.item.costModel?.sharedCostAllocationWeight || 0,
      isBase: line.item.itemKey === 'clinical_core'
    })),
    values,
    allocationSettings,
    input.patientQuantity
  );
  const postPeriod = calculatePeriod(
    resolved.map((line) => ({
      netRevenueCents: line.postPromotionRecurringRevenueCents,
      grossRevenueCents: line.grossRecurringRevenueCents,
      directCostCents: line.directCostCents,
      weight: line.item.costModel?.sharedCostAllocationWeight || 0,
      isBase: line.item.itemKey === 'clinical_core'
    })),
    values,
    allocationSettings,
    input.patientQuantity
  );

  const missingCosts = resolved
    .filter((line) =>
      line.directCostCents === null ||
      line.oneTimeDirectCostCents === null
    )
    .map((line) => line.item.publicName);
  const requiredShared: Array<keyof SalesAssumptionValues> = [
    'stripeFeeBasisPoints',
    'stripeFixedFeeCents',
    'revenueTaxBasisPoints',
    'estimatedDelinquencyBasisPoints',
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
    'depreciationAmortizationCents',
    'financialExpensesCents',
    'profitTaxBasisPoints',
    'otherBelowEbitdaCents',
    'minimumMarginBasisPoints',
    'healthyMarginBasisPoints',
    'attentionMarginBasisPoints'
  ];
  if (requiredShared.some((key) => values[key] === null)) {
    missingCosts.push('Custos compartilhados e premissas');
  }

  const lines: SalesModularProposalLineResult[] = resolved.map(
    (line, index) => {
      const promotional = promotionalPeriod.lines[index];
      const postPromotion = postPeriod.lines[index];
      const minimumRecommendedRevenueCents = minimumRevenueForMargin(
        {
          ...promotionalPeriod.consolidated,
          recurringRevenueCents: promotional.netRevenueCents,
          directCostCents: promotional.directCostCents,
          transactionAndTaxCostAllocatedCents:
            promotional.transactionAndTaxCostAllocatedCents,
          sharedPlatformCostAllocatedCents:
            promotional.sharedPlatformCostAllocatedCents,
          totalEstimatedCostCents: nullableSum([
            promotional.directCostCents,
            promotional.transactionAndTaxCostAllocatedCents,
            promotional.sharedPlatformCostAllocatedCents
          ]),
          contributionMarginCents: promotional.contributionMarginCents,
          contributionMarginBasisPoints:
            promotional.contributionMarginBasisPoints,
          ebitdaCents: promotional.ebitdaCents,
          ebitdaMarginBasisPoints: promotional.ebitdaMarginBasisPoints,
          belowEbitdaCostAllocatedCents:
            promotional.belowEbitdaCostAllocatedCents,
          profitTaxAllocatedCents: promotional.profitTaxAllocatedCents,
          netIncomeCents: promotional.netIncomeCents,
          netMarginBasisPoints: promotional.netMarginBasisPoints
        },
        values.minimumMarginBasisPoints
      );
      const maximumRecommendedDiscountBasisPoints =
        minimumRecommendedRevenueCents === null ||
        line.grossRecurringRevenueCents <= 0
          ? null
          : Math.max(
              0,
              Math.min(
                10_000,
                Math.floor(
                  ((line.grossRecurringRevenueCents -
                    minimumRecommendedRevenueCents) *
                    10_000) /
                    line.grossRecurringRevenueCents
                )
              )
            );
      const warnings: string[] = [];
      if (line.directCostCents === null) {
        warnings.push('Modelo de custo ainda não informado.');
      }
      if (
        promotional.ebitdaCents !== null &&
        promotional.ebitdaCents < 0
      ) {
        warnings.push('EBITDA promocional negativo.');
      }
      return {
        lineKey: lineIdentity(line.selection),
        catalogItemId: line.item.id,
        tierId: line.tier?.id || null,
        itemKey: line.item.itemKey,
        publicName: line.item.publicName,
        description: line.item.description,
        pricingMode: line.item.pricingMode,
        quantity: line.quantity,
        limitQuantity: line.tier?.maximumQuantity ?? line.item.maximumQuantity,
        includedQuantity:
          line.tier?.includedQuantity ?? line.item.includedQuantity,
        grossRecurringRevenueCents: line.grossRecurringRevenueCents,
        grossOneTimeRevenueCents: line.grossOneTimeRevenueCents,
        itemDiscountBasisPoints: line.itemDiscountBasisPoints,
        itemDiscountCents: line.itemDiscountCents,
        oneTimeDiscountCents: line.oneTimeDiscountCents,
        allocatedGlobalDiscountCents: globalAllocations[index],
        promotionalRecurringRevenueCents: promotional.netRevenueCents,
        postPromotionRecurringRevenueCents:
          postPromotion.netRevenueCents,
        oneTimeRevenueCents: line.oneTimeRevenueCents,
        oneTimeDirectCostCents: line.oneTimeDirectCostCents,
        oneTimeContributionMarginCents:
          line.oneTimeDirectCostCents === null
            ? null
            : line.oneTimeRevenueCents - line.oneTimeDirectCostCents,
        promotional,
        postPromotion,
        costSource: line.item.costModel?.costSource || 'unavailable',
        costSourceDetail:
          line.item.costModel?.sourceDetail ||
          'Configure os custos por funcionalidade.',
        costModelSnapshot: line.item.costModel,
        minimumRecommendedRevenueCents,
        maximumRecommendedDiscountBasisPoints,
        breakEvenQuantity:
          line.directCostCents === null ||
          line.grossRecurringRevenueCents <= 0
            ? null
            : Math.max(
                1,
                Math.ceil(
                  line.directCostCents /
                    Math.max(1, line.grossRecurringRevenueCents)
                )
              ),
        warnings,
        publicMetadata: {
          tierName: line.tier?.publicName || null,
          unitName: line.item.unitName,
          includedQuantity:
            line.tier?.includedQuantity ?? line.item.includedQuantity,
          maximumQuantity:
            line.tier?.maximumQuantity ?? line.item.maximumQuantity,
          features: Array.isArray(line.item.metadata?.features)
            ? line.item.metadata.features
                .filter(
                  (feature: unknown): feature is string =>
                    typeof feature === 'string' && feature.trim().length > 0
                )
                .slice(0, 30)
            : []
        }
      };
    }
  );

  const minimumRecommendedRecurringRevenueCents =
    minimumRevenueForMargin(
      promotionalPeriod.consolidated,
      values.minimumMarginBasisPoints
    );
  const maximumRecommendedDiscountBasisPoints =
    minimumRecommendedRecurringRevenueCents === null ||
    resolved.reduce(
      (sum, line) => sum + line.grossRecurringRevenueCents,
      0
    ) <= 0
      ? null
      : Math.max(
          0,
          Math.min(
            10_000,
            Math.floor(
              ((resolved.reduce(
                (sum, line) => sum + line.grossRecurringRevenueCents,
                0
              ) -
                minimumRecommendedRecurringRevenueCents) *
                10_000) /
                resolved.reduce(
                  (sum, line) => sum + line.grossRecurringRevenueCents,
                  0
                )
            )
          )
        );
  const ratingMargin =
    promotionalPeriod.consolidated.ebitdaMarginBasisPoints ??
    promotionalPeriod.consolidated.contributionMarginBasisPoints;
  const rating: OfferProfitabilityRating =
    missingCosts.length > 0 ||
    ratingMargin === null ||
    values.healthyMarginBasisPoints === null ||
    values.attentionMarginBasisPoints === null
      ? 'insufficient_data'
      : ratingMargin >= values.healthyMarginBasisPoints
        ? 'healthy'
        : ratingMargin >= values.attentionMarginBasisPoints
          ? 'attention'
          : 'not_recommended';
  const requiresJustification =
    ratingMargin !== null &&
    values.minimumMarginBasisPoints !== null &&
    ratingMargin < values.minimumMarginBasisPoints;
  const oneTimeRevenueCents = lines.reduce(
    (sum, line) => sum + line.oneTimeRevenueCents,
    0
  );
  const oneTimeDiscountCents = lines.reduce(
    (sum, line) => sum + line.oneTimeDiscountCents,
    0
  );
  const oneTimeDirectCostCents = nullableSum(
    lines.map((line) => line.oneTimeDirectCostCents)
  );
  const oneTimeContributionMarginCents =
    oneTimeDirectCostCents === null
      ? null
      : oneTimeRevenueCents - oneTimeDirectCostCents;
  const onboardingInstallments = input.onboardingInstallments ?? 1;
  const oneTimeRevenueInstallments = allocateSalesCents(
    oneTimeRevenueCents,
    Array.from({ length: onboardingInstallments }, () => 1),
    0
  );
  const oneTimeDiscountInstallments = allocateSalesCents(
    oneTimeDiscountCents,
    Array.from({ length: onboardingInstallments }, () => 1),
    0
  );
  const horizons = [12, 24, 36].reduce<
    SalesModularProposalResult['horizons']
  >((accumulator, months) => {
    const promotionalMonths = Math.min(
      input.discountDurationMonths,
      months
    );
    const fullPriceMonths = months - promotionalMonths;
    const recognizedInstallments = Math.min(
      months,
      onboardingInstallments
    );
    const recognizedOneTimeRevenueCents = oneTimeRevenueInstallments
      .slice(0, recognizedInstallments)
      .reduce((sum, installment) => sum + installment, 0);
    const recognizedOneTimeDiscountCents = oneTimeDiscountInstallments
      .slice(0, recognizedInstallments)
      .reduce((sum, installment) => sum + installment, 0);
    accumulator[String(months) as '12' | '24' | '36'] = {
      months,
      promotionalMonths,
      fullPriceMonths,
      recurringRevenueCents:
        promotionalPeriod.consolidated.recurringRevenueCents *
          promotionalMonths +
        postPeriod.consolidated.recurringRevenueCents * fullPriceMonths,
      oneTimeRevenueCents: recognizedOneTimeRevenueCents,
      ebitdaCents:
        promotionalPeriod.consolidated.ebitdaCents === null ||
        postPeriod.consolidated.ebitdaCents === null ||
        oneTimeDirectCostCents === null
          ? null
          : promotionalPeriod.consolidated.ebitdaCents *
              promotionalMonths +
            postPeriod.consolidated.ebitdaCents * fullPriceMonths +
            recognizedOneTimeRevenueCents -
            oneTimeDirectCostCents,
      netIncomeCents:
        promotionalPeriod.consolidated.netIncomeCents === null ||
        postPeriod.consolidated.netIncomeCents === null ||
        oneTimeDirectCostCents === null
          ? null
          : promotionalPeriod.consolidated.netIncomeCents *
              promotionalMonths +
            postPeriod.consolidated.netIncomeCents * fullPriceMonths +
            recognizedOneTimeRevenueCents -
            oneTimeDirectCostCents,
      discountImpactCents:
        (postPeriod.consolidated.recurringRevenueCents -
          promotionalPeriod.consolidated.recurringRevenueCents) *
          promotionalMonths +
        recognizedOneTimeDiscountCents
    };
    return accumulator;
  }, {} as SalesModularProposalResult['horizons']);
  const warnings: string[] = [];
  if (missingCosts.length > 0) {
    warnings.push(
      'Há custos indisponíveis. Margens incompletas não são tratadas como zero.'
    );
  }
  if (requiresJustification) {
    warnings.push(
      'A margem está abaixo do mínimo e exige justificativa administrativa.'
    );
  }

  const assertExactTotal = (
    field: string,
    actual: number | null,
    expected: number | null
  ) => {
    if (actual !== expected) {
      throw new Error(`PRICING_TOTAL_MISMATCH:${field}`);
    }
  };
  assertExactTotal(
    'grossRecurringRevenueCents',
    lines.reduce((sum, line) => sum + line.grossRecurringRevenueCents, 0),
    resolved.reduce(
      (sum, line) => sum + line.grossRecurringRevenueCents,
      0
    )
  );
  assertExactTotal(
    'promotionalRecurringRevenueCents',
    lines.reduce(
      (sum, line) => sum + line.promotionalRecurringRevenueCents,
      0
    ),
    promotionalPeriod.consolidated.recurringRevenueCents
  );
  assertExactTotal(
    'postPromotionRecurringRevenueCents',
    lines.reduce(
      (sum, line) => sum + line.postPromotionRecurringRevenueCents,
      0
    ),
    postPeriod.consolidated.recurringRevenueCents
  );
  for (const [periodName, periodLines, consolidated] of [
    ['promotional', lines.map((line) => line.promotional), promotionalPeriod.consolidated],
    ['postPromotion', lines.map((line) => line.postPromotion), postPeriod.consolidated]
  ] as const) {
    for (const field of [
      'directCostCents',
      'transactionAndTaxCostAllocatedCents',
      'sharedPlatformCostAllocatedCents',
      'contributionMarginCents',
      'ebitdaCents',
      'belowEbitdaCostAllocatedCents',
      'profitTaxAllocatedCents',
      'netIncomeCents'
    ] as const) {
      assertExactTotal(
        `${periodName}.${field}`,
        nullableSum(periodLines.map((line) => line[field])),
        consolidated[field]
      );
    }
  }

  return {
    modelVersion: SALES_MODULAR_PROPOSAL_MODEL_VERSION,
    catalogVersionId: catalog.id,
    catalogVersion: catalog.version,
    input,
    basePackage: {
      itemKey: 'clinical_core',
      tierId: baseTier.id,
      name: baseTier.publicName,
      limitQuantity: baseTier.maximumQuantity,
      includedStorageMb: baseTier.maximumQuantity
        ? baseTier.maximumQuantity * 100
        : null,
      occupiedQuantity: input.patientQuantity,
      availableQuantity:
        baseTier.maximumQuantity === null
          ? null
          : Math.max(0, baseTier.maximumQuantity - input.patientQuantity)
    },
    lines,
    promotional: promotionalPeriod.consolidated,
    postPromotion: postPeriod.consolidated,
    grossRecurringRevenueCents: lines.reduce(
      (sum, line) => sum + line.grossRecurringRevenueCents,
      0
    ),
    itemDiscountCents: lines.reduce(
      (sum, line) => sum + line.itemDiscountCents,
      0
    ),
    oneTimeDiscountCents,
    globalDiscountCents: globalDiscountTotal,
    promotionalRecurringRevenueCents:
      promotionalPeriod.consolidated.recurringRevenueCents,
    postPromotionRecurringRevenueCents:
      postPeriod.consolidated.recurringRevenueCents,
    oneTimeRevenueCents,
    oneTimeDirectCostCents,
    oneTimeContributionMarginCents,
    minimumRecommendedRecurringRevenueCents,
    maximumRecommendedDiscountBasisPoints,
    rating,
    requiresJustification,
    missingCosts: Array.from(new Set(missingCosts)),
    warnings,
    horizons
  };
}
