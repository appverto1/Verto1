import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPayerScopedBillingForm,
  clearPayerDependentBillingFields,
  payerScopedBillingSourceLabel,
} from '../src/utils/appointmentBillingPayerSwitch';
import {
  findSuggestedTissAuthorizationForAppointment,
  getPatientTissAuthorizationQuantitySummary,
  getPatientTissAuthorizationVisualState,
} from '../src/utils/patientTissAuthorizationView';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
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
const atomicAuthorizationReservationMigrationCode = readFileSync(join(root, 'supabase/migrations/20260715120000_atomic_tiss_authorization_reservation.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 4000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

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
  assert.match(route, /let data: any = null/);
  assert.match(route, /supabase\.rpc\('reserve_tiss_authorization_billing_context'/);
  assert.match(route, /data = await upsertAppointmentBillingContextRow\(payload, Boolean\(existing\?\.id\)\)/);
  assert.doesNotMatch(route, /regenerateClosureForAppointments/);
  assert.doesNotMatch(route, /\.upsert\(\[payload\]/);
  assert.match(route, /appliedTissAuthorization\?\.authorizationId \? 'Autorização aplicada\.' : 'Pagador salvo na consulta\.'/);
  assert.match(route, /runAffectedTissPipeline\([\s\S]*appointmentId: appointment\.id[\s\S]*limit: 1/);
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
  const saveIndex = route.indexOf("supabase.rpc('reserve_tiss_authorization_billing_context'");
  assert.ok(mirrorIndex > 0, 'rota deve validar appointments antes de gravar pagador');
  assert.ok(existingIndex > mirrorIndex, 'contexto existente deve ser buscado depois da validacao');
  assert.ok(saveIndex > existingIndex, 'upsert do pagador deve acontecer depois da validacao');
  assert.match(route, /Sincronize a agenda e tente salvar o pagador novamente/);
});

test('saldo de autorizacao separa consumido, reservado e disponivel sem sugerir pacote esgotado', () => {
  const exhausted = {
    id: 'auth-1',
    payerId: 'payer-1',
    patientId: 'patient-1',
    authorizedQuantity: 12,
    usedQuantity: 0,
    reservedQuantity: 12,
    validFrom: '2026-07-01',
    validUntil: '2026-12-31',
    tussCode: '50000470',
    serviceName: 'Psicoterapia',
    active: true,
  };
  const summary = getPatientTissAuthorizationQuantitySummary(exhausted);
  assert.deepEqual(summary, {
    authorized: 12,
    consumed: 0,
    reserved: 12,
    available: 0,
    hasPackageLimit: true,
  });
  assert.equal(getPatientTissAuthorizationVisualState(exhausted, '2026-07-15').status, 'consumed');
  assert.equal(findSuggestedTissAuthorizationForAppointment({
    payerId: 'payer-1',
    serviceName: 'Psicoterapia',
    tussCode: '50000470',
    appointmentDate: '2026-07-15',
  }, [exhausted]), null);

  const mixedConsumptionAndReservation = getPatientTissAuthorizationQuantitySummary({
    ...exhausted,
    usedQuantity: 1,
    reservedQuantity: 1,
  });
  assert.deepEqual(mixedConsumptionAndReservation, {
    authorized: 12,
    consumed: 1,
    reserved: 1,
    available: 10,
    hasPackageLimit: true,
  });
});

test('reserva de autorizacao e atomica, idempotente, restrita ao tenant e sem acesso do cliente', () => {
  const reservationCounter = sliceFrom(serverCode, 'async function fetchAppointmentTissAuthorizationReservationCounts', 15000);
  assert.match(reservationCounter, /reservationsByAppointmentAndAuthorization/);
  assert.match(reservationCounter, /reservationKey\(appointmentId, authorizationId\)/);
  assert.match(reservationCounter, /futureCounts/);
  assert.match(reservationCounter, /historicalOfficialCounts/);
  assert.match(reservationCounter, /Math\.max\(0, futureReservations\) \+ Math\.max\(0, historicalOfficialCommitments - alreadyConsumed\)/);
  assert.match(atomicAuthorizationReservationMigrationCode, /create or replace function public\.reserve_tiss_authorization_billing_context/);
  assert.match(atomicAuthorizationReservationMigrationCode, /from public\.patient_payer_authorizations[\s\S]*organization_id = p_organization_id[\s\S]*patient_id = p_patient_id[\s\S]*for update/);
  assert.match(atomicAuthorizationReservationMigrationCode, /TISS_AUTHORIZATION_NO_AVAILABLE_BALANCE/);
  assert.match(atomicAuthorizationReservationMigrationCode, /v_future_commitments/);
  assert.match(atomicAuthorizationReservationMigrationCode, /v_historical_official_commitments/);
  assert.match(atomicAuthorizationReservationMigrationCode, /greatest\(0, v_future_commitments\)[\s\S]*greatest\(0, v_historical_official_commitments - v_consumed\)/);
  assert.match(atomicAuthorizationReservationMigrationCode, /on conflict \(organization_id, appointment_id\) do update/);
  assert.match(atomicAuthorizationReservationMigrationCode, /revoke all on function[\s\S]*from authenticated/);
  assert.match(atomicAuthorizationReservationMigrationCode, /grant execute on function[\s\S]*to service_role/);
});

test('conflito de contexto existente vira update idempotente', () => {
  assert.match(serverCode, /isAppointmentBillingContextConflict/);
  assert.match(serverCode, /sanitizeString\(error\?\.code, 40\) === '23505'/);
  assert.match(serverCode, /\.select\('id, created_at, created_by'\)[\s\S]*\.eq\('organization_id', row\.organization_id\)[\s\S]*\.eq\('appointment_id', row\.appointment_id\)/);
  assert.match(serverCode, /\.update\(cleanObject\(\{\s*\.\.\.row,\s*id: existingResult\.data\.id,/);
});

test('salvar contexto comum usa fallback e autorizacao exige reserva atomica disponivel', () => {
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
  assert.match(route, /data = await upsertAppointmentBillingContextRow\(payload, Boolean\(existing\?\.id\)\)/);
  assert.match(route, /auditoria apos pagador falhou/);
  assert.match(route, /pendencias apos pagador falharam/);
  assert.match(route, /documentos apos pagador falharam/);
  assert.match(route, /error: 'Não foi possível salvar o pagador da consulta agora\.'/);
  assert.match(route, /TISS_AUTHORIZATION_RESERVATION_SCHEMA_UNAVAILABLE/);
  assert.match(route, /Não foi possível reservar esta autorização porque a estrutura necessária ainda não está disponível/);

  const fetchStart = serverCode.indexOf('const fetchAppointmentForBillingContext');
  const fetchSlice = serverCode.slice(fetchStart, fetchStart + 7000);
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
  assert.match(serverCode, /existing\.data\?\.id &&\s*!requestedTissAuthorizationId &&\s*\(!params\.overwriteExplicit \|\| !explicitFinancialContextType\)/);
  assert.match(serverCode, /suggestedBilling = await resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /payer_name_snapshot: payerName \|\| null/);
  assert.match(serverCode, /insurance_card_number: sanitizeString\(appointmentPayload\?\.insuranceCardNumber/);
  assert.match(serverCode, /insurance_plan_name: sanitizeString\(appointmentPayload\?\.insurancePlanName/);
  assert.match(serverCode, /guide_number: sanitizeString\(appointmentPayload\?\.guideNumber/);
  assert.match(serverCode, /financialContextType: financialContextType \|\| undefined/);
  assert.match(serverCode, /explicitFinancialContext: Boolean\(explicitFinancialContextType\)/);
  assert.match(serverCode, /skipTussResolution: financialContextSkipsInsuranceBilling\(financialContextType\)/);
  assert.match(serverCode, /created_at: existing\.data\?\.created_at \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(serverCode, /source: sanitizeString\(\s*selectedTissAuthorization\?\.authorizationId[\s\S]*?'PATIENT_TISS_AUTHORIZATION'[\s\S]*?explicitFinancialContextType[\s\S]*?'APPOINTMENT_CONTEXT'/);
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

test('agendamento particular oculta e limpa guia autorizacao e senha', () => {
  const modal = sliceFrom(coordinatorCode, '{isAddSessionModalOpen && (', 70000);
  assert.match(modal, /Atendimento particular, sem pagador de conv.nio/);
  assert.match(modal, /sessionFinancialContextType === "INSURANCE" \? \(/);
  assert.match(modal, /Guia[\s\S]*Autorização\/senha/);
  assert.match(coordinatorCode, /guideNumber: sessionFinancialContextType === "INSURANCE" \? sessionGuideNumber : ""/);
  assert.match(coordinatorCode, /authorizationCode: sessionFinancialContextType === "INSURANCE" \? sessionAuthorizationCode : ""/);
  assert.match(coordinatorCode, /patientTissAuthorizationId: sessionFinancialContextType === "INSURANCE" \? sessionPatientTissAuthorizationId \|\| null : null/);
  assert.match(coordinatorCode, /guideNumber: sessionFinancialContextType === "INSURANCE" \? sessionGuideNumber \|\| null : null/);
  assert.match(coordinatorCode, /authorizationCode: sessionFinancialContextType === "INSURANCE" \? sessionAuthorizationCode \|\| null : null/);
  assert.match(coordinatorCode, /setSessionGuideNumber\(""\)/);
  assert.match(coordinatorCode, /setSessionAuthorizationCode\(""\)/);
  assert.match(coordinatorCode, /setSessionPatientTissAuthorizationId\(""\)/);
});

test('criacao e edicao da consulta exibem e persistem plano e carteirinha', () => {
  assert.match(coordinatorCode, /const \[sessionInsurancePlanName, setSessionInsurancePlanName\] = useState\(""\)/);
  assert.match(coordinatorCode, /const \[sessionInsuranceCardNumber, setSessionInsuranceCardNumber\] = useState\(""\)/);
  assert.match(coordinatorCode, /normalizePatientInsuranceEligibility\(patient\)/);
  assert.match(coordinatorCode, /insurancePlanName: String\([\s\S]*?insurancePlan\?\.insurancePlanName[\s\S]*?eligibilityMatchesPlan/);
  assert.match(coordinatorCode, /insuranceCardNumber: String\([\s\S]*?insurancePlan\?\.insuranceCardNumber[\s\S]*?eligibilityMatchesPlan/);
  assert.match(coordinatorCode, /Dados do plano/);
  assert.match(coordinatorCode, /Somente leitura no agendamento/);
  assert.match(coordinatorCode, /Editar dados do convênio no paciente/);
  assert.doesNotMatch(coordinatorCode, /onChange=\{\(e\) => setSessionInsurancePlanName\(e\.target\.value\)\}/);
  assert.doesNotMatch(coordinatorCode, /onChange=\{\(e\) => setSessionInsuranceCardNumber\(e\.target\.value\)\}/);
  assert.match(coordinatorCode, /insurancePlanName: sessionFinancialContextType === "INSURANCE" \? sessionInsurancePlanName/);
  assert.match(coordinatorCode, /insuranceCardNumber: sessionFinancialContextType === "INSURANCE" \? sessionInsuranceCardNumber/);
  assert.match(coordinatorCode, /const appointmentInsurancePlanSnapshot = String/);
  assert.match(coordinatorCode, /const appointmentInsuranceCardSnapshot = String/);
  assert.match(coordinatorCode, /result\.data\.hasContext[\s\S]*?appointmentInsurancePlanSnapshot \|\| result\.data\.insurancePlanName/);
  assert.match(coordinatorCode, /result\.data\.hasContext[\s\S]*?appointmentInsuranceCardSnapshot \|\| result\.data\.insuranceCardNumber/);
  assert.match(coordinatorCode, /\(histórico\/inativo\)/);
  assert.match(serverCode, /insurance_plan_name: sanitizeString\(appointmentPayload\?\.insurancePlanName/);
  assert.match(serverCode, /insurance_card_number: sanitizeString\(appointmentPayload\?\.insuranceCardNumber/);
});

test('novas consultas copiam o vinculo atual sem alterar snapshots antigos', () => {
  assert.match(appCode, /const patientInsuranceEligibility = normalizePatientInsuranceEligibility\(patientForSession \|\| \{\}\)/);
  assert.match(appCode, /const legacyPayerMatchesSelected =/);
  assert.match(appCode, /const effectiveInsurancePlanName = usesInsuranceContext/);
  assert.match(appCode, /const effectiveInsuranceCardNumber = usesInsuranceContext/);
  assert.match(appCode, /insurancePlanName: effectiveInsurancePlanName/);
  assert.match(appCode, /insuranceCardNumber: effectiveInsuranceCardNumber/);
  assert.match(serverCode, /existing\.data\?\.id &&\s*!requestedTissAuthorizationId &&\s*\(!params\.overwriteExplicit \|\| !explicitFinancialContextType\)/);
  assert.match(serverCode, /appointmentPayload\?\.insurancePlanName \|\| appointmentPayload\?\.insurance_plan_name \|\| suggestedBilling/);
  assert.match(serverCode, /appointmentPayload\?\.insuranceCardNumber \|\| appointmentPayload\?\.insurance_card_number/);
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
  assert.match(calendarCode, /insuranceCardNumber: usesInsuranceContext \? resolvedValues\.insuranceCardNumber/);
  assert.match(calendarCode, /insurancePlanName: usesInsuranceContext \? resolvedValues\.insurancePlanName/);
  assert.match(calendarCode, /billingEditorFinancialContextError/);
  assert.match(calendarCode, /source: resolvedValues\.source/);
  assert.match(calendarCode, /Aplicar . consulta/);
  assert.match(calendarCode, /Definir pagador/);
  assert.match(calendarCode, /Editar pagador/);
  assert.doesNotMatch(calendarCode, /onClick=\{\(\) => onEditAppointment\?\.\(detailEvent\)\}[\s\S]{0,140}Editar pagador/);
});

test('modal preenche sugestao do paciente com carteirinha sem sobrescrever cadastro', () => {
  assert.match(serverCode, /\.from\('patients'\)[\s\S]*\.select\('id, insurance_type, insurance_name, insurance_card_number, insurance_card_valid_until, insurance_plan_category, insurance_holder_name'\)/);
  assert.match(serverCode, /const patientInsuranceCardForPayer = \(payerName\?: any\) =>/);
  assert.match(serverCode, /patientInsuranceFallbackMatches\(payerName\) \? patientInsuranceCardNumber : ''/);
  assert.match(serverCode, /const patientInsurancePlanName = sanitizeString\(patientBillingRow\?\.insurance_plan_category, 160\)/);
  assert.match(serverCode, /insurancePlanName: sanitizeString\(selectedPlan\.insurance_plan_name, 160\) \|\| patientInsurancePlanForPayer\(payerName\) \|\| null/);
  assert.match(serverCode, /insurancePlanName: patientInsurancePlanForPayer\(payerName\) \|\| null/);
  assert.match(serverCode, /const patientDefault = serializeBillingSuggestion\(suggestion\)/);
  assert.match(serverCode, /payerId: sanitizeString\(row\?\.payer_id, 120\) \|\| null/);
  assert.match(serverCode, /payerName: sanitizeString\(payer\?\.name \|\| row\?\.payer_name_snapshot, 180\) \|\| null/);
  assert.match(serverCode, /insuranceCardNumber: sanitizeString\(row\?\.insurance_card_number, 120\) \|\| patientDefault\?\.insuranceCardNumber \|\| null/);
  assert.match(serverCode, /insurancePlanName: sanitizeString\(row\?\.insurance_plan_name, 160\) \|\| patientDefault\?\.insurancePlanName \|\| null/);
  assert.doesNotMatch(serverCode, /const suggestion = billingContext\?\.id\s*\?\s*null/);
  assert.match(calendarCode, /getBillingFormSource/);
  assert.match(calendarCode, /suggestion\?\.insuranceCardNumber/);
  assert.match(calendarCode, /suggestion\?\.insurancePlanName/);
  assert.match(calendarCode, /<span className="font-semibold">Plano:<\/span>/);
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
  assert.match(calendarCode, /const payerId = String\(payer\?\.id/);
  assert.match(calendarCode, /const payerName = sanitizeHumanPayerName\(payer\?\.name/);
  assert.match(calendarCode, /clearPayerDependentBillingFields\(\{[\s\S]*payerId,[\s\S]*payerName/);
  assert.match(calendarCode, /billingPayersLoaded/);
  assert.match(calendarCode, /normalizePayerOptions\(result\.data\)/);
  assert.match(calendarCode, /selectedBillingPayerKnown/);
  assert.match(calendarCode, /billingSnapshotSelectValue/);
});

test('modal de editar pagador usa payerId canonico e deduplica nomes legados', () => {
  assert.match(calendarCode, /normalizePayerNameKey/);
  assert.match(calendarCode, /const byId = new Map/);
  assert.match(calendarCode, /const byName = new Map/);
  assert.match(calendarCode, /findUniqueBillingPayerByName/);
  assert.match(calendarCode, /normalizeBillingFormWithResolvedPayer/);
  assert.match(calendarCode, /payerId: selectedPayer\?\.id \|\| payerId/);
  assert.match(calendarCode, /const effectiveBillingPayerId = billingForm\.payerId \|\| matchedBillingPayerByName\?\.id \|\| ''/);
  assert.match(calendarCode, /billingEditorFinancialContextError[\s\S]*?!String\(effectiveBillingPayerId/);
  assert.match(calendarCode, /billingSnapshotOptionVisible[\s\S]*?!matchedBillingPayerByName/);
  assert.match(calendarCode, /payerId: usesInsuranceContext \? resolvedValues\.payerId \|\| null : null/);
  assert.match(calendarCode, /guideNumber: usesInsuranceContext \? resolvedValues\.guideNumber \|\| null : null/);
  assert.match(calendarCode, /authorizationCode: usesInsuranceContext \? resolvedValues\.authorizationCode \|\| null : null/);
});

test('troca de pagador limpa dados dependentes do convenio anterior', () => {
  const amilForm = {
    financialContextType: 'INSURANCE',
    payerId: 'amil-id',
    payerName: 'Amil',
    serviceType: 'ABA',
    insuranceCardNumber: '123456789',
    insurancePlanName: 'Platinum',
    guideNumber: '6549874132',
    authorizationCode: '1235987',
    patientTissAuthorizationId: 'auth-amil',
    procedureCode: '50000470',
    notes: 'mantem observacao'
  };
  const switched = clearPayerDependentBillingFields({
    ...amilForm,
    payerId: 'unimed-id',
    payerName: 'Unimed'
  });
  assert.equal(switched.payerId, 'unimed-id');
  assert.equal(switched.payerName, 'Unimed');
  assert.equal(switched.insuranceCardNumber, '');
  assert.equal(switched.insurancePlanName, '');
  assert.equal(switched.guideNumber, '');
  assert.equal(switched.authorizationCode, '');
  assert.equal(switched.patientTissAuthorizationId, '');
  assert.equal(switched.procedureCode, '');
  assert.equal(switched.notes, 'mantem observacao');
});

test('troca para pagador com autorizacao vigente aplica somente dados do novo convenio', () => {
  const base = clearPayerDependentBillingFields({
    payerId: 'unimed-id',
    payerName: 'Unimed',
    serviceType: 'ABA',
    insuranceCardNumber: 'AMIL-CARD',
    guideNumber: 'GUIA-AMIL',
    authorizationCode: 'AUTH-AMIL'
  });
  const hydrated = buildPayerScopedBillingForm(base, {
    payerId: 'unimed-id',
    payerName: 'Unimed',
    suggestion: {
      payerId: 'unimed-id',
      payerName: 'Unimed',
      insuranceCardNumber: 'UNIMED-CARD',
      insurancePlanName: 'Unimed Terapias',
      tissAuthorization: {
        authorizationId: 'auth-unimed',
        guideNumber: 'GUIA-UNIMED',
        authorizationCode: 'AUTH-UNIMED'
      }
    }
  });
  assert.equal(hydrated.insuranceCardNumber, 'UNIMED-CARD');
  assert.equal(hydrated.insurancePlanName, 'Unimed Terapias');
  assert.equal(hydrated.guideNumber, 'GUIA-UNIMED');
  assert.equal(hydrated.authorizationCode, 'AUTH-UNIMED');
  assert.equal(hydrated.patientTissAuthorizationId, 'auth-unimed');
  assert.equal(hydrated.source, 'PATIENT_TISS_AUTHORIZATION');
  assert.equal(payerScopedBillingSourceLabel({ field: 'authorization', form: hydrated }), 'Origem: autorizacao TISS vigente');
});

test('modal recarrega sugestao por payerId e rebaixa edicao livre para ajuste avancado', () => {
  assert.match(calendarCode, /handleBillingPayerChange/);
  assert.match(calendarCode, /clearPayerDependentBillingFields/);
  assert.match(calendarCode, /buildPayerScopedBillingForm/);
  assert.match(calendarCode, /dataService\.getAppointmentBillingContext\(appointmentId, \{\s*payerId: safePayerId/);
  assert.match(calendarCode, /Dados encontrados para este convenio/);
  assert.match(calendarCode, /Ajuste manual avancado/);
  assert.match(calendarCode, /Ao trocar o pagador, carteirinha, plano, guia e autorizacao sao recarregados apenas da fonte deste convenio/);
});

test('consulta e modal sugerem autorização TISS vigente do paciente sem usar TUSS legado', () => {
  assert.match(serverCode, /function appointmentDateKeyForAuthorization/);
  assert.match(serverCode, /resolveAppointmentTissAuthorizationForBilling/);
  assert.match(serverCode, /fetchMatchingTussServiceCatalogForAppointmentTissBilling/);
  assert.match(serverCode, /findSuggestedTissAuthorizationForAppointment/);
  assert.match(serverCode, /patient_payer_authorizations/);
  assert.match(serverCode, /getPatientTissAuthorizationVisualState/);
  assert.match(serverCode, /dedupePatientTissAuthorizationSelectionOptions/);
  assert.match(serverCode, /fetchAppointmentTissAuthorizationReservationCounts/);
  assert.match(serverCode, /suggestedBilling = await resolveAppointmentBillingSuggestion\(/);
  assert.match(serverCode, /patient_tiss_authorization_id: selectedTissAuthorization\?\.authorizationId/);
  assert.match(serverCode, /Esta autoriza..o n.o possui saldo dispon.vel/);
  assert.match(serverCode, /Esta autoriza..o n.o est. dispon.vel para a data, conv.nio ou procedimento da consulta/);
  assert.match(serverCode, /conflictType: 'authorization'/);
  assert.match(calendarCode, /Autorização TISS sugerida/);
  assert.match(calendarCode, /Usar esta autorização/);
  assert.match(calendarCode, /applySuggestedTissAuthorizationToBillingForm/);
  assert.match(calendarCode, /patientTissAuthorizationId: usesInsuranceContext \? resolvedValues\.patientTissAuthorizationId \|\| null : null/);
  assert.match(calendarCode, /Autorização TISS vigente do paciente/);
});

test('hotfix detalhe de calendario nao chama helper TUSS fora de escopo', () => {
  const resolverStart = serverCode.indexOf('async function resolveAppointmentTissAuthorizationForBilling');
  const resolverEnd = serverCode.indexOf('async function resolveAppointmentBillingSuggestion', resolverStart);
  assert.ok(resolverStart > 0 && resolverEnd > resolverStart, 'resolvedor de autorização da consulta deve existir');
  const resolver = serverCode.slice(resolverStart, resolverEnd);
  assert.match(resolver, /fetchMatchingTussServiceCatalogForAppointmentTissBilling/);
  assert.doesNotMatch(resolver, /fetchMatchingTussServiceCatalog\(/);
  assert.match(resolver, /catch \(error: any\)[\s\S]*return null/);

  const detailStart = serverCode.indexOf("app.get('/api/calendar/events/:eventId/detail'");
  const detailEnd = serverCode.indexOf('const payerSafeError', detailStart);
  assert.ok(detailStart > 0, 'endpoint de detalhe do calendário deve existir');
  const detailRoute = serverCode.slice(detailStart, detailEnd > detailStart ? detailEnd : detailStart + 16000);
  assert.match(detailRoute, /serializeBillingContext\([\s\S]*await resolveAppointmentBillingSuggestion/);
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
  const fetchSlice = serverCode.slice(fetchStart, fetchStart + 7000);
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

test('GET de billing-context resolve sugestao pelo payerId solicitado sem salvar contexto', () => {
  const routeStart = serverCode.indexOf("app.get('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /const requestedSuggestionPayerId = sanitizeString\(req\.query\?\.payerId \|\| req\.query\?\.payer_id, 120\)/);
  assert.match(route, /const suggestionPayer = isUuid\(requestedSuggestionPayerId\)/);
  assert.match(route, /if \(requestedSuggestionPayerId && !suggestionPayer\) return res\.status\(404\)\.json\(payerSafeError\(404\)\)/);
  assert.match(route, /payerId: suggestionPayer\?\.id \|\| billingContext\?\.payer_id/);
  assert.match(route, /payerName: suggestionPayer\?\.name \|\| requestedSuggestionPayerName/);
  assert.doesNotMatch(route, /upsertAppointmentBillingContextRow/);
});

test('billing-context expõe autorizações disponíveis por pagador sem reaproveitar outro convênio', () => {
  assert.match(serverCode, /async function listAppointmentTissAuthorizationOptionsForBilling/);
  assert.match(serverCode, /app\.get\('\/api\/appointments\/billing-suggestion'/);
  assert.match(dataServiceCode, /async getAppointmentBillingSuggestion/);
  assert.match(serverCode, /availableTissAuthorizations/);
  assert.match(serverCode, /availabilityGroup/);
  assert.match(serverCode, /no_balance/);
  assert.match(serverCode, /other_service/);
  assert.match(serverCode, /expectedTussCode/);
  assert.match(serverCode, /sameTussCode/);
  assert.match(serverCode, /\.eq\('payer_id', payerId\)/);
  assert.match(calendarCode, /Autorizacoes disponiveis|Autoriza/);
  assert.match(calendarCode, /applyAvailableTissAuthorizationToBillingForm/);
  assert.match(calendarCode, /canUseForAppointment/);
  assert.match(coordinatorCode, /Autoriza..es dispon.veis/);
  assert.match(coordinatorCode, /Usar esta autoriza..o/);
  assert.match(coordinatorCode, /Selecionar n.o consome saldo/);
});

test('detalhe da consulta mostra validação financeira guiada', () => {
  assert.match(calendarCode, /financialValidationItems/);
  assert.match(calendarCode, /Validar financeiro da consulta/);
  assert.match(calendarCode, /Validacao financeira da consulta/);
  assert.match(calendarCode, /Pronta para faturamento/);
  assert.match(calendarCode, /Pronta com alerta/);
  assert.match(calendarCode, /Bloqueada para faturamento/);
  for (const label of ['Pagador', 'Plano/carteirinha', 'Guia/autorizacao', 'Servico', 'TUSS/DePara', 'Valor', 'Anti-glosa']) {
    assert.match(calendarCode, new RegExp(label));
  }
});

test('override manual de pagador fica marcado em metadata sem apagar sala ou profissional', () => {
  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /const normalizedBillingContextSource = appliedTissAuthorization\?\.authorizationId/);
  assert.match(route, /const hasManualBillingOverride = normalizedBillingContextSource === 'MANUAL'/);
  assert.match(route, /manual_override: hasManualBillingOverride \|\| undefined/);
  assert.match(route, /manual_override_fields: hasManualBillingOverride \? manualOverrideFields : undefined/);
  assert.doesNotMatch(route, /room_id|roomId|therapist_id|professional_id|responsible_professional_id/);
});

test('fechamento usa pagador da consulta, nao plano do paciente como substituto', () => {
  const payerBlockIndex = closureCode.indexOf("'payer_linked'");
  assert.ok(payerBlockIndex > 0, 'payer_linked deve existir');
  const payerInputIndex = closureCode.indexOf('const appointmentPayerId');
  assert.ok(payerInputIndex > 0, 'entrada de pagador do fechamento deve existir');
  const payerBlock = closureCode.slice(payerInputIndex, payerBlockIndex + 900);
  assert.match(closureCode, /const hasAppliedPayerByName = !appointmentPayerId && financialContextType === 'INSURANCE' && Boolean\(appointmentPayerName\)/);
  assert.match(closureCode, /const hasAppliedPayer = Boolean\(appointmentPayerId \|\| hasAppliedPayerByName\)/);
  assert.match(closureCode, /const payerLinkedStatus: ClosureCheckStatus = hasAppliedPayer \|\| nonInsuranceFinancialContext \? 'PASSED' : 'FAILED'/);
  assert.match(closureCode, /Pagador sugerido pelo plano financeiro/);
  assert.match(closureCode, /Contexto financeiro definido/);
  assert.match(payerBlock, /appointmentPayerId/);
  assert.match(payerBlock, /suggestedPayerName/);
  assert.doesNotMatch(payerBlock, /suggestedPayerName\s*\?\s*'PASSED'/);
  assert.doesNotMatch(payerBlock, /input\.patient\?\.financialPlans/);
});

test('endpoint de fechamento usa billing context efetivo antes de montar checklist', () => {
  assert.match(serverCode, /const resolveEffectiveClosureBillingContext = async/);
  const effectiveStart = serverCode.indexOf('const resolveEffectiveClosureBillingContext = async');
  const persistStart = serverCode.indexOf('const persistAppointmentClosureCheck = async');
  assert.ok(effectiveStart > 0 && persistStart > effectiveStart, 'resolvedor efetivo deve existir antes da persistencia do fechamento');
  const effectiveSlice = serverCode.slice(effectiveStart, persistStart);
  assert.match(effectiveSlice, /const appointmentBillingPayload = mergeAppointmentBillingPayload\(appointment\)/);
  assert.match(effectiveSlice, /resolveAppointmentBillingSuggestion/);
  assert.match(effectiveSlice, /payerId: sanitizeString\(base\?\.payer_id \|\| appointmentPayerId, 120\) \|\| null/);
  assert.match(effectiveSlice, /payerName: sanitizeString\(base\?\.payer_name_snapshot \|\| appointmentPayerName, 180\) \|\| null/);
  assert.match(effectiveSlice, /const suggestionHasTissAuthorization = Boolean/);
  assert.match(effectiveSlice, /base\?\.payer_name_snapshot \|\|\s*appointmentPayerName \|\|/);
  assert.match(effectiveSlice, /payer_name_snapshot: effectivePayerName \|\| null/);
  assert.match(effectiveSlice, /appointmentBillingPayload\?\.insurance_card_number/);
  assert.match(effectiveSlice, /appointmentBillingPayload\?\.insurance_plan_name/);
  assert.match(effectiveSlice, /authorization_code: sanitizeString\(/);
  assert.match(effectiveSlice, /appointmentBillingPayload\?\.authorization_code/);
  assert.match(effectiveSlice, /guide_number: sanitizeString\(/);
  assert.match(effectiveSlice, /appointmentBillingPayload\?\.guide_number/);
  assert.match(effectiveSlice, /source: sanitizeString\(base\?\.source \|\| \(suggestionHasTissAuthorization \? 'PATIENT_TISS_AUTHORIZATION' : null\), 60\) \|\| null/);

  const persistEnd = serverCode.indexOf('const result = await upsertAppointmentClosureCheckRow', persistStart);
  const persistSlice = serverCode.slice(persistStart, persistEnd);
  assert.match(persistSlice, /const billingContext = await resolveEffectiveClosureBillingContext/);
  assert.match(persistSlice, /payer_name_snapshot: billingContext\?\.payer_name_snapshot \|\| null/);
  assert.match(persistSlice, /authorization_code: billingContext\?\.authorization_code \|\| null/);
  assert.match(persistSlice, /guide_number: billingContext\?\.guide_number \|\| null/);
  assert.doesNotMatch(persistSlice, /payer_name_snapshot: sanitizeString\(billingContext\?\.payer_name_snapshot \|\| \(context as any\)\.requirements\?\.payerName/);
});

test('modal do fechamento mostra pagador sugerido sem marcar como aplicado', () => {
  const normalizeStart = serverCode.indexOf('function normalizeHydratedClosureChecklist');
  assert.ok(normalizeStart > 0, 'normalizador do checklist hidratado deve existir');
  const normalizeSlice = serverCode.slice(normalizeStart, normalizeStart + 1500);
  assert.match(serverCode, /const repairChecklistDisplayText/);
  assert.match(normalizeSlice, /const payerName = sanitizeString\(hydratedRow\?\.payer_name \|\| hydratedRow\?\.payer_name_snapshot, 180\)/);
  assert.match(normalizeSlice, /const hasRealPayer = isUuid\(sanitizeString\(hydratedRow\?\.payer_id, 120\)\) \|\| Boolean\(payerName && payerName !== 'Sem pagador'\)/);
  assert.match(normalizeSlice, /label: repairChecklistDisplayText\(item\?\.label, 180\)/);
  assert.match(normalizeSlice, /message: repairChecklistDisplayText\(item\?\.message, 800\)/);
  assert.match(normalizeSlice, /status: hasRealPayer \? 'PASSED' : 'FAILED'/);
  assert.match(normalizeSlice, /Pagador \$\{payerName \|\| 'informado'\} aplicado ao atendimento/);
  assert.match(normalizeSlice, /Pagador sugerido pelo plano financeiro/);
  assert.match(normalizeSlice, /Ainda não aplicado ao atendimento/);

  const detailStart = serverCode.indexOf("app.get('/api/closure/appointments/:appointmentId'");
  const detailEnd = serverCode.indexOf("app.post('/api/closure/appointments/:appointmentId/revalidate'", detailStart);
  assert.ok(detailStart > 0 && detailEnd > detailStart, 'detalhe do fechamento deve existir');
  const detailSlice = serverCode.slice(detailStart, detailEnd);
  assert.match(detailSlice, /const generated = await persistAppointmentClosureCheck\(\{ appointmentId, user: req\.session\.user, force: true \}\)/);
  assert.match(detailSlice, /const hydratedRows = await hydrateConferenceRows\(\[data\], clinicId, req\.session\.user\)/);
  assert.match(detailSlice, /checklist: normalizeHydratedClosureChecklist\(data\?\.checklist, hydratedDetail\)/);

  const hydrateStart = serverCode.indexOf('const hydrateConferenceRows');
  const hydrateEnd = serverCode.indexOf('const loadConferenceClosureRows', hydrateStart);
  assert.ok(hydrateStart > 0 && hydrateEnd > hydrateStart, 'hidratação do fechamento deve existir');
  const hydrateSlice = serverCode.slice(hydrateStart, hydrateEnd);
  assert.match(hydrateSlice, /const billingPayerName = sanitizeString\(billing\?\.payer_name_snapshot, 180\)/);
  assert.match(hydrateSlice, /billing\?\.payer_id \|\| billingPayerName \? 'INSURANCE' : null/);
  assert.match(hydrateSlice, /const billingPayerId = sanitizeString\(billing\?\.payer_id, 120\)/);
  assert.match(hydrateSlice, /const appliedPayerId = isUuid\(rowPayerId\) \? rowPayerId : isUuid\(billingPayerId\) \? billingPayerId : null/);
  assert.match(hydrateSlice, /const hasBillingPayerName = billingContextType === 'INSURANCE' && Boolean\(billingPayerName && billingPayerName !== 'Sem pagador'\)/);
  assert.match(hydrateSlice, /const hasClosurePayerName = Boolean\(rowPayerName && rowPayerName !== 'Sem pagador'\)/);
  assert.match(hydrateSlice, /const hasRealPayer = isUuid\(appliedPayerId\) \|\| hasBillingPayerName \|\| hasClosurePayerName/);
  assert.match(hydrateSlice, /payer_id: appliedPayerId/);
  assert.match(hydrateSlice, /payer_name: hasRealPayer \? appliedPayerName : 'Sem pagador'/);
  assert.match(hydrateSlice, /financial_context_type: billingContextType \|\| \(hasClosurePayerName \? 'INSURANCE' : null\)/);
  assert.match(hydrateSlice, /insurance_plan_name: sanitizeString\(billing\?\.insurance_plan_name \|\| patient\?\.insurance_plan_category, 160\) \|\| null/);

  assert.match(operationalClosureCode, /payer_id\?: string \| null/);
  assert.match(operationalClosureCode, /suggested_payer_name\?: string \| null/);
  assert.match(operationalClosureCode, /function hasAppliedPayer/);
  assert.match(operationalClosureCode, /return Boolean\(String\(row\?\.payer_id \|\| ""\)\.trim\(\)\)/);
  assert.match(operationalClosureCode, /Pagador sugerido pelo plano financeiro: \{detail\.suggested_payer_name\}\. Ainda não aplicado ao atendimento\./);
  assert.match(operationalClosureCode, /Pagador: \{appliedPayerLabel\(detail\)\}/);
});

test('detalhe corrige labels do histórico operacional sem mojibake', () => {
  assert.match(calendarCode, /Histórico operacional/);
  assert.match(calendarCode, /Sessão assinada por/);
  assert.match(calendarCode, /Ação registrada/);
  assert.doesNotMatch(calendarCode, /HistÃ³rico operacional/);
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
