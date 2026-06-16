import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const packageJson = read('package.json');
const appCode = read('src/App.tsx');
const onboardingCode = read('src/components/ProfessionalOnboarding.tsx');
const serverCode = read('server.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 5000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('package expoe script test:onboarding', () => {
  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['test:onboarding'], 'tsx tests/onboarding.test.ts');
});

test('onboarding profissional nao ativa assinatura artificialmente', () => {
  const finish = sliceFrom(onboardingCode, 'const finish = async () =>', 3600);
  assert.doesNotMatch(finish, /subscriptionStatus:\s*['"]active['"]/);
  assert.match(finish, /subscriptionStatus:\s*result\?\.subscriptionStatus[\s\S]*?payment_required/);

  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId/complete-onboarding'", 8000);
  assert.doesNotMatch(route, /subscription_status:\s*['"]active['"]/);
  assert.match(route, /nextSubscriptionStatus[\s\S]*?payment_required/);
  assert.match(route, /res\.json\(\{[\s\S]*?subscriptionStatus:\s*nextSubscriptionStatus/);
});

test('dashboard profissional exige assinatura ativa ou trial autorizado', () => {
  assert.match(appCode, /CLINIC_ACCESS_ACTIVE_STATUSES/);
  assert.match(appCode, /CLINIC_ACCESS_BLOCKED_STATUSES/);
  assert.match(appCode, /hasDashboardBillingAccess/);
  assert.match(appCode, /isProfessionalClinicRole\(user\.role\) && !hasDashboardBillingAccess\(user\)/);
  assert.match(appCode, /<SubscriptionRequired user=\{user\} onLogout=\{handleLogout\} \/>/);
});

test('backend bloqueia rotas protegidas quando assinatura esta incompleta', () => {
  assert.match(serverCode, /CLINIC_ACCESS_BLOCKED_STATUSES/);
  assert.match(serverCode, /hasActiveClinicBillingAccess/);
  assert.match(serverCode, /isBillingOnboardingAllowedPath/);
  assert.match(serverCode, /SUBSCRIPTION_REQUIRED/);
  assert.match(serverCode, /res\.status\(402\)\.json\(billingAccessBlockedPayload\(req\.session\.user\)\)/);
});

test('rotas necessarias para completar onboarding e billing continuam permitidas', () => {
  const allow = sliceFrom(serverCode, 'function isBillingOnboardingAllowedPath', 1800);
  for (const path of [
    '/api/auth/me',
    '/api/profile/',
    '/api/stripe/',
    '/api/billing/',
    '/api/storage/'
  ]) {
    assert.match(allow, new RegExp(path.replaceAll('/', '\\/')));
  }
});

test('onboarding pergunta tipo de operacao e nao exige TISS/TUSS para particular', () => {
  assert.match(onboardingCode, /clinicOperationType/);
  assert.match(onboardingCode, /Como sua clínica atende hoje\?/);
  assert.match(onboardingCode, /Particular/);
  assert.match(onboardingCode, /Convênio/);
  assert.match(onboardingCode, /Clínicas particulares não precisam configurar TISS\/TUSS no primeiro acesso/);
  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId/complete-onboarding'", 8000);
  assert.match(route, /clinicOperationType/);
});

test('etapa de clinica usa dados minimos e nao mostra workspace generico ou credenciais', () => {
  const stepTwo = sliceFrom(onboardingCode, '{step === 2 &&', 7000);
  assert.match(stepTwo, /Configurações da clínica/);
  assert.match(stepTwo, /Nome da clínica/);
  assert.match(stepTwo, /Telefone ou WhatsApp da clínica/);
  assert.match(stepTwo, /Continuar para o plano/);
  assert.doesNotMatch(stepTwo, /Clínica do workspace/);
  assert.doesNotMatch(stepTwo, /Conselho \(ex: CRP\)/);
  assert.doesNotMatch(stepTwo, /Registro profissional/);
  assert.doesNotMatch(stepTwo, /Assinatura para relatórios|Assinatura para relatorios/);
  assert.doesNotMatch(stepTwo, /00\.000\.000\/0000-00/);
});

test('dados do usuario pedem apenas nome e telefone no bloqueio inicial', () => {
  const validation = sliceFrom(onboardingCode, 'const canGoNextPersonal', 900);
  assert.match(validation, /fullName\.trim\(\) && phone\.trim\(\)/);
  assert.doesNotMatch(validation, /birthDate|gender|cep|logradouro|bairro|cidade/);

  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId/complete-onboarding'", 3000);
  assert.doesNotMatch(route, /Terapeuta precisa informar conselho/);
});

test('tela de ativacao mostra plano modular e checkout seguro', () => {
  const subscriptionRequired = sliceFrom(appCode, 'const SubscriptionRequired =', 4200);
  assert.match(subscriptionRequired, /pacientes ativos/);
  assert.match(subscriptionRequired, /Cadastrar cartão e ativar assinatura/);
  assert.match(subscriptionRequired, /Até 10 pacientes ativos/);
  assert.match(subscriptionRequired, /Acima disso/);
  assert.match(subscriptionRequired, /Stripe/);
  assert.doesNotMatch(subscriptionRequired, /número completo do cartão[\s\S]*localStorage|card_number|cardNumber/);

  const checkout = sliceFrom(serverCode, "app.post('/api/stripe/create-checkout'", 2300);
  assert.match(checkout, /payment_method_types:\s*\['card'\]/);
  assert.match(checkout, /const activePatientPriceId = isPatientCheckout \? '' : resolveActivePatientPriceId\(\)/);
});

test('foto cadastrada na Verto tem prioridade sobre avatar OAuth', () => {
  const enrich = sliceFrom(appCode, 'const enrichUserFromSessionMetadata', 1800);
  assert.match(enrich, /internalProfilePicture/);
  assert.match(enrich, /oauthAvatarUrl/);
  assert.match(enrich, /profilePicture:\s*internalProfilePicture \|\| oauthAvatarUrl/);
  assert.match(enrich, /profile_picture:\s*internalProfilePicture \|\| oauthAvatarUrl/);
  assert.match(enrich, /googlePicture/);

  const completeOnboarding = sliceFrom(serverCode, "app.post('/api/profile/:userId/complete-onboarding'", 6000);
  assert.match(completeOnboarding, /profile_picture:\s*profilePicture/);
  assert.match(completeOnboarding, /profile_photo_url:\s*profilePicture/);
});

test('onboarding nao cria assinatura Stripe incompleta sem checkout', () => {
  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId/complete-onboarding'", 9000);
  assert.doesNotMatch(route, /createClinicMeteredSubscription/);
  assert.doesNotMatch(route, /persistStripeSubscriptionReference/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`onboarding tests passed: ${passed}/${tests.length}`);
