import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');
const dashboard = readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');

assert.match(shell, /axis: AnalyticsAxis;/, 'o eixo analítico deve ser controlado pelo dashboard');
assert.match(shell, /onAxisChange: \(axis: AnalyticsAxis\) => void;/, 'a troca de eixo deve ser compartilhada com os cards individuais');
assert.match(shell, /flex h-\[170px\] min-w-0 sm:h-\[180px\]/, 'a visão geral deve permanecer compacta');
assert.match(shell, /minHeight=\{150\}/, 'o gráfico-resumo não deve voltar à altura antiga');
assert.match(shell, /data-testid="overview-y-axis-pane"/, 'o eixo Y compacto deve permanecer fixo fora do viewport rolável');
assert.match(shell, /data-testid="overview-x-scroll-viewport"/, 'a densidade temporal deve ser absorvida apenas pelo scroll do eixo X');

assert.match(dashboard, /useState<AnalyticsAxis>\('session'\)/, 'o dashboard deve manter um único eixo analítico compartilhado');
assert.match(dashboard, /axis=\{analyticsAxis\}/, 'o shell e o card detalhado devem receber o mesmo eixo');
assert.match(dashboard, /<SeriesChart series=\{series\} isDark=\{isPanelDark\} axis=\{analyticsAxis\}/, 'o card individual deve obedecer ao eixo global');
assert.match(dashboard, /data-axis=\{axis\}/, 'o gráfico detalhado deve declarar o eixo renderizado');
assert.match(dashboard, /\? 138[\s\S]*\? 152[\s\S]*: 168;/, 'o gráfico detalhado deve permanecer compacto');
assert.match(dashboard, /data-testid="clinical-evidence-compact-meta"/, 'metadados da evidência devem ficar em uma faixa compacta');
assert.match(dashboard, /Histórico anterior disponível/, 'o histórico Legacy deve continuar descobrível');
assert.doesNotMatch(dashboard, /<details[^>]*\sopen(?:=|\s|>)/, 'o histórico Legacy não pode abrir por padrão');
assert.match(dashboard, /mt-2 flex flex-wrap gap-1\.5/, 'o histórico expandido deve usar chips compactos, não cards altos');
assert.match(dashboard, /connectNulls=\{false\}/, 'a compactação não pode conectar lacunas clínicas');

console.log('clinicalAnalyticsDensity.regression.test.mjs: ok');
