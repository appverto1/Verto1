import assert from 'node:assert/strict';
import { checkLocalScheduleConflicts, isSameSchedulePatient } from '../src/utils/scheduling';

// Regression: two different patients may share a room configured for overlap,
// including when display names are identical or missing.
const existing = {
  id: 'appointment-2145',
  patient_id: 'patient-1',
  patient_name: 'Paciente Teste',
  name: 'Paciente Teste',
  therapist_id: 'professional-1',
  room_id: 'room-1',
  date: '2026-10-16',
  time: '21:45',
  duration_minutes: 50,
  status: 'scheduled',
};

assert.equal(isSameSchedulePatient('patient-2', existing), false);
assert.equal(isSameSchedulePatient('patient-1', existing), true);
assert.equal(isSameSchedulePatient('patient-2', { ...existing, patient_id: null, name: 'Paciente Teste' }), false);
assert.equal(isSameSchedulePatient('patient-2', { patient_id: '', name: '' }), false);
assert.equal(isSameSchedulePatient('', existing), false);

const newSession = {
  appointments: [existing],
  date: '2026-10-16',
  start_time: '22:00',
  duration_minutes: 50,
  patient_id: 'patient-2',
  patient_name: 'Paciente Teste',
  professional_ids: ['professional-2'],
  room_id: 'room-1',
  location_type: 'clinica',
  rooms: [{ id: 'room-1', name: 'Sala Compartilhada', prevent_overlapping_appointments: false }],
};
const allowed = checkLocalScheduleConflicts(newSession);
assert.equal(allowed.blocking, false, 'dois pacientes e profissionais distintos podem sobrepor sala permitida');
assert.deepEqual(allowed.conflicts, []);

const samePatient = checkLocalScheduleConflicts({ ...newSession, patient_id: 'patient-1' });
assert.equal(samePatient.blocking, true, 'a regra do próprio paciente permanece');
assert.ok(samePatient.conflicts.some((c) => c.conflictType === 'patient' || c.conflictType === 'specialty'));

const sameProfessional = checkLocalScheduleConflicts({ ...newSession, professional_ids: ['professional-1'] });
assert.equal(sameProfessional.blocking, true, 'a regra do profissional permanece');
assert.ok(sameProfessional.conflicts.some((c) => c.conflictType === 'professional' || c.conflictType === 'team'));

const blockedRoom = checkLocalScheduleConflicts({
  ...newSession,
  rooms: [{ id: 'room-1', name: 'Sala Compartilhada', prevent_overlapping_appointments: true }],
});
assert.equal(blockedRoom.blocking, true, 'sala sem sobreposição ainda bloqueia');
assert.ok(blockedRoom.conflicts.some((c) => c.conflictType === 'room'));

const canceled = checkLocalScheduleConflicts({
  ...newSession,
  rooms: [{ id: 'room-1', name: 'Sala Compartilhada', prevent_overlapping_appointments: true }],
  appointments: [{ ...existing, status: 'cancelled' }],
});
assert.equal(canceled.blocking, false, 'sessão cancelada não mantém ocupação');

console.log('schedulingOverlappingRoomsPatientIdentity.test.ts: ok');
