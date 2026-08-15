import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815193000_aba_measurement_v3_read_models_endpoints.sql',
  'utf8',
);
const server = readFileSync('server.ts', 'utf8');
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-008-read-models-node-boundary.md', 'utf8');
const lower = migration.toLowerCase();

// PR8 is additive: no Legacy V2 table is altered and rollout remains dark.
for (const legacyTable of [
  'aba_sessions', 'aba_programs', 'aba_targets', 'aba_trials', 'aba_behavior_events',
  'aba_interval_records', 'aba_interval_summaries', 'aba_session_summaries', 'aba_prompt_types',
]) {
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}
assert.doesNotMatch(lower, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);

// Every supported read model is a security-invoker view.
for (const view of [
  'aba_session_target_read_v3',
  'aba_session_task_analysis_read_v3',
  'aba_session_behavior_read_v3',
  'aba_session_interval_read_v3',
  'aba_session_ioa_read_v3',
  'aba_maintenance_probe_read_v3',
  'aba_target_state_read_v3',
  'aba_session_target_binding_read_v3',
]) {
  assert.match(lower, new RegExp(`create or replace view public\\.${view}\\s+with \\(security_invoker = true\\)`));
  assert.match(lower, new RegExp(`revoke all on public\\.${view} from public, anon, authenticated`));
  assert.match(lower, new RegExp(`grant select on public\\.${view} to service_role`));
}

// Official patient metrics stay PRIMARY-only; IOA remains a separate surface.
assert.match(lower, /from public\.aba_official_session_behavior_summaries_v3 summary/);
assert.match(lower, /from public\.aba_official_interval_summaries_v3 summary/);
assert.match(lower, /create or replace view public\.aba_session_ioa_read_v3/);
assert.doesNotMatch(lower, /aba_session_behavior_read_v3[^;]{0,5000}reliability_collector_binding_id/);

// Prompts are categorical/count-based. Legacy weighted scores never enter V3 reads.
assert.match(lower, /summary\.prompt_step_counts/);
assert.match(lower, /summary\.prompt_counts/);
assert.doesNotMatch(lower, /independence_score/);
assert.doesNotMatch(lower, /response_score/);

// One RPC per read use-case, with server-side scope and history bounds.
for (const fn of [
  'get_aba_session_read_bundle_v3',
  'get_aba_patient_overview_v3',
  'get_aba_target_history_v3',
]) {
  assert.match(lower, new RegExp(`create or replace function public\\.${fn}\\(`));
}
assert.match(migration, /greatest\(1, least\(coalesce\(p_limit, 90\), 180\)\)/);
assert.match(migration, /v_to - v_from > interval '366 days'/);
assert.match(migration, /ABA_V3_READ_SESSION_SCOPE_INVALID/);
assert.match(migration, /ABA_V3_READ_PATIENT_SCOPE_INVALID/);
assert.match(migration, /ABA_V3_READ_TARGET_SCOPE_INVALID/);
assert.match(lower, /create index if not exists idx_aba_session_behavior_summaries_v3_scope/);
assert.match(lower, /create index if not exists idx_aba_interval_summaries_v3_scope/);

// Browser roles cannot call the service read RPCs directly.
assert.match(lower, /revoke all on function public\.get_aba_session_read_bundle_v3\(uuid,uuid,text\) from public, anon, authenticated/);
assert.match(lower, /revoke all on function public\.get_aba_patient_overview_v3\(uuid,uuid\) from public, anon, authenticated/);
assert.match(lower, /revoke all on function public\.get_aba_target_history_v3\(uuid,uuid,text,timestamptz,timestamptz,integer\) from public, anon, authenticated/);

// Node boundary is opt-in, authenticated, capability-scoped and patient/session-scoped.
assert.match(server, /const isAbaV3ReadApiEnabled = \(\) => normalizeServerFeatureFlag\([\s\S]*?FEATURE_ABA_V3_READ_API,[\s\S]*?false/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/overview[\s\S]*?requireAbaV3ReadFeature,[\s\S]*?checkAuth,[\s\S]*?requireClinicCapability\('aba\.analytics\.view'\),[\s\S]*?checkPatientAccess/);
assert.match(server, /\/api\/aba\/v3\/sessions\/:sessionId\/read-model[\s\S]*?requireAbaV3ReadFeature,[\s\S]*?checkAuth,[\s\S]*?requireClinicCapability\('aba\.analytics\.view'\)[\s\S]*?resolveAbaSessionReadScope/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/targets\/:targetId\/history[\s\S]*?checkPatientAccess[\s\S]*?parseAbaChartParams/);
assert.match(server, /supabase\.rpc\('get_aba_patient_overview_v3'/);
assert.match(server, /supabase\.rpc\('get_aba_session_read_bundle_v3'/);
assert.match(server, /supabase\.rpc\('get_aba_target_history_v3'/);

// PR9 owns the prompt UI change; PR10 owns graph segmentation.
assert.match(architecture, /PR8 — read models canônicos e fronteira Node/i);
assert.match(architecture, /Tipos de ajuda ABA[\s\S]*PR9/i);
assert.match(architecture, /series_segments[\s\S]*PR10/i);
assert.match(adr, /FEATURE_ABA_V3_READ_API.*false por padrão/i);
assert.match(adr, /pontuação 0–100/i);
assert.match(adr, /PR9/i);

console.log('ABA Measurement V3 PR8 read-model/Node-boundary contracts: OK');
