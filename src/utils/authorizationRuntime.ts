import {
  SUPERVISION_CAPABILITY_OVERLAY,
  getDefaultCapabilitiesForRole,
  isCapabilityKey,
  isClinicBaseRole,
  isDelegableCapability,
  roleHasDefaultCapability,
  type CapabilityKey,
  type ClinicBaseRole,
} from '../constants/authorizationModel';
import { canManageClinicRole } from './clinicMembershipAuthority';

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
  options: { canSupervise?: boolean } = {},
): EffectiveClinicCapabilities | null {
  const normalizedRole = String(roleInput ?? '').trim().toLowerCase();
  if (!isClinicBaseRole(normalizedRole)) return null;

  const role = normalizedRole as ClinicBaseRole;
  const capabilities = new Set<CapabilityKey>(getDefaultCapabilitiesForRole(role));
  if (role === 'therapist' && options.canSupervise === true) {
    SUPERVISION_CAPABILITY_OVERLAY.forEach((capability) => capabilities.add(capability));
  }
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

    if (
      effect === 'allow'
      && (
        roleHasDefaultCapability(role, permissionKey)
        || isAdditionalCapabilityCompatibleWithRoleScope(role, permissionKey)
      )
    ) {
      capabilities.add(permissionKey);
    }
    if (effect === 'deny') capabilities.delete(permissionKey);
    appliedOverrides.push({ permissionKey, effect });
  }

  // Invitation authority is structural: Directors may invite supported clinic
  // roles and Coordinators may invite professionals in their own active unit.
  // Narrower roles cannot regain invitation authority through stale overrides.
  if (role !== 'director' && role !== 'coordinator') {
    capabilities.delete('team.invite');
  }
  if (role !== 'director') {
    capabilities.delete('workspace.multiclinic.analytics');
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



/**
 * Structural ceiling for NEW grants on roles whose resource scope is narrower
 * than the whole active clinic. Denies/resets remain possible so an unsafe
 * historical override can always be removed.
 *
 * This does not replace resource authorization. It prevents a checkbox grant
 * from turning a case-scoped or billing-scoped role into a clinic-wide role
 * while broad-list endpoints are still being migrated to scope-aware reads.
 */
export function isAdditionalCapabilityCompatibleWithRoleScope(
  roleInput: unknown,
  capabilityInput: unknown,
): boolean {
  const role = String(roleInput ?? '').trim().toLowerCase();
  const capability = String(capabilityInput ?? '').trim();
  if (!isClinicBaseRole(role) || !isCapabilityKey(capability)) return false;

  if (roleHasDefaultCapability(role, capability)) return true;

  // Clinic managers can receive additional clinic-scoped capabilities.
  if (role === 'director' || role === 'coordinator') {
    return true;
  }

  // Reception remains operational/administrative. Explicit grants may extend
  // administrative workflows, but never into clinical records or payer/TISS
  // data merely because the actor has ACTIVE_CLINIC scope.
  if (role === 'receptionist') {
    return (
      [
        'patient.list',
        'patient.create',
        'patient.demographics.view',
        'patient.demographics.edit',
        'patient.contacts.view',
        'patient.birthdays.view',
        'patient.documents.registration.view',
      ].includes(capability)
      || capability.startsWith('calendar.')
      || capability.startsWith('finance.')
      || capability.startsWith('communication.')
      || capability === 'documents.patient_share'
    );
  }

  // Case-scoped roles may only receive capabilities whose resources are
  // patient/case/own-resource scoped. Finance, TISS, team administration,
  // clinic settings and multiclinic access cannot be introduced by override.
  if (role === 'supervisor' || role === 'therapist') {
    return (
      capability.startsWith('patient.') ||
      capability.startsWith('clinical.') ||
      capability.startsWith('treatment_plan.') ||
      capability.startsWith('treatment_goal.') ||
      capability.startsWith('aba.') ||
      capability.startsWith('school.') ||
      capability.startsWith('session.') ||
      capability.startsWith('patient.files.') ||
      capability === 'documents.patient_share'
    );
  }

  // Billing scope never expands into clinical, clinic administration or the
  // general finance ledger through an individual checkbox.
  if (role === 'biller') {
    return capability.startsWith('billing.') || capability.startsWith('patient.insurance.');
  }

  return false;
}

export function canDelegateClinicCapability(params: {
  actorRole: unknown;
  targetRole: unknown;
  actorUserId: unknown;
  targetUserId: unknown;
  capability: unknown;
  actorCapabilities: ReadonlySet<CapabilityKey>;
  requestedEffect?: CapabilityOverrideEffect | null;
}): boolean {
  const actorRole = String(params.actorRole ?? '').trim().toLowerCase();
  const targetRole = String(params.targetRole ?? '').trim().toLowerCase();
  const actorUserId = String(params.actorUserId ?? '').trim();
  const targetUserId = String(params.targetUserId ?? '').trim();
  const capability = String(params.capability ?? '').trim();

  if (!actorUserId || !targetUserId || actorUserId === targetUserId) return false;
  if (!isClinicBaseRole(actorRole) || !isClinicBaseRole(targetRole)) return false;
  if (!isCapabilityKey(capability) || !isDelegableCapability(capability)) return false;
  if (!canManageClinicRole(actorRole, targetRole)) return false;
  if (!params.actorCapabilities.has(capability)) return false;
  if (
    params.requestedEffect === 'allow' &&
    !roleHasDefaultCapability(targetRole, capability) &&
    !isAdditionalCapabilityCompatibleWithRoleScope(targetRole, capability)
  ) {
    return false;
  }
  return true;
}
