import type {
  SalesModularLineSelection,
  SalesModularProposalInput,
  SalesPricingCatalogItem,
  SalesPricingCatalogSnapshot,
  SalesPricingCatalogTier
} from './salesModularProposal';

// Presentation/draft helpers moved unchanged from SalesModularProposalBuilder.
// Server-side pricing and immutable saved snapshots remain authoritative.

const SALES_FUNCTIONAL_MODULE_KEYS = [
  'clinical_core',
  'appointments_communication',
  'financial_management',
  'insurance_tiss',
  'school_management'
] as const;

export const SALES_PATIENT_CAPACITY_BLOCKS = [10, 20, 30, 40, 50] as const;
const SALES_ESSENTIAL_PATIENT_LIMIT = 50;
export const SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS = 50;
export const isSalesFunctionalModuleItemKey = (value: string) =>
  SALES_FUNCTIONAL_MODULE_KEYS.includes(
    value as (typeof SALES_FUNCTIONAL_MODULE_KEYS)[number]
  );

export const commercialCapacityForDemand = (patientQuantity: number) =>
  SALES_PATIENT_CAPACITY_BLOCKS.find(
    (capacity) => patientQuantity <= capacity
  ) ?? null;

export const commercialPlanLabelForCapacity = (capacity: number) => {
  const safeCapacity = Math.max(
    SALES_ESSENTIAL_PATIENT_LIMIT,
    Math.floor(Number(capacity) || SALES_ESSENTIAL_PATIENT_LIMIT)
  );
  if (safeCapacity <= SALES_ESSENTIAL_PATIENT_LIMIT) {
    return 'Plano Essencial · 1 a 50 pacientes';
  }
  const enterpriseBlock = Math.ceil(
    (safeCapacity - SALES_ESSENTIAL_PATIENT_LIMIT) /
      SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS
  );
  const startsAt =
    SALES_ESSENTIAL_PATIENT_LIMIT +
    (enterpriseBlock - 1) * SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS +
    1;
  return `Enterprise ${enterpriseBlock} · ${startsAt} a ${safeCapacity} pacientes`;
};

// New exact-seat offers use the Essencial 1–50 / Enterprise 50-seat bands.
// Keep historical block-based offer capacity selection unchanged.
export const commercialCapacityForExactDemand = (patientQuantity: number) => {
  const demand = Math.max(1, Math.floor(Number(patientQuantity) || 1));
  return Math.ceil(demand / SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS) * SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS;
};

export const itemTierForQuantity = (
  item: SalesPricingCatalogItem,
  quantity: number
) =>
  [...item.tiers]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .find(
      (tier) =>
        !tier.isCustom &&
        tier.minimumQuantity <= quantity &&
        (tier.maximumQuantity === null || quantity <= tier.maximumQuantity)
    ) ||
  item.tiers.find((tier) => tier.isCustom) ||
  null;

export const selectionForItem = (
  item: SalesPricingCatalogItem,
  patientQuantity: number,
  baseTier: SalesPricingCatalogTier,
  perPatientPricing = false,
  exactPerPatientBilling = false
): SalesModularLineSelection => {
  const quantity =
    item.itemKey === 'insurance_tiss'
      ? 100
      : item.itemKey === 'additional_storage'
        ? 1
        : patientQuantity;
  const suggestedTier = itemTierForQuantity(item, quantity);
  const customCommercialTier =
    perPatientPricing && isSalesFunctionalModuleItemKey(item.itemKey)
      ? item.tiers.find((tier) => tier.isCustom) ||
        item.tiers.find((tier) => tier.maximumQuantity === null) ||
        null
      : null;
  const linkedTier =
    item.itemKey === 'clinical_core'
      ? baseTier
      : customCommercialTier || suggestedTier;
  const catalogMonthlyAmountCents =
    linkedTier?.recurringAmountCents ??
    suggestedTier?.recurringAmountCents ??
    item.recurringAmountCents ??
    0;
  return {
    itemKey: item.itemKey,
    tierId: linkedTier?.id || null,
    quantity,
    itemDiscountBasisPoints: 0,
    customRecurringAmountCents:
      exactPerPatientBilling && item.billingInterval === 'monthly'
        ? null
        : perPatientPricing && item.billingInterval !== 'one_time'
          ? catalogMonthlyAmountCents
        : linkedTier?.isCustom
          ? 0
          : null,
    pricingEditMode:
      exactPerPatientBilling && item.billingInterval === 'monthly'
        ? 'per_patient'
        : perPatientPricing && item.billingInterval !== 'one_time'
          ? 'monthly_total'
        : undefined,
    proposedPricePerPatientCents:
      perPatientPricing && item.billingInterval !== 'one_time'
        ? null
        : undefined,
    customOneTimeAmountCents: item.itemKey === 'onboarding' ? 0 : null
  };
};

