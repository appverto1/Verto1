import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');
const originalSql = read('supabase/migrations/20260725220000_structured_school_management.sql');
const hardeningSql = read('supabase/migrations/20260725234500_structured_school_management_hardening.sql');
const server = read('server.ts');
const routes = read('services/schoolManagementRoutes.ts');
const service = read('src/services/dataService.ts');
const dashboard = read('src/components/CoordinatorDashboard.tsx');
const calendar = read('src/components/Calendar.tsx');
const schools = read('src/components/SchoolsManagement.tsx');
const patientSchool = read('src/components/PatientSchoolInformation.tsx');
const meetingWorkspace = read('src/components/SchoolMeetingWorkspace.tsx');

// A migration já aplicada continua presente e a correção é exclusivamente posterior/aditiva.
assert.match(originalSql, /create table if not exists public\.schools/i);
assert.match(hardeningSql, /Corrective migration for 20260725220000_structured_school_management\.sql, already applied\./i);
assert.doesNotMatch(hardeningSql, /drop\s+table/i);
assert.doesNotMatch(hardeningSql, /truncate\b/i);
assert.doesNotMatch(hardeningSql, /delete\s+from/i);

for (const fragment of [
  'school_organizations',
  'school_clinic_links',
  'enrollment_type',
  'consent_version',
  'removed_at',
  'attendance_marked_by',
  'school_meeting_referrals',
]) assert.match(hardeningSql, new RegExp(fragment));

// Organização real e apenas uma escola primária atual, preservando vínculos complementares.
assert.match(hardeningSql, /school_organization_id/);
assert.match(hardeningSql, /where is_current and enrollment_type='PRIMARY_SCHOOL'/i);
assert.match(hardeningSql, /drop index if exists public\.idx_enrollment_single_current/i);

// RLS e grants explícitos; notas de pacientes não ficam liberadas à recepção.
assert.match(hardeningSql, /create policy patient_notes_select_explicit/i);
assert.match(hardeningSql, /school_actor_can_access_patient/i);
assert.match(hardeningSql, /patient_notes_select_explicit[\s\S]{0,500}school_actor_effective_role[\s\S]{0,300}in \('owner','admin','coordinator','therapist'\)/i);
assert.match(hardeningSql, /revoke all on function[\s\S]*from public,anon,authenticated/i);
assert.match(hardeningSql, /grant execute on function[\s\S]*to service_role/i);

const criticalRpcs = [
  'school_create_school_v2', 'school_update_school_v2', 'school_upsert_unit_v2',
  'school_upsert_contact_v2', 'school_change_enrollment_v2', 'school_end_enrollment_v2',
  'school_record_consent_v2', 'create_school_meeting_batch_v2',
  'school_transition_meeting_v2', 'school_modify_meeting_patients_v2',
  'school_upsert_participant_v2', 'school_record_attendance_v2',
  'school_save_minutes_v2', 'school_link_document_v2', 'school_update_document_v2',
  'school_attach_referral_tasks_v2', 'school_resolve_migration_review_v2',
];
for (const rpc of criticalRpcs) assert.match(hardeningSql, new RegExp(`create or replace function public\\.${rpc}`));
assert.ok((hardeningSql.match(/school_idempotency_existing/g) || []).length >= criticalRpcs.length - 1);
assert.ok((hardeningSql.match(/school_idempotency_store/g) || []).length >= criticalRpcs.length - 1);
assert.match(hardeningSql, /pg_advisory_xact_lock/);
assert.match(hardeningSql, /school_assert_professional_availability/);
assert.match(hardeningSql, /SCHOOL_PROFESSIONAL_CONFLICT/);
assert.match(hardeningSql, /SCHOOL_CONSENT_REQUIRED/);
assert.match(hardeningSql, /PATIENT_ATTENDANCE_REQUIRED/);
assert.match(hardeningSql, /PARTICIPANT_ATTENDANCE_REQUIRED/);

// Backend modularizado e tenant resolvido pela sessão/clínica, sem confiar em organization_id do payload.
assert.match(server, /registerSchoolManagementRoutes/);
assert.match(routes, /select\('id,school_organization_id'\)/);
assert.doesNotMatch(routes, /req\.body\.organization_id|req\.body\.clinic_id/);
assert.match(routes, /if \(scope\.role === 'therapist'\) query = query\.eq\('therapist_id', scope\.actorId\)/);

