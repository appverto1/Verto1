import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');
const server = read('server.ts');
const landing = read('src/components/LandingPage.tsx');
const migration = read('supabase/migrations/20260723123000_owner_mfa_contract.sql');

const securityLookup =
  server.match(/async function fetchMfaSecurityProfile[\s\S]*?\n}/)?.[0] || '';
const loginRoute =
  server.match(/app\.post\('\/api\/auth\/login'[\s\S]*?app\.post\('\/api\/auth\/logout'/)?.[0] || '';
const mfaRoute =
  server.match(/app\.post\('\/api\/auth\/2fa\/login'[\s\S]*?const registerUserWithEmailConfirmation/)?.[0] || '';
const checkAuthBlock =
  server.match(/const checkAuth = async[\s\S]*?\n  const checkPatientAccess/)?.[0] || '';

test('MFA migration reconciles the canonical columns without enabling owners automatically', () => {
  assert.match(migration, /add column if not exists two_factor_enabled boolean not null default false/);
  assert.match(migration, /add column if not exists two_factor_secret text/);
  assert.match(migration, /create table if not exists public\.auth_mfa_challenges/);
  assert.match(migration, /alter table public\.auth_mfa_challenges enable row level security/);
  assert.match(migration, /revoke all on table public\.auth_mfa_challenges from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.auth_mfa_challenges to service_role/);
  assert.doesNotMatch(migration, /set\s+two_factor_enabled\s*=\s*true/i);
  assert.doesNotMatch(migration, /set\s+two_factor_secret\s*=/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\.users/i);
});

test('privileged security lookup is exact and fail-closed instead of schema fallback', () => {
  assert.match(securityLookup, /\.select\('id,role,two_factor_enabled,two_factor_secret'\)/);
  assert.doesNotMatch(securityLookup, /fetchProfileWithSchemaFallback|removeMissing/);
  assert.match(loginRoute, /OWNER_MFA_SCHEMA_UNAVAILABLE/);
  assert.match(loginRoute, /securityProfileResult\.error \|\| !securityProfile/);
});

test('owner identity cannot be downgraded by a clinic workspace before MFA', () => {
  assert.match(server, /canonicalInputRole === 'owner'[\s\S]{0,80}\? 'owner'/);
  assert.match(loginRoute, /const isOwnerLogin = \[[\s\S]*profile\?\.role[\s\S]*securityProfile\?\.role/);
  assert.match(checkAuthBlock, /canonicalProfileRole === 'owner'/);
  assert.match(checkAuthBlock, /OWNER_MFA_REQUIRED/);
});

test('password validation creates a short-lived opaque setup or login challenge', () => {
  assert.match(loginRoute, /signInWithPassword/);
  assert.match(loginRoute, /createAuthMfaChallenge/);
  assert.match(server, /const AUTH_MFA_CHALLENGE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(server, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(server, /createHmac\('sha256', secret\)\.update\(challengeId\)/);
  assert.match(server, /setup_secret_encrypted/);
  assert.doesNotMatch(loginRoute, /two_factor_secret:\s*generateSecret/);
});

test('TOTP verification requires challengeId, is rate limited and one-use', () => {
  assert.match(mfaRoute, /req\.body\?\.challengeId/);
  assert.doesNotMatch(mfaRoute, /req\.body\?\.email/);
  assert.match(mfaRoute, /AUTH_MFA_MAX_ATTEMPTS/);
  assert.match(mfaRoute, /\.eq\('attempts', currentAttempts\)/);
  assert.match(mfaRoute, /\.is\('consumed_at', null\)/);
  assert.match(mfaRoute, /MFA_CHALLENGE_ALREADY_USED/);
  assert.match(mfaRoute, /verifySync\(\{ token, secret \}\)\.valid/);
});

test('owner session is created only after TOTP and carries server-validated MFA claims', () => {
  const consumeIndex = mfaRoute.indexOf(".update({ consumed_at: new Date().toISOString() })");
  const sessionIndex = mfaRoute.indexOf('req.session.user = userData');
  assert.ok(consumeIndex >= 0 && sessionIndex > consumeIndex);
  assert.match(mfaRoute, /mfaVerified: true/);
  assert.match(mfaRoute, /mfaVerifiedAt: verifiedAt/);
  assert.match(mfaRoute, /mfaMethod: 'totp'/);
  assert.match(mfaRoute, /regenerateExpressSession\(req\)/);
  assert.match(server, /function hasVerifiedOwnerMfaSession/);
  assert.match(server, /mfaMethod[\s\S]{0,80}'totp'/);
});

test('legacy owner cookies and bearer tokens cannot enter owner routes', () => {
  assert.match(checkAuthBlock, /!hasVerifiedOwnerMfaSession\(req\.session\.user\)/);
  assert.match(checkAuthBlock, /invalidateActiveSession/);
  assert.match(checkAuthBlock, /req\.session\.destroy/);
  assert.match(checkAuthBlock, /canonicalProfileRole === 'owner'/);
  assert.match(server, /const OWNER_MFA_POLICY_VERSION = '2026-07-23-v1'/);
  assert.match(checkAuthBlock, /authPolicyVersion !== OWNER_MFA_POLICY_VERSION/);
  assert.match(checkAuthBlock, /fetchMfaSecurityProfile\(sessionUserId\)/);
  assert.match(checkAuthBlock, /legacySecurityProfile\.data\.role/);
  assert.match(server, /const checkOwner =[\s\S]*hasVerifiedOwnerMfaSession/);
});

test('owner bootstrap exposes only a QR code and enables MFA after a valid code', () => {
  assert.match(loginRoute, /twoFactorSetupRequired: purpose === 'setup'/);
  assert.match(loginRoute, /qrCodeUrl: challenge\.qrCodeUrl/);
  assert.doesNotMatch(loginRoute, /two_factor_secret\s*:/);
  const enableIndex = mfaRoute.indexOf("two_factor_enabled: true");
  const verifyIndex = mfaRoute.indexOf('verifySync({ token, secret }).valid');
  assert.ok(verifyIndex >= 0 && enableIndex > verifyIndex);
  assert.match(server, /const MFA_STORED_SECRET_PREFIX = 'enc:v1:'/);
  assert.match(mfaRoute, /two_factor_secret: encryptStoredMfaSecret\(secret\)/);
  assert.match(mfaRoute, /!isEncryptedStoredMfaSecret\(securityProfile\.two_factor_secret\)/);
  assert.match(migration, /encrypted by the application/);
});

test('enabled MFA with an unreadable secret fails closed instead of starting a new setup', () => {
  assert.match(loginRoute, /securityMfaEnabled && !resolvedSecurityMfaSecret/);
  assert.match(loginRoute, /MFA_CONFIGURATION_INVALID/);
  assert.match(loginRoute, /const purpose = hasConfiguredMfa \? 'login' : 'setup'/);
});

test('frontend submits challenge plus TOTP and never reloads or sends email as MFA proof', () => {
  const verifyHandler =
    landing.match(/const handle2FALogin = async[\s\S]*?\n  };/)?.[0] || '';
  assert.match(verifyHandler, /challengeId: twoFactorChallengeId/);
  assert.doesNotMatch(verifyHandler, /email:/);
  assert.doesNotMatch(verifyHandler, /window\.location\.reload/);
  assert.match(landing, /QR Code para configurar o Google Authenticator/);
  assert.doesNotMatch(landing, /setTempSecret|data\.secret/);
});

test('password recovery uses the same exact MFA contract and fails closed for owner', () => {
  assert.match(server, /fetchMfaSecurityProfile\(challenge\.userId\)/);
  assert.match(server, /const recoveryMfaSecret = resolveStoredMfaSecret\(securityProfile\.two_factor_secret\)/);
  assert.match(server, /OWNER_MFA_CONFIGURATION_REQUIRED/);
  assert.match(server, /MFA_CONFIGURATION_INVALID/);
});
