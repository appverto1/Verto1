import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const builder = read('src/components/SalesModularProposalBuilder.tsx');
const server = read('server.ts');
const costDrivers = read('src/utils/salesModularCostDrivers.ts');
const catalogPanel = read('src/components/SalesPricingCatalogPanel.tsx');
const tissEngine = read('src/services/tissPreGuideEngine.ts');
const billingSettings = read('src/components/BillingTissSettingsPanel.tsx');
const publicOffer = read('src/components/PublicSalesOffer.tsx');

assert.match(builder, /Usar faixa recomendada/);
assert.match(builder, /Seleção automática/);
assert.match(builder, /Seleção manual/);
assert.match(builder, /Limite contratado do pacote-base/);
assert.match(builder, /customBasePackageLimit/);
assert.match(builder, /basePackageSelectionMode/);
assert.match(builder, /modularCheckoutEnabled: false/);

assert.match(server, /customBasePackageLimit/);
assert.match(server, /basePackageSelectionMode/);
assert.match(
  server,
  /inputSnapshot: input/,
  'o limite e o preÃ§o personalizados devem ser congelados no snapshot de entrada'
);
assert.match(
  server,
  /resultsSnapshot: results/,
  'o resultado calculado da faixa personalizada deve ser congelado sem recÃ¡lculo histÃ³rico'
);
assert.match(
  server,
  /basePackage: modularSnapshot\.basePackage \|\| null/,
  'a proposta pÃºblica deve reutilizar o pacote-base congelado'
);
assert.match(server, /modularCheckoutEnabled: false/);
assert.match(server, /PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED/);
assert.match(
  server,
  /stripe\.checkout\.sessions\.create/,
  'o Checkout legado deve continuar implementado'
);

assert.match(costDrivers, /label: 'Sessões mensais'/);
assert.match(costDrivers, /label: 'Lembretes por sessão'/);
assert.match(costDrivers, /unit: 'lembretes\/sessão'/);
assert.match(catalogPanel, /appointments_communication: 'R\$\/sessão'/);

assert.match(
  tissEngine,
  /guideType: 'consulta' \| 'sp_sadt' \| 'other'/,
  'o contrato técnico TISS deve continuar usando consulta'
);
assert.match(
  billingSettings,
  /<option value="consulta">Sessão<\/option>/,
  'o valor persistido permanece consulta e o rótulo visível vira Sessão'
);
assert.match(publicOffer, /checkout modular será habilitado/);

const visibleFiles = [
  'src/components/Calendar.tsx',
  'src/components/PatientDashboard.tsx',
  'src/components/PatientDetailView.tsx',
  'src/components/PatientFinanceWorkspace.tsx',
  'src/components/CoordinatorDashboard.tsx',
  'src/components/SessionMode.tsx',
  'src/services/notificationBranding.ts'
];
for (const file of visibleFiles) {
  const source = read(file);
  assert.doesNotMatch(
    source,
    /\bConsultas?\b(?! Padrão)/,
    `${file} não deve exibir Consulta/Consultas`
  );
}

console.log('salesModularProposalFlow.test.ts: OK');
