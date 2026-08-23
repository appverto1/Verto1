import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const writer = readFileSync('supabase/migrations/20260823200000_clinical_measurement_v3_plan_writer_ui_convergence.sql', 'utf8');
const reader = readFileSync('supabase/migrations/20260823200500_clinical_measurement_v3_plan_read_model_proportion.sql', 'utf8');
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const sessionMode = readFileSync('src/components/SessionMode.tsx', 'utf8');
const therapeuticPlan = readFileSync('src/utils/therapeuticPlan.ts', 'utf8');

assert.match(writer, /'PROPORTION'/, 'writer efetivo deve aceitar PROPORTION');
assert.match(writer, /numerator_category_keys[\s\S]*'correct'/, 'acurácia deve declarar numerador explícito');
assert.match(writer, /denominator_category_keys[\s\S]*'correct'[\s\S]*'incorrect'/, 'acurácia deve declarar denominador explícito');
assert.match(writer, /v_family in \('CATEGORICAL','PROPORTION'\)[\s\S]*category_key/, 'PROPORTION deve persistir fato categórico bruto, não percentual pronto');
assert.match(writer, /v_category not in \('correct','incorrect'\)/, 'writer deve rejeitar categorias fora do contrato binário');
assert.doesNotMatch(writer, /insert\s+into\s+public\.aba_trials\b/i, 'writer universal não deve duplicar em aba_trials');
assert.doesNotMatch(writer, /insert\s+into\s+public\.clinical_observations\b/i, 'writer universal não deve duplicar em clinical_observations');

assert.match(reader, /clinical_measurement_session_proportion_summaries_v3/, 'reader de Planos\/PTS deve consumir projeção PROPORTION');
assert.match(reader, /summary\.numerator::numeric as numerator/, 'reader deve preservar numerador');
assert.match(reader, /summary\.denominator::numeric as denominator/, 'reader deve preservar denominador');
assert.match(reader, /'PERCENT'::text as canonical_value_unit/, 'reader deve declarar unidade percentual canônica');

assert.match(routes, /metricType==='correct_incorrect'[\s\S]*semanticFamily='PROPORTION'/, 'rota deve mapear acerto\/erro para PROPORTION');
assert.match(routes, /category_key:numericValue===1\?'correct':'incorrect'/, 'rota deve enviar fato correto\/incorreto, não score');

assert.match(therapeuticPlan, /therapeuticObjectiveId:[\s\S]*therapeutic_objective_id/, 'alvo de sessão deve carregar identidade do objetivo terapêutico');
assert.match(therapeuticPlan, /therapeuticPlanId:[\s\S]*therapeutic_plan_id/, 'alvo de sessão deve carregar escopo do plano');

assert.match(sessionMode, /CMV3_PLAN_SUPPORTED_MEASUREMENTS = new Set\(\['correct_incorrect', 'frequency', 'duration', 'latency', 'percentage'\]\)/);
assert.match(sessionMode, /saveClinicalPlanMeasurementV3\(patientId, cmv3Payload\)/, 'medida suportada deve usar writer V3');
assert.match(sessionMode, /useCanonicalPlanWriter[\s\S]*\?[\s\S]*saveClinicalPlanMeasurementV3[\s\S]*:[\s\S]*saveAbaTrial/, 'V3 e Legacy devem ser caminhos alternativos, não dual-write');
assert.match(sessionMode, /Nenhum registro Legacy foi criado/, 'falha do writer V3 deve falhar fechado sem fallback transitório');
assert.match(sessionMode, /SEMANTIC_FAMILY_NOT_SUPPORTED_BY_PLAN_WRITER/, 'fallback Legacy deve ser explicitamente classificado');
assert.match(sessionMode, /THERAPEUTIC_OBJECTIVE_IDENTITY_UNAVAILABLE/, 'fallback de compatibilidade de identidade antiga deve ser explicitamente classificado');

console.log('clinicalMeasurementV3PlanWriterUiConvergence.regression.test.mjs: ok');
