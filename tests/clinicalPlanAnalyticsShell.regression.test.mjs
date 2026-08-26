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
assert.match(shell, /com os domínios empilhados; não é um score clínico/, 'a visão geral deve explicar o empilhamento sem sugerir score global');
assert.match(shell, /stackId="domains"/, 'a visão geral deve empilhar os domínios na mesma barra');
assert.match(shell, /data-testid="overview-domain-filters"/, 'a legenda da visão geral deve ser um grupo de filtros HTML fora do SVG');
assert.match(shell, /role="group" aria-label="Filtrar domínios exibidos no gráfico"/, 'os filtros do overview devem expor semântica acessível');
assert.match(shell, /toggleOverviewDomain/, 'a legenda deve permitir seleção de um ou vários domínios sem nova consulta');
assert.match(shell, /overviewVisibleBars/, 'o conjunto de barras visíveis deve ser derivado apenas do estado local do filtro');
assert.match(shell, /OVERVIEW_Y_AXIS_MIN = 10/, 'o eixo Y filtrado deve preservar um piso visual para não inflar eventos raros');
assert.match(shell, /data-testid="overview-y-axis-pane"/, 'o eixo Y deve viver em um painel fixo separado do scroll horizontal');
assert.match(shell, /data-testid="overview-x-scroll-viewport"/, 'somente a timeline do overview deve rolar horizontalmente');
assert.match(shell, /__filteredEmpty/, 'o eixo X deve preservar buckets sem dados do filtro atual');
assert.match(shell, /__ghostMessage/, 'lacunas do filtro devem manter feedback semântico sem inventar zero clínico');
assert.match(shell, /height=\{44\}/, 'a área tocável da ghost bar deve atingir 44px');
assert.match(shell, /createPortal/, 'tooltips em gráficos roláveis devem escapar do clipping via portal');
assert.match(shell, /prefers-reduced-motion: reduce/, 'a transição curta do filtro deve respeitar preferência por movimento reduzido');
assert.match(shell, /border-b-\[3px\][\s\S]*?font-normal/, 'abas devem manter tipografia regular e indicador inferior forte em vez de depender de peso semibold');
assert.doesNotMatch(shell, /<BarChart[\s\S]*?<Legend wrapperStyle=\{\{ fontSize: 11 \}\} \/>[\s\S]*?overviewVisibleBars/, 'a visão geral não deve voltar a usar a legenda nativa do Recharts');
assert.match(shell, /session-minute:/, 'a visão geral por sessão deve consolidar registros canônicos da mesma sessão visual');
assert.match(shell, /abaSessionStartTimestamp/, 'sessões ABA devem usar o timestamp de início persistido no id como âncora visual');
assert.ok(shell.includes('Total: <strong>{total}</strong>'), 'o tooltip da barra empilhada deve mostrar o total da sessão ou dia');
assert.match(shell, /_reportSessionIds/, 'o agrupamento empilhado deve preservar um sessionId navegável quando houver uma única sessão ABA');
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
