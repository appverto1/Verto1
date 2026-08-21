import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820190000_clinical_measurement_v3_bulk_ingestion.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

for (const table of [
  'clinical_measurement_sync_batches_v3',
  'clinical_measurement_sync_batch_events_v3',
  'clinical_aba_trial_protocol_intents_v3'
]) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`'${table}'`), `${table} must be included in dark RLS setup`);
}

// One server-only entrypoint; internal handlers remain inaccessible to browser roles.
assert.match(lower, /create or replace function public\.sync_clinical_measurements_bulk_v3/);
assert.match(lower, /grant execute on function public\.sync_clinical_measurements_bulk_v3\(uuid, uuid, uuid, text, jsonb\) to service_role/);
assert.match(lower, /revoke all on function public\.sync_clinical_measurements_bulk_v3[\s\S]*from public, anon, authenticated/);
assert.doesNotMatch(lower, /grant execute on function public\.sync_clinical_measurements_bulk_v3[\s\S]*to authenticated/);

// Strict limits and server-owned scope/semantic fields.
assert.match(lower, /jsonb_array_length\(p_items\) > 500/);
assert.match(lower, /octet_length\(p_items::text\) > 2000000/);
assert.match(lower, /cmv3_sync_server_owned_field_forbidden/);
assert.match(lower, /cmv3_sync_stream_observer_mismatch/);
assert.match(lower, /cmv3_sync_correction_authority_required/);
assert.match(lower, /cmv3_sync_client_semantic_field_forbidden/);
assert.match(lower, /clinical_aba_trial_protocol_intents_v3/);
assert.match(lower, /intent\.trial_type/);
assert.match(lower, /cmv3_sync_aba_trial_intent_required/);
assert.match(lower, /cmv3_sync_absence_kind_semantic_family_mismatch/);
assert.match(lower, /opportunity_role/);
assert.match(lower, /eligibility/);

// Idempotency exists at both batch and event level and collision is fail-closed.
assert.match(lower, /unique \(organization_id, client_batch_id\)/);
assert.match(lower, /pg_advisory_xact_lock/);
assert.match(lower, /idempotent_replay/);
assert.match(lower, /cmv3_sync_batch_id_collision/);
assert.match(lower, /cmv3_sync_client_event_id_collision/);
assert.match(lower, /digest\(convert_to\(item::text,'utf8'\),'sha256'\)/);

// Bulk handlers are set-based. No per-event FOREACH/LOOP is allowed in ingestion functions.
for (const fn of [
  'accept_clinical_measurement_raw_envelopes_bulk_v3',
  'ingest_clinical_measurement_primitives_bulk_v3',
  'ingest_clinical_aba_trials_bulk_v3',
  'ingest_clinical_aba_task_runs_bulk_v3',
  'sync_clinical_measurements_bulk_v3'
]) {
  assert.match(lower, new RegExp(`create or replace function public\\.${fn}`));
}
const ingestionSection = lower.slice(
  lower.indexOf('create or replace function public.accept_clinical_measurement_raw_envelopes_bulk_v3'),
  lower.indexOf('-- sync provenance is immutable.')
);
assert.doesNotMatch(ingestionSection, /\bforeach\b/);
assert.doesNotMatch(ingestionSection, /\bloop\b/);
assert.match(ingestionSection, /jsonb_array_elements\(p_items\)/);
assert.match(ingestionSection, /cross join lateral jsonb_array_elements/);

// ABA client submits facts only; server-side triggers continue to derive clinical semantics.
assert.doesNotMatch(lower, /insert into public\.clinical_measurement_aba_trial_steps_v3\([\s\S]{0,500}opportunity_role/);
assert.doesNotMatch(lower, /insert into public\.clinical_measurement_aba_task_step_results_v3\([\s\S]{0,500}eligibility/);
assert.match(lower, /cmv3_sync_task_analysis_step_set_incomplete/);

// Deferred one-event/one-payload invariant is forced before batch success is recorded.
assert.match(lower, /set constraints ensure_clinical_measurement_raw_payload_v3 immediate/);

// Migration remains additive/dark and never writes to legacy ABA/V2 tables.
for (const legacyTable of [
  'aba_sessions', 'aba_trials', 'aba_trials_v3', 'aba_trial_steps_v3',
  'aba_behavior_events_v3', 'patient_therapeutic_plans', 'appointments'
]) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`));
  assert.doesNotMatch(lower, new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`));
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`));
}

console.log('Clinical Measurement Engine V3 bulk/offline ingestion contracts: OK');
