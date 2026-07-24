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
const identityV3MigrationSql = readFileSync(join(root, 'supabase/migrations/20260724180000_aba_recommendation_identity_v3.sql'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');

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
  const queue = deduplicateAbaRecommendationsForDecisionQueue([legacy, ...regenerated.recommendations]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].groupedCount, 2);
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
  const queue = deduplicateAbaRecommendationsForDecisionQueue([legacy, ...regenerated.recommendations]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].groupedCount, 2);
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
    { ...common, id: 'cycle-1', evidence: { reasonCode: 'maintenance_probe_due', clinicalCycleKeyV3: 'schedule-1' } },
    { ...common, id: 'cycle-2', evidence: { reasonCode: 'maintenance_probe_due', clinicalCycleKeyV3: 'schedule-2' } }
  ]);
  assert.equal(queue.length, 2);
});


test('identidade v3 ignora sessão, contexto, título, alertId e suggestionKey diagnóstica', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'REGRESSION_ATTENTION',
    target_id: 'target-1',
    metric_name: 'regression_alert',
    status: 'SUGGESTED'
  };
  const left = buildAbaRecommendationSemanticKey({
    ...common,
    source_session_id: 'session-a',
    context_hash: 'context-a',
    title: 'Ponto de atencao para regressao',
    evidence: { alertId: 'alert-a', suggestionKey: 'legacy-a', clinicalWindowKey: 'week-a' }
  });
  const right = buildAbaRecommendationSemanticKey({
    ...common,
    source_session_id: 'session-b',
    context_hash: 'context-b',
    title: 'Atenção para regressão em &quot;alvo do PEI&quot;',
    evidence: { alertId: 'alert-b', suggestionKey: 'legacy-b', clinicalWindowKey: 'week-b' }
  });
  assert.equal(left, right);
});

test('identidade v3 mantém alvos diferentes separados mesmo com o mesmo título', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'MAINTENANCE_PROBE',
    metric_name: 'maintenance_schedule',
    title: 'Agendar sondagem de manutenção: Nomeia 6 itens nao reforcadores',
    evidence: { clinicalCycleKeyV3: 'active' }
  };
  assert.notEqual(
    buildAbaRecommendationSemanticKey({ ...common, target_id: 'target-a' }),
    buildAbaRecommendationSemanticKey({ ...common, target_id: 'target-b' })
  );
});

test('identidade v3 trata skillId como o mesmo alvo canônico quando target_id está ausente ou é igual', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'MAINTENANCE_PROBE',
    metric_name: 'maintenance_schedule',
    evidence: { reasonCode: 'maintenance_probe_due', clinicalCycleKeyV3: 'active' }
  };
  const targetOnly = buildAbaRecommendationSemanticKey({ ...common, target_id: 'target-a' });
  const skillOnly = buildAbaRecommendationSemanticKey({ ...common, evidence: { ...common.evidence, skillId: 'target-a' } });
  const targetAndSameSkill = buildAbaRecommendationSemanticKey({ ...common, target_id: 'target-a', evidence: { ...common.evidence, skillId: 'target-a' } });
  assert.equal(targetOnly, skillOnly);
  assert.equal(targetOnly, targetAndSameSkill);
});

test('identidade v3 preserva janela clínica explícita para tipos fora de regressão e manutenção', () => {
  const common = {
    organization_id: 'clinic-1',
    patient_id: 'patient-1',
    recommendation_type: 'GENERALIZATION',
    target_id: 'target-a',
    metric_name: 'generalization_candidate'
  };
  assert.notEqual(
    buildAbaRecommendationSemanticKey({ ...common, evidence: { clinicalWindowKey: 'snapshot-a' } }),
    buildAbaRecommendationSemanticKey({ ...common, evidence: { clinicalWindowKey: 'snapshot-b' } })
  );
});

