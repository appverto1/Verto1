import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815183000_aba_measurement_v3_task_interval_ioa.sql',
  'utf8',
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-007-task-analysis-interval-ioa.md', 'utf8');
const lower = migration.toLowerCase();

// PR7 remains additive: no Legacy V2 table shape is changed.
for (const legacyTable of [
  'aba_trials', 'aba_interval_records', 'aba_interval_summaries',
  'aba_behavior_events', 'aba_session_summaries', 'aba_prompt_levels',
]) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}

// Task Analysis is relational and categorical, not weighted prompt scoring.
assert.match(lower, /create table if not exists public\.aba_task_analysis_step_definitions_v3/);
assert.match(lower, /create table if not exists public\.aba_task_analysis_runs_v3/);
assert.match(lower, /create table if not exists public\.aba_task_analysis_step_results_v3/);
assert.match(lower, /create table if not exists public\.aba_task_analysis_run_revisions_v3/);
assert.match(lower, /create or replace view public\.aba_effective_task_analysis_runs_v3/);
assert.match(lower, /create table if not exists public\.aba_session_task_analysis_summaries_v3/);
assert.match(migration, /'INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE','NOT_OBSERVED'/);
assert.match(migration, /eligible_step_count = independent_step_count \+ prompted_step_count \+ incorrect_step_count \+ no_response_step_count/);
assert.match(migration, /independent_steps_percent/);
assert.doesNotMatch(lower, /task_analysis[^\n]{0,80}independence_score/);
assert.doesNotMatch(lower, /task_analysis[^\n]{0,80}response_score/);
assert.match(lower, /create or replace function public\.publish_aba_task_analysis_steps_v3/);
assert.match(lower, /create or replace function public\.record_aba_task_analysis_run_v3/);
assert.match(lower, /create or replace function public\.revise_aba_task_analysis_run_v3/);
assert.match(migration, /TASK_ANALYSIS_RECORDED/);
assert.match(migration, /target\.target_type <> 'task_analysis'/);


// Offline/idempotent commands are replay-safe and hashing functions can resolve pgcrypto in Supabase.
assert.match(lower, /client_revision_event_id text not null/);
assert.match(lower, /client_run_event_id text not null/);
assert.match(migration, /ABA_V3_TASK_REVISION_IDEMPOTENCY_CONFLICT/);
assert.match(migration, /ABA_V3_INTERVAL_RUN_IDEMPOTENCY_CONFLICT/);
assert.match(migration, /ABA_V3_INTERVAL_REVISION_IDEMPOTENCY_CONFLICT/);
for (const fn of ['revise_aba_task_analysis_run_v3', 'create_aba_interval_run_v3', 'revise_aba_interval_observation_v3']) {
  const start = lower.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start >= 0, `${fn} must exist`);
  const end = lower.indexOf('$function$;', start);
  const block = lower.slice(start, end);
  assert.match(block, /set search_path = pg_catalog, public, extensions/);
}
assert.match(migration, /ABA_V3_TASK_ANALYSIS_RESULT_OUTSIDE_RUN_WINDOW/);

// Interval grid is server-defined; missing observations remain explicit.
assert.match(lower, /create table if not exists public\.aba_interval_runs_v3/);
assert.match(lower, /primary_collector_binding_id uuid not null/);
assert.match(lower, /create table if not exists public\.aba_interval_observations_v3/);
assert.match(lower, /create table if not exists public\.aba_interval_observation_revisions_v3/);
assert.match(lower, /create or replace view public\.aba_effective_interval_observations_v3/);
assert.match(lower, /create table if not exists public\.aba_interval_summaries_v3/);
assert.match(migration, /'PARTIAL_INTERVAL','WHOLE_INTERVAL','MOMENTARY_TIME_SAMPLING'/);
assert.match(migration, /'OCCURRED','NOT_OCCURRED','NOT_OBSERVED'/);
assert.match(migration, /ABA_V3_INTERVAL_MTS_SAMPLE_MUST_MATCH_GRID/);
assert.match(migration, /v_run\.started_at \+ make_interval\(secs => item\.interval_index \* v_run\.interval_seconds\)/);
assert.match(lower, /create or replace function public\.record_aba_interval_observations_bulk_v3/);
assert.match(migration, /INTERVAL_GRID_CONFLICT/);
assert.match(migration, /IDEMPOTENCY_PAYLOAD_CONFLICT/);
assert.match(migration, /'INTERVAL_OBSERVATION'/);
assert.match(lower, /create or replace function public\.finalize_aba_interval_runs_for_session_v3/);
assert.match(migration, /when v_primary_recorded >= planned_intervals then 'COMPLETE'/);
assert.match(migration, /else 'PARTIAL'/);

// IOA never mixes reliability observations into official patient metrics.
assert.match(lower, /create table if not exists public\.aba_ioa_summaries_v3/);
assert.match(lower, /create or replace function public\.recompute_aba_behavior_ioa_v3/);
assert.match(lower, /create or replace function public\.recompute_aba_interval_ioa_v3/);
assert.match(migration, /'TOTAL_COUNT','TOTAL_DURATION','INTERVAL_BY_INTERVAL'/);
assert.match(migration, /OBSERVATION_WINDOWS_NOT_ALIGNED/);
assert.match(migration, /CENSORED_OR_OPEN_DURATION_EPISODE/);
assert.match(migration, /reliability_obs\.observation_code <> 'NOT_OBSERVED'/);
assert.match(migration, /primary_obs\.observation_code <> 'NOT_OBSERVED'/);
assert.match(lower, /create or replace view public\.aba_official_interval_summaries_v3/);
assert.match(migration, /where summary\.collector_role = 'PRIMARY'/);

// Finalization composes new interval/task projections with existing V3 close flow.
assert.match(lower, /create or replace function public\.finalize_aba_session_measurements_v3/);
assert.match(migration, /public\.finalize_aba_interval_runs_for_session_v3/);
assert.match(migration, /public\.recompute_aba_session_task_analysis_summary_v3/);
assert.match(migration, /public\.recompute_aba_behavior_ioa_v3/);

// Dark rollout / browser fail-closed remains intact.
assert.match(lower, /revoke all on table public\.aba_task_analysis_runs_v3 from public, anon, authenticated/);
assert.match(lower, /revoke all on table public\.aba_interval_observations_v3 from public, anon, authenticated/);
assert.match(lower, /revoke all on table public\.aba_ioa_summaries_v3 from public, anon, authenticated/);
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.match(architecture, /PR7 — Task Analysis, intervalos e IOA/i);
assert.match(adr, /pontuação 0–100.*PR9/i);

console.log('ABA Measurement V3 PR7 task-analysis/interval/IOA contracts: OK');
