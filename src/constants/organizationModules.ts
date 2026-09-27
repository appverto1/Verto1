import type { CapabilityKey } from './authorizationModel';

export const ORGANIZATION_MODULE_KEYS = [
  'clinical_core',
  'appointments_communication',
  'financial_management',
  'insurance_tiss',
  'school_management',
] as const;

export type OrganizationModuleKey = (typeof ORGANIZATION_MODULE_KEYS)[number];
export type OrganizationModuleAccessMode = 'legacy_full' | 'contract';
export type OrganizationModuleEntitlementStatus = 'active' | 'trial' | 'grace' | 'suspended' | 'cancelled';

export const ACTIVE_ORGANIZATION_MODULE_STATUSES = new Set<OrganizationModuleEntitlementStatus>([
  'active',
  'trial',
  'grace',
]);

const CAPABILITY_PREFIX_MODULES: readonly [string, OrganizationModuleKey][] = [
  ['clinical.', 'clinical_core'],
  ['treatment_plan.', 'clinical_core'],
  ['treatment_goal.', 'clinical_core'],
  ['aba.', 'clinical_core'],
  ['calendar.', 'appointments_communication'],
  ['communication.', 'appointments_communication'],
  ['finance.', 'financial_management'],
  ['billing.', 'insurance_tiss'],
  ['school.', 'school_management'],
];

const MODULE_AGNOSTIC_CAPABILITIES = new Set<CapabilityKey>([
  'communication.billing_updates.view',
  'communication.billing_updates.write',
  'communication.billing_updates.manage',
]);

const CAPABILITY_MODULE_OVERRIDES: Partial<Record<CapabilityKey, OrganizationModuleKey>> = {
  'clinic.rooms.manage': 'appointments_communication',
  'session.start': 'clinical_core',
  'session.finish': 'clinical_core',
  'session.data.write': 'clinical_core',
  'session.history.view': 'clinical_core',
  'session.closed.edit_own': 'clinical_core',
  'session.no_show.classify': 'appointments_communication',
  'session.billing_evidence.generate': 'insurance_tiss',
  'patient.files.view': 'clinical_core',
  'patient.files.upload': 'clinical_core',
  'patient.files.archive': 'clinical_core',
  'documents.patient_share': 'clinical_core',
  'reports.clinical.indicators': 'clinical_core',
  'reports.appointments.view': 'appointments_communication',
  'reports.billing.view': 'insurance_tiss',
  'patient.insurance.view': 'insurance_tiss',
  'patient.insurance.create': 'insurance_tiss',
  'patient.insurance.edit': 'insurance_tiss',
  'patient.insurance.card.view': 'insurance_tiss',
  'patient.insurance.authorization.view': 'insurance_tiss',
  'patient.insurance.authorization.edit': 'insurance_tiss',
  'patient.insurance.eligibility.view': 'insurance_tiss',
  'portal.appointments.view': 'appointments_communication',
  'portal.attendance.confirm': 'appointments_communication',
  'portal.reschedule.request': 'appointments_communication',
  'portal.cancel.request': 'appointments_communication',
  'portal.notifications.view': 'appointments_communication',
  'portal.notification_preferences.manage': 'appointments_communication',
  'portal.appointment_volume.view': 'appointments_communication',
};

export const ORGANIZATION_MODULE_REGISTRY: Readonly<Record<OrganizationModuleKey, {
  label: string;
  commercialItemKey: OrganizationModuleKey;
}>> = {
  clinical_core: { label: 'Verto Clínica / ABA', commercialItemKey: 'clinical_core' },
  appointments_communication: { label: 'Agenda e Comunicação', commercialItemKey: 'appointments_communication' },
  financial_management: { label: 'Financeiro e Gestão', commercialItemKey: 'financial_management' },
  insurance_tiss: { label: 'Convênios e TISS', commercialItemKey: 'insurance_tiss' },
  school_management: { label: 'Gestão Escolar e Institucional', commercialItemKey: 'school_management' },
};

export function isOrganizationModuleKey(value: unknown): value is OrganizationModuleKey {
  return ORGANIZATION_MODULE_KEYS.includes(String(value || '').trim() as OrganizationModuleKey);
}

export function requiredModuleForCapability(capability: CapabilityKey): OrganizationModuleKey | null {
  if (MODULE_AGNOSTIC_CAPABILITIES.has(capability)) return null;
  const exact = CAPABILITY_MODULE_OVERRIDES[capability];
  if (exact) return exact;
  const value = String(capability || '');
  for (const [prefix, moduleKey] of CAPABILITY_PREFIX_MODULES) {
    if (value.startsWith(prefix)) return moduleKey;
  }
  return null;
}

export function moduleAllowsCapability(
  mode: OrganizationModuleAccessMode,
  modules: ReadonlySet<OrganizationModuleKey>,
  capability: CapabilityKey,
): boolean {
  if (mode === 'legacy_full') return true;
  const required = requiredModuleForCapability(capability);
  return !required || hasOrganizationModule(mode, modules, required);
}

export function filterCapabilitiesByOrganizationModules(
  capabilities: ReadonlySet<CapabilityKey>,
  mode: OrganizationModuleAccessMode,
  modules: ReadonlySet<OrganizationModuleKey>,
): ReadonlySet<CapabilityKey> {
  if (mode === 'legacy_full') return capabilities;
  return new Set(Array.from(capabilities).filter((capability) => moduleAllowsCapability(mode, modules, capability)));
}

export function hasOrganizationModule(
  mode: OrganizationModuleAccessMode,
  modules: ReadonlySet<OrganizationModuleKey>,
  moduleKey: OrganizationModuleKey,
): boolean {
  // Verto Clínica is the mandatory platform baseline: patient registration,
  // clinical record/patient dashboard and the clinical patient portal must never
  // disappear because an optional commercial entitlement is absent or stale.
  if (moduleKey === 'clinical_core') return true;
  return mode === 'legacy_full' || modules.has(moduleKey);
}