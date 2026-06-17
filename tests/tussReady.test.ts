import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveTussBillingItem
} from '../src/services/tussBillingResolutionEngine';
import {
  buildMonthlyConferenceExportRows,
  buildMonthlyConferenceSummary,
  classifyConferencePendingDetails,
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

test('cenario controlado ABA Amil resolve procedimento TUSS e valor sem afetar pendencias nao relacionadas', () => {
  const appointment = {
    id: 'appointment-amil-aba',
    scheduled_minutes: 50,
    service_type: 'ABA',
    approach: 'ABA'
  };
  const billingContext = {
    id: 'billing-context-amil',
    payer_id: 'amil-payer',
    service_type: 'ABA',
    insurance_card_number: 'AMIL-123',
    guide_number: 'GUIA-AMIL',
    authorization_code: 'AUTH-AMIL'
  };
  const patientFinancialPlan = {
    id: 'plan-amil',
    payer_id: 'amil-payer',
    name: 'Plano Amil teste',
    insurance_card_number: 'AMIL-123'
  };
  const payer = { id: 'amil-payer', name: 'Amil' };

  const before = resolveTussBillingItem({
    appointment,
    billingContext,
    patientFinancialPlan,
    payer,
    serviceCatalog: null,
    mapping: null,
    tussCode: null
  });
  assert.equal(before.ready, false);
  assert.ok(before.pendingReasons.includes('missing_service_catalog'));
  assert.ok(before.pendingReasons.includes('missing_tuss_mapping'));
  assert.ok(before.pendingReasons.includes('missing_amount'));

  const beforeKinds = classifyConferencePendingKinds({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    service_type: 'ABA',
    payer_name: 'Amil',
    financial_plan_name: 'Plano Amil teste',
    insurance_card_number: 'AMIL-123',
    readiness_status: 'PENDING',
    internal_procedure_name: before.internalProcedureName,
    tuss_code: before.tussCode,
    billing_amount_cents: before.amountCents,
    tuss_pending_reason_codes: before.pendingReasons
  } as any);
  assert.ok(beforeKinds.includes('Procedimento'));
  assert.ok(beforeKinds.includes('TUSS'));
  assert.ok(beforeKinds.includes('Valor'));

  const serviceCatalog = {
    id: 'service-aba-individual',
    name: 'Sessao ABA individual',
    internal_code: 'ABA-IND',
    service_type: 'ABA',
    billing_unit: 'session',
    default_quantity: 1,
    default_duration_minutes: 50
  };
  const tussCode = {
    id: 'tuss-demo-aba',
    code: 'TESTE-ABA',
    description: 'Codigo TUSS de teste controlado',
    version: 'demo-2026'
  };
  const mapping = {
    id: 'mapping-amil-aba',
    payer_id: 'amil-payer',
    service_catalog_id: 'service-aba-individual',
    tuss_code_id: 'tuss-demo-aba',
    guide_type: 'sp_sadt',
    billing_unit: 'session',
    quantity_rule: 'per_session',
    default_quantity: 1,
    amount_cents: 12000,
    requires_authorization: false,
    requires_guide: false,
    requires_signature: false,
    requires_report: false,
    requires_professional_registry: false,
    requires_patient_document: true
  };

  const after = resolveTussBillingItem({
    appointment,
    billingContext,
    patientFinancialPlan,
    payer,
    serviceCatalog,
    mapping,
    tussCode
  });
  assert.equal(after.ready, true);
  assert.equal(after.internalProcedureName, 'Sessao ABA individual');
  assert.equal(after.tussCode, 'TESTE-ABA');
  assert.equal(after.tussDescription, 'Codigo TUSS de teste controlado');
  assert.equal(after.billingUnit, 'session');
  assert.equal(after.quantity, 1);
  assert.equal(after.amountCents, 12000);
  assert.ok(!after.pendingReasons.includes('missing_service_catalog'));
  assert.ok(!after.pendingReasons.includes('missing_tuss_mapping'));
  assert.ok(!after.pendingReasons.includes('missing_amount'));

  const afterKinds = classifyConferencePendingKinds({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    service_type: 'ABA',
    payer_id: 'amil-payer',
    payer_name: 'Amil',
    financial_plan_name: 'Plano Amil teste',
    insurance_card_number: 'AMIL-123',
    readiness_status: 'READY',
    internal_procedure_name: after.internalProcedureName,
    tuss_code: after.tussCode,
    billing_amount_cents: after.amountCents,
    tuss_pending_reason_codes: after.pendingReasons
  } as any);
  assert.ok(!afterKinds.includes('Procedimento'));
  assert.ok(!afterKinds.includes('TUSS'));
  assert.ok(!afterKinds.includes('Valor'));

  const staleReasonDetails = classifyConferencePendingDetails({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    professional_registry: null,
    service_type: 'ABA',
    payer_id: 'amil-payer',
    payer_name: 'Amil',
    financial_plan_name: 'Plano Amil teste',
    insurance_card_number: 'AMIL-123',
    guide_number: 'GUIA-AMIL',
    authorization_code: 'AUTH-AMIL',
    readiness_status: 'DRAFT',
    internal_procedure_name: after.internalProcedureName,
    tuss_code: after.tussCode,
    billing_amount_cents: after.amountCents,
    required_document_pending_count: 0,
    main_issues: [],
    tuss_pending_reason_codes: ['missing_service_catalog', 'missing_tuss_mapping', 'missing_amount', 'missing_card_number', 'missing_professional_registry']
  } as any);
  assert.ok(!staleReasonDetails.configuration.includes('Procedimento'));
  assert.ok(!staleReasonDetails.configuration.includes('TUSS'));
  assert.ok(!staleReasonDetails.configuration.includes('Valor'));
  assert.ok(!staleReasonDetails.configuration.includes('Carteirinha'));
  assert.ok(staleReasonDetails.configuration.includes('Registro profissional'));
  assert.ok(staleReasonDetails.notApplicable.includes('Aguardando realizacao'));

  const withoutPayer = resolveTussBillingItem({
    appointment,
    billingContext: { service_type: 'ABA' },
    patientFinancialPlan: null,
    serviceCatalog,
    mapping,
    tussCode
  });
  assert.ok(withoutPayer.pendingReasons.includes('missing_payer'));
  assert.ok(withoutPayer.pendingReasons.includes('missing_financial_plan'));
  const withoutPayerKinds = classifyConferencePendingKinds({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    service_type: 'ABA',
    payer_name: '',
    financial_plan_name: '',
    readiness_status: 'PENDING',
    internal_procedure_name: after.internalProcedureName,
    tuss_code: after.tussCode,
    billing_amount_cents: after.amountCents,
    tuss_pending_reason_codes: withoutPayer.pendingReasons
  } as any);
  assert.ok(withoutPayerKinds.includes('Pagador'));
  assert.ok(withoutPayerKinds.includes('Plano financeiro'));
  assert.ok(!withoutPayerKinds.includes('Procedimento'));
  assert.ok(!withoutPayerKinds.includes('TUSS'));

  const nonBillableDetails = classifyConferencePendingDetails({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    service_type: '',
    payer_name: '',
    financial_plan_name: '',
    readiness_status: 'NOT_BILLABLE',
    issues: ['Tipo de sessao ou especialidade nao informado'],
    tuss_pending_reason_codes: before.pendingReasons
  } as any);
  assert.deepEqual(nonBillableDetails.blocking, []);
  assert.ok(nonBillableDetails.informational.includes('Nao aplicavel ao faturamento'));

  const registryNotRequired = resolveTussBillingItem({
    appointment,
    billingContext,
    patientFinancialPlan,
    payer,
    serviceCatalog,
    mapping: { ...mapping, requires_professional_registry: false },
    tussCode,
    professional: {}
  });
  assert.ok(!registryNotRequired.pendingReasons.includes('missing_professional_registry'));

  const registryRequired = resolveTussBillingItem({
    appointment,
    billingContext,
    patientFinancialPlan,
    payer,
    serviceCatalog,
    mapping: { ...mapping, requires_professional_registry: true },
    tussCode,
    professional: {}
  });
  assert.ok(registryRequired.pendingReasons.includes('missing_professional_registry'));

  const registryConfigured = resolveTussBillingItem({
    appointment,
    billingContext,
    patientFinancialPlan,
    payer,
    serviceCatalog,
    mapping: { ...mapping, requires_professional_registry: true },
    tussCode,
    professional: { professional_registry: 'CRP 00/00000' }
  });
  assert.ok(!registryConfigured.pendingReasons.includes('missing_professional_registry'));

  const registryVisualOnlyKinds = classifyConferencePendingKinds({
    patient_name: 'Pedro Henrique',
    professional_name: 'Mateus',
    professional_registry: '',
    service_type: 'ABA',
    payer_name: 'Amil',
    financial_plan_name: 'Plano Amil teste',
    insurance_card_number: 'AMIL-123',
    readiness_status: 'READY',
    internal_procedure_name: after.internalProcedureName,
    tuss_code: after.tussCode,
    billing_amount_cents: after.amountCents,
    tuss_pending_reason_codes: []
  } as any);
  assert.ok(registryVisualOnlyKinds.includes('Registro profissional'));
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
    "app.post('/api/admin/tuss/mappings/:mappingId/revalidate'",
    "app.post('/api/appointments/:appointmentId/billing-item/resolve'"
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(serverCode, /resolveAndPersistAppointmentBillingItem/);
  assert.match(serverCode, /const billingItem: any = null|let billingItem: any = null/);
  assert.match(serverCode, /appointment_billing_items/);
  assert.match(serverCode, /onConflict: 'organization_id,appointment_id'/);
  assert.match(serverCode, /affectedItems: billingItems/);
  assert.match(serverCode, /updatedCount: counts\.resolved/);
  assert.match(serverCode, /'payer_id'[\s\S]*?'payer_name_snapshot'[\s\S]*?'insurance_card_number'/);
  const revalidateRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/admin/tuss/mappings/:mappingId/revalidate'"),
    serverCode.indexOf("app.get('/api/appointments/:appointmentId/billing-context'")
  );
  assert.match(revalidateRoute, /effectiveBillingContextForAppointment/);
  assert.match(revalidateRoute, /context\?\.payer_id \|\| appointment\?\.payer_id/);
  assert.match(revalidateRoute, /mappingIsValidForDate\(mapping, appointmentScheduledStart\(appointment\)\)/);
  assert.match(revalidateRoute, /diagnostics: counts\.found === 0 \? buildRevalidationDiagnostics\(\) : undefined/);
  assert.match(revalidateRoute, /appointmentsWithSamePayer/);
  assert.match(revalidateRoute, /sampleExcludedAppointments/);
  assert.doesNotMatch(revalidateRoute, /if \(!billingContext\?\.id\)/);
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
    'revalidatePayerTussMapping',
    'resolveAppointmentBillingItem'
  ]) {
    assert.match(dataServiceCode, new RegExp(helper));
  }
  assert.match(payerPanelCode, /Procedimentos e TUSS/);
  assert.match(payerPanelCode, /createTussService/);
  assert.match(payerPanelCode, /createTussCode/);
  assert.match(payerPanelCode, /createTussMapping/);
  assert.match(payerPanelCode, /editTussService/);
  assert.match(payerPanelCode, /disableTussService/);
  assert.match(payerPanelCode, /editTussCode/);
  assert.match(payerPanelCode, /disableTussCode/);
  assert.match(payerPanelCode, /editTussMapping/);
  assert.match(payerPanelCode, /revalidateAffectedTussMapping/);
  assert.match(payerPanelCode, /Revalidar atendimentos afetados/);
  assert.match(payerPanelCode, /defaultDurationMinutes/);
  assert.match(payerPanelCode, /validFrom/);
  assert.match(payerPanelCode, /requiresReport/);
  assert.match(payerPanelCode, /setTussServices/);
  assert.match(payerPanelCode, /setTussCodes/);
  assert.match(payerPanelCode, /upsertTussMappingInState/);
  assert.match(payerPanelCode, /result\.affectedItems/);
  assert.match(payerPanelCode, /result\.updatedCount/);
  assert.match(payerPanelCode, /buildClinicMonthDateRange/);
  assert.match(payerPanelCode, /Código TUSS cadastrado\./);
  assert.doesNotMatch(payerPanelCode, /CÃ|NÃ|perÃ|cÃ/);
});

