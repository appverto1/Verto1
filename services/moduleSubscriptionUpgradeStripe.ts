import Stripe from 'stripe';
import { buildFrozenStripeCheckoutPlan, type OfferCommercialPhase, type CustomCapacitySnapshot } from '../src/utils/salesCommercialEvolution';
import { resolveValidatedStripeEnvironment } from './stripeEnvironment';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-03-25.dahlia';
const BILLABLE_STATUSES = new Set(['active', 'trialing']);
const ACTION_STATUSES = new Set(['requires_action', 'requires_payment_method', 'requires_confirmation']);
const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);

type SupabaseLike = any;
export type ModuleUpgradeExecutionResult = {
  state: 'provisioned' | 'requires_action' | 'pending' | 'failed';
  intentStatus: string;
  entitlementGranted: boolean;
  invoiceId: string | null;
  paymentIntentStatus: string | null;
  subscriptionId: string;
};

const stripeClient = () => {
  const { secret } = resolveValidatedStripeEnvironment();
  return new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
};

const lineIdentity = (item: any) => {
  const product = item?.price?.product;
  const productMetadata = product && typeof product === 'object' ? product.metadata : null;
  return text(item?.metadata?.revenue_line || item?.price?.metadata?.revenue_line || productMetadata?.revenue_line, 100);
};

const parseCheckoutPlan = (offer: any) => {
  const snapshot = offer?.modular_snapshot;
  const phases = Array.isArray(snapshot?.commercialPhases) ? snapshot.commercialPhases as OfferCommercialPhase[] : [];
  if (phases.length === 0) throw new Error('MODULE_UPGRADE_OFFER_PHASES_MISSING');
  const capacity = snapshot?.capacity && typeof snapshot.capacity === 'object' ? snapshot.capacity as CustomCapacitySnapshot : null;
  const plan = buildFrozenStripeCheckoutPlan({
    currency: text(offer?.currency, 12).toLowerCase() || 'brl',
    phases,
    capacity,
    effectiveAt: new Date().toISOString(),
  });
  if (plan.initialLineItems.some((line) => !line.recurring && line.unitAmountCents > 0)) {
    throw new Error('MODULE_UPGRADE_ONE_TIME_CHARGE_UNSUPPORTED');
  }
  return plan;
};

async function createFrozenPrice(stripe: Stripe, offerId: string, line: any, currency: string) {
  const amount = Math.max(0, Math.floor(Number(line.unitAmountCents || 0)));
  const key = `module-upgrade:${offerId}:${line.itemKey}:${amount}:${currency}`;
  const product = await stripe.products.create({
    name: line.description || line.itemKey,
    metadata: { flowType: 'module_subscription_upgrade_v1', revenue_line: line.itemKey, sourceOfferId: offerId },
  }, { idempotencyKey: `${key}:product` });
  return stripe.prices.create({
    currency,
    unit_amount: amount,
    recurring: { interval: 'month' },
    product: product.id,
    metadata: { flowType: 'module_subscription_upgrade_v1', revenue_line: line.itemKey, sourceOfferId: offerId },
  }, { idempotencyKey: `${key}:price` });
}

async function advanceIntent(supabase: SupabaseLike, intent: any, expected: string, next: string, evidence: any = {}) {
  const result = await supabase.rpc('advance_module_subscription_upgrade_intent_v1', {
    p_intent_id: intent.id,
    p_claim_token: intent.claim_token,
    p_expected_status: expected,
    p_next_status: next,
    p_stripe_operation_id: evidence.operationId || null,
    p_stripe_invoice_id: evidence.invoiceId || null,
    p_stripe_event_id: evidence.eventId || null,
    p_stripe_event_created_at: evidence.eventCreatedAt || null,
    p_error_code: evidence.errorCode || null,
  });
  if (result.error) throw result.error;
  return result.data || { ...intent, intent_status: next };
}

