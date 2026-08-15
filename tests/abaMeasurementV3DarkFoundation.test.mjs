import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815123000_aba_measurement_v3_dark_foundation.sql',
  'utf8'
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-001-dark-rollout.md', 'utf8');

const lower = migration.toLowerCase();

for (const table of [
  'aba_collection_definition_versions_v3',
  'aba_target_phase_assignments_v3',
  'aba_measurement_rollout_states_v3',
  'aba_measurement_rollout_events_v3',
  'aba_session_target_measurement_bindings'
]) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`alter table public\\.${table} enable row level security`));
}

// Dark launch: no tenant is activated by the migration and the gates are independent.
assert.match(migration, /allow_new_v3_sessions boolean not null default false/i);
assert.match(migration, /accept_v3_sync boolean not null default false/i);
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);

// Phase and collection version are deliberately orthogonal.
const phaseTable = migration.match(
  /create table if not exists public\.aba_target_phase_assignments_v3[\s\S]*?\n\);/
)?.[0] ?? '';
assert.ok(phaseTable.length > 0, 'phase table definition not found');
assert.doesNotMatch(phaseTable, /collection_definition_version_id/i);

// Mid-session upgrades cannot mutate an existing session + target decision.
assert.match(migration, /unique \(session_id, target_id\)/i);
assert.match(migration, /ABA_V3_SESSION_TARGET_BINDING_IMMUTABLE/);

// A V3 binding must reference BOTH independent dimensions.
assert.match(
  migration,
  /measurement_model_version = 'V3'[\s\S]*collection_definition_version_id is not null[\s\S]*target_phase_assignment_id is not null/i
);

// The new schema must not ALTER the clinical V2 source tables in this PR.
for (const legacyTable of [
  'aba_trials',
  'aba_sessions',
  'aba_targets',
  'aba_programs',
  'aba_session_summaries'
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`),
    `dark foundation must not alter ${legacyTable}`
  );
}

// Browser access is fail-closed until narrow RPCs are introduced in later PRs.
assert.match(
  lower,
  /revoke all on table public\.aba_session_target_measurement_bindings from public, anon, authenticated/
);
assert.match(
  lower,
  /grant all on table public\.aba_session_target_measurement_bindings to service_role/
);

// New-table writes are scope-checked against existing patient/program/target/session ownership.
assert.match(migration, /ABA_V3_PATIENT_SCOPE_INVALID/);
assert.match(migration, /ABA_V3_TARGET_SCOPE_INVALID/);
assert.match(migration, /ABA_V3_SESSION_SCOPE_INVALID/);

assert.match(architecture, /nenhum dado V2 é reescrito/i);
assert.match(architecture, /accept_v3_sync/i);
assert.match(architecture, /allow_new_v3_sessions/i);
assert.match(architecture, /session_id, target_id/i);
assert.match(adr, /EMERGENCY_LEGACY_BRIDGE/i);

console.log('ABA Measurement V3 dark foundation contracts: OK');
