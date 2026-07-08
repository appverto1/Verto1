import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptRecommendationForNextSession,
  abaRecommendationPriorityLabel,
  abaRecommendationTypeLabel,
  deduplicateAbaRecommendationsForDecisionQueue,
  generateNextSessionRecommendations,
  rejectRecommendation,
  translateAbaRecommendationText
} from '../src/utils/abaPlanningEngine.ts';

const root = process.cwd();
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260527120000_aba_next_session_planning.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const baseInput = {
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sourceSessionId: 'session-1',
  supervisorId: 'supervisor-1',
  now: '2026-05-27T12:00:00.000Z'
};

const target = (overrides: any = {}) => ({
  id: overrides.id || 'target-1',
  target_id: overrides.target_id || overrides.id || 'target-1',
  name: overrides.name || 'Nomeia cores',
  clinical_status: overrides.clinical_status || 'ACQUISITION',
  updated_at: overrides.updated_at || '2026-05-27T10:00:00.000Z',
  ...overrides
});

const snapshot = (overrides: any = {}) => ({
  id: overrides.id || `snap-${overrides.metric_type || 'accuracy'}`,
  target_id: overrides.target_id || 'target-1',
  metric_type: overrides.metric_type || 'accuracy_percent',
  metric_label: overrides.metric_label || overrides.metric_type || 'Acuracia',
  metric_value: overrides.metric_value ?? 70,
  previous_value: overrides.previous_value ?? 60,
  updated_at: overrides.updated_at || '2026-05-27T10:00:00.000Z',
  ...overrides
});

const types = (result: any) => result.recommendations.map((item: any) => item.recommendation_type);

test('maintenance vencida gera MAINTENANCE_PROBE', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    maintenanceSchedules: [{
      id: 'sched-1',
      target_id: 'target-1',
      status: 'PENDING',
      target_due_date: '2026-05-20T12:00:00.000Z',
      scheduled_for: '2026-05-20T12:00:00.000Z',
      updated_at: '2026-05-20T12:00:00.000Z'
    }]
  });
  assert.equal(types(result)[0], 'MAINTENANCE_PROBE');
  assert.equal(result.recommendations[0].priority, 'HIGH');
});

test('target em manutencao sem schedule gera recomendacao de agendamento', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    maintenanceSchedules: []
  });
  assert.equal(result.recommendations[0].recommendation_type, 'MAINTENANCE_PROBE');
  assert.match(result.recommendations[0].suggested_action, /Agendar sondagem de manutenção/);
});

test('regression alert gera REGRESSION_ATTENTION', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BALANCED',
    regressionAlerts: [{ id: 'alert-1', target_id: 'target-1', severity: 'HIGH', message: 'Risco ativo', created_at: '2026-05-27T10:00:00.000Z' }]
  });
  assert.equal(types(result)[0], 'REGRESSION_ATTENTION');
  assert.equal(result.recommendations[0].priority, 'CRITICAL');
});

test('criterio atingido gera MASTERY_REVIEW', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MASTERY_REVIEW',
    masteryEvaluations: [{ id: 'eval-1', target_id: 'target-1', status: 'READY_FOR_REVIEW', accuracy_percent: 90, independence_percent: 90, evaluated_at: '2026-05-27T10:00:00.000Z' }]
  });
  assert.equal(types(result)[0], 'MASTERY_REVIEW');
});

test('acuracia alta + independencia baixa gera PROMPT_FADING', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BALANCED',
    metricSnapshots: [
      snapshot({ id: 'acc', metric_type: 'accuracy_percent', metric_value: 92, previous_value: 88 }),
      snapshot({ id: 'ind', metric_type: 'independence_percent', metric_value: 55, previous_value: 50 })
    ]
  });
  assert.ok(types(result).includes('PROMPT_FADING'));
});

test('comportamento aumentou gera BEHAVIOR_MONITORING', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BEHAVIOR_REDUCTION',
    behaviorDailySummaries: [{
      id: 'beh-1',
      behavior_id: 'behavior-1',
      metric_type: 'frequency',
      metric_value: 13,
      previous_value: 10,
      abc_count: 3,
      updated_at: '2026-05-27T10:00:00.000Z'
    }]
  });
  assert.equal(types(result)[0], 'BEHAVIOR_MONITORING');
});

test('comportamento aumentou + poucos ABC gera ABC_COLLECTION', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BEHAVIOR_REDUCTION',
    behaviorDailySummaries: [{
      id: 'beh-1',
      behavior_id: 'behavior-1',
      metric_type: 'frequency',
      metric_value: 15,
      previous_value: 10,
      abc_count: 0,
      updated_at: '2026-05-27T10:00:00.000Z'
    }]
  });
  assert.ok(types(result).includes('ABC_COLLECTION'));
});

test('focusType NEW_SKILLS nao sugere nova habilidade se ha alerta critico', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'NEW_SKILLS',
    targets: [target({ id: 'new-1', clinical_status: 'NOT_STARTED', phase: 'draft' })],
    regressionAlerts: [{ id: 'alert-1', severity: 'HIGH', created_at: '2026-05-27T10:00:00.000Z' }]
  });
  assert.ok(!types(result).includes('INTRODUCE_NEW_TARGET'));
});

