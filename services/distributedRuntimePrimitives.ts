import crypto from 'crypto';

export const sha256 = (value: unknown) =>
  crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

export const asDate = (value: unknown, fallbackMs: number) => {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now() + fallbackMs);
};
