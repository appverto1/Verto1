import assert from 'node:assert/strict';
import { buildClinicalOutcomePlanScopeIndex } from '../src/utils/clinicalOutcomePlanScope';
import { selectPtsMultidisciplinarySeries } from '../src/utils/ptsMultidisciplinarySeries';
import { isClinicalOutcomeHistoricalOnlySeries, summarizeClinicalOutcomeSeries } from '../src/utils/clinicalOutcomeAnalytics';
import type { ClinicalOutcomeObservation, ClinicalOutcomeSeriesSummary } from '../src/utils/clinicalOutcomeAnalytics';

const makeSeries = (key: string, planId: string | null, metricKey = 'TARGET_ACCURACY'): ClinicalOutcomeSeriesSummary => {
  const observation: ClinicalOutcomeObservation = {
    id: key,
    planId,
    specialty: key,
    metricKey,
    metricLabel: metricKey,
    observedAt: '2026-11-08T13:00:00.000Z',
    value: 60,
  };
  return {
    key,
    metricKey,
    metricLabel: metricKey,
    itemLabel: key,
    unit: '%',
    direction: 'higher_is_better',
    specialty: key,
    context: 'clinic',
    source: 'V3 canônico',
    observations: [observation],
    validObservations: [observation],
    evidenceState: 'preliminary',
    visualTrend: 'unknown',
    latestObservation: observation,
    firstObservation: observation,
    missingCount: 0,
    stale: false,
    recencyWindowDays: 90,
    minimumDataPoints: 3,
  };
};

const pts = makeSeries('PTS', 'pts-plan');
const fono = makeSeries('Fonoaudiologia', 'fono-plan');
const to = makeSeries('Terapia Ocupacional', 'to-plan');
const psico = makeSeries('Psicoterapia', 'psico-plan');
const unrelatedPlan = makeSeries('Unrelated', 'not-visible');
const unscopedBehavior = makeSeries('Comportamento interferente', null, 'BEHAVIOR_FREQUENCY');
const historical = makeSeries('Historical', 'fono-plan');

const index = buildClinicalOutcomePlanScopeIndex([]);
const series = selectPtsMultidisciplinarySeries({
  allSeries: [pts, fono, to, psico, unrelatedPlan, unscopedBehavior, historical],
  ptsSeries: [pts, fono],
  ptsGoalRows: [],
  specialtyPlanIds: ['fono-plan', 'to-plan', 'psico-plan'],
  planScopeIndex: index,
  isHistoricalOnly: (item) => item.key === 'Historical',
});

assert.deepEqual(
  new Set(series.map((item) => item.key)),
  new Set(['PTS', 'Fonoaudiologia', 'Terapia Ocupacional', 'Psicoterapia', 'Comportamento interferente']),
  'o PTS reúne todas as especialidades autorizadas sem exigir vínculo explícito e sem incluir outros planos',
);
assert.equal(series.filter((item) => item.key === 'Fonoaudiologia').length, 1, 'contribuições não duplicam métricas');
assert.ok(!series.some((item) => item.key === 'Historical'), 'histórico legado não substitui a série atual');

const linked = selectPtsMultidisciplinarySeries({
  allSeries: [unrelatedPlan],
  ptsSeries: [],
  ptsGoalRows: [{ contributions: [{ link: { id: 'link' }, specialtyPlan: { id: 'not-visible' }, series: [unrelatedPlan] }] }],
  specialtyPlanIds: [],
  planScopeIndex: index,
  isHistoricalOnly: () => false,
});
assert.equal(linked.length, 1, 'vínculos explícitos já autorizados mantêm a evidência do PTS');

assert.deepEqual(selectPtsMultidisciplinarySeries({
  allSeries: [unrelatedPlan],
  ptsSeries: [],
  ptsGoalRows: [],
  specialtyPlanIds: [],
  planScopeIndex: index,
  isHistoricalOnly: () => false,
}), [], 'um plano estranho à visão autorizada não pode entrar por semelhança de nome');


