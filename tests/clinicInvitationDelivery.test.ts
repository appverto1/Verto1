import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildActivationEmailTemplate } from '../src/services/emailTemplates';

const server = fs.readFileSync('server.ts', 'utf8');
const teamManagement = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const invitationModal = fs.readFileSync('src/components/InvitationModal.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const resendConfigurationCheck = fs.readFileSync(
  'scripts/check-resend-configuration.mjs',
  'utf8',
);
const resendCheckScript = fs.readFileSync('scripts/check-resend-configuration.mjs', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const resendSender = section(
  server,
  'async function sendEmailViaResend({',
  'const HTML_ESCAPE_MAP',
);
const inviteRoute = section(
  server,
  "app.post('/api/clinic/invite'",
  "app.get('/api/clinic/invitations'",
);
const inviteDataService = section(
  dataService,
  'async inviteToClinic(',
  'async getInvitations()',
);
const newInviteHandler = section(
  teamManagement,
  'const handleInvite = async',
  'const handleCancelInvitation = async',
);

assert.match(server, /function resolveConfiguredResendFrom\(fallback: string\)/);
assert.match(inviteRoute, /from: resolveConfiguredResendFrom\(OFFICIAL_FROM_NOREPLY\)/);
assert.doesNotMatch(
  inviteRoute,
  /from: OFFICIAL_FROM_NOREPLY/,
  'o convite não pode ignorar RESEND_FROM_EMAIL',
);

assert.match(resendSender, /template:\s*\{[\s\S]*?id: templateId,[\s\S]*?variables: templateData \|\| \{\}/);
assert.match(resendSender, /templatePayload \|\| htmlPayload/);
assert.match(resendSender, /deliveryMode = 'html_fallback'/);
assert.match(resendSender, /providerMessageId: sanitizeString\(responseBody\.json\?\.id/);
assert.match(server, /sendTransactionalEmailWithResultSafe/);
assert.match(server, /'User-Agent': 'Verto\/1\.0'/);
assert.match(server, /templateFallbackReason/);

assert.match(inviteRoute, /nome: invitedProfessionalName/);
assert.match(inviteRoute, /link_ativacao: activationLink/);
assert.match(inviteRoute, /escapeHtml\(invitedRoleLabel\)/);
assert.match(inviteRoute, /escapeHtml\(clinicName\)/);
assert.match(inviteRoute, /providerMessageId: emailDelivery\.providerMessageId/);
assert.match(inviteRoute, /deliveryMode: emailDelivery\.deliveryMode/);
assert.match(inviteRoute, /templateId: emailDelivery\.templateId/);

assert.match(inviteRoute, /res\.status\(502\)\.json\(\{/);
assert.match(inviteRoute, /code: 'CLINIC_INVITATION_EMAIL_SEND_FAILED'/);
assert.match(inviteRoute, /invitationPersisted: true/);
assert.match(inviteRoute, /invitationEmailSent: false/);
assert.match(inviteRoute, /if \(!emailSent\)/);
assert.match(inviteRoute, /return res\.json\(\{[\s\S]*?success: true,[\s\S]*?invitationEmailSent: true/);
assert.doesNotMatch(
  inviteRoute,
  /success: true,[\s\S]{0,300}invitationEmailSent: emailSent/,
  'falha de e-mail não pode continuar retornando sucesso global',
);
assert.match(inviteRoute, /logRouteDbError\('\/api\/clinic\/invite \[POST\]'/);
assert.doesNotMatch(inviteRoute, /\/api\/tasks\/:patientId/);

assert.match(inviteDataService, /const payload = await safeJson\(response\)/);
assert.match(inviteDataService, /\.\.\.payload,[\s\S]*?success: false/);
assert.match(newInviteHandler, /result\.success && result\.invitationEmailSent !== false/);
assert.match(newInviteHandler, /setSuccess\(result\.message \|\|/);
assert.match(newInviteHandler, /if \(result\.invitationPersisted\) \{[\s\S]*?await fetchInvitations\(\)/);
assert.doesNotMatch(newInviteHandler, /Convite enviado com sucesso para/);
assert.match(invitationModal, /result\.success && result\.invitationEmailSent !== false/);
assert.match(invitationModal, /result\.invitationPersisted/);

assert.match(envExample, /RESEND_TEMPLATE_WELCOME_PROFESSIONAL_ID=/);
assert.match(envExample, /variables `nome` and `link_ativacao`/);
assert.equal(
  packageJson.scripts?.['check:resend'],
  'node scripts/check-resend-configuration.mjs',
);
assert.match(resendConfigurationCheck, /GET|resendGet/);
assert.match(resendConfigurationCheck, /\/domains/);
assert.match(resendConfigurationCheck, /\/templates\//);
assert.match(resendConfigurationCheck, /'User-Agent': 'Verto-Resend-Check\/1\.0'/);
assert.match(resendConfigurationCheck, /AbortSignal\.timeout\(10_000\)/);
assert.match(resendConfigurationCheck, /\['nome', 'link_ativacao'\]/);
assert.match(resendCheckScript, /resendGet\('\/domains'\)/);
assert.match(resendCheckScript, /\/templates\/\$\{encodeURIComponent\(professionalTemplate\)\}/);
assert.match(resendCheckScript, /\['nome', 'link_ativacao'\]/);
assert.doesNotMatch(resendCheckScript, /POST|\/emails/);

const personalizedTemplate = buildActivationEmailTemplate({
  nome: 'Marina',
  link_ativacao: 'https://appverto.com.br/ativar?token=teste',
  perfil: 'professional',
});
assert.match(personalizedTemplate.html, /Olá, Marina!/);
assert.match(personalizedTemplate.html, /https:\/\/appverto\.com\.br\/ativar\?token=teste/);
assert.doesNotMatch(personalizedTemplate.html, /\{\{saudacao\}\}|\{\{link_ativacao\}\}/);

console.log('clinicInvitationDelivery.test.ts: ok');
