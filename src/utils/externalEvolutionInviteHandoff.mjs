import crypto from 'node:crypto';

export const EXTERNAL_EVOLUTION_INVITE_HANDOFF_QUERY_PARAM = 't';
export const EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS = 15 * 60 * 1000;
export const EXTERNAL_EVOLUTION_INVITE_COOKIE_PATH = '/api/external';

const normalizeText = (value) => String(value ?? '').trim();

export function buildExternalEvolutionActivationHandoffUrl(locatorValue, rawTokenValue) {
  const locator = normalizeText(locatorValue);
  const rawToken = normalizeText(rawTokenValue);
  if (!locator || rawToken.length < 32 || rawToken.length > 256) {
    throw new Error('EXTERNAL_EVOLUTION_ACTIVATION_HANDOFF_LINK_INVALID');
  }
  const url = new URL(locator);
  url.hash = '';
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/convite`;
  url.searchParams.set(EXTERNAL_EVOLUTION_INVITE_HANDOFF_QUERY_PARAM, rawToken);
  return url.toString();
}

export function buildExternalEvolutionCleanAccessPath(publicIdValue) {
  const publicId = normalizeText(publicIdValue);
  if (!publicId) throw new Error('EXTERNAL_EVOLUTION_PUBLIC_ID_REQUIRED');
  return `/evolucao-compartilhada/${encodeURIComponent(publicId)}`;
}

export function externalEvolutionInvitationCookieName(publicIdValue) {
  const publicId = normalizeText(publicIdValue);
  if (!publicId) throw new Error('EXTERNAL_EVOLUTION_PUBLIC_ID_REQUIRED');
  return `verto_external_invite_${crypto.createHash('sha256').update(publicId, 'utf8').digest('hex').slice(0, 16)}`;
}

export function signExternalEvolutionInvitationContext(params, secretValue) {
  const secret = normalizeText(secretValue);
  const publicId = normalizeText(params?.publicId);
  const grantId = normalizeText(params?.grantId);
  const tokenId = normalizeText(params?.tokenId);
  const expiresAt = Number(params?.expiresAt || 0);
  if (secret.length < 32 || !publicId || !grantId || !tokenId || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('EXTERNAL_EVOLUTION_INVITE_CONTEXT_INVALID');
  }
  const payload = Buffer.from(JSON.stringify({ publicId, grantId, tokenId, expiresAt }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyExternalEvolutionInvitationContext(tokenValue, secretValue, nowValue = Date.now()) {
  const token = normalizeText(tokenValue);
  const secret = normalizeText(secretValue);
  if (!token || secret.length < 32) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const publicId = normalizeText(parsed?.publicId);
    const grantId = normalizeText(parsed?.grantId);
    const tokenId = normalizeText(parsed?.tokenId);
    const expiresAt = Number(parsed?.expiresAt || 0);
    const now = Number(nowValue || 0);
    if (!publicId || !grantId || !tokenId || !Number.isFinite(expiresAt) || !Number.isFinite(now) || now >= expiresAt) return null;
    return { publicId, grantId, tokenId, expiresAt };
  } catch {
    return null;
  }
}

export function externalEvolutionInvitationCookieOptions({ secureValue, maxAgeValue } = {}) {
  const maxAge = Math.max(1, Math.min(EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS, Number(maxAgeValue || EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS)));
  return {
    httpOnly: true,
    secure: Boolean(secureValue),
    sameSite: 'lax',
    path: EXTERNAL_EVOLUTION_INVITE_COOKIE_PATH,
    maxAge,
  };
}

export function externalEvolutionInvitationCookieClearOptions({ secureValue } = {}) {
  return {
    httpOnly: true,
    secure: Boolean(secureValue),
    sameSite: 'lax',
    path: EXTERNAL_EVOLUTION_INVITE_COOKIE_PATH,
  };
}
