import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const routeFallbackCode = read('src/utils/routeSchemaFallbacks.ts');
const migrationCode = read('supabase/migrations/20260601133000_patient_safe_archive.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 5000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return source.slice(start, end);
}

test('DELETE /api/patients/:id arquiva o paciente sem delete fisico nem desvinculo da clinica', () => {
  const route = sliceBetween(serverCode, "app.delete('/api/patients/:id'", "app.post('/api/patients/:id/reactivate'");
  assert.match(route, /checkAuth,\s*requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
  assert.match(route, /select\('id, clinic_id, email, name, therapist_id, status, metadata'\)/);
  assert.match(route, /status:\s*PATIENT_STATUS_ARCHIVED/);
  assert.match(route, /is_active:\s*false/);
  assert.match(route, /archived_at:\s*nowIso/);
  assert.match(route, /archived_by:\s*sanitizeString/);
  assert.match(route, /deleted_at:\s*nowIso/);
  assert.match(route, /privateDataOwnerClinicId/);
  assert.doesNotMatch(route, /clinic_id:\s*null/);
  assert.doesNotMatch(route, /\.from\('patients'\)[\s\S]{0,200}\.delete\(/);
  assert.match(route, /message:\s*'Paciente arquivado com sucesso\.'/);
});

test('arquivamento preserva historico clinico e dados privados da clinica original', () => {
  const route = sliceBetween(serverCode, "app.delete('/api/patients/:id'", "app.post('/api/patients/:id/reactivate'");
  assert.doesNotMatch(route, /archiveDependency/);
  assert.doesNotMatch(route, /\.from\('notes'\)[\s\S]*?\.update/);
  assert.doesNotMatch(route, /\.from\('history'\)[\s\S]*?\.update/);
  assert.doesNotMatch(route, /\.from\('appointments'\)[\s\S]*?\.update/);
  assert.doesNotMatch(route, /\.from\('users'\)[\s\S]*?clinic_id:\s*null/);
  assert.match(route, /readOnlyHistory:\s*true/);
  assert.match(route, /private_history_read_only:\s*true/);
});

test('arquivamento e idempotente e nao vaza infraestrutura no erro', () => {
  const route = sliceBetween(serverCode, "app.delete('/api/patients/:id'", "app.post('/api/patients/:id/reactivate'");
  assert.match(route, /alreadyArchived/);
  assert.match(route, /idempotent:\s*alreadyArchived/);
  assert.match(route, /return res\.status\(500\)\.json\(\{ success: false, error: 'Não foi possível arquivar o paciente agora\.' \}\)/);
  assert.doesNotMatch(route, /sendRouteDbError\(res/);
});

test('reativacao preserva historico anterior como somente leitura', () => {
  const route = sliceFrom(serverCode, "app.post('/api/patients/:id/reactivate'", 6200);
  assert.match(route, /checkAuth,\s*requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(route, /PATIENT_STATUS_PENDING_ANAMNESIS/);
  assert.match(route, /PATIENT_STATUS_ACTIVE/);
  assert.match(route, /is_active:\s*true/);
  assert.match(route, /deleted_at:\s*null/);
  assert.match(route, /reactivated_at:\s*nowIso/);
  assert.match(route, /previousPrivateHistoryReadOnly:\s*true/);
  assert.match(route, /PATIENT_REACTIVATED/);
});

test('front chama delete como arquivamento e remove apenas da lista ativa', () => {
  const handleUpdate = sliceFrom(appCode, 'const handleUpdatePatient = async', 9500);
  const handleDelete = sliceFrom(coordinatorCode, 'const handleDeletePatient = async', 2200);
  assert.match(handleUpdate, /normalizedPatientStatus === 'archived'/);
  assert.match(handleUpdate, /setAllPatients\(prev => prev\.filter/);
  assert.match(handleUpdate, /dataService\.deletePatient/);
  assert.doesNotMatch(handleUpdate, /setClinicalRecords\(prev => prev\.filter/);
  assert.match(handleDelete, /Deseja arquivar o paciente/);
  assert.match(handleDelete, /status:\s*isUnlinkOnly \? "deleted" : "archived"/);
  assert.match(handleDelete, /Paciente arquivado com sucesso/);
  assert.match(coordinatorCode, /> Arquivar/);
  assert.match(dataServiceCode, /Falha ao arquivar paciente/);
});

test('lista padrao de pacientes exclui arquivados mesmo com fallback de schema', () => {
  assert.match(routeFallbackCode, /query = query\.neq\('status', 'ARCHIVED'\)\.neq\('status', 'archived'\)/);
  assert.match(routeFallbackCode, /if \(filterIsActive\) query = query\.eq\('is_active', true\)/);
  assert.match(routeFallbackCode, /if \(filterDeletedAt\) query = query\.is\('deleted_at', null\)/);
});

test('migration adiciona apenas colunas auxiliares de arquivo e reativacao', () => {
  for (const column of ['archived_at', 'archived_by', 'reactivated_at', 'reactivated_by']) {
    assert.match(migrationCode, new RegExp(`add column if not exists ${column}`, 'i'));
  }
  assert.match(migrationCode, /idx_patients_clinic_active_archive/);
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

console.log(`${passed}/${tests.length} patient archive checks passed`);
