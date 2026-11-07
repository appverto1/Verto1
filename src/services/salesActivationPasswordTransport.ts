// The backend remains the only authority for password persistence, paid access,
// Director role and clinic scope. No new HTTP calls or retries.
export const loadPublicSalesActivationSummary = async (
  token: string, signal: AbortSignal, request: typeof fetch = fetch,
) => {
  const response = await request(
    `/api/public/sales-activations/${encodeURIComponent(token)}`,
    { credentials: 'omit', signal },
  );
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

export const persistPublicSalesActivationPassword = async (
  token: string, password: string, request: typeof fetch = fetch,
) => {
  const response = await request(
    `/api/public/sales-activations/${encodeURIComponent(token)}/password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ password }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};
