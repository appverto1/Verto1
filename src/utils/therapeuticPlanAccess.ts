import { normalizeClinicalSpecialty } from './clinicalSpecialties';
import { buildAppointmentDateTime } from './scheduling';

export type TherapeuticPlanActorContext = {
  actorId: unknown;
  actorRole: unknown;
  professionalLinks?: readonly unknown[];
  supervisionLinks?: readonly unknown[];
};

type TherapeuticPlanPermission = 'read' | 'write';

export type TherapeuticPlanAccessReason =
  | 'clinic_manager'
  | 'shared_pts'
  | 'plan_participant'
  | 'supervisor'
  | 'none';

export type TherapeuticPlanScopeAccess = {
  canRead: boolean;
  canEdit: boolean;
  reason: TherapeuticPlanAccessReason;
};

const cleanText = (value: unknown): string => String(value ?? '').trim();

const ISO_CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const readValue = (source: unknown, ...keys: string[]): unknown => {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] !== 'undefined') return record[key];
  }
  return undefined;
};

const resolveActorRole = (roleOrActor: unknown): string => {
  if (roleOrActor && typeof roleOrActor === 'object') {
    return cleanText(readValue(roleOrActor, 'actorRole', 'role')).toLowerCase();
  }
  return cleanText(roleOrActor).toLowerCase();
};

const resolveScopePatientId = (scope: unknown): string =>
  cleanText(readValue(scope, 'patient_id', 'patientId'));

const resolveScopeClinicId = (scope: unknown): string =>
  cleanText(readValue(scope, 'clinic_id', 'clinicId', 'organization_id', 'organizationId'));

const resolveScopeMode = (scope: unknown): string =>
  cleanText(readValue(scope, 'mode')).toLowerCase();

const resolveProgramScopeId = (program: unknown): string =>
  cleanText(
    readValue(program, 'therapeutic_plan_id', 'therapeuticPlanId', 'plan_id', 'planId')
  );

const resolveProgramResponsibleIds = (program: unknown): string[] => {
  const rawResponsibleIds = readValue(
    program,
    'responsible_professional_ids',
    'responsibleProfessionalIds'
  );
  const responsibleIds = Array.isArray(rawResponsibleIds)
    ? rawResponsibleIds.map(cleanText)
    : [];
  const createdBy = cleanText(readValue(program, 'created_by', 'createdBy'));
  return Array.from(new Set([createdBy, ...responsibleIds].filter(Boolean)));
};

const resolveScopeId = (scope: unknown): string =>
  cleanText(readValue(scope, 'id', 'therapeutic_plan_id', 'therapeuticPlanId'));

const permissionAllows = (
  link: unknown,
  permission: TherapeuticPlanPermission
): boolean => {
  const permissions = readValue(link, 'permissions');
  if (!permissions || typeof permissions !== 'object') return true;
  const value = (permissions as Record<string, unknown>)[permission];
  return value !== false;
};

const linkBelongsToPatient = (
  link: unknown,
  patientId: string
): boolean => {
  if (!patientId) return true;
  const linkPatientId = cleanText(readValue(link, 'patient_id', 'patientId'));
  return !linkPatientId || linkPatientId === patientId;
};

const hasActiveProfessionalLink = (
  professionalLinks: readonly unknown[],
  actorId: string,
  patientId: string,
  permission: TherapeuticPlanPermission
): boolean =>
  professionalLinks.some(
    (link) =>
      cleanText(readValue(link, 'professional_id', 'professionalId')) === actorId &&
      cleanText(readValue(link, 'status')).toLowerCase() === 'active' &&
      linkBelongsToPatient(link, patientId) &&
      permissionAllows(link, permission)
  );

