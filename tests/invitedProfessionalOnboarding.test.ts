import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const settingsMenu = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');

const section = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const contextResolver = section(server, 'async function resolveOnboardingContextForUser', 'async function persistSpecialtyFromOnboardingContext');
const specialtyPersistence = section(server, 'async function persistSpecialtyFromOnboardingContext', 'function mergeAuthoritativeClinicSettings');
const contextRoute = section(server, "app.get('/api/onboarding/context'", "app.get('/api/workspaces'");
const loginRoute = section(server, "app.post('/api/auth/login'", "app.post('/api/auth/logout'");
const completeRoute = section(server, "app.post('/api/profile/:userId/complete-onboarding'", "app.get('/api/profile/:userId', checkAuth");
const checkoutHandler = section(server, 'const handleCreateClinicCheckout', "app.post('/api/billing/checkout'");
const acceptInviteRoute = section(server, "app.post('/api/clinic/accept-invite'", "app.post('/api/clinic/assign-role'");
const clinicMemberAccessPending = section(app, 'const ClinicMemberAccessPending', 'const SubscriptionRequired');

// Tenant, papel e especialidade são resolvidos por membership/convite no backend.
assert.match(contextResolver, /from\('clinic_memberships'\)/);
assert.match(contextResolver, /\.eq\('user_id', userId\)/);
assert.match(contextResolver, /membership\?\.clinic_id \|\| preferredClinicId/);
assert.match(contextResolver, /sanitizeEmail\(item\?\.email\) === email/);
assert.match(contextResolver, /readClinicalSpecialtyFromSource\(invitation/);
assert.match(contextRoute, /resolveOnboardingContextForUser/);
assert.match(dataService, /async getOnboardingContext\(\)/);
assert.match(onboarding, /dataService\.getOnboardingContext\(\)/);
assert.match(onboarding, /Clinic identity is server-authoritative for invited members/);
assert.doesNotMatch(onboarding, /setSpecialty\(/);

// Novo vínculo não sobrescreve o perfil profissional global já preenchido.
assert.match(specialtyPersistence, /existingGlobalSpecialty/);
assert.match(specialtyPersistence, /if \(existingGlobalSpecialty\) \{[\s\S]*?return;/);
assert.match(specialtyPersistence, /specialtyAuthority: metadata\?\.specialtyAuthority \|\| 'first_clinic_invitation'/);
assert.doesNotMatch(acceptInviteRoute, /from\('professional_profiles'\)/);
assert.doesNotMatch(acceptInviteRoute, /user\.email\?\.split\('@'\)/);

// Primeiro convite mantém onboarding pessoal; convites seguintes retornam modo curto e sem pagamento.
assert.match(contextResolver, /const onboardingMode:[\s\S]*?\? 'invited_professional'/);
assert.match(contextResolver, /requiresPayment: onboardingMode === 'clinic_owner'/);
assert.match(loginRoute, /if \(!profile\)[\s\S]*?first_login_completed: false/);
assert.match(loginRoute, /firstLoginCompleted: \(profile\.first_login_completed/);
assert.match(app, /onboardingContext\?\.requiresPayment === false/);
assert.match(app, /ClinicMemberAccessPending/);
assert.doesNotMatch(clinicMemberAccessPending, /financeir|cobrança|pagamento|plano/i);
assert.match(settingsMenu, /const isClinicManagedMember/);
assert.match(settingsMenu, /const canSeeBilling = \(isCoordinator \|\| isOwner\) && !isClinicManagedMember/);
assert.match(app, /const isClinicManagedMember = \['invited_professional', 'clinic_member'\]/);
assert.match(app, /!isClinicManagedMember && professionalProfile\?\.clinic_name/);
assert.match(app, /!isClinicManagedMember && professionalProfile\?\.clinic_logo_url/);
assert.match(onboarding, /isManagedMember \? memberPayload : ownerPayload/);
assert.doesNotMatch(section(onboarding, 'const memberPayload', 'const ownerPayload'), /clinicName|clinicPhone|clinicLogoUrl|clinicOperationType/);
assert.match(onboarding, /Concluir configuração/);

// Checkout/Stripe continuam bloqueados para profissional convidado antes de qualquer chamada financeira.
assert.match(app, /CLINIC_MEMBER_CHECKOUT_FORBIDDEN/);
assert.match(checkoutHandler, /CLINIC_MEMBER_CHECKOUT_FORBIDDEN/);
assert.ok(
  checkoutHandler.indexOf('CLINIC_MEMBER_CHECKOUT_FORBIDDEN') < checkoutHandler.indexOf('getStripe()'),
  'bloqueio deve ocorrer antes de criar cliente ou sessão Stripe',
);
assert.match(checkoutHandler, /A assinatura é administrada pela clínica responsável/);

// O proprietário preserva o onboarding comercial original.
assert.match(onboarding, /Continuar para o plano/);
assert.match(onboarding, /isOwnerOnboarding/);
assert.match(contextResolver, /onboardingMode: 'clinic_owner'/);
assert.match(completeRoute, /!isClinicManagedMember && clinicId/);
assert.match(completeRoute, /subscription_status: nextSubscriptionStatus/);
assert.match(checkoutHandler, /stripe\.checkout\.sessions\.create/);

// Aceite alternativo usa a mesma operação atômica e reconstrói o workspace da clínica convidante.
assert.match(acceptInviteRoute, /acceptClinicInvitationAtomically/);
assert.match(acceptInviteRoute, /acceptedInvitation\.clinicId/);
assert.match(acceptInviteRoute, /acceptedInvitation\.role/);
assert.match(acceptInviteRoute, /idempotent: acceptedInvitation\.idempotent/);
assert.match(loginRoute, /resolveOnboardingContextForUser/);
assert.match(server, /hydrateSessionUserWithOnboardingContext/);

// Dados pessoais permanecem globais; agenda do membro convidado fica isolada por clínica.
assert.match(onboarding, /cpf/);
assert.match(onboarding, /miniCurriculum/);
assert.match(onboarding, /signatureDataUrl/);
assert.match(onboarding, /workSchedule: schedule/);
assert.match(completeRoute, /sanitizeProfessionalWorkingSchedule/);
assert.match(completeRoute, /const globalSpecialty = normalizeClinicalSpecialty/);
assert.match(completeRoute, /\.\.\.\(isClinicManagedMember \? \{\} : \{[\s\S]*?workSchedule,[\s\S]*?work_schedule: workSchedule/);
assert.match(completeRoute, /from\('clinic_memberships'\)[\s\S]*?work_schedule: role === 'therapist' \? workSchedule : null/);
assert.match(completeRoute, /const profileClinicName = isClinicManagedMember/);
assert.match(completeRoute, /clinic_name: profileClinicName/);
assert.match(completeRoute, /\.\.\.\(isClinicManagedMember \? \{\} : \{\s*clinicId,/);

console.log('invitedProfessionalOnboarding.test.ts: ok');
