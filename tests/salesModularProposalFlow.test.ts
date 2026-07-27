import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const server = read('server.ts');
const migration = read(
  'supabase/migrations/20260727030000_sales_modular_proposal_builder.sql'
);
const sqlTest = read(
  'supabase/tests/20260727030000_sales_modular_proposal_builder_test.sql'
);
const builder = read('src/components/SalesModularProposalBuilder.tsx');
const catalogPanel = read('src/components/SalesPricingCatalogPanel.tsx');
const publicOffer = read('src/components/PublicSalesOffer.tsx');
const simulator = read('src/components/SalesProfitabilitySimulator.tsx');
const engine = read('src/utils/salesModularProposal.ts');
const packageJson = JSON.parse(read('package.json'));

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const sliceFrom = (source: string, marker: string, length: number) => {
  const index = source.indexOf(marker);
  assert.ok(index >= 0, `${marker} não encontrado`);
  return source.slice(index, index + length);
};

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} não encontrado`);
  assert.ok(end > start, `${endMarker} não encontrado depois de ${startMarker}`);
  return source.slice(start, end);
};

test('migration e transacional, aditiva e nao toca a DRE realizada', () => {
  assert.match(migration, /^--[\s\S]*?\nbegin;/);
  assert.match(migration, /\ncommit;\s*$/);
  assert.match(
    migration,
    /alter table public\.sales_offer_simulations[\s\S]*simulation_type/
  );
  assert.match(
    migration,
    /create table if not exists public\.sales_offer_simulation_items/
  );
  assert.match(
    migration,
    /create table if not exists public\.sales_offer_items/
  );
  assert.doesNotMatch(
    migration,
    /(insert into|update|delete from) public\.(financial_entries|revenues|expenses)/i
  );
});

test('catalogo inicial possui os sete itens e precos solicitados', () => {
  for (const itemKey of [
    'clinical_core',
    'appointments_communication',
    'financial_management',
    'insurance_tiss',
    'school_management',
    'additional_storage',
    'onboarding'
  ]) {
    assert.match(migration, new RegExp(`'${itemKey}'`));
  }
  for (const amount of [
    '19900',
    '39900',
    '69900',
    '119900',
    '4900',
    '7900',
    '12900',
    '19900',
    '9900',
    '14900',
    '29900',
    '5900',
    '9900',
    '14900',
    '24900',
    '299',
    '990',
    '1690'
  ]) {
    assert.match(migration, new RegExp(`\\b${amount}\\b`));
  }
  assert.match(migration, /cost_source[\s\S]*'unavailable'/);
  assert.match(migration, /Custo por funcionalidade ainda não informado/);
});

test('estruturas internas e RPCs ficam somente no service_role', () => {
  for (const relation of [
    'sales_pricing_catalog_versions',
    'sales_pricing_catalog_items',
    'sales_pricing_catalog_tiers',
    'sales_pricing_item_cost_models',
    'sales_offer_simulation_items',
    'sales_offer_items',
    'sales_feature_profitability_summary_v1'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on public\\.${relation} from public, anon, authenticated`
      )
    );
  }
  for (const rpc of [
    'clone_sales_pricing_catalog_version_v1',
    'save_sales_pricing_catalog_draft_v1',
    'publish_sales_pricing_catalog_version_v1',
    'save_sales_modular_simulation_v1',
    'create_sales_modular_offer_v1'
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${rpc}[\\s\\S]{0,180}from public, anon, authenticated`
      )
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${rpc}[\\s\\S]{0,180}to service_role`
      )
    );
  }
  assert.match(migration, /set search_path = pg_catalog, public/g);
});

