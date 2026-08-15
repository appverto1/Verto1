import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260815233000_aba_measurement_v3_pr11_preproduction_pilot_safety.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const featureFlags = readFileSync('src/utils/featureFlags.ts', 'utf8');
const settings = readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const env = readFileSync('.env.example', 'utf8');
const smoke = readFileSync('scripts/aba-v3-pilot-smoke.mjs', 'utf8');
const runbook = readFileSync('docs/operations/ABA_V3_PILOT_RUNBOOK.md', 'utf8');

assert.match(migration, /create or replace function public\.get_aba_v3_session_collection_plan/);
assert.match(migration, /p_target_ids text\[\]/);
assert.match(migration, /cardinality\(p_target_ids\)[\s\S]*200/);
assert.match(migration, /EXISTING_IMMUTABLE_BINDING[\s\S]*ROLLOUT_READY_PREVIEW/);
assert.match(migration, /V3_BLOCKED/);
assert.match(migration, /v3_behavior_ids/);
assert.match(migration, /Existing immutable session decisions win over current configuration/);
assert.match(migration, /measurement_model_version = 'V3'[\s\S]*not exists \([\s\S]*aba_session_behavior_collection_bindings_v3 frozen/);
assert.match(migration, /rollout_state_at as \([\s\S]*select distinct on/);
assert.doesNotMatch(migration, /resolve_aba_measurement_rollout_snapshot_v3/);
assert.match(migration, /when target\.rollout_allow = false then 'LEGACY_V2'/);
assert.match(migration, /when target\.rollout_accept = false then 'V3_BLOCKED'/);
assert.match(migration, /phase_row\.program_id = target\.program_id/);
assert.match(migration, /create or replace function public\.get_aba_v3_rollout_drain_status/);
assert.match(migration, /OPEN_V3_SESSIONS[\s\S]*OPEN_INTERVAL_RUNS[\s\S]*OPEN_BEHAVIOR_OBSERVATION_SLICES[\s\S]*OPEN_DURATION_EVENTS[\s\S]*UNRESOLVED_SYNC_QUARANTINE/);
assert.match(migration, /p_allow_new_v3_sessions and not p_accept_v3_sync[\s\S]*ABA_V3_ROLLOUT_SYNC_REQUIRED/);
assert.match(migration, /if p_allow_new_v3_sessions then[\s\S]*get_aba_v3_pilot_readiness/);
assert.doesNotMatch(migration, /if p_allow_new_v3_sessions or p_accept_v3_sync then/);
assert.match(migration, /not p_accept_v3_sync[\s\S]*get_aba_v3_rollout_drain_status[\s\S]*ABA_V3_ROLLOUT_DRAIN_REQUIRED/);
assert.match(migration, /no_v3_rollout_enabled/);

assert.match(server, /FEATURE_ABA_V3_PREFLIGHT_API/);
assert.match(server, /\/api\/aba\/v3\/sessions\/:sessionId\/collection-plan[\s\S]*requireAbaV3ReadFeature/);
assert.match(server, /get_aba_v3_session_collection_plan/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/pilot-readiness[\s\S]*requireAbaV3PreflightFeature[\s\S]*checkPlatformAdmin/);
assert.match(server, /\/api\/aba\/v3\/admin\/drain-status[\s\S]*requireAbaV3PreflightFeature[\s\S]*checkPlatformAdmin/);
assert.match(server, /\/api\/aba\/v3\/admin\/rollout-state[\s\S]*requireAbaV3RolloutAdminFeature[\s\S]*checkPlatformAdmin/);
assert.match(server, /allowRaw && !syncRaw[\s\S]*ABA_V3_ROLLOUT_SYNC_REQUIRED/);
assert.match(server, /if \(allowRaw && \(!isAbaV3ReadApiEnabled\(\)/);
assert.doesNotMatch(server, /if \(\(allowRaw \|\| syncRaw\) && \(!isAbaV3ReadApiEnabled\(\)/);

assert.match(dataService, /getAbaV3SessionCollectionPlan/);
assert.match(dataService, /target_ids: targetIds/);
assert.match(sessionMode, /abaV3SessionPlanStatus/);
assert.match(sessionMode, /getAbaV3SessionCollectionPlan/);
assert.match(sessionMode, /abaV3SessionPlanStatus === 'ready' && plannedModel === 'V3_BLOCKED'/);
assert.match(sessionMode, /mustResolveBinding = abaV3SessionPlanStatus !== 'ready' \|\| plannedModel === 'V3'/);
assert.match(sessionMode, /legacyPromptedPromptOptions[\s\S]*!prompt\.countsAsIndependent/);
assert.match(sessionMode, /promptedPromptOptionsForGoal[\s\S]*isGoalPlannedForV3Ui/);
assert.match(sessionMode, /abaV3BehaviorIdSet\.has/);
assert.match(sessionMode, /abaV3SessionPlanStatus === 'ready' && !abaV3BehaviorIdSet\.has\(behaviorId\)\) return null/);
assert.doesNotMatch(sessionMode, /\.filter\(\(prompt\) => abaV3UiEnabled \|\| !prompt\.countsAsIndependent\)/);

assert.match(featureFlags, /isAbaV3UiEnabled[\s\S]*storage: null/);
assert.match(featureFlags, /hasOwnProperty\.call\(options, 'storage'\)/);
assert.match(settings, /const v3PromptSemantics = isAbaV3UiEnabled\(\) && !legacyV2StillEnabled/);
assert.match(env, /^FEATURE_ABA_V3_PREFLIGHT_API=false$/m);
assert.match(smoke, /drain-status/);
assert.match(smoke, /session-collection-plan/);
assert.doesNotMatch(smoke, /admin\/rollout-state/);
assert.match(runbook, /allow_new_v3_sessions=false[\s\S]*accept_v3_sync=true[\s\S]*drain-status[\s\S]*accept_v3_sync=false/i);
assert.match(runbook, /drain-status[\s\S]*novamente[\s\S]*reabilitar \*\*somente\*\* `accept_v3_sync=true`/i);

console.log('ABA Measurement V3 PR11 pre-production safety contracts: OK');
