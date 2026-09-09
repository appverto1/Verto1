import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createSensitiveApiMutationProtectionMiddleware,
  isExternalPreAuthMutationPath,
} from '../src/utils/sensitiveApiMutationProtection.mjs';

const TRUSTED_ORIGIN = 'https://staging.appverto.com.br';
const PUBLIC_ID = 'd438e831-6293-4c95-b9c3-ffd5be9a49a7';
const GRANT_ID = '9a5bc709-efdc-4b45-af5d-119b7e2395b2';

function expressLikeRequest(nodeReq) {
  const parsed = new URL(nodeReq.url || '/', 'http://localhost');
  const mountedPath = parsed.pathname.startsWith('/api') ? parsed.pathname.slice(4) || '/' : parsed.pathname;
  const cookieHeader = String(nodeReq.headers.cookie || '');
  return Object.assign(nodeReq, {
    path: mountedPath,
    protocol: 'https',
    cookies: cookieHeader.includes('verto-session=') ? { 'verto-session': 'present' } : {},
    get(name) { return String(name).toLowerCase() === 'host' ? String(nodeReq.headers.host || '') : undefined; },
  });
}

function expressLikeResponse(nodeRes) {
  let statusCode = 200;
  return {
    status(code) { statusCode = code; return this; },
    json(payload) {
      nodeRes.statusCode = statusCode;
      nodeRes.setHeader('Content-Type', 'application/json');
      nodeRes.end(JSON.stringify(payload));
      return this;
    },
  };
}

function legacySensitiveMiddleware(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const hasSessionCookie = Boolean((req.cookies && req.cookies['verto-session']) || String(req.headers.cookie || '').includes('verto-session='));
  const hasBearerAuth = String(req.headers.authorization || '').toLowerCase().startsWith('bearer ');
  if (hasSessionCookie || hasBearerAuth) return next();
  return res.status(403).json({ error: 'Requisição sensível sem autenticação válida.' });
}

const currentMiddleware = createSensitiveApiMutationProtectionMiddleware({
  publicStateChangingPaths: new Set(),
  isPublicSalesOfferMutation: () => false,
  configuredAppBase: () => TRUSTED_ORIGIN,
});

function routeLabel(path, method) {
  if (method === 'POST' && new RegExp(`^/api/external/evolution/${PUBLIC_ID}/bootstrap$`).test(path)) return 'bootstrap';
  if (method === 'POST' && new RegExp(`^/api/external/evolution/${PUBLIC_ID}/access-state$`).test(path)) return 'access-state';
  if (method === 'POST' && new RegExp(`^/api/external/evolution/${PUBLIC_ID}/activate$`).test(path)) return 'activate';
  if (method === 'POST' && new RegExp(`^/api/external/evolution/${PUBLIC_ID}/resend-access$`).test(path)) return 'resend-access';
  if (method === 'POST' && path === '/api/external/auth/login') return 'login';
  if (method === 'POST' && path === '/api/external/auth/session') return 'auth-session';
  if (method === 'PATCH' && path === '/api/external/auth/me') return 'profile';
  if (method === 'POST' && path.includes('/api/external/care-network/patients/') && path.endsWith(`/items/${GRANT_ID}/view`)) return 'view';
  if (method === 'POST' && path === `/api/external/evolution/${PUBLIC_ID}/comments`) return 'comments';
  if (method === 'POST' && path === '/api/internal-sensitive') return 'internal-sensitive';
  return null;
}

