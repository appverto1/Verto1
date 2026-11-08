import type Stripe from 'stripe';

export type SalesSettledCheckoutMethod = 'card' | 'boleto';

// Session.payment_method_types lists the AVAILABLE choices, not the method
// actually used. A settled invoice payment + its succeeded charge are required.
export async function resolveSalesSettledCheckoutMethod(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<SalesSettledCheckoutMethod> {
  if (session.payment_status !== 'paid' ||
      !Number.isSafeInteger(Number(session.amount_total)) ||
      Number(session.amount_total) <= 0) {
    throw new Error('SALES_PAYMENT_NOT_SETTLED');
  }

  const invoiceId = typeof session.invoice === 'string'
    ? session.invoice : session.invoice?.id || '';
  let intentId = '';
  if (invoiceId) {
    const invoicePayments = await stripe.invoicePayments.list({
      invoice: invoiceId, status: 'paid', limit: 5,
    });
    const successful = invoicePayments.data.filter((entry) =>
      entry.status === 'paid' && entry.payment?.type === 'payment_intent',
    );
    if (successful.length !== 1) throw new Error('SALES_INVOICE_PAYMENT_AMBIGUOUS');
    const intent = successful[0].payment.payment_intent;
    intentId = typeof intent === 'string' ? intent : intent?.id || '';
  } else {
    const direct = session.payment_intent;
    intentId = typeof direct === 'string' ? direct : direct?.id || '';
  }
  if (!intentId) throw new Error('SALES_SETTLED_PAYMENT_INTENT_MISSING');

  const intent = await stripe.paymentIntents.retrieve(intentId, {
    expand: ['latest_charge'],
  });
  if (intent.status !== 'succeeded' || Number(intent.amount_received || 0) <= 0) {
    throw new Error('SALES_PAYMENT_INTENT_NOT_SUCCEEDED');
  }
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string' ||
      charge.paid !== true || charge.status !== 'succeeded') {
    throw new Error('SALES_PAYMENT_CHARGE_NOT_VERIFIED');
  }
  const method = charge.payment_method_details?.type;
  if (method !== 'card' && method !== 'boleto') {
    throw new Error('SALES_PAYMENT_METHOD_UNSUPPORTED');
  }
  return method;
}
