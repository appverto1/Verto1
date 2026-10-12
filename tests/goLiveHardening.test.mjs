import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const server = read('server.ts');
const school = read('services/schoolManagementRoutes.ts');
const policy = read('services/clinicAppointmentPolicyRoutes.ts');
const vite = read('vite.config.ts');
const envValidation = read('scripts/validate-required-env.mjs');
const authorization = read('src/constants/authorizationModel.ts');
const schoolWorkspace = read('src/components/SchoolMeetingWorkspace.tsx');
const roleMatrix = read('src/components/RoleCapabilityMatrix.tsx');
const financeMigration = read('supabase/migrations/20260812022000_private_finance_membership_authority_v2.sql');
const caseTeamMigration = read('supabase/migrations/20260812013000_patient_professional_link_manager_roles_v2.sql');

// Platform administration: active platform_admin + MFA, never clinic owner role.
const platformGuardStart = server.indexOf('async function checkPlatformAdmin');
const platformGuardEnd = server.indexOf('type ResolvedExternalBillingAccess', platformGuardStart);
const platformGuard = server.slice(platformGuardStart, platformGuardEnd);
assert.match(platformGuard, /isPlatformAdminUserId\(userId\)/);
assert.match(platformGuard, /hasVerifiedMfaSession\(req\.session\?\.user\)/);
assert.match(platformGuard, /PLATFORM_ADMIN_MFA_REQUIRED/);
assert.doesNotMatch(platformGuard, /role.*owner|owner.*role/i);

for (const route of [
  '/api/owner/sales/offers/:offerId/accept',
  '/api/owner/sales/offers/:offerId/modular-checkout',
  '/api/owner/sales/offers/:offerId/modular-checkout/expire',
  '/api/owner/sales/offers/:offerId/modular-checkout/email',
]) {
  const at = server.indexOf(route);
  assert.ok(at >= 0, `rota comercial ausente: ${route}`);
  assert.match(server.slice(at, at + 700), /checkPlatformAdmin/, `rota ${route} precisa do guard de plataforma`);
}

// Own TISS professional profile is self-scoped and module-gated; editing it must not depend on session capabilities.
for (const route of [
  "app.get('/api/tiss/professional-profile/me'",
  "app.patch('/api/tiss/professional-profile/me'",
]) {
  const routeAt = server.indexOf(route);
  assert.ok(routeAt >= 0, `rota ausente: ${route}`);
  const routeBoundary = server.slice(routeAt, routeAt + 520);
  assert.match(routeBoundary, /checkAuth/);
  assert.match(routeBoundary, /requireClinicModule\('insurance_tiss'\)/);
  assert.doesNotMatch(routeBoundary, /session\.billing_evidence\.generate|session\.start|requireAnyClinicCapability/);
  if (route.includes("app.get(")) {
    assert.match(routeBoundary, /createTissOwnProfessionalProfileReadHandler/);
    const movedProfileRead = read('services/tissPayerReadHandlers.ts');
    const start = movedProfileRead.indexOf('export function createTissOwnProfessionalProfileReadHandler');
    const end = movedProfileRead.indexOf('// GET ', start + 1);
    assert.ok(start >= 0, 'GET factory de perfil profissional precisa existir');
    const handlerSource = movedProfileRead.slice(start, end < 0 ? undefined : end);
    assert.match(handlerSource, /req\.session\.user\?\.id/, 'GET deve continuar limitado à identidade da sessão');
    assert.match(handlerSource, /currentClinicId\(req\.session\.user\)/, 'GET deve continuar limitado à clínica ativa');
  } else {
    assert.match(routeBoundary, /req\.session\.user\?\.id/, 'PATCH continua usando usuário da sessão');
  }
}


