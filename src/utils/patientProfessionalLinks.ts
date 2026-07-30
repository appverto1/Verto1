export const PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS = [
  { value: 'case_coordinator', label: 'Coordenação do caso' },
  { value: 'primary_therapist', label: 'Terapeuta principal' },
  { value: 'therapist', label: 'Terapeuta' },
  { value: 'supervisor', label: 'Supervisão' },
  { value: 'consultant', label: 'Consultoria' }
] as const;

export type PatientProfessionalCaseRole =
  (typeof PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS)[number]['value'];

export type PatientProfessionalLinkIntegrityStatus =
  | 'membership_inactive'
  | 'professional_missing'
  | 'profile_missing'
  | 'tenant_mismatch';

export type PatientProfessionalCandidateValidation =
  | {
      ok: true;
      specialty: string;
    }
  | {
      ok: false;
      error:
        | 'PATIENT_PROFESSIONAL_NOT_FOUND'
        | 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE'
        | 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED'
        | 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED';
    };

const cleanText = (value: unknown) => String(value ?? '').trim();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPatientProfessionalCaseRole(
  value: unknown
): value is PatientProfessionalCaseRole {
  const normalized = cleanText(value);
  return PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS.some(
    (option) => option.value === normalized
  );
}

export function patientProfessionalCaseRoleLabel(value: unknown): string {
  const normalized = cleanText(value);
  return (
    PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS.find(
      (option) => option.value === normalized
    )?.label ||
    normalized ||
    'Função não informada'
  );
}

export function resolveProfessionalProfileSpecialty(profile: any): string {
  return cleanText(profile?.specialty);
}

