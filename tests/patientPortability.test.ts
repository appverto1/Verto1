import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientPortabilitySnapshot,
  isNotePortableWithConsent,
  normalizePatientPortabilityScope
} from '../src/utils/patientPortability';
import { isIdempotentConflictPayload } from '../src/utils/offlineSyncResilience';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const localDbCode = read('src/services/localDb.ts');
const routeFallbackCode = read('src/utils/routeSchemaFallbacks.ts');
const clinicalPostCode = read('src/utils/clinicalPostResilience.ts');
const migrationCode = read('supabase/migrations/20260529170000_patient_portability_foundation.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice(marker: string, chars = 900) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

test('cadastro trata duplicidade segura como idempotente sem transformar 409 real em sucesso generico', () => {
  assert.match(serverCode, /PATIENT_ALREADY_EXISTS_SAME_CLINIC/);
  assert.match(serverCode, /PATIENT_SPECIALTY_CONFLICT_OTHER_CLINIC/);
  assert.match(serverCode, /findPatientSpecialtyConflictAcrossClinics\(\{[\s\S]*?requestedSpecialtyKeys/);
  assert.match(serverCode, /idempotent:\s*true/);
  assert.match(serverCode, /RESPONSIBLE_LINKED_TO_NEW_PATIENT/);
  assert.match(serverCode, /EXISTING_EMAIL_LINKED/);
  assert.match(serverCode, /findDuplicatePatientInClinic\(\{[\s\S]*?name:/);
  assert.doesNotMatch(serverCode, /Todo o hist.rico cl.nico anterior ser. vinculado/i);
});

test('duplicidade entre clinicas bloqueia apenas quando especialidade coincide', () => {
  assert.match(serverCode, /function normalizePatientSpecialtyKey/);
  assert.match(serverCode, /function derivePatientSpecialtyKeysFromPayload/);
  assert.match(serverCode, /async function fetchSpecialtyKeysForPatientRows/);
  assert.match(serverCode, /async function findPatientSpecialtyConflictAcrossClinics/);
  assert.match(serverCode, /requested\.size === 0/);
  assert.match(serverCode, /if \(requested\.has\(key\)\)/);
  const patientPost = routeSlice("app.post('/api/patients',", 9000);
  assert.match(patientPost, /requestedSpecialtyKeys = derivePatientSpecialtyKeysFromPayload/);
  assert.match(patientPost, /PATIENT_SPECIALTY_CONFLICT_OTHER_CLINIC/);
});

test('frontend nao vincula historico automaticamente por e-mail existente nem duplica popup de ativacao', () => {
  const addPatientStart = appCode.indexOf('const handleAddPatient = async');
  const addPatientEnd = appCode.indexOf('const handleUpdatePatient = async', addPatientStart);
  const addPatientSlice = appCode.slice(addPatientStart, addPatientEnd);
  assert.doesNotMatch(addPatientSlice, /getHistoryByEmail|getNotesByEmail/);
  assert.doesNotMatch(addPatientSlice, /Todo o hist.rico|hist.rico cl.nico anterior/i);
  assert.match(addPatientSlice, /activationMessage/);
  assert.match(read('src/components/CoordinatorDashboard.tsx'), /activationMessage/);
});

test('offline sync marca conflito idempotente como sincronizado', () => {
  assert.equal(isIdempotentConflictPayload({ success: true, idempotent: true }), true);
  assert.equal(isIdempotentConflictPayload({ code: 'PATIENT_ALREADY_EXISTS_SAME_CLINIC' }), true);
  assert.equal(isIdempotentConflictPayload({ code: 'PORTABILITY_REQUEST_ALREADY_EXISTS' }), true);
  assert.equal(isIdempotentConflictPayload({ success: false, code: 'REAL_CONFLICT' }), false);
  assert.match(dataServiceCode, /response\.status === 409 && isIdempotentConflictPayload/);
  assert.match(localDbCode, /response\.status === 409 && isIdempotentConflictPayload/);
});

test('migration cria base de portabilidade, grants, snapshots, campos de notas e RLS', () => {
  for (const table of [
    'patient_portability_requests',
    'patient_portability_snapshots',
    'patient_access_grants'
  ]) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migrationCode, new RegExp(`create policy [\\s\\S]*${table}`, 'i'));
  }
  for (const column of [
    'portability_scope',
    'is_portable',
    'shared_with_patient',
    'shared_with_professionals',
    'original_organization_id',
    'original_author_id',
    'responsible_user_id',
    'client_record_id'
  ]) {
    assert.match(migrationCode, new RegExp(column));
  }
});

test('rotas de portabilidade sao autenticadas, escopadas e auditadas', () => {
  assert.match(routeSlice("app.post('/api/patients/:patientId/portability/request'"), /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.get('/api/patients/:patientId/portability/status'"), /checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.post('/api/portal/portability/:requestId/approve'"), /portalActionLimiter, checkAuth/);
  assert.match(routeSlice("app.post('/api/portal/portability/:requestId/reject'"), /portalActionLimiter, checkAuth/);
  assert.match(routeSlice("app.post('/api/patients/:patientId/portability/import'"), /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  for (const action of [
    'PORTABILITY_REQUEST_CREATED',
    'PORTABILITY_APPROVED',
    'PORTABILITY_REJECTED',
    'PORTABILITY_SNAPSHOT_IMPORTED',
    'ACCESS_GRANT_CREATED'
  ]) {
    assert.match(serverCode, new RegExp(action));
  }
  assert.doesNotMatch(serverCode, /select\(['"]\*['"]\)/);
});

test('regras de notas privadas, paciente e profissionais respeitam consentimento', () => {
  const scope = normalizePatientPortabilityScope({
    patientVisibleNotes: true,
    professionalSharedNotes: true
  });
  assert.equal(isNotePortableWithConsent({ visibility: 'private', content: 'segredo' }, scope), false);
  assert.equal(isNotePortableWithConsent({ visibility: 'patient', shared_with_patient: true }, scope), true);
  assert.equal(isNotePortableWithConsent({ visibility: 'professional', is_portable: false }, scope), false);
  assert.equal(isNotePortableWithConsent({ visibility: 'professional', is_portable: true, shared_with_professionals: true }, scope), true);

  const snapshot = buildPatientPortabilitySnapshot({
    patient: { name: 'Paciente Demo', age: 8, status: 'active' },
    scope,
    notes: [
      { visibility: 'private', content: 'nao entra' },
      { visibility: 'patient', content: 'entra para familia', shared_with_patient: true },
      { visibility: 'professional', content: 'entra se marcado', is_portable: true, shared_with_professionals: true }
    ]
  });
  assert.equal(snapshot.notes.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /nao entra/);
});

test('selects e writes de notas conhecem campos de portabilidade como opcionais', () => {
  for (const field of ['portability_scope', 'is_portable', 'shared_with_patient', 'shared_with_professionals']) {
    assert.match(routeFallbackCode, new RegExp(`'${field}'`));
    assert.match(clinicalPostCode, new RegExp(`'${field}'`));
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

console.log(`${passed}/${tests.length} patient portability checks passed`);
