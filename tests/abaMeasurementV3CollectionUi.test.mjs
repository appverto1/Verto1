import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260815203000_aba_measurement_v3_pr9a_atomic_trial_collection_bridge.sql',
  'utf8',
);
const server = readFileSync('server.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const settings = readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const featureFlags = readFileSync('src/utils/featureFlags.ts', 'utf8');
const collectionUtils = readFileSync('src/utils/abaV3Collection.ts', 'utf8');
const summary = readFileSync('src/utils/abaSessionSummary.ts', 'utf8');
const architecture = readFileSync('docs/architecture/aba-measurement-v3.md', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-009-collection-ui-node-boundary.md', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const lowerMigration = migration.toLowerCase();

// PR9 is additive and dark: no Legacy table shape or rollout state is mutated.
for (const legacyTable of [
  'aba_sessions', 'aba_programs', 'aba_targets', 'aba_trials', 'aba_prompt_types',
  'aba_session_summaries', 'aba_behavior_events', 'aba_interval_records',
]) {
  assert.doesNotMatch(lowerMigration, new RegExp(`alter\\s+table\\s+public\\.${legacyTable}(?:\\s|;)`));
}
assert.doesNotMatch(lowerMigration, /insert\s+into\s+public\.aba_measurement_rollout_states_v3/);
assert.doesNotMatch(lowerMigration, /update\s+public\.aba_measurement_rollout_states_v3/);

// Maintenance trial + probe link is one transaction and replay-safe after finalization.
assert.match(lowerMigration, /create or replace function public\.record_aba_trial_action_v3\(/);
assert.match(migration, /v_result := public\.record_aba_trial_v3\(/);
assert.match(migration, /v_probe := public\.open_aba_maintenance_probe_v3\(/);
assert.match(migration, /from public\.aba_maintenance_probe_trials_v3 link[\s\S]*?if not found then[\s\S]*?public\.link_aba_trial_to_maintenance_probe_v3\(/);
assert.match(lowerMigration, /revoke all on function public\.record_aba_trial_action_v3\(uuid,uuid,jsonb,text,uuid\)[\s\S]*?from public, anon, authenticated/);
assert.match(lowerMigration, /grant execute on function public\.record_aba_trial_action_v3\(uuid,uuid,jsonb,text,uuid\)[\s\S]*?to service_role/);
assert.match(migration, /trial_action_rpc_ready/);
assert.match(migration, /hybrid_completion_ready/);
assert.match(migration, /no_new_v3_sessions_enabled/);
assert.match(lowerMigration, /target\.target_type/);
assert.match(lowerMigration, /v_target_type not in \('dtt', 'net', 'probe'\)/);
assert.match(migration, /ABA_V3_UI_MEASUREMENT_NOT_READY/);
assert.match(migration, /v_binding := public\.resolve_aba_session_target_measurement_binding_v1\(/);
assert.match(migration, /p_trial[\s\S]*?- 'collection_definition_version_id'[\s\S]*?- 'target_phase_assignment_id'[\s\S]*?jsonb_build_object\([\s\S]*?'collection_definition_version_id', v_binding\.collection_definition_version_id[\s\S]*?'target_phase_assignment_id', v_binding\.target_phase_assignment_id/);

// Server collection boundary is opt-in and defense-in-depth.
assert.match(server, /const isAbaV3CollectionApiEnabled = \(\) => normalizeServerFeatureFlag\([\s\S]*?FEATURE_ABA_V3_COLLECTION_API,[\s\S]*?false/);
assert.match(server, /\/api\/aba\/v3\/sessions\/:sessionId\/targets\/:targetId\/resolve-binding[\s\S]*?requireAbaV3CollectionFeature,[\s\S]*?checkAuth,[\s\S]*?requireClinicCapability\('aba\.trial\.record'\),[\s\S]*?checkPatientAccess/);
assert.match(server, /\/api\/aba\/v3\/trials[\s\S]*?requireAbaV3CollectionFeature,[\s\S]*?checkAuth,[\s\S]*?requireClinicCapability\('aba\.trial\.record'\),[\s\S]*?checkPatientAccess/);
assert.match(server, /enforcePayloadLimit\(req, res, 16 \* 1024, 'Resolução de binding ABA V3'\)/);
assert.match(server, /enforcePayloadLimit\(req, res, 64 \* 1024, 'Tentativa ABA V3'\)/);
assert.match(server, /assertAbaSessionCanAcceptClinicalWrite/);
assert.match(server, /supabase\.rpc\('resolve_aba_session_target_measurement_binding_v1'/);
assert.match(server, /supabase\.rpc\('record_aba_trial_action_v3'/);
assert.match(server, /ABA_V3_PR9A_TRIAL_TARGET_TYPES = new Set\(\['dtt', 'net', 'probe'\]\)/);
assert.match(server, /\.select\('id,target_type'\)[\s\S]*?ABA_V3_UI_MEASUREMENT_NOT_READY/);
assert.match(server, /assertAbaV3Pr9bTargetReady\(organizationId, patientId, targetId\)[\s\S]*?resolve_aba_session_target_measurement_binding_v1/);

const trialRouteStart = server.indexOf("'/api/aba/v3/trials'");
const trialRouteEnd = server.indexOf('const handleAbaV3ReadRpcError', trialRouteStart);
assert.ok(trialRouteStart >= 0 && trialRouteEnd > trialRouteStart, 'V3 trial route block must exist');
const trialRoute = server.slice(trialRouteStart, trialRouteEnd);
assert.doesNotMatch(trialRoute, /req\.body\?\.steps|req\.body\.steps/);
assert.doesNotMatch(trialRoute, /resolve_aba_session_target_measurement_binding_v1/);
assert.doesNotMatch(trialRoute, /collection_definition_version_id|target_phase_assignment_id/);
assert.match(trialRoute, /buildAbaV3TrialSteps\(actionKey, promptKey \|\| null\)/);
assert.match(trialRoute, /\.select\('id,key,name,category,intrusiveness_order,active,show_in_session'\)/);
assert.doesNotMatch(trialRoute, /independence_score|response_score/);

// The session completion path is hybrid only behind the collection gate.
assert.match(server, /const useAbaV3Completion = isAbaV3CollectionApiEnabled\(\)/);
assert.match(server, /useAbaV3Completion \? 'complete_aba_session_v3' : 'complete_aba_session_atomic_v1'/);
assert.match(server, /p_legacy_v2_summary: summaryPayload/);

// Browser sends categorical intent, never weighted prompt mathematics.
for (const key of ['INDEPENDENT_CORRECT', 'INDEPENDENT_INCORRECT', 'NO_RESPONSE', 'PROMPTED_CORRECT']) {
  assert.match(collectionUtils, new RegExp(key));
}
assert.match(collectionUtils, /opportunity_role: 'PRIMARY_INDEPENDENT'/);
assert.match(collectionUtils, /opportunity_role: 'SUPPORT'/);
assert.doesNotMatch(collectionUtils, /independence_score|response_score/);
assert.match(dataService, /saveOfflineFirst\(clientEventId, data, 'aba_v3', '\/api\/aba\/v3\/trials', 'POST'\)/);
assert.match(localDb, /'aba_v3'/);

// Binding is cached once per session+target and unresolved state fails closed.
assert.match(sessionMode, /abaV3BindingCacheRef\.current\.get\(cacheKey\)/);
assert.match(sessionMode, /abaV3BindingCacheRef\.current\.set\(cacheKey, binding\)/);
assert.match(sessionMode, /throw new Error\(result\?\.error \|\| 'Não foi possível determinar o modelo de coleta deste target\.'\)/);
assert.match(sessionMode, /binding\?\.measurementModelVersion === 'V3'/);
assert.match(sessionMode, /INDEPENDENT_INCORRECT/);
assert.match(sessionMode, /NO_RESPONSE/);
assert.match(sessionMode, /measurementModelVersion: 'V3'/);
assert.match(sessionMode, /score: null/);

// In V3, Legacy prompt score/independence toggles disappear instead of being reinterpreted.
assert.match(featureFlags, /resolveFeatureFlag\('aba_v3_ui', \{ defaultValue: false/);
assert.match(settings, /Ajuda categórica na ABA V3/);
assert.match(settings, /nenhuma pontuação de prompt entra nos cálculos clínicos/);
assert.match(settings, /\{!v3PromptSemantics && <th[^\n]*Pontuação de independência/);
assert.match(settings, /\{!v3PromptSemantics && <th[^\n]*Conta como resposta independente/);
assert.match(settings, /disabled=\{v3PromptSemantics && legacyV2StillEnabled\}/);
assert.match(sessionMode, /\.filter\(\(prompt\) => abaV3UiEnabled \|\| !prompt\.countsAsIndependent\)/);

// Pure Legacy summaries preserve weighted behavior, while any V3 trial avoids mixing 0-100 scores.
assert.match(summary, /const isV3Trial =/);
assert.match(summary, /const hasV3Trial = trials\.some\(isV3Trial\)/);
assert.match(summary, /\['INDEPENDENT_CORRECT', 'INDEPENDENT_INCORRECT', 'NO_RESPONSE'\]\.includes\(actionKey\)/);
assert.match(summary, /const snapshotScores = trials\.map\(trialPromptScoreSnapshot\)/);

// All rollout flags remain dark in the shipped environment example.
assert.match(envExample, /^FEATURE_ABA_V3_READ_API=false$/m);
assert.match(envExample, /^FEATURE_ABA_V3_COLLECTION_API=false$/m);
assert.match(envExample, /^VITE_FEATURE_ABA_V3_UI=false$/m);
assert.match(architecture, /PR9A — UI categórica de tentativas e ponte transacional de escrita/i);
assert.match(architecture, /PR9B — comportamento, intervalos e Task Analysis/i);
assert.match(architecture, /behavior.*task_analysis[\s\S]*?antes.*binding V3/i);
assert.match(adr, /somente.*`dtt`, `net` e `probe`/i);
assert.match(adr, /Não existe fallback silencioso dessas famílias para V2/i);
assert.match(adr, /Não existe fallback silencioso de V3 para V2/i);
assert.match(adr, /replay após o fechamento da sessão/i);

console.log('ABA Measurement V3 PR9A trial collection/UI contracts: OK');
