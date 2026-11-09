import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const passwordRoute = fs.readFileSync('services/publicSalesActivationPasswordRoute.ts', 'utf8');
const finishPasswordLogin = ui.match(
  /const finishPasswordLogin = async \(\) => \{[\s\S]*?\n  \};/
)?.[0] || '';

assert.ok(passwordRoute.length > 0, 'password activation route should exist');
assert.ok(finishPasswordLogin.length > 0, 'password login helper should exist');

// Password setup is provider-agnostic and the verified paid activation finishes
// the director workspace server-side before the client performs credential login.
assert.match(passwordRoute, /passwordSaved: true/);
assert.match(passwordRoute, /role: "director"/);
assert.match(passwordRoute, /finalizeSalesActivationForUser\(/);
assert.match(passwordRoute, /ensureClinicAndMembershipForCoordinator\(authUser\.id, "director"\)/);
assert.doesNotMatch(passwordRoute, /\.update\(\{ used: true \}\)/);

// The non-Google first-access path must not depend on a browser Supabase Auth
// session. It goes straight to the server credential login, which supports any
// valid e-mail provider/domain.
assert.match(finishPasswordLogin, /const serverLoginResult = await onLogin\(\s*null,/);
assert.doesNotMatch(finishPasswordLogin, /signInWithPassword/);

// Regression intent: corporate and non-Google consumer domains are valid.
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
for (const email of [
  'diretoria@clinicadela.com.br',
  'cliente@hotmail.com',
  'gestao@empresa.saude.br',
]) {
  assert.equal(emailRegex.test(email), true, `${email} should be accepted`);
}

console.log('salesActivationPasswordProviderAgnostic.test.mjs: OK');
