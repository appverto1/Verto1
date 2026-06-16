import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const packageJson = read('package.json');
const envExample = read('.env.example');
const serverCode = read('server.ts');
const stripeServiceCode = read('services/stripeService.ts');
const landingCode = read('src/components/LandingPage.tsx');
const appCode = read('src/App.tsx');
const adminCode = read('src/components/AdminDashboard.tsx');
const superAdminCode = read('src/components/SuperAdminDashboard.tsx');
const invitationCode = read('src/components/InvitationModal.tsx');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const therapistCode = read('src/components/TherapistDashboard.tsx');
const receptionistCode = read('src/components/ReceptionistDashboard.tsx');
const migrationCode = read('supabase/migrations/20260610120000_active_patient_billing_consolidation.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 4000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

function doesNotContain(source: string, needles: string[]) {
  for (const needle of needles) {
    assert.equal(source.includes(needle), false, `Nao deveria conter ${needle}.`);
  }
}

test('package expoe script test:billing', () => {
  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['test:billing'], 'tsx tests/billing.test.ts');
});

test('env usa apenas o Price modular por paciente ativo no fluxo profissional', () => {
  assert.match(envExample, /STRIPE_ACTIVE_PATIENT_PRICE_ID=/);
  assert.match(envExample, /STRIPE_BILLING_PLAN_PRICE_IDS=/);
  assert.match(envExample, /SALES_CONTACT_URL=/);
  assert.match(envExample, /STRIPE_ACTIVE_PATIENT_BILLING_MODE=quantity/);
  assert.match(envExample, /ACTIVE_PATIENT_ENTERPRISE_THRESHOLD=50/);
  doesNotContain(envExample, [
    'STRIPE_PRICE_ESSENCIAL',
    'STRIPE_PRICE_CRESCIMENTO',
    'STRIPE_PRICE_AVANCADO',
    'STRIPE_ACTIVE_PATIENT_METER_EVENT_NAME'
  ]);
});

