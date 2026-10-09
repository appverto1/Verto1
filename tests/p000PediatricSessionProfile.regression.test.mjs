import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (path) => readFileSync(path, 'utf8');
const profileSource = read('src/utils/patientProfileType.ts');
const js = ts.transpileModule(profileSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const profile = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

assert.equal(profile.isPediatricPatientGroup('infantil'), true);
assert.equal(profile.isPediatricPatientGroup('Adolescente'), true);
assert.equal(profile.isPediatricPatientGroup('adulto'), false);
assert.equal(profile.isPediatricPatientGroup('idoso'), false);
assert.equal(profile.profileTypeForPatientGroup('infantil', 'ADULT'), 'KIDS');
assert.equal(profile.profileTypeForPatientGroup('adolescente', 'ABA'), 'KIDS');
assert.equal(profile.profileTypeForPatientGroup('adulto', 'ABA'), 'ABA');
assert.equal(profile.profileTypeForPatientGroup('idoso', 'ADULT'), 'ADULT');

// Reproduction: the saved demographic category says pediatric but the stale
// legacy portal field says adult. Neither should open adult collection.
assert.equal(profile.resolvePatientPortalKind({
  patient_group: 'infantil',
  patient_profile_type: 'ADULT',
  type: 'adult_conventional',
  age: 7,
}), 'KIDS');
assert.equal(profile.resolvePatientPortalKind({
  patient_group: 'adolescente',
  patientProfileType: 'ADULT',
  type: 'adult_conventional',
  age: 15,
}), 'KIDS');
assert.equal(profile.resolvePatientPortalKind({
  group: 'infantil',
  patientProfileType: 'ABA',
  age: 9,
}), 'KIDS');
assert.equal(profile.resolvePatientPortalKind({
  group: 'adulto',
  patient_profile_type: 'ABA',
  type: 'adult_tea',
}), 'ADULT_ABA');
assert.equal(profile.resolvePatientPortalKind({
  group: 'adulto',
  patient_profile_type: 'ADULT',
}), 'ADULT_CONVENTIONAL');

const coordinator = read('src/components/CoordinatorDashboard.tsx');
const app = read('src/App.tsx');
const service = read('src/services/dataService.ts');
const detail = read('src/components/PatientDetailView.tsx');

assert.match(coordinator, /if \(field === "grupo"\) \{[\s\S]*?patientProfileType: isPediatricPatientGroup\(value\)/);
assert.match(coordinator, /if \(field === "patientProfileType"\) \{[\s\S]*?grupo: selectedProfile === "KIDS"/);
assert.match(coordinator, /grupo: patient\.group \|\| patient\.patient_group \|\| patient\.grupo/);
assert.match(coordinator, /const canonicalProfileType = profileTypeForPatientGroup\(newPatientForm\.grupo, newPatientForm\.patientProfileType\)/);
assert.match(coordinator, /patientProfileType: resolvePatientPortalKind\(patient\) === "KIDS"/);

assert.match(app, /source\?\.grupo, source\?\.group, source\?\.patient_group/);
assert.match(app, /const updatedProfileType = profileTypeForPatientGroup\(/);
assert.match(app, /patientProfileType: updatedProfileType, panelType: updatedProfileType, type: updatedPortalType/);
assert.match(service, /const mustConfirmClinicalProfile = \[/);
assert.match(service, /requireServerAck: mustConfirmClinicalProfile/);
assert.match(detail, /const isKidsProfile = patientPortalKind === 'KIDS'/);
assert.match(detail, /const hasConventionalSessionSurface = !hasAbaClinicalProfile/);
assert.match(detail, /\{hasAbaSessionSurface && isSessionModeOpen && \([\s\S]*?<SessionMode/);
assert.match(detail, /sessionSpecialtyPlanCandidates\(scopes, scheduledSessionForPatient\)/);

console.log('p000PediatricSessionProfile.regression.test.mjs: ok');
