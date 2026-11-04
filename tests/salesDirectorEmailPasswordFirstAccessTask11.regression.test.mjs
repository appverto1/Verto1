import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const landing = readFileSync('src/components/LandingPage.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const activation = ui.match(/const handlePasswordActivation = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const credentialLogin = ui.match(/const finishPasswordLogin = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const passwordRoute = server.match(/app\.post\(\s*"\/api\/public\/sales-activations\/:token\/password"[\s\S]*?const stripeSubscriptionToEntitlementStatus/)?.[0] || '';

test('director password is strong and confirmed before the single activation POST', () => {
  assert.match(ui, /if \(value\.length < 12\)/);
  assert.match(ui, /if \(value\.length > 128\)/);
  assert.match(ui, /if \(!\/\[A-Z\]\//);
  assert.match(ui, /if \(!\/\[a-z\]\//);
  assert.match(ui, /if \(!\/\\d\//);
  assert.match(ui, /if \(!\/\[\^A-Za-z0-9\]\//);
  assert.match(activation, /validateActivationPassword\(password\)/);
  assert.match(activation, /if \(password !== passwordConfirmation\)/);
  assert.match(activation, /if \(!passwordSaved\) \{[\s\S]*?fetch\([\s\S]*?\/password/);
  assert.match(activation, /credentials: 'omit'/);
  assert.match(activation, /body: JSON\.stringify\(\{ password \}\)/);
  assert.doesNotMatch(activation, /window\.location\.assign|checkout\.sessions\.create/);
});

test('password saved during this request stays saved even when login fails before React re-render', () => {
  assert.match(activation, /let passwordPersisted = passwordSaved;/);
  assert.match(activation, /if \(payload\?\.passwordSaved === true\) \{\s*passwordPersisted = true;\s*setPasswordSaved\(true\);/);
  assert.match(activation, /\} else \{\s*passwordPersisted = true;\s*setPasswordSaved\(true\);\s*setMessage\('Senha registrada/);
  assert.match(activation, /if \(payload\?\.passwordSaved !== true\) \{\s*throw new Error/);
  assert.match(activation, /await finishPasswordLogin\(\);/);
  assert.match(activation, /catch \(activationError: any\) \{\s*setError\(\s*passwordPersisted\s*\?/);
  assert.doesNotMatch(activation, /catch \(activationError: any\) \{\s*setError\(\s*passwordSaved\s*\?/);
  assert.match(ui, /passwordSaved\s*\? 'Entrar com a senha criada'/);
});

test('first director login uses backend credential authentication, never frontend role authority', () => {
  assert.match(credentialLogin, /provider: 'email'/);
  assert.match(credentialLogin, /passwordSetupCompleted: true/);
  assert.match(credentialLogin, /activationEmail: activation\.email/);
  assert.match(credentialLogin, /onLogin\(\s*null,\s*'director',\s*\{ email: activation\.email, password \}/);
  assert.match(credentialLogin, /if \(!serverLoginResult\?\.success\)/);
  assert.doesNotMatch(credentialLogin, /signInWithPassword|createUser|localStorage/);
  assert.match(landing, /supabase\.auth\.signInWithPassword\(\{\s*email,\s*password/);
  assert.match(landing, /onLogin\(data\.session, loginType/);
  assert.match(landing, /localStorage\.removeItem\('verto_password'\)/);
});

test('paid activation is bound server-side to the correct Director, clinic and exact contract', () => {
  assert.ok(passwordRoute, 'commercial password activation route must still exist');
  assert.match(passwordRoute, /role: "director"/);
  assert.match(passwordRoute, /ensureClinicAndMembershipForCoordinator\(authUser\.id, "director"\)/);
  assert.match(passwordRoute, /modules: loaded\.contractedModules/);
  assert.match(passwordRoute, /finalizeSalesActivationForUser\(/);
  assert.match(passwordRoute, /recoverablePartialActivation/);
  assert.match(passwordRoute, /activationOfferId === loaded\.offerId/);
  assert.match(passwordRoute, /profileEmail === loaded\.email/);
  assert.match(passwordRoute, /loaded\.activation\.used !== true/);
  assert.doesNotMatch(passwordRoute, /\.update\(\{ used: true \}\)/);
});
