export const EXTERNAL_EVOLUTION_ACTIVATION_FRAGMENT_PARAM = 'activation_token';

const normalizeText = (value) => String(value ?? '').trim();

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export function buildExternalEvolutionActivationAccessUrl(locatorValue, rawTokenValue) {
  const locator = normalizeText(locatorValue);
  const rawToken = normalizeText(rawTokenValue);
  if (!locator || rawToken.length < 32 || rawToken.length > 256) {
    throw new Error('EXTERNAL_EVOLUTION_ACTIVATION_LINK_INVALID');
  }
  const url = new URL(locator);
  const fragment = new URLSearchParams();
  fragment.set(EXTERNAL_EVOLUTION_ACTIVATION_FRAGMENT_PARAM, rawToken);
  url.hash = fragment.toString();
  return url.toString();
}

export function readExternalEvolutionActivationTokenFromUrl(urlValue) {
  const rawUrl = normalizeText(urlValue);
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl, 'https://verto.invalid');
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    return normalizeText(fragment.get(EXTERNAL_EVOLUTION_ACTIVATION_FRAGMENT_PARAM));
  } catch {
    return '';
  }
}

export function buildExternalEvolutionInviteEmailContract({ clinicName: clinicNameValue, shareUrl: shareUrlValue, logoUrl: logoUrlValue }) {
  const clinicName = escapeHtml(normalizeText(clinicNameValue) || 'Clínica');
  const shareUrl = escapeHtml(normalizeText(shareUrlValue));
  const logoUrl = escapeHtml(normalizeText(logoUrlValue));
  return {
    subject: `${clinicName} compartilhou uma atualização clínica com você`,
    html: `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:28px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;padding:28px;">
          <img src="${logoUrl}" alt="Verto" width="160" height="46" style="display:block;width:160px;height:auto;margin:0 0 20px;border:0;outline:none;" />
          <h1 style="font-size:21px;margin:0 0 14px;">Timeline clínica compartilhada</h1>
          <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 18px;">
            ${clinicName} disponibilizou uma atualização clínica para continuidade do cuidado. Após autenticar sua conta Verto, você verá a timeline compartilhada deste paciente contendo somente os registros autorizados para o seu e-mail.
          </p>
          <a href="${shareUrl}" style="display:inline-block;background:#7a32fc;color:#fff;text-decoration:none;border-radius:14px;padding:13px 18px;font-weight:800;">Acessar timeline compartilhada</a>
        </div>
      </div>
    `
  };
}

export function resolveExternalEvolutionBootstrapMode({ authenticated, mismatch, tokenState, authUserExists }) {
  // A valid one-time invitation is allowed to bootstrap its own recipient even when
  // this browser still carries an external-partner session for another account.
  // The invitation remains bootstrap-only: future access still requires the account
  // session bound to the ACTIVE grant.
  if (tokenState === 'VALID') {
    if (authenticated) return 'AUTHENTICATED';
    return authUserExists ? 'LOGIN' : 'ACTIVATE';
  }
  if (authenticated) return 'AUTHENTICATED';
  if (mismatch) return 'MISMATCH';
  if (tokenState === 'CONSUMED') return 'LOGIN';
  return 'REFRESH';
}

export function classifyExternalEvolutionBootstrapFailure(statusValue, codeValue) {
  const status = Number(statusValue) || 0;
  const code = normalizeText(codeValue);
  if (code === 'EXTERNAL_ACCOUNT_MISMATCH' || status === 403) return 'MISMATCH';
  if (code === 'EXTERNAL_ACCESS_LINK_REFRESH_REQUIRED') return 'REFRESH';
  if (status === 404) return 'UNAVAILABLE';
  return 'TEMPORARY_ERROR';
}
