import { SALES_CONTRACT_DOCUMENT } from '../constants/salesContractDocument';

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

// Public contract acceptance is one explicit unauthenticated request, acknowledged by backend.
// No payment is confirmed and no financial amount is computed here.
export const acceptPublicSalesModularOffer = async (
  token: string,
  request: typeof fetch = fetch
) => {
      const response = await request(
        `/api/public/sales-offers/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({
            commercialValuesConsent: true,
            contractDocumentAcknowledged: true,
            contractDocumentVersion: SALES_CONTRACT_DOCUMENT.version
          })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Não foi possível registrar o aceite.');
      }
  return data;
};

// Redirect only after the existing server-authoritative Checkout transport succeeds.
// Caller injects navigation for testability; no automatic retries, polling or new requests.
export const handoffPublicSalesCardCheckout = async (
  token: string,
  navigate: (url: string) => void,
  request: typeof fetch = fetch
) => {
  const data = await requestPublicSalesCardCheckout(token, request);
  navigate(data.url);
};
