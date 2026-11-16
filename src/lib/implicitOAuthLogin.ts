// Only ordinary OAuth returns on the app root may use these implicit tokens.
// Signup, invite, recovery and commercial activation are handled by their own flows.
export const readImplicitLoginTokens = (href: string): {
  accessToken: string;
  refreshToken: string;
} | null => {
  try {
    const url = new URL(href);
    if (url.pathname !== '/' || url.searchParams.has('auth_action') ||
        url.searchParams.has('invitation_id') || url.searchParams.has('token_hash') ||
        url.searchParams.has('code') || url.searchParams.has('type')) return null;
    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (params.has('type') || params.has('token_hash') || params.has('error')) return null;
    const accessToken = params.get('access_token') || '';
    const refreshToken = params.get('refresh_token') || '';
    const tokenType = (params.get('token_type') || '').toLowerCase();
    if (!accessToken || !refreshToken || (tokenType && tokenType !== 'bearer')) return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
};

export const establishImplicitLoginSession = async (
  href: string,
  auth: { setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<any> },
): Promise<any | null> => {
  const tokens = readImplicitLoginTokens(href);
  if (!tokens) return null;
  // The Supabase SDK verifies/refreshes the tokens; only the backend authorizes
  // the user role, clinic membership and billing. Never trust the fragment for roles.
  const result = await auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  return !result?.error ? result?.data?.session || null : null;
};
