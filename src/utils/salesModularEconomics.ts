import type { SalesUsageProfile, SimulationValueSource } from './salesProfitability';

export const SALES_PROFITABILITY_POLICY_SCHEMA_VERSION = 1 as const;

export const SALES_PROFITABILITY_POLICY_MIGRATION_PENDING_CODE =
  'SALES_PROFITABILITY_POLICY_MIGRATION_PENDING';
export const SALES_PROFITABILITY_POLICY_MIGRATION_PENDING_MESSAGE =
  'A estrutura comercial de margem precisa ser aplicada antes de usar esta versão.';
export const SALES_PROFITABILITY_POLICY_REQUIRED_CODE =
  'PRICING_PROFITABILITY_POLICY_REQUIRED';
export const SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE =
  'Publique uma nova versão do catálogo com a política de margem antes de criar propostas personalizadas.';

export const isSalesProfitabilityPolicySchemaMissingError = (
  error: unknown
) => {
  const source = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const text = [
    source.code,
    source.message,
    source.details,
    source.hint
  ].map((value) => String(value || '')).join(' ').toLowerCase();
  return (
    text.includes(
      SALES_PROFITABILITY_POLICY_MIGRATION_PENDING_CODE.toLowerCase()
    ) ||
    (
      text.includes('profitability_policy') &&
      (
        text.includes('does not exist') ||
        text.includes('schema cache') ||
        text.includes('could not find')
      )
    )
  );
};

// Mantido apenas como referência histórica para snapshots anteriores.
// Novos cálculos usam exclusivamente os valores da política versionada.
export const SALES_PROFITABILITY_TARGETS_BASIS_POINTS = [
  6000,
  7000,
  7500,
  8000
] as const;

export type SalesProfitabilityTargetBasisPoints = number;

export type SalesExpansionItemKey =
  | 'appointments_communication'
  | 'financial_management'
  | 'insurance_tiss'
  | 'school_management'
  | 'additional_storage';

export type SalesExpansionDriverKey =
  | 'monthlyAppointments'
  | 'financialEntries'
  | 'tissGuides'
  | 'schoolPatients'
  | 'expectedStorageGb';

export type SalesDriverExpansionPolicy = {
  enabled: boolean;
  driverKey: SalesExpansionDriverKey;
  includedUnits: number | null;
  blockSizeUnits: number | null;
  blockPriceCents: number | null;
  source: SimulationValueSource;
  sourceDetail: string;
  effectiveAt: string;
  version: number;
};

export type SalesProfitabilityPolicy = {
  schemaVersion: typeof SALES_PROFITABILITY_POLICY_SCHEMA_VERSION;
  clinicMinimumEbitdaMarginBasisPoints: number;
  recurringTargetEbitdaMarginBasisPoints: number;
  moduleTargetIncrementalMarginBasisPoints: number;
  moduleMinimumIncrementalMarginBasisPoints: number;
  capacityMinimumIncrementalMarginBasisPoints: number;
  postPromotionMinimumEbitdaMarginBasisPoints: number;
  pricingProfile: Extract<SalesUsageProfile, 'intensive'>;
  sharedCostAllocation: 'clinical_core';
  fixedPaymentFeeAllocation: 'clinical_core';
  driverExpansionPolicies: Partial<
    Record<SalesExpansionItemKey, SalesDriverExpansionPolicy>
  >;
};

export const DEFAULT_SALES_PROFITABILITY_POLICY: SalesProfitabilityPolicy = {
  schemaVersion: SALES_PROFITABILITY_POLICY_SCHEMA_VERSION,
  clinicMinimumEbitdaMarginBasisPoints: 6000,
  recurringTargetEbitdaMarginBasisPoints: 7000,
  moduleTargetIncrementalMarginBasisPoints: 8000,
  moduleMinimumIncrementalMarginBasisPoints: 7500,
  capacityMinimumIncrementalMarginBasisPoints: 7500,
  postPromotionMinimumEbitdaMarginBasisPoints: 7000,
  pricingProfile: 'intensive',
  sharedCostAllocation: 'clinical_core',
  fixedPaymentFeeAllocation: 'clinical_core',
  driverExpansionPolicies: {}
};

