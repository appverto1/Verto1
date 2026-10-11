import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createAuthConfigHandler } from '../services/authConfigRouteHandler';

const serverText = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const route = "app.get('/api/auth/config', createAuthConfigHandler({ getAuthRedirectUrl, getRecoveryRedirectUrl, sanitizeString }))";
assert.ok(serverText.includes(route));
assert.equal(serverText.split("app.get('/api/auth/config'").length - 1, 1);
assert.ok(serverText.indexOf("app.post('/api/auth/signup-direct'") < serverText.indexOf(route));
assert.ok(serverText.indexOf(route) < serverText.indexOf("app.post('/api/auth/resend-confirmation'"));

const originalBase = process.env.VERTO_APP_BASE_URL;
const originalFallback = process.env.APP_BASE_URL;
let authCalls = 0;
let recoveryCalls = 0;
let reject = false;
const app = express();
app.get('/api/auth/config', createAuthConfigHandler({
  getAuthRedirectUrl: () => { authCalls++; if (reject) throw new Error('TEST_AUTH_REDIRECT_ERROR'); return 'https://test.invalid/auth'; },
  getRecoveryRedirectUrl: () => { recoveryCalls++; return 'https://test.invalid/recovery'; },
  sanitizeString: (value: any, max?: number) => { assert.equal(max, 500); return String(value ?? '').trim().slice(0, max); },
}));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const url = 'http://127.0.0.1:' + address.port + '/api/auth/config';
try {
  process.env.VERTO_APP_BASE_URL = 'https://app.example.invalid';
  process.env.APP_BASE_URL = 'https://fallback.example.invalid';
  let response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, authRedirectUrl: 'https://test.invalid/auth', recoveryRedirectUrl: 'https://test.invalid/recovery', productionBaseUrl: 'https://app.example.invalid' });
  assert.equal(authCalls, 1); assert.equal(recoveryCalls, 1);
  delete process.env.VERTO_APP_BASE_URL;
  response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).productionBaseUrl, 'https://fallback.example.invalid');
  reject = true;
  response = await fetch(url);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {success:false,error:'TEST_AUTH_REDIRECT_ERROR'});
  assert.equal(authCalls, 3); assert.equal(recoveryCalls, 2);
} finally {
  if (originalBase === undefined) delete process.env.VERTO_APP_BASE_URL;
  else process.env.VERTO_APP_BASE_URL = originalBase;
  if (originalFallback === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalFallback;
  server.close(); server.closeAllConnections();
}
console.log('authConfigRouteHandler.test.ts: PASS');
