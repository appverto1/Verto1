import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const modal = fs.readFileSync('src/components/InvitationModal.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

const section = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const contextResolver = section(
  server,
  'async function resolveOnboardingContextForUser',
  'async function persistSpecialtyFromOnboardingContext',
);
const contextRoute = section(
  server,
  "app.get('/api/onboarding/context'",
  "app.get('/api/workspaces'",
);
const loginRoute = section(
  server,
  "app.post('/api/auth/login'",
  "app.post('/api/auth/logout'",
);
const completeRoute = section(
  server,
  "app.post('/api/profile/:userId/complete-onboarding'",
  "app.get('/api/profile/:userId', checkAuth",
);
const checkoutHandler = section(
  server,
  'const handleCreateClinicCheckout',
  "app.post('/api/billing/checkout'",
);
const acceptInviteRoute = section(
  server,
  "app.post('/api/clinic/accept-invite'",
  "app.post('/api/clinic/assign-role'",
);
const inviteHandler = section(
  team,
  'const handleInvite = async',
  'const handleCancelInvitation = async',
);

// 1–3: confirmação genérica no botão e sem sucesso falso.
assert.match(team, /Convite enviado com sucesso\./);
assert.match(modal, /Convite enviado com sucesso\./);
assert.match(inviteHandler, /result\.success && result\.invitationEmailSent !== false/);
assert.doesNotMatch(inviteHandler, /setSuccess\(result\.message/);
assert.doesNotMatch(modal, /successMessage|setTimeout\(/);

// 4–6: tenant, clínica e especialidade vêm do backend.
assert.match(contextResolver, /from\('clinic_memberships'\)/);
assert.match(contextResolver, /\.eq\('user_id', userId\)/);
assert.match(contextResolver, /membership\?\.clinic_id \|\| preferredClinicId/);
assert.match(server, /async function fetchClinicOnboardingSnapshot[\s\S]*?from\('clinics'\)/);
assert.match(contextResolver, /sanitizeEmail\(item\?\.email\) === email/);
assert.match(contextResolver, /readClinicalSpecialtyFromSource\(invitation/);
assert.match(contextRoute, /resolveOnboardingContextForUser/);
assert.match(contextRoute, /ONBOARDING_CLINIC_NOT_FOUND/);
assert.match(dataService, /async getOnboardingContext\(\)/);
assert.match(onboarding, /dataService\.getOnboardingContext\(\)/);
assert.match(onboarding, /Clinic identity is server-authoritative for invited members/);
assert.doesNotMatch(onboarding, /setSpecialty\(/);

// 7–10: profissional convidado não vê ou dispara contratação.
assert.match(app, /onboardingContext\?\.requiresPayment === false/);
assert.match(app, /ClinicMemberAccessPending/);
assert.match(app, /CLINIC_MEMBER_CHECKOUT_FORBIDDEN/);
assert.match(checkoutHandler, /CLINIC_MEMBER_CHECKOUT_FORBIDDEN/);
assert.match(checkoutHandler, /A assinatura é administrada pela clínica responsável/);
assert.ok(
  checkoutHandler.indexOf('CLINIC_MEMBER_CHECKOUT_FORBIDDEN') < checkoutHandler.indexOf('getStripe()'),
  'bloqueio deve ocorrer antes de criar cliente ou sessão Stripe',
);
assert.match(onboarding, /isManagedMember \? memberPayload : ownerPayload/);
assert.doesNotMatch(
  section(onboarding, 'const memberPayload', 'const ownerPayload'),
  /clinicName|clinicPhone|clinicLogoUrl|clinicOperationType/,
);
assert.match(onboarding, /Concluir configuração/);
assert.doesNotMatch(onboarding, /Nenhuma cobrança será criada para seu usuário/);

// 11: onboarding comercial do proprietário permanece isolado, inclusive antes de a clínica existir.
assert.match(onboarding, /Continuar para o plano/);
assert.match(onboarding, /isOwnerOnboarding/);
assert.match(contextResolver, /ownerFallbackClinicId/);
assert.match(contextResolver, /canProvisionOwnerClinic/);
assert.match(contextResolver, /onboardingMode: 'clinic_owner'/);
assert.match(completeRoute, /!isClinicManagedMember && clinicId/);
assert.match(completeRoute, /subscription_status: nextSubscriptionStatus/);

// 12: recarregar sessão recalcula contexto no servidor.
assert.match(server, /hydrateSessionUserWithOnboardingContext/);
assert.match(section(server, "app.get('/api/auth/me'", "app.get('/api/onboarding/context'"), /hydrateSessionUserWithOnboardingContext/);
assert.match(loginRoute, /onboardingContext/);

// 13: aceite é idempotente por membership.
assert.match(acceptInviteRoute, /upsert\(\[\{/);
assert.match(acceptInviteRoute, /onConflict: 'user_id,clinic_id'/);
assert.match(acceptInviteRoute, /status: 'accepted'/);

assert.match(acceptInviteRoute, /const invitationId = sanitizeString\(req\.body\?\.invitationId, 120\)/);
assert.match(acceptInviteRoute, /sanitizeEmail\(invitation\.email\) !== sanitizeEmail\(user\.email\)/);

// 14–15: convite define tenant e papel; frontend não eleva acesso.
assert.match(acceptInviteRoute, /clinic_id: invitation\.clinic_id/);
assert.match(acceptInviteRoute, /role: invitation\.role/);
assert.match(completeRoute, /context\.membership\?\.role \|\| req\.session\.user\.role/);
assert.doesNotMatch(completeRoute, /req\.body\?\.clinicId|req\.body\?\.organizationId|req\.body\?\.role/);

// 16: clínica ausente interrompe sem criar substituta.
assert.match(contextRoute, /Não foi possível identificar a clínica vinculada ao seu convite/);
assert.doesNotMatch(contextRoute, /from\('clinics'\)[\s\S]*?insert|from\('clinics'\)[\s\S]*?upsert/);

// 17–18: first_login é concluído somente depois de perfil/clínica e retorna sessão pronta.
const initialUserPatch = section(completeRoute, 'const userPatch = cleanObject', 'let safeUserPatch');
assert.doesNotMatch(initialUserPatch, /first_login_completed/);
assert.match(completeRoute, /const authCompletionResult = await supabase\.auth\.admin\.updateUserById/);
assert.match(completeRoute, /const publicCompletionResult = await supabase[\s\S]*?first_login_completed: true/);
assert.ok(
  completeRoute.indexOf('const authCompletionResult') > completeRoute.indexOf("from('professional_profiles')"),
  'conclusão deve ocorrer depois da persistência do perfil profissional',
);
assert.match(completeRoute, /onboardingState: context\.requiresPayment \? 'PAYMENT_REQUIRED' : 'MEMBER_READY'/);
assert.match(completeRoute, /user: req\.session\.user/);

// 19: logout/login mantém contexto na sessão reconstruída.
assert.match(loginRoute, /resolveOnboardingContextForUser/);
assert.match(loginRoute, /const sessionUser = buildSessionUserPayload\(userData\)/);

// 20: Stripe global continua existindo, mas membro é bloqueado antes dele.
assert.match(checkoutHandler, /stripe\.checkout\.sessions\.create/);
assert.match(checkoutHandler, /selectedClinicPlan/);

// Dados profissionais, assinatura e agenda do próprio usuário.
assert.match(onboarding, /cpf/);
assert.match(onboarding, /miniCurriculum/);
assert.match(onboarding, /signatureDataUrl/);
assert.match(onboarding, /workSchedule: schedule/);
assert.match(completeRoute, /sanitizeProfessionalWorkingSchedule/);
assert.match(completeRoute, /clinicAuthority: isClinicManagedMember \? 'clinic_membership' : 'clinic_owner'/);

// Sem migration nova para essa correção.
assert.equal(
  fs.readdirSync('supabase/migrations').filter((name) => /invited.*onboarding|onboarding.*invite/i.test(name)).length,
  0,
);

console.log('invitedProfessionalOnboarding.test.ts: ok');
