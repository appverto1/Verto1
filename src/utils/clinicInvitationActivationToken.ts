import crypto from 'node:crypto';

const CLINIC_INVITATION_TOKEN_VERSION = 1;

type ClinicInvitationActivationTokenPayload = {
  v: number;
  i: string;
  u: string;
  n: string;
  exp: number;
};

export type ClinicInvitationActivationClaims = {
  invitationId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
};

const encodeBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8');

const isSafeSigningSecret = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length >= 32;

const signPayload = (encodedPayload: string, signingSecret: string): string =>
  crypto.createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url');

export function createClinicInvitationActivationToken(params: {
  invitationId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
  signingSecret: string;
}): string {
  if (!isSafeSigningSecret(params.signingSecret)) {
    throw new Error('CLINIC_INVITATION_LINK_SECRET_INVALID');
  }
  if (
    !params.invitationId ||
    !params.userId ||
    !params.nonce ||
    !Number.isFinite(params.expiresAt)
  ) {
    throw new Error('CLINIC_INVITATION_LINK_PAYLOAD_INVALID');
  }

  const payload: ClinicInvitationActivationTokenPayload = {
    v: CLINIC_INVITATION_TOKEN_VERSION,
    i: params.invitationId,
    u: params.userId,
    n: params.nonce,
    exp: Math.trunc(params.expiresAt),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, params.signingSecret.trim())}`;
}

export function verifyClinicInvitationActivationToken(params: {
  token: unknown;
  signingSecret: string;
  now?: number;
}): ClinicInvitationActivationClaims | null {
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
    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<ClinicInvitationActivationTokenPayload>;
    const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();
    if (
      parsed.v !== CLINIC_INVITATION_TOKEN_VERSION ||
      typeof parsed.i !== 'string' ||
      parsed.i.length > 120 ||
      typeof parsed.u !== 'string' ||
      parsed.u.length > 120 ||
      typeof parsed.n !== 'string' ||
      parsed.n.length < 32 ||
      parsed.n.length > 200 ||
      typeof parsed.exp !== 'number' ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= now
    ) {
      return null;
    }
    return {
      invitationId: parsed.i,
      userId: parsed.u,
      nonce: parsed.n,
      expiresAt: Math.trunc(parsed.exp),
    };
  } catch {
    return null;
  }
}
