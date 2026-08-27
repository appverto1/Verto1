import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const migrationPath = resolve(
  root,
  'supabase/migrations/20260826211500_patient_primary_pointer_nullable_v1.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /^begin\s*;/i, 'migration must start with BEGIN');
assert.match(
  sql,
  /alter\s+table\s+public\.patients[\s\S]*alter\s+column\s+therapist_id\s+drop\s+not\s+null/i,
  'legacy patients.therapist_id must be nullable',
);
assert.match(
  sql,
  /patient_professional_links is the canonical case-team relation/i,
  'migration must document the canonical case-team source',
);
assert.doesNotMatch(
  sql,
  /update\s+public\.patients\s+[\s\S]*set\s+therapist_id\s*=\s*[^n]/i,
  'migration must not manufacture a replacement therapist pointer',
);
assert.match(sql, /\bcommit\s*;/i, 'migration must finish with COMMIT');

console.log('patientCaseTeamPrimaryPointerNullable.regression: PASS');
