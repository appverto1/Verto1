import crypto from 'crypto';
import type Stripe from 'stripe';

type SupabaseClientLike = any;

export const ACTIVE_PATIENT_BILLING_MODEL = 'active_patients' as const;
export const ACTIVE_PATIENT_BILLING_LOOKUP_KEY = 'verto_active_patients_monthly' as const;
export const ACTIVE_PATIENT_BILLING_TIERS: Array<never> = [];

export type SafeStripeBillingTier = {
  from: number;
  to: number | null;
  upTo: number | null;
  unitAmountCents: number | null;
  flatAmountCents: number | null;
  unitAmountDecimal: string | null;
  flatAmountDecimal: string | null;
  displayLabel?: string | null;
  displayPrice?: string | null;
};

export type SafeStripeBillingPlan = {
  productId: string;
  priceId: string;
  lookupKey: string | null;
  planKey: string | null;
  name: string;
  description: string | null;
  currency: string;
  interval: string | null;
  intervalCount: number | null;
  billingScheme: string;
  tiersMode: string | null;
  usageType: string | null;
  unitAmountCents: number | null;
  unitAmountDecimal: string | null;
  tiers: SafeStripeBillingTier[];
  active: boolean;
  metadata: Record<string, string>;
  patientLimit: number | null;
  minPatients: number | null;
  maxPatients: number | null;
  pricingModel: 'tiered_active_patients' | 'per_patient' | 'fixed_limit' | 'custom';
  usesActivePatientQuantity: boolean;
  isCustom: boolean;
  enterpriseThreshold: number | null;
  selfService: boolean;
  stripeCreatedAt: string | null;
  stripeUpdatedAt: string | null;
};

export type SafeStripeBillingEstimate = {
  priceId: string;
  activePatients: number;
  matchedTier: SafeStripeBillingTier | null;
  estimatedAmountCents: number | null;
  currency: string;
  isEnterprise: boolean;
  enterpriseThreshold: number | null;
};

const ACTIVE_PATIENT_STATUS_VALUES = [
  'ACTIVE',
  'active',
  'ativo',
  'atendimento_ativo',
  'em_tratamento'
] as const;

function toSafeString(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function toSafeInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function centsFromStripeDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function mergeSafeMetadata(...sources: Array<Record<string, string> | null | undefined>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const source of sources) {
    for (const [rawKey, rawValue] of Object.entries(source || {})) {
      const key = toSafeString(rawKey, 80);
      if (!key) continue;
      if (/(secret|token|key|password|credential)/i.test(key)) continue;
      safe[key] = toSafeString(rawValue, 240);
    }
  }
  return safe;
}

function metadataValue(metadata: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = toSafeString(metadata[key], 200);
    if (value) return value;
  }
  return '';
}

function booleanMetadataValue(metadata: Record<string, string>, keys: string[], defaultValue: boolean): boolean {
  const raw = metadataValue(metadata, keys).toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'sim', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'nao', 'não', 'off'].includes(raw)) return false;
  return defaultValue;
}

function planKeyFromMetadata(metadata: Record<string, string>, lookupKey: string): string | null {
  return (
    metadataValue(metadata, [
      'vertoPlanKey',
      'verto_plan_key',
      'plan_key',
      'billing_plan_key',
      'billingPlanKey'
    ]) ||
    lookupKey ||
    null
  );
}

function metadataIndicatesActivePatients(value: string): boolean {
  const normalized = toSafeString(value, 160).toLowerCase();
  return Boolean(
    normalized === ACTIVE_PATIENT_BILLING_MODEL ||
    normalized === ACTIVE_PATIENT_BILLING_LOOKUP_KEY ||
    normalized.includes('active_patient') ||
    normalized.includes('active_patients')
  );
}

function parsePriceIdList(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => toSafeString(item, 120))
        .filter(Boolean)
    )
  );
}

function stripeProductFromPrice(price: Stripe.Price): Stripe.Product | null {
  const product = (price as any)?.product;
  if (product && typeof product === 'object' && !('deleted' in product)) return product as Stripe.Product;
  return null;
}

function stripeProductIsActive(product: Stripe.Product | null): boolean {
  if (!product) return true;
  return product.active !== false;
}

function isActivePatientBillingPrice(params: {
  price: Stripe.Price;
  product: Stripe.Product | null;
  primaryPriceId?: string | null;
  allowedPriceIds?: string[];
}): boolean {
  const priceId = toSafeString(params.price.id, 120);
  if (!params.price.active || !params.price.recurring || !stripeProductIsActive(params.product)) return false;
  const allowedIds = new Set((params.allowedPriceIds || []).map((id) => toSafeString(id, 120)).filter(Boolean));
  const primaryPriceId = toSafeString(params.primaryPriceId, 120);
  if (priceId && (priceId === primaryPriceId || allowedIds.has(priceId))) return true;

  const metadata = mergeSafeMetadata(params.product?.metadata, params.price.metadata);
  const billingModel = metadataValue(metadata, ['billing_model', 'billingModel', 'verto_billing_model']).toLowerCase();
  const lookupKey = toSafeString((params.price as any).lookup_key, 160).toLowerCase();
  const planKey = toSafeString(planKeyFromMetadata(metadata, lookupKey), 160).toLowerCase();
  const visible = metadataValue(metadata, ['verto_visible', 'onboarding_visible', 'visible']).toLowerCase();
  const audience = metadataValue(metadata, ['audience', 'plan_audience', 'verto_audience']).toLowerCase();
  return (
    metadataIndicatesActivePatients(billingModel) ||
    metadataIndicatesActivePatients(lookupKey) ||
    metadataIndicatesActivePatients(planKey) ||
    visible === 'true' ||
    audience === 'clinic'
  );
}

function buildSafeStripeBillingPlan(params: {
  price: Stripe.Price;
  product: Stripe.Product | null;
  primaryPriceId?: string | null;
}): SafeStripeBillingPlan {
  const { price, product } = params;
  const metadata = mergeSafeMetadata(product?.metadata, price.metadata);
  const priceId = toSafeString(price.id, 120);
  const lookupKey = toSafeString((price as any).lookup_key, 160) || null;
  const planKey = planKeyFromMetadata(metadata, lookupKey || '');
  const billingScheme = toSafeString(price.billing_scheme, 40) || 'per_unit';
  const tiersMode = toSafeString((price as any).tiers_mode, 40) || null;
  const usageType = toSafeString(price.recurring?.usage_type, 40) || null;
  const minPatients = toSafeInteger(metadataValue(metadata, ['min_patients', 'minimum_patients', 'patient_min']));
  const maxPatients =
    toSafeInteger(metadataValue(metadata, ['max_patients', 'patient_limit', 'active_patient_limit', 'limit_patients'])) ||
    null;
  const enterpriseThreshold =
    toSafeInteger(metadataValue(metadata, [
      'enterpriseRequiredAfter',
      'enterprise_required_after',
      'enterprise_threshold',
      'enterprise_from',
      'custom_threshold',
      'custom_from_patients'
    ])) ||
    null;
  const quantityMode = metadataValue(metadata, ['quantity_mode', 'billing_quantity_mode']).toLowerCase();
  const usesActivePatientQuantity =
    billingScheme === 'tiered' ||
    quantityMode === 'active_patients' ||
    quantityMode === 'per_patient' ||
    priceId === toSafeString(params.primaryPriceId, 120);
  const isCustom =
    metadataValue(metadata, ['custom_plan', 'enterprise', 'requires_sales']).toLowerCase() === 'true' ||
    maxPatients === null && metadataValue(metadata, ['plan_type', 'kind']).toLowerCase() === 'enterprise';
  const selfService = booleanMetadataValue(metadata, ['selfService', 'self_service', 'verto_self_service'], !isCustom);
  const pricingModel: SafeStripeBillingPlan['pricingModel'] = isCustom
    ? 'custom'
    : billingScheme === 'tiered'
      ? 'tiered_active_patients'
      : usesActivePatientQuantity
        ? 'per_patient'
        : 'fixed_limit';

  let previousTierLimit = 0;
  const tiers = Array.isArray((price as any).tiers)
    ? ((price as any).tiers as Stripe.Price.Tier[]).map((tier) => {
        const upTo = tier.up_to === 'inf' ? null : toSafeInteger(tier.up_to);
        const from = previousTierLimit + 1;
        if (typeof upTo === 'number') previousTierLimit = upTo;
        return {
        from,
        to: upTo,
        upTo,
        unitAmountCents: typeof tier.unit_amount === 'number' ? tier.unit_amount : null,
        flatAmountCents: typeof tier.flat_amount === 'number' ? tier.flat_amount : null,
        unitAmountDecimal: toSafeString((tier as any).unit_amount_decimal, 80) || null,
        flatAmountDecimal: toSafeString((tier as any).flat_amount_decimal, 80) || null
        };
      })
    : [];

  return {
    productId: toSafeString(product?.id || String(price.product || ''), 120),
    priceId,
    lookupKey,
    planKey,
    name: toSafeString(metadataValue(metadata, ['display_name', 'plan_name']) || product?.name, 160) || 'Plano Verto',
    description: toSafeString(product?.description || metadataValue(metadata, ['description']), 500) || null,
    currency: toSafeString(price.currency, 20).toLowerCase() || 'brl',
    interval: toSafeString(price.recurring?.interval, 40) || null,
    intervalCount: typeof price.recurring?.interval_count === 'number' ? price.recurring.interval_count : null,
    billingScheme,
    tiersMode,
    usageType,
    unitAmountCents: typeof price.unit_amount === 'number' ? price.unit_amount : null,
    unitAmountDecimal: toSafeString((price as any).unit_amount_decimal, 80) || null,
    tiers,
    active: price.active === true,
    metadata,
    patientLimit: maxPatients,
    minPatients,
    maxPatients,
    pricingModel,
    usesActivePatientQuantity,
    isCustom,
    enterpriseThreshold,
    selfService,
    stripeCreatedAt:
      typeof (price as any).created === 'number'
        ? new Date(Number((price as any).created) * 1000).toISOString()
        : null,
    stripeUpdatedAt:
      typeof (product as any)?.updated === 'number'
        ? new Date(Number((product as any).updated) * 1000).toISOString()
        : null
  };
}

