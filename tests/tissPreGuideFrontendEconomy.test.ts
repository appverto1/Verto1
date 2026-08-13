import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/TissPreGuideTab.tsx', 'utf8');
const conferenceSource = fs.readFileSync('src/components/MonthlyConferenceCenter.tsx', 'utf8');
const coordinatorSource = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const billerSource = fs.readFileSync('src/components/BillerWorkspace.tsx', 'utf8');

const between = (start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const rowsLoader = between('const loadRows = useCallback', 'const loadCoverage = useCallback');
assert.equal((rowsLoader.match(/dataService\.getTissPreGuides\(/g) || []).length, 1);
assert.doesNotMatch(rowsLoader, /getTissPreGuideCoverage/,
  'paginar ou filtrar a lista nao pode recalcular a cobertura do periodo');
assert.match(rowsLoader, /rowsInFlightRef\.current\.get\(requestKey\)/,
  'requisicoes identicas em voo devem compartilhar a mesma Promise');
assert.match(rowsLoader, /requestSequence !== rowsRequestSequenceRef\.current/,
  'resposta de uma consulta obsoleta nao pode sobrescrever o filtro atual');
assert.match(source, /JSON\.stringify\(\[workspaceScopeKey, from, to, patientId, professionalId, payerId\]\)/,
  'o cache da lista precisa incluir o workspace ativo');
assert.match(source, /JSON\.stringify\(\[workspaceScopeKey, competenceMonth, payerId\]\)/,
  'documentos e rascunhos precisam incluir o workspace ativo');
assert.match(source, /rowsInFlightRef\.current\.clear\(\)[\s\S]*?setRows\(\[\]\)[\s\S]*?\}, \[workspaceScopeKey\]\);/,
  'a troca de clinica deve descartar dados e requisicoes em voo do tenant anterior');
assert.match(conferenceSource, /<TissPreGuideTab[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'a conferencia mensal deve propagar o escopo do workspace');
assert.match(coordinatorSource, /key=\{`conference:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'o coordenador deve remontar a conferencia ao trocar de clinica');
assert.match(billerSource, /key=\{`conference:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'o faturista deve remontar a conferencia ao trocar de clinica');

const effects = between('const scopeChanged = previousListScopeKeyRef.current !== listScopeKey', 'const openDetail = async');
const resetIndex = effects.indexOf('setPage(1)');
const rowsFetchIndex = effects.indexOf('void loadRows()');
assert.ok(resetIndex >= 0 && rowsFetchIndex > resetIndex,
  'ao trocar o escopo, a pagina deve ser normalizada antes de consultar');
assert.match(effects, /if \(page !== 1\) \{\s*setPage\(1\);\s*return;/,
  'pagina antiga precisa retornar sem disparar request obsoleto');

const listEffect = effects.slice(0, effects.indexOf('useEffect(() => {'));
assert.equal((listEffect.match(/void loadRows\(\)/g) || []).length, 1);
assert.doesNotMatch(listEffect, /loadCoverage|loadXmlDrafts|loadBatchDrafts|loadOfficialDocuments/,
  'pagina/filtro da lista deve produzir somente uma chamada principal');

assert.match(effects, /useEffect\(\(\) => \{\s*void loadCoverage\(\);\s*\}, \[loadCoverage\]\);/,
  'cobertura deve seguir apenas os filtros de escopo, nunca a paginacao');
assert.match(effects, /useEffect\(\(\) => \{\s*void loadOfficialDocuments\(\);\s*\}, \[loadOfficialDocuments\]\);/,
  'historico oficial deve ter ciclo independente');
assert.match(effects, /if \(!internalToolsOpen\) return;[\s\S]*activePanel === "xmlDrafts"[\s\S]*else void loadBatchDrafts\(\)/,
  'somente o painel avancado visivel deve carregar seus rascunhos');

const periodRevalidation = between('const revalidatePeriod = async', 'const openXmlDraftModal');
assert.doesNotMatch(periodRevalidation, /await loadRows/,
  'revalidacao do periodo nao deve fazer refresh imperativo e outro pelo effect');
assert.match(periodRevalidation, /setRowsRefreshVersion/,
  'revalidacao deve agendar exatamente um refresh pelo ciclo canonico');

// Contagem de rede do fluxo normal:
// antes: lista + cobertura + XML rascunho + lote rascunho + documentos = 5;
// depois: lista + cobertura + documentos = 3 no primeiro acesso e somente lista = 1 por pagina/filtro.
assert.equal((listEffect.match(/void load[A-Z][A-Za-z]+\(/g) || []).length, 1);

console.log('tissPreGuideFrontendEconomy tests passed');
