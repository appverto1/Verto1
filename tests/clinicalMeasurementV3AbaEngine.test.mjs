import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820173000_clinical_measurement_v3_aba_engine.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

const tables = [
  'clinical_aba_prompt_hierarchies_v3',
  'clinical_aba_prompt_hierarchy_versions_v3',
  'clinical_aba_prompt_hierarchy_levels_v3',
  'clinical_aba_task_step_definitions_v3',
  'clinical_aba_chaining_policy_versions_v3',
  'clinical_aba_chaining_step_rules_v3',
  'clinical_aba_protocol_bindings_v3',
  'clinical_aba_raw_payload_claims_v3',
  'clinical_measurement_aba_trials_v3',
  'clinical_measurement_aba_trial_steps_v3',
  'clinical_measurement_aba_task_runs_v3',
  'clinical_measurement_aba_task_step_results_v3'
];
for (const table of tables) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`'${table}'`), `${table} must be in dark RLS setup`);
}

// Prompt semantics remain categorical; legacy scores are never used by the new engine.
assert.doesNotMatch(lower, /independence_score\s+(numeric|double|real|integer|bigint)/);
assert.doesNotMatch(lower, /prompt_score/);
assert.match(lower, /is_independent boolean not null default false/);
assert.match(lower, /strategy text not null check \(strategy in \('least_to_most','most_to_least','custom'\)\)/);
assert.match(lower, /cmv3_aba_prompt_hierarchy_requires_one_independent/i);

// Config versions are drafts until complete child sets are atomically published + hashed.
assert.match(lower, /status text not null default 'draft'/);
assert.match(lower, /publish_clinical_aba_prompt_hierarchy_version_v3/);
assert.match(lower, /publish_clinical_aba_chaining_policy_version_v3/);
assert.match(lower, /chaining_rule_coverage_incomplete/);

// Trial outcomes are step-derived and primary opportunity is server-owned.
assert.doesNotMatch(lower, /clinical_measurement_aba_trials_v3[\s\S]{0,1200}(response_score|independence_percent|correct boolean|independent boolean)/);
assert.match(lower, /opportunity_role text not null default 'support'/);
assert.match(lower, /new\.opportunity_role := 'primary_independent'/);
assert.match(lower, /initial_opportunity_mode = 'independent_eligible'/);
assert.match(lower, /ux_cabav3_trial_one_primary_independent/);
assert.match(lower, /unique \(trial_event_id, client_step_id\)/);

// Task Analysis eligibility is derived from a frozen chaining policy, never trusted from client input.
assert.match(lower, /eligibility text not null default 'not_eligible'/);
assert.match(lower, /new\.eligibility := v_rule\.eligibility/);
assert.match(lower, /cmv3_aba_task_step_set_already_sealed/);
assert.match(lower, /trainer_completed/);
assert.match(lower, /acquisition/);
assert.match(lower, /maintenance/);

// Specialized ABA payloads participate in the universal one-event/one-payload invariant.
assert.match(lower, /clinical_aba_raw_payload_claims_v3/);
assert.match(lower, /raw_event_already_has_generic_payload/);
assert.match(lower, /raw_event_already_has_aba_payload/);
assert.match(lower, /from public\.clinical_measurement_raw_events_v3 event[\s\S]*for update/);
assert.match(lower, /resolve_clinical_measurement_payload_kind_v3/);
assert.match(lower, /create or replace function public\.ensure_clinical_measurement_raw_payload_v3/);
assert.match(lower, /raw_correction_payload_kind_mismatch/);

// Dark-only and no legacy/runtime mutation.
assert.doesNotMatch(lower, /grant execute on function[\s\S]*to authenticated/);
for (const legacyTable of [
  'aba_trials', 'aba_trials_v3', 'aba_trial_steps_v3', 'aba_prompt_types',
  'aba_task_analysis_runs_v3', 'aba_task_analysis_step_results_v3',
  'clinical_measurement_raw_events_v3', 'clinical_measurement_sessions_v3'
]) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`), `must not alter ${legacyTable}`);
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`), `must not write ${legacyTable}`);
  assert.doesNotMatch(lower, new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`), `must not update ${legacyTable}`);
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`), `must not delete ${legacyTable}`);
}

console.log('Clinical Measurement Engine V3 ABA specialized engine contracts: OK');
