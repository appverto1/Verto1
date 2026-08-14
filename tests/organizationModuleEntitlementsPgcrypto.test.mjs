import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  'supabase/migrations/20260814110000_module_entitlement_pgcrypto_search_path.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

assert.match(
  migration,
  /create extension if not exists pgcrypto with schema extensions;/i,
  'migration must preserve pgcrypto in the extensions schema',
);
assert.match(
  migration,
  /alter function public\.apply_sales_offer_module_entitlements_v1\([\s\S]*?\) set search_path = pg_catalog, public, extensions;/i,
  'entitlement RPC must resolve pgcrypto from its explicit SECURITY DEFINER search_path',
);
assert.match(
  migration,
  /digest\('verto-module-entitlement-check'::text, 'sha256'::text\)/i,
  'migration must fail fast if digest is still unavailable',
);
assert.doesNotMatch(
  migration,
  /drop table|truncate|delete from public\.organization_module/i,
  'fix must not delete entitlement data',
);

console.log('organizationModuleEntitlementsPgcrypto.test.mjs: ok');
