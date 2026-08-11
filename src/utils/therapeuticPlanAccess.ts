import { normalizeClinicalSpecialty } from './clinicalSpecialties';
import { buildAppointmentDateTime } from './scheduling';

export type TherapeuticPlanActorContext = {
  actorId: unknown;
  actorRole: unknown;
  professionalLinks?: readonly unknown[];
};

type TherapeuticPlanPermission = 'read' | 'write';

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

export function isTherapeuticPlanManager(roleOrActor: unknown): boolean {
  return ['owner', 'admin', 'director', 'coordinator', 'supervisor'].includes(
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

export function canEditTherapeuticPlanScope(
  scope: unknown,
  context: TherapeuticPlanActorContext
): boolean {
  if (isTherapeuticPlanManager(context.actorRole)) return true;

  const actorId = cleanText(context.actorId);
  if (
    resolveActorRole(context.actorRole) !== 'therapist' ||
    !isTherapeuticPlanParticipant(scope, actorId)
  ) {
    return false;
  }

  return hasActiveProfessionalLink(
    context.professionalLinks ?? [],
    actorId,
    resolveScopePatientId(scope),
    'write'
  );
}

export function filterTherapeuticPlanScopesForActor<T>(
  scopes: readonly T[],
  context: TherapeuticPlanActorContext
): T[] {
  if (isTherapeuticPlanManager(context.actorRole)) return [...scopes];

  const actorId = cleanText(context.actorId);
  if (resolveActorRole(context.actorRole) !== 'therapist' || !actorId) {
    return [];
  }

  return scopes.filter(
    (scope) =>
      isTherapeuticPlanParticipant(scope, actorId) &&
      hasActiveProfessionalLink(
        context.professionalLinks ?? [],
        actorId,
        resolveScopePatientId(scope),
        'read'
      )
  );
}

export function filterTherapeuticPlanProgramsForActor<TProgram, TScope>(
  programs: readonly TProgram[],
  scopes: readonly TScope[],
  context: TherapeuticPlanActorContext
): TProgram[] {
  if (isTherapeuticPlanManager(context.actorRole)) return [...programs];

  const actorId = cleanText(context.actorId);
  if (resolveActorRole(context.actorRole) !== 'therapist' || !actorId) {
    return [];
  }

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