test('BALANCED limita recomendacoes', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BALANCED',
    targets: [
      target({ id: 'm1', clinical_status: 'MAINTENANCE' }),
      target({ id: 'm2', clinical_status: 'MAINTENANCE' }),
      target({ id: 'm3', clinical_status: 'MAINTENANCE' }),
      target({ id: 'new-1', clinical_status: 'NOT_STARTED', phase: 'draft' })
    ],
    regressionAlerts: [{ id: 'alert-1', severity: 'LOW', created_at: '2026-05-27T10:00:00.000Z' }],
    metricSnapshots: [
      snapshot({ id: 'acc', target_id: 'target-x', metric_type: 'accuracy_percent', metric_value: 92, previous_value: 88 }),
      snapshot({ id: 'ind', target_id: 'target-x', metric_type: 'independence_percent', metric_value: 55, previous_value: 50 })
    ],
    behaviorDailySummaries: [{ id: 'beh-1', behavior_id: 'b1', metric_type: 'frequency', metric_value: 15, previous_value: 10, abc_count: 0 }]
  });
  assert.ok(result.recommendations.length <= 6);
});

test('context_hash evita duplicidade', () => {
  const first = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  });
  const second = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    existingRecommendations: first.recommendations
  });
  assert.equal(second.contextHash, first.contextHash);
  assert.equal(second.reusedExisting, true);
  assert.deepEqual(second.recommendations.map((item) => item.id), first.recommendations.map((item) => item.id));
});

test('aceitar cria next_session_plan_item', () => {
  const generated = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  });
  const accepted = acceptRecommendationForNextSession({
    recommendation: generated.recommendations[0],
    acceptedBy: 'supervisor-1',
    createPlanItem: true,
    now: baseInput.now
  });
  assert.equal(accepted.recommendation.status, 'APPLIED_TO_NEXT_SESSION');
  assert.equal(accepted.planItem?.status, 'PLANNED');
  assert.equal(accepted.planItem?.planned_trial_type, 'maintenance_probe');
});

test('rejeitar nao cria plano', () => {
  const generated = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  });
  const rejected = rejectRecommendation({
    recommendation: generated.recommendations[0],
    rejectedBy: 'supervisor-1',
    reason: 'Aguardar revisao',
    notes: 'Prioridade clinica sera outra',
    now: baseInput.now
  });
  assert.equal(rejected.recommendation.status, 'REJECTED');
  assert.equal(rejected.auditLog.new_status, 'REJECTED');
  assert.equal(rejected.auditLog.metadata.reason, 'Aguardar revisao');
  assert.equal(rejected.auditLog.metadata.notes, 'Prioridade clinica sera outra');
});

test('labels de sugestao clinica ficam em portugues', () => {
  assert.equal(abaRecommendationPriorityLabel('HIGH'), 'Alta');
  assert.equal(abaRecommendationPriorityLabel('MEDIUM'), 'Média');
  assert.equal(abaRecommendationTypeLabel('REGRESSION_ATTENTION'), 'Atenção para regressão');
  assert.equal(abaRecommendationTypeLabel('MAINTENANCE_PROBE'), 'Sondagem de manutenção');
  assert.equal(translateAbaRecommendationText('HIGH PROMPT_FADING target summary-driven Maintenance Probe'), 'Alta Redução gradual de ajuda alvo baseado no resumo clínico sondagem de manutenção');
});

test('fila de decisao deduplica sugestoes equivalentes', () => {
  const generated = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  });
  const duplicate = { ...generated.recommendations[0], id: 'duplicada' };
  const queue = deduplicateAbaRecommendationsForDecisionQueue([generated.recommendations[0], duplicate]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].groupedCount, 2);
});

test('infraestrutura de planning esta persistente, economica e sem select star', () => {
  assert.match(packageJson, /"test:aba-planning-engine"/);
  for (const tableName of [
    'aba_next_session_focuses',
    'aba_clinical_recommendations',
    'aba_next_session_plan_items',
    'aba_clinical_recommendation_audit_logs'
  ]) {
    assert.match(migrationSql, new RegExp(`create table if not exists public\\.${tableName}`, 'i'));
  }
  assert.match(serverCode, /generateNextSessionRecommendations/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/patients\/:patientId\/next-session\/recommendations\/generate'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/recommendations\/:recommendationId\/accept'/);
  assert.match(serverCode, /Informe o motivo da recusa/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/recommendations\/:recommendationId\/apply-to-next-session'/);
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

test('UI nao aplica sugestao sem aceite', () => {
  assert.match(sessionModeCode, /Planejamento sugerido para a pr.xima sess.o/);
  assert.match(sessionModeCode, /Fila de decis.o cl.nica/);
  assert.match(sessionModeCode, /handleAcceptRecommendation/);
  assert.match(sessionModeCode, /handleApplyPlanItemNow/);
  assert.match(sessionModeCode, /data-aba-recommendation-edit-modal/);
  assert.match(sessionModeCode, /data-aba-recommendation-reject-modal/);
  assert.match(sessionModeCode, /Motivo da recusa|Escolha o motivo da recusa/);
  assert.match(sessionModeCode, /abaRecommendationPriorityLabel/);
  assert.match(sessionModeCode, /abaRecommendationTypeLabel/);
  assert.doesNotMatch(sessionModeCode, /window\.prompt\('Editar acao sugerida'/);
  assert.doesNotMatch(sessionModeCode, /\{recommendation\.priority \|\| 'MEDIUM'\}/);
  assert.doesNotMatch(sessionModeCode, /\{recommendation\.recommendation_type\}/);
  assert.doesNotMatch(sessionModeCode, /aplique esta intervencao/i);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA planning engine checks: ${passed}/${tests.length}`);
