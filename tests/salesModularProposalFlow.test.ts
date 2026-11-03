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
const publicOfferDetails = read('src/components/ModularPublicOfferDetails.tsx');

assert.match(builder, /Usar faixa recomendada/);
assert.match(builder, /Seleção automática/);
assert.match(builder, /Seleção manual/);
assert.match(builder, /Limite técnico de capacidade/);
assert.match(builder, /customBasePackageLimit/);
assert.match(builder, /basePackageSelectionMode/);
assert.match(builder, /modularCheckoutEnabled: true/);
assert.match(builder, /trialDays: 7/);
assert.match(builder, /selectedSimulationTrialDays/);
assert.match(builder, /Período de teste alterado\. Salve e selecione um novo cenário/);
assert.match(builder, /selectedSimulationTrialMismatch/);
assert.match(builder, /Cenário selecionado:/);

assert.match(server, /customBasePackageLimit/);
assert.match(server, /basePackageSelectionMode/);
assert.match(
  server,
  /inputSnapshot: resultSnapshot\.input/,
  'o limite, o preço por paciente e o total derivado devem ser congelados no snapshot canônico'
);
assert.match(
  server,
  /resultsSnapshot: resultSnapshot/,
  'o resultado calculado da faixa personalizada deve ser congelado sem recálculo histórico'
);
assert.match(
  server,
  /basePackage: sanitizePublicBasePackage\(/,
  'a proposta pública deve reutilizar e sanitizar o pacote-base congelado'
);
assert.match(server, /modularCheckoutEnabled: offer\?\.modular_checkout_enabled === true/);
assert.match(server, /create_sales_modular_offer_v3/);
assert.doesNotMatch(server, /PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED/);
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
assert.match(publicOffer, /Continuar para cadastro do cartão/);
assert.match(publicOfferDetails, /dias gratuitos/);

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
