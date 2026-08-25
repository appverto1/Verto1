import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260825123000_clinical_plan_context_link_and_unscheduled_session_claim.sql', 'utf8');

assert.match(sessionMode, /abaSessionId:\s*String\(abaSessionId \|\| sessionId/, 'coleta terapêutica deve carregar a sessão ABA explícita');
assert.match(sessionMode, /contextPlanId:\s*therapeuticPlanId \|\| null/, 'coleta deve carregar o plano clínico de contexto');
assert.match(sessionMode, /measurementModelVersion:\s*'V3'/, 'registro terapêutico local deve ficar explicitamente marcado como V3');
assert.match(sessionMode, /trialId:\s*record\.id,[\s\S]*abaSessionId:\s*sessionId/, 'retry legado deve preservar idempotência e sessão original');

assert.match(routes, /const abaSessionId=sanitizeString\(req\.body\?\.abaSessionId[\s\S]*req\.body\?\.session_id/, 'endpoint deve aceitar a sessão clínica explícita');
assert.match(routes, /\.from\('aba_sessions'\)[\s\S]*\.eq\('id',abaSessionId\)[\s\S]*\.eq\('patient_id',patientId\)[\s\S]*\.eq\('clinic_id',clinicId\)/, 'endpoint deve validar tenant, paciente e sessão exata');
assert.match(routes, /link_clinical_plan_measurement_context_v1/, 'writer deve registrar contexto append-only após o ACK canônico');
assert.match(routes, /CMV3_PLAN_WRITE_OCCURRED_BEFORE_ABA_SESSION|CMV3_PLAN_WRITE_OCCURRED_AFTER_ABA_SESSION/, 'sessão explícita deve ser validada contra o horário clínico original');

assert.match(migration, /create table if not exists public\.clinical_measurement_session_context_links_v3/, 'vínculo de contexto deve ser persistido fora do raw imutável');
assert.match(migration, /before update or delete[\s\S]*guard_clinical_measurement_session_context_link_v1/, 'vínculo de contexto deve ser append-only');
assert.match(migration, /session_key is distinct from \('plan-write:' \|\| v_client_event_id\)/, 'RPC não pode ligar um evento a outra sessão CMV3');
assert.match(migration, /CMV3_CONTEXT_LINK_IDEMPOTENCY_CONFLICT/, 'replay contraditório deve falhar fechado');
assert.doesNotMatch(migration, /update\s+public\.clinical_measurement_raw_events_v3|delete\s+from\s+public\.clinical_measurement_raw_events_v3/i, 'correção não pode reescrever raw clínico');

assert.match(server, /contextByCmv3Session/, 'dashboard deve consumir o vínculo operacional sem reescrever o raw');
assert.match(server, /linkedAbaSessionId/, 'dashboard deve expor a sessão ABA vinculada quando houver');

console.log('clinicalPlanMeasurementSessionContext.regression.test.mjs: ok');
