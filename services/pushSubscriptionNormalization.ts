export type PushSubscriptionInput = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export type NormalizedPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const safeJsonSubscription = (value: any): PushSubscriptionInput | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
};

export const normalizePushSubscription = (rowOrSubscription: any): NormalizedPushSubscription | null => {
  if (rowOrSubscription?.invalidated_at) return null;
  const direct = safeJsonSubscription(rowOrSubscription);
  const embedded = safeJsonSubscription(rowOrSubscription?.subscription);
  const source = embedded || direct || {};
  const endpoint = sanitizeText(source?.endpoint || rowOrSubscription?.endpoint, 2000);
  const p256dh = sanitizeText(source?.keys?.p256dh || rowOrSubscription?.p256dh, 2000);
  const auth = sanitizeText(source?.keys?.auth || rowOrSubscription?.auth, 2000);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth }
  };
};
