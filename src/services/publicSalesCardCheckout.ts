// Task 07: public Checkout initiation after explicit commercial acceptance.
// This transport retains the current single request/response contract. Stripe keys,
// payment confirmation, customer identity and idempotency remain server-authoritative.
export const requestPublicSalesCardCheckout = async (
  token: string,
  request: typeof fetch = fetch
) => {
  const response = await request(
    '/api/public/sales-offers/' + encodeURIComponent(token) + '/checkout',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ acceptTerms: true })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || 'Não foi possível continuar.');
  }
  if (!data?.url) throw new Error('Checkout indisponível.');
  return data;
};
