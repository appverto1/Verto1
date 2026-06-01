import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const agendaPreferenceCode = readFileSync(join(root, 'src/utils/agendaViewPreference.ts'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('calendar endpoint usa intervalo visivel, limit e colunas explicitas', () => {
  assert.match(serverCode, /app\.get\('\/api\/calendar\/events'/);
  assert.match(serverCode, /const CALENDAR_EVENT_SELECT = \[/);
  assert.match(serverCode, /'recurrence_group_id'/);
  assert.match(serverCode, /'recurrence_index'/);
  assert.match(serverCode, /recurrenceGroupId: sanitizeString/);
  assert.match(serverCode, /\.select\(CALENDAR_EVENT_SELECT\)/);
  assert.match(serverCode, /\.gte\('scheduled_at', range\.fromIso\)/);
  assert.match(serverCode, /\.lte\('scheduled_at', range\.toIso\)/);
  assert.match(serverCode, /\.limit\(range\.limit\)/);
  assert.doesNotMatch(serverCode, /\/api\/calendar\/events[\s\S]{0,2400}\.select\('\*'\)/);
});

test('calendar endpoint aplica filtros de terapeuta, paciente, tipo e status', () => {
  assert.match(serverCode, /therapistIds: parseCalendarFilterList/);
  assert.match(serverCode, /patientIds: parseCalendarFilterList/);
  assert.match(serverCode, /types: parseCalendarFilterList/);
  assert.match(serverCode, /statuses: parseCalendarFilterList/);
  assert.match(serverCode, /roomIds: parseCalendarFilterList/);
  assert.match(serverCode, /locationTypes: parseCalendarFilterList/);
  assert.match(serverCode, /\.in\('therapist_id', filters\.therapistIds\)/);
  assert.match(serverCode, /\.in\('patient_id', filters\.patientIds\)/);
  assert.match(serverCode, /\.in\('room_id', filters\.roomIds\)/);
  assert.match(serverCode, /\.eq\('organization_id', organizationId\)/);
  assert.match(serverCode, /calendarEventMatchesFilters/);
});

test('detail endpoint carrega dados pesados apenas sob demanda', () => {
  assert.match(serverCode, /app\.get\('\/api\/calendar\/events\/:eventId\/detail'/);
  assert.match(serverCode, /\.from\('aba_next_session_plan_items'\)/);
  assert.match(serverCode, /\.from\('aba_maintenance_schedules'\)/);
  assert.match(serverCode, /\.from\('aba_clinical_recommendations'\)/);
  assert.match(serverCode, /\.eq\('appointment_id', eventId\)/);
  assert.match(serverCode, /\.in\('status', \['ACCEPTED', 'APPLIED_TO_NEXT_SESSION'\]\)/);
  assert.doesNotMatch(serverCode, /\/api\/calendar\/events\/:eventId\/detail[\s\S]{0,3600}\.select\('\*'\)/);
});

test('dataService expõe agenda leve e detalhe sob demanda', () => {
  assert.match(dataServiceCode, /async getCalendarEvents/);
  assert.match(dataServiceCode, /\/api\/calendar\/events/);
  assert.match(dataServiceCode, /from: options\.from/);
  assert.match(dataServiceCode, /to: options\.to/);
  assert.match(dataServiceCode, /view: options\.view/);
  assert.match(dataServiceCode, /roomId: options\.roomId/);
  assert.match(dataServiceCode, /locationType: options\.locationType/);
  assert.match(dataServiceCode, /helperName: 'getCalendarEvents'/);
  assert.match(dataServiceCode, /async getCalendarEventDetail/);
  assert.match(dataServiceCode, /helperName: 'getCalendarEventDetail'/);
});

test('agenda operacional mensal tem sidebar, filtros, KPIs discretos e cards clinicos', () => {
  assert.match(calendarCode, /export const ClinicalAgendaBoard/);
  for (const label of ['Mini calendário', 'Equipe', 'Paciente', 'Local/Sala', 'Tipo de sessão', 'Status e pendências']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['Somente significativas', 'Somente melhora', 'Somente piora', 'Somente alertas']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['Sessões', 'Registradas', 'Plano', 'Probes', 'Pendências']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['ABA', 'Fonoaudiologia', 'Terapia Ocupacional', 'Psicologia', 'Avaliação', 'Supervisão']) {
    assert.match(calendarCode, new RegExp(label));
  }
});

test('cards mostram informacoes e indicadores essenciais da sessao', () => {
  assert.match(calendarCode, /event\.time/);
  assert.match(calendarCode, /event\.patientName/);
  assert.match(calendarCode, /getAppointmentStatusColor/);
  assert.match(calendarCode, /statusColor\.dot/);
  assert.match(calendarCode, /style\.label/);
  assert.match(calendarCode, /getRoomDisplayLine/);
  assert.match(calendarCode, /has_next_session_plan/);
  assert.match(calendarCode, /has_maintenance_probe/);
  assert.match(calendarCode, /has_session_record/);
  assert.match(calendarCode, /has_pending_signature/);
  assert.match(calendarCode, /closure_readiness_status/);
  assert.match(calendarCode, /getClosureStatusStyle/);
});

test('popover tem acoes clinicas e nao registra sessao automaticamente', () => {
  assert.match(calendarCode, /Ações da consulta/);
  assert.match(calendarCode, /Confirmar/);
  assert.match(calendarCode, /Remarcar/);
  assert.match(calendarCode, /Cancelar/);
  assert.match(calendarCode, /Excluir/);
  assert.match(calendarCode, /Iniciar sessão/);
  assert.match(calendarCode, /Ver prontuário/);
  assert.match(calendarCode, /Ver plano sugerido/);
  assert.match(calendarCode, /Ver relatório/);
  assert.match(calendarCode, /Ver gráficos/);
  assert.match(calendarCode, /Manutencoes vinculadas/);
  assert.match(calendarCode, /Plano sugerido para esta sessão/);
  assert.match(calendarCode, /Fechamento/);
  assert.match(calendarCode, /Ver checklist/);
  assert.match(calendarCode, /getClosureAppointmentDetail/);
  assert.match(calendarCode, /isDeletedAppointmentEvent/);
  assert.match(serverCode, /\.is\('deleted_at', null\)/);
  assert.match(serverCode, /\.neq\('status', 'deleted'\)/);
  assert.doesNotMatch(calendarCode, /completeMaintenanceSchedule\(/);
  assert.doesNotMatch(calendarCode, /saveAbaSessionSummary\(/);
});

test('coordinator usa agenda clinica e padrao inicial mensal persistido', () => {
  assert.match(coordinatorCode, /import \{ ClinicalAgendaBoard \} from "\.\/Calendar"/);
  assert.match(coordinatorCode, /<ClinicalAgendaBoard/);
  assert.match(coordinatorCode, /onStartSession=\{\(appointment: any\) =>/);
  assert.match(agendaPreferenceCode, /CALENDAR_LAST_VIEW_MODE_KEY = "calendar:lastViewMode"/);
  assert.match(agendaPreferenceCode, /const DEFAULT_AGENDA_VIEW: AgendaView = "month"/);
});

test('visao mensal mantem calendario fixo, scroll interno e ver mais acima de dez consultas', () => {
  assert.match(calendarCode, /xl:h-\[calc\(100vh-2rem\)\]/);
  assert.match(calendarCode, /h-full overflow-y-auto p-4 pr-3 custom-scrollbar/);
  assert.match(calendarCode, /items\.slice\(0, 10\)/);
  assert.match(calendarCode, /items\.length > 10/);
  assert.match(calendarCode, /ver mais/);
  assert.match(calendarCode, /openDayPanel/);
  assert.match(calendarCode, /overflow-y-auto pr-1 custom-scrollbar/);
});

test('nomes reais de sala aparecem como dado humano e nunca como uuid', () => {
  assert.match(calendarCode, /Sala não identificada/);
  assert.match(calendarCode, /Sala não informada/);
  assert.match(calendarCode, /looksLikeTechnicalId/);
  assert.match(serverCode, /room_name: room \|\| null/);
  assert.match(serverCode, /room_specialties: roomSpecialties/);
  assert.match(coordinatorCode, /O nome da sala será exibido na agenda e nos relatórios/);
  assert.match(coordinatorCode, /Especialidades ajudam a filtrar salas/);
  assert.match(coordinatorCode, /roomSpecialties/);
});

test('modal de criacao cobre tipos ABA/multidisciplinar e recorrencia', () => {
  for (const label of ['Fonoaudiologia', 'Terapia Ocupacional', 'Psicopedagogia', 'Reunião interdisciplinar', 'Orientação familiar']) {
    assert.match(coordinatorCode, new RegExp(label));
  }
  for (const label of ['Semanal', 'Quinzenal', 'Mensal', 'Personalizada']) {
    assert.match(coordinatorCode, new RegExp(label));
  }
  assert.match(coordinatorCode, /recurrencePattern: sessionRecurrencePattern/);
});

test('package inclui script de teste da agenda', () => {
  assert.match(packageJson, /"test:calendar-events": "tsx tests\/calendarEvents\.test\.ts"/);
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

console.log(`${passed}/${tests.length} calendar agenda tests passed`);