// Schools: capabilities and patient/case scope; no direct role gate.
assert.doesNotMatch(school, /requireRoles\(/);
assert.match(school, /requireClinicCapability\('school\.view'\)/);
assert.match(school, /requireClinicCapability\('school\.manage'\)/);
assert.match(school, /requireClinicCapability\('school\.meetings\.manage'\)/);
assert.match(school, /resolvePatientListScopedPatientIds/);
assert.match(school, /schoolMeetingVisibilityIds/);
assert.match(school, /const allowedByScope = Array\.isArray\(scope\.scopedPatientIds\)/);
assert.match(schoolWorkspace, /canManageMeeting = hasCapability\('school\.meetings\.manage'\)/);
assert.match(schoolWorkspace, /canWriteClinicalContent = hasCapability\('clinical\.notes\.create'\)/);

// No-show / appointment policy is capability-based.
assert.doesNotMatch(policy, /requireRoles\(/);
assert.match(policy, /requireClinicCapability\('clinic\.settings\.edit'\)/);
assert.match(policy, /requireAnyClinicCapability/);

// External biller runtime must fail closed when the company-clinic link is revoked.
assert.match(server, /async function resolveExternalBillingAccessForUser/);
assert.match(server, /from\('external_organization_clinic_links'\)/);
assert.match(server, /externalBillingAccess\.isExternalBillingUser && !externalBillingAccess\.allowedClinicIds\.has\(clinicId\)/);

// Case-team management uses active memberships in the DB, not legacy users.role.
assert.match(caseTeamMigration, /actor_membership\.role in \('director', 'coordinator'\)/);
assert.match(caseTeamMigration, /actor_membership\.status = 'active'/);
assert.doesNotMatch(caseTeamMigration, /lower\([^\n]*users[^\n]*role|owner.*admin/i);

// Private finance is backend-only and membership-based; no owner/admin authority remains.
assert.match(financeMigration, /private_finance_actor_role_v2/);
assert.match(financeMigration, /from public\.clinic_memberships membership/);
assert.match(financeMigration, /coalesce\(membership\.status, ''\)\)\) = 'active'/);
assert.match(financeMigration, /\('director', 'coordinator', 'receptionist'\)/);
assert.doesNotMatch(financeMigration, /from public\.users user_row/);
assert.doesNotMatch(financeMigration, /\('owner', 'admin/);
assert.match(financeMigration, /revoke all on function public\.resolve_private_session_price_v1[\s\S]*from public, anon, authenticated/);
assert.match(financeMigration, /grant execute on function public\.resolve_private_session_price_v1[\s\S]*to service_role/);
assert.match(server, /professionalAuthorizationContext\?\.capabilities\.has\('finance\.entries\.manage'\)/);


// Private finance UI/actions must follow effective capabilities, not legacy role labels.
const privatePricing = read('src/components/PrivatePricingManagement.tsx');
const patientFinance = read('src/components/PatientFinanceWorkspace.tsx');
assert.match(privatePricing, /finance\.entries\.manage/);
assert.doesNotMatch(privatePricing, /\['owner', 'admin'\]/);
assert.match(patientFinance, /finance\.entries\.manage/);
assert.match(server, /validatePrivateLateCancellationRescheduleBatch[\s\S]*canManageFinance:\s*boolean/);
assert.match(server, /canManageFinance:\s*req\.authorizationContext\?\.capabilities\?\.has\('finance\.entries\.manage'\)/);

// Case-team management authority must come only from active director/coordinator membership.
const professionalLinks = read('src/utils/patientProfessionalLinks.ts');
assert.match(professionalLinks, /\['director', 'coordinator'\]\.includes\(membershipRole\)/);
assert.doesNotMatch(professionalLinks, /actorRole === 'owner'|actorRole === 'admin'/);

// Resolving legacy patient identifiers must never create patients implicitly.
const patientResolverStart = server.indexOf('async function resolvePatientIdForRequest');
const patientResolverEnd = server.indexOf('function normalizeAppointmentStatusForTable', patientResolverStart);
const patientResolver = server.slice(patientResolverStart, patientResolverEnd);
assert.doesNotMatch(patientResolver, /from\('patients'\)[\s\S]*\.insert\(/);
assert.doesNotMatch(patientResolver, /therapist_id:/);

// Therapist list scope must be canonical case-team only.
const patientScopeStart = server.indexOf('async function resolvePatientListScopedPatientIds');
const patientScopeEnd = server.indexOf('async function resolveLegacyClinicalEmailReadScope', patientScopeStart);
const patientScope = server.slice(patientScopeStart, patientScopeEnd);
assert.match(patientScope, /from\('patient_professional_links'\)/);
assert.doesNotMatch(patientScope, /therapist_id/);

// Patient list schema fallback must fail closed for case-scoped roles.
const routeFallbacks = read('src/utils/routeSchemaFallbacks.ts');
const patientFallbackStart = routeFallbacks.indexOf('export async function fetchPatientsWithSchemaFallback');
const patientFallback = routeFallbacks.slice(patientFallbackStart, routeFallbacks.indexOf('export ', patientFallbackStart + 10) > 0 ? routeFallbacks.indexOf('export ', patientFallbackStart + 10) : undefined);
assert.match(patientFallback, /role === 'supervisor' \|\| role === 'therapist'/);
assert.doesNotMatch(patientFallback, /therapist_id\.eq|query\.eq\('therapist_id'/);

// No frontend server secret injection and deploy target is explicit.
assert.doesNotMatch(vite, /GEMINI_API_KEY/);
assert.doesNotMatch(vite, /define\s*:\s*\{[\s\S]*process\.env\./);
assert.match(envValidation, /VERTO_APP_BASE_URL/);
assert.match(envValidation, /SUPABASE_EXPECTED_PROJECT_REF/);
assert.match(envValidation, /deve utilizar HTTPS em deploy/);
assert.match(envValidation, /nao corresponde ao SUPABASE_URL configurado/);

// Canonical role/access matrix exposed to users. Supervisor is contextual;
// the legacy role remains in authorization defaults only for backwards compatibility.
for (const role of ['director', 'coordinator', 'therapist', 'receptionist', 'biller']) {
  assert.match(authorization, new RegExp(`\\b${role}:`));
}
assert.match(authorization, /supervisor:/, 'papel supervisor legado deve continuar reconhecido durante a migração');
for (const label of ['Diretor', 'Coordenador', 'Profissional', 'Recepção', 'Faturista']) {
  assert.ok(roleMatrix.includes(label), `matriz deve exibir ${label}`);
}
assert.ok(!roleMatrix.includes("supervisor: 'Supervisor'"), 'matriz não deve expor Supervisor como papel base');


// Platform-admin session identity must survive MFA/session hydration and own the initial frontend route.
const app = read('src/App.tsx');
assert.match(server, /function buildSessionUserPayload[\s\S]*?isPlatformAdmin:\s*input\?\.isPlatformAdmin === true/);
assert.match(server, /app\.post\('\/api\/auth\/2fa\/login'[\s\S]*?isPlatformAdminUserId\(boundUserId\)[\s\S]*?isPlatformAdmin:\s*isPlatformAdminLogin/);
assert.match(server, /app\.get\('\/api\/auth\/me'[\s\S]*?isPlatformAdminUserId\(sessionUserId\)[\s\S]*?PRIVILEGED_MFA_REQUIRED/);
const platformPanelIndex = app.indexOf("user?.isPlatformAdmin === true ? (");
const clinicPickerIndex = app.indexOf('showWorkspacePicker && (accessContextOptions.length > 0 || pendingClinicInvitations.length > 0) ? (');
assert.ok(platformPanelIndex >= 0 && clinicPickerIndex > platformPanelIndex);
assert.match(app.slice(platformPanelIndex, platformPanelIndex + 220), /<SuperAdminDashboard/);
assert.doesNotMatch(app, /user\.role === 'owner' \? \([\s\S]{0,120}<SuperAdminDashboard/);

console.log('goLiveHardening.test.mjs: ok');
