import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const overlay = read('src/components/Tutorial.tsx');
const help = read('src/components/HelpCenter.tsx');
const session = read('src/components/SessionMode.tsx');
const dataService = read('src/services/dataService.ts');
const taskUi = read('src/components/PatientDashboard.tsx');
const taskSql = read('supabase/migrations/20261007193000_assigned_task_completion_idempotency_p0.sql');
const legacy = read('src/components/LegacyAssessmentChartsPanel.tsx');
const charts = read('src/components/ClinicalChartsWorkspace.tsx');
const server = read('server.ts');

// Tutorial: no negative positioning on narrow/zoomed viewports.
assert.match(overlay, /window\.visualViewport\?\.width/);
assert.match(overlay, /window\.visualViewport\?\.height/);
assert.match(overlay, /Math\.max\(edge, Math\.min\(suggestedLeft, viewportWidth - cardWidth - edge\)\)/);
assert.match(overlay, /maxWidth: 'calc\(100vw - 24px\)'/);
assert.match(overlay, /maxHeight: 'calc\(100dvh - 24px\)'/);
assert.match(overlay, /overflowY: 'auto'/);
// Help: a server-authorized article belongs to exactly one collapsible theme.
assert.match(help, /const groupedTopics=useMemo/);
assert.match(help, /groups\.get\(theme\)!\.push\(topic\)/);
assert.match(help, /aria-expanded=\{expanded\}/);
assert.match(help, /aria-controls=\{groupId\}/);
assert.match(help, /hidden=\{!expanded\}/);
assert.match(help, /aria-current=\{article\?\.articleId===t\.articleId/);
assert.match(help, /setExpandedTheme\(chosen\.theme\)/);
assert.match(help, /max-h-\[calc\(100dvh-7rem\)\]/);
assert.match(help, /\.filter\(x=>x\.score>0\)/);
assert.match(help, /fetch\('\/api\/help\/catalog'/);

// P0 8: NO_OPPORTUNITY is an exposure state, never trial/score.
const exposureStart=server.indexOf("'/api/aba/v3/target-exposures'");
const exposureEnd=server.indexOf("'/api/aba/v3/trials'",exposureStart);
assert.ok(exposureStart>0 && exposureEnd>exposureStart, 'ABA V3 exposure route must be registered');
const route=server.slice(exposureStart,exposureEnd);
assert.match(route, /requireAbaV3CollectionFeature/);
assert.match(route, /requireClinicCapability\('aba\.trial\.record'\)/);
assert.match(route, /checkPatientAccess/);
assert.match(route, /resolveAbaSessionReadScope/);
assert.match(route, /assertAbaSessionCanAcceptClinicalWrite/);
assert.match(route, /assertAbaV3Pr9bTargetReady/);
assert.match(route, /status !== 'NO_OPPORTUNITY'/);
assert.match(route, /supabase\.rpc\('set_aba_session_target_exposure_v3'/);
assert.doesNotMatch(route, /record_aba_trial_action_v3|insert.*aba_trials_v3/);
assert.match(dataService, /async saveAbaV3TargetExposure\(input: any\)/);
assert.match(dataService, /saveOfflineFirst\([\s\S]*?'\/api\/aba\/v3\/target-exposures', 'POST'/);
assert.match(session, /abaV3ExposureSavingRef\.current/);
assert.match(session, /void saveAbaV3NoOpportunity\(\)/);
assert.match(session, /Registro aguardando sincronização/);
assert.match(session, /Estado clínico persistido sem criar ou contabilizar uma tentativa/);

// P0 26: React state + synchronous ref lock suppress double taps before render.
assert.match(taskUi, /taskSubmitInFlightRef = useRef\(false\)/);
assert.match(taskUi, /isTaskSaving \|\| taskSubmitInFlightRef\.current/);
assert.match(taskUi, /taskSubmitInFlightRef\.current = true;/);
assert.match(taskUi, /taskSubmitInFlightRef\.current = false;/);
assert.match(taskUi, /disabled=\{isTaskSaving \|\| showTaskSuccess/);

// P0 27: authoritative atomic task completion stays guarded by row lock.
assert.match(taskSql, /for update/i);
assert.match(taskSql, /lower\(coalesce\(v_task\.status, 'pending'\)\) in \('completed', 'done'\)/);
assert.match(taskSql, /assigned_task_id = v_task\.id/);
assert.match(taskSql, /'idempotent', true/);

// P0 28: ABA Legacy only assessment application sources.
assert.match(charts, /LegacyAssessmentChartsPanel/);
assert.match(charts, /legacyAssessmentProtocols/);
assert.match(legacy, /Dados de intervenção do plano individual não entram no ABA Legacy/);
console.log('PASS P0 8, tutorial, tasks 26-28 integrity contracts');
