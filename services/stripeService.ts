import crypto from 'crypto';
import type Stripe from 'stripe';

type SupabaseClientLike = any;

export const ACTIVE_PATIENT_BILLING_TIERS = [
  { name: 'Verto Start', upTo: 5, amount: 49900 },
  { name: 'Verto Essencial', upTo: 10, amount: 89900 },
  { name: 'Verto Growth', upTo: 20, amount: 159900 },
  { name: 'Verto Clinic 50', upTo: 50, amount: 349900 },
  { name: 'Verto Clinic 100', upTo: 100, amount: 599900 },
  { name: 'Verto Clinic 150', upTo: 150, amount: 824900 },
  { name: 'Verto Clinic 200', upTo: 200, amount: 999900 },
  { name: 'Verto Clinic 299', upTo: 299, amount: 1349900 }
] as const;

const ACTIVE_PATIENT_NEGOTIATION_THRESHOLD = 299;
const ACTIVE_PATIENT_STATUSES = new Set([
  'active',
  'ativo',
  'atendimento_ativo',
  'em_tratamento'
]);

function toSafeString(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function normalizeStatus(status: unknown): string {
  return toSafeString(status, 60)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function isActivePatientStatus(status: unknown): boolean {
  if (!status) return true;
  return ACTIVE_PATIENT_STATUSES.has(normalizeStatus(status));
}

function buildIdempotencyKey(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function formatBillingPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function resolveMeterEventName(): string {
  return toSafeString(process.env.STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME || 'verto_active_patients_monthly', 100);
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
} {
  const safePatients = Math.max(0, Math.floor(Number(activePatients || 0)));
  const requiresNegotiation = safePatients > ACTIVE_PATIENT_NEGOTIATION_THRESHOLD;
  const billablePatients = Math.min(Math.max(1, safePatients), ACTIVE_PATIENT_NEGOTIATION_THRESHOLD);
  const selectedTier = ACTIVE_PATIENT_BILLING_TIERS.find((tier) => billablePatients <= tier.upTo);
  const totalCents = selectedTier?.amount || 0;

  return {
    activePatients: safePatients,
    planName: selectedTier?.name || 'Verto Enterprise',
    patientLimit: selectedTier?.upTo || null,
    estimatedAmount: Number((totalCents / 100).toFixed(2)),
    estimatedAmountCents: totalCents,
    averageUnitPrice: billablePatients ? Number((totalCents / billablePatients / 100).toFixed(2)) : 0,
    requiresNegotiation,
    includedForEstimate: selectedTier?.upTo || ACTIVE_PATIENT_NEGOTIATION_THRESHOLD
  };
}

async function countActivePatientsByClinic(
  supabase: SupabaseClientLike,
  clinicId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('patients')
    .select('id,status')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(10000);

  if (error) throw error;
  return (data || []).filter((patient: any) => isActivePatientStatus(patient?.status)).length;
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
}): Promise<{ success: boolean; activePatients: number; synced: boolean; reason?: string }> {
  const logger = params.logger || console;
  const clinicId = toSafeString(params.clinicId, 120);
  const priceId = toSafeString(params.activePatientPriceId, 120);
  if (!clinicId) {
    return { success: false, activePatients: 0, synced: false, reason: 'clinic_id ausente' };
  }
  if (!priceId) {
    logger.warn('[Stripe Sync] STRIPE_ACTIVE_PATIENT_PRICE_ID ausente. Sincronização ignorada.', { clinicId });
    return { success: true, activePatients: 0, synced: false, reason: 'price_id_ausente' };
  }

  const activePatients = await countActivePatientsByClinic(params.supabase, clinicId);
  const clinicEmails = await resolveClinicEmails(params.supabase, clinicId);
  const subscription = await findSubscriptionForClinic({
    stripe: params.stripe,
    clinicId,
    clinicEmails,
    logger
  });

  if (!subscription) {
    logger.warn('[Stripe Sync] Assinatura não encontrada para clínica.', { clinicId, activePatients });
    return { success: true, activePatients, synced: false, reason: 'subscription_not_found' };
  }

  const item = resolveSubscriptionItemByPriceId(subscription, priceId);
  const idempotencySeed = `${clinicId}:${subscription.id}:${priceId}:${activePatients}:${params.trigger}:${new Date().toISOString().slice(0, 13)}`;
  const idempotencyKey = buildIdempotencyKey(idempotencySeed);

  if (item) {
    await params.stripe.subscriptionItems.update(
      item.id,
      { quantity: activePatients },
      { idempotencyKey }
    );
  } else {
    await params.stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: priceId,
        quantity: activePatients
      },
      { idempotencyKey }
    );
  }

  logger.log('[Stripe Sync] Quantidade de pacientes ativos sincronizada.', {
    clinicId,
    subscriptionId: subscription.id,
    activePatients,
    trigger: params.trigger
  });

  return { success: true, activePatients, synced: true };
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
  const logger = params.logger || console;
  const clinicId = toSafeString(params.clinicId, 120);
  const priceId = toSafeString(params.activePatientPriceId, 120);
  if (!clinicId || !priceId) {
    return { success: false, clinicId, activePatients: 0, reported: false, reason: 'clinic_or_price_missing' };
  }

  const activePatients = await countActivePatientsByClinic(params.supabase, clinicId);
  if (activePatients > ACTIVE_PATIENT_NEGOTIATION_THRESHOLD && !params.allowOverNegotiationLimit) {
    logger.warn('[Stripe Usage] Clínica ultrapassou 299 pacientes ativos; uso mensal bloqueado para negociação manual.', {
      clinicId,
      activePatients
    });
    return { success: true, clinicId, activePatients, reported: false, reason: 'requires_manual_negotiation' };
  }

  let subscriptionId = '';
  let subscriptionItemId = '';
  let customerId = '';
  const { data: clinicRows } = await params.supabase
    .from('clinics')
    .select('stripe_customer_id,stripe_subscription_id,stripe_subscription_item_id,stripe_customer_email')
    .eq('id', clinicId)
    .limit(1);
  customerId = toSafeString(clinicRows?.[0]?.stripe_customer_id, 200);
  subscriptionId = toSafeString(clinicRows?.[0]?.stripe_subscription_id, 120);
  subscriptionItemId = toSafeString(clinicRows?.[0]?.stripe_subscription_item_id, 120);

  if (!customerId || !subscriptionId || !subscriptionItemId) {
    const clinicEmails = await resolveClinicEmails(params.supabase, clinicId);
    const subscription = await findSubscriptionForClinic({
      stripe: params.stripe,
      clinicId,
      clinicEmails,
      logger
    });
    if (!subscription) {
      return { success: true, clinicId, activePatients, reported: false, reason: 'subscription_not_found' };
    }
    subscriptionId = subscription.id;
    customerId = toSafeString(String(subscription.customer || ''), 200);
    const item = resolveSubscriptionItemByPriceId(subscription, priceId);
    if (!item?.id) {
      return { success: true, clinicId, activePatients, subscriptionId, reported: false, reason: 'subscription_item_not_found' };
    }
    subscriptionItemId = item.id;
  }

  if (!customerId) {
    return { success: true, clinicId, activePatients, subscriptionId, subscriptionItemId, reported: false, reason: 'customer_not_found' };
  }

  const period = formatBillingPeriod();
  const identifier = buildIdempotencyKey(`${clinicId}:${customerId}:${period}:active_patients`);
  await (params.stripe.billing as any).meterEvents.create({
    event_name: resolveMeterEventName(),
    payload: {
      stripe_customer_id: customerId,
      value: String(activePatients)
    },
    identifier,
    timestamp: Math.floor(Date.now() / 1000)
  });

  const reportPayload = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_subscription_item_id: subscriptionItemId,
    stripe_last_reported_active_patients: activePatients,
    stripe_last_usage_reported_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  try {
    await params.supabase.from('clinics').update(reportPayload).eq('id', clinicId);
  } catch {
    // Persistência auxiliar; o usage record já foi enviado ao Stripe.
  }

  logger.log('[Stripe Usage] Uso mensal de pacientes ativos reportado.', {
    clinicId,
    customerId,
    subscriptionId,
    subscriptionItemId,
    activePatients,
    trigger: params.trigger
  });

  return {
    success: true,
    clinicId,
    activePatients,
    subscriptionId,
    subscriptionItemId,
    reported: true
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
      logger.error('[Stripe Usage] Falha ao reportar uso mensal da clínica.', {
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
        billingModel: 'active_patient_metered_graduated'
      }
    });
    customerId = customer.id;
  }

  const subscription = await params.stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    collection_method: 'charge_automatically',
    metadata: {
      clinicId,
      userId: coordinatorUserId,
      billingModel: 'active_patient_metered_graduated'
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
}> {
  const activePatients = await countActivePatientsByClinic(params.supabase, params.clinicId);
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
    tiers: ACTIVE_PATIENT_BILLING_TIERS
  };
}
