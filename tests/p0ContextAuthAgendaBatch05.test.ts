import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appointmentBlocksConflict, checkLocalScheduleConflicts } from '../src/utils/scheduling';

// 19: Cancellation only frees the slot after cancellation is effective.
const conflicting = {
  id: 'appt-existing',
  patient_id: 'patient-a',
  therapist_id: 'professional-a',
  room_id: 'room-a',
  date: '2026-10-10',
  time: '14:00',
  scheduled_at: '2026-10-10T14:00:00-03:00',
  scheduled_end_at: '2026-10-10T14:50:00-03:00',
  duration_minutes: 50,
  status: 'scheduled'
};
const input = {
  appointments: [conflicting],
  date: '2026-10-10',
  start_time: '14:00',
  duration_minutes: 50,
  patient_id: 'patient-a',
  professional_ids: ['professional-a'],
  room_id: 'room-a',
  location_type: 'clinica',
  rooms: [{ id: 'room-a', name: 'Sala A', prevent_overlapping_appointments: true }]
};
const baseline = checkLocalScheduleConflicts(input);
assert.equal(baseline.blocking, true, 'agendamento ativo deve bloquear');
assert.ok(baseline.conflicts.some((c) => c.conflictType === 'patient' || c.conflictType === 'specialty'));
assert.ok(baseline.conflicts.some((c) => c.conflictType === 'professional'));
assert.ok(baseline.conflicts.some((c) => c.conflictType === 'room'));
for (const status of ['cancelled', 'canceled', 'CANCELADA', 'cancelado', 'no_show', 'archived']) {
  assert.equal(appointmentBlocksConflict({ status }), false, `${status} não bloqueia`);
  const result = checkLocalScheduleConflicts({ ...input, appointments: [{ ...conflicting, status }] });
  assert.equal(result.blocking, false, `${status} libera paciente, sala e profissional`);
}
for (const status of ['cancel_requested', 'CANCELAMENTO_SOLICITADO', 'reschedule_requested']) {
  assert.equal(appointmentBlocksConflict({ status }), true, `${status} ainda bloqueia`);
  assert.equal(checkLocalScheduleConflicts({ ...input, appointments: [{ ...conflicting, status }] }).blocking, true);
}

// 16: Switching access contexts must read canonical backend identities and reset old tenant UI.
const app = fs.readFileSync('src/App.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const selection = app.slice(app.indexOf('const handleAccessContextSelect = async'), app.indexOf('const handleAppointmentConfirmationChoice', app.indexOf('const handleAccessContextSelect = async')));
assert.match(selection, /dataService\.selectAccessContext\(/);
assert.match(selection, /resetWorkspaceScopedState\(\)/);
assert.match(selection, /setResolvedPatientPortalId\(''\)/);
assert.match(selection, /setPatientContextLoaded\(false\)/);
assert.match(selection, /setUser\(alignedUser\)/);
assert.doesNotMatch(selection, /setUser\(\{[^}]*role: context\.role/);
const serverSelection = server.slice(server.indexOf("app.post('/api/access-contexts/select'"), server.indexOf("app.post('/api/workspaces/select'", server.indexOf("app.post('/api/access-contexts/select'")));
assert.match(serverSelection, /fetchUserAccessContexts\(req\.session\.user\.id, workspaces\)/);
assert.match(serverSelection, /accessContexts\.find\(\(context\) => context\.id === accessContextId\)/);
assert.match(serverSelection, /ACCESS_CONTEXT_NOT_AUTHORIZED/);
assert.match(serverSelection, /req\.session\.save\(/);
assert.doesNotMatch(serverSelection, /req\.body\?\.(?:role|clinicId|patientId)/);

// 18: On an uncertain response, read the persisted result once; never retry the write blindly.
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const confirm = dataService.slice(dataService.indexOf('async confirmPortalAppointment('), dataService.indexOf('async requestPortalAppointmentReschedule(', dataService.indexOf('async confirmPortalAppointment(')));
assert.match(confirm, /response\.status < 500/);
assert.match(confirm, /getPortalAppointmentDetail\(appointmentId\)/);
assert.match(confirm, /recoveredFromReadback: true/);
assert.match(confirm, /status === 'CONFIRMED' \|\| patientResponse === 'CONFIRMED'/);
assert.equal((confirm.match(/method: 'POST'/g) || []).length, 1, 'sem segunda gravação especulativa');

console.log('p0ContextAuthAgendaBatch05.test.ts: ok');
