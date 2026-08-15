import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815153000_aba_measurement_v3_server_summaries.sql',
  'utf8',
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync(
  'docs/architecture/ADR-ABA-V3-004-server-summaries-reconciliation.md',
  'utf8',
);
const lower = migration.toLowerCase();

// PR4 remains parallel and must not mutate Legacy V2.
for (const legacyTable of [
  'aba_sessions',
  'aba_trials',
  'aba_targets',
  'aba_programs',
  'aba_session_summaries',
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`),
    `PR4 must not alter ${legacyTable}`,
  );
}

assert.match(lower, /create table if not exists public\.aba_session_target_summaries_v3/);
assert.match(lower, /unique \(session_id, target_id, target_phase_assignment_id\)/);
assert.match(migration, /ABA_V3_TRIAL_STEPS_REQUIRED_AT_COMMIT/);
assert.match(lower, /create constraint trigger validate_aba_trial_v3_has_steps_at_commit/);
assert.match(lower, /deferrable initially deferred/);
assert.match(lower, /create or replace view public\.aba_effective_trials_v3/);
assert.match(migration, /latest_revision_event_type = 'RESTORE'/);
assert.match(migration, /VOID \/ CORRECT \/ SUPERSEDE/);

// Independence is trial-level and zero eligible opportunities remain N/A.
assert.match(migration, /eligible_independent_opportunity_count/);
assert.match(migration, /primary_independent_correct_count/);
assert.match(migration, /when coalesce\(counts\.eligible_independent_opportunity_count, 0\) = 0 then null/i);
assert.match(migration, /count\(\*\) filter \(where has_primary_independent\)/i);
assert.doesNotMatch(lower, /accuracy_percent/);

// One mathematical implementation powers both recompute and verification.
assert.match(lower, /create or replace function public\.compute_aba_session_target_summary_projection_v3/);
assert.match(lower, /create or replace function public\.recompute_aba_session_target_summary_v3/);
assert.match(lower, /create or replace function public\.verify_aba_session_target_summary_v3/);
assert.match(lower, /create or replace function public\.record_aba_trial_correction_v3/);
assert.match(migration, /ABA_V3_ATOMIC_CORRECTION_REPLACEMENT_NOT_ACCEPTED/);
assert.match(migration, /source_projection_hash/);
assert.match(migration, /summary_definition_version/);

// Bulk reconciliation must be statement-level, not one trigger execution per step/trial.
assert.match(lower, /referencing new table as new_steps/);
assert.match(lower, /for each statement execute function public\.reconcile_aba_v3_summaries_after_steps_insert/);
assert.match(migration, /select distinct[\s\S]*trial\.target_phase_assignment_id/i);

// Revision reconciliation is synchronous and annotation-only events do not rewrite cache.
assert.match(lower, /after insert on public\.aba_trial_revisions_v3/);
assert.match(migration, /if new\.event_type = 'ANNOTATE' then/i);
assert.match(migration, /perform public\.recompute_aba_session_target_summary_v3/i);

// Lock is granular to phase segment and browser remains fail-closed.
assert.match(migration, /p_target_phase_assignment_id::text/);
assert.match(lower, /revoke all on table public\.aba_session_target_summaries_v3 from public, anon, authenticated/);
assert.match(lower, /grant select on table public\.aba_session_target_summaries_v3 to service_role/);
assert.doesNotMatch(lower, /grant all on table public\.aba_session_target_summaries_v3 to service_role/);

// Dark rollout remains dark.
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.match(architecture, /PR4 — summaries canônicos e reconciliação server-side/i);
assert.match(adr, /raw efetivo continua sendo a autoridade/i);

console.log('ABA Measurement V3 PR4 canonical server summaries contracts: OK');
