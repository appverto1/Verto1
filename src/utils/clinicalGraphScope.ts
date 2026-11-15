import { clinicalSpecialtiesMatch, readClinicalSpecialty } from './clinicalSpecialties';

const clean = (value: unknown) => String(value ?? '').trim();

export type ClinicalGraphActorScope = {
  actorRole: unknown;
  actorSpecialty?: unknown;
  hasSupervisionAccess?: boolean;
};

/**
 * Graph-only scope refinement layered on top of the existing patient/case ReBAC.
 *
 * The caller must first apply canonical patient/plan authorization. This helper
 * only narrows what an ordinary professional can see inside that already
 * authorized patient: only plans of the actor's canonical specialty are visible.
 * The interdisciplinary PTS is reserved for managers and case-authorized
 * supervisors after the existing patient/case ReBAC checks.
 */
export function filterClinicalGraphPlanScopesForActor<T extends { mode?: unknown; specialty?: unknown }>(
  plans: readonly T[],
  scope: ClinicalGraphActorScope,
): T[] {
  const role = clean(scope.actorRole).toLowerCase();
  if (['owner', 'admin', 'director', 'coordinator'].includes(role)) return [...plans];
  if (role === 'supervisor' || scope.hasSupervisionAccess === true) return [...plans];
  if (role !== 'therapist') return [];

  const actorSpecialty = readClinicalSpecialty(scope.actorSpecialty);
  return plans.filter((plan) => {
    const mode = clean(plan?.mode).toLowerCase();
    if (mode !== 'specialty') return false;
    return Boolean(actorSpecialty && clinicalSpecialtiesMatch(plan?.specialty, actorSpecialty));
  });
}

export function clinicalGraphLegacySnapshotVisibleToActor(
  snapshotSpecialty: unknown,
  scope: ClinicalGraphActorScope,
): boolean {
  const role = clean(scope.actorRole).toLowerCase();
  if (['owner', 'admin', 'director', 'coordinator'].includes(role)) return true;
  if (role === 'supervisor' || scope.hasSupervisionAccess === true) return true;
  if (role !== 'therapist') return false;

  const actorSpecialty = readClinicalSpecialty(scope.actorSpecialty);
  return Boolean(actorSpecialty && clinicalSpecialtiesMatch(snapshotSpecialty, actorSpecialty));
}

/** Pick an initial chart only from the plan scopes authorized by the server. */
export function resolveClinicalGraphScopeId(
  requestedScopeId: string,
  hasAuthorizedPts: boolean,
  authorizedSpecialtyPlanIds: readonly string[],
): string {
  const fallback = hasAuthorizedPts ? 'pts' : (authorizedSpecialtyPlanIds[0] || '');
  if (requestedScopeId === 'pts') return hasAuthorizedPts ? 'pts' : fallback;
  return authorizedSpecialtyPlanIds.includes(requestedScopeId) ? requestedScopeId : fallback;
}
