import assert from 'node:assert/strict';
import { buildClinicalOutcomePlanScopeIndex } from '../src/utils/clinicalOutcomePlanScope';
import { selectPtsMultidisciplinarySeries } from '../src/utils/ptsMultidisciplinarySeries';
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

console.log('ptsMultidisciplinarySeries.test.ts: ok');
