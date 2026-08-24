import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../services/distributedRuntimeState.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260822011500_runtime_active_session_validator_v2.sql', import.meta.url),
  'utf8'
);

const currentRevokeStart = runtime.indexOf('export async function revokeDistributedSessionToken');
const revokeAllStart = runtime.indexOf('export async function revokeAllDistributedSessionTokens');
assert.ok(currentRevokeStart >= 0 && revokeAllStart > currentRevokeStart, 'current and global revocation functions must both exist');
const currentRevoke = runtime.slice(currentRevokeStart, revokeAllStart);
const revokeAll = runtime.slice(revokeAllStart, runtime.indexOf('export async function tryAcquireDistributedJobLease', revokeAllStart));
assert.match(currentRevoke, /expectedToken: string/);
assert.match(currentRevoke, /\.eq\('user_id', userId\)[\s\S]*?\.eq\('token_hash', hashRuntimeSessionToken\(expectedToken\)\)/);
assert.doesNotMatch(revokeAll, /token_hash/);
assert.match(revokeAll, /\.eq\('user_id', userId\)/);

assert.match(migration, /create or replace function public\.runtime_validate_active_session_v2/);
assert.match(migration, /\n  for update;/);
assert.doesNotMatch(migration, /\n  for share;/);
assert.match(migration, /revoke all on function public\.runtime_validate_active_session_v2\(text, text\) from public, anon, authenticated;/);
assert.match(migration, /grant execute on function public\.runtime_validate_active_session_v2\(text, text\) to service_role;/);

const mfaStart = server.indexOf("app.post('/api/auth/2fa/login'");
const mfaEnd = server.indexOf('const registerUserWithEmailConfirmation', mfaStart);
const mfaRoute = server.slice(mfaStart, mfaEnd);
assert.ok(mfaStart >= 0 && mfaEnd > mfaStart, 'MFA login route must exist');
assert.ok(
  mfaRoute.indexOf('await hydrateSessionUserWithOnboardingContext') < mfaRoute.indexOf('await issueSessionToken(boundUserId)'),
  'MFA must hydrate before issuing the authoritative session token'
);
assert.ok(
  mfaRoute.indexOf('await regenerateExpressSession(req)') < mfaRoute.indexOf('await issueSessionToken(boundUserId)'),
  'MFA must regenerate the Express session before issuing the authoritative token'
);
assert.match(mfaRoute, /await invalidateCurrentSession\(issuedSessionUserId, issuedSessionToken\)/);

const portalStart = server.indexOf("app.post('/api/portal/auth/verify-code'");
const portalEnd = server.indexOf("app.post('/api/auth/password/recovery/verify'", portalStart);
const portalRoute = server.slice(portalStart, portalEnd);
assert.ok(portalStart >= 0 && portalEnd > portalStart, 'portal verify route must exist');
assert.ok(
  portalRoute.indexOf('await hydrateSessionUserWithOnboardingContext(userData)') < portalRoute.indexOf('await issueSessionToken(issuedSessionUserId)'),
  'portal must hydrate before issuing the authoritative session token'
);
assert.match(portalRoute, /const challengeConsumed = await consumeOtpChallenge\(key\);/);
assert.match(portalRoute, /if \(!challengeConsumed\) return res\.status\(400\)\.json\(genericError\);/);
assert.match(portalRoute, /await invalidateCurrentSession\(issuedSessionUserId, issuedSessionToken\)/);

const loginStart = server.indexOf("app.post('/api/auth/login'");
const loginEnd = server.indexOf("app.post('/api/auth/logout'", loginStart);
const loginRoute = server.slice(loginStart, loginEnd);
assert.ok(loginStart >= 0 && loginEnd > loginStart, 'normal login route must exist');
assert.ok(
  loginRoute.indexOf('const sessionUser = await hydrateSessionUserWithOnboardingContext(userData)') < loginRoute.indexOf('issuedSessionToken = await issueSessionToken(issuedSessionUserId)'),
  'normal login must hydrate before issuing the authoritative session token'
);
assert.match(loginRoute, /await invalidateCurrentSession\(issuedSessionUserId, issuedSessionToken\)/);

const recoveryStart = server.indexOf("app.post('/api/auth/password/recovery/verify'");
const recoveryEnd = server.indexOf('// --- AUTH ROUTES ---', recoveryStart);
const recoveryRoute = server.slice(recoveryStart, recoveryEnd);
assert.match(recoveryRoute, /await invalidateAllActiveSessions\(challenge\.userId\)/);
assert.doesNotMatch(recoveryRoute, /invalidateCurrentSession\(challenge\.userId/);
const passwordUpdateIndex = recoveryRoute.indexOf('await supabase.auth.admin.updateUserById(challenge.userId');
const revokeIndexes = [...recoveryRoute.matchAll(/await invalidateAllActiveSessions\(challenge\.userId\)/g)].map((match) => match.index ?? -1);
assert.equal(revokeIndexes.length, 2, 'password recovery must revoke Verto sessions before and after Auth password rotation');
assert.ok(revokeIndexes[0] < passwordUpdateIndex && passwordUpdateIndex < revokeIndexes[1]);

console.log('distributedSessionSafety.regression.test.mjs: ok');
