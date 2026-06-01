import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice(marker: string, chars = 7000) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

function routeBetween(startMarker: string, endMarker: string) {
  const start = serverCode.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  const end = serverCode.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return serverCode.slice(start, end);
}

test('request-code retorna mensagem generica e invalida codigo antigo', () => {
  const route = routeSlice("app.post('/api/portal/auth/request-code'");
  assert.match(route, /genericResponse/);
  assert.match(route, /findAuthUserByEmail\(email\)/);
  assert.match(route, /await consumeOtpChallenge\(key\)/);
  assert.match(route, /purpose:\s*'portal_login'/);
  assert.match(route, /PORTAL_OTP_REQUESTED|OTP do portal solicitado/);
  assert.doesNotMatch(route, /return res\.status\(404\)/);
});

test('verify-code expira, limita tentativas e consome uso unico', () => {
  const route = routeBetween("app.post('/api/portal/auth/verify-code'", "app.post('/api/auth/password/recovery/verify'");
  assert.match(route, /getOtpChallenge\(key\)/);
  assert.match(route, /challenge\.attempts \+= 1/);
  assert.match(route, /challenge\.attempts > 5/);
  assert.match(route, /Date\.now\(\) > challenge\.expiresAt/);
  assert.match(route, /error:\s*'INVALID_CODE'/);
  assert.match(route, /portalVerified:\s*true/);
  assert.match(route, /accountState:\s*'PORTAL_VERIFIED'/);
  assert.match(route, /passwordStatus:\s*'PASSWORD_OPTIONAL'/);
  assert.match(route, /await consumeOtpChallenge\(key\)/);
  assert.match(route, /req\.session\.user = buildSessionUserPayload\(userData\)/);
  assert.doesNotMatch(route, /PATIENT_ACTIVATION_REQUIRED/);
});

test('portal login nao reutiliza fluxo de reset ou ativacao', () => {
  const requestRoute = routeSlice("app.post('/api/portal/auth/request-code'");
  const verifyRoute = routeBetween("app.post('/api/portal/auth/verify-code'", "app.post('/api/auth/password/recovery/verify'");
  assert.doesNotMatch(requestRoute, /password_recovery|getRecoveryRedirectUrl|buildPasswordRecoveryEmailTemplate/);
  assert.doesNotMatch(requestRoute, /activation_token|getActivationRedirectUrl|buildActivationEmailTemplate/);
  assert.doesNotMatch(verifyRoute, /newPassword|updateUserById\(challenge\.userId/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} portal OTP auth checks passed`);