const POLICY_KEYS = [
  'schemaVersion',
  'clinicMinimumEbitdaMarginBasisPoints',
  'recurringTargetEbitdaMarginBasisPoints',
  'moduleTargetIncrementalMarginBasisPoints',
  'moduleMinimumIncrementalMarginBasisPoints',
  'capacityMinimumIncrementalMarginBasisPoints',
  'postPromotionMinimumEbitdaMarginBasisPoints',
  'pricingProfile',
  'sharedCostAllocation',
  'fixedPaymentFeeAllocation',
  'driverExpansionPolicies'
] as const;

const EXPANSION_POLICY_KEYS = [
  'enabled',
  'driverKey',
  'includedUnits',
  'blockSizeUnits',
  'blockPriceCents',
  'source',
  'sourceDetail',
  'effectiveAt',
  'version'
] as const;

export const SALES_EXPANSION_DRIVER_BY_ITEM: Record<
  SalesExpansionItemKey,
  SalesExpansionDriverKey
> = {
  appointments_communication: 'monthlyAppointments',
  financial_management: 'financialEntries',
  insurance_tiss: 'tissGuides',
  school_management: 'schoolPatients',
  additional_storage: 'expectedStorageGb'
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const received = Object.keys(value).sort();
  const known = [...expected].sort();
  return (
    received.length === known.length &&
    received.every((key, index) => key === known[index])
  );
};

const integerBetween = (value: unknown, minimum: number, maximum: number) =>
  Number.isInteger(value) &&
  Number(value) >= minimum &&
  Number(value) <= maximum;

const nullableNonNegativeNumber = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

const validateExpansionPolicy = (
  itemKey: SalesExpansionItemKey,
  value: unknown
): value is SalesDriverExpansionPolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (!exactKeys(policy, EXPANSION_POLICY_KEYS)) return false;
  if (typeof policy.enabled !== 'boolean') return false;
  if (policy.driverKey !== SALES_EXPANSION_DRIVER_BY_ITEM[itemKey]) return false;
  if (!nullableNonNegativeNumber(policy.includedUnits)) return false;
  if (!nullableNonNegativeNumber(policy.blockSizeUnits)) return false;
  if (!nullableNonNegativeNumber(policy.blockPriceCents)) return false;
  if (
    !['actual', 'calculated', 'estimated', 'manual', 'unavailable'].includes(
      String(policy.source)
    )
  ) {
    return false;
  }
  if (typeof policy.sourceDetail !== 'string' || policy.sourceDetail.trim().length < 2) {
    return false;
  }
  if (!Number.isFinite(new Date(String(policy.effectiveAt)).getTime())) return false;
  if (!integerBetween(policy.version, 1, 2_147_483_647)) return false;
  if (!policy.enabled) return true;
  return (
    policy.source !== 'unavailable' &&
    typeof policy.includedUnits === 'number' &&
    typeof policy.blockSizeUnits === 'number' &&
    policy.blockSizeUnits > 0 &&
    typeof policy.blockPriceCents === 'number' &&
    Number.isInteger(policy.blockPriceCents) &&
    policy.blockPriceCents >= 0
  );
};

