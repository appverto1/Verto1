// @ts-nocheck -- isolated runtime fixture with narrow Supabase/Stripe mocks
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSalesPaidDirectorAccountProvisioning } from '../services/salesPaidDirectorAccountProvisioning.ts';

const offerId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const checkoutSessionId = 'cs_test_pending_subscription';
const subscriptionId = 'sub_test_pending_subscription';

function harness({ status = 'incomplete', subscriptionPresent = true, modular = true, retrievalFails = false } = {}) {
  let writes = 0;
  let stripeReads = 0;
  const rows = {
    sales_leads: { id: leadId, normalized_email: 'buyer@example.invalid', deleted_at: null, converted_clinic_id: null },
    sales_offers: {
      id: offerId, lead_id: leadId, status: 'paid', stripe_checkout_session_id: checkoutSessionId,
      stripe_subscription_id: subscriptionPresent ? subscriptionId : null,
      offer_type: modular ? 'modular' : 'legacy',
    },
  };
  const select = (table) => ({
    eq() { return this; },
    is() { return this; },
    maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
  });
  const supabase = {
    from(table) {
      return {
        select: () => select(table),
        update: () => { writes++; throw new Error('WRITE_REACHED_AFTER_VERIFICATION'); },
      };
    },
  };
  const deps = {
    supabase,
    getStripe: () => ({ subscriptions: { retrieve: async (id) => {
      stripeReads++;
      assert.equal(id, subscriptionId);
      if (retrievalFails) throw new Error('STRIPE_TEMPORARILY_UNAVAILABLE');
      return { id, status };
    } } }),
    sanitizeString: (value, size = 240) => String(value ?? '').slice(0, size),
    sanitizeEmail: (value) => String(value ?? '').toLowerCase(),
    isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
    isMissingRelationError: () => false,
    stripeSubscriptionToEntitlementStatus: (value) => value === 'active' ? 'active' : value === 'trialing' ? 'trial' : 'inactive',
    maskEmail: () => '[masked]',
  };
  const { finalizeSalesActivationForUser } = createSalesPaidDirectorAccountProvisioning(deps);
  return {
    run: () => finalizeSalesActivationForUser({
      email: 'buyer@example.invalid', userId, clinicId: userId,
      offerId, leadId, checkoutSessionId, requireActivationRecord: false,
    }),
    metrics: () => ({ writes, stripeReads }),
  };
}

test('a paid offer with incomplete subscription cannot mark its lead converted', async () => {
  const h = harness({ status: 'incomplete' });
  await assert.rejects(h.run(), /SALES_SUBSCRIPTION_NOT_ACTIVE/);
  assert.deepEqual(h.metrics(), { writes: 0, stripeReads: 1 });
});
test('past_due or canceled subscription also leaves tenant and lead untouched', async () => {
  for (const status of ['past_due', 'canceled', 'unpaid']) {
    const h = harness({ status });
    await assert.rejects(h.run(), /SALES_SUBSCRIPTION_NOT_ACTIVE/);
    assert.deepEqual(h.metrics(), { writes: 0, stripeReads: 1 });
  }
});
test('a verified active subscription proceeds to the existing lead conversion', async () => {
  const h = harness({ status: 'active' });
  await assert.rejects(h.run(), /WRITE_REACHED_AFTER_VERIFICATION/);
  assert.deepEqual(h.metrics(), { writes: 1, stripeReads: 1 });
});
test('missing persisted Stripe subscription linkage fails closed without reads or writes', async () => {
  const h = harness({ subscriptionPresent: false });
  await assert.rejects(h.run(), /SALES_SUBSCRIPTION_LINKAGE_MISSING/);
  assert.deepEqual(h.metrics(), { writes: 0, stripeReads: 0 });
});
test('Stripe outage leaves the persisted lead unconverted and can be retried later', async () => {
  const h = harness({ retrievalFails: true });
  await assert.rejects(h.run(), /STRIPE_TEMPORARILY_UNAVAILABLE/);
  assert.deepEqual(h.metrics(), { writes: 0, stripeReads: 1 });
});
test('legacy offer does not introduce an unnecessary subscription lookup', async () => {
  const h = harness({ modular: false });
  await assert.rejects(h.run(), /WRITE_REACHED_AFTER_VERIFICATION/);
  assert.deepEqual(h.metrics(), { writes: 1, stripeReads: 0 });
});
