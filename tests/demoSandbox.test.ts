import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const packageJson = read('package.json');
const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const routeFallbacksCode = read('src/utils/routeSchemaFallbacks.ts');
const stripeServiceCode = read('services/stripeService.ts');
const migrationCode = read('supabase/migrations/20260610160000_demo_sandbox_infrastructure.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 5000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('package expoe script test:demo-sandbox', () => {
  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['test:demo-sandbox'], 'tsx tests/demoSandbox.test.ts');
});

test('migration demo e aditiva, persistente e com RLS nos artefatos novos', () => {
  for (const field of [
    'is_demo',
    'is_demo_user',
    'demo_role',
    'demo_expires_at',
    'demo_reset_at',
    'demo_owner_user_id',
    'billing_model',
    'demo_sandbox_audit_logs',
    'demo_sandbox_templates',
    'payload jsonb'
  ]) {
    assert.match(migrationCode, new RegExp(field));
  }
  assert.match(migrationCode, /alter table public\.demo_sandbox_audit_logs enable row level security/i);
  assert.match(migrationCode, /alter table public\.demo_sandbox_templates enable row level security/i);
  assert.doesNotMatch(migrationCode, /\btruncate\b/i);
  assert.doesNotMatch(migrationCode, /\bdrop table\b/i);
});

test('endpoints admin de demo existem e exigem auth/admin', () => {
  for (const marker of [
    "app.post('/api/admin/demo/create-presentation'",
    "app.post('/api/admin/demo/create-prospect-sandbox'",
    "app.post('/api/admin/demo/:clinicId/reset'",
    "app.post('/api/admin/demo/:clinicId/expire'",
    "app.post('/api/admin/demo/:clinicId/reactivate'",
    "app.get('/api/admin/demo/sandboxes'"
  ]) {
    const route = sliceFrom(serverCode, marker, 900);
    assert.match(route, /checkAuth/);
    assert.match(route, /checkPlatformAdmin/);
  }
});

