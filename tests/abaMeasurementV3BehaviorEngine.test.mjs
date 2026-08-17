import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260815163000_aba_measurement_v3_behavior_engine.sql', 'utf8');
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const lower = migration.toLowerCase();

for (const legacyTable of ['aba_behavior_events','aba_sessions','aba_trials','aba_targets']) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}

assert.match(lower, /create table if not exists public\.aba_behavior_observation_slices_v3/);
assert.match(lower, /create table if not exists public\.aba_behavior_events_v3/);
assert.match(lower, /create table if not exists public\.aba_behavior_collector_bindings_v3/);
assert.match(lower, /create unique index if not exists uq_aba_behavior_primary_collector_v3/);
assert.match(migration, /collector_role in \('PRIMARY','RELIABILITY'\)/);
assert.match(lower, /exclude using gist/);
assert.match(lower, /collector_binding_id with =/);
assert.match(lower, /active_observation_seconds/);
assert.match(migration, /v_frequency::numeric \* 3600\.0/);
assert.match(migration, /when v_observation_seconds > 0/);
assert.match(migration, /is_censored = true/);
assert.match(migration, /SESSION_FINALIZATION/);
assert.match(migration, /requires_review/);
assert.match(lower, /create or replace view public\.aba_official_session_behavior_summaries_v3/);
assert.match(migration, /collector_role = 'PRIMARY'/);
assert.match(lower, /behavior_observation_slice/);
assert.match(lower, /behavior_event/);
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.match(architecture, /PR5/i);

console.log('ABA Measurement V3 PR5 behavior engine contracts: OK');
