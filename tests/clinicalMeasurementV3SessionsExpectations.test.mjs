import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260820144500_clinical_measurement_v3_sessions_expectations.sql';
const migration = readFileSync(migrationPath, 'utf8');
const lower = migration.toLowerCase();

const tables = [
  'clinical_measurement_sessions_v3',
  'clinical_measurement_session_expectations_v3',
  'clinical_measurement_collection_streams_v3'
];

for (const table of tables) {
  assert.match(lower, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(lower, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(
    lower,
    new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
    `${table} must remain browser-closed in Migration B`
  );
  assert.match(
    lower,
    new RegExp(`grant all on table public\\.${table} to service_role`),
    `${table} must remain available to server-side runtime`
  );
}

// Clinical calendar is server-derived from the frozen timezone + session start.
assert.match(migration, /clinical_date date not null/i);
assert.match(migration, /timezone_snapshot text not null/i);
assert.match(migration, /timezone_offset_minutes integer not null/i);
assert.match(migration, /new\.clinical_date := timezone\(v_timezone, new\.started_at\)::date/i);
assert.match(migration, /new\.recorded_at := clock_timestamp\(\)/i);
assert.match(migration, /pg_catalog\.pg_timezone_names/i);
assert.match(migration, /SESSION_START_LOCAL_DATE/);
assert.match(migration, /expectations_sealed_at timestamptz/i);
assert.match(migration, /status in \('PREPARING', 'OPEN', 'FINALIZED', 'CANCELED'\)/i);
assert.match(migration, /CMV3_SESSION_INSERT_MUST_PREPARE/);

// Midnight sessions keep one clinical date; event-local dates remain a later raw-event concern.
assert.doesNotMatch(lower, /clinical_date\s*:=\s*current_date/);
assert.doesNotMatch(lower, /clinical_date\s*:=\s*new\.recorded_at/);

// Expectations are explicit facts. No synthetic NOT_COLLECTED/NOT_SCHEDULED rows are materialized.
assert.match(migration, /CMV3_SESSION_EXPECTATION_IMMUTABLE/);
assert.match(migration, /CMV3_EXPECTATION_SET_SEALED/);
assert.match(migration, /CMV3_SESSION_EXPECTATION_SET_EMPTY/);
assert.match(migration, /new\.expectations_sealed_at := clock_timestamp\(\)/i);
assert.match(migration, /unique \(session_id, protocol_snapshot_id\)/i);
assert.match(migration, /clinical_collection_protocol_snapshots_v3/i);
assert.doesNotMatch(lower, /status\s+text[^;]*(not_collected|not_scheduled)/s);

// Streams are logical identities: one PRIMARY per expectation, device swaps do not create denominator identities.
assert.match(migration, /ux_cmv3_primary_stream_per_expectation/i);
assert.match(migration, /where stream_role = 'PRIMARY'/i);
assert.match(migration, /stream_role in \('PRIMARY', 'RELIABILITY'\)/i);
assert.match(migration, /paired_primary_stream_id uuid/i);
assert.match(migration, /CMV3_STREAM_PRIMARY_PAIR_INVALID/);
assert.match(migration, /CMV3_RELIABILITY_OBSERVER_MUST_DIFFER/);
assert.match(migration, /CMV3_STREAM_OBSERVER_SCOPE_INVALID/);
assert.match(migration, /CMV3_SESSION_OPEN_STREAMS_EXIST/);

// Session and expectation identities are immutable; only explicit lifecycle closure is allowed.
assert.match(migration, /CMV3_SESSION_IDENTITY_IMMUTABLE/);
assert.match(migration, /CMV3_SESSION_TERMINAL_STATE_IMMUTABLE/);
assert.match(migration, /CMV3_SESSION_DELETE_FORBIDDEN/);
assert.match(migration, /CMV3_STREAM_IDENTITY_IMMUTABLE/);
assert.match(migration, /CMV3_STREAM_DELETE_FORBIDDEN/);

// A legacy ABA session may be referenced for compatibility but its scope is revalidated server-side.
assert.match(migration, /source_kind in \('NATIVE_V3', 'ABA_SESSION'\)/i);
assert.match(migration, /CMV3_ABA_SESSION_SCOPE_INVALID/);
assert.match(migration, /CMV3_SESSION_PATIENT_SCOPE_INVALID/);

// Migration B must remain dark and additive: no browser RPC and no mutation of legacy/live domains.
assert.doesNotMatch(lower, /grant execute on function[\s\S]*to authenticated/);
for (const legacyTable of [
  'aba_sessions',
  'aba_trials',
  'aba_trials_v3',
  'aba_session_target_bindings_v3',
  'patient_therapeutic_plans',
  'patient_therapeutic_objectives',
  'appointments'
]) {
  assert.doesNotMatch(
    lower,
    new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`),
    `Migration B must not alter ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`),
    `Migration B must not write ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`update\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Migration B must not update ${legacyTable}`
  );
  assert.doesNotMatch(
    lower,
    new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`),
    `Migration B must not delete from ${legacyTable}`
  );
}

console.log('Clinical Measurement Engine V3 Migration B contracts: OK');
