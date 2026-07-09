import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientTimeReport,
  buildProfessionalWorkReport,
  checkLocalScheduleConflicts,
  resolveRecurringAppointmentBillingFields,
} from '../src/utils/scheduling';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260527143000_clinic_rooms_schedule_conflicts_time_reports.sql'), 'utf8');
const roomSpecialtiesMigrationCode = readFileSync(join(root, 'supabase/migrations/20260528120000_clinic_rooms_specialties.sql'), 'utf8');
const roomOverlapMigrationCode = readFileSync(join(root, 'supabase/migrations/20260707120000_clinic_room_overlap_policy.sql'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const baseAppointments = [
  {
    id: 'a1',
    date: '2026-05-27',
    time: '08:00',
    duration_minutes: 60,
    patientId: 'p1',
    patientName: 'Pedro',
    professionalId: 't1',
    professional: 'Mateus',
    room: 'room-aba',
    roomName: 'Sala ABA',
    location_type: 'clinica',
    type: 'ABA',
    status: 'scheduled',
  },
];

test('local Clínica exige sala', () => {
  const result = checkLocalScheduleConflicts({
    appointments: [],
    patient_id: 'p2',
    professional_ids: ['t2'],
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '09:00',
    duration_minutes: 45,
  });
  assert.equal(result.hasConflict, false);
  assert.match(serverCode, /Selecione uma sala da clinica|Selecione uma sala da clínica/);
});

test('sala com sobreposicao liberada nao bloqueia, mas profissional continua bloqueando', () => {
  const sharedRoom = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t2'],
    room_id: 'room-aba',
    room_name: 'Sala ABA compartilhavel',
    rooms: [{ id: 'room-aba', name: 'Sala ABA compartilhavel', prevent_overlapping_appointments: false }],
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:15',
    duration_minutes: 30,
  });
  assert.equal(sharedRoom.hasConflict, false);

  const sameProfessional = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t1'],
    room_id: 'room-aba',
    rooms: [{ id: 'room-aba', prevent_overlapping_appointments: false }],
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:15',
    duration_minutes: 30,
  });
  assert.equal(sameProfessional.conflicts.some((item) => item.conflictType === 'professional'), true);
});

test('configuracao cadastrada da sala vence payload inseguro', () => {
  const result = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t2'],
    room_id: 'room-aba',
    room_name: 'Sala ABA',
    room_prevent_overlapping_appointments: false,
    rooms: [{ id: 'room-aba', name: 'Sala ABA', prevent_overlapping_appointments: true }],
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:15',
    duration_minutes: 30,
  });
  assert.equal(result.conflicts.some((item) => item.conflictType === 'room'), true);
});

test('detecta conflito de sala sobreposto e permite horário adjacente', () => {
  const conflict = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t2'],
    room_id: 'room-aba',
    room_name: 'Sala ABA',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:45',
    duration_minutes: 45,
  });
  assert.equal(conflict.blocking, true);
  assert.equal(conflict.conflicts.some((item) => item.conflictType === 'room'), true);

  const adjacent = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t2'],
    room_id: 'room-aba',
    room_name: 'Sala ABA',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '09:00',
    duration_minutes: 45,
  });
  assert.equal(adjacent.hasConflict, false);
});

test('detecta conflito de profissional, paciente e recorrência', () => {
  const professional = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t1'],
    room_id: 'room-fono',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:30',
    duration_minutes: 30,
  });
  assert.equal(professional.conflicts.some((item) => item.conflictType === 'professional'), true);

  const patient = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p1',
    professional_ids: ['t2'],
    room_id: 'room-fono',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '08:30',
    duration_minutes: 30,
  });
  assert.equal(patient.conflicts.some((item) => item.conflictType === 'patient'), true);

  const recurrence = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t2'],
    room_id: 'room-aba',
    room_name: 'Sala ABA',
    location_type: 'clinica',
    start_time: '08:30',
    duration_minutes: 30,
    recurrence_dates: ['2026-05-20', '2026-05-27'],
  });
  assert.equal(recurrence.blocking, true);
  assert.equal(recurrence.conflicts[0].date, '2026-05-27');
});

