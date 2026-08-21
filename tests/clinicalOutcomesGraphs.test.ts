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

const nullIsNotZero = summarizeClinicalOutcomeSeries([
  { ...base, id: 'missing', observedAt: '2026-07-23T10:00:00.000Z', value: null, missingReason: 'expected_not_collected' },
], new Date('2026-07-23T12:00:00.000Z'));
assert.equal(nullIsNotZero[0].evidenceState, 'no_data', 'ausência explícita nunca pode virar zero no gráfico');

const categorical = summarizeClinicalOutcomeSeries([
  { ...base, id: 'cat-1', metricKey: 'support_level', metricLabel: 'Nível de apoio', unit: '', value: null, valueText: 'Moderado', observedAt: '2026-07-20T10:00:00.000Z' },
], new Date('2026-07-23T12:00:00.000Z'));
assert.equal(categorical[0].evidenceState, 'baseline_only', 'categoria V3 é evidência válida mesmo sem valor numérico');
assert.equal(formatClinicalOutcomeValue(categorical[0].latestObservation), 'Moderado');

const mergedSources = summarizeClinicalOutcomeSeries([
  { ...base, id: 'legacy', source: 'professional_observation', observedAt: '2026-07-01T10:00:00.000Z', value: 20 },
  { ...base, id: 'v3', source: 'V3 canônico', observedAt: '2026-07-08T10:00:00.000Z', value: 30 },
], new Date('2026-07-09T00:00:00.000Z'));
assert.equal(mergedSources.length, 1, 'mudança da fonte legado → V3 não pode quebrar a continuidade da mesma série clínica');
assert.equal(mergedSources[0].source, 'V3 + histórico');

const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
assert.match(dashboard, /sem calcular média entre métricas incompatíveis/i);
assert.match(dashboard, /Ausência de dados não é tratada como zero/);
assert.match(dashboard, /Dados ainda insuficientes para interpretar tendência/);
assert.match(dashboard, /Contribuição esperada, ainda sem vínculo explícito/);
assert.match(dashboard, /connectNulls=\{false\}/);
assert.match(dashboard, /minHeight=\{compact \? 112 : 208\}/, 'o container do gráfico deve respeitar a altura visual para não invadir o rodapé');
assert.match(dashboard, /tickMargin=\{compact \? 6 : 8\}/, 'o eixo X deve reservar distância visual da série');
assert.match(dashboard, /V3 canônico/);
assert.match(dashboard, /verto:clinical-outcomes-changed/);
assert.match(dashboard, /categoricalMode/);

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(server, /clinical-outcomes-dashboard/);
assert.match(server, /doesNotAverageSpecialties: true/);
assert.match(server, /supabase\.rpc\('read_clinical_outcomes_converged_v3'/, 'dashboard deve usar uma única leitura bulk V3 convergente');
assert.match(server, /canonicalSource: 'CMV3_PLAN_PROJECTIONS_PLUS_ABA_V3_READ_MODEL'/);
assert.match(server, /mergeClinicalOutcomeRowsV3First/);
assert.match(server, /legacyFallbackPreserved: true/);
assert.match(server, /rawEventsRead: false/);
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
