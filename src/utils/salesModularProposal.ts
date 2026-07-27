import type {
  OfferProfitabilityRating,
  SalesAssumptionSnapshot,
  SalesAssumptionValues,
  SalesUsageProfile,
  SimulationValueSource
} from './salesProfitability';
import {
  DEFAULT_REQUIRED_DRIVERS_BY_ITEM,
  MODULAR_COST_OWNERSHIP_LABELS,
  OWNERSHIP_ASSUMPTION_KEYS,
  emptySalesModularDriverConfig,
  findModularCostDuplicates,
  modularCostCategoryApplies,
  normalizeModularCostSettings,
  type ModularCostOwnershipKey,
  type SalesModularCostSettings,
  type SalesModularDriverConfig,
  type SalesModularDriverKey,
  type SalesModularDriverOverrides,
  type SalesModularDriverValue,
  type SalesModularProfile
} from './salesModularCostDrivers';

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
  otherVariableCostCents: number | null;
  supportFixedMonthlyCostCents: number | null;
  supportCostPerPatientCents: number | null;
  operationalFixedMonthlyCostCents: number | null;
  onboardingCostCents: number | null;
  sharedCostAllocationWeight: number;
  costSource: SimulationValueSource;
  sourceDetail: string;
  effectiveAt: string;
  driverConfig: SalesModularDriverConfig;
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
  modularCostSettings: SalesModularCostSettings;
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
  driverOverrides?: SalesModularDriverOverrides;
  internalNotes?: string;
  publicNotes?: string;
};