export function estimateStripeActivePatientPlan(params: {
  plan: SafeStripeBillingPlan;
  activePatients: number;
  enterpriseThreshold?: number | null;
}): SafeStripeBillingEstimate {
  const plan = params.plan;
  const activePatients = Math.max(1, Math.floor(Number(params.activePatients || 1)));
  const enterpriseThreshold =
    typeof params.enterpriseThreshold === 'number' && params.enterpriseThreshold > 0
      ? Math.floor(params.enterpriseThreshold)
      : typeof plan.enterpriseThreshold === 'number' && plan.enterpriseThreshold > 0
        ? Math.floor(plan.enterpriseThreshold)
        : null;
  const isEnterprise = Boolean(enterpriseThreshold && activePatients > enterpriseThreshold);
  const tiers = Array.isArray(plan.tiers) ? plan.tiers : [];
  const matchedTier =
    tiers.find((tier) => {
      const from = Math.max(1, Number(tier.from || 1));
      const to = tier.to === null ? Number.MAX_SAFE_INTEGER : Number(tier.to || 0);
      return activePatients >= from && activePatients <= to;
    }) ||
    (tiers.length > 0 ? tiers[tiers.length - 1] : null);

  if (isEnterprise) {
    return {
      priceId: plan.priceId,
      activePatients,
      matchedTier,
      estimatedAmountCents: null,
      currency: plan.currency,
      isEnterprise: true,
      enterpriseThreshold
    };
  }

  let estimatedAmountCents: number | null = null;
  if (tiers.length > 0) {
    const tiersMode = toSafeString(plan.tiersMode, 40).toLowerCase() || 'graduated';
    if (tiersMode === 'volume') {
      const unit = typeof matchedTier?.unitAmountCents === 'number'
        ? matchedTier.unitAmountCents
        : centsFromStripeDecimal(matchedTier?.unitAmountDecimal);
      const flat = typeof matchedTier?.flatAmountCents === 'number'
        ? matchedTier.flatAmountCents
        : centsFromStripeDecimal(matchedTier?.flatAmountDecimal) || 0;
      estimatedAmountCents = typeof unit === 'number' ? unit * activePatients + flat : flat || null;
    } else {
      let total = 0;
      for (const tier of tiers) {
        const from = Math.max(1, Number(tier.from || 1));
        const to = tier.to === null ? activePatients : Number(tier.to || 0);
        const unitsInTier = Math.max(0, Math.min(activePatients, to) - from + 1);
        if (unitsInTier <= 0) continue;
        const unit = typeof tier.unitAmountCents === 'number' ? tier.unitAmountCents : centsFromStripeDecimal(tier.unitAmountDecimal) || 0;
        const flat = typeof tier.flatAmountCents === 'number' ? tier.flatAmountCents : centsFromStripeDecimal(tier.flatAmountDecimal) || 0;
        total += unitsInTier * unit + flat;
      }
      estimatedAmountCents = total > 0 ? total : null;
    }
  } else {
    const unit = typeof plan.unitAmountCents === 'number' ? plan.unitAmountCents : centsFromStripeDecimal(plan.unitAmountDecimal);
    if (plan.usesActivePatientQuantity && typeof unit === 'number') {
      estimatedAmountCents = unit * activePatients;
    } else if (typeof unit === 'number') {
      estimatedAmountCents = unit;
    }
  }

  return {
    priceId: plan.priceId,
    activePatients,
    matchedTier,
    estimatedAmountCents,
    currency: plan.currency,
    isEnterprise: false,
    enterpriseThreshold
  };
}

