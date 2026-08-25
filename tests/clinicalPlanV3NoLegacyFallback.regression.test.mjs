import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const localDb = readFileSync('src/services/localDb.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const writer = readFileSync('supabase/migrations/20260825144500_clinical_measurement_v3_aba_target_plan_writer.sql', 'utf8');
const reader = readFileSync('supabase/migrations/20260825145000_clinical_measurement_v3_plan_read_model_aba_target.sql', 'utf8');
const converged = readFileSync('supabase/migrations/20260825145500_clinical_measurement_v3_converged_reader_catchup.sql', 'utf8');

assert.match(sessionMode, /CMV3_PLAN_SUPPORTED_MEASUREMENTS = new Set\(\['correct_incorrect', 'frequency', 'duration', 'latency', 'percentage', 'task_analysis'\]\)/,
  'todas as coletas rápidas terapêuticas suportadas devem entrar no caminho V3');
assert.match(sessionMode, /const sourceKind = therapeuticObjectiveId \? 'THERAPEUTIC_OBJECTIVE' : targetId \? 'ABA_TARGET' : ''/,
  'alvo sem objective deve usar identidade ABA_TARGET, nunca cair no Legacy');
const persistStart = sessionMode.indexOf('const persistTherapeuticMeasurement = async');
const persistEnd = sessionMode.indexOf('const startTherapeuticTimer', persistStart);
const persistBlock = sessionMode.slice(persistStart, persistEnd);
assert.doesNotMatch(persistBlock, /dataService\.saveAbaTrial\(/,
  'coleta de programa terapêutico não pode gravar pela rota Legacy V2');
assert.match(persistBlock, /legacyFallbackBlocked:\s*true/,
  'identidade insuficiente deve falhar fechado e preservar o registro para revisão');


assert.match(localDb, /recoverLegacyTherapeuticTrialAsClinicalPlanV3/,
  'outbox deve recuperar tentativas terapêuticas antigas antes de reenviá-las');
assert.match(localDb, /record\.type !== 'aba' \|\| record\.method !== 'POST'/,
  'migração de outbox deve ser restrita ao antigo tipo ABA POST');
assert.match(localDb, /recoveredFromLegacyOutbox:\s*true/,
  'payload recuperado deve manter proveniência explícita');
assert.match(localDb, /requestEndpoint = recoveredTherapeutic\?\.endpoint \|\| record\.endpoint/,
  'sync genérico deve redirecionar o registro legado para o endpoint V3');
assert.match(server, /code:\s*'ABA_THERAPEUTIC_V3_REQUIRED'[\s\S]*retryable:\s*true/,
  'backend deve impedir que uma aba antiga grave coleta terapêutica no Legacy e manter retry possível');

assert.match(routes, /\['PLAN_GOAL','THERAPEUTIC_OBJECTIVE','ABA_TARGET'\]/,
  'endpoint canônico deve aceitar ABA_TARGET');
assert.match(routes, /sourceKind==='ABA_TARGET'[\s\S]*\.from\('aba_targets'\)/,
  'endpoint deve validar o alvo ABA contra paciente e clínica');
assert.match(routes, /CMV3_PLAN_WRITE_ABA_TARGET_PLAN_REQUIRED/,
  'alvo deve estar ligado a um plano clínico antes da gravação');
assert.match(routes, /p_goal_id:sourceKind==='PLAN_GOAL'\?goalId:sourceKind==='ABA_TARGET'\?abaTargetId:null/,
  'RPC deve receber a identidade do ABA target sem mudar a assinatura existente');
assert.match(routes, /\['numeric','percentage','scale','task_analysis'\]/,
  'task analysis simplificada deve persistir como percentual contínuo V3, não Legacy');

assert.match(writer, /v_source_kind not in \('PLAN_GOAL','THERAPEUTIC_OBJECTIVE','ABA_TARGET'\)/,
  'writer deve suportar ABA_TARGET');
assert.match(writer, /insert into public\.clinical_measurement_targets_v3\([\s\S]*'ABA_TARGET'/,
  'writer deve autobootstrapar identidade ABA_TARGET apenas de um aba_targets válido');
assert.match(writer, /source_target\.patient_id = p_patient_id[\s\S]*source_target\.clinic_id = p_organization_id::text/,
  'autobootstrap deve ser tenant/patient scoped');

assert.match(reader, /target\.source_kind in \('PLAN_GOAL', 'THERAPEUTIC_OBJECTIVE', 'ABA_TARGET'\)/,
  'reader genérico deve incluir evidência ABA_TARGET');
assert.match(reader, /aba_program\.therapeutic_plan_id = any\(coalesce\(p_plan_ids/,
  'reader deve mapear ABA target ao plano via programa');
assert.match(converged, /create or replace function public\.read_clinical_outcomes_converged_v3/,
  'catch-up deve instalar o reader convergido ausente');

console.log('clinicalPlanV3NoLegacyFallback.regression.test.mjs: ok');
