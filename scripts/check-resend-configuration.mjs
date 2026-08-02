const apiKey = String(process.env.RESEND_API_KEY || '').trim();
const fromValue = String(process.env.RESEND_FROM_EMAIL || '').trim();
const recoveryLinkSecret = String(
  process.env.PASSWORD_RECOVERY_LINK_SECRET || process.env.SESSION_SECRET || '',
).trim();
const templateChecks = [
  {
    key: 'clinicInvitation',
    label: 'convite de clínica',
    envKey: 'RESEND_TEMPLATE_CLINIC_INVITATION_ID',
    configuredId: String(process.env.RESEND_TEMPLATE_CLINIC_INVITATION_ID || '').trim(),
    expectedAlias: null,
    requiredVariables: [
      'clinic_name',
      'invited_professional_name',
      'responsible_professional_name',
      'invited_email',
      'invited_role_label',
      'link_ativacao',
    ],
  },
  {
    key: 'patientActivation',
    label: 'ativação de paciente',
    envKey: 'RESEND_TEMPLATE_PATIENT_ACTIVATION_ID',
    configuredId: String(
      process.env.RESEND_TEMPLATE_PATIENT_ACTIVATION_ID ||
        process.env.RESEND_TEMPLATE_WELCOME_PATIENT_ID ||
        '',
    ).trim(),
    expectedAlias: 'ativao-paciente',
    requiredVariables: ['activation_patient'],
  },
  {
    key: 'passwordReset',
    label: 'redefinição de senha',
    envKey: 'RESEND_TEMPLATE_PASSWORD_RESET_ID',
    configuredId: String(process.env.RESEND_TEMPLATE_PASSWORD_RESET_ID || '').trim(),
    expectedAlias: 'password-reset',
    requiredVariables: ['reset_link'],
  },
];

const result = {
  ok: false,
  provider: 'resend',
  sender: null,
  domain: null,
  template: null,
  templates: {},
  warnings: [],
  errors: [],
};

const extractSenderEmail = (value) => {
  const bracketMatch = value.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const candidate = bracketMatch?.[1] || value;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : null;
};

const senderEmail = extractSenderEmail(fromValue);
if (!apiKey) result.errors.push('RESEND_API_KEY não configurada.');
if (!senderEmail) result.errors.push('RESEND_FROM_EMAIL ausente ou inválido.');
if (!recoveryLinkSecret) {
  result.errors.push('PASSWORD_RECOVERY_LINK_SECRET ou SESSION_SECRET deve estar configurado no backend.');
} else if (!String(process.env.PASSWORD_RECOVERY_LINK_SECRET || '').trim()) {
  result.warnings.push('PASSWORD_RECOVERY_LINK_SECRET ausente; o backend usará SESSION_SECRET como fallback seguro.');
}
for (const templateCheck of templateChecks) {
  if (!templateCheck.configuredId) {
    result.errors.push(`${templateCheck.envKey} não configurado para o template de ${templateCheck.label}.`);
  }
}

const resendGet = async (path) => {
  const response = await fetch(`https://api.resend.com${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'Verto-Resend-Check/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = String(body?.message || raw || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return body;
};

if (result.errors.length > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}

try {
  const senderDomain = senderEmail.split('@')[1];
  result.sender = senderEmail;

  const domainsResponse = await resendGet('/domains');
  const domains = Array.isArray(domainsResponse?.data) ? domainsResponse.data : [];
  const domain = domains.find(
    (entry) => String(entry?.name || '').toLowerCase() === senderDomain,
  );
  result.domain = domain
    ? {
        name: String(domain.name || ''),
        status: String(domain.status || ''),
        sending: String(domain.capabilities?.sending || ''),
      }
    : { name: senderDomain, status: 'not_found', sending: 'unknown' };

  if (!domain) {
    result.errors.push(`O domínio remetente ${senderDomain} não foi encontrado no Resend.`);
  } else if (
    String(domain.status || '').toLowerCase() !== 'verified' ||
    String(domain.capabilities?.sending || '').toLowerCase() === 'disabled'
  ) {
    result.errors.push(`O domínio ${senderDomain} ainda não está habilitado para envio.`);
  }

  for (const templateCheck of templateChecks) {
    // This verification is read-only: it only performs GET requests and never sends e-mail.
    const template = await resendGet(
      `/templates/${encodeURIComponent(templateCheck.configuredId)}`,
    );
    const variableKeys = Array.isArray(template?.variables)
      ? template.variables
          .map((variable) => String(variable?.key || variable?.name || '').trim())
          .filter(Boolean)
      : [];
    const templateResult = {
      id: String(template?.id || ''),
      alias: String(template?.alias || ''),
      status: String(template?.status || ''),
      variables: variableKeys,
    };
    result.templates[templateCheck.key] = templateResult;
    if (templateCheck.key === 'clinicInvitation') {
      // Backward-compatible output consumed by previous deployment notes.
      result.template = templateResult;
    }

    if (String(template?.status || '').toLowerCase() !== 'published') {
      result.errors.push(`O template de ${templateCheck.label} existe, mas não está publicado.`);
    }
    if (
      templateCheck.expectedAlias &&
      String(template?.alias || '').trim() !== templateCheck.expectedAlias
    ) {
      result.errors.push(
        `O template de ${templateCheck.label} deve usar o alias ${templateCheck.expectedAlias}.`,
      );
    }
    for (const requiredVariable of templateCheck.requiredVariables) {
      if (!variableKeys.includes(requiredVariable)) {
        result.errors.push(
          `O template de ${templateCheck.label} não declara a variável ${requiredVariable}.`,
        );
      }
    }
  }

  result.ok = result.errors.length === 0;
  const output = JSON.stringify(result, null, 2);
  if (result.ok) {
    console.log(output);
    process.exit(0);
  }
  console.error(output);
  process.exit(1);
} catch (error) {
  result.errors.push(
    `Falha ao consultar o Resend${error?.statusCode ? ` (HTTP ${error.statusCode})` : ''}: ${String(error?.message || error).slice(0, 300)}`,
  );
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
