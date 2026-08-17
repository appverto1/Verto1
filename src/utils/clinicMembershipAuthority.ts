export type ClinicAuthorityRole =
  | 'owner'
  | 'admin'
  | 'director'
  | 'coordinator'
  | 'supervisor'
  | 'receptionist'
  | 'therapist'
  | 'biller'
  | 'patient';

type ClinicMembershipAuthorityInput = {
  actorId: unknown;
  clinicId: unknown;
  sessionRole: unknown;
  globalRole?: unknown;
  membership?: {
    user_id?: unknown;
    clinic_id?: unknown;
    role?: unknown;
    status?: unknown;
  } | null;
};

const ALL_AUTHORITY_ROLES = new Set<ClinicAuthorityRole>([
  'owner',
  'admin',
  'director',
  'coordinator',
  'supervisor',
  'receptionist',
  'therapist',
  'biller',
  'patient',
]);

const CLINIC_MEMBERSHIP_ROLES = new Set<ClinicAuthorityRole>([
  'director',
  'coordinator',
  'supervisor',
  'receptionist',
  'therapist',
  'biller',
]);

const cleanText = (value: unknown): string =>
  String(value ?? '').trim();

export function normalizeClinicAuthorityRole(
  value: unknown,
): ClinicAuthorityRole | null {
  const role = cleanText(value).toLowerCase() as ClinicAuthorityRole;
  return ALL_AUTHORITY_ROLES.has(role) ? role : null;
}

export function resolveEffectiveClinicRoleFromMembership(
  input: ClinicMembershipAuthorityInput,
): ClinicAuthorityRole | null {
  // Clinic authority is membership-scoped. Legacy/global owner/admin labels and
  // the session role never substitute an active membership in the selected
  // clinic. Platform administration is validated by a separate authority.
  const actorId = cleanText(input.actorId);
  const clinicId = cleanText(input.clinicId);
  const membership = input.membership;
  const membershipRole = normalizeClinicAuthorityRole(membership?.role);

  if (
    !actorId ||
    !clinicId ||
    cleanText(membership?.user_id) !== actorId ||
    cleanText(membership?.clinic_id) !== clinicId ||
    cleanText(membership?.status).toLowerCase() !== 'active' ||
    !membershipRole ||
    !CLINIC_MEMBERSHIP_ROLES.has(membershipRole)
  ) {
    return null;
  }

  return membershipRole;
}

export function canAssignClinicRole(
  actorRoleInput: unknown,
  targetRoleInput: unknown,
): boolean {
  const actorRole = normalizeClinicAuthorityRole(actorRoleInput);
  const targetRole = normalizeClinicAuthorityRole(targetRoleInput);
  if (!actorRole || !targetRole || !CLINIC_MEMBERSHIP_ROLES.has(targetRole)) {
    return false;
  }

  // Supervisor is no longer an assignable base role. Existing supervisor
  // memberships remain readable for backwards compatibility while new
  // supervision is granted to a professional through can_supervise.
  if (targetRole === 'supervisor') return false;

  // Directors can provision any canonical clinic role. Coordinators have the
  // same team-management authority inside their active unit, but cannot grant
  // the organization-level Director role. Their unit boundary is enforced by
  // the active clinic membership used by the route authorization layer.
  if (actorRole === 'director') return true;
  if (actorRole === 'coordinator') return targetRole !== 'director';

  return false;
}



export function canManageClinicRole(
  actorRoleInput: unknown,
  targetCurrentRoleInput: unknown,
): boolean {
  const actorRole = normalizeClinicAuthorityRole(actorRoleInput);
  const targetCurrentRole = normalizeClinicAuthorityRole(targetCurrentRoleInput);
  if (!actorRole || !targetCurrentRole || !CLINIC_MEMBERSHIP_ROLES.has(targetCurrentRole)) {
    return false;
  }

  if (actorRole === 'director') {
    return true;
  }

  if (actorRole === 'coordinator') {
    return targetCurrentRole !== 'director';
  }

  return false;
}
