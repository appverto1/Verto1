import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260802010000_clinic_membership_professional_settings.sql',
  'utf8',
);
const sqlTest = fs.readFileSync(
  'supabase/tests/20260802010000_clinic_membership_professional_settings_test.sql',
  'utf8',
);

assert.match(migration, /^begin;/im);
assert.match(migration, /commit;\s*$/im);
assert.doesNotMatch(migration, /CLINIC_INVITATION_ACCEPTANCE_MIGRATION_REQUIRED/);
assert.match(migration, /create or replace function public\.accept_clinic_invitation_v1/);
assert.match(migration, /prevent_duplicate_pending_clinic_invitation_v1/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /CLINIC_INVITATION_PENDING_ALREADY_EXISTS/);
assert.match(migration, /invitations_single_pending_per_clinic_email_v1/);
assert.match(
  migration,
  /revoke all on function public\.accept_clinic_invitation_v1[\s\S]*?from public, anon, authenticated;[\s\S]*?grant execute[\s\S]*?to service_role;/i,
);

const acceptedBranchStart = migration.indexOf("if v_status = 'accepted' then");
const pendingBranchStart = migration.indexOf("if v_status <> 'pending' then", acceptedBranchStart);
assert.notEqual(acceptedBranchStart, -1);
assert.notEqual(pendingBranchStart, -1);
const acceptedBranch = migration.slice(acceptedBranchStart, pendingBranchStart);
assert.doesNotMatch(
  acceptedBranch,
  /update public\.clinic_memberships|insert into public\.clinic_memberships/,
  'retry aceito precisa ser estritamente idempotente',
);

assert.match(sqlTest, /^begin;/im);
assert.match(sqlTest, /rollback;\s*$/im);
assert.match(sqlTest, /TEST_DUPLICATE_PENDING_INVITATION_WAS_ACCEPTED/);
assert.match(sqlTest, /TEST_CONFLICT_ACCEPTANCE_RETRY_MUTATED_MEMBERSHIP/);
assert.match(sqlTest, /TEST_PENDING_INVITATION_GUARD_EXPOSED/);

console.log('clinicMembershipProfessionalSettingsMigration.test.ts: ok');
