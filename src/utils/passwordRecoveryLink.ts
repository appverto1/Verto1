import crypto from 'node:crypto';

const RECOVERY_TOKEN_VERSION = 1;

type PasswordRecoveryTokenPayload = {
  v: number;
  k: string;
  s: string;
  exp: number;
};

export type PasswordRecoveryLinkClaims = {
  challengeKey: string;
  challengeSecret: string;
  expiresAt: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(encodedPayload: string, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url');
}

function isSafeSigningSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 32;
}

export function createPasswordRecoveryToken(params: {
  challengeKey: string;
  challengeSecret: string;
  expiresAt: number;
  signingSecret: string;
}): string {
  if (!isSafeSigningSecret(params.signingSecret)) {
    throw new Error('PASSWORD_RECOVERY_LINK_SECRET_INVALID');
  }
  if (!params.challengeKey || !params.challengeSecret || !Number.isFinite(params.expiresAt)) {
    throw new Error('PASSWORD_RECOVERY_LINK_PAYLOAD_INVALID');
  }

  const payload: PasswordRecoveryTokenPayload = {
    v: RECOVERY_TOKEN_VERSION,
    k: params.challengeKey,
    s: params.challengeSecret,
    exp: Math.trunc(params.expiresAt),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, params.signingSecret.trim())}`;
}

export function verifyPasswordRecoveryToken(params: {
  token: unknown;
  signingSecret: string;
  now?: number;
}): PasswordRecoveryLinkClaims | null {
  if (!isSafeSigningSecret(params.signingSecret) || typeof params.token !== 'string') return null;
  const token = params.token.trim();
  if (!token || token.length > 4096) return null;

  const [encodedPayload, suppliedSignature, extraPart] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extraPart) return null;

  const expectedSignature = signPayload(encodedPayload, params.signingSecret.trim());
  const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<PasswordRecoveryTokenPayload>;
    const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();
    if (
      parsed.v !== RECOVERY_TOKEN_VERSION ||
      typeof parsed.k !== 'string' ||
      !parsed.k ||
      parsed.k.length > 200 ||
      typeof parsed.s !== 'string' ||
      parsed.s.length < 32 ||
      parsed.s.length > 200 ||
      typeof parsed.exp !== 'number' ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= now
    ) {
      return null;
    }
    return {
      challengeKey: parsed.k,
      challengeSecret: parsed.s,
      expiresAt: Math.trunc(parsed.exp),
    };
  } catch {
    return null;
  }
}

