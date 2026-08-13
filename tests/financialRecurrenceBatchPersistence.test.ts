import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

function routeBlock(start: string, end: string) {
  const startIndex = server.indexOf(start);
  const endIndex = server.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `rota ausente: ${start}`);
  assert.ok(endIndex > startIndex, `limite da rota ausente: ${end}`);
  return server.slice(startIndex, endIndex);
}

const patientCreate = routeBlock(
  "app.post('/api/payments/batch'",
  "app.post('/api/payments'",
);
const patientUpdate = routeBlock(
  "app.patch('/api/payments/batch'",
  "app.patch('/api/payments/:paymentId'",
);
const professionalCreate = routeBlock(
  "app.post('/api/financial/professional-payments/batch'",
  "app.post('/api/financial/professional-payments'",
);
const professionalUpdate = routeBlock(
  "app.patch('/api/financial/professional-payments/batch'",
  "app.patch('/api/financial/professional-payments/:paymentId'",
);

assert.doesNotMatch(
  dashboard,
  /Promise\.all\(paymentsToCreate\.map[\s\S]{0,160}savePayment/,
  'a recorrência do paciente não pode criar uma chamada por parcela',
);
assert.doesNotMatch(
  dashboard,
  /Promise\.all\(payloads\.map[\s\S]{0,160}saveProfessionalPayment/,
  'a recorrência profissional não pode criar uma chamada por parcela',
);
assert.match(dashboard, /dataService\.savePaymentsBatch\(paymentsToCreate\)/);
assert.match(dashboard, /dataService\.updatePaymentsBatch\(/);
assert.match(dashboard, /dataService\.saveProfessionalPaymentsBatch\(payloads\)/);
assert.match(dashboard, /dataService\.updateProfessionalPaymentsBatch\(/);
assert.match(dashboard, /if \(paymentSaveInFlightRef\.current\) return;[\s\S]*?paymentSaveInFlightRef\.current = true;/,
  'duplo clique não pode criar ou editar a série financeira duas vezes');
assert.match(dashboard, /if \(professionalPaymentSaveInFlightRef\.current\) return;[\s\S]*?professionalPaymentSaveInFlightRef\.current = true;/,
  'duplo clique não pode criar ou editar a série de repasses duas vezes');
assert.match(dashboard, /finally \{[\s\S]*?paymentSaveInFlightRef\.current = false;[\s\S]*?setIsPaymentSaving\(false\);/,
  'a trava financeira deve ser liberada inclusive após erro');
assert.match(dashboard, /finally \{[\s\S]*?professionalPaymentSaveInFlightRef\.current = false;[\s\S]*?setIsProfessionalPaymentSaving\(false\);/,
  'a trava de repasse deve ser liberada inclusive após erro');
assert.match(dashboard, /disabled=\{isPaymentSaving\}[\s\S]*?aria-busy=\{isPaymentSaving\}/,
  'o botão de cobrança precisa comunicar e impedir novo envio enquanto salva');
assert.match(dashboard, /disabled=\{isProfessionalPaymentSaving\}[\s\S]*?aria-busy=\{isProfessionalPaymentSaving\}/,
  'o botão de repasse precisa comunicar e impedir novo envio enquanto salva');

for (const method of [
  'savePaymentsBatch',
  'updatePaymentsBatch',
  'saveProfessionalPaymentsBatch',
  'updateProfessionalPaymentsBatch',
]) {
  assert.match(dataService, new RegExp(`async ${method}\\(`), `${method} precisa existir no serviço`);
}
assert.match(dataService, /saveOfflineFirst\([\s\S]{0,260}'\/api\/payments\/batch'/);
assert.match(dataService, /saveOfflineFirst\([\s\S]{0,300}'\/api\/financial\/professional-payments\/batch'/);
assert.match(dataService, /id: String\(payment\?\.id \|\| generateId\(\)\)/);
assert.match(dataService, /requestedAt: new Date\(\)\.toISOString\(\)/);

for (const block of [patientCreate, professionalCreate]) {
  assert.equal((block.match(/\.insert\(payloads\)/g) || []).length, 1, 'a série deve usar um único insert em lote');
  assert.doesNotMatch(block, /\.insert\(\[payload/);
  assert.match(block, /idempotent:\s*true/);
  assert.match(block, /series_request_hash/);
  assert.match(block, /IDEMPOTENCY_CONFLICT/);
  assert.match(block, /recurrenceGroups\.size !== 1/);
  assert.match(block, /recurrenceIndexes\.has\(recurrenceIndex\)/);
  assert.match(block, /clinic_id:\s*clinicId/);
  assert.doesNotMatch(block, /clinic_id:\s*(?:item|req\.body)/);
  assert.match(block, /\.insert\(payloads\)\.select\(/,
    'a resposta deve reutilizar as linhas efetivamente persistidas');
}

assert.match(patientCreate, /\.from\('patients'\)[\s\S]*?\.eq\('clinic_id', clinicId\)/,
  'pacientes da série devem ser validados no tenant pelo servidor');
assert.match(server, /loadProfessionalPaymentIdentities[\s\S]*?\.from\('clinic_memberships'\)[\s\S]*?\.eq\('clinic_id', clinicId\)[\s\S]*?\.eq\('role', 'therapist'\)[\s\S]*?\.eq\('status', 'active'\)/,
  'profissionais da série devem ter membership ativa na clínica');
assert.match(patientCreate, /\.select\('id,name'\)[\s\S]*?patientNamesById/,
  'o nome persistido precisa vir do cadastro canonico carregado em lote');
assert.match(professionalCreate, /loadProfessionalPaymentIdentities\(clinicId, professionalIds\)/,
  'nome e especialidade devem vir da identidade profissional canônica');
assert.match(professionalUpdate,
  /professionalIdentityInputProvided && !professionalIdInputProvided[\s\S]*PROFESSIONAL_PAYMENT_IDENTITY_REQUIRES_ID/,
  'nome ou especialidade nao podem ser atualizados sem a identidade canonica do profissional');
assert.match(professionalUpdate,
  /if \(professionalIdInputProvided\)[\s\S]*loadProfessionalPaymentIdentities\(clinicId, \[patchBase\.professional_id\]\)[\s\S]*patchBase\.professional_name = identity\.name[\s\S]*patchBase\.specialty = identity\.specialty/,
  'o PATCH deve validar e reidratar nome e especialidade a partir do professional_id');

for (const block of [patientUpdate, professionalUpdate]) {
  assert.equal((block.match(/\.rpc\('apply_financial_series_update_v1'/g) || []).length, 1,
    'a série deve usar um único RPC transacional em lote');
  assert.match(block, /p_row_ids:\s*paymentIds/);
  assert.match(block, /p_clinic_id:\s*clinicId/);
  assert.doesNotMatch(block, /for\s*\([^)]*paymentIds/);
  assert.match(block, /updateRequestHash/);
  assert.match(block, /UPDATE_IDEMPOTENCY_CONFLICT/);
  assert.doesNotMatch(block, /updated_at:\s*requestedAt|updated_at:\s*req\.body/,
    'o navegador não pode retroagir a auditoria da série');
}
assert.match(server, /loadPersistedFinancialSeriesRows[\s\S]*\.in\('id', ids\)/,
  'retry deve consultar ids em lotes limitados, sem URL com ate 2.000 UUIDs');
assert.match(server, /table: 'payments'[\s\S]*select: `\$\{PAYMENT_SELECT\},series_request_hash`/,
  'retry de cobranca deve devolver a linha persistida, nao payload reconstruido');
assert.match(server, /table: 'professional_payments'[\s\S]*select: `\$\{PROFESSIONAL_PAYMENT_SELECT\},series_request_hash`/,
  'retry de repasse deve devolver a linha persistida, nao payload reconstruido');
for (const block of [patientUpdate, professionalUpdate]) {
  assert.match(block, /asSafeNumber\(value, 0, 1_000_000\) === null/,
    'numero invalido deve retornar 400 antes da RPC');
  assert.match(block, /Data de (?:pagamento|vencimento) invalida/,
    'data invalida nao pode virar null silenciosamente');
}

assert.match(server, /MAX_FINANCIAL_SERIES_ITEMS = 2000/);
assert.match(server, /financialSeriesIdempotencyKey/);
assert.match(server, /app\.post\('\/api\/payments'/, 'o fluxo individual de paciente deve ser preservado');
assert.match(server, /app\.patch\('\/api\/payments\/:paymentId'/, 'a edição individual de paciente deve ser preservada');
assert.match(server, /app\.post\('\/api\/financial\/professional-payments'/, 'o fluxo individual profissional deve ser preservado');
assert.match(server, /app\.patch\('\/api\/financial\/professional-payments\/:paymentId'/, 'a edição individual profissional deve ser preservada');

console.log('financialRecurrenceBatchPersistence.test.ts: ok');
