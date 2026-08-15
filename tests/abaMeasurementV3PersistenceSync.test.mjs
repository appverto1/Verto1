import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815143000_aba_measurement_v3_persistence_sync.sql',
  'utf8',
);
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync(
  'docs/architecture/ADR-ABA-V3-003-persistence-offline-sync.md',
  'utf8',
);
const lower = migration.toLowerCase();

// V3 raw persistence is parallel; Legacy V2 tables are not altered.
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
    `PR3 must not alter ${legacyTable}`,
  );
}

assert.match(lower, /create table if not exists public\.aba_trials_v3/);
assert.match(lower, /create table if not exists public\.aba_trial_steps_v3/);
assert.match(lower, /create table if not exists public\.aba_session_target_exposures_v3/);
assert.match(lower, /create table if not exists public\.aba_sync_quarantine_v3/);

// Envelope has no duplicate clinical truth.
assert.doesNotMatch(
  migration.match(/create table if not exists public\.aba_trials_v3[\s\S]*?\n\);/)?.[0] ?? '',
  /\b(correct|independent|independence_percent|accuracy_percent|response_score)\b/i,
);

// Complex trial + denominator invariants are relational.
assert.match(migration, /unique \(trial_id, sequence_no\)/i);
assert.match(migration, /ux_aba_trial_steps_v3_primary_independent/i);
assert.match(migration, /where opportunity_role = 'PRIMARY_INDEPENDENT'/i);
assert.match(migration, /Complex trial is atomic/i);

// Retry/idempotency and offline historical interpretation.
assert.match(migration, /unique \(organization_id, client_event_id\)/i);
assert.match(migration, /payload_hash/i);
assert.match(migration, /IDEMPOTENCY_PAYLOAD_CONFLICT/i);
assert.match(migration, /phase\.effective_from <= stage\.occurred_at/i);
assert.match(migration, /stage\.occurred_at < phase\.effective_until/i);
assert.match(migration, /protocol_version_deprecated_at_sync/i);
assert.match(migration, /COLLECTION_VERSION_BINDING_MISMATCH/i);
assert.match(migration, /ABA_V3_SYNC_CURRENTLY_DISABLED/i);
assert.match(migration, /SESSION_TIME_WINDOW_MISMATCH/i);
assert.match(migration, /TRIAL_STEP_SEQUENCE_GAP/i);

assert.match(migration, /batch_duplicate boolean not null default false/i);
assert.match(migration, /having count\(distinct grouped\.payload_hash\) > 1/i);
assert.match(migration, /and stage\.batch_duplicate = false/i);
assert.match(migration, /phase\.created_at <= stage\.occurred_at/i);
assert.match(migration, /ABA_V3_BINDING_PHASE_NOT_VALID_AT_SESSION_START/i);
assert.match(migration, /ABA_V3_TARGET_PHASE_CLOSURE_BEFORE_RECORDED_EVENT/i);
assert.match(migration, /ABA_V3_QUARANTINE_REASON_NOT_RETRYABLE/i);

// Bulk is set-oriented by distinct session+target, not one resolver RPC per trial.
assert.match(migration, /select distinct stage\.session_id, stage\.target_id/i);
assert.match(migration, /cross join lateral public\.resolve_aba_session_target_measurement_binding_v1/i);
assert.match(migration, /jsonb_array_length\(p_trials\)/i);
assert.match(migration, /v_received > 500/i);

// Quarantine never permits version de/para.
assert.match(migration, /ABA_V3_QUARANTINE_VERSION_REMAP_FORBIDDEN/i);
assert.match(migration, /resolved_collection_definition_version_id = original_collection_definition_version_id/i);
assert.match(adr, /não oferece De\/Para/i);

// Valid trials deterministically promote exposure once, with guarded upsert.
assert.match(migration, /on conflict \(session_id, target_id\) do update/i);
assert.match(migration, /where public\.aba_session_target_exposures_v3\.exposure_status <> 'COLLECTED'/i);
assert.match(migration, /VALID_TRIAL_PROMOTED_EXPOSURE/i);

// Raw/revision/audit surfaces are append-only and direct browser access remains closed.
assert.match(migration, /ABA_V3_RAW_EVENT_APPEND_ONLY/i);
assert.match(lower, /revoke all on table public\.aba_trials_v3 from public, anon, authenticated/);
assert.match(lower, /grant execute on function public\.record_aba_trials_bulk_v3\(uuid, uuid, jsonb, uuid\) to service_role/);
assert.match(lower, /create or replace function public\.record_aba_trial_v3/);
assert.match(migration, /jsonb_build_array\(p_trial\)/i);
assert.match(lower, /revoke all on function public\.record_aba_trials_bulk_v3\(uuid, uuid, jsonb, uuid\) from public, anon, authenticated/);

// PR3 is still dark: it must not create rollout enablement rows.
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.match(architecture, /PR3 — persistência raw V3 e sincronização offline/i);
assert.match(architecture, /PR3 não cria summaries/i);

console.log('ABA Measurement V3 PR3 persistence + offline sync contracts: OK');
