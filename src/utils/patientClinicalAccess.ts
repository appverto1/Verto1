export type PatientClinicalPermission = 'read' | 'write';

type PatientClinicalAccessLink = {
  organization_id?: unknown;
  clinic_id?: unknown;
  patient_id?: unknown;
  professional_id?: unknown;
  status?: unknown;
  permissions?: Record<string, unknown> | null;
} | null;

type PatientClinicalAccessMembership = {
  user_id?: unknown;
  clinic_id?: unknown;
  role?: unknown;
  status?: unknown;
  can_supervise?: unknown;
} | null;

type PatientClinicalAccessProfile = {
  user_id?: unknown;
  specialty?: unknown;
} | null;

type PatientClinicalSupervisionLink = {
  clinic_id?: unknown;
  supervisor_user_id?: unknown;
  supervised_user_id?: unknown;
  patient_id?: unknown;
  status?: unknown;
} | null;

const cleanText = (value: unknown) => String(value ?? '').trim();

const isActiveMembershipFor = (
  membership: PatientClinicalAccessMembership,
  actorId: string,
  clinicId: string,
  allowedRoles: readonly string[],
): boolean => Boolean(
  membership
  && cleanText(membership.user_id) === actorId
  && cleanText(membership.clinic_id) === clinicId
  && allowedRoles.includes(cleanText(membership.role).toLowerCase())
  && cleanText(membership.status).toLowerCase() === 'active'
);

/**
 * Evaluates only the patient/case scope dimension for clinical data.
 *
 * Platform administration never grants an implicit clinical bypass here.
 * Route-level capability checks remain responsible for deciding whether the
 * action itself (read/write/approve/etc.) is permitted for the actor role.
 */
export function evaluatePatientClinicalAccess(params: {
  actorId: unknown;
  actorRole: unknown;
  actorClinicId: unknown;
  patientId: unknown;
  patientClinicId: unknown;
  legacyTherapistId?: unknown;
  activeProfessionalLink?: PatientClinicalAccessLink;
  activeProfessionalMembership?: PatientClinicalAccessMembership;
  activeProfessionalProfile?: PatientClinicalAccessProfile;
  activeManagerMembership?: PatientClinicalAccessMembership;
  activeSupervisionLink?: PatientClinicalSupervisionLink;
  requiredPermission: PatientClinicalPermission;
}): boolean {
  const actorId = cleanText(params.actorId);
  const actorClinicId = cleanText(params.actorClinicId);
  const patientId = cleanText(params.patientId);
  const patientClinicId = cleanText(params.patientClinicId);
  if (
    !actorId ||
    !actorClinicId ||
    !patientId ||
    !patientClinicId ||
    actorClinicId !== patientClinicId
  ) {
    return false;
  }

  // Clinic managers receive clinic-wide clinical scope only from an active
  // membership in the exact patient clinic. Legacy/global roles do not count.
  if (
    isActiveMembershipFor(
      params.activeManagerMembership,
      actorId,
      patientClinicId,
      ['director', 'coordinator'],
    )
  ) {
    return true;
  }

  // Supervision is a contextual capability of a professional. The legacy
  // supervisor role remains accepted only so older memberships do not lose
  // access before they are migrated.
  const professionalMembershipRole = cleanText(
    params.activeProfessionalMembership?.role,
  ).toLowerCase();
  const canSupervise =
    professionalMembershipRole === 'supervisor'
    || (
      professionalMembershipRole === 'therapist'
      && params.activeProfessionalMembership?.can_supervise === true
    );
  if (
    isActiveMembershipFor(
      params.activeProfessionalMembership,
      actorId,
      patientClinicId,
      ['supervisor', 'therapist'],
    )
    && canSupervise
  ) {
    const supervision = params.activeSupervisionLink;
    if (
      supervision
      && cleanText(supervision.clinic_id) === patientClinicId
      && cleanText(supervision.supervisor_user_id) === actorId
      && cleanText(supervision.status).toLowerCase() === 'active'
      && (
        cleanText(supervision.patient_id) === patientId
        || cleanText(supervision.supervised_user_id).length > 0
      )
    ) {
      return true;
    }
  }

  const link = params.activeProfessionalLink;
  if (!link) {
    // patient_professional_links is the canonical case-team relation.
    // Legacy patients.therapist_id never grants production access by itself.
    return false;
  }

  const membership = params.activeProfessionalMembership;
  const profile = params.activeProfessionalProfile;
  return Boolean(
    isActiveMembershipFor(membership, actorId, patientClinicId, ['therapist', 'supervisor']) &&
      profile &&
      cleanText(profile.user_id) === actorId &&
      cleanText(profile.specialty).length >= 2 &&
      cleanText(link.organization_id) === patientClinicId &&
      cleanText(link.clinic_id) === patientClinicId &&
      cleanText(link.patient_id) === patientId &&
      cleanText(link.professional_id) === actorId &&
      cleanText(link.status).toLowerCase() === 'active' &&
      link.permissions?.[params.requiredPermission] === true
  );
}

export type HistoryScoreMutationOutcome<T> =
  | {
      ok: false;
      status: 400 | 403;
      error: string;
    }
  | {
      ok: true;
      status: 200;
      score: number;
      result: T;
    };

export async function executeAuthorizedHistoryScoreMutation<T>(params: {
  hasWriteAccess: boolean;
  recordType: unknown;
  requestedScore: unknown;
  persist: (score: number) => Promise<T>;
}): Promise<HistoryScoreMutationOutcome<T>> {
  if (!params.hasWriteAccess) {
    return {
      ok: false,
      status: 403,
      error: 'Acesso negado.'
    };
  }

  const score = Number(params.requestedScore);
  const recordType = cleanText(params.recordType).toLowerCase();
  const isFamilyStar = recordType === 'family_note' || recordType === 'photo';
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    (isFamilyStar && score !== 0 && score !== 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: isFamilyStar
        ? 'A estrelinha deve ser informada como 0 ou 1.'
        : 'A pontuação deve estar entre 0 e 100.'
    };
  }

  return {
    ok: true,
    status: 200,
    score,
    result: await params.persist(score)
  };
}
