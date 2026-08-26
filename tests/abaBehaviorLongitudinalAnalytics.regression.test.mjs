import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/AbaClinicalChartsPanel.tsx', 'utf8');
const charts = readFileSync('src/utils/abaClinicalCharts.ts', 'utf8');
const workspace = readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');

assert.match(charts, /export function buildBehaviorLongitudinalChart/);
assert.match(charts, /selectedBehaviorIds\?: string\[\]/);
assert.match(charts, /Math\.min\(3,/);
assert.match(charts, /row\[item\.key\] = null/);
assert.match(charts, /buildSessionDisplayLabel\(\{ sessionId, changedAt/);
assert.match(charts, /sessionId: groupBy === 'session' && group\.sessionIds\.size === 1/);

assert.match(panel, /Comportamentos no gráfico · até 3/);
assert.match(panel, /data-aba-behavior-longitudinal-chart/);
assert.match(panel, /Evolução do comportamento/);
assert.match(panel, /dot=\{false\}/);
assert.match(panel, /activeDot=\{behaviorActiveDot\}/);
assert.match(panel, /connectNulls=\{false\}/);
assert.match(panel, /Clique no ponto para abrir o relatório da sessão/);
assert.match(panel, /Tendência de aumento/);
assert.match(panel, /não equivale, isoladamente, a regressão clínica/);
assert.match(panel, /pelo menos 3 pontos comparáveis/);
assert.match(panel, /comportamento\(s\) · \{behaviorContextPatterns\.length\} com contexto/);
assert.match(panel, /border-sky-500 bg-sky-600 text-white/);

assert.match(workspace, /<AbaClinicalChartsPanel[^>]*onOpenSessionReport=\{onOpenSessionReport\}/);

console.log('abaBehaviorLongitudinalAnalytics.regression.test.mjs: ok');
