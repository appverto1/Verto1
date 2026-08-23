import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');

assert.match(dashboard, /sm:hidden[\s\S]*?<select[\s\S]*?value=\{periodPreset\}/, 'mobile deve usar seletor de período compacto sem comprimir todos os presets');
assert.match(dashboard, />\{comparePrevious \? '✓ Comparando' : 'Comparar'\}</, 'Comparar deve permanecer explícito em texto no mobile');
assert.match(dashboard, /<SlidersHorizontal[^>]*>[\s\S]*?Filtros\{activeFilterCount/, 'Filtros deve permanecer explícito em texto, não como ícone isolado');
assert.match(dashboard, /aria-label="Filtros clínicos ativos"/, 'filtros aplicados precisam continuar visíveis fora do painel de edição');
assert.match(dashboard, /expandedTargetKeys[\s\S]*?slice\(-2\)/, 'no máximo dois alvos podem permanecer abertos simultaneamente');
assert.doesNotMatch(dashboard, /scrollIntoView/, 'accordion clínico não deve depender de scrollIntoView e causar salto de layout');
assert.match(dashboard, /data-testid="clinical-target-card"[\s\S]*?data-testid="clinical-target-detail"/, 'o gráfico expandido deve nascer dentro do card pai');
assert.match(dashboard, /<span className="sr-only">Evidência aberta<\/span>/, 'estado expandido deve continuar acessível sem repetir um cabeçalho visual redundante');

assert.match(patientDetail, /activeTab === 'aba-charts'[\s\S]*?Equipe · \{activeCaseTeamLinks\.length\}/, 'Gráficos deve manter apenas o contexto compacto da equipe no cabeçalho');
assert.match(patientDetail, /activeTab === 'aba-charts' && !showChartsCaseTeam \? 'hidden' : 'mt-6 grid'/, 'gestão administrativa da equipe deve sair do caminho clínico e abrir apenas sob demanda');
assert.match(patientDetail, /caseTeamIntegrityPendingCount/, 'pendências da equipe devem permanecer descobríveis no contexto compacto');

console.log('clinicalOutcomesMobileUx.regression.test.mjs: ok');
