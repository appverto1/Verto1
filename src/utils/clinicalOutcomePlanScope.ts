import type { ClinicalOutcomeSeriesSummary } from './clinicalOutcomeAnalytics';
import { isClinicalOutcomeInterferingBehaviorSeries } from './clinicalOutcomeAnalytics';
import { clinicalSpecialtiesMatch, clinicalSpecialtyScopeKey } from './clinicalSpecialties';

const clean = (value: unknown) => String(value ?? '').trim();

export type ClinicalOutcomePlanScopeIndex = {
  programPlanById: Map<string, string>;
  objectivePlanIdsById: Map<string, Set<string>>;
};

const addObjectivePlan = (
  index: Map<string, Set<string>>,
  objectiveId: string,
  planId: string,
) => {
  if (!objectiveId || !planId) return;
  const current = index.get(objectiveId) || new Set<string>();
  current.add(planId);
  index.set(objectiveId, current);
};

export const buildClinicalOutcomePlanScopeIndex = (
  programs: any[],
): ClinicalOutcomePlanScopeIndex => {
  const programPlanById = new Map<string, string>();
  const objectivePlanIdsById = new Map<string, Set<string>>();

  for (const program of Array.isArray(programs) ? programs : []) {
    const programId = clean(program?.id);
    const planId = clean(program?.therapeuticPlanId || program?.therapeutic_plan_id);
    const objectiveId = clean(program?.therapeuticObjectiveId || program?.therapeutic_objective_id);
    if (programId && planId) programPlanById.set(programId, planId);
    addObjectivePlan(objectivePlanIdsById, objectiveId, planId);
  }

  return { programPlanById, objectivePlanIdsById };
};

const seriesObservationValues = (
  series: ClinicalOutcomeSeriesSummary,
  selector: (row: any) => unknown[],
) => Array.from(new Set(
  (Array.isArray(series?.observations) ? series.observations : [])
    .flatMap((row) => selector(row).map(clean))
    .filter(Boolean),
));

export const clinicalOutcomeSeriesSourceKinds = (series: ClinicalOutcomeSeriesSummary) => (
  seriesObservationValues(series, (row) => [
    row?.metadata?.sourceKind,
    row?.metadata?.source_kind,
  ]).map((value) => value.toUpperCase())
);

export const clinicalOutcomeSeriesBelongsToPlanScope = (
  series: ClinicalOutcomeSeriesSummary,
  planId: unknown,
  index: ClinicalOutcomePlanScopeIndex,
) => {
  const expectedPlanId = clean(planId);
  if (!expectedPlanId) return false;

  const directPlanIds = seriesObservationValues(series, (row) => [
    row?.planId,
    row?.metadata?.planId,
    row?.metadata?.plan_id,
  ]);

  // A plan carried by the canonical read row is authoritative. Never remap a row
  // that already names another plan merely because a program/objective id overlaps.
  if (directPlanIds.length > 0) return directPlanIds.includes(expectedPlanId);

  const programIds = seriesObservationValues(series, (row) => [
    row?.programId,
    row?.metadata?.programId,
    row?.metadata?.program_id,
  ]);
  const goalIds = seriesObservationValues(series, (row) => [
    row?.goalId,
    row?.metadata?.goalId,
    row?.metadata?.goal_id,
    row?.metadata?.therapeuticObjectiveId,
    row?.metadata?.therapeutic_objective_id,
  ]);
  const sourceKinds = clinicalOutcomeSeriesSourceKinds(series);

  const programMatches = programIds.some((programId) => index.programPlanById.get(programId) === expectedPlanId);
  const goalMatches = goalIds.some((goalId) => index.objectivePlanIdsById.get(goalId)?.has(expectedPlanId));

  if (sourceKinds.includes('ABA_TARGET')) return programMatches || goalMatches;
  if (sourceKinds.includes('PLAN_GOAL') || sourceKinds.includes('THERAPEUTIC_OBJECTIVE')) return goalMatches || programMatches;
  return programMatches || goalMatches;
};

/**
 * P1-15: behavioral evidence may be collected without a therapeutic-plan id.
 * Attribute it to a specialty chart only when every persisted observation
 * identifies that same known specialty and contains no other plan/program/goal
 * relationship. Unknown or mixed-origin evidence stays in the patient PTS view.
 * This is presentation filtering after the server's patient/tenant authorization,
 * never a substitute for that authorization.
 */
export const unscopedBehaviorSeriesBelongsToSpecialty = (
  series: ClinicalOutcomeSeriesSummary,
  specialty: unknown,
): boolean => {
  if (!clinicalSpecialtyScopeKey(specialty) || !isClinicalOutcomeInterferingBehaviorSeries(series)) return false;
  const rows = Array.isArray(series.observations) ? series.observations : [];
  return rows.length > 0 && rows.every((row) => {
    if (!clinicalSpecialtiesMatch(row.specialty, specialty)) return false;
    return ![
      row.planId, row.programId, row.goalId,
      row.metadata?.planId, row.metadata?.plan_id,
      row.metadata?.programId, row.metadata?.program_id,
      row.metadata?.goalId, row.metadata?.goal_id,
      row.metadata?.therapeuticObjectiveId, row.metadata?.therapeutic_objective_id,
    ].some((value) => clean(value));
  });
};