export const validateSalesProfitabilityPolicy = (
  value: unknown
): value is SalesProfitabilityPolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (!exactKeys(policy, POLICY_KEYS)) return false;
  if (policy.schemaVersion !== SALES_PROFITABILITY_POLICY_SCHEMA_VERSION) {
    return false;
  }
  const margins = [
    policy.clinicMinimumEbitdaMarginBasisPoints,
    policy.recurringTargetEbitdaMarginBasisPoints,
    policy.moduleTargetIncrementalMarginBasisPoints,
    policy.moduleMinimumIncrementalMarginBasisPoints,
    policy.capacityMinimumIncrementalMarginBasisPoints,
    policy.postPromotionMinimumEbitdaMarginBasisPoints
  ];
  if (!margins.every((margin) => integerBetween(margin, 0, 9999))) return false;
  if (
    Number(policy.clinicMinimumEbitdaMarginBasisPoints) >
      Number(policy.recurringTargetEbitdaMarginBasisPoints) ||
    Number(policy.recurringTargetEbitdaMarginBasisPoints) >
      Number(policy.moduleMinimumIncrementalMarginBasisPoints) ||
    Number(policy.moduleMinimumIncrementalMarginBasisPoints) >
      Number(policy.moduleTargetIncrementalMarginBasisPoints) ||
    Number(policy.capacityMinimumIncrementalMarginBasisPoints) <
      Number(policy.clinicMinimumEbitdaMarginBasisPoints) ||
    Number(policy.postPromotionMinimumEbitdaMarginBasisPoints) <
      Number(policy.clinicMinimumEbitdaMarginBasisPoints)
  ) {
    return false;
  }
  if (
    policy.pricingProfile !== 'intensive' ||
    policy.sharedCostAllocation !== 'clinical_core' ||
    policy.fixedPaymentFeeAllocation !== 'clinical_core'
  ) {
    return false;
  }
  if (
    !policy.driverExpansionPolicies ||
    typeof policy.driverExpansionPolicies !== 'object' ||
    Array.isArray(policy.driverExpansionPolicies)
  ) {
    return false;
  }
  const expansions = policy.driverExpansionPolicies as Record<string, unknown>;
  return Object.entries(expansions).every(
    ([itemKey, expansion]) =>
      itemKey in SALES_EXPANSION_DRIVER_BY_ITEM &&
      validateExpansionPolicy(itemKey as SalesExpansionItemKey, expansion)
  );
};

export type SalesMinimumPriceInput = {
  fixedAllocatedCostCents: number | null;
  directCostCents: number | null;
  fixedPaymentFeeCents: number | null;
  targetEbitdaMarginBasisPoints: number;
  stripePercentageBasisPoints: number | null;
  delinquencyPercentageBasisPoints: number | null;
  refundChargebackPercentageBasisPoints: number | null;
  taxPercentageBasisPoints: number | null;
};

export const calculateSalesMinimumPriceCents = (
  input: SalesMinimumPriceInput
): number | null => {
  const numeratorParts = [
    input.fixedAllocatedCostCents,
    input.directCostCents,
    input.fixedPaymentFeeCents
  ];
  const percentageParts = [
    input.stripePercentageBasisPoints,
    input.delinquencyPercentageBasisPoints,
    input.refundChargebackPercentageBasisPoints,
    input.taxPercentageBasisPoints
  ];
  if (
    numeratorParts.some((value) => value === null) ||
    percentageParts.some((value) => value === null)
  ) {
    return null;
  }
  const denominatorBasisPoints =
    10_000 -
    input.targetEbitdaMarginBasisPoints -
    percentageParts.reduce<number>((sum, value) => sum + Number(value), 0);
  if (denominatorBasisPoints <= 0) return null;
  const numerator = numeratorParts.reduce<number>(
    (sum, value) => sum + Number(value),
    0
  );
  return Math.ceil((numerator * 10_000) / denominatorBasisPoints);
};

export const calculateMaximumSupportedCostCents = (
  priceCents: number,
  targetEbitdaMarginBasisPoints: number,
  percentageCostBasisPoints: number
) => {
  const supportedBasisPoints =
    10_000 - targetEbitdaMarginBasisPoints - percentageCostBasisPoints;
  if (priceCents < 0 || supportedBasisPoints < 0) return null;
  return Math.floor((priceCents * supportedBasisPoints) / 10_000);
};

export const marginBasisPoints = (
  revenueCents: number,
  costCents: number | null
): number | null => {
  if (costCents === null || revenueCents <= 0) return null;
  return Math.round(((revenueCents - costCents) * 10_000) / revenueCents);
};

export type SalesModuleMarginStatus =
  | 'healthy'
  | 'acceptable'
  | 'attention'
  | 'blocked'
  | 'insufficient_data';

export type SalesIncrementalMarginKind = 'module' | 'capacity';

export const formatSalesBasisPointsPercent = (basisPoints: number) =>
  `${(basisPoints / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}%`;

