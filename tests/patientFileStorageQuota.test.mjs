import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260817012000_patient_file_storage_quota.sql', import.meta.url), 'utf8');

const uploadBlock = dataService.slice(dataService.indexOf('async uploadPatientFile'), dataService.indexOf('async deletePatientFile'));
assert.ok(dataService.includes('function dataUrlToBlob'), 'compressed images must be converted locally without a network fetch');
assert.ok(!uploadBlock.includes('fetch(prepared.dataUrl)'), 'image compression must not fetch a data: URL under CSP');

assert.ok(server.includes('PATIENT_FILE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024'), 'server must keep the 1 GiB patient quota');
assert.ok(server.includes("rpc('get_patient_file_storage_usage_v1'"), 'server must read quota with one aggregate RPC');
assert.ok(server.includes("code: 'PATIENT_FILE_QUOTA_UNAVAILABLE'"), 'uploads must fail closed when authoritative quota cannot be checked');
assert.ok(server.includes("code: 'PATIENT_FILE_STORAGE_QUOTA_EXCEEDED'"), 'quota overflow must have a stable API code');
assert.ok(server.includes('isPatientFileQuotaError(insertError)'), 'database race rejection must not fall through to legacy fallback');
assert.match(server, /remove\(\[storagePath\]\)[\s\S]*sendPatientFileQuotaExceeded/, 'storage object must be cleaned if the atomic database quota rejects it');

assert.ok(migration.includes('1073741824'), 'database quota must be exactly 1 GiB');
assert.ok(migration.includes('10485760'), 'database must preserve the 10 MiB per-file limit');
assert.ok(migration.includes('for update'), 'quota trigger must serialize concurrent writes per patient with a row lock');
assert.ok(migration.includes('PATIENT_FILE_STORAGE_QUOTA_EXCEEDED'), 'database trigger must expose a recognizable quota error');
assert.ok(migration.includes('revoke all on function public.get_patient_file_storage_usage_v1(uuid, uuid) from authenticated'), 'usage RPC must not be directly exposed to authenticated clients');
assert.ok(migration.includes('grant execute on function public.get_patient_file_storage_usage_v1(uuid, uuid) to service_role'), 'usage RPC must remain server-only');

assert.ok(patientDetail.includes('PATIENT_FILE_MAX_SIZE_BYTES = 10 * 1024 * 1024'), 'UI must block files above 10 MiB before transport');
assert.ok(patientDetail.includes('PATIENT_FILE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024'), 'UI must know the 1 GiB patient limit');
assert.ok(patientDetail.includes('disabled={isUploadingFile || patientFileStorageIsFull}'), 'file picker must lock when the patient quota is full');
assert.ok(patientDetail.includes('de 1 GB usados'), 'UI must surface patient storage usage');

console.log('patientFileStorageQuota.test.mjs: PASS');
