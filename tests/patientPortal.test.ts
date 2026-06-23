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
  assert.match(route, /buildCalendarAppointmentStart\(a\)\.getTime\(\) - buildCalendarAppointmentStart\(b\)\.getTime\(\)/);
  assert.match(route, /visibleRows\.map\(\(row\) => serializePortalAppointmentForFamilyView\(row\)\)/);
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
  assert.match(notificationsRoute, /Toque para confirmar, remarcar ou cancelar/);
  assert.match(notificationsRoute, /dedupedRowsByAppointment/);
  assert.match(notificationsRoute, /latestPendingAppointmentReminder/);
  assert.match(notificationsRoute, /data: visibleRows/);
  assert.match(notificationsRoute, /appointment_id/);
  assert.match(patientDashboardCode, /dedupePortalNotifications/);
  assert.match(patientDashboardCode, /openPortalNotification/);
  assert.match(patientDashboardCode, /getPortalNotificationMessage/);
  assert.doesNotMatch(patientDashboardCode, /<Bell size=\{15\}/);
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
