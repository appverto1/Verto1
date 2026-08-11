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
  const globalRole = normalizeClinicAuthorityRole(input.globalRole);

  // Owner e admin vêm do papel global persistido. O papel da sessão pode ser o
  // papel da workspace selecionada e não deve esconder essa autoridade.
  if (globalRole === 'owner' || globalRole === 'admin') {
    return globalRole;
  }

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

  // Platform legacy roles are kept only for backward-compatible administration.
  if (actorRole === 'owner' || actorRole === 'admin') return true;

  // Directors may manage every clinic-scoped role, including another director,
  // but only after the active-clinic membership check performed by the server.
  if (actorRole === 'director') return true;

  // Coordinators manage operational roles inside their own clinic, but cannot
  // create or promote a director.
  if (actorRole === 'coordinator') {
    return targetRole !== 'director';
  }

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

  if (actorRole === 'owner' || actorRole === 'admin' || actorRole === 'director') {
    return true;
  }

  if (actorRole === 'coordinator') {
    return targetCurrentRole !== 'director';
  }

  return false;
}
