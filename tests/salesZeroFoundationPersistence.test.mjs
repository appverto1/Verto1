import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260814151000_sales_modular_zero_foundation_persistence.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');

// The exception is deliberately narrow: only modular snapshots may persist a
// zero canonical base amount. Legacy pricing must remain strictly positive.
assert.match(
  migration,
  /simulation_type\s*=\s*'modular'[\s\S]*base_unit_amount_cents\s*>=\s*0/
);
assert.match(
  migration,
  /simulation_type\s*<>\s*'modular'[\s\S]*base_unit_amount_cents\s*>\s*0/
);
assert.match(
  migration,
  /offer_type\s*=\s*'modular'[\s\S]*base_unit_amount_cents\s*>=\s*0/
);
assert.match(
  migration,
  /offer_type\s*<>\s*'modular'[\s\S]*base_unit_amount_cents\s*>\s*0/
);

// Both historical sales_offers constraint names are handled idempotently.
assert.match(
  migration,
  /drop constraint if exists sales_offers_base_amount_check/
);
assert.match(
  migration,
  /drop constraint if exists sales_offers_amount_positive/
);

// No commercial rows or snapshots are rewritten as part of the repair.
const executableBody = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
assert.doesNotMatch(
  executableBody,
  /\b(update|delete|insert)\s+(?:into\s+)?public\.sales_(?:offer|lead|pricing)/i
);

console.log('salesZeroFoundationPersistence.test.mjs: ok');
