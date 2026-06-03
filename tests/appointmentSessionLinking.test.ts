import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const coordinatorDashboardCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260602153000_aba_clinical_records_appointment_link.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('ABA session start is idempotent for an appointment', () => {
  assert.match(serverCode, /fetchInProgressAbaSessionForAppointment[\s\S]*?\.eq\('appointment_id', appointmentId\)[\s\S]*?\.in\('status', \['active', 'in_progress', 'IN_PROGRESS'\]\)/);
  assert.match(serverCode, /const sessionId = sanitizeString\(existingInProgressSession\?\.id \|\| requestedSessionId, 180\)/);
  assert.match(serverCode, /return res\.json\(\{ success: true, idempotent: Boolean\(existingInProgressSession\?\.id\), data, session: data \}\)/);
});

test('ABA session start validates server appointment instead of returning false sync conflict', () => {
  const routeStart = serverCode.indexOf("app.post('/api/aba/sessions'");
  const routeEnd = serverCode.indexOf("app.patch('/api/aba/sessions/:sessionId'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(serverCode, /ensureServerAppointmentForAbaSessionLink[\s\S]*?fetchAppointmentForAbaSessionLink[\s\S]*?fetchClinicStateAppointmentForAbaSessionLink/);
  assert.match(serverCode, /resolvePatientClinicIdForAbaSession[\s\S]*?\.from\('patients'\)[\s\S]*?\.select\('clinic_id'\)[\s\S]*?resolveAbaSessionClinicId/);
  assert.match(serverCode, /collectAbaSessionProfessionalScopeIds[\s\S]*?appointmentCanBeLinkedByUser/);
  assert.match(serverCode, /scheduled_start_at[\s\S]*?scheduledStartAt[\s\S]*?scheduled_start[\s\S]*?scheduledStart/);
  assert.match(route, /const clinicId = await resolveAbaSessionClinicId/);
  assert.match(route, /const rawAppointmentId = sanitizeString\(req\.body\?\.appointment_id \|\| req\.body\?\.appointmentId, 180\)/);
  assert.match(route, /APPOINTMENT_NOT_PERSISTED[\s\S]*?Esta consulta ainda não foi salva no servidor/);
  assert.match(route, /const fallbackAppointment = buildAbaSessionAppointmentMirrorFallback/);
  assert.match(route, /fallbackAppointment/);
  assert.match(route, /professionalScopeIds/);
  assert.match(serverCode, /appointment_snapshot/);
  assert.match(serverCode, /appointmentSnapshot/);
  assert.match(serverCode, /syncAppointmentsTableFromClinicState/);
  assert.match(route, /ensureServerAppointmentForAbaSessionLink/);
  assert.doesNotMatch(route, /Sincronize a agenda antes de iniciar/);
});

test('ABA session appointment lookup tolerates clinic and professional aliases', () => {
  const fetchStart = serverCode.indexOf('const fetchAppointmentForAbaSessionLink');
  const fetchEnd = serverCode.indexOf('const ensureServerAppointmentForAbaSessionLink', fetchStart);
  const fetchBlock = serverCode.slice(fetchStart, fetchEnd);
  const routeStart = serverCode.indexOf("app.post('/api/aba/sessions'");
  const routeEnd = serverCode.indexOf("app.patch('/api/aba/sessions/:sessionId'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);

  assert.match(fetchBlock, /\.or\(`organization_id\.eq\.\$\{safeClinicId\},clinic_id\.eq\.\$\{safeClinicId\}`\)/);
  assert.match(fetchBlock, /appointmentCanBeLinkedByUser\(data, user, professionalScopeIds\)/);
  assert.doesNotMatch(fetchBlock, /\.eq\('therapist_id', sanitizeString\(user\?\.id, 120\)\)/);
  assert.match(route, /req\.body\?\.therapist_id[\s\S]*?req\.body\?\.therapistId/);
  assert.match(route, /!appointmentBelongsToProfessional\(linkedAppointment, explicitProfessionalId\)/);
  assert.match(route, /professionalIds: professionalScopeIds/);
});

test('ABA session start returns specific operational conflicts', () => {
  const routeStart = serverCode.indexOf("app.post('/api/aba/sessions'");
  const routeEnd = serverCode.indexOf("app.patch('/api/aba/sessions/:sessionId'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /Esta consulta está cancelada e não pode ser iniciada/);
  assert.match(route, /Esta consulta já possui sessão encerrada/);
  assert.match(route, /Já existe uma sessão em andamento para este paciente\/profissional/);
  assert.match(serverCode, /fetchCompletedAbaSessionForAppointment[\s\S]*?\.in\('status', \['completed', 'COMPLETED'\]\)/);
  assert.match(serverCode, /fetchConflictingInProgressAbaSessionForAppointment[\s\S]*?\.eq\('patient_id', patientId\)[\s\S]*?\.eq\('therapist_id', professionalId\)/);
});

test('ABA session writes update appointment and closure readiness', () => {
  assert.match(serverCode, /patchAppointmentOperationalFromAbaSession[\s\S]*?status: 'IN_PROGRESS' \| 'COMPLETED'/);
  assert.match(serverCode, /appointmentStatus = payload\.status === 'completed'[\s\S]*?'COMPLETED'[\s\S]*?isAbaSessionInProgressStatus\(payload\.status\)[\s\S]*?'IN_PROGRESS'/);
  assert.match(serverCode, /await regenerateClosureForAppointments\(\s*\[payload\.appointment_id\],[\s\S]*?'aba_session_saved'/);
  assert.match(serverCode, /await regenerateClosureForAppointments\(\s*\[appointmentIdForClosure\],[\s\S]*?'aba_session_updated'/);
});

test('clinical records inherit appointment_id from session or request', () => {
  assert.match(serverCode, /resolveAbaAppointmentIdForClinicalWrite[\s\S]*?readAbaSessionAppointmentLink/);
  assert.match(serverCode, /fetchAppointmentForAbaSessionLink\(requestedAppointmentId, params\.clinicId, params\.user\)/);
  assert.match(serverCode, /sanitizeString\(appointment\.patient_id, 120\) !== patientId/);
  for (const route of [
    '/api/aba/trials',
    '/api/aba/behavior-events',
    '/api/aba/interval-records',
    '/api/aba/interval-summaries',
    '/api/aba/abc-events',
    '/api/aba/mastery-evaluations',
    '/api/aba/maintenance-probe-results',
    '/api/aba/session-summaries'
  ]) {
    const routeStart = serverCode.indexOf(`app.post('${route}'`);
    assert.ok(routeStart >= 0, `${route} route exists`);
    const routeEnd = serverCode.indexOf('\n  app.', routeStart + 20);
    const block = serverCode.slice(routeStart, routeEnd > routeStart ? routeEnd : routeStart + 9000);
    assert.match(block, /appointment_id:/, `${route} persists appointment_id`);
  }
});

test('frontend accepts canonical session id and sends appointment_id with records', () => {
  assert.match(patientDetailCode, /const saveResult = await dataService\.saveAbaSession/);
  assert.match(patientDetailCode, /const savedSession = saveResult\?\.session \|\| saveResult\?\.data/);
  assert.match(patientDetailCode, /id: String\(savedSession\.id\)/);
  assert.match(patientDetailCode, /professional_id: nextSession\.professional_id \|\| undefined/);
  assert.match(patientDetailCode, /service_type: nextSession\.service_type \|\| undefined/);
  assert.match(dataServiceCode, /fields\.appointment_id = appointmentId[\s\S]*?fields\.appointmentId = appointmentId/);
  assert.match(patientDetailCode, /appointment_snapshot: scheduledSessionForPatient/);
  assert.match(patientDetailCode, /appointmentSnapshot: scheduledSessionForPatient/);
  assert.match(sessionModeCode, /appointment_id: activeAppointmentId \|\| undefined/);
  assert.match(sessionModeCode, /appointmentId: activeAppointmentId \|\| undefined/);
});

test('agenda start action auto-starts a scheduled patient session', () => {
  assert.match(coordinatorDashboardCode, /setScheduledSessionContext\(appointment\)/);
  assert.match(coordinatorDashboardCode, /setScheduledSessionStartKey\(/);
  assert.match(coordinatorDashboardCode, /startScheduledSessionKey=\{/);
  assert.match(patientDetailCode, /startScheduledSessionKey/);
  assert.match(patientDetailCode, /consumedScheduledSessionStartKeyRef/);
  assert.match(patientDetailCode, /handleConfirmSessionStart\(\{ durationMinutes: scheduledSessionDurationMinutes, openSessionMode: true \}\)/);
  assert.match(patientDetailCode, /appointmentId: scheduledAppointmentId[\s\S]*?appointment_id: scheduledAppointmentId/);
});

test('migration adds appointment_id to ABA clinical records with scoped indexes', () => {
  assert.match(migrationSql, /aba_sessions_status_check[\s\S]*?'in_progress'/);
  for (const table of [
    'aba_session_summaries',
    'aba_trials',
    'aba_behavior_events',
    'aba_interval_records',
    'aba_interval_summaries',
    'aba_abc_events',
    'aba_mastery_evaluations',
    'aba_maintenance_probe_results'
  ]) {
    assert.match(migrationSql, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists appointment_id uuid references public\\.appointments`, 'i'));
    assert.match(migrationSql, new RegExp(`idx_${table}_appointment|idx_${table.replace('aba_', 'aba_')}_appointment`, 'i'));
  }
});

test('no broad select star is introduced', () => {
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] appointment-session linking checks: ${passed}/${tests.length}`);
