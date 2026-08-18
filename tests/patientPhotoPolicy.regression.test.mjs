import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const settings = fs.readFileSync('src/components/ClinicGlobalSettingsPanel.tsx', 'utf8');
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const patientAuthorization = fs.readFileSync('src/utils/patientAuthorization.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260818152000_patient_photo_policy_v1.sql', 'utf8');

assert.match(migration, /add column if not exists patient_photo_policy text not null default 'PORTAL'/);
assert.match(migration, /patient_photo_policy in \('PORTAL', 'CLINIC'\)/);
assert.match(migration, /add column if not exists portal_profile_picture text/);
assert.match(migration, /portal_profile_picture_path text/);

assert.match(server, /patientPhotoPolicy: 'PORTAL' \| 'CLINIC'/);
assert.match(server, /select\('patient_photo_policy'\)/);
assert.match(server, /portal_profile_picture: profilePicture \|\| undefined/);
assert.match(server, /profile_picture: patientPhotoPolicy === 'PORTAL' \? profilePicture \|\| undefined : undefined/);
assert.match(server, /patient_photo_policy: clinicPatientPhotoPolicy/);
assert.match(server, /req\.session\.user\?\.clinicSettings\?\.patientPhotoPolicy/, 'saving another clinic/profile field must not silently reset the existing photo policy');
assert.match(server, /portalProfilePicturePath/);

assert.match(patientAuthorization, /'portal_profile_picture'/);
assert.match(patientAuthorization, /'portal_profile_picture_path'/);

assert.match(coordinator, /clinicPatientPhotoPolicy/);
assert.match(coordinator, /patientPhotoPolicy: clinicPatientPhotoPolicy/);
assert.match(settings, /Usar foto do portal/);
assert.match(settings, /Foto gerenciada pela clínica/);
assert.match(detail, /dataService\.uploadFile\('patient-photos'/);
assert.match(detail, /\['director', 'coordinator', 'receptionist'\]\.includes\(normalizedPatientPhotoRole\)/);
assert.match(detail, /file\.size > 2 \* 1024 \* 1024/);

console.log('patientPhotoPolicy.regression.test.mjs: ok');
