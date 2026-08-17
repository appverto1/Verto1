import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260816003000_aba_measurement_v3_pr12_dark_preflight_attestation.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const smoke = readFileSync('scripts/aba-v3-pilot-smoke.mjs', 'utf8');
const runbook = readFileSync('docs/operations/ABA_V3_PILOT_RUNBOOK.md', 'utf8');

assert.match(migration, /create or replace function public\.get_aba_v3_preflight_scope_snapshot/);
assert.match(migration, /language plpgsql\s+stable\s+security definer/i);
assert.match(migration, /scope_fingerprint/);
assert.match(migration, /digest\(convert_to\(v_metrics::text, 'UTF8'\), 'sha256'\)/);
assert.match(migration, /rollout_dark/);
assert.match(migration, /enabled_rollout_count/);
assert.match(migration, /aba_session_target_measurement_bindings/);
assert.match(migration, /aba_trials_v3/);
assert.match(migration, /aba_behavior_events_v3/);
assert.match(migration, /aba_interval_runs_v3/);
assert.match(migration, /aba_task_analysis_runs_v3/);
assert.match(migration, /aba_sync_quarantine_v3/);
assert.match(migration, /aba_measurement_rollout_states_v3/);
assert.doesNotMatch(migration, /\binsert\s+into\b/i);
assert.doesNotMatch(migration, /\bupdate\s+public\./i);
assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
assert.match(migration, /revoke all on function public\.get_aba_v3_preflight_scope_snapshot\(uuid,uuid\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.get_aba_v3_preflight_scope_snapshot\(uuid,uuid\) to service_role/);

assert.match(server, /\/api\/aba\/v3\/admin\/preflight-snapshot/);
assert.match(server, /requireAbaV3PreflightFeature,[\s\S]*?checkAuth,[\s\S]*?checkPlatformAdmin/);
assert.match(server, /supabase\.rpc\('get_aba_v3_preflight_scope_snapshot'/);
assert.match(server, /darkPreflightProfile/);
assert.match(server, /collectionApiEnabled: isAbaV3CollectionApiEnabled\(\)/);
assert.match(server, /rolloutAdminEnabled: isAbaV3RolloutAdminEnabled\(\)/);
assert.match(server, /uiBuildFlagEnabled: normalizeServerFeatureFlag\(process\.env\.VITE_FEATURE_ABA_V3_UI, false\)/);

assert.match(smoke, /preflight-snapshot-before/);
assert.match(smoke, /preflight-snapshot-after/);
assert.match(smoke, /scope_fingerprint/);
assert.match(smoke, /beforeFingerprint === afterFingerprint/);
assert.match(smoke, /rollout_dark/);
assert.match(smoke, /darkPreflightProfile/);
assert.match(smoke, /Não avance para rollout/);

assert.match(runbook, /fingerprint antes/i);
assert.match(runbook, /fingerprint depois/i);
assert.match(runbook, /darkPreflightProfile=true/);
assert.match(runbook, /qualquer diferença de fingerprint/i);

console.log('ABA Measurement V3 PR12 dark preflight attestation contract: OK');
