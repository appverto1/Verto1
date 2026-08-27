import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildClinicalOutcomePlanScopeIndex,
  clinicalOutcomeSeriesBelongsToPlanScope,
  clinicalOutcomeSeriesSourceKinds,
} from '../src/utils/clinicalOutcomePlanScope';
import type { ClinicalOutcomeSeriesSummary } from '../src/utils/clinicalOutcomeAnalytics';

const summary = (observations: any[]): ClinicalOutcomeSeriesSummary => ({
  key: 'series',
  metricKey: 'PRIMARY_INDEPENDENCE_PERCENT',
  metricLabel: 'Independência primária',
  itemLabel: 'Alvo',
  unit: '%',
  direction: 'higher_is_better',
  specialty: 'Sem especialidade',
  context: 'clinic',
  source: 'ABA V3 canônico',
  observations,
  validObservations: observations,
  evidenceState: 'sufficient',
  visualTrend: 'stable',
  latestObservation: observations[observations.length - 1] || null,
  firstObservation: observations[0] || null,
  missingCount: 0,
  stale: false,
  recencyWindowDays: 30,
  minimumDataPoints: 4,
});

const index = buildClinicalOutcomePlanScopeIndex([
  { id: 'program-aba', therapeuticPlanId: 'pts-1', therapeuticObjectiveId: 'objective-aba' },
  { id: 'program-plan', therapeutic_plan_id: 'specialty-1', therapeutic_objective_id: 'objective-plan' },
]);

assert.equal(clinicalOutcomeSeriesBelongsToPlanScope(summary([
  { planId: 'pts-1', metadata: { sourceKind: 'ABA_TARGET' } },
]), 'pts-1', index), true, 'planId canônico deve governar o escopo quando presente');

assert.equal(clinicalOutcomeSeriesBelongsToPlanScope(summary([
  { planId: 'pts-1', programId: 'program-plan', metadata: { sourceKind: 'ABA_TARGET' } },
]), 'specialty-1', index), false, 'planId explícito não pode ser remapeado por coincidência de programa');

assert.equal(clinicalOutcomeSeriesBelongsToPlanScope(summary([
  { planId: null, programId: 'program-aba', metadata: { sourceKind: 'ABA_TARGET' } },
]), 'pts-1', index), true, 'ABA_TARGET sem planId pode recuperar escopo pelo programa autorizado');

assert.equal(clinicalOutcomeSeriesBelongsToPlanScope(summary([
  { planId: null, goalId: 'objective-plan', metadata: { sourceKind: 'THERAPEUTIC_OBJECTIVE' } },
]), 'specialty-1', index), true, 'objetivo terapêutico sem planId pode recuperar escopo pelo vínculo objetivo→plano');

assert.deepEqual(clinicalOutcomeSeriesSourceKinds(summary([
  { metadata: { sourceKind: 'ABA_TARGET' } },
  { metadata: { source_kind: 'THERAPEUTIC_OBJECTIVE' } },
])), ['ABA_TARGET', 'THERAPEUTIC_OBJECTIVE']);

const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
assert.match(dashboard, /ptsPlanSeries/);
assert.match(dashboard, /clinicalOutcomeSeriesBelongsToPlanScope/);
assert.match(dashboard, /for \(const series of ptsPlanSeries\)/, 'PTS deve nascer do read model canônico mesmo sem goals estruturados');
assert.match(dashboard, /pts-canonical-unstructured-evidence/, 'evidência canônica deve permanecer visível quando common_objectives está vazio');
assert.match(dashboard, /sem inferir automaticamente uma especialidade/i, 'specialty null não pode ser atribuído silenciosamente a um plano de especialidade');

console.log('clinicalOutcomePlanScope.regression.test.ts: ok');
