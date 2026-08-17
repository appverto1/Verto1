import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `inicio ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const billingRoleGate = section(server, 'function roleRequiresClinicBillingAccess', 'async function resolveClinicManagedMemberDashboardAccess');
const memberAccessResolver = section(server, 'async function resolveClinicManagedMemberDashboardAccess', 'function hasActiveClinicBillingAccess');
const onboardingResolver = section(server, 'async function resolveOnboardingContextForUser', 'async function persistSpecialtyFromOnboardingContext');
const loginHandler = section(app, 'const handleLoginSuccess = async', 'const [therapistNotes');
const patientCreateRoute = section(server, "app.post('/api/patients/create-user'", "app.post('/api/storage/create-bucket'");

// O mesmo contrato de acesso vale para todos os papeis geridos pela clinica.
for (const role of ['director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller', 'admin']) {
  assert.match(billingRoleGate, new RegExp(`['\"]${role}['\"]`), `papel ausente do gate: ${role}`);
}
assert.doesNotMatch(billingRoleGate, /['\"]patient['\"]/i, 'paciente nao pode herdar o gate comercial de colaborador');

// Membership ativa e contexto da clinica sao a autoridade; o perfil individual do convidado nao vira um segundo checkout.
assert.match(onboardingResolver, /\.eq\('status', 'active'\)/);
assert.match(onboardingResolver, /Boolean\(membership\) && await resolveClinicManagedMemberDashboardAccess\(clinicId, clinicRow\)/);
assert.match(onboardingResolver, /requiresPayment: onboardingMode === 'clinic_owner'/);

// Bloqueios terminais ganham de marcadores antigos de sync/entitlement.
const hardBlockIndex = memberAccessResolver.indexOf('CLINIC_MEMBER_HARD_BLOCK_STATUSES.has(subscriptionStatus)');
const fastPathIndex = memberAccessResolver.indexOf('CLINIC_MEMBER_BILLING_READY_SYNC_STATUSES.has(billingSyncStatus)');
assert.ok(hardBlockIndex >= 0 && fastPathIndex >= 0 && hardBlockIndex < fastPathIndex,
  'bloqueio terminal deve ser avaliado antes do fast path de billing');
assert.match(server, /const CLINIC_MEMBER_HARD_BLOCK_STATUSES = new Set\([\s\S]*?'canceled'[\s\S]*?'cancelled'[\s\S]*?'incomplete_expired'/);

// A mesma janela de tolerancia do Stripe usada no runtime deve ser respeitada no onboarding.
assert.match(memberAccessResolver, /CLINIC_MEMBER_GRACE_STATUSES\.has\(subscriptionStatus\)/);
assert.match(memberAccessResolver, /stripe_access_block_at/);
assert.match(memberAccessResolver, /accessBlockAt > Date\.now\(\)/);
assert.match(server, /'stripe_access_block_at'/);

// Somente estados comerciais ambiguos fazem a leitura adicional; estados saudaveis ficam no fast path.
const rpcIndex = memberAccessResolver.indexOf("supabase.rpc('get_organization_module_access_v1'");
assert.ok(rpcIndex > fastPathIndex, 'RPC de entitlement deve ficar fora do fast path');
assert.match(memberAccessResolver, /ownerAccessColumns = \['subscription_status', 'billing_model', 'stripe_access_block_at'\]/);
assert.match(memberAccessResolver, /select\(ownerAccessColumns\.join\(','\)\)/);
assert.match(memberAccessResolver, /clinicRow\?\.owner_user_id \|\| clinicRow\?\.created_by/);
assert.doesNotMatch(memberAccessResolver, /if \(mode === 'legacy_full'\) return true/);
assert.match(memberAccessResolver, /mode === 'contract'[\s\S]*?isOrganizationModuleKey/);
assert.match(memberAccessResolver, /if \(error\) return false/);

// Depois de uma ativacao concluida, artefatos de recovery/convite nao podem permanecer na URL.
assert.match(loginHandler, /const clearActivationInvitationContext/);
assert.match(loginHandler, /\['activate', 'recovery', 'accept_invitation'\]\.includes\(authAction\)/);
assert.match(loginHandler, /window\.history\.replaceState\(\{\}, document\.title, '\/'\)/);

// Paciente novo ja entra por ativacao, sem uma segunda confirmacao de vinculo.
assert.match(patientCreateRoute, /existingAccount \? RELATIONSHIP_PENDING : RELATIONSHIP_CONFIRMED/);
assert.match(patientCreateRoute, /ensurePatientLink\(authUser\.user\.id, \{ existingAccount: false \}\)/);
assert.match(patientCreateRoute, /relationshipConfirmationSent: false/);

// Para uma identidade preexistente, a confirmacao de relacionamento continua proposital:
// impede que uma clinica vincule silenciosamente uma conta ja existente e exponha historico/portabilidade.
assert.match(patientCreateRoute, /ensurePatientLink\(existingUser\.id, \{ existingAccount: true \}\)/);
assert.match(patientCreateRoute, /sendRelationshipConfirmationForLinkedPatient/);
assert.match(patientCreateRoute, /status: 'RELATIONSHIP_CONFIRMATION_SENT'/);

console.log('clinicMemberInviteDirectAccess.regression.test.mjs: ok');
