import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const appCode = read('src/App.tsx');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const localDbCode = read('src/services/localDb.ts');
const serverCode = read('server.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2400) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('cadastro rapido e edicao nao anunciam sucesso antes da persistencia', () => {
  const quickRegister = sliceFrom(coordinatorCode, 'const handleQuickRegister = async', 2600);
  assert.match(quickRegister, /const addResult = await onAddPatient\(newPatient\)/);
  assert.match(quickRegister, /addResult\?\.success === false/);
  assert.match(quickRegister, /finally\s*\{\s*hideProcessing\(\)/);

  const fullFormSave = sliceFrom(coordinatorCode, 'if (editingPatientId && onUpdatePatient)', 1200);
  assert.match(fullFormSave, /const updateResult = await onUpdatePatient\(newPatient\)/);
  assert.match(fullFormSave, /updateResult\?\.success === false/);

  const deletePatient = sliceFrom(coordinatorCode, 'const handleDeletePatient = async', 2200);
  assert.match(deletePatient, /const updateResult = await onUpdatePatient/);
  assert.match(deletePatient, /updateResult\?\.success === false/);
  assert.match(deletePatient, /finally\s*\{\s*hideProcessing\(\)/);
});

test('app checa retorno de persistencia antes de confirmar update cadastral', () => {
  const updatePatient = sliceFrom(appCode, 'const handleUpdatePatient = async', 11000);
  assert.match(updatePatient, /const deleteResult = await dataService\.deletePatient/);
  assert.match(updatePatient, /return \{ success: false, error: errorMessage \}/);
  assert.match(updatePatient, /const updateResult = await dataService\.updatePatient/);
  assert.match(updatePatient, /Não foi possível confirmar a persistência do cadastro/);
  assert.match(updatePatient, /const patientRecordResult = await dataService\.savePatientRecord/);
  assert.match(updatePatient, /return \{ success: true \}/);
});

test('estado operacional mutavel tem caminho persistente explicito', () => {
  const clinicStateSync = sliceFrom(appCode, 'clinicStateSyncTimerRef.current = setTimeout', 1600);
  assert.match(clinicStateSync, /appointments:\s*therapistAgenda/);
  assert.match(clinicStateSync, /payload\.rooms = rooms/);
  assert.match(clinicStateSync, /payload\.protocols = protocols/);
  assert.match(clinicStateSync, /await dataService\.saveClinicState\(payload\)/);

  const dataServiceCore = sliceFrom(dataServiceCode, 'async savePatient(patient: any)', 2400);
  for (const helper of ['savePatient', 'savePatientRecord', 'updatePatient', 'deletePatient']) {
    assert.match(dataServiceCode, new RegExp(`async ${helper}\\(`));
  }
  assert.match(dataServiceCore, /saveOfflineFirst/);
});

test('offline first criptografado e sync nao perdem mutacoes pendentes', () => {
  const saveOfflineFirst = sliceFrom(dataServiceCode, 'async function saveOfflineFirst', 3200);
  assert.match(saveOfflineFirst, /await saveEncryptedRecord/);
  assert.match(saveOfflineFirst, /sync_status:\s*'pending'/);
  assert.match(saveOfflineFirst, /markRecordSyncStatus\(id, 'synced'\)/);
  assert.match(saveOfflineFirst, /markRecordSyncFailure/);

  assert.match(localDbCode, /AES-GCM/);
  assert.match(localDbCode, /getPendingRecords/);
  assert.match(localDbCode, /syncOfflineData/);
  assert.match(localDbCode, /isIdempotentConflictPayload/);
});

test('backend mantem selects explicitos nos caminhos auditados', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  for (const constantName of [
    'PATIENT_MUTATION_SELECT',
    'PATIENT_ANAMNESIS_REQUEST_SELECT',
    'PATIENT_ANAMNESIS_RESPONSE_SELECT',
    'ANAMNESIS_TEMPLATE_SELECT'
  ]) {
    assert.match(serverCode, new RegExp(`const ${constantName}`));
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

console.log(`${passed}/${tests.length} system persistence audit checks passed`);