export async function listStripeActivePatientBillingPlans(params: {
  stripe: Stripe;
  activePatientPriceId?: string | null;
  allowedPriceIds?: string[];
}): Promise<SafeStripeBillingPlan[]> {
  const allowedPriceIds = parsePriceIdList((params.allowedPriceIds || []).join(','));
  const primaryPriceId = toSafeString(params.activePatientPriceId, 120);
  const pricesById = new Map<string, Stripe.Price>();

  let recurringPrices: Stripe.ApiList<Stripe.Price>;
  try {
    recurringPrices = await params.stripe.prices.list({
      active: true,
      type: 'recurring',
      limit: 100,
      expand: ['data.product', 'data.tiers']
    });
  } catch {
    recurringPrices = await params.stripe.prices.list({
      active: true,
      type: 'recurring',
      limit: 100,
      expand: ['data.product']
    });
  }

  for (const price of recurringPrices.data || []) {
    pricesById.set(price.id, price);
  }

  for (const priceId of [primaryPriceId, ...allowedPriceIds].filter(Boolean)) {
    if (pricesById.has(priceId)) continue;
    try {
      const price = await params.stripe.prices.retrieve(priceId, { expand: ['product', 'tiers'] });
      pricesById.set(price.id, price);
    } catch {
      try {
        const price = await params.stripe.prices.retrieve(priceId, { expand: ['product'] });
        pricesById.set(price.id, price);
      } catch {
        // A price configured in env may be unavailable in this Stripe account; ignore here and let checkout fail clearly.
      }
    }
  }

  const plans: SafeStripeBillingPlan[] = [];
  for (const price of pricesById.values()) {
    let resolvedPrice = price;
    let product = stripeProductFromPrice(resolvedPrice);
    if (!isActivePatientBillingPrice({ price: resolvedPrice, product, primaryPriceId, allowedPriceIds })) continue;
    if (resolvedPrice.billing_scheme === 'tiered' && !Array.isArray((resolvedPrice as any).tiers)) {
      try {
        resolvedPrice = await params.stripe.prices.retrieve(resolvedPrice.id, { expand: ['product', 'tiers'] });
        product = stripeProductFromPrice(resolvedPrice);
      } catch {
        try {
          resolvedPrice = await params.stripe.prices.retrieve(resolvedPrice.id, { expand: ['product'] });
          product = stripeProductFromPrice(resolvedPrice);
        } catch {
          // Keep the list response as fallback; checkout still uses Stripe's canonical price.
        }
      }
    }
    plans.push(buildSafeStripeBillingPlan({ price: resolvedPrice, product, primaryPriceId }));
  }

  console.info('[Stripe Billing Plans] diagnostics:', {
    stripeConfigured: true,
    pricesFound: pricesById.size,
    activeRecurringPrices: recurringPrices.data?.length || 0,
    tieredPricesFound: plans.filter((plan) => plan.billingScheme === 'tiered').length,
    returnedPlans: plans.length,
    firstPlanHasPriceId: Boolean(plans[0]?.priceId),
    firstPlanTierCount: plans[0]?.tiers?.length || 0
  });

  return plans.sort((a, b) => {
    if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
    const aLimit = a.maxPatients ?? Number.MAX_SAFE_INTEGER;
    const bLimit = b.maxPatients ?? Number.MAX_SAFE_INTEGER;
    if (aLimit !== bLimit) return aLimit - bLimit;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

function buildIdempotencyKey(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function estimateGraduatedActivePatientBilling(activePatients: number): {
  activePatients: number;
  planName: string;
  patientLimit: number | null;
  estimatedAmount: number;
  estimatedAmountCents: number;
  averageUnitPrice: number;
  requiresNegotiation: boolean;
  includedForEstimate: number;
  billingModel: typeof ACTIVE_PATIENT_BILLING_MODEL;
  stripeCalculatesFinalAmount: boolean;
} {
  const safePatients = Math.max(0, Math.floor(Number(activePatients || 0)));
  const estimate = calculateVertoPatientBasedMonthlyPrice(safePatients, DEFAULT_VERTO_PATIENT_PRICING_TIERS);

  return {
    activePatients: safePatients,
    planName: 'Pacientes ativos',
    patientLimit: estimate.appliedTier?.patientLimit || null,
    estimatedAmount: estimate.totalAmountCents / 100,
    estimatedAmountCents: estimate.totalAmountCents,
    averageUnitPrice: estimate.unitPriceCents / 100,
    requiresNegotiation: estimate.requiresCustomPricing,
    includedForEstimate: safePatients,
    billingModel: ACTIVE_PATIENT_BILLING_MODEL,
    stripeCalculatesFinalAmount: true
  };
}

export type VertoPricingTier = {
  patientLimit: number;
  fixedMonthlyPriceCents: number;
};

export type VertoPatientBasedMonthlyPrice = {
  activePatientCount: number;
  patientBasedBillingEnabled: boolean;
  pricingModel: 'patient_based_active_patients' | 'legacy';
  appliedTier: VertoPricingTier | null;
  unitPriceCents: number;
  totalAmountCents: number;
  nextMilestone: number | null;
  patientsUntilMilestone: number | null;
  milestonePriceCents: number | null;
  requiresCustomPricing: boolean;
};

export const DEFAULT_VERTO_PATIENT_PRICING_TIERS: VertoPricingTier[] = [
  { patientLimit: 5, fixedMonthlyPriceCents: 19700 },
  { patientLimit: 10, fixedMonthlyPriceCents: 29700 },
  { patientLimit: 20, fixedMonthlyPriceCents: 49700 },
  { patientLimit: 30, fixedMonthlyPriceCents: 69700 },
  { patientLimit: 40, fixedMonthlyPriceCents: 89700 },
  { patientLimit: 50, fixedMonthlyPriceCents: 109700 }
];

function normalizeVertoPricingTiers(tiers: VertoPricingTier[] = []): VertoPricingTier[] {
  return (Array.isArray(tiers) ? tiers : [])
    .map((tier) => ({
      patientLimit: Math.max(1, Math.floor(Number(tier?.patientLimit || 0))),
      fixedMonthlyPriceCents: Math.max(0, Math.round(Number(tier?.fixedMonthlyPriceCents || 0)))
    }))
    .filter((tier) => tier.patientLimit > 0 && tier.fixedMonthlyPriceCents > 0)
    .sort((a, b) => a.patientLimit - b.patientLimit);
}

export function isVertoPatientBasedBillingEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = toSafeString(value, 40).toLowerCase();
  return ['1', 'true', 'enabled', 'on', 'patient_based', 'patient_based_active_patients'].includes(normalized);
}

export function calculateVertoPatientBasedMonthlyPrice(
  activePatientCount: number,
  pricingTiers: VertoPricingTier[] = DEFAULT_VERTO_PATIENT_PRICING_TIERS
): VertoPatientBasedMonthlyPrice {
  const safeCount = Math.max(0, Math.floor(Number(activePatientCount || 0)));
  const tiers = normalizeVertoPricingTiers(pricingTiers);
  const appliedTier = tiers.find((tier) => tier.patientLimit >= Math.max(1, safeCount)) || null;
  if (!appliedTier) {
    return {
      activePatientCount: safeCount,
      patientBasedBillingEnabled: true,
      pricingModel: 'patient_based_active_patients',
      appliedTier: null,
      unitPriceCents: 0,
      totalAmountCents: 0,
      nextMilestone: null,
      patientsUntilMilestone: null,
      milestonePriceCents: null,
      requiresCustomPricing: safeCount > 0
    };
  }

  const unitPriceCents = Math.ceil((appliedTier.fixedMonthlyPriceCents / appliedTier.patientLimit) / 100) * 100;
  const totalAmountCents = safeCount === appliedTier.patientLimit
    ? appliedTier.fixedMonthlyPriceCents
    : safeCount * unitPriceCents;

  return {
    activePatientCount: safeCount,
    patientBasedBillingEnabled: true,
    pricingModel: 'patient_based_active_patients',
    appliedTier,
    unitPriceCents,
    totalAmountCents,
    nextMilestone: appliedTier.patientLimit,
    patientsUntilMilestone: Math.max(0, appliedTier.patientLimit - safeCount),
    milestonePriceCents: appliedTier.fixedMonthlyPriceCents,
    requiresCustomPricing: false
  };
}

export function previewVertoPatientBillingPrice(params: {
  activePatientCount: number;
  pricingTiers?: VertoPricingTier[];
  patientBasedBillingEnabled?: boolean | string | null;
  legacyMonthlyPriceCents?: number | null;
}): VertoPatientBasedMonthlyPrice {
  const enabled = isVertoPatientBasedBillingEnabled(params.patientBasedBillingEnabled);
  if (!enabled) {
    return {
      activePatientCount: Math.max(0, Math.floor(Number(params.activePatientCount || 0))),
      patientBasedBillingEnabled: false,
      pricingModel: 'legacy',
      appliedTier: null,
      unitPriceCents: 0,
      totalAmountCents: Math.max(0, Math.round(Number(params.legacyMonthlyPriceCents || 0))),
      nextMilestone: null,
      patientsUntilMilestone: null,
      milestonePriceCents: null,
      requiresCustomPricing: false
    };
  }
  return calculateVertoPatientBasedMonthlyPrice(params.activePatientCount, params.pricingTiers || DEFAULT_VERTO_PATIENT_PRICING_TIERS);
}

export function isVertoBillableActivePatientRecord(patient: any, organizationId?: string | null): boolean {
  if (!patient) return false;
  const scopedOrganizationId = toSafeString(organizationId, 120);
  if (scopedOrganizationId) {
    const patientOrganizationId = toSafeString(patient.organization_id || patient.organizationId || patient.clinic_id || patient.clinicId, 120);
    if (patientOrganizationId !== scopedOrganizationId) return false;
  }
  const status = toSafeString(patient.status || 'active', 80).toLowerCase();
  if (patient.is_active === false || patient.isActive === false) return false;
  if (patient.deleted_at || patient.deletedAt || patient.archived_at || patient.archivedAt || patient.unlinkedAt) return false;
  return !['inactive', 'inativo', 'deleted', 'archived', 'cancelled', 'canceled', 'unlinked'].includes(status);
}

export function countVertoBillableActivePatients(patients: any[] = [], organizationId?: string | null): number {
  return (Array.isArray(patients) ? patients : []).filter((patient) => isVertoBillableActivePatientRecord(patient, organizationId)).length;
}

function activePatientStatusFilter(): string {
  return `status.is.null,status.in.(${ACTIVE_PATIENT_STATUS_VALUES.join(',')})`;
}

function extractMissingColumnName(error: any): string | null {
  const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  const quoted = raw.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:does not exist|of relation|not found)/i);
  if (quoted?.[1]) return quoted[1];
  const cache = raw.match(/schema cache.*['"]([a-zA-Z0-9_]+)['"]/i);
  if (cache?.[1]) return cache[1];
  return null;
}

async function patchClinicBillingSafely(
  supabase: SupabaseClientLike,
  clinicId: string,
  patch: Record<string, any>
): Promise<void> {
  let safePatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  while (Object.keys(safePatch).length > 0) {
    const { error } = await supabase
      .from('clinics')
      .update(safePatch)
      .eq('id', clinicId);
    if (!error) return;
    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn || !(missingColumn in safePatch)) return;
    const { [missingColumn]: _removed, ...rest } = safePatch;
    safePatch = rest;
  }
}

async function getClinicDemoBillingState(
  supabase: SupabaseClientLike,
  clinicId: string
): Promise<{ isDemo: boolean; billingModel: string; subscriptionStatus: string }> {
  const safeClinicId = toSafeString(clinicId, 120);
  if (!safeClinicId) return { isDemo: false, billingModel: '', subscriptionStatus: '' };

  const run = (selectColumns: string) =>
    supabase
      .from('clinics')
      .select(selectColumns)
      .eq('id', safeClinicId)
      .limit(1);

  let result = await run('is_demo,billing_model,subscription_status');
  if (result.error && extractMissingColumnName(result.error)) {
    result = await run('subscription_status');
  }
  if (result.error) return { isDemo: false, billingModel: '', subscriptionStatus: '' };

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    isDemo: row?.is_demo === true || toSafeString(row?.billing_model, 40).toLowerCase() === 'demo',
    billingModel: toSafeString(row?.billing_model, 40).toLowerCase(),
    subscriptionStatus: toSafeString(row?.subscription_status, 40).toLowerCase()
  };
}

export async function getBillableActivePatientCount(params: {
  supabase: SupabaseClientLike;
  clinicId?: string | null;
  organizationId?: string | null;
}): Promise<number> {
  const clinicId = toSafeString(params.clinicId, 120);
  const organizationId = toSafeString(params.organizationId, 120);
  const scopeColumn = clinicId ? 'clinic_id' : 'organization_id';
  const scopeValue = clinicId || organizationId;
  if (!scopeValue) return 0;

  const runCount = async (includeArchivedAt: boolean) => {
    let query = params.supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq(scopeColumn, scopeValue)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(activePatientStatusFilter());

    if (includeArchivedAt) {
      query = query.is('archived_at', null);
    }

    return query;
  };

  let result = await runCount(true);
  if (result.error && extractMissingColumnName(result.error) === 'archived_at') {
    result = await runCount(false);
  }
  if (result.error) throw result.error;
  return Math.max(0, Number(result.count || 0));
}

async function getClinicActivePatientLimitState(
  supabase: SupabaseClientLike,
  clinicId: string
): Promise<{
  currentActivePatientLimit: number | null;
  currentActivePatientCount: number | null;
  pendingBillingQuantity: number | null;
  pendingBillingStatus: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionItemId: string | null;
}> {
  const safeClinicId = toSafeString(clinicId, 120);
  if (!safeClinicId) {
    return {
      currentActivePatientLimit: null,
      currentActivePatientCount: null,
      pendingBillingQuantity: null,
      pendingBillingStatus: null,
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null
    };
  }

  const run = (selectColumns: string) =>
    supabase
      .from('clinics')
      .select(selectColumns)
      .eq('id', safeClinicId)
      .limit(1);

  let result = await run(
    [
      'current_active_patient_limit',
      'current_active_patient_count',
      'pending_billing_quantity',
      'pending_billing_status',
      'stripe_subscription_id',
      'stripe_subscription_item_id'
    ].join(',')
  );
  if (result.error && extractMissingColumnName(result.error)) {
    result = await run('stripe_subscription_id,stripe_subscription_item_id,active_patient_count');
  }
  if (result.error) {
    return {
      currentActivePatientLimit: null,
      currentActivePatientCount: null,
      pendingBillingQuantity: null,
      pendingBillingStatus: null,
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null
    };
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const currentActivePatientLimit = toSafeInteger(row?.current_active_patient_limit);
  const activeCount = toSafeInteger(row?.current_active_patient_count ?? row?.active_patient_count);
  const pendingBillingQuantity = toSafeInteger(row?.pending_billing_quantity);
  const pendingBillingStatus = toSafeString(row?.pending_billing_status, 80) || null;
  return {
    currentActivePatientLimit,
    currentActivePatientCount: activeCount,
    pendingBillingQuantity,
    pendingBillingStatus,
    stripeSubscriptionId: toSafeString(row?.stripe_subscription_id, 200) || null,
    stripeSubscriptionItemId: toSafeString(row?.stripe_subscription_item_id, 200) || null
  };
}

function resolveSubscriptionItemByPriceId(subscription: Stripe.Subscription, priceId: string): Stripe.SubscriptionItem | null {
  return (
    subscription.items.data.find((item) => {
      const itemPriceId = toSafeString((item.price as any)?.id, 120);
      return itemPriceId === priceId;
    }) || null
  );
}

async function resolveClinicEmails(
  supabase: SupabaseClientLike,
  clinicId: string
): Promise<string[]> {
  const emails = new Set<string>();

  const { data: ownerRows } = await supabase
    .from('clinics')
    .select('owner_user_id')
    .eq('id', clinicId)
    .limit(1);

  const ownerUserId = toSafeString(ownerRows?.[0]?.owner_user_id, 120);
  if (ownerUserId) {
    const { data: ownerUser } = await supabase
      .from('users')
      .select('email')
      .eq('id', ownerUserId)
      .limit(1);
    const ownerEmail = toSafeString(ownerUser?.[0]?.email, 320).toLowerCase();
    if (ownerEmail) emails.add(ownerEmail);
  }

  const { data: coordinatorRows } = await supabase
    .from('users')
    .select('email')
    .eq('clinic_id', clinicId)
    .eq('role', 'coordinator')
    .limit(20);

  for (const row of coordinatorRows || []) {
    const email = toSafeString(row?.email, 320).toLowerCase();
    if (email) emails.add(email);
  }

  return Array.from(emails);
}

async function findSubscriptionForClinic(params: {
  stripe: Stripe;
  clinicId: string;
  clinicEmails: string[];
  logger: Pick<Console, 'warn'>;
}): Promise<Stripe.Subscription | null> {
  const { stripe, clinicId, clinicEmails, logger } = params;
  const eligibleStatuses: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due'];

  try {
    const searched = await stripe.subscriptions.search({
      query: `metadata['clinicId']:'${clinicId}' AND status:'active'`,
      limit: 1
    });
    if (searched.data?.[0]) return searched.data[0];
  } catch (error: any) {
    logger.warn('[Stripe Sync] subscriptions.search indisponível, seguindo fallback', {
      clinicId,
      message: error?.message || String(error)
    });
  }

  for (const email of clinicEmails) {
    const customers = await stripe.customers.list({ email, limit: 10 });
    for (const customer of customers.data || []) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 20
      });
      const selected =
        subscriptions.data.find((sub) => eligibleStatuses.includes(sub.status)) ||
        subscriptions.data[0] ||
        null;
      if (selected) return selected;
    }
  }

  return null;
}


