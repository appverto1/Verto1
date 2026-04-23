import {
  ROLE_CAPABILITY_SECTIONS,
  type RoleCapabilityStatus,
  type VertoRole,
} from '../constants/roleCapabilities';

export type ClinicalRole = 'coordinator' | 'receptionist' | 'therapist';
export type CapabilityKey = string;

export const CAPABILITY_TO_ROUTE: Record<string, string> = {
  'agenda-multi-view': 'agenda',
  'patient-intake': 'patient-intake',
  'medical-records': 'medical-records',
  anamnesis: 'anamnesis',
  'protocol-library': 'protocol-library',
  rooms: 'rooms',
};

const CLINICAL_ROLES: ClinicalRole[] = ['coordinator', 'receptionist', 'therapist'];

export function isClinicalRole(role: VertoRole | string): role is ClinicalRole {
  return CLINICAL_ROLES.includes(role as ClinicalRole);
}

export function getCapabilityStatus(role: ClinicalRole, capabilityKey: CapabilityKey): RoleCapabilityStatus {
  const item = ROLE_CAPABILITY_SECTIONS.flatMap((section) => section.items).find(
    (capability) => capability.key === capabilityKey,
  );
  if (!item) return 'none';
  return item[role] ?? 'none';
}

export function hasCapability(role: ClinicalRole, capabilityKey: CapabilityKey): boolean {
  return getCapabilityStatus(role, capabilityKey) !== 'none';
}

export function getAllowedRoutesByRole(role: ClinicalRole): string[] {
  const routes = new Set<string>(['home', 'profile']);

  ROLE_CAPABILITY_SECTIONS.forEach((section) => {
    section.items.forEach((item) => {
      if (item[role] === 'none') return;
      const route = CAPABILITY_TO_ROUTE[item.key];
      if (route) routes.add(route);
    });
  });

  return Array.from(routes);
}

export function isClinicalMfaEnabled(user: any): boolean {
  return Boolean(
    user?.two_factor_enabled ||
      user?.twoFactorEnabled ||
      user?.mfa_enabled ||
      user?.mfaEnabled,
  );
}

