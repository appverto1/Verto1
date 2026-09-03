const externalEvolutionPreAuthPattern = /^\/external\/evolution\/[^/]+\/(bootstrap|access-state|activate|resend-access)$/;
const externalAuthPreAuthPattern = /^\/external\/auth\/(login|session)$/;

export function isExternalPreAuthMutationPath(pathname) {
  const path = typeof pathname === 'string' ? pathname : '';
  return externalEvolutionPreAuthPattern.test(path) || externalAuthPreAuthPattern.test(path);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value.trim()).origin.toLowerCase();
  } catch {
    return '';
  }
}

export function resolveTrustedBrowserOriginState(req, configuredAppBase = '') {
  const rawOrigin = typeof req?.headers?.origin === 'string' ? req.headers.origin.slice(0, 500) : '';
  const rawReferer = typeof req?.headers?.referer === 'string' ? req.headers.referer.slice(0, 1000) : '';
  const protocol = typeof req?.protocol === 'string' && req.protocol ? req.protocol : 'http';
  const host = typeof req?.get === 'function'
    ? String(req.get('host') || '')
    : String(req?.headers?.host || '');
  const expected = host ? `${protocol}://${host}` : '';

  const allowedOrigins = new Set();
  const expectedOrigin = normalizeOrigin(expected);
  const configuredOrigin = normalizeOrigin(configuredAppBase);
  if (expectedOrigin) allowedOrigins.add(expectedOrigin);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const requestOrigin = normalizeOrigin(rawOrigin);
  const refererOrigin = normalizeOrigin(rawReferer);
  return {
    originAllowed: Boolean(requestOrigin && allowedOrigins.has(requestOrigin)),
    refererAllowed: Boolean(refererOrigin && allowedOrigins.has(refererOrigin)),
  };
}

export function createSensitiveApiMutationProtectionMiddleware({
  publicStateChangingPaths = new Set(),
  isPublicSalesOfferMutation = () => false,
  configuredAppBase = () => process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '',
} = {}) {
  return (req, res, next) => {
    const method = String(req?.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const path = String(req?.path || '');
    if (path === '/stripe/webhook') return next();
    if (publicStateChangingPaths.has(path) || isPublicSalesOfferMutation(path)) return next();

    const { originAllowed, refererAllowed } = resolveTrustedBrowserOriginState(
      req,
      typeof configuredAppBase === 'function' ? configuredAppBase() : configuredAppBase,
    );

    if (method === 'POST' && isExternalPreAuthMutationPath(path)) {
      if (originAllowed || refererAllowed) return next();
      return res.status(403).json({ error: 'Origem inválida para operação sensível.' });
    }

    const hasSessionCookie = Boolean(
      (req?.cookies && req.cookies['verto-session']) ||
      String(req?.headers?.cookie || '').includes('verto-session='),
    );
    const hasBearerAuth = String(req?.headers?.authorization || '').toLowerCase().startsWith('bearer ');

    if (hasSessionCookie) {
      if (!originAllowed && !refererAllowed) {
        return res.status(403).json({ error: 'Origem inválida para operação sensível.' });
      }
      return next();
    }

    if (hasBearerAuth) return next();

    return res.status(403).json({ error: 'Requisição sensível sem autenticação válida.' });
  };
}
