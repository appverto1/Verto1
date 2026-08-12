import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const localDb = fs.readFileSync('src/services/localDb.ts', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `inicio ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const loginRoute = section(server, "app.post('/api/auth/login'", "app.post('/api/auth/logout'");
const completeOnboarding = section(server, "app.post('/api/profile/:userId/complete-onboarding'", "app.get('/api/profile/:userId'");
const loginHandler = section(app, 'const handleLoginSuccess = async', 'const [therapistNotes');
const clinicHydration = section(app, 'useEffect(() => {\n    if (!user) {\n      setClinicStateHydrated(false);', 'const resolvePatientIdentityForPortal');

// Novo convite explícito deve criar a membership antes do onboarding, mesmo
// quando o perfil foi reconciliado por e-mail durante o login.
assert.match(loginRoute, /const deferInvitationAcceptance = Boolean\(req\.body\?\.deferInvitationAcceptance\)/);
assert.match(loginRoute, /const invitationForWorkspace =[\s\S]*?activationFlow[\s\S]*?!deferInvitationAcceptance[\s\S]*?requestedInvitationId[\s\S]*?requestedClinicInvitation/);
assert.doesNotMatch(loginRoute, /!profileExistedBeforeInvitationProvisioning/);
assert.match(loginRoute, /acceptClinicInvitationAtomically\(\{/);

// O aceite de conta existente continua explícito e o frontend informa isso ao servidor.
assert.match(loginHandler, /deferInvitationAcceptance: shouldDeferInvitationAcceptance/);

// Onboarding não pode prosseguir sem vínculo ativo real.
assert.match(completeOnboarding, /isClinicManagedMember && !context\.membership/);
assert.match(completeOnboarding, /ONBOARDING_MEMBERSHIP_REQUIRED/);
assert.match(onboarding, /!authoritativeContext\?\.membership/);
assert.match(onboarding, /Seu convite ainda não concluiu o vínculo com a clínica/);

// Estado da clínica/pacientes não deve hidratar durante onboarding pendente.
assert.match(clinicHydration, /user\.firstLoginCompleted === false/);
assert.match(clinicHydration, /user\?\.onboardingContext\?\.canAccessDashboard === false/);

// Sync offline também é isolado por usuário e não roda durante onboarding.
assert.match(localDb, /row\.user_id === currentUserId/);
assert.match(app, /user\.firstLoginCompleted !== false[\s\S]*?hasDashboardBillingAccess\(user\)[\s\S]*?syncOfflineData\(\)/);

// Conta Auth confirmada é conta existente mesmo se public.users ainda não existir.
assert.match(server, /const reusedExistingAuthAccess = Boolean\(authUserHadVerifiedEmail\)/);

console.log('invitedProfessionalActivationContinuity.test.mjs: ok');
