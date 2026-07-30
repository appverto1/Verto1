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
import {
  addCommercialDuration,
  buildOfferCommercialPhases,
  calculateCustomCapacity,
  discountAppliesAt,
  normalizeOfferItemDiscount,
  validateCustomCapacityPolicy,
  validateDiscountStacking,
  type CustomCapacityPolicy,
  type CustomCapacitySnapshot,
  type OfferCommercialPhase,
  type OfferItemDiscount
} from './salesCommercialEvolution';
import {
  calculateMaximumSupportedCostCents,
  calculateSalesDriverExpansion,
  calculateSalesMinimumPriceCents,
  calculateSalesModuleEffect,
  classifyModuleIncrementalMargin,
  formatSalesBasisPointsPercent,
  marginBasisPoints,
  salesProfitabilityPolicyThresholds,
  validateSalesProfitabilityPolicy,
  type SalesModularEconomicsResult,
  type SalesPriceThresholds,
  type SalesProfitabilityPolicy,
  type SalesExpansionItemKey
} from './salesModularEconomics';

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

export type SalesCommercialPricingEditMode =
  | 'per_patient'
  | 'monthly_total';

export type SalesCommercialEstimateStatus =
  | 'calibrated'
  | 'estimated'
  | 'pre_launch'
  | 'insufficient_data';

export type SalesCommercialConfidenceLevel =
  | 'high'
  | 'medium'
  | 'low'
  | 'unavailable';

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
  customCapacityPolicy: CustomCapacityPolicy | null;
  hasVersionedCustomCapacityPolicy: boolean;
  profitabilityPolicy: SalesProfitabilityPolicy | null;
  hasVersionedProfitabilityPolicy: boolean;
  items: SalesPricingCatalogItem[];
};

export type SalesModularLineSelection = {
  itemKey: string;
  tierId?: string | null;
  quantity: number;
  itemDiscountBasisPoints?: number;
  customRecurringAmountCents?: number | null;
  customOneTimeAmountCents?: number | null;
  pricingEditMode?: SalesCommercialPricingEditMode;
  proposedPricePerPatientCents?: number | null;
  offerDiscount?: OfferItemDiscount | null;
};

export type SalesModularProposalInput = {
  patientQuantity: number;
  expectedPatientQuantity12Months: number;
  basePackageTierId: string;
  basePackageSelectionMode?: 'automatic' | 'manual';
  customBasePackageLimit?: number | null;
  customCapacityBlocks?: number | null;
  customCapacitySelectionMode?: 'automatic' | 'manual';
  lines: SalesModularLineSelection[];
  globalDiscountBasisPoints: number;
  discountDurationMonths: number;
  offerValidityDays: number;
  onboardingInstallments?: number;
  usageProfile: SalesUsageProfile;
  driverOverrides?: SalesModularDriverOverrides;
  internalNotes?: string;
  publicNotes?: string;
  offerStartsAt?: string;
  discountStackingJustification?: string;
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
  offerDiscount: OfferItemDiscount | null;
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
  commercialPricing: {
    enabled: boolean;
    editMode: SalesCommercialPricingEditMode | 'legacy_monthly_total';
    contractedCapacityPatients: number | null;
    proposedPricePerPatientCents: number | null;
    derivedMonthlyRevenueCents: number | null;
    requestedMonthlyRevenueCents: number | null;
    monthlyTotalRepresentable: boolean;
    nearestRepresentableMonthlyRevenueCents: number | null;
    monthlyTotalAdjustmentCents: number | null;
    estimatedMonthlyCostCents: number | null;
    effectiveCostPerPatientCents: number | null;
    marginalCostPerPatientCents: number | null;
    minimumPricePerPatientCents: number | null;
    recommendedPricePerPatientCents: number | null;
    contributionCents: number | null;
    contributionMarginBasisPoints: number | null;
    estimateStatus: SalesCommercialEstimateStatus;
    confidenceLevel: SalesCommercialConfidenceLevel;
    costModelVersion: number | null;
    assumptionsVersion: number;
    estimatedAt: string;
  };
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

export type SalesCapacityBlockModulePricing = {
  itemKey: string;
  publicName: string;
  normalPricePerPatientCents: number;
  effectivePricePerPatientCents: number;
  normalBlockRevenueCents: number;
  blockRevenueCents: number;
  subsidizedBlockRevenueCents: number;
  marginalCostPerPatientCents: number | null;
  blockMarginalCostCents: number | null;
  blockContributionCents: number | null;
  blockIncrementalMarginBasisPoints: number | null;
};

export type SalesCapacityBlockPhasePricing = {
  schemaVersion: 1;
  phaseNumber: number;
  startsAt: string;
  endsAt: string | null;
  baseCapacityPatients: number;
  contractedCapacityPatients: number;
  blockSizePatients: number;
  selectedBlocks: number;
  effectivePricePerPatientCents: number;
  contractedMonthlyRevenueCents: number;
  blockPriceCents: number;
  blocksRevenueCents: number;
  blockMarginalCostCents: number | null;
  blockContributionCents: number | null;
  blockIncrementalMarginBasisPoints: number | null;
  blockMinimumPriceCents: number | null;
  blockMarginStatus:
    | 'healthy'
    | 'acceptable'
    | 'attention'
    | 'blocked'
    | 'insufficient_data';
  modules: SalesCapacityBlockModulePricing[];
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
    capacity: CustomCapacitySnapshot | null;
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
  commercialPhases: OfferCommercialPhase[];
  economics: SalesModularEconomicsResult | null;
  commercialPricing: {
    schemaVersion: 1;
    enabled: boolean;
    contractedCapacityPatients: number | null;
    selectedRecurringItemKeys: string[];
    missingPriceItemKeys: string[];
    monthlyTotalMismatches: Array<{
      itemKey: string;
      publicName: string;
      requestedMonthlyRevenueCents: number;
      proposedPricePerPatientCents: number;
      nearestRepresentableMonthlyRevenueCents: number;
      adjustmentCents: number;
    }>;
    totalProposedPricePerPatientCents: number | null;
    nextBlockPriceCents: number | null;
    nextBlockMarginalCostCents: number | null;
    nextBlockContributionCents: number | null;
    nextBlockMarginBasisPoints: number | null;
    capacityBlockPhases: SalesCapacityBlockPhasePricing[];
    estimateStatus: SalesCommercialEstimateStatus;
    assumptionSetVersion: number;
    calculatedAt: string;
  };
};

export const SALES_MODULAR_PROPOSAL_MODEL_VERSION = '2026-07-28-v4';
export const SALES_MODULAR_ECONOMICS_MODEL_VERSION = '2026-07-28-v5';
export const SALES_MODULAR_PER_PATIENT_MODEL_VERSION = '2026-07-28-v6';
export const SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION = '2026-07-30-v7';

export const SALES_COMMERCIAL_MODULE_DEPENDENCIES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  appointments_communication: ['clinical_core'],
  financial_management: ['clinical_core'],
  insurance_tiss: ['clinical_core'],
  school_management: ['clinical_core'],
  additional_storage: ['clinical_core'],
  onboarding: ['clinical_core']
});

export const findMissingSalesModuleDependencies = (
  selectedItemKeys: readonly string[]
) => {
  const selected = new Set(selectedItemKeys);
  return selectedItemKeys.flatMap((itemKey) =>
    (SALES_COMMERCIAL_MODULE_DEPENDENCIES[itemKey] || [])
      .filter((dependency) => !selected.has(dependency))
      .map((dependency) => ({ itemKey, dependency }))
  );
};

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

export const roundSalesMoneyCents = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error('PRICING_MONEY_INVALID');
  }
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || Math.abs(rounded) > 1_000_000_000) {
    throw new Error('PRICING_MONEY_INVALID');
  }
  return rounded;
};

export const multiplySalesMoneyBasisPoints = (
  amountCents: number,
  basisPoints: number
) => {
  const amount = roundSalesMoneyCents(amountCents);
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new Error('PRICING_BASIS_POINTS_INVALID');
  }
  return roundSalesMoneyCents((amount * basisPoints) / 10_000);
};

const multiplyBasisPoints = multiplySalesMoneyBasisPoints;

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

export function deriveSalesCapacityBlockPhases(args: {
  phases: OfferCommercialPhase[];
  capacity: CustomCapacitySnapshot;
  recurringLines: Array<{
    itemKey: string;
    publicName: string;
    normalPricePerPatientCents: number | null;
    blockDirectMarginalCostCents: number | null;
  }>;
  percentageCostBasisPoints: number | null;
  policy: SalesProfitabilityPolicy;
}): SalesCapacityBlockPhasePricing[] {
  const contractedCapacityPatients =
    args.capacity.totalContractedLimitPatients;
  const blockSizePatients = args.capacity.policy.blockSizePatients;
  if (
    !Number.isSafeInteger(contractedCapacityPatients) ||
    contractedCapacityPatients < 1 ||
    !Number.isSafeInteger(blockSizePatients) ||
    blockSizePatients < 1
  ) {
    throw new Error('PRICING_CAPACITY_INVALID');
  }
  const sourceByItemKey = new Map(
    args.recurringLines.map((line) => [line.itemKey, line])
  );
  return args.phases.map((phase) => {
    const recurringPhaseLines = phase.lines.filter(
      (line) => line.billingInterval === 'monthly'
    );
    const preliminaryModules = recurringPhaseLines.map((phaseLine) => {
      const source = sourceByItemKey.get(phaseLine.itemKey);
      if (
        !source ||
        source.normalPricePerPatientCents === null ||
        phaseLine.activePriceCents % contractedCapacityPatients !== 0
      ) {
        throw new Error(
          `PRICING_PHASE_PER_PATIENT_MISMATCH:${phaseLine.itemKey}`
        );
      }
      const normalPricePerPatientCents = roundSalesMoneyCents(
        source.normalPricePerPatientCents
      );
      const effectivePricePerPatientCents =
        phaseLine.activePriceCents / contractedCapacityPatients;
      const normalBlockRevenueCents =
        normalPricePerPatientCents * blockSizePatients;
      const blockRevenueCents =
        effectivePricePerPatientCents * blockSizePatients;
      const directMarginalCostCents =
        source.blockDirectMarginalCostCents === null
          ? null
          : roundSalesMoneyCents(source.blockDirectMarginalCostCents);
      return {
        itemKey: phaseLine.itemKey,
        publicName: phaseLine.publicName,
        normalPricePerPatientCents,
        effectivePricePerPatientCents,
        normalBlockRevenueCents,
        blockRevenueCents,
        subsidizedBlockRevenueCents:
          normalBlockRevenueCents - blockRevenueCents,
        directMarginalCostCents
      };
    });
    const blockPriceCents = preliminaryModules.reduce(
      (sum, module) => sum + module.blockRevenueCents,
      0
    );
    const totalDirectMarginalCostCents = nullableSum(
      preliminaryModules.map((module) => module.directMarginalCostCents)
    );
    const totalPercentageCostCents =
      args.percentageCostBasisPoints === null
        ? null
        : multiplyBasisPoints(
            blockPriceCents,
            args.percentageCostBasisPoints
          );
    const percentageAllocations =
      totalPercentageCostCents === null
        ? preliminaryModules.map(() => null)
        : allocateSalesCents(
            totalPercentageCostCents,
            preliminaryModules.map((module) => module.blockRevenueCents),
            Math.max(
              0,
              preliminaryModules.findIndex(
                (module) => module.itemKey === 'clinical_core'
              )
            )
          );
    const modules: SalesCapacityBlockModulePricing[] =
      preliminaryModules.map((module, index) => {
        const blockMarginalCostCents = nullableSum([
          module.directMarginalCostCents,
          percentageAllocations[index]
        ]);
        const blockContributionCents =
          blockMarginalCostCents === null
            ? null
            : module.blockRevenueCents - blockMarginalCostCents;
        return {
          itemKey: module.itemKey,
          publicName: module.publicName,
          normalPricePerPatientCents:
            module.normalPricePerPatientCents,
          effectivePricePerPatientCents:
            module.effectivePricePerPatientCents,
          normalBlockRevenueCents: module.normalBlockRevenueCents,
          blockRevenueCents: module.blockRevenueCents,
          subsidizedBlockRevenueCents:
            module.subsidizedBlockRevenueCents,
          marginalCostPerPatientCents:
            module.directMarginalCostCents === null
              ? null
              : roundSalesMoneyCents(
                  module.directMarginalCostCents / blockSizePatients
                ),
          blockMarginalCostCents,
          blockContributionCents,
          blockIncrementalMarginBasisPoints: marginBasisPoints(
            module.blockRevenueCents,
            blockMarginalCostCents
          )
        };
      });
    const blockMarginalCostCents = nullableSum([
      totalDirectMarginalCostCents,
      totalPercentageCostCents
    ]);
    const blockContributionCents =
      blockMarginalCostCents === null
        ? null
        : blockPriceCents - blockMarginalCostCents;
    const blockIncrementalMarginBasisPoints = marginBasisPoints(
      blockPriceCents,
      blockMarginalCostCents
    );
    const blockMinimumPriceCents = calculateSalesMinimumPriceCents({
      directCostCents: totalDirectMarginalCostCents,
      fixedAllocatedCostCents: 0,
      fixedPaymentFeeCents: 0,
      targetEbitdaMarginBasisPoints:
        args.policy.capacityMinimumIncrementalMarginBasisPoints,
      stripePercentageBasisPoints: args.percentageCostBasisPoints,
      delinquencyPercentageBasisPoints: 0,
      taxPercentageBasisPoints: 0
    });
    const effectivePricePerPatientCents = modules.reduce(
      (sum, module) => sum + module.effectivePricePerPatientCents,
      0
    );
    const contractedMonthlyRevenueCents =
      effectivePricePerPatientCents * contractedCapacityPatients;
    if (contractedMonthlyRevenueCents !== phase.recurringRevenueCents) {
      throw new Error(
        `PRICING_PHASE_TOTAL_MISMATCH:${phase.phaseNumber}`
      );
    }
    return {
      schemaVersion: 1,
      phaseNumber: phase.phaseNumber,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
      baseCapacityPatients: args.capacity.baseLimitPatients,
      contractedCapacityPatients,
      blockSizePatients,
      selectedBlocks: args.capacity.selectedBlocks,
      effectivePricePerPatientCents,
      contractedMonthlyRevenueCents,
      blockPriceCents,
      blocksRevenueCents:
        blockPriceCents * args.capacity.selectedBlocks,
      blockMarginalCostCents,
      blockContributionCents,
      blockIncrementalMarginBasisPoints,
      blockMinimumPriceCents,
      blockMarginStatus: classifyModuleIncrementalMargin(
        blockIncrementalMarginBasisPoints,
        args.policy,
        'capacity'
      ),
      modules
    };
  });
}

const reconciliationNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const reconciliationText = (value: unknown) =>
  typeof value === 'string' ? value : '';

export function canonicalizeSalesCapacityBlockPhasesForReconciliation(
  raw: unknown
) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((phase: any) => ({
      schemaVersion: reconciliationNumber(phase?.schemaVersion),
      phaseNumber: reconciliationNumber(phase?.phaseNumber),
      startsAt: reconciliationText(phase?.startsAt),
      endsAt:
        phase?.endsAt === null || phase?.endsAt === undefined
          ? null
          : reconciliationText(phase.endsAt),
      baseCapacityPatients: reconciliationNumber(
        phase?.baseCapacityPatients
      ),
      contractedCapacityPatients: reconciliationNumber(
        phase?.contractedCapacityPatients
      ),
      blockSizePatients: reconciliationNumber(phase?.blockSizePatients),
      selectedBlocks: reconciliationNumber(phase?.selectedBlocks),
      effectivePricePerPatientCents: reconciliationNumber(
        phase?.effectivePricePerPatientCents
      ),
      contractedMonthlyRevenueCents: reconciliationNumber(
        phase?.contractedMonthlyRevenueCents
      ),
      blockPriceCents: reconciliationNumber(phase?.blockPriceCents),
      blocksRevenueCents: reconciliationNumber(phase?.blocksRevenueCents),
      blockMarginalCostCents: reconciliationNumber(
        phase?.blockMarginalCostCents
      ),
      blockContributionCents: reconciliationNumber(
        phase?.blockContributionCents
      ),
      blockIncrementalMarginBasisPoints: reconciliationNumber(
        phase?.blockIncrementalMarginBasisPoints
      ),
      blockMinimumPriceCents: reconciliationNumber(
        phase?.blockMinimumPriceCents
      ),
      blockMarginStatus: reconciliationText(phase?.blockMarginStatus),
      modules: (Array.isArray(phase?.modules) ? phase.modules : [])
        .map((module: any) => ({
          itemKey: reconciliationText(module?.itemKey),
          normalPricePerPatientCents: reconciliationNumber(
            module?.normalPricePerPatientCents
          ),
          effectivePricePerPatientCents: reconciliationNumber(
            module?.effectivePricePerPatientCents
          ),
          normalBlockRevenueCents: reconciliationNumber(
            module?.normalBlockRevenueCents
          ),
          blockRevenueCents: reconciliationNumber(
            module?.blockRevenueCents
          ),
          subsidizedBlockRevenueCents: reconciliationNumber(
            module?.subsidizedBlockRevenueCents
          ),
          blockMarginalCostCents: reconciliationNumber(
            module?.blockMarginalCostCents
          ),
          blockContributionCents: reconciliationNumber(
            module?.blockContributionCents
          ),
          blockIncrementalMarginBasisPoints: reconciliationNumber(
            module?.blockIncrementalMarginBasisPoints
          )
        }))
        .sort((left, right) => left.itemKey.localeCompare(right.itemKey))
    }))
    .sort(
      (left, right) =>
        Number(left.phaseNumber ?? Number.MAX_SAFE_INTEGER) -
        Number(right.phaseNumber ?? Number.MAX_SAFE_INTEGER)
    );
}

