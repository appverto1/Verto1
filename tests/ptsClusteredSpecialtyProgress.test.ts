import assert from 'node:assert/strict';
import { buildClinicalOutcomePlanScopeIndex } from '../src/utils/clinicalOutcomePlanScope';
import { buildPtsClusteredSpecialtyMetrics } from '../src/utils/ptsClusteredSpecialtyProgress';
import type { ClinicalOutcomeObservation, ClinicalOutcomeSeriesSummary } from '../src/utils/clinicalOutcomeAnalytics';

const plans = [
  { id: 'fono-plan', specialty: 'Fonoaudiologia' },
  { id: 'to-plan', specialty: 'Terapia Ocupacional' },
  { id: 'psico-plan', specialty: 'Psicoterapia' },
];

const observation = (
  id: string, planId: string | null, value: number | null, observedAt = '2026-11-03T14:00:00Z',
  numerator: number | null = null, denominator: number | null = null,
): ClinicalOutcomeObservation => ({
  id, planId, metricKey: 'TARGET_ACCURACY', metricLabel: 'Acurácia', unit: '%',
  value, numerator, denominator, observedAt,
});
const makeSeries = (
  key: string, rows: ClinicalOutcomeObservation[],
  metricKey = 'TARGET_ACCURACY', unit = '%', direction = 'higher_is_better',
): ClinicalOutcomeSeriesSummary => ({
  key, metricKey, metricLabel: metricKey, itemLabel: key, unit,
  direction: direction as ClinicalOutcomeSeriesSummary['direction'],
  specialty: key, context: 'clinic', source: 'CMV3',
  observations: rows, validObservations: rows.filter((r) => r.value !== null),
  evidenceState: 'preliminary', visualTrend: 'unknown',
  latestObservation: rows[rows.length - 1], firstObservation: rows[0],
  missingCount: 0, stale: false, recencyWindowDays: 90, minimumDataPoints: 3,
});

const fono = makeSeries('fono', [
  observation('f1', 'fono-plan', 50, '2026-11-03T14:00:00Z', 5, 10),
  observation('f2', 'fono-plan', 80, '2026-11-05T14:00:00Z', 8, 10),
  observation('f3', 'fono-plan', 90, '2026-11-10T14:00:00Z', 9, 10),
]);
const to = makeSeries('to', [observation('to1', 'to-plan', 40, '2026-11-05T14:00:00Z', 4, 10)]);
const psico = makeSeries('psico', [observation('p1', 'psico-plan', 70, '2026-11-07T14:00:00Z', 7, 10)]);
const outOfScope = makeSeries('other-patient-plan', [observation('bad', 'not-visible', 100)]);
const mixed = makeSeries('ambiguous-mixed-plans', [
  observation('mixed-1', 'fono-plan', 99),
  observation('mixed-2', 'to-plan', 99),
]);
const missing = makeSeries('no-data', [observation('missing', 'psico-plan', null)]);
const behavior = makeSeries(
  'behavior', [observation('behavior', 'fono-plan', 12)],
  'BEHAVIOR_FREQUENCY', 'eventos', 'lower_is_better',
);
const index = buildClinicalOutcomePlanScopeIndex([]);
const metrics = buildPtsClusteredSpecialtyMetrics(plans, [
  fono, to, psico, outOfScope, mixed, missing, behavior,
], index);
const accuracy = metrics.find((metric) => metric.id.startsWith('TARGET_ACCURACY::%::'));
assert.ok(accuracy, 'a métrica percentual compartilhada entre planos deve existir');
assert.equal(accuracy.specialtyCount, 3, 'as três especialidades com evidência numérica aparecem');
assert.deepEqual(accuracy.weeks.map((week) => week.week), ['2026-11-02', '2026-11-09']);
assert.equal(accuracy.weeks[0].values['fono-plan'], 65, 'percentuais usam oportunidades ponderadas (13/20)');
assert.equal(accuracy.weeks[0].values['to-plan'], 40);
assert.equal(accuracy.weeks[0].values['psico-plan'], 70);
assert.deepEqual(accuracy.weeks[0].sampleCounts, { 'fono-plan': 2, 'to-plan': 1, 'psico-plan': 1 });
assert.equal(accuracy.weeks[1].values['fono-plan'], 90);
assert.equal(accuracy.weeks[1].values['to-plan'], undefined, 'ausência de coleta nunca deve ser representada por zero');
assert.equal(accuracy.weeks[0].values['not-visible'], undefined, 'plano fora do escopo autorizado não entra na consolidação');
assert.equal(accuracy.weeks[0].values['fono-plan'], 65, 'série com identidade ambígua não altera a média');
assert.ok(metrics.some((metric) => metric.id.startsWith('BEHAVIOR_FREQUENCY::eventos::lower_is_better')), 'frequência com outra unidade permanece métrica separada');
assert.ok(metrics.every((metric) => !metric.id.includes('::NOT_ALLOWED::')), 'métricas não autorizadas não são criadas');
assert.deepEqual(buildPtsClusteredSpecialtyMetrics(plans, [outOfScope, missing], index), [], 'sem evidência comparável, mostrar estado vazio');

console.log('ptsClusteredSpecialtyProgress.test.ts: ok');
