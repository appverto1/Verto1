import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');

assert.match(server, /set_patient_shared_chart_selection_v2/, 'server must use actor-bound service-role set RPC');
assert.match(server, /clear_patient_shared_chart_selection_v2/, 'server must use actor-bound service-role clear RPC');
assert.doesNotMatch(dataService, /set_patient_shared_chart_selection_v[12]|clear_patient_shared_chart_selection_v[12]/, 'browser must not call mutation RPCs directly');

assert.match(server, /family === 'PLAN_PTS'[\s\S]*seriesKeys/, 'PLAN_PTS descriptor must be normalized server-side');
assert.match(server, /family === 'ABA_V3'[\s\S]*seriesRefs/, 'ABA_V3 descriptor must be normalized server-side');
assert.match(server, /SHARED_CHART_SOURCE_ACCESS_DENIED/, 'source-family capability must be enforced');
assert.match(server, /SHARED_CHART_REFERENCE_NOT_RESOLVABLE/, 'invalid source reference must fail closed');
assert.match(server, /filterTherapeuticPlanScopesForActor/, 'PLAN_PTS must reuse plan access rules');
assert.match(server, /summarizeClinicalOutcomeSeries/, 'PLAN_PTS must reuse existing clinical outcome builder');
assert.match(server, /get_aba_chart_series_bundle_v3/, 'ABA must reuse canonical V3 chart read model');

assert.match(server, /\/api\/portal\/patients\/:patientId\/shared-chart/, 'patient-self endpoint must exist');
assert.match(server, /requireRoles\('patient'\)[\s\S]*requirePatientPortalModule\('clinical_core'\)/, 'portal role/module guards must remain');
assert.match(server, /allowedPatientIds[\s\S]*PORTAL_PATIENT_SCOPE_DENIED/, 'portal patient scope must be session-derived');
assert.match(server, /select\('chart_family,chart_key,reference_version,chart_reference,updated_at'\)/, 'selection query must select only required columns');

const projectionStart = server.indexOf('const projectSharedClinicalSeries');
const projectionEnd = server.indexOf('const loadSharedPlanChartProjection', projectionStart);
const clinicalProjection = projectionStart >= 0 && projectionEnd > projectionStart ? server.slice(projectionStart, projectionEnd) : '';
assert.ok(clinicalProjection, 'clinical portal projection helper must exist');
assert.doesNotMatch(clinicalProjection, /professionalId|metadata|sourceRecordType|sessionId/, 'portal projection must omit professional and technical metadata');

for (const method of ['getPatientSharedChartSelection', 'setPatientSharedChartSelection', 'clearPatientSharedChartSelection', 'getPortalSharedChart']) {
  assert.match(dataService, new RegExp('async ' + method + '\\('), 'dataService missing ' + method);
}
assert.match(dataService, /\/shared-chart-selection/, 'professional client must use server endpoint');
assert.match(dataService, /\/shared-chart/, 'portal client must use patient-self endpoint');

console.log('patientSharedChartIntegration.regression.test.mjs: ok');
