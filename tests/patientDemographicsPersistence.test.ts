import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260813110000_persistence_guarantees.sql', 'utf8');

assert.match(app, /const recordPayloadForCreate = \{[\s\S]*?financialPlans[\s\S]*?pei[\s\S]*?evaluationLinks/,
  'cadastro deve montar o prontuário agregado antes da primeira gravação');
assert.match(app, /dataService\.savePatient\([\s\S]*?\{ recordPayload: recordPayloadForCreate \}\)/,
  'paciente e prontuário inicial devem ser enviados na mesma mutação');
assert.match(app, /const rollbackOptimisticPatient = \(\) => \{[\s\S]*?setAllPatients[\s\S]*?setClinicalRecords[\s\S]*?setTherapistAgenda/,
  'cadastro otimista deve possuir rollback completo');
assert.match(app, /const rollbackOptimisticPatientState = \(\) => \{[\s\S]*?previousPatientSnapshot[\s\S]*?previousClinicalRecordSnapshot/,
  'edição/remoção otimista deve possuir snapshot de rollback');
assert.match(dataService, /async savePatient\(patient: any, options: \{ recordPayload\?: any \} = \{\}\)/,
  'savePatient deve aceitar o agregado clínico');
assert.match(dataService, /async updatePatient\([\s\S]*?recordPayload[\s\S]*?saveOfflineFirst/,
  'updatePatient deve persistir o agregado pela outbox durável');
assert.match(server, /supabase\.rpc\('verto_create_patient_aggregate_atomic'/,
  'criação de paciente deve usar transação atômica no banco');
assert.match(server, /supabase\.rpc\('verto_update_patient_aggregate_atomic'[\s\S]*?p_expected_record_ciphertext:[\s\S]*?p_idempotency_key:/,
  'edição agregada deve usar CAS e idempotência');
assert.match(server, /PATIENT_PERSISTENCE_SCHEMA_MISMATCH[\s\S]*?Nenhum campo foi descartado silenciosamente/,
  'schema incompatível deve falhar fechado, sem descartar campo editado');
assert.doesNotMatch(server, /delete \(safePatientUpdates as any\)\[missingColumn\]/,
  'PATCH de paciente não pode remover silenciosamente coluna ausente');
assert.match(migration, /verto_create_patient_aggregate_atomic[\s\S]*?on conflict \(id\) do nothing/,
  'retry de criação não deve reescrever edições posteriores');
assert.match(migration, /PATIENT_RECORD_CONCURRENT_EDIT/,
  'prontuário deve detectar edição concorrente antes de sobrescrever');
assert.match(migration, /p_idempotency_key, 'patient_aggregate'/,
  'mutação agregada deve registrar recibo idempotente na mesma transação');

console.log('patientDemographicsPersistence.test.ts: ok');
