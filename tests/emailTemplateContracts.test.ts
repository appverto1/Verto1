import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildActivationEmailTemplate,
  buildPasswordRecoveryEmailTemplate,
  buildPasswordRecoveryTemplateVariables,
  buildPatientActivationTemplateVariables,
} from '../src/services/emailTemplates';

const activationUrl =
  'https://project.supabase.co/auth/v1/verify?token=one-time-token&type=signup';
assert.deepEqual(buildPatientActivationTemplateVariables(activationUrl), {
  activation_patient: activationUrl,
});

const patientActivation = buildActivationEmailTemplate({
  nome: 'Ana',
  link_ativacao: activationUrl,
  perfil: 'patient',
});
assert.deepEqual(patientActivation.variables, { activation_patient: activationUrl });
assert.match(patientActivation.html, /Ana/);
assert.match(patientActivation.html, /one-time-token/);

// The provider-facing professional contract remains available for old templates.
const professionalActivation = buildActivationEmailTemplate({
  nome: 'Marina',
  link_ativacao: activationUrl,
  perfil: 'professional',
});
assert.deepEqual(professionalActivation.variables, {
  nome: 'Marina',
  link_ativacao: activationUrl,
});

const recoveryUrl =
  'https://www.appverto.com.br/reset-password?recovery_token=signed-token';
assert.deepEqual(buildPasswordRecoveryTemplateVariables(recoveryUrl), {
  reset_link: recoveryUrl,
});
assert.deepEqual(buildPasswordRecoveryTemplateVariables('javascript:alert(1)'), {
  reset_link: 'https://www.appverto.com.br/?auth_action=recovery',
});

const legacyRecovery = buildPasswordRecoveryEmailTemplate({
  nome: 'Alexandre',
  codigo: '123456',
  link_recuperacao: recoveryUrl,
  expira_em_minutos: 15,
  perfil: 'patient',
});
assert.equal(legacyRecovery.subject, 'Redefinição de senha — Verto');
assert.deepEqual(legacyRecovery.variables, { reset_link: recoveryUrl });
assert.match(legacyRecovery.html, /Alexandre/);
assert.match(legacyRecovery.html, /123456/);
assert.match(legacyRecovery.html, /expira em 15 minutos/);
assert.match(legacyRecovery.html, /signed-token/);
assert.doesNotMatch(legacyRecovery.html, /\{\{[^}]+\}\}/);

// Recovery belongs to the Auth identity, so the visible fallback is role-neutral.
const professionalRecovery = buildPasswordRecoveryEmailTemplate({
  nome: 'Alexandre',
  codigo: '123456',
  link_recuperacao: recoveryUrl,
  expira_em_minutos: 15,
  perfil: 'professional',
});
assert.equal(professionalRecovery.html, legacyRecovery.html);

const signedLinkRecovery = buildPasswordRecoveryEmailTemplate({
  nome: 'Conta Verto',
  link_recuperacao: recoveryUrl,
  expira_em_minutos: 30,
});
assert.deepEqual(signedLinkRecovery.variables, { reset_link: recoveryUrl });
assert.doesNotMatch(signedLinkRecovery.html, /Código de recuperação/);
assert.match(signedLinkRecovery.html, /expira em 30 minutos/);

const envExample = fs.readFileSync('.env.example', 'utf8');
assert.match(envExample, /^RESEND_TEMPLATE_PATIENT_ACTIVATION_ID=ativao-paciente$/m);
assert.match(envExample, /^RESEND_TEMPLATE_WELCOME_PATIENT_ID=$/m);
assert.match(envExample, /^RESEND_TEMPLATE_PASSWORD_RESET_ID=password-reset$/m);
assert.match(envExample, /^RESEND_TEMPLATE_RECOVERY_PROFESSIONAL_ID=$/m);
assert.match(envExample, /^RESEND_TEMPLATE_RECOVERY_PATIENT_ID=$/m);
assert.match(envExample, /^PASSWORD_RECOVERY_LINK_SECRET=$/m);
assert.match(envExample, /SESSION_SECRET/);
assert.doesNotMatch(envExample, /^VITE_PASSWORD_RECOVERY_LINK_SECRET=/m);

const resendCheck = fs.readFileSync('scripts/check-resend-configuration.mjs', 'utf8');
assert.match(resendCheck, /RESEND_TEMPLATE_CLINIC_INVITATION_ID/);
assert.match(resendCheck, /RESEND_TEMPLATE_PATIENT_ACTIVATION_ID/);
assert.match(resendCheck, /RESEND_TEMPLATE_WELCOME_PATIENT_ID/);
assert.match(resendCheck, /RESEND_TEMPLATE_PASSWORD_RESET_ID/);
assert.match(resendCheck, /activation_patient/);
assert.match(resendCheck, /reset_link/);
assert.doesNotMatch(resendCheck, /method:\s*['"]POST['"]/);
assert.doesNotMatch(resendCheck, /\/emails(?:['"`?])/);

const server = fs.readFileSync('server.ts', 'utf8');
const activationAccess = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `inicio ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const signupActivation = section(
  server,
  'const registerUserWithEmailConfirmation = async',
  "app.post('/api/auth/signup'",
);
assert.match(signupActivation, /templateData: activationEmail\.variables/);
assert.doesNotMatch(
  signupActivation,
  /templateData:\s*\{[\s\S]*?nome:[\s\S]*?link_ativacao:/,
  'signup nao deve reconstruir variaveis do template fora do helper canonico',
);

const resendConfirmation = section(
  server,
  "app.post('/api/auth/resend-confirmation'",
  "app.post('/api/auth/activation/bootstrap'",
);
assert.match(resendConfirmation, /templateData: activationEmail\.variables/);
assert.doesNotMatch(
  resendConfirmation,
  /templateData:\s*\{[\s\S]*?nome:[\s\S]*?link_ativacao:/,
  'reenvio nao deve reconstruir variaveis do template fora do helper canonico',
);

const activationBootstrap = section(
  server,
  "app.post('/api/auth/activation/bootstrap'",
  "app.post('/api/auth/password/recovery/bootstrap'",
);
assert.match(activationBootstrap, /sendTransactionalEmailSafe\(\{/);
assert.match(activationBootstrap, /templateData: activationEmail\.variables/);
assert.match(activationBootstrap, /return res\.json\(genericResponse\)/);
assert.match(activationBootstrap, /profile\?\.role \|\| \(authUser as any\)\?\.user_metadata\?\.role/);
assert.doesNotMatch(activationBootstrap, /req\.body\?\.role/);
assert.doesNotMatch(activationBootstrap, /updateUserById/);
assert.doesNotMatch(
  activationBootstrap,
  /(?:res\.json|\.json)\s*\(\s*\{[^}]*activationLink/s,
  'o link privilegiado nunca pode integrar o JSON do bootstrap',
);
assert.doesNotMatch(activationBootstrap, /ALREADY_CONFIRMED|Conta n.o encontrada/);

const activationBootstrapClient = section(
  activationAccess,
  'const requestActivationBootstrap = async',
  'useEffect(() => {',
);
assert.match(activationBootstrapClient, /body: JSON\.stringify\(\{ email: safeEmail \}\)/);
assert.doesNotMatch(activationBootstrapClient, /activationLink|alreadyConfirmed|window\.location/);

console.log('emailTemplateContracts.test.ts: ok');
