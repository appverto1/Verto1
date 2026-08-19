import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const accessUtil = fs.readFileSync(new URL('../src/utils/patientFileAccess.ts', import.meta.url), 'utf8');
const schoolRoutes = fs.readFileSync(new URL('../services/schoolManagementRoutes.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260819235500_patient_file_access_control_v1.sql', import.meta.url), 'utf8');
const schemaFallbacks = fs.readFileSync(new URL('../src/utils/routeSchemaFallbacks.ts', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists access_scope text/);
assert.match(migration, /add column if not exists patient_portal_visible boolean/);
assert.match(migration, /create table if not exists public\.patient_file_access_grants/);
assert.match(migration, /for update[\s\S]*uploaded_by is null or v_file\.uploaded_by <> p_actor_id/);
assert.match(migration, /set_patient_file_access_v1/);
assert.match(migration, /for update;/);
assert.match(migration, /PATIENT_FILE_ACCESS_GRANTEE_OUTSIDE_CASE_TEAM/);
assert.match(migration, /patient_file_current_actor_can_read_v1/);
assert.match(migration, /patient_file_actor_has_patient_access_v1/);
assert.match(migration, /patient_file_acl_write_guard_v1/);
assert.match(migration, /PATIENT_FILE_ACCESS_RPC_REQUIRED/);
assert.match(migration, /public\.patient_file_current_actor_can_read_v1\(id\)[\s\S]*patient_files_update/);
assert.match(migration, /drop policy if exists "patient files private read"/);
assert.match(migration, /grant execute on function public\.set_patient_file_access_v1[\s\S]*to service_role/);

assert.match(accessUtil, /PATIENT_FILE_ACCESS_SCOPES = \['OWNER', 'CASE_TEAM', 'PATIENT_ACCESS', 'SELECTED'\]/);
assert.match(accessUtil, /isPatientFileAccessScope/);
assert.match(accessUtil, /if \(uploaderId && uploaderId === actorId\) return true/);
assert.match(accessUtil, /scope === 'CASE_TEAM'/);
assert.match(accessUtil, /scope === 'SELECTED'/);
assert.match(accessUtil, /patient_file_access_grants/);
assert.match(accessUtil, /patient_professional_links/);

assert.match(server, /app\.get\('\/api\/patient-files\/:patientId\/:fileId\/permissions'/);
assert.match(server, /app\.patch\('\/api\/patient-files\/:patientId\/:fileId\/permissions'/);
assert.match(server, /Somente quem enviou este arquivo pode alterar o nível de acesso/);
assert.match(server, /PATIENT_FILE_ACCESS_SCOPE_INVALID/);
assert.match(server, /PATIENT_FILE_PORTAL_VISIBILITY_INVALID/);
assert.match(server, /PATIENT_FILE_ACCESS_SELECTED_EMPTY/);
assert.match(server, /supabase\.rpc\('set_patient_file_access_v1'/);
assert.match(server, /filterPatientFilesForActor\([\s\S]*createSignedUrl/);
assert.match(server, /access_scope: 'PATIENT_ACCESS'/);
assert.match(server, /patient_portal_visible: isPatientUploader/);

assert.match(dataService, /getPatientFilePermissions/);
assert.match(dataService, /updatePatientFilePermissions/);
assert.match(patientDetail, /Somente eu/);
assert.match(patientDetail, /Equipe do caso/);
assert.match(patientDetail, /Pessoas selecionadas/);
assert.match(patientDetail, /Paciente\/responsável pode ver/);
assert.match(patientDetail, /file\.canManageAccess/);
assert.match(patientDetail, /savePatientFileAccess/);

assert.match(schemaFallbacks, /'uploaded_by'/);
assert.match(schemaFallbacks, /'access_scope'/);
assert.match(schemaFallbacks, /'patient_portal_visible'/);
assert.match(schoolRoutes, /filterPatientFilesForActor/);

console.log('patientFileAccessControl.regression.test.mjs: ok');
