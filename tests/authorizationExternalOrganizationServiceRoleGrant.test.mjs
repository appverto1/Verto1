import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(
  new URL('../supabase/migrations/20260817193000_authorization_service_role_external_org_select.sql', import.meta.url),
  'utf8',
);

for (const table of [
  'external_organization_users',
  'external_organizations',
  'external_organization_clinic_links',
]) {
  assert.match(
    sql,
    new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+service_role\\s*;`, 'i'),
    `service_role must be able to read ${table}`,
  );

  assert.doesNotMatch(
    sql,
    new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+(anon|authenticated)\\b`, 'i'),
    `${table} must remain closed to direct client roles`,
  );
}

console.log('authorizationExternalOrganizationServiceRoleGrant.test.mjs: ok');
