import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const closureCode = readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8');
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
  assert.doesNotMatch(route, /regenerateClosureForAppointments/);
  assert.match(serverCode, /message: 'Pagador atualizado\.'/);
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
});

test('criacao da consulta cria contexto inicial sem sobrescrever edicao posterior', () => {
  assert.match(serverCode, /upsertInitialBillingContextFromAppointment/);
  assert.match(serverCode, /if \(existing\.data\?\.id\) return/);
  assert.match(serverCode, /suggestedBilling = await resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /payer_name_snapshot: payerName \|\| null/);
  assert.match(serverCode, /insurance_card_number: sanitizeString\(params\.appointment\?\.insuranceCardNumber/);
  assert.match(serverCode, /insurance_plan_name: sanitizeString\(params\.appointment\?\.insurancePlanName/);
  assert.match(serverCode, /guide_number: sanitizeString\(params\.appointment\?\.guideNumber/);
  assert.match(serverCode, /source: sanitizeString\(suggestedBilling\?\.source/);
});

test('sugestao do paciente nao escolhe multiplos planos silenciosamente', () => {
  assert.match(serverCode, /resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /matchingPlans\.length === 1/);
  assert.match(coordinatorCode, /matchingPlans\.length === 1/);
  assert.match(coordinatorCode, /financialPlanMatchesAppointmentService/);
});

test('detalhe da consulta salva pagador no contexto administrativo', () => {
  assert.match(calendarCode, /saveBillingContext/);
  assert.match(calendarCode, /dataService\.updateAppointmentBillingContext/);
  assert.match(calendarCode, /insuranceCardNumber: values\.insuranceCardNumber/);
  assert.match(calendarCode, /insurancePlanName: values\.insurancePlanName/);
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
  assert.match(calendarCode, /currentBilling\?\.hasContext \? currentBilling : currentBilling\?\.suggestion \|\| currentBilling/);
  assert.match(calendarCode, /Dados sugeridos a partir do cadastro do paciente/);
  assert.match(calendarCode, /NÃºmero da carteirinha/);
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
  const fetchSlice = serverCode.slice(fetchStart, fetchStart + 1500);
  assert.match(fetchSlice, /\.from\('appointments'\)[\s\S]*\.select\(CLOSURE_APPOINTMENT_SELECT\)[\s\S]*\.eq\('id', safeAppointmentId\)/);
  assert.match(fetchSlice, /\.or\(`organization_id\.eq\.\$\{organizationId\},clinic_id\.eq\.\$\{organizationId\}`\)/);
  assert.match(fetchSlice, /canAccessPatientInCurrentClinic/);

  const routeStart = serverCode.indexOf("app.patch('/api/appointments/:appointmentId/billing-context'");
  const routeEnd = serverCode.indexOf("app.post('/api/appointments/:appointmentId/required-documents", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /const payer = isUuid\(payerId\) \? await fetchPayerForAdmin\(payerId, organizationId\) : null/);
  assert.match(route, /if \(payerId && !payer\) return res\.status\(404\)\.json\(payerSafeError\(404\)\)/);
});

test('fechamento usa pagador da consulta, nao plano do paciente como substituto', () => {
  const payerBlockIndex = closureCode.indexOf("'payer_linked'");
  assert.ok(payerBlockIndex > 0, 'payer_linked deve existir');
  const payerBlock = closureCode.slice(Math.max(0, payerBlockIndex - 500), payerBlockIndex + 900);
  assert.match(payerBlock, /appointmentPayerContext/);
  assert.doesNotMatch(payerBlock, /input\.patient\?\.financialPlans/);
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
  assert.match(patientDefaultMigrationCode, /add column if not exists insurance_card_number text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists insurance_plan_name text/);
  assert.match(patientDefaultMigrationCode, /add column if not exists source text/);
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
