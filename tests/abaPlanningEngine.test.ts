import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptRecommendationForNextSession,
  abaRecommendationPriorityLabel,
  abaRecommendationTypeLabel,
  buildAbaRecommendationSemanticKey,
  deduplicateAbaRecommendationsForDecisionQueue,
  formatAbaRecommendationTitle,
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

test('titulo legado decodifica entidades e usa aspas tipograficas sem executar HTML', () => {
  assert.equal(
    formatAbaRecommendationTitle('Atenção para regressão em &quot;alvo do PEI&quot;'),
    'Atenção para regressão em “alvo do PEI”'
  );
  assert.equal(
    translateAbaRecommendationText('&lt;script&gt;alert(1)&lt;/script&gt;'),
    '<script>alert(1)</script>'
  );
});

test('quatro regressões do mesmo alvo, motivo e janela resultam em um card', () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `regression-${index + 1}`,
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    source_session_id: `session-${index + 1}`,
    recommendation_type: 'REGRESSION_ATTENTION',
    priority: 'HIGH',
    title: 'Atenção para regressão em &quot;alvo do PEI&quot;',
    summary: '2 probes consecutivos abaixo do critério.',
    rationale: 'Há alerta ativo.',
    suggested_action: 'Revisar dados recentes.',
    target_id: 'target-1',
    metric_name: 'regression_alert',
    evidence: {
      alertId: `alert-${index + 1}`,
      createdAt: `2026-05-2${index + 4}T10:00:00.000Z`
    },
    status: 'SUGGESTED',
    context_hash: `context-${index + 1}`,
    created_at: `2026-05-2${index + 1}T12:00:00.000Z`
  }));
  const queue = deduplicateAbaRecommendationsForDecisionQueue(rows);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].groupedCount, 4);
  assert.equal(formatAbaRecommendationTitle(queue[0].title), 'Atenção para regressão em “alvo do PEI”');
});

test('manutenção idêntica entre sessões reutiliza a mesma sugestão persistida', () => {
  const first = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  });
  const second = generateNextSessionRecommendations({
    ...baseInput,
    sourceSessionId: 'session-2',
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    existingRecommendations: first.recommendations
  });
  assert.equal(second.reusedExisting, true);
  assert.equal(second.recommendations.length, 1);
  assert.equal(second.recommendations[0].id, first.recommendations[0].id);
});

test('manutenção legada sem chave explícita é reconciliada sem criar outro card', () => {
  const initial = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    maintenanceSchedules: []
  });
  const legacy = {
    ...initial.recommendations[0],
    id: 'legacy-maintenance',
    source_session_id: 'legacy-session',
    evidence: {
      source: 'summary_driven',
      nextProbe: {
        status: 'NO_SCHEDULE',
        noSchedule: true
      }
    }
  };
  const regenerated = generateNextSessionRecommendations({
    ...baseInput,
    sourceSessionId: 'new-session',
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })],
    maintenanceSchedules: [],
    existingRecommendations: [legacy]
  });
  assert.equal(regenerated.recommendations.length, 1);
  assert.equal(regenerated.recommendations[0].id, 'legacy-maintenance');
  assert.equal(regenerated.reusedExisting, true);
});

test('regressão legada usa a janela clínica canônica e não reaparece em nova sessão', () => {
  const regressionAlert = {
    id: 'alert-legacy',
    target_id: 'target-1',
    severity: 'HIGH',
    message: '2 probes consecutivos abaixo do critério.',
    created_at: '2026-05-27T10:00:00.000Z'
  };
  const initial = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BALANCED',
    regressionAlerts: [regressionAlert]
  });
  const legacy = {
    ...initial.recommendations[0],
    id: 'legacy-regression',
    source_session_id: 'legacy-session',
    evidence: {
      source: 'summary_driven',
      alertId: 'alert-legacy',
      createdAt: regressionAlert.created_at
    }
  };
  const regenerated = generateNextSessionRecommendations({
    ...baseInput,
    sourceSessionId: 'new-session',
    focusType: 'BALANCED',
    regressionAlerts: [regressionAlert],
    existingRecommendations: [legacy]
  });
  assert.equal(regenerated.recommendations.length, 1);
  assert.equal(regenerated.recommendations[0].id, 'legacy-regression');
  assert.equal(regenerated.reusedExisting, true);
});

