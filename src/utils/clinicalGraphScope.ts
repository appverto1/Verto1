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
 * authorized patient: specialty plans must match the actor's canonical clinic
 * specialty. Managers keep clinic-wide plan visibility, while supervisors keep
 * the case-scoped visibility proven by supervision ReBAC.
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
    if (mode === 'interdisciplinary') return true;
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
