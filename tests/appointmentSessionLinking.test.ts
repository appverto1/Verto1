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
const behaviorSoftDeleteMigrationSql = readFileSync(join(root, 'supabase/migrations/20260608120000_aba_behavior_events_soft_delete.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const getAbaSessionStartRoute = () => {
  const routeStart = serverCode.indexOf("app.post('/api/aba/sessions'");
  const routeEnd = serverCode.indexOf("app.patch('/api/aba/sessions/:sessionId'", routeStart);
  assert.ok(routeStart >= 0, 'ABA session start route exists');
  assert.ok(routeEnd > routeStart, 'ABA session patch route follows start route');
  return serverCode.slice(routeStart, routeEnd);
};

test('ABA session start is idempotent for an appointment', () => {
  assert.match(serverCode, /fetchInProgressAbaSessionForAppointment[\s\S]*?\.eq\('appointment_id', appointmentId\)[\s\S]*?\.in\('status', \['active', 'in_progress', 'IN_PROGRESS'\]\)/);
  assert.match(serverCode, /const sessionId = sanitizeString\(existingInProgressSession\?\.id \|\| requestedSessionId, 180\)/);
  assert.match(serverCode, /return res\.json\(\{ success: true, idempotent: Boolean\(existingInProgressSession\?\.id\), data, session: data \}\)/);
});

test('ABA session start validates server appointment instead of returning false sync conflict', () => {
  const route = getAbaSessionStartRoute();
  assert.match(serverCode, /ensureServerAppointmentForAbaSessionLink[\s\S]*?fetchAppointmentForAbaSessionLink[\s\S]*?fetchClinicStateAppointmentForAbaSessionLink/);
  assert.match(serverCode, /getAppointmentForSessionStart[\s\S]*?ensureServerAppointmentForAbaSessionLink/);
  assert.match(serverCode, /resolvePatientClinicIdForAbaSession[\s\S]*?\.from\('patients'\)[\s\S]*?\.select\('clinic_id'\)[\s\S]*?resolveAbaSessionClinicId/);
  assert.match(serverCode, /collectAbaSessionProfessionalScopeIds[\s\S]*?appointmentCanBeLinkedByUser/);
  assert.match(serverCode, /scheduled_start_at[\s\S]*?scheduledStartAt[\s\S]*?scheduled_start[\s\S]*?scheduledStart/);
  assert.match(route, /const clinicId = await resolveAbaSessionClinicId/);
  assert.match(route, /const rawAppointmentId = sanitizeString\(req\.body\?\.appointment_id \|\| req\.body\?\.appointmentId, 180\)/);
  assert.match(route, /appointmentStartRequested[\s\S]*?Consulta n.o informada/);
  assert.match(route, /INVALID_APPOINTMENT_ID[\s\S]*?Consulta inv.lida/);
  assert.match(route, /const fallbackAppointment = buildAbaSessionAppointmentMirrorFallback/);
  assert.match(route, /getAppointmentForSessionStart/);
  assert.match(route, /fallbackAppointment/);
  assert.match(route, /professionalScopeIds/);
  assert.match(serverCode, /appointment_snapshot/);
  assert.match(serverCode, /appointmentSnapshot/);
  assert.match(serverCode, /syncAppointmentsTableFromClinicState/);
  assert.doesNotMatch(route, /Sincronize a agenda antes de iniciar/);
});

test('ABA session appointment lookup tolerates clinic, schema and professional aliases', () => {
  const fetchStart = serverCode.indexOf('const fetchAppointmentForAbaSessionLink');
  const fetchEnd = serverCode.indexOf('const getAppointmentForSessionStart', fetchStart);
  const fetchBlock = serverCode.slice(fetchStart, fetchEnd);
  const route = getAbaSessionStartRoute();

  assert.match(fetchBlock, /\.or\(`organization_id\.eq\.\$\{safeClinicId\},clinic_id\.eq\.\$\{safeClinicId\}`\)/);
  assert.match(fetchBlock, /let selectColumns = CLOSURE_APPOINTMENT_SELECT/);
  assert.match(fetchBlock, /fallbackColumns/);
  assert.match(fetchBlock, /extractMissingColumnName\(error\)/);
  assert.match(fetchBlock, /appointmentCanBeLinkedByUser\(data, user, professionalScopeIds\)/);
  assert.doesNotMatch(fetchBlock, /\.eq\('therapist_id', sanitizeString\(user\?\.id, 120\)\)/);
  assert.match(route, /req\.body\?\.therapist_id[\s\S]*?req\.body\?\.therapistId/);
  assert.match(route, /!appointmentBelongsToProfessional\(linkedAppointment, explicitProfessionalId\)/);
  assert.match(route, /professionalIds: professionalScopeIds/);
});

test('ABA session start returns specific operational conflicts', () => {
  const route = getAbaSessionStartRoute();
  assert.match(route, /Esta consulta est[\s\S]*?cancelada e n[\s\S]*?pode ser iniciada/);
  assert.match(route, /Esta consulta j[\s\S]*?possui sess[\s\S]*?encerrada/);
  assert.match(route, /Os dados da consulta n[\s\S]*?conferem com o paciente selecionado/);
  assert.match(route, /Esta consulta n[\s\S]*?pode ser iniciada neste status/);
  assert.match(route, /J[\s\S]*?existe uma sess[\s\S]*?em andamento para este paciente\/profissional/);
  assert.match(serverCode, /fetchCompletedAbaSessionForAppointment[\s\S]*?\.in\('status', \['completed', 'COMPLETED'\]\)/);
  assert.match(serverCode, /fetchConflictingInProgressAbaSessionForAppointment[\s\S]*?\.eq\('patient_id', patientId\)[\s\S]*?\.eq\('therapist_id', professionalId\)/);
});

test('ABA session writes update appointment and closure readiness', () => {
  assert.match(serverCode, /patchAppointmentOperationalFromAbaSession[\s\S]*?status: 'IN_PROGRESS' \| 'COMPLETED'/);
  assert.match(serverCode, /patchAppointmentOperationalFromAbaSession[\s\S]*?aba_session_id: sanitizeString\(params\.abaSessionId, 180\) \|\| undefined/);
  assert.match(serverCode, /updateAppointmentOperationalPatch[\s\S]*?if \(missingColumn && missingColumn in safePatch\)[\s\S]*?delete safePatch\[missingColumn\]/);
  assert.match(serverCode, /const CLOSURE_APPOINTMENT_SELECT = \[[\s\S]*?'aba_session_id'/);
  assert.match(serverCode, /const CLOSURE_APPOINTMENT_SCHEMA_FALLBACK_COLUMNS = new Set\(\[[\s\S]*?'aba_session_id'/);
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

test('ABA behavior events usam soft delete e listagem ignora arquivados', () => {
  const deleteStart = serverCode.indexOf("app.delete('/api/aba/behavior-events/:eventId'");
  const listStart = serverCode.indexOf("app.get('/api/aba/behavior-events/:patientId'", deleteStart);
  const nextRoute = serverCode.indexOf("app.post('/api/aba/interval-records'", listStart);
  assert.ok(deleteStart >= 0, 'behavior delete route exists');
  assert.ok(listStart > deleteStart, 'behavior list route follows delete route');
  const deleteRoute = serverCode.slice(deleteStart, listStart);
  const listRoute = serverCode.slice(listStart, nextRoute);

  assert.match(deleteRoute, /softDeletePatch[\s\S]*?is_active: false[\s\S]*?deleted_at: now[\s\S]*?status: 'CANCELED'/m);
  assert.match(deleteRoute, /\.from\('aba_behavior_events'\)[\s\S]*?\.update\(softDeletePatch\)/m);
  assert.match(listRoute, /filterIsActive[\s\S]*?query = query\.eq\('is_active', true\)/m);
  assert.match(listRoute, /filterDeletedAt[\s\S]*?query = query\.is\('deleted_at', null\)/m);
  assert.match(listRoute, /filterCanceled[\s\S]*?query = query\.neq\('status', 'CANCELED'\)/m);
});

test('migration adiciona soft delete em ABA behavior events', () => {
  assert.match(behaviorSoftDeleteMigrationSql, /alter table public\.aba_behavior_events[\s\S]*add column if not exists is_active boolean not null default true[\s\S]*add column if not exists deleted_at timestamptz/i);
  assert.match(behaviorSoftDeleteMigrationSql, /idx_aba_behavior_events_active_patient/i);
});

test('frontend accepts canonical session id and sends appointment_id with records', () => {
  assert.match(patientDetailCode, /const saveResult = await dataService\.saveAbaSession/);
  assert.match(patientDetailCode, /const savedSession = saveResult\?\.session \|\| saveResult\?\.data/);
  assert.match(patientDetailCode, /id: String\(savedSession\.id\)/);
  assert.match(patientDetailCode, /professional_id: nextSession\.professional_id \|\| undefined/);
  assert.match(patientDetailCode, /service_type: nextSession\.service_type \|\| undefined/);
  assert.match(patientDetailCode, /appointmentId: nextSession\.appointmentId/);
  assert.match(patientDetailCode, /scheduled_start_at: nextSession\.scheduledStart/);
  assert.match(patientDetailCode, /scheduled_end_at: nextSession\.scheduledEnd/);
  assert.match(patientDetailCode, /source: nextSession\.appointment_id \? 'appointment' : 'verto_web'/);
  assert.match(dataServiceCode, /fields\.appointment_id = appointmentId[\s\S]*?fields\.appointmentId = appointmentId/);
  assert.match(patientDetailCode, /appointment_snapshot: scheduledSessionForPatient/);
  assert.match(patientDetailCode, /appointmentSnapshot: scheduledSessionForPatient/);
  assert.match(sessionModeCode, /appointment_id: activeAppointmentId \|\| undefined/);
  assert.match(sessionModeCode, /appointmentId: activeAppointmentId \|\| undefined/);
});

test('agenda start action uses only a persisted appointment id', () => {
  assert.match(coordinatorDashboardCode, /resolvePersistedAppointmentId/);
  assert.match(coordinatorDashboardCode, /appointment\?\.appointment_id[\s\S]*?appointment\?\.appointmentId[\s\S]*?appointment\?\.id/);
  assert.match(coordinatorDashboardCode, /buildAppointmentSessionContext/);
  assert.match(coordinatorDashboardCode, /showToast\("Esta consulta ainda n[\s\S]*?foi salva no servidor\. Atualize a agenda e tente novamente\.", "error"\)/);
  assert.match(coordinatorDashboardCode, /setScheduledSessionContext\(sessionAppointment\)/);
  assert.match(coordinatorDashboardCode, /setScheduledSessionStartKey\(/);
  assert.match(coordinatorDashboardCode, /startScheduledSessionKey=\{/);
  assert.match(patientDetailCode, /startScheduledSessionKey/);
  assert.match(patientDetailCode, /consumedScheduledSessionStartKeyRef/);
  assert.match(patientDetailCode, /isUuidLike\(scheduledAppointmentId\)/);
  assert.match(patientDetailCode, /handleConfirmSessionStart\(\{ durationMinutes: scheduledSessionDurationMinutes, openSessionMode: true \}\)/);
  assert.match(patientDetailCode, /appointmentId: scheduledAppointmentId[\s\S]*?appointment_id: scheduledAppointmentId/);
  assert.match(patientDetailCode, /const sessionToOpen = activeSession \|\| persistedSession/);
  assert.match(patientDetailCode, /scheduledAppointmentId && !sessionAppointmentId[\s\S]*?appointment_id: scheduledAppointmentId/);
  assert.match(patientDetailCode, /dataService\.saveAbaSession\(\{[\s\S]*?source: 'appointment'[\s\S]*?clientSource: 'appointment'/);
});

test('ABA session start emits safe appointment context logs', () => {
  assert.match(serverCode, /logAbaSessionStartDebug/);
  assert.match(serverCode, /START_ABA_SESSION_FROM_APPOINTMENT/);
  assert.match(serverCode, /hasAppointmentId/);
  assert.match(serverCode, /appointmentFound/);
  assert.match(serverCode, /organizationMatched/);
  assert.doesNotMatch(serverCode, /console\.info\([^)]*req\.body/);
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

test('maintenance probes da sessao usam appointment_id e escopo da sessao', () => {
  const routeStart = serverCode.indexOf("app.get('/api/aba/sessions/:sessionId/maintenance-probes'");
  assert.ok(routeStart >= 0, 'endpoint de probes da sessao existe');
  const routeEnd = serverCode.indexOf("app.get('/api/aba/patient-summary/:patientId'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /checkAuth, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/);
  assert.match(route, /resolveAbaSessionReadScope\(requestedSessionId, req\.session\.user\)/);
  assert.match(route, /const activeAppointmentId = sanitizeString\(session\?\.appointment_id/);
  assert.match(route, /\.eq\('patient_id', patientId\)/);
  assert.match(route, /select\(ABA_MAINTENANCE_SCHEDULE_SELECT\)/);
  assert.match(route, /resolveMaintenanceProbeAvailability/);
  assert.match(route, /linkedToActiveAppointment/);
  assert.match(route, /missingLinkedAppointment = Boolean\(appointmentId && !appointment\?\.id && !linkedToActiveAppointment\)/);
  assert.match(route, /available[\s\S]*upcoming/);
  assert.doesNotMatch(route, /select\('\*'\)|targetName[\s\S]{0,120}availableSchedule/);
});

test('agenda recebe vinculo da sessao para liberar maintenance probes planejadas', () => {
  assert.match(serverCode, /mapClosureRowToCalendarFields[\s\S]*?aba_session_id: sanitizeString\(row\?\.aba_session_id, 180\) \|\| null/);
  assert.match(serverCode, /normalizeCalendarAppointmentRow[\s\S]*?aba_session_id: sanitizeString\(row\?\.aba_session_id \|\| row\?\.abaSessionId \|\| source\?\.aba_session_id \|\| source\?\.abaSessionId, 180\) \|\| null/);
  assert.match(sessionModeCode, /const activeAppointmentId = String\(\s*activeSession\?\.appointmentId \|\| activeSession\?\.appointment_id/);
  assert.match(sessionModeCode, /getAbaSessionMaintenanceProbes\(sessionId,\s*\{[\s\S]*?appointmentId: activeAppointmentId/m);
  assert.match(sessionModeCode, /Sondagens de manutenção desta consulta/);
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