export type SalesModularDirectCostBreakdown = {
  fixedCostCents: number | null;
  patientCostCents: number | null;
  usageCostCents: number | null;
  storageCostCents: number | null;
  egressCostCents: number | null;
  notificationCostCents: number | null;
  otherVariableCostCents: number | null;
  supportCostCents: number | null;
  operationalCostCents: number | null;
  includedStorageGb: number;
  estimatedUsedStorageGb: number | null;
  estimatedEgressGb: number | null;
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
  resolvedDrivers: Partial<Record<SalesModularDriverKey, SalesModularDriverValue>>;
  missingDrivers: SalesModularDriverKey[];
  directCostBreakdown: SalesModularDirectCostBreakdown;
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
  directCostBreakdown: SalesModularDirectCostBreakdown;
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
  missingDrivers: Array<{
    itemKey: string;
    itemName: string;
    driver: SalesModularDriverKey;
  }>;
  possibleDuplicateCosts: Array<{
    category: ModularCostOwnershipKey;
    label: string;
    justified: boolean;
  }>;
  costOwnership: SalesModularCostSettings;
  totalsReconciled: boolean;
  forecast: {
    currentPatients: number;
    expectedPatients: number;
    commercialLimitPatients: number | null;
    aggressivePatients: number | null;
  };
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

export const SALES_MODULAR_PROPOSAL_MODEL_VERSION = '2026-07-27-v2';

const integer = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const nonNegativeInteger = (value: unknown, fallback = 0) =>
  Math.max(0, integer(value, fallback));

const nullableNonNegativeInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

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
  if (
    input.driverOverrides !== undefined &&
    (input.driverOverrides === null ||
      typeof input.driverOverrides !== 'object' ||
      Array.isArray(input.driverOverrides))
  ) {
    errors.push('driverOverrides');
  } else {
    for (const [itemKey, drivers] of Object.entries(
      input.driverOverrides || {}
    )) {
      if (!itemKey || !drivers || typeof drivers !== 'object') {
        errors.push(`driverOverrides.${itemKey || 'item'}`);
        continue;
      }
      for (const [driverKey, datum] of Object.entries(drivers)) {
        const value = datum as SalesModularDriverValue;
        if (
          !value ||
          (value.value !== null &&
            (!Number.isFinite(value.value) || value.value < 0)) ||
          !['actual', 'calculated', 'estimated', 'manual', 'unavailable'].includes(
            value.source
          ) ||
          !Number.isInteger(value.version) ||
          value.version < 1 ||
          String(value.sourceDetail || '').trim().length < 2 ||
          !Number.isFinite(new Date(value.effectiveAt).getTime())
        ) {
          errors.push(`driverOverrides.${itemKey}.${driverKey}`);
        }
      }
    }
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

type DirectCostResolution = {
  monthlyCostCents: number | null;
  oneTimeCostCents: number | null;
  breakdown: SalesModularDirectCostBreakdown;
  resolvedDrivers: Partial<
    Record<SalesModularDriverKey, SalesModularDriverValue>
  >;
  missingDrivers: SalesModularDriverKey[];
};

const unavailableDriver = (
  detail: string,
  effectiveAt: string,
  version: number
): SalesModularDriverValue => ({
  value: null,
  source: 'unavailable',
  sourceDetail: detail,
  effectiveAt,
  version
});

const calculatedDriver = (
  value: number,
  detail: string,
  effectiveAt: string,
  version: number
): SalesModularDriverValue => ({
  value,
  source: 'calculated',
  sourceDetail: detail,
  effectiveAt,
  version
});

const estimatedDriver = (
  value: number | null,
  detail: string,
  effectiveAt: string,
  version: number
): SalesModularDriverValue => ({
  value,
  source: value === null ? 'unavailable' : 'estimated',
  sourceDetail: detail,
  effectiveAt,
  version
});

const validDriverDatum = (
  value: SalesModularDriverValue | null | undefined
): value is SalesModularDriverValue =>
  Boolean(
    value &&
      value.source !== 'unavailable' &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      value.value >= 0
  );

const directMonthlyCost = (
  item: SalesPricingCatalogItem,
  tier: SalesPricingCatalogTier | null,
  selectionQuantity: number,
  input: SalesModularProposalInput,
  settings: SalesModularCostSettings
): DirectCostResolution => {
  const model = item.costModel;
  const emptyBreakdown: SalesModularDirectCostBreakdown = {
    fixedCostCents: null,
    patientCostCents: null,
    usageCostCents: null,
    storageCostCents: null,
    egressCostCents: null,
    notificationCostCents: null,
    otherVariableCostCents: null,
    supportCostCents: null,
    operationalCostCents: null,
    includedStorageGb: 0,
    estimatedUsedStorageGb: null,
    estimatedEgressGb: null
  };
  if (!model || model.costSource === 'unavailable') {
    return {
      monthlyCostCents: null,
      oneTimeCostCents: null,
      breakdown: emptyBreakdown,
      resolvedDrivers: {},
      missingDrivers: [
        ...(DEFAULT_REQUIRED_DRIVERS_BY_ITEM[item.itemKey] || [])
      ]
    };
  }

  const config = model.driverConfig || emptySalesModularDriverConfig(item.itemKey);
  const profile = input.usageProfile === 'custom'
    ? null
    : input.usageProfile as SalesModularProfile;
  const overrides = input.driverOverrides?.[item.itemKey] || {};
  const resolvedDrivers: Partial<
    Record<SalesModularDriverKey, SalesModularDriverValue>
  > = {};
  const resolveDriver = (
    key: SalesModularDriverKey,
    calculated?: SalesModularDriverValue
  ) => {
    if (resolvedDrivers[key]) return resolvedDrivers[key]!;
    const override = overrides[key];
    const configured = profile ? config.profiles?.[profile]?.[key] : undefined;
    const resolved = override || calculated || configured || unavailableDriver(
      'Driver não informado para este perfil.',
      model.effectiveAt,
      model.version
    );
    resolvedDrivers[key] = resolved;
    return resolved;
  };
  const requiredDrivers = config.requiredDrivers ||
    DEFAULT_REQUIRED_DRIVERS_BY_ITEM[item.itemKey] || [];

  if (item.itemKey === 'insurance_tiss') {
    resolveDriver(
      'tissGuides',
      calculatedDriver(
        selectionQuantity,
        'Quantidade de guias informada na proposta.',
        model.effectiveAt,
        model.version
      )
    );
  }

  for (const key of requiredDrivers) resolveDriver(key);
  for (const key of Object.keys(overrides) as SalesModularDriverKey[]) {
    resolveDriver(key);
  }

  const profileSettings = profile
    ? {
        ...settings.usageProfiles[profile],
        ...(config.usageProfileOverrides?.[profile] || {})
      }
    : null;
  const storageUtilization = resolveDriver(
    'storageUtilizationBasisPoints',
    profileSettings
      ? estimatedDriver(
          profileSettings.storageUtilizationBasisPoints,
          `Perfil ${profile}; percentual explícito e versionado no catálogo.`,
          model.effectiveAt,
          model.version
        )
      : undefined
  );
  const egressMultiplier = resolveDriver(
    'expectedEgressMultiplier',
    profileSettings
      ? estimatedDriver(
          profileSettings.expectedEgressMultiplier,
          `Perfil ${profile}; multiplicador explícito e versionado no catálogo.`,
          model.effectiveAt,
          model.version
        )
      : undefined
  );

  const missingDrivers = Array.from(new Set([
    ...requiredDrivers,
    ...(['clinical_core', 'additional_storage'].includes(item.itemKey)
      ? ['storageUtilizationBasisPoints' as const]
      : []),
    ...(['clinical_core', 'additional_storage', 'insurance_tiss', 'school_management'].includes(item.itemKey)
      ? ['expectedEgressMultiplier' as const]
      : [])
  ].filter((key) => !validDriverDatum(resolvedDrivers[key]))));

  const ownership = settings.ownership;
  const ownedRate = (
    field: keyof SalesPricingCostModel,
    key: ModularCostOwnershipKey
  ): number | null => {
    if (!modularCostCategoryApplies(item.itemKey, key)) return 0;
    if (ownership[key] !== 'item_direct') return 0;
    const value = model[field];
    if (value === null || value === undefined) {
      return null;
    }
    return nullableNonNegativeInteger(value);
  };
  const fixedRate = ownedRate(
    'directFixedMonthlyCostCents',
    'fixedMonthlyEligibleCost'
  );
  const fixedCostCents = fixedRate;
  const clinicRate = ownedRate('directCostPerClinicCents', 'variableClinicCost');
  const patientCostApplicable = modularCostCategoryApplies(
    item.itemKey,
    'variablePatientCost'
  );
  const supportPatientApplicable = modularCostCategoryApplies(
    item.itemKey,
    'supportPatientCost'
  );
  const patientDriverApplicable =
    patientCostApplicable || supportPatientApplicable;
  const patientRate = patientCostApplicable
    ? ownedRate('directCostPerPatientCents', 'variablePatientCost')
    : 0;
  const usageRate = nullableNonNegativeInteger(
    model.directCostPerUsageUnitCents
  );
  const processingRate = ownedRate('processingCostPerUnitCents', 'processingCost');
  const notificationApplicable = modularCostCategoryApplies(
    item.itemKey,
    'notificationCost'
  );
  const notificationRate = notificationApplicable
    ? ownedRate('notificationCostPerUnitCents', 'notificationCost')
    : 0;
  const supportFixedRate = ownedRate('supportFixedMonthlyCostCents', 'supportClinicCost');
  const supportPatientRate = supportPatientApplicable
    ? ownedRate('supportCostPerPatientCents', 'supportPatientCost')
    : 0;
  const otherVariableRate = ownedRate(
    'otherVariableCostCents',
    'otherVariableCost'
  );
  const operationalRate = ownedRate('operationalFixedMonthlyCostCents', 'operationalCost');
  const patientDriver = item.itemKey === 'school_management'
    ? resolvedDrivers.schoolPatients
    : patientDriverApplicable
      ? calculatedDriver(
        input.expectedPatientQuantity12Months,
        'Previsão de pacientes informada na proposta.',
        model.effectiveAt,
        model.version
      )
      : calculatedDriver(
          0,
          'A funcionalidade não possui custo por paciente.',
          model.effectiveAt,
          model.version
        );
  const patientCount = validDriverDatum(patientDriver)
    ? Number(patientDriver.value)
    : null;
  const patientCostCents = patientRate === null || patientCount === null
    ? null
    : patientRate * patientCount;

  const driverNumber = (key: SalesModularDriverKey) => {
    const datum = resolvedDrivers[key] || resolveDriver(key);
    return validDriverDatum(datum) ? Number(datum.value) : null;
  };
  const unitCost = (key: SalesModularDriverKey | 'onboardingHours') => {
    const value = config.unitCostsCents?.[key];
    return value === null || value === undefined
      ? null
      : nullableNonNegativeInteger(value);
  };
  const multiplyDriver = (
    key: SalesModularDriverKey,
    rate: number | null,
    divisor = 1
  ) => {
    const value = driverNumber(key);
    return value === null || rate === null
      ? null
      : Math.round((value * rate) / divisor);
  };

  let usageComponents: Array<number | null> = [];
  let notificationCount: number | null = 0;
  if (item.itemKey === 'clinical_core') {
    usageComponents = [
      multiplyDriver(
        'monthlyClinicalSessions',
        usageRate === null ? null : nonNegativeInteger(usageRate)
      ),
      multiplyDriver('monthlyAbaSessions', unitCost('monthlyAbaSessions')),
      multiplyDriver('monthlyAbaRecords', unitCost('monthlyAbaRecords'), 1000),
      multiplyDriver('generatedDocuments', unitCost('generatedDocuments'))
    ];
  } else if (item.itemKey === 'appointments_communication') {
    usageComponents = [
      multiplyDriver(
        'monthlyAppointments',
        usageRate === null ? null : nonNegativeInteger(usageRate)
      )
    ];
    const appointments = driverNumber('monthlyAppointments');
    const reminders = driverNumber('remindersPerAppointment');
    const notificationParts = [
      appointments === null || reminders === null
        ? null
        : appointments * reminders,
      driverNumber('internalNotifications'),
      driverNumber('emails'),
      driverNumber('webPushNotifications'),
      resolvedDrivers.futurePaidMessages
        ? driverNumber('futurePaidMessages')
        : 0
    ];
    notificationCount = notificationParts.every((value) => value !== null)
      ? notificationParts.reduce((sum, value) => sum + Number(value), 0)
      : null;
  } else if (item.itemKey === 'financial_management') {
    usageComponents = [
      multiplyDriver(
        'financialEntries',
        usageRate === null ? null : nonNegativeInteger(usageRate)
      ),
      multiplyDriver('financialReports', unitCost('financialReports')),
      multiplyDriver('recurringProcesses', unitCost('recurringProcesses')),
      multiplyDriver('recurringProcesses', processingRate)
    ];
  } else if (item.itemKey === 'insurance_tiss') {
    usageComponents = [
      multiplyDriver(
        'tissGuides',
        usageRate === null ? null : nonNegativeInteger(usageRate)
      ),
      multiplyDriver('tissBatches', unitCost('tissBatches')),
      multiplyDriver('tissXmlDocuments', unitCost('tissXmlDocuments')),
      multiplyDriver('tissDocuments', unitCost('tissDocuments')),
      processingRate === null
        ? null
        : nullableSum([
            multiplyDriver('tissBatches', processingRate),
            multiplyDriver('tissXmlDocuments', processingRate)
          ])
    ];
  } else if (item.itemKey === 'school_management') {
    usageComponents = [
      multiplyDriver(
        'schoolMeetings',
        usageRate === null ? null : nonNegativeInteger(usageRate)
      ),
      multiplyDriver('schoolParticipants', unitCost('schoolParticipants')),
      multiplyDriver('schoolDocuments', processingRate)
    ];
    notificationCount = driverNumber('schoolNotifications');
  } else if (!['additional_storage', 'onboarding'].includes(item.itemKey)) {
    usageComponents = [
      usageRate === null
        ? null
        : nonNegativeInteger(usageRate) * selectionQuantity
    ];
  }
  const usageCostCents = nullableSum(usageComponents);
  const notificationCostCents = notificationCount === null || notificationRate === null
    ? null
    : Math.round(notificationCount * notificationRate);

  let includedStorageGb = 0;
  let usedStorageGb: number | null = 0;
  if (item.itemKey === 'clinical_core') {
    const explicitIncludedMb = Number(tier?.metadata?.includedStorageMb);
    const includedMb = Number.isFinite(explicitIncludedMb) && explicitIncludedMb >= 0
      ? explicitIncludedMb
      : tier?.maximumQuantity === null || settings.includedStorageMbPerPatient === null
        ? null
        : tier.maximumQuantity * settings.includedStorageMbPerPatient;
    includedStorageGb = includedMb === null ? 0 : includedMb / 1024;
    const utilization = validDriverDatum(storageUtilization)
      ? Number(storageUtilization.value)
      : null;
    usedStorageGb = includedMb === null || utilization === null
      ? null
      : includedStorageGb * utilization / 10_000;
  } else if (item.itemKey === 'additional_storage') {
    includedStorageGb = storageGigabytes(item, tier, selectionQuantity);
    const utilization = validDriverDatum(storageUtilization)
      ? Number(storageUtilization.value)
      : null;
    usedStorageGb = utilization === null
      ? null
      : includedStorageGb * utilization / 10_000;
  } else if (['insurance_tiss', 'school_management'].includes(item.itemKey)) {
    usedStorageGb = driverNumber('expectedStorageGb');
  }
  const storageApplies =
    modularCostCategoryApplies(item.itemKey, 'storageCost') ||
    modularCostCategoryApplies(item.itemKey, 'egressCost');
  const storageRate = ownedRate('storageCostPerGbCents', 'storageCost');
  const egressRate = ownedRate('egressCostPerGbCents', 'egressCost');
  const estimatedEgressGb = storageApplies && usedStorageGb !== null && validDriverDatum(egressMultiplier)
    ? usedStorageGb * Number(egressMultiplier.value)
    : storageApplies
      ? null
      : 0;
  const storageCostCents = !storageApplies
    ? 0
    : usedStorageGb === null || storageRate === null
      ? null
      : Math.round(usedStorageGb * storageRate);
  const egressCostCents = !storageApplies
    ? 0
    : estimatedEgressGb === null || egressRate === null
      ? null
      : Math.round(estimatedEgressGb * egressRate);
  const supportCostCents = supportFixedRate === null || supportPatientRate === null || patientCount === null
    ? null
    : supportFixedRate + supportPatientRate * patientCount;
  const otherVariableCostCents = otherVariableRate;
  const operationalCostCents = operationalRate;
  const fixedAndClinic = fixedCostCents === null || clinicRate === null
    ? null
    : fixedCostCents + clinicRate;
  const breakdown: SalesModularDirectCostBreakdown = {
    fixedCostCents: fixedAndClinic,
    patientCostCents,
    usageCostCents,
    storageCostCents,
    egressCostCents,
    notificationCostCents,
    otherVariableCostCents,
    supportCostCents,
    operationalCostCents,
    includedStorageGb,
    estimatedUsedStorageGb: usedStorageGb,
    estimatedEgressGb
  };
  const monthlyCostCents = item.billingInterval === 'one_time'
    ? 0
    : nullableSum([
        breakdown.fixedCostCents,
        breakdown.patientCostCents,
        breakdown.usageCostCents,
        breakdown.storageCostCents,
        breakdown.egressCostCents,
        breakdown.notificationCostCents,
        breakdown.otherVariableCostCents,
        breakdown.supportCostCents,
        breakdown.operationalCostCents
      ]);

  let oneTimeCostCents: number | null = item.billingInterval === 'one_time'
    ? null
    : 0;
  if (item.billingInterval === 'one_time') {
    if (config.onboardingCalculationMode === 'manual') {
      oneTimeCostCents = model.onboardingCostCents === null
        ? null
        : nullableNonNegativeInteger(model.onboardingCostCents);
    } else {
      const hourlyRate = unitCost('onboardingHours');
      const hourCosts = nullableSum([
        multiplyDriver('onboardingConfigurationHours', hourlyRate),
        multiplyDriver('onboardingTrainingHours', hourlyRate),
        multiplyDriver('onboardingImportHours', hourlyRate)
      ]);
      const extraordinary = resolvedDrivers.extraordinaryOnboardingCostCents
        ? driverNumber('extraordinaryOnboardingCostCents')
        : 0;
      oneTimeCostCents = hourCosts === null || extraordinary === null
        ? null
        : hourCosts + Math.round(extraordinary);
    }
  }

  return {
    monthlyCostCents:
      missingDrivers.length > 0 && item.billingInterval !== 'one_time'
        ? null
        : monthlyCostCents,
    oneTimeCostCents:
      missingDrivers.length > 0 && item.billingInterval === 'one_time'
        ? null
        : oneTimeCostCents,
    breakdown,
    resolvedDrivers,
    missingDrivers
  };
};

const sharedPlatformCosts = (
  values: SalesAssumptionValues,
  patientQuantity: number,
  settings: SalesModularCostSettings,
  selectedItemKeys: readonly string[]
): number | null => {
  const sharedValue = (
    ownershipKey: ModularCostOwnershipKey
  ): number | null => {
    if (
      settings.ownership[ownershipKey] !== 'shared' ||
      !selectedItemKeys.some((itemKey) =>
        modularCostCategoryApplies(itemKey, ownershipKey)
      )
    ) return 0;
    const assumptionKey = OWNERSHIP_ASSUMPTION_KEYS[ownershipKey] as keyof SalesAssumptionValues;
    const value = values[assumptionKey];
    return value === null || value === undefined ? null : Number(value);
  };
  const variablePatient = sharedValue('variablePatientCost');
  const variableClinic = sharedValue('variableClinicCost');
  const storage = sharedValue('storageCost');
  const egress = sharedValue('egressCost');
  const processing = sharedValue('processingCost');
  const notification = sharedValue('notificationCost');
  const otherVariable = sharedValue('otherVariableCost');
  const supportClinic = sharedValue('supportClinicCost');
  const supportPatient = sharedValue('supportPatientCost');
  const operational = sharedValue('operationalCost');
  const fixed = settings.ownership.fixedMonthlyEligibleCost === 'shared'
    ? fixedAllocationCents(values, patientQuantity)
    : 0;
  const parts = [
    variablePatient,
    variableClinic,
    storage,
    egress,
    processing,
    notification,
    otherVariable,
    supportClinic,
    supportPatient,
    operational,
    fixed
  ];
  if (parts.some((value) => value === null)) return null;
  return (
    patientQuantity * Number(variablePatient) +
    Number(variableClinic) +
    Number(storage) +
    Number(egress) +
    Number(processing) +
    Number(notification) +
    Number(otherVariable) +
    Number(supportClinic) +
    patientQuantity * Number(supportPatient) +
    Number(operational) +
    Number(fixed)
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
  itemKey: string;
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
  directCostBreakdown: SalesModularDirectCostBreakdown;
};

const calculatePeriod = (
  sourceLines: Array<{
    itemKey: string;
    netRevenueCents: number;
    grossRevenueCents: number;
    directCostCents: number | null;
    directCostBreakdown: SalesModularDirectCostBreakdown;
    weight: number;
    isBase: boolean;
  }>,
  values: SalesAssumptionValues,
  allocation: SalesPricingCatalogSnapshot['allocationSettings'],
  patientQuantity: number,
  settings: SalesModularCostSettings
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

  const platformTotal = sharedPlatformCosts(
    values,
    patientQuantity,
    settings,
    lines.map((line) => line.itemKey)
  );
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
    netMarginBasisPoints: null,
    directCostBreakdown: {
      fixedCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.fixedCostCents)
      ),
      patientCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.patientCostCents)
      ),
      usageCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.usageCostCents)
      ),
      storageCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.storageCostCents)
      ),
      egressCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.egressCostCents)
      ),
      notificationCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.notificationCostCents)
      ),
      otherVariableCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.otherVariableCostCents)
      ),
      supportCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.supportCostCents)
      ),
      operationalCostCents: nullableSum(
        lines.map((line) => line.directCostBreakdown.operationalCostCents)
      ),
      includedStorageGb: lines.reduce(
        (sum, line) => sum + line.directCostBreakdown.includedStorageGb,
        0
      ),
      estimatedUsedStorageGb: nullableSum(
        lines.map((line) => line.directCostBreakdown.estimatedUsedStorageGb)
      ),
      estimatedEgressGb: nullableSum(
        lines.map((line) => line.directCostBreakdown.estimatedEgressGb)
      )
    }
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
  const costSettings = normalizeModularCostSettings(
    catalog.modularCostSettings
  );

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
    const costResolution = directMonthlyCost(
      item,
      tier,
      amounts.quantity,
      input,
      costSettings
    );
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
      directCostCents: costResolution.monthlyCostCents,
      oneTimeDirectCostCents: costResolution.oneTimeCostCents,
      costResolution
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
      itemKey: line.item.itemKey,
      netRevenueCents:
        line.postPromotionRecurringRevenueCents -
        globalAllocations[index],
      grossRevenueCents: line.grossRecurringRevenueCents,
      directCostCents: line.directCostCents,
      directCostBreakdown: line.costResolution.breakdown,
      weight: line.item.costModel?.sharedCostAllocationWeight || 0,
      isBase: line.item.itemKey === 'clinical_core'
    })),
    values,
    allocationSettings,
    input.expectedPatientQuantity12Months,
    costSettings
  );
  const postPeriod = calculatePeriod(
    resolved.map((line) => ({
      itemKey: line.item.itemKey,
      netRevenueCents: line.postPromotionRecurringRevenueCents,
      grossRevenueCents: line.grossRecurringRevenueCents,
      directCostCents: line.directCostCents,
      directCostBreakdown: line.costResolution.breakdown,
      weight: line.item.costModel?.sharedCostAllocationWeight || 0,
      isBase: line.item.itemKey === 'clinical_core'
    })),
    values,
    allocationSettings,
    input.expectedPatientQuantity12Months,
    costSettings
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
    'depreciationAmortizationCents',
    'financialExpensesCents',
    'profitTaxBasisPoints',
    'otherBelowEbitdaCents',
    'minimumMarginBasisPoints',
    'healthyMarginBasisPoints',
    'attentionMarginBasisPoints'
  ];
  for (const ownershipKey of Object.keys(costSettings.ownership) as ModularCostOwnershipKey[]) {
    if (costSettings.ownership[ownershipKey] === 'shared') {
      requiredShared.push(
        OWNERSHIP_ASSUMPTION_KEYS[ownershipKey] as keyof SalesAssumptionValues
      );
    }
  }
  if (requiredShared.some((key) => values[key] === null)) {
    missingCosts.push('Custos compartilhados e premissas');
  }
  const missingDrivers = resolved.flatMap((line) =>
    line.costResolution.missingDrivers.map((driver) => ({
      itemKey: line.item.itemKey,
      itemName: line.item.publicName,
      driver
    }))
  );
  const possibleDuplicateCosts = findModularCostDuplicates(
    costSettings,
    catalog.items,
    values as unknown as Record<string, any>
  ).map((category) => ({
    category,
    label: MODULAR_COST_OWNERSHIP_LABELS[category],
    justified:
      String(costSettings.ownershipJustifications[category] || '').trim()
        .length >= 12
  }));

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
      if (line.costResolution.missingDrivers.length > 0) {
        warnings.push(
          `Dados insuficientes: ${line.costResolution.missingDrivers.join(', ')}.`
        );
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
        resolvedDrivers: line.costResolution.resolvedDrivers,
        missingDrivers: line.costResolution.missingDrivers,
        directCostBreakdown: line.costResolution.breakdown,
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
  if (possibleDuplicateCosts.length > 0) {
    warnings.push(
      `Possível custo duplicado: ${possibleDuplicateCosts
        .map((duplicate) => duplicate.label)
        .join(', ')}.`
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
    for (const field of [
      'fixedCostCents',
      'patientCostCents',
      'usageCostCents',
      'storageCostCents',
      'egressCostCents',
      'notificationCostCents',
      'otherVariableCostCents',
      'supportCostCents',
      'operationalCostCents'
    ] as const) {
      assertExactTotal(
        `${periodName}.directCostBreakdown.${field}`,
        nullableSum(lines.map((line) => line.directCostBreakdown[field])),
        consolidated.directCostBreakdown[field]
      );
    }
    assertExactTotal(
      `${periodName}.directCostBreakdown.total`,
      nullableSum([
        consolidated.directCostBreakdown.fixedCostCents,
        consolidated.directCostBreakdown.patientCostCents,
        consolidated.directCostBreakdown.usageCostCents,
        consolidated.directCostBreakdown.storageCostCents,
        consolidated.directCostBreakdown.egressCostCents,
        consolidated.directCostBreakdown.notificationCostCents,
        consolidated.directCostBreakdown.otherVariableCostCents,
        consolidated.directCostBreakdown.supportCostCents,
        consolidated.directCostBreakdown.operationalCostCents
      ]),
      consolidated.directCostCents
    );
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
      includedStorageMb:
        baseTier.maximumQuantity !== null &&
        costSettings.includedStorageMbPerPatient !== null
        ? baseTier.maximumQuantity * costSettings.includedStorageMbPerPatient
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
    missingDrivers,
    possibleDuplicateCosts,
    costOwnership: costSettings,
    totalsReconciled: true,
    forecast: {
      currentPatients: input.patientQuantity,
      expectedPatients: input.expectedPatientQuantity12Months,
      commercialLimitPatients: baseTier.maximumQuantity,
      aggressivePatients: baseTier.maximumQuantity
    },
    warnings,
    horizons
  };
}
