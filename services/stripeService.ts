import crypto from 'crypto';
import type Stripe from 'stripe';

type SupabaseClientLike = any;

export const ACTIVE_PATIENT_BILLING_MODEL = 'active_patients' as const;
export const ACTIVE_PATIENT_BILLING_TIERS: Array<never> = [];

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
  const clinicsResult = await params.supabase
    .from('clinics')
    .select('id,subscription_status,stripe_subscription_id,stripe_subscription_item_id')
    .in('subscription_status', ['active', 'trialing', 'past_due', 'delinquent'])
    .limit(10000);

  if (clinicsResult.error) {
    throw clinicsResult.error;
  }

  const results: Array<Awaited<ReturnType<typeof reportClinicActivePatientUsage>>> = [];
  for (const clinic of clinicsResult.data || []) {
    const clinicId = toSafeString((clinic as any)?.id, 120);
    if (!clinicId) continue;
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
