import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const serverCode = read('server.ts');
const displayLabelsCode = read('src/utils/displayLabels.ts');
const closureMigration = read('supabase/migrations/20260528153000_operational_closure.sql');
const signatureMigration = read('supabase/migrations/20260529110000_appointment_confirmation_signature.sql');
const payerMigration = read('supabase/migrations/20260529123000_payer_requirements_prefacturing.sql');
const conferenceMigration = read('supabase/migrations/20260529143000_monthly_conference_exports.sql');
const closureCode = read('src/components/OperationalClosureCenter.tsx');
const conferenceCode = read('src/components/MonthlyConferenceCenter.tsx');
const payerCode = read('src/components/PayerRequirementsPanel.tsx');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const calendarCode = read('src/components/Calendar.tsx');
const monthlyEngineCode = read('src/services/monthlyConferenceEngine.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSignature(marker: string, chars = 320) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

test('endpoints sensiveis exigem autenticacao e roles adequadas', () => {
  const roleRoutes = [
    ["app.get('/api/admin/payers'", /checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.post('/api/admin/payers'", /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.post('/api/admin/payers/:payerId/requirements'", /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.patch('/api/appointments/:appointmentId/billing-context'", /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.get('/api/closure/appointments'", /checkAuth, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/],
    ["app.patch('/api/closure/appointments/:appointmentId/override'", /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.get('/api/conference/monthly'", /checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/],
    ["app.post('/api/conference/monthly/export'", /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/]
  ] as const;

  for (const [marker, pattern] of roleRoutes) {
    assert.match(routeSignature(marker), pattern, `${marker} com assinatura insegura.`);
  }

  for (const marker of [
    "app.post('/api/portal/appointments/:appointmentId/confirm'",
    "app.post('/api/portal/appointments/:appointmentId/request-reschedule'",
    "app.post('/api/portal/appointments/:appointmentId/request-cancel'",
    "app.post('/api/portal/sessions/:sessionId/sign'"
  ]) {
    assert.match(routeSignature(marker), /portalActionLimiter, checkAuth/);
  }
});

test('rate limit cobre revalidacao, assinatura, exportacao e endpoints administrativos', () => {
  for (const marker of [
    "app.post('/api/portal/appointments/:appointmentId/confirm'",
    "app.post('/api/portal/appointments/:appointmentId/request-reschedule'",
    "app.post('/api/portal/appointments/:appointmentId/request-cancel'",
    "app.post('/api/portal/sessions/:sessionId/sign'",
    "app.post('/api/appointments/action-requests/:requestId/approve'",
    "app.post('/api/appointments/action-requests/:requestId/reject'",
    "app.post('/api/admin/payers'",
    "app.patch('/api/admin/payers/:payerId'",
    "app.post('/api/admin/payers/:payerId/requirements'",
    "app.patch('/api/admin/payer-requirements/:requirementId'",
    "app.patch('/api/appointments/:appointmentId/billing-context'",
    "app.post('/api/appointments/:appointmentId/required-documents/:documentId/waive'",
    "app.post('/api/closure/appointments/:appointmentId/revalidate'",
    "app.patch('/api/closure/appointments/:appointmentId/override'",
    "app.post('/api/conference/monthly/session/:appointmentId/revalidate'",
    "app.post('/api/conference/monthly/export'"
  ]) {
    assert.match(routeSignature(marker), /portalActionLimiter/, `${marker} deve usar rate limit.`);
  }
});

test('multi-tenant e IDOR usam escopo de clinica, ownership e filtro por organizacao', () => {
  assert.match(serverCode, /canPortalUserAccessPatient/);
  assert.match(serverCode, /fetchPortalAppointmentForUser/);
  assert.match(serverCode, /fetchAppointmentForBillingContext/);
  assert.match(serverCode, /applyClosureTenantScope/);
  assert.match(serverCode, /assertConferenceFilterOwnership/);
  assert.match(serverCode, /\.eq\('organization_id', organizationId\)/);
  assert.match(serverCode, /\.eq\('organization_id', clinicId\)/);
  assert.match(serverCode, /\.eq\('clinic_id', clinicId\)/);
});

test('RLS explicita existe para tabelas novas do piloto', () => {
  const rlsExpectations = [
    [closureMigration, 'appointment_closure_checks'],
    [closureMigration, 'appointment_closure_audit_logs'],
    [closureMigration, 'clinic_closure_requirements'],
    [signatureMigration, 'appointment_action_requests'],
    [signatureMigration, 'session_signatures'],
    [signatureMigration, 'appointment_status_audit_logs'],
    [payerMigration, 'clinic_payers'],
    [payerMigration, 'clinic_payer_requirements'],
    [payerMigration, 'appointment_billing_contexts'],
    [payerMigration, 'appointment_required_documents'],
    [payerMigration, 'payer_requirement_audit_logs'],
    [conferenceMigration, 'operational_closure_exports']
  ] as const;

  for (const [migration, table] of rlsExpectations) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} sem RLS.`);
    assert.match(migration, new RegExp(`create policy [\\s\\S]*${table}`, 'i'), `${table} sem policy.`);
  }
});

test('areas novas nao reintroduzem select star nem consultas ABA brutas em massa', () => {
  const pilotSlice = serverCode.slice(
    serverCode.indexOf('const PORTAL_SESSION_CONSENT_TEXT_VERSION'),
    serverCode.indexOf('const fetchFutureAppointmentsForMaintenance')
  );
  assert.doesNotMatch(pilotSlice, /\.select\('\*'\)/);
  assert.match(pilotSlice, /PORTAL_APPOINTMENT_SELECT/);
  assert.match(pilotSlice, /APPOINTMENT_CLOSURE_LIST_SELECT/);
  assert.match(pilotSlice, /CLINIC_PAYER_SELECT/);
  assert.match(pilotSlice, /CLINIC_PAYER_REQUIREMENT_SELECT/);
  assert.doesNotMatch(pilotSlice, /aba_recent_session_events|aba_trials|aba_behavior_events/);
});

test('validacao server-side cobre UUIDs, datas, status, paginacao, payload e filtros', () => {
  for (const helper of [
    'isUuid',
    'sanitizeIsoDateTime',
    'parseClosureStatusFilter',
    'parseBoundedListLimit',
    'parseClosurePageParams',
    'parseConferenceFilters',
    'enforcePayloadLimit',
    'sanitizeTextField',
    'sanitizeClinicalPayload'
  ]) {
    assert.match(serverCode, new RegExp(helper));
  }
});

test('erros retornados ao front sao humanos e nao vazam infraestrutura', () => {
  for (const helper of ['portalSafeError', 'closureSafeError', 'payerSafeError', 'conferenceSafeError']) {
    const start = serverCode.indexOf(`const ${helper}`);
    assert.ok(start >= 0, `${helper} nao encontrado.`);
    const end = serverCode.indexOf('\n\n', start);
    const slice = serverCode.slice(start, end > start ? end : start + 500);
    assert.doesNotMatch(slice, /Supabase|PostgREST|Railway|schema cache|SQL/i);
  }
});

test('front comum esconde IDs tecnicos e termos de infraestrutura', () => {
  for (const field of [
    'appointment_id',
    'appointmentId',
    'payer_id',
    'payerId',
    'organization_id',
    'organizationId',
    'clinic_id',
    'clinicId',
    'session_id',
    'sessionId'
  ]) {
    assert.match(displayLabelsCode, new RegExp(`'${field}'`), `${field} deve estar na denylist visual.`);
  }

  const front = [closureCode, conferenceCode, payerCode, patientDashboardCode, calendarCode].join('\n');
  assert.doesNotMatch(front, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(front, /Supabase|PostgREST|Railway|schema cache/);
});

test('exportacao de conferencia usa whitelist operacional sem IDs tecnicos', () => {
  assert.match(monthlyEngineCode, /MONTHLY_CONFERENCE_EXPORT_FIELDS/);
  const fieldsBlock = monthlyEngineCode.match(/MONTHLY_CONFERENCE_EXPORT_FIELDS = \[[\s\S]*?\]/)?.[0] || '';
  assert.match(fieldsBlock, /scheduledDate/);
  assert.match(fieldsBlock, /patientName/);
  assert.match(fieldsBlock, /professionalName/);
  assert.match(fieldsBlock, /payerName/);
  assert.doesNotMatch(fieldsBlock, /patient_id|appointment_id|professional_id|organization_id|clinic_id|patientId|appointmentId|professionalId|organizationId|clinicId/);
});

test('logs e auditoria de piloto evitam payload clinico bruto', () => {
  assert.match(serverCode, /metadata: sanitizeClinicalPayload/);
  assert.match(serverCode, /hashOperationalValue/);
  assert.match(serverCode, /signature_hash/);
  assert.match(serverCode, /ip_hash/);
  assert.match(serverCode, /user_agent_hash/);
  assert.doesNotMatch(serverCode, /console\.(log|warn|error)\([^\n)]*(\bcookie\b|\btoken\b|signature_data_url)/i);
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

console.log(`${passed}/${tests.length} pilot security checks passed`);