type ModularCapacityBillingContract = {
  id: string;
  organizationId: string;
  salesOfferId: string;
  stripeSubscriptionId: string;
  stripeScheduleId: string | null;
  acceptedCapacityLimitPatients: number;
  initialCapacityBlocks: number;
  initialCapacityMonthlyCents: number;
  blockSizePatients: number;
  blockPriceCents: number;
  gracePeriodDays: number;
  billedAdditionalBlocks: number;
  lastActivePatientCount: number;
  overageStartedAt: string | null;
  graceExpiresAt: string | null;
  capacityProductId: string | null;
  capacitySubscriptionItemId: string | null;
  capacityPriceId: string | null;
  sourceSnapshot: Record<string, any>;
};

function isMissingBillingContractRelation(error: any): boolean {
  const code = toSafeString(error?.code, 20);
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return code === '42P01' || message.includes('organization_billing_contracts');
}

async function readModularCapacityBillingContract(
  supabase: SupabaseClientLike,
  clinicId: string
): Promise<ModularCapacityBillingContract | null> {
  const { data, error } = await supabase
    .from('organization_billing_contracts')
    .select([
      'id',
      'organization_id',
      'sales_offer_id',
      'stripe_subscription_id',
      'stripe_schedule_id',
      'accepted_capacity_limit_patients',
      'initial_capacity_blocks',
      'initial_capacity_monthly_cents',
      'block_size_patients',
      'block_price_cents',
      'grace_period_days',
      'billed_additional_blocks',
      'last_active_patient_count',
      'overage_started_at',
      'grace_expires_at',
      'capacity_product_id',
      'capacity_subscription_item_id',
      'capacity_price_id',
      'source_snapshot'
    ].join(','))
    .eq('organization_id', clinicId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    if (isMissingBillingContractRelation(error)) return null;
    throw error;
  }
  if (!data) return null;
  const acceptedCapacityLimitPatients = toSafeInteger(data.accepted_capacity_limit_patients);
  const blockSizePatients = toSafeInteger(data.block_size_patients);
  const blockPriceCents = toSafeInteger(data.block_price_cents);
  if (!acceptedCapacityLimitPatients || !blockSizePatients || blockPriceCents === null) {
    throw new Error('MODULAR_CAPACITY_CONTRACT_INVALID');
  }
  return {
    id: toSafeString(data.id, 120),
    organizationId: toSafeString(data.organization_id, 120),
    salesOfferId: toSafeString(data.sales_offer_id, 120),
    stripeSubscriptionId: toSafeString(data.stripe_subscription_id, 200),
    stripeScheduleId: toSafeString(data.stripe_schedule_id, 200) || null,
    acceptedCapacityLimitPatients,
    initialCapacityBlocks: toSafeInteger(data.initial_capacity_blocks) || 0,
    initialCapacityMonthlyCents: toSafeInteger(data.initial_capacity_monthly_cents) || 0,
    blockSizePatients,
    blockPriceCents,
    gracePeriodDays: toSafeInteger(data.grace_period_days) || 0,
    billedAdditionalBlocks: toSafeInteger(data.billed_additional_blocks) || 0,
    lastActivePatientCount: toSafeInteger(data.last_active_patient_count) || 0,
    overageStartedAt: toSafeString(data.overage_started_at, 80) || null,
    graceExpiresAt: toSafeString(data.grace_expires_at, 80) || null,
    capacityProductId: toSafeString(data.capacity_product_id, 200) || null,
    capacitySubscriptionItemId: toSafeString(data.capacity_subscription_item_id, 200) || null,
    capacityPriceId: toSafeString(data.capacity_price_id, 200) || null,
    sourceSnapshot:
      data.source_snapshot && typeof data.source_snapshot === 'object' && !Array.isArray(data.source_snapshot)
        ? data.source_snapshot
        : {}
  };
}

async function patchModularCapacityBillingContract(
  supabase: SupabaseClientLike,
  contractId: string,
  patch: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('organization_billing_contracts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', contractId);
  if (error) throw error;
}

type ContractCapacityPhase = {
  startsAt: string;
  endsAt: string | null;
  blockPriceCents: number;
  initialBlocksRevenueCents: number;
};

function resolveContractCapacityPhase(
  contract: ModularCapacityBillingContract,
  instantMs: number
): ContractCapacityPhase {
  const rawPhases = Array.isArray(contract.sourceSnapshot?.capacityBlockPhases)
    ? contract.sourceSnapshot.capacityBlockPhases
    : [];
  const phases = rawPhases
    .map((phase: any) => ({
      startsAt: toSafeString(phase?.startsAt, 80),
      endsAt: phase?.endsAt == null ? null : toSafeString(phase.endsAt, 80) || null,
      blockPriceCents: toSafeInteger(phase?.blockPriceCents),
      initialBlocksRevenueCents: toSafeInteger(phase?.blocksRevenueCents)
    }))
    .filter((phase: any) =>
      phase.startsAt
      && phase.blockPriceCents !== null
      && phase.initialBlocksRevenueCents !== null
      && Number.isFinite(Date.parse(phase.startsAt))
    ) as ContractCapacityPhase[];
  const match = phases.find((phase) => {
    const start = Date.parse(phase.startsAt);
    const end = phase.endsAt ? Date.parse(phase.endsAt) : Number.POSITIVE_INFINITY;
    return instantMs >= start && instantMs < end;
  });
  if (match) return match;
  const future = phases.find((phase) => instantMs < Date.parse(phase.startsAt));
  if (future) return future;
  if (phases.length > 0) return phases[phases.length - 1];
  return {
    startsAt: new Date(instantMs).toISOString(),
    endsAt: null,
    blockPriceCents: contract.blockPriceCents,
    initialBlocksRevenueCents: contract.initialCapacityMonthlyCents
  };
}

