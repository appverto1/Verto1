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
const snapshotMigrationCode = read('supabase/migrations/20260616120000_billing_plan_snapshots.sql');
const activePatientLimitsMigrationCode = read('supabase/migrations/20260617100000_active_patient_billing_limits.sql');

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
  assert.match(envExample, /STRIPE_ACTIVE_PATIENT_LOOKUP_KEY=verto_active_patients_monthly/);
  assert.match(envExample, /STRIPE_BILLING_PLAN_PRICE_IDS=/);
  assert.match(envExample, /SALES_CONTACT_URL=/);
  assert.match(envExample, /STRIPE_ACTIVE_PATIENT_BILLING_MODE=quantity/);
  assert.match(envExample, /ACTIVE_PATIENT_ENTERPRISE_THRESHOLD=50/);
  assert.match(envExample, /BILLING_PLAN_SNAPSHOT_TTL_MINUTES=10/);
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

test('sync de rotina nao faz upgrade silencioso no Stripe e persiste referencias criticas', () => {
  assert.match(stripeServiceCode, /allowStripeQuantityUpdate\?: boolean/);
  assert.match(stripeServiceCode, /if \(!params\.allowStripeQuantityUpdate\)/);
  assert.match(stripeServiceCode, /upgrade_required_confirm_upgrade_first/);
  assert.match(stripeServiceCode, /within_current_limit_no_stripe_update/);
  const mutationBlock = sliceFrom(stripeServiceCode, 'if (item) {', 1600);
  assert.match(mutationBlock, /stripe\.subscriptionItems\.update[\s\S]*?quantity: billableQuantity[\s\S]*?proration_behavior: 'none'/);
  assert.match(mutationBlock, /stripe\.subscriptionItems\.create[\s\S]*?price: priceId[\s\S]*?quantity: billableQuantity[\s\S]*?proration_behavior: 'none'/);
  for (const field of [
    'stripe_customer_id',
    'stripe_subscription_id',
    'stripe_subscription_item_id',
    'stripe_price_id',
    'subscription_status',
    'billing_model',
    'active_patient_count',
    'current_active_patient_limit',
    'current_active_patient_count',
    'pending_billing_quantity',
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
  assert.match(route, /loadBillingPlansFromSnapshots\(\{ allowSync: true[^}]*\}\)/);
  assert.match(route, /activePatientSignupPlan\.priceId/);
  assert.match(route, /line_items: \[\{ price: activePatientSignupPlan\.priceId, quantity: 1 \}\]/);
  assert.match(route, /billingModel: ACTIVE_PATIENT_BILLING_MODEL/);
  assert.doesNotMatch(route, /planPrices|requestedPlan|price_data|planName/);
});

test('checkout autenticado preserva paciente separado e usa active patient price para clinica', () => {
  const handler = sliceFrom(serverCode, 'const handleCreateClinicCheckout', 12000);
  assert.match(handler, /const isPatientCheckout/);
  assert.match(handler, /const activePatientPriceId = isPatientCheckout \? '' : resolveActivePatientPriceId\(\)/);
  assert.match(handler, /loadBillingPlansFromSnapshots\(\{ allowSync: true[^}]*\}\)/);
  assert.match(handler, /selectedPriceId/);
  assert.match(handler, /requestedPlan/);
  assert.match(handler, /PRICE_NOT_AVAILABLE/);
  assert.match(handler, /PRICE_USAGE_TYPE_NOT_SUPPORTED_FOR_CHECKOUT/);
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

test('mudanca de faixa por pacientes ativos exige confirmacao explicita e sem prorata', () => {
  assert.match(serverCode, /BILLING_UPGRADE_REQUIRED/);
  assert.match(serverCode, /Seu plano atual cobre até \$\{currentLimit\} pacientes ativos/);
  assert.match(serverCode, /assertCanActivateBillablePatient/);
  assert.match(serverCode, /trigger: 'patient_create'/);
  assert.match(serverCode, /trigger: 'patient_patch'/);
  assert.match(serverCode, /trigger: 'anamnesis_review'/);
  assert.match(serverCode, /trigger: 'patient_reactivate'/);
  assert.match(serverCode, /app\.post\('\/api\/billing\/active-patient-limit\/confirm-upgrade'/);
  assert.match(serverCode, /app\.post\('\/api\/billing\/active-patient-limit\/cancel-pending'/);
  const confirmRoute = sliceFrom(serverCode, "app.post('/api/billing/active-patient-limit/confirm-upgrade'", 9000);
  assert.match(confirmRoute, /stripe\.subscriptionItems\.update/);
  assert.match(confirmRoute, /quantity: requestedLimit/);
  assert.match(confirmRoute, /proration_behavior: 'none'/);
  assert.match(confirmRoute, /pending_billing_status: 'confirmed_next_cycle'/);
  assert.match(confirmRoute, /persistBillingPlanChangeAudit/);
  assert.match(confirmRoute, /ENTERPRISE_REQUIRED/);
  assert.doesNotMatch(confirmRoute, /checkout\.sessions\.create/);

  const cancelRoute = sliceFrom(serverCode, "app.post('/api/billing/active-patient-limit/cancel-pending'", 5200);
  assert.match(cancelRoute, /ACTIVE_PATIENTS_OVER_CURRENT_LIMIT/);
  assert.match(cancelRoute, /quantity: previousLimit/);
  assert.match(cancelRoute, /proration_behavior: 'none'/);
});

test('frontend reconhece bloqueio de limite e confirma upgrade antes de retentar ativacao', () => {
  assert.match(appCode, /confirmActivePatientBillingUpgrade/);
  assert.match(appCode, /BILLING_UPGRADE_REQUIRED/);
  assert.match(appCode, /\/api\/billing\/active-patient-limit\/confirm-upgrade/);
  assert.match(appCode, /não gera cobrança proporcional imediata/);
  assert.match(appCode, /dataService\.updatePatient\(String\(updatedData\.id\), patientUpdatePayload\)/);
});

test('endpoint de planos le Stripe e retorna apenas dados seguros para onboarding', () => {
  const route = sliceFrom(serverCode, "app.get('/api/billing/plans'", 4600);
  assert.match(route, /checkAuth/);
  assert.match(route, /loadBillingPlansFromSnapshots\(\{ allowSync: true \}\)/);
  assert.match(route, /source/);
  assert.match(serverCode, /syncStripeBillingPlanSnapshots/);
  assert.match(serverCode, /app\.post\('\/api\/admin\/billing\/sync-stripe-plans'/);
  assert.match(route, /enterpriseThreshold/);
  assert.match(route, /salesContactUrl/);
  assert.match(route, /firstPlanTierCount/);
  assert.match(route, /tieredPricesFound/);
  assert.match(route, /MISSING_STRIPE_CONFIG/);
  assert.doesNotMatch(route, /STRIPE_SECRET_KEY|sk_|apiKey/);
});

test('parser Stripe expande tiers e transforma faixas up_to em from/to', () => {
  assert.match(stripeServiceCode, /ACTIVE_PATIENT_BILLING_LOOKUP_KEY/);
  assert.match(stripeServiceCode, /lookup_key/);
  assert.match(stripeServiceCode, /vertoPlanKey/);
  assert.match(stripeServiceCode, /enterpriseRequiredAfter/);
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
  assert.match(estimateRoute, /loadBillingPlansFromSnapshots\(\{ allowSync: true \}\)/);
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
  assert.match(serverCode, /loadBillingPlansFromSnapshots\(\{ allowSync: true \}\)/);
  assert.match(serverCode, /checkout\.session\.completed/);
  assert.match(serverCode, /customer\.subscription\.created/);
  assert.match(serverCode, /product\.updated/);
  assert.match(serverCode, /price\.updated/);
  assert.match(serverCode, /syncStripeBillingPlanSnapshots\(`webhook:\$\{event\.type\}`\)/);
  assert.match(serverCode, /invoice\.finalized/);
  assert.match(serverCode, /invoice\.payment_succeeded/);
  assert.match(serverCode, /subscriptionItemId/);
  assert.match(serverCode, /subscriptionItemPriceId/);
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
  for (const field of [
    'billing_plan_snapshots',
    'stripe_product_id',
    'stripe_price_id',
    'lookup_key',
    'plan_key',
    'tiers_json',
    'metadata_json',
    'last_synced_at',
    'enterprise_threshold'
  ]) {
    assert.match(snapshotMigrationCode, new RegExp(field));
  }
  assert.match(snapshotMigrationCode, /alter table public\.billing_plan_snapshots enable row level security/i);
  for (const field of [
    'current_active_patient_limit',
    'current_active_patient_count',
    'pending_billing_quantity',
    'pending_effective_date',
    'pending_billing_status',
    'billing_plan_change_audit_logs',
    'previous_limit',
    'requested_limit'
  ]) {
    assert.match(activePatientLimitsMigrationCode, new RegExp(field));
  }
  assert.match(activePatientLimitsMigrationCode, /alter table public\.billing_plan_change_audit_logs enable row level security/i);
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
  assert.match(subscriptionRequired, /tier\.displayLabel/);
  assert.match(appCode, /PRICE_USAGE_TYPE_NOT_SUPPORTED_FOR_CHECKOUT/);
  assert.match(subscriptionRequired, /label === 'Pacientes ativos'/);
  assert.match(subscriptionRequired, /Selecione uma faixa para ver a estimativa/);
  assert.match(subscriptionRequired, /Estimativa para até/);
  assert.match(subscriptionRequired, /Faixa selecionada/);
  assert.match(subscriptionRequired, /Solicitar proposta personalizada/);
  assert.match(subscriptionRequired, /Plano personalizado/);
  assert.doesNotMatch(subscriptionRequired, /Valor no checkout|Valor calculado com segurança no checkout|Estimativa indisponível|Erro ao iniciar pagamento/);
  assert.doesNotMatch(subscriptionRequired, /alert\('Erro ao iniciar pagamento/);
  assert.doesNotMatch(subscriptionRequired, /Quantos pacientes ativos sua clínica tem hoje\?|type="number"|Sua faixa|Faixa correspondente|productId|DEFAULT_SELF_SERVICE_PATIENT_RANGES|linear-\$\{plan\.priceId\}/);
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
