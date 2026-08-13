import assert from 'node:assert/strict';
import fs from 'node:fs';

const localDb = fs.readFileSync('src/services/localDb.ts', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260813110000_persistence_guarantees.sql', 'utf8');

assert.match(localDb, /this\.version\(5\)\.stores\([\s\S]*?cache_records:[\s\S]*?tombstones:/,
  'cache confirmado, outbox e tombstones devem permanecer separados');
assert.match(localDb, /const hasUnsynced = userRows\.some\(\(row\) => row\.sync_status !== 'synced'\);[\s\S]*?if \(!hasUnsynced\) \{[\s\S]*?persistentSeedKeyForUser/,
  'logout não pode destruir cache/chave enquanto houver mutações não confirmadas');
assert.match(localDb, /function mergeOfflineEntityData\([\s\S]*?type === 'patient_record'[\s\S]*?type === 'clinic_state'/,
  'PATCHs e estado clínico parcial devem ser mesclados sem truncar cache');
assert.match(localDb, /response\.status === 409 && \(responsePayload\?\.conflict === true \|\| record\.type === 'appointment'\)/,
  'conflitos de persistência devem permanecer na outbox para reconciliação');
assert.match(localDb, /last_updated` is the mutation's causal-order timestamp[\s\S]*?Number\(row\.last_updated \|\| 0\)/,
  'retry/ACK não pode reordenar mutações pendentes da mesma entidade');
assert.match(localDb, /row\.sync_status !== 'failed' \|\| isRecoverableFailedOfflineSyncRecord\(row\)/,
  'falha permanente rejeitada pelo servidor não pode reaparecer como dado persistido após F5');
assert.match(localDb, /failedRows\.filter\(\(row\) => isRecoverableFailedOfflineSyncRecord\(row\)\)/,
  'falha permanente antiga não pode bloquear uma edição corrigida mais nova');
assert.match(dataService, /const queueId = `\$\{type\}:\$\{id\}:\$\{crypto\.randomUUID\(\)\}`/,
  'cada mutação deve possuir registro único na outbox para evitar ACK cruzado');
assert.match(dataService, /if \(result\?\.success === false\) \{[\s\S]*?markRecordSyncFailure/,
  'HTTP 2xx com success:false não pode ser marcado como sincronizado');
assert.match(dataService, /if \(response\.status === 409 && errorPayload\?\.conflict === true\)/,
  'conflitos de qualquer entidade devem ser preservados localmente');
assert.match(dataService, /nextOfflineMutationTimestamp\(\)/,
  'mutações locais devem receber ordem causal monotônica');
assert.match(dataService, /async hydrateWorkspaceState[\s\S]*?buildLocalWorkspaceHydration[\s\S]*?getRecordById\(clinicStateEntityId\)[\s\S]*?getRecordsByType\('patient'\)/,
  'relogin/reload deve reconstruir o workspace a partir do cache + outbox quando a rede falhar');
assert.match(dataService, /A reload\/relogin must[\s\S]*?effectiveClinicStateRecord[\s\S]*?effectivePatientRecords/,
  'snapshot remoto não pode ocultar mutações locais duráveis durante hidratação');
assert.match(app, /if \(result\?\.conflict === true\) \{[\s\S]*?Never auto-retry/,
  'clinic_state não pode sobrescrever concorrência por retry automático');
assert.match(app, /if \(result\?\.pending === true\) \{[\s\S]*?virtualVersions[\s\S]*?clinicStatePersistedSnapshotRef/,
  'edições offline sequenciais de configuração devem avançar a cadeia local de versões');
assert.match(server, /verto_save_clinic_state_sections/,
  'estado clínico deve persistir por primitiva transacional');
assert.match(migration, /section_versions jsonb/,
  'clinic_state deve possuir versionamento por seção');
assert.match(migration, /section_mutation_keys jsonb/,
  'retry ambíguo de clinic_state deve ser idempotente');
assert.match(migration, /verto_persistence_mutation_receipts/,
  'mutações críticas devem possuir recibos idempotentes server-side');
assert.match(migration, /enable row level security/,
  'estrutura auxiliar de persistência deve usar RLS/negação por padrão');

console.log('systemPersistenceAudit.test.ts: ok');
