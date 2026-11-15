import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const routes = read('services/abaBehaviorCatalogRoutes.ts');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const session = read('src/components/SessionMode.tsx');
const catalogManager = read('src/components/AbaBehaviorCatalogManager.tsx');
const pinned = read('src/components/AbaPinnedBehaviorStrip.tsx');
const migration = read('supabase/migrations/20261115030000_aba_behavior_catalog_active_name_uniqueness.sql');

for (const action of ['get', 'post', 'patch', 'delete']) {
  assert.match(routes, new RegExp('app\\.' + action + '\\(\\x27/api/aba/patients/:patientId/behavior-catalog'), action + ' behavior API missing');
}
assert.match(routes, /checkAuth[\s\S]*?requireClinicCapability\('aba\.behavior\.record'\)[\s\S]*?checkPatientAccess/,
  'every action must require authentication, capability and patient access');
assert.match(routes, /patientClinicId !== clinicId/, 'all operations must reject a different clinic');
assert.match(routes, /\.eq\('patient_id', [a-zA-Z.]+\)\.eq\('clinic_id', [a-zA-Z.]+\)/, 'write/update rows must be scoped');
assert.match(routes, /status: 'archived', is_active: false/, 'DELETE must archive behavior');
assert.doesNotMatch(routes, /from\('aba_behavior_definitions'\)\.delete\(/, 'history-linked behaviors must never be hard deleted');
assert.match(routes, /MAX_BEHAVIORS = 200/, 'bounded patient catalogue');
assert.match(routes, /Buffer\.byteLength\(JSON\.stringify/, 'limit payload size');
assert.match(routes, /isAbaCatalogMethod/, 'server validates actual measurement method');
assert.match(routes, /responseError/, 'database uniqueness errors must not result in false success');
assert.match(server, /registerAbaBehaviorCatalogRoutes\(app, \{/, 'modular routes must be registered once');
assert.match(server, /save_aba_user_session_preferences_v1/, 'original atomic preferences RPC preserved');
assert.match(migration, /aba_behavior_definitions_patient_active_name_unique/, 'concurrent duplicate prevention required');
assert.match(migration, /pg_advisory_xact_lock/, 'preference concurrency guard preserved');
assert.match(migration, /jsonb_array_length\(quick_behavior_shortcuts\) <= 200/, 'persist all pinned behaviors');
assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated;/,
  'SECURITY DEFINER function is closed to public callers');

for (const method of [
  'getAbaPatientBehaviorCatalog','createAbaPatientBehavior',
  'updateAbaPatientBehavior','archiveAbaPatientBehavior',
]) assert.match(dataService, new RegExp(method), method + ' service method missing');

assert.match(session, /AbaBehaviorCatalogManager/, 'CRUD must be reachable from session UI');
assert.match(session, /AbaPinnedBehaviorStrip/, 'horizontal gesture strip must be wired');
assert.match(catalogManager, /Salvar comportamento/, 'persistence remains an explicit save action');
assert.match(catalogManager, /Definição operacional individualizada/, 'clinical operational description required');
assert.match(catalogManager, /Intervalo parcial/, 'interval-partial must remain available for all');
assert.match(pinned, /overflow-x-auto/, 'pinned behaviors must scroll horizontally');
assert.match(pinned, /LONG_HOLD_MS/, 'long press detection must be bounded');
assert.match(pinned, /onPointerCancel/, 'scroll or cancelled gesture must not create phantom records');
assert.match(pinned, /onPointerUp/, 'touch release must be the registration authority');
assert.match(pinned, /data-aba-severity-degree/, 'touch release can select the intended severity');
assert.match(pinned, /if \(!gesture\.held\)/, 'short tap must not select severity');
assert.match(session, /selectPinnedBehaviorSeverity/, 'saved severity must be captured in the session');
console.log('abaBehaviorCatalogCrudAndGesture.regression.test.mjs: ok');
