type FeatureFlagSource = Record<string, unknown> | null | undefined;

const truthyValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const falsyValues = new Set(['0', 'false', 'no', 'off', 'disabled']);

export const normalizeFeatureFlagValue = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (truthyValues.has(normalized)) return true;
  if (falsyValues.has(normalized)) return false;
  return fallback;
};

const readSourceValue = (source: FeatureFlagSource, keys: string[]) => {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
};

const readStorageValue = (storage: Storage | null | undefined, keys: string[]) => {
  if (!storage) return undefined;
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value !== null) return value;
  }
  return undefined;
};

const readImportMetaEnv = (): FeatureFlagSource => {
  try {
    return (import.meta as any)?.env || {};
  } catch {
    return {};
  }
};

export function resolveFeatureFlag(
  key: string,
  options: {
    defaultValue?: boolean;
    overrides?: FeatureFlagSource;
    env?: FeatureFlagSource;
    storage?: Storage | null;
  } = {}
): boolean {
  const defaultValue = options.defaultValue ?? false;
  const normalizedKey = key.trim().toLowerCase();
  const envKey = `VITE_FEATURE_${normalizedKey.toUpperCase()}`;
  const serverEnvKey = `FEATURE_${normalizedKey.toUpperCase()}`;
  const keys = [normalizedKey, envKey, serverEnvKey];

  const overrideValue = readSourceValue(options.overrides, keys);
  if (overrideValue !== undefined) return normalizeFeatureFlagValue(overrideValue, defaultValue);

  const storageValue = readStorageValue(
    options.storage ?? (typeof window !== 'undefined' ? window.localStorage : null),
    [`verto.feature.${normalizedKey}`, `feature.${normalizedKey}`, normalizedKey]
  );
  if (storageValue !== undefined) return normalizeFeatureFlagValue(storageValue, defaultValue);

  const envValue = readSourceValue(options.env ?? readImportMetaEnv(), keys);
  if (envValue !== undefined) return normalizeFeatureFlagValue(envValue, defaultValue);

  return defaultValue;
}

export const isAbaV2Enabled = (options: Parameters<typeof resolveFeatureFlag>[1] = {}) => (
  resolveFeatureFlag('aba_v2', { defaultValue: true, ...options })
);
