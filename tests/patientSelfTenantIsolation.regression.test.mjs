import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = readPatientPlanServerSource();

const block = (start, end) => {
  const from = server.indexOf(start);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  const to = server.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end marker: ${end}`);
  return server.slice(from, to);
};

const scopeHelper = block(
  'async function resolveCanonicalPatientPortalScope',
  'function currentClinicTimeZone',
);
assert.match(scopeHelper, /currentClinicId\(user\)/, 'portal scope must start from the current clinic');
assert.match(scopeHelper, /patientPortalPatientId/, 'portal scope must prefer the canonical portal patient id');
assert.match(scopeHelper, /contextKind === 'patient_portal'/, 'portal scope must reuse the authorized access context');
assert.match(scopeHelper, /\.eq\('clinic_id', clinicId\)/, 'scope validation must bind the current clinic');
assert.match(scopeHelper, /candidateIds\.size !== 1/, 'ambiguous compatibility resolution must fail closed');
assert.match(scopeHelper, /getPatientIdsByEmailAcrossClinics\(userEmail, userId, clinicId\)/, 'legacy compatibility may use the legacy resolver only with the selected clinic');

const legacyResolver = block(
  'async function getPatientIdsByEmailAcrossClinics',
  'async function resolvePatientIdForRequest',
);
assert.match(legacyResolver, /if \(!isUuid\(safeClinicId\)/, 'legacy resolver must reject calls without a concrete clinic');
assert.match(legacyResolver, /query = query\.eq\('clinic_id', safeClinicId\)/, 'legacy resolver must never fan out across clinics');

const profile = block("app.patch('/api/patient/self/profile'", "app.get('/api/appointments/:appointmentId/confirmation'");
const history = block("app.get('/api/patient/self/history'", "app.get('/api/patient/self/protocols'");
const protocols = block("app.get('/api/patient/self/protocols'", "app.post('/api/history'");
const tasks = block("app.get('/api/patient/self/tasks'", "app.post('/api/tasks'");
const assigned = block("app.get('/api/patient/self/assigned-tasks'", "app.post('/api/assigned-tasks'");

for (const [name, route] of Object.entries({ profile, history, protocols, tasks, assigned })) {
  assert.match(route, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/, `${name} must resolve canonical patient+clinic scope`);
  assert.match(route, /PATIENT_PORTAL_CONTEXT_REQUIRED/, `${name} must fail closed when canonical scope is unavailable`);
  assert.doesNotMatch(route, /getPatientIdsByEmailAcrossClinics/, `${name} must not rediscover patients across clinics`);
  assert.doesNotMatch(route, /\.ilike\('patient_email'/, `${name} must not authorize by task email`);
}

assert.match(profile, /\.eq\('id', portalScope\.patientId\)[\s\S]*\.eq\('clinic_id', portalScope\.clinicId\)/, 'profile writes must target canonical patient+clinic scope');
assert.doesNotMatch(profile, /\.eq\('email',/, 'profile writes must never fall back to email mutation');

assert.match(history, /patientId: portalScope\.patientId/, 'history must load only the canonical patient id');
assert.match(history, /clinicId: portalScope\.clinicId/, 'assigned-task history must bind the canonical clinic');

assert.match(protocols, /const clinicIds = \[portalScope\.clinicId\]/, 'protocols must derive its clinic list only from the selected clinic');
assert.match(protocols, /\.in\('clinic_id', clinicIds\)/, 'protocol state reads must use the singleton selected-clinic list');
assert.doesNotMatch(protocols, /getPatientIdsByEmailAcrossClinics/, 'protocols must never discover clinic scope from patient email');

assert.match(tasks, /patientId: portalScope\.patientId/, 'legacy tasks must be restricted to the canonical patient id');
assert.match(assigned, /patientId: portalScope\.patientId[\s\S]*clinicId: portalScope\.clinicId/, 'assigned tasks must bind clinic and patient');

console.log('patientSelfTenantIsolation.regression: PASS');
