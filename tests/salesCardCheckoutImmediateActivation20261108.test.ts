import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { resolveSalesSettledCheckoutMethod } from '../services/salesCheckoutSettledMethod';

type Method = 'card' | 'boleto' | 'pix' | 'other';
const settledSession = (override: Record<string, unknown> = {}) => ({
  status: 'complete',
  payment_status: 'paid',
  amount_total: 20000,
  currency: 'brl',
  invoice: 'in_test_paid',
  ...override,
}) as unknown as Stripe.Checkout.Session;
const fakeStripe = (
  method: Method,
  overrides: {
    status?: string;
    amountReceived?: number;
    currency?: string;
    invoicePayments?: any[];
    methodAsId?: boolean;
  } = {},
) => {
  const counts = { list: 0, paymentIntent: 0, paymentMethod: 0 };
  const invoicePayments = overrides.invoicePayments ?? [{
    status: 'paid',
    amount_paid: 20000,
    payment: { type: 'payment_intent', payment_intent: 'pi_paid' },
  }];
  const stripe = {
    invoicePayments: {
      async list() {
        counts.list++;
        return { data: invoicePayments };
      },
    },
    paymentIntents: {
      async retrieve() {
        counts.paymentIntent++;
        return {
          status: overrides.status || 'succeeded',
          amount_received: overrides.amountReceived ?? 20000,
          currency: overrides.currency || 'brl',
          payment_method: overrides.methodAsId ? 'pm_paid' : { id: 'pm_paid', type: method },
        };
      },
    },
    paymentMethods: {
      async retrieve() {
        counts.paymentMethod++;
        return { id: 'pm_paid', type: method };
      },
    },
  };
  return { stripe: stripe as unknown as Stripe, counts };
};

{
  const { stripe, counts } = fakeStripe('card');
  assert.equal(await resolveSalesSettledCheckoutMethod(stripe, settledSession()), 'card');
  assert.equal(counts.list, 1);
  assert.equal(counts.paymentIntent, 1);
  assert.equal(counts.paymentMethod, 0);
}
{
  const { stripe } = fakeStripe('boleto', { methodAsId: true });
  assert.equal(await resolveSalesSettledCheckoutMethod(stripe, settledSession()), 'boleto');
}
for (const invalid of [
  { payment_status: 'unpaid' },
  { payment_status: 'no_payment_required', amount_total: 0 },
  { payment_status: 'paid', amount_total: 0 },
  { status: 'open' },
  { invoice: null },
]) {
  const { stripe, counts } = fakeStripe('card');
  assert.equal(await resolveSalesSettledCheckoutMethod(stripe, settledSession(invalid)), null);
  assert.equal(counts.list, 0, 'not even an invoice request for unpaid/incomplete sessions');
}
for (const invalid of [
  { status: 'processing' },
  { amountReceived: 0 },
  { currency: 'usd' },
  { invoicePayments: [] },
  { invoicePayments: [{ status: 'paid', amount_paid: 0, payment: { type: 'payment_intent', payment_intent: 'pi_paid' } }] },
  { invoicePayments: Array.from({ length: 2 }, () => ({
    status: 'paid', amount_paid: 10000,
    payment: { type: 'payment_intent', payment_intent: 'pi_paid' },
  })) },
]) {
  const { stripe } = fakeStripe('card', invalid);
  assert.equal(await resolveSalesSettledCheckoutMethod(stripe, settledSession()), null);
}
{
  const { stripe } = fakeStripe('pix');
  assert.equal(await resolveSalesSettledCheckoutMethod(stripe, settledSession()), null);
}
console.log('salesCardCheckoutImmediateActivation20261108.test.ts: PASS');
