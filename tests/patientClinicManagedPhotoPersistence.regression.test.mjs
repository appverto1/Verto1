import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const app = read('src/App.tsx');
const patientDetail = read('src/components/PatientDetailView.tsx');
const server = read('server.ts');

const photoHandlerStart = patientDetail.indexOf('const handleClinicalPatientPhotoChange');
const photoHandlerEnd = patientDetail.indexOf('const canReopenAutomaticNoShow', photoHandlerStart);
assert.ok(photoHandlerStart >= 0 && photoHandlerEnd > photoHandlerStart, 'clinic photo handler must exist');
const photoHandler = patientDetail.slice(photoHandlerStart, photoHandlerEnd);
const mutationStart = photoHandler.indexOf('const updatedPatient = {');
const mutationEnd = photoHandler.indexOf('};', mutationStart);
assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, 'clinic photo mutation must exist');
const photoMutation = photoHandler.slice(mutationStart, mutationEnd + 2);

// Caller: clinic-managed photo is an intentionally minimal mutation.
assert.doesNotMatch(photoMutation, /\.\.\.patient/);
assert.match(photoMutation, /id:\s*patient\.id/);
for (const key of ['profilePicture', 'profile_picture', 'profilePicturePath', 'profile_picture_path']) {
  assert.ok(photoMutation.includes(key), `clinic photo mutation must include ${key}`);
}
for (const forbidden of ['insurance', 'convenio', 'financialPlans', 'billing', 'diagnosis', 'guardian', 'address']) {
  assert.ok(!photoMutation.toLowerCase().includes(forbidden.toLowerCase()), `clinic photo mutation must not include ${forbidden}`);
}
assert.match(photoHandler, /\/profile\/clinic-profile\.\$\{extension\}/);
assert.doesNotMatch(photoHandler, /clinic-profile-\$\{Date\.now\(\)\}/);

// Policy: CLINIC keeps the existing role matrix; PORTAL remains a distinct source.
assert.match(patientDetail, /patientPhotoPolicy === 'CLINIC'[\s\S]{0,160}\['director', 'coordinator', 'receptionist'\]/);
assert.match(patientDetail, /patientPhotoPolicy === 'PORTAL'[\s\S]{0,180}portalPatientPhotoSource/);
assert.match(patientDetail, /portal_profile_picture/);
assert.match(patientDetail, /profile_picture/);

const updateStart = app.indexOf('const handleUpdatePatient = async');
const updateEnd = app.indexOf('const handleScheduleSession', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'handleUpdatePatient must exist');
const updateHandler = app.slice(updateStart, updateEnd);

// App boundary: photo aliases are explicit, presence-sensitive, and isolated from insurance detection.
assert.match(updateHandler, /const patientPhotoPatchKeys = \[[\s\S]{0,220}'profilePicture'[\s\S]{0,220}'profile_picture'[\s\S]{0,220}'profilePicturePath'[\s\S]{0,220}'profile_picture_path'/);
assert.match(updateHandler, /const isPatientPhotoOnlyPatch =[\s\S]{0,260}key === 'id'[\s\S]{0,180}patientPhotoPatchKeys\.includes/);
assert.match(updateHandler, /const syncedAnamnesisData =\s*isPatientPhotoOnlyPatch\s*\? undefined/);
assert.match(updateHandler, /const patientUpdatePayload = isPatientPhotoOnlyPatch\s*\? patientPhotoPatch\s*:\s*\{/);
for (const key of ['profilePicture', 'profile_picture', 'profilePicturePath', 'profile_picture_path']) {
  assert.ok(
    updateHandler.includes(`Object.prototype.hasOwnProperty.call(updatedData || {}, '${key}')`),
    `${key} must preserve ABSENT vs explicit null/empty semantics`,
  );
}
assert.match(updateHandler, /\.\.\.patientPhotoPatch/);

const insuranceDetectorStart = updateHandler.indexOf('const hasInsuranceEligibilityPatch = [');
const insuranceDetectorEnd = updateHandler.indexOf('].some((key)', insuranceDetectorStart);
assert.ok(insuranceDetectorStart >= 0 && insuranceDetectorEnd > insuranceDetectorStart, 'insurance presence detector must exist');
const insuranceDetector = updateHandler.slice(insuranceDetectorStart, insuranceDetectorEnd);
for (const key of ['profilePicture', 'profile_picture', 'profilePicturePath', 'profile_picture_path']) {
  assert.ok(!insuranceDetector.includes(`'${key}'`), `${key} must not activate hasInsuranceEligibilityPatch`);
}

// Backend protections and canonical persistence remain unchanged.
assert.match(server, /app\.patch\('\/api\/patients\/:id',[\s\S]{0,220}requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /patient\.insurance\.edit/);
assert.match(server, /PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED/);
assert.match(server, /profile_picture:\s*safeProfilePicture !== undefined/);
assert.match(server, /profile_picture_path:\s*safeProfilePicturePath !== undefined/);

console.log('patientClinicManagedPhotoPersistence.regression.test.mjs: PASS');
