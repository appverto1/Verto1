import crypto from 'crypto';
import type Stripe from 'stripe';

type SupabaseClientLike = any;

const ACTIVE_PATIENT_PRICE_BRL = 4.9;
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

function findAddonItemByPriceId(subscription: Stripe.Subscription, priceId: string): Stripe.SubscriptionItem | null {
  return (
    subscription.items.data.find((item) => {
      const itemPriceId = toSafeString((item.price as any)?.id, 120);
      return itemPriceId === priceId;
    }) || null
  );
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

  const item = findAddonItemByPriceId(subscription, priceId);
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
}): Promise<{ activePatients: number; unitPrice: number; additionalCost: number }> {
  const activePatients = await countActivePatientsByClinic(params.supabase, params.clinicId);
  const unitPrice = ACTIVE_PATIENT_PRICE_BRL;
  return {
    activePatients,
    unitPrice,
    additionalCost: Number((activePatients * unitPrice).toFixed(2))
  };
}