const supervisionBelongsToScope = (
  supervision: unknown,
  scope: unknown,
  actorId: string,
): boolean => {
  if (
    cleanText(readValue(supervision, 'supervisor_user_id', 'supervisorUserId')) !== actorId ||
    cleanText(readValue(supervision, 'status')).toLowerCase() !== 'active'
  ) {
    return false;
  }

  const scopePatientId = resolveScopePatientId(scope);
  const scopeClinicId = resolveScopeClinicId(scope);
  const supervisionPatientId = cleanText(readValue(supervision, 'patient_id', 'patientId'));
  const supervisionClinicId = cleanText(readValue(supervision, 'clinic_id', 'clinicId'));
  if (scopeClinicId && supervisionClinicId && scopeClinicId !== supervisionClinicId) return false;
  // A supervisor's case link must not expand to a different patient's
  // specialty plan merely because the same professional handles both cases.
  if (supervisionPatientId && scopePatientId) {
    return supervisionPatientId === scopePatientId;
  }

  const supervisedUserId = cleanText(
    readValue(supervision, 'supervised_user_id', 'supervisedUserId')
  );
  return Boolean(
    supervisedUserId && getTherapeuticPlanParticipantIds(scope).includes(supervisedUserId)
  );
};

const hasActiveSupervisionAccess = (
  scope: unknown,
  context: TherapeuticPlanActorContext,
): boolean => {
  const actorId = cleanText(context.actorId);
  if (!actorId) return false;
  return (context.supervisionLinks ?? []).some((supervision) =>
    supervisionBelongsToScope(supervision, scope, actorId)
  );
};

/**
 * Clinic-level plan authority. Supervision is deliberately not a manager role:
 * a supervisor receives read access only through an active supervision
 * relationship with this case/professional, never clinic-wide access.
 */
export function isTherapeuticPlanManager(roleOrActor: unknown): boolean {
  return ['owner', 'admin', 'director', 'coordinator'].includes(
    resolveActorRole(roleOrActor)
  );
}

export function getTherapeuticPlanParticipantIds(
  scope: unknown
): string[] {
  const responsibleId = cleanText(
    readValue(
      scope,
      'responsible_professional_id',
      'responsibleProfessionalId'
    )
  );
  const rawParticipants = readValue(
    scope,
    'participant_professional_ids',
    'participantProfessionalIds'
  );
  const participantIds = Array.isArray(rawParticipants)
    ? rawParticipants.map(cleanText)
    : [];

  return Array.from(
    new Set([responsibleId, ...participantIds].filter(Boolean))
  );
}

export function isTherapeuticPlanParticipant(
  scope: unknown,
  actorId: unknown
): boolean {
  const normalizedActorId = cleanText(actorId);
  return Boolean(
    normalizedActorId &&
      getTherapeuticPlanParticipantIds(scope).includes(normalizedActorId)
  );
}

/**
 * ReBAC contract for plan visibility:
 * - PTS/interdisciplinary: every active professional on the patient case may
 *   read it; only explicit participants (or clinic managers) may edit it.
 * - Specialty plan: only explicit participants, their active supervisor, and
 *   clinic managers may read it. Supervisory access is read-only unless the
 *   supervisor is also an explicit participant.
 */
export function resolveTherapeuticPlanScopeAccess(
  scope: unknown,
  context: TherapeuticPlanActorContext,
): TherapeuticPlanScopeAccess {
  if (isTherapeuticPlanManager(context.actorRole)) {
    return { canRead: true, canEdit: true, reason: 'clinic_manager' };
  }

  const actorId = cleanText(context.actorId);
  if (!actorId) return { canRead: false, canEdit: false, reason: 'none' };

  const patientId = resolveScopePatientId(scope);
  const isParticipant = isTherapeuticPlanParticipant(scope, actorId);
  const hasReadLink = hasActiveProfessionalLink(
    context.professionalLinks ?? [],
    actorId,
    patientId,
    'read'
  );
  const hasWriteLink = hasActiveProfessionalLink(
    context.professionalLinks ?? [],
    actorId,
    patientId,
    'write'
  );
  const supervised = hasActiveSupervisionAccess(scope, context);
  const mode = resolveScopeMode(scope);

  if (mode === 'interdisciplinary') {
    if (isParticipant && hasReadLink) {
      return {
        canRead: true,
        canEdit: hasWriteLink,
        reason: 'plan_participant',
      };
    }
    if (hasReadLink) {
      return { canRead: true, canEdit: false, reason: 'shared_pts' };
    }
    if (supervised) {
      return { canRead: true, canEdit: false, reason: 'supervisor' };
    }
    return { canRead: false, canEdit: false, reason: 'none' };
  }

  if (isParticipant && hasReadLink) {
    return {
      canRead: true,
      canEdit: hasWriteLink,
      reason: 'plan_participant',
    };
  }
  if (supervised) {
    return { canRead: true, canEdit: false, reason: 'supervisor' };
  }
  return { canRead: false, canEdit: false, reason: 'none' };
}

