import { getSupabase } from '../lib/supabase';

export const SALES_ACTIVATION_OAUTH_PENDING_KEY = 'verto_sales_activation_oauth_pending';

type ActivationOAuthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Browser hints select a continuation, never authorize a role or clinic.
export const beginSalesActivationGoogleOAuth = async (
  token: string, email: string, origin: string,
  storage: ActivationOAuthStorage = localStorage,
  resolveSupabase: typeof getSupabase = getSupabase,
): Promise<void> => {
  try {
    storage.setItem('verto_intended_role', 'director');
    storage.setItem('verto_activation_email', email.toLowerCase());
    storage.setItem(SALES_ACTIVATION_OAUTH_PENDING_KEY, token);
    const supabase = await resolveSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/ativacao-comercial/${encodeURIComponent(token)}`,
        scopes: 'https://www.googleapis.com/auth/userinfo.email',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (oauthError) throw oauthError;
  } catch (oauthError) {
    try {
      // Never clear markers belonging to a newer attempt.
      if (storage.getItem(SALES_ACTIVATION_OAUTH_PENDING_KEY) === token) {
        storage.removeItem(SALES_ACTIVATION_OAUTH_PENDING_KEY);
        if (storage.getItem('verto_intended_role') === 'director') {
          storage.removeItem('verto_intended_role');
        }
        if (storage.getItem('verto_activation_email') === email.toLowerCase()) {
          storage.removeItem('verto_activation_email');
        }
      }
    } catch {
      // Browser storage is optional; backend still validates the paid Director.
    }
    throw oauthError;
  }
};

// A continuation guard, not a substitute for server-side payment/identity checks.
export const readSalesActivationOAuthContext = (
  pathname: string, storage: Pick<Storage, 'getItem'>,
): { activationEmail: string } | null => {
  const routeMatch = pathname.match(/^\/ativacao-comercial\/([^/]+)\/?$/i);
  if (!routeMatch) return null;
  let routeToken = '';
  try {
    routeToken = decodeURIComponent(routeMatch[1]);
  } catch {
    routeToken = '';
  }
  const pendingToken = String(
    storage.getItem(SALES_ACTIVATION_OAUTH_PENDING_KEY) || '',
  ).trim();
  const activationEmail = String(
    storage.getItem('verto_activation_email') || '',
  ).trim().toLowerCase();

  if (!routeToken || pendingToken !== routeToken || !activationEmail) {
    return null;
  }
  return { activationEmail };
};
