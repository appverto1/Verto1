export type EmailTemplateProfile = 'professional' | 'patient';

import { VERTO_EMAIL_HORIZONTAL_LOGO_URL } from '../constants/vertoBranding';

export type ActivationTemplateInput = {
  nome: string;
  link_ativacao: string;
  perfil: EmailTemplateProfile;
};

type WelcomeTemplateInput = {
  nome: string;
  perfil: EmailTemplateProfile;
};

export type ClinicInvitationTemplateInput = {
  clinic_name: string;
  invited_professional_name?: string | null;
  responsible_professional_name?: string | null;
  invited_email: string;
  invited_role_label: string;
  link_ativacao: string;
};

export type PasswordRecoveryTemplateInput = {
  nome: string;
  codigo?: string | null;
  link_recuperacao?: string | null;
  expira_em_minutos: number;
  perfil?: EmailTemplateProfile;
};

export type PatientActivationTemplateVariables = {
  activation_patient: string;
};

export type PasswordRecoveryTemplateVariables = {
  reset_link: string;
};

const DEFAULT_RECOVERY_URL = 'https://www.appverto.com.br/?auth_action=recovery';

const toSafeName = (value: string): string => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : 'Usuário';
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toSafeHttpUrl = (value: unknown, fallback: string): string => {
  const candidate = String(value || '').trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // A controlled fallback keeps malformed input out of an href attribute.
  }
  return fallback;
};

export const buildPatientActivationTemplateVariables = (
  activationLink: unknown,
): PatientActivationTemplateVariables => ({
  activation_patient: String(activationLink || '').trim(),
});

export const buildPasswordRecoveryTemplateVariables = (
  recoveryLink: unknown,
): PasswordRecoveryTemplateVariables => ({
  reset_link: toSafeHttpUrl(recoveryLink, DEFAULT_RECOVERY_URL),
});

const PROFESSIONAL_WELCOME_HTML = `
  <div style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,Helvetica,sans-serif;color:#2e1065;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:34px 36px 12px;text-align:center;">
                <img src="${VERTO_EMAIL_HORIZONTAL_LOGO_URL}" alt="Verto" width="180" height="52" style="display:block;width:180px;height:auto;margin:0 auto 16px;outline:none;border:none;text-decoration:none;" />
                <p style="margin:12px 0 0;color:#8b5cf6;font-size:14px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;">SUA CLÍNICA NO PRÓXIMO NÍVEL</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 36px 0;">
                <h2 style="margin:0 0 12px;color:#2e1065;font-size:44px;line-height:1.12;font-weight:700;">{{saudacao}}</h2>
                <p style="margin:0 0 8px;color:#5b21b6;font-size:36px;line-height:1.35;">Sua jornada para uma gestão mais inteligente e humana começou.</p>
                <p style="margin:0 0 24px;color:#5b21b6;font-size:36px;line-height:1.35;">Estamos muito felizes em ter você na nossa comunidade.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px;">
                <div style="background:#faf5ff;border:1px dashed #c4b5fd;border-radius:12px;padding:28px 18px;text-align:center;">
                  <p style="margin:0 0 18px;color:#4c1d95;font-size:22px;line-height:1.4;font-weight:600;">Clique no botão abaixo para ativar sua conta e começar:</p>
                  <a href="{{link_ativacao}}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;padding:18px 34px;border-radius:999px;font-size:31px;line-height:1.1;font-weight:700;">Confirmar E-mail agora</a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 36px 0;">
                <hr style="border:none;border-top:1px solid #ddd6fe;margin:0 0 22px;" />
                <p style="margin:0 0 10px;color:#6d28d9;font-size:15px;font-weight:700;">O que vem a seguir?</p>
                <p style="margin:0;color:#5b21b6;font-size:32px;line-height:1.34;">✅ Configure seus horários de atendimento</p>
                <p style="margin:0;color:#5b21b6;font-size:32px;line-height:1.34;">👥 Adicione sua primeira equipe</p>
                <p style="margin:0;color:#5b21b6;font-size:32px;line-height:1.34;">📑 Importe seus prontuários</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px 26px;text-align:center;">
                <p style="margin:0 0 14px;color:#a78bfa;font-size:20px;">© 2026 Verto Software Ltda.</p>
                <p style="margin:0;color:#6d28d9;font-size:18px;line-height:1.4;">Se o botão não funcionar, copie e cole este link no navegador:</p>
                <p style="margin:8px 0 0;word-break:break-all;color:#6d28d9;font-size:16px;line-height:1.4;">{{link_ativacao}}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
`;