test('remarcacao em lote ignora as ocorrencias da propria serie', () => {
  const recurringSeries = [
    {
      id: 'series-1',
      date: '2026-05-27',
      time: '08:00',
      duration_minutes: 60,
      patientId: 'p1',
      professionalId: 't1',
      room: 'room-aba',
      location_type: 'clinica',
      status: 'scheduled',
      recurrence_group_id: 'rec-1',
      recurrence_index: 1,
    },
    {
      id: 'series-2',
      date: '2026-06-03',
      time: '08:00',
      duration_minutes: 60,
      patientId: 'p1',
      professionalId: 't1',
      room: 'room-aba',
      location_type: 'clinica',
      status: 'scheduled',
      recurrence_group_id: 'rec-1',
      recurrence_index: 2,
    },
  ];
  const result = checkLocalScheduleConflicts({
    appointments: recurringSeries,
    patient_id: 'p1',
    professional_ids: ['t1'],
    room_id: 'room-aba',
    location_type: 'clinica',
    start_time: '08:30',
    duration_minutes: 60,
    recurrence_dates: ['2026-05-27', '2026-06-03'],
    exclude_event_ids: ['series-1', 'series-2'],
  });
  assert.equal(result.hasConflict, false);
});

test('recorrencia copia autorizacao quando confirmada e deixa guia pendente nas demais', () => {
  const first = resolveRecurringAppointmentBillingFields({
    occurrenceIndex: 0,
    totalOccurrences: 4,
    guideNumber: 'GUIA-1',
    authorizationCode: 'AUTH-1',
    applyAuthorizationToRecurrence: true,
    reuseGuideAcrossRecurrence: false,
  });
  const second = resolveRecurringAppointmentBillingFields({
    occurrenceIndex: 1,
    totalOccurrences: 4,
    guideNumber: 'GUIA-1',
    authorizationCode: 'AUTH-1',
    applyAuthorizationToRecurrence: true,
    reuseGuideAcrossRecurrence: false,
  });
  assert.deepEqual(first, {
    guideNumber: 'GUIA-1',
    authorizationCode: 'AUTH-1',
  });
  assert.deepEqual(second, {
    guideNumber: '',
    authorizationCode: 'AUTH-1',
  });
});

test('guia so replica na recorrencia com escolha explicita', () => {
  const occurrence = resolveRecurringAppointmentBillingFields({
    occurrenceIndex: 2,
    totalOccurrences: 4,
    guideNumber: 'GUIA-LOTE',
    authorizationCode: 'AUTH-1',
    applyAuthorizationToRecurrence: false,
    reuseGuideAcrossRecurrence: true,
  });
  assert.deepEqual(occurrence, {
    guideNumber: 'GUIA-LOTE',
    authorizationCode: '',
  });
});

