import type Stripe from 'stripe';

/**
 * Determines the payment rail that actually settled the first invoice.
 * Checkout.payment_method_types are merely *offered* options (card + boleto),
 * not the rail the payer selected. Unknown or pending methods fail closed.
 *
 * This runs only on confirmed initial Checkouts or a bounded paid return
 * reconciliation; no repeated database polling and no new Stripe charge.
 */
export async function resolveSalesSettledCheckoutMethod(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<'card' | 'boleto' | null> {
  const invoiceId = typeof session.invoice === 'string'
    ? session.invoice
    : session.invoice?.id;
  if (
    session.status !== 'complete'
    || session.payment_status !== 'paid'
    || !Number.isSafeInteger(session.amount_total)
    || Number(session.amount_total) <= 0
    || !invoiceId
  ) return null;

  const invoicePayments = await stripe.invoicePayments.list({
    invoice: invoiceId,
    status: 'paid',
    limit: 5,
  });
  // Zero or ambiguous paid intents must never grant a browser activation URL.
  const successful = invoicePayments.data.filter((payment) =>
    payment.status === 'paid'
    && Number(payment.amount_paid) > 0
    && payment.payment?.type === 'payment_intent'
    && Boolean(payment.payment?.payment_intent)
  );
  if (successful.length !== 1) return null;
  const entry = successful[0];
  const intentRef = entry.payment.payment_intent;
  const intentId = typeof intentRef === 'string' ? intentRef : intentRef?.id;
  if (!intentId) return null;

  const intent = await stripe.paymentIntents.retrieve(intentId, {
    expand: ['payment_method'],
  });
  if (
    intent.status !== 'succeeded'
    || !Number.isSafeInteger(intent.amount_received)
    || intent.amount_received <= 0
    || intent.currency !== session.currency
  ) return null;

  const methodRef = intent.payment_method;
  const method = typeof methodRef === 'string'
    ? await stripe.paymentMethods.retrieve(methodRef)
    : methodRef;
  if (method?.type === 'card' || method?.type === 'boleto') return method.type;
  return null;
}
