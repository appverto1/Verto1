import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mergePersistedAppointments, removePersistedAppointments } from '../src/utils/appointmentActionUpdates';

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
  assert.match(appCode, /setTherapistAgenda\(\(prev\) => mergePersistedAppointments\(prev, persistenceResult\.appointments\)\)/);
  assert.match(appCode, /const handleUpdateAppointment = async/);
  assert.match(appCode, /await dataService\.updateAppointment\(/);
  assert.match(coordinatorCode, /await onScheduleSession\(newSession\)/);
  assert.match(coordinatorCode, /await onUpdateAppointment\(editingAppointmentId, updates\)/);
});

test('appointment endpoints use stable idempotency keys and read-after-write', () => {
  assert.match(dataServiceCode, /POST:\/api\/appointments:\$\{stableRequestId\}/);
  assert.match(dataServiceCode, /PATCH:\/api\/appointments\/\$\{appointmentId\}:\$\{stableRequestId\}/);
  assert.match(serverCode, /app\.post\('\/api\/appointments'/);
  assert.match(serverCode, /app\.patch\('\/api\/appointments\/:appointmentId'/);
  assert.match(serverCode, /readPersistedAppointmentRows\(appointmentIds, clinicId\)/);
  assert.match(serverCode, /confirmPersistedAppointmentRows\(persistedRows, preparedAppointments, clinicId\)/);
  assert.match(serverCode, /Não foi possível confirmar a persistência do agendamento/);
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
  assert.match(serverCode, /Sugestao de Maintenance Probe ignorada ao criar consulta/);
  assert.match(serverCode, /Contexto financeiro inicial ignorado/);
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
