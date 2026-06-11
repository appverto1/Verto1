import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveTussBillingItem
} from '../src/services/tussBillingResolutionEngine';
import {
  buildMonthlyConferenceExportRows,
  buildMonthlyConferenceSummary,
  classifyConferencePendingKinds,
  rowsToCsv
} from '../src/services/monthlyConferenceEngine';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const payerPanelCode = readFileSync(join(root, 'src/components/PayerRequirementsPanel.tsx'), 'utf8');
const conferenceCode = readFileSync(join(root, 'src/components/MonthlyConferenceCenter.tsx'), 'utf8');
const closureCode = readFileSync(join(root, 'src/components/OperationalClosureCenter.tsx'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260611183000_tuss_ready_billing_layer.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('migration cria camada TUSS-ready aditiva, versionavel e com RLS', () => {
  for (const table of ['tuss_service_catalog', 'tuss_codes', 'payer_tuss_mappings', 'appointment_billing_items']) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migrationCode, /idx_tuss_service_catalog_org_service_type/);
  assert.match(migrationCode, /idx_payer_tuss_mappings_clinic_payer_service/);
  assert.match(migrationCode, /idx_appointment_billing_items_appointment/);
  assert.match(migrationCode, /status in \('draft', 'ready', 'pending', 'reviewed', 'exported', 'non_billable'\)/);
  assert.match(migrationCode, /NAO implementa XML TISS, remessa, retorno, glosa, recurso/);
  assert.doesNotMatch(migrationCode, /insert into public\.tuss_codes/i);
});

test('engine resolve item pronto e pendencias sem hardcodar codigo TUSS', () => {
  const ready = resolveTussBillingItem({
    appointment: { scheduled_minutes: 60 },
    billingContext: {
      payer_id: 'payer-1',
      authorization_code: 'AUTH-1',
      guide_number: 'G-1',
      insurance_card_number: 'CARD-1'
    },
    patientFinancialPlan: { id: 'plan-1', amount_cents: 10000 },
    payer: { id: 'payer-1' },
    serviceCatalog: { id: 'service-1', name: 'Sessao ABA', internal_code: 'ABA-1', billing_unit: 'session' },
    mapping: {
      id: 'mapping-1',
      guide_type: 'sp_sadt',
      billing_unit: 'hour',
      quantity_rule: 'per_hour',
      default_quantity: 1,
      amount_cents: 12000,
      requires_authorization: true,
      requires_guide: true,
      requires_patient_document: true
    },
    tussCode: { id: 'tuss-1', code: 'CONFIGURADO', description: 'Configurado pela clinica', version: 'manual' }
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.quantity, 1);
  assert.equal(ready.amountCents, 12000);
  assert.equal(ready.tussCode, 'CONFIGURADO');

  const pending = resolveTussBillingItem({
    appointment: { scheduled_minutes: 45 },
    billingContext: {},
    patientFinancialPlan: null,
    serviceCatalog: null,
    mapping: null
  });
  assert.equal(pending.ready, false);
  assert.ok(pending.pendingReasons.includes('missing_payer'));
  assert.ok(pending.pendingReasons.includes('missing_service_catalog'));
  assert.ok(pending.pendingReasons.includes('missing_tuss_mapping'));
});

test('backend tem CRUD TUSS-ready action-driven e resolve ao salvar contexto financeiro', () => {
  for (const route of [
    "app.get('/api/admin/tuss/services'",
    "app.post('/api/admin/tuss/services'",
    "app.patch('/api/admin/tuss/services/:serviceId'",
    "app.get('/api/admin/tuss/codes'",
    "app.post('/api/admin/tuss/codes'",
    "app.patch('/api/admin/tuss/codes/:codeId'",
    "app.get('/api/admin/tuss/mappings'",
    "app.post('/api/admin/tuss/mappings'",
    "app.patch('/api/admin/tuss/mappings/:mappingId'",
    "app.post('/api/appointments/:appointmentId/billing-item/resolve'"
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(serverCode, /resolveAndPersistAppointmentBillingItem/);
  assert.match(serverCode, /const billingItem: any = null|let billingItem: any = null/);
  assert.match(serverCode, /appointment_billing_items/);
  assert.match(serverCode, /onConflict: 'organization_id,appointment_id'/);
  const billingRoute = serverCode.slice(
    serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'"),
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/billing-item/resolve'")
  );
  assert.match(billingRoute, /resolveAndPersistAppointmentBillingItem/);
  assert.doesNotMatch(billingRoute, /\.select\('\*'\)/);
});

test('frontend administra procedimentos codigos e mapeamentos sem F5', () => {
  for (const helper of [
    'getTussServices',
    'createTussService',
    'updateTussService',
    'getTussCodes',
    'createTussCode',
    'updateTussCode',
    'getPayerTussMappings',
    'createPayerTussMapping',
    'updatePayerTussMapping',
    'resolveAppointmentBillingItem'
  ]) {
    assert.match(dataServiceCode, new RegExp(helper));
  }
  assert.match(payerPanelCode, /Procedimentos e TUSS-ready/);
  assert.match(payerPanelCode, /createTussService/);
  assert.match(payerPanelCode, /createTussCode/);
  assert.match(payerPanelCode, /createTussMapping/);
  assert.match(payerPanelCode, /setTussServices/);
  assert.match(payerPanelCode, /setTussCodes/);
  assert.match(payerPanelCode, /upsertTussMappingInState/);
});

test('fechamento e conferencia exibem e filtram dados TUSS-ready', () => {
  for (const code of [conferenceCode, closureCode]) {
    assert.match(code, /internal_procedure_name/);
    assert.match(code, /tuss_code/);
    assert.match(code, /billing_amount_cents/);
    assert.match(code, /Sem procedimento/);
    assert.match(code, /Sem TUSS/);
    assert.match(code, /Sem valor/);
    assert.match(code, /Sem registro/);
    assert.match(code, /Sem carteirinha/);
  }
  assert.match(conferenceCode, /Por procedimento/);
  assert.match(conferenceCode, /Por TUSS/);
  assert.match(conferenceCode, /Por guia/);
  assert.match(serverCode, /filterHydratedRowsByTussMissingKind/);
  assert.match(serverCode, /summary-by-procedure/);
  assert.match(serverCode, /summary-by-tuss-code/);
  assert.match(serverCode, /summary-by-guide-type/);
});

test('CSV de conferencia mensal exporta campos TUSS-ready sem virar XML', () => {
  const rows = buildMonthlyConferenceExportRows([{
    patient_name: 'Pedro',
    professional_name: 'Mateus',
    professional_registry: 'CRP 00/00000',
    service_type: 'ABA',
    payer_name: 'Convenio A',
    financial_plan_name: 'Plano ABA',
    insurance_card_number: '123',
    scheduled_start: '2026-06-10T10:00:00.000Z',
    readiness_status: 'READY',
    internal_procedure_code: 'ABA-IND',
    internal_procedure_name: 'Sessao ABA individual',
    tuss_code: 'CONFIGURADO',
    tuss_description: 'Descricao controlada',
    tuss_version: 'manual-2026',
    guide_type: 'sp_sadt',
    billing_unit: 'session',
    billing_quantity: 1,
    billing_unit_amount_cents: 12000,
    billing_amount_cents: 12000,
    tuss_mapping_status: 'configured',
    tuss_pending_reasons: []
  }]);
  const csv = rowsToCsv(rows, [
    'internalProcedureCode',
    'internalProcedureName',
    'tussCode',
    'tussDescription',
    'tussVersion',
    'guideType',
    'billingUnit',
    'billingQuantity',
    'billingUnitAmount',
    'billingExpectedAmount',
    'tussMappingStatus',
    'tussPendingReasons'
  ]);
  assert.match(csv, /internalProcedureCode,internalProcedureName,tussCode,tussDescription,tussVersion,guideType,billingUnit,billingQuantity,billingUnitAmount,billingExpectedAmount,tussMappingStatus,tussPendingReasons/);
  assert.match(csv, /ABA-IND/);
  assert.match(csv, /CONFIGURADO/);
  assert.match(csv, /Configurado/);
  assert.doesNotMatch(csv, /xml|remessa|retorno|glosa|recurso/i);
});

test('resumo mensal classifica pendencias e agrupa por procedimento TUSS e guia', () => {
  const row: any = {
    patient_name: 'Pedro',
    professional_name: 'Mateus',
    service_type: 'ABA',
    payer_name: 'Convenio A',
    readiness_status: 'PENDING',
    scheduled_minutes: 45,
    actual_minutes: 45,
    tuss_pending_reason_codes: ['missing_tuss_mapping', 'missing_amount', 'missing_card_number']
  };
  const kinds = classifyConferencePendingKinds(row);
  assert.ok(kinds.includes('Procedimento'));
  assert.ok(kinds.includes('TUSS'));
  assert.ok(kinds.includes('Valor'));
  assert.ok(kinds.includes('Carteirinha'));
  const summary = buildMonthlyConferenceSummary([{
    ...row,
    internal_procedure_name: 'Sessao ABA',
    tuss_code: 'CONFIGURADO',
    guide_type: 'sp_sadt'
  }]);
  assert.equal(summary.byProcedure[0].name, 'Sessao ABA');
  assert.equal(summary.byTussCode[0].code, 'CONFIGURADO');
  assert.equal(summary.byGuideType[0].guideType, 'sp_sadt');
});

test('script test:tuss-ready existe e modulo nao promete faturamento eletronico completo', () => {
  assert.match(packageJson, /"test:tuss-ready": "tsx tests\/tussReady\.test\.ts"/);
  const serverTussSlice = serverCode.slice(
    serverCode.indexOf('const normalizeTussActiveFlag'),
    serverCode.indexOf("app.get('/api/appointments/:appointmentId/billing-context'")
  );
  for (const code of [serverTussSlice, dataServiceCode, payerPanelCode, conferenceCode, closureCode]) {
    assert.doesNotMatch(code, /XML TISS|lote TISS|remessa|retorno|glosa|recurso|faturamento eletrônico completo/i);
  }
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

console.log(`${passed}/${tests.length} tuss-ready tests passed`);
