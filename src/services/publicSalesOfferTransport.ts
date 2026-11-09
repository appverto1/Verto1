// Task 06: anonymous read of a single server-issued offer token.
// Retain the existing GET, omitted credentials and response semantics.
// Server validates token, status, frozen pricing and public-only projection.
export const loadPublicSalesOfferResponse = async (
  token: string,
  request: typeof fetch = fetch
) => {
  const response = await request(
    '/api/public/sales-offers/' + encodeURIComponent(token),
    { credentials: 'omit' }
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
};


// A 2xx response alone is not proof of an accessible, server-issued contract.
// Interpret the public projection after its token-specific 404 handling in UI.
export const requireConfirmedPublicSalesOffer = (response: Response, data: any) => {
  const offer = data?.offer;
  if (
    !response.ok ||
    data?.success !== true ||
    !offer ||
    typeof offer !== 'object' ||
    Array.isArray(offer) ||
    (offer.offerType !== 'modular' && offer.offerType !== 'legacy')
  ) {
    throw new Error(data?.message || data?.error || 'Oferta indisponível.');
  }
  return offer;
};
