import {
  ACTIVE_ORGANIZATION_MODULE_STATUSES,
  ORGANIZATION_MODULE_KEYS,
  requiredModuleForCapability,
  type OrganizationModuleAccessMode,
  type OrganizationModuleEntitlementStatus,
  type OrganizationModuleKey,
} from '../constants/organizationModules';

export const MODULE_PURCHASE_ELIGIBILITY_STATES = [
  'eligible',
  'already_entitled',
  'permission_only',
  'billing_recovery',
  'cancelled_reactivation',
  'legacy_full_not_sellable',
  'baseline_not_sellable',
  'demo_forbidden',
  'no_direct_price',
  'not_commercially_available',
] as const;

export type ModulePurchaseEligibilityState = (typeof MODULE_PURCHASE_ELIGIBILITY_STATES)[number];

export type ModulePurchaseEligibilityInput = {
  moduleKey: OrganizationModuleKey;
  accessMode: OrganizationModuleAccessMode;
  entitlementStatus: OrganizationModuleEntitlementStatus | null;
  actorCapabilities: Iterable<string>;
  isDemo: boolean;
  directOfferAvailable: boolean;
  commerciallyAvailable?: boolean;
};

export type ModulePurchaseEligibility = {
  moduleKey: OrganizationModuleKey;
  state: ModulePurchaseEligibilityState;
  canPurchase: boolean;
  alreadyEntitled: boolean;
  hasUseCapability: boolean;
};

const hasCapabilityForModule = (
  moduleKey: OrganizationModuleKey,
  capabilities: Iterable<string>,
) => {
  for (const rawCapability of capabilities) {
    const capability = String(rawCapability || '').trim() as any;
    if (capability && requiredModuleForCapability(capability) === moduleKey) return true;
  }
  return false;
};

export function resolveModulePurchaseEligibility(
  input: ModulePurchaseEligibilityInput,
): ModulePurchaseEligibility {
  const hasUseCapability = hasCapabilityForModule(input.moduleKey, input.actorCapabilities);
  const entitlementStatus = input.entitlementStatus;

  if (input.moduleKey === 'clinical_core') {
    return {
      moduleKey: input.moduleKey,
      state: 'baseline_not_sellable',
      canPurchase: false,
      alreadyEntitled: true,
      hasUseCapability,
    };
  }

  if (input.accessMode === 'legacy_full') {
    return {
      moduleKey: input.moduleKey,
      state: 'legacy_full_not_sellable',
      canPurchase: false,
      alreadyEntitled: true,
      hasUseCapability,
    };
  }

  if (entitlementStatus && ACTIVE_ORGANIZATION_MODULE_STATUSES.has(entitlementStatus)) {
    return {
      moduleKey: input.moduleKey,
      state: hasUseCapability ? 'already_entitled' : 'permission_only',
      canPurchase: false,
      alreadyEntitled: true,
      hasUseCapability,
    };
  }

  if (entitlementStatus === 'suspended') {
    return {
      moduleKey: input.moduleKey,
      state: 'billing_recovery',
      canPurchase: false,
      alreadyEntitled: false,
      hasUseCapability,
    };
  }

  if (entitlementStatus === 'cancelled') {
    return {
      moduleKey: input.moduleKey,
      state: 'cancelled_reactivation',
      canPurchase: false,
      alreadyEntitled: false,
      hasUseCapability,
    };
  }

  if (input.isDemo) {
    return {
      moduleKey: input.moduleKey,
      state: 'demo_forbidden',
      canPurchase: false,
      alreadyEntitled: false,
      hasUseCapability,
    };
  }

  if (input.commerciallyAvailable === false) {
    return {
      moduleKey: input.moduleKey,
      state: 'not_commercially_available',
      canPurchase: false,
      alreadyEntitled: false,
      hasUseCapability,
    };
  }

  if (!input.directOfferAvailable) {
    return {
      moduleKey: input.moduleKey,
      state: 'no_direct_price',
      canPurchase: false,
      alreadyEntitled: false,
      hasUseCapability,
    };
  }

  return {
    moduleKey: input.moduleKey,
    state: 'eligible',
    canPurchase: true,
    alreadyEntitled: false,
    hasUseCapability,
  };
}

export function isOrganizationModulePurchaseKey(value: unknown): value is OrganizationModuleKey {
  return ORGANIZATION_MODULE_KEYS.includes(String(value || '').trim() as OrganizationModuleKey);
}
