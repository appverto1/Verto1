import { isClinicalOutcomeInterferingBehaviorSeries, type ClinicalOutcomeSeriesSummary } from './clinicalOutcomeAnalytics';
import { clinicalOutcomeSeriesBelongsToPlanScope, type ClinicalOutcomePlanScopeIndex } from './clinicalOutcomePlanScope';

type PtsContribution = {
  link?: unknown;
  specialtyPlan?: { id?: unknown } | null;
  series?: ClinicalOutcomeSeriesSummary[];
};

type PtsGoalEvidence = { contributions: PtsContribution[] };

/**
 * Build the already-authorized, patient-scoped evidence for the PTS overview.
 * The PTS includes all visible specialty plans, not just explicitly linked
 * contributions. No metric averaging, inferred link by specialty label or
 * additional network request is performed here.
 *
 * The caller must use the plans and observations returned by the tenant/actor
 * scoped clinical-outcomes API. This presentation selector is not an ACL.
 */
export function selectPtsMultidisciplinarySeries({
  allSeries,
  ptsSeries,
  ptsGoalRows,
  specialtyPlanIds,
  planScopeIndex,
  isHistoricalOnly,
}: {
  allSeries: ClinicalOutcomeSeriesSummary[];
  ptsSeries: ClinicalOutcomeSeriesSummary[];
  ptsGoalRows: PtsGoalEvidence[];
  specialtyPlanIds: unknown[];
  planScopeIndex: ClinicalOutcomePlanScopeIndex;
  isHistoricalOnly: (series: ClinicalOutcomeSeriesSummary) => boolean;
}): ClinicalOutcomeSeriesSummary[] {
  const selected = new Map<string, ClinicalOutcomeSeriesSummary>();
  const include = (series: ClinicalOutcomeSeriesSummary) => {
    if (!isHistoricalOnly(series)) selected.set(series.key, series);
  };

  ptsSeries.forEach(include);

  for (const goal of ptsGoalRows) {
    for (const contribution of goal.contributions) {
      (contribution.series || []).forEach(include);
    }
  }

  // The PTS needs every authorized specialty plan even when a contribution
  // has not yet been explicitly linked to a PTS goal. Use canonical plan IDs,
  // never infer a clinical relationship from matching specialty names.
  const planIds = new Set(
    [...specialtyPlanIds, ...ptsGoalRows.flatMap((goal) => goal.contributions
      .filter((contribution) => Boolean(contribution.link && contribution.specialtyPlan?.id))
      .map((contribution) => contribution.specialtyPlan?.id))]
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  );

  const visiblePlanIds = [...planIds];
  for (const series of allSeries) {
    if (isHistoricalOnly(series)) continue;
    if (
      isClinicalOutcomeInterferingBehaviorSeries(series)
      || visiblePlanIds.some((id) => clinicalOutcomeSeriesBelongsToPlanScope(series, id, planScopeIndex))
    ) include(series);
  }

  return [...selected.values()];
}
