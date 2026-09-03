import assert from 'node:assert/strict';
import express from 'express';
import {
  createSensitiveApiMutationProtectionMiddleware,
  isExternalPreAuthMutationPath,
} from '../src/utils/sensitiveApiMutationProtection.mjs';

const TRUSTED_ORIGIN = 'https://staging.appverto.com.br';
const PUBLIC_ID = 'd438e831-6293-4c95-b9c3-ffd5be9a49a7';
const GRANT_ID = '9a5bc709-efdc-4b45-af5d-119b7e2395b2';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

async function request(server, path, { method = 'POST', origin = TRUSTED_ORIGIN, headers = {}, body } = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, payload };
}

function legacySensitiveMiddleware(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const hasSessionCookie = String(req.headers.cookie || '').includes('verto-session=');
  const hasBearerAuth = String(req.headers.authorization || '').toLowerCase().startsWith('bearer ');
  if (hasSessionCookie || hasBearerAuth) return next();
  return res.status(403).json({ error: 'Requisição sensível sem autenticação válida.' });
}

function buildApp(middleware) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api', middleware);

  const reached = (label) => (req, res) => res.json({ reached: label, body: req.body || null });
  app.post('/api/external/evolution/:publicId/bootstrap', reached('bootstrap'));
  app.post('/api/external/evolution/:publicId/access-state', reached('access-state'));
  app.post('/api/external/evolution/:publicId/activate', reached('activate'));
  app.post('/api/external/evolution/:publicId/resend-access', reached('resend-access'));
  app.post('/api/external/auth/login', reached('login'));
  app.post('/api/external/auth/session', (req, res) => {
    if (!req.body?.accessToken) return res.status(401).json({ reached: 'auth-session', validatedAccessToken: false });
    return res.json({ reached: 'auth-session', validatedAccessToken: true });
  });

  app.patch('/api/external/auth/me', reached('profile'));
  app.post('/api/external/care-network/patients/:clinicId/:patientId/items/:grantId/view', reached('view'));
  app.post('/api/external/evolution/:publicId/comments', reached('comments'));
  app.post('/api/internal-sensitive', reached('internal-sensitive'));
  return app;
}

