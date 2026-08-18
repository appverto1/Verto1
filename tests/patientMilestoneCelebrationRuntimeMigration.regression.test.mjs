import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20260818113600_patient_milestone_celebration_runtime_v1.sql', 'utf8');
assert.match(sql, /create table if not exists public\.patient_milestone_celebration_receipts/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all on table[\s\S]*from anon, authenticated/i);
assert.match(sql, /grant select, insert, update[\s\S]*to service_role/i);
assert.match(sql, /create or replace function public\.consume_patient_milestone_celebration_v1/i);
assert.match(sql, /pg_advisory_xact_lock/i);
assert.match(sql, /grant execute[\s\S]*to service_role/i);
assert.doesNotMatch(sql, /note_row\.updated_at/, 'runtime migration must not depend on notes.updated_at schema drift');

console.log('patientMilestoneCelebrationRuntimeMigration.regression.test.mjs: ok');