test('backend exige owner com MFA e recalcula sem aceitar resultados do navegador', () => {
  const catalogRoute = sliceFrom(
    server,
    '"/api/owner/sales/pricing-catalogs"',
    1000
  );
  const simulationRoute = sliceFrom(
    server,
    '"/api/owner/sales/leads/:leadId/modular-simulations"',
    18000
  );
  assert.match(catalogRoute, /checkAuth/);
  assert.match(catalogRoute, /checkOwner/);
  assert.match(simulationRoute, /checkAuth/);
  assert.match(simulationRoute, /checkOwner/);
  assert.match(simulationRoute, /loadSalesPricingCatalog\(/);
  assert.match(simulationRoute, /calculateSalesModularProposal\(/);
  assert.match(simulationRoute, /save_sales_modular_simulation_v1/);
  assert.doesNotMatch(
    simulationRoute,
    /req\.body\?\.(results|ebitda|margin|netIncome|cost)/
  );
});

test('catalogo, faixas e custos sao carregados em lote sem N mais um', () => {
  const loader = sliceFrom(
    server,
    'async function loadSalesPricingCatalog',
    8000
  );
  assert.match(loader, /Promise\.all\(\[/);
  assert.match(loader, /sales_pricing_catalog_items/);
  assert.match(loader, /sales_pricing_catalog_tiers/);
  assert.match(loader, /sales_pricing_item_cost_models/);
  assert.match(loader, /tiersByItem/);
  assert.match(loader, /costByItem/);
  assert.doesNotMatch(loader, /for[\s\S]{0,300}await supabase/);
  assert.match(builder, /calculateSalesModularProposal\(input, catalog, assumptions\)/);
});

test('proposta modular e atomica e nao acessa Stripe', () => {
  const modularPrepare = sliceBetween(
    server,
    'const prepareSalesModularOffer',
    'const prepareSalesOfferFromSimulation'
  );
  assert.match(modularPrepare, /calculateSalesModularProposal/);
  assert.match(modularPrepare, /create_sales_modular_offer_v1/);
  assert.match(modularPrepare, /stripeReady: false/);
  assert.match(modularPrepare, /modularCheckoutEnabled: false/);
  assert.doesNotMatch(
    modularPrepare,
    /getStripe\(\)|stripe\.|coupons\.create|checkout\.sessions\.create/
  );
  assert.match(
    migration,
    /create or replace function public\.create_sales_modular_offer_v1/
  );
  assert.match(migration, /insert into public\.sales_offer_items/);
  assert.match(migration, /modular_checkout_enabled, modular_snapshot/);
});

test('checkout modular e bloqueado antes de qualquer chamada Stripe', () => {
  const checkout = sliceFrom(
    server,
    '"/api/public/sales-offers/:token/checkout"',
    4000
  );
  const guardIndex = checkout.indexOf(
    'PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED'
  );
  const stripeIndex = checkout.indexOf('getStripe()');
  assert.ok(guardIndex > 0);
  assert.ok(stripeIndex > guardIndex);
  assert.match(
    checkout,
    /Checkout modular será habilitado após a validação da nova estrutura de pacotes/
  );
});

test('payload publico modular seleciona somente campos comerciais', () => {
  const loader = sliceFrom(server, 'const loadPublicSalesOffer', 15000);
  const publicBranch = sliceFrom(
    loader,
    'if (offerType === "modular")',
    8500
  );
  for (const field of [
    'public_name_snapshot',
    'public_description_snapshot',
    'limit_quantity',
    'included_quantity',
    'recurring_amount_cents',
    'one_time_amount_cents',
    'public_metadata'
  ]) {
    assert.match(loader, new RegExp(field));
  }
  for (const forbidden of [
    'direct_cost_cents',
    'ebitda_cents',
    'net_income_cents',
    'internal_result_snapshot',
    'internal_justification',
    'assumptions_snapshot'
  ]) {
    assert.doesNotMatch(loader, new RegExp(forbidden));
  }
  assert.doesNotMatch(
    publicBranch,
    /cost|margin|ebitda|profit|justification|assumption/i
  );
  assert.match(publicOffer, /Toda a estrutura clínica e ABA/);
  assert.match(publicOffer, /modularCheckoutEnabled/);
});

test('simulador existente evolui no mesmo ponto e preserva fallback legado', () => {
  assert.match(simulator, /SalesModularProposalBuilder/);
  assert.match(simulator, /legacyFallback/);
  assert.equal(
    (simulator.match(/export const SalesProfitabilitySimulator/g) || []).length,
    1
  );
  assert.match(builder, /Compare no máximo três cenários/);
  assert.match(builder, /Salvar cenário/);
  assert.match(builder, /Gerar proposta pública/);
  assert.match(builder, /Projeções da proposta/);
  assert.match(builder, /ModularOfferDetails/);
  assert.match(builder, /onboardingInstallments/);
  assert.doesNotMatch(builder, /window\.location\.reload|refreshAll/);
});

test('painel permite versionar catalogo e mostra relatorio simulado/proposto', () => {
  assert.match(catalogPanel, /Nova versão/);
  assert.match(catalogPanel, /Publicar versão/);
  assert.match(catalogPanel, /Criar versão do custo/);
  assert.match(catalogPanel, /Simulado e proposto/);
  assert.match(catalogPanel, /Não representa contratação nem receita realizada/);
});

test('motor documenta rateios separados e preserva residuo no pacote base', () => {
  assert.match(engine, /allocation\.stripePercentage/);
  assert.match(engine, /allocation\.stripeFixed/);
  assert.match(engine, /allocation\.revenueTax/);
  assert.match(engine, /allocation\.delinquency/);
  assert.match(engine, /allocation\.sharedPlatformCosts/);
  assert.match(engine, /allocation\.belowEbitda/);
  assert.match(engine, /allocation\[safeBaseIndex\] \+= safeTotal - allocated/);
});

test('teste SQL cobre grants, idempotencia, conflito, imutabilidade e rollback', () => {
  assert.match(sqlTest, /has_table_privilege/);
  assert.match(sqlTest, /has_function_privilege/);
  assert.match(sqlTest, /simulation retry was not idempotent/);
  assert.match(sqlTest, /different payload with same key should have failed/);
  assert.match(sqlTest, /left a partial row after failure/);
  assert.match(sqlTest, /published catalog mutation should have failed/);
  assert.match(sqlTest, /offer item mutation should have failed/);
  assert.match(sqlTest, /\nrollback;\s*$/);
});

test('scripts dedicados estao registrados', () => {
  assert.equal(
    packageJson.scripts['test:sales-modular-proposal'],
    'tsx tests/salesModularProposal.test.ts'
  );
  assert.equal(
    packageJson.scripts['test:sales-modular-flow'],
    'tsx tests/salesModularProposalFlow.test.ts'
  );
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

console.log(`sales modular flow tests passed: ${passed}/${tests.length}`);
