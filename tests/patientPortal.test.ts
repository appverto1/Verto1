import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const serverCode = read('server.ts');
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

test('home mostra aviso de anamnese apenas enquanto ficha esta pendente e nao mostra card de calendario', () => {
  const homeSummary = between(patientDashboardCode, 'const portalAnamnesisTopNotice =', 'const renderPortalAnamnesisField');
  assert.match(homeSummary, /portalAnamnesisNeedsAction/);
  assert.match(homeSummary, /hasPendingPortalAnamnesisHint/);
  assert.match(homeSummary, /setPortalSection\('anamnesis'\)/);
  assert.match(homeSummary, /Preencher/);
  assert.doesNotMatch(homeSummary, /setPortalSection\('appointments'\)/);
  assert.doesNotMatch(homeSummary, /Pr.xima consulta|Abrir agenda/);
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

test('calendario e relatorio carregam sob demanda e nao na home Kids', () => {
  assert.match(patientDashboardCode, /\['appointments', 'reports'\]\.includes\(portalSection\)/);
  assert.match(patientDashboardCode, /portalAppointmentsLoaded/);
  assert.match(patientDashboardCode, /getPortalCalendarMonthRange\(portalCalendarMonth\)/);
  assert.match(patientDashboardCode, /portalAppointmentsRangeKey/);
  assert.match(patientDashboardCode, /portalCalendarCells/);
  assert.match(patientDashboardCode, /Agenda mensal da cl.nica/);
  assert.match(patientDashboardCode, /Pr.ximos agendamentos do paciente/);
  assert.match(patientDashboardCode, /portalReportPanel/);
  assert.match(patientDashboardCode, /actualDurationMinutes/);
  assert.match(patientDashboardCode, /formatPortalDuration/);
  assert.doesNotMatch(patientDashboardCode, /billingContext|payerName|payerId|conv.nio|valor/i);
});

test('endpoint do calendario do portal segue escopo e select explicito', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  const route = serverSlice("app.get('/api/portal/appointments'", 4400);
  assert.match(route, /checkAuth/);
  assert.match(route, /getPortalPatientIdsForUser/);
  assert.match(route, /canPortalUserAccessPatient/);
  assert.match(route, /\.select\(PORTAL_APPOINTMENT_SELECT\)/);
  assert.match(route, /buildPortalAppointmentRangeQuery\('scheduled_at'\)/);
  assert.match(route, /buildPortalAppointmentRangeQuery\('scheduled_start_at'\)/);
  assert.match(route, /const rowsById = new Map<string, any>\(\)/);
  assert.match(route, /buildCalendarAppointmentStart\(a\)\.getTime\(\) - buildCalendarAppointmentStart\(b\)\.getTime\(\)/);
  assert.match(route, /visibleRows\.map\(\(row\) => serializePortalAppointment\(row\)\)/);
});

test('serializacao do portal nao envia dados financeiros ou identificadores tecnicos como campos visiveis', () => {
  const serializer = serverSlice('const serializePortalAppointment = (row: any', 2600);
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
