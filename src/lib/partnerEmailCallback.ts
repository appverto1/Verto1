/**
 * Email confirmation links use Supabase's implicit flow (#access_token=...).
 * This remains isolated from the clinical authentication URL handler.
 */
export function readPartnerEmailCallbackHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const hasAuthResponse = ['access_token', 'refresh_token', 'token_hash', 'error', 'error_code']
    .some(key => params.has(key));
  return {
    hasAuthResponse,
    failed: Boolean(params.get('error') || params.get('error_code')),
    accessToken: params.get('access_token') || '',
    refreshToken: params.get('refresh_token') || '',
  };
}

/** Remove one-time credentials from the browser URL before awaiting network calls. */
export function cleanPartnerAuthReturnUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const { hasAuthResponse } = readPartnerEmailCallbackHash(url.hash);
  url.searchParams.delete('partner_oauth');
  url.searchParams.delete('partner_apply');
  url.searchParams.delete('partner_setup');
  if (hasAuthResponse) url.hash = '';
  return url.pathname + url.search + url.hash;
}
