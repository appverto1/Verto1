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
} | null;

type PatientClinicalAccessProfile = {
  user_id?: unknown;
  specialty?: unknown;
} | null;

const cleanText = (value: unknown) => String(value ?? '').trim();

export function evaluatePatientClinicalAccess(params: {
  actorId: unknown;
  actorRole: unknown;
  actorClinicId: unknown;
  hasGlobalAccess?: boolean;
  patientId: unknown;
  patientClinicId: unknown;
  legacyTherapistId?: unknown;
  activeProfessionalLink?: PatientClinicalAccessLink;
  activeProfessionalMembership?: PatientClinicalAccessMembership;
  activeProfessionalProfile?: PatientClinicalAccessProfile;
  activeManagerMembership?: PatientClinicalAccessMembership;
  requiredPermission: PatientClinicalPermission;
}): boolean {
  if (params.hasGlobalAccess === true) return true;

  const actorId = cleanText(params.actorId);
  const actorRole = cleanText(params.actorRole).toLowerCase();
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

  const managerMembership = params.activeManagerMembership;
  if (
    managerMembership &&
    cleanText(managerMembership.user_id) === actorId &&
    cleanText(managerMembership.clinic_id) === patientClinicId &&
    cleanText(managerMembership.role).toLowerCase() === 'coordinator' &&
    cleanText(managerMembership.status).toLowerCase() === 'active'
  ) {
    return true;
  }

  const link = params.activeProfessionalLink;
  if (!link) {
    const membership = params.activeProfessionalMembership;
    const profile = params.activeProfessionalProfile;
    return Boolean(
      actorRole === 'therapist' &&
      cleanText(params.legacyTherapistId) === actorId &&
      membership &&
      profile &&
      cleanText(membership.user_id) === actorId &&
      cleanText(membership.clinic_id) === patientClinicId &&
      cleanText(membership.role).toLowerCase() === 'therapist' &&
      cleanText(membership.status).toLowerCase() === 'active' &&
      cleanText(profile.user_id) === actorId &&
      cleanText(profile.specialty).length >= 2
    );
  }

  const membership = params.activeProfessionalMembership;
  const profile = params.activeProfessionalProfile;
  return Boolean(
    membership &&
      profile &&
      cleanText(membership.user_id) === actorId &&
      cleanText(membership.clinic_id) === patientClinicId &&
      cleanText(membership.role).toLowerCase() === 'therapist' &&
      cleanText(membership.status).toLowerCase() === 'active' &&
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
