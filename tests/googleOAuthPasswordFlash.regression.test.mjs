import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const activationExpression = app.match(/  const hasSupabaseAuthReturnParams = ([\s\S]*?)\n  const isAuthActionRoute =/)?.[1];
const pendingBody = app.match(/const \[oauthCallbackPending, setOauthCallbackPending\] = useState\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert.ok(activationExpression, 'activation callback classifier must exist');
assert.ok(pendingBody, 'initial OAuth callback render guard must exist');

const classifyActivation = new Function('window', 'authAction',
  'return (' + activationExpression.trim().replace(/;$/, '') + ');');
const classifyPending = new Function(
  'window', 'isAuthActionRoute', 'isExternalPartnerRoute',
  'isExternalEvolutionRoute', 'isExternalCareNetworkRoute', 'isExternalCarePatientRoute', pendingBody);

function route(urlText) {
  const url = new URL(urlText, 'https://staging.example.invalid');
  const browser = { location: { pathname: url.pathname, search: url.search, hash: url.hash } };
  const action = String(url.searchParams.get('auth_action') || '').toLowerCase();
  const explicitRoute = ['/ativar', '/reset-password'].includes(url.pathname) ||
    ['activate', 'recovery', 'accept_invitation'].includes(action);
  const activationParams = Boolean(classifyActivation(browser, action));
  const isAuthActionRoute = explicitRoute || activationParams;
  const isExternalPartnerRoute = url.pathname === '/parcerias';
  const oauthPending = Boolean(classifyPending(browser, isAuthActionRoute,
    isExternalPartnerRoute, false, false, false));
  return { activationParams, oauthPending };
}

test('normal Google PKCE and implicit callbacks never select password activation', () => {
  assert.deepEqual(route('/?code=google-pkce'), { activationParams: false, oauthPending: true });
  assert.deepEqual(route('/#access_token=oauth&refresh_token=refresh'), { activationParams: false, oauthPending: true });
});

test('paid Google Director return hides the password page until auth completes', () => {
  assert.deepEqual(route('/ativacao-comercial/offer-token?code=google-pkce'),
    { activationParams: false, oauthPending: true });
  assert.match(app, /if \(loading \|\| oauthCallbackPending\) \{/);
  assert.match(app, /setOauthCallbackPending\(false\);\s*setLoading\(false\);/);
  assert.match(app, /isSalesActivationRoute && !user \? \(\s*<SalesActivationAccess/);
});

test('genuine invitations, signup and recovery retain their activation UI', () => {
  assert.deepEqual(route('/?auth_action=activate&invitation_id=invite-id&code=activation-code'),
    { activationParams: true, oauthPending: false });
  assert.deepEqual(route('/?type=invite&token_hash=invite-token'),
    { activationParams: true, oauthPending: false });
  assert.deepEqual(route('/?type=signup&access_token=signup-token'),
    { activationParams: true, oauthPending: false });
  assert.deepEqual(route('/reset-password?code=recovery-code'),
    { activationParams: false, oauthPending: false });
});

test('partner Google OAuth remains owned by its isolated portal', () => {
  assert.deepEqual(route('/parcerias?code=partner-oauth'),
    { activationParams: false, oauthPending: false });
});
