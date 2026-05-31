import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const dataServiceCode = read('src/services/dataService.ts');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const appCode = read('src/App.tsx');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice(marker: string, chars = 2600) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

test('backend normaliza paths com prefixo do bucket antes de renovar URL assinada', () => {
  const helperStart = serverCode.indexOf('function extractPatientPhotosStoragePath');
  const helperEnd = serverCode.indexOf('async function resolvePatientPhotoUrl', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'helper de path de foto nao encontrado.');
  const helper = serverCode.slice(helperStart, helperEnd);
  assert.match(helper, /value\.startsWith\('patient-photos\/'\)/);
  assert.ok(
    helper.indexOf("value.startsWith('patient-photos/')") < helper.indexOf("!value.includes('://')"),
    'prefixo patient-photos precisa ser removido antes do fallback generico de path.'
  );
  assert.match(serverCode, /createSignedUrl\(storagePath, 60 \* 60 \* 24 \* 30\)/);
});

test('upload de midia de perfil usa path deterministico por hash e retry idempotente', () => {
  assert.match(dataServiceCode, /function resolveIdempotentPatientPhotoPath/);
  assert.match(dataServiceCode, /sha256TextHex\(prepared\.dataUrl\)/);
  assert.match(dataServiceCode, /patient-profile:\$\{ownerId\}:\$\{shortHash\}/);
  assert.match(dataServiceCode, /onboarding:\$\{ownerId\}:\$\{kind\}:\$\{shortHash\}/);
  assert.match(dataServiceCode, /idempotent:\s*uploadTarget\.idempotent/);
  assert.match(dataServiceCode, /idempotencyKey:\s*uploadTarget\.idempotencyKey/);

  const storageRoute = routeSlice("app.post('/api/storage/upload'", 7000);
  assert.match(storageRoute, /isIdempotentUpload/);
  assert.match(storageRoute, /isStorageDuplicateObjectError/);
  assert.match(storageRoute, /createSignedUrl\(objectPath, 60 \* 10\)/);
  assert.match(storageRoute, /idempotent:\s*true/);
  assert.doesNotMatch(storageRoute, /upsert:\s*true/);
});

test('perfil de paciente salva foto imediatamente e enfileira PATCH quando servidor cai', () => {
  const updateMethod = dataServiceCode.slice(
    dataServiceCode.indexOf('async updatePatientSelfProfile'),
    dataServiceCode.indexOf('async getUserProfileMedia')
  );
  assert.match(updateMethod, /id:\s*'profile:self'/);
  assert.match(updateMethod, /type:\s*'profile'/);
  assert.match(updateMethod, /method:\s*'PATCH'/);
  assert.match(updateMethod, /endpoint/);
  assert.match(updateMethod, /queued:\s*true/);
  assert.match(updateMethod, /response\.status === 408 \|\| response\.status === 429 \|\| response\.status >= 500/);

  assert.match(patientDashboardCode, /Foto salva com seguran.a/);
  assert.match(patientDashboardCode, /Foto salva localmente/);
  assert.match(patientDashboardCode, /dataService\.updatePatientSelfProfile\(\{/);
});

test('perfil profissional tambem fica em cache pendente sem perder paths de midia', () => {
  const saveMethod = dataServiceCode.slice(
    dataServiceCode.indexOf('async saveUserProfile'),
    dataServiceCode.indexOf('async getUserProfile')
  );
  assert.match(saveMethod, /id:\s*`profile:\$\{userId\}`/);
  assert.match(saveMethod, /type:\s*'profile'/);
  assert.match(saveMethod, /method:\s*'POST'/);
  assert.match(saveMethod, /queued:\s*true/);
  assert.match(saveMethod, /sync_status:\s*'synced'/);

  const profileRoute = routeSlice("app.post('/api/profile/:userId'", 7000);
  assert.match(profileRoute, /profilePicturePath/);
  assert.match(profileRoute, /pathProfilePictureUrl/);
  assert.match(profileRoute, /profilePicturePath:\s*profilePicturePath \|\| existingMetadata\?\.profilePicturePath/);
  assert.match(appCode, /profilePicturePath:\s*profileUpload\.path/);
  assert.match(appCode, /signaturePath:\s*signatureUpload\.path/);
  assert.match(appCode, /clinicLogoPath:\s*clinicLogoUpload\.path/);
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

console.log(`${passed}/${tests.length} profile media persistence checks passed`);
