export const NEW_FEATURE_KEYS = ['clinic_notices'] as const;

export type NewFeatureKey = (typeof NEW_FEATURE_KEYS)[number];

export type FeatureMetadata = {
  key: NewFeatureKey;
  label: string;
  releasedAt: string;
  newForDays: number;
};

export const FEATURE_METADATA: Record<NewFeatureKey, FeatureMetadata> = {
  clinic_notices: {
    key: 'clinic_notices',
    label: 'Avisos',
    releasedAt: '2026-08-20T00:00:00-03:00',
    newForDays: 14,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const isKnownNewFeatureKey = (value: unknown): value is NewFeatureKey =>
  NEW_FEATURE_KEYS.includes(String(value || '').trim() as NewFeatureKey);

export const getFeatureMetadata = (featureKey: NewFeatureKey): FeatureMetadata =>
  FEATURE_METADATA[featureKey];

export const isFeatureWithinNewWindow = (
  featureKey: NewFeatureKey,
  now: Date | number = Date.now(),
): boolean => {
  const metadata = FEATURE_METADATA[featureKey];
  const releasedAtMs = new Date(metadata.releasedAt).getTime();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(releasedAtMs) || !Number.isFinite(nowMs)) return false;
  const expiresAtMs = releasedAtMs + metadata.newForDays * DAY_MS;
  return nowMs >= releasedAtMs && nowMs < expiresAtMs;
};

export const getActiveNewFeatureKeys = (
  now: Date | number = Date.now(),
): NewFeatureKey[] => NEW_FEATURE_KEYS.filter((featureKey) => isFeatureWithinNewWindow(featureKey, now));

export const shouldShowNewBadge = ({
  featureKey,
  hasAccess,
  firstAccessedAt,
  now = Date.now(),
}: {
  featureKey: NewFeatureKey;
  hasAccess: boolean;
  firstAccessedAt?: string | null;
  now?: Date | number;
}): boolean => {
  if (!hasAccess || firstAccessedAt) return false;
  return isFeatureWithinNewWindow(featureKey, now);
};
