import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const invitationAcceptance = fs.readFileSync('src/components/ClinicInvitationAcceptance.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const settingsMenu = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const supabaseClient = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260731193000_atomic_clinic_invitation_acceptance.sql', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const invitationAppBaseUrl = section(server, 'function getInvitationAppBaseUrl', 'type ActivationRedirectOptions');
const activationUrl = section(server, 'type ActivationRedirectOptions', 'function getRecoveryRedirectUrl');
const invitationAcceptanceUrl = section(server, 'function getClinicInvitationAcceptanceUrl', 'function getRecoveryRedirectUrl');
const inviteRoute = section(server, "app.post('/api/clinic/invite'", "app.get('/api/clinic/invitations'");
const loginRoute = section(server, "app.post('/api/auth/login'", "app.post('/api/auth/logout'");
const acceptRoute = section(server, "app.post('/api/clinic/accept-invite'", "app.post('/api/clinic/assign-role'");
const unlinkRoute = section(server, "app.patch('/api/clinic/members/:memberId/unlink'", "app.get('/api/clinic/anamnesis-template'");
const accessContextRoute = section(server, "app.post('/api/access-contexts/select'", "app.post('/api/workspaces/select'");
const legacyWorkspaceRoute = section(server, "app.post('/api/workspaces/select'", 'const PORTAL_RESCHEDULE_WEEK_WINDOW_DAYS');
const billingOnboardingPaths = section(server, 'function isBillingOnboardingAllowedPath', 'function billingAccessBlockedPayload');
const invitationBillingBypass = section(server, 'function isClinicInvitationAcceptancePath', 'const DEMO_SANDBOX_BILLING_MODEL');

// Convites usam diretamente o host canonico; o redirecionamento do dominio raiz nao pode perder a query.
assert.match(invitationAppBaseUrl, /url\.hostname\.toLowerCase\(\) === 'appverto\.com\.br'/);
assert.match(invitationAppBaseUrl, /url\.hostname = 'www\.appverto\.com\.br'/);
assert.match(invitationAppBaseUrl, /url\.search = ''/);
assert.match(invitationAppBaseUrl, /url\.hash = ''/);
assert.match(activationUrl, /const baseUrl = getInvitationAppBaseUrl\(\)/);
assert.match(invitationAcceptanceUrl, /const baseUrl = getInvitationAppBaseUrl\(\)/);

// Primeiro convite abre a raiz real da SPA e carrega invitation_id, evitando landing page/404.
assert.match(activationUrl, /auth_action: 'activate'/);
assert.match(activationUrl, /params\.set\('invitation_id', invitationId\)/);
assert.match(activationUrl, /return `\$\{baseUrl\.replace[\s\S]*?\}\/\?\$\{params\.toString\(\)\}`/);
assert.doesNotMatch(activationUrl, /\/ativar\?role=/);
assert.match(app, /authAction === 'activate'/);
assert.match(app, /const hasSupabaseAuthReturnParams/);
assert.match(app, /searchParams\.get\('code'\)/);
assert.match(app, /hasSupabaseAuthReturnParams/);
assert.match(app, /session\?\.user\?\.user_metadata\?\.invitation_id/);
assert.match(app, /metadataInvitationId/);
assert.match(activation, /auth_action/);
assert.match(supabaseClient, /authAction === 'activate'/);

// Convites posteriores usam uma tela de aceite, sem e-mail ou clínica na URL.
assert.match(invitationAcceptanceUrl, /auth_action: 'accept_invitation'/);
assert.match(invitationAcceptanceUrl, /invitation_id: invitationId/);
assert.doesNotMatch(invitationAcceptanceUrl, /params\.set\('email'|role:/);
assert.match(app, /authAction === 'accept_invitation'/);
assert.match(app, /authAction === 'activate' && invitationMode === 'existing'/);
assert.match(app, /isInvitationAcceptanceRoute && user/);
assert.match(app, /ClinicInvitationAcceptance/);
assert.match(activation, /isInvitationAcceptanceAction/);
assert.match(activation, /auth_action: isRecoveryRoute[\s\S]*?'accept_invitation'/);
assert.match(activation, /deferInvitationAcceptance: isInvitationAcceptanceAction/);
assert.match(activation, /verto_pending_invitation_acceptance/);
assert.match(invitationAcceptance, /dataService\.acceptInvitation\(invitationId\)/);
assert.match(invitationAcceptance, /onboardingContext: result\.onboardingContext \|\| \{\}/);
assert.match(invitationAcceptance, /accepted\?\.onboardingContext\?\.clinic\?\.name/);
assert.match(invitationAcceptance, /Entrar na clínica/);
assert.match(invitationAcceptance, /Continuar depois/);
assert.match(invitationAcceptance, /\{!accepted \? \(/);
assert.doesNotMatch(invitationAcceptance, /accepted \? 'Ver depois'/);
assert.match(invitationAcceptance, /No clinic,[\s\S]*?role, name, or e-mail comes from the URL/);
assert.match(dataService, /async acceptInvitation\(invitationId: string\)/);

// Conta existente reutiliza Auth e não recebe nova senha/UUID.
assert.match(inviteRoute, /const reusedExistingAuthAccess = Boolean\(authUserHadVerifiedEmail\)/);
assert.match(activationUrl, /inviteMode: 'new'/);
assert.match(inviteRoute, /const activationLink = reusedExistingAuthAccess[\s\S]*?getClinicInvitationAcceptanceUrl\(data\?\.id\)[\s\S]*?: getClinicInvitationActivationUrl/);
assert.match(inviteRoute, /getClinicInvitationAcceptanceUrl\(data\?\.id\)/);
assert.match(inviteRoute, /invitationId: data\?\.id/);
assert.match(inviteRoute, /updateUserById\(/);
assert.match(inviteRoute, /pendingInvitationPredatesUnlink/);
assert.match(inviteRoute, /invitationCreatedAt <= membershipUnlinkedAt/);
assert.match(inviteRoute, /status: 'canceled'/);
assert.match(activation, /isExistingAccountInvite/);
assert.match(activation, /Entrar e aceitar convite/);
assert.match(activation, /passwordSetupCompleted: false/);
assert.match(activation, /signInWithOAuth/);
assert.match(activation, /redirectParams\.set\('invitation_id', invitationId\)/);
assert.match(activation, /window\.history\.replaceState[\s\S]*?continuationParams\.toString\(\)/);
assert.match(activation, /userMetadata\?\.invitation_id/);
assert.match(activation, /resolvedInvitationId/);
assert.match(activation, /actionParam === 'accept_invitation'[\s\S]*?setIntendedRole\('coordinator'\)/);
assert.match(activation, /Boolean\(invitationParam\)/);
assert.match(activation, /if \(code \|\| tokenHash \|\| accessToken \|\| refreshToken\)/);
assert.doesNotMatch(
  section(activation, 'const establishSessionFromUrl', 'const requestActivationBootstrap'),
  /if \(hasActivationParams\)[\s\S]*?signOut/,
  'um convite simples não pode deslogar uma conta já autenticada',
);

// URL e OAuth preservam o convite; localStorage é apenas fallback, não a única fonte.
assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\('invitation_id'\)/);
assert.match(app, /const isInvitationContinuation = currentAuthAction === 'activate'/);
assert.match(app, /currentAuthAction === 'accept_invitation'/);
assert.match(app, /invitationId: currentInvitationId/);
assert.match(app, /activationFlow: isInvitationContinuation/);
assert.match(app, /deferInvitationAcceptance: isInvitationAcceptanceContinuation/);
assert.match(app, /hasStoredInvitationAcceptance/);
assert.match(app, /storedInvitationAcceptance/);
assert.match(app, /publishActivationErrorMessage/);
assert.match(activation, /verto:activation-error/);
assert.match(activation, /verto_activation_error/);

// Aceite usa uma única RPC server-side e não aceita clinic_id/role do navegador.
assert.match(loginRoute, /acceptClinicInvitationAtomically\(\{/);
assert.match(acceptRoute, /acceptClinicInvitationAtomically\(\{/);
const loginHandler = section(app, 'const handleLoginSuccess = async', 'const [therapistNotes');
assert.match(loginHandler, /const shouldDeferInvitationAcceptance = Boolean/);
assert.match(loginHandler, /invitationId: authContext\?\.invitationId \|\| null/);
assert.match(loginHandler, /deferInvitationAcceptance: shouldDeferInvitationAcceptance/);
assert.match(loginHandler, /result\?\.message \|\| result\?\.error \|\| 'Erro no login'/);
assert.doesNotMatch(loginHandler, /invitationId: shouldDeferInvitationAcceptance \? null/);
assert.match(loginHandler, /if \(!shouldDeferInvitationAcceptance\) clearActivationInvitationContext\(\)/);
assert.match(activation, /activationFlow: Boolean\(invitationId\)/);
assert.match(activation, /invitationId: invitationId \|\| null/);
assert.doesNotMatch(loginRoute, /!profileExistedBeforeInvitationProvisioning/);
assert.match(loginRoute, /activationFlow[\s\S]*?!deferInvitationAcceptance[\s\S]*?requestedInvitationId[\s\S]*?requestedClinicInvitation/);
assert.doesNotMatch(loginRoute, /\.eq\('email', safeAuthEmail\)[\s\S]*?\.eq\('status', 'pending'\)[\s\S]*?invitationForWorkspace = pendingInvite/);
assert.match(billingOnboardingPaths, /path === '\/api\/clinic\/accept-invite'/);
assert.match(invitationBillingBypass, /=== '\/api\/clinic\/accept-invite'/);
assert.match(server, /!isClinicInvitationAcceptancePath\(req\.path \|\| req\.originalUrl\) && await isBillingAccessBlocked/);
assert.match(server, /supabase\.rpc\('accept_clinic_invitation_v1'/);
assert.doesNotMatch(acceptRoute, /req\.body\?\.clinicId|req\.body\?\.clinic_id|req\.body\?\.role/);
assert.match(loginRoute, /\.eq\('id', requestedInvitationId\)/);
assert.match(loginRoute, /\.in\('status', \['pending', 'accepted'\]\)/);
assert.match(loginRoute, /sanitizeEmail\(invitation\.email\) !== safeAuthEmail/);
assert.match(loginRoute, /CLINIC_INVITATION_EMAIL_MISMATCH/);
assert.match(loginRoute, /workspaces\.find\(\(w: any\) => w\.clinicId === invitedWorkspaceId\)/);

// Uma identidade Auth com acessos profissionais e de paciente escolhe o contexto,
// sem transformar localStorage, role ou clinic_id enviados pelo navegador em autoridade.
assert.match(app, /type AccessContextKind = 'clinic_workspace' \| 'patient_portal'/);
assert.match(app, /candidateUser\?\.mustSelectAccessContext/);
assert.match(app, /dataService\.selectAccessContext\(/);
assert.match(app, /getLastActiveAccessContextId\(candidateUser\?\.id\)/);
assert.match(app, /Preferência local nunca ativa um tenant por conta própria/);
assert.match(app, /Trabalhar/);
assert.match(app, /Cuidar de mim/);
assert.match(dataService, /fetch\('\/api\/access-contexts\/select'/);
assert.match(dataService, /body: JSON\.stringify\(\{ accessContextId: safeAccessContextId \}\)/);
assert.match(dataService, /\[404, 405\]\.includes\(response\.status\) && safeFallbackClinicId/);
assert.match(settingsMenu, /Trocar clínica ou acesso/);
assert.match(settingsMenu, /verto:open-access-contexts/);
assert.match(settingsMenu, /\(isCoordinator \|\| isOwner\) && !isClinicManagedMember/);
assert.match(server, /responsible_user_id\.eq\.\$\{safeUserId\},id\.eq\.\$\{safeUserId\}/);
assert.doesNotMatch(
  section(server, 'async function fetchPatientPortalAccessContexts', 'async function fetchUserAccessContexts'),
  /\.ilike\('email'|\.eq\('email'/,
  'contexto de paciente deve vir do vínculo canônico, não de coincidência de e-mail',
);
assert.match(accessContextRoute, /accessContexts\.find\(\(context\) => context\.id === accessContextId\)/);
assert.match(accessContextRoute, /ACCESS_CONTEXT_NOT_AUTHORIZED/);
assert.doesNotMatch(accessContextRoute, /req\.body\?\.(?:clinicId|role)/);
assert.doesNotMatch(accessContextRoute, /\.from\('users'\)[\s\S]*?\.update\(/);
assert.doesNotMatch(legacyWorkspaceRoute, /\.from\('users'\)[\s\S]*?\.update\(/);
assert.match(server, /ACCESS_CONTEXT_SELECTION_REQUIRED/);
assert.match(server, /mustSelectAccessContext === true/);

// Transação bloqueia corrida, duplicidade, convite antigo e e-mail divergente.
assert.match(migration, /for update/i);
assert.match(migration, /CLINIC_INVITATION_EMAIL_MISMATCH/);
assert.match(migration, /CLINIC_INVITATION_ALREADY_USED/);
assert.match(migration, /v_status <> 'pending'/);
assert.match(migration, /v_invitation\.created_at[\s\S]*?v_existing_membership\.updated_at/);
assert.match(migration, /on conflict \(user_id, clinic_id\)/i);
assert.match(migration, /do update set[\s\S]*?status = 'active'/i);
assert.match(migration, /update public\.invitations[\s\S]*?status = 'accepted'/i);
assert.match(migration, /revoke all[\s\S]*?from authenticated/i);
assert.match(migration, /grant execute[\s\S]*?to service_role/i);

// Desvincular preserva a identidade e só inativa a membership.
assert.match(unlinkRoute, /status: 'inactive'/);
assert.match(unlinkRoute, /\.from\('clinic_memberships'\)[\s\S]*?\.update\(\{/);
assert.doesNotMatch(
  unlinkRoute,
  /\.from\('users'\)[\s\S]*?\.(?:update|delete)\(/,
  'desvincular uma clínica não pode reescrever a identidade global da conta',
);
assert.doesNotMatch(unlinkRoute, /auth\.admin\.deleteUser|deleteUser\(/);

// P0: admitir conta profissional preexistente em B não remove vínculos de A.
assert.match(migration, /insert into public\.clinic_memberships[\s\S]*?on conflict \(user_id, clinic_id\)/i);
assert.doesNotMatch(
  migration,
  /delete from public\.clinic_memberships[\s\S]*?v_actor_user_id/i,
  'aceite do convite não pode apagar memberships de outras clínicas',
);
assert.match(accessContextRoute, /ACCESS_CONTEXT_NOT_AUTHORIZED/);
assert.doesNotMatch(acceptRoute, /req\.body\?\.(?:clinicId|clinic_id|role|professionalId)/);

console.log('clinicReinviteAccess.test.ts: ok');
