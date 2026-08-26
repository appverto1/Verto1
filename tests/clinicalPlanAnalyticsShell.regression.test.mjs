import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const analytics = fs.readFileSync('src/utils/clinicalOutcomeAnalytics.ts', 'utf8');

for (const label of ['Visão geral', 'Habilidades', 'Comportamentos', 'Maestria', 'Manutenção', 'Mudanças por sessão']) {
  assert.ok(shell.includes(label), `domínio analítico ausente: ${label}`);
}
for (const label of ['Por data', 'Por sessão']) {
  assert.ok(shell.includes(label), `eixo de comparação ausente: ${label}`);
}
for (const label of ['Habilidades', 'Comportamentos', 'Maestria', 'Manutenção', 'Regressão/alertas']) {
  assert.ok(shell.includes(label), `legenda clínica coerente ausente: ${label}`);
}
assert.match(shell, /Alvos no gráfico · até 3/, 'o gráfico comparativo deve limitar a seleção cognitiva a três alvos');

assert.match(shell, /Comportamentos interferentes/, 'o domínio comportamental deve ser nomeado explicitamente como comportamentos interferentes');
assert.match(shell, /isClinicalOutcomeInterferingBehaviorSeries\(series\)/, 'classificação comportamental deve usar semântica explícita, não palavras genéricas como duração');
assert.doesNotMatch(shell, /label\.includes\('duração'\)\) return 'behaviors'/, 'duração terapêutica genérica não pode ser classificada como comportamento interferente');
assert.match(shell, /Comportamentos interferentes no gráfico · até 3/, 'seleção do domínio comportamental deve falar em comportamentos interferentes, não alvos');
assert.match(dashboard, /for \(const series of summaries\)[\s\S]*?isClinicalOutcomeInterferingBehaviorSeries\(series\)/, 'PTS multidisciplinar deve incluir comportamento interferente de nível paciente mesmo sem planId legado');
assert.match(analytics, /startsWith\('BEHAVIOR_'\)/, 'identificação de comportamento deve reconhecer métricas BEHAVIOR_*');
assert.match(analytics, /sourceFamilies\.includes\('BEHAVIOR'\)/, 'identificação de comportamento deve reconhecer source_family BEHAVIOR do read model canônico');
assert.match(analytics, /text\(observation\.itemId\) \|\| text\(observation\.itemLabel\)/, 'comportamentos legados sem itemId devem permanecer separados pelo nome clínico');

assert.match(shell, /current_\$\{index\}/, 'o período atual deve permanecer como série própria');
assert.match(shell, /previous_\$\{index\}/, 'o período anterior deve permanecer no mesmo gráfico, sem substituir o atual');
assert.match(shell, /strokeDasharray="6 5"/, 'o período anterior deve usar o mesmo significado cromático com estilo visual distinto');
assert.match(shell, /connectNulls=\{false\}/, 'períodos e lacunas não podem ser conectados artificialmente');
assert.match(shell, /Contagem de registros distintos; não é um score clínico\./, 'a visão geral não pode sugerir um score global');
assert.match(shell, /Percentuais, duração, frequência e outras unidades não são somados entre si\./, 'a visão geral deve proibir soma de unidades incompatíveis');
assert.match(shell, /metricSignature/, 'métricas devem permanecer separadas por assinatura semântica');
assert.match(shell, /previousSeriesByKey/, 'comparação deve reutilizar a série clínica compatível do período anterior');
assert.doesNotMatch(shell, /Desempenho Geral|score global/i, 'o shell não deve reintroduzir score geral do paciente');

assert.match(dashboard, /<ClinicalPlanAnalyticsShell/, 'Planos e PTS devem compartilhar o mesmo shell analítico');
assert.match(dashboard, /scopeId === 'pts'[\s\S]*?ptsAnalyticsSeries[\s\S]*?selectedPlanSeries\.filter/, 'PTS e plano da especialidade devem reutilizar as séries já autorizadas, sem nova fonte de verdade');
assert.match(dashboard, /!isHistoricalOnlySeries\(series\)/, 'histórico semanticamente incompatível deve continuar fora do gráfico comparativo principal');
assert.match(dashboard, /Leitura comparativa disponível no gráfico acima\./, 'o PTS deve centralizar a comparação no shell em vez de repetir mini-gráficos em cada contribuição');
assert.doesNotMatch(dashboard, /invalidateQueries\(\s*\{?\s*\}?\s*\)/, 'a mudança visual não deve introduzir invalidação global de dados');

for (const metric of [
  'BEHAVIOR_DURATION_EPISODES',
  'MASTERY_STATUS',
  'MAINTENANCE_ACCURACY',
  'REGRESSION_RISK',
]) {
  assert.ok(analytics.includes(metric), `rótulo canônico ausente para ${metric}`);
}

console.log('clinicalPlanAnalyticsShell.regression.test.mjs: ok');
