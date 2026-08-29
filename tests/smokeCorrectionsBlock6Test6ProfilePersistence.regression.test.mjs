import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const coordinator = fs.readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
const therapist = fs.readFileSync(new URL('../src/components/TherapistDashboard.tsx', import.meta.url), 'utf8');
const receptionist = fs.readFileSync(new URL('../src/components/ReceptionistDashboard.tsx', import.meta.url), 'utf8');

const routeStart = server.indexOf("app.post('/api/profile/:userId'");
const routeEnd = server.indexOf('// Tasks', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'profile POST route must exist');
const profileRoute = server.slice(routeStart, routeEnd);

assert.match(profileRoute, /profileSaveScope/);
assert.match(profileRoute, /requestedProfileSaveScope === 'clinic' \? 'clinic' : 'professional'/);
assert.match(profileRoute, /if \(profileSaveScope === 'clinic'\) \{[\s\S]{0,500}resolveClinicCapabilityContext/);
assert.match(profileRoute, /CLINIC_SETTINGS_EDIT_DENIED/);
assert.match(profileRoute, /profileSaveScope === 'clinic' && canEditClinicSettings && req\.body\?\.clinicSettings/);
assert.match(profileRoute, /councilNumber: resolvedCouncilNumber/);
assert.match(profileRoute, /council_number: resolvedCouncilNumber/);
assert.match(profileRoute, /crp: resolvedCrp \|\| resolvedCouncilNumber/);
assert.match(profileRoute, /professionalProfilePersisted/);
assert.match(profileRoute, /metadataFallbackCandidate/);
assert.match(profileRoute, /throw professionalProfileWriteError/);
assert.match(profileRoute, /PROFILE_SAVE_FAILED/);
assert.match(profileRoute, /profileSaveStage/);
assert.match(profileRoute, /profileSaveScope === 'clinic'[\s\S]{0,180}fetchUserWorkspaces/);

assert.match(coordinator, /profileSaveScope: "professional"/);
assert.match(coordinator, /profileSaveScope: "clinic"/);
assert.match(therapist, /profileSaveScope: "professional"/);
assert.match(receptionist, /profileSaveScope: "professional"/);

assert.match(app, /const profileSaveScope = data\?\.profileSaveScope === 'clinic' \? 'clinic' : 'professional'/);
assert.match(app, /const persistencePayload = profileSaveScope === 'clinic'/);
assert.match(app, /professionalProfile: nextUser\.professionalProfile/);
assert.match(app, /clinicSettings: nextUser\.clinicSettings/);
assert.doesNotMatch(app, /saveUserProfile\(user\.id, \{\s*\.\.\.nextUser/);
assert.doesNotMatch(app, /saveUserProfile\(user\.id, \{\s*\.\.\.baseUser/);

console.log('smokeCorrectionsBlock6Test6ProfilePersistence.regression: PASS');
