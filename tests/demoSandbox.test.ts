import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const packageJson = read('package.json');
const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const superAdminCode = read('src/components/SuperAdminDashboard.tsx');
const routeFallbacksCode = read('src/utils/routeSchemaFallbacks.ts');
const stripeServiceCode = read('services/stripeService.ts');
const migrationCode = read('supabase/migrations/20260610160000_demo_sandbox_infrastructure.sql');
const operationalMigrationCode = read('supabase/migrations/20260610170000_operational_demo_model.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 5000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return source.slice(start, end);
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

test('migration operacional classifica demos fixas sem apagar infraestrutura existente', () => {
  for (const field of [
    'demo_kind',
    'demo_key',
    'demo_last_activity_at',
    'demo_access_mode',
    'presentation',
    'playground',
    'prospect',
    'shared_guided'
  ]) {
    assert.match(operationalMigrationCode, new RegExp(field));
  }
  assert.match(operationalMigrationCode, /create unique index if not exists clinics_demo_key_unique_idx/i);
  assert.doesNotMatch(operationalMigrationCode, /\btruncate\b/i);
  assert.doesNotMatch(operationalMigrationCode, /\bdrop table\b/i);
  assert.doesNotMatch(operationalMigrationCode, /\bdelete from\b/i);
});

test('endpoints admin de demo existem e exigem auth/admin', () => {
  for (const marker of [
    "app.post('/api/admin/demo/bootstrap-operational'",
    "app.post('/api/admin/demo/shared-user/rotate-password'",
    "app.post('/api/admin/demo/playground/reset'",
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

test('bootstrap operacional e idempotente e preserva a demo de apresentacao', () => {
  const route = sliceFrom(serverCode, "app.post('/api/admin/demo/bootstrap-operational'", 12500);
  assert.match(route, /DEMO_PRESENTATION_CLINIC_ID/);
  assert.match(route, /DEMO_PLAYGROUND_CLINIC_ID/);
  assert.match(route, /DEMO_SHARED_USER_EMAIL/);
  assert.match(route, /demo_kind:\s*clinic\.kind/);
  assert.match(route, /demo_key:\s*clinic\.key/);
  assert.match(route, /demo_access_mode:\s*'shared_guided'/);
  assert.match(route, /seedFixedDemoIfEmpty/);
  assert.match(route, /membershipIsDemo/);
  assert.match(route, /status:\s*'inactive'/);
  assert.doesNotMatch(route, /resetDemoClinicData\(DEMO_PRESENTATION_CLINIC_ID\)/);
  assert.doesNotMatch(serverCode, /Coord@123456/);
});

test('conta demo recebe apenas workspaces demo e nao transforma admin real em demo', () => {
  const session = sliceFrom(serverCode, 'function buildSessionUserPayload', 4300);
  assert.match(session, /const explicitDemoUser = isExplicitDemoUser\(input\)/);
  assert.match(session, /compactedWorkspaces\.filter/);
  assert.match(session, /workspace\.isDemo \|\| workspace\.billingModel === DEMO_SANDBOX_BILLING_MODEL/);
  assert.match(session, /const resolvedIsDemoUser = explicitDemoUser/);
  assert.doesNotMatch(session, /selectedWorkspace\?\.isDemo\s*\|\|/);

  const selectRoute = sliceFrom(serverCode, "app.post('/api/workspaces/select'", 2300);
  assert.match(selectRoute, /filterWorkspacesForUser/);
  assert.match(selectRoute, /DEMO_REAL_CLINIC_ACCESS_DENIED/);
  assert.match(selectRoute, /req\.session\.user\.isDemoUser = isExplicitDemoUser/);
});

test('politica demo bloqueia admin billing logs export e exclusao permanente', () => {
  const policy = sliceFrom(serverCode, 'function isDemoRouteForbidden', 5200);
  for (const marker of [
    "'/api/admin'",
    "'/api/owner'",
    "'/api/billing'",
    "'/api/payments'",
    "'/api/financial'",
    "'/api/logs'",
    "'/api/clinic/invite'",
    "'/api/protocol-import-requests'",
    "path.includes('/export')",
    "method === 'DELETE'",
    'DEMO_PRESENTATION_READ_ONLY',
    'DEMO_REAL_CLINIC_ACCESS_DENIED',
    'blocked_demo_billing_attempt'
  ]) {
    assert.match(policy, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
  assert.match(route, /demo_access_mode:\s*'prospect'/);
  assert.match(route, /demo_kind:\s*'prospect'/);
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
  assert.doesNotMatch(route, /req\.body\?\.confirm === true/);
  assert.match(route, /fetchClinicDemoState\(clinicId\)/);
  assert.match(route, /if \(!state\.isDemo\)/);
  assert.match(route, /RESET PRESENTATION DEMO/);
  assert.match(route, /resetDemoClinicData\(clinicId\)/);
  assert.match(route, /seedDemoClinicData/);
  assert.doesNotMatch(route, /\btruncate\b/i);
});

test('reset dedicado afeta somente o Playground e recria baseline', () => {
  const route = sliceBetween(
    serverCode,
    "app.post('/api/admin/demo/playground/reset'",
    "app.post('/api/admin/demo/create-presentation'"
  );
  assert.match(route, /confirmationText !== 'RESET DEMO'/);
  assert.match(route, /fetchClinicDemoState\(DEMO_PLAYGROUND_CLINIC_ID\)/);
  assert.match(route, /state\.demoKind !== 'playground'/);
  assert.match(route, /resetDemoClinicData\(DEMO_PLAYGROUND_CLINIC_ID\)/);
  assert.match(route, /source:\s*'playground'/);
  assert.doesNotMatch(route, /DEMO_PRESENTATION_CLINIC_ID/);
});

test('reset apaga apenas por escopo de demo clinic/patient e nao por nome', () => {
  const reset = sliceFrom(serverCode, 'async function resetDemoClinicData', 3600);
  assert.match(reset, /fetchDemoPatientIds\(safeClinicId\)/);
  assert.match(reset, /deleteDemoRowsByColumn\(tableName, 'patient_id', patientIds\)/);
  assert.match(reset, /deleteDemoRowsByColumn\(tableName, 'clinic_id', safeClinicId\)/);
  assert.doesNotMatch(reset, /\.ilike\(|\.like\(|\.eq\('name'/);
  assert.doesNotMatch(reset, /\btruncate\b/i);
  assert.match(reset, /removeDemoPatientStorage\(safeClinicId, patientIds\)/);
  assert.match(serverCode, /`demo\/\$\{clinicId\}\/\$\{patientId\}`/);
});

test('sessao e workspaces carregam metadados demo para sobreviver a refresh', () => {
  assert.match(serverCode, /function buildSessionUserPayload/);
  assert.match(serverCode, /billingModel:\s*resolvedBillingModel/);
  assert.match(serverCode, /isDemoUser:\s*resolvedIsDemoUser/);
  assert.match(serverCode, /demoExpiresAt/);
  assert.match(serverCode, /fetchUserWorkspaces/);
  assert.match(serverCode, /is_demo,demo_status,demo_expires_at,demo_source,demo_kind,demo_key,demo_last_activity_at,billing_model/);
  assert.match(routeFallbacksCode, /'is_demo_user'/);
  assert.match(routeFallbacksCode, /'demo_access_mode'/);
  assert.match(routeFallbacksCode, /'demo_expires_at'/);
  assert.match(routeFallbacksCode, /'is_demo'/);
});

test('pacientes e storage da conta demo ficam isolados de dados reais', () => {
  const patientAccess = sliceFrom(serverCode, 'async function canAccessPatientInCurrentClinic', 2700);
  assert.match(patientAccess, /isExplicitDemoUser\(user\)/);
  assert.match(patientAccess, /data\?\.is_demo !== true/);
  assert.match(patientAccess, /data\?\.clinic_id/);
  const listPatients = sliceFrom(serverCode, "app.get('/api/patients'", 1500);
  assert.match(listPatients, /isExplicitDemoUser\(req\.session\.user\)/);
  assert.match(listPatients, /patient\?\.is_demo === true/);

  const createPatient = sliceFrom(serverCode, "app.post('/api/patients'", 5800);
  assert.match(createPatient, /fetchClinicDemoState\(safeClinicId\)/);
  assert.match(createPatient, /is_demo:\s*demoClinicState\.isDemo \? true/);
  assert.match(createPatient, /endsWith\('\.invalid'\)/);
  assert.match(createPatient, /CPF e telefone reais não devem ser informados/);
  const updatePatient = sliceBetween(
    serverCode,
    "app.patch('/api/patients/:id'",
    "app.get('/api/patients/:patientId/financial-plans'"
  );
  assert.match(updatePatient, /fetchClinicDemoState\(scopedClinicId\)/);
  assert.match(updatePatient, /demoEmails\.some/);
  assert.match(updatePatient, /submittedDemoPii/);
  assert.match(updatePatient, /explicitDemoUser && req\.body\?\.clinic_id !== undefined/);
  assert.match(updatePatient, /A conta demo não pode transferir pacientes entre clínicas/);
  assert.match(updatePatient, /patientUpdateQuery = patientUpdateQuery\.eq\('is_demo', true\)/);

  const upload = sliceFrom(serverCode, "app.post('/api/storage/upload'", 6500);
  assert.match(upload, /`demo\/\$\{activeClinicId\}\/\$\{accessObjectPath\}`/);
  assert.match(upload, /Path demo fora do escopo da clínica/);
  const view = sliceFrom(serverCode, "app.get('/api/storage/patient-photos/view'", 3600);
  assert.match(view, /A conta demo só pode acessar arquivos do ambiente demo/);
});

test('demo expirado e bloqueado no checkAuth antes do billing real', () => {
  const checkAuth = sliceFrom(serverCode, 'const checkAuth = async', 3600);
  assert.match(checkAuth, /resolveDemoAccessBlock\(req\.session\.user,\s*demoState\)/);
  assert.match(checkAuth, /resolveDemoRoutePolicyBlock\(req,\s*res,\s*req\.session\.user,\s*demoState\)/);
  assert.match(serverCode, /DEMO_SANDBOX_EXPIRED/);
  assert.ok(
    checkAuth.indexOf('resolveDemoAccessBlock(req.session.user, demoState)') < checkAuth.indexOf('isBillingAccessBlocked(req.session.user)'),
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
  assert.match(appCode, /Use apenas dados ficticios\. Este ambiente pode ser resetado\./);
  assert.match(appCode, /Demo de apresentacao\./);
  assert.match(appCode, /pointer-events-none/);
});

test('painel admin prioriza demo principal e playground e billing some da conta demo', () => {
  assert.match(superAdminCode, /Ambientes Demo/);
  assert.match(superAdminCode, /\/api\/admin\/demo\/bootstrap-operational/);
  assert.match(superAdminCode, /\/api\/admin\/demo\/playground\/reset/);
  assert.match(superAdminCode, /\/api\/admin\/demo\/shared-user\/rotate-password/);
  assert.match(superAdminCode, /Sandbox individual por prospect continua disponível|Sandboxes opcionais por prospect/);
  assert.match(coordinatorCode, /const isDemoAccount = Boolean\(user\?\.isDemoUser\)/);
  assert.match(coordinatorCode, /const canManageBilling = !isDemoAccount/);
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
