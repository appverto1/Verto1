import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const routeSchemaCode = read('src/utils/routeSchemaFallbacks.ts');
const packageJson = read('package.json');
const calendarCode = read('src/components/Calendar.tsx');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function serverSlice(marker: string, chars = 2600) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

function between(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return source.slice(start, end);
}

test('scripts especificos do portal do paciente existem', () => {
  assert.match(packageJson, /"test:patient-portal": "tsx tests\/patientPortal\.test\.ts"/);
  assert.match(packageJson, /"test:patient-dashboard": "tsx tests\/patientDashboard\.test\.ts"/);
});

test('hamburger do portal contem os itens solicitados sem destacar tarefas no Kids', () => {
  for (const marker of [
    "{ id: 'home', label: 'Início'",
    "{ id: 'appointments', label: isKidsProfile ? 'Calendário' : 'Consultas'",
    "{ id: 'anamnesis', label: 'Anamnese'",
    "{ id: 'notes', label: 'Anotações'",
    "{ id: 'documents', label: 'Documentos'",
    "{ id: 'reports', label: 'Relatório'"
  ]) {
    assert.ok(patientDashboardCode.includes(marker), `${marker} deve estar no menu do portal.`);
  }
  assert.match(patientDashboardCode, /\.\.\.\(!isKidsProfile \? \[\{ id: 'tasks', label: 'Tarefas'/);
  assert.match(patientDashboardCode, /const portalMenu = isKidsProfile \? null : \(/);
});

test('cada item novo abre painel proprio e Inicio preserva a home', () => {
  assert.match(patientDashboardCode, /portalSection === 'home' && portalHomeSummary/);
  assert.match(patientDashboardCode, /portalSection === 'home' && \(\s*<React\.Fragment>/);
  assert.match(patientDashboardCode, /portalSection === 'appointments' && portalAppointmentsPanel/);
  assert.match(patientDashboardCode, /portalSection === 'anamnesis' && portalAnamnesisPanel/);
  assert.match(patientDashboardCode, /portalSection === 'notes' && portalNotesPanel/);
  assert.match(patientDashboardCode, /portalSection === 'documents' && portalDocumentsPanel/);
  assert.match(patientDashboardCode, /portalSection === 'reports' && portalReportPanel/);
});

test('home Kids remove agenda da tela inicial e mantem anamnese acessivel', () => {
  const homeSummary = between(patientDashboardCode, 'const portalAnamnesisTopNotice =', 'const renderPortalAnamnesisField');
  assert.match(patientDashboardCode, /const shouldLoadHomeNotice = portalSection === 'home' && \(isKidsProfile \|\| hasPendingPortalAnamnesisHint\)/);
  assert.match(homeSummary, /portalAnamnesisNeedsAction/);
  assert.match(homeSummary, /hasPendingPortalAnamnesisHint/);
  assert.match(homeSummary, /setPortalSection\('anamnesis'\)/);
  assert.match(homeSummary, /Preencher/);
  assert.doesNotMatch(homeSummary, /portalKidsAppointmentsSummary/);
  assert.doesNotMatch(homeSummary, /Pr.ximas consultas/);
  assert.doesNotMatch(homeSummary, /setPortalSection\('appointments'\)/);
});

test('anotacoes e documentos sao filtrados para familia sem expor conteudo interno', () => {
  assert.match(patientDashboardCode, /const isPortalSharedNote = \(note: any\) =>/);
  assert.match(patientDashboardCode, /hasPortalPrivateFlag\(note\)/);
  assert.match(patientDashboardCode, /sharedWithPatient/);
  assert.match(patientDashboardCode, /visibleToPatient/);
  assert.match(patientDashboardCode, /const isPortalReleasedDocument = \(document: any\) =>/);
  assert.match(patientDashboardCode, /releasedToPatient/);
  assert.match(patientDashboardCode, /portalReleasedDocuments/);
  assert.match(patientDashboardCode, /portalSection !== 'documents'/);
  assert.match(patientDashboardCode, /dataService\.getPatientFiles\(portalPatientId\)/);
  assert.match(serverCode, /source === 'family_portal_document'/);
  assert.match(serverCode, /visibleToPatient/);
  assert.doesNotMatch(patientDashboardCode, /dangerouslySetInnerHTML/);
});

test('calendario carrega somente pelo menu Kids e relatorio continua sob demanda', () => {
  assert.match(patientDashboardCode, /const shouldLoadPortalAppointments =\s*portalSection === 'appointments' \|\|\s*portalSection === 'reports';/);
  assert.doesNotMatch(patientDashboardCode, /\(portalSection === 'home' && isKidsProfile\)/);
  assert.match(patientDashboardCode, /portalAppointmentsLoaded/);
  assert.match(patientDashboardCode, /getPortalCalendarMonthRange\(portalCalendarMonth\)/);
  assert.match(patientDashboardCode, /const portalDefaultAppointmentsRange = useMemo\(\(\) => getPortalDefaultAppointmentsRange\(\), \[portalPatientId\]\)/);
  assert.match(patientDashboardCode, /: portalDefaultAppointmentsRange/);
  assert.doesNotMatch(patientDashboardCode, /: getPortalDefaultAppointmentsRange\(\)/);
  assert.match(patientDashboardCode, /portalAppointmentsRangeKey/);
  assert.match(patientDashboardCode, /portalCalendarCells/);
  assert.match(patientDashboardCode, /Mini calend.rio/);
  assert.match(patientDashboardCode, /handlePortalCalendarDayClick/);
  assert.match(patientDashboardCode, /openPortalAppointmentDetail\(cell\.appointments\[0\]\)/);
  assert.match(patientDashboardCode, /selectedPortalCalendarAppointments/);
  assert.match(patientDashboardCode, /Pr.ximos agendamentos do paciente/);
  assert.match(patientDashboardCode, /portalReportPanel/);
  assert.match(patientDashboardCode, /actualDurationMinutes/);
  assert.match(patientDashboardCode, /formatPortalDuration/);
  assert.doesNotMatch(patientDashboardCode, /billingContext|payerName|payerId|conv.nio|valor/i);
});

test('endpoint do calendario do portal segue escopo e select explicito', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  const route = serverSlice("app.get('/api/portal/appointments'", 12200);
  assert.match(route, /checkAuth/);
  assert.match(route, /getPortalPatientIdsForUser/);
  assert.match(route, /canPortalUserAccessPatient/);
  assert.match(serverCode, /queryPortalAppointmentsWithSchemaFallback/);
  assert.match(route, /\.select\(selectColumns\)/);
  assert.match(serverCode, /optional column unavailable/);
  assert.match(route, /buildPortalAppointmentRangeQuery\('scheduled_at'\)/);
  assert.match(route, /buildPortalAppointmentRangeQuery\('scheduled_start_at'\)/);
  assert.match(route, /patientEmails/);
  assert.match(route, /\.in\('patient_email', emailList\)/);
  assert.match(route, /\.in\('clinic_id', clinicList\)/);
  assert.match(route, /buildPortalAppointmentClinicRangeQuery/);
  assert.match(route, /rowsById\.size < limit/);
  assert.match(serverCode, /readPortalAppointmentPatientScope/);
  assert.match(route, /if \(visibleRows\.length >= limit\) break/);
  assert.match(route, /portal_notifications/);
  assert.match(route, /notificationAppointmentIds/);
  assert.match(route, /notificationScopedAppointmentIds/);
  assert.match(route, /const rowsById = new Map<string, any>\(\)/);
  assert.match(route, /notificationScopedAppointmentIds\.has\(rowId\)/);
  assert.match(route, /authorizedPatientIdSet\.has\(rowPatientId\)/);
  assert.match(route, /buildCalendarAppointmentStart\(a\)\.getTime\(\) - buildCalendarAppointmentStart\(b\)\.getTime\(\)/);
  assert.match(route, /visibleRows\.map\(\(row\) => \{/);
  assert.match(route, /serializePortalAppointmentForFamilyView\(row, \{\}, \{/);
  assert.match(route, /patient:\s*portalPatientContextsById\.get\(patientId\)/);
  assert.match(route, /clinicBranding:\s*clinicBrandingById\.get\(clinicId\)/);
  assert.doesNotMatch(route, /patient_name/);
});

test('portal resolve paciente Kids tambem pelo responsavel vinculado', () => {
  const resolver = serverSlice('const getPortalPatientIdsForUser = async', 2200);
  assert.match(resolver, /responsible_user_id/);
  assert.match(resolver, /responsible_email/);
  assert.match(resolver, /appendLinkedPatientIds/);
  assert.match(resolver, /\.eq\('is_active', true\)/);
  assert.match(resolver, /\.is\('deleted_at', null\)/);
  const contextRoute = serverSlice("app.get('/api/portal/context'", 900);
  assert.match(serverCode, /const resolvePatientPortalContext = async/);
  assert.match(contextRoute, /resolvePatientPortalContext/);
  assert.match(dataServiceCode, /async getPortalContext\(\)/);
  assert.match(appCode, /const portalContextResult = await dataService\.getPortalContext\(\)/);
  assert.match(appCode, /if \(!resolvedContextPatientId\)/);
  assert.match(dataServiceCode, /skipped patient-scoped fetch: missing resolvedPatientId/);
  assert.doesNotMatch(appCode, /candidateId \|\| user\?\.id \|\| ''/);
});

test('diario e tarefas do portal nao consultam colunas ausentes em producao', () => {
  const noteSelectColumns = between(routeSchemaCode, 'export const NOTE_SELECT_COLUMNS = [', '];');
  const taskSelectColumns = between(routeSchemaCode, 'export const TASK_SELECT_COLUMNS = [', '];');
  const taskLegacySelectColumns = between(routeSchemaCode, 'export const TASK_LEGACY_SELECT_COLUMNS = [', '];');
  assert.doesNotMatch(noteSelectColumns, /'note'/);
  assert.doesNotMatch(noteSelectColumns, /'created_by'/);
  assert.doesNotMatch(noteSelectColumns, /'updated_at'/);
  assert.doesNotMatch(noteSelectColumns, /'visibility'/);
  assert.doesNotMatch(taskSelectColumns, /'icon'/);
  assert.doesNotMatch(taskSelectColumns, /'type'/);
  assert.doesNotMatch(taskLegacySelectColumns, /'type'/);
  assert.doesNotMatch(routeSchemaCode, /\.in\('visibility'/);
  const notesEmailRoute = serverSlice("app.get('/api/notes/email/:email'", 2200);
  assert.match(notesEmailRoute, /fetchNotesWithRoleFilter/);
  assert.doesNotMatch(notesEmailRoute, /\.from\('notes'\)[\s\S]{0,120}\.select\(NOTE_SELECT\)/);
  assert.match(notesEmailRoute, /\/api\/notes\/email\/:email \[GET\]/);
  assert.doesNotMatch(notesEmailRoute, /\/api\/patient-records\/:patientId \[POST\]/);
  const selfHistoryRoute = serverSlice("app.get('/api/patient/self/history'", 6200);
  assert.match(selfHistoryRoute, /fetchHistoryWithSchemaFallback/);
  assert.doesNotMatch(selfHistoryRoute, /\.from\('history'\)[\s\S]{0,160}\.select\(HISTORY_SELECT\)/);
  assert.match(selfHistoryRoute, /success: true, data: \[\], reason: 'missing_resolved_patient'/);
});

test('notificacoes do portal sao deduplicadas e normalizadas por consulta pendente', () => {
  const notificationsRoute = between(
    serverCode,
    "app.get('/api/portal/notifications'",
    "app.patch('/api/portal/notifications/:notificationId'"
  );
  assert.match(notificationsRoute, /\.is\('acknowledged_at', null\)/);
  assert.match(notificationsRoute, /title: branding\.displayName/);
  assert.match(notificationsRoute, /formatPortalReminderMessage/);
  assert.match(notificationsRoute, /normalizePortalNotificationType\(row\?\.type\) === 'appointment_reminder'/);
  assert.match(notificationsRoute, /readClinicPatientReschedulePolicies/);
  assert.match(notificationsRoute, /canRequestReschedule/);
  assert.match(notificationsRoute, /confirmar, cancelar ou solicitar reagendamento/);
  assert.match(notificationsRoute, /confirmar ou cancelar a sessão/);
  assert.match(notificationsRoute, /dedupedRowsByAppointment/);
  assert.match(notificationsRoute, /type === 'appointment_reschedule_approved' && patientId && eventScheduledAt/);
  assert.match(notificationsRoute, /latestPendingAppointmentReminder/);
  assert.match(serverCode, /const isPatientAppointmentNotificationActionable/);
  assert.match(serverCode, /normalizePortalNotificationType/);
  assert.match(notificationsRoute, /isPatientAppointmentNotificationActionable/);
  assert.match(serverCode, /const notificationAppointmentStart = sanitizeIsoDateTime/);
  assert.match(serverCode, /const currentAppointmentStart = sanitizeIsoDateTime/);
  assert.match(notificationsRoute, /queryPortalAppointmentsWithSchemaFallback/);
  assert.match(serverCode, /patient_confirmation_status/);
  assert.match(serverCode, /RESCHEDULE_REQUESTED/);
  assert.match(serverCode, /CANCEL_REQUESTED/);
  assert.match(serverCode, /Date\.now\(\)/);
  assert.match(notificationsRoute, /data: visibleRows/);
  assert.match(notificationsRoute, /appointment_id/);
  assert.match(patientDashboardCode, /dedupePortalNotifications/);
  assert.match(patientDashboardCode, /getPortalNotificationEventKey/);
  assert.match(patientDashboardCode, /type === 'appointment_reschedule_approved' && patientId && scheduledKey/);
  assert.match(patientDashboardCode, /openPortalNotification/);
  assert.match(patientDashboardCode, /getPortalNotificationMessage/);
  assert.match(patientDashboardCode, /notificationType !== 'appointment_reminder'/);
  assert.match(patientDashboardCode, /!acknowledged && notification\?\.read_at/);
  assert.match(serverCode, /buildPortalAppointmentHistory/);
  assert.doesNotMatch(patientDashboardCode, /<Bell size=\{15\}/);
});

test('notificacao de remarcacao lida pode ser reconhecida e baixa duplicatas equivalentes', () => {
  const notificationPatch = between(
    serverCode,
    "app.patch('/api/portal/notifications/:notificationId'",
    'const serializePortalAppointment ='
  );
  assert.match(notificationPatch, /normalizePortalNotificationType\(existing\?\.type\) === 'appointment_reschedule_approved'/);
  assert.match(notificationPatch, /targetNotificationIds = Array\.from\(new Set/);
  assert.match(notificationPatch, /metadata\.scheduledAt \|\| metadata\.scheduled_at \|\| row\?\.scheduled_for/);
  assert.match(notificationPatch, /\.in\('id', targetNotificationIds\)/);
  assert.match(notificationPatch, /acknowledgedIds: acknowledge \? targetNotificationIds : \[\]/);
  assert.match(notificationPatch, /patientIds\.includes/);
  assert.match(notificationPatch, /belongsToRecipient/);
});

test('remarcacao do portal usa slots disponiveis em vez de seletor livre', () => {
  const modal = between(patientDashboardCode, 'const portalActionModal =', 'const closeMoodModal');
  assert.match(dataServiceCode, /async getPortalAppointmentRescheduleSlots/);
  assert.match(dataServiceCode, /\/reschedule-slots/);
  const availabilityClient = between(dataServiceCode, 'async getPortalAppointmentRescheduleSlots', 'async requestPortalAppointmentCancel');
  assert.match(availabilityClient, /cache: 'no-store'/);
  assert.match(serverCode, /app\.get\('\/api\/portal\/appointments\/:appointmentId\/reschedule-slots'/);
  assert.match(serverCode, /app\.get\('\/api\/portal\/appointments\/:appointmentId\/reschedule-slots', portalActionLimiter, noStoreDynamicResponse, checkAuth/);
  assert.match(serverCode, /buildPortalRescheduleAvailabilityForAppointment/);
  assert.match(serverCode, /resolveValidPortalRescheduleOptions/);
  assert.match(patientDashboardCode, /maxDays: 5/);
  assert.match(patientDashboardCode, /rangeLabel/);
  assert.match(patientDashboardCode, /Ver pr.xima semana/);
  assert.match(modal, /Escolha at. 3 op..es de hor.rio/);
  assert.match(modal, /portalRescheduleAvailability\.days\.map/);
  assert.match(modal, /portalSelectedRescheduleSlots\.length\}\//);
  assert.match(patientDashboardCode, /rescheduleOptions: selectedRescheduleOptions/);
  assert.match(patientDashboardCode, /portalModal === 'reschedule' && portalSelectedRescheduleSlots\.length === 0/);
  assert.match(patientDashboardCode, /availableSlotIds\.has/);
  assert.match(patientDashboardCode, /portalRescheduleAvailabilityLastRequestedAtRef/);
  assert.match(patientDashboardCode, /window\.addEventListener\('verto:appointment-domain-event', refreshAvailableSlotsAfterDomainEvent/);
  assert.doesNotMatch(modal, /datetime-local/);
});

test('disponibilidade usa appointments persistidos antes do snapshot legado', () => {
  const canonicalPrecedence = serverCode.match(/\[\.\.\.stateAppointments, \.\.\.tableAppointments\]/g) || [];
  assert.ok(canonicalPrecedence.length >= 3, 'Agenda, aprovaÃ§Ã£o e portal devem priorizar a tabela canÃ´nica.');
  assert.match(serverCode, /stateResult\.data\.rooms\.forEach\(\(room: any\) => addRoom\(room, false\)\)/);
  assert.match(serverCode, /app\.get\('\/api\/appointments\/action-requests\/:requestId\/availability', noStoreDynamicResponse, checkAuth/);
  const staffAvailabilityClient = between(dataServiceCode, 'async getAppointmentActionRequestAvailability', 'async rejectAppointmentActionRequest');
  assert.match(staffAvailabilityClient, /cache: 'no-store'/);
  assert.match(calendarCode, /window\.addEventListener\('verto:appointment-domain-event', refreshAvailabilityAfterDomainEvent/);
  const portalAppointmentsClient = between(dataServiceCode, 'async getPortalAppointments', 'async getPortalContext');
  assert.match(portalAppointmentsClient, /cache: 'no-store'/);
  assert.match(serverCode, /app\.get\('\/api\/portal\/appointments', noStoreDynamicResponse, checkAuth/);
  assert.match(patientDashboardCode, /window\.addEventListener\('verto:appointment-domain-event', refreshAppointmentsAfterDomainEvent/);
});

test('horarios de trabalho do profissional alimentam remarcacao sem listar mes inteiro', () => {
  assert.match(serverCode, /app\.get\('\/api\/clinic\/members\/:memberId\/work-schedule'/);
  assert.match(serverCode, /app\.patch\('\/api\/clinic\/members\/:memberId\/work-schedule'/);
  assert.match(serverCode, /assertClinicMemberForWorkSchedule/);
  assert.match(serverCode, /readProfessionalWorkingScheduleFromMetadata/);
  assert.match(serverCode, /PORTAL_RESCHEDULE_WEEK_WINDOW_DAYS = 5/);
  assert.match(serverCode, /buildPortalRescheduleDateWindow/);
  assert.match(serverCode, /workingSchedule/);
  assert.doesNotMatch(patientDashboardCode, /maxDays: 14/);
});

test('equipe aprova opcao escolhida sem expor agenda privada', () => {
  const staffBlock = between(calendarCode, "actionRequests.filter((request: any) => request.status === 'PENDING')", 'signatures.length > 0');
  assert.match(calendarCode, /parseRescheduleRequestPayload/);
  assert.match(staffBlock, /rescheduleOptions\.slice\(0, 3\)/);
  assert.match(staffBlock, /openRescheduleApprovalReview/);
  assert.match(calendarCode, /selectedOptionIndex: draft\.optionIndex/);
  assert.match(calendarCode, /assignmentId: assignment\.id/);
  assert.match(staffBlock, /Revisar e aprovar/);
  assert.match(calendarCode, /Aprovar remarca..o/);
  assert.match(staffBlock, /configura..es compat.veis dispon.veis/);
  const availabilityRoute = serverSlice("app.get('/api/portal/appointments/:appointmentId/reschedule-slots'", 1600);
  assert.doesNotMatch(availabilityRoute, /patient_name|title|notes|observation/i);
  const approvalRoute = serverSlice("app.post('/api/appointments/action-requests/:requestId/approve'", 22000);
  assert.match(approvalRoute, /selectedOptionIndex/);
  assert.match(approvalRoute, /buildRescheduleApprovalPreview/);
  assert.match(approvalRoute, /appointmentScheduleMatches/);
  assert.match(approvalRoute, /idempotent: requestRow\.request_type === 'RESCHEDULE' \? atomicPayload\?\.idempotent === true/);
  assert.match(approvalRoute, /\.eq\('status', 'PENDING'\)/);
  assert.doesNotMatch(approvalRoute, /req\.body\?\.scheduledStart/);
  assert.match(serverCode, /notifyPortalRescheduleApproval/);
  assert.match(serverCode, /acknowledgeStaleAppointmentReminderNotifications\(nextAppointment\)/);
  assert.match(serverCode, /appointment_reschedule_approved/);
  assert.match(serverCode, /sendAppointmentNotification/);
});

test('serializacao do portal nao envia dados financeiros ou identificadores tecnicos como campos visiveis', () => {
  const serializer = serverSlice('const serializePortalAppointment = (row: any', 5200);
  assert.match(serializer, /scheduledDurationMinutes/);
  assert.match(serializer, /actualDurationMinutes/);
  assert.match(serializer, /professionalName/);
  assert.match(serializer, /locationLabel/);
  assert.doesNotMatch(serializer, /payer|billing|guide_number|authorization_code|required_documents/i);
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

console.log(`${passed}/${tests.length} patient portal checks passed`);
