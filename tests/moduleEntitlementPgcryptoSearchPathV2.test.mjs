import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'supabase/migrations/20260814210000_fix_module_entitlement_pgcrypto_search_path_v2.sql'
);

const sql = fs.readFileSync(migrationPath, 'utf8');

test('repairs pgcrypto search_path for both entitlement RPC versions', () => {
  assert.match(sql, /alter function public\.apply_sales_offer_module_entitlements_v1\([\s\S]*?\) set search_path = pg_catalog, public, extensions;/);
  assert.match(sql, /alter function public\.apply_sales_offer_module_entitlements_v2\([\s\S]*?\) set search_path = pg_catalog, public, extensions;/);
  assert.match(sql, /create extension if not exists pgcrypto with schema extensions;/);
  assert.match(sql, /encode\(digest\('verto-entitlement-runtime-check'/);
});
