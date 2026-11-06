import type Stripe from 'stripe';

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

export { createFrozenPrice };