export const salesProfitabilityPolicyThresholds = (
  policy: SalesProfitabilityPolicy
) =>
  Array.from(
    new Set([
      policy.clinicMinimumEbitdaMarginBasisPoints,
      policy.recurringTargetEbitdaMarginBasisPoints,
      policy.postPromotionMinimumEbitdaMarginBasisPoints,
      policy.moduleMinimumIncrementalMarginBasisPoints,
      policy.capacityMinimumIncrementalMarginBasisPoints,
      policy.moduleTargetIncrementalMarginBasisPoints
    ])
  ).sort((left, right) => left - right);

export const resolveSalesIncrementalMarginThresholds = (
  policy: SalesProfitabilityPolicy,
  kind: SalesIncrementalMarginKind = 'module'
) => {
  const minimumBasisPoints =
    kind === 'capacity'
      ? policy.capacityMinimumIncrementalMarginBasisPoints
      : policy.moduleMinimumIncrementalMarginBasisPoints;
  return {
    healthyBasisPoints: Math.max(
      minimumBasisPoints,
      policy.moduleTargetIncrementalMarginBasisPoints
    ),
    minimumBasisPoints,
    attentionBasisPoints: policy.clinicMinimumEbitdaMarginBasisPoints
  };
};

export const classifyModuleIncrementalMargin = (
  margin: number | null,
  policy: SalesProfitabilityPolicy,
  kind: SalesIncrementalMarginKind = 'module'
): SalesModuleMarginStatus => {
  if (margin === null) return 'insufficient_data';
  const thresholds = resolveSalesIncrementalMarginThresholds(policy, kind);
  if (margin >= thresholds.healthyBasisPoints) return 'healthy';
  if (margin >= thresholds.minimumBasisPoints) return 'acceptable';
  if (margin >= thresholds.attentionBasisPoints) return 'attention';
  return 'blocked';
};

export const formatSalesIncrementalMarginStatusLabel = (
  status: SalesModuleMarginStatus,
  policy: SalesProfitabilityPolicy,
  kind: SalesIncrementalMarginKind = 'module'
) => {
  if (status === 'insufficient_data') return 'Dados insuficientes';
  const thresholds = resolveSalesIncrementalMarginThresholds(policy, kind);
  if (status === 'healthy') {
    return `Saudável · ≥ ${formatSalesBasisPointsPercent(
      thresholds.healthyBasisPoints
    )}`;
  }
  if (status === 'acceptable') {
    return `Aceitável · ≥ ${formatSalesBasisPointsPercent(
      thresholds.minimumBasisPoints
    )} e < ${formatSalesBasisPointsPercent(
      thresholds.healthyBasisPoints
    )}`;
  }
  if (status === 'attention') {
    return `Atenção · ≥ ${formatSalesBasisPointsPercent(
      thresholds.attentionBasisPoints
    )} e < ${formatSalesBasisPointsPercent(
      thresholds.minimumBasisPoints
    )}`;
  }
  return `Abaixo do piso · < ${formatSalesBasisPointsPercent(
    thresholds.attentionBasisPoints
  )}`;
};

export type SalesModuleEffect = {
  marginBeforeBasisPoints: number | null;
  moduleMarginBasisPoints: number | null;
  marginAfterBasisPoints: number | null;
  variationBasisPoints: number | null;
  increasesConsolidatedMargin: boolean | null;
};

export type SalesPriceThresholds = Record<
  SalesProfitabilityTargetBasisPoints,
  number | null
>;

export type SalesEconomicsItemResult = {
  itemKey: string;
  publicName: string;
  isBasePackage: boolean;
  currentPriceCents: number;
  intensiveDirectCostCents: number | null;
  fixedAllocatedCostCents: number | null;
  fixedPaymentFeeCents: number | null;
  percentageCostBasisPoints: number | null;
  priceMinimumCents: SalesPriceThresholds;
  maximumSupportedCostAtCurrentPriceCents: number | null;
  promotionalRevenueCents: number;
  promotionalCostCents: number | null;
  promotionalMarginBasisPoints: number | null;
  postPromotionRevenueCents: number;
  postPromotionCostCents: number | null;
  postPromotionMarginBasisPoints: number | null;
  incrementalStatus: SalesModuleMarginStatus;
  effect: SalesModuleEffect | null;
  maximumDiscountCents: number | null;
};

