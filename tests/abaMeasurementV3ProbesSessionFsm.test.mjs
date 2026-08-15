import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815173000_aba_measurement_v3_probes_session_fsm.sql',
  'utf8',
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-006-probes-session-fsm.md', 'utf8');
const lower = migration.toLowerCase();

// Additive V3: no schema mutation of Legacy V2 tables in PR6.
for (const legacyTable of ['aba_sessions','aba_trials','aba_targets','aba_mastery_evaluations','aba_maintenance_probe_results']) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}

assert.match(lower, /create table if not exists public\.aba_mastery_criterion_versions_v3/);
assert.match(lower, /create table if not exists public\.aba_maintenance_probes_v3/);
assert.match(lower, /create table if not exists public\.aba_maintenance_probe_trials_v3/);
assert.match(lower, /create table if not exists public\.aba_target_clinical_states_v3/);
assert.match(lower, /create table if not exists public\.aba_target_clinical_state_events_v3/);
assert.match(lower, /create or replace function public\.publish_aba_mastery_criterion_version_v3/);
assert.match(migration, /digest\(convert_to\(v_definition::text, 'UTF8'\), 'sha256'\)/);

// No implicit mastery threshold, and incomplete probes are not failures.
assert.match(migration, /auto_mastery_enabled boolean not null default false/);
assert.doesNotMatch(migration, /mastery_threshold_percent[^\n]*default\s+80/i);
assert.match(migration, /'OPEN','COMPLETE','INCOMPLETE','CANCELLED'/);
assert.match(migration, /lifecycle_status = 'INCOMPLETE'[\s\S]*eligibility_status = 'INELIGIBLE'[\s\S]*evaluation_result = 'NOT_EVALUATED'/);
assert.match(migration, /lifecycle_status = 'COMPLETE'[\s\S]*eligibility_status = 'ELIGIBLE'/);
assert.match(migration, /STALE_REVIEW_REQUIRED/);
assert.match(lower, /create or replace function public\.reconcile_aba_maintenance_probe_after_revision_v3/);
assert.match(migration, /probe\.evidence_status = 'CURRENT'/);
assert.match(migration, /probe\.lifecycle_status = 'COMPLETE'[\s\S]*probe\.eligibility_status = 'ELIGIBLE'/);
assert.doesNotMatch(migration, /'WATCH'/);

// FSM automatic scope is intentionally narrow; reacquisition stays human.
assert.match(migration, /ACQUISITION','MASTERY_CRITERIA_MET','MASTERED','MAINTENANCE'/);
assert.match(migration, /v_from in \('ACQUISITION','REACQUISITION'\) and v_to = 'MASTERY_CRITERIA_MET'/);
assert.match(migration, /v_from = 'MAINTENANCE' and v_to = 'MAINTENANCE_ALERT'/);
assert.match(migration, /when 'MAINTENANCE_ALERT' then v_to in \('REACQUISITION','MAINTENANCE','PAUSED','DISCONTINUED'\)/);
assert.doesNotMatch(migration, /v_from = 'MAINTENANCE_ALERT' and v_to = 'REACQUISITION'/);

// Session finalization closes every open probe and composes with existing V2 completion atomically.
assert.match(lower, /create or replace function public\.finalize_aba_session_measurements_v3/);
assert.match(lower, /create or replace function public\.complete_aba_session_v3/);
assert.match(migration, /public\.complete_aba_session_atomic_v1\(/);
assert.match(migration, /public\.finalize_aba_behavior_timers_v3\(/);
assert.match(migration, /probe\.lifecycle_status = 'OPEN'/);
assert.match(migration, /p_opened_at timestamptz default null/);
assert.match(migration, /p_closed_at timestamptz default null/);
assert.match(migration, /v_effective_end/);
assert.match(migration, /exposure\.exposure_status = 'PENDING'/);
assert.match(migration, /public\.recompute_aba_session_target_summaries_v3\(/);
assert.match(migration, /public\.evaluate_aba_target_mastery_after_session_v3\(/);

// Browser remains fail-closed and rollout remains dark.
assert.match(lower, /revoke all on table public\.aba_maintenance_probes_v3 from public, anon, authenticated/);
assert.match(lower, /revoke all on function public\.complete_aba_session_v3/);
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.doesNotMatch(lower, /grant select, insert, update on table public\.aba_target_clinical_states_v3/);
assert.doesNotMatch(lower, /grant select, insert on table public\.aba_mastery_criterion_versions_v3/);
assert.match(architecture, /PR6 — probes, fechamento transacional e FSM clínica/i);
assert.match(adr, /INCOMPLETE.*nunca equivale a falha/i);

console.log('ABA Measurement V3 PR6 probes/session/FSM contracts: OK');