test('os 36 registros auditados convergem para oito grupos clínicos v3', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => ({ id: `r1-${index}`, recommendation_type: 'REGRESSION_ATTENTION', target_id: '1780494368466' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `r2-${index}`, recommendation_type: 'REGRESSION_ATTENTION', target_id: '1780420265023' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `r3-${index}`, recommendation_type: 'REGRESSION_ATTENTION', target_id: '1780420265939' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `r4-${index}`, recommendation_type: 'REGRESSION_ATTENTION', target_id: '1780420267884' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `m1-${index}`, recommendation_type: 'MAINTENANCE_PROBE', target_id: '6c3284c8-2a1e-509d-b6c0-018ba1c4b866' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `m2-${index}`, recommendation_type: 'MAINTENANCE_PROBE', target_id: 'c7b837c3-fc67-5d36-a5cb-04624a001649' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `m3-${index}`, recommendation_type: 'MAINTENANCE_PROBE', target_id: 'de65b3f1-bc01-5359-b650-b6c70678504a' })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `m4-${index}`, recommendation_type: 'MAINTENANCE_PROBE', target_id: 'd089666d-b4e2-5890-8dd9-2219adb200d2' }))
  ].map((row) => ({
    ...row,
    organization_id: '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6',
    patient_id: '1ede0f1a-af0e-4c49-94b4-7d9bd81dac23',
    metric_name: row.recommendation_type === 'REGRESSION_ATTENTION' ? 'regression_alert' : 'maintenance_schedule',
    evidence: { clinicalCycleKeyV3: 'active' }
  }));
  assert.equal(rows.length, 36);
  assert.equal(new Set(rows.map(buildAbaRecommendationSemanticKey)).size, 8);
});

test('migration v3 reconstrói identidade no banco e preserva conflito terminal', () => {
  assert.match(identityV3MigrationSql, /suggestion_key_v3 text/i);
  assert.match(identityV3MigrationSql, /aba_recommendation_semantic_material_v3/i);
  assert.match(identityV3MigrationSql, /CONTRADICTORY_TERMINAL_DECISIONS/);
  assert.match(identityV3MigrationSql, /TERMINAL_CONFLICT_DETECTED/);
  assert.match(identityV3MigrationSql, /upsert_aba_clinical_recommendations_v3/);
  assert.match(identityV3MigrationSql, /apply_aba_clinical_recommendation_decision_v3/);
  assert.match(identityV3MigrationSql, /for update/i);
  assert.match(identityV3MigrationSql, /idempotency_key/);
  assert.match(identityV3MigrationSql, /aba_recommendation_audit_append_only/);
  assert.match(identityV3MigrationSql, /rec-v3-' \|\| public\.aba_recommendation_sha256\(\s*v_organization_id \|\| '\|' \|\| p_patient_id::text \|\| '\|' \|\| v_suggestion_key_v3/);
  assert.match(identityV3MigrationSql, /clientSuggestionKeyDiagnostic/);
  assert.match(identityV3MigrationSql, /revoke all on function public\.aba_can_read_recommendation_scope_v3/);
  assert.match(identityV3MigrationSql, /grant execute on function public\.aba_can_read_recommendation_scope_v3[\s\S]*to authenticated, service_role/);
  const semanticFunction = identityV3MigrationSql.match(/create or replace function public\.aba_recommendation_semantic_material_v3\([\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.ok(semanticFunction);
  assert.doesNotMatch(semanticFunction, /suggestionKey|source_session_id|context_hash|alertId|snapshotId|title/i);
});

test('servidor usa tenant autenticado e RPC v3 antes da paginação', () => {
  assert.match(serverCode, /const organizationId = clinicId;/);
  assert.match(serverCode, /upsert_aba_clinical_recommendations_v3/);
  assert.match(serverCode, /apply_aba_clinical_recommendation_decision_v3/);
  assert.match(serverCode, /\.is\('canonical_recommendation_id', null\)/);
  assert.match(serverCode, /\.neq\('status', 'SUPERSEDED'\)/);
  assert.match(dataServiceCode, /abaDecisionIdempotencyKeys/);
  assert.match(dataServiceCode, /idempotencyKey/);
  assert.match(serverCode, /groupedRecommendationIds: persisted\.groupedRecommendationIds \|\| \[\]/);
  const queueRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/aba/patients/:patientId/next-session/recommendations'"),
    serverCode.indexOf("app.post('/api/aba/patients/:patientId/next-session/recommendations/generate'")
  );
  assert.ok(queueRoute);
  assert.doesNotMatch(queueRoute, /\.eq\('source_session_id'/);
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
  assert.match(serverCode, /upsert_aba_clinical_recommendations_v3/);
  assert.match(serverCode, /apply_aba_clinical_recommendation_decision_v3/);
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
  assert.match(sessionModeCode, /deduplicateAbaRecommendationsForDecisionQueue\(\[\s*\.\.\.generatedRows,\s*\.\.\.previous/);
  assert.match(sessionModeCode, /Conflito histórico entre aceite e recusa preservado/);
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
