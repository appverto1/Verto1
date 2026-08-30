import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const identityHelper = section(
  server,
  'async function ensurePatientActivationAuthIdentityFromPatient',
  'function compactClinicSettingsForSession',
);
const resendRoute = section(
  server,
  "'/api/patients/:id/resend-activation'",
  "'/api/patients/:id/resend-recovery'",
);
const patientsRoute = section(
  server,
  "app.get('/api/patients'",
  "app.post('/api/patients'",
);
const visiblePatients = section(
  dashboard,
  'const visiblePatients = useMemo(() => {',
  'const visiblePatientsWithoutQuickFilter = useMemo(() => {',
);

assert.match(identityHelper, /findRecoverableAuthUserByEmail\(email\)/);
assert.match(identityHelper, /supabase\.auth\.admin\.createUser\(/);
assert.match(identityHelper, /patient_activation_required:\s*true/);
assert.match(identityHelper, /insertUserProfileWithSchemaFallback\(/);
assert.match(identityHelper, /repaired_from_patient_record:\s*true/);
assert.match(identityHelper, /invalidateAuthUserEmailCache\(email\)/);

assert.match(resendRoute, /ensurePatientActivationAuthIdentityFromPatient\(patient\)/);
assert.doesNotMatch(resendRoute, /code:\s*'PATIENT_AUTH_IDENTITY_MISSING'/);
assert.match(resendRoute, /identityRepaired:\s*authIdentity\.created/);
assert.match(resendRoute, /createPatientActivationLink\(refreshedAuthUserResult\?\.user \|\| authUser\)/);

assert.match(patientsRoute, /patientsAlphabetical/);
assert.match(patientsRoute, /localeCompare\([\s\S]*?'pt-BR'/);
assert.match(visiblePatients, /sortAlphabetically/);
assert.match(visiblePatients, /localeCompare\([\s\S]*?'pt-BR'/);
assert.match(visiblePatients, /return sortAlphabetically\(filteredPatients\)/);

console.log('patientAuthIdentityRepairAlphabetical.regression.test.mjs: ok');