test('sandbox prospect cria billing demo, membership e seed sem e-mail real de paciente', () => {
  const route = sliceFrom(serverCode, "app.post('/api/admin/demo/create-prospect-sandbox'", 9000);
  assert.match(route, /billing_model:\s*DEMO_SANDBOX_BILLING_MODEL/);
  assert.match(route, /subscription_status:\s*DEMO_SANDBOX_BILLING_MODEL/);
  assert.match(route, /is_demo:\s*true/);
  assert.match(route, /const persistedDemoState = await fetchClinicDemoState\(clinicId\)/);
  assert.match(route, /Não foi possível confirmar a persistência do sandbox demo/);
  assert.match(route, /is_demo_user:\s*true/);
  assert.match(route, /demo_role:\s*'prospect_demo'/);
  assert.match(route, /\.from\('clinic_memberships'\)|tableName:\s*'clinic_memberships'/);
  assert.match(route, /sendTransactionalEmailSafe/);
  assert.match(route, /ownerEmail/);
  assert.doesNotMatch(route, /patient.*sendTransactionalEmailSafe|sendTransactionalEmailSafe[\s\S]*pedro\.demo@example\.invalid/i);

  const seed = sliceFrom(serverCode, 'function buildDemoPatientRows', 1600);
  assert.match(seed, /pedro\.demo@example\.invalid/);
  assert.match(seed, /ana\.demo@example\.invalid/);
  assert.match(seed, /lucas\.demo@example\.invalid/);
  assert.match(seed, /uuidFromStableString/);
  assert.doesNotMatch(seed, /\bcpf:\s*['"`]\d/);
  assert.doesNotMatch(seed, /\bphone:\s*['"`]\d/);
});

test('reset demo valida clinica demo, exige confirmacao e nao usa truncate', () => {
  const route = sliceFrom(serverCode, "app.post('/api/admin/demo/:clinicId/reset'", 4200);
  assert.match(route, /confirmationText === 'RESET DEMO'/);
  assert.match(route, /fetchClinicDemoState\(clinicId\)/);
  assert.match(route, /if \(!state\.isDemo\)/);
  assert.match(route, /resetDemoClinicData\(clinicId\)/);
  assert.match(route, /seedDemoClinicData/);
  assert.doesNotMatch(route, /\btruncate\b/i);
});

test('reset apaga apenas por escopo de demo clinic/patient e nao por nome', () => {
  const reset = sliceFrom(serverCode, 'async function resetDemoClinicData', 3600);
  assert.match(reset, /fetchDemoPatientIds\(safeClinicId\)/);
  assert.match(reset, /deleteDemoRowsByColumn\(tableName, 'patient_id', patientIds\)/);
  assert.match(reset, /deleteDemoRowsByColumn\(tableName, 'clinic_id', safeClinicId\)/);
  assert.doesNotMatch(reset, /\.ilike\(|\.like\(|\.eq\('name'/);
  assert.doesNotMatch(reset, /\btruncate\b/i);
});

test('sessao e workspaces carregam metadados demo para sobreviver a refresh', () => {
  assert.match(serverCode, /function buildSessionUserPayload/);
  assert.match(serverCode, /billingModel:\s*resolvedBillingModel/);
  assert.match(serverCode, /isDemoUser:\s*resolvedIsDemoUser/);
  assert.match(serverCode, /demoExpiresAt/);
  assert.match(serverCode, /fetchUserWorkspaces/);
  assert.match(serverCode, /is_demo,demo_status,demo_expires_at,demo_source,billing_model/);
  assert.match(routeFallbacksCode, /'is_demo_user'/);
  assert.match(routeFallbacksCode, /'demo_expires_at'/);
  assert.match(routeFallbacksCode, /'is_demo'/);
});

test('demo expirado e bloqueado no checkAuth antes do billing real', () => {
  const checkAuth = sliceFrom(serverCode, 'const checkAuth = async', 3600);
  assert.match(checkAuth, /resolveDemoAccessBlock\(req\.session\.user\)/);
  assert.match(serverCode, /DEMO_SANDBOX_EXPIRED/);
  assert.ok(
    checkAuth.indexOf('resolveDemoAccessBlock(req.session.user)') < checkAuth.indexOf('isBillingAccessBlocked(req.session.user)'),
    'demo expirado deve ser avaliado antes de billing bloqueado'
  );
});

test('Stripe e convites reais sao bloqueados para ambiente demo antes de side-effect', () => {
  const checkout = sliceFrom(serverCode, "app.post('/api/stripe/create-checkout'", 3600);
  assert.match(checkout, /fetchClinicDemoState\(clinicId\)/);
  assert.match(checkout, /isDemoSessionUser\(user\)/);
  assert.match(checkout, /Ambiente demo não cobra Stripe real|Ambiente demo não abre cobrança real/);
  assert.ok(
    checkout.indexOf('fetchClinicDemoState(clinicId)') < checkout.indexOf('const stripe = getStripe()'),
    'checkout demo deve bloquear antes de getStripe'
  );

  const portal = sliceFrom(serverCode, "app.post('/api/stripe/customer-portal-session'", 3600);
  assert.match(portal, /fetchClinicDemoState\(clinicId\)/);
  assert.match(portal, /Ambiente demo não abre faturamento real/);
  assert.ok(
    portal.indexOf('fetchClinicDemoState(clinicId)') < portal.indexOf('const stripe = getStripe()'),
    'portal demo deve bloquear antes de getStripe'
  );

  const invite = sliceFrom(serverCode, "app.post('/api/clinic/invite'", 2600);
  assert.match(invite, /fetchClinicDemoState\(clinicId\)/);
  assert.match(invite, /Ambiente demo não permite convidar membros reais/);
});

test('servico de billing ignora clinicas demo em sync e report global', () => {
  assert.match(stripeServiceCode, /async function getClinicDemoBillingState/);
  assert.match(stripeServiceCode, /reason:\s*'demo_billing_disabled'/);
  assert.match(stripeServiceCode, /is_demo,billing_model,subscription_status/);
  assert.doesNotMatch(stripeServiceCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
});

test('UI exibe badge de ambiente demo sem fluxo novo', () => {
  assert.match(appCode, /isDemoEnvironment/);
  assert.match(appCode, /Ambiente demo/);
  assert.match(appCode, /Dados ficticios para demonstracao/);
  assert.match(appCode, /pointer-events-none/);
});

test('codigo demo nao usa select star nem cria dados por nome de habilidade/paciente', () => {
  const demoCode = [
    sliceFrom(serverCode, 'type DemoClinicState', 26000),
    sliceFrom(serverCode, "app.post('/api/admin/demo/create-presentation'", 24000)
  ].join('\n');
  assert.doesNotMatch(demoCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
  assert.doesNotMatch(demoCode, /\.eq\('name'/);
  assert.doesNotMatch(demoCode, /truncate/i);
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

console.log(`demoSandbox.test.ts: ${passed}/${tests.length} testes passaram`);
