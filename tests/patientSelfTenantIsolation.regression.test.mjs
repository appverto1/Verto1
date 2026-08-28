import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

const block = (start, end) => {
  const from = server.indexOf(start);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  const to = server.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end marker: ${end}`);
  return server.slice(from, to);
};

const scopeHelper = block(
  'async function resolvePatientSelfTenantScope',
  'function normalizeAnamnesisAnswers',
);
assert.match(scopeHelper, /currentClinicId\(user\)/, 'self scope must start from the current clinic');
assert.match(scopeHelper, /patientPortalPatientId/, 'self scope must prefer the canonical portal patient id');
assert.match(scopeHelper, /activeAccessContext\?\.kind === 'patient_portal'/, 'self scope must reuse authorized portal access context');
assert.match(scopeHelper, /\.eq\('clinic_id', clinicId\)/, 'same-email compatibility lookup must stay inside the current clinic');
assert.match(scopeHelper, /candidates\.length !== 1/, 'ambiguous same-clinic email matches must fail closed');
assert.doesNotMatch(scopeHelper, /getPatientIdsByEmailAcrossClinics/, 'self scope must never broaden to clinics by email');

const profile = block("app.patch('/api/patient/self/profile'", "app.get('/api/appointments/:appointmentId/confirmation'");
const history = block("app.get('/api/patient/self/history'", "app.get('/api/patient/self/protocols'");
const protocols = block("app.get('/api/patient/self/protocols'", "app.post('/api/history'");
const tasks = block("app.get('/api/patient/self/tasks'", "app.post('/api/tasks'");
const assigned = block("app.get('/api/patient/self/assigned-tasks'", "app.post('/api/assigned-tasks'");

for (const [name, route] of Object.entries({ profile, history, protocols, tasks, assigned })) {
  assert.match(route, /resolvePatientSelfTenantScope\(req\.session\.user\)/, `${name} must resolve canonical patient+clinic scope`);
  assert.match(route, /PATIENT_PORTAL_SCOPE_INVALID/, `${name} must fail closed when canonical scope is unavailable`);
  assert.doesNotMatch(route, /getPatientIdsByEmailAcrossClinics/, `${name} must not rediscover patients across clinics`);
  assert.doesNotMatch(route, /\.ilike\('patient_email'/, `${name} must not authorize by task email`);
  assert.doesNotMatch(route, /\.eq\('email',\s*(patientEmail|email)\)/, `${name} must not query patient data by email outside the canonical scope`);
}

assert.match(profile, /\{ column: 'id', value: tenantScope\.patientId \}/, 'profile writes must target the canonical patient id');
assert.doesNotMatch(profile, /\{ column: 'email'/, 'profile writes must never fall back to email mutation');

assert.match(history, /patientIds: \[patientId\]/, 'history must load only the canonical patient id');
assert.match(history, /\.eq\('clinic_id', clinicId\)[\s\S]*\.eq\('patient_id', patientId\)/, 'assigned-task history must bind clinic and patient');
assert.match(history, /sanitizeString\(row\?\.patient_id, 120\) !== patientId/, 'history response must drop rows outside the canonical patient id');

assert.match(protocols, /\.eq\('clinic_id', clinicId\)/, 'protocols must read one clinic_state only');
assert.doesNotMatch(protocols, /\.in\('clinic_id', clinicIds\)/, 'protocols must not scan clinic states from multiple clinics');
assert.doesNotMatch(protocols, /orderedStates/, 'protocols must not choose a different clinic by newest state');

assert.match(tasks, /patientIds: \[tenantScope\.patientId\]/, 'legacy tasks must be restricted to the canonical patient id');
assert.match(assigned, /\.eq\('clinic_id', tenantScope\.clinicId\)[\s\S]*\.eq\('patient_id', tenantScope\.patientId\)/, 'assigned tasks must bind clinic and patient');
assert.match(assigned, /patientIds,/, 'legacy assigned-task compatibility must use canonical patient ids only');

console.log('patientSelfTenantIsolation.regression: PASS');
