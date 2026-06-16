import crypto from 'crypto';
import type Stripe from 'stripe';

type SupabaseClientLike = any;

export const ACTIVE_PATIENT_BILLING_MODEL = 'active_patients' as const;
export const ACTIVE_PATIENT_BILLING_TIERS: Array<never> = [];

export type SafeStripeBillingTier = {
  from: number;
  to: number | null;
  upTo: number | null;
  unitAmountCents: number | null;
  flatAmountCents: number | null;
  unitAmountDecimal: string | null;
  flatAmountDecimal: string | null;
};

export type SafeStripeBillingPlan = {
  productId: string;
  priceId: string;
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
  const visible = metadataValue(metadata, ['verto_visible', 'onboarding_visible', 'visible']).toLowerCase();
  const audience = metadataValue(metadata, ['audience', 'plan_audience', 'verto_audience']).toLowerCase();
  return billingModel === ACTIVE_PATIENT_BILLING_MODEL || visible === 'true' || audience === 'clinic';
}

function buildSafeStripeBillingPlan(params: {
  price: Stripe.Price;
  product: Stripe.Product | null;
  primaryPriceId?: string | null;
}): SafeStripeBillingPlan {
  const { price, product } = params;
  const metadata = mergeSafeMetadata(product?.metadata, price.metadata);
  const priceId = toSafeString(price.id, 120);
  const billingScheme = toSafeString(price.billing_scheme, 40) || 'per_unit';
  const tiersMode = toSafeString((price as any).tiers_mode, 40) || null;
  const usageType = toSafeString(price.recurring?.usage_type, 40) || null;
  const minPatients = toSafeInteger(metadataValue(metadata, ['min_patients', 'minimum_patients', 'patient_min']));
  const maxPatients =
    toSafeInteger(metadataValue(metadata, ['max_patients', 'patient_limit', 'active_patient_limit', 'limit_patients'])) ||
    null;
  const enterpriseThreshold =
    toSafeInteger(metadataValue(metadata, ['enterprise_threshold', 'enterprise_from', 'custom_threshold', 'custom_from_patients'])) ||
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
    enterpriseThreshold
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

  return {
    activePatients: safePatients,
    planName: 'Pacientes ativos',
    patientLimit: null,
    estimatedAmount: 0,
    estimatedAmountCents: 0,
    averageUnitPrice: 0,
    requiresNegotiation: false,
    includedForEstimate: safePatients,
    billingModel: ACTIVE_PATIENT_BILLING_MODEL,
    stripeCalculatesFinalAmount: true
  };
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

export async function syncClinicActivePatientAddonQuantity(params: {
  supabase: SupabaseClientLike;
  stripe: Stripe;
  clinicId: string;
  trigger: string;
  activePatientPriceId: string;
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
  if (!priceId) {
    logger.warn('[Stripe Sync] STRIPE_ACTIVE_PATIENT_PRICE_ID ausente. Sincronização ignorada.', { clinicId });
    return { success: true, activePatients: 0, billableQuantity: 1, synced: false, reason: 'price_id_ausente' };
  }

  const demoState = await getClinicDemoBillingState(params.supabase, clinicId);
  if (demoState.isDemo) {
    logger.log('[Stripe Sync] Clínica demo sem cobrança real. Sync ignorado.', { clinicId });
    return { success: true, activePatients: 0, billableQuantity: 1, synced: false, reason: 'demo_billing_disabled' };
  }

  const activePatients = await getBillableActivePatientCount({ supabase: params.supabase, clinicId });
  const billableQuantity = Math.max(1, activePatients);
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
  const idempotencySeed = `${clinicId}:${subscription.id}:${priceId}:${billableQuantity}:${params.trigger}:${new Date().toISOString().slice(0, 13)}`;
  const idempotencyKey = buildIdempotencyKey(idempotencySeed);
  let subscriptionItemId = toSafeString(item?.id, 120);

  if (item) {
    await params.stripe.subscriptionItems.update(
      item.id,
      { quantity: billableQuantity, proration_behavior: 'none' } as any,
      { idempotencyKey }
    );
  } else {
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

  logger.log('[Stripe Sync] Rota legada report-usage encaminhada para sync de quantity.', {
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
