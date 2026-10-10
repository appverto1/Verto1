import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync('services/abaReinforcerCatalogRoutes.ts','utf8');
const registered = fs.readFileSync('services/clinicalMeasurementV3Routes.ts','utf8');
const frontend = fs.readFileSync('src/services/abaReinforcers.ts','utf8');
const client = fs.readFileSync('src/services/dataService.ts','utf8');
const panel = fs.readFileSync('src/components/AbaReinforcerCatalogPanel.tsx','utf8');
const sessionPanel = fs.readFileSync('src/components/AbaReinforcerSessionPanel.tsx','utf8');

assert.match(registered,/registerAbaReinforcerCatalogRoutes\(app, deps\)/);
for(const url of ['/reinforcers','/reinforcer-sessions/:sessionId','/reinforcer-sessions/:sessionId/deliveries']){
  assert.ok(routes.includes(url));
}
assert.match(routes,/checkAuth, requireClinicCapability\('clinical\.record\.view'\), checkPatientAccess/);
assert.match(routes,/checkAuth, requireClinicCapability\('session\.data\.write'\), checkPatientAccess/);
assert.match(routes,/currentClinicId\(req\.session\?\.user/);
assert.match(routes,/actorId = sanitizeString\(req\.session\?\.user\?\.id/);
assert.match(routes,/patientClinicId === clinicId/);
for(const procedure of ['list_aba_patient_reinforcers_v1','save_aba_patient_reinforcer_v1','list_recent_aba_patient_reinforcers_v1','list_aba_session_reinforcer_events_v1','get_aba_session_reinforcer_summary_v1','record_aba_reinforcer_delivery_v1']){
  assert.ok(routes.includes("supabase.rpc('"+procedure+"'"));
}
assert.match(frontend,/dataService\.getAbaPatientReinforcers\(patientId, includeInactive\)/);
assert.match(frontend,/dataService\.saveAbaPatientReinforcer\(input\.patientId/);
assert.match(frontend,/dataService\.recordAbaReinforcerDelivery\(/);
assert.doesNotMatch(frontend,/\.rpc\('list_aba_patient_reinforcers_authenticated_v1'/);
assert.doesNotMatch(frontend,/\.rpc\('save_aba_patient_reinforcer_authenticated_v1'/);
assert.doesNotMatch(frontend,/\.rpc\('record_aba_reinforcer_delivery_authenticated_v1'/);
assert.match(frontend,/clientEventId = generateId\(\)/);
assert.match(frontend,/markRecordSyncStatus\(row\.id, 'synced'\)/);
assert.match(client,/credentials: 'include'/);
assert.match(client,/async getAbaReinforcerSessionBundle\(/);
assert.match(client,/async recordAbaReinforcerDelivery\(/);
assert.equal((client.match(/async recordAbaReinforcerDelivery\(/g)||[]).length,1);
assert.match(panel,/if \(accessDenied\) return null/);
assert.match(sessionPanel,/getAbaReinforcerSessionBundle\(patientId,sessionId\)/);
console.log('abaReinforcerCookieAuthentication.regression.test.mjs: PASS');
