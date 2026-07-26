import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  careSettingToLocationType,
  checkLocalScheduleConflicts,
  normalizeCareSetting,
} from '../src/utils/scheduling';
import {
  buildPatientReminderModalViewModel,
  buildPatientReminderNotificationPayload,
  resolveBrandingContext,
} from '../src/services/notificationBranding';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260726230000_clinical_location_and_reschedule_policy.sql');
const databaseTest = read('supabase/tests/20260726230000_clinical_location_and_reschedule_policy_test.sql');
const server = read('server.ts');
const schoolRoutes = read('services/schoolManagementRoutes.ts');
const policyRoutes = read('services/clinicAppointmentPolicyRoutes.ts');
const schoolDialog = read('src/components/SchoolEnrollmentDialog.tsx');
const clinicSettings = read('src/components/ClinicGlobalSettingsPanel.tsx');
const patientSchool = read('src/components/PatientSchoolInformation.tsx');
const schoolManagement = read('src/components/SchoolsManagement.tsx');
const coordinator = read('src/components/CoordinatorDashboard.tsx');
const app = read('src/App.tsx');
const patientDashboard = read('src/components/PatientDashboard.tsx');

assert.equal(normalizeCareSetting('SCHOOL'), 'SCHOOL');
assert.equal(normalizeCareSetting('', 'escola'), 'SCHOOL');
assert.equal(normalizeCareSetting('', 'domicílio'), 'PATIENT_HOME');
assert.equal(normalizeCareSetting('CLINIC'), 'CLINIC');
assert.equal(careSettingToLocationType('PATIENT_HOME'), 'domicilio');

const institutionalConflict = checkLocalScheduleConflicts({
  appointments: [{
    id: 'meeting-1:institutional:0',
    source: 'school_meeting',
    type: 'Reunião escolar',
    patient_id: 'patient-1',
    professional_ids: ['professional-1'],
    scheduled_at: '2026-07-27T13:00:00.000Z',
    scheduled_end_at: '2026-07-27T14:00:00.000Z',
    location_type: 'escola',
    status: 'scheduled',
  }],
  patient_id: 'patient-2',
  professional_ids: ['professional-1'],
  location_type: 'online',
  date: '2026-07-27',
  start_time: '10:30',
  duration_minutes: 50,
});
assert.equal(institutionalConflict.blocking, true);
assert.equal(institutionalConflict.conflicts.some((item) => item.conflictType === 'professional'), true);

const branding = resolveBrandingContext({ clinic: { displayName: 'Clínica Teste' } });
const disabledPush = buildPatientReminderNotificationPayload({
  appointmentId: 'appointment-1',
  dateLabel: '27/07/2026',
  timeLabel: '10:30',
  reminderKind: '24h',
  branding,
  canRequestReschedule: false,
});
assert.deepEqual(disabledPush.data.allowedActions, {
  canConfirm: true,
  canCancel: true,
  canRequestReschedule: false,
});
assert.doesNotMatch(disabledPush.body, /remarcar/i);

const disabledModal = buildPatientReminderModalViewModel({
  appointmentId: 'appointment-1',
  dateLabel: '27/07/2026',
  timeLabel: '10:30',
  status: 'pending',
  branding,
  canRequestReschedule: false,
});
assert.equal(disabledModal.rescheduleLabel, null);
assert.equal(disabledModal.allowedActions.canRequestReschedule, false);

for (const fragment of [
  'add column if not exists allow_patient_reschedule boolean',
  'default true',
  'clinic_policy_audit_events',
  'set_clinic_patient_reschedule_policy_v1',
  'add column if not exists care_setting text',
  'add column if not exists location_snapshot jsonb',
  'add column if not exists location_context_snapshot jsonb',
  'school_save_enrollment_v3',
  'appointments_structured_location_guard',
]) {
  assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}
