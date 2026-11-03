// Pure normalization of Stripe module-upgrade invoice evidence and item identities.
// No Stripe calls, database mutations, entitlements or authorization.
const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);

export const lineIdentity = (item: any) => {
  const product = item?.price?.product;
  const productMetadata = product && typeof product === 'object' ? product.metadata : null;
  return text(item?.metadata?.revenue_line || item?.price?.metadata?.revenue_line || productMetadata?.revenue_line, 100);
};

export const invoiceIdList = (subscription: any) => Array.from(new Set([
  text(subscription?.metadata?.vertoUpgradeProrationInvoiceId, 120),
  text(subscription?.metadata?.vertoUpgradeOneTimeInvoiceId, 120),
  typeof subscription?.latest_invoice === 'string' ? text(subscription.latest_invoice, 120) : text(subscription?.latest_invoice?.id, 120),
].filter(Boolean)));
