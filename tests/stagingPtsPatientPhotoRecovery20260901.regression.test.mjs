import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const panel = read('src/components/TherapeuticPlanPanel.tsx');
const dashboard = read('src/components/PtsTherapeuticDashboard.tsx');
const editor = read('src/components/PtsWorkspaceEditor.tsx');
const patientDetail = read('src/components/PatientDetailView.tsx');
const patientRegistry = read('src/components/PatientRegistry.tsx');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const receptionist = read('src/components/ReceptionistDashboard.tsx');
const therapist = read('src/components/TherapistDashboard.tsx');
const routeFallbacks = read('src/utils/routeSchemaFallbacks.ts');
const patientAuthorization = read('src/utils/patientAuthorization.ts');
const dataService = read('src/services/dataService.ts');
const server = read('server.ts');
const photoMigration = read('supabase/migrations/20260818152000_patient_photo_policy_v1.sql');

// PTS: API projections must survive load/reset and reach the components that consume them.
assert.match(panel, /ptsSharedEvidence:\s*\[\]/);
assert.match(panel, /ptsLegacyEvidence:\s*\[\]/);
assert.match(panel, /ptsSharedEvidence:\s*Array\.isArray\(data\?\.ptsSharedEvidence\)\s*\?\s*data\.ptsSharedEvidence\s*:\s*\[\]/);
assert.match(panel, /ptsLegacyEvidence:\s*Array\.isArray\(data\?\.ptsLegacyEvidence\)\s*\?\s*data\.ptsLegacyEvidence\s*:\s*\[\]/);
assert.match(panel, /<PtsTherapeuticDashboard[\s\S]*?sharedEvidence=\{ptsSharedEvidence\}[\s\S]*?legacyEvidence=\{ptsLegacyEvidence\}/);
assert.doesNotMatch(panel.match(/<PtsTherapeuticDashboard[\s\S]*?\/>/)?.[0] || '', /programs=\{ptsWorkspacePrograms\}|renderProgramCard=/);
assert.match(panel, /<PtsWorkspaceEditor[\s\S]*?sharedEvidence=\{ptsSharedEvidence\}/);
assert.match(dashboard, /sharedEvidence\?\:\s*any\[\]/);
assert.match(dashboard, /legacyEvidence\?\:\s*any\[\]/);
assert.match(dashboard, /sharedEvidence\s*=\s*\[\]/);
assert.match(dashboard, /legacyEvidence\s*=\s*\[\]/);
assert.match(dashboard, /data-testid="pts-legacy-evidence-section"/);
assert.match(editor, /sharedEvidence\s*=\s*\[\]/);
assert.match(server, /ptsSharedEvidence,/);
assert.match(server, /ptsLegacyEvidence,/);

// Patient photos: both canonical clinic photo and portal photo must be fetched and renderable.
const patientListSelect = routeFallbacks.match(/export const PATIENT_LIST_SELECT_COLUMNS = \[[\s\S]*?\n\];/)?.[0] || '';
const patientOptional = routeFallbacks.match(/const PATIENT_LIST_OPTIONAL_COLUMNS = new Set\(\[[\s\S]*?\n\]\);/)?.[0] || '';
for (const column of ['portal_profile_picture', 'portal_profile_picture_path']) {
  assert.ok(patientListSelect.includes(`'${column}'`), `patient list select must include ${column}`);
  assert.ok(patientOptional.includes(`'${column}'`), `patient schema fallback must treat ${column} as optional`);
  assert.ok(patientAuthorization.includes(`'${column}'`), `patient authorization projection must retain ${column}`);
}
assert.match(patientRegistry, /portalProfilePicture[\s\S]*portal_profile_picture/);
assert.match(coordinator, /portalProfilePicture[\s\S]*portal_profile_picture/);

// Policy must be propagated from persisted clinic settings after any relogin.
assert.match(receptionist, /patientPhotoPolicy:[\s\S]*clinicSettings\?\.patientPhotoPolicy[\s\S]*userRole=\{user\?\.role \|\| 'receptionist'\}/);
assert.match(therapist, /patientPhotoPolicy:[\s\S]*clinicSettings\?\.patientPhotoPolicy[\s\S]*userRole=\{user\?\.role \|\| 'therapist'\}/);
assert.match(coordinator, /patientPhotoPolicy:\s*clinicPatientPhotoPolicy/);
assert.match(coordinator, /userRole=\{user\.role\}/);

// Clinic-managed photo uses the existing deterministic content-hash upload path.
assert.match(patientDetail, /\/profile\/clinic-profile\.\$\{extension\}/);
assert.doesNotMatch(patientDetail, /clinic-profile-\$\{Date\.now\(\)\}/);
assert.match(dataService, /patientProfileMatch = normalizedPath\.match\(\/\^\(\[\^\/\]\+\)\\\/profile/);
assert.match(dataService, /patient-profile:\$\{ownerId\}:\$\{shortHash\}/);

// Reception can upload ONLY a clinic-managed patient profile image through demographics authority;
// generic document upload still requires the original document/file capabilities.
assert.match(server, /patientProfilePhotoUploadGuard = requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /isCanonicalPatientProfilePhotoUploadPath/);
assert.match(server, /return patientProfilePhotoUploadGuard\(req, res, next\)/);
assert.match(server, /patientStorageUploadGuard = requireAnyClinicCapabilityOrPatientPortal\('patient\.files\.upload', 'clinical\.documents\.upload'\)/);
assert.match(server, /\['director', 'coordinator', 'receptionist'\]\.includes\(effectiveClinicRole\)/);
assert.match(server, /select\('patient_photo_policy'\)/);
assert.match(server, /clinicPhotoPolicy !== 'CLINIC'/);
assert.match(server, /validateBinaryUpload\(fileBuffer, mimeFromDataUrl, 'image-only'\)/);
assert.match(server, /app\.patch\('\/api\/patients\/:id',[\s\S]*?requireClinicCapability\('patient\.demographics\.edit'\)/);
assert.match(server, /profile_picture:\s*safeProfilePicture !== undefined/);
assert.match(server, /profile_picture_path:\s*safeProfilePicturePath !== undefined/);

// Persistence is canonical DB state, not browser-only state.
assert.match(photoMigration, /clinics[\s\S]*patient_photo_policy/);
assert.match(photoMigration, /patients[\s\S]*portal_profile_picture/);
assert.match(server, /serializePatientMediaForClient\(patient\)/);
assert.match(server, /portal_profile_picture:\s*portalProfilePicture/);

console.log('stagingPtsPatientPhotoRecovery20260901.regression.test.mjs: OK');