export function validatePatientProfessionalCandidate(params: {
  clinicId: unknown;
  professionalId: unknown;
  user?: any;
  membership?: any;
  profile?: any;
}): PatientProfessionalCandidateValidation {
  const clinicId = cleanText(params.clinicId);
  const professionalId = cleanText(params.professionalId);
  if (!params.user || cleanText(params.user?.id) !== professionalId) {
    return { ok: false, error: 'PATIENT_PROFESSIONAL_NOT_FOUND' };
  }
  if (
    !params.membership ||
    cleanText(params.membership?.user_id) !== professionalId ||
    cleanText(params.membership?.clinic_id) !== clinicId ||
    cleanText(params.membership?.role).toLowerCase() !== 'therapist' ||
    cleanText(params.membership?.status).toLowerCase() !== 'active'
  ) {
    return {
      ok: false,
      error: 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE'
    };
  }
  if (
    !params.profile ||
    cleanText(params.profile?.user_id) !== professionalId
  ) {
    return { ok: false, error: 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED' };
  }
  const specialty = resolveProfessionalProfileSpecialty(params.profile);
  if (specialty.length < 2) {
    return {
      ok: false,
      error: 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED'
    };
  }
  return { ok: true, specialty };
}

export function resolvePatientProfessionalLinkIntegrity(params: {
  clinicId: unknown;
  professionalId: unknown;
  link?: any;
  user?: any;
  profile?: any;
  membership?: any;
}): PatientProfessionalLinkIntegrityStatus | null {
  const clinicId = cleanText(params.clinicId);
  const professionalId = cleanText(params.professionalId);
  if (
    params.link &&
    (
      cleanText(params.link?.organization_id) !== clinicId ||
      cleanText(params.link?.clinic_id) !== clinicId
    )
  ) {
    return 'tenant_mismatch';
  }
  if (!params.user || cleanText(params.user?.id) !== professionalId) {
    return 'professional_missing';
  }
  if (
    params.membership &&
    (
      cleanText(params.membership?.clinic_id) !== clinicId ||
      cleanText(params.membership?.user_id) !== professionalId
    )
  ) {
    return 'tenant_mismatch';
  }
  if (
    !params.membership ||
    cleanText(params.membership?.status).toLowerCase() !== 'active' ||
    cleanText(params.membership?.role).toLowerCase() !== 'therapist'
  ) {
    return 'membership_inactive';
  }
  if (
    !params.profile ||
    cleanText(params.profile?.user_id) !== professionalId ||
    resolveProfessionalProfileSpecialty(params.profile).length < 2
  ) {
    return 'profile_missing';
  }
  return null;
}

export function isPatientProfessionalLinkManager(params: {
  actorId: unknown;
  actorRole: unknown;
  clinicId: unknown;
  membership?: any;
}): boolean {
  const actorId = cleanText(params.actorId);
  const actorRole = cleanText(params.actorRole).toLowerCase();
  const clinicId = cleanText(params.clinicId);
  if (!actorId || !clinicId) return false;
  if (actorRole === 'owner' || actorRole === 'admin') return true;
  return Boolean(
    cleanText(params.membership?.user_id) === actorId &&
      cleanText(params.membership?.clinic_id) === clinicId &&
      cleanText(params.membership?.role).toLowerCase() === 'coordinator' &&
      cleanText(params.membership?.status).toLowerCase() === 'active'
  );
}

export function isEligiblePatientProfessionalLinkCandidate(
  professional: any,
  activeProfessionalIds: ReadonlySet<string> | readonly string[] = []
): boolean {
  const professionalId = cleanText(professional?.id);
  const activeIds = new Set(
    Array.from(activeProfessionalIds, (value) => cleanText(value))
  );
  return Boolean(
    UUID_PATTERN.test(professionalId) &&
      cleanText(professional?.role).toLowerCase() === 'therapist' &&
      cleanText(professional?.status).toLowerCase() === 'active' &&
      resolveProfessionalProfileSpecialty(professional).length >= 2 &&
      !activeIds.has(professionalId)
  );
}

export async function executeAuthorizedPatientProfessionalLinkEnd<T>(params: {
  isManager: boolean;
  persist: () => Promise<T>;
}): Promise<
  | { ok: false; status: 403; error: 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED' }
  | { ok: true; status: 200; result: T }
> {
  if (!params.isManager) {
    return {
      ok: false,
      status: 403,
      error: 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED'
    };
  }
  return {
    ok: true,
    status: 200,
    result: await params.persist()
  };
}

export function composePatientProfessionalLinks(params: {
  clinicId: string;
  links: any[];
  users: any[];
  profiles: any[];
  memberships: any[];
}) {
  const clinicId = cleanText(params.clinicId);
  const usersById = new Map(
    (Array.isArray(params.users) ? params.users : [])
      .filter((user) => cleanText(user?.id))
      .map((user) => [cleanText(user.id), user])
  );
  const profilesByUserId = new Map(
    (Array.isArray(params.profiles) ? params.profiles : [])
      .filter((profile) => cleanText(profile?.user_id))
      .map((profile) => [cleanText(profile.user_id), profile])
  );
  const membershipsByUserId = new Map(
    (Array.isArray(params.memberships) ? params.memberships : [])
      .filter((membership) => cleanText(membership?.user_id))
      .map((membership) => [cleanText(membership.user_id), membership])
  );

  const links = (Array.isArray(params.links) ? params.links : []).map(
    (link) => {
      const professionalId = cleanText(link?.professional_id);
      const status = cleanText(link?.status).toLowerCase();
      const user = usersById.get(professionalId) || null;
      const profile = profilesByUserId.get(professionalId) || null;
      const membership = membershipsByUserId.get(professionalId) || null;
      const profileSpecialty = resolveProfessionalProfileSpecialty(profile);
      const snapshotSpecialty = cleanText(link?.specialty);
      const membershipBelongsToClinic =
        Boolean(membership) &&
        cleanText(membership?.clinic_id) === clinicId &&
        cleanText(membership?.user_id) === professionalId;
      const specialty =
        snapshotSpecialty ||
        (membershipBelongsToClinic ? profileSpecialty : '');
      const resolvedIntegrity = resolvePatientProfessionalLinkIntegrity({
        clinicId,
        professionalId,
        link,
        user,
        profile,
        membership
      });
      const integrityStatus = status === 'active' ? resolvedIntegrity : null;
      const professional =
        user && membershipBelongsToClinic
          ? {
              id: user.id,
              name: user.name ?? null,
              email: user.email ?? null,
              role: membership?.role ?? null,
              status: membership?.status ?? null,
              specialty: profileSpecialty || snapshotSpecialty || null,
              council: profile?.council ?? null,
              council_number: profile?.council_number ?? null,
              membershipActive:
                cleanText(membership?.status).toLowerCase() === 'active',
              profileAvailable: Boolean(profile),
              availableForNewLink: resolvedIntegrity === null
            }
          : null;

      return {
        ...link,
        specialty,
        professional,
        integrityStatus,
        accessEnabled: status === 'active' && integrityStatus === null,
        canBeEnded: status === 'active'
      };
    }
  );

  return {
    links,
    activeCount: links.filter(
      (link) => cleanText(link?.status).toLowerCase() === 'active'
    ).length,
    activeLimit: 5
  };
}
