import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMonthlyConferenceExportRows,
  rowsToCsv
} from '../src/services/monthlyConferenceEngine';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const conferenceCode = readFileSync(join(root, 'src/components/MonthlyConferenceCenter.tsx'), 'utf8');
const closureCode = readFileSync(join(root, 'src/components/OperationalClosureCenter.tsx'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');
const statusMigration = readFileSync(join(root, 'supabase/migrations/20260611110000_appointment_conference_statuses.sql'), 'utf8');
const payerMigration = readFileSync(join(root, 'supabase/migrations/20260529123000_payer_requirements_prefacturing.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('migration cria status individual de conferencia com RLS e sem TISS/XML', () => {
  assert.match(statusMigration, /create table if not exists public\.appointment_conference_statuses/);
  assert.match(statusMigration, /appointment_id uuid not null references public\.appointments/);
  assert.match(statusMigration, /export_id uuid references public\.operational_closure_exports/);
  assert.match(statusMigration, /status in \('pending_review', 'reviewed', 'exported', 'reopened', 'non_billable'\)/);
  assert.match(statusMigration, /idx_appointment_conference_statuses_competence_status/);
  assert.match(statusMigration, /alter table public\.appointment_conference_statuses enable row level security/);
  assert.match(statusMigration, /u\.role in \('owner', 'admin', 'coordinator'\)/);
  assert.doesNotMatch(statusMigration, /lote tiss|xml tiss|remessa|retorno|glosa|recurso/i);
  assert.match(payerMigration, /does not implement TISS\/TUSS, XML exports or external billing integrations/);
});

test('backend tem acoes idempotentes de conferido, reaberto e exportado', () => {
  assert.match(serverCode, /APPOINTMENT_CONFERENCE_STATUS_SELECT/);
  assert.match(serverCode, /upsertAppointmentConferenceStatuses/);
  assert.match(serverCode, /onConflict: 'organization_id,appointment_id,competence_month'/);
  assert.match(serverCode, /app\.patch\('\/api\/conference\/monthly\/session\/:appointmentId\/status', portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /Apenas itens exportados podem ser reabertos/);
  assert.match(serverCode, /status === 'reopened' && reason\.length < 8/);
  assert.match(serverCode, /CONFERENCE_STATUS_REVIEWED/);
  assert.match(serverCode, /CONFERENCE_STATUS_EXPORTED/);
  assert.match(serverCode, /CONFERENCE_STATUS_REOPENED/);
});

test('revalidacao de periodo materializa checks faltantes sem sobrescrever override manual', () => {
  assert.match(serverCode, /app\.post\('\/api\/closure\/revalidate-period', portalActionLimiter, checkAuth, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/);
  assert.match(serverCode, /revalidateClosureChecksForPeriod/);
  assert.match(serverCode, /mirrorLegacyClosureAppointmentsForPeriod/);
  assert.match(serverCode, /syncAppointmentsTableFromClinicState/);
  assert.match(serverCode, /\.upsert\(\[storagePayload\], \{ onConflict: 'organization_id,appointment_id' \}\)/);
  assert.match(serverCode, /\.in\('action', \['MANUAL_OVERRIDE', 'MARKED_NOT_BILLABLE'\]\)/);
  assert.match(serverCode, /manualOverrideIds\.has\(appointmentId\)/);
  assert.match(serverCode, /PERIOD_REVALIDATED/);
  const revalidationSlice = serverCode.slice(serverCode.indexOf('const revalidateClosureChecksForPeriod'), serverCode.indexOf('const fetchClosureSummariesByAppointment'));
  assert.doesNotMatch(revalidationSlice, /\.select\('\*'\)/);
});

test('exportacao completa registra auditoria, marca itens e retorna ActionResult', () => {
  assert.match(serverCode, /normalizeConferenceExportType/);
  assert.match(serverCode, /billing_conference_full/);
  assert.match(serverCode, /writeConferenceExportAudit\(/);
  assert.match(serverCode, /status: 'exported'/);
  assert.match(serverCode, /exportId: sanitizeString\(auditRecord\.id/);
  assert.match(serverCode, /affectedItems/);
  assert.match(serverCode, /conferencia-convenios-\$\{monthLabel\}-\$\{clinicExportSlug/);
  const exportSlice = serverCode.slice(serverCode.indexOf("app.post('/api/conference/monthly/export'"), serverCode.indexOf('const normalizeMaintenanceAppointmentStatusKey'));
  assert.doesNotMatch(exportSlice, /\.select\('\*'\)/);
  assert.doesNotMatch(exportSlice, /XML TISS|lote TISS|remessa|glosa|recurso/i);
});

test('CSV de conferencia mensal inclui campos financeiros e auditoria sem virar TISS', () => {
  const exportRows = buildMonthlyConferenceExportRows([{
    appointment_id: 'appt-1',
    clinic_name: 'Clínica Verto',
    unit_name: '',
    patient_name: 'Pedro',
    professional_name: 'Mateus',
    professional_registry: 'CRP 00/00000',
    service_type: 'ABA',
    payer_name: 'Unimed',
    financial_plan_name: 'Plano ABA',
    insurance_card_number: '123456',
    guide_number: 'G-1',
    authorization_code: 'A-1',
    copayment_amount_cents: 1500,
    expected_amount_cents: 12000,
    financial_status: 'ACTIVE',
    scheduled_start: '2026-05-04T08:00:00.000Z',
    scheduled_end: '2026-05-04T08:45:00.000Z',
    scheduled_minutes: 45,
    actual_minutes: 45,
    readiness_status: 'READY',
    conference_status_label: 'Exportado',
    export_status: 'Exportado',
    export_id: 'export-1',
    exported_at: '2026-05-31T12:00:00.000Z',
    exported_by_name: 'Financeiro',
    required_document_pending_count: 0,
    main_issues: [],
    notes: 'Conferido pelo financeiro'
  }]);
  const csv = rowsToCsv(exportRows, [
    'competenceMonth',
    'clinicName',
    'patientName',
    'professionalRegistry',
    'financialPlanName',
    'insuranceCardNumber',
    'guideNumber',
    'authorizationCode',
    'copaymentAmount',
    'expectedAmount',
    'conferenceStatus',
    'exportStatus',
    'exportedAt',
    'exportedBy',
    'exportId'
  ]);
  assert.match(csv, /competenceMonth,clinicName,patientName,professionalRegistry,financialPlanName,insuranceCardNumber,guideNumber,authorizationCode,copaymentAmount,expectedAmount,conferenceStatus,exportStatus,exportedAt,exportedBy,exportId/);
  assert.match(csv, /Clínica Verto/);
  assert.match(csv, /Plano ABA/);
  assert.match(csv, /123456/);
  assert.match(csv, /G-1/);
  assert.match(csv, /A-1/);
  assert.match(csv, /export-1/);
  assert.doesNotMatch(csv, /xml|tiss|remessa|glosa/i);
});

test('frontend atualiza conferencia sem F5 e nao promete faturamento eletronico', () => {
  assert.match(dataServiceCode, /async revalidateClosurePeriod/);
  assert.match(dataServiceCode, /\/api\/closure\/revalidate-period/);
  assert.match(closureCode, /dataService\.revalidateClosurePeriod/);
  assert.match(conferenceCode, /dataService\.revalidateClosurePeriod/);
  assert.match(dataServiceCode, /updateMonthlyConferenceSessionStatus/);
  assert.match(dataServiceCode, /\/api\/conference\/monthly\/session\/\$\{encodeURIComponent\(String\(appointmentId\)\)\}\/status/);
  assert.match(conferenceCode, /markReviewed/);
  assert.match(conferenceCode, /submitReopen/);
  assert.match(conferenceCode, /applyUpdatedConferenceRows/);
  assert.match(conferenceCode, /billing_conference_full/);
  assert.match(conferenceCode, /Conferência completa para financeiro/);
  assert.match(conferenceCode, /Exportar CSV/);
  assert.match(closureCode, /Fechamento operacional/);
  assert.match(closureCode, /Pronta para conferência/);
  assert.doesNotMatch(conferenceCode, /XML TISS|lote TISS|remessa|glosa|recurso|faturamento eletrônico/i);
});

test('script de pre-faturamento existe', () => {
  assert.match(packageJson, /"test:prefacturing-conference": "tsx tests\/prefacturingConference\.test\.ts"/);
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

console.log(`${passed}/${tests.length} prefacturing conference tests passed`);
