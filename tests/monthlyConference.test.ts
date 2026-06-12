import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMonthlyConferenceExportRows,
  buildMonthlyConferenceSummary,
  rowsToCsv
} from '../src/services/monthlyConferenceEngine';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const conferenceCode = readFileSync(join(root, 'src/components/MonthlyConferenceCenter.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260529143000_monthly_conference_exports.sql'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

const rows = [
  {
    appointment_id: 'appt-ready',
    patient_id: 'patient-1',
    patient_name: 'Pedro',
    professional_id: 'pro-1',
    professional_name: 'Mateus',
    service_type: 'ABA',
    payer_name: 'Unimed',
    scheduled_start: '2026-05-04T08:00:00.000Z',
    scheduled_minutes: 45,
    actual_minutes: 45,
    readiness_status: 'READY',
    main_issues: []
  },
  {
    appointment_id: 'appt-pending',
    patient_id: 'patient-1',
    patient_name: 'Pedro',
    professional_id: 'pro-2',
    professional_name: 'Laura',
    service_type: 'Fonoaudiologia',
    payer_name: 'Unimed',
    scheduled_start: '2026-05-05T09:00:00.000Z',
    scheduled_minutes: 60,
    actual_minutes: 50,
    readiness_status: 'PENDING',
    guide_number: null,
    authorization_code: null,
    required_document_pending_count: 1,
    main_issues: [
      'Assinatura pendente para fechamento da sessão.',
      'Relatório da sessão ainda não foi preenchido.',
      'Guia obrigatória pendente.'
    ]
  },
  {
    appointment_id: 'appt-warning',
    patient_id: 'patient-2',
    patient_name: 'Ana',
    professional_id: 'pro-1',
    professional_name: 'Mateus',
    service_type: 'Terapia Ocupacional',
    payer_name: 'Particular',
    scheduled_start: '2026-05-06T10:00:00.000Z',
    scheduled_minutes: 60,
    actual_minutes: 35,
    readiness_status: 'WARNING',
    main_issues: ['Duração real divergente do planejado.']
  },
  {
    appointment_id: 'appt-cancelled',
    patient_id: 'patient-3',
    patient_name: 'Bia',
    professional_id: 'pro-3',
    professional_name: 'Rafa',
    service_type: 'Psicologia',
    payer_name: 'Bradesco',
    scheduled_start: '2026-05-07T10:00:00.000Z',
    scheduled_minutes: 50,
    actual_minutes: 50,
    readiness_status: 'NOT_BILLABLE',
    main_issues: ['Sessão cancelada.']
  }
];

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('KPIs contam prontas, pendentes, alertas, nao faturaveis e tempo', () => {
  const summary = buildMonthlyConferenceSummary(rows);
  assert.equal(summary.kpis.totalSessions, 4);
  assert.equal(summary.kpis.ready, 1);
  assert.equal(summary.kpis.pending, 1);
  assert.equal(summary.kpis.warning, 1);
  assert.equal(summary.kpis.notBillable, 1);
  assert.equal(summary.kpis.actualMinutes, 130);
  assert.equal(summary.kpis.scheduledMinutes, 215);
  assert.equal(summary.kpis.pendingSignatures, 1);
  assert.equal(summary.kpis.pendingReports, 1);
  assert.equal(summary.kpis.pendingGuides, 1);
  assert.equal(summary.kpis.pendingDocuments, 1);
});

test('resumos agrupam paciente, profissional, pagador e especialidade', () => {
  const summary = buildMonthlyConferenceSummary(rows);
  const pedro = summary.byPatient.find((item) => item.name === 'Pedro');
  assert.equal(pedro.totalSessions, 2);
  assert.equal(pedro.actualMinutes, 95);
  const mateus = summary.byProfessional.find((item) => item.name === 'Mateus');
  assert.equal(mateus.totalSessions, 2);
  assert.equal(mateus.workedDaysCount, 2);
  const unimed = summary.byPayer.find((item) => item.payerName === 'Unimed');
  assert.equal(unimed.totalSessions, 2);
  assert.equal(unimed.pending, 1);
  const aba = summary.byServiceType.find((item) => item.serviceType === 'ABA');
  assert.equal(aba.actualMinutes, 45);
});

test('exportacao usa whitelist operacional e CSV sem dados clinicos brutos', () => {
  const exportRows = buildMonthlyConferenceExportRows(rows);
  const csv = rowsToCsv(exportRows, ['scheduledDate', 'patientName', 'professionalName', 'serviceType', 'actualMinutes', 'pendingKinds', 'rawAbaEvents']);
  assert.match(csv, /scheduledDate,patientName,professionalName,serviceType,actualMinutes,pendingKinds/);
  assert.doesNotMatch(csv, /rawAbaEvents/);
  assert.doesNotMatch(csv, /Sessão cancelada/);
});

test('API da conferencia tem auth, roles, paginacao, filtros e select explicito', () => {
  assert.match(serverCode, /app\.get\('\/api\/conference\/monthly', checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /app\.get\('\/api\/conference\/monthly\/summary-by-patient'/);
  assert.match(serverCode, /app\.get\('\/api\/conference\/monthly\/session\/:appointmentId'/);
  assert.match(serverCode, /app\.post\('\/api\/conference\/monthly\/export', portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /\.select\(APPOINTMENT_CLOSURE_LIST_SELECT\)/);
  assert.match(serverCode, /\.range\(params\.filters\.from, params\.filters\.to\)/);
  assert.match(serverCode, /assertConferenceFilterOwnership/);
  const conferenceSlice = serverCode.slice(serverCode.indexOf("app.get('/api/conference/monthly'"), serverCode.indexOf('const fetchFutureAppointmentsForMaintenance'));
  assert.doesNotMatch(conferenceSlice, /\.select\('\*'\)/);
  assert.doesNotMatch(conferenceSlice, /aba_recent_session_events|aba_trials|aba_behavior_events/);
});

test('conferencia revalida periodo antes de listar em tela e antes de exportar CSV', () => {
  assert.match(dataServiceCode, /async revalidateClosurePeriod/);
  assert.match(conferenceCode, /const revalidation = await dataService\.revalidateClosurePeriod/);
  assert.match(conferenceCode, /const \[main, byPatient, byProfessional, byPayer, byService, byProcedure, byTuss, byGuide\] = await Promise\.all/);
  const exportSlice = serverCode.slice(serverCode.indexOf("app.post('/api/conference/monthly/export'"), serverCode.indexOf('let hydratedRows = filterHydratedRowsByTussMissingKind'));
  assert.match(exportSlice, /revalidateClosureChecksForPeriod/);
  assert.match(exportSlice, /source: 'monthly_conference_export'/);
});

test('exportacao gera trilha auditavel e tabela com RLS', () => {
  assert.match(migrationCode, /create table if not exists public\.operational_closure_exports/);
  assert.match(migrationCode, /alter table public\.operational_closure_exports enable row level security/);
  assert.match(migrationCode, /create policy operational_closure_exports_admin_rw/);
  assert.match(migrationCode, /EXPORT_GENERATED/);
  assert.match(serverCode, /writeConferenceExportAudit/);
  assert.match(serverCode, /\.from\('operational_closure_exports'\)[\s\S]*?\.insert/);
});

test('frontend tem tela mensal, filtros, detalhe, exportacao e nao expõe infraestrutura', () => {
  for (const label of ['Conferência mensal', 'Por paciente', 'Por profissional', 'Por pagador', 'Por especialidade', 'Exportar CSV', 'Conferência da sessão']) {
    assert.match(conferenceCode, new RegExp(label));
  }
  assert.match(coordinatorCode, /<MonthlyConferenceCenter/);
  assert.doesNotMatch(conferenceCode, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(conferenceCode, /Supabase|PostgREST|Railway|schema cache/i);
  assert.doesNotMatch(conferenceCode, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('dataService expõe helpers econômicos da conferência', () => {
  assert.match(dataServiceCode, /async getMonthlyConference/);
  assert.match(dataServiceCode, /\/api\/conference\/monthly/);
  assert.match(dataServiceCode, /async getMonthlyConferenceSummary/);
  assert.match(dataServiceCode, /async exportMonthlyConference/);
  assert.match(dataServiceCode, /helperName: 'getMonthlyConference'/);
  assert.match(dataServiceCode, /hasExplicitColumns: true/);
});

test('package inclui script da conferencia mensal', () => {
  assert.match(packageJson, /"test:monthly-conference": "tsx tests\/monthlyConference\.test\.ts"/);
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

console.log(`${passed}/${tests.length} monthly conference tests passed`);
