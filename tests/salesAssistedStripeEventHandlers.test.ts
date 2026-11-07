import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import type Stripe from 'stripe';
import { createSalesAssistedStripeEventHandlers } from '../services/salesAssistedStripeEventHandlers';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const marker = '  const isSalesAssistedStripeEvent = async (\n';
const markerEnd = '  return { isSalesAssistedStripeEvent, processSalesAssistedStripeEvent };\n';
function fnv(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const uuid = '12345678-1234-4123-8123-123456789abc';
const leadId = '87654321-1234-4123-8123-123456789abc';

function setup() {
  const calls: string[] = [];
  const updates: Array<{ table: string; data: unknown }> = [];
  const stripe = {
    subscriptions: { retrieve: async (id: string) => {
      calls.push('subscription:retrieve:' + id);
      return { id, metadata: { flowType: 'sales_assisted_signup', offerId: uuid, leadId }, status: 'active' };
    } },
  } as unknown as Stripe;
  const handlers = createSalesAssistedStripeEventHandlers({
    salesAssistedFlowType: (value: unknown) => ['sales_assisted_signup', 'sales_modular_assisted'].includes(String(value)),
    stripeInvoiceSubscriptionId: (invoice: Stripe.Invoice) => String((invoice as any).subscription || ''),
    reconcileSalesAssistedCheckout: async (_stripe, _session, options) => {
      calls.push('checkout:reconcile:' + String(options?.sendActivationEmail === true));
      return { paymentConfirmed: true, linked: true };
    },
    sanitizeString: (value: unknown, maxLength = 500) => String(value ?? '').slice(0, maxLength).trim(),
    supabase: { from: (table: string) => ({
      update: (data: unknown) => {
        updates.push({ table, data });
        return {
          eq: () => Promise.resolve({ error: null }),
        };
      },
      upsert: async () => ({ error: null }),
    }) },
    isUuid: (value: string | null | undefined) => /^[a-f0-9-]{36}$/i.test(value || ''),
    resolveStripeEnvironment: () => 'test',
    validateStripeSecretForEnvironment: () => 'sk_test_fixture',
    persistPlatformBillingInvoiceLedger: async () => { calls.push('ledger'); },
    persistPlatformSubscriptionFinancialState: async () => { calls.push('financial'); },
    syncSalesSubscriptionDiscount: async () => { calls.push('discounts'); },
    applyModularEntitlementsForOrganization: async () => { calls.push('entitlements'); },
    stripeSubscriptionToEntitlementStatus: () => 'active',
  });
  return { ...handlers, stripe, calls, updates };
}
function event(type: string, metadata: Record<string, string> = { flowType: 'sales_assisted_signup' }): Stripe.Event {
  return {
    id: 'evt_fixture', type, created: 1700000000,
    data: { object: { id: 'cs_fixture', metadata, subscription: 'sub_fixture' } },
  } as unknown as Stripe.Event;
}
test('moved sales-assisted webhook source is byte-for-byte identical and registered prior to both Stripe routes', () => {
  const mod = fs.readFileSync('services/salesAssistedStripeEventHandlers.ts', 'utf8');
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.equal(fnv(mod.slice(mod.indexOf(marker), mod.indexOf(markerEnd))), '24e0e5ac');
  const handlers = server.indexOf('createSalesAssistedStripeEventHandlers({');
  const legacy = server.indexOf('registerLegacySalesActivationStripeWebhookRoute(app, {');
  const canonical = server.indexOf('registerStripeCanonicalWebhookRoute(app, {');
  assert.ok(handlers >= 0 && legacy > handlers && canonical > legacy);
  assert.match(fs.readFileSync('services/stripeCanonicalWebhookRoute.ts', 'utf8'), /"\/api\/stripe\/webhook"/);
  assert.match(server, /applyModularEntitlementsForOrganization: \(params\) =>\s+applyModularEntitlementsForOrganization\(params\)/);
  assert.match(server, /stripeSubscriptionToEntitlementStatus: \(status\) =>\s+stripeSubscriptionToEntitlementStatus\(status\)/);
  assert.doesNotMatch(server, /  const processSalesAssistedStripeEvent = async/);
});
test('classification handles sales checkout, subscription, schedule, invoice and ignores other events', async () => {
  const { isSalesAssistedStripeEvent, stripe, calls } = setup();
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('checkout.session.completed')), true);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('checkout.session.expired')), true);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('customer.subscription.updated')), true);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('subscription_schedule.updated')), true);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('invoice.paid')), true);
  assert.deepEqual(calls, ['subscription:retrieve:sub_fixture']);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('invoice.payment_failed', { flowType: 'none' })), true);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('unknown.event')), false);
  assert.equal(await isSalesAssistedStripeEvent(stripe, event('checkout.session.completed', {flowType:'other'})), false);
});
test('confirmed card checkout delegates without activation email and without new database write', async () => {
  const { processSalesAssistedStripeEvent, stripe, calls, updates } = setup();
  const r = await processSalesAssistedStripeEvent(stripe, event('checkout.session.completed'));
  assert.equal(r.handled, true);
  assert.equal(r.result?.paymentConfirmed, true);
  assert.deepEqual(calls, ['checkout:reconcile:false']);
  assert.equal(updates.length, 0);
});
test('async payment delegates with activation email after confirmed event', async () => {
  const { processSalesAssistedStripeEvent, stripe, calls, updates } = setup();
  const r = await processSalesAssistedStripeEvent(stripe, event('checkout.session.async_payment_succeeded'));
  assert.equal(r.handled, true);
  assert.deepEqual(calls, ['checkout:reconcile:true']);
  assert.equal(updates.length, 0);
});
test('modular Checkout writes original confirmed state only after reconciliation', async () => {
  const { processSalesAssistedStripeEvent, stripe, calls, updates } = setup();
  const r = await processSalesAssistedStripeEvent(stripe, event('checkout.session.completed', {flowType:'sales_modular_assisted'}));
  assert.equal(r.handled, true);
  assert.deepEqual(calls, ['checkout:reconcile:false']);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.table, 'sales_checkout_links');
  assert.equal((updates[0]?.data as any).status, 'completed');
});
test('unrelated events are never written to billing tables', async () => {
  const { processSalesAssistedStripeEvent, stripe, calls, updates } = setup();
  const r = await processSalesAssistedStripeEvent(stripe, event('customer.created'));
  assert.deepEqual(r, { handled: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(updates, []);
});
test('invoice without linked subscription is ignored by sales-assisted classification', async () => {
  const { isSalesAssistedStripeEvent, stripe, calls } = setup();
  const r = await isSalesAssistedStripeEvent(stripe, {
    ...event('invoice.payment_failed'),
    data: { object: { id:'in_fixture', subscription: null } } as any,
  });
  assert.equal(r, false);
  assert.deepEqual(calls, []);
});
test('schedule without UUIDs fails closed with existing error code', async () => {
  const { processSalesAssistedStripeEvent, stripe, updates } = setup();
  await assert.rejects(() => processSalesAssistedStripeEvent(stripe, event('subscription_schedule.updated')), /MODULAR_SCHEDULE_METADATA_INVALID/);
  assert.deepEqual(updates, []);
});
