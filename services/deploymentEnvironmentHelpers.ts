import crypto from 'crypto';

export const clean = (value: unknown, maxLength = 500) => String(value ?? '').trim().slice(0, maxLength);

export function vapidPublicKeyFingerprint(value: unknown): string | null {
  const publicKey = clean(value, 2000);
  if (!publicKey) return null;
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 24);
}

export function parseHttpUrl(value: unknown): URL | null {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

export function hasEnvironmentHint(value: unknown, hints: string[]) {
  const normalized = clean(value, 240).toLowerCase();
  return Boolean(normalized && hints.some((hint) => normalized.includes(hint)));
}
