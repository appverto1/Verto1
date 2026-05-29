import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const packageJson = read('package.json');
const readinessDoc = read('docs/SIMPLISAUDE_PILOT_READINESS.md');
const seedScript = read('scripts/seed-simplisaude-demo.mjs');
const serverCode = read('server.ts');
const dataServiceCode = read('src/services/dataService.ts');
const calendarCode = read('src/components/Calendar.tsx');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const closureCode = read('src/components/OperationalClosureCenter.tsx');
const conferenceCode = read('src/components/MonthlyConferenceCenter.tsx');
const payerCode = read('src/components/PayerRequirementsPanel.tsx');
const sessionModeCode = read('src/components/SessionMode.tsx');
const monthlyEngineCode = read('src/services/monthlyConferenceEngine.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('documenta roteiro, dados minimos, roles, fora de escopo e checklist pre-reuniao', () => {
  for (const expected of [
    'Fluxo demonstravel',
    'Dados minimos',
    'Contas e roles',
    'Fora de escopo neste marco',
    'Checklist rapido antes da reuniao',
    'Smoke manual complementar',
    'TISS/TUSS',
    'XML',
    'painel dedicado',
    'Exportacao CSV'
  ]) {
    assert.match(readinessDoc, new RegExp(expected, 'i'));
  }
});

test('seed demo e manual, ficticio, removivel e bloqueado por dupla confirmacao', () => {
  assert.match(seedScript, /ALLOW_DEMO_SEED/);
  assert.match(seedScript, /--confirm-demo-seed/);
  assert.match(seedScript, /--cleanup/);
  assert.match(seedScript, /DEMO:SIMPLISAUDE/);
  assert.match(seedScript, /Clinica Demo Verto/);
  assert.match(seedScript, /Pedro Almeida/);
  assert.match(seedScript, /Mariana Almeida/);
  assert.match(seedScript, /Ana Ribeiro/);
  assert.match(seedScript, /\.test/);
  assert.doesNotMatch(seedScript, /@gmail\.com|@hotmail\.com|@outlook\.com/i);
  assert.doesNotMatch(seedScript, /cpf:\s*['"][0-9]{11}/i);
});

test('scripts npm do marco piloto estao registrados', () => {
  assert.match(packageJson, /"test:simplisaude-pilot-smoke": "tsx tests\/simplisaudePilotSmoke\.test\.ts"/);
  assert.match(packageJson, /"test:pilot-security": "tsx tests\/pilotSecurity\.test\.ts"/);
});

test('rotas do fluxo agenda-portal-sessao-fechamento-conferencia existem', () => {
  for (const marker of [
    "app.get('/api/calendar/events'",
    "app.get('/api/calendar/events/:eventId/detail'",
    "app.post('/api/portal/appointments/:appointmentId/confirm'",
    "app.post('/api/portal/appointments/:appointmentId/request-reschedule'",
    "app.post('/api/portal/appointments/:appointmentId/request-cancel'",
    "app.post('/api/portal/sessions/:sessionId/sign'",
    "app.post('/api/aba/sessions'",
    "app.patch('/api/aba/sessions/:sessionId'",
    "app.post('/api/aba/session-summaries'",
    "app.get('/api/closure/appointments'",
    "app.post('/api/closure/appointments/:appointmentId/revalidate'",
    "app.get('/api/conference/monthly'",
    "app.post('/api/conference/monthly/export'"
  ]) {
    assert.ok(serverCode.includes(marker), `${marker} deve existir.`);
  }
});

test('pagadores, documentos e regras aparecem no fluxo operacional', () => {
  for (const marker of [
    "app.get('/api/admin/payers'",
    "app.post('/api/admin/payers'",
    "app.get('/api/admin/payers/:payerId/requirements'",
    "app.post('/api/admin/payers/:payerId/requirements'",
    "app.patch('/api/admin/payer-requirements/:requirementId'",
    "app.patch('/api/appointments/:appointmentId/billing-context'",
    "app.post('/api/appointments/:appointmentId/required-documents/:documentId/waive'"
  ]) {
    assert.ok(serverCode.includes(marker), `${marker} deve existir.`);
  }
  assert.match(payerCode, /Regras por pagador|Pagador|documentos|assinatura/i);
});

test('acoes sensiveis geram trilha auditavel', () => {
  assert.match(serverCode, /writeAppointmentStatusAuditLog/);
  assert.match(serverCode, /CONFIRMED_BY_RESPONSIBLE/);
  assert.match(serverCode, /RESCHEDULE_REQUESTED/);
  assert.match(serverCode, /CANCEL_REQUESTED/);
  assert.match(serverCode, /SIGNATURE_CREATED/);
  assert.match(serverCode, /writePayerRequirementAuditLog/);
  assert.match(serverCode, /DOCUMENT_WAIVED/);
  assert.match(serverCode, /writeClosureAuditLog/);
  assert.match(serverCode, /REVALIDATED_FROM_CONFERENCE/);
  assert.match(serverCode, /writeConferenceExportAudit/);
  assert.match(serverCode, /EXPORT_GENERATED/);
});

test('conferencia usa read model persistido, paginacao e exportacao whitelist', () => {
  const conferenceSlice = serverCode.slice(
    serverCode.indexOf("app.get('/api/conference/monthly'"),
    serverCode.indexOf('const fetchFutureAppointmentsForMaintenance')
  );
  assert.match(conferenceSlice, /\.from\('appointment_closure_checks'\)/);
  assert.match(serverCode, /\.range\(params\.filters\.from, params\.filters\.to\)/);
  assert.match(conferenceSlice, /hardLimit: 2000/);
  assert.doesNotMatch(conferenceSlice, /aba_recent_session_events|aba_trials|aba_behavior_events/);
  assert.match(monthlyEngineCode, /MONTHLY_CONFERENCE_EXPORT_FIELDS/);
  const fieldsBlock = monthlyEngineCode.match(/MONTHLY_CONFERENCE_EXPORT_FIELDS = \[[\s\S]*?\]/)?.[0] || '';
  assert.doesNotMatch(fieldsBlock, /patient_id|appointment_id|professional_id|organization_id|clinic_id/);
});

test('front tem superficies da demo sem html inseguro nem termos de infraestrutura', () => {
  const front = [
    calendarCode,
    patientDashboardCode,
    closureCode,
    conferenceCode,
    payerCode,
    sessionModeCode
  ].join('\n');
  for (const label of ['Agenda', 'Assinar sess', 'Fechamento operacional', 'Confer.ncia mensal', 'Exportar CSV']) {
    assert.match(front, new RegExp(label, 'i'));
  }
  assert.doesNotMatch(front, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(front, /Supabase|PostgREST|Railway|schema cache/);
});

test('dataService expoe helpers economicos para as telas do roteiro', () => {
  for (const helper of [
    'getCalendarEvents',
    'getPortalAppointments',
    'confirmPortalAppointment',
    'requestPortalAppointmentReschedule',
    'requestPortalAppointmentCancel',
    'signPortalSession',
    'getClosureAppointments',
    'getMonthlyConference',
    'exportMonthlyConference',
    'getPayers',
    'getPayerRequirements'
  ]) {
    assert.match(dataServiceCode, new RegExp(`async ${helper}\\b`));
  }
  assert.match(dataServiceCode, /hasExplicitColumns: true/);
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

console.log(`${passed}/${tests.length} Simpli Saude pilot smoke checks passed`);
