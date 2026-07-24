import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const server = read('server.ts');
const simulator = read('src/components/SalesProfitabilitySimulator.tsx');
const assumptionsPanel = read(
  'src/components/SalesFinancialAssumptionsPanel.tsx'
);
const dashboard = read('src/components/SuperAdminDashboard.tsx');
const publicOffer = read('src/components/PublicSalesOffer.tsx');
const migration = read(
  'supabase/migrations/20260724120000_sales_offer_profitability_simulator.sql'
);
const packageJson = JSON.parse(read('package.json'));

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const sliceFrom = (source: string, marker: string, length: number) => {
  const index = source.indexOf(marker);
  assert.ok(index >= 0, `${marker} nao encontrado`);
  return source.slice(index, index + length);
};

test('package expoe testes dedicados do simulador', () => {
  assert.equal(
    packageJson.scripts['test:sales-profitability'],
    'tsx tests/salesProfitability.test.ts'
  );
  assert.equal(
    packageJson.scripts['test:sales-profitability-flow'],
    'tsx tests/salesProfitabilityFlow.test.ts'
  );
});

test('migration e aditiva, versionada, protegida por RLS e nao toca DRE', () => {
  assert.match(
    migration,
    /create table if not exists public\.sales_financial_assumption_sets/
  );
  assert.match(
    migration,
    /create table if not exists public\.sales_offer_simulations/
  );
  assert.match(
    migration,
    /create unique index if not exists sales_offer_simulations_creator_idempotency_uidx/
  );
  assert.match(
    migration,
    /alter table public\.sales_offer_simulations enable row level security/
  );
  assert.match(
    migration,
    /revoke all on public\.sales_offer_simulations from anon, authenticated/
  );
  assert.doesNotMatch(
    migration,
    /insert into public\.(financial_entries|revenues|expenses)|update public\.(financial_entries|revenues|expenses)/i
  );
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test('premissas e simulacoes exigem owner com MFA no servidor', () => {
  for (const marker of [
    '"/api/owner/sales/profitability-assumptions"',
    '"/api/owner/sales/leads/:leadId/simulations"',
    '"/api/owner/sales/leads/:leadId/simulations/:simulationId/select"',
  ]) {
    const route = sliceFrom(server, marker, 500);
    assert.match(route, /checkAuth/);
    assert.match(route, /checkOwner/);
  }
});

test('backend recalcula a simulacao e nao aceita resultado financeiro do cliente', () => {
  const route = sliceFrom(
    server,
    '"/api/owner/sales/leads/:leadId/simulations"',
    14500
  );
  assert.match(route, /normalizeSalesSimulationRequest\(req\.body\)/);
  assert.match(route, /calculateSalesProfitability\(/);
  assert.match(route, /results_snapshot: results/);
  assert.doesNotMatch(route, /req\.body\?\.(results|ebitda|margin|netIncome)/);
  assert.doesNotMatch(route, /getStripe\(\)|stripe\./);
  assert.doesNotMatch(route, /checkout\.sessions\.create|coupons\.create/);
});

test('oferta copia snapshot imutavel e cria cupom somente no preparo', () => {
  const prepare = sliceFrom(
    server,
    'const prepareSalesOfferFromSimulation',
    25000
  );
  assert.match(prepare, /simulation_snapshot:/);
  assert.match(prepare, /stripe\.coupons\.create/);
  assert.match(prepare, /duration: "repeating"/);
  assert.match(prepare, /duration_in_months: duration/);
  assert.match(
    prepare,
    /idempotencyKey: `sales-offer-coupon:\$\{offer\.id\}`/
  );
  assert.match(prepare, /\.eq\("simulation_id", simulationId\)/);
  assert.match(prepare, /OFFER_SIMULATION_CHANGED/);
  assert.match(prepare, /SIMULATION_FINANCIAL_DATA_INSUFFICIENT/);
});

test('checkout reutiliza o cupom individual sem aceitar IDs Stripe do cliente', () => {
  const checkout = sliceFrom(
    server,
    '"/api/public/sales-offers/:token/checkout"',
    8500
  );
  assert.match(checkout, /offer\.stripe_coupon_id/);
  assert.match(checkout, /discounts/);
  assert.match(checkout, /sales-offer-checkout:\$\{offer\.id\}/);
  const ownerOffer = sliceFrom(
    server,
    '"/api/owner/sales/offers"',
    2500
  );
  assert.match(ownerOffer, /stripeCouponId/);
  assert.match(ownerOffer, /IDs Stripe não são aceitos pelo cliente/);
});

test('payload e pagina publica exibem somente condicoes comerciais', () => {
  const publicLoad = sliceFrom(
    server,
    '"/api/public/sales-offers/:token"',
    7000
  );
  for (const publicField of [
    'promotionalUnitAmountCents',
    'promotionalMonthlyAmountCents',
    'postDiscountMonthlyAmountCents',
  ]) {
    assert.match(publicLoad, new RegExp(publicField));
    assert.match(publicOffer, new RegExp(publicField));
  }
  for (const internalField of [
    'ebitda',
    'netIncome',
    'contributionMargin',
    'profitabilityRating',
    'internalJustification',
    'assumptionsSnapshot',
  ]) {
    assert.doesNotMatch(publicLoad, new RegExp(internalField, 'i'));
    assert.doesNotMatch(publicOffer, new RegExp(internalField, 'i'));
  }
});

test('painel substitui oferta rigida pelo simulador sem full refetch', () => {
  assert.match(dashboard, /SalesProfitabilitySimulator/);
  assert.match(dashboard, /Simular rentabilidade/);
  assert.doesNotMatch(dashboard, /Cupom 6 meses|Cupom 12 meses|Cupom 24 meses/);
  const callback = sliceFrom(dashboard, 'onOfferPrepared=', 1500);
  assert.match(callback, /setLeadRecoveryItems/);
  assert.doesNotMatch(callback, /refreshAll/);
});

test('simulador carrega premissas e historico em lote e oferece envio do link', () => {
  assert.match(simulator, /Promise\.all\(\[/);
  assert.match(
    simulator,
    /\/api\/owner\/sales\/profitability-assumptions/
  );
  assert.match(simulator, /\/simulations/);
  assert.match(simulator, /Abrir proposta/);
  assert.match(simulator, /Copiar link/);
  assert.match(simulator, /Enviar pelo WhatsApp/);
  assert.doesNotMatch(simulator, /window\.location\.reload|refreshAll/);
});

test('premissas globais ficam fora do simulador e preservam versoes e origens', () => {
  assert.match(dashboard, /Configurações financeiras/);
  assert.match(dashboard, /SalesFinancialAssumptionsPanel/);
  assert.match(
    assumptionsPanel,
    /Premissas de simulação comercial/
  );
  assert.match(assumptionsPanel, /Configuração básica/);
  assert.match(assumptionsPanel, /Configurações avançadas/);
  assert.match(assumptionsPanel, /Histórico de versões/);
  assert.match(assumptionsPanel, /Perfis de uso/);
  for (const source of [
    'Real',
    'Calculado',
    'Estimado',
    'Manual',
    'Indisponível',
  ]) {
    assert.match(assumptionsPanel, new RegExp(source));
  }
  assert.doesNotMatch(simulator, /Nome da nova versão/);
  assert.doesNotMatch(simulator, /Criar nova versão/);
  assert.doesNotMatch(simulator, /Tarifa percentual da Stripe/);
});

test('drawer do lead e compacto e mantem detalhes secundarios recolhidos', () => {
  for (const label of [
    'Pacientes ativos iniciais',
    'Preço oficial por paciente',
    'Desconto personalizado',
    'Duração do desconto',
    'Validade da proposta',
    'Perfil de uso',
    'Observação interna',
    'Custos adicionais desta proposta',
    'Receita promocional',
    'Margem de contribuição',
    'EBITDA incremental',
    'Margem EBITDA',
    'Lucro líquido estimado',
    'Classificação da oferta',
    'Projeções de 12, 24 e 36 meses',
    'Ponto de equilíbrio',
    'Detalhamento dos custos',
    'Origem dos dados',
    'Memória de cálculo',
    'Histórico de simulações',
  ]) {
    assert.match(simulator, new RegExp(label));
  }
  assert.match(simulator, /<details/);
  assert.match(simulator, /Premissas utilizadas/);
  assert.match(simulator, /Ver ou alterar premissas/);
});

test('ausencia de premissas permite snapshot incompleto sem liberar oferta', () => {
  assert.match(
    simulator,
    /Configure as premissas financeiras uma única vez/
  );
  assert.match(simulator, /Salvar simulação incompleta/);
  assert.match(simulator, /Configurar dados ausentes/);
  assert.match(
    simulator,
    /selectedSimulation\.profitability_rating === 'insufficient_data'/
  );
  assert.match(
    simulator,
    /Complete as premissas financeiras obrigatórias antes de preparar a oferta/
  );
});

test('endpoint entrega versao ativa e historico em uma unica consulta limitada', () => {
  const route = sliceFrom(
    server,
    '"/api/owner/sales/profitability-assumptions"',
    3500
  );
  assert.match(route, /\.limit\(50\)/);
  assert.match(route, /assumptionSet: assumptionSets\[0\] \|\| null/);
  assert.match(route, /assumptionSets,/);
  assert.doesNotMatch(route, /Promise\.all/);
});

test('webhook persiste duracoes personalizadas de um a 36 meses', () => {
  const sync = sliceFrom(
    server,
    'const syncSalesSubscriptionDiscount',
    5200
  );
  assert.match(sync, /isCustomCouponDurationMonths\(durationMonths\)/);
  assert.match(sync, /discount_duration_months/);
  assert.match(sync, /post_discount_unit_amount_cents/);
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

console.log(`sales profitability flow tests passed: ${passed}/${tests.length}`);
