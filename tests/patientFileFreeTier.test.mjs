import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261115001000_patient_file_free_tier_100mb.sql', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');

assert.match(migration, /quota_bytes bigint not null default 104857600/, 'unentitled patient must start at 100 MiB');
assert.match(migration, /quota_bytes between 104857600 and 1073741824/, 'admin allowance cannot exceed 1 GiB');
assert.match(migration, /select usage\.used_bytes, usage\.quota_bytes[\s\S]*for update/, 'race-safe trigger must read entitlement with same lock');
assert.match(migration, /projected_bytes > granted_bytes/, 'DB must enforce granted quota, not global ceiling');
assert.match(migration, /greatest\(allowance\.limit_bytes - allowance\.used_bytes, 0::bigint\)/, 'API must expose remaining authorized space');
assert.match(migration, /PATIENT_FILE_STORAGE_QUOTA_EXCEEDED/, 'rejections must preserve stable error code');
assert.match(migration, /revoke all on table public\.patient_file_storage_usage from public, anon, authenticated/, 'entitlement must remain server-only');
assert.match(patientDetail, /PATIENT_FILE_FREE_TIER_BYTES = 100 \* 1024 \* 1024/, 'staff UI must default to 100 MiB');
assert.match(patientDetail, /patientFileStorageUsage\.limitBytes/, 'staff UI must respect effective quota');
assert.match(portal, /result\.storageUsage/, 'patient portal should reuse existing usage response');
assert.match(portal, /portalPatientFileQuotaFull/, 'patient portal must block picker when quota is full');
console.log('patientFileFreeTier.test.mjs: PASS');