export const normalizeBuilderInputForCalculation = (
  input: SalesModularProposalInput,
  catalog: SalesPricingCatalogSnapshot
): SalesModularProposalInput => {
  if (input.exactPerPatientBilling !== true) return input;
  const coreItem = catalog.items.find(
    (item) => item.itemKey === 'clinical_core'
  );
  const baseTier = coreItem?.tiers.find(
    (tier) => tier.id === input.basePackageTierId
  );
  if (!coreItem || !baseTier) return input;

  const patientQuantity = input.patientQuantity;
  const rawCapacity = Number(input.customBasePackageLimit || 0);
  const validCommercialCapacity =
    Number.isInteger(rawCapacity) &&
    rawCapacity >= SALES_ESSENTIAL_PATIENT_LIMIT &&
    rawCapacity >= patientQuantity &&
    rawCapacity % SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS === 0;
  const customBasePackageLimit =
    input.commercialPricingMode === 'manual_module_prices' &&
    (baseTier.isCustom || baseTier.maximumQuantity === null)
      ? validCommercialCapacity
        ? rawCapacity
        : commercialCapacityForExactDemand(patientQuantity)
      : input.customBasePackageLimit;

  const lines = input.lines.map((line) => {
    const item = catalog.items.find(
      (candidate) => candidate.itemKey === line.itemKey
    );
    if (!item) return line;

    let normalized: SalesModularLineSelection = { ...line };
    if (item.itemKey === 'clinical_core') {
      normalized = {
        ...normalized,
        tierId: baseTier.id,
        quantity: patientQuantity
      };
    } else if (
      item.pricingMode === 'package_limit' &&
      item.itemKey !== 'insurance_tiss'
    ) {
      const selectedTier = item.tiers.find(
        (tier) => tier.id === normalized.tierId
      );
      const selectedTierFits =
        Boolean(selectedTier) &&
        Number(selectedTier?.minimumQuantity || 0) <= patientQuantity &&
        (
          selectedTier?.maximumQuantity === null ||
          patientQuantity <= Number(selectedTier?.maximumQuantity)
        );
      const compatibleTier = selectedTierFits
        ? selectedTier
        : itemTierForQuantity(item, patientQuantity);
      normalized = {
        ...normalized,
        tierId: compatibleTier?.id || normalized.tierId || null,
        quantity: patientQuantity
      };
    }

    if (
      input.commercialPricingMode === 'manual_module_prices' &&
      item.billingInterval !== 'one_time'
    ) {
      const editMode =
        normalized.pricingEditMode === 'monthly_total'
          ? 'monthly_total'
          : 'per_patient';
      if (editMode === 'per_patient') {
        normalized = {
          ...normalized,
          pricingEditMode: editMode,
          proposedPricePerPatientCents:
            typeof normalized.proposedPricePerPatientCents === 'number' &&
            Number.isFinite(normalized.proposedPricePerPatientCents) &&
            normalized.proposedPricePerPatientCents >= 0
              ? Math.round(normalized.proposedPricePerPatientCents)
              : null,
          customRecurringAmountCents: null
        };
      } else {
        normalized = {
          ...normalized,
          pricingEditMode: editMode,
          proposedPricePerPatientCents: null,
          customRecurringAmountCents:
            typeof normalized.customRecurringAmountCents === 'number' &&
            Number.isFinite(normalized.customRecurringAmountCents) &&
            normalized.customRecurringAmountCents >= 0
              ? Math.round(normalized.customRecurringAmountCents)
              : null
        };
      }
    }

    return normalized;
  });

  return {
    ...input,
    customBasePackageLimit,
    lines
  };
};

