import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260817082000_fix_accept_clinic_invitation_variable_conflict.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

assert.match(
  migration,
  /create or replace function public\.accept_clinic_invitation_v1\(\s*p_invitation_id uuid,\s*p_user_id uuid,\s*p_verified_email text\s*\)/i,
);
assert.match(migration, /returns table\s*\([\s\S]*?clinic_id uuid[\s\S]*?\)/i);
assert.match(migration, /#variable_conflict use_column/i);
assert.match(migration, /on conflict \(user_id, clinic_id\)/i);
assert.match(
  migration,
  /revoke all on function public\.accept_clinic_invitation_v1\(uuid, uuid, text\)[\s\S]*?from public, anon, authenticated;/i,
);
assert.match(
  migration,
  /grant execute on function public\.accept_clinic_invitation_v1\(uuid, uuid, text\)\s*to service_role;/i,
);
assert.doesNotMatch(migration, /alter table|drop table|delete from|truncate/i);

console.log('clinicInvitationVariableConflictMigration.test.ts: ok');
