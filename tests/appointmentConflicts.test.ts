import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BLOCKING_APPOINTMENT_STATUS_QUERY_VALUES,
  buildAppointmentDateTime,
  calculateAppointmentEnd,
  checkLocalScheduleConflicts,
  formatTimeInAppointmentTimezone,
  normalizeAppointmentTime,
} from '../src/utils/scheduling';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const baseAppointment = {
  id: 'appointment-09',
  date: '2026-05-27',
  time: '09:00',
  duration_minutes: 30,
  patientId: 'patient-1',
  patientName: 'Pedro Henrique',
  professionalId: 'professional-1',
  professional: 'Terapeuta Mateus',
  room: 'room-1',
  roomName: 'Sala 1',
  location_type: 'clinica',
  status: 'SCHEDULED',
};

function conflictFor(overrides: Record<string, any> = {}, appointments = [baseAppointment]) {
  return checkLocalScheduleConflicts({
    appointments,
    patient_id: overrides.patient_id ?? 'patient-2',
    patient_name: overrides.patient_name ?? 'Maria',
    professional_ids: overrides.professional_ids ?? ['professional-2'],
    professional_names: overrides.professional_names ?? ['Terapeuta Ana'],
    room_id: overrides.room_id ?? 'room-2',
    room_name: overrides.room_name ?? 'Sala 2',
    location_type: overrides.location_type ?? 'clinica',
    date: overrides.date ?? '2026-05-27',
    start_time: overrides.start_time ?? '12:20',
    duration_minutes: overrides.duration_minutes ?? 30,
    exclude_event_id: overrides.exclude_event_id,
  });
}

test('09:00-09:30 e 12:20-12:50 nao conflitam', () => {
  assert.equal(conflictFor().hasConflict, false);
});

test('12:20-12:50 e 12:40-13:10 conflitam por sobreposicao real', () => {
  const existing = { ...baseAppointment, id: 'appointment-1220', time: '12:20' };
  const result = conflictFor({ start_time: '12:40', patient_id: 'patient-1' }, [existing]);
  assert.equal(result.blocking, true);
  assert.equal(result.conflicts[0].conflictType, 'patient');
});

test('12:20-12:50 e 12:50-13:20 nao conflitam por adjacencia', () => {
  const existing = { ...baseAppointment, id: 'appointment-1220', time: '12:20' };
  assert.equal(conflictFor({ start_time: '12:50', patient_id: 'patient-1' }, [existing]).hasConflict, false);
});

test('17:00 + 30min gera 17:30 em America/Sao_Paulo', () => {
  const start = buildAppointmentDateTime('2026-05-27', '17:00', 'America/Sao_Paulo');
  const end = calculateAppointmentEnd(start, 30);
  assert.equal(formatTimeInAppointmentTimezone(end, 'America/Sao_Paulo'), '17:30');
});

test('17:00-17:30 e 17:30-18:00 nao conflitam', () => {
  const existing = { ...baseAppointment, id: 'appointment-17', time: '17:00', duration_minutes: 30 };
  assert.equal(conflictFor({ start_time: '17:30', patient_id: 'patient-1' }, [existing]).hasConflict, false);
});

test('consulta cancelada nao bloqueia novo agendamento', () => {
  const existing = { ...baseAppointment, status: 'CANCELADA' };
  assert.equal(conflictFor({ start_time: '09:10', patient_id: 'patient-1' }, [existing]).hasConflict, false);
});

test('consulta remarcada antiga nao bloqueia novo agendamento', () => {
  const existing = { ...baseAppointment, status: 'REMARCADA' };
  assert.equal(conflictFor({ start_time: '09:10', patient_id: 'patient-1' }, [existing]).hasConflict, false);
});

test('editar consulta ignora auto-conflito', () => {
  const result = conflictFor({
    start_time: '09:00',
    patient_id: 'patient-1',
    professional_ids: ['professional-1'],
    room_id: 'room-1',
    exclude_event_id: 'appointment-09',
  });
  assert.equal(result.hasConflict, false);
});

test('conflito de sala retorna mensagem de sala', () => {
  const result = conflictFor({ start_time: '09:10', room_id: 'room-1', room_name: 'Sala 1' });
  assert.equal(result.conflicts[0].conflictType, 'room');
  assert.equal(result.humanMessage, 'Sala 1 ja esta ocupada das 09:00 as 09:30.');
});

test('conflito de profissional retorna mensagem de profissional', () => {
  const result = conflictFor({ start_time: '09:10', professional_ids: ['professional-1'] });
  assert.equal(result.conflicts[0].conflictType, 'professional');
  assert.equal(result.humanMessage, 'Terapeuta Mateus ja possui consulta das 09:00 as 09:30.');
});

test('conflito de paciente retorna mensagem de paciente', () => {
  const result = conflictFor({ start_time: '09:10', patient_id: 'patient-1', patient_name: 'Pedro Henrique' });
  assert.equal(result.conflicts[0].conflictType, 'patient');
  assert.equal(result.humanMessage, 'Pedro Henrique ja possui consulta das 09:00 as 09:30.');
});

test('timezone America/Sao_Paulo preserva horario local ao salvar em UTC', () => {
  const start = buildAppointmentDateTime('2026-05-27', '12:20', 'America/Sao_Paulo');
  assert.equal(start?.toISOString(), '2026-05-27T15:20:00.000Z');
  assert.equal(formatTimeInAppointmentTimezone(start, 'America/Sao_Paulo'), '12:20');
});

test('payload exige horario HH:mm completo e backend nao usa select estrela', () => {
  assert.equal(normalizeAppointmentTime('12:20'), '12:20');
  assert.equal(normalizeAppointmentTime('12:2'), '');
  assert.ok(BLOCKING_APPOINTMENT_STATUS_QUERY_VALUES.includes('COMPLETED'));
  assert.ok(BLOCKING_APPOINTMENT_STATUS_QUERY_VALUES.includes('RESCHEDULED_ACTIVE'));
  const routeStart = serverCode.indexOf("app.post('/api/calendar/events/check-conflicts'");
  const routeEnd = serverCode.indexOf("app.get('/api/clinic/rooms'", routeStart);
  const routeCode = serverCode.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeCode, /\.select\('\*'\)/);
  assert.match(serverCode, /\.select\(SCHEDULE_CONFLICT_APPOINTMENT_SELECT\)/);
  assert.match(serverCode, /BLOCKING_APPOINTMENT_STATUS_QUERY_VALUES/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} appointment conflict tests passed`);
