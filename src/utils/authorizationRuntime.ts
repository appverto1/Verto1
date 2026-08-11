import {
  getDefaultCapabilitiesForRole,
  isCapabilityKey,
  isClinicBaseRole,
  type CapabilityKey,
  type ClinicBaseRole,
} from '../constants/authorizationModel';

export type CapabilityOverrideEffect = 'allow' | 'deny';

export type CapabilityOverrideLike = {
  permission_key?: unknown;
  permissionKey?: unknown;
  effect?: unknown;
};

export type EffectiveClinicCapabilities = {
  role: ClinicBaseRole;
  capabilities: ReadonlySet<CapabilityKey>;
  appliedOverrides: ReadonlyArray<{
    permissionKey: CapabilityKey;
    effect: CapabilityOverrideEffect;
  }>;
};

const normalizeEffect = (value: unknown): CapabilityOverrideEffect | null => {
  const effect = String(value ?? '').trim().toLowerCase();
  return effect === 'allow' || effect === 'deny' ? effect : null;
};

/**
 * Computes the effective capability set for one active clinic membership.
 *
 * Runtime authorization must still validate tenant/unit/resource scope. This
 * helper intentionally decides only the capability dimension (P + D - deny).
 * Structural restrictions are enforced separately and always win.
 */
export function resolveEffectiveClinicCapabilities(
  roleInput: unknown,
  overrides: readonly CapabilityOverrideLike[] = [],
): EffectiveClinicCapabilities | null {
  const normalizedRole = String(roleInput ?? '').trim().toLowerCase();
  if (!isClinicBaseRole(normalizedRole)) return null;

  const role = normalizedRole as ClinicBaseRole;
  const capabilities = new Set<CapabilityKey>(getDefaultCapabilitiesForRole(role));
  const appliedOverrides: Array<{
    permissionKey: CapabilityKey;
    effect: CapabilityOverrideEffect;
  }> = [];

  for (const rawOverride of overrides) {
    const permissionKey = String(
      rawOverride?.permission_key ?? rawOverride?.permissionKey ?? '',
    ).trim();
    const effect = normalizeEffect(rawOverride?.effect);
    if (!isCapabilityKey(permissionKey) || !effect) continue;

    if (effect === 'allow') capabilities.add(permissionKey);
    if (effect === 'deny') capabilities.delete(permissionKey);
    appliedOverrides.push({ permissionKey, effect });
  }

  return {
    role,
    capabilities,
    appliedOverrides,
  };
}

export function hasEffectiveClinicCapability(
  roleInput: unknown,
  capabilityInput: unknown,
  overrides: readonly CapabilityOverrideLike[] = [],
): boolean {
  const capability = String(capabilityInput ?? '').trim();
  if (!isCapabilityKey(capability)) return false;
  const resolved = resolveEffectiveClinicCapabilities(roleInput, overrides);
  return resolved?.capabilities.has(capability) === true;
}
