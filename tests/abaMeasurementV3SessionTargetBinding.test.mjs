import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const foundation = readFileSync(
  'supabase/migrations/20260815123000_aba_measurement_v3_dark_foundation.sql',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/20260815133000_aba_measurement_v3_session_target_binding_resolver.sql',
  'utf8',
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync(
  'docs/architecture/ADR-ABA-V3-002-session-target-binding-resolver.md',
  'utf8',
);

const lower = migration.toLowerCase();

// PR1 and PR2 must coexist: uploaded repository must retain the dark foundation.
assert.match(foundation, /aba_session_target_measurement_bindings/i);
assert.match(foundation, /allow_new_v3_sessions boolean not null default false/i);
assert.match(foundation, /accept_v3_sync boolean not null default false/i);

// Decision is frozen by session start, not request/sync time.
assert.match(migration, /v_session\.started_at/i);
assert.match(migration, /decision_at/i);
assert.match(migration, /ROLLOUT_NOT_ENABLED_AT_SESSION_START/i);
assert.match(adr, /decision_at = aba_sessions\.started_at/i);

// Historical rollout state is reconstructed from append-only rollout events.
assert.match(migration, /from public\.aba_measurement_rollout_events_v3 event/i);
assert.match(migration, /effective_from/i);
assert.match(migration, /ABA_V3_ROLLOUT_BACKDATE_FORBIDDEN/i);
assert.match(migration, /ABA_V3_ROLLOUT_EFFECTIVE_FROM_REQUIRED/i);

// Pilot gates are fail-closed and sync readiness is mandatory before new V3 bindings.
assert.match(migration, /v_allow :=[\s\S]*v_clinic[\s\S]*v_patient[\s\S]*v_enrollment/i);
assert.match(migration, /v_accept :=[\s\S]*v_clinic[\s\S]*v_patient[\s\S]*v_enrollment/i);
assert.match(migration, /if v_target is not null then[\s\S]*v_enrollment := v_target[\s\S]*else[\s\S]*v_enrollment := v_program/i);
assert.match(migration, /ABA_V3_SYNC_NOT_READY_FOR_NEW_BINDING/i);

// Binding write is serialized only for the exact session + target and remains immutable.
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /p_organization_id::text \|\| ':' \|\| p_session_id \|\| ':' \|\| p_target_id/i);
assert.match(foundation, /unique \(session_id, target_id\)/i);
assert.match(foundation, /ABA_V3_SESSION_TARGET_BINDING_IMMUTABLE/i);
assert.match(migration, /when unique_violation then/i);

// V3 prerequisites are resolved at session start and historical deprecated versions remain valid.
assert.match(migration, /definition\.published_at <= v_session\.started_at/i);
assert.match(migration, /definition\.deprecated_at is null[\s\S]*v_session\.started_at < definition\.deprecated_at/i);
assert.match(migration, /phase\.effective_from <= v_session\.started_at/i);
assert.match(migration, /v_session\.started_at < phase\.effective_until/i);
assert.match(migration, /ABA_V3_COLLECTION_DEFINITION_MISSING_AT_SESSION_START/i);
assert.match(migration, /ABA_V3_TARGET_PHASE_MISSING_AT_SESSION_START/i);

// Emergency bridge is infrastructure-only, audited and browser fail-closed.
assert.match(lower, /create table if not exists public\.aba_emergency_legacy_bridges_v3/);
assert.match(lower, /create table if not exists public\.aba_emergency_legacy_bridge_events_v3/);
assert.match(migration, /ACTIVE_EMERGENCY_LEGACY_BRIDGE/i);
assert.match(migration, /ABA_V3_EMERGENCY_BRIDGE_EVENT_APPEND_ONLY/i);
assert.match(lower, /revoke all on table public\.aba_emergency_legacy_bridges_v3 from public, anon, authenticated/);

// Resolver itself is backend-only; PR2 must not expose a browser RPC.
assert.match(
  lower,
  /revoke all on function public\.resolve_aba_session_target_measurement_binding_v1\(uuid, uuid, text, text, uuid\) from public, anon, authenticated/,
);
assert.match(
  lower,
  /grant execute on function public\.resolve_aba_session_target_measurement_binding_v1\(uuid, uuid, text, text, uuid\) to service_role/,
);

// PR2 remains additive: no V2 source table may be altered.
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
    `PR2 must not alter ${legacyTable}`,
  );
}

assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.match(architecture, /PR2 — resolução imutável do binding/i);
assert.match(architecture, /sessões que\s+começaram antes de uma ativação/i);

console.log('ABA Measurement V3 PR2 immutable binding contracts: OK');
