import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const changeAnalytics = fs.readFileSync('src/utils/clinicalProgramChangeAnalytics.ts', 'utf8');

assert.match(shell, /Andamento geral dos programas/, 'mudanças por sessão deve resumir programas, não repetir um gráfico por alvo');
assert.match(shell, /Evolução dos programas/, 'a visão deve explicitar evolução dos programas');
assert.match(shell, /Maiores evoluções/, 'a visão deve destacar alvos em evolução');
assert.match(shell, /Precisam de atenção/, 'a visão deve destacar alvos em piora');
assert.match(shell, /sem criar score ou média entre unidades incompatíveis/i, 'a visão não pode reintroduzir score global');
assert.match(shell, /activeDomain !== 'changes' && activeMetric/, 'mudanças por sessão não deve exibir seletor de uma métrica/alvo individual');
assert.match(shell, /ProgramChangesView series=\{series\} programs=\{programs\}/, 'a aba de mudanças deve usar o resumo por programa');
assert.match(dashboard, /programs=\{data\.programs \|\| \[\]\}/, 'o shell precisa receber os programas canônicos retornados pelo dashboard');

assert.match(changeAnalytics, /therapeuticObjectiveId/, 'evidência CMV3 sem programId deve poder resolver o programa pelo objetivo terapêutico');
assert.match(changeAnalytics, /program_target:\(\[\^:\]\+\):/, 'alvos program_target devem preservar identidade individual mesmo quando compartilham o target CMV3 do objetivo');
assert.match(changeAnalytics, /values\.length < 3/, 'tendência não deve ser classificada com menos de três sessões comparáveis');
assert.match(changeAnalytics, /direction === 'lower_is_better'/, 'a direção clínica deve inverter corretamente métricas em que menor é melhor');
assert.match(changeAnalytics, /no_directional_judgment/, 'volume sem direção clínica não pode virar melhora/piora');
assert.match(changeAnalytics, /representativeByTarget/, 'cada alvo deve entrar uma única vez no resumo do programa');
assert.doesNotMatch(shell, /Desempenho Geral|score global/i, 'o shell não deve criar score global do paciente');

console.log('clinicalProgramChangeOverview.regression.test.mjs: ok');
