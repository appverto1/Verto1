import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820203000_clinical_measurement_v3_projection_read_models.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

for (const table of [
  'clinical_measurement_projection_queue_v3',
  'clinical_measurement_session_count_summaries_v3',
  'clinical_measurement_session_rate_summaries_v3',
  'clinical_measurement_session_proportion_summaries_v3',
  'clinical_measurement_session_temporal_summaries_v3',
  'clinical_measurement_session_continuous_summaries_v3',
  'clinical_measurement_session_interval_summaries_v3',
  'clinical_measurement_session_ordinal_summaries_v3',
  'clinical_measurement_session_categorical_summaries_v3',
  'clinical_measurement_session_task_analysis_summaries_v3',
  'clinical_measurement_session_projection_heads_v3',
  'clinical_measurement_session_projection_revisions_v3'
]) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`'${table}'`), `${table} must be included in dark RLS setup`);
}

// Current truth is derived; raw remains immutable authority.
assert.match(lower, /create or replace view public\.clinical_measurement_effective_raw_events_v3/);
assert.match(lower, /event\.event_kind in \('fact','correction'\)/);
assert.match(lower, /compensation\.subject_event_id = event\.id/);

// Queue is incremental and statement-level, avoiding one queue write per raw event.
assert.match(lower, /referencing new table as inserted_events/);
assert.match(lower, /for each statement execute function public\.enqueue_clinical_measurement_projection_from_raw_v3/);
assert.match(lower, /generation=public\.clinical_measurement_projection_queue_v3\.generation\+1/);
assert.match(lower, /for update skip locked/);
assert.match(lower, /array_agg\(expectation_id/);

// Recompute is set-based. No per-expectation LOOP/FOREACH is allowed.
const recomputeStart = lower.indexOf('create or replace function public.recompute_clinical_measurement_projection_batch_v3');
const enqueueStart = lower.indexOf('-- statement-level enqueue');
const recomputeSection = lower.slice(recomputeStart, enqueueStart);
assert.doesNotMatch(recomputeSection, /\bforeach\b/);
assert.doesNotMatch(recomputeSection, /\bloop\b/);
assert.match(recomputeSection, /expectation_id=any\(p_expectation_ids\)/);

// Mathematical families remain typed and cannot collapse into a generic score.
assert.match(lower, /clinical_measurement_session_rate_summaries_v3/);
assert.match(lower, /observation_duration_ms/);
assert.match(lower, /rate_per_hour/);
assert.match(lower, /clinical_measurement_session_temporal_summaries_v3/);
assert.match(lower, /semantic_family text not null check \(semantic_family in \('duration','latency','irt'\)\)/);
assert.match(lower, /clinical_measurement_session_ordinal_summaries_v3/);
assert.doesNotMatch(lower, /ordinal[^\n]{0,120}percent_value/);

// Proportion is explicit: ABA is server-derived; custom specialties require semantic config.
assert.match(lower, /semantic_config_required/);
assert.match(lower, /invalid_mixed_source/);
assert.match(lower, /numerator_category_keys/);
assert.match(lower, /denominator_category_keys/);
assert.match(lower, /step\.opportunity_role='primary_independent'/);

// Task Analysis preserves acquisition vs maintenance denominators separately.
assert.match(lower, /acquisition_eligible_count/);
assert.match(lower, /maintenance_eligible_count/);
assert.match(lower, /trainer_completed_count/);
assert.match(lower, /clinical_measurement_session_task_step_summaries_v3/);

// No analytical JSON blob in hot summary tables; JSON is restricted to cold revision ledger.
assert.match(lower, /projection_payload jsonb/);
assert.match(lower, /revision_reason text not null/);
assert.match(lower, /late_data_incorporated/);
assert.match(lower, /audit_correction/);
assert.match(lower, /projection_revision_append_only/);
assert.match(lower, /to_jsonb\(s\)-'organization_id'-'patient_id'-'computed_at'/);

// Finalization enqueues expectations even if there was no raw event, so missingness is derived.
assert.match(lower, /expected_not_collected/);
assert.match(lower, /enqueue_clinical_measurement_projection_on_session_finalization_v3/);
assert.doesNotMatch(lower, /insert into public\.clinical_measurement_explicit_absence_facts_v3[\s\S]{0,300}expected_not_collected/);

// Hot reads are target/time indexed, not full patient loads.
for (const idx of [
  'idx_cmv3_rate_summary_target_time',
  'idx_cmv3_proportion_summary_target_time',
  'idx_cmv3_temporal_summary_target_time',
  'idx_cmv3_task_summary_target_time'
]) assert.match(lower, new RegExp(`create index if not exists ${idx}`));

// Browser remains dark; service role owns the internal engine.
assert.match(lower, /revoke all on function public\.process_clinical_measurement_projection_queue_v3\(integer\) from public,anon,authenticated/);
assert.match(lower, /grant execute on function public\.process_clinical_measurement_projection_queue_v3\(integer\) to service_role/);

// Additive preservation: no writes/DDL against legacy/V2/old ABA V3 application tables.
for (const legacyTable of [
  'aba_sessions', 'aba_trials', 'aba_trials_v3', 'aba_trial_steps_v3',
  'aba_session_target_summaries_v3', 'patient_therapeutic_plans', 'appointments'
]) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`));
  assert.doesNotMatch(lower, new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`));
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`));
}

console.log('Clinical Measurement Engine V3 projection/read-model contracts: OK');
