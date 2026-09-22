import crypto from 'crypto';
import Stripe from 'stripe';
import { buildFrozenStripeCheckoutPlan, type OfferCommercialPhase, type CustomCapacitySnapshot } from '../src/utils/salesCommercialEvolution';
import { resolveValidatedStripeEnvironment } from './stripeEnvironment';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-03-25.dahlia';
const BILLABLE_STATUSES = new Set(['active', 'trialing']);
const ACTION_STATUSES = new Set(['requires_action', 'requires_payment_method', 'requires_confirmation']);
const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
const unix = (value: unknown) => Math.max(0, Math.floor(Number(value || 0)));

type SupabaseLike = any;
export type ModuleUpgradeExecutionResult = {
  state: 'provisioned' | 'requires_action' | 'pending' | 'failed';
  intentStatus: string;
  entitlementGranted: boolean;
  invoiceId: string | null;
  invoiceIds: string[];
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
  return buildFrozenStripeCheckoutPlan({
    currency: text(offer?.currency, 12).toLowerCase() || 'brl',
    phases,
    capacity,
    effectiveAt: new Date().toISOString(),
  });
};

async function createFrozenPrice(stripe: Stripe, offerId: string, line: any, currency: string, recurring: boolean) {
  const amount = Math.max(0, Math.floor(Number(line.unitAmountCents || 0)));
  const frequency = recurring ? 'recurring' : 'one-time';
  const key = `module-upgrade:${offerId}:${line.itemKey}:${amount}:${currency}:${frequency}`;
  const product = await stripe.products.create({
    name: line.description || line.itemKey,
    metadata: { flowType: 'module_subscription_upgrade_v1', revenue_line: line.itemKey, sourceOfferId: offerId },
  }, { idempotencyKey: `${key}:product` });
  return stripe.prices.create({
    currency,
    unit_amount: amount,
    ...(recurring ? { recurring: { interval: 'month' as const } } : {}),
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

async function acceptOfferIfNeeded(supabase: SupabaseLike, offer: any, intent: any, actorUserId: string, acceptTerms: boolean) {
  if (offer?.accepted_at) return offer;
  if (!acceptTerms) throw new Error('MODULE_UPGRADE_TERMS_CONFIRMATION_REQUIRED');
  const status = text(offer?.status, 40).toLowerCase();
  if (!['ready', 'sent', 'opened', 'accepted', 'checkout_created'].includes(status)) throw new Error('MODULE_UPGRADE_OFFER_NOT_ACCEPTABLE');
  const acceptedAt = new Date().toISOString();
  const updateResult = await supabase.from('sales_offers').update({
    status: 'accepted', accepted_at: acceptedAt, accepted_terms_at: acceptedAt,
    accepted_terms_snapshot: { schemaVersion: 1, source: 'module_upgrade_v5', intentId: intent.id, acceptedByUserId: actorUserId },
    updated_at: acceptedAt,
  }).eq('id', offer.id).eq('lead_id', offer.lead_id).is('revoked_at', null)
    .select('id,lead_id,status,accepted_at,expires_at,revoked_at,offer_type,currency,modular_snapshot').limit(1).maybeSingle();
  if (updateResult.error) throw updateResult.error;
  if (!updateResult.data?.accepted_at) throw new Error('MODULE_UPGRADE_OFFER_ACCEPTANCE_FAILED');
  return updateResult.data;
}

async function loadContext(supabase: SupabaseLike, organizationId: string, intentId: string, actorUserId: string, acceptTerms: boolean) {
  const intentResult = await supabase.from('module_subscription_upgrade_intents')
    .select('id,organization_id,sales_offer_id,stripe_subscription_id,expected_access_profile_version,expected_access_profile_mode,idempotency_key,intent_status,claim_token,stripe_operation_id,stripe_invoice_id,stripe_event_id,stripe_event_created_at,last_error_code')
    .eq('id', intentId).eq('organization_id', organizationId).limit(1).maybeSingle();
  if (intentResult.error) throw intentResult.error;
  const intent = intentResult.data;
  if (!intent?.id) throw new Error('MODULE_UPGRADE_INTENT_NOT_FOUND');
  const [profileResult, offerResult] = await Promise.all([
    supabase.from('organization_module_access_profiles').select('organization_id,mode,version,source_offer_id,stripe_subscription_id').eq('organization_id', organizationId).limit(1).maybeSingle(),
    supabase.from('sales_offers').select('id,lead_id,status,accepted_at,accepted_terms_at,expires_at,revoked_at,offer_type,currency,modular_snapshot').eq('id', intent.sales_offer_id).limit(1).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (offerResult.error) throw offerResult.error;
  const profile = profileResult.data;
  let offer = offerResult.data;
  if (!profile?.organization_id || text(profile.mode, 40) !== text(intent.expected_access_profile_mode, 40) || Number(profile.version) !== Number(intent.expected_access_profile_version) || text(profile.stripe_subscription_id, 180) !== text(intent.stripe_subscription_id, 180)) throw new Error('MODULE_UPGRADE_ACCESS_PROFILE_STALE');
  if (!offer?.id || offer.offer_type !== 'modular' || offer.revoked_at) throw new Error('MODULE_UPGRADE_OFFER_NOT_ACCEPTED');
  const expiresAt = Date.parse(String(offer.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('MODULE_UPGRADE_OFFER_STALE');
  offer = await acceptOfferIfNeeded(supabase, offer, intent, actorUserId, acceptTerms);
  return { intent, offer };
}

const invoiceIdList = (subscription: any) => Array.from(new Set([
  text(subscription?.metadata?.vertoUpgradeProrationInvoiceId, 120),
  text(subscription?.metadata?.vertoUpgradeOneTimeInvoiceId, 120),
  typeof subscription?.latest_invoice === 'string' ? text(subscription.latest_invoice, 120) : text(subscription?.latest_invoice?.id, 120),
].filter(Boolean)));

async function retrieveInvoice(stripe: Stripe, invoiceId: string) {
  return stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] } as any);
}

async function settlement(stripe: Stripe, subscription: any) {
  const ids = invoiceIdList(subscription);
  const invoices = await Promise.all(ids.map((id) => retrieveInvoice(stripe, id)));
  const states = invoices.map((invoice: any) => {
    const paymentIntent = invoice?.payment_intent && typeof invoice.payment_intent === 'object' ? invoice.payment_intent : null;
    return { id: text(invoice?.id, 120), status: text(invoice?.status, 40).toLowerCase(), created: Number(invoice?.created || 0), paymentIntentStatus: text(paymentIntent?.status, 60).toLowerCase() || null };
  });
  return { ids, states };
}

async function createOneTimeInvoiceIfNeeded(stripe: Stripe, subscription: any, offer: any, intent: any, plan: any) {
  const oneTimeLines = plan.initialLineItems.filter((line: any) => !line.recurring && Number(line.unitAmountCents || 0) > 0);
  if (oneTimeLines.length === 0) return null;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : text(subscription.customer?.id, 120);
  if (!customerId) throw new Error('MODULE_UPGRADE_CUSTOMER_STALE');
  const existingInvoiceId = text(subscription.metadata?.vertoUpgradeOneTimeInvoiceId, 120);
  if (existingInvoiceId) return existingInvoiceId;
  for (const line of oneTimeLines) {
    const price = await createFrozenPrice(stripe, offer.id, line, plan.currency, false);
    await stripe.invoiceItems.create({ customer: customerId, subscription: subscription.id, pricing: { price: price.id }, quantity: 1,
      metadata: { flowType: 'module_subscription_upgrade_v1', vertoUpgradeIntentId: intent.id, vertoOfferId: offer.id, revenue_line: line.itemKey } } as any,
      { idempotencyKey: `module-upgrade:${intent.id}:one-time-item:${line.itemKey}` });
  }
  const invoice: any = await stripe.invoices.create({ customer: customerId, subscription: subscription.id, collection_method: 'charge_automatically', auto_advance: true, pending_invoice_items_behavior: 'include',
    metadata: { flowType: 'module_subscription_upgrade_v1', vertoUpgradeIntentId: intent.id, vertoOfferId: offer.id, purpose: 'one_time' } } as any,
    { idempotencyKey: `module-upgrade:${intent.id}:one-time-invoice` });
  return text(invoice?.id, 120) || null;
}

async function stampInvoiceEvidence(stripe: Stripe, subscription: any, intent: any, prorationInvoiceId: string | null, oneTimeInvoiceId: string | null) {
  const metadata = { ...(subscription.metadata || {}), vertoUpgradeIntentId: intent.id,
    ...(prorationInvoiceId ? { vertoUpgradeProrationInvoiceId: prorationInvoiceId } : {}),
    ...(oneTimeInvoiceId ? { vertoUpgradeOneTimeInvoiceId: oneTimeInvoiceId } : {}) };
  return stripe.subscriptions.update(subscription.id, { metadata } as any, { idempotencyKey: `module-upgrade:${intent.id}:invoice-evidence:${oneTimeInvoiceId || 'proration'}` });
}

async function reconcile(supabase: SupabaseLike, stripe: Stripe, intent: any, subscription: any, offer: any, plan: any): Promise<ModuleUpgradeExecutionResult> {
  const settled = await settlement(stripe, subscription);
  const current = text(intent.intent_status, 40);
  const representativeId = settled.ids[0] || text(intent.stripe_invoice_id, 120) || null;
  const paymentIntentStatus = settled.states.find((state) => state.paymentIntentStatus)?.paymentIntentStatus || null;
  const actionState = settled.states.find((state) => state.paymentIntentStatus && ACTION_STATUSES.has(state.paymentIntentStatus));
  const failedState = settled.states.find((state) => ['void', 'uncollectible'].includes(state.status));
  if (actionState) {
    if (current === 'stripe_pending') await advanceIntent(supabase, intent, 'stripe_pending', 'requires_action', { operationId: `subscription:${subscription.id}`, invoiceId: actionState.id, errorCode: actionState.paymentIntentStatus });
    return { state: 'requires_action', intentStatus: 'requires_action', entitlementGranted: false, invoiceId: actionState.id, invoiceIds: settled.ids, paymentIntentStatus: actionState.paymentIntentStatus, subscriptionId: subscription.id };
  }
  if (failedState) {
    if (['stripe_pending', 'requires_action'].includes(current)) await advanceIntent(supabase, intent, current, 'failed', { operationId: `subscription:${subscription.id}`, invoiceId: failedState.id, errorCode: `invoice_${failedState.status}` });
    return { state: 'failed', intentStatus: 'failed', entitlementGranted: false, invoiceId: failedState.id, invoiceIds: settled.ids, paymentIntentStatus, subscriptionId: subscription.id };
  }
  const allKnownPaid = settled.states.length > 0 && settled.states.every((state) => state.status === 'paid');
  const needsOneTime = plan.initialLineItems.some((line: any) => !line.recurring && Number(line.unitAmountCents || 0) > 0);
  if (allKnownPaid && needsOneTime && !text(subscription.metadata?.vertoUpgradeOneTimeInvoiceId, 120)) {
    const oneTimeInvoiceId = await createOneTimeInvoiceIfNeeded(stripe, subscription, offer, intent, plan);
    if (!oneTimeInvoiceId) throw new Error('MODULE_UPGRADE_ONE_TIME_EVIDENCE_MISSING');
    subscription = await stampInvoiceEvidence(stripe, subscription, intent, text(subscription.metadata?.vertoUpgradeProrationInvoiceId, 120) || representativeId, oneTimeInvoiceId);
    subscription = await stripe.subscriptions.retrieve(subscription.id, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
    return reconcile(supabase, stripe, intent, subscription, offer, plan);
  }
  if (allKnownPaid && (!needsOneTime || text(subscription.metadata?.vertoUpgradeOneTimeInvoiceId, 120))) {
    const eventCreated = Math.max(...settled.states.map((state) => state.created || 0));
    if (!eventCreated) throw new Error('MODULE_UPGRADE_PAYMENT_EVIDENCE_STALE');
    const eventCreatedAt = new Date(eventCreated * 1000).toISOString();
    const eventId = `module-upgrade-invoices:${crypto.createHash('sha256').update(settled.ids.slice().sort().join(':')).digest('hex').slice(0, 40)}`;
    let nextIntent = intent;
    if (current !== 'stripe_confirmed' && current !== 'provisioned') nextIntent = await advanceIntent(supabase, nextIntent, current, 'stripe_confirmed', { operationId: `subscription:${subscription.id}`, invoiceId: representativeId, eventId, eventCreatedAt });
    if (text(nextIntent.intent_status, 40) !== 'provisioned') {
      const applied = await supabase.rpc('apply_sales_offer_module_entitlements_v2', { p_offer_id: nextIntent.sales_offer_id, p_organization_id: nextIntent.organization_id, p_stripe_subscription_id: subscription.id, p_stripe_event_id: eventId, p_stripe_event_created_at: eventCreatedAt, p_status: 'active' });
      if (applied.error) throw applied.error;
      if (applied.data?.ignoredStaleEvent === true) throw new Error(`MODULE_UPGRADE_ENTITLEMENT_STALE:${text(applied.data?.reason, 100)}`);
      nextIntent = await advanceIntent(supabase, nextIntent, 'stripe_confirmed', 'provisioned', { operationId: `subscription:${subscription.id}`, invoiceId: representativeId, eventId, eventCreatedAt });
    }
    return { state: 'provisioned', intentStatus: 'provisioned', entitlementGranted: true, invoiceId: representativeId, invoiceIds: settled.ids, paymentIntentStatus, subscriptionId: subscription.id };
  }
  return { state: 'pending', intentStatus: current, entitlementGranted: false, invoiceId: representativeId, invoiceIds: settled.ids, paymentIntentStatus, subscriptionId: subscription.id };
}

async function buildRecurringPrices(stripe: Stripe, offerId: string, plan: any) {
  const map = new Map<string, string>();
  for (const phase of plan.schedulePhases) for (const item of phase.items) {
    const key = `${item.itemKey}:${item.unitAmountCents}`;
    if (map.has(key)) continue;
    const price = await createFrozenPrice(stripe, offerId, { itemKey: item.itemKey, description: item.itemKey, unitAmountCents: item.unitAmountCents }, plan.currency, true);
    map.set(key, price.id);
  }
  return map;
}

const priceForPhaseItem = async (stripe: Stripe, offerId: string, plan: any, cache: Map<string, string>, item: any) => {
  const exactKey = `${item.itemKey}:${item.unitAmountCents}`;
  const cached = cache.get(exactKey);
  if (cached) return cached;
  const price = await createFrozenPrice(stripe, offerId, { itemKey: item.itemKey, description: item.itemKey, unitAmountCents: item.unitAmountCents }, plan.currency, true);
  cache.set(exactKey, price.id);
  return price.id;
};

async function mutateDirectSubscription(stripe: Stripe, subscription: any, offer: any, intent: any, plan: any) {
  const existingItems = Array.isArray(subscription.items?.data) ? subscription.items.data : [];
  const existingByLine = new Map<string, any>();
  for (const item of existingItems) {
    const identity = lineIdentity(item);
    if (!identity) throw new Error('MODULE_UPGRADE_STRIPE_ITEM_IDENTITY_STALE');
    if (existingByLine.has(identity)) throw new Error('MODULE_UPGRADE_DUPLICATE_STRIPE_LINE');
    existingByLine.set(identity, item);
  }
  const desired = plan.initialLineItems.filter((line: any) => line.recurring);
  if (desired.length === 0) throw new Error('MODULE_UPGRADE_RECURRING_PLAN_EMPTY');
  const desiredKeys = new Set(desired.map((line: any) => line.itemKey));
  const mutationItems: any[] = [];
  for (const line of desired) {
    const price = await createFrozenPrice(stripe, offer.id, line, plan.currency, true);
    const existing = existingByLine.get(line.itemKey);
    mutationItems.push(existing ? { id: existing.id, price: price.id, quantity: 1 } : { price: price.id, quantity: 1 });
  }
  for (const [identity, item] of existingByLine.entries()) if (!desiredKeys.has(identity)) mutationItems.push({ id: item.id, deleted: true });
  return stripe.subscriptions.update(subscription.id, { items: mutationItems, proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete', metadata: { ...(subscription.metadata || {}), vertoUpgradeIntentId: intent.id, vertoOfferId: offer.id }, expand: ['latest_invoice.payment_intent'] } as any,
    { idempotencyKey: `module-upgrade:${intent.id}:subscription-update` });
}

const phaseBoundary = (value: unknown) => value == null ? null : unix(value);
const exactScheduleBoundaries = (stripePhases: any[], offerPhases: any[]) => stripePhases.length === offerPhases.length && stripePhases.every((phase, index) => {
  const offer = offerPhases[index];
  return phaseBoundary(phase.start_date) === phaseBoundary(Date.parse(offer.startsAt) / 1000) && phaseBoundary(phase.end_date) === (offer.endsAt ? phaseBoundary(Date.parse(offer.endsAt) / 1000) : null);
});

async function mutateExistingSchedule(stripe: Stripe, subscription: any, offer: any, intent: any, plan: any) {
  const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : text(subscription.schedule?.id, 120);
  if (!scheduleId) throw new Error('MODULE_UPGRADE_SCHEDULE_ID_STALE');
  const schedule: any = await stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ['phases.items.price.product'] } as any);
  const now = Math.floor(Date.now() / 1000);
  const liveStripePhases = (Array.isArray(schedule?.phases) ? schedule.phases : []).filter((phase: any) => !phase.end_date || Number(phase.end_date) > now);
  const liveOfferPhases = plan.schedulePhases;
  if (!exactScheduleBoundaries(liveStripePhases, liveOfferPhases)) throw new Error('MODULE_UPGRADE_SCHEDULE_BOUNDARY_MISMATCH');
  const priceCache = await buildRecurringPrices(stripe, offer.id, plan);
  const phases: any[] = [];
  for (let index = 0; index < liveStripePhases.length; index += 1) {
    const existing = liveStripePhases[index];
    const desired = liveOfferPhases[index];
    const items = [];
    for (const item of desired.items) items.push({ price: await priceForPhaseItem(stripe, offer.id, plan, priceCache, item), quantity: 1 });
    phases.push({
      start_date: existing.start_date, ...(existing.end_date ? { end_date: existing.end_date } : {}), items,
      ...(existing.trial_end ? { trial_end: existing.trial_end } : {}),
      ...(existing.billing_cycle_anchor ? { billing_cycle_anchor: existing.billing_cycle_anchor } : {}),
      ...(existing.collection_method ? { collection_method: existing.collection_method } : {}),
      ...(typeof existing.default_payment_method === 'string' && existing.default_payment_method ? { default_payment_method: existing.default_payment_method } : {}),
      ...(Array.isArray(existing.default_tax_rates) && existing.default_tax_rates.length > 0 ? { default_tax_rates: existing.default_tax_rates.map((rate: any) => typeof rate === 'string' ? rate : rate.id).filter(Boolean) } : {}),
      ...(Array.isArray(existing.discounts) && existing.discounts.length > 0 ? { discounts: existing.discounts.map((discount: any) => discount?.discount ? { discount: discount.discount } : discount?.coupon ? { coupon: discount.coupon } : null).filter(Boolean) } : {}),
      ...(Array.isArray(existing.add_invoice_items) && existing.add_invoice_items.length > 0 ? { add_invoice_items: existing.add_invoice_items } : {}),
      ...(existing.description ? { description: existing.description } : {}),
      ...(existing.billing_thresholds ? { billing_thresholds: existing.billing_thresholds } : {}),
      ...(existing.invoice_settings ? { invoice_settings: existing.invoice_settings } : {}),
      ...(existing.on_behalf_of ? { on_behalf_of: typeof existing.on_behalf_of === 'string' ? existing.on_behalf_of : existing.on_behalf_of.id } : {}),
      ...(existing.transfer_data ? { transfer_data: existing.transfer_data } : {}),
      metadata: { ...(existing.metadata || {}), vertoUpgradeIntentId: intent.id, vertoOfferId: offer.id },
      proration_behavior: index === 0 ? 'always_invoice' : (existing.proration_behavior || 'create_prorations'),
    });
  }
  await stripe.subscriptionSchedules.update(scheduleId, { end_behavior: schedule.end_behavior || 'release', phases, metadata: { ...(schedule.metadata || {}), vertoUpgradeIntentId: intent.id, vertoOfferId: offer.id }, proration_behavior: 'always_invoice' } as any,
    { idempotencyKey: `module-upgrade:${intent.id}:schedule-update` });
  return stripe.subscriptions.retrieve(subscription.id, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
}

export async function executeOrReconcileModuleSubscriptionUpgrade(params: { supabase: SupabaseLike; organizationId: string; intentId: string; actorUserId?: string; acceptTerms?: boolean }): Promise<ModuleUpgradeExecutionResult> {
  const { intent: initialIntent, offer } = await loadContext(params.supabase, params.organizationId, params.intentId, text(params.actorUserId, 120), params.acceptTerms === true);
  const subscriptionId = text(initialIntent.stripe_subscription_id, 180);
  if (!subscriptionId) throw new Error('MODULE_UPGRADE_SUBSCRIPTION_MISSING');
  const stripe = stripeClient();
  let subscription: any = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
  if (!subscription?.id || !BILLABLE_STATUSES.has(text(subscription.status, 40).toLowerCase())) throw new Error('MODULE_UPGRADE_SUBSCRIPTION_STALE');
  const plan = parseCheckoutPlan(offer);
  const status = text(initialIntent.intent_status, 40);
  if (status === 'provisioned') return { state: 'provisioned', intentStatus: 'provisioned', entitlementGranted: true, invoiceId: text(initialIntent.stripe_invoice_id, 120) || null, invoiceIds: invoiceIdList(subscription), paymentIntentStatus: null, subscriptionId };
  if (['stripe_pending', 'requires_action', 'stripe_confirmed'].includes(status)) {
    if (!text(subscription.metadata?.vertoUpgradeProrationInvoiceId, 120)) {
      const recoverableProration = typeof subscription.latest_invoice === 'string' ? text(subscription.latest_invoice, 120) : text(subscription.latest_invoice?.id, 120);
      if (!recoverableProration) throw new Error('MODULE_UPGRADE_PAYMENT_EVIDENCE_MISSING');
      subscription = await stampInvoiceEvidence(stripe, subscription, initialIntent, recoverableProration, null);
      subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
    }
    return reconcile(params.supabase, stripe, initialIntent, subscription, offer, plan);
  }
  if (status !== 'claimed') throw new Error(`MODULE_UPGRADE_INTENT_NOT_EXECUTABLE:${status}`);
  const intent = await advanceIntent(params.supabase, initialIntent, 'claimed', 'stripe_pending', { operationId: `subscription:${subscriptionId}` });
  subscription = subscription.schedule ? await mutateExistingSchedule(stripe, subscription, offer, intent, plan) : await mutateDirectSubscription(stripe, subscription, offer, intent, plan);
  const prorationInvoiceId = typeof subscription.latest_invoice === 'string' ? text(subscription.latest_invoice, 120) : text(subscription.latest_invoice?.id, 120) || null;
  if (!prorationInvoiceId) throw new Error('MODULE_UPGRADE_PAYMENT_EVIDENCE_MISSING');
  subscription = await stampInvoiceEvidence(stripe, subscription, intent, prorationInvoiceId, null);
  subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product', 'latest_invoice.payment_intent'] } as any);
  return reconcile(params.supabase, stripe, intent, subscription, offer, plan);
}
