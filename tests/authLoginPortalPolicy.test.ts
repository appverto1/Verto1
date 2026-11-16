import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  INVALID_PORTAL_CREDENTIALS_MESSAGE,
  matchesClinicalLoginPortal,
  persistedClinicalLoginPortal,
  requestedClinicalLoginPortal,
} from '../services/authLoginPortalPolicy';

assert.equal(INVALID_PORTAL_CREDENTIALS_MESSAGE, 'E-mail ou senha inválidos.');

for (const role of [
  'owner', 'admin', 'director', 'coordinator', 'supervisor',
  'therapist', 'receptionist', 'biller',
]) {
  assert.equal(persistedClinicalLoginPortal(role), 'professional', role);
  assert.equal(matchesClinicalLoginPortal('professional', role), true, role);
  assert.equal(matchesClinicalLoginPortal('patient', role), false, role);
  assert.equal(matchesClinicalLoginPortal('partner', role), false, role);
}

assert.equal(persistedClinicalLoginPortal('patient'), 'patient');
assert.equal(matchesClinicalLoginPortal('patient', 'patient'), true);
assert.equal(matchesClinicalLoginPortal('professional', 'patient'), false);
assert.equal(matchesClinicalLoginPortal('coordinator', 'patient'), false);
assert.equal(matchesClinicalLoginPortal('director', 'patient'), false);
assert.equal(matchesClinicalLoginPortal('partner', 'patient'), false);
assert.equal(matchesClinicalLoginPortal('', 'patient'), false);
assert.equal(matchesClinicalLoginPortal(null, 'patient'), false);
assert.equal(matchesClinicalLoginPortal('patient', 'unknown'), false);
assert.equal(matchesClinicalLoginPortal('patient', null), false);
assert.equal(requestedClinicalLoginPortal('partner'), null);
assert.equal(requestedClinicalLoginPortal({ role: 'patient' }), null);
assert.equal(matchesClinicalLoginPortal('patient', 'PATIENT'), true);
assert.equal(matchesClinicalLoginPortal('professional', ' THERAPIST '), true);

const server = fs.readFileSync('server.ts', 'utf8');
const clinicalStart = server.indexOf("app.post('/api/auth/login'");
const clinicalEnd = server.indexOf("app.post('/api/auth/logout'", clinicalStart);
assert.ok(clinicalStart >= 0 && clinicalEnd > clinicalStart);
const clinicalLogin = server.slice(clinicalStart, clinicalEnd);
assert.match(clinicalLogin, /matchesClinicalLoginPortal\(intendedRole, profile\.role\)/);
assert.match(clinicalLogin, /const verifiedProfessionalInvitationActivation =/);
assert.match(clinicalLogin, /requestedClinicInvitation\?\.status === 'pending'/);
assert.match(clinicalLogin, /ensureClinicRole\(requestedClinicInvitation\?\.role\)/);
assert.match(clinicalLogin, /requestedClinicalLoginPortal\(intendedRole\) === 'professional'/);
assert.match(clinicalLogin, /INVALID_PORTAL_CREDENTIALS_MESSAGE/);
assert.ok(
  clinicalLogin.indexOf('matchesClinicalLoginPortal(intendedRole, profile.role)') <
    clinicalLogin.indexOf('const newProfile ='),
  'the persisted role is checked before any new user profile provisioning',
);
assert.ok(
  clinicalLogin.indexOf('matchesClinicalLoginPortal(intendedRole, profile.role)') <
    clinicalLogin.indexOf('const sessionUser ='),
  'the wrong entry portal must be rejected before creating a server session',
);
assert.match(clinicalLogin, /\.from\('verto_partner_accounts'\)/);
assert.match(clinicalLogin, /\.eq\('partner_kind', 'external'\)/);
assert.match(clinicalLogin, /if \(!profile && safeAuthEmail && !verifiedProfessionalInvitationActivation\)/);

const partnerGuardStart = server.indexOf("app.use('/api/partnerships/auth/session'");
assert.ok(partnerGuardStart > server.indexOf('app.use(express.json'));
const partnerGuard = server.slice(partnerGuardStart, partnerGuardStart + 2250);
assert.match(partnerGuard, /getUserFromAccessToken\(accessToken\)/);
assert.match(partnerGuard, /fetchProfileWithSchemaFallback\(/);
assert.match(partnerGuard, /fetchProfileByEmailWithSchemaFallback\(/);
assert.match(partnerGuard, /persistedClinicalLoginPortal\(clinicalProfile\.role\)/);
assert.match(partnerGuard, /INVALID_CREDENTIALS/);
assert.doesNotMatch(partnerGuard, /req\.session\.user\s*=/);

const app = fs.readFileSync('src/App.tsx', 'utf8');
assert.match(app, /if \(errData\?\.error === 'INVALID_CREDENTIALS'\)/);
assert.match(app, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);

const landing = fs.readFileSync('src/components/LandingPage.tsx', 'utf8');
assert.match(landing, /rawMessage\.includes\('e-mail ou senha inválidos'\)/);
assert.match(landing, /setLoginError\('E-mail ou senha inválidos\.'\)/);

const partnerPage = fs.readFileSync('src/components/ExternalPartnershipPortal.tsx', 'utf8');
assert.match(partnerPage, /PARTNER_APPROVAL_PENDING: 'Sua inscrição está em análise/);
assert.match(partnerPage, /CLINICAL_SESSION_ACTIVE: 'Existe uma sessão clínica ativa/);
assert.match(partnerPage, /EMAIL_VERIFICATION_REQUIRED: 'Não foi possível validar/);
assert.match(partnerPage, /\['PARTNER_NOT_REGISTERED', 'INVALID_CREDENTIALS', 'EMAIL_VERIFICATION_REQUIRED'/);
assert.doesNotMatch(partnerPage, /\['CLINICAL_SESSION_ACTIVE', 'PARTNER_NOT_REGISTERED'/);
assert.match(partnerPage, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);

console.log('authLoginPortalPolicy.test.ts: ok');