export type SalesCapacityEconomicsResult = {
  revenueCents: number;
  incrementalCostCents: number | null;
  marginBasisPoints: number | null;
  minimumPriceCents: number | null;
  meetsMinimumMargin: boolean | null;
  incrementalStatus: SalesModuleMarginStatus;
};

export type SalesClinicPhaseEconomics = {
  startsAt: string;
  endsAt: string | null;
  revenueCents: number;
  costCents: number | null;
  ebitdaCents: number | null;
  marginBasisPoints: number | null;
  maximumDiscountCents: number | null;
  belowAbsoluteMinimum: boolean;
  requiresTemporaryDiscountJustification: boolean;
};

export type SalesModularEconomicsResult = {
  policy: SalesProfitabilityPolicy;
  pricingProfile: 'intensive';
  percentageCostBasisPoints: number | null;
  promotional: {
    revenueCents: number;
    costCents: number | null;
    ebitdaCents: number | null;
    marginBasisPoints: number | null;
    maximumDiscountCents: number | null;
  };
  postPromotion: {
    revenueCents: number;
    costCents: number | null;
    ebitdaCents: number | null;
    marginBasisPoints: number | null;
    maximumDiscountCents: number | null;
  };
  items: SalesEconomicsItemResult[];
  capacity: SalesCapacityEconomicsResult | null;
  expansions: Array<
    SalesDriverExpansionResult & {
      itemKey: SalesExpansionItemKey;
      publicName: string;
      driverKey: SalesExpansionDriverKey;
      incrementalCostPerUnitCents: number | null;
    }
  >;
  phases: SalesClinicPhaseEconomics[];
  firstYearMaximumDiscountCents: number | null;
  canSend: boolean;
  requiresJustification: boolean;
  blockingCodes: string[];
  alertCodes: string[];
  warnings: string[];
};

export const SALES_COMMERCIAL_EXCEPTION_TYPES = [
  'margin_policy_override',
  'temporary_promotion',
  'strategic_showcase'
] as const;

export type SalesCommercialExceptionType =
  (typeof SALES_COMMERCIAL_EXCEPTION_TYPES)[number];

export type SalesCommercialExceptionApprovalSnapshot = {
  schemaVersion: 1;
  status: 'approved';
  type: SalesCommercialExceptionType;
  explicitConfirmation: true;
  approvedCodes: string[];
  promotionalMarginBasisPoints: number | null;
  postPromotionMarginBasisPoints: number | null;
  moduleMargins: Array<{
    itemKey: string;
    promotionalMarginBasisPoints: number | null;
    postPromotionMarginBasisPoints: number | null;
  }>;
  capacityMarginBasisPoints: number | null;
  monthlyPriceCents: number;
  pricePerPatientCents: number | null;
  contractedCapacityPatients: number | null;
  approvedBy: string;
  approvedAt: string;
  policyVersion: {
    catalogVersion: number | null;
    schemaVersion: number;
  };
  policyHash?: string;
  justification: string;
  resultHash: string;
};

export type SalesProposalReviewClassification = {
  technicalBlockingCodes: string[];
  commercialAlertCodes: string[];
  canSaveDraft: boolean;
  canGeneratePublicOfferWithoutApproval: boolean;
  requiresCommercialApproval: boolean;
};

type SalesProposalReviewSource = {
  catalogVersion?: number;
  missingCosts?: string[];
  missingDrivers?: Array<{
    itemKey?: string;
    driver?: string;
  }>;
  possibleDuplicateCosts?: Array<{
    itemKey?: string;
    category?: string;
    justified?: boolean;
  }>;
  totalsReconciled?: boolean;
  commercialPricing?: {
    enabled?: boolean;
    missingPriceItemKeys?: string[];
    monthlyTotalMismatches?: Array<{
      itemKey?: string;
    }>;
    totalProposedPricePerPatientCents?: number | null;
    contractedCapacityPatients?: number | null;
    capacityBlockPhases?: Array<{
      phaseNumber?: number;
      blockPriceCents?: number;
      blocksRevenueCents?: number;
      blockMarginalCostCents?: number | null;
      blockIncrementalMarginBasisPoints?: number | null;
    }>;
  };
  promotionalRecurringRevenueCents?: number;
  economics?: SalesModularEconomicsResult | null;
};

