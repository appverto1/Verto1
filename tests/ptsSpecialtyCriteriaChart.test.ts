import assert from 'node:assert/strict';
import { summarizeClinicalOutcomeSeries, type ClinicalOutcomeObservation } from '../src/utils/clinicalOutcomeAnalytics';
import { buildClinicalOutcomePlanScopeIndex } from '../src/utils/clinicalOutcomePlanScope';
import { buildPtsSpecialtyCriterionBuckets } from '../src/utils/ptsSpecialtyCriteriaChart';

const sample = (planId: string, targetId: string, values: number[], month = '11', threshold = 80): ClinicalOutcomeObservation[] =>
  values.map((value, index) => ({
    id: `${planId}-${targetId}-${index}`,
    planId, programId: `${planId}-program`, itemId: targetId,
    itemLabel: targetId, specialty: planId, observedAt: `2026-${month}-${String(2 + index).padStart(2, '0')}T14:00:00.000Z`,
    sessionId: `${planId}-${targetId}-session-${index}`,
    metricKey: 'TARGET_ACCURACY', metricLabel: 'Acurácia', unit: '%', direction: 'higher_is_better', value,
    metadata: { clinicalDecisionRules: { threshold, operator: 'gte', requiredSessions: 2 } },
  }));

const rows = [
  ...sample('fono', 'sustained', [70, 85, 92]),
  ...sample('fono', 'not-sustained', [45, 55, 65]),
  ...sample('to', 'sustained', [85, 87, 90]),
  ...sample('psico', 'sparse', [30, 50]),
  ...sample('outside', 'outsider', [90, 95, 98]),
];
const programs = ['fono', 'to', 'psico'].map((id) => ({
  id: `${id}-program`, therapeutic_plan_id: id, name: 'Atendimento',
}));
const plans = ['fono', 'to', 'psico'].map((id) => ({ id, specialty: id }));
const result = buildPtsSpecialtyCriterionBuckets({
  plans,
  series: summarizeClinicalOutcomeSeries(rows),
  programs,
  planScopeIndex: buildClinicalOutcomePlanScopeIndex(programs),
});
assert.equal(result.length, 1);
assert.equal(result[0].month, '2026-11');
assert.equal(result[0].values.fono, 50, 'um alvo sustentado em dois avaliáveis = 50%, sem média de métricas');
assert.equal(result[0].values.to, 100);
assert.equal(result[0].values.psico, null, 'sem três sessões não vira zero');
assert.equal(result[0].values.outside, undefined, 'um plano de fora não aparece');
assert.deepEqual(result[0].evidence.fono, { sustained: 1, evaluable: 2 });

const withoutCriteria = summarizeClinicalOutcomeSeries(sample('fono', 'no-rule', [10, 20, 30]).map(({ metadata, ...rest }) => rest));
const missing = buildPtsSpecialtyCriterionBuckets({
  plans: [plans[0]],
  series: withoutCriteria,
  programs: [],
  planScopeIndex: buildClinicalOutcomePlanScopeIndex([]),
});
assert.equal(missing[0].values.fono, null, 'nunca assumir critério quando não está definido');

const spanningMonths = buildPtsSpecialtyCriterionBuckets({
  plans: [plans[0]],
  series: summarizeClinicalOutcomeSeries(sample('fono', 'sustained', [70, 85, 92], '10').concat(sample('fono', 'sustained', [88, 94], '11'))),
  programs: [programs[0]],
  planScopeIndex: buildClinicalOutcomePlanScopeIndex([programs[0]]),
});
assert.deepEqual(spanningMonths.map((row) => row.month), ['2026-10', '2026-11']);
assert.equal(spanningMonths[0].values.fono, 100);
assert.equal(spanningMonths[1].values.fono, 100);

console.log('ptsSpecialtyCriteriaChart.test.ts: ok');
