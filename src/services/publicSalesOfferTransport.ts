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
