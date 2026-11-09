import type { ClinicalOutcomeSeriesSummary, ClinicalOutcomeObservation } from './clinicalOutcomeAnalytics';
import { clinicalOutcomeSeriesBelongsToPlanScope, type ClinicalOutcomePlanScopeIndex } from './clinicalOutcomePlanScope';

export type PtsChartSpecialtyPlan = { id: string; specialty: string };
export type PtsClusteredWeek = {
  week: string;
  values: Record<string, number>;
  sampleCounts: Record<string, number>;
};
export type PtsClusteredMetric = {
  id: string;
  label: string;
  unit: string;
  direction: string;
  specialtyCount: number;
  weeks: PtsClusteredWeek[];
};

const clean = (value: unknown) => String(value ?? '').trim();
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Use calendar weeks instead of individual sessions: each specialty gets a
// neighboring bar even when its professional collected on a different day.
const weekKey = (observedAt: unknown): string => {
  const date = new Date(clean(observedAt));
  if (!Number.isFinite(date.getTime())) return '';
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};

// Normalize only target-specific identifiers. Do not equate independence,
// accuracy, duration, frequency or instruments with different versions.
const metricFamily = (series: ClinicalOutcomeSeriesSummary): string => {
  const key = clean(series.metricKey).toUpperCase();
  return key
    .replace(/^(PROGRAM_TARGET|ABA_TARGET):[^:]+:/, '$1:')
    .replace(/[0-9A-F]{8}-[0-9A-F-]{27,}/g, '{ID}');
};

type Sample = { value: number; numerator: number | null; denominator: number | null };
type Bucket = { week: string; samples: Sample[] };

const aggregate = (samples: Sample[], unit: string): number | null => {
  if (!samples.length) return null;
  // For percentage-based trial ratios, pool observed opportunities rather
  // than averaging percentages from unequal sample sizes.
  if (unit === '%' && samples.every((row) => row.numerator !== null && row.denominator !== null && row.denominator > 0)) {
    const numerator = samples.reduce((sum, row) => sum + (row.numerator || 0), 0);
    const denominator = samples.reduce((sum, row) => sum + (row.denominator || 0), 0);
    return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null;
  }
  return Math.round(samples.reduce((sum, row) => sum + row.value, 0) / samples.length * 100) / 100;
};

/**
 * A descriptive comparison of the SAME measurement across separately scoped
 * clinical plans. This is not a mastery score or an authorization check.
 * Missing observations stay missing, never zero.
 */
export function buildPtsClusteredSpecialtyMetrics(
  plans: PtsChartSpecialtyPlan[],
  seriesRows: ClinicalOutcomeSeriesSummary[],
  planScopeIndex: ClinicalOutcomePlanScopeIndex,
): PtsClusteredMetric[] {
  const validPlans = plans.filter((plan) => clean(plan.id) && clean(plan.specialty));
  const metrics = new Map<string, {
    label: string; unit: string; direction: string;
    byPlanWeek: Map<string, Bucket>;
  }>();

  for (const series of seriesRows) {
    const observedPlans = validPlans.filter((plan) => clinicalOutcomeSeriesBelongsToPlanScope(series, plan.id, planScopeIndex));
    // Mixed-plan evidence is ambiguous: don't assign it to two specialties.
    if (observedPlans.length !== 1) continue;
    const plan = observedPlans[0];
    const family = metricFamily(series);
    const unit = clean(series.unit);
    const direction = clean(series.direction);
    const instrument = clean(series.validObservations[0]?.instrumentId);
    const version = clean(series.validObservations[0]?.instrumentVersion);
    const definition = clean(series.validObservations[0]?.definitionVersion || 1);
    const metricId = [family, unit, direction, instrument, version, definition].join('::');
    if (!family) continue;

    for (const row of series.validObservations) {
      const value = finite(row.value);
      const week = weekKey(row.observedAt);
      if (value === null || !week) continue;
      let metric = metrics.get(metricId);
      if (!metric) {
        metric = { label: clean(series.metricLabel) || family, unit, direction, byPlanWeek: new Map() };
        metrics.set(metricId, metric);
      }
      const bucketKey = plan.id + '::' + week;
      let bucket = metric.byPlanWeek.get(bucketKey);
      if (!bucket) {
        bucket = { week, samples: [] };
        metric.byPlanWeek.set(bucketKey, bucket);
      }
      bucket.samples.push({ value, numerator: finite(row.numerator), denominator: finite(row.denominator) });
    }
  }

  return [...metrics.entries()].map(([id, metric]) => {
    const weeks = new Map<string, PtsClusteredWeek>();
    const includedPlans = new Set<string>();
    for (const [key, bucket] of metric.byPlanWeek.entries()) {
      const planId = key.slice(0, key.length - bucket.week.length - 2);
      const value = aggregate(bucket.samples, metric.unit);
      if (value === null) continue;
      includedPlans.add(planId);
      const row = weeks.get(bucket.week) || { week: bucket.week, values: {}, sampleCounts: {} };
      row.values[planId] = value;
      row.sampleCounts[planId] = bucket.samples.length;
      weeks.set(bucket.week, row);
    }
    return {
      id, label: metric.label, unit: metric.unit, direction: metric.direction,
      specialtyCount: includedPlans.size,
      weeks: [...weeks.values()].sort((left, right) => left.week.localeCompare(right.week)),
    };
  }).filter((item) => item.weeks.length > 0)
    .sort((left, right) => right.specialtyCount - left.specialtyCount || left.label.localeCompare(right.label, 'pt-BR'));
}
