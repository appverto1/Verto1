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
  assert.match(serverCode, /\.in\('therapist_id', filters\.therapistIds\)/);
  assert.match(serverCode, /\.in\('patient_id', filters\.patientIds\)/);
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
  assert.match(dataServiceCode, /helperName: 'getCalendarEvents'/);
  assert.match(dataServiceCode, /async getCalendarEventDetail/);
  assert.match(dataServiceCode, /helperName: 'getCalendarEventDetail'/);
});

test('agenda semanal moderna tem sidebar, filtros, KPIs e cards clinicos', () => {
  assert.match(calendarCode, /export const ClinicalAgendaBoard/);
  for (const label of ['Mini calendário', 'Equipe', 'Paciente', 'Local/Sala', 'Tipo de sessão', 'Status e pendências']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['Somente significativas', 'Somente melhora', 'Somente piora', 'Somente alertas']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['Mudanças', 'Registradas', 'Com plano', 'Probes', 'Pendências']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['ABA', 'Fonoaudiologia', 'Terapia Ocupacional', 'Psicologia', 'Avaliação', 'Supervisão']) {
    assert.match(calendarCode, new RegExp(label));
  }
});

test('cards mostram informacoes e indicadores essenciais da sessao', () => {
  assert.match(calendarCode, /event\.time/);
  assert.match(calendarCode, /event\.patientName/);
  assert.match(calendarCode, /style\.label/);
  assert.match(calendarCode, /event\.room/);
  assert.match(calendarCode, /has_next_session_plan/);
  assert.match(calendarCode, /has_maintenance_probe/);
  assert.match(calendarCode, /has_session_record/);
  assert.match(calendarCode, /has_pending_signature/);
});

test('popover tem acoes clinicas e nao registra sessao automaticamente', () => {
  assert.match(calendarCode, /Iniciar sessão/);
  assert.match(calendarCode, /Ver prontuário/);
  assert.match(calendarCode, /Ver plano sugerido/);
  assert.match(calendarCode, /Ver relatório/);
  assert.match(calendarCode, /Ver gráficos/);
  assert.match(calendarCode, /Maintenance Probes pendentes/);
  assert.match(calendarCode, /Plano sugerido para esta sessão/);
  assert.doesNotMatch(calendarCode, /completeMaintenanceSchedule\(/);
  assert.doesNotMatch(calendarCode, /saveAbaSessionSummary\(/);
});

test('coordinator usa agenda clinica e padrao inicial semanal', () => {
  assert.match(coordinatorCode, /import \{ ClinicalAgendaBoard \} from "\.\/Calendar"/);
  assert.match(coordinatorCode, /<ClinicalAgendaBoard/);
  assert.match(coordinatorCode, /onStartSession=\{\(appointment: any\) =>/);
  assert.match(agendaPreferenceCode, /const DEFAULT_AGENDA_VIEW: AgendaView = "week"/);
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