export function salesCapacityBlockPhasesMatch(
  left: unknown,
  right: unknown
) {
  return (
    JSON.stringify(
      canonicalizeSalesCapacityBlockPhasesForReconciliation(left)
    ) ===
    JSON.stringify(
      canonicalizeSalesCapacityBlockPhasesForReconciliation(right)
    )
  );
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

export function salesModularProposalRequiresVersionedProfitabilityPolicy(
  input: Pick<SalesModularProposalInput, 'basePackageTierId'> | null | undefined,
  catalog: Pick<SalesPricingCatalogSnapshot, 'items'> | null | undefined
): boolean {
  if (!input?.basePackageTierId || !catalog) return false;
  const clinicalCore = catalog.items.find(
    (item) => item.itemKey === 'clinical_core' && item.isActive
  );
  const selectedTier = clinicalCore?.tiers.find(
    (tier) => tier.id === input.basePackageTierId
  );
  return Boolean(
    selectedTier &&
      (selectedTier.isCustom || selectedTier.maximumQuantity === null)
  );
}

export const salesPackageDemand = (
  patientQuantity: number,
  expectedPatientQuantity12Months: number
) => Math.max(
  1,
  integer(patientQuantity, 1),
  integer(expectedPatientQuantity12Months, 1)
);

export function isSalesPackageTierCompatible(
  catalog: SalesPricingCatalogSnapshot,
  tierId: string | null | undefined,
  demand: number
): boolean {
  if (!tierId) return false;
  const clinicalCore = catalog.items.find(
    (item) => item.itemKey === 'clinical_core' && item.isActive
  );
  const tier = clinicalCore?.tiers.find((candidate) => candidate.id === tierId);
  if (!tier) return false;
  const recommended = recommendSalesPackageTier(catalog, demand);
  if (tier.isCustom || tier.maximumQuantity === null) {
    return Boolean(
      recommended &&
      (recommended.isCustom || recommended.maximumQuantity === null)
    );
  }
  return demand <= tier.maximumQuantity;
}

export type SalesPackageTierSelectionResolution = {
  demand: number;
  recommendedTier: SalesPricingCatalogTier | null;
  selectedTier: SalesPricingCatalogTier | null;
  mode: 'automatic' | 'manual';
  manualOverrideRemoved: boolean;
};

export function resolveSalesPackageTierSelection(
  catalog: SalesPricingCatalogSnapshot,
  input: Pick<
    SalesModularProposalInput,
    | 'patientQuantity'
    | 'expectedPatientQuantity12Months'
    | 'basePackageTierId'
    | 'basePackageSelectionMode'
  >
): SalesPackageTierSelectionResolution {
  const demand = salesPackageDemand(
    input.patientQuantity,
    input.expectedPatientQuantity12Months
  );
  const recommendedTier = recommendSalesPackageTier(catalog, demand);
  const requestedMode = input.basePackageSelectionMode === 'manual'
    ? 'manual'
    : 'automatic';
  const currentTier = catalog.items
    .find((item) => item.itemKey === 'clinical_core' && item.isActive)
    ?.tiers.find((tier) => tier.id === input.basePackageTierId) || null;
  const manualCompatible =
    requestedMode === 'manual' &&
    currentTier !== null &&
    isSalesPackageTierCompatible(catalog, currentTier.id, demand);

  return {
    demand,
    recommendedTier,
    selectedTier: manualCompatible ? currentTier : recommendedTier,
    mode: manualCompatible ? 'manual' : 'automatic',
    manualOverrideRemoved: requestedMode === 'manual' && !manualCompatible
  };
}

export function applySalesPackageTierSelection(
  input: SalesModularProposalInput,
  tier: SalesPricingCatalogTier,
  mode: 'automatic' | 'manual'
): SalesModularProposalInput {
  const demand = salesPackageDemand(
    input.patientQuantity,
    input.expectedPatientQuantity12Months
  );
  const customBasePackageLimit = tier.isCustom || tier.maximumQuantity === null
    ? Number.isInteger(input.customBasePackageLimit)
      ? Number(input.customBasePackageLimit)
      : 150
    : null;
  const customPricing = tier.isCustom || tier.maximumQuantity === null;
  return {
    ...input,
    basePackageTierId: tier.id,
    basePackageSelectionMode: mode,
    customBasePackageLimit,
    customCapacityBlocks:
      tier.isCustom || tier.maximumQuantity === null
        ? input.customCapacityBlocks ?? null
        : null,
    customCapacitySelectionMode:
      tier.isCustom || tier.maximumQuantity === null
        ? input.customCapacitySelectionMode || 'automatic'
        : 'automatic',
    lines: input.lines.map((line) => {
      const recurringCustomLine =
        customPricing && line.itemKey !== 'onboarding';
      if (line.itemKey === 'clinical_core') {
        return {
          ...line,
          tierId: tier.id,
          quantity: input.patientQuantity,
          pricingEditMode: recurringCustomLine
            ? line.pricingEditMode || 'per_patient'
            : undefined,
          proposedPricePerPatientCents: recurringCustomLine
            ? line.proposedPricePerPatientCents ?? null
            : undefined,
          customRecurringAmountCents: recurringCustomLine
            ? line.pricingEditMode === 'monthly_total'
              ? line.customRecurringAmountCents ?? null
              : null
            : null
        };
      }
      return recurringCustomLine
        ? {
            ...line,
            pricingEditMode: line.pricingEditMode || 'per_patient',
            proposedPricePerPatientCents:
              line.proposedPricePerPatientCents ?? null,
            customRecurringAmountCents:
              line.pricingEditMode === 'monthly_total'
                ? line.customRecurringAmountCents ?? null
                : null
          }
        : line;
    })
  };
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
    input.expectedPatientQuantity12Months < 1 ||
    input.expectedPatientQuantity12Months > 100_000
  ) {
    errors.push('expectedPatientQuantity12Months');
  }
  if (!input.basePackageTierId) errors.push('basePackageTierId');
  if (
    input.basePackageSelectionMode !== undefined &&
    !['automatic', 'manual'].includes(input.basePackageSelectionMode)
  ) {
    errors.push('basePackageSelectionMode');
  }
  if (
    input.customBasePackageLimit !== undefined &&
    input.customBasePackageLimit !== null &&
    (!Number.isInteger(input.customBasePackageLimit) ||
      input.customBasePackageLimit < 1 ||
      input.customBasePackageLimit > 100_000)
  ) {
    errors.push('customBasePackageLimit');
  }
  if (
    input.customCapacityBlocks !== undefined &&
    input.customCapacityBlocks !== null &&
    (!Number.isInteger(input.customCapacityBlocks) ||
      input.customCapacityBlocks < 0 ||
      input.customCapacityBlocks > 10_000)
  ) {
    errors.push('customCapacityBlocks');
  }
  if (
    input.customCapacitySelectionMode !== undefined &&
    !['automatic', 'manual'].includes(input.customCapacitySelectionMode)
  ) {
    errors.push('customCapacitySelectionMode');
  }
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
      if (line.offerDiscount) {
        try {
          normalizeOfferItemDiscount(line.offerDiscount);
        } catch {
          errors.push(`lines.${index}.offerDiscount`);
        }
      }
      if (
        line.pricingEditMode !== undefined &&
        !['per_patient', 'monthly_total'].includes(line.pricingEditMode)
      ) {
        errors.push(`lines.${index}.pricingEditMode`);
      }
      if (
        line.proposedPricePerPatientCents !== null &&
        line.proposedPricePerPatientCents !== undefined &&
        (
          !Number.isFinite(line.proposedPricePerPatientCents) ||
          line.proposedPricePerPatientCents < 0 ||
          line.proposedPricePerPatientCents > 10_000_000
        )
      ) {
        errors.push(`lines.${index}.proposedPricePerPatientCents`);
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
  try {
    validateDiscountStacking({
      globalDiscountBasisPoints: input.globalDiscountBasisPoints,
      itemDiscounts: input.lines?.map((line) => line.offerDiscount),
      justification: input.discountStackingJustification
    });
  } catch {
    errors.push('discountStackingJustification');
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
  selection: SalesModularLineSelection,
  options?: {
    perPatientPricingEnabled: boolean;
    contractedCapacityPatients: number;
  }
) => {
  const quantity = Math.max(1, integer(selection.quantity, 1));
  const contractedCapacityPatients =
    options?.perPatientPricingEnabled === true
      ? Math.max(1, integer(options.contractedCapacityPatients, 1))
      : null;
  if (
    contractedCapacityPatients !== null &&
    item.billingInterval !== 'one_time'
  ) {
    const editMode =
      selection.pricingEditMode === 'monthly_total'
        ? 'monthly_total'
        : 'per_patient';
    const sourceAmount =
      editMode === 'per_patient'
        ? selection.proposedPricePerPatientCents
        : selection.customRecurringAmountCents;
    const sourceAvailable =
      typeof sourceAmount === 'number' &&
      Number.isFinite(sourceAmount) &&
      sourceAmount >= 0;
    const requestedMonthlyRevenueCents =
      editMode === 'monthly_total' && sourceAvailable
        ? roundSalesMoneyCents(Number(sourceAmount))
        : null;
    const proposedPricePerPatientCents = !sourceAvailable
      ? null
      : editMode === 'per_patient'
        ? roundSalesMoneyCents(Number(sourceAmount))
        : roundSalesMoneyCents(
            Number(sourceAmount) / contractedCapacityPatients
          );
    const recurringAmountCents =
      proposedPricePerPatientCents === null
        ? 0
        : roundSalesMoneyCents(
            contractedCapacityPatients * proposedPricePerPatientCents
          );
    const monthlyTotalRepresentable =
      editMode !== 'monthly_total' ||
      requestedMonthlyRevenueCents === null ||
      requestedMonthlyRevenueCents === recurringAmountCents;
    const monthlyTotalAdjustmentCents =
      requestedMonthlyRevenueCents === null
        ? null
        : recurringAmountCents - requestedMonthlyRevenueCents;
    return {
      recurringAmountCents,
      oneTimeAmountCents: 0,
      quantity,
      commercialPricing: {
        enabled: true,
        editMode: editMode as SalesCommercialPricingEditMode,
        contractedCapacityPatients,
        proposedPricePerPatientCents,
        derivedMonthlyRevenueCents: sourceAvailable
          ? recurringAmountCents
          : null,
        requestedMonthlyRevenueCents,
        monthlyTotalRepresentable,
        nearestRepresentableMonthlyRevenueCents:
          requestedMonthlyRevenueCents === null ? null : recurringAmountCents,
        monthlyTotalAdjustmentCents
      }
    };
  }
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
    quantity,
    commercialPricing: {
      enabled: false,
      editMode: 'legacy_monthly_total' as const,
      contractedCapacityPatients: null,
      proposedPricePerPatientCents: null,
      derivedMonthlyRevenueCents: recurringUnit * recurringMultiplier,
      requestedMonthlyRevenueCents: null,
      monthlyTotalRepresentable: true,
      nearestRepresentableMonthlyRevenueCents: null,
      monthlyTotalAdjustmentCents: null
    }
  };
};

const normalizePerPatientOfferDiscount = (
  discount: OfferItemDiscount,
  normalPricePerPatientCents: number,
  contractedCapacityPatients: number
): OfferItemDiscount => {
  const normalUnit = roundSalesMoneyCents(normalPricePerPatientCents);
  let discountedUnit = normalUnit;
  if (discount.type === 'free') {
    discountedUnit = 0;
  } else if (discount.type === 'percentage') {
    discountedUnit =
      normalUnit -
      multiplyBasisPoints(
        normalUnit,
        Number(discount.percentageBasisPoints || 0)
      );
  } else {
    discountedUnit = roundSalesMoneyCents(
      discount.discountedPriceCents / contractedCapacityPatients
    );
  }
  discountedUnit = Math.max(0, Math.min(normalUnit, discountedUnit));
  const normalMonthlyCents = roundSalesMoneyCents(
    normalUnit * contractedCapacityPatients
  );
  const discountedMonthlyCents = roundSalesMoneyCents(
    discountedUnit * contractedCapacityPatients
  );
  return {
    ...discount,
    priceBeforeDiscountCents: normalMonthlyCents,
    discountedPriceCents: discountedMonthlyCents,
    priceAfterExpirationCents: normalMonthlyCents
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

const classifyCommercialEstimate = (
  model: SalesPricingCostModel | null,
  missingDrivers: SalesModularDriverKey[]
): {
  estimateStatus: SalesCommercialEstimateStatus;
  confidenceLevel: SalesCommercialConfidenceLevel;
} => {
  if (
    !model ||
    model.costSource === 'unavailable' ||
    missingDrivers.length > 0
  ) {
    return {
      estimateStatus: 'insufficient_data',
      confidenceLevel: 'unavailable'
    };
  }
  if (/pré-lançamento|pre-lancamento/i.test(model.sourceDetail || '')) {
    return {
      estimateStatus: 'pre_launch',
      confidenceLevel: 'low'
    };
  }
  if (model.costSource === 'actual') {
    return {
      estimateStatus: 'calibrated',
      confidenceLevel: 'high'
    };
  }
  if (model.costSource === 'calculated') {
    return {
      estimateStatus: 'calibrated',
      confidenceLevel: 'medium'
    };
  }
  return {
    estimateStatus: 'estimated',
    confidenceLevel: model.costSource === 'manual' ? 'low' : 'medium'
  };
};

const directMonthlyCost = (
  item: SalesPricingCatalogItem,
  tier: SalesPricingCatalogTier | null,
  selectionQuantity: number,
  input: SalesModularProposalInput,
  settings: SalesModularCostSettings,
  basePackageContractedLimit: number
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
    const isCustomTier = Boolean(tier?.isCustom || tier?.maximumQuantity === null);
    const includedMb = !isCustomTier && Number.isFinite(explicitIncludedMb) && explicitIncludedMb >= 0
      ? explicitIncludedMb
      : settings.includedStorageMbPerPatient === null
        ? null
        : basePackageContractedLimit * settings.includedStorageMbPerPatient;
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
  if (
    catalog.status !== 'active' &&
    catalog.status !== 'draft' &&
    catalog.status !== 'archived'
  ) {
    throw new Error('PRICING_CATALOG_INACTIVE');
  }
  const costSettings = normalizeModularCostSettings(
    catalog.modularCostSettings
  );
  const profitabilityPolicy =
    catalog.hasVersionedProfitabilityPolicy === true &&
    validateSalesProfitabilityPolicy(catalog.profitabilityPolicy)
      ? {
          ...catalog.profitabilityPolicy,
          driverExpansionPolicies: Object.fromEntries(
            Object.entries(
              catalog.profitabilityPolicy.driverExpansionPolicies
            ).map(([itemKey, policy]) => [
              itemKey,
              policy ? { ...policy } : policy
            ])
          )
        }
      : null;
  const commercialStartsAt = input.offerStartsAt || assumptionSnapshot.effectiveAt;

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
  const demand = salesPackageDemand(
    input.patientQuantity,
    input.expectedPatientQuantity12Months
  );
  const isCustomBaseTier = baseTier.isCustom || baseTier.maximumQuantity === null;
  const selections = [...input.lines];
  const coreSelections = selections.filter(
    (selection) => selection.itemKey === 'clinical_core'
  );
  if (coreSelections.length !== 1) {
    throw new Error('PROPOSAL_SIMULATION_INVALID:clinical_core');
  }
  const missingDependencies = findMissingSalesModuleDependencies(
    selections.map((selection) => selection.itemKey)
  );
  if (missingDependencies.length > 0) {
    const missing = missingDependencies[0];
    throw new Error(
      `PROPOSAL_MODULE_DEPENDENCY_MISSING:${missing.itemKey}:${missing.dependency}`
    );
  }
  const perPatientPricingEnabled =
    isCustomBaseTier &&
    ['per_patient', 'monthly_total'].includes(
      String(coreSelections[0].pricingEditMode || '')
    );
  if (
    isCustomBaseTier &&
    !perPatientPricingEnabled &&
    (!Number.isInteger(coreSelections[0].customRecurringAmountCents) ||
      Number(coreSelections[0].customRecurringAmountCents) <= 0)
  ) {
    throw new Error('PROPOSAL_SIMULATION_INVALID:customRecurringAmountCents');
  }
  if (
    isCustomBaseTier &&
    (!Number.isInteger(input.customBasePackageLimit) ||
      Number(input.customBasePackageLimit) < 1)
  ) {
    throw new Error('PROPOSAL_SIMULATION_INVALID:customBasePackageLimit');
  }
  const hasVersionedCustomCapacityPolicy =
    catalog.status === 'active' &&
    validateCustomCapacityPolicy(catalog.customCapacityPolicy);
  const customCapacityPolicy = hasVersionedCustomCapacityPolicy
    ? catalog.customCapacityPolicy
    : null;
  let capacity = isCustomBaseTier && customCapacityPolicy
    ? calculateCustomCapacity(
        {
          currentPatients: input.patientQuantity,
          expectedPatients: input.expectedPatientQuantity12Months,
          baseLimitPatients: Number(input.customBasePackageLimit),
          basePriceCents: perPatientPricingEnabled
            ? typeof coreSelections[0].proposedPricePerPatientCents === 'number'
              ? Math.round(
                  Number(input.customBasePackageLimit) *
                    Number(coreSelections[0].proposedPricePerPatientCents)
                )
              : 0
            : Number(coreSelections[0].customRecurringAmountCents),
          selection: {
            mode:
              input.customCapacitySelectionMode === 'manual'
                ? 'manual'
                : 'automatic',
            selectedBlocks: input.customCapacityBlocks
          }
        },
        customCapacityPolicy
      )
    : null;
  const basePackageContractedLimit = capacity
    ? capacity.totalContractedLimitPatients
    : isCustomBaseTier
      ? input.customBasePackageLimit
      : baseTier.maximumQuantity;
  if (
    basePackageContractedLimit === null ||
    basePackageContractedLimit === undefined ||
    !Number.isInteger(basePackageContractedLimit) ||
    basePackageContractedLimit < demand ||
    basePackageContractedLimit > 100_000
  ) {
    throw new Error('PROPOSAL_SIMULATION_INVALID:customBasePackageLimit');
  }
  if (!isCustomBaseTier && demand > basePackageContractedLimit) {
    throw new Error('PRICING_PACKAGE_LIMIT_EXCEEDED');
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
    const resolvedAmounts = resolveGrossAmounts(
      item,
      tier,
      effectiveSelection,
      {
        perPatientPricingEnabled,
        contractedCapacityPatients: basePackageContractedLimit
      }
    );
    const amounts = {
      ...resolvedAmounts,
      recurringAmountCents:
        item.itemKey === 'clinical_core' &&
        capacity &&
        !perPatientPricingEnabled
          ? capacity.clinicalCoreMonthlyRevenueCents
          : resolvedAmounts.recurringAmountCents
    };
    if (
      item.billingInterval !== 'one_time' &&
      !perPatientPricingEnabled &&
      amounts.recurringAmountCents <= 0
    ) {
      throw new Error(`PRICING_TIER_NOT_FOUND:${item.itemKey}`);
    }
    const normalizedOfferDiscount = effectiveSelection.offerDiscount
      ? normalizeOfferItemDiscount({
          ...effectiveSelection.offerDiscount,
          priceBeforeDiscountCents:
            item.billingInterval === 'one_time'
              ? amounts.oneTimeAmountCents
              : amounts.recurringAmountCents,
          priceAfterExpirationCents:
            item.billingInterval === 'one_time'
              ? amounts.oneTimeAmountCents
              : amounts.recurringAmountCents
        })
      : null;
    const normalPricePerPatientCents =
      perPatientPricingEnabled &&
      item.billingInterval !== 'one_time'
        ? amounts.commercialPricing.proposedPricePerPatientCents
        : null;
    const offerDiscount =
      normalizedOfferDiscount &&
      normalPricePerPatientCents !== null
        ? normalizePerPatientOfferDiscount(
            normalizedOfferDiscount,
            normalPricePerPatientCents,
            basePackageContractedLimit
          )
        : normalizedOfferDiscount;
    const legacyDiscountBasisPoints = nonNegativeInteger(
      effectiveSelection.itemDiscountBasisPoints
    );
    const discountBasisPoints = offerDiscount
      ? offerDiscount.priceBeforeDiscountCents > 0
        ? Math.round(
            ((offerDiscount.priceBeforeDiscountCents -
              offerDiscount.discountedPriceCents) *
              10_000) /
              offerDiscount.priceBeforeDiscountCents
          )
        : 0
      : legacyDiscountBasisPoints;
    if (discountBasisPoints > 10_000) {
      throw new Error(`PRICING_INVALID_DISCOUNT:${item.itemKey}`);
    }
    const offerDiscountAppliesInitially = offerDiscount
      ? discountAppliesAt(offerDiscount, commercialStartsAt)
      : false;
    const itemDiscountCents = offerDiscount
      ? offerDiscountAppliesInitially && item.billingInterval !== 'one_time'
        ? offerDiscount.priceBeforeDiscountCents - offerDiscount.discountedPriceCents
        : 0
      : normalPricePerPatientCents === null
        ? multiplyBasisPoints(amounts.recurringAmountCents, discountBasisPoints)
        : basePackageContractedLimit *
          multiplyBasisPoints(
            normalPricePerPatientCents,
            discountBasisPoints
          );
    const oneTimeDiscountCents = offerDiscount
      ? offerDiscountAppliesInitially && item.billingInterval === 'one_time'
        ? offerDiscount.priceBeforeDiscountCents - offerDiscount.discountedPriceCents
        : 0
      : multiplyBasisPoints(amounts.oneTimeAmountCents, discountBasisPoints);
    const costResolution = directMonthlyCost(
      item,
      tier,
      amounts.quantity,
      input,
      costSettings,
      basePackageContractedLimit
    );
    return {
      item,
      tier,
      selection: effectiveSelection,
      quantity: amounts.quantity,
      grossRecurringRevenueCents: amounts.recurringAmountCents,
      grossOneTimeRevenueCents: amounts.oneTimeAmountCents,
      itemDiscountBasisPoints: discountBasisPoints,
      offerDiscount,
      itemDiscountCents,
      oneTimeDiscountCents,
      promotionalItemRevenueCents:
        amounts.recurringAmountCents - itemDiscountCents,
      postPromotionRecurringRevenueCents:
        offerDiscount
          ? amounts.recurringAmountCents
          : amounts.recurringAmountCents - itemDiscountCents,
      oneTimeRevenueCents:
        amounts.oneTimeAmountCents - oneTimeDiscountCents,
      normalPricePerPatientCents,
      promotionalPricePerPatientCents:
        normalPricePerPatientCents === null
          ? null
          : roundSalesMoneyCents(
              (amounts.recurringAmountCents - itemDiscountCents) /
                basePackageContractedLimit
            ),
      postPromotionPricePerPatientCents:
        normalPricePerPatientCents === null
          ? null
          : offerDiscount
            ? normalPricePerPatientCents
            : roundSalesMoneyCents(
                (amounts.recurringAmountCents - itemDiscountCents) /
                  basePackageContractedLimit
              ),
      commercialPricing: resolvedAmounts.commercialPricing,
      directCostCents: costResolution.monthlyCostCents,
      oneTimeDirectCostCents: costResolution.oneTimeCostCents,
      costResolution
    };
  });

  const selectedRecurringLines = resolved.filter(
    (line) => line.item.billingInterval !== 'one_time'
  );
  const missingCommercialPriceItemKeys = perPatientPricingEnabled
    ? selectedRecurringLines
        .filter(
          (line) =>
            line.commercialPricing.proposedPricePerPatientCents === null
        )
        .map((line) => line.item.itemKey)
    : [];
  const totalProposedPricePerPatientCents =
    perPatientPricingEnabled && missingCommercialPriceItemKeys.length === 0
      ? selectedRecurringLines.reduce(
          (sum, line) =>
            sum +
            Number(line.commercialPricing.proposedPricePerPatientCents),
          0
        )
      : null;
  if (capacity && perPatientPricingEnabled) {
    const corePerPatient = resolved.find(
      (line) => line.item.itemKey === 'clinical_core'
    )?.commercialPricing.proposedPricePerPatientCents;
    capacity = calculateCustomCapacity(
      {
        currentPatients: input.patientQuantity,
        expectedPatients: input.expectedPatientQuantity12Months,
        baseLimitPatients: Number(input.customBasePackageLimit),
        basePriceCents:
          corePerPatient === null || corePerPatient === undefined
            ? 0
            : Math.round(Number(input.customBasePackageLimit) * corePerPatient),
        blockPriceCentsOverride:
          totalProposedPricePerPatientCents === null
            ? null
            : Math.round(
                customCapacityPolicy!.blockSizePatients *
                  totalProposedPricePerPatientCents
              ),
        selectedModulePricePerPatientCents:
          totalProposedPricePerPatientCents,
        selection: {
          mode:
            input.customCapacitySelectionMode === 'manual'
              ? 'manual'
              : 'automatic',
          selectedBlocks: input.customCapacityBlocks
        }
      },
      customCapacityPolicy!
    );
  }

  const baseIndex = Math.max(
    0,
    resolved.findIndex((line) => line.item.itemKey === 'clinical_core')
  );
  const globalDiscountBase = resolved.reduce(
    (sum, line) => sum + line.promotionalItemRevenueCents,
    0
  );
  const globalAllocations = perPatientPricingEnabled
    ? resolved.map((line) =>
        line.promotionalPricePerPatientCents === null
          ? 0
          : basePackageContractedLimit *
            multiplyBasisPoints(
              line.promotionalPricePerPatientCents,
              input.globalDiscountBasisPoints
            )
      )
    : allocateSalesCents(
        multiplyBasisPoints(
          globalDiscountBase,
          input.globalDiscountBasisPoints
        ),
        resolved.map((line) => line.promotionalItemRevenueCents),
        baseIndex
      );
  const globalDiscountTotal = globalAllocations.reduce(
    (sum, amount) => sum + amount,
    0
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
    stripeFixed: profitabilityPolicy
      ? 'base_package' as const
      : resolvedAllocationMethod(
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
    sharedPlatformCosts: profitabilityPolicy
      ? 'base_package' as const
      : resolvedAllocationMethod(
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
        line.promotionalItemRevenueCents -
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
        warnings.push('Resultado operacional atribuído promocional negativo.');
      }
      const estimateClassification = classifyCommercialEstimate(
        line.item.costModel,
        line.costResolution.missingDrivers
      );
      const contractedCapacityPatients =
        line.commercialPricing.enabled
          ? basePackageContractedLimit
          : null;
      return {
        lineKey: lineIdentity(line.selection),
        catalogItemId: line.item.id,
        tierId: line.tier?.id || null,
        itemKey: line.item.itemKey,
        publicName: line.item.publicName,
        description: line.item.description,
        pricingMode: line.item.pricingMode,
        quantity: line.quantity,
        limitQuantity: line.item.itemKey === 'clinical_core'
          ? basePackageContractedLimit
          : line.tier?.maximumQuantity ?? line.item.maximumQuantity,
        includedQuantity:
          line.tier?.includedQuantity ?? line.item.includedQuantity,
        grossRecurringRevenueCents: line.grossRecurringRevenueCents,
        grossOneTimeRevenueCents: line.grossOneTimeRevenueCents,
        itemDiscountBasisPoints: line.itemDiscountBasisPoints,
        offerDiscount: line.offerDiscount,
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
        commercialPricing: {
          enabled: line.commercialPricing.enabled,
          editMode: line.commercialPricing.editMode,
          contractedCapacityPatients,
          proposedPricePerPatientCents:
            line.commercialPricing.proposedPricePerPatientCents,
          derivedMonthlyRevenueCents:
            line.commercialPricing.derivedMonthlyRevenueCents,
          requestedMonthlyRevenueCents:
            line.commercialPricing.requestedMonthlyRevenueCents,
          monthlyTotalRepresentable:
            line.commercialPricing.monthlyTotalRepresentable,
          nearestRepresentableMonthlyRevenueCents:
            line.commercialPricing.nearestRepresentableMonthlyRevenueCents,
          monthlyTotalAdjustmentCents:
            line.commercialPricing.monthlyTotalAdjustmentCents,
          estimatedMonthlyCostCents: line.directCostCents,
          effectiveCostPerPatientCents:
            line.directCostCents === null ||
            contractedCapacityPatients === null
              ? null
              : roundSalesMoneyCents(
                  line.directCostCents / contractedCapacityPatients
                ),
          marginalCostPerPatientCents: null,
          minimumPricePerPatientCents: null,
          recommendedPricePerPatientCents: null,
          contributionCents: promotional.contributionMarginCents,
          contributionMarginBasisPoints:
            promotional.contributionMarginBasisPoints,
          ...estimateClassification,
          costModelVersion: line.item.costModel?.version ?? null,
          assumptionsVersion: assumptionSnapshot.version,
          estimatedAt:
            line.item.costModel?.effectiveAt ||
            assumptionSnapshot.effectiveAt
        },
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
          offerDiscount: line.offerDiscount,
          tierName: line.tier?.publicName || null,
          unitName: line.item.unitName,
          includedQuantity:
            line.tier?.includedQuantity ?? line.item.includedQuantity,
          maximumQuantity:
            line.item.itemKey === 'clinical_core'
              ? basePackageContractedLimit
              : line.tier?.maximumQuantity ?? line.item.maximumQuantity,
          pricePerPatientCents:
            line.commercialPricing.proposedPricePerPatientCents,
          billedCapacityPatients:
            line.commercialPricing.enabled
              ? basePackageContractedLimit
              : null,
          pricingBasis:
            line.commercialPricing.enabled
              ? 'contracted_capacity'
              : 'catalog_snapshot',
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
  let horizons = {} as SalesModularProposalResult['horizons'];
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

  const initialCommercialPhases = buildOfferCommercialPhases({
    startsAt: commercialStartsAt,
    globalDiscountBasisPoints: perPatientPricingEnabled
      ? 0
      : input.globalDiscountBasisPoints,
    globalDiscountBaseItemKey: 'clinical_core',
    globalDiscountStartsAt: input.globalDiscountBasisPoints > 0 ? commercialStartsAt : null,
    globalDiscountEndsAt:
      input.globalDiscountBasisPoints > 0 && input.discountDurationMonths > 0
        ? addCommercialDuration(commercialStartsAt, input.discountDurationMonths, 'months')
        : null,
    lines: lines.map((line, index) => ({
      itemKey: line.itemKey,
      publicName: line.publicName,
      billingInterval:
        line.pricingMode === 'one_time' ? 'one_time' : 'monthly',
      normalPriceCents:
        line.pricingMode === 'one_time'
          ? line.offerDiscount
            ? line.grossOneTimeRevenueCents
            : line.oneTimeRevenueCents
          : line.offerDiscount
            ? line.grossRecurringRevenueCents
            : line.postPromotionRecurringRevenueCents,
      directCostCents:
        line.pricingMode === 'one_time'
          ? line.oneTimeDirectCostCents
          : line.promotional.directCostCents,
      discount: line.offerDiscount,
      globalDiscountCents: globalAllocations[index]
    }))
  });
  const commercialPhasePeriods = new Map<
    number,
    SalesModularConsolidatedPeriod
  >();
  const commercialPhases = initialCommercialPhases.map((phase) => {
    const recalculated = calculatePeriod(
      resolved.map((line, index) => {
        const isRecurring = line.item.billingInterval !== 'one_time';
        return {
          itemKey: line.item.itemKey,
          netRevenueCents: isRecurring
            ? phase.lines[index].activePriceCents
            : 0,
          grossRevenueCents: isRecurring
            ? line.grossRecurringRevenueCents
            : 0,
          directCostCents: isRecurring ? line.directCostCents : 0,
          directCostBreakdown: line.costResolution.breakdown,
          weight: isRecurring
            ? line.item.costModel?.sharedCostAllocationWeight || 0
            : 0,
          isBase: line.item.itemKey === 'clinical_core'
        };
      }),
      values,
      allocationSettings,
      input.expectedPatientQuantity12Months,
      costSettings
    );
    commercialPhasePeriods.set(
      phase.phaseNumber,
      recalculated.consolidated
    );
    return {
      ...phase,
      lines: phase.lines.map((line, index) => ({
        ...line,
        directCostCents:
          line.billingInterval === 'one_time'
            ? line.directCostCents
            : nullableSum([
                recalculated.lines[index].directCostCents,
                recalculated.lines[index].transactionAndTaxCostAllocatedCents,
                recalculated.lines[index].sharedPlatformCostAllocatedCents
              ])
      })),
      recurringCostCents: recalculated.consolidated.totalEstimatedCostCents,
      contributionCents: recalculated.consolidated.contributionMarginCents,
      ebitdaCents: recalculated.consolidated.ebitdaCents,
      marginBasisPoints: recalculated.consolidated.ebitdaMarginBasisPoints
    };
  });
  if (
    capacity &&
    perPatientPricingEnabled &&
    missingCommercialPriceItemKeys.length === 0 &&
    commercialPhases[0]
  ) {
    const phasePricePerPatientCents = commercialPhases[0].lines
      .filter((line) => line.billingInterval === 'monthly')
      .reduce(
        (sum, line) =>
          sum +
          roundSalesMoneyCents(
            line.activePriceCents / basePackageContractedLimit
          ),
        0
      );
    const phaseBlockPriceCents =
      capacity.policy.blockSizePatients * phasePricePerPatientCents;
    capacity = {
      ...capacity,
      effectiveBlockPriceCents: phaseBlockPriceCents,
      selectedModulePricePerPatientCents: phasePricePerPatientCents,
      blocksMonthlyRevenueCents:
        capacity.selectedBlocks * phaseBlockPriceCents,
      blockPricingBasis: 'selected_module_per_patient_prices'
    };
  }
  const normalRecurringRevenueCents = lines.reduce(
    (sum, line) =>
      sum +
      (line.pricingMode === 'one_time'
        ? 0
        : line.grossRecurringRevenueCents),
    0
  );
  horizons = [12, 24, 36].reduce<
    SalesModularProposalResult['horizons']
  >((accumulator, months) => {
    const monthPhases = Array.from({ length: months }, (_, monthIndex) => {
      const monthStartsAt =
        monthIndex === 0
          ? commercialStartsAt
          : addCommercialDuration(
              commercialStartsAt,
              monthIndex,
              'months'
            );
      const monthTime = Date.parse(monthStartsAt);
      return (
        commercialPhases.find((phase) => {
          const phaseStarts = Date.parse(phase.startsAt);
          const phaseEnds =
            phase.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(phase.endsAt);
          return monthTime >= phaseStarts && monthTime < phaseEnds;
        }) ||
        commercialPhases[commercialPhases.length - 1]
      );
    });
    const promotionalMonths = monthPhases.filter(
      (phase) =>
        phase &&
        phase.recurringRevenueCents < normalRecurringRevenueCents
    ).length;
    const fullPriceMonths = months - promotionalMonths;
    const recognizedInstallments = Math.min(months, onboardingInstallments);
    const recognizedOneTimeRevenueCents = oneTimeRevenueInstallments
      .slice(0, recognizedInstallments)
      .reduce((sum, installment) => sum + installment, 0);
    const recognizedOneTimeDiscountCents = oneTimeDiscountInstallments
      .slice(0, recognizedInstallments)
      .reduce((sum, installment) => sum + installment, 0);
    const monthlyPeriods = monthPhases.map((phase) =>
      phase ? commercialPhasePeriods.get(phase.phaseNumber) || null : null
    );
    const recurringRevenueCents = monthPhases.reduce(
      (sum, phase) => sum + Number(phase?.recurringRevenueCents || 0),
      0
    );
    const recurringEbitdaCents = nullableSum(
      monthlyPeriods.map((period) => period?.ebitdaCents ?? null)
    );
    const recurringNetIncomeCents = nullableSum(
      monthlyPeriods.map((period) => period?.netIncomeCents ?? null)
    );
    const oneTimeContributionCents =
      oneTimeDirectCostCents === null
        ? null
        : recognizedOneTimeRevenueCents - oneTimeDirectCostCents;
    accumulator[String(months) as '12' | '24' | '36'] = {
      months,
      promotionalMonths,
      fullPriceMonths,
      recurringRevenueCents,
      oneTimeRevenueCents: recognizedOneTimeRevenueCents,
      ebitdaCents: nullableSum([
        recurringEbitdaCents,
        oneTimeContributionCents
      ]),
      netIncomeCents: nullableSum([
        recurringNetIncomeCents,
        oneTimeContributionCents
      ]),
      discountImpactCents:
        monthPhases.reduce(
          (sum, phase) =>
            sum +
            Math.max(
              0,
              normalRecurringRevenueCents -
                Number(phase?.recurringRevenueCents || 0)
            ),
          0
        ) + recognizedOneTimeDiscountCents
    };
    return accumulator;
  }, {} as SalesModularProposalResult['horizons']);
  const phaseMargins = commercialPhases.map((phase) => phase.marginBasisPoints);
  const allPhaseMarginsKnown = phaseMargins.every((margin) => margin !== null);
  const minimumPhaseMargin = allPhaseMarginsKnown
    ? Math.min(...phaseMargins.map(Number))
    : null;
  const phaseRating: OfferProfitabilityRating =
    missingCosts.length > 0 ||
    minimumPhaseMargin === null ||
    values.healthyMarginBasisPoints === null ||
    values.attentionMarginBasisPoints === null
      ? 'insufficient_data'
      : minimumPhaseMargin >= values.healthyMarginBasisPoints
        ? 'healthy'
        : minimumPhaseMargin >= values.attentionMarginBasisPoints
          ? 'attention'
          : 'not_recommended';
  const anyPhaseRequiresJustification =
    minimumPhaseMargin !== null &&
    values.minimumMarginBasisPoints !== null &&
    minimumPhaseMargin < values.minimumMarginBasisPoints;
  const finalRequiresJustification =
    requiresJustification || anyPhaseRequiresJustification;
  if (
    anyPhaseRequiresJustification &&
    !warnings.some((warning) => warning.includes('margem está abaixo'))
  ) {
    warnings.push(
      'Ao menos uma fase comercial está abaixo da margem mínima e exige justificativa administrativa.'
    );
  }

  const commercialLineEconomics = new Map<
    string,
    {
      marginalCostPerPatientCents: number | null;
      minimumPricePerPatientCents: number | null;
      recommendedPricePerPatientCents: number | null;
    }
  >();
  const commercialBlockDirectMarginalCosts = new Map<
    string,
    number | null
  >();
  let economics: SalesModularEconomicsResult | null = null;
  if (profitabilityPolicy) {
    const intensiveInput: SalesModularProposalInput = {
      ...input,
      usageProfile: 'intensive',
      driverOverrides: {}
    };
    const intensiveValues = resolveProfileAssumptions(
      assumptionSnapshot,
      profitabilityPolicy.pricingProfile
    );
    const intensiveCosts = resolved.map((line) =>
      directMonthlyCost(
        line.item,
        line.tier,
        line.quantity,
        intensiveInput,
        costSettings,
        basePackageContractedLimit
      )
    );
    if (capacity && perPatientPricingEnabled) {
      const currentCapacityPatients =
        capacity.totalContractedLimitPatients;
      const nextCapacityPatients =
        currentCapacityPatients + capacity.policy.blockSizePatients;
      const directCostsAtCapacity = (capacityPatients: number) =>
        resolved.map((line) =>
          line.item.billingInterval === 'one_time'
            ? line.costResolution
            : directMonthlyCost(
                line.item,
                line.tier,
                line.item.itemKey === 'clinical_core'
                  ? capacityPatients
                  : line.quantity,
                {
                  ...intensiveInput,
                  patientQuantity: capacityPatients,
                  expectedPatientQuantity12Months: capacityPatients,
                  customCapacityBlocks: Math.max(
                    0,
                    Math.ceil(
                      (capacityPatients - capacity.baseLimitPatients) /
                        capacity.policy.blockSizePatients
                    )
                  )
                },
                costSettings,
                capacityPatients
              )
        );
      const currentCapacityCosts =
        directCostsAtCapacity(currentCapacityPatients);
      const nextCapacityCosts = directCostsAtCapacity(nextCapacityPatients);
      resolved.forEach((line, index) => {
        if (line.item.billingInterval === 'one_time') return;
        const currentCost = currentCapacityCosts[index].monthlyCostCents;
        const nextCost = nextCapacityCosts[index].monthlyCostCents;
        commercialBlockDirectMarginalCosts.set(
          lineIdentity(line.selection),
          currentCost === null || nextCost === null
            ? null
            : Math.max(0, nextCost - currentCost)
        );
      });
    }
    const previousDemand = Math.max(
      1,
      salesPackageDemand(
        input.patientQuantity,
        input.expectedPatientQuantity12Months
      ) - 1
    );
    const previousCapacity = Math.max(
      1,
      basePackageContractedLimit - 1
    );
    const previousIntensiveCosts = resolved.map((line) =>
      line.item.billingInterval === 'one_time'
        ? line.costResolution
        : directMonthlyCost(
            line.item,
            line.tier,
            line.quantity,
            {
              ...intensiveInput,
              patientQuantity: Math.min(
                input.patientQuantity,
                previousDemand
              ),
              expectedPatientQuantity12Months: previousDemand
            },
            costSettings,
            previousCapacity
          )
    );
    const intensivePeriodForPhase = (phase: OfferCommercialPhase) =>
      calculatePeriod(
        resolved.map((line, index) => ({
          itemKey: line.item.itemKey,
          netRevenueCents:
            line.item.billingInterval === 'one_time'
              ? 0
              : phase.lines[index].activePriceCents,
          grossRevenueCents:
            line.item.billingInterval === 'one_time'
              ? 0
              : line.grossRecurringRevenueCents,
          directCostCents:
            line.item.billingInterval === 'one_time'
              ? 0
              : intensiveCosts[index].monthlyCostCents,
          directCostBreakdown: intensiveCosts[index].breakdown,
          weight: line.item.itemKey === 'clinical_core' ? 1 : 0,
          isBase: line.item.itemKey === 'clinical_core'
        })),
        intensiveValues,
        allocationSettings,
        input.expectedPatientQuantity12Months,
        costSettings
      );
    const intensivePhasePeriods = commercialPhases.map((phase) =>
      intensivePeriodForPhase(phase)
    );
    const intensivePromotionalPeriod =
      intensivePhasePeriods[0] || promotionalPeriod;
    const intensivePostPeriod =
      intensivePhasePeriods[intensivePhasePeriods.length - 1] ||
      postPeriod;
    const percentageParts = [
      intensiveValues.stripeFeeBasisPoints,
      intensiveValues.estimatedDelinquencyBasisPoints,
      intensiveValues.revenueTaxBasisPoints
    ];
    const percentageCostBasisPoints = percentageParts.some(
      (value) => value === null
    )
      ? null
      : percentageParts.reduce<number>(
          (sum, value) => sum + Number(value),
          0
        );
    const intensiveSharedCostCents = sharedPlatformCosts(
      intensiveValues,
      input.expectedPatientQuantity12Months,
      costSettings,
      resolved.map((line) => line.item.itemKey)
    );
    const minimumPrices = (
      directCostCents: number | null,
      fixedAllocatedCostCents: number | null,
      fixedPaymentFeeCents: number | null
    ) =>
      Object.fromEntries(
        salesProfitabilityPolicyThresholds(profitabilityPolicy).map(
          (target) => [
            target,
            calculateSalesMinimumPriceCents({
              directCostCents,
              fixedAllocatedCostCents,
              fixedPaymentFeeCents,
              targetEbitdaMarginBasisPoints: target,
              stripePercentageBasisPoints:
                intensiveValues.stripeFeeBasisPoints,
              delinquencyPercentageBasisPoints:
                intensiveValues.estimatedDelinquencyBasisPoints,
              taxPercentageBasisPoints:
                intensiveValues.revenueTaxBasisPoints
            })
          ]
        )
      ) as SalesPriceThresholds;
    const lineTotalCost = (
      periodLine: SalesModularPeriodLineResult
    ): number | null =>
      nullableSum([
        periodLine.directCostCents,
        periodLine.transactionAndTaxCostAllocatedCents,
        periodLine.sharedPlatformCostAllocatedCents
      ]);

    let accumulatedRevenueCents =
      intensivePostPeriod.lines[baseIndex]?.netRevenueCents || 0;
    let accumulatedCostCents = lineTotalCost(
      intensivePostPeriod.lines[baseIndex]
    );
    const effects = new Map<
      number,
      ReturnType<typeof calculateSalesModuleEffect>
    >();
    resolved.forEach((line, index) => {
      if (index === baseIndex || line.item.billingInterval === 'one_time') {
        return;
      }
      const moduleCostCents = lineTotalCost(
        intensivePostPeriod.lines[index]
      );
      const effect = calculateSalesModuleEffect({
        revenueBeforeCents: accumulatedRevenueCents,
        costBeforeCents: accumulatedCostCents,
        moduleRevenueCents:
          intensivePostPeriod.lines[index].netRevenueCents,
        moduleCostCents
      });
      effects.set(index, effect);
      accumulatedRevenueCents +=
        intensivePostPeriod.lines[index].netRevenueCents;
      accumulatedCostCents =
        accumulatedCostCents === null || moduleCostCents === null
          ? null
          : accumulatedCostCents + moduleCostCents;
    });

    const economicsItems = resolved.map((line, index) => {
      const isBasePackage = index === baseIndex;
      const fixedAllocatedCostCents = isBasePackage
        ? intensiveSharedCostCents
        : 0;
      const fixedPaymentFeeCents = isBasePackage
        ? intensiveValues.stripeFixedFeeCents
        : 0;
      const thresholds = minimumPrices(
        intensiveCosts[index].monthlyCostCents,
        fixedAllocatedCostCents,
        fixedPaymentFeeCents
      );
      const promotionalCostCents = lineTotalCost(
        intensivePromotionalPeriod.lines[index]
      );
      const postPromotionCostCents = lineTotalCost(
        intensivePostPeriod.lines[index]
      );
      const promotionalRevenueCents =
        intensivePromotionalPeriod.lines[index].netRevenueCents;
      const postPromotionRevenueCents =
        intensivePostPeriod.lines[index].netRevenueCents;
      const promotionalMarginBasisPoints = marginBasisPoints(
        promotionalRevenueCents,
        promotionalCostCents
      );
      const postPromotionMarginBasisPoints = marginBasisPoints(
        postPromotionRevenueCents,
        postPromotionCostCents
      );
      const target = isBasePackage
        ? profitabilityPolicy.recurringTargetEbitdaMarginBasisPoints
        : profitabilityPolicy.moduleMinimumIncrementalMarginBasisPoints;
      const targetMinimum = calculateSalesMinimumPriceCents({
        directCostCents: intensiveCosts[index].monthlyCostCents,
        fixedAllocatedCostCents,
        fixedPaymentFeeCents,
        targetEbitdaMarginBasisPoints: target,
        stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
        delinquencyPercentageBasisPoints:
          intensiveValues.estimatedDelinquencyBasisPoints,
        taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
      });
      const commercialMinimumRevenueCents =
        calculateSalesMinimumPriceCents({
          directCostCents: intensiveCosts[index].monthlyCostCents,
          fixedAllocatedCostCents,
          fixedPaymentFeeCents,
          targetEbitdaMarginBasisPoints: isBasePackage
            ? profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints
            : profitabilityPolicy.moduleMinimumIncrementalMarginBasisPoints,
          stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
          delinquencyPercentageBasisPoints:
            intensiveValues.estimatedDelinquencyBasisPoints,
          taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
        });
      const commercialRecommendedRevenueCents =
        calculateSalesMinimumPriceCents({
          directCostCents: intensiveCosts[index].monthlyCostCents,
          fixedAllocatedCostCents,
          fixedPaymentFeeCents,
          targetEbitdaMarginBasisPoints: isBasePackage
            ? profitabilityPolicy.recurringTargetEbitdaMarginBasisPoints
            : profitabilityPolicy.moduleTargetIncrementalMarginBasisPoints,
          stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
          delinquencyPercentageBasisPoints:
            intensiveValues.estimatedDelinquencyBasisPoints,
          taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
        });
      const previousDirectCostCents =
        previousIntensiveCosts[index].monthlyCostCents;
      commercialLineEconomics.set(lineIdentity(line.selection), {
        marginalCostPerPatientCents:
          intensiveCosts[index].monthlyCostCents === null ||
          previousDirectCostCents === null
            ? null
            : Math.max(
                0,
                intensiveCosts[index].monthlyCostCents -
                  previousDirectCostCents
              ),
        minimumPricePerPatientCents:
          commercialMinimumRevenueCents === null ||
          basePackageContractedLimit <= 0
            ? null
            : Math.ceil(
                commercialMinimumRevenueCents /
                  basePackageContractedLimit
              ),
        recommendedPricePerPatientCents:
          commercialRecommendedRevenueCents === null ||
          basePackageContractedLimit <= 0
            ? null
            : Math.ceil(
                commercialRecommendedRevenueCents /
                  basePackageContractedLimit
              )
      });
      return {
        itemKey: line.item.itemKey,
        publicName: line.item.publicName,
        isBasePackage,
        currentPriceCents: line.grossRecurringRevenueCents,
        intensiveDirectCostCents: intensiveCosts[index].monthlyCostCents,
        fixedAllocatedCostCents,
        fixedPaymentFeeCents,
        percentageCostBasisPoints,
        priceMinimumCents: thresholds,
        maximumSupportedCostAtCurrentPriceCents:
          percentageCostBasisPoints === null
            ? null
            : calculateMaximumSupportedCostCents(
                line.grossRecurringRevenueCents,
                target,
                percentageCostBasisPoints
              ),
        promotionalRevenueCents,
        promotionalCostCents,
        promotionalMarginBasisPoints,
        postPromotionRevenueCents,
        postPromotionCostCents,
        postPromotionMarginBasisPoints,
        incrementalStatus: classifyModuleIncrementalMargin(
          postPromotionMarginBasisPoints,
          profitabilityPolicy
        ),
        effect: effects.get(index) || null,
        maximumDiscountCents:
          targetMinimum === null
            ? null
            : Math.max(0, line.grossRecurringRevenueCents - targetMinimum)
      };
    });

    let capacityEconomics: SalesModularEconomicsResult['capacity'] = null;
    if (capacity) {
      const coreLine = resolved[baseIndex];
      const baseOnlyCost = directMonthlyCost(
        coreLine.item,
        coreLine.tier,
        Math.min(coreLine.quantity, capacity.baseLimitPatients),
        {
          ...intensiveInput,
          patientQuantity: Math.min(
            input.patientQuantity,
            capacity.baseLimitPatients
          ),
          expectedPatientQuantity12Months: Math.min(
            input.expectedPatientQuantity12Months,
            capacity.baseLimitPatients
          ),
          customCapacityBlocks: 0
        },
        costSettings,
        capacity.baseLimitPatients
      ).monthlyCostCents;
      const totalCoreCost = intensiveCosts[baseIndex].monthlyCostCents;
      let capacityDirectCostCents =
        totalCoreCost === null || baseOnlyCost === null
          ? null
          : Math.max(0, totalCoreCost - baseOnlyCost);
      if (perPatientPricingEnabled) {
        const baseRecurringCosts = resolved.map((line) =>
          line.item.billingInterval === 'one_time'
            ? 0
            : directMonthlyCost(
                line.item,
                line.tier,
                line.quantity,
                {
                  ...intensiveInput,
                  patientQuantity: Math.min(
                    input.patientQuantity,
                    capacity.baseLimitPatients
                  ),
                  expectedPatientQuantity12Months: Math.min(
                    input.expectedPatientQuantity12Months,
                    capacity.baseLimitPatients
                  ),
                  customCapacityBlocks: 0
                },
                costSettings,
                capacity.baseLimitPatients
              ).monthlyCostCents
        );
        const totalRecurringCosts = intensiveCosts.map((cost, index) =>
          resolved[index].item.billingInterval === 'one_time'
            ? 0
            : cost.monthlyCostCents
        );
        const baseAllCost = nullableSum(baseRecurringCosts);
        const totalAllCost = nullableSum(totalRecurringCosts);
        capacityDirectCostCents =
          baseAllCost === null || totalAllCost === null
            ? null
            : Math.max(0, totalAllCost - baseAllCost);
      }
      const capacityPercentageCostCents =
        percentageCostBasisPoints === null
          ? null
          : multiplyBasisPoints(
              capacity.blocksMonthlyRevenueCents,
              percentageCostBasisPoints
            );
      const incrementalCostCents = nullableSum([
        capacityDirectCostCents,
        capacityPercentageCostCents
      ]);
      const capacityMarginBasisPoints =
        capacity.blocksMonthlyRevenueCents === 0
          ? null
          : marginBasisPoints(
              capacity.blocksMonthlyRevenueCents,
              incrementalCostCents
            );
      const minimumPriceCents = calculateSalesMinimumPriceCents({
        directCostCents: capacityDirectCostCents,
        fixedAllocatedCostCents: 0,
        fixedPaymentFeeCents: 0,
        targetEbitdaMarginBasisPoints:
          profitabilityPolicy.capacityMinimumIncrementalMarginBasisPoints,
        stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
        delinquencyPercentageBasisPoints:
          intensiveValues.estimatedDelinquencyBasisPoints,
        taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
      });
      capacityEconomics = {
        revenueCents: capacity.blocksMonthlyRevenueCents,
        incrementalCostCents,
        marginBasisPoints: capacityMarginBasisPoints,
        minimumPriceCents,
        meetsMinimumMargin:
          capacity.blocksMonthlyRevenueCents === 0
            ? true
            : capacityMarginBasisPoints === null
              ? null
              : capacityMarginBasisPoints >=
                profitabilityPolicy.capacityMinimumIncrementalMarginBasisPoints,
        incrementalStatus:
          capacity.blocksMonthlyRevenueCents === 0
            ? 'acceptable'
            : classifyModuleIncrementalMargin(
                capacityMarginBasisPoints,
                profitabilityPolicy,
                'capacity'
              )
      };
    }

    const expansionEconomics = Object.entries(
      profitabilityPolicy.driverExpansionPolicies
    ).flatMap(([itemKey, expansionPolicy]) => {
      if (!expansionPolicy) return [];
      const index = resolved.findIndex(
        (line) => line.item.itemKey === itemKey
      );
      if (index < 0) return [];
      const line = resolved[index];
      const configuredDriver =
        intensiveCosts[index].resolvedDrivers[expansionPolicy.driverKey];
      const driverValue =
        itemKey === 'additional_storage'
          ? intensiveCosts[index].breakdown.estimatedUsedStorageGb
          : validDriverDatum(configuredDriver)
            ? Number(configuredDriver.value)
            : null;
      let incrementalCostPerUnitCents: number | null = null;
      if (
        itemKey === 'additional_storage' &&
        driverValue !== null &&
        driverValue > 0
      ) {
        const storageAndEgress = nullableSum([
          intensiveCosts[index].breakdown.storageCostCents,
          intensiveCosts[index].breakdown.egressCostCents
        ]);
        incrementalCostPerUnitCents =
          storageAndEgress === null
            ? null
            : storageAndEgress / driverValue;
      } else if (driverValue !== null && driverValue > 0) {
        const zeroDriverInput: SalesModularProposalInput = {
          ...intensiveInput,
          driverOverrides: {
            [itemKey]: {
              [expansionPolicy.driverKey]: calculatedDriver(
                0,
                'Base sem consumo incremental para cálculo marginal.',
                line.item.costModel?.effectiveAt || catalog.effectiveAt,
                line.item.costModel?.version || 1
              )
            }
          }
        };
        const zeroDriverCost = directMonthlyCost(
          line.item,
          line.tier,
          line.quantity,
          zeroDriverInput,
          costSettings,
          basePackageContractedLimit
        ).monthlyCostCents;
        incrementalCostPerUnitCents =
          zeroDriverCost === null ||
          intensiveCosts[index].monthlyCostCents === null
            ? null
            : Math.max(
                0,
                intensiveCosts[index].monthlyCostCents - zeroDriverCost
              ) / driverValue;
      }
      return [
        {
          itemKey: itemKey as SalesExpansionItemKey,
          publicName: line.item.publicName,
          driverKey: expansionPolicy.driverKey,
          incrementalCostPerUnitCents,
          ...calculateSalesDriverExpansion({
            driverValue,
            policy: expansionPolicy,
            incrementalCostPerUnitCents,
            minimumMarginBasisPoints:
              profitabilityPolicy.capacityMinimumIncrementalMarginBasisPoints
          })
        }
      ];
    });

    const phaseHasTemporaryDiscount = (phase: OfferCommercialPhase) =>
      phase.endsAt !== null &&
      phase.lines.some(
        (line) =>
          line.billingInterval === 'monthly' && line.discountCents > 0
      );
    const economicsPhases = commercialPhases.map((phase, index) => {
      const intensive = intensivePhasePeriods[index].consolidated;
      const target =
        index === commercialPhases.length - 1
          ? profitabilityPolicy.postPromotionMinimumEbitdaMarginBasisPoints
          : profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints;
      const directAndShared = nullableSum([
        intensive.directCostCents,
        intensive.sharedPlatformCostAllocatedCents
      ]);
      const minimumPhasePrice = calculateSalesMinimumPriceCents({
        directCostCents: directAndShared,
        fixedAllocatedCostCents: 0,
        fixedPaymentFeeCents: intensiveValues.stripeFixedFeeCents,
        targetEbitdaMarginBasisPoints: target,
        stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
        delinquencyPercentageBasisPoints:
          intensiveValues.estimatedDelinquencyBasisPoints,
        taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
      });
      return {
        startsAt: phase.startsAt,
        endsAt: phase.endsAt,
        revenueCents: intensive.recurringRevenueCents,
        costCents: intensive.totalEstimatedCostCents,
        ebitdaCents: intensive.ebitdaCents,
        marginBasisPoints: intensive.ebitdaMarginBasisPoints,
        maximumDiscountCents:
          minimumPhasePrice === null
            ? null
            : Math.max(
                0,
                intensive.recurringRevenueCents - minimumPhasePrice
              ),
        belowAbsoluteMinimum:
          intensive.ebitdaMarginBasisPoints !== null &&
          intensive.ebitdaMarginBasisPoints <
            profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints,
        requiresTemporaryDiscountJustification:
          intensive.ebitdaMarginBasisPoints !== null &&
          intensive.ebitdaMarginBasisPoints >=
            profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints &&
          intensive.ebitdaMarginBasisPoints <
            profitabilityPolicy.recurringTargetEbitdaMarginBasisPoints
      };
    });
    const blockingCodes: string[] = [];
    const economicsWarnings: string[] = [];
    if (
      perPatientPricingEnabled &&
      missingCommercialPriceItemKeys.length > 0
    ) {
      missingCommercialPriceItemKeys.forEach((itemKey) =>
        blockingCodes.push(
          `COMMERCIAL_PRICE_PER_PATIENT_MISSING:${itemKey}`
        )
      );
      economicsWarnings.push(
        'Informe o preço comercial por paciente dos módulos selecionados; custos conhecidos continuam calculados.'
      );
    }
    if (
      intensiveCosts.some(
        (cost) =>
          cost.monthlyCostCents === null || cost.missingDrivers.length > 0
      ) ||
      economicsPhases.some((phase) => phase.marginBasisPoints === null)
    ) {
      blockingCodes.push('ECONOMICS_INSUFFICIENT_DATA');
      economicsWarnings.push(
        'Dados intensivos incompletos não são tratados como custo zero.'
      );
    }
    if (
      percentageCostBasisPoints !== null &&
      salesProfitabilityPolicyThresholds(profitabilityPolicy).some(
        (target) => 10_000 - target - percentageCostBasisPoints <= 0
      )
    ) {
      blockingCodes.push('ECONOMICS_DENOMINATOR_INVALID');
      economicsWarnings.push(
        'A soma da margem alvo, Stripe, inadimplência e impostos invalida o denominador do preço mínimo.'
      );
    }
    if (economicsPhases.some((phase) => phase.belowAbsoluteMinimum)) {
      blockingCodes.push('CLINIC_MARGIN_BELOW_MINIMUM');
      economicsWarnings.push(
        `Ao menos uma fase está abaixo da margem operacional atribuída mínima de ${formatSalesBasisPointsPercent(
          profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints
        )}.`
      );
    }
    const finalPhase = economicsPhases[economicsPhases.length - 1];
    if (
      finalPhase &&
      finalPhase.marginBasisPoints !== null &&
      finalPhase.marginBasisPoints <
        profitabilityPolicy.postPromotionMinimumEbitdaMarginBasisPoints
    ) {
      blockingCodes.push('POST_PROMOTION_MARGIN_BELOW_MINIMUM');
      economicsWarnings.push(
        `A condição posterior precisa alcançar margem operacional atribuída de pelo menos ${formatSalesBasisPointsPercent(
          profitabilityPolicy.postPromotionMinimumEbitdaMarginBasisPoints
        )}.`
      );
    }
    const phaseNeedsJustification = economicsPhases.some(
      (phase) => phase.requiresTemporaryDiscountJustification
    );
    const promotionalModuleNeedsJustification = economicsItems
      .filter((item) => !item.isBasePackage)
      .some(
        (item) =>
          (item.promotionalRevenueCents === 0 &&
            Number(item.promotionalCostCents) > 0) ||
          (item.promotionalMarginBasisPoints !== null &&
            item.promotionalMarginBasisPoints <
              profitabilityPolicy.moduleMinimumIncrementalMarginBasisPoints)
      );
    const phaseMissingTemporaryDiscount = economicsPhases.some(
      (phase, index) =>
        phase.requiresTemporaryDiscountJustification &&
        !phaseHasTemporaryDiscount(commercialPhases[index])
    );
    if (phaseNeedsJustification && phaseMissingTemporaryDiscount) {
      blockingCodes.push('TEMPORARY_DISCOUNT_REQUIRED');
      economicsWarnings.push(
        `Margens entre ${formatSalesBasisPointsPercent(
          profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints
        )} e ${formatSalesBasisPointsPercent(
          profitabilityPolicy.recurringTargetEbitdaMarginBasisPoints
        )} exigem desconto temporário com término definido.`
      );
    }
    const firstCommercialPhase = commercialPhases[0];
    const promotionalModuleHasTemporaryDiscount =
      firstCommercialPhase !== undefined &&
      firstCommercialPhase.endsAt !== null &&
      firstCommercialPhase.lines.some(
        (line) =>
          line.billingInterval === 'monthly' &&
          line.itemKey !== 'clinical_core' &&
          line.discountCents > 0
      );
    if (
      promotionalModuleNeedsJustification &&
      !promotionalModuleHasTemporaryDiscount
    ) {
      blockingCodes.push('MODULE_PROMOTION_TERMS_REQUIRED');
      economicsWarnings.push(
        'Módulo abaixo do piso incremental exige benefício temporário explícito e justificativa.'
      );
    }
    economicsItems
      .filter((item) => !item.isBasePackage)
      .forEach((item) => {
        if (
          item.postPromotionMarginBasisPoints !== null &&
          item.postPromotionMarginBasisPoints <
            profitabilityPolicy.moduleMinimumIncrementalMarginBasisPoints
        ) {
          blockingCodes.push(
            `MODULE_MARGIN_BELOW_MINIMUM:${item.itemKey}`
          );
          economicsWarnings.push(
            `${item.publicName} está abaixo da margem incremental mínima de ${formatSalesBasisPointsPercent(
              profitabilityPolicy.moduleMinimumIncrementalMarginBasisPoints
            )}.`
          );
        }
      });
    if (capacityEconomics?.meetsMinimumMargin === false) {
      blockingCodes.push('CAPACITY_MARGIN_BELOW_MINIMUM');
      economicsWarnings.push(
        `Os blocos de capacidade não preservam a margem incremental mínima de ${formatSalesBasisPointsPercent(
          profitabilityPolicy.capacityMinimumIncrementalMarginBasisPoints
        )}.`
      );
    }
    expansionEconomics.forEach((expansion) => {
      if (expansion.status === 'insufficient_data') {
        blockingCodes.push(
          `EXPANSION_INSUFFICIENT_DATA:${expansion.itemKey}`
        );
      } else if (expansion.status === 'blocked') {
        blockingCodes.push(
          `EXPANSION_MARGIN_BELOW_MINIMUM:${expansion.itemKey}`
        );
        economicsWarnings.push(
          `${expansion.publicName} está abaixo da margem incremental mínima de ${formatSalesBasisPointsPercent(
            profitabilityPolicy.capacityMinimumIncrementalMarginBasisPoints
          )} para excedentes por driver.`
        );
      }
    });
    const promotionalMinimumPrice = calculateSalesMinimumPriceCents({
      directCostCents: nullableSum([
        intensivePromotionalPeriod.consolidated.directCostCents,
        intensivePromotionalPeriod.consolidated
          .sharedPlatformCostAllocatedCents
      ]),
      fixedAllocatedCostCents: 0,
      fixedPaymentFeeCents: intensiveValues.stripeFixedFeeCents,
      targetEbitdaMarginBasisPoints:
        profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints,
      stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
      delinquencyPercentageBasisPoints:
        intensiveValues.estimatedDelinquencyBasisPoints,
      taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
    });
    const postMinimumPrice = calculateSalesMinimumPriceCents({
      directCostCents: nullableSum([
        intensivePostPeriod.consolidated.directCostCents,
        intensivePostPeriod.consolidated.sharedPlatformCostAllocatedCents
      ]),
      fixedAllocatedCostCents: 0,
      fixedPaymentFeeCents: intensiveValues.stripeFixedFeeCents,
      targetEbitdaMarginBasisPoints:
        profitabilityPolicy.postPromotionMinimumEbitdaMarginBasisPoints,
      stripePercentageBasisPoints: intensiveValues.stripeFeeBasisPoints,
      delinquencyPercentageBasisPoints:
        intensiveValues.estimatedDelinquencyBasisPoints,
      taxPercentageBasisPoints: intensiveValues.revenueTaxBasisPoints
    });
    const firstYearMaximumDiscountCents =
      promotionalMinimumPrice === null
        ? null
        : Math.max(
            0,
            intensivePostPeriod.consolidated.recurringRevenueCents * 12 -
              promotionalMinimumPrice *
                Math.min(12, input.discountDurationMonths) -
              (postMinimumPrice || promotionalMinimumPrice) *
                Math.max(0, 12 - input.discountDurationMonths)
          );
    economics = {
      policy: profitabilityPolicy,
      pricingProfile: 'intensive',
      percentageCostBasisPoints,
      promotional: {
        revenueCents:
          intensivePromotionalPeriod.consolidated.recurringRevenueCents,
        costCents:
          intensivePromotionalPeriod.consolidated.totalEstimatedCostCents,
        ebitdaCents: intensivePromotionalPeriod.consolidated.ebitdaCents,
        marginBasisPoints:
          intensivePromotionalPeriod.consolidated.ebitdaMarginBasisPoints,
        maximumDiscountCents:
          promotionalMinimumPrice === null
            ? null
            : Math.max(
                0,
                intensivePromotionalPeriod.consolidated
                  .recurringRevenueCents - promotionalMinimumPrice
              )
      },
      postPromotion: {
        revenueCents:
          intensivePostPeriod.consolidated.recurringRevenueCents,
        costCents: intensivePostPeriod.consolidated.totalEstimatedCostCents,
        ebitdaCents: intensivePostPeriod.consolidated.ebitdaCents,
        marginBasisPoints:
          intensivePostPeriod.consolidated.ebitdaMarginBasisPoints,
        maximumDiscountCents:
          postMinimumPrice === null
            ? null
            : Math.max(
                0,
                intensivePostPeriod.consolidated.recurringRevenueCents -
                  postMinimumPrice
              )
      },
      items: economicsItems,
      capacity: capacityEconomics,
      expansions: expansionEconomics,
      phases: economicsPhases,
      firstYearMaximumDiscountCents,
      canSend: blockingCodes.length === 0,
      requiresJustification:
        phaseNeedsJustification || promotionalModuleNeedsJustification,
      blockingCodes: Array.from(new Set(blockingCodes)),
      warnings: economicsWarnings
    };
    warnings.push(...economicsWarnings);
  }

  const finalizedLines = lines.map((line) => {
    const commercialEconomics = commercialLineEconomics.get(line.lineKey);
    return {
      ...line,
      commercialPricing: {
        ...line.commercialPricing,
        marginalCostPerPatientCents:
          commercialEconomics?.marginalCostPerPatientCents ?? null,
        minimumPricePerPatientCents:
          commercialEconomics?.minimumPricePerPatientCents ?? null,
        recommendedPricePerPatientCents:
          commercialEconomics?.recommendedPricePerPatientCents ?? null
      }
    };
  });
  const monthlyTotalMismatches = finalizedLines.flatMap((line) =>
    line.commercialPricing.editMode === 'monthly_total' &&
    line.commercialPricing.monthlyTotalRepresentable === false &&
    line.commercialPricing.requestedMonthlyRevenueCents !== null &&
    line.commercialPricing.proposedPricePerPatientCents !== null &&
    line.commercialPricing.nearestRepresentableMonthlyRevenueCents !== null &&
    line.commercialPricing.monthlyTotalAdjustmentCents !== null
      ? [
          {
            itemKey: line.itemKey,
            publicName: line.publicName,
            requestedMonthlyRevenueCents:
              line.commercialPricing.requestedMonthlyRevenueCents,
            proposedPricePerPatientCents:
              line.commercialPricing.proposedPricePerPatientCents,
            nearestRepresentableMonthlyRevenueCents:
              line.commercialPricing.nearestRepresentableMonthlyRevenueCents,
            adjustmentCents:
              line.commercialPricing.monthlyTotalAdjustmentCents
          }
        ]
      : []
  );
  const capacityBlockPhases =
    perPatientPricingEnabled &&
    capacity &&
    profitabilityPolicy &&
    missingCommercialPriceItemKeys.length === 0
      ? deriveSalesCapacityBlockPhases({
          phases: commercialPhases,
          capacity,
          recurringLines: finalizedLines
            .filter((line) => line.pricingMode !== 'one_time')
            .map((line) => ({
              itemKey: line.itemKey,
              publicName: line.publicName,
              normalPricePerPatientCents:
                line.commercialPricing.proposedPricePerPatientCents,
              blockDirectMarginalCostCents:
                commercialBlockDirectMarginalCosts.get(line.lineKey) ?? null
            })),
          percentageCostBasisPoints:
            economics?.percentageCostBasisPoints ?? null,
          policy: profitabilityPolicy
        })
      : [];
  const currentCapacityBlockPhase = capacityBlockPhases[0] || null;
  const nextBlockPriceCents = perPatientPricingEnabled
    ? currentCapacityBlockPhase?.blockPriceCents ?? null
    : capacity?.effectiveBlockPriceCents ??
      (capacity ? capacity.policy.blockPriceCents : null);
  const nextBlockMarginalCostCents = perPatientPricingEnabled
    ? currentCapacityBlockPhase?.blockMarginalCostCents ?? null
    : null;
  const nextBlockContributionCents = perPatientPricingEnabled
    ? currentCapacityBlockPhase?.blockContributionCents ?? null
    : null;
  const nextBlockMarginBasisPoints = perPatientPricingEnabled
    ? currentCapacityBlockPhase?.blockIncrementalMarginBasisPoints ?? null
    : null;
  const lineEstimateStatuses = finalizedLines
    .filter((line) => line.pricingMode !== 'one_time')
    .map((line) => line.commercialPricing.estimateStatus);
  const commercialEstimateStatus: SalesCommercialEstimateStatus =
    missingCommercialPriceItemKeys.length > 0 ||
    lineEstimateStatuses.includes('insufficient_data')
      ? 'insufficient_data'
      : lineEstimateStatuses.includes('pre_launch')
        ? 'pre_launch'
        : lineEstimateStatuses.includes('estimated')
          ? 'estimated'
          : 'calibrated';
  const canonicalInput: SalesModularProposalInput = perPatientPricingEnabled
    ? {
        ...input,
        lines: input.lines.map((selection) => {
          const resultLine = finalizedLines.find(
            (line) => line.lineKey === lineIdentity(selection)
          );
          if (
            !resultLine ||
            resultLine.pricingMode === 'one_time' ||
            !resultLine.commercialPricing.enabled
          ) {
            return selection;
          }
          return {
            ...selection,
            pricingEditMode:
              resultLine.commercialPricing.editMode === 'monthly_total'
                ? 'monthly_total'
                : 'per_patient',
            proposedPricePerPatientCents:
              resultLine.commercialPricing.proposedPricePerPatientCents,
            customRecurringAmountCents:
              resultLine.commercialPricing.monthlyTotalRepresentable
                ? resultLine.commercialPricing.derivedMonthlyRevenueCents
                : selection.customRecurringAmountCents
          };
        })
      }
    : input;

  return {
    modelVersion: perPatientPricingEnabled
      ? SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION
      : profitabilityPolicy
        ? SALES_MODULAR_ECONOMICS_MODEL_VERSION
        : SALES_MODULAR_PROPOSAL_MODEL_VERSION,
    catalogVersionId: catalog.id,
    catalogVersion: catalog.version,
    input: canonicalInput,
    basePackage: {
      itemKey: 'clinical_core',
      tierId: baseTier.id,
      name: baseTier.publicName,
      limitQuantity: basePackageContractedLimit,
      includedStorageMb:
        capacity?.includedStorageMb ??
        (costSettings.includedStorageMbPerPatient !== null
          ? basePackageContractedLimit * costSettings.includedStorageMbPerPatient
          : null),
      occupiedQuantity: input.patientQuantity,
      availableQuantity: Math.max(
        0,
        basePackageContractedLimit - input.patientQuantity
      ),
      capacity
    },
    lines: finalizedLines,
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
    rating: economics
      ? economics.blockingCodes.includes('ECONOMICS_INSUFFICIENT_DATA') ||
        missingCommercialPriceItemKeys.length > 0
        ? 'insufficient_data'
        : economics.canSend
          ? 'healthy'
          : 'not_recommended'
      : phaseRating,
    requiresJustification:
      finalRequiresJustification || economics?.requiresJustification === true,
    missingCosts: Array.from(new Set(missingCosts)),
    missingDrivers,
    possibleDuplicateCosts,
    costOwnership: costSettings,
    totalsReconciled: true,
    forecast: {
      currentPatients: input.patientQuantity,
      expectedPatients: input.expectedPatientQuantity12Months,
      commercialLimitPatients: basePackageContractedLimit,
      aggressivePatients: basePackageContractedLimit
    },
    warnings,
    horizons,
    commercialPhases,
    economics,
    commercialPricing: {
      schemaVersion: 1,
      enabled: perPatientPricingEnabled,
      contractedCapacityPatients: perPatientPricingEnabled
        ? basePackageContractedLimit
        : null,
      selectedRecurringItemKeys: selectedRecurringLines.map(
        (line) => line.item.itemKey
      ),
      missingPriceItemKeys: missingCommercialPriceItemKeys,
      monthlyTotalMismatches,
      totalProposedPricePerPatientCents,
      nextBlockPriceCents:
        perPatientPricingEnabled ? nextBlockPriceCents : null,
      nextBlockMarginalCostCents:
        perPatientPricingEnabled ? nextBlockMarginalCostCents : null,
      nextBlockContributionCents:
        perPatientPricingEnabled ? nextBlockContributionCents : null,
      nextBlockMarginBasisPoints:
        perPatientPricingEnabled ? nextBlockMarginBasisPoints : null,
      capacityBlockPhases,
      estimateStatus: commercialEstimateStatus,
      assumptionSetVersion: assumptionSnapshot.version,
      calculatedAt: commercialStartsAt
    }
  };
}