const COMMERCIAL_REVIEW_CODE_PREFIXES = [
  'CLINIC_MARGIN_BELOW_MINIMUM',
  'POST_PROMOTION_MARGIN_BELOW_MINIMUM',
  'MODULE_MARGIN_BELOW_MINIMUM:',
  'CAPACITY_MARGIN_BELOW_MINIMUM',
  'EXPANSION_MARGIN_BELOW_MINIMUM:',
  'CLINIC_MARGIN_BELOW_TARGET',
  'POST_PROMOTION_MARGIN_BELOW_TARGET',
  'MODULE_MARGIN_BELOW_TARGET:',
  'CAPACITY_MARGIN_BELOW_TARGET',
  'EXPANSION_MARGIN_BELOW_TARGET:',
  'TEMPORARY_DISCOUNT_REQUIRED',
  'TEMPORARY_DISCOUNT_RECOMMENDED',
  'MODULE_PROMOTION_TERMS_REQUIRED',
  'MODULE_PROMOTION_TERMS_RECOMMENDED',
  // Compatibilidade exclusiva para leitura de snapshots históricos.
  'CLINIC_MARGIN_BELOW_60',
  'POST_PROMOTION_MARGIN_BELOW_70',
  'MODULE_MARGIN_BELOW_75:',
  'CAPACITY_MARGIN_BELOW_75',
  'EXPANSION_MARGIN_BELOW_75:'
] as const;

export const isSalesCommercialReviewCode = (code: string) =>
  COMMERCIAL_REVIEW_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
  code === 'PROMOTIONAL_PHASE_DEFICIT' ||
  code.startsWith('FREE_MODULE_WITH_COST:') ||
  code === 'STRATEGIC_SHOWCASE_CONDITION';

const uniqueSortedCodes = (codes: string[]) =>
  Array.from(new Set(codes.filter(Boolean))).sort();

export const classifySalesProposalReview = (
  result: SalesProposalReviewSource
): SalesProposalReviewClassification => {
  const technicalBlockingCodes: string[] = [];
  const commercialAlertCodes: string[] = [];
  const economics = result.economics;

  for (const code of economics?.blockingCodes || []) {
    if (isSalesCommercialReviewCode(code)) commercialAlertCodes.push(code);
    else technicalBlockingCodes.push(code);
  }
  for (const code of economics?.alertCodes || []) {
    commercialAlertCodes.push(code);
  }

  for (const itemKey of result.missingCosts || []) {
    technicalBlockingCodes.push(`PRICING_COST_MODEL_MISSING:${itemKey}`);
  }
  for (const missing of result.missingDrivers || []) {
    technicalBlockingCodes.push(
      `REQUIRED_DRIVER_MISSING:${missing.itemKey || 'unknown'}:${missing.driver || 'unknown'}`
    );
  }
  for (const duplicate of result.possibleDuplicateCosts || []) {
    if (duplicate.justified === true) continue;
    technicalBlockingCodes.push(
      `POSSIBLE_DUPLICATE_COST:${duplicate.itemKey || 'unknown'}:${duplicate.category || 'unknown'}`
    );
  }
  for (const itemKey of result.commercialPricing?.missingPriceItemKeys || []) {
    technicalBlockingCodes.push(
      `COMMERCIAL_PRICE_PER_PATIENT_MISSING:${itemKey}`
    );
  }
  for (const mismatch of
    result.commercialPricing?.monthlyTotalMismatches || []) {
    technicalBlockingCodes.push(
      `PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:${mismatch.itemKey || 'unknown'}`
    );
  }
  if (result.totalsReconciled === false) {
    technicalBlockingCodes.push('PRICING_TOTAL_MISMATCH');
  }

  if (
    economics?.phases.some(
      (phase) =>
        phase.costCents !== null &&
        phase.revenueCents - phase.costCents < 0
    )
  ) {
    commercialAlertCodes.push('PROMOTIONAL_PHASE_DEFICIT');
  }
  for (const item of economics?.items || []) {
    if (
      !item.isBasePackage &&
      item.promotionalRevenueCents === 0 &&
      item.promotionalCostCents !== null &&
      item.promotionalCostCents > 0
    ) {
      commercialAlertCodes.push(`FREE_MODULE_WITH_COST:${item.itemKey}`);
    }
  }
  if (
    economics?.requiresJustification === true &&
    commercialAlertCodes.length === 0
  ) {
    commercialAlertCodes.push('CLINIC_MARGIN_BELOW_TARGET');
  }

  const technical = uniqueSortedCodes(technicalBlockingCodes);
  const commercial = uniqueSortedCodes(commercialAlertCodes);
  return {
    technicalBlockingCodes: technical,
    commercialAlertCodes: commercial,
    canSaveDraft: technical.length === 0,
    // Margens abaixo da meta são alertas comerciais, nunca bloqueios.
    canGeneratePublicOfferWithoutApproval: technical.length === 0,
    requiresCommercialApproval: false
  };
};

