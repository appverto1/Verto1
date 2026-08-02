import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildClinicInvitationEmailTemplate } from '../src/services/emailTemplates';

const server = fs.readFileSync('server.ts', 'utf8');
const teamManagement = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const invitationModal = fs.readFileSync('src/components/InvitationModal.tsx', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');
const resendCheck = fs.readFileSync('scripts/check-resend-configuration.mjs', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const inviteRoute = section(
  server,
  "app.post('/api/clinic/invite'",
  "app.get('/api/clinic/invitations'",
);
const publicInviteResponse = inviteRoute.slice(inviteRoute.indexOf('if (!emailSent)'));

// O backend resolve a identidade da clínica pela clinic_id autenticada.
assert.match(inviteRoute, /const clinicId = currentClinicId\(user\)/);
assert.match(inviteRoute, /fetchClinicOnboardingSnapshot\(clinicId\)/);
assert.match(inviteRoute, /resolveOfficialClinicName\(clinic\)/);
assert.match(server, /async function resolveOfficialClinicName/);
assert.match(server, /ownerProfile\?\.clinic_name/);
assert.match(server, /normalizeClinicOfficialName\(name\) === ownerIdentity/);
assert.match(server, /isGenericClinicOfficialName/);
assert.match(inviteRoute, /CLINIC_IDENTITY_NOT_CONFIGURED/);
assert.doesNotMatch(inviteRoute, /clinic\?\.name\s*\|\|\s*user\.name/);
assert.doesNotMatch(inviteRoute, /clinicName\s*=\s*sanitizeString\([^\n]*user\.name/);

// As quatro identidades são mantidas em variáveis distintas.
assert.match(inviteRoute, /clinic_name: clinicName/);
assert.match(inviteRoute, /invited_professional_name: invitedProfessionalName/);
assert.match(inviteRoute, /responsible_professional_name: responsibleProfessionalName/);
assert.match(inviteRoute, /invited_email: email/);
assert.match(inviteRoute, /templateKind: 'clinic_invitation'/);
assert.match(inviteRoute, /templateData: invitationEmail\.variables/);
assert.match(inviteRoute, /preferHtml: true/);
assert.doesNotMatch(inviteRoute, /email\.split\('@'\)\[0\]/);
assert.match(inviteRoute, /const invitedProfileExists = Boolean\(invitedProfileResult\.data\?\.id\)/);
assert.match(inviteRoute, /authUserHadVerifiedEmail && invitedProfileExists/);

const personalized = buildClinicInvitationEmailTemplate({
  clinic_name: 'Espaço Guiar',
  invited_professional_name: 'Marina Souza',
  responsible_professional_name: 'Mateus Montoro',
  invited_email: 'marina@example.com',
  invited_role_label: 'Psicóloga',
  link_ativacao: 'https://www.appverto.com.br/?auth_action=activate&invitation_id=00000000-0000-4000-8000-000000000001',
});
assert.equal(personalized.subject, 'Bem-vindo à Verto');
assert.match(personalized.html, /Olá, Marina Souza!/);
assert.match(personalized.html, /clínica <strong>Espaço Guiar<\/strong>/);
assert.match(personalized.html, /Mateus Montoro<\/strong> realizou este convite em nome da clínica/);
assert.doesNotMatch(personalized.subject, /Mateus Montoro/);
assert.equal(personalized.variables.clinic_name, 'Espaço Guiar');
assert.equal(personalized.variables.invited_professional_name, 'Marina Souza');
assert.equal(personalized.variables.responsible_professional_name, 'Mateus Montoro');
assert.equal(personalized.variables.invited_email, 'marina@example.com');

const genericGreeting = buildClinicInvitationEmailTemplate({
  clinic_name: 'Espaço Guiar',
  invited_professional_name: null,
  responsible_professional_name: null,
  invited_email: 'contato.aba+financeiro@example.com',
  invited_role_label: 'Profissional de atendimento',
  link_ativacao: 'https://www.appverto.com.br/',
});
assert.match(genericGreeting.html, /Olá! 🎉/);
assert.doesNotMatch(genericGreeting.html, /contato\.aba|financeiro/);
assert.equal(genericGreeting.variables.invited_professional_name, '');

// O cliente recebe somente estado funcional; IDs e fallback do Resend ficam nos logs.
assert.match(inviteRoute, /providerMessageId: emailDelivery\.providerMessageId/);
assert.match(inviteRoute, /deliveryMode: emailDelivery\.deliveryMode/);
assert.match(inviteRoute, /templateId: emailDelivery\.templateId/);
assert.doesNotMatch(publicInviteResponse, /emailDelivery:\s*\{|providerMessageId|templateFallbackReason|templateId/);
assert.match(inviteRoute, /code: 'CLINIC_INVITATION_EMAIL_SEND_FAILED'/);
assert.match(inviteRoute, /invitationPersisted: true/);
assert.match(inviteRoute, /invitationEmailSent: false/);
assert.match(inviteRoute, /message: 'Convite enviado com sucesso\.'/);
assert.match(teamManagement, /result\.success && result\.invitationEmailSent !== false/);
assert.match(invitationModal, /result\.success && result\.invitationEmailSent !== false/);

// Contrato explícito para template publicado, sem reutilizar o template de boas-vindas.
assert.match(envExample, /RESEND_TEMPLATE_CLINIC_INVITATION_ID=/);
for (const variable of [
  'clinic_name',
  'invited_professional_name',
  'responsible_professional_name',
  'invited_email',
  'invited_role_label',
  'link_ativacao',
]) {
  assert.match(envExample, new RegExp(variable));
  assert.match(resendCheck, new RegExp(`['\"]${variable}['\"]`));
}
assert.match(resendCheck, /RESEND_TEMPLATE_CLINIC_INVITATION_ID/);
assert.doesNotMatch(resendCheck, /RESEND_TEMPLATE_WELCOME_PROFESSIONAL_ID/);

console.log('clinicInvitationDelivery.test.ts: ok');
