import assert from 'node:assert/strict';
import fs from 'node:fs';

const sessionMode = fs.readFileSync('src/components/SessionMode.tsx', 'utf8');
const therapeuticPlan = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const abaSessionSummary = fs.readFileSync('src/utils/abaSessionSummary.ts', 'utf8');
const summaryGuardMigration = fs.readFileSync('supabase/migrations/20260817113000_aba_therapeutic_measurement_summary_guard.sql', 'utf8');

assert.match(sessionMode, /data-therapeutic-measurement-collector=\{measurementType\}/, 'sessão deve renderizar coletor específico da medida');
assert.match(sessionMode, /measurementType === 'duration'[\s\S]*?Iniciar[\s\S]*?Pausar[\s\S]*?Finalizar/, 'duração deve oferecer iniciar, pausar e finalizar');
assert.match(sessionMode, /measurementType === 'latency'[\s\S]*?Iniciar[\s\S]*?Responder/, 'latência deve oferecer iniciar e responder');
assert.match(sessionMode, /measurementType === 'frequency'[\s\S]*?\+1 ocorrência/, 'frequência deve registrar incremento');
assert.match(sessionMode, /measurementType === 'correct_incorrect'[\s\S]*?Acerto[\s\S]*?Erro/, 'acerto/erro deve ter coletor binário');
assert.match(sessionMode, /source: 'therapeutic_program_measurement'/, 'medida deve ser persistida com marcador canônico');
assert.match(sessionMode, /raw_payload: rawPayload/, 'medida deve persistir no raw_payload do aba_trial');
assert.match(sessionMode, /renderTherapeuticMeasurementCollector\(goal\) \|\| \(/, 'matriz Legacy deve ser fallback, não coletor universal');
assert.match(sessionMode, /therapeutic_measurement_timer_open/, 'sessão não pode encerrar com cronômetro terapêutico aberto');

assert.match(therapeuticPlan, /isTherapeuticMasteryCriteriaCompatible/, 'plano deve validar compatibilidade medida x critério');
assert.match(therapeuticPlan, /therapeuticMeasurementDefaultMasteryMeasure/, 'troca da forma de coleta deve selecionar medida de domínio compatível');

assert.match(server, /allowedTherapeuticMeasurementTypes/, 'servidor deve validar formas de coleta terapêuticas');
assert.match(server, /Medida terapêutica inválida/, 'servidor deve validar valor clínico');
assert.match(server, /therapeuticMeasurementWrite \? false : correct && promptInfo\.isIndependent/, 'medidas genéricas não podem ser classificadas como independência ABA');
assert.match(server, /'latency_ms',[\s\S]*?'raw_payload'/, 'leitura de aba_trials deve devolver metadados da medida após F5/relogin');
assert.match(abaSessionSummary, /!isTherapeuticProgramMeasurementRecord\(trial\)/, 'medidas terapêuticas não podem contaminar resumo Legacy de tentativas');
assert.match(summaryGuardMigration, /therapeutic_program_measurement/, 'trigger incremental deve ignorar medidas terapêuticas nos summaries Legacy');

console.log('therapeuticMeasurementSessionCollector.test.mjs: ok');