export const buildSalesCommercialApprovalResult = (
  result: SalesProposalReviewSource,
  approvedCodes: string[]
) => ({
  catalogVersion:
    Number.isInteger(result.catalogVersion) ? Number(result.catalogVersion) : null,
  policySchemaVersion:
    result.economics?.policy.schemaVersion ??
    SALES_PROFITABILITY_POLICY_SCHEMA_VERSION,
  approvedCodes: uniqueSortedCodes(approvedCodes),
  promotionalMarginBasisPoints:
    result.economics?.promotional.marginBasisPoints ?? null,
  postPromotionMarginBasisPoints:
    result.economics?.postPromotion.marginBasisPoints ?? null,
  moduleMargins: (result.economics?.items || [])
    .map((item) => ({
      itemKey: item.itemKey,
      promotionalMarginBasisPoints: item.promotionalMarginBasisPoints,
      postPromotionMarginBasisPoints: item.postPromotionMarginBasisPoints
    }))
    .sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
  capacityMarginBasisPoints:
    result.economics?.capacity?.marginBasisPoints ?? null,
  monthlyPriceCents: Number(result.promotionalRecurringRevenueCents || 0),
  pricePerPatientCents:
    result.commercialPricing?.totalProposedPricePerPatientCents ?? null,
  contractedCapacityPatients:
    result.commercialPricing?.contractedCapacityPatients ?? null,
  capacityBlockPhases: (
    result.commercialPricing?.capacityBlockPhases || []
  ).map((phase) => ({
    phaseNumber: Number(phase.phaseNumber || 0),
    blockPriceCents: Number(phase.blockPriceCents || 0),
    blocksRevenueCents: Number(phase.blocksRevenueCents || 0),
    blockMarginalCostCents:
      phase.blockMarginalCostCents == null
        ? null
        : Number(phase.blockMarginalCostCents),
    blockIncrementalMarginBasisPoints:
      phase.blockIncrementalMarginBasisPoints == null
        ? null
        : Number(phase.blockIncrementalMarginBasisPoints)
  }))
});

export const buildSalesCommercialApprovalHashInput = (
  result: SalesProposalReviewSource,
  approvedCodes: string[]
) => ({
  approvalResult: buildSalesCommercialApprovalResult(result, approvedCodes),
  profitabilityPolicy: result.economics?.policy ?? null
});

export const validateSalesCommercialExceptionActor = (input: {
  role: unknown;
  mfaVerified: boolean;
  explicitConfirmation: boolean;
  justification: string;
  type: unknown;
}) => {
  if (input.role !== 'owner') return 'OWNER_ROLE_REQUIRED' as const;
  if (!input.mfaVerified) return 'OWNER_MFA_REQUIRED' as const;
  if (!input.explicitConfirmation) {
    return 'COMMERCIAL_EXCEPTION_CONFIRMATION_REQUIRED' as const;
  }
  if (!SALES_COMMERCIAL_EXCEPTION_TYPES.includes(
    input.type as SalesCommercialExceptionType
  )) {
    return 'COMMERCIAL_EXCEPTION_TYPE_INVALID' as const;
  }
  if (input.justification.trim().length < 20) {
    return 'COMMERCIAL_EXCEPTION_JUSTIFICATION_REQUIRED' as const;
  }
  return null;
};