function stripePriceProductId(price: Stripe.Price | null | undefined): string {
  const product = (price as any)?.product;
  if (typeof product === 'string') return toSafeString(product, 200);
  return toSafeString(product?.id, 200);
}

function stripeProductMetadata(price: Stripe.Price | null | undefined): Record<string, string> {
  const product = (price as any)?.product;
  return product && typeof product === 'object' && !('deleted' in product)
    ? mergeSafeMetadata((product as Stripe.Product).metadata)
    : {};
}

function isCapacitySubscriptionItem(
  item: Stripe.SubscriptionItem,
  contract: ModularCapacityBillingContract
): boolean {
  const productId = stripePriceProductId(item.price as Stripe.Price);
  if (contract.capacityProductId && productId === contract.capacityProductId) return true;
  const metadata = stripeProductMetadata(item.price as Stripe.Price);
  return metadataValue(metadata, ['extension']).toLowerCase() === 'capacity_blocks';
}

async function ensureCapacityProduct(params: {
  stripe: Stripe;
  contract: ModularCapacityBillingContract;
  existingItem?: Stripe.SubscriptionItem | null;
}): Promise<string> {
  const existingProductId = params.existingItem
    ? stripePriceProductId(params.existingItem.price as Stripe.Price)
    : '';
  if (existingProductId) return existingProductId;
  if (params.contract.capacityProductId) return params.contract.capacityProductId;
  const product = await params.stripe.products.create(
    {
      name: 'Capacidade adicional — extensão Verto Clínica',
      metadata: {
        flowType: 'sales_modular_assisted',
        revenue_line: 'clinical_core',
        extension: 'capacity_blocks',
        offerId: params.contract.salesOfferId,
        billingModel: 'modular_capacity_v1'
      }
    },
    {
      idempotencyKey: buildIdempotencyKey(
        `modular-capacity-product:${params.contract.id}:${params.contract.salesOfferId}`
      )
    }
  );
  return toSafeString(product.id, 200);
}

async function createCapacityPrice(params: {
  stripe: Stripe;
  contract: ModularCapacityBillingContract;
  productId: string;
  amountCents: number;
  currency: string;
  phaseKey: string;
}): Promise<string> {
  const price = await params.stripe.prices.create(
    {
      currency: toSafeString(params.currency, 12).toLowerCase() || 'brl',
      unit_amount: Math.max(0, Math.floor(params.amountCents)),
      recurring: { interval: 'month' },
      product: params.productId,
      metadata: {
        flowType: 'sales_modular_assisted',
        revenue_line: 'clinical_core',
        extension: 'capacity_blocks',
        offerId: params.contract.salesOfferId,
        billingModel: 'modular_capacity_v1',
        phaseKey: toSafeString(params.phaseKey, 80)
      }
    },
    {
      idempotencyKey: buildIdempotencyKey(
        `modular-capacity-price:${params.contract.id}:${params.productId}:${params.phaseKey}:${Math.max(0, Math.floor(params.amountCents))}`
      )
    }
  );
  return toSafeString(price.id, 200);
}

function scheduleIdFromSubscription(subscription: Stripe.Subscription): string {
  const schedule = (subscription as any)?.schedule;
  if (typeof schedule === 'string') return toSafeString(schedule, 200);
  return toSafeString(schedule?.id, 200);
}

function stripeScheduleItemPriceId(item: any): string {
  const price = item?.price;
  if (typeof price === 'string') return toSafeString(price, 200);
  return toSafeString(price?.id, 200);
}

function stripeScheduleItemProductId(item: any): string {
  const price = item?.price;
  if (!price || typeof price !== 'object') return '';
  const product = price.product;
  if (typeof product === 'string') return toSafeString(product, 200);
  return toSafeString(product?.id, 200);
}

async function syncModularCapacityStripeAmount(params: {
  stripe: Stripe;
  contract: ModularCapacityBillingContract;
  subscription: Stripe.Subscription;
  targetAdditionalBlocks: number;
  idempotencyKey?: string | null;
}): Promise<{
  productId: string | null;
  subscriptionItemId: string | null;
  priceId: string | null;
  effectiveDate: string;
}> {
  const existingCapacityItem =
    params.subscription.items.data.find((item) => isCapacitySubscriptionItem(item, params.contract)) || null;
  const currentPhase = resolveContractCapacityPhase(params.contract, Date.now());
  const currentTargetAmount =
    currentPhase.initialBlocksRevenueCents
    + params.targetAdditionalBlocks * currentPhase.blockPriceCents;
  const currentPeriodEnd = Number((params.subscription as any)?.current_period_end || 0);
  const effectiveDate = currentPeriodEnd > 0
    ? new Date(currentPeriodEnd * 1000).toISOString()
    : new Date().toISOString();
  const scheduleId =
    params.contract.stripeScheduleId
    || scheduleIdFromSubscription(params.subscription);

  // A genuinely free capacity extension still updates the contract quantity but
  // does not need a Stripe item when there is no schedule. With a schedule, a
  // free current phase may become paid later, so future phases still need the
  // capacity line prepared now.
  if (currentTargetAmount <= 0 && !existingCapacityItem && !scheduleId) {
    return { productId: null, subscriptionItemId: null, priceId: null, effectiveDate };
  }

  const productId = await ensureCapacityProduct({
    stripe: params.stripe,
    contract: params.contract,
    existingItem: existingCapacityItem
  });
  const currency =
    toSafeString((existingCapacityItem?.price as any)?.currency, 12)
    || toSafeString((params.subscription.items.data[0]?.price as any)?.currency, 12)
    || 'brl';
  if (scheduleId) {
    const schedule = await params.stripe.subscriptionSchedules.retrieve(
      scheduleId,
      { expand: ['phases.items.price.product'] } as any
    );
    const scheduleStatus = toSafeString((schedule as any)?.status, 40).toLowerCase();
    if (!['completed', 'canceled', 'released'].includes(scheduleStatus)) {
      const stripePhases = await Promise.all(
        ((schedule as any).phases || []).map(async (phase: any, index: number) => {
          const phaseStartSeconds = Number(phase?.start_date || 0);
          const phaseInstantMs = phaseStartSeconds > 0
            ? phaseStartSeconds * 1000
            : Date.now();
          const contractPhase = resolveContractCapacityPhase(params.contract, phaseInstantMs);
          const targetAmount =
            contractPhase.initialBlocksRevenueCents
            + params.targetAdditionalBlocks * contractPhase.blockPriceCents;
          const phasePriceId = targetAmount > 0
            ? await createCapacityPrice({
                stripe: params.stripe,
                contract: params.contract,
                productId,
                amountCents: targetAmount,
                currency,
                phaseKey: String(index + 1)
              })
            : '';
          const items = (phase?.items || [])
            .filter((item: any) => {
              const itemProductId = stripeScheduleItemProductId(item);
              if (itemProductId && itemProductId === productId) return false;
              const itemPriceId = stripeScheduleItemPriceId(item);
              return !(
                params.contract.capacityPriceId
                && itemPriceId === params.contract.capacityPriceId
              );
            })
            .map((item: any) => ({
              price: stripeScheduleItemPriceId(item),
              quantity: Math.max(1, Number(item?.quantity || 1))
            }))
            .filter((item: any) => Boolean(item.price));
          if (targetAmount > 0 && phasePriceId) {
            items.push({ price: phasePriceId, quantity: 1 });
          }
          return {
            start_date: phase?.start_date,
            ...(phase?.end_date ? { end_date: phase.end_date } : {}),
            items,
            metadata: mergeSafeMetadata(phase?.metadata),
          };
        })
      );
      await params.stripe.subscriptionSchedules.update(
        scheduleId,
        {
          end_behavior: (schedule as any)?.end_behavior || 'release',
          phases: stripePhases,
          metadata: mergeSafeMetadata((schedule as any)?.metadata),
          proration_behavior: 'none'
        } as any,
        {
          idempotencyKey:
            toSafeString(params.idempotencyKey, 255)
            || buildIdempotencyKey(
              `modular-capacity-schedule:${params.contract.id}:${scheduleId}:${params.targetAdditionalBlocks}`
            )
        }
      );
      const refreshedSubscription = await params.stripe.subscriptions.retrieve(
        params.subscription.id,
        { expand: ['items.data.price.product'] } as any
      );
      const refreshedItem =
        refreshedSubscription.items.data.find((item) => {
          const itemProductId = stripePriceProductId(item.price as Stripe.Price);
          return itemProductId === productId;
        }) || null;
      return {
        productId,
        subscriptionItemId: toSafeString(refreshedItem?.id, 200) || null,
        priceId: toSafeString((refreshedItem?.price as any)?.id, 200) || null,
        effectiveDate
      };
    }
  }

  const currentPriceAmount = Number((existingCapacityItem?.price as any)?.unit_amount ?? -1);
  let currentPriceId = toSafeString((existingCapacityItem?.price as any)?.id, 200);
  let subscriptionItemId = toSafeString(existingCapacityItem?.id, 200);
  if (currentTargetAmount > 0 && currentPriceAmount !== currentTargetAmount) {
    currentPriceId = await createCapacityPrice({
      stripe: params.stripe,
      contract: params.contract,
      productId,
      amountCents: currentTargetAmount,
      currency,
      phaseKey: 'current'
    });
  }
  const idempotencyKey =
    toSafeString(params.idempotencyKey, 255)
    || buildIdempotencyKey(
      `modular-capacity-subscription:${params.contract.id}:${params.subscription.id}:${params.targetAdditionalBlocks}`
    );
  if (existingCapacityItem && currentTargetAmount > 0) {
    if (currentPriceId && currentPriceId !== toSafeString((existingCapacityItem.price as any)?.id, 200)) {
      await params.stripe.subscriptionItems.update(
        existingCapacityItem.id,
        { price: currentPriceId, quantity: 1, proration_behavior: 'none' } as any,
        { idempotencyKey }
      );
    }
  } else if (!existingCapacityItem && currentTargetAmount > 0) {
    const createdItem = await params.stripe.subscriptionItems.create(
      {
        subscription: params.subscription.id,
        price: currentPriceId,
        quantity: 1,
        proration_behavior: 'none'
      } as any,
      { idempotencyKey }
    );
    subscriptionItemId = toSafeString(createdItem?.id, 200);
  }
  return {
    productId,
    subscriptionItemId: subscriptionItemId || null,
    priceId: currentPriceId || null,
    effectiveDate
  };
}