const PATIENT_WELCOME_HTML = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f3ff;margin:0;padding:0;color:#2e1065;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;padding:28px 28px 24px;">
            <tr>
              <td style="text-align:center;padding-bottom:8px;">
                <img src="${VERTO_EMAIL_HORIZONTAL_LOGO_URL}" alt="Verto" width="160" height="46" style="display:block;width:160px;height:auto;margin:0 auto 16px;border:0;outline:none;" />
                <h1 style="margin:0;padding:0;font-size:1.5rem;line-height:1.333;color:rgb(46,16,101);font-weight:700;margin-bottom:1rem;">Olá, {{nome}}! 🎉</h1>
                <p style="margin:0;padding:0;font-size:1.125rem;line-height:1.75rem;color:rgb(91,33,182);margin-bottom:1.5rem;margin-top:16px;">Seu caminho para um acompanhamento mais próximo e humano começou. Estamos muito felizes em participar da sua jornada.</p>
                <p style="margin:0 0 20px;">
                  <a href="{{link_ativacao}}" style="display:inline-block;background-color:rgb(139,92,246);color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-size:18px;font-weight:700;">Confirmar meu acesso agora</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:6px;">
                <p style="margin:0 0 10px;color:rgb(109,40,217);font-weight:700;">O que você pode fazer agora?</p>
                <p style="margin:0 0 4px;">✅ Visualize seus progressos</p>
                <p style="margin:0 0 4px;">✅ Consulte sua agenda de sessões</p>
                <p style="margin:0;">✅ Acesse materiais compartilhados</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
`;

const PASSWORD_RECOVERY_HTML = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f3ff;margin:0;padding:0;color:#2e1065;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;padding:28px;">
            <tr><td>
              <img src="${VERTO_EMAIL_HORIZONTAL_LOGO_URL}" alt="Verto" width="160" height="46" style="display:block;width:160px;height:auto;margin:0 auto 22px;border:0;outline:none;" />
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.333;color:#2e1065;font-weight:700;">Redefinição de senha</h1>
              <p style="margin:0 0 20px;color:#5b21b6;font-size:16px;line-height:1.6;">Olá, {{nome}}. Recebemos uma solicitação para redefinir a senha da sua conta Verto.</p>
              <p style="margin:0 0 20px;text-align:center;">
                <a href="{{reset_link}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:16px;font-weight:700;">Redefinir minha senha</a>
              </p>
              {{legacy_code_section}}
              <p style="margin:18px 0 0;color:#6d28d9;font-size:13px;line-height:1.5;">Este acesso expira em {{expira_em_minutos}} minutos. Se você não solicitou a alteração, ignore este e-mail; sua senha atual continuará válida.</p>
              <p style="margin:14px 0 0;color:#7c3aed;font-size:12px;line-height:1.45;word-break:break-all;">Se o botão não funcionar, copie e cole no navegador:<br />{{reset_link}}</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
`;

export const buildClinicInvitationEmailTemplate = (
  input: ClinicInvitationTemplateInput
): { subject: string; html: string; variables: Record<string, string> } => {
  const clinicName = escapeHtml(String(input.clinic_name || '').trim());
  if (!clinicName) {
    throw new Error('clinic_name is required for clinic invitation emails');
  }
  const invitedProfessionalName = String(input.invited_professional_name || '').trim();
  const responsibleProfessionalName = String(input.responsible_professional_name || '').trim();
  const invitedEmail = String(input.invited_email || '').trim().toLowerCase();
  const invitedRoleLabel = escapeHtml(String(input.invited_role_label || '').trim() || 'profissional');
  const activationLink = String(input.link_ativacao || '').trim();
  const greeting = invitedProfessionalName
    ? `Olá, ${escapeHtml(invitedProfessionalName)}! 🎉`
    : 'Olá! 🎉';
  const responsibleCopy = responsibleProfessionalName
    ? `<p style="margin:0 0 16px 0;color:#5b21b6;font-size:15px;line-height:1.55;"><strong>${escapeHtml(responsibleProfessionalName)}</strong> realizou este convite em nome da clínica.</p>`
    : '';
  const invitationCopy = `<p style="margin:0 0 16px 0;color:#5b21b6;font-size:15px;line-height:1.55;">Você foi convidado(a) para atuar como <strong>${invitedRoleLabel}</strong> na clínica <strong>${clinicName}</strong>.</p>${responsibleCopy}`;
  const html = PROFESSIONAL_WELCOME_HTML
    .replace(/\{\{saudacao\}\}/g, greeting)
    .replace(/\{\{link_ativacao\}\}/g, activationLink)
    .replace('</h2>', `</h2>${invitationCopy}`);

  return {
    subject: 'Bem-vindo à Verto',
    html,
    variables: {
      clinic_name: String(input.clinic_name || '').trim(),
      invited_professional_name: invitedProfessionalName,
      responsible_professional_name: responsibleProfessionalName,
      invited_email: invitedEmail,
      invited_role_label: String(input.invited_role_label || '').trim(),
      link_ativacao: activationLink,
      // Compatibility with the existing published professional template.
      nome: invitedProfessionalName || 'Profissional',
    },
  };
};