const routeFragments = [
  "/api/schools/patients/search", "/api/school-calendar-events", "/api/school-meetings/:meetingId",
  "/api/school-meetings/:meetingId/patients", "/api/school-meetings/:meetingId/participants",
  "/api/school-meetings/:meetingId/attendance", "/api/school-meetings/:meetingId/patient-notes",
  "/api/school-documents", "/api/school-migration-review",
];
for (const fragment of routeFragments) assert.ok(routes.includes(fragment), `Rota ausente: ${fragment}`);
assert.match(routes, /portal_notifications/);
assert.match(routes, /from\('tasks'\)/);
assert.match(routes, /school_meeting_referrals/);
assert.match(routes, /deterministicUuid/);
assert.match(routes, /scope\.role === 'receptionist'.*return false/is);

// Contratos do frontend.
for (const method of [
  'searchSchoolPatients', 'getSchoolCalendarEvents', 'getSchoolMeetingDetail',
  'addSchoolMeetingPatients', 'removeSchoolMeetingPatients', 'addSchoolMeetingParticipant',
  'updateSchoolMeetingAttendance', 'getSchoolMeetingPatientNotes', 'linkSchoolDocument',
  'getSchoolMigrationReview', 'resolveSchoolMigrationReview', 'endPatientSchoolEnrollment',
]) assert.match(service, new RegExp(`async ${method}\\(`));

// Lista geral de pacientes e agenda realmente consomem os endpoints escolares.
assert.match(dashboard, /dataService\.searchSchoolPatients/);
assert.match(dashboard, /Criar reunião \(/);
assert.match(dashboard, /patientSchoolUnitFilter/);
assert.match(dashboard, /patientSchoolConsentFilter/);
assert.match(calendar, /dataService\.getSchoolCalendarEvents/);
assert.match(calendar, /SchoolMeetingWorkspace/);
assert.match(calendar, /selectedSchoolIds/);
assert.match(calendar, /selectedSchoolUnitIds/);

assert.match(calendar, /Promise\.allSettled/);
assert.match(calendar, /patientId: selectedPatientIds\.join\(','\)/);
assert.match(calendar, /event\.professionalIds/);
assert.match(calendar, /event\.patientIds/);
assert.match(routes, /requestedPatientIds/);
assert.match(routes, /patientIds:meetingPatientIds/);
assert.match(schools, /userRole=\{userRole\}/);
assert.match(schools, /value="DIRECTOR"/);
assert.match(hardeningSql, /INVALID_SCHOOL_CONTACT_ROLE/);

// Gestão funcional: ciclo da reunião, pacientes, participantes, presença, notas, tarefas e documentos.
for (const marker of [
  "runTransition('RESCHEDULE')", "runTransition('CANCEL')", "runTransition('NOT_HELD')",
  'addSchoolMeetingPatients', 'removeSchoolMeetingPatients', 'addSchoolMeetingParticipant',
  'updateSchoolMeetingAttendance', 'saveSchoolMeetingMinutes', 'linkSchoolDocument',
]) assert.ok(meetingWorkspace.includes(marker), `Fluxo ausente no workspace: ${marker}`);
assert.match(meetingWorkspace, /CLINICAL_TEAM/);
assert.match(meetingWorkspace, /AUTHORIZED_SCHOOL/);
assert.match(meetingWorkspace, /Concluir ata/);

// Fila de revisão, unidades e contatos possuem ações reais e sem exclusão física.
assert.match(schools, /startSchoolFromReview/);
assert.match(schools, /Criar nova escola/);
assert.match(schools, /updateSchoolUnit/);
assert.match(schools, /updateSchoolContact/);
assert.match(patientSchool, /endPatientSchoolEnrollment/);
assert.match(patientSchool, /SCHOOL_MEETING_PARTICIPATION/);

for (const source of [routes, dashboard, calendar, schools, patientSchool, meetingWorkspace]) {
  assert.doesNotMatch(source, /window\.location\.reload/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
}

console.log('schoolManagement.test: ok');
