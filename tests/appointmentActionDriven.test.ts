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
const coordinatorCode = fs.readFileSync(path.join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const dataServiceCode = fs.readFileSync(path.join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');

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