export function canEditTherapeuticPlanScope(
  scope: unknown,
  context: TherapeuticPlanActorContext
): boolean {
  return resolveTherapeuticPlanScopeAccess(scope, context).canEdit;
}

export function filterTherapeuticPlanScopesForActor<T>(
  scopes: readonly T[],
  context: TherapeuticPlanActorContext
): T[] {
  return scopes.filter(
    (scope) => resolveTherapeuticPlanScopeAccess(scope, context).canRead
  );
}

export function filterTherapeuticPlanProgramsForActor<TProgram, TScope>(
  programs: readonly TProgram[],
  scopes: readonly TScope[],
  context: TherapeuticPlanActorContext
): TProgram[] {
  if (isTherapeuticPlanManager(context.actorRole)) return [...programs];

  const actorId = cleanText(context.actorId);
  if (!actorId) return [];

  const visibleScopeIds = new Set(
    filterTherapeuticPlanScopesForActor(scopes, context)
      .map(resolveScopeId)
      .filter(Boolean)
  );

  return programs.filter((program) => {
    const scopeId = resolveProgramScopeId(program);
    if (scopeId) return visibleScopeIds.has(scopeId);

    return (
      resolveProgramResponsibleIds(program).includes(actorId) &&
      hasActiveProfessionalLink(
        context.professionalLinks ?? [],
        actorId,
        cleanText(readValue(program, 'patient_id', 'patientId')),
        'read'
      )
    );
  });
}

/**
 * Validates specialty-objective keys without changing their clinical content.
 * The route sanitizes the values separately; this helper prevents a browser
 * from introducing a specialty that is not part of the saved plan.
 */
export function normalizeTherapeuticSpecialtyObjectives(
  value: unknown,
  allowedSpecialties: readonly unknown[],
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const allowed = new Set<string>();
  for (const candidate of allowedSpecialties) {
    const specialty = normalizeClinicalSpecialty(candidate);
    if (specialty) allowed.add(specialty);
  }
  const result: Record<string, unknown> = {};

  for (const [rawSpecialty, objectives] of Object.entries(value)) {
    const specialty = normalizeClinicalSpecialty(rawSpecialty);
    if (!specialty || !allowed.has(specialty) || specialty in result) {
      return null;
    }
    result[specialty] = objectives;
  }

  return result;
}

export type HistoricalTherapeuticPlanReadCutoff = {
  endsAt: string;
  updatedAt: string;
  exclusiveCivilEndAt: string;
};

/**
 * The link end date is a civil clinic date, not a UTC midnight timestamp.
 * A historical record must satisfy both the mutation timestamp and that
 * civil-date boundary. Keeping this logic shared with the backend avoids
 * exposing a version written after the professional was unlinked.
 */
export function resolveHistoricalTherapeuticPlanReadCutoff(
  link: unknown,
): HistoricalTherapeuticPlanReadCutoff | null {
  const endsAt = cleanText(readValue(link, 'ends_at', 'endsAt')).slice(0, 10);
  const updatedAt = cleanText(readValue(link, 'updated_at', 'updatedAt'));
  const match = ISO_CIVIL_DATE.exec(endsAt);
  const updatedDate = updatedAt ? new Date(updatedAt) : null;
  if (!match || !updatedDate || Number.isNaN(updatedDate.getTime())) return null;

  const nextDay = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + 1,
    ),
  );
  const nextCivilDate = `${nextDay.getUTCFullYear()}-${String(
    nextDay.getUTCMonth() + 1,
  ).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  const exclusiveCivilEndAt = buildAppointmentDateTime(nextCivilDate, '00:00');
  if (!exclusiveCivilEndAt) return null;

  return {
    endsAt,
    updatedAt: updatedDate.toISOString(),
    exclusiveCivilEndAt: exclusiveCivilEndAt.toISOString(),
  };
}
