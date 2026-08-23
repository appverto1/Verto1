import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260823184500_aba_v3_analytical_metric_expansion.sql',
  'utf8',
);
const shell = fs.readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');
const analytics = fs.readFileSync('src/utils/clinicalOutcomeAnalytics.ts', 'utf8');

assert.match(sql, /'FINAL_COMPLETION_ACCURACY_PERCENT'::text/,
  'V3 deve expor acurácia final como métrica canônica distinta da independência');
assert.match(sql, /summary\.final_completion_correct_count::numeric \* 100\.0[\s\S]*?read_row\.effective_trial_count::numeric/,
  'acurácia final deve ser conclusão correta final ÷ tentativas efetivas');
assert.match(sql, /'EFFECTIVE_TRIAL_COUNT'::text[\s\S]*?read_row\.effective_trial_count::numeric/,
  'volume de tentativas deve vir do summary canônico server-side');
assert.match(sql, /point\.metric_key = 'EFFECTIVE_TRIAL_COUNT' then 'NO_DIRECTIONAL_JUDGMENT'/,
  'mais tentativas não podem ser classificadas como melhora clínica');

assert.match(sql, /'BEHAVIOR_DURATION_EPISODES'::text/,
  'comportamentos de duração devem expor contagem de episódios');
assert.match(sql, /'BEHAVIOR_DURATION_AVG'::text/,
  'comportamentos de duração devem expor duração média');
assert.match(sql, /duration_episode_count - summary\.censored_duration_count - summary\.open_duration_count/,
  'duração média deve excluir episódios censurados ou ainda abertos do denominador');
assert.match(sql, /summary\.completed_duration_seconds::numeric[\s\S]*?greatest\(summary\.duration_episode_count - summary\.censored_duration_count - summary\.open_duration_count/,
  'duração média deve usar duração concluída ÷ episódios concluídos');
assert.match(sql, /summary\.censored_duration_count > 0 or summary\.open_duration_count > 0/,
  'duração total/média devem sinalizar revisão quando houver evidência censurada/aberta');

assert.match(shell, /key\.includes\('RATE'\)[\s\S]*?ratio\.numerator \* 3600[\s\S]*?ratio\.denominator/,
  'agregação por data deve ponderar taxa pelo tempo observado em vez de tirar média simples das sessões');
assert.match(shell, /key\.includes\('DURATION_AVG'\)[\s\S]*?ratio\.numerator \/ ratio\.denominator/,
  'agregação por data deve ponderar duração média pelo número de episódios concluídos');
assert.match(analytics, /FINAL_COMPLETION_ACCURACY_PERCENT: 'Acurácia final'/,
  'UI deve nomear explicitamente a acurácia final sem confundi-la com independência');
assert.match(analytics, /EFFECTIVE_TRIAL_COUNT: 'Tentativas registradas'/,
  'UI deve tratar tentativas como volume registrado');
assert.match(analytics, /metric\.includes\('count'\)[\s\S]*?return raw && raw !== 'count' \? raw : 'Contagem'/,
  'métrica de episódios de duração com unidade count não pode ser rotulada como tempo');

assert.doesNotMatch(sql, /insert\s+into\s+public\.(?:aba_trials_v3|aba_behavior_events_v3|aba_sessions|clinical_observations)/i,
  'expansão analítica não pode escrever fatos clínicos');
assert.doesNotMatch(sql, /update\s+public\.(?:aba_trials_v3|aba_behavior_events_v3|aba_measurement_rollout_states_v3)/i,
  'expansão analítica não pode reescrever fatos/rollout');

console.log('abaV3AnalyticalMetricExpansion.regression.test.mjs: ok');
