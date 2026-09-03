import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const invite = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const landing = fs.readFileSync(new URL('../src/components/LandingPage.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const epochs = fs.readFileSync(new URL('../supabase/migrations/20260903123000_external_share_grant_authorization_epochs.sql', import.meta.url), 'utf8');

// Custom-domain e-mails use the same normalized-email/Auth contract as Gmail.
const customDomainFixture = 'contato@neurosingulares.com.br';
assert.match(customDomainFixture, /^[^@]+@[^@]+\.[^@]+$/);
assert.match(server, /sanitizeEmail\(validated\.loaded\.grant\.recipient_email\)/);
assert.doesNotMatch(server, /@gmail\.com[\s\S]{0,200}external/i);

// Ambient internal/browser sessions do not decide invitation authorization.
assert.match(server, /resolveExternalProfessionalAccountFromExternalSession/);
const preauthStart = server.indexOf("app.get('/api/external/evolution/:publicId'");
const preauthEnd = server.indexOf("app.post('/api/external/evolution/:publicId/resend-access'", preauthStart);
const preauth = server.slice(preauthStart, preauthEnd);
assert.match(preauth, /resolveExternalProfessionalAccountFromExternalSession/);
assert.doesNotMatch(preauth, /resolveExternalProfessionalAccount\(req, sanitizeEmail\(loaded\.grant\.recipient_email\)\)/);
assert.match(invite, /Ignore an unrelated browser\/Supabase session/);
assert.match(invite, /sessionEmail !== normalizedExpected/);

// First invitation: immutable invite e-mail + required name + simple 8-char password.
assert.match(invite, /value=\{email\} readOnly/);
assert.match(invite, /Seu nome/);
assert.match(invite, /displayName/);
assert.match(invite, /password\.length < 8/);
assert.match(invite, /Use pelo menos 8 caracteres\. Sem regras de composição\./);
assert.match(server, /EXTERNAL_PARTNER_PASSWORD_MIN_LENGTH = 8/);
assert.match(server, /validateExternalPartnerPassword/);
assert.doesNotMatch(preauth, /patientName:|clinicName:|subject:|content:/);

// Activation converges on one Auth identity/account and stores the chosen display name.
const activationStart = server.indexOf("app.post('/api/external/evolution/:publicId/activate'");
const activationEnd = server.indexOf("app.post('/api/external/auth/session'", activationStart);
const activation = server.slice(activationStart, activationEnd);
assert.match(activation, /findAuthUserByEmail\(email\)/);
assert.match(activation, /signInWithPassword\(\{ email, password \}\)/);
assert.match(activation, /supabase\.auth\.admin\.createUser/);
assert.match(activation, /ensureExternalProfessionalAccountForAuthUser\(authUser, displayName\)/);
assert.match(activation, /consume_external_evolution_activation_token_v1/);
assert.match(activation, /bindExternalProfessionalAccount/);
assert.match(activation, /setExternalClinicalIdentitySession/);
assert.match(invite, /Criar meu acesso gratuito/);
assert.match(invite, /Já sou profissional parceiro — Entrar/);

// Existing internal Auth UID remains reusable without role/membership mutation.
assert.doesNotMatch(activation, /clinic_memberships/);
assert.doesNotMatch(activation, /role\s*:/);
assert.doesNotMatch(server, /role\s*:\s*['"]external_professional/);

// Partner access is a distinct landing-page entry; existing professional access remains.
assert.match(landing, /Sou profissional parceiro/);
assert.match(landing, /window\.location\.href = '\/rede-de-cuidado'/);
assert.match(landing, /Sou Profissional/);
assert.match(landing, /Área do profissional/);

// Partner central uses explicit password login; OAuth only bridges after explicit partner OAuth.
assert.match(central, /Acesso do profissional parceiro/);
assert.match(central, /\/api\/external\/auth\/login/);
assert.match(central, /partner_oauth/);
assert.match(central, /isPartnerOauthReturn/);
assert.match(central, /signInWithOAuth/);
assert.match(timeline, /isPartnerOauthReturn/);
assert.match(app, /isExternalEvolutionRoute \|\| isExternalCareNetworkRoute \|\| isExternalCarePatientRoute/);

// Premium hub remains grant-driven, grouped by tenant/patient and searchable by sender.
assert.match(server, /\.eq\('external_account_id', accountId\)[\s\S]*\.eq\('status', 'ACTIVE'\)/);
assert.match(server, /created_by_user_id/);
assert.match(server, /supabase\.from\('users'\)\.select\('id,name'\)\.in\('id', actorIds\)/);
assert.match(server, /senderName:/);
assert.match(central, /Buscar clínica, paciente ou profissional/);
assert.match(central, /senderNames\.some/);
assert.match(central, /Compartilhado por/);
assert.match(central, /toggleClinic/);
assert.match(central, /openPatientTimeline/);
assert.match(central, /Seus compartilhamentos, organizados em um só lugar/);

// Persistence/revocation remains server-derived; authorization epochs stay immutable.
assert.match(central, /api\/external\/care-network\/shared/);
assert.doesNotMatch(central, /localStorage/);
assert.match(epochs, /WHERE status = 'ACTIVE'/);
assert.match(epochs, /INSERT INTO public\.patient_evolution_share_grants/);
assert.doesNotMatch(epochs, /revoked_at\s*=\s*NULL[\s\S]*UPDATE public\.patient_evolution_share_grants/i);

console.log('externalPartnerOnboardingHub20260903.regression: PASS');