async function syncModularCapacityBillingContract(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  contract: ModularCapacityBillingContract;
  clinicId: string;
  activePatients: number;
  trigger: string;
  idempotencyKey?: string | null;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<{
  success: boolean;
  activePatients: number;
  billableQuantity: number;
  synced: boolean;
  subscriptionId?: string;
  subscriptionItemId?: string;
  reason?: string;
}> {
  const { contract, activePatients } = params;
  if (!contract.stripeSubscriptionId) {
    return {
      success: false,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: false,
      reason: 'modular_subscription_missing'
    };
  }
  const subscription = await params.stripe.subscriptions.retrieve(
    contract.stripeSubscriptionId,
    { expand: ['items.data.price.product'] } as any
  );
  if (!['active', 'trialing', 'past_due'].includes(subscription.status)) {
    await patchModularCapacityBillingContract(params.supabase, contract.id, {
      last_active_patient_count: activePatients,
      last_capacity_sync_error: `subscription_status:${subscription.status}`
    });
    return {
      success: false,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: false,
      subscriptionId: subscription.id,
      reason: 'modular_subscription_not_billable'
    };
  }

  const effectiveLimit =
    contract.acceptedCapacityLimitPatients
    + contract.billedAdditionalBlocks * contract.blockSizePatients;
  const configuredAutomaticUpgradeMax = toSafeInteger(
    contract.sourceSnapshot?.automaticUpgradeMaxPatients
  );
  const automaticUpgradeMaxPatients =
    configuredAutomaticUpgradeMax &&
    configuredAutomaticUpgradeMax >= contract.acceptedCapacityLimitPatients
      ? configuredAutomaticUpgradeMax
      : contract.acceptedCapacityLimitPatients <= 50
        ? 50
        : contract.acceptedCapacityLimitPatients;
  if (activePatients > automaticUpgradeMaxPatients) {
    const standardAdditionalBlocks = Math.max(
      contract.billedAdditionalBlocks,
      Math.ceil(
        Math.max(
          automaticUpgradeMaxPatients - contract.acceptedCapacityLimitPatients,
          0
        ) / contract.blockSizePatients
      )
    );
    let stripeSync: Awaited<ReturnType<typeof syncModularCapacityStripeAmount>> | null = null;
    if (standardAdditionalBlocks > contract.billedAdditionalBlocks) {
      stripeSync = await syncModularCapacityStripeAmount({
        stripe: params.stripe,
        contract,
        subscription,
        targetAdditionalBlocks: standardAdditionalBlocks,
        idempotencyKey: params.idempotencyKey
      });
    }
    const nowIso = new Date().toISOString();
    const effectiveStandardLimit =
      contract.acceptedCapacityLimitPatients
      + standardAdditionalBlocks * contract.blockSizePatients;
    await patchModularCapacityBillingContract(params.supabase, contract.id, {
      billed_additional_blocks: standardAdditionalBlocks,
      last_active_patient_count: activePatients,
      overage_started_at: null,
      grace_expires_at: null,
      last_capacity_sync_error: null,
      ...(stripeSync
        ? {
            last_capacity_sync_at: nowIso,
            capacity_product_id: stripeSync.productId,
            capacity_subscription_item_id: stripeSync.subscriptionItemId,
            capacity_price_id: stripeSync.priceId,
            stripe_schedule_id:
              contract.stripeScheduleId || scheduleIdFromSubscription(subscription) || null
          }
        : {})
    });
    await patchClinicBillingSafely(params.supabase, params.clinicId, {
      stripe_customer_id: toSafeString(String(subscription.customer || ''), 200) || undefined,
      stripe_subscription_id: subscription.id,
      ...(stripeSync?.subscriptionItemId
        ? { stripe_subscription_item_id: stripeSync.subscriptionItemId }
        : {}),
      ...(stripeSync?.priceId ? { stripe_price_id: stripeSync.priceId } : {}),
      subscription_status: subscription.status,
      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
      active_patient_count: activePatients,
      current_active_patient_count: activePatients,
      current_active_patient_limit: effectiveStandardLimit,
      pending_billing_quantity: standardAdditionalBlocks,
      pending_billing_status: 'enterprise_review_required',
      ...(stripeSync?.effectiveDate
        ? { pending_effective_date: stripeSync.effectiveDate }
        : {}),
      billing_sync_status: 'enterprise_review_required',
      billing_sync_error: null,
      last_billing_sync_at: nowIso,
      updated_at: nowIso
    });
    params.logger.warn('[Stripe Sync] Limite de upgrade automático atingido; revisão Enterprise necessária.', {
      clinicId: params.clinicId,
      subscriptionId: subscription.id,
      activePatients,
      automaticUpgradeMaxPatients,
      effectiveStandardLimit,
      trigger: params.trigger
    });
    return {
      success: true,
      activePatients,
      billableQuantity: standardAdditionalBlocks,
      synced: true,
      subscriptionId: subscription.id,
      subscriptionItemId:
        stripeSync?.subscriptionItemId || contract.capacitySubscriptionItemId || undefined,
      reason: 'enterprise_review_required'
    };
  }
  if (activePatients <= effectiveLimit) {
    await patchModularCapacityBillingContract(params.supabase, contract.id, {
      last_active_patient_count: activePatients,
      overage_started_at: null,
      grace_expires_at: null,
      last_capacity_sync_error: null
    });
    await patchClinicBillingSafely(params.supabase, params.clinicId, {
      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
      stripe_subscription_id: subscription.id,
      active_patient_count: activePatients,
      current_active_patient_count: activePatients,
      current_active_patient_limit: effectiveLimit,
      billing_sync_status: 'within_contracted_capacity',
      billing_sync_error: null,
      last_billing_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return {
      success: true,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: true,
      subscriptionId: subscription.id,
      subscriptionItemId: contract.capacitySubscriptionItemId || undefined,
      reason: 'within_contracted_capacity'
    };
  }

  const requiredAdditionalBlocks = Math.max(
    contract.billedAdditionalBlocks,
    Math.ceil(
      Math.max(activePatients - contract.acceptedCapacityLimitPatients, 0)
      / contract.blockSizePatients
    )
  );
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const storedGraceExpiresMs = contract.graceExpiresAt
    ? Date.parse(contract.graceExpiresAt)
    : NaN;
  const graceActive = Number.isFinite(storedGraceExpiresMs) && nowMs < storedGraceExpiresMs;

  if (contract.gracePeriodDays > 0 && !contract.overageStartedAt) {
    const graceExpiresAt = new Date(
      nowMs + contract.gracePeriodDays * 24 * 60 * 60 * 1000
    ).toISOString();
    await patchModularCapacityBillingContract(params.supabase, contract.id, {
      last_active_patient_count: activePatients,
      overage_started_at: nowIso,
      grace_expires_at: graceExpiresAt,
      last_capacity_sync_error: null
    });
    await patchClinicBillingSafely(params.supabase, params.clinicId, {
      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
      active_patient_count: activePatients,
      current_active_patient_count: activePatients,
      current_active_patient_limit: effectiveLimit,
      billing_sync_status: 'capacity_grace_period',
      billing_sync_error: null,
      last_billing_sync_at: nowIso,
      updated_at: nowIso
    });
    return {
      success: true,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: true,
      subscriptionId: subscription.id,
      subscriptionItemId: contract.capacitySubscriptionItemId || undefined,
      reason: 'capacity_grace_started'
    };
  }

  if (graceActive) {
    await patchModularCapacityBillingContract(params.supabase, contract.id, {
      last_active_patient_count: activePatients,
      last_capacity_sync_error: null
    });
    return {
      success: true,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: true,
      subscriptionId: subscription.id,
      subscriptionItemId: contract.capacitySubscriptionItemId || undefined,
      reason: 'capacity_grace_pending'
    };
  }

  if (requiredAdditionalBlocks <= contract.billedAdditionalBlocks) {
    return {
      success: true,
      activePatients,
      billableQuantity: contract.billedAdditionalBlocks,
      synced: true,
      subscriptionId: subscription.id,
      subscriptionItemId: contract.capacitySubscriptionItemId || undefined,
      reason: 'capacity_already_billed'
    };
  }

  const stripeSync = await syncModularCapacityStripeAmount({
    stripe: params.stripe,
    contract,
    subscription,
    targetAdditionalBlocks: requiredAdditionalBlocks,
    idempotencyKey: params.idempotencyKey
  });
  const newEffectiveLimit =
    contract.acceptedCapacityLimitPatients
    + requiredAdditionalBlocks * contract.blockSizePatients;
  await patchModularCapacityBillingContract(params.supabase, contract.id, {
    billed_additional_blocks: requiredAdditionalBlocks,
    last_active_patient_count: activePatients,
    overage_started_at: null,
    grace_expires_at: null,
    last_capacity_sync_at: nowIso,
    last_capacity_sync_error: null,
    capacity_product_id: stripeSync.productId,
    capacity_subscription_item_id: stripeSync.subscriptionItemId,
    capacity_price_id: stripeSync.priceId,
    stripe_schedule_id:
      contract.stripeScheduleId || scheduleIdFromSubscription(subscription) || null
  });
  await patchClinicBillingSafely(params.supabase, params.clinicId, {
    stripe_customer_id: toSafeString(String(subscription.customer || ''), 200) || undefined,
    stripe_subscription_id: subscription.id,
    stripe_subscription_item_id: stripeSync.subscriptionItemId || undefined,
    stripe_price_id: stripeSync.priceId || undefined,
    subscription_status: subscription.status,
    billing_model: ACTIVE_PATIENT_BILLING_MODEL,
    active_patient_count: activePatients,
    current_active_patient_count: activePatients,
    current_active_patient_limit: newEffectiveLimit,
    pending_billing_quantity: requiredAdditionalBlocks,
    pending_billing_status: 'scheduled_next_cycle',
    pending_effective_date: stripeSync.effectiveDate,
    billing_sync_status: 'capacity_blocks_synced',
    billing_sync_error: null,
    last_billing_sync_at: nowIso,
    updated_at: nowIso
  });
  params.logger.log('[Stripe Sync] Capacidade modular sincronizada.', {
    clinicId: params.clinicId,
    subscriptionId: subscription.id,
    activePatients,
    acceptedCapacityLimitPatients: contract.acceptedCapacityLimitPatients,
    previousAdditionalBlocks: contract.billedAdditionalBlocks,
    additionalBlocks: requiredAdditionalBlocks,
    effectiveLimit: newEffectiveLimit,
    trigger: params.trigger
  });
  return {
    success: true,
    activePatients,
    billableQuantity: requiredAdditionalBlocks,
    subscriptionId: subscription.id,
    subscriptionItemId: stripeSync.subscriptionItemId || undefined,
    synced: true,
    reason: 'capacity_blocks_synced'
  };
}

export async function syncClinicActivePatientAddonQuantity(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  clinicId: string;
  trigger: string;
  activePatientPriceId: string;
  requestedBillingQuantity?: number | null;
  idempotencyKey?: string | null;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<{
  success: boolean;
  activePatients: number;
  billableQuantity: number;
  synced: boolean;
  subscriptionId?: string;
  subscriptionItemId?: string;
  reason?: string;
}> {
  const logger = params.logger || console;
  const clinicId = toSafeString(params.clinicId, 120);
  const priceId = toSafeString(params.activePatientPriceId, 120);
  if (!clinicId) {
    return { success: false, activePatients: 0, billableQuantity: 1, synced: false, reason: 'clinic_id ausente' };
  }

  const demoState = await getClinicDemoBillingState(params.supabase, clinicId);
  if (demoState.isDemo) {
    logger.log('[Stripe Sync] Clínica demo sem cobrança real. Sync ignorado.', { clinicId });
    return { success: true, activePatients: 0, billableQuantity: 1, synced: false, reason: 'demo_billing_disabled' };
  }

  const activePatients = await getBillableActivePatientCount({ supabase: params.supabase, clinicId });
  const modularContract = await readModularCapacityBillingContract(params.supabase, clinicId);
  if (modularContract) {
    return await syncModularCapacityBillingContract({
      supabase: params.supabase,
      stripe: params.stripe,
      contract: modularContract,
      clinicId,
      activePatients,
      trigger: params.trigger,
      idempotencyKey: params.idempotencyKey,
      logger
    });
  }

  // Legacy contracts still use the global active-patient Price. New modular
  // capacity contracts above are intentionally independent from this setting.
  if (!priceId) {
    logger.warn('[Stripe Sync] Price legado de pacientes ativos ausente.', { clinicId });
    return { success: false, activePatients, billableQuantity: activePatients, synced: false, reason: 'price_id_ausente' };
  }

  const requestedBillingQuantity = toSafeInteger(params.requestedBillingQuantity);
  // The add-on mirrors the canonical active-patient count. A zero quantity keeps
  // the base subscription intact while removing the patient add-on for next cycle.
  const billableQuantity = requestedBillingQuantity ?? activePatients;

  const clinicEmails = await resolveClinicEmails(params.supabase, clinicId);
  const subscription = await findSubscriptionForClinic({
    stripe: params.stripe,
    clinicId,
    clinicEmails,
    logger
  });

  if (!subscription) {
    logger.warn('[Stripe Sync] Assinatura não encontrada para clínica.', { clinicId, activePatients });
    await patchClinicBillingSafely(params.supabase, clinicId, {
      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
      stripe_price_id: priceId,
      active_patient_count: activePatients,
      billing_sync_status: 'subscription_not_found',
      billing_sync_error: 'Assinatura Stripe nao encontrada para a clinica.',
      last_billing_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return { success: true, activePatients, billableQuantity, synced: false, reason: 'subscription_not_found' };
  }

  const item = resolveSubscriptionItemByPriceId(subscription, priceId);
  const idempotencySeed = `${clinicId}:${subscription.id}:${priceId}:${billableQuantity}:${params.trigger}`;
  const idempotencyKey = toSafeString(params.idempotencyKey, 255) || buildIdempotencyKey(idempotencySeed);
  let subscriptionItemId = toSafeString(item?.id, 120);

  if (item) {
    await params.stripe.subscriptionItems.update(
      item.id,
      { quantity: billableQuantity, proration_behavior: 'none' } as any,
      { idempotencyKey }
    );
  } else if (billableQuantity > 0) {
    const createdItem = await params.stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: priceId,
        quantity: billableQuantity,
        proration_behavior: 'none'
      } as any,
      { idempotencyKey }
    );
    subscriptionItemId = toSafeString(createdItem?.id, 120);
  }

  await patchClinicBillingSafely(params.supabase, clinicId, {
    stripe_customer_id: toSafeString(String(subscription.customer || ''), 200) || undefined,
      stripe_subscription_id: subscription.id,
      stripe_subscription_item_id: subscriptionItemId || undefined,
      stripe_price_id: priceId,
      subscription_status: subscription.status,
      billing_model: ACTIVE_PATIENT_BILLING_MODEL,
      active_patient_count: activePatients,
      current_active_patient_count: activePatients,
      current_active_patient_limit: billableQuantity,
      pending_billing_quantity: billableQuantity,
      pending_billing_status: 'scheduled_next_cycle',
      pending_effective_date: new Date().toISOString(),
      billing_sync_status: 'synced',
      billing_sync_error: null,
      last_billing_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

  logger.log('[Stripe Sync] Quantidade de pacientes ativos sincronizada.', {
    clinicId,
    subscriptionId: subscription.id,
    subscriptionItemId,
    activePatients,
    billableQuantity,
    trigger: params.trigger
  });

  return { success: true, activePatients, billableQuantity, subscriptionId: subscription.id, subscriptionItemId, synced: true };
}

export async function reportClinicActivePatientUsage(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  clinicId: string;
  activePatientPriceId: string;
  trigger: string;
  allowOverNegotiationLimit?: boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<{
  success: boolean;
  clinicId: string;
  activePatients: number;
  subscriptionId?: string;
  subscriptionItemId?: string;
  reported: boolean;
  reason?: string;
}> {
  void params.allowOverNegotiationLimit;
  const logger = params.logger || console;
  const clinicId = toSafeString(params.clinicId, 120);
  const priceId = toSafeString(params.activePatientPriceId, 120);
  if (!clinicId || !priceId) {
    return { success: false, clinicId, activePatients: 0, reported: false, reason: 'clinic_or_price_missing' };
  }

  const syncResult = await syncClinicActivePatientAddonQuantity({
    supabase: params.supabase,
    stripe: params.stripe,
    clinicId,
    trigger: params.trigger,
    activePatientPriceId: priceId,
    logger
  });

  logger.log('[Stripe Sync] Rota legada report-usage confirmou a quantidade silenciosamente.', {
    clinicId,
    subscriptionId: syncResult.subscriptionId,
    subscriptionItemId: syncResult.subscriptionItemId,
    activePatients: syncResult.activePatients,
    billableQuantity: syncResult.billableQuantity,
    trigger: params.trigger
  });

  return {
    success: syncResult.success,
    clinicId,
    activePatients: syncResult.activePatients,
    subscriptionId: syncResult.subscriptionId,
    subscriptionItemId: syncResult.subscriptionItemId,
    reported: syncResult.synced,
    reason: syncResult.reason
  };
}

export async function reportAllClinicsActivePatientUsage(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  activePatientPriceId: string;
  trigger: string;
  allowOverNegotiationLimit?: boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<Array<Awaited<ReturnType<typeof reportClinicActivePatientUsage>>>> {
  const logger = params.logger || console;
  let clinicsResult = await params.supabase
    .from('clinics')
    .select('id,subscription_status,stripe_subscription_id,stripe_subscription_item_id,is_demo,billing_model')
    .in('subscription_status', ['active', 'trialing', 'past_due', 'delinquent'])
    .limit(10000);

  if (clinicsResult.error && extractMissingColumnName(clinicsResult.error)) {
    clinicsResult = await params.supabase
      .from('clinics')
      .select('id,subscription_status,stripe_subscription_id,stripe_subscription_item_id')
      .in('subscription_status', ['active', 'trialing', 'past_due', 'delinquent'])
      .limit(10000);
  }

  if (clinicsResult.error) {
    throw clinicsResult.error;
  }

  const results: Array<Awaited<ReturnType<typeof reportClinicActivePatientUsage>>> = [];
  for (const clinic of clinicsResult.data || []) {
    const clinicId = toSafeString((clinic as any)?.id, 120);
    if (!clinicId) continue;
    const isDemo = (clinic as any)?.is_demo === true || toSafeString((clinic as any)?.billing_model, 40).toLowerCase() === 'demo';
    if (isDemo) {
      results.push({ success: true, clinicId, activePatients: 0, reported: false, reason: 'demo_billing_disabled' });
      continue;
    }
    try {
      results.push(await reportClinicActivePatientUsage({
        supabase: params.supabase,
        stripe: params.stripe,
        clinicId,
        activePatientPriceId: params.activePatientPriceId,
        trigger: params.trigger,
        allowOverNegotiationLimit: params.allowOverNegotiationLimit,
        logger
      }));
    } catch (error: any) {
      logger.error('[Stripe Sync] Falha ao sincronizar quantidade de pacientes ativos da clínica.', {
        clinicId,
        message: error?.message || String(error)
      });
      results.push({ success: false, clinicId, activePatients: 0, reported: false, reason: error?.message || String(error) });
    }
  }
  return results;
}

export async function createClinicMeteredSubscription(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  clinicId: string;
  coordinatorUserId: string;
  email: string;
  clinicName: string;
  activePatientPriceId: string;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<{ customerId: string; subscriptionId: string; subscriptionItemId: string; status: string } | null> {
  const logger = params.logger || console;
  const clinicId = toSafeString(params.clinicId, 120);
  const coordinatorUserId = toSafeString(params.coordinatorUserId, 120);
  const email = toSafeString(params.email, 320).toLowerCase();
  const clinicName = toSafeString(params.clinicName, 180) || 'Clínica Verto';
  const priceId = toSafeString(params.activePatientPriceId, 120);
  if (!clinicId || !email || !priceId) return null;

  const demoState = await getClinicDemoBillingState(params.supabase, clinicId);
  if (demoState.isDemo) {
    logger.warn('[Stripe Sync] Assinatura Stripe não criada para clínica demo.', { clinicId });
    return null;
  }

  const { data: clinicRows } = await params.supabase
    .from('clinics')
    .select('stripe_customer_id,stripe_subscription_id,stripe_subscription_item_id')
    .eq('id', clinicId)
    .limit(1);
  const existingSubscriptionId = toSafeString(clinicRows?.[0]?.stripe_subscription_id, 120);
  const existingItemId = toSafeString(clinicRows?.[0]?.stripe_subscription_item_id, 120);
  if (existingSubscriptionId && existingItemId) {
    return {
      customerId: toSafeString(clinicRows?.[0]?.stripe_customer_id, 200),
      subscriptionId: existingSubscriptionId,
      subscriptionItemId: existingItemId,
      status: 'existing'
    };
  }

  let customerId = toSafeString(clinicRows?.[0]?.stripe_customer_id, 200);
  if (!customerId) {
    const customer = await params.stripe.customers.create({
      email,
      name: clinicName,
      metadata: {
        clinicId,
        userId: coordinatorUserId,
        billingModel: ACTIVE_PATIENT_BILLING_MODEL
      }
    });
    customerId = customer.id;
  }

  const activePatients = await getBillableActivePatientCount({ supabase: params.supabase, clinicId });
  const billableQuantity = Math.max(1, activePatients);
  const subscription = await params.stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId, quantity: billableQuantity }],
    payment_behavior: 'default_incomplete',
    collection_method: 'charge_automatically',
    metadata: {
      clinicId,
      userId: coordinatorUserId,
      billingModel: ACTIVE_PATIENT_BILLING_MODEL
    },
    expand: ['items.data.price', 'latest_invoice']
  } as any);

  const item = resolveSubscriptionItemByPriceId(subscription, priceId) || subscription.items.data[0] || null;
  const subscriptionItemId = toSafeString(item?.id, 120);
  if (!subscriptionItemId) {
    logger.warn('[Stripe Billing] Subscription criada sem item mensurável identificado.', {
      clinicId,
      subscriptionId: subscription.id
    });
  }

  return {
    customerId,
    subscriptionId: subscription.id,
    subscriptionItemId,
    status: subscription.status
  };
}

export async function syncAllClinicsActivePatientAddonQuantity(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  activePatientPriceId: string;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<void> {
  const logger = params.logger || console;
  let clinics: string[] = [];

  const clinicsResult = await params.supabase
    .from('clinics')
    .select('id')
    .limit(10000);

  if (!clinicsResult.error) {
    clinics = (clinicsResult.data || [])
      .map((row: any) => toSafeString(row?.id, 120))
      .filter(Boolean);
  } else {
    logger.warn('[Stripe Sync] Fallback para users.clinic_id no batch diário.', {
      message: clinicsResult.error?.message || String(clinicsResult.error)
    });
    const usersResult = await params.supabase
      .from('users')
      .select('clinic_id')
      .not('clinic_id', 'is', null)
      .limit(10000);
    clinics = Array.from(
      new Set(
        (usersResult.data || [])
          .map((row: any) => toSafeString(row?.clinic_id, 120))
          .filter(Boolean)
      )
    );
  }

  for (const clinicId of clinics) {
    try {
      await syncClinicActivePatientAddonQuantity({
        supabase: params.supabase,
        stripe: params.stripe,
        clinicId,
        trigger: 'daily_batch',
        activePatientPriceId: params.activePatientPriceId,
        logger
      });
    } catch (error: any) {
      logger.error('[CRITICAL] Falha no sync diário de pacientes ativos (não bloqueante).', {
        clinicId,
        message: error?.message || String(error)
      });
    }
  }
}

export async function getClinicBillingSummary(params: {
  supabase: SupabaseClientLike;
  clinicId: string;
}): Promise<{
  activePatients: number;
  planName: string;
  patientLimit: number | null;
  unitPrice: number;
  additionalCost: number;
  estimatedAmount: number;
  estimatedAmountCents: number;
  averageUnitPrice: number;
  requiresNegotiation: boolean;
  includedForEstimate: number;
  tiers: typeof ACTIVE_PATIENT_BILLING_TIERS;
  billingModel: typeof ACTIVE_PATIENT_BILLING_MODEL;
  stripeCalculatesFinalAmount: boolean;
}> {
  const activePatients = await getBillableActivePatientCount({ supabase: params.supabase, clinicId: params.clinicId });
  const estimate = estimateGraduatedActivePatientBilling(activePatients);
  return {
    activePatients,
    planName: estimate.planName,
    patientLimit: estimate.patientLimit,
    unitPrice: estimate.averageUnitPrice,
    additionalCost: estimate.estimatedAmount,
    estimatedAmount: estimate.estimatedAmount,
    estimatedAmountCents: estimate.estimatedAmountCents,
    averageUnitPrice: estimate.averageUnitPrice,
    requiresNegotiation: estimate.requiresNegotiation,
    includedForEstimate: estimate.includedForEstimate,
    tiers: ACTIVE_PATIENT_BILLING_TIERS,
    billingModel: estimate.billingModel,
    stripeCalculatesFinalAmount: estimate.stripeCalculatesFinalAmount
  };
}
