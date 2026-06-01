import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const closureCode = readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260601120000_appointment_billing_context_patient_index.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('endpoint de contexto faz upsert idempotente por consulta', () => {
  assert.match(serverCode, /app\.get\('\/api\/appointments\/:appointmentId\/billing-context'/);
  assert.match(serverCode, /app\.patch\('\/api\/appointments\/:appointmentId\/billing-context'/);
  assert.match(serverCode, /\.upsert\(\[payload\], \{ onConflict: 'organization_id,appointment_id' \}\)/);
  assert.match(serverCode, /void regenerateClosureForAppointments\(\[appointment\.id\], req\.session\.user, 'billing_context_updated'\)/);
  assert.match(serverCode, /message: 'Pagador atualizado\.'/);
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
});

test('criacao da consulta cria contexto inicial sem sobrescrever edicao posterior', () => {
  assert.match(serverCode, /upsertInitialBillingContextFromAppointment/);
  assert.match(serverCode, /if \(existing\.data\?\.id\) return/);
  assert.match(serverCode, /suggestedBilling = await resolveAppointmentBillingSuggestion/);
  assert.match(serverCode, /payer_name_snapshot: payerName \|\| null/);
  assert.match(serverCode, /guide_number: sanitizeString\(params\.appointment\?\.guideNumber/);
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
  assert.match(calendarCode, /Aplicar . consulta/);
  assert.match(calendarCode, /Definir pagador/);
  assert.match(calendarCode, /Editar pagador/);
  assert.doesNotMatch(calendarCode, /onClick=\{\(\) => onEditAppointment\?\.\(detailEvent\)\}[\s\S]{0,140}Editar pagador/);
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
  assert.match(calendarCode, /payerName: String\(payer\?\.name/);
});

test('criacao de pagador reutiliza nome existente na mesma clinica', () => {
  const routeStart = serverCode.indexOf("app.post('/api/admin/payers'");
  assert.ok(routeStart > 0, 'rota de criar pagador deve existir');
  const route = serverCode.slice(routeStart, routeStart + 2600);
  assert.match(route, /\.from\('clinic_payers'\)[\s\S]*\.select\(CLINIC_PAYER_SELECT\)[\s\S]*\.eq\('organization_id', organizationId\)[\s\S]*\.ilike\('name', name\)/);
  assert.match(route, /idempotent:\s*true/);
  assert.match(route, /serializePayer\(existingPayer\)/);
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
