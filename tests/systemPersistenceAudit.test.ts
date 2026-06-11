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

test('diario da familia usa historico como fonte persistente e idempotente', () => {
  const familySave = sliceFrom(appCode, 'const handleAddFamilyNote = async', 4800);
  assert.match(familySave, /const recordId = createAppointmentId\(\)/);
  assert.match(familySave, /const createdAt = new Date\(\)\.toISOString\(\)/);
  assert.match(familySave, /id:\s*recordId/);
  assert.match(familySave, /patient_id:\s*targetPatientId/);
  assert.match(familySave, /image_path:\s*imagePath \|\| null/);
  assert.match(familySave, /created_at:\s*createdAt/);
  assert.match(familySave, /source:\s*isSimpleNote \? 'family_portal_note' : 'family_portal'/);
  assert.match(familySave, /const persistedPatientId = String\(historySaveResult\.data\.patient_id \|\| historySaveResult\.data\.patientId \|\| ''\)\.trim\(\)/);
  assert.match(familySave, /setResolvedPatientPortalId\(persistedPatientId\)/);
  assert.match(familySave, /return \{ success: true, data: historySaveResult\?\.data \|\| newHistoryItem \}/);
  assert.match(appCode, /const refreshPatientHistoryForProfessional = async \(patientId: any\) =>/);
  assert.match(appCode, /dataService\.getHistory\(normalizedPatientId\)/);
  assert.match(appCode, /const next = mergeHistoryRecords\(prev, result\.data, normalizedPatientId\)/);
  assert.match(appCode, /historyRef\.current = next/);
  assert.match(coordinatorCode, /onRefreshPatientHistory\?: \(patientId: any\) => Promise<any> \| any/);
  assert.match(coordinatorCode, /onRefreshPatientHistory\?\.?\(resolvedPatient\.id\)/);

  const historyRoute = sliceFrom(serverCode, "app.post('/api/history'", 6200);
  assert.match(historyRoute, /const incomingHistoryId = sanitizeString\(req\.body\?\.id/);
  assert.match(historyRoute, /selectTodayPhotos\('patient_id', resolvedPatientId\)/);
  assert.match(historyRoute, /selectTodayPhotos\('patient_email', safeEmail\)/);
  assert.match(historyRoute, /\.eq\(field, value\)/);
  assert.match(historyRoute, /const sameUploadedPhoto = todayPhotos\.find/);
  assert.match(historyRoute, /FAMILY_DAILY_PHOTO_ALREADY_SAVED/);
  assert.match(historyRoute, /idempotent:\s*true/);
  assert.match(historyRoute, /FAMILY_DAILY_PHOTO_LIMIT/);
  assert.match(historyRoute, /todayPhotos\.length >= FAMILY_DAILY_PHOTO_LIMIT/);
  assert.doesNotMatch(historyRoute, /\.select\(\s*['"`]\*['"`]\s*\)/);
});

test('estrelinhas do diario sao persistidas para o portal do paciente', () => {
  const updateHistory = sliceFrom(appCode, 'const handleUpdateHistoryItem = async', 11000);
  assert.match(updateHistory, /resolvePatientEmailForMilestone/);
  assert.match(updateHistory, /stableUuidFromString\(`family-milestone:\$\{sourceRef\}`\)/);
  assert.match(updateHistory, /source:\s*'family_milestone_event'/);
  assert.match(updateHistory, /dataService\.updateNote\(String\(noteId\)/);
  assert.match(updateHistory, /const historyUpdateResult = await dataService\.updateHistoryItem/);
  assert.match(updateHistory, /return false/);
  assert.match(updateHistory, /const previousTherapistNotes = therapistNotes/);
  assert.match(updateHistory, /const previousHistory = history/);
  assert.match(updateHistory, /setHistory\(previousHistory\)/);
  assert.match(updateHistory, /setTherapistNotes\(previousTherapistNotes\)/);
  assert.match(updateHistory, /Não foi possível salvar a estrelinha agora\. Tente novamente\./);
  assert.match(updateHistory, /throw new Error\(historyUpdateResult\?\.error \|\| 'Falha ao salvar estrela no histórico\.'\)/);
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