// A behavioral metric from a different explicit plan must not be included by
// the broad PTS behavior fallback. Nor may unlinked label-only contributions.
const foreignBehavior = makeSeries('Foreign behavior', 'other-plan', 'BEHAVIOR_FREQUENCY');
const blocked = selectPtsMultidisciplinarySeries({
  allSeries: [foreignBehavior],
  ptsSeries: [],
  ptsGoalRows: [{ contributions: [{ specialtyPlan: { id: 'other-plan' }, series: [foreignBehavior] }] }],
  specialtyPlanIds: ['fono-plan'],
  planScopeIndex: index,
  isHistoricalOnly: () => false,
});
assert.deepEqual(blocked, [], 'no cross-plan behavior or label-only contribution may enter PTS');

// A completed V2 session can contain persisted interfering-behavior snapshots
// even when the ABA V3 read model has no behavior rows. These are NOT arbitrary
// historic target scores: preserve their original semantic metric and value.
const snapshots = [
  {
    id: 'saved-frequency-1', planId: null, programId: null, goalId: null,
    sessionId: 'session-1762719475912', itemId: null, itemLabel: 'Comportamento A',
    specialty: 'Terapia Ocupacional', metricKey: 'BEHAVIOR_FREQUENCY',
    metricLabel: 'Comportamento A', unit: 'ocorrências',
    direction: 'lower_is_better' as const, source: 'aba_session_metric_snapshot',
    observedAt: '2026-11-09T20:17:55.912Z', value: 0,
  },
  {
    id: 'saved-frequency-2', planId: null, programId: null, goalId: null,
    sessionId: 'session-1762719475912', itemId: null, itemLabel: 'Comportamento B',
    specialty: 'Terapia Ocupacional', metricKey: 'BEHAVIOR_FREQUENCY',
    metricLabel: 'Comportamento B', unit: 'ocorrências',
    direction: 'lower_is_better' as const, source: 'aba_session_metric_snapshot',
    observedAt: '2026-11-09T20:17:55.912Z', value: 3,
  },
];
const snapshotSeries = summarizeClinicalOutcomeSeries(snapshots);
assert.equal(snapshotSeries.length, 2, 'behavior names remain separate even if old snapshots have no behavior_id');
assert.ok(snapshotSeries.every((item) => !isClinicalOutcomeHistoricalOnlySeries(item)),
  'saved BEHAVIOR_* evidence is available when the canonical read model has no replacement');
assert.ok(snapshotSeries.some((item) => item.validObservations[0].value === 0),
  'a legitimate observation of zero occurrences is preserved, not mistaken for missing data');

const savedBehaviorPts = selectPtsMultidisciplinarySeries({
  allSeries: snapshotSeries,
  ptsSeries: [],
  ptsGoalRows: [],
  specialtyPlanIds: ['to-plan'],
  planScopeIndex: index,
  isHistoricalOnly: isClinicalOutcomeHistoricalOnlySeries,
});
assert.equal(savedBehaviorPts.length, 2, 'interfering behaviors must appear in PTS after confirmed session closure');

const previousLegacyTarget = makeSeries('old-target', 'to-plan');
previousLegacyTarget.source = 'aba_session_metric_snapshot';
previousLegacyTarget.observations[0].source = 'aba_session_metric_snapshot';
previousLegacyTarget.observations[0].sessionId = 'session-1762719475912';
assert.equal(isClinicalOutcomeHistoricalOnlySeries(previousLegacyTarget), true,
  'old target snapshots must remain excluded from current analytic charts');

const unrelatedSnapshot = makeSeries('other-plan-behavior', 'foreign-plan', 'BEHAVIOR_FREQUENCY');
unrelatedSnapshot.source = 'aba_session_metric_snapshot';
unrelatedSnapshot.observations[0].source = 'aba_session_metric_snapshot';
unrelatedSnapshot.observations[0].sessionId = 'session-1762719475912';
assert.deepEqual(selectPtsMultidisciplinarySeries({
  allSeries: [unrelatedSnapshot], ptsSeries: [], ptsGoalRows: [],
  specialtyPlanIds: ['to-plan'], planScopeIndex: index,
  isHistoricalOnly: isClinicalOutcomeHistoricalOnlySeries,
}), [], 'old behavior data with an explicit foreign plan must not cross the authorized scope');

console.log('ptsMultidisciplinarySeries.test.ts: ok');
