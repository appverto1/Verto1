import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildClinicalOutcomePlanScopeIndex,
  clinicalOutcomeSeriesBelongsToPlanScope,
  clinicalOutcomeSeriesSourceKinds,
  unscopedBehaviorSeriesBelongsToSpecialty,
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
const ptsSelector = fs.readFileSync('src/utils/ptsMultidisciplinarySeries.ts', 'utf8');
assert.match(dashboard, /ptsSeries: ptsPlanSeries/, 'PTS deve receber séries canônicas do plano mesmo sem goals estruturados');
assert.match(ptsSelector, /ptsSeries\.forEach\(include\)/, 'o módulo deve preservar o read model canônico sem goals estruturados');
assert.match(ptsSelector, /clinicalOutcomeSeriesBelongsToPlanScope\(series, linkedPlanId, planScopeIndex\)/,
  'contribuições devem exigir vínculo de plano validado, não apenas nome de especialidade');
assert.match(dashboard, /pts-canonical-unstructured-evidence/, 'evidência canônica deve permanecer visível quando common_objectives está vazio');
assert.match(dashboard, /sem inferir automaticamente uma especialidade/i, 'specialty null não pode ser atribuído silenciosamente a um plano de especialidade');


const behavior = (observations: any[]): ClinicalOutcomeSeriesSummary => ({
  ...summary(observations),
  metricKey: 'BEHAVIOR_FREQUENCY',
  metricLabel: 'Frequência de comportamento interferente',
  specialty: observations[0]?.specialty || 'Sem especialidade',
});
const toBehavior = [
  { planId: null, goalId: null, programId: null, specialty: 'Terapia Ocupacional', metadata: { sourceFamily: 'BEHAVIOR' } },
  { planId: null, goalId: null, programId: null, specialty: 'Terapeuta Ocupacional', metadata: { source_family: 'BEHAVIOR' } },
];
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior(toBehavior), 'Terapeuta Ocupacional'), true,
  'P1-15: comportamento TO sem planId deve integrar o gráfico geral TO');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior(toBehavior), 'Fonoaudiólogo'), false,
  'comportamento TO não pode aparecer nos gráficos Fono');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior([{ ...toBehavior[0], specialty: '' }]), 'Terapeuta Ocupacional'), false,
  'ausência de especialidade não deve ser inferida');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior([toBehavior[0], { ...toBehavior[1], specialty: 'Fonoaudiólogo' }]), 'Terapeuta Ocupacional'), false,
  'série de origem mista não pode ser atribuída à especialidade');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior([{ ...toBehavior[0], planId: 'other-plan' }]), 'Terapeuta Ocupacional'), false,
  'planId de outro plano impede associação automática');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior([{ ...toBehavior[0], metadata: { plan_id: 'other-plan' } }]), 'Terapeuta Ocupacional'), false,
  'vínculo de plano em metadata também impede associação automática');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior([{ ...toBehavior[0], goalId: 'other-goal' }]), 'Terapeuta Ocupacional'), false,
  'objetivo existente não pode ser remapeado para outro plano');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(summary(toBehavior), 'Terapeuta Ocupacional'), true,
  'source_family BEHAVIOR canônico permite origem comportamental mesmo em outra métrica');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(summary([{ ...toBehavior[0], metadata: {} }]), 'Terapeuta Ocupacional'), false,
  'métricas não comportamentais ficam fora da recuperação P1-15');
assert.equal(unscopedBehaviorSeriesBelongsToSpecialty(behavior(toBehavior), 'Especialidade livre desconhecida'), false,
  'especialidade não canônica nunca pode apropriar evidência');

assert.match(dashboard, /unscopedBehaviorSeriesBelongsToSpecialty\(series, selectedPlan.specialty\)/,
  'P1-15/16: gráficos gerais de todas especialidades incluem apenas comportamento comprovadamente vinculado');
assert.match(dashboard, /data-testid="clinical-target-detail"/, 'P1-13: todas especialidades usam o mesmo gráfico detalhado por alvo');
assert.match(dashboard, /<SeriesChart series=\{series\}/, 'P1-13: evidência por alvo preserva sua unidade clínica');
assert.match(ptsSelector, /\.\.\.specialtyPlanIds/,
  'PTS inclui os planos por especialidade já autorizados, mesmo sem vínculo explícito ao goal');
assert.match(ptsSelector, /contribution\.link && contribution\.specialtyPlan\?\.id/,
  'P1-14: contribuições vinculadas exigem ID explícito, nunca apenas nome de especialidade');
assert.match(ptsSelector, /selected\.set\(series\.key, series\)/,
  'P1-14: deduplicação por identidade canônica evita duplicar série clínica no PTS');
assert.match(ptsSelector, /const isUnscopedBehavior = !hasExplicitScope/,
  'comportamentos com vínculo explícito a plano externo não entram por fallback');

// A completed session must invalidate the same patient-scoped analytics cache
// immediately, not wait for staleMs/F5. Deferred/offline closures do not
// announce persistence before the server has confirmed it.
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const completionStart = dataService.indexOf('async completeAbaSession(sessionId: string, payload: any)');
const completionEnd = dataService.indexOf('async ', completionStart + 20);
assert.ok(completionStart > 0 && completionEnd > completionStart, 'completion service method found');
const completion = dataService.slice(completionStart, completionEnd);
assert.match(completion, /if \(completionAttempt\.response\.ok\) \{[\s\S]*?completionAttempt\.result\?\.success === true[\s\S]*?pending !== true[\s\S]*?notifyClinicalOutcomesChanged\(/,
  'only a confirmed successful session close invalidates the patient graph cache');
assert.ok(completion.indexOf('notifyClinicalOutcomesChanged(') > completion.indexOf('if (completionAttempt.response.ok)'),
  'pending, unsaved, failed or offline closure must not pretend charts were persisted');

console.log('clinicalOutcomePlanScope.regression.test.ts: ok');
