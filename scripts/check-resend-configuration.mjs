const apiKey = String(process.env.RESEND_API_KEY || '').trim();
const fromValue = String(process.env.RESEND_FROM_EMAIL || '').trim();
const professionalTemplate = String(
  process.env.RESEND_TEMPLATE_WELCOME_PROFESSIONAL_ID || 'bem-vindo-clnica',
).trim();

const result = {
  ok: false,
  provider: 'resend',
  sender: null,
  domain: null,
  template: null,
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
if (!professionalTemplate) {
  result.errors.push('Template profissional do Resend não configurado.');
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

  const template = await resendGet(
    `/templates/${encodeURIComponent(professionalTemplate)}`,
  );
  const variableKeys = Array.isArray(template?.variables)
    ? template.variables.map((variable) => String(variable?.key || ''))
    : [];
  result.template = {
    id: String(template?.id || ''),
    alias: String(template?.alias || ''),
    status: String(template?.status || ''),
    variables: variableKeys,
  };

  if (String(template?.status || '').toLowerCase() !== 'published') {
    result.errors.push('O template profissional existe, mas não está publicado.');
  }
  for (const requiredVariable of ['nome', 'link_ativacao']) {
    if (!variableKeys.includes(requiredVariable)) {
      result.errors.push(`O template profissional não declara a variável ${requiredVariable}.`);
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