test('contador de pacientes ativos e central, server-side e sem select star', () => {
  assert.match(stripeServiceCode, /export async function getBillableActivePatientCount/);
  assert.match(stripeServiceCode, /\.from\('patients'\)[\s\S]*?\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(stripeServiceCode, /\.eq\('is_active', true\)/);
  assert.match(stripeServiceCode, /\.is\('deleted_at', null\)/);
  assert.match(stripeServiceCode, /\.or\(activePatientStatusFilter\(\)\)/);
  assert.doesNotMatch(stripeServiceCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  assert.doesNotMatch(stripeServiceCode, /\.select\('id,status'\)/);
});

test('sync Stripe atualiza quantity do subscription item e persiste referencias criticas', () => {
  assert.match(stripeServiceCode, /const billableQuantity = Math\.max\(1, activePatients\)/);
  assert.match(stripeServiceCode, /stripe\.subscriptionItems\.update[\s\S]*?quantity: billableQuantity[\s\S]*?proration_behavior: 'none'/);
  assert.match(stripeServiceCode, /stripe\.subscriptionItems\.create[\s\S]*?price: priceId[\s\S]*?quantity: billableQuantity[\s\S]*?proration_behavior: 'none'/);
  for (const field of [
    'stripe_customer_id',
    'stripe_subscription_id',
    'stripe_subscription_item_id',
    'stripe_price_id',
    'subscription_status',
    'billing_model',
    'active_patient_count',
    'billing_sync_status',
    'billing_sync_error',
    'last_billing_sync_at'
  ]) {
    assert.match(stripeServiceCode, new RegExp(field));
  }
  assert.doesNotMatch(stripeServiceCode, /meterEvents\.create/);
});

test('checkout de cadastro profissional nao aceita plano/preco vindo do front', () => {
  const route = sliceFrom(serverCode, "app.post('/api/stripe/create-checkout-registration'", 5200);
  assert.match(route, /const activePatientPriceId = resolveActivePatientPriceId\(\)/);
  assert.match(route, /line_items: \[\{ price: activePatientPriceId, quantity: 1 \}\]/);
  assert.match(route, /billingModel: ACTIVE_PATIENT_BILLING_MODEL/);
  assert.doesNotMatch(route, /planPrices|requestedPlan|price_data|planName/);
});

test('checkout autenticado preserva paciente separado e usa active patient price para clinica', () => {
  const handler = sliceFrom(serverCode, 'const handleCreateClinicCheckout', 12000);
  assert.match(handler, /const isPatientCheckout/);
  assert.match(handler, /const activePatientPriceId = isPatientCheckout \? '' : resolveActivePatientPriceId\(\)/);
  assert.match(handler, /listStripeActivePatientBillingPlans/);
  assert.match(handler, /selectedPriceId/);
  assert.match(handler, /requestedPlan/);
  assert.match(handler, /PRICE_NOT_AVAILABLE/);
  assert.match(handler, /INVALID_ACTIVE_PATIENTS/);
  assert.match(handler, /ENTERPRISE_REQUIRED/);
  assert.match(handler, /MISSING_ORGANIZATION/);
  assert.match(handler, /MISSING_STRIPE_CONFIG/);
  assert.match(handler, /STRIPE_CUSTOMER_FAILED/);
  assert.match(handler, /CHECKOUT_SESSION_FAILED/);
  assert.match(handler, /selectedPriceIdPresent/);
  assert.match(handler, /priceRecurring/);
  assert.match(handler, /checkoutCreated/);
  assert.match(handler, /activePatients/);
  assert.match(handler, /price: selectedClinicPlan!\.priceId/);
  assert.match(handler, /quantity: selectedClinicPlan!\.usesActivePatientQuantity \? activePatients : 1/);
  assert.match(handler, /billingModel: ACTIVE_PATIENT_BILLING_MODEL/);
  assert.match(serverCode, /app\.post\('\/api\/billing\/checkout', checkAuth, handleCreateClinicCheckout\)/);
  assert.match(serverCode, /app\.post\('\/api\/stripe\/create-checkout', checkAuth, handleCreateClinicCheckout\)/);
  assert.doesNotMatch(handler, /planPrices|STRIPE_PRICE_ESSENCIAL|STRIPE_PRICE_CRESCIMENTO|STRIPE_PRICE_AVANCADO/);
});

test('endpoint de planos le Stripe e retorna apenas dados seguros para onboarding', () => {
  const route = sliceFrom(serverCode, "app.get('/api/billing/plans'", 4600);
  assert.match(route, /checkAuth/);
  assert.match(route, /listStripeActivePatientBillingPlans/);
  assert.match(route, /resolveBillingPlanPriceIds/);
  assert.match(route, /enterpriseThreshold/);
  assert.match(route, /salesContactUrl/);
  assert.match(route, /firstPlanTierCount/);
  assert.match(route, /tieredPricesFound/);
  assert.match(route, /MISSING_STRIPE_CONFIG/);
  assert.doesNotMatch(route, /STRIPE_SECRET_KEY|sk_|apiKey/);
});

test('parser Stripe expande tiers e transforma faixas up_to em from/to', () => {
  assert.match(stripeServiceCode, /expand:\s*\['data\.product', 'data\.tiers'\]/);
  assert.match(stripeServiceCode, /prices\.retrieve\(priceId, \{ expand: \['product', 'tiers'\] \}\)/);
  assert.match(stripeServiceCode, /prices\.retrieve\(resolvedPrice\.id, \{ expand: \['product', 'tiers'\] \}\)/);
  assert.match(stripeServiceCode, /const from = previousTierLimit \+ 1/);
  assert.match(stripeServiceCode, /tier\.up_to === 'inf' \? null : toSafeInteger\(tier\.up_to\)/);
  assert.match(stripeServiceCode, /firstPlanTierCount/);
});

test('endpoint de estimativa calcula faixa server-side e nao abre checkout enterprise', () => {
  const estimateRoute = sliceFrom(serverCode, "app.post('/api/billing/estimate'", 4200);
  assert.match(estimateRoute, /estimateStripeActivePatientPlan/);
  assert.match(estimateRoute, /PRICE_NOT_AVAILABLE/);
  assert.match(estimateRoute, /INVALID_ACTIVE_PATIENTS/);
  assert.match(estimateRoute, /enterpriseThreshold/);
  assert.match(estimateRoute, /tierCount/);
  assert.match(estimateRoute, /estimatedAmountCents/);

  const serviceEstimate = sliceFrom(stripeServiceCode, 'export function estimateStripeActivePatientPlan', 3800);
  assert.match(serviceEstimate, /matchedTier/);
  assert.match(serviceEstimate, /estimatedAmountCents/);
  assert.match(serviceEstimate, /isEnterprise/);
});

test('webhook e idempotente, valida price conhecido e salva subscription item', () => {
  assert.match(serverCode, /async function reserveStripeWebhookEvent/);
  assert.match(serverCode, /\.from\('stripe_webhook_events'\)[\s\S]*?\.insert\(/);
  assert.match(serverCode, /duplicate/i);
  assert.match(serverCode, /checkoutSessionUsesActivePatientPrice/);
  assert.match(serverCode, /checkout\.session\.completed/);
  assert.match(serverCode, /customer\.subscription\.created/);
  assert.match(serverCode, /invoice\.finalized/);
  assert.match(serverCode, /invoice\.payment_succeeded/);
  assert.match(serverCode, /subscriptionItemId/);
  assert.match(serverCode, /priceId: activePatientPriceId/);
  assert.doesNotMatch(serverCode, /provisionProfessionalFromDirectStripeCheckout|resolveProfessionalPlanPriceId|resolveProfessionalPlanByPriceId/);
});

test('reconcile diario existe com autorizacao por segredo ou admin e sem select star', () => {
  const route = sliceFrom(serverCode, "app.post('/api/admin/billing/reconcile-active-patient-usage'", 3600);
  assert.match(route, /BILLING_CRON_SECRET/);
  assert.match(route, /crypto\.timingSafeEqual/);
  assert.match(route, /\['owner', 'admin'\]\.includes\(sessionRole\)/);
  assert.match(route, /reportAllClinicsActivePatientUsage/);
  assert.match(route, /billingModel: ACTIVE_PATIENT_BILLING_MODEL/);
  assert.doesNotMatch(route, /\.select\(\s*['"`]\*['"`]\s*\)/);
});

test('migration cria campos persistentes e auditoria de webhook/sync', () => {
  for (const field of [
    'stripe_price_id',
    'billing_model',
    'active_patient_count',
    'last_billing_sync_at',
    'billing_sync_status',
    'billing_sync_error',
    'stripe_webhook_events',
    'billing_sync_audit_logs',
    'stripe_subscription_item_id'
  ]) {
    assert.match(migrationCode, new RegExp(field));
  }
  assert.match(migrationCode, /alter table public\.stripe_webhook_events enable row level security/i);
  assert.match(migrationCode, /alter table public\.billing_sync_audit_logs enable row level security/i);
});

test('landing e tela de assinatura nao exibem planos fixos antigos', () => {
  const subscriptionRequired = sliceFrom(appCode, 'const SubscriptionRequired =', 34000);
  const uiCode = [
    landingCode,
    appCode,
    adminCode,
    superAdminCode,
    invitationCode,
    coordinatorCode,
    therapistCode,
    receptionistCode
  ].join('\n');

  doesNotContain(uiCode, [
    'Essencial',
    'Crescimento',
    'Avancado',
    'R$ 149',
    'R$ 399',
    'R$ 679',
    'Falar com Mateus',
    'Fale com Mateus',
    'business_plan_id',
    'enterprise_plan_id'
  ]);
  assert.match(landingCode, /billingModel:[\s\S]*?'active_patients'/);
  assert.match(appCode, /paciente ativo/i);
  assert.match(appCode, /\/api\/billing\/plans/);
  assert.match(appCode, /\/api\/billing\/estimate/);
  assert.match(appCode, /\/api\/billing\/checkout/);
  assert.match(appCode, /selectedPriceId/);
  assert.match(subscriptionRequired, /billingRangeCards/);
  assert.match(subscriptionRequired, /setSelectedBillingRangeKey/);
  assert.match(subscriptionRequired, /selectedBillingPriceId/);
  assert.match(subscriptionRequired, /key: `tier-\$\{from\}-\$\{to\}`/);
  assert.match(subscriptionRequired, /activePatients: to/);
  assert.match(subscriptionRequired, /selectedPriceId: selectedBillingPriceId/);
  assert.match(subscriptionRequired, /priceId: selectedBillingPriceId/);
  assert.match(subscriptionRequired, /label === 'Pacientes ativos'/);
  assert.match(subscriptionRequired, /Selecione uma faixa para ver a estimativa/);
  assert.match(subscriptionRequired, /Estimativa para até/);
  assert.match(subscriptionRequired, /Faixa selecionada/);
  assert.match(subscriptionRequired, /Solicitar proposta personalizada/);
  assert.match(subscriptionRequired, /Plano personalizado/);
  assert.doesNotMatch(subscriptionRequired, /Valor no checkout|Valor calculado com segurança no checkout|Estimativa indisponível|Erro ao iniciar pagamento/);
  assert.doesNotMatch(subscriptionRequired, /alert\('Erro ao iniciar pagamento/);
  assert.doesNotMatch(subscriptionRequired, /Quantos pacientes ativos sua clínica tem hoje\?|type="number"|Sua faixa|Faixa correspondente|productId/);
  assert.doesNotMatch(`${adminCode}\n${superAdminCode}`, /planName:\s*complimentaryPlan|complimentaryPlan/);
  assert.doesNotMatch(invitationCode, /planLimits|user\.planName|Seu plano/);
});

test('codigo principal nao usa select star nos caminhos de billing alterados', () => {
  for (const code of [serverCode, stripeServiceCode]) {
    assert.doesNotMatch(code, /\.select\(\s*['"`]\*['"`]\s*\)/);
  }
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

console.log(`billing tests passed: ${passed}/${tests.length}`);
