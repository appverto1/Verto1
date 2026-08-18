import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  'supabase/migrations/20260818000500_authorization_service_role_clinical_supervision_select.sql',
);

assert.ok(fs.existsSync(migrationPath), 'clinical supervision service-role grant migration must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(
  sql,
  /grant\s+select\s+on\s+table\s+public\.clinical_supervision_links\s+to\s+service_role\s*;/i,
  'service_role must have SELECT on clinical_supervision_links',
);
assert.doesNotMatch(
  sql,
  /grant\s+[^;]*\bon\s+(?:table\s+)?public\.clinical_supervision_links\s+to\s+(?:anon|authenticated)\b/i,
  'migration must not grant clinical_supervision_links to anon/authenticated',
);
assert.doesNotMatch(
  sql,
  /grant\s+(?:all|insert|update|delete)\b[^;]*clinical_supervision_links/i,
  'migration must grant read-only access only',
);

console.log('authorizationClinicalSupervisionServiceRoleGrant.test.mjs: ok');
