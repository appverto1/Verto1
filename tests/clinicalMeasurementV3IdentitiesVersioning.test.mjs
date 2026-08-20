import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820130000_clinical_measurement_v3_identities_versioning.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

const tables = [
  'clinical_measurement_targets_v3',
  'clinical_measurement_definitions_v3',
  'clinical_measurement_definition_versions_v3',
  'clinical_measurement_definition_activations_v3',
  'clinical_measurement_phases_v3',
  'clinical_measurement_phase_versions_v3',
  'clinical_measurement_phase_epochs_v3',
  'clinical_collection_protocol_snapshots_v3'
];

for (const table of tables) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(
    lower,
    new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
    `${table} must remain browser-closed in Migration A`
  );
  assert.match(
    lower,
    new RegExp(`grant all on table public\\.${table} to service_role`),
    `${table} must remain available to the server-side migration/runtime role`
  );
}

// The universal foundation must not be rooted in ABA-specific table names.
for (const table of tables) {
  assert.ok(!table.startsWith('aba_'), `${table} unexpectedly reintroduced ABA as the universal root`);
}

// Native measurement families remain explicit and cannot collapse to a universal score.
for (const family of [
  'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
  'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
]) {
  assert.match(migration, new RegExp(`'${family}'`));
}
assert.doesNotMatch(lower, /global_score|universal_score|prompt_score/);

// Definition and phase semantics are independently versioned and immutable.
assert.match(migration, /CMV3_VERSION_IMMUTABLE/);
assert.match(migration, /definition_hash/);
assert.match(migration, /phase_hash/);
assert.match(migration, /CMV3_DEFINITION_CONTENT_KIND_MISMATCH/);

// Bitemporal valid time + system knowledge time are first-class.
assert.match(migration, /effective_from timestamptz not null/i);
assert.match(migration, /recorded_at timestamptz not null default now\(\)/i);
assert.match(migration, /RETROSPECTIVE_CORRECTION/);
assert.match(migration, /supersedes_activation_id/);
assert.match(migration, /supersedes_epoch_id/);
assert.match(migration, /CMV3_BITEMPORAL_RECORD_IMMUTABLE/);

// Current-truth timelines cannot overlap; historical superseded rows remain retained.
assert.match(migration, /cmv3_definition_activation_no_overlap/i);
assert.match(migration, /cmv3_phase_epoch_no_overlap/i);
assert.match(migration, /where \(superseded_at is null\)/i);
assert.match(migration, /tstzrange\(/i);

// Server, not the client, owns knowledge time and semantic hashes.
assert.match(migration, /new\.recorded_at := clock_timestamp\(\)/i);
assert.match(migration, /new\.definition_hash := encode/i);
assert.match(migration, /new\.phase_hash := encode/i);
assert.match(migration, /new\.snapshot_hash := encode/i);

// Collection protocol snapshots are immutable and phase is optional for non-ABA specialties.
assert.match(migration, /CMV3_PROTOCOL_SNAPSHOT_IMMUTABLE/);
assert.match(
  migration,
  /\(phase_epoch_id is null and phase_version_id is null\) or \(phase_epoch_id is not null and phase_version_id is not null\)/i
);

// Tenant/source IDs are explicitly scope-validated rather than trusted.
assert.match(migration, /CMV3_PATIENT_SCOPE_INVALID/);
assert.match(migration, /CMV3_ABA_TARGET_SCOPE_INVALID/);
assert.match(migration, /CMV3_THERAPEUTIC_OBJECTIVE_SCOPE_INVALID/);
assert.match(migration, /CMV3_THERAPEUTIC_PLAN_SCOPE_INVALID/);

// Absolute preservation: this migration may reference old tables but must never alter or write them.
for (const legacyTable of [
  'aba_targets',
  'aba_collection_definition_versions_v3',
  'aba_target_phase_assignments_v3',
  'aba_trials_v3',
  'aba_sessions',
  'clinical_measure_definitions',
  'clinical_observations',
  'patient_therapeutic_plans',
  'patient_therapeutic_objectives'
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`),
    `Migration A must not alter ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`),
    `Migration A must not write ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Migration A must not update ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Migration A must not delete from ${legacyTable}`
  );
}

console.log('Clinical Measurement Engine V3 Migration A contracts: OK');
