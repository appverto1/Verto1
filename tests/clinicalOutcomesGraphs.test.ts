import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canCombineClinicalOutcomeSeries,
  formatClinicalOutcomeValue,
  summarizeClinicalOutcomeSeries,
} from '../src/utils/clinicalOutcomeAnalytics';

const base = {
  planId: 'plan-1',
  metricKey: 'functional_requests',
  metricLabel: 'Pedidos funcionais',
  unit: '%',
  direction: 'higher_is_better' as const,
  specialty: 'Fonoaudiologia',
  context: 'clinic',
  source: 'professional_observation',
};

const observations = [
  { ...base, id: '1', observedAt: '2026-07-01T10:00:00.000Z', value: 20, numerator: 2, denominator: 10 },
  { ...base, id: '2', observedAt: '2026-07-08T10:00:00.000Z', value: 30, numerator: 3, denominator: 10 },
  { ...base, id: '3', observedAt: '2026-07-15T10:00:00.000Z', value: 40, numerator: 4, denominator: 10 },
  { ...base, id: '4', observedAt: '2026-07-22T10:00:00.000Z', value: 50, numerator: 5, denominator: 10 },
];

const summaries = summarizeClinicalOutcomeSeries(observations, new Date('2026-07-23T00:00:00.000Z'));
assert.equal(summaries.length, 1);
assert.equal(summaries[0].evidenceState, 'sufficient');
assert.equal(summaries[0].visualTrend, 'up');
assert.equal(formatClinicalOutcomeValue(observations[3]), '5 de 10 — 50%');

assert.equal(canCombineClinicalOutcomeSeries(base, { ...base, context: 'home' }), true, 'contextos comparáveis podem compartilhar o mesmo gráfico');
assert.equal(canCombineClinicalOutcomeSeries(base, { ...base, unit: 'segundos' }), false, 'unidades incompatíveis não podem ser misturadas');
assert.equal(canCombineClinicalOutcomeSeries(base, { ...base, direction: 'lower_is_better' }), false, 'direções opostas não podem ser misturadas');

const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
assert.match(dashboard, /sem calcular média entre métricas incompatíveis/i);
assert.match(dashboard, /Ausência de dados não é tratada como zero/);
assert.match(dashboard, /Dados ainda insuficientes para interpretar tendência/);
assert.match(dashboard, /Contribuição esperada, ainda sem vínculo explícito/);
assert.match(dashboard, /connectNulls=\{false\}/);

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(server, /clinical-outcomes-dashboard/);
assert.match(server, /doesNotAverageSpecialties: true/);
assert.match(server, /clinical-observations/);
assert.match(server, /onConflict: 'organization_id,idempotency_key'/);
assert.match(server, /canEditTherapeuticPlanScope/);
assert.match(server, /Promise\.all\(\[/, 'endpoint deve carregar dados em lote');

const migration = fs.readFileSync('supabase/migrations/20260803170000_clinical_outcomes_graphs_v2.sql', 'utf8');
for (const table of ['clinical_measure_definitions', 'clinical_observations', 'clinical_goal_contributions', 'clinical_plan_phases']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
}
assert.match(migration, /therapeutic_plan_current_actor_can_access_v1/);
assert.doesNotMatch(migration, /delete from public\./i);

console.log('clinicalOutcomesGraphs.test.ts: ok');
