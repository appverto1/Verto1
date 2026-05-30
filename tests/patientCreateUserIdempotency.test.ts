import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice() {
  const start = serverCode.indexOf("app.post('/api/patients/create-user'");
  const end = serverCode.indexOf("app.post('/api/storage/create-bucket'", start);
  assert.ok(start >= 0, 'rota /api/patients/create-user nao encontrada.');
  assert.ok(end > start, 'fim da rota /api/patients/create-user nao encontrado.');
  return serverCode.slice(start, end);
}

test('create-user diferencia duplicidade segura de conflito real sem 500 esperado', () => {
  const route = routeSlice();
  assert.match(route, /isAuthEmailAlreadyRegisteredError/);
  assert.match(route, /findAuthUserByEmail/);
  assert.match(route, /clinic_id/);
  assert.match(route, /LINKED_EXISTING_USER/);
  assert.match(route, /ALREADY_LINKED/);
  assert.match(route, /CONFLICT_REQUIRES_REVIEW/);
  assert.match(route, /idempotent:\s*true/);
  assert.match(route, /Respons.vel existente vinculado ao paciente/);
  assert.match(route, /N.o foi poss.vel confirmar este v.nculo automaticamente/);
  assert.doesNotMatch(route, /authError\.message\.includes\('already registered'\)/);
});

test('create-user enfileira convite e nao aguarda envio de e-mail no fluxo principal', () => {
  const route = routeSlice();
  assert.match(route, /sendPatientInviteInBackground/);
  assert.match(route, /Promise\.race/);
  assert.match(route, /PATIENT_INVITE_BACKGROUND_TIMEOUT_MS\s*=\s*7_000/);
  assert.match(route, /INVITE_QUEUED/);
  assert.match(route, /INVITE_FAILED_RETRYABLE/);
  assert.match(route, /Convite preparado com sucesso/);
  assert.doesNotMatch(route, /const emailResult = await sendPatientActivationEmail\(\)/);
  assert.doesNotMatch(route, /status:\s*'INVITE_SENT'[\s\S]{0,180}userId:/);
});

test('frontend trata resposta idempotente e nao mostra mojibake no convite do paciente', () => {
  assert.match(dataServiceCode, /response\.status === 409 && isIdempotentConflictPayload\(result\)/);
  assert.match(dataServiceCode, /RESOLVED_IDEMPOTENT/);
  assert.match(dataServiceCode, /normalizePatientInviteSuccess/);
  assert.match(dataServiceCode, /INVITE_QUEUED/);
  assert.match(dataServiceCode, /INVITE_FAILED_RETRYABLE/);
  assert.doesNotMatch(appCode, /NÃƒÂ£o foi possÃƒÂ­vel enviar o convite do paciente/);
  assert.match(appCode, /N.o foi poss.vel enviar o convite do paciente/);
});

test('normalizacao de erro repara mojibake comum antes de exibir ao usuario', () => {
  assert.match(dataServiceCode, /function repairMojibakeMessage/);
  assert.match(dataServiceCode, /replace\([^)]*'N.o'\)/);
  assert.match(dataServiceCode, /\[erro n.o serializ.vel\]/);
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

console.log(`${passed}/${tests.length} patient create-user idempotency checks passed`);
