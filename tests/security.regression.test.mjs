import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const modularMigration = fs.readFileSync(
  'supabase/migrations/20260727040000_sales_modular_cost_drivers_v2.sql',
  'utf8'
);

assert.match(server, /app\.use\(helmet\(/);
assert.match(server, /const checkOwner =/);
assert.match(server, /checkAuth/);
assert.match(server, /sanitizeString/);
assert.match(modularMigration, /security definer/);
assert.match(modularMigration, /service_role/);
assert.doesNotMatch(modularMigration, /drop table|truncate/i);

console.log('security.regression.test.mjs: OK');
