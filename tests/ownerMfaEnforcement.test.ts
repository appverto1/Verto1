import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260723123000_owner_mfa_contract.sql',
  'utf8'
);

assert.match(server, /const OWNER_MFA_POLICY_VERSION = '2026-07-23-v1'/);
assert.match(server, /function hasVerifiedOwnerMfaSession/);
assert.match(server, /const checkOwner = checkPlatformAdmin/);
assert.match(server, /checkPlatformAdmin[\s\S]*hasVerifiedMfaSession/);
assert.match(server, /authMfaLimiter/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.auth_mfa_challenges/);
assert.doesNotMatch(migration, /set\s+two_factor_enabled\s*=\s*true/i);

console.log('ownerMfaEnforcement.test.ts: OK');
