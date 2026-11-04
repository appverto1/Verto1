// Task 05. Preserve frozen commercial identity and the owner's authenticated request.
export type SalesPublicOfferRequest = (url: string, init?: RequestInit) => Promise<any>;
export type SalesPublicOfferIdentity = {
  leadId: string;
  simulationId: string;
  contractEmail: string;
};
export const prepareSalesPublicOffer = (
  request: SalesPublicOfferRequest,
  identity: SalesPublicOfferIdentity,
  idempotencyKey: string
) => request('/api/owner/sales/offers', {
  method: 'POST',
  headers: { 'X-Idempotency-Key': idempotencyKey },
  body: JSON.stringify(identity)
});
// Copy exactly the URL issued by the backend. Never derive historical tokens locally.
export const copySalesPublicOfferUrl = async (
  publicUrl: string,
  writeText: (value: string) => Promise<void>
): Promise<boolean> => {
  if (!publicUrl) return false;
  await writeText(publicUrl);
  return true;
};
