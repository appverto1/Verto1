import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260821002000_clinical_measurement_v3_projection_task_analysis_groupby_hotfix.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

assert.match(lower, /create or replace function public\.recompute_clinical_measurement_projection_batch_v3\(/);
assert.match(
  lower,
  /scope\.protocol_snapshot_id,scope\.phase_version_id,scope\.semantic_family/,
  'TASK_ANALYSIS aggregate must group every scope.* field, including phase_version_id'
);

// Preserve the dark/server-only security posture after CREATE OR REPLACE.
assert.match(lower, /revoke all on function public\.recompute_clinical_measurement_projection_batch_v3\(uuid\[\],text\) from public,anon,authenticated/);
assert.match(lower, /grant execute on function public\.recompute_clinical_measurement_projection_batch_v3\(uuid\[\],text\) to service_role/);

// Hotfix is function-only: do not mutate raw facts, summaries, or legacy/V2 tables directly.
for (const forbidden of [
  /insert\s+into\s+public\.clinical_measurement_raw_events_v3/,
  /update\s+public\.clinical_measurement_raw_events_v3/,
  /delete\s+from\s+public\.clinical_measurement_raw_events_v3/,
  /alter\s+table\s+public\.aba_/,
  /insert\s+into\s+public\.aba_/,
  /update\s+public\.aba_/,
  /delete\s+from\s+public\.aba_/
]) assert.doesNotMatch(lower, forbidden);

console.log('CMV3 TASK_ANALYSIS projection GROUP BY hotfix contract: OK');
