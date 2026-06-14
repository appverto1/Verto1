import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const receptionistCode = readFileSync(join(root, 'src/components/ReceptionistDashboard.tsx'), 'utf8');
const therapistCode = readFileSync(join(root, 'src/components/TherapistDashboard.tsx'), 'utf8');
const operationalClosureCode = readFileSync(join(root, 'src/components/OperationalClosureCenter.tsx'), 'utf8');
const closureCode = readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const financialContextCode = readFileSync(join(root, 'src/utils/appointmentFinancialContext.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260601120000_appointment_billing_context_patient_index.sql'), 'utf8');
const patientDefaultMigrationCode = readFileSync(join(root, 'supabase/migrations/20260602123000_appointment_billing_context_patient_defaults.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('endpoint de contexto faz upsert idempotente por consulta', () => {
  assert.match(serverCode, /app\.get\('\/api\/appointments\/:appointmentId\/billing-context'/);
  assert.match(serverCode, /app\.patch\('\/api\/appointments\/:appointmentId\/billing-context'/);
  assert.match(serverCode, /\.upsert\(\[payload\], \{ onConflict: 'organization_id,appointment_id' \}\)/);
  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  assert.ok(routeStart > 0, 'rota de salvar contexto deve existir');
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  assert.ok(routeEnd > routeStart, 'rota de salvar contexto deve terminar antes da dispensa de documento');
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /await persistAppointmentClosureCheck\(\{\s*appointmentId: appointment\.id,\s*user: req\.session\.user,\s*force: true\s*\}\)/);
  assert.match(route, /const data = await upsertAppointmentBillingContextRow\(payload, Boolean\(existing\?\.id\)\)/);
  assert.doesNotMatch(route, /regenerateClosureForAppointments/);
  assert.doesNotMatch(route, /\.upsert\(\[payload\]/);
  assert.match(route, /message: 'Pagador salvo na consulta\.'/);
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
});

test('salvar pagador exige appointment persistido e nao cria consulta nova', () => {
  assert.match(serverCode, /ensureAppointmentMirrorForBillingContext/);
  const ensureStart = serverCode.indexOf('async function ensureAppointmentMirrorForBillingContext');
  const ensureEnd = serverCode.indexOf('async function syncClinicRoomsTableFromClinicState', ensureStart);
  const ensureSlice = serverCode.slice(ensureStart, ensureEnd);
  assert.match(ensureSlice, /\.from\('appointments'\)[\s\S]*?\.select\('id'\)[\s\S]*?\.eq\('id', appointmentId\)/);
  assert.doesNotMatch(ensureSlice, /syncAppointmentsTableFromClinicState/);
  assert.doesNotMatch(ensureSlice, /\.upsert\(/);
  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  const mirrorIndex = route.indexOf('ensureAppointmentMirrorForBillingContext');
  const existingIndex = route.indexOf('const existing = await fetchAppointmentBillingContextRow');
  const saveIndex = route.indexOf('const data = await upsertAppointmentBillingContextRow');
  assert.ok(mirrorIndex > 0, 'rota deve validar appointments antes de gravar pagador');
  assert.ok(existingIndex > mirrorIndex, 'contexto existente deve ser buscado depois da validacao');
  assert.ok(saveIndex > existingIndex, 'upsert do pagador deve acontecer depois da validacao');
  assert.match(route, /Sincronize a agenda e tente salvar o pagador novamente/);
});

test('conflito de contexto existente vira update idempotente', () => {
  assert.match(serverCode, /isAppointmentBillingContextConflict/);
  assert.match(serverCode, /sanitizeString\(error\?\.code, 40\) === '23505'/);
  assert.match(serverCode, /\.select\('id, created_at, created_by'\)[\s\S]*\.eq\('organization_id', row\.organization_id\)[\s\S]*\.eq\('appointment_id', row\.appointment_id\)/);
  assert.match(serverCode, /\.update\(cleanObject\(\{\s*\.\.\.row,\s*id: existingResult\.data\.id,/);
});

test('salvar contexto usa fallback de schema sem expor 503 tecnico', () => {
  assert.match(serverCode, /APPOINTMENT_BILLING_CONTEXT_SCHEMA_FALLBACK_COLUMNS/);
  assert.match(serverCode, /APPOINTMENT_BILLING_CONTEXT_METADATA_VALUE_COLUMNS/);
  assert.match(serverCode, /BILLING_CONTEXT_APPOINTMENT_SELECT/);
  assert.match(serverCode, /BILLING_CONTEXT_APPOINTMENT_SCHEMA_FALLBACK_COLUMNS/);
  assert.match(serverCode, /fetchClinicStateWithSchemaFallback\(\{ supabase, clinicId: organizationId, logger: console \}\)/);
  assert.match(serverCode, /source_payload: sanitizeClinicalPayload\(stateAppointment\)/);
  assert.match(serverCode, /const buildBillingContextSelect/);
  assert.match(serverCode, /const buildBillingContextStoragePayload/);
  assert.match(serverCode, /buildBillingContextMetadata\(payload\)/);
  assert.doesNotMatch(serverCode, /BILLING_CONTEXT_SCHEMA_INCOMPLETE/);

  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /const data = await upsertAppointmentBillingContextRow\(payload, Boolean\(existing\?\.id\)\)/);
  assert.match(route, /auditoria apos pagador falhou/);
  assert.match(route, /pendencias apos pagador falharam/);
  assert.match(route, /documentos apos pagador falharam/);
  assert.match(route, /error: 'Não foi possível salvar o pagador da consulta agora\.'/);
  assert.doesNotMatch(route, /status\(503\)/);

  const fetchStart = serverCode.indexOf('const fetchAppointmentForBillingContext');
  const fetchSlice = serverCode.slice(fetchStart, fetchStart + 3200);
  assert.match(fetchSlice, /runAppointmentQuery\(CLOSURE_APPOINTMENT_SELECT\)/);
  assert.match(fetchSlice, /runAppointmentQuery\(selectColumns\)/);
  assert.match(fetchSlice, /buildClinicStateAppointment/);
  assert.match(fetchSlice, /status: 500, error: 'Agenda indisponível\.'/);
  assert.doesNotMatch(fetchSlice, /status: 503/);

  assert.match(dataServiceCode, /Não foi possível salvar o pagador da consulta agora\./);
});

test('detalhe do fechamento tolera colunas novas do pagador ausentes', () => {
  assert.match(serverCode, /APPOINTMENT_CLOSURE_CHECK_SCHEMA_FALLBACK_COLUMNS/);
  assert.match(serverCode, /buildAppointmentClosureCheckSelect/);
  assert.match(serverCode, /buildAppointmentClosureCheckStoragePayload/);
  assert.match(serverCode, /fetchAppointmentClosureCheckRow/);
  assert.match(serverCode, /upsertAppointmentClosureCheckRow/);

  const persistStart = serverCode.indexOf('const persistAppointmentClosureCheck');
  const persistEnd = serverCode.indexOf('const regenerateClosureForAppointments', persistStart);
  assert.ok(persistStart > 0 && persistEnd > persistStart, 'persistencia de fechamento deve existir');
  const persistSlice = serverCode.slice(persistStart, persistEnd);
  assert.match(persistSlice, /const existingResult = await fetchAppointmentClosureCheckRow/);
  assert.match(persistSlice, /const result = await upsertAppointmentClosureCheckRow\(payload\)/);
  assert.doesNotMatch(persistSlice, /\.select\(APPOINTMENT_CLOSURE_CHECK_SELECT\)/);

  const detailStart = serverCode.indexOf("app.get('/api/closure/appointments/:appointmentId'");
  const detailEnd = serverCode.indexOf("app.post('/api/closure/appointments/:appointmentId/revalidate'", detailStart);
  assert.ok(detailStart > 0 && detailEnd > detailStart, 'rota de detalhe do fechamento deve existir');
  const detailSlice = serverCode.slice(detailStart, detailEnd);
  assert.match(detailSlice, /const closureResult = await fetchAppointmentClosureCheckRow/);
  assert.match(detailSlice, /closureResult\.omittedColumns\.size > 0/);
  assert.doesNotMatch(detailSlice, /\.select\(APPOINTMENT_CLOSURE_CHECK_SELECT\)/);
});

test('criacao da consulta cria contexto inicial sem sobrescrever edicao posterior', () => {
  assert.match(serverCode, /upsertInitialBillingContextFromAppointment/);
  assert.match(serverCode, /overwriteExplicit\?: boolean/);
  assert.match(serverCode, /if \(existing\.data\?\.id && \(!params\.overwriteExplicit \|\| !explicitFinancialContextType\)\) return/);
  assert.match(serverCode, /suggestedBilling = await resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /payer_name_snapshot: payerName \|\| null/);
  assert.match(serverCode, /insurance_card_number: sanitizeString\(appointmentPayload\?\.insuranceCardNumber/);
  assert.match(serverCode, /insurance_plan_name: sanitizeString\(appointmentPayload\?\.insurancePlanName/);
  assert.match(serverCode, /guide_number: sanitizeString\(appointmentPayload\?\.guideNumber/);
  assert.match(serverCode, /financialContextType: financialContextType \|\| undefined/);
  assert.match(serverCode, /explicitFinancialContext: Boolean\(explicitFinancialContextType\)/);
  assert.match(serverCode, /skipTussResolution: financialContextSkipsInsuranceBilling\(financialContextType\)/);
  assert.match(serverCode, /created_at: existing\.data\?\.created_at \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(serverCode, /source: sanitizeString\(\s*explicitFinancialContextType[\s\S]*?'APPOINTMENT_CONTEXT'/);
});

test('agendamento faturavel exige contexto financeiro explicito', () => {
  assert.match(coordinatorCode, /APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE/);
  assert.match(coordinatorCode, /APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS/);
  assert.match(coordinatorCode, /Contexto financeiro/);
  assert.match(financialContextCode, /Conv.nio/);
  assert.match(financialContextCode, /Particular/);
  assert.match(financialContextCode, /Pacote\/mensalidade/);
  assert.match(financialContextCode, /Sem cobran.a/);
  assert.match(financialContextCode, /N.o fatur.vel/);
  assert.match(coordinatorCode, /disabled=\{!canSubmitSession\}/);
  assert.match(coordinatorCode, /sessionFinancialContextType === "INSURANCE" \? sessionPayerId \|\| null : null/);
  assert.match(coordinatorCode, /source: "APPOINTMENT_CONTEXT"/);
  assert.match(dataServiceCode, /async createAppointments/);
  assert.match(serverCode, /validateAppointmentFinancialContextForWrite/);
  assert.match(serverCode, /appointmentRequiresFinancialContext/);
  assert.match(serverCode, /APPOINTMENT_FINANCIAL_CONTEXT_ERROR/);
  assert.match(serverCode, /Selecione um pagador\/convênio cadastrado ou escolha outro contexto financeiro válido\./);
});

test('contextos particular sem cobranca e nao faturavel persistem sem payer_id', () => {
  assert.match(serverCode, /normalizeAppointmentFinancialContextType/);
  assert.match(serverCode, /NON_INSURANCE_FINANCIAL_CONTEXT_TYPES/);
  assert.match(serverCode, /financialContextSkipsInsuranceBilling/);
  assert.match(serverCode, /payer_id: effectivePayerId/);
  assert.match(serverCode, /payer_type: effectiveFinancialContextType \|\| null/);
  assert.match(serverCode, /financialContextIsNotBillable\(billingContext\?\.payer_type\)/);
  assert.match(serverCode, /if \(financialContextSkipsInsuranceBilling\(billingContext\?\.payer_type\)\) return null/);
  assert.match(serverCode, /A resolução TUSS exige convênio com pagador cadastrado no atendimento\./);
  assert.match(serverCode, /appointmentRequiresFinancialContext\(appointment\) && !effectiveFinancialContextType/);
});

test('sugestao do paciente nao escolhe multiplos planos silenciosamente', () => {
  assert.match(serverCode, /resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /matchingPlans\.length === 1/);
  assert.match(coordinatorCode, /matchingPlans\.length === 1/);
  assert.match(coordinatorCode, /financialPlanMatchesAppointmentService/);
});

test('telas simples de agenda enviam contexto financeiro explicito quando escolhido', () => {
  for (const code of [receptionistCode, therapistCode]) {
    assert.match(code, /Contexto financeiro/);
    assert.match(code, /NON_INSURANCE_APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS/);
    assert.match(code, /const financialContextPayload = financialContextType/);
    assert.match(code, /financial_context_type: financialContextType/);
    assert.match(code, /payer_id: null/);
  }
});

test('detalhe da consulta salva pagador no contexto administrativo', () => {
  assert.match(calendarCode, /saveBillingContext/);
  assert.match(calendarCode, /dataService\.updateAppointmentBillingContext/);
  assert.match(calendarCode, /Contexto financeiro/);
  assert.match(calendarCode, /financialContextType,/);
  assert.match(calendarCode, /payerType: financialContextType/);
  assert.match(calendarCode, /insuranceCardNumber: usesInsuranceContext \? values\.insuranceCardNumber/);
  assert.match(calendarCode, /insurancePlanName: usesInsuranceContext \? values\.insurancePlanName/);
  assert.match(calendarCode, /billingEditorFinancialContextError/);
  assert.match(calendarCode, /source: values\.source/);
  assert.match(calendarCode, /Aplicar . consulta/);
  assert.match(calendarCode, /Definir pagador/);
  assert.match(calendarCode, /Editar pagador/);
  assert.doesNotMatch(calendarCode, /onClick=\{\(\) => onEditAppointment\?\.\(detailEvent\)\}[\s\S]{0,140}Editar pagador/);
});

test('modal preenche sugestao do paciente com carteirinha sem sobrescrever cadastro', () => {
  assert.match(serverCode, /\.from\('patients'\)[\s\S]*\.select\('id, insurance_type, insurance_name, insurance_card_number'\)/);
  assert.match(serverCode, /insuranceCardNumber: patientInsuranceCardNumber \|\| null/);
  assert.match(serverCode, /insurancePlanName: sanitizeString\(selectedPlan\.insurance_plan_name/);
  assert.match(serverCode, /const patientDefault = serializeBillingSuggestion\(suggestion\)/);
  assert.match(serverCode, /payerId: sanitizeString\(row\?\.payer_id, 120\) \|\| null/);
  assert.match(serverCode, /payerName: sanitizeString\(payer\?\.name \|\| row\?\.payer_name_snapshot, 180\) \|\| null/);
  assert.match(serverCode, /insuranceCardNumber: sanitizeString\(row\?\.insurance_card_number, 120\) \|\| patientDefault\?\.insuranceCardNumber \|\| null/);
  assert.match(serverCode, /insurancePlanName: sanitizeString\(row\?\.insurance_plan_name, 160\) \|\| patientDefault\?\.insurancePlanName \|\| null/);
  assert.doesNotMatch(serverCode, /const suggestion = billingContext\?\.id\s*\?\s*null/);
  assert.match(calendarCode, /getBillingFormSource/);
  assert.match(calendarCode, /suggestion\?\.insuranceCardNumber/);
  assert.match(calendarCode, /suggestion\?\.insurancePlanName/);
  assert.match(calendarCode, /Pagador sugerido pelo plano financeiro, não aplicado ao atendimento/);
  assert.match(calendarCode, /Dados sugeridos a partir do cadastro do paciente/);
  assert.match(calendarCode, /Número da carteirinha/);
  assert.doesNotMatch(calendarCode, /NÃºmero da carteirinha|Plano do convÃªnio/);
  assert.match(calendarCode, /Salvar na consulta/);
  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.doesNotMatch(route, /\.from\('patients'\)[\s\S]*\.update/);
  assert.doesNotMatch(route, /\.from\('patient_financial_plans'\)[\s\S]*\.update/);
});

test('modal carrega pagadores ativos e permite criar pagador rapido', () => {
  assert.match(calendarCode, /dataService\.getPayers\(\{ status: 'ACTIVE', limit: 80 \}\)/);
  assert.match(calendarCode, /Nenhum pagador cadastrado/);
  assert.match(calendarCode, /Criar pagador/);
  assert.match(calendarCode, /createQuickBillingPayer/);
  assert.match(calendarCode, /dataService\.createPayer/);
  assert.match(calendarCode, /Salvar e selecionar/);
  assert.match(calendarCode, /setBillingPayers/);
  assert.match(calendarCode, /payerId: String\(payer\?\.id/);
  assert.match(calendarCode, /payerName: sanitizeHumanPayerName\(payer\?\.name/);
  assert.match(calendarCode, /billingPayersLoaded/);
  assert.match(calendarCode, /normalizePayerOptions\(result\.data\)/);
  assert.match(calendarCode, /selectedBillingPayerKnown/);
  assert.match(calendarCode, /billingSnapshotSelectValue/);
});

test('criacao de pagador reutiliza nome existente na mesma clinica', () => {
  const routeStart = serverCode.indexOf("app.post('/api/admin/payers'");
  assert.ok(routeStart > 0, 'rota de criar pagador deve existir');
  const route = serverCode.slice(routeStart, routeStart + 2600);
  assert.match(route, /\.from\('clinic_payers'\)[\s\S]*\.select\(CLINIC_PAYER_SELECT\)[\s\S]*\.eq\('organization_id', organizationId\)[\s\S]*\.ilike\('name', name\)/);
  assert.match(route, /idempotent:\s*true/);
  assert.match(route, /serializePayer\(existingPayer\)/);
});

test('payer_id e appointment_id fora da organizacao sao rejeitados', () => {
  const fetchStart = serverCode.indexOf('const fetchAppointmentForBillingContext');
  assert.ok(fetchStart > 0, 'helper de escopo da consulta deve existir');
  const fetchSlice = serverCode.slice(fetchStart, fetchStart + 3800);
  assert.match(fetchSlice, /\.from\('appointments'\)[\s\S]*\.select\(selectColumns\)[\s\S]*\.eq\('id', safeAppointmentId\)/);
  assert.match(fetchSlice, /runAppointmentQuery\(CLOSURE_APPOINTMENT_SELECT\)/);
  assert.match(fetchSlice, /\.or\(`organization_id\.eq\.\$\{organizationId\},clinic_id\.eq\.\$\{organizationId\}`\)/);
  assert.match(fetchSlice, /canAccessPatientInCurrentClinic/);

  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /const payer = isUuid\(payerId\) \? await fetchPayerForAdmin\(payerId, organizationId\) : null/);
  assert.match(route, /const requestedPayerName = sanitizeString\(req\.body\?\.payerName \|\| req\.body\?\.payer_name_snapshot, 180\)/);
  assert.match(route, /if \(payerId && !payer && !requestedPayerName\) return res\.status\(404\)\.json\(payerSafeError\(404\)\)/);
  assert.match(route, /const effectivePayerId = effectiveFinancialContextType === 'INSURANCE'/);
  assert.match(route, /payer_id: effectivePayerId/);
  assert.match(route, /payer_type: effectiveFinancialContextType \|\| null/);
  assert.match(route, /payer_name_snapshot: effectiveFinancialContextType === 'INSURANCE'/);
});

test('fechamento usa pagador da consulta, nao plano do paciente como substituto', () => {
  const payerBlockIndex = closureCode.indexOf("'payer_linked'");
  assert.ok(payerBlockIndex > 0, 'payer_linked deve existir');
  const payerBlock = closureCode.slice(Math.max(0, payerBlockIndex - 1600), payerBlockIndex + 900);
  assert.match(closureCode, /const payerLinkedStatus: ClosureCheckStatus = appointmentPayerId \|\| nonInsuranceFinancialContext \? 'PASSED' : 'FAILED'/);
  assert.match(closureCode, /Pagador sugerido pelo plano financeiro/);
  assert.match(closureCode, /Contexto financeiro definido/);
  assert.match(payerBlock, /appointmentPayerId/);
  assert.match(payerBlock, /suggestedPayerName/);
  assert.doesNotMatch(payerBlock, /suggestedPayerName\s*\?\s*'PASSED'/);
  assert.doesNotMatch(payerBlock, /input\.patient\?\.financialPlans/);
});

test('modal do fechamento mostra pagador sugerido sem marcar como aplicado', () => {
  const normalizeStart = serverCode.indexOf('function normalizeHydratedClosureChecklist');
  assert.ok(normalizeStart > 0, 'normalizador do checklist hidratado deve existir');
  const normalizeSlice = serverCode.slice(normalizeStart, normalizeStart + 1100);
  assert.match(serverCode, /const repairChecklistDisplayText/);
  assert.match(normalizeSlice, /const hasRealPayer = isUuid\(sanitizeString\(hydratedRow\?\.payer_id, 120\)\)/);
  assert.match(normalizeSlice, /label: repairChecklistDisplayText\(item\?\.label, 180\)/);
  assert.match(normalizeSlice, /message: repairChecklistDisplayText\(item\?\.message, 800\)/);
  assert.match(normalizeSlice, /status: hasRealPayer \? 'PASSED' : 'FAILED'/);
  assert.match(normalizeSlice, /Pagador sugerido pelo plano financeiro/);
  assert.match(normalizeSlice, /Ainda não aplicado ao atendimento/);

  const detailStart = serverCode.indexOf("app.get('/api/closure/appointments/:appointmentId'");
  const detailEnd = serverCode.indexOf("app.post('/api/closure/appointments/:appointmentId/revalidate'", detailStart);
  assert.ok(detailStart > 0 && detailEnd > detailStart, 'detalhe do fechamento deve existir');
  const detailSlice = serverCode.slice(detailStart, detailEnd);
  assert.match(detailSlice, /const hydratedRows = await hydrateConferenceRows\(\[data\], clinicId, req\.session\.user\)/);
  assert.match(detailSlice, /checklist: normalizeHydratedClosureChecklist\(data\?\.checklist, hydratedDetail\)/);

  assert.match(operationalClosureCode, /payer_id\?: string \| null/);
  assert.match(operationalClosureCode, /suggested_payer_name\?: string \| null/);
  assert.match(operationalClosureCode, /function hasAppliedPayer/);
  assert.match(operationalClosureCode, /return Boolean\(String\(row\?\.payer_id \|\| ""\)\.trim\(\)\)/);
  assert.match(operationalClosureCode, /Pagador sugerido pelo plano financeiro: \{detail\.suggested_payer_name\}\. Ainda não aplicado ao atendimento\./);
  assert.match(operationalClosureCode, /Pagador: \{appliedPayerLabel\(detail\)\}/);
});

test('conferencia mensal consome resumo persistido com pagador da consulta', () => {
  const closureListIndex = serverCode.indexOf('const APPOINTMENT_CLOSURE_LIST_SELECT');
  assert.ok(closureListIndex > 0, 'select persistido de fechamento deve existir');
  const closureListSelect = serverCode.slice(closureListIndex, closureListIndex + 900);
  assert.match(closureListSelect, /'payer_id'/);
  assert.match(closureListSelect, /'payer_name_snapshot'/);
  assert.match(closureListSelect, /'authorization_code'/);
  assert.match(closureListSelect, /'guide_number'/);
  const filterStart = serverCode.indexOf('const applyConferenceFilters');
  const conferenceStart = serverCode.indexOf('const loadConferenceClosureRows');
  const conferenceEnd = serverCode.indexOf("app.get('/api/conference/monthly/session/:appointmentId'");
  assert.ok(conferenceStart > 0 && conferenceEnd > conferenceStart, 'rotas da conferencia mensal devem usar fechamento persistido');
  const filterSlice = serverCode.slice(filterStart, conferenceStart);
  const conferenceSlice = serverCode.slice(conferenceStart, conferenceEnd);
  assert.match(conferenceSlice, /\.from\('appointment_closure_checks'\)/);
  assert.match(conferenceSlice, /\.select\(APPOINTMENT_CLOSURE_LIST_SELECT\)/);
  assert.match(filterSlice, /if \(filters\.payerId\) scoped = scoped\.eq\('payer_id', filters\.payerId\)/);
  assert.match(filterSlice, /scoped = scoped\.is\('guide_number', null\)/);
  assert.match(filterSlice, /scoped = scoped\.is\('authorization_code', null\)/);
});

test('indice por paciente foi adicionado de forma aditiva', () => {
  assert.match(migrationCode, /create index if not exists idx_appointment_billing_contexts_patient/);
  assert.match(migrationCode, /appointment_billing_contexts \(organization_id, patient_id\)/);
});

test('campos herdados do paciente foram adicionados de forma aditiva', () => {
  assert.match(patientDefaultMigrationCode, /add column if not exists payer_type text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists insurance_card_number text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists insurance_plan_name text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists source text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists metadata jsonb not null default '\{\}'::jsonb/);
  assert.match(patientDefaultMigrationCode, /add column if not exists created_by uuid/);
  assert.match(patientDefaultMigrationCode, /add column if not exists updated_by uuid/);
  assert.match(patientDefaultMigrationCode, /idx_appointment_billing_contexts_source/);
  assert.match(serverCode, /'insurance_card_number'/);
  assert.match(serverCode, /'insurance_plan_name'/);
  assert.match(serverCode, /'source'/);
  assert.match(closureCode, /insuranceCardPresent/);
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

console.log(`${passed}/${tests.length} appointment billing context tests passed`);
