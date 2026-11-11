import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const profileSource = fs.readFileSync('src/utils/patientProfileType.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const exports = {};
vm.runInNewContext(
  ts.transpileModule(profileSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, Date },
  { filename: 'patientProfileType.cjs' },
);
const { resolvePatientRegistrationCategory, resolvePatientProfileTypeForCategory, resolvePatientPortalKind } = exports;

// A opção salvo no banco usa patient_group; não cair silenciosamente no default.
for (const group of ['infantil', 'adolescente', 'adulto', 'idoso']) {
  assert.equal(resolvePatientRegistrationCategory({ patient_group: group }), group);
}
assert.equal(resolvePatientRegistrationCategory({ group: 'adulto', patient_group: 'infantil' }), 'infantil', 'banco prevalece sobre alias local antigo');
assert.equal(resolvePatientRegistrationCategory({ patient_profile_type: 'KIDS' }), 'infantil');
assert.equal(resolvePatientRegistrationCategory({ patient_profile_type: 'ABA' }), 'adulto');

assert.equal(resolvePatientProfileTypeForCategory('infantil', 'ADULT'), 'KIDS');
assert.equal(resolvePatientProfileTypeForCategory('adolescente', 'ADULT'), 'KIDS');
assert.equal(resolvePatientProfileTypeForCategory('adulto', 'KIDS'), 'ADULT');
assert.equal(resolvePatientProfileTypeForCategory('idoso', 'KIDS'), 'ADULT');
assert.equal(resolvePatientProfileTypeForCategory('adulto', 'ABA'), 'ABA', 'não converter adulto ABA em convencional');
assert.equal(resolvePatientProfileTypeForCategory('infantil', 'KIDS'), 'KIDS', 'repetição idempotente');
assert.equal(resolvePatientProfileTypeForCategory('infantil', 'ABA'), 'KIDS');
assert.equal(resolvePatientProfileTypeForCategory('adulto', 'ADULT'), 'ADULT');

assert.equal(resolvePatientPortalKind({
  patient_group: 'infantil',
  patient_profile_type: 'ADULT',
  age: null,
}), 'KIDS', 'registro legado infantil não pode iniciar sessão adulta');
assert.equal(resolvePatientPortalKind({
  group: 'adulto',
  patient_group: 'infantil',
  patient_profile_type: 'ADULT',
  age: null,
}), 'KIDS', 'categoria canônica prevalece sobre estado local obsoleto');
assert.equal(resolvePatientPortalKind({
  patient_group: 'adolescente',
  patient_profile_type: 'ADULT',
  age: null,
}), 'KIDS');
assert.equal(resolvePatientPortalKind({
  patient_group: 'adulto',
  patient_profile_type: 'ADULT',
  age: null,
}), 'ADULT_CONVENTIONAL');
assert.equal(resolvePatientPortalKind({
  patient_group: 'adulto',
  patient_profile_type: 'ABA',
  age: null,
}), 'ADULT_ABA');

// Assegura os três limites: dropdown -> backend -> leitura autenticada após o Salvar.
assert.match(coordinator, /field === 'grupo'[\s\S]{0,230}resolvePatientProfileTypeForCategory\(value, prev\.patientProfileType\)/);
assert.match(coordinator, /grupo: resolvePatientRegistrationCategory\(patient\)/);
assert.match(coordinator, /const canonicalProfileType = normalizePatientProfileType\(/);
assert.match(coordinator, /field === 'patientProfileType'[\s\S]{0,650}grupo: portalProfile === 'KIDS'/,
  'explicit portal change must keep the server category guard consistent');
assert.match(coordinator, /patientRegistrationSaveInFlightRef\.current = true/);
assert.match(coordinator, /patientRegistrationSaveInFlightRef\.current = false/);
assert.match(coordinator, /if \(updateResult\?\.success !== true\)/);
// Salvar deve falhar fechado: resposta ausente/ambigua nao pode fechar o modal nem registrar sucesso.
const patientCreateAckCondition = coordinator.match(/const addPatientResult = await onAddPatient\(newPatient\);\s*if \((addPatientResult\?\.success !== true)\) \{/);
assert.ok(patientCreateAckCondition, 'cadastro de paciente deve exigir success === true explicitamente');
for (const result of [undefined, null, {}, { success: false }, { success: 0 }, { success: 'true' }]) {
  assert.equal(vm.runInNewContext(patientCreateAckCondition[1], { addPatientResult: result }), true,
    'resposta sem confirmacao explicita nao pode ser tratada como cadastro concluido');
}
assert.equal(vm.runInNewContext(patientCreateAckCondition[1], { addPatientResult: { success: true } }), false,
  'confirmacao explicita deve preservar o caminho de sucesso existente');
assert.match(dataService, /async updatePatient\([\s\S]{0,410}requireServerAck: options\?\.requireServerAck === true/);
assert.match(dataService, /async confirmPatientCategoryOnServer\([\s\S]{0,1000}fetchNoStoreJsonWithRetry/);
assert.match(dataService, /persisted\.patient_group \?\? persisted\.group/);
assert.match(app, /requireServerAck: mustConfirmPatientCategory/);
assert.match(app, /confirmPatientCategoryOnServer\(/);
assert.match(app, /mustConfirmSavedPatientProfile/);
assert.match(app, /hasExplicitPortalPatch && confirmedProfileType !== updatedProfileType/);
assert.match(app, /rollbackOptimisticPatientState\(\)/);
assert.match(server, /patient_group: sanitizeString\(body\?\.group \|\| body\?\.patient_group \|\| body\?\.grupo, 80\)/);
assert.match(server, /supabase\.rpc\('verto_update_patient_aggregate_atomic'/);
assert.match(server, /app\.get\('\/api\/patients', checkAuth, requireClinicCapability\('patient\.list'\)/);

console.log('p000PatientCategoryPersistence.regression.test.mjs: ok (persisted aliases, pediatric routing, adult ABA, ACK, readback, duplicate-save guard)');