function createServer(middleware) {
  return http.createServer((nodeReq, nodeRes) => {
    const req = expressLikeRequest(nodeReq);
    const res = expressLikeResponse(nodeRes);
    middleware(req, res, () => {
      const path = new URL(nodeReq.url || '/', 'http://localhost').pathname;
      const label = routeLabel(path, String(nodeReq.method || '').toUpperCase());
      if (!label) {
        nodeRes.statusCode = 404;
        return nodeRes.end(JSON.stringify({ error: 'not-found' }));
      }
      nodeRes.statusCode = 200;
      nodeRes.setHeader('Content-Type', 'application/json');
      return nodeRes.end(JSON.stringify({ reached: label }));
    });
  });
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

async function request(server, path, { method = 'POST', origin = TRUSTED_ORIGIN, referer = '', cookie = '', authorization = '' } = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(referer ? { Referer: referer } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

// BEFORE: exact old boundary — request is rejected before the bootstrap handler.
{
  const server = createServer(legacySensitiveMiddleware);
  await listen(server);
  try {
    const before = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`);
    assert.equal(before.status, 403);
    assert.equal(before.payload?.error, 'Requisição sensível sem autenticação válida.');
    assert.equal(before.payload?.reached, undefined);
  } finally {
    await close(server);
  }
}

// Explicit allowlist: never a broad /external/* bypass.
for (const path of [
  `/external/evolution/${PUBLIC_ID}/bootstrap`,
  `/external/evolution/${PUBLIC_ID}/access-state`,
  `/external/evolution/${PUBLIC_ID}/activate`,
  `/external/evolution/${PUBLIC_ID}/resend-access`,
  '/external/auth/login',
  '/external/auth/session',
]) assert.equal(isExternalPreAuthMutationPath(path), true);
for (const path of [
  `/external/evolution/${PUBLIC_ID}/comments`,
  `/external/care-network/patients/a/b/items/${GRANT_ID}/view`,
  '/external/auth/me',
  '/external/care-network',
]) assert.equal(isExternalPreAuthMutationPath(path), false);

const server = createServer(currentMiddleware);
await listen(server);
try {
  // AFTER: same-origin pre-auth mutations reach their own handlers without verto-session/Bearer.
  for (const [path, label] of [
    [`/api/external/evolution/${PUBLIC_ID}/bootstrap`, 'bootstrap'],
    [`/api/external/evolution/${PUBLIC_ID}/access-state`, 'access-state'],
    [`/api/external/evolution/${PUBLIC_ID}/activate`, 'activate'],
    [`/api/external/evolution/${PUBLIC_ID}/resend-access`, 'resend-access'],
    ['/api/external/auth/login', 'login'],
    ['/api/external/auth/session', 'auth-session'],
  ]) {
    const result = await request(server, path);
    assert.equal(result.status, 200, `${label} must reach handler`);
    assert.equal(result.payload?.reached, label);
  }

  const malicious = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`, { origin: 'https://evil.example' });
  assert.equal(malicious.status, 403);
  assert.equal(malicious.payload?.error, 'Origem inválida para operação sensível.');

  const refererOnly = await request(server, `/api/external/evolution/${PUBLIC_ID}/bootstrap`, {
    origin: '', referer: `${TRUSTED_ORIGIN}/evolucao-compartilhada/${PUBLIC_ID}`,
  });
  assert.equal(refererOnly.status, 200);
  assert.equal(refererOnly.payload?.reached, 'bootstrap');

  const wrongMethod = await request(server, '/api/external/auth/login', { method: 'PATCH' });
  assert.equal(wrongMethod.status, 403, 'only POST is pre-auth');
  assert.equal(wrongMethod.payload?.error, 'Requisição sensível sem autenticação válida.');

  for (const [path, method] of [
    ['/api/external/auth/me', 'PATCH'],
    [`/api/external/care-network/patients/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/items/${GRANT_ID}/view`, 'POST'],
    [`/api/external/evolution/${PUBLIC_ID}/comments`, 'POST'],
    ['/api/internal-sensitive', 'POST'],
  ]) {
    const blocked = await request(server, path, { method });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload?.error, 'Requisição sensível sem autenticação válida.');
    assert.equal(blocked.payload?.reached, undefined);
  }

  const protectedTrusted = await request(server, `/api/external/evolution/${PUBLIC_ID}/comments`, { cookie: 'verto-session=fake' });
  assert.equal(protectedTrusted.status, 200);
  assert.equal(protectedTrusted.payload?.reached, 'comments');

  const protectedEvil = await request(server, `/api/external/evolution/${PUBLIC_ID}/comments`, { cookie: 'verto-session=fake', origin: 'https://evil.example' });
  assert.equal(protectedEvil.status, 403);
  assert.equal(protectedEvil.payload?.error, 'Origem inválida para operação sensível.');

  const bearer = await request(server, '/api/internal-sensitive', { origin: 'https://evil.example', authorization: 'Bearer test' });
  assert.equal(bearer.status, 200, 'existing non-cookie bearer contract remains unchanged');
  assert.equal(bearer.payload?.reached, 'internal-sensitive');
} finally {
  await close(server);
}

console.log('externalPreAuthMiddlewareHttpP0_20260903.integration.test.mjs: PASS');