test('criacao e revalidacao pontual usam o resolvedor TUSS-ready central', () => {
  const helperSlice = serverCode.slice(
    serverCode.indexOf('const revalidateAppointmentBillingForAppointment'),
    serverCode.indexOf("app.get('/api/admin/payers'")
  );
  assert.match(helperSlice, /upsertInitialBillingContextFromAppointment/);
  assert.match(helperSlice, /resolveAndPersistAppointmentBillingItem/);
  assert.match(helperSlice, /clearAppointmentBillingItemForAppointment/);
  assert.match(helperSlice, /persistAppointmentClosureCheck/);
  assert.match(helperSlice, /hydrateConferenceRows/);
  assert.match(helperSlice, /skippedInsuranceBilling/);
  assert.match(helperSlice, /payerId: isUuid\(payerId\) \? payerId : null/);

  const appointmentActionSlice = serverCode.slice(
    serverCode.indexOf('const persistAppointmentActionBatch'),
    serverCode.indexOf('const affected = {', serverCode.indexOf('const persistAppointmentActionBatch'))
  );
  assert.match(appointmentActionSlice, /revalidateAppointmentBillingForAppointment/);
  assert.match(appointmentActionSlice, /overwriteExplicitContext: true/);
  assert.match(appointmentActionSlice, /forceClosure: true/);
  assert.match(appointmentActionSlice, /pendingClosureIds/);

  const billingItemRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/billing-item/resolve'"),
    serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents")
  );
  assert.match(billingItemRoute, /revalidateAppointmentBillingForAppointment/);
  assert.doesNotMatch(billingItemRoute, /resolveAndPersistAppointmentBillingItem\(\{/);

  const closureRevalidateRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/closure/appointments/:appointmentId/revalidate'"),
    serverCode.indexOf("app.patch('/api/closure/appointments/:appointmentId/override'")
  );
  assert.match(closureRevalidateRoute, /revalidateAppointmentBillingForAppointment/);
  assert.match(closureRevalidateRoute, /billingItem/);
  assert.match(closureRevalidateRoute, /billingContext/);
  assert.match(closureRevalidateRoute, /resolution/);
  assert.doesNotMatch(closureRevalidateRoute, /persistAppointmentClosureCheck\(\{/);

  const conferenceRevalidateRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/conference/monthly/session/:appointmentId/revalidate'"),
    serverCode.indexOf("app.patch('/api/conference/monthly/session/:appointmentId/status'")
  );
  assert.match(conferenceRevalidateRoute, /revalidateAppointmentBillingForAppointment/);
  assert.match(conferenceRevalidateRoute, /REVALIDATED_FROM_CONFERENCE/);
  assert.match(conferenceRevalidateRoute, /billingItem/);
  assert.match(conferenceRevalidateRoute, /billingContext/);
  assert.match(conferenceRevalidateRoute, /resolution/);
  assert.doesNotMatch(conferenceRevalidateRoute, /persistAppointmentClosureCheck\(\{/);

  assert.match(dataServiceCode, /appointment_billing_contexts,appointment_billing_items,appointment_closure_checks/);
  assert.match(conferenceCode, /applyUpdatedConferenceRows\(\[result\.data\]\)/);
  assert.doesNotMatch(conferenceCode, /await loadConference\(\);\s*const refreshed = await dataService\.getMonthlyConferenceSession/);
  assert.match(closureCode, /applyUpdatedClosureRows\(\[result\.data\]\)/);
  assert.doesNotMatch(closureCode, /await loadRows\(\);\s*if \(detail\?\.appointment_id === appointmentId\) await openDetail/);
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

test('script test:tuss-ready existe e modulo nao promete envio ou faturamento eletronico completo', () => {
  assert.match(packageJson, /"test:tuss-ready": "tsx tests\/tussReady\.test\.ts"/);
  const serverTussSlice = serverCode.slice(
    serverCode.indexOf('const normalizeTussActiveFlag'),
    serverCode.indexOf("app.get('/api/appointments/:appointmentId/billing-context'")
  );
  for (const code of [serverTussSlice, dataServiceCode, payerPanelCode, conferenceCode, closureCode]) {
    assert.doesNotMatch(code, /remessa enviada|enviar remessa|retorno|glosa|recurso|faturamento eletrônico completo|lote transmitido|guia oficial enviada/i);
  }
});

test('componentes TUSS e conferencia nao exibem mojibake', () => {
  for (const code of [payerPanelCode, conferenceCode, closureCode]) {
    assert.doesNotMatch(code, /Ã|Â|�/);
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
