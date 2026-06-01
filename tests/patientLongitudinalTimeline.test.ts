import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientPortabilitySnapshot,
  isNotePortableWithConsent,
  normalizePatientPortabilityScope
} from '../src/utils/patientPortability';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const dataServiceCode = read('src/services/dataService.ts');
const migrationCode = read('supabase/migrations/20260601143000_patient_longitudinal_timeline.sql');
const portabilityCode = read('src/utils/patientPortability.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice(marker: string, chars = 5000) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

test('migration cria timeline longitudinal, import log, indices idempotentes e RLS', () => {
  for (const table of ['patient_longitudinal_timeline_items', 'patient_history_imports']) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migrationCode, new RegExp(`create policy ${table}_clinic_rw`, 'i'));
  }
  for (const column of [
    'global_patient_identity_id',
    'source_organization_id',
    'source_patient_id',
    'visibility',
    'portability_scope',
    'is_imported',
    'is_read_only',
    'imported_from_snapshot_id',
    'source_hash',
    'idempotency_key'
  ]) {
    assert.match(migrationCode, new RegExp(column));
  }
  assert.match(migrationCode, /idx_patient_timeline_source_hash/);
  assert.match(migrationCode, /idx_patient_history_imports_idempotency/);
});

test('timeline e historico importado sao rotas autenticadas, escopadas e paginadas', () => {
  const timelineRoute = routeSlice("app.get('/api/patients/:patientId/timeline'");
  const importedRoute = routeSlice("app.get('/api/patients/:patientId/imported-history'");
  assert.match(timelineRoute, /checkAuth, checkPatientAccess, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/);
  assert.match(timelineRoute, /parseBoundedListLimit/);
  assert.match(timelineRoute, /\.eq\('organization_id', clinicId\)/);
  assert.match(timelineRoute, /\.eq\('patient_id', patientId\)/);
  assert.match(timelineRoute, /\.range\(offset, offset \+ limit - 1\)/);
  assert.match(timelineRoute, /PATIENT_LONGITUDINAL_TIMELINE_SELECT/);
  assert.match(timelineRoute, /LONGITUDINAL_TIMELINE_VIEWED/);
  assert.match(importedRoute, /\.eq\('is_imported', true\)/);
  assert.match(dataServiceCode, /async getPatientLongitudinalTimeline/);
  assert.match(dataServiceCode, /async getPatientImportedHistory/);
  assert.match(dataServiceCode, /async createPatientSharedHistorySnapshot/);
});

test('snapshot compartilhavel exclui PRIVATE e inclui timeline importada ja autorizada', () => {
  const snapshotRoute = routeSlice("app.post('/api/patients/:patientId/shared-history/snapshot'", 7600);
  assert.match(snapshotRoute, /fetchNotesWithRoleFilter/);
  assert.match(snapshotRoute, /buildPatientPortabilitySnapshot/);
  assert.match(snapshotRoute, /timelineItems/);
  assert.match(snapshotRoute, /isShareableTimelineVisibility/);
  assert.match(snapshotRoute, /PRIVATE_HISTORY_EXCLUDED_FROM_PORTABILITY/);
  assert.match(snapshotRoute, /SHARED_HISTORY_SNAPSHOT_GENERATED/);
  assert.match(snapshotRoute, /idempotencyKey/);

  const scope = normalizePatientPortabilityScope({ patientVisibleNotes: true, professionalSharedNotes: true });
  assert.equal(isNotePortableWithConsent({ visibility: 'private', content: 'segredo' }, scope), false);
  const snapshot = buildPatientPortabilitySnapshot({
    patient: { name: 'Paciente', age: 12 },
    scope,
    notes: [
      { visibility: 'PRIVATE', content: 'nao entra' },
      { visibility: 'PATIENT', shared_with_patient: true, content: 'entra' },
      { visibility: 'PROFESSIONALS', is_portable: true, shared_with_professionals: true, content: 'entra tambem' }
    ]
  });
  assert.equal(snapshot.notes.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /nao entra/);
});

test('importacao de shared history persiste itens e e idempotente por source_hash', () => {
  const helper = routeSlice('async function importSharedSnapshotIntoLongitudinalTimeline', 7600);
  const builder = routeSlice('function buildTimelineItemsFromSharedSnapshot', 7600);
  assert.match(helper, /patient_history_imports/);
  assert.match(helper, /idempotencyKey/);
  assert.match(helper, /patient_longitudinal_timeline_items/);
  assert.match(helper, /\.in\('source_hash', sourceHashes\)/);
  assert.match(helper, /skippedDuplicatesCount/);
  assert.match(helper, /Histórico compartilhado já estava importado/);
  assert.match(builder, /is_read_only:\s*true/);
  assert.match(builder, /visibility:\s*'IMPORTED'/);
});

test('rotas de importacao usam persistencia longitudinal e auditoria idempotente', () => {
  const sharedImport = routeSlice("app.post('/api/patients/:patientId/shared-history/import'", 5200);
  const portabilityImport = routeSlice("app.post('/api/patients/:patientId/portability/import'", 7600);
  assert.match(sharedImport, /importSharedSnapshotIntoLongitudinalTimeline/);
  assert.match(sharedImport, /SHARED_HISTORY_IMPORT_IDEMPOTENT/);
  assert.match(sharedImport, /importedItemsCount/);
  assert.match(portabilityImport, /patient_portability_snapshots/);
  assert.match(portabilityImport, /importSharedSnapshotIntoLongitudinalTimeline/);
  assert.match(portabilityImport, /Histórico compartilhado já estava importado/);
});

test('sem select star e helper de portabilidade continua sem notas privadas', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  assert.match(portabilityCode, /if \(visibility === 'PRIVATE'\) return false/);
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

console.log(`${passed}/${tests.length} patient longitudinal timeline checks passed`);