export const calculateSalesModuleEffect = (input: {
  revenueBeforeCents: number;
  costBeforeCents: number | null;
  moduleRevenueCents: number;
  moduleCostCents: number | null;
}): SalesModuleEffect => {
  const marginBefore = marginBasisPoints(
    input.revenueBeforeCents,
    input.costBeforeCents
  );
  const moduleMargin = marginBasisPoints(
    input.moduleRevenueCents,
    input.moduleCostCents
  );
  const combinedCost =
    input.costBeforeCents === null || input.moduleCostCents === null
      ? null
      : input.costBeforeCents + input.moduleCostCents;
  const marginAfter = marginBasisPoints(
    input.revenueBeforeCents + input.moduleRevenueCents,
    combinedCost
  );
  return {
    marginBeforeBasisPoints: marginBefore,
    moduleMarginBasisPoints: moduleMargin,
    marginAfterBasisPoints: marginAfter,
    variationBasisPoints:
      marginBefore === null || marginAfter === null
        ? null
        : marginAfter - marginBefore,
    increasesConsolidatedMargin:
      marginBefore === null || moduleMargin === null || marginAfter === null
        ? null
        : marginAfter > marginBefore
  };
};

export type SalesDriverExpansionResult = {
  status: 'disabled' | 'included' | 'priced' | 'insufficient_data' | 'blocked';
  driverValue: number | null;
  includedUnits: number | null;
  excessUnits: number | null;
  blocks: number | null;
  additionalRevenueCents: number | null;
  additionalCostCents: number | null;
  incrementalMarginBasisPoints: number | null;
};

export const calculateSalesDriverExpansion = (input: {
  driverValue: number | null;
  policy: SalesDriverExpansionPolicy | null | undefined;
  incrementalCostPerUnitCents: number | null;
  minimumMarginBasisPoints: number;
}): SalesDriverExpansionResult => {
  if (!input.policy?.enabled) {
    return {
      status: 'disabled',
      driverValue: input.driverValue,
      includedUnits: input.policy?.includedUnits ?? null,
      excessUnits: 0,
      blocks: 0,
      additionalRevenueCents: 0,
      additionalCostCents: 0,
      incrementalMarginBasisPoints: null
    };
  }
  if (
    input.driverValue === null ||
    input.incrementalCostPerUnitCents === null ||
    input.policy.includedUnits === null ||
    input.policy.blockSizeUnits === null ||
    input.policy.blockSizeUnits <= 0 ||
    input.policy.blockPriceCents === null
  ) {
    return {
      status: 'insufficient_data',
      driverValue: input.driverValue,
      includedUnits: input.policy.includedUnits,
      excessUnits: null,
      blocks: null,
      additionalRevenueCents: null,
      additionalCostCents: null,
      incrementalMarginBasisPoints: null
    };
  }
  const excessUnits = Math.max(input.driverValue - input.policy.includedUnits, 0);
  if (excessUnits === 0) {
    return {
      status: 'included',
      driverValue: input.driverValue,
      includedUnits: input.policy.includedUnits,
      excessUnits,
      blocks: 0,
      additionalRevenueCents: 0,
      additionalCostCents: 0,
      incrementalMarginBasisPoints: null
    };
  }
  const blocks = Math.ceil(excessUnits / input.policy.blockSizeUnits);
  const coveredUnits = blocks * input.policy.blockSizeUnits;
  const additionalRevenueCents = blocks * input.policy.blockPriceCents;
  const additionalCostCents = Math.ceil(
    coveredUnits * input.incrementalCostPerUnitCents
  );
  const incrementalMargin = marginBasisPoints(
    additionalRevenueCents,
    additionalCostCents
  );
  return {
    status:
      incrementalMargin !== null &&
      incrementalMargin >= input.minimumMarginBasisPoints
        ? 'priced'
        : 'blocked',
    driverValue: input.driverValue,
    includedUnits: input.policy.includedUnits,
    excessUnits,
    blocks,
    additionalRevenueCents,
    additionalCostCents,
    incrementalMarginBasisPoints: incrementalMargin
  };
};