test('agendamento mostra autorizacoes disponiveis e permite usar guia sem consumir saldo', () => {
  assert.match(coordinatorCode, /dataService\.getAppointmentBillingSuggestion/);
  assert.match(coordinatorCode, /Autoriza..es dispon.veis/);
  assert.match(coordinatorCode, /Guia\/senha do paciente neste conv.nio, servi.o e data/);
  assert.match(coordinatorCode, /Selecionar n.o consome saldo/);
  assert.match(coordinatorCode, /Usar esta autoriza..o/);
  assert.match(coordinatorCode, /sessionUsableTissAuthorizations\.slice\(0, 6\)/);
  assert.match(coordinatorCode, /Autoriza..es n.o utiliz.veis/);
  assert.match(coordinatorCode, /hist.rico recente/);
  assert.match(coordinatorCode, /Nenhuma autoriza..o utiliz.vel para \$\{payerName\} nesta data/);
  assert.match(coordinatorCode, /autoriza..es cadastradas para outro conv.nio/);
  assert.match(coordinatorCode, /fora da validade da sess.o/);
  assert.match(coordinatorCode, /procedimento\/TUSS n.o . compat.vel/);
  assert.match(coordinatorCode, /sem saldo dispon.vel/);
  assert.match(coordinatorCode, /Reservado:/);
  assert.match(coordinatorCode, /Consumido:/);
  assert.match(coordinatorCode, /setSessionGuideNumber\(String\(authorization\?\.guideNumber/);
  assert.match(coordinatorCode, /setSessionAuthorizationCode\(String\(authorization\?\.authorizationCode/);
  assert.match(coordinatorCode, /sessionPatientTissAuthorizationId/);
  assert.match(coordinatorCode, /currentAppointmentId: editingAppointmentId/);
});

test('relatórios somam paciente e profissional com duração real', () => {
  const appointments = [
    ...baseAppointments.map((item) => ({
      ...item,
      status: 'completed',
      actual_duration_minutes: 50,
    })),
    {
      id: 'a2',
      date: '2026-05-28',
      time: '10:00',
      duration_minutes: 45,
      actual_duration_minutes: 40,
      patientId: 'p1',
      patientName: 'Pedro',
      professionalId: 't1',
      professional: 'Mateus',
      type: 'Fonoaudiologia',
      status: 'completed',
    },
    {
      id: 'a3',
      date: '2026-05-29',
      time: '11:00',
      duration_minutes: 60,
      patientId: 'p1',
      patientName: 'Pedro',
      professionalId: 't1',
      professional: 'Mateus',
      type: 'ABA',
      status: 'canceled',
    },
  ];

  const patientReport = buildPatientTimeReport(appointments, { patient_id: 'p1', from: '2026-05-01', to: '2026-05-31' });
  assert.equal(patientReport.scheduledMinutes, 165);
  assert.equal(patientReport.actualMinutes, 90);
  assert.equal(patientReport.cancelledCount, 1);
  assert.equal(patientReport.byServiceType.find((row: any) => row.serviceType === 'ABA')?.actualMinutes, 50);

  const professionalReport = buildProfessionalWorkReport(appointments, { professional_id: 't1', from: '2026-05-01', to: '2026-05-31' });
  assert.equal(professionalReport.actualMinutes, 90);
  assert.equal(professionalReport.workedDaysCount, 3);
  assert.equal(professionalReport.byDay.find((row: any) => row.workDate === '2026-05-28')?.actualMinutes, 40);
});

test('backend expõe endpoint de conflitos, relatórios e queries econômicas', () => {
  assert.match(serverCode, /app\.post\('\/api\/calendar\/events\/check-conflicts'/);
  assert.match(serverCode, /app\.get\('\/api\/reports\/time\/patient'/);
  assert.match(serverCode, /app\.get\('\/api\/reports\/time\/professional'/);
  assert.match(serverCode, /\.select\(SCHEDULE_CONFLICT_APPOINTMENT_SELECT\)/);
  assert.match(serverCode, /fetchConflictRooms/);
  assert.match(serverCode, /roomPreventsOverlappingAppointments/);
  assert.match(serverCode, /\.select\(TIME_REPORT_APPOINTMENT_SELECT\)/);
  assert.match(serverCode, /exclude_event_ids/);
  assert.doesNotMatch(serverCode, /check-conflicts[\s\S]{0,2400}\.select\('\*'\)/);
});

test('migration cria salas, índices e summaries', () => {
  for (const fragment of [
    'create table if not exists public.clinic_rooms',
    'add column if not exists specialties text',
    'add column if not exists approach text',
    'add column if not exists deleted_at timestamptz',
    'add column if not exists is_active boolean default true',
    'idx_appointments_schedule_window',
    'idx_appointments_patient_schedule_window',
    'idx_appointments_room_schedule_window',
    'appointment_professionals',
    'patient_monthly_service_summaries',
    'professional_daily_work_summaries',
    'professional_monthly_work_summaries',
  ]) {
    assert.match(migrationCode, new RegExp(fragment));
  }
  assert.match(roomSpecialtiesMigrationCode, /create table if not exists public\.clinic_rooms/i);
  assert.match(roomSpecialtiesMigrationCode, /alter table public\.clinic_rooms[\s\S]*add column if not exists specialties text/i);
  assert.match(roomOverlapMigrationCode, /add column if not exists prevent_overlapping_appointments boolean not null default true/i);
});

test('modal separa local, sala e duração', () => {
  for (const fragment of [
    'Local do atendimento',
    'Sala <span',
    'Duração',
    'Hora de fim',
    'Horário disponível',
    'Conflito encontrado',
    'Impedir sobreposição nesta sala',
    'Bloqueia sobreposição',
  ]) {
    assert.match(coordinatorCode, new RegExp(fragment));
  }
  assert.match(coordinatorCode, /exclude_event_ids: conflictExcludeEventIds/);
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

console.log(`${passed}/${tests.length} scheduling tests passed`);