export const buildActivationEmailTemplate = (
  input: ActivationTemplateInput
): { subject: string; html: string; variables: Record<string, string> } => {
  const nome = escapeHtml(toSafeName(input.nome));
  const activationLink = String(input.link_ativacao || '').trim();

  if (input.perfil === 'professional') {
    const subject = 'Bem-vindo à revolução na gestão da sua clínica';
    const html = PROFESSIONAL_WELCOME_HTML
      .replace(/\{\{saudacao\}\}/g, `Olá, ${nome}! 🎉`)
      .replace(/\{\{link_ativacao\}\}/g, activationLink);
    return {
      subject,
      html,
      variables: {
        nome: String(input.nome || '').trim(),
        link_ativacao: activationLink,
      },
    };
  }

  const subject = 'Bem-vindo à Verto! Vamos juntos?';
  const html = PATIENT_WELCOME_HTML
    .replace(/\{\{nome\}\}/g, nome)
    .replace(/\{\{link_ativacao\}\}/g, activationLink);
  return {
    subject,
    html,
    variables: buildPatientActivationTemplateVariables(activationLink),
  };
};

export const buildWelcomeEmailTemplate = (
  input: WelcomeTemplateInput
): { subject: string; html: string } => {
  const nome = escapeHtml(toSafeName(input.nome));
  if (input.perfil === 'professional') {
    return {
      subject: 'Bem-vindo à revolução na gestão da sua clínica',
      html: PROFESSIONAL_WELCOME_HTML
        .replace(/\{\{saudacao\}\}/g, `Olá, ${nome}! 🎉`)
        .replace(/\{\{link_ativacao\}\}/g, '#')
    };
  }
  return {
    subject: 'Bem-vindo à Verto! Vamos juntos?',
    html: PATIENT_WELCOME_HTML
      .replace(/\{\{nome\}\}/g, nome)
      .replace(/\{\{link_ativacao\}\}/g, '#')
  };
};

export const buildPasswordRecoveryEmailTemplate = (
  input: PasswordRecoveryTemplateInput
): { subject: string; html: string; variables: PasswordRecoveryTemplateVariables } => {
  const nome = escapeHtml(toSafeName(input.nome));
  const codigo = escapeHtml(String(input.codigo || '').trim());
  const expiryValue = Number(input.expira_em_minutos);
  const expiryMinutes = Number.isFinite(expiryValue)
    ? Math.max(1, Math.min(1_440, Math.round(expiryValue)))
    : 15;
  const recoveryVariables = buildPasswordRecoveryTemplateVariables(input.link_recuperacao);
  const safeRecoveryLink = escapeHtml(recoveryVariables.reset_link);
  const legacyCodeSection = codigo
    ? `<div style="margin:20px 0;padding:16px;border:1px solid #ddd6fe;border-radius:12px;background:#faf5ff;text-align:center;"><p style="margin:0 0 8px;color:#4c1d95;font-size:13px;font-weight:700;">Código de recuperação</p><p style="margin:0;color:#2e1065;font-size:28px;letter-spacing:3px;font-weight:800;">${codigo}</p></div>`
    : '';

  return {
    subject: 'Redefinição de senha — Verto',
    html: PASSWORD_RECOVERY_HTML
      .replace(/\{\{nome\}\}/g, nome)
      .replace(/\{\{reset_link\}\}/g, safeRecoveryLink)
      .replace(/\{\{legacy_code_section\}\}/g, legacyCodeSection)
      .replace(/\{\{expira_em_minutos\}\}/g, String(expiryMinutes)),
    variables: recoveryVariables,
  };
};