async function loadContext(supabase: SupabaseLike, organizationId: string, intentId: string) {
  const intentResult = await supabase.from('module_subscription_upgrade_intents')
    .select('id,organization_id,sales_offer_id,stripe_subscription_id,expected_access_profile_version,expected_access_profile_mode,idempotency_key,intent_status,claim_token,stripe_operation_id,stripe_invoice_id,stripe_event_id,stripe_event_created_at,last_error_code')
    .eq('id', intentId).eq('organization_id', organizationId).limit(1).maybeSingle();
  if (intentResult.error) throw intentResult.error;
  const intent = intentResult.data;
  if (!intent?.id) throw new Error('MODULE_UPGRADE_INTENT_NOT_FOUND');

  const [profileResult, offerResult] = await Promise.all([
    supabase.from('organization_module_access_profiles')
      .select('organization_id,mode,version,source_offer_id,stripe_subscription_id')
      .eq('organization_id', organizationId).limit(1).maybeSingle(),
    supabase.from('sales_offers')
      .select('id,lead_id,status,accepted_at,expires_at,revoked_at,offer_type,currency,modular_snapshot')
      .eq('id', intent.sales_offer_id).limit(1).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (offerResult.error) throw offerResult.error;
  const profile = profileResult.data;
  const offer = offerResult.data;
  if (!profile?.organization_id || text(profile.mode, 40) !== text(intent.expected_access_profile_mode, 40) ||
      Number(profile.version) !== Number(intent.expected_access_profile_version) ||
      text(profile.stripe_subscription_id, 180) !== text(intent.stripe_subscription_id, 180)) {
    throw new Error('MODULE_UPGRADE_ACCESS_PROFILE_STALE');
  }
  if (!offer?.id || offer.offer_type !== 'modular' || !offer.accepted_at || offer.revoked_at) {
    throw new Error('MODULE_UPGRADE_OFFER_NOT_ACCEPTED');
  }
  const expiresAt = Date.parse(String(offer.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('MODULE_UPGRADE_OFFER_STALE');
  return { intent, offer };
}

async function settlement(stripe: Stripe, subscription: any) {
  let invoice: any = subscription?.latest_invoice || null;
  if (typeof invoice === 'string' && invoice) invoice = await stripe.invoices.retrieve(invoice, { expand: ['payment_intent'] } as any);
  const paymentIntent = invoice?.payment_intent && typeof invoice.payment_intent === 'object' ? invoice.payment_intent : null;
  return {
    invoiceId: text(invoice?.id, 120) || null,
    invoiceStatus: text(invoice?.status, 40).toLowerCase(),
    invoiceCreatedAt: Number(invoice?.created) > 0 ? new Date(Number(invoice.created) * 1000).toISOString() : null,
    paymentIntentStatus: text(paymentIntent?.status, 60).toLowerCase() || null,
  };
}

async function reconcile(supabase: SupabaseLike, stripe: Stripe, intent: any, subscription: any): Promise<ModuleUpgradeExecutionResult> {
  const settled = await settlement(stripe, subscription);
  const current = text(intent.intent_status, 40);
  if (settled.invoiceStatus === 'paid' && settled.invoiceId && settled.invoiceCreatedAt) {
    let nextIntent = intent;
    if (current !== 'stripe_confirmed' && current !== 'provisioned') {
      nextIntent = await advanceIntent(supabase, nextIntent, current, 'stripe_confirmed', {
        operationId: `subscription:${subscription.id}`,
        invoiceId: settled.invoiceId,
        eventId: `module-upgrade-invoice:${settled.invoiceId}`,
        eventCreatedAt: settled.invoiceCreatedAt,
      });
    }
    if (text(nextIntent.intent_status, 40) !== 'provisioned') {
      const applied = await supabase.rpc('apply_sales_offer_module_entitlements_v2', {
        p_offer_id: nextIntent.sales_offer_id,
        p_organization_id: nextIntent.organization_id,
        p_stripe_subscription_id: subscription.id,
        p_stripe_event_id: `module-upgrade-invoice:${settled.invoiceId}`,
        p_stripe_event_created_at: settled.invoiceCreatedAt,
        p_status: 'active',
      });
      if (applied.error) throw applied.error;
      if (applied.data?.ignoredStaleEvent === true) throw new Error(`MODULE_UPGRADE_ENTITLEMENT_STALE:${text(applied.data?.reason, 100)}`);
      nextIntent = await advanceIntent(supabase, nextIntent, 'stripe_confirmed', 'provisioned', {
        operationId: `subscription:${subscription.id}`,
        invoiceId: settled.invoiceId,
        eventId: `module-upgrade-invoice:${settled.invoiceId}`,
        eventCreatedAt: settled.invoiceCreatedAt,
      });
    }
    return { state: 'provisioned', intentStatus: 'provisioned', entitlementGranted: true, invoiceId: settled.invoiceId, paymentIntentStatus: settled.paymentIntentStatus, subscriptionId: subscription.id };
  }
  if (settled.paymentIntentStatus && ACTION_STATUSES.has(settled.paymentIntentStatus)) {
    if (current === 'stripe_pending') await advanceIntent(supabase, intent, 'stripe_pending', 'requires_action', { operationId: `subscription:${subscription.id}`, invoiceId: settled.invoiceId, errorCode: settled.paymentIntentStatus });
    return { state: 'requires_action', intentStatus: 'requires_action', entitlementGranted: false, invoiceId: settled.invoiceId, paymentIntentStatus: settled.paymentIntentStatus, subscriptionId: subscription.id };
  }
  if (['void', 'uncollectible'].includes(settled.invoiceStatus)) {
    if (['stripe_pending', 'requires_action'].includes(current)) await advanceIntent(supabase, intent, current, 'failed', { operationId: `subscription:${subscription.id}`, invoiceId: settled.invoiceId, errorCode: `invoice_${settled.invoiceStatus}` });
    return { state: 'failed', intentStatus: 'failed', entitlementGranted: false, invoiceId: settled.invoiceId, paymentIntentStatus: settled.paymentIntentStatus, subscriptionId: subscription.id };
  }
  return { state: 'pending', intentStatus: current, entitlementGranted: false, invoiceId: settled.invoiceId, paymentIntentStatus: settled.paymentIntentStatus, subscriptionId: subscription.id };
}

export async function executeOrReconcileModuleSubscriptionUpgrade(params: { supabase: SupabaseLike; organizationId: string; intentId: string }): Promise<ModuleUpgradeExecutionResult> {
  const { intent: initialIntent, offer } = await loadContext(params.supabase, params.organizationId, params.intentId);
  const subscriptionId = text(initialIntent.stripe_subscription_id, 180);
  if (!subscriptionId) throw new Error('MODULE_UPGRADE_SUBSCRIPTION_MISSING');
  const stripe = stripeClient();
  let subscription: any = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
  if (!subscription?.id || !BILLABLE_STATUSES.has(text(subscription.status, 40).toLowerCase())) throw new Error('MODULE_UPGRADE_SUBSCRIPTION_STALE');

  const status = text(initialIntent.intent_status, 40);
  if (status === 'provisioned') return { state: 'provisioned', intentStatus: 'provisioned', entitlementGranted: true, invoiceId: text(initialIntent.stripe_invoice_id, 120) || null, paymentIntentStatus: null, subscriptionId };
  if (['stripe_pending', 'requires_action', 'stripe_confirmed'].includes(status)) return reconcile(params.supabase, stripe, initialIntent, subscription);
  if (status !== 'claimed') throw new Error(`MODULE_UPGRADE_INTENT_NOT_EXECUTABLE:${status}`);

  if (subscription.schedule) throw new Error('MODULE_UPGRADE_SCHEDULE_PHASE_RECONCILIATION_REQUIRED');
  const plan = parseCheckoutPlan(offer);
  const desired = plan.initialLineItems.filter((line) => line.recurring);
  if (desired.length === 0) throw new Error('MODULE_UPGRADE_RECURRING_PLAN_EMPTY');

  const existingItems = Array.isArray(subscription.items?.data) ? subscription.items.data : [];
  const existingByLine = new Map<string, any>();
  for (const item of existingItems) {
    const identity = lineIdentity(item);
    if (!identity) throw new Error('MODULE_UPGRADE_STRIPE_ITEM_IDENTITY_STALE');
    if (existingByLine.has(identity)) throw new Error('MODULE_UPGRADE_DUPLICATE_STRIPE_LINE');
    existingByLine.set(identity, item);
  }

  const desiredKeys = new Set(desired.map((line) => line.itemKey));
  const mutationItems: any[] = [];
  for (const line of desired) {
    const price = await createFrozenPrice(stripe, offer.id, line, plan.currency);
    const existing = existingByLine.get(line.itemKey);
    mutationItems.push(existing ? { id: existing.id, price: price.id, quantity: 1 } : { price: price.id, quantity: 1 });
  }
  for (const [identity, item] of existingByLine.entries()) if (!desiredKeys.has(identity)) mutationItems.push({ id: item.id, deleted: true });

  const intent = await advanceIntent(params.supabase, initialIntent, 'claimed', 'stripe_pending', { operationId: `subscription:${subscriptionId}` });
  subscription = await stripe.subscriptions.update(subscriptionId, {
    items: mutationItems,
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    metadata: { ...(subscription.metadata || {}), vertoUpgradeIntentId: initialIntent.id, vertoOfferId: offer.id },
    expand: ['latest_invoice.payment_intent'],
  } as any, { idempotencyKey: `module-upgrade:${initialIntent.id}:subscription-update` });
  return reconcile(params.supabase, stripe, intent, subscription);
}
