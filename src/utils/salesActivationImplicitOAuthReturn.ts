// Restore the legacy implicit Google return only for the pending paid Director
// activation. Normal routes and PKCE code exchanges keep their existing owner.
// This check is UX context only: /api/auth/login still verifies the identity,
// paid contract, role and clinic before authorizing any access.
export const shouldDetectSalesActivationImplicitOAuthReturn = (
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  storage: Pick<Storage, 'getItem'>,
): boolean => {
  try {
    const route = String(location.pathname || '').match(/^\/ativacao-comercial\/([^/]+)\/?$/i);
    if (!route || new URLSearchParams(location.search || '').has('code')) return false;

    const routeToken = decodeURIComponent(route[1]);
    if (!routeToken ||
        storage.getItem('verto_sales_activation_oauth_pending') !== routeToken ||
        !String(storage.getItem('verto_activation_email') || '').trim()) return false;

    const fragment = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    return Boolean(fragment.get('access_token') && fragment.get('refresh_token'));
  } catch {
    // Blocked storage, malformed links and empty fragments must fail closed.
    return false;
  }
};
