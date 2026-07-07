import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateCalendarEventVisualLayout } from '../src/components/Calendar';
import { formatDisplayDate, formatDisplayDateTime } from '../src/utils/dateFormatting';
import { resolveAppointmentCancellationState } from '../src/utils/appointmentCancellationState';
import { getAppointmentPrimaryAction } from '../src/utils/appointmentPrimaryAction';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const agendaPreferenceCode = readFileSync(join(root, 'src/utils/agendaViewPreference.ts'), 'utf8');
const primaryActionCode = readFileSync(join(root, 'src/utils/appointmentPrimaryAction.ts'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('calendar endpoint usa intervalo visivel, limit e colunas explicitas', () => {
  assert.match(serverCode, /app\.get\('\/api\/calendar\/events'/);
  assert.match(serverCode, /const CALENDAR_EVENT_SELECT = \[/);
  assert.match(serverCode, /'patient_response'/);
  assert.match(serverCode, /'patient_confirmation_status'/);
  assert.match(serverCode, /'patient_confirmation_source'/);
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

test('agenda hidrata nome real do paciente quando recorrencia vem apenas com patient_id', () => {
  assert.match(serverCode, /hydrateCalendarPatientNames/);
  assert.match(serverCode, /\.from\('patients'\)[\s\S]*?\.select\('id, name'\)[\s\S]*?\.eq\('clinic_id', safeClinicId\)[\s\S]*?\.in\('id', idsNeedingHydration\)/);
  assert.match(serverCode, /isGenericCalendarPatientName/);
  assert.match(serverCode, /patient_name: pickCalendarPatientName/);
  assert.match(calendarCode, /parseEventSourcePayload/);
  assert.match(calendarCode, /pickPatientLabel/);
  assert.match(calendarCode, /getCalendarEventPatientId/);
  assert.match(calendarCode, /hydrateCalendarEventsByKnownPatientNames/);
  assert.match(calendarCode, /namesByPatientId\.set\(patientId, patientName\)/);
  assert.match(calendarCode, /mergeCalendarEventsForRender/);
  assert.match(calendarCode, /return hydrateCalendarEventsByKnownPatientNames\(\[\.\.\.withoutId, \.\.\.Array\.from\(byId\.values\(\)\)\]\)/);
  assert.match(calendarCode, /remoteState\.loaded/);
  assert.match(calendarCode, /source\?\.patientName/);
  assert.match(calendarCode, /source\?\.patient\?\.name/);
  assert.match(serverCode, /knownNamesById/);
  assert.match(serverCode, /hydrateRowsFromKnownNames/);
});

test('detalhe da consulta hidrata profissional, sala e responsavel familiar sem fallback destrutivo', () => {
  assert.match(serverCode, /patientResponsibleNamesById/);
  assert.match(serverCode, /responsible_name/);
  assert.match(serverCode, /familyResponsibleName: resolvedFamilyResponsibleName/);
  assert.match(calendarCode, /getProfessionalDisplayLine/);
  assert.match(calendarCode, /source\?\.professionalName/);
  assert.match(calendarCode, /getFamilyResponsibleDisplayLine/);
  assert.match(calendarCode, /event\?\.patient\?\.guardian\?\.nome/);
  assert.match(calendarCode, /familyResponsibleName: familyResponsibleName \|\| null/);
  assert.match(calendarCode, /isAppointmentPendingOfflineSync/);
  assert.match(calendarCode, /Pendente de sincronizacao/);
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

test('agenda mensal tem sidebar, filtros e barra compacta sem cabecalho redundante', () => {
  assert.match(calendarCode, /export const ClinicalAgendaBoard/);
  for (const label of ['Mini calendário', 'Equipe', 'Paciente', 'Local/Sala', 'Tipo de sessão', 'Status e pendências']) {
    assert.match(calendarCode, new RegExp(label));
  }
  for (const label of ['Somente significativas', 'Somente melhora', 'Somente piora', 'Somente alertas']) {
    assert.match(calendarCode, new RegExp(label));
  }
  assert.match(calendarCode, /periodLabel/);
  assert.match(calendarCode, /xl:grid-cols-\[1fr_auto_1fr\]/);
  assert.match(calendarCode, /min-w-\[180px\]/);
  assert.match(calendarCode, /aria-label="Atualizar agenda"/);
  assert.match(calendarCode, /aria-label="Relatórios de tempo"/);
  assert.doesNotMatch(calendarCode, /onDateChange\?\.\(new Date\(\)\)/);
  assert.doesNotMatch(calendarCode, /Nova sessão/);
  assert.doesNotMatch(calendarCode, /moveMiniCalendarMonth/);
  assert.doesNotMatch(calendarCode, /aria-label="Mês anterior"/);
  assert.doesNotMatch(calendarCode, /aria-label="Próximo mês"/);
  assert.doesNotMatch(calendarCode, /Agenda cl.nica/);
  assert.doesNotMatch(calendarCode, /Agenda operacional/);
  assert.doesNotMatch(calendarCode, /headerKpis/);
  for (const label of ['ABA', 'Fonoaudiologia', 'Terapia Ocupacional', 'Psicologia', 'Avaliação', 'Supervisão']) {
    assert.match(calendarCode, new RegExp(label));
  }
});

test('cards mostram informacoes e indicadores essenciais da sessao', () => {
  assert.match(calendarCode, /event\.time/);
  assert.match(calendarCode, /event\.patientName/);
  assert.match(calendarCode, /getAppointmentStatusColor/);
  assert.match(calendarCode, /getAppointmentPatientConfirmationVisualState/);
  assert.match(calendarCode, /patientConfirmationLabel/);
  assert.match(calendarCode, /patientConfirmationColor/);
  assert.match(calendarCode, /statusColor\.card/);
  assert.match(calendarCode, /bg-emerald-500 text-white/);
  assert.match(calendarCode, /mergeAppointmentStatusForRender/);
  assert.match(calendarCode, /Consulta confirmada pelo responsável/);
  assert.match(calendarCode, /style\.label/);
  assert.match(calendarCode, /getRoomDisplayLine/);
  assert.match(calendarCode, /has_next_session_plan/);
  assert.match(calendarCode, /has_maintenance_probe/);
  assert.match(calendarCode, /has_session_record/);
  assert.match(calendarCode, /has_pending_signature/);
  assert.match(calendarCode, /closure_readiness_status/);
  assert.match(calendarCode, /getClosureStatusStyle/);
});

test('detalhe da consulta hidrata profissional e separa responsavel familiar', () => {
  assert.match(calendarCode, /mergeAppointmentIdentity\(serverEvent, localEvent\)/);
  assert.match(calendarCode, /source\?\.therapistName/);
  assert.match(calendarCode, /source\?\.professional_id/);
  assert.match(calendarCode, /getProfessionalDisplayLine\(detailEvent\)/);
  assert.match(calendarCode, /getFamilyResponsibleDisplayLine\(detailEvent\)/);
  assert.match(calendarCode, /Equipe\/profissional/);
  assert.match(calendarCode, /Responsável familiar/);
  assert.match(calendarCode, /Profissional cadastrado não carregado/);
  assert.doesNotMatch(calendarCode, /label: 'Responsável', value: detailEvent\.therapistName/);
});

test('agenda usa resposta do paciente como fonte visual canonica', () => {
  assert.match(serverCode, /normalizePatientConfirmationStatusForAgenda/);
  assert.match(serverCode, /resolveAppointmentPatientConfirmationStates/);
  assert.match(serverCode, /appointment_status_audit_logs/);
  assert.match(serverCode, /CONFIRMED_BY_RESPONSIBLE/);
  assert.match(serverCode, /mapAppointmentAuditRowToPatientConfirmationState/);
  assert.match(serverCode, /patientConfirmationStatus/);
  assert.match(serverCode, /patientConfirmationLabel/);
  assert.match(serverCode, /patientConfirmationColor/);
  assert.match(serverCode, /clinic_state_fallback/);
  assert.match(serverCode, /fetchCalendarEventsFromClinicState[\s\S]*?enrichCalendarEventsWithPatientConfirmationState/);
  assert.match(serverCode, /normalizedEvents[\s\S]*?enrichCalendarEventsWithPatientConfirmationState/);
  assert.match(calendarCode, /normalizeAppointmentPatientConfirmationStatus/);
  assert.match(calendarCode, /getAppointmentPatientConfirmationVisualState\(event\)/);
  assert.match(calendarCode, /detailStatusColor = getAppointmentPatientConfirmationVisualState\(detailEvent\)/);
  assert.match(calendarCode, /CONFIRMADO/);
  assert.match(calendarCode, /REMARCAÇÃO SOLICITADA/);
  assert.match(calendarCode, /CANCELAMENTO SOLICITADO/);
});

test('clinic_state_fallback enriquece resposta confirmada pelo historico operacional', () => {
  assert.match(serverCode, /source: 'clinic_state_fallback'/);
  assert.match(serverCode, /fetchCalendarEventsFromClinicState\(clinicId, range, filters, \{\}, organizationId\)/);
  assert.match(serverCode, /\.from\('appointment_status_audit_logs'\)[\s\S]*?\.in\('appointment_id', ids\)/);
  assert.match(serverCode, /\.in\('action', \['CONFIRMED_BY_RESPONSIBLE', 'RESCHEDULE_REQUESTED', 'CANCEL_REQUESTED'\]\)/);
  assert.match(serverCode, /action === 'CONFIRMED_BY_RESPONSIBLE'[\s\S]*?status = 'confirmed'/);
  assert.match(serverCode, /applyPatientConfirmationStateToCalendarEvent/);
  assert.match(serverCode, /patientConfirmationStatus: resolved\.status/);
  assert.match(serverCode, /patientConfirmationColor: resolved\.color/);
});

test('agenda atualiza automaticamente apos resposta do portal', () => {
  assert.match(calendarCode, /remoteRefreshNonce/);
  assert.match(calendarCode, /verto:appointment-domain-event/);
  assert.match(calendarCode, /CALENDAR_EVENTS_CACHE_TTL_MS = 60_000/);
  assert.match(calendarCode, /CALENDAR_EVENTS_FOCUS_REFRESH_TTL_MS = 3 \* 60_000/);
  assert.match(calendarCode, /CALENDAR_DOMAIN_EVENT_DEBOUNCE_MS = 350/);
  assert.match(calendarCode, /inFlightRequestRef/);
  assert.match(calendarCode, /AbortController/);
  assert.match(calendarCode, /signal: controller\?\.signal/);
  assert.match(calendarCode, /refreshDebounceTimerRef/);
  assert.match(calendarCode, /document\.visibilityState !== 'visible'/);
  assert.doesNotMatch(calendarCode, /setInterval\(refreshWhenVisible, 15000\)/);
  assert.match(readFileSync(join(root, 'src/App.tsx'), 'utf8'), /window\.dispatchEvent\(new CustomEvent\('verto:appointment-domain-event'/);
});

test('agenda mensal usa scroll interno por dia sem janela de excedentes', () => {
  assert.match(calendarCode, /grid-rows-6/);
  assert.match(calendarCode, /items\.map\(\(event: any\) =>/);
  assert.match(calendarCode, /overflow-y-auto pr-0\.5 overscroll-contain custom-scrollbar/);
  assert.match(calendarCode, /onCreateAppointment\?\.\(key, '08:00'\)/);
  assert.doesNotMatch(calendarCode, /CALENDAR_MONTH_VISIBLE_EVENT_LIMIT/);
  assert.doesNotMatch(calendarCode, /\+\{items\.length/);
  assert.doesNotMatch(calendarCode, /openDayPanel/);
  assert.doesNotMatch(calendarCode, /items\.slice\(0, 10\)/);
});

test('clinic state logs e media nao ficam em polling pela agenda', () => {
  const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const mediaSlice = appCode.slice(
    appCode.indexOf('const refreshSignedProfileMedia = async'),
    appCode.indexOf('const handleVisibilityRefresh = () =>', appCode.indexOf('const refreshSignedProfileMedia = async')),
  );
  const logsSlice = appCode.slice(
    appCode.indexOf('// Fetch activity logs from Backend on load'),
    appCode.indexOf('const handleAddTask = async', appCode.indexOf('// Fetch activity logs from Backend on load')),
  );
  const clinicStateSlice = appCode.slice(
    appCode.indexOf('clinicStateSyncTimerRef.current = setTimeout'),
    appCode.indexOf('// Fetch activity logs from Backend on load'),
  );
  assert.match(appCode, /profileMediaFetchRef/);
  assert.match(appCode, /PROFILE_MEDIA_REFRESH_TTL_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(mediaSlice, /setInterval/);
  assert.match(appCode, /activityLogsFetchRef/);
  assert.match(logsSlice, /ACTIVITY_LOGS_REFRESH_TTL_MS/);
  assert.match(logsSlice, /\[user\?\.id, user\?\.role\]/);
  assert.doesNotMatch(logsSlice, /\[user\]/);
  assert.doesNotMatch(clinicStateSlice, /appointments:\s*therapistAgenda/);
});

test('cancelamento diferencia origem da clínica, paciente e desconhecida', () => {
  assert.deepEqual(
    resolveAppointmentCancellationState({ status: 'cancelled' }),
    {
      isCancelled: true,
      origin: 'clinic',
      status: 'cancelled_by_clinic',
      label: 'CANCELADO PELA CLÍNICA',
      message: 'Esta consulta foi cancelada pela clínica.',
      source: 'clinic'
    }
  );
  assert.equal(
    resolveAppointmentCancellationState({
      status: 'scheduled',
      patient_confirmation_status: 'CANCEL_REQUESTED',
      patient_confirmation_source: 'portal'
    }).isCancelled,
    false
  );
  assert.equal(
    resolveAppointmentCancellationState({
      status: 'cancelled',
      patient_confirmation_status: 'CANCEL_REQUESTED',
      patient_confirmation_source: 'portal'
    }).label,
    'CANCELADO PELO PACIENTE'
  );
  assert.equal(
    resolveAppointmentCancellationState({
      status: 'cancelled',
      patient_confirmation_status: 'confirmed',
      patient_confirmation_source: 'portal'
    }).label,
    'CANCELADO PELA CLÍNICA'
  );
  assert.equal(
    resolveAppointmentCancellationState({
      status: 'cancelled',
      patient_confirmation_source: 'legacy_unknown'
    }).label,
    'CANCELADO'
  );
  assert.equal(
    resolveAppointmentCancellationState({
      status: 'reschedule',
      patient_confirmation_status: 'RESCHEDULE_REQUESTED',
      patient_confirmation_source: 'portal'
    }).isCancelled,
    false
  );
  assert.match(serverCode, /function resolveCalendarCancellationState/);
  assert.match(serverCode, /status: 'cancelled_by_clinic'/);
  assert.match(serverCode, /label: 'CANCELADO PELA CLÍNICA'/);
  assert.match(serverCode, /patient_confirmation_source = 'clinic'/);
  assert.match(serverCode, /action: isPatientActor \? 'CANCEL_REQUESTED' : 'CANCELLED'/);
  assert.match(serverCode, /CANCELLED: 'Consulta cancelada pela clínica'/);
});

test('popover tem acoes clinicas e nao registra sessao automaticamente', () => {
  assert.match(calendarCode, /Ações da consulta/);
  assert.match(calendarCode, /Confirmar/);
  assert.match(calendarCode, /Remarcar/);
  assert.match(calendarCode, /Cancelar/);
  assert.match(calendarCode, /Excluir/);
  assert.match(primaryActionCode, /Iniciar sessão/);
  assert.match(primaryActionCode, /Continuar sessão/);
  assert.match(primaryActionCode, /Ver fechamento/);
  assert.match(calendarCode, /Ver prontuário/);
  assert.match(calendarCode, /Ver plano sugerido/);
  assert.match(calendarCode, /Ver relatório/);
  assert.match(calendarCode, /Ver gráficos/);
  assert.match(calendarCode, /Manutencoes vinculadas/);
  assert.match(calendarCode, /Plano sugerido para esta sessão/);
  assert.match(calendarCode, /Fechamento/);
  assert.match(calendarCode, /Preparação do atendimento/);
  assert.match(calendarCode, /Sessão em aberto/);
  assert.match(calendarCode, /Faturamento TISS/);
  assert.match(calendarCode, /CLOSURE_SECTION_META/);
  assert.match(calendarCode, /Antes da sessão/);
  assert.match(calendarCode, /Depois da sessão/);
  assert.match(calendarCode, /Ver Pré-guias TISS/);
  assert.match(calendarCode, /future_check/);
  assert.match(calendarCode, /Ver checklist/);
  assert.match(calendarCode, /getClosureAppointmentDetail/);
  assert.match(calendarCode, /isDeletedAppointmentEvent/);
  assert.match(serverCode, /\.is\('deleted_at', null\)/);
  assert.match(serverCode, /\.neq\('status', 'deleted'\)/);
  assert.doesNotMatch(calendarCode, /completeMaintenanceSchedule\(/);
  assert.doesNotMatch(calendarCode, /saveAbaSessionSummary\(/);
});

test('maintenance probes vinculadas reconhecem sessao ativa da consulta', () => {
  assert.match(calendarCode, /aba_session_id: event\?\.aba_session_id \|\| event\?\.abaSessionId \|\| source\?\.aba_session_id \|\| source\?\.abaSessionId \|\| null/);
  assert.match(calendarCode, /const detailLinkedAbaSessionId = String\(/);
  assert.match(calendarCode, /const detailHasActiveLinkedSession =/);
  assert.match(calendarCode, /detailPrimaryAction\.kind === 'continue'/);
  assert.match(calendarCode, /Abrir na sessão ativa/);
  assert.match(calendarCode, /Usada na sessão\./);
  assert.match(calendarCode, /Inicie a sessão para usar esta Maintenance Probe\./);
});

test('ação principal respeita a fase operacional da consulta', () => {
  assert.deepEqual(
    getAppointmentPrimaryAction({ status: 'scheduled' }, 'scheduled_pre_session'),
    { kind: 'start', label: 'Iniciar sessão' }
  );
  assert.deepEqual(
    getAppointmentPrimaryAction({ status: 'in_progress', actual_start_at: '2026-06-25T10:00:00.000Z' }, 'in_session'),
    { kind: 'continue', label: 'Continuar sessão' }
  );
  for (const phase of [
    'completed_pending_closure',
    'closed_ready_for_prefacturing',
    'prefacturing_ready',
    'prefacturing_blocked'
  ]) {
    assert.deepEqual(
      getAppointmentPrimaryAction({ status: 'completed', has_session_record: true }, phase),
      { kind: 'closure', label: 'Ver fechamento' }
    );
  }
  assert.deepEqual(
    getAppointmentPrimaryAction({ status: 'cancelled' }, 'cancelled'),
    { kind: 'none', label: '' }
  );
  assert.match(calendarCode, /detailPrimaryAction\.kind !== 'none'/);
  assert.match(calendarCode, /detailPrimaryAction\.label/);
  assert.match(calendarCode, /detailPrimaryAction\.kind === 'closure'/);
  assert.match(calendarCode, /\['READY', 'PENDING', 'WARNING'\]\.includes\(closureReadinessStatus\)/);
});

test('consulta cancelada não oferece fechamento, pré-guia ou novo cancelamento', () => {
  assert.match(calendarCode, /const detailCancellationState = resolveAppointmentCancellationState\(detailEvent\)/);
  assert.match(calendarCode, /cancelled\s*\?\s*'cancelled'\s*:\s*explicitPhase/);
  assert.match(calendarCode, /!detailCancellationState\.isCancelled && \[/);
  assert.match(calendarCode, /!detailCancellationState\.isCancelled && \(\s*<button[\s\S]*?onCancelAppointment/);
  assert.match(calendarCode, /!resolveAppointmentCancellationState\(statusActionEvent\)\.isCancelled && \(\s*<button[\s\S]*?handleStatusAction\(statusActionEvent, 'cancel'\)/);
  assert.match(calendarCode, /title: 'Consulta cancelada'/);
});

test('coordinator usa agenda clinica e padrao inicial mensal persistido', () => {
  assert.match(coordinatorCode, /import \{ ClinicalAgendaBoard \} from "\.\/Calendar"/);
  assert.match(coordinatorCode, /<ClinicalAgendaBoard/);
  assert.match(coordinatorCode, /onStartSession=\{\(appointment: any\) =>/);
  assert.match(coordinatorCode, /activeTab === "agenda" \? "py-2\.5"/);
  assert.match(coordinatorCode, /activeTab !== "agenda" && \(/);
  assert.match(agendaPreferenceCode, /CALENDAR_LAST_VIEW_MODE_KEY = "calendar:lastViewMode"/);
  assert.match(agendaPreferenceCode, /const DEFAULT_AGENDA_VIEW: AgendaView = "month"/);
});

test('visao mensal prioriza calendario amplo e eventos rolaveis no proprio dia', () => {
  assert.match(calendarCode, /xl:h-\[calc\(100vh-4\.25rem\)\]/);
  assert.match(coordinatorCode, /activeTab === "agenda" \? "pb-2" : "pb-16"/);
  assert.match(calendarCode, /xl:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.match(calendarCode, /h-full overflow-y-auto p-3 pr-2 custom-scrollbar/);
  assert.match(calendarCode, /grid-rows-6/);
  assert.match(calendarCode, /items\.map\(\(event: any\) =>/);
  assert.match(calendarCode, /space-y-0\.5 overflow-y-auto pr-0\.5 overscroll-contain custom-scrollbar/);
  assert.match(calendarCode, /min-h-\[20px\]/);
  assert.doesNotMatch(calendarCode, /Agenda cl.nica/);
  assert.doesNotMatch(calendarCode, /Agenda operacional/);
  assert.doesNotMatch(calendarCode, /\+\{items\.length/);
  assert.doesNotMatch(calendarCode, /openDayPanel/);
});

test('agenda dia e semana respeitam duracao real em minutos', () => {
  const fifty = calculateCalendarEventVisualLayout(new Date('2026-07-04T09:00:00'), new Date('2026-07-04T09:50:00'));
  const sixty = calculateCalendarEventVisualLayout(new Date('2026-07-04T09:00:00'), new Date('2026-07-04T10:00:00'));
  const thirty = calculateCalendarEventVisualLayout(new Date('2026-07-04T09:30:00'), new Date('2026-07-04T10:00:00'));
  const ninety = calculateCalendarEventVisualLayout(new Date('2026-07-04T09:00:00'), new Date('2026-07-04T10:30:00'));

  assert.ok(fifty.height < sixty.height);
  assert.equal(Math.round(fifty.height * 100) / 100, 46.67);
  assert.equal(sixty.height, 56);
  assert.equal(thirty.height, 28);
  assert.equal(ninety.height, 84);
  assert.equal(thirty.top, 140);
  assert.doesNotMatch(calendarCode, /Math\.max\(48,\s*\(\(endMinutes - startMinutes\)/);
  assert.match(calendarCode, /className="absolute z-10 overflow-hidden px-2"/);
  assert.match(calendarCode, /className=\{`group relative h-full min-h-0 w-full overflow-hidden/);
});

test('datas visiveis da agenda usam dd/mm/aaaa sem alterar input tecnico', () => {
  assert.equal(formatDisplayDate('2026-07-04'), '04/07/2026');
  assert.match(formatDisplayDateTime('2026-07-04T09:00:00'), /^04\/07\/2026 \d{2}:00$/);
  assert.match(calendarCode, /formatDisplayDate\(activeDate\)/);
  assert.match(calendarCode, /formatDisplayDateTime\(requestedStart\)/);
  assert.match(calendarCode, /formatDisplayMonthYear\(activeDate\)/);
  assert.doesNotMatch(calendarCode, /toLocaleString\('pt-BR', \{ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' \}\)/);
});

test('filtro de equipe reutiliza foto de perfil com fallback para iniciais', () => {
  assert.match(coordinatorCode, /profilePicture:/);
  assert.match(calendarCode, /const memberPhotoUrl = String/);
  assert.match(calendarCode, /src=\{memberPhotoUrl\}/);
  assert.match(calendarCode, /data-avatar-fallback="true"/);
  assert.match(calendarCode, /getInitials\(member\.label \|\| member\.name\)/);
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
