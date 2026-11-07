// The paid Director bootstrap is authorized by the server, not the Checkout return URL.
// Keep the existing two requests and OTP flow unchanged; no fallback Checkout or retries.
import { getSupabase } from '../lib/supabase';

export const establishPublicSalesDirectorSession = async (
  token: string,
  checkoutSessionId: string,
  request: typeof fetch = fetch,
  resolveSupabase: typeof getSupabase = getSupabase,
): Promise<'already_claimed' | 'authenticated'> => {
      const response = await request(
        `/api/public/sales-offers/${encodeURIComponent(token)}/director-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          body: JSON.stringify({ sessionId: checkoutSessionId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false || !payload?.tokenHash) {
        if (payload?.error === 'SALES_DIRECTOR_SESSION_ALREADY_CLAIMED') {
          return 'already_claimed';
        }
        throw new Error(payload?.message || payload?.error || 'Não foi possível abrir sua conta agora.');
      }

      const supabase = await resolveSupabase();
      const verified = await supabase.auth.verifyOtp({
        token_hash: String(payload.tokenHash),
        type: (payload.otpType || 'magiclink') as any,
      });
      if (verified?.error || !verified?.data?.session?.access_token) {
        throw verified?.error || new Error('Não foi possível estabelecer a sessão do Diretor.');
      }

      const loginResponse = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessToken: verified.data.session.access_token,
          intendedRole: 'director',
          provider: 'sales_checkout',
          activationFlow: false,
        }),
      });
      const loginPayload = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok || loginPayload?.success === false) {
        throw new Error(loginPayload?.message || loginPayload?.error || 'O acesso foi liberado, mas não foi possível abrir a Verto.');
      }
  return 'authenticated';
};
