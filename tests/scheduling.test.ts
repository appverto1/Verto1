import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientTimeReport,
  buildProfessionalWorkReport,
  checkLocalScheduleConflicts,
  resolveRecurringAppointmentBillingFields,
} from '../src/utils/scheduling';
import {
  buildAvailableRescheduleSlots,
  buildRescheduleRequestNote,
  normalizeRescheduleOptions,
  parseRescheduleRequestPayload,
  parseRescheduleRequestNote,
} from '../src/services/portalRescheduleAvailability';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260527143000_clinic_rooms_schedule_conflicts_time_reports.sql'), 'utf8');
const roomSpecialtiesMigrationCode = readFileSync(join(root, 'supabase/migrations/20260528120000_clinic_rooms_specialties.sql'), 'utf8');
const roomOverlapMigrationCode = readFileSync(join(root, 'supabase/migrations/20260707120000_clinic_room_overlap_policy.sql'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const teamManagementCode = readFileSync(join(root, 'src/components/TeamManagement.tsx'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');

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

test('intervalo entre sessoes bloqueia horario colado quando configurado', () => {
  const buffered = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t1'],
    room_id: 'room-fono',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '09:00',
    duration_minutes: 45,
    session_buffer_minutes: 10,
  });
  assert.equal(buffered.conflicts.some((item) => item.conflictType === 'professional'), true);

  const noBuffer = checkLocalScheduleConflicts({
    appointments: baseAppointments,
    patient_id: 'p2',
    professional_ids: ['t1'],
    room_id: 'room-fono',
    location_type: 'clinica',
    date: '2026-05-27',
    start_time: '09:00',
    duration_minutes: 45,
    session_buffer_minutes: 0,
  });
  assert.equal(noBuffer.hasConflict, false);
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

test('remarcacao do portal retorna apenas slots livres sem expor agenda privada', () => {
  const availability = buildAvailableRescheduleSlots({
    appointmentId: 'original',
    patientId: 'p1',
    professionalId: 't1',
    roomId: 'room-aba',
    locationType: 'clinica',
    currentScheduledStart: '2026-07-11T17:00:00.000Z',
    durationMinutes: 50,
    now: '2026-07-10T10:00:00-03:00',
    dateFrom: '2026-07-11',
    maxDays: 2,
    workdayStart: '08:00',
    workdayEnd: '12:00',
    minLeadMinutes: 0,
    existingAppointments: [
      {
        id: 'professional-busy',
        professionalId: 't1',
        patientId: 'other-patient',
        roomId: 'room-other',
        scheduledStart: '2026-07-11T11:00:00.000Z',
        scheduledEnd: '2026-07-11T11:50:00.000Z',
        status: 'scheduled',
      },
      {
        id: 'patient-busy',
        professionalId: 'other-professional',
        patientId: 'p1',
        roomId: 'room-other',
        scheduledStart: '2026-07-11T12:00:00.000Z',
        scheduledEnd: '2026-07-11T12:50:00.000Z',
        status: 'scheduled',
      },
      {
        id: 'room-busy',
        professionalId: 'other-professional',
        patientId: 'other-patient',
        roomId: 'room-aba',
        scheduledStart: '2026-07-11T13:00:00.000Z',
        scheduledEnd: '2026-07-11T13:50:00.000Z',
        status: 'scheduled',
      },
    ],
  });
  assert.equal(availability.windowDays, 2);
  assert.equal(availability.days[0]?.label, '11/07/2026');
  const firstDayStarts = availability.days.find((day) => day.date === '2026-07-11')?.slots.map((slot) => slot.start) || [];
  assert.deepEqual(firstDayStarts, ['11:00']);
  assert.ok(availability.days.every((day) => day.slots.every((slot) => !('patientName' in slot) && !('title' in slot))));
});

test('remarcacao do portal usa jornada semanal, almoco e bloqueios do profissional', () => {
  const availability = buildAvailableRescheduleSlots({
    appointmentId: 'original',
    patientId: 'p1',
    professionalId: 't1',
    roomId: 'room-aba',
    locationType: 'clinica',
    currentScheduledStart: '2026-07-20T14:00:00.000Z',
    durationMinutes: 50,
    now: '2026-07-19T10:00:00-03:00',
    dateFrom: '2026-07-20',
    maxDays: 5,
    workingSchedule: {
      active: true,
      stepMinutes: 50,
      minLeadMinutes: 0,
      maxSlotsPerDay: 12,
      days: {
        monday: {
          enabled: true,
          periods: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
          intervals: [{ start: '12:00', end: '13:00' }]
        },
        tuesday: {
          enabled: true,
          periods: [{ start: '08:00', end: '12:00' }],
          intervals: []
        },
        saturday: { enabled: false, periods: [] },
        sunday: { enabled: false, periods: [] }
      },
      exceptions: [
        { date: '2026-07-20', start: '08:00', end: '09:30', type: 'Folga', blocksAvailability: true }
      ]
    },
    existingAppointments: [
      {
        id: 'busy',
        professionalId: 't1',
        patientId: 'other',
        roomId: 'room-aba',
        scheduledStart: '2026-07-20T13:30:00.000Z',
        scheduledEnd: '2026-07-20T14:20:00.000Z',
        status: 'scheduled'
      }
    ]
  });

  assert.equal(availability.windowDays, 5);
  assert.equal(availability.rangeLabel, '20/07/2026 a 24/07/2026');
  assert.ok(!availability.days.some((day) => day.date === '2026-07-25'));
  const mondayStarts = availability.days.find((day) => day.date === '2026-07-20')?.slots.map((slot) => slot.start) || [];
  assert.ok(!mondayStarts.includes('08:00'));
  assert.ok(!mondayStarts.includes('08:50'));
  assert.ok(!mondayStarts.includes('10:30'));
  assert.ok(!mondayStarts.includes('12:00'));
  assert.ok(mondayStarts.includes('09:40'));
  assert.ok(mondayStarts.includes('13:00'));
});

test('remarcacao do portal respeita intervalo entre sessoes da jornada', () => {
  const availability = buildAvailableRescheduleSlots({
    appointmentId: 'original',
    patientId: 'p1',
    professionalId: 't1',
    roomId: 'room-aba',
    locationType: 'clinica',
    durationMinutes: 50,
    now: '2026-07-19T10:00:00-03:00',
    dateFrom: '2026-07-20',
    maxDays: 1,
    workingSchedule: {
      active: true,
      stepMinutes: 50,
      sessionBufferMinutes: 10,
      minLeadMinutes: 0,
      maxSlotsPerDay: 8,
      days: {
        monday: {
          enabled: true,
          periods: [{ start: '08:00', end: '12:00' }],
          intervals: []
        }
      }
    },
    existingAppointments: []
  });
  const starts = availability.days[0]?.slots.map((slot) => slot.start) || [];
  assert.deepEqual(starts, ['08:00', '09:00', '10:00', '11:00']);
  assert.ok(!starts.includes('08:50'));
});

test('configuracao de jornada profissional persiste no perfil e exige permissao administrativa', () => {
  assert.match(serverCode, /app\.get\('\/api\/clinic\/members\/:memberId\/work-schedule'/);
  assert.match(serverCode, /app\.patch\('\/api\/clinic\/members\/:memberId\/work-schedule'/);
  assert.match(serverCode, /app\.post\('\/api\/clinic\/members\/:memberId\/work-schedule\/apply'/);
  assert.match(serverCode, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /assertClinicMemberForWorkSchedule/);
  assert.match(serverCode, /metadata[^]*workSchedule/);
  assert.match(serverCode, /sessionBufferMinutes/);
  assert.match(serverCode, /session_buffer_minutes/);
  assert.match(serverCode, /preserveExceptions/);
  assert.match(serverCode, /upsert\(payloads/);
  assert.match(teamManagementCode, /Hor.rios de trabalho/);
  assert.match(teamManagementCode, /Exce..es e bloqueios/);
  assert.match(teamManagementCode, /updateMemberWorkSchedule/);
  assert.match(teamManagementCode, /applyMemberWorkSchedule/);
  assert.match(teamManagementCode, /Aplicar escala para outros profissionais/);
  assert.match(teamManagementCode, /Mesmo t.tulo profissional/);
  assert.match(teamManagementCode, /Preservar exce..es e bloqueios individuais futuros/);
  assert.match(teamManagementCode, /normalizeWorkScheduleDraftForSave/);
  assert.match(teamManagementCode, /formato HH:mm/);
  assert.match(teamManagementCode, /type="time"/);
  assert.doesNotMatch(teamManagementCode, /inputMode="numeric"[^]*Hor.rios de trabalho/);
  assert.match(teamManagementCode, /mt-4 grid gap-3/);
  assert.match(teamManagementCode, /min-w-0 w-full rounded-xl/);
  assert.match(teamManagementCode, /defaultSchedulePeriods/);
  assert.match(teamManagementCode, /defaultScheduleLunch/);
  assert.match(teamManagementCode, /sessionBufferMinutes/);
  assert.match(teamManagementCode, /Intervalo entre sess.es/);
  assert.match(teamManagementCode, /informe pelo menos um hor.rio de atendimento v.lido/);
  assert.match(teamManagementCode, /formatWorkScheduleMemberTitle\(editingScheduleMember\)/);
  assert.match(teamManagementCode, /replace\(/);
  assert.match(teamManagementCode, /terapeuta\\s\+/);
  assert.doesNotMatch(teamManagementCode, /Terapeuta Mateus/);
  assert.match(teamManagementCode, /workScheduleSavedPulse/);
  assert.match(teamManagementCode, /Hor.rios salvos/);
  assert.match(teamManagementCode, /CheckCircle2 size=\{17\}/);
  assert.match(teamManagementCode, /ring-4 ring-emerald-100/);
  assert.match(teamManagementCode, /Salvar hor.rios/);
});

test('pacientes e prontuario usam profissional responsavel sem terapeuta generico', () => {
  assert.match(coordinatorCode, /resolvePatientResponsibleProfessionalId/);
  assert.match(coordinatorCode, /responsible_professional_id/);
  assert.match(coordinatorCode, /Filtrar por profissional/);
  assert.match(coordinatorCode, /Sem profissional responsável/);
  assert.doesNotMatch(coordinatorCode, /Filtrar por terapeuta/);
  assert.doesNotMatch(coordinatorCode, /Profissional não identificado/);

  assert.match(patientDetailCode, /Profissional responsável/);
  assert.match(patientDetailCode, /formatPatientProfessionalOptionLabel/);
  assert.match(patientDetailCode, /responsible_professional_id/);
  assert.doesNotMatch(patientDetailCode, /Terapeuta Responsável/);
  assert.doesNotMatch(patientDetailCode, /Carregando terapeutas/);
  assert.match(appCode, /therapist_id:[\s\S]*updatedData\.therapist_id/);
});

test('agendamento usa responsavel do paciente e envia intervalo de sessoes ao conflito', () => {
  assert.match(coordinatorCode, /selectPatientForSession/);
  assert.match(coordinatorCode, /resolvePatientResponsibleProfessionalId\(patient\)/);
  assert.match(coordinatorCode, /setSessionProfessionalId\(responsibleProfessional\?\.id/);
  assert.match(coordinatorCode, /Este paciente ainda não possui profissional responsável atribuído/);
  assert.match(coordinatorCode, /sessionBufferMinutes/);
  assert.match(coordinatorCode, /session_buffer_minutes: sessionBufferMinutes/);
  assert.match(serverCode, /fetchProfessionalWorkingSchedule\(clinicId, professionalIds\[0\]\)/);
});

test('modal de agendamento resolve profissional responsavel por aliases de id', () => {
  assert.match(coordinatorCode, /isPatientCareProfessionalMember/);
  assert.match(coordinatorCode, /getProfessionalAccessRoleKeys/);
  assert.match(coordinatorCode, /collectProfessionalIdentifierCandidates/);
  assert.match(coordinatorCode, /professional_profile_id/);
  assert.match(coordinatorCode, /professionalProfileId/);
  assert.match(coordinatorCode, /user_id/);
  assert.match(coordinatorCode, /matchIds/);
  assert.match(coordinatorCode, /findProfessionalOptionById/);
  assert.match(coordinatorCode, /handleSessionPatientNameChange/);
  assert.match(coordinatorCode, /setSessionProfessionalManuallySelected\(Boolean\(nextId\)\)/);
  assert.match(coordinatorCode, /O profissional respons/);
  assert.doesNotMatch(coordinatorCode, /Terapeuta respons/);
  assert.doesNotMatch(coordinatorCode, /THERAPIST/);
});

test('solicitacao de remarcacao guarda ate tres opcoes estruturadas em nota compativel', () => {
  const options = normalizeRescheduleOptions([
    { scheduledStart: '2026-07-11T17:00:00.000Z', scheduledEnd: '2026-07-11T17:50:00.000Z', dateLabel: '11/07/2026', start: '14:00', end: '14:50' },
    { scheduledStart: '2026-07-12T12:00:00.000Z', scheduledEnd: '2026-07-12T12:50:00.000Z', dateLabel: '12/07/2026', start: '09:00', end: '09:50' },
    { scheduledStart: '2026-07-15T11:30:00.000Z', scheduledEnd: '2026-07-15T12:20:00.000Z', dateLabel: '15/07/2026', start: '08:30', end: '09:20' },
    { scheduledStart: '2026-07-16T11:30:00.000Z', scheduledEnd: '2026-07-16T12:20:00.000Z' },
  ]);
  assert.equal(options.length, 3);
  const note = buildRescheduleRequestNote('Prefiro periodo da tarde.', options);
  const parsed = parseRescheduleRequestNote(note);
  assert.equal(parsed.options.length, 3);
  assert.equal(parsed.options[0].start, '14:00');
  assert.equal(parsed.note, 'Prefiro periodo da tarde.');
});

test('solicitacao legada de remarcacao nunca vaza JSON escapado para a tela', () => {
  const legacy = '[verto-reschedule-options]{{&quot;selectedSlots&quot;:[{&quot;scheduledStart&quot;:&quot;2026-07-15T11:00:00.000Z&quot;,&quot;scheduledEnd&quot;:&quot;2026-07-15T11:50:00.000Z&quot;,&quot;dateLabel&quot;:&quot;15/07/2026&quot;,&quot;start&quot;:&quot;08:00&quot;,&quot;end&quot;:&quot;08:50&quot;}]}}';
  const parsed = parseRescheduleRequestNote(legacy);
  assert.equal(parsed.options.length, 1);
  assert.equal(parsed.note, '');
  assert.equal(parsed.hasStructuredPayload, true);
  assert.equal(parsed.invalidPayload, false);
});

test('metadata de remarcacao tem prioridade sobre nota legada e preserva mensagem humana', () => {
  const parsed = parseRescheduleRequestPayload('Prefiro a tarde.', {
    rescheduleOptions: [{
      scheduledStart: '2026-07-15T18:00:00.000Z',
      scheduledEnd: '2026-07-15T18:50:00.000Z',
      dateLabel: '15/07/2026',
      start: '15:00',
      end: '15:50'
    }]
  });
  assert.equal(parsed.source, 'metadata');
  assert.equal(parsed.options[0].start, '15:00');
  assert.equal(parsed.note, 'Prefiro a tarde.');
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
  assert.match(coordinatorCode, /Reservadas:/);
  assert.match(coordinatorCode, /Consumidas:/);
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