// BEFORE: reproduce the exact production boundary. No session/bearer means the request never reaches bootstrap.
{
  const server = await listen(buildApp(legacySensitiveMiddleware));
  try {
    const before = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`);
    assert.equal(before.status, 403);
    assert.equal(before.payload?.error, 'Requisição sensível sem autenticação válida.');
    assert.equal(before.payload?.reached, undefined);
  } finally {
    await close(server);
  }
}

const publicStateChangingPaths = new Set();
const middleware = createSensitiveApiMutationProtectionMiddleware({
  publicStateChangingPaths,
  isPublicSalesOfferMutation: () => false,
  configuredAppBase: () => TRUSTED_ORIGIN,
});

// The allowlist is explicit. There is no broad /external/* bypass.
assert.equal(isExternalPreAuthMutationPath(`/external/evolution/${PUBLIC_ID}/bootstrap`), true);
assert.equal(isExternalPreAuthMutationPath(`/external/evolution/${PUBLIC_ID}/access-state`), true);
assert.equal(isExternalPreAuthMutationPath(`/external/evolution/${PUBLIC_ID}/activate`), true);
assert.equal(isExternalPreAuthMutationPath(`/external/evolution/${PUBLIC_ID}/resend-access`), true);
assert.equal(isExternalPreAuthMutationPath('/external/auth/login'), true);
assert.equal(isExternalPreAuthMutationPath('/external/auth/session'), true);
assert.equal(isExternalPreAuthMutationPath(`/external/evolution/${PUBLIC_ID}/comments`), false);
assert.equal(isExternalPreAuthMutationPath(`/external/care-network/patients/a/b/items/${GRANT_ID}/view`), false);
assert.equal(isExternalPreAuthMutationPath('/external/auth/me'), false);
assert.equal(isExternalPreAuthMutationPath('/external/care-network'), false);

const server = await listen(buildApp(middleware));
try {
  // AFTER: trusted browser origin may reach only the explicit pre-auth handlers without an existing Verto session.
  for (const [path, label, body] of [
    [`/api/external/evolution/${PUBLIC_ID}/bootstrap`, 'bootstrap', { invitation: 'cookie-context-present' }],
    [`/api/external/evolution/${PUBLIC_ID}/access-state`, 'access-state', {}],
    [`/api/external/evolution/${PUBLIC_ID}/activate`, 'activate', { password: '12345678' }],
    [`/api/external/evolution/${PUBLIC_ID}/resend-access`, 'resend-access', {}],
    ['/api/external/auth/login', 'login', { email: 'partner@example.com', password: '12345678' }],
  ]) {
    const result = await request(server, path, { body });
    assert.equal(result.status, 200, `${label} should reach its handler`);
    assert.equal(result.payload?.reached, label);
  }

  const authSession = await request(server, '/api/external/auth/session', { body: { accessToken: 'verified-by-handler' } });
  assert.equal(authSession.status, 200);
  assert.equal(authSession.payload?.reached, 'auth-session');
  assert.equal(authSession.payload?.validatedAccessToken, true);

  const authSessionMissingToken = await request(server, '/api/external/auth/session', { body: {} });
  assert.equal(authSessionMissingToken.status, 401, 'middleware must allow the handler itself to reject a missing access token');
  assert.equal(authSessionMissingToken.payload?.reached, 'auth-session');
  assert.equal(authSessionMissingToken.payload?.validatedAccessToken, false);

  // Malicious browser origins are stopped before every pre-auth handler.
  const evil = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`, { origin: 'https://evil.example', body: {} });
  assert.equal(evil.status, 403);
  assert.equal(evil.payload?.error, 'Origem inválida para operação sensível.');
  assert.equal(evil.payload?.reached, undefined);

  // Referer may provide the same trusted-browser proof when Origin is absent.
  const refererOnly = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`, {
    origin: '',
    headers: { Referer: `${TRUSTED_ORIGIN}/evolucao-compartilhada/${PUBLIC_ID}` },
    body: {},
  });
  assert.equal(refererOnly.status, 200);
  assert.equal(refererOnly.payload?.reached, 'bootstrap');

  // Post-auth external mutations remain protected.
  for (const [path, method] of [
    ['/api/external/auth/me', 'PATCH'],
    [`/api/external/care-network/patients/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/items/${GRANT_ID}/view`, 'POST'],
    [`/api/external/evolution/${PUBLIC_ID}/comments`, 'POST'],
    ['/api/internal-sensitive', 'POST'],
  ]) {
    const blocked = await request(server, path, { method, body: {} });
    assert.equal(blocked.status, 403, `${method} ${path} must remain session-protected`);
    assert.equal(blocked.payload?.error, 'Requisição sensível sem autenticação válida.');
    assert.equal(blocked.payload?.reached, undefined);
  }

  // Existing cookie-authenticated behavior still requires same-origin proof.
  const cookieTrusted = await request(server, `/api/external/evolution/${PUBLIC_ID}/comments`, {
    headers: { Cookie: 'verto-session=fake-session' },
    body: {},
  });
  assert.equal(cookieTrusted.status, 200);
  assert.equal(cookieTrusted.payload?.reached, 'comments');

  const cookieEvil = await request(server, `/api/external/evolution/${PUBLIC_ID}/comments`, {
    origin: 'https://evil.example',
    headers: { Cookie: 'verto-session=fake-session' },
    body: {},
  });
  assert.equal(cookieEvil.status, 403);
  assert.equal(cookieEvil.payload?.error, 'Origem inválida para operação sensível.');
} finally {
  await close(server);
}

console.log('externalPreAuthMiddlewareP0_20260903.integration.test.mjs: PASS');