test('alertas distintos do mesmo alvo, motivo e janela geram um único card', () => {
  const result = generateNextSessionRecommendations({
    ...baseInput,
    focusType: 'BALANCED',
    regressionAlerts: Array.from({ length: 4 }, (_, index) => ({
      id: `alert-${index + 1}`,
      target_id: 'target-1',
      severity: 'HIGH',
      message: '2 probes consecutivos abaixo do critério.',
      created_at: `2026-05-2${index + 4}T10:00:00.000Z`
    }))
  });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].recommendation_type, 'REGRESSION_ATTENTION');
  assert.deepEqual(
    new Set(result.recommendations[0].evidence.relatedSourceIds),
    new Set(['alert-1', 'alert-2', 'alert-3', 'alert-4'])
  );
});

test('requisições concorrentes para o mesmo ciclo geram o mesmo ID idempotente', () => {
  const input = {
    ...baseInput,
    focusType: 'MAINTENANCE',
    targets: [target({ clinical_status: 'MAINTENANCE' })]
  };
  const left = generateNextSessionRecommendations(input);
  const right = generateNextSessionRecommendations(input);
  assert.equal(left.recommendations[0].id, right.recommendations[0].id);
  assert.equal(
    buildAbaRecommendationSemanticKey(left.recommendations[0]),
    buildAbaRecommendationSemanticKey(right.recommendations[0])
  );
});

test('chave semântica preserva alvos, pacientes e organizações diferentes', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'MAINTENANCE_PROBE',
    target_id: 'target-1',
    metric_name: 'maintenance_schedule',
    evidence: { reasonCode: 'maintenance_probe_due', clinicalWindowKey: 'maintenance-unscheduled:initial' }
  };
  const keys = [
    buildAbaRecommendationSemanticKey(common),
    buildAbaRecommendationSemanticKey({ ...common, target_id: 'target-2' }),
    buildAbaRecommendationSemanticKey({ ...common, patient_id: 'patient-2' }),
    buildAbaRecommendationSemanticKey({ ...common, organization_id: 'clinic-2' })
  ];
  assert.equal(new Set(keys).size, 4);
});

test('ciclos clínicos diferentes continuam como sugestões distintas', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'MAINTENANCE_PROBE',
    target_id: 'target-1',
    metric_name: 'maintenance_schedule',
    status: 'SUGGESTED'
  };
  const queue = deduplicateAbaRecommendationsForDecisionQueue([
    { ...common, id: 'cycle-1', evidence: { reasonCode: 'maintenance_probe_due', clinicalWindowKey: 'schedule-1' } },
    { ...common, id: 'cycle-2', evidence: { reasonCode: 'maintenance_probe_due', clinicalWindowKey: 'schedule-2' } }
  ]);
  assert.equal(queue.length, 2);
});

test('estado editado prevalece sobre duplicata pendente sem remover o histórico', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'REGRESSION_ATTENTION',
    target_id: 'target-1',
    metric_name: 'regression_alert',
    title: 'Atenção para regressão',
    evidence: { reasonCode: 'unresolved_regression_alert', clinicalWindowKey: 'probe-result:probe-1' }
  };
  const queue = deduplicateAbaRecommendationsForDecisionQueue([
    { ...common, id: 'original', status: 'SUGGESTED', updated_at: '2026-05-27T10:00:00.000Z' },
    { ...common, id: 'edited', status: 'EDITED', updated_at: '2026-05-27T11:00:00.000Z' }
  ]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'edited');
  assert.equal(queue[0].status, 'EDITED');
  assert.deepEqual(new Set(queue[0].groupedRecommendationIds), new Set(['original', 'edited']));
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
  assert.match(serverCode, /canonicalizeAbaRecommendationRows/);
  assert.match(serverCode, /\.upsert\(payloads, \{ onConflict: 'id' \}\)/);
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
  assert.match(sessionModeCode, /planningDecisionInFlightRef/);
  assert.match(sessionModeCode, /formatAbaRecommendationTitle/);
  assert.doesNotMatch(sessionModeCode, /dangerouslySetInnerHTML/);
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
