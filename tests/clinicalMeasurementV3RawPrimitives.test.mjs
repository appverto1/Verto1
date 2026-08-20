import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820160000_clinical_measurement_v3_raw_primitives.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

const tables = [
  'clinical_measurement_raw_events_v3',
  'clinical_measurement_raw_event_payload_claims_v3',
  'clinical_measurement_observation_slices_v3',
  'clinical_measurement_count_facts_v3',
  'clinical_measurement_category_facts_v3',
  'clinical_measurement_scalar_facts_v3',
  'clinical_measurement_interval_facts_v3',
  'clinical_measurement_interval_samples_v3',
  'clinical_measurement_explicit_absence_facts_v3'
];

for (const table of tables) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`'${table}'`), `${table} must be part of dark security setup`);
}

assert.match(lower, /create extension if not exists btree_gist/);
assert.match(lower, /unique \(organization_id, client_event_id\)/);
assert.match(lower, /event_kind in \('fact', 'correction', 'void', 'supersede'\)/);
assert.match(lower, /ingestion_mode in \('live', 'offline_sync', 'retrospective_entry', 'correction'\)/);
assert.match(lower, /clinical_date := v_session\.clinical_date/);
assert.match(lower, /local_occurred_date := timezone\(v_session\.timezone_snapshot, new\.occurred_at_utc\)::date/);
assert.match(lower, /new\.received_at := v_now/);
assert.match(lower, /new\.recorded_at := v_now/);
assert.match(lower, /cmv3_raw_live_stream_not_open/);
assert.match(lower, /cmv3_raw_actor_scope_invalid/);
assert.match(lower, /cmv3_raw_append_only/);
assert.match(lower, /cmv3_raw_event_subject_scope_fkey/);
assert.match(lower, /cmv3_raw_event_replacement_scope_fkey/);
assert.match(lower, /ux_cmv3_raw_single_direct_compensation/);
assert.match(lower, /clinical_measurement_raw_event_payload_claims_v3/);
assert.match(lower, /cmv3_raw_event_typed_payload_required/);
assert.match(lower, /cmv3_raw_event_payload_kind_conflict/);
assert.match(lower, /resolve_clinical_measurement_payload_event_v3/);

// Range denominators and interval samples are protected in the database, not JS.
assert.match(lower, /cmv3_observation_slices_no_overlap/);
assert.match(lower, /exclude using gist[\s\S]*stream_id with =[\s\S]*observation_range with &&/);
assert.match(lower, /cmv3_interval_samples_no_overlap/);
assert.match(lower, /sample_range with &&/);
assert.match(lower, /tstzrange\(started_at, ended_at, '\[\)'\)/);

// Mathematical families remain physically typed rather than a universal sparse payload.
assert.match(lower, /semantic_family text not null check \(semantic_family in \('count', 'rate'\)\)/);
assert.match(lower, /semantic_family in \('proportion', 'ordinal', 'categorical'\)/);
assert.match(lower, /semantic_family text not null check \(semantic_family = 'continuous'\)/);
assert.match(lower, /semantic_family text not null check \(semantic_family in \('duration', 'latency', 'irt'\)\)/);
assert.match(lower, /semantic_family text not null check \(semantic_family = 'interval'\)/);
assert.match(lower, /cmv3_primitive_semantic_family_mismatch/);
assert.doesNotMatch(lower, /value_jsonb/);
assert.doesNotMatch(lower, /measurement_payload\s+jsonb/);

// Explicit clinical absence may be persisted; implicit coverage absence never is.
assert.match(lower, /no_eligible_opportunity/);
assert.match(lower, /no_valid_observation_window/);
assert.doesNotMatch(lower, /absence_kind in \([^)]*(not_collected|not_scheduled)/s);

// Raw accepted evidence and typed primitives are append-only.
assert.match(lower, /before update or delete on public\.clinical_measurement_raw_events_v3/);
assert.match(lower, /guard_cmv3_raw_immutable/);

// Dark and additive: no browser writer and no legacy/live domain mutation.
assert.doesNotMatch(lower, /grant execute on function[\s\S]*to authenticated/);
for (const legacyTable of [
  'aba_sessions',
  'aba_trials',
  'aba_trials_v3',
  'aba_behavior_events_v3',
  'aba_behavior_observation_slices_v3',
  'patient_therapeutic_plans',
  'appointments'
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`),
    `Raw primitives migration must not alter ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`),
    `Raw primitives migration must not write ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Raw primitives migration must not update ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Raw primitives migration must not delete ${legacyTable}`
  );
}

console.log('Clinical Measurement Engine V3 raw primitive contracts: OK');
