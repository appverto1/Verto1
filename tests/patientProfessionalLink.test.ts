import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const app = read('src/App.tsx');
const dashboard = read('src/components/PatientDashboard.tsx');
const landing = read('src/components/LandingPage.tsx');
const activation = read('src/components/ActivationAccess.tsx');
const localDb = read('src/services/localDb.ts');

assert.match(landing, /GoogleIcon/);
assert.match(activation, /GoogleIcon/);
assert.match(app, /dataService\.getPatientSelfHistory\(\)/);
assert.doesNotMatch(app.slice(app.indexOf('const fetchPatientScopedData'), app.indexOf('const patientIsReadOnlyMode')), /getHistoryByEmail|getHistory\(identity\.patientId\)/);
assert.match(app, /setPatientContextLoaded\(true\)[\s\S]*getPatientSelfTasks\(\)/);
assert.match(dashboard, /\{ id: 'anamnesis', label: 'Anamnese'/);
assert.doesNotMatch(dashboard, /shouldOfferPortalAnamnesis \? \[\{ id: 'anamnesis'/);
assert.match(dashboard, /portalAnamnesisRequestRef/);
assert.match(app, /family_portal_note/);
assert.match(app, /const refreshPatientHistoryForProfessional/);
assert.match(localDb, /clearSensitiveOfflineCacheForUser/);
assert.match(app, /await clearSensitiveOfflineCacheForUser\(signingOutUserId\)/);

console.log('patient-professional link checks passed');
