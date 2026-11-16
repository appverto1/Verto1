import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  beginExplicitPasswordSignIn,
  rememberExplicitPasswordSession,
  finishExplicitPasswordSignIn,
  isExplicitPasswordSignInEvent,
  isExplicitPasswordSignInInProgress,
} from '../src/lib/explicitClinicalPasswordLogin.ts';

const app = readFileSync('src/App.tsx', 'utf8');
const landing = readFileSync('src/components/LandingPage.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// Runtime: A password SIGNED_IN event is not a second portal login,
// regardless of the long-lived app_metadata provider for this identity.
assert.equal(isExplicitPasswordSignInInProgress(), false);
assert.equal(isExplicitPasswordSignInEvent('signed-in-token-a'), false);
beginExplicitPasswordSignIn();
assert.equal(isExplicitPasswordSignInInProgress(), true);
assert.equal(isExplicitPasswordSignInEvent('signed-in-token-a'), true);
rememberExplicitPasswordSession('signed-in-token-a');
finishExplicitPasswordSignIn(true);
assert.equal(isExplicitPasswordSignInInProgress(), false);
assert.equal(isExplicitPasswordSignInEvent('signed-in-token-a'), true);
assert.equal(isExplicitPasswordSignInEvent('oauth-token-b'), false);

// A new sign-in discards the old marker; a failed attempt cannot suppress
// a future distinct Google/SSO login.
beginExplicitPasswordSignIn();
finishExplicitPasswordSignIn(false);
assert.equal(isExplicitPasswordSignInEvent('signed-in-token-a'), false);
assert.equal(isExplicitPasswordSignInEvent('oauth-token-b'), false);

// If server authorization rejects a password login *after* Supabase has
// issued a session, its async SIGNED_IN notification must not silently
// retry through a different portal.
beginExplicitPasswordSignIn();
rememberExplicitPasswordSession('denied-portal-session');
finishExplicitPasswordSignIn(true);
assert.equal(isExplicitPasswordSignInEvent('denied-portal-session'), true);
beginExplicitPasswordSignIn();
rememberExplicitPasswordSession('new-explicit-session');
finishExplicitPasswordSignIn(true);
assert.equal(isExplicitPasswordSignInEvent('denied-portal-session'), false);
assert.equal(isExplicitPasswordSignInEvent('new-explicit-session'), true);

const formStart = landing.indexOf('const handleLogin = async');
const formEnd = landing.indexOf('const handleResendConfirmation', formStart);
const form = landing.slice(formStart, formEnd);
assert.ok(formStart !== -1 && formEnd > formStart);
const before = (a, b) => {
  const ai = form.indexOf(a);
  const bi = form.indexOf(b);
  assert.ok(ai >= 0 && bi > ai, a + ' must precede ' + b);
};
assert.match(form, /if \(passwordLoginSubmittingRef\.current\) return;/);
assert.match(form, /passwordLoginSubmittingRef\.current = true;/);
assert.match(form, /finally \{[\s\S]*?passwordLoginSubmittingRef\.current = false;/);
before('beginExplicitPasswordSignIn();', 'supabase.auth.signInWithPassword({');
before('rememberExplicitPasswordSession(data.session.access_token);', 'const loginRes = await onLogin(');
assert.match(form, /finally \{\s*finishExplicitPasswordSignIn\(passwordSessionIssued\);/);

const signedIn = app.slice(app.indexOf("if (event === 'SIGNED_IN' && session)"), app.indexOf("} else if (event === 'SIGNED_OUT')"));
assert.match(signedIn, /if \(!patientOAuthPending && isExplicitPasswordSignInEvent\(session\.access_token\)\) return;/);
assert.match(signedIn, /const professionalOAuthPending = explicitClinicalOAuthPortal === 'professional';/);
assert.match(signedIn, /const authProvider = patientOAuthPending \|\| professionalOAuthPending\s*\? 'google'/);
assert.match(signedIn, /provider: patientOAuthPending \|\| professionalOAuthPending \? 'google'/);
assert.ok(signedIn.indexOf('isExplicitPasswordSignInEvent(session.access_token)') < signedIn.indexOf('const authProvider ='), 'event guard must precede inference from persistent user metadata');
assert.ok(signedIn.indexOf('isExplicitPasswordSignInEvent(session.access_token)') < signedIn.indexOf('await handleLoginSuccess(session, intendedRole'), 'password sign-in notification must not issue a second server token');

const boot = app.slice(app.indexOf('const checkSession = async () => {'), app.indexOf('checkSession();', app.indexOf('const checkSession = async () => {')));
assert.match(boot, /const explicitOAuthIntentAtBootstrap = readClinicalPortalOAuthIntent\(window\.sessionStorage\);/);
assert.match(boot, /if \(explicitOAuthIntentAtBootstrap \|\|\s*readClinicalPortalOAuthIntent\(window\.sessionStorage\) \|\|\s*isExplicitPasswordSignInEvent\(session\?\.access_token\)/);
assert.ok(boot.indexOf('explicitOAuthIntentAtBootstrap ||') < boot.indexOf('const loginRes = await handleLoginSuccess(session'), 'OAuth callback must own login instead of racing restoration');

// Neither the database-backed single active session policy nor the clinic
// selection guard can be bypassed by this frontend-only coordination.
assert.match(server, /if \(!activeSessionValid\) \{[\s\S]*?error: 'SESSION_REVOKED'/);
assert.match(server, /app\.post\('\/api\/access-contexts\/select'/);
assert.match(server, /app\.post\('\/api\/auth\/login', authLoginLimiter/);
assert.match(app, /serverLoginInFlightRef\.current\?\.key === loginRequestBody/);
console.log('stagingExplicitLoginRace.regression.test.mjs: OK');
