import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(
  new URL('../supabase/migrations/20260814223000_authorization_service_role_override_select.sql', import.meta.url),
  'utf8',
);

assert.match(
  sql,
  /grant\s+select\s+on\s+table\s+public\.clinic_membership_permission_overrides\s+to\s+service_role\s*;/i,
  'service_role must be able to read per-membership authorization overrides',
);

assert.doesNotMatch(
  sql,
  /grant\s+select\s+on\s+table\s+public\.clinic_membership_permission_overrides\s+to\s+(anon|authenticated)\b/i,
  'direct client access must remain closed',
);

console.log('authorizationOverrideServiceRoleGrant.test.mjs: ok');
