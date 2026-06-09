import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const dataServiceCode = read('src/services/dataService.ts');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const appCode = read('src/App.tsx');
const secureMediaCode = read('src/components/SecureMedia.tsx');
const familyPhotoLimitMigration = read('supabase/migrations/20260609143000_family_diary_photo_limit_five.sql');

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
  assert.match(serverCode, /function buildPatientPhotoViewUrl\(storagePath: unknown\): string \| null/);
  assert.match(serverCode, /\/api\/storage\/patient-photos\/view\?path=/);
  assert.match(serverCode, /if \(storagePath\) return buildPatientPhotoViewUrl\(storagePath\)/);
});

test('upload de midia de perfil usa path deterministico por hash e retry idempotente', () => {
  assert.match(dataServiceCode, /function resolveIdempotentPatientPhotoPath/);
  assert.match(dataServiceCode, /mimeType:\s*'image\/webp'/);
  assert.match(dataServiceCode, /const readDataUrlContentType =/);
  assert.match(dataServiceCode, /contentType:\s*actualOutputType/);
  assert.match(dataServiceCode, /sha256TextHex\(prepared\.dataUrl\)/);
  assert.match(dataServiceCode, /patient-profile:\$\{ownerId\}:\$\{shortHash\}/);
  assert.match(dataServiceCode, /onboarding:\$\{ownerId\}:\$\{kind\}:\$\{shortHash\}/);
  assert.match(dataServiceCode, /idempotent:\s*uploadTarget\.idempotent/);
  assert.match(dataServiceCode, /idempotencyKey:\s*uploadTarget\.idempotencyKey/);

  const storageRoute = routeSlice("app.post('/api/storage/upload'", 7000);
  assert.match(storageRoute, /isIdempotentUpload/);
  assert.match(storageRoute, /isStorageDuplicateObjectError/);
  assert.match(storageRoute, /buildPatientPhotoViewUrl\(objectPath\)/);
  assert.match(storageRoute, /buildPatientPhotoViewUrl\(uploadData\.path\)/);
  assert.match(storageRoute, /idempotent:\s*true/);
  assert.doesNotMatch(storageRoute, /upsert:\s*true/);
});

test('diario da familia permite cinco fotos por dia sem indice unico antigo', () => {
  assert.match(serverCode, /const FAMILY_DAILY_PHOTO_LIMIT = 5/);
  assert.match(serverCode, /todayPhotos\.length >= FAMILY_DAILY_PHOTO_LIMIT/);
  assert.match(serverCode, /at. \${FAMILY_DAILY_PHOTO_LIMIT} fotos por dia/);
  assert.match(familyPhotoLimitMigration, /drop index if exists public\.history_one_photo_per_day/);
  assert.match(familyPhotoLimitMigration, /create index if not exists idx_history_family_photos_patient_day/);
});

test('midia de patient-photos usa proxy autenticado e imagem falhada para de renderizar', () => {
  const viewRoute = routeSlice("app.get('/api/storage/patient-photos/view'", 5000);
  assert.match(viewRoute, /checkAuth/);
  assert.match(viewRoute, /requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner', 'patient'\)/);
  assert.match(viewRoute, /canAccessPatientInCurrentClinic\(ownerPatientId, req\.session\.user\)/);
  assert.match(viewRoute, /supabase\.storage\.from\('patient-photos'\)\.download\(objectPath\)/);
  assert.match(viewRoute, /Cache-Control', 'private, max-age=300'/);
  assert.match(secureMediaCode, /const \[failedSrc, setFailedSrc\]/);
  assert.match(secureMediaCode, /function normalizePatientPhotoSource/);
  assert.match(secureMediaCode, /\/storage\/v1\/object\/sign\/patient-photos\//);
  assert.match(secureMediaCode, /\/api\/storage\/patient-photos\/view\?path=/);
  assert.match(secureMediaCode, /const normalizedSrc = normalizePatientPhotoSource/);
  assert.match(secureMediaCode, /toTrustedMediaUrl\(normalizedSrc\)/);
  assert.match(secureMediaCode, /failedSrc === safeSrc/);
  assert.match(secureMediaCode, /loading=\{loading \|\| "lazy"\}/);
  assert.match(secureMediaCode, /decoding=\{decoding \|\| "async"\}/);
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
