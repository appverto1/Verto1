import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  mergeAppointmentIdentityFallbacks,
  mergePersistedAppointments,
  removePersistedAppointments
} from '../src/utils/appointmentActionUpdates';

const root = process.cwd();
const appCode = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const calendarCode = fs.readFileSync(path.join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = fs.readFileSync(path.join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const dataServiceCode = fs.readFileSync(path.join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const atomicRescheduleMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260719153000_atomic_appointment_reschedule_approval.sql'),
  'utf8'
);
const atomicActionResolutionMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260720143000_atomic_appointment_action_request_resolution.sql'),
  'utf8'
);

test('appointment merge updates only matching persisted ids', () => {
  const current = [
    { id: 'a', patientName: 'A', date: '2026-06-10', time: '08:00', status: 'pending' },
    { id: 'b', patientName: 'B', date: '2026-06-10', time: '09:00', status: 'pending' },
  ];
  const next = mergePersistedAppointments(current, [
    { id: 'a', patientName: 'A', date: '2026-06-10', time: '08:00', status: 'confirmed' },
  ]);
  assert.equal(next.length, 2);
  assert.equal(next.find((item) => item.id === 'a')?.status, 'confirmed');
  assert.equal(next.find((item) => item.id === 'b')?.status, 'pending');
});

test('appointment merge never replaces real patient name with generic Paciente', () => {
  const next = mergePersistedAppointments(
    [{ id: 'future-1', patientName: 'Pedro Henrique', patient_name: 'Pedro Henrique', name: 'Pedro Henrique', date: '2026-06-19', time: '14:00' }],
    [{ id: 'future-1', patientName: 'Paciente', patient_name: 'Paciente', name: 'Paciente', status: 'confirmed' }],
  );
  assert.equal(next.find((item) => item.id === 'future-1')?.patientName, 'Pedro Henrique');
  assert.equal(next.find((item) => item.id === 'future-1')?.patient_name, 'Pedro Henrique');
  assert.equal(next.find((item) => item.id === 'future-1')?.name, 'Pedro Henrique');

  const unidentifiedFallback = mergeAppointmentIdentityFallbacks(
    [{ id: 'future-1', patientName: 'Paciente não identificado' }],
    [{ id: 'future-1', patientName: 'Pedro Henrique' }],
  );
  assert.equal(unidentifiedFallback[0]?.patientName, 'Pedro Henrique');
});

test('appointment merge preserves professional and room on partial patches', () => {
  const next = mergeAppointmentIdentityFallbacks(
    [{
      id: 'appointment-1',
      status: 'confirmed',
      therapistName: 'Profissional não definido',
      professional: 'Equipe',
      location: 'outro',
    }],
    [{
      id: 'appointment-1',
      therapist_id: 'professional-1',
      therapistName: 'Terapeuta Mateus',
      room_id: 'room-1',
      roomName: 'Sala ABA',
      location: 'clinica',
    }],
  );
  assert.equal(next[0].therapist_id, 'professional-1');
  assert.equal(next[0].therapistId, 'professional-1');
  assert.equal(next[0].professionalId, 'professional-1');
  assert.equal(next[0].therapistName, 'Terapeuta Mateus');
  assert.equal(next[0].room_id, 'room-1');
  assert.equal(next[0].roomName, 'Sala ABA');
  assert.equal(next[0].location, 'clinica');
});

test('appointment action result is enriched with local confirmed identity before rendering', () => {
  const enriched = mergeAppointmentIdentityFallbacks(
    [{ id: 'new-1', patientName: 'Paciente', patient_name: 'Paciente', date: '2026-06-26' }],
    [{ id: 'new-1', patientName: 'Pedro Henrique', patient_name: 'Pedro Henrique', name: 'Pedro Henrique' }],
  );
  assert.equal(enriched[0].patientName, 'Pedro Henrique');
  assert.equal(enriched[0].patient_name, 'Pedro Henrique');
  assert.equal(enriched[0].name, 'Pedro Henrique');
  assert.match(appCode, /mergeAppointmentIdentityFallbacks\(rawItems, fallback\.items \|\| \[\]\)/);
  assert.match(appCode, /const persistedAppointments = mergeAppointmentIdentityFallbacks\(persistenceResult\.appointments, newItems\)/);
  assert.match(appCode, /\{ action: 'created', items: newItems \}/);
});

test('appointment edit preserves the known patient name in agenda and open detail without reload', () => {
  assert.match(appCode, /mergeAppointmentIdentityFallbacks\(\s*persistenceResult\.appointments,\s*appointmentsToPersist,?\s*\)/);
  assert.match(appCode, /items: confirmedAppointments/);
  assert.match(appCode, /appointments: confirmedAppointments/);
  assert.match(calendarCode, /const mergedIdentity = mergeAppointmentIdentity\(event, local\)/);
  assert.match(calendarCode, /setSelectedEvent[\s\S]*?mergeAppointmentIdentity\(prev, normalized\)/);
  assert.match(calendarCode, /const detailMergedEvent = mergeAppointmentIdentity\([\s\S]*?detail\.event[\s\S]*?detail\.closure/);
});

test('appointment reschedule replaces every schedule alias and closes stale detail without reload', () => {
  assert.match(appCode, /startTime: targetScheduledAt/);
  assert.match(appCode, /start_time: targetScheduledAt/);
  assert.match(appCode, /endTime: targetScheduledEndAt/);
  assert.match(appCode, /end_time: targetScheduledEndAt/);
  assert.match(appCode, /scheduleChanged: scheduleChangedCount > 0/);
  assert.match(calendarCode, /const openAppointmentEditor = \(event: any\) => \{[\s\S]*?setSelectedEvent\(null\);[\s\S]*?setEventDetail\(null\);[\s\S]*?onEditAppointment\?\.\(event\)/);
  assert.match(calendarCode, /merged\.scheduledAt \|\| merged\.scheduled_at/);
  assert.match(calendarCode, /merged\.startTime \|\| merged\.start_time \|\| merged\.start/);
  assert.match(coordinatorCode, /Consulta remarcada com sucesso!/);
  assert.match(coordinatorCode, /Consulta atualizada com sucesso!/);
});

test('appointment mirror persists real patient labels instead of generic Paciente', () => {
  const syncSlice = serverCode.slice(
    serverCode.indexOf('async function syncAppointmentsTableFromClinicState'),
    serverCode.indexOf('async function ensureAppointmentMirrorForBillingContext'),
  );
  assert.match(serverCode, /function isGenericAppointmentPatientLabel/);
  assert.match(serverCode, /function pickAppointmentPatientName/);
  assert.match(syncSlice, /patientNamesById/);
  assert.match(syncSlice, /\.from\('patients'\)[\s\S]*?\.select\('id, name'\)[\s\S]*?\.eq\('clinic_id', clinicId\)[\s\S]*?\.in\('id', requestedPatientIds\)/);
  assert.match(syncSlice, /const resolvedPatientName = pickAppointmentPatientName/);
  assert.match(syncSlice, /patient_name: resolvedPatientName \|\| null/);
  assert.match(syncSlice, /patientName: resolvedPatientName/);
});

test('appointment removal deletes only confirmed deleted ids', () => {
  const next = removePersistedAppointments(
    [
      { id: 'a', patientName: 'A' },
      { id: 'b', patientName: 'B' },
    ],
    ['a'],
  );
  assert.deepEqual(next.map((item) => item.id), ['b']);
});

test('clinic state autosave no longer transports appointments', () => {
  const effectSlice = appCode.slice(
    appCode.indexOf('clinicStateSyncTimerRef.current = setTimeout'),
    appCode.indexOf('// Fetch activity logs from Backend on load'),
  );
  assert.match(effectSlice, /dataService\.saveClinicState\(payload\)/);
  assert.doesNotMatch(effectSlice, /appointments:\s*therapistAgenda/);
});

test('clinic_state appointment merge preserves professional and room unless explicitly cleared', () => {
  const mergeSlice = serverCode.slice(
    serverCode.indexOf('const mergeClinicStateAppointmentsById'),
    serverCode.indexOf('const normalizeAppointmentPatchStatus', serverCode.indexOf('const mergeClinicStateAppointmentsById')),
  );
  assert.match(mergeSlice, /mergeAppointmentClinicalAssignment/);
  assert.match(mergeSlice, /clearProfessional/);
  assert.match(mergeSlice, /clearRoom/);
  assert.match(mergeSlice, /professional_id/);
  assert.match(mergeSlice, /room_id/);
  assert.match(mergeSlice, /location_type = 'clinica'|location_type': 'clinica'|location_type/);
  assert.match(mergeSlice, /byId\.set\(id, mergeAppointmentClinicalAssignment\(byId\.get\(id\) \|\| \{\}, appointment\)\)/);
});

test('schedule and update actions await persisted backend mutations before success', () => {
  assert.match(appCode, /const handleScheduleSession = async/);
  assert.match(appCode, /await dataService\.createAppointments\(/);
  assert.match(appCode, /const handleUpdateAppointment = async/);
  assert.match(appCode, /await dataService\.updateAppointment\(/);
  assert.match(appCode, /applyAppointmentResultToAgenda/);
  assert.match(appCode, /if \(!applied\.ok\)/);
  assert.match(coordinatorCode, /await onScheduleSession\(newSession\)/);
  assert.match(coordinatorCode, /await onUpdateAppointment\(editingAppointmentId, updates\)/);
});

test('appointment endpoints use stable idempotency keys and read-after-write', () => {
  assert.match(dataServiceCode, /POST:\/api\/appointments:\$\{stableRequestId\}/);
  assert.match(dataServiceCode, /PATCH:\/api\/appointments\/\$\{appointmentId\}:\$\{stableRequestId\}/);
  assert.match(serverCode, /app\.post\('\/api\/appointments'/);
  assert.match(serverCode, /app\.patch\('\/api\/appointments\/:appointmentId'/);
  assert.match(serverCode, /fetchPersistedAppointmentActionByIdempotencyKey/);
  assert.match(serverCode, /\.like\('idempotency_key', `\$\{idempotencyKey\}:\$\{eventType\}:%`\)/);
  assert.match(serverCode, /idempotent: true/);
  assert.match(serverCode, /readPersistedAppointmentRows\(appointmentIds, clinicId\)/);
  assert.match(serverCode, /confirmPersistedAppointmentRows\(persistedRows, preparedAppointments, clinicId\)/);
  assert.match(serverCode, /Não foi possível confirmar a persistência do agendamento/);
});

test('appointment creation blocks duplicate durable slots and double submit', () => {
  const batchSlice = serverCode.slice(
    serverCode.indexOf('const persistAppointmentActionBatch'),
    serverCode.indexOf("app.post('/api/appointments'", serverCode.indexOf('const persistAppointmentActionBatch')),
  );
  assert.match(serverCode, /const validateDurableAppointmentConflictsForWrite/);
  assert.match(batchSlice, /validateDurableAppointmentConflictsForWrite\(\{/);
  assert.match(batchSlice, /duplicateGuard: true/);
  assert.match(batchSlice, /const mirror = await syncAppointmentsTableFromClinicState/);
  assert.ok(
    batchSlice.indexOf('validateDurableAppointmentConflictsForWrite') < batchSlice.indexOf('const mirror = await syncAppointmentsTableFromClinicState'),
    'duplicate guard must run before durable appointment upsert'
  );
  assert.match(coordinatorCode, /const sessionSubmitInFlightRef = useRef\(false\)/);
  assert.match(coordinatorCode, /const \[isSessionSubmitting, setIsSessionSubmitting\] = useState\(false\)/);
  assert.match(coordinatorCode, /if \(sessionSubmitInFlightRef\.current\) return/);
  assert.match(coordinatorCode, /sessionSubmitInFlightRef\.current = true/);
  assert.match(coordinatorCode, /!isSessionSubmitting/);
  assert.match(coordinatorCode, /isSessionSubmitting[\s\S]*\? "Salvando\.\.\."/);
});

test('billing context and TUSS revalidation do not create appointments', () => {
  const billingContextRoute = serverCode.slice(
    serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'"),
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/billing-item/resolve'")
  );
  assert.match(billingContextRoute, /ensureAppointmentMirrorForBillingContext/);
  assert.doesNotMatch(billingContextRoute, /syncAppointmentsTableFromClinicState\(/);
  assert.doesNotMatch(billingContextRoute, /\.from\('appointments'\)[\s\S]{0,500}\.upsert/);
  const billingResolveRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/billing-item/resolve'"),
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents")
  );
  assert.match(billingResolveRoute, /revalidateAppointmentBillingForAppointment/);
  assert.doesNotMatch(billingResolveRoute, /syncAppointmentsTableFromClinicState|\.from\('appointments'\)[\s\S]{0,500}\.upsert/);
});

test('duplicate diagnostics endpoint is read-only and scoped', () => {
  const routeStart = serverCode.indexOf("app.get('/api/appointments/duplicates/diagnostics'");
  const routeEnd = serverCode.indexOf("app.get('/api/clinic/rooms'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(route, /\.from\('appointments'\)[\s\S]*?\.select\(SCHEDULE_CONFLICT_APPOINTMENT_SELECT\)/);
  assert.match(route, /\.from\('appointment_billing_contexts'\)[\s\S]*?\.select\('appointment_id, payer_id, payer_type, payer_name_snapshot'\)/);
  assert.match(route, /recommendedKeepAppointmentId/);
  assert.match(route, /Revisar manualmente/);
  assert.doesNotMatch(route, /\.delete\(|\.update\(|\.upsert\(|\.insert\(/);
  assert.doesNotMatch(route, /\.select\('\*'\)/);
});

test('appointment mirror helpers can access schema fallback helpers at module scope', () => {
  const helperIndex = serverCode.indexOf('function hasMissingFinancialSchema');
  const syncIndex = serverCode.indexOf('async function syncAppointmentsTableFromClinicState');
  const startServerIndex = serverCode.indexOf('async function startServer');
  assert.ok(helperIndex > -1, 'hasMissingFinancialSchema must be declared');
  assert.ok(syncIndex > -1, 'syncAppointmentsTableFromClinicState must be declared');
  assert.ok(startServerIndex > -1, 'startServer must be declared');
  assert.ok(helperIndex < syncIndex, 'schema fallback helper must be available to module-scope appointment helpers');
  assert.ok(helperIndex < startServerIndex, 'schema fallback helper must not be scoped inside startServer');
  assert.doesNotMatch(serverCode, /const hasMissingFinancialSchema =/);
});

test('appointment create tolerates optional schema columns after durable write', () => {
  const appointmentRouteSlice = serverCode.slice(
    serverCode.indexOf("const readClinicStateForAppointmentMutation"),
    serverCode.indexOf("const handleVapidPublicKey"),
  );
  assert.match(appointmentRouteSlice, /criticalColumns = new Set\(\['id', 'clinic_id', 'patient_id', 'therapist_id', 'scheduled_at', 'status'\]\)/);
  assert.match(appointmentRouteSlice, /extractMissingColumnName\(result\.error\)/);
  assert.match(appointmentRouteSlice, /columns = columns\.filter/);
  assert.match(appointmentRouteSlice, /extractMissingColumnName\(result\.error\) === 'specialty_settings'/);
  assert.match(appointmentRouteSlice, /extractMissingColumnName\(result\.error\) === 'updated_by'/);
  assert.match(appointmentRouteSlice, /clinic_state mirror ignored after durable persistence/);
  assert.match(appointmentRouteSlice, /clinic_state mirror did not echo all durable appointments/);
  assert.match(serverCode, /Sugestao de Maintenance Probe ignorada ao criar consulta/);
  assert.match(serverCode, /Contexto financeiro inicial ignorado/);
});

test('appointment status actions confirm durable table update without depending on clinic_state mirror', () => {
  const statusRouteSlice = serverCode.slice(
    serverCode.indexOf('const handleAppointmentStatusUpdate'),
    serverCode.indexOf("app.delete('/api/appointments/:appointmentId'"),
  );
  assert.match(statusRouteSlice, /\.select\('id'\)/);
  assert.match(statusRouteSlice, /status clinic_state mirror ignored after durable update/);
  assert.match(statusRouteSlice, /persistedStatusMatches/);
  assert.match(statusRouteSlice, /normalizeAppointmentStatusForUi\(row\?\.status \|\| ''\) === normalizedStatus/);
});

test('appointment routes avoid select star and persist domain events', () => {
  const appointmentRouteSlice = serverCode.slice(
    serverCode.indexOf("const readClinicStateForAppointmentMutation"),
    serverCode.indexOf("const handleVapidPublicKey"),
  );
  assert.doesNotMatch(appointmentRouteSlice, /\.select\(['"]\*['"]\)/);
  assert.match(appointmentRouteSlice, /appointment_domain_events/);
  assert.match(appointmentRouteSlice, /eventType/);
  assert.match(appointmentRouteSlice, /idempotencyKey/);
});

test('reschedule approval readback compares canonical ISO strings without throwing', () => {
  const helperStart = serverCode.indexOf('const appointmentScheduleMatches');
  const helperEnd = serverCode.indexOf('const resolveAppointmentNotificationTarget', helperStart);
  const helper = serverCode.slice(helperStart, helperEnd);
  assert.ok(helperStart > -1, 'appointmentScheduleMatches must exist');
  assert.match(helper, /sanitizeIsoDateTime\(buildAppointmentScheduledAt\(row\)\)/);
  assert.doesNotMatch(helper, /buildAppointmentScheduledAt\(row\)\?\.toISOString/);
  assert.match(helper, /calculateAppointmentEnd\(new Date\(actualStart\), getCalendarAppointmentDuration\(row\)\)/);
});

test('reschedule approval preflights all submitted options and only accepts server assignments', () => {
  const previewStart = serverCode.indexOf('const buildRescheduleApprovalPreview');
  const previewEnd = serverCode.indexOf('const buildPortalRescheduleDateWindow', previewStart);
  const preview = serverCode.slice(previewStart, previewEnd);
  const routeStart = serverCode.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);

  assert.match(preview, /parsed\.options\.slice\(0, Math\.min\(24/);
  assert.match(preview, /\.from\('clinic_memberships'\)[\s\S]*?\.eq\('clinic_id', assignment\.clinicId\)/);
  assert.match(preview, /\.from\('professional_profiles'\)[\s\S]*?\.in\('user_id', activeMemberIds\)/);
  assert.match(preview, /fetchConflictRooms\(assignment\.clinicId, assignment\.organizationId\)/);
  assert.match(preview, /Promise\.all\(\[[\s\S]*?fetchConflictAppointmentsFromTable[\s\S]*?fetchConflictAppointmentsFromState/);
  assert.match(preview, /checkLocalScheduleConflicts\(\{/);
  assert.match(preview, /evaluateRequestedRescheduleSlot\(\{/);
  assert.match(preview, /!conflictTypes\.has\('patient'\)/);
  assert.match(preview, /alternatives\.length >= 3/);

  assert.match(route, /const selectedOption = requestedOptions\[selectedOptionIndex\]/);
  assert.match(route, /Nunca aceite data\/hora arbitraria do corpo da requisicao/);
  assert.doesNotMatch(route, /sanitizeIsoDateTime\(req\.body\?\.scheduledStart/);
  assert.match(route, /const allowedAssignments = \[/);
  assert.match(route, /allowedAssignments\.find/);
  assert.match(route, /code: 'RESCHEDULE_CONFLICT'/);
  assert.match(route, /supabase\.rpc\('approve_appointment_reschedule_v2'/);
  assert.match(route, /RESCHEDULE_APPROVAL_SCHEMA_INCOMPATIBLE/);
  assert.match(route, /p_professional_id: approvedAssignment\.professionalId/);
  assert.match(route, /p_room_id: approvedAssignment\.locationType === 'clinica'/);
  assert.match(route, /const durationMinutes = getCalendarAppointmentDuration\(appointment\)/);
  assert.match(route, /calculateAppointmentEnd\(startDate, durationMinutes\)/);
});

test('reschedule approval is idempotent and does not record a false approval before persistence', () => {
  const routeStart = serverCode.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /requestRow\.status === 'APPROVED'/);
  assert.match(route, /recoveringApprovedReschedule = true/);
  assert.match(route, /let atomicPayload: any = \{\};/);
  assert.doesNotMatch(route, /const atomicPayload/);
  assert.match(route, /appointmentScheduleMatches\(persistedAppointment/);
  assert.match(route, /supabase\.rpc\('approve_appointment_reschedule_v2'/);
  assert.match(route, /appointmentScheduleMatches\(confirmedAppointment/);
  assert.match(route, /RESCHEDULE_APPROVAL_SCHEMA_UNAVAILABLE/);
  assert.match(route, /RESCHEDULE_APPOINTMENT_CHANGED/);
  assert.match(route, /RESCHEDULE_ASSIGNMENT_UNAVAILABLE/);
  assert.doesNotMatch(route, /rescheduleCompensationPatch/);
  assert.match(atomicRescheduleMigration, /from public\.appointment_action_requests[\s\S]*?for update/);
  assert.match(atomicRescheduleMigration, /from public\.appointments[\s\S]*?for update/);
  assert.match(atomicRescheduleMigration, /pg_advisory_xact_lock[\s\S]*?:patient:/);
  assert.match(atomicRescheduleMigration, /pg_advisory_xact_lock[\s\S]*?:professional:/);
  assert.match(atomicRescheduleMigration, /pg_advisory_xact_lock[\s\S]*?:room:/);
  assert.match(atomicRescheduleMigration, /RESCHEDULE_APPOINTMENT_CHANGED/);
  assert.match(atomicRescheduleMigration, /originalScheduledStart/);
  assert.match(atomicRescheduleMigration, /update public\.appointments[\s\S]*?set status = 'scheduled'/);
  assert.match(atomicRescheduleMigration, /update public\.appointment_action_requests[\s\S]*?set status = 'APPROVED'/);
  assert.match(atomicRescheduleMigration, /insert into public\.appointment_status_audit_logs/);
  assert.match(atomicRescheduleMigration, /notification_24h_sent_at = null/);
  assert.doesNotMatch(atomicRescheduleMigration, /insert into public\.appointments/);
  assert.match(atomicActionResolutionMigration, /perform 1[\s\S]*?appointment_action_requests[\s\S]*?order by r\.id[\s\S]*?for update/);
  assert.match(atomicActionResolutionMigration, /ACTION_REQUEST_SUPERSEDED/);
  assert.match(atomicActionResolutionMigration, /r\.request_type in \('CANCEL', 'RESCHEDULE'\)/);
  assert.match(atomicActionResolutionMigration, /approve_appointment_cancellation/);
  assert.match(atomicActionResolutionMigration, /reject_appointment_action_request/);
  assert.doesNotMatch(atomicActionResolutionMigration, /insert into public\.appointments/);
});

test('calendar exposes conflict-aware options and propagates approved appointment immediately', () => {
  assert.match(dataServiceCode, /getAppointmentActionRequestAvailability/);
  assert.match(calendarCode, /As opções foram comparadas por profissional, sala, financeiro e concorrência\./);
  assert.match(calendarCode, /Revisar e aprovar/);
  assert.match(calendarCode, /Confirmar novo horário/);
  assert.match(calendarCode, /Manter o contexto atual/);
  assert.match(calendarCode, /Sugerir outro horário/);
  assert.match(calendarCode, /Disponibilidade completa/);
  assert.match(calendarCode, /onAppointmentActionResolved\?\.\(result\.appointment\)/);
  const decisionStart = calendarCode.indexOf('const handleActionRequestDecision');
  const decisionEnd = calendarCode.indexOf('const handleMaintenanceLinkDecision', decisionStart);
  const decisionHandler = calendarCode.slice(decisionStart, decisionEnd);
  assert.match(decisionHandler, /applyUpdatedAppointmentToAgenda\(result\.appointment\)/);
  assert.doesNotMatch(decisionHandler, /cacheRef\.current\.clear/);
  assert.doesNotMatch(decisionHandler, /setRemoteRefreshNonce/);
  assert.doesNotMatch(decisionHandler, /getCalendarEventDetail/);
  const cacheUpdateStart = calendarCode.indexOf('const applyUpdatedAppointmentToAgenda');
  const cacheUpdateEnd = calendarCode.indexOf('const hydrateBillingForm', cacheUpdateStart);
  const cacheUpdate = calendarCode.slice(cacheUpdateStart, cacheUpdateEnd);
  assert.match(cacheUpdate, /cachedIndex < 0 && !belongsToRange/);
  assert.match(cacheUpdate, /nextData\.push\(normalizeClinicalEvent/);
  assert.match(coordinatorCode, /onAppointmentActionResolved=\{onAppointmentActionResolved\}/);
  assert.match(appCode, /onAppointmentActionResolved=\{\(appointment: any\) => \{[\s\S]*?applyAppointmentResultToAgenda/);
});
