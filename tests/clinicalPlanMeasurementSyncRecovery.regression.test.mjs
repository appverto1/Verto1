import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const resilience = readFileSync('src/utils/offlineSyncResilience.ts', 'utf8');
const pgcryptoFix = readFileSync('supabase/migrations/20260824212000_clinical_measurement_v3_bulk_pgcrypto_search_path_fix.sql', 'utf8');
const intervalTimeFix = readFileSync('supabase/migrations/20260824213000_clinical_measurement_v3_plan_writer_interval_event_time_fix.sql', 'utf8');

assert.match(dataService, /'clinical_plan_v3'/, 'medição de plano V3 deve ter outbox próprio');
assert.match(dataService, /saveClinicalPlanMeasurementV3[\s\S]*saveOfflineFirst\([\s\S]*idempotencyKey: clientEventId/, 'writer de plano deve ser offline-first e preservar a identidade original');
assert.match(localDb, /verto:offline-sync-status/, 'ACK do outbox deve notificar a UI sem F5');
assert.match(app, /setInterval\(refreshFailedSyncCount, 5_000\)/, 'outbox deve ser verificado periodicamente');
assert.match(app, /visibilitychange[\s\S]*refreshFailedSyncCount/, 'retorno à aba deve disparar reconciliação');
assert.match(sessionMode, /therapeuticMeasurement === true[\s\S]*syncStatus === 'local' \|\| record\.syncStatus === 'error'/, 'coletas terapêuticas antigas devem voltar automaticamente para a fila');
assert.match(sessionMode, /trialId: record\.id/, 'retry terapêutico deve reutilizar o idempotency key original');
assert.match(sessionMode, /offlineOutboxQueued/, 'registro local deve saber que já foi promovido à outbox para evitar duplicar filas');
assert.match(sessionMode, /Retry automático ativo/, 'UI deve informar que a falha transitória continua sendo reconciliada');
assert.doesNotMatch(resilience, /nextRetryCount\s*>=\s*maxRetries/, 'falha de infraestrutura não pode morrer por limite de tentativas');
assert.match(pgcryptoFix, /set search_path = pg_catalog, public, extensions/, 'hotfix de pgcrypto aplicado manualmente deve estar versionado');
assert.match(intervalTimeFix, /CMV3_PLAN_WRITER_INTERVAL_EVENT_TIME_REPAIRED/, 'hotfix temporal aplicado manualmente deve estar versionado');
assert.match(intervalTimeFix, /'occurred_at_utc',v_interval_start[\s\S]*'kind','TEMPORAL_INTERVAL'/, 'intervalo temporal deve usar START como event time');

console.log('clinicalPlanMeasurementSyncRecovery.regression.test.mjs: ok');
