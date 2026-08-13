import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');
const coordinatorSource = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const billerSource = fs.readFileSync('src/components/BillerWorkspace.tsx', 'utf8');

assert.match(
  source,
  /if \(!payerId\) \{[\s\S]*?setTussMappings\(\[\]\);[\s\S]*?setProcedurePrices\(\[\]\);[\s\S]*?return;/,
  'A tela não deve carregar catálogos ou configurações TISS sem convênio selecionado.',
);
assert.match(
  source,
  /const catalogRequest = Promise\.all\(\[[\s\S]*?getTussServices[\s\S]*?getTussCodes[\s\S]*?tussCatalogInFlightRef\.current = catalogRequest/,
  'Os catálogos compartilhados TUSS devem ter uma única leitura em voo.',
);
assert.match(
  source,
  /tussCatalogLoadedRef\.current && tussCatalogDataRef\.current[\s\S]*?\? Promise\.resolve\(tussCatalogDataRef\.current\)/,
  'Trocar de convênio deve reutilizar os dados canônicos do catálogo, não o estado React potencialmente atrasado.',
);
assert.match(source, /tussCatalogDataRef\.current = catalog;[\s\S]*?setTussServices\(catalog\.services\);[\s\S]*?tussCatalogLoadedRef\.current = true;/,
  'o cache só pode ficar pronto depois de guardar e atribuir o catálogo confirmado');
assert.match(
  source,
  /if \(requestId !== tussConfigRequestRef\.current \|\| requestWorkspace !== workspaceScopeRef\.current\) return;/,
  'Uma resposta antiga não pode sobrescrever o convênio selecionado mais recentemente.',
);
assert.match(source, /const requestId = \+\+requirementsRequestRef\.current;[\s\S]*?if \(requestId !== requirementsRequestRef\.current\) return;/,
  'regras antigas não podem sobrescrever o pagador atual');
assert.match(source, /const requestId = \+\+payerTissProfileRequestRef\.current;[\s\S]*?if \(requestId !== payerTissProfileRequestRef\.current\) return;/,
  'perfil TISS antigo não pode sobrescrever o pagador atual');
assert.match(source, /!mappingsResult\?\.success[\s\S]*?throw new Error\("Não foi possível carregar o De\/Para e os valores deste convênio\."\)/,
  'falha de configuração não pode virar lista vazia editável silenciosamente');

assert.match(source, /setLoading\(true\);[\s\S]*?setRequirements\(\[\]\);[\s\S]*?setRequirementForm\(defaultRequirement\(payerId\)\);[\s\S]*?getPayerRequirements\(payerId\)/,
  'ao trocar o pagador, regras e formulario anteriores devem sair da tela antes da nova consulta');
assert.match(source, /setTussLoading\(true\);[\s\S]*?setTussMappings\(\[\]\);[\s\S]*?setProcedurePrices\(\[\]\);[\s\S]*?dataService\.getPayerTussMappings/,
  'De/Para e precos do pagador anterior devem ser removidos enquanto a nova base carrega');
assert.match(source, /if \(tussConfigInFlightRef\.current\?\.payerId === payerId\) return;/,
  'atualizacoes repetidas do mesmo pagador devem compartilhar a leitura em andamento');
assert.match(source, /setTussMappingForm\(defaultTussMappingForm\);[\s\S]*?setProcedurePriceForm\(defaultProcedurePriceForm\);/,
  'formularios do pagador anterior nao podem continuar acionaveis durante a troca');
assert.match(source, /disabled=\{!selectedPayerId \|\| !tussMappingForm\.serviceCatalogId \|\| saving \|\| tussLoading\}/,
  'o De/Para nao pode ser salvo enquanto a configuracao do pagador ainda carrega');
assert.match(coordinatorSource, /key=\{`payers:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'o cache TISS do coordenador deve ser descartado quando o workspace ativo mudar');
assert.match(billerSource, /key=\{`payers:\$\{workspaceScopeKey\}`\}[\s\S]*?workspaceScopeKey=\{workspaceScopeKey\}/,
  'o cache TISS do faturista deve ser descartado quando o workspace ativo mudar');

console.log('payerRequirementsDataEconomy.test.ts: OK');
