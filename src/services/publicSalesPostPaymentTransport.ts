// Anonymous post-payment transport. Stripe confirmation and patient/clinic
// entitlements remain exclusively server-authoritative. No new requests or retries.
export const requestPublicSalesPostPaymentReconciliation = async (
  token: string, checkoutSessionId: string, request: typeof fetch = fetch
) => {
  const response = await request(
    `/api/public/sales-offers/${encodeURIComponent(token)}/prepare-activation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({ sessionId: checkoutSessionId }),
    },
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
};

export const loadPublicSalesPaymentStatusResponse = async (
  token: string, checkoutSessionId: string, request: typeof fetch = fetch
) => {
  const response = await request(
    `/api/public/sales-offers/${encodeURIComponent(token)}/payment-status?session_id=${encodeURIComponent(checkoutSessionId)}`,
    { credentials: 'omit', cache: 'no-store' },
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
};

// A card payment does not require email. Return only the first-access chooser
// URL after the server verifies Stripe, the frozen clinic and the HttpOnly
// proof from the browser that initiated Checkout.
export const requestPaidSalesCardActivation = async (
  token: string, checkoutSessionId: string, request: typeof fetch = fetch
) => {
  const response = await request(
    `/api/public/sales-offers/${encodeURIComponent(token)}/card-activation`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: checkoutSessionId }),
    },
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
};
