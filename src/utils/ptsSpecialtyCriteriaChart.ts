import { summarizeClinicalOutcomeSeries, type ClinicalOutcomeSeriesSummary } from './clinicalOutcomeAnalytics';
import { buildClinicalProgramChangeOverview } from './clinicalProgramChangeAnalytics';
import { clinicalOutcomeSeriesBelongsToPlanScope, type ClinicalOutcomePlanScopeIndex } from './clinicalOutcomePlanScope';

export type PtsSpecialtyPlan = { id: string; specialty: string };
export type PtsSpecialtyCriterionBucket = {
  month: string;
  label: string;
  values: Record<string, number | null>;
  evidence: Record<string, { sustained: number; evaluable: number }>;
};

/**
 * Clinical progress means sustained individual target criteria, NOT clicks,
 * total sessions or an unweighted average of incompatible measurements.
 * A missing/insufficient criterion is never converted to 0 or scored as met.
 *
 * The caller supplies only authorized patient-scoped plans, programs and
 * canonical observations from the existing clinical outcomes read model.
 */
export function buildPtsSpecialtyCriterionBuckets({
  plans, series, programs, planScopeIndex,
}: {
  plans: PtsSpecialtyPlan[];
  series: ClinicalOutcomeSeriesSummary[];
  programs: any[];
  planScopeIndex: ClinicalOutcomePlanScopeIndex;
}): PtsSpecialtyCriterionBucket[] {
  if (!plans.length || !series.length) return [];
  const validMonths = new Set<string>();
  for (const summary of series) {
    for (const observation of summary.observations) {
      const month = String(observation.observedAt || '').slice(0, 7);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) validMonths.add(month);
    }
  }
  const months = [...validMonths].sort();
  if (!months.length) return [];

  // Pre-index plan-specific series; never associate plans merely by a
  // matching specialty name. No new network requests or DB reads.
  const seriesByPlan = new Map(plans.map((plan) => [
    plan.id,
    series.filter((summary) => clinicalOutcomeSeriesBelongsToPlanScope(summary, plan.id, planScopeIndex)),
  ]));
  const programsByPlan = new Map(plans.map((plan) => [
    plan.id,
    (Array.isArray(programs) ? programs : []).filter((program) =>
      String(program?.therapeutic_plan_id || program?.therapeuticPlanId || '') === plan.id),
  ]));

  return months.map((month) => {
    const values: Record<string, number | null> = {};
    const evidence: PtsSpecialtyCriterionBucket['evidence'] = {};
    for (const plan of plans) {
      const eligibleObservations = (seriesByPlan.get(plan.id) || []).flatMap((summary) =>
        summary.observations.filter((observation) => String(observation.observedAt || '').slice(0, 7) <= month));
      if (!eligibleObservations.length) {
        values[plan.id] = null;
        evidence[plan.id] = { sustained: 0, evaluable: 0 };
        continue;
      }
      const cumulative = summarizeClinicalOutcomeSeries(eligibleObservations);
      const overview = buildClinicalProgramChangeOverview(cumulative, programsByPlan.get(plan.id) || []);
      // A criterion must exist and have sufficient per-session evidence for
      // this display. Each target contributes once regardless of the number
      // of attempts recorded for it.
      const evaluableTargets = overview.targets.filter((target) =>
        Boolean(target.criterionSource) && target.pointCount >= 3 && target.movement !== 'insufficient');
      const sustained = evaluableTargets.filter((target) => target.movement === 'criterion_sustained').length;
      evidence[plan.id] = { sustained, evaluable: evaluableTargets.length };
      values[plan.id] = evaluableTargets.length > 0
        ? Math.round((sustained / evaluableTargets.length) * 1000) / 10
        : null;
    }
    const [year, monthNumber] = month.split('-');
    return {
      month,
      label: `${monthNumber}/${year}`,
      values,
      evidence,
    };
  });
}