assert.doesNotMatch(migration, /\btruncate\b|\bdelete\s+from\b/i);
assert.match(migration, /if not exists|create or replace/i);
assert.match(migration, /new\.location_snapshot is not distinct from old\.location_snapshot/i);
assert.match(migration, /APPOINTMENT_SCHOOL_UNIT_REQUIRED/);
assert.match(migration, /SCHOOL_UNIT_REQUIRED/);
assert.match(migration, /alter table if exists public\.aba_session_summaries[\s\S]*location_context_snapshot/i);
assert.match(migration, /appointment_location_legacy_diagnostics_v1/);
assert.match(migration, /CLINIC_WITHOUT_ROOM/);
assert.match(migration, /NON_CLINIC_WITH_ROOM/);
assert.match(migration, /SCHOOL_WITHOUT_SCHOOL/);
assert.match(migration, /STRUCTURED_LOCATION_WITHOUT_SNAPSHOT/);
assert.match(migration, /CLINIC_WITHOUT_SCHOOL_ORGANIZATION/);
assert.match(migration, /APPOINTMENT_CLINIC_SCHOOL_ORGANIZATION_REQUIRED/);
assert.match(migration, /APPOINTMENT_CLINIC_ROOM_SCOPE_MISMATCH/);
assert.match(
  migration,
  /revoke all on function public\.set_clinic_patient_reschedule_policy_v1\(uuid,uuid,boolean,text,text,text\)[\s\S]*?from public, anon, authenticated;[\s\S]*?grant execute[\s\S]*?to service_role;/i,
);
assert.match(
  migration,
  /revoke all on function public\.school_save_enrollment_v3\(uuid,uuid,uuid,uuid,jsonb,text,text\)[\s\S]*?from public, anon, authenticated;[\s\S]*?grant execute[\s\S]*?to service_role;/i,
);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.(?:set_clinic_patient_reschedule_policy_v1|school_save_enrollment_v3)[^;]*\bauthenticated\b/i,
);
const schoolSaveV3 = migration.match(
  /create or replace function public\.school_save_enrollment_v3[\s\S]*?\n\$\$;/i,
)?.[0] || '';
assert.match(schoolSaveV3, /'SAVE_SCHOOL_ENROLLMENT_V3'/);
assert.match(schoolSaveV3, /'v3-enrollment:'[\s\S]*school_change_enrollment_v2/i);
assert.match(schoolSaveV3, /'v3-consent:'[\s\S]*school_record_consent_v2/i);
assert.match(
  schoolSaveV3,
  /v_response := v_response \|\| jsonb_build_object\([\s\S]*'consents'[\s\S]*school_idempotency_store\([\s\S]*'SAVE_SCHOOL_ENROLLMENT_V3'/i,
);
assert.doesNotMatch(
  schoolSaveV3,
  /school_idempotency_existing\([\s\S]{0,220}'CHANGE_SCHOOL_ENROLLMENT'/i,
);

for (const databaseCase of [
  'TEST_GRANT_ANON_FAILED',
  'TEST_GRANT_AUTHENTICATED_FAILED',
  'TEST_GRANT_SERVICE_ROLE_FAILED',
  'TEST_CLINIC_ROOM_QUERY_FAILED',
  'APPOINTMENT_NON_CLINIC_ROOM_FORBIDDEN',
  'APPOINTMENT_PATIENT_SCHOOL_LINK_REQUIRED',
  'APPOINTMENT_SCHOOL_SCOPE_MISMATCH',
  'APPOINTMENT_LOCATION_SNAPSHOT_REQUIRED',
  'TEST_IDEMPOTENT_RETRY_RESPONSE_FAILED',
  'TEST_IDEMPOTENCY_CONFLICT_NOT_RAISED',
  'TEST_ROLLBACK_ENROLLMENT_FAILED',
  'rollback;',
]) {
  assert.match(databaseTest, new RegExp(databaseCase, 'i'));
}

assert.match(policyRoutes, /requireRoles\('coordinator', 'admin', 'owner'\)/);
assert.match(policyRoutes, /set_clinic_patient_reschedule_policy_v1/);
assert.match(server, /PATIENT_RESCHEDULE_DISABLED/);
assert.match(server, /readClinicPatientReschedulePolicies/);
assert.match(server, /\.from\('school_meetings'\)[\s\S]*school_meeting_participants/);
assert.match(server, /preserveHistoricalSnapshot/);
assert.match(server, /location_context_snapshot: sanitizeClinicalPayload/);
assert.match(server, /summaryLocationContext/);

assert.match(schoolRoutes, /\/api\/schools\/autocomplete/);
assert.match(schoolRoutes, /\/patients\/autocomplete/);
assert.match(schoolRoutes, /school_save_enrollment_v3/);
assert.doesNotMatch(schoolDialog, /\.rpc\(\s*['"]school_save_enrollment_v3/i);
assert.match(schoolDialog, /idempotencyKey\.current/);
assert.match(schoolDialog, /dataService\.(?:create|update)PatientSchoolEnrollment/);
assert.doesNotMatch(clinicSettings, /\.rpc\(\s*['"]set_clinic_patient_reschedule_policy_v1/i);
assert.match(clinicSettings, /dataService\.updateClinicAppointmentPolicy/);
assert.match(schoolDialog, /searchPatientsForSchool/);
assert.match(schoolDialog, /getSchoolAutocomplete/);
assert.match(patientSchool, /SchoolEnrollmentDialog/);
assert.match(schoolManagement, /SchoolEnrollmentDialog/);
assert.match(schoolManagement, /Editar dados e endereço/);
assert.match(schoolManagement, /dataService\.updateSchool\(selectedSchool\.id/);
assert.match(schoolManagement, /schoolEditForm\.addressComplement/);
assert.match(schoolManagement, /unitForm\.street/);
assert.match(schoolManagement, /Salvar unidade e endereço/);
assert.match(coordinator, /getPatientCareLocations/);
assert.match(coordinator, /school_id: sessionLocationType === "escola"/);
assert.match(coordinator, /refresh_location_snapshot: sessionRefreshLocationSnapshot/);
assert.match(app, /const schoolId =[\s\S]*sess\.schoolId \|\| sess\.school_id/);
assert.match(app, /care_setting: careSetting/);
assert.match(app, /school_id: locationType === 'escola' \? schoolId : null/);
assert.match(app, /school_unit_id: locationType === 'escola' \? schoolUnitId \|\| null : null/);
assert.match(patientDashboard, /canRequestReschedule/);

console.log('clinical location, school link and reschedule policy checks passed');
