import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260815213000_aba_measurement_v3_pr9b_behavior_interval_task_collection.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-010-behavior-interval-task-collection.md', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const lowerMigration = migration.toLowerCase();

// Additive/dark only: no Legacy shape or rollout enablement.
for (const legacyTable of [
  'aba_sessions','aba_programs','aba_targets','aba_trials','aba_prompt_types',
  'aba_behavior_definitions','aba_behavior_events','aba_interval_records','aba_interval_summaries'
]) {
  assert.doesNotMatch(lowerMigration, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}
assert.doesNotMatch(lowerMigration, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.doesNotMatch(lowerMigration, /update\s+public\.aba_measurement_rollout_states_v3/);

// Behavior identity is explicit, tenant scoped, auditable and never name-inferred.
assert.match(lowerMigration, /create table if not exists public\.aba_behavior_target_bindings_v3/);
assert.match(lowerMigration, /create table if not exists public\.aba_session_behavior_collection_bindings_v3/);
assert.match(migration, /ABA_V3_SESSION_BEHAVIOR_BINDING_IMMUTABLE/);
assert.match(migration, /BEHAVIOR_TARGET_NOT_EXPLICITLY_BOUND/);
assert.match(migration, /'session_behavior_binding_id'/);
assert.match(lowerMigration, /unique index if not exists uq_aba_behavior_target_binding_v3_active/);
assert.match(migration, /validate_aba_behavior_target_binding_v3/);
assert.match(migration, /lower\(target\.target_type\) = 'behavior'/);
assert.match(migration, /archive_aba_behavior_target_v3/);
assert.match(migration, /archive_reason/);
assert.match(migration, /ABA_V3_BEHAVIOR_BINDING_ARCHIVE_REASON_INVALID/);
assert.match(migration, /Historical session-target bindings stay immutable/);
assert.match(migration, /ABA_V3_BEHAVIOR_BINDING_DELETE_FORBIDDEN/);
assert.match(migration, /ABA_V3_BEHAVIOR_BINDING_IDENTITY_IMMUTABLE/);
assert.doesNotMatch(lowerMigration, /lower\(behavior\.name\)|behavior\.name\s*=\s*target\.name|ilike[\s\S]{0,80}target/);

// Browser roles cannot reach the mapping/RPC surface directly.
assert.match(lowerMigration, /alter table public\.aba_behavior_target_bindings_v3 enable row level security/);
assert.match(lowerMigration, /alter table public\.aba_session_behavior_collection_bindings_v3 enable row level security/);
assert.match(lowerMigration, /revoke all on table public\.aba_behavior_target_bindings_v3 from public, anon, authenticated/);
assert.match(lowerMigration, /grant select on table public\.aba_behavior_target_bindings_v3 to service_role/);
assert.match(lowerMigration, /revoke all on function public\.record_aba_behavior_action_v3[\s\S]*?from public, anon, authenticated/);
assert.match(lowerMigration, /grant execute on function public\.record_aba_behavior_action_v3[\s\S]*?to service_role/);

// Behavior writers use canonical PR5 facts and reject method mismatch.
assert.match(migration, /create or replace function public\.record_aba_behavior_action_v3\(/);
for (const action of ['FREQUENCY','RATE_OCCURRENCE','DURATION_START','DURATION_STOP','OBSERVATION_START','OBSERVATION_STOP']) {
  assert.match(migration, new RegExp(action));
}
assert.match(migration, /ABA_V3_BEHAVIOR_METHOD_MISMATCH/);
assert.match(migration, /ABA_V3_BEHAVIOR_PRIMARY_COLLECTOR_ALREADY_ASSIGNED/);
assert.match(migration, /bound_at, metadata[\s\S]*?p_actor_id, 'PRIMARY', v_effective_at/);
assert.match(migration, /ABA_V3_BEHAVIOR_EFFECTIVE_TIME_OUTSIDE_SESSION/);
assert.match(migration, /p_actor_id, p_occurred_at/);
assert.match(migration, /p_actor_id,p_started_at/);
assert.match(migration, /SESSION_DEFAULT/);
assert.match(migration, /where event\.organization_id = p_organization_id and event\.client_event_id = p_client_event_id/);

// Interval wrapper reuses the PR7 canonical grid/bulk/finalizer. The bulk call has exactly its 5 canonical args.
assert.match(migration, /create or replace function public\.start_aba_interval_run_action_v3\(/);
assert.match(migration, /create or replace function public\.record_aba_interval_observation_action_v3\(/);
assert.match(migration, /create or replace function public\.finalize_aba_interval_run_action_v3\(/);
assert.match(migration, /public\.record_aba_interval_observations_bulk_v3\(\s*p_organization_id,\s*p_patient_id,\s*p_interval_run_id,\s*v_run\.primary_collector_binding_id,\s*jsonb_build_array/);
assert.doesNotMatch(migration, /record_aba_interval_observations_bulk_v3\([\s\S]{0,500}p_actor_id[\s\S]{0,200}\)/);
assert.match(migration, /public\.finalize_aba_interval_run_v3\(/);

// Task Analysis is its own categorical atomic run, not weighted DTT trials.
assert.match(migration, /create or replace function public\.get_aba_task_analysis_definition_for_session_v3\(/);
assert.match(migration, /create or replace function public\.record_aba_task_analysis_action_v3\(/);
assert.match(migration, /lower\(v_target\.target_type\) <> 'task_analysis'/);
assert.match(migration, /public\.record_aba_task_analysis_run_v3\(/);
assert.match(migration, /result\.performance_code = 'PROMPTED'/);
assert.match(migration, /prompt\.active[\s\S]*?prompt\.show_in_session/);
assert.doesNotMatch(lowerMigration, /independence_score|response_score/);

// Server boundary: opt-in, scoped, minimal reads and strict payload sizes.
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/behavior-catalog[\s\S]*?requireAbaV3CollectionFeature[\s\S]*?requireClinicCapability\('aba\.behavior\.record'\)[\s\S]*?checkPatientAccess/);
assert.match(server, /\.select\('id,name,measurement_type,interval_seconds,status'\)/);
assert.match(server, /\.eq\('patient_id', patientId\)[\s\S]*?\.eq\('clinic_id', organizationId\)[\s\S]*?\.limit\(200\)/);
assert.match(server, /\/api\/aba\/v3\/behavior-actions[\s\S]*?enforcePayloadLimit\(req, res, 48 \* 1024/);
assert.match(server, /\/api\/aba\/v3\/interval-runs[\s\S]*?enforcePayloadLimit\(req, res, 32 \* 1024/);
assert.match(server, /\/api\/aba\/v3\/task-analysis-runs[\s\S]*?enforcePayloadLimit\(req, res, 96 \* 1024/);
assert.match(server, /assertAbaSessionCanAcceptClinicalWrite/);
assert.match(server, /supabase\.rpc\('record_aba_behavior_action_v3'/);
assert.match(server, /supabase\.rpc\('start_aba_interval_run_action_v3'/);
assert.match(server, /supabase\.rpc\('record_aba_interval_observation_action_v3'/);
assert.match(server, /supabase\.rpc\('record_aba_task_analysis_action_v3'/);

// Client reuses canonical catalog/state; V3 families never call their Legacy writers.
assert.match(dataService, /getAbaV3BehaviorCatalog/);
assert.match(dataService, /saveOfflineFirst\(clientEventId, data, 'aba_v3', '\/api\/aba\/v3\/behavior-actions', 'POST', \{ queueEntityId \}\)/);
assert.match(dataService, /observations`, 'POST', \{ queueEntityId: runId \}\)/);
assert.match(dataService, /saveOfflineFirst\(clientEventId, data, 'aba_v3', '\/api\/aba\/v3\/task-analysis-runs', 'POST'\)/);
assert.match(localDb, /pending\.sort\(\(a, b\) => a\.last_updated - b\.last_updated\)/);
assert.match(localDb, /Never let a newer mutation overtake an unresolved older mutation/);
assert.match(dataService, /options: \{ queueEntityId\?: string \} = \{\}/);
assert.match(dataService, /entity_id: queueEntityId/);
assert.match(dataService, /finalize`, 'POST', \{ queueEntityId: runId \}\)/);
assert.match(sessionMode, /causalEntityId: measurementType === 'rate'/);
assert.match(sessionMode, /Duração V3 não pode ser descartada/);

assert.match(sessionMode, /canonicalBehaviorPresets/);
assert.match(sessionMode, /sessionBehaviorPresets/);
assert.match(sessionMode, /abaV3BehaviorBindingCacheRef/);
assert.match(sessionMode, /resolveAbaV3BehaviorForAction/);
assert.match(sessionMode, /persistAbaV3BehaviorPayload/);
assert.match(sessionMode, /measurementModelVersion: 'V3'/);
assert.match(sessionMode, /ABC ainda não possui modelo V3|ABC V3/i);
assert.match(sessionMode, /Pausa indisponível nesta coleta V3/i);
assert.match(sessionMode, /V3 · imutável/);
assert.match(sessionMode, /openAbaV3TaskAnalysis/);
assert.match(sessionMode, /saveAbaV3TaskAnalysis/);
for (const code of ['NOT_OBSERVED','INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE']) {
  assert.match(sessionMode, new RegExp(code));
}

// Dark flags + docs remain explicit.
assert.match(envExample, /^FEATURE_ABA_V3_READ_API=false$/m);
assert.match(envExample, /^FEATURE_ABA_V3_COLLECTION_API=false$/m);
assert.match(envExample, /^VITE_FEATURE_ABA_V3_UI=false$/m);
assert.match(architecture, /PR9B — comportamento, intervalos e Task Analysis na coleta V3/i);
assert.match(architecture, /A próxima etapa é \*\*PR10\*\*/i);
assert.match(adr, /Não existe comparação de nomes/i);
assert.match(adr, /ABC não é convertido/i);
assert.match(adr, /Produção não é habilitada pelo PR9B/i);

console.log('ABA Measurement V3 PR9B behavior/interval/task collection contracts: OK');
