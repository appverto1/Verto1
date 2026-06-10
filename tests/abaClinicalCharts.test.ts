import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aggregateClinicalChangesBySession,
  aggregateAbaClinicalLinePoints,
  buildAbaClinicalLinePointsFromTargetSummaries,
  buildAbaClinicalLineSummary,
  buildSessionMetricSnapshotsFromSummaries,
  compareAbaMetric,
  compareSessionMetrics,
  getClinicalChangeDrilldown,
  getAbaMetricDirection
} from '../src/utils/abaClinicalCharts.ts';

const root = process.cwd();
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260525173000_aba_clinical_charts.sql'), 'utf8');
const durationEpisodeMetricMigration = readFileSync(join(root, 'supabase/migrations/20260531130000_aba_duration_episode_metric.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const panelCode = readFileSync(join(root, 'src/components/AbaClinicalChartsPanel.tsx'), 'utf8');
const safeResponsiveContainerCode = readFileSync(join(root, 'src/components/SafeResponsiveContainer.tsx'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('migration cria snapshots e anotações com escopo clínico', () => {
  for (const tableName of ['aba_session_metric_snapshots', 'aba_graph_annotations']) {
    assert.match(migrationSql, new RegExp(`create table if not exists public\\.${tableName}`, 'i'));
    assert.match(migrationSql, new RegExp(`${tableName}[\\s\\S]*?organization_id text not null`, 'i'));
    assert.match(migrationSql, new RegExp(`${tableName}[\\s\\S]*?clinic_id text not null`, 'i'));
    assert.match(migrationSql, new RegExp(`alter table public\\.${tableName} enable row level security`, 'i'));
    assert.match(migrationSql, new RegExp(`${tableName}_patient_scope_rw`, 'i'));
  }
  assert.match(migrationSql, /metric_type text not null[\s\S]*?TARGET_ACCURACY[\s\S]*?BEHAVIOR_FREQUENCY[\s\S]*?MAINTENANCE_STATUS/i);
  assert.match(durationEpisodeMetricMigration, /aba_session_metric_snapshots_metric_type_check[\s\S]*?BEHAVIOR_DURATION_EPISODES/i);
  assert.match(migrationSql, /annotation_type text not null[\s\S]*?GOAL_LINE[\s\S]*?CONDITION_LINE[\s\S]*?NOTE/i);
});

test('directionality está configurada por métrica', () => {
  assert.equal(getAbaMetricDirection('TARGET_ACCURACY'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('TARGET_INDEPENDENCE'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('FUNCTIONAL_COMMUNICATION'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('ENGAGEMENT'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('BEHAVIOR_FREQUENCY'), 'LOWER_IS_BETTER');
  assert.equal(getAbaMetricDirection('BEHAVIOR_DURATION_EPISODES'), 'LOWER_IS_BETTER');
  assert.equal(getAbaMetricDirection('BEHAVIOR_DURATION_TOTAL'), 'LOWER_IS_BETTER');
  assert.equal(getAbaMetricDirection('BEHAVIOR_INTERVAL_OCCURRENCE'), 'LOWER_IS_BETTER');
  assert.equal(getAbaMetricDirection('MASTERY_STATUS'), 'STATUS_BASED');
  assert.equal(getAbaMetricDirection('MAINTENANCE_STATUS'), 'STATUS_BASED');
});

test('primeira medição retorna FIRST_MEASUREMENT', () => {
  const result = compareAbaMetric({ metricType: 'TARGET_ACCURACY', metricValue: 60 });
  assert.equal(result.changeStatus, 'FIRST_MEASUREMENT');
  assert.equal(result.trendDirection, 'INSUFFICIENT_DATA');
  assert.equal(result.statusLabel, 'Primeira medição');
});

test('métrica percentual usa pontos percentuais e nunca variação relativa explosiva', () => {
  const result = compareAbaMetric({ metricType: 'TARGET_INDEPENDENCE', previousValue: 1, metricValue: 54 });
  assert.equal(result.trendDirection, 'IMPROVED');
  assert.equal(result.changeStatus, 'CLINICALLY_SIGNIFICANT_CHANGE');
  assert.equal(result.deltaValue, 53);
  assert.equal(result.deltaPercent, 53);
  assert.notEqual(result.deltaPercent, 5300);
  assert.equal(result.statusLabel, 'Melhora relevante');
});

test('melhora em target é interpretada por p.p. e threshold clínico', () => {
  const result = compareAbaMetric({ metricType: 'TARGET_INDEPENDENCE', previousValue: 60, metricValue: 80 });
  assert.equal(result.trendDirection, 'IMPROVED');
  assert.equal(result.changeStatus, 'CLINICALLY_SIGNIFICANT_CHANGE');
  assert.equal(result.deltaPercent, 20);
  assert.equal(result.statusLabel, 'Melhora relevante');
});

test('mudança percentual menor que 5 p.p. é estável e 5 a 9 p.p. é leve', () => {
  const stable = compareAbaMetric({ metricType: 'TARGET_ACCURACY', previousValue: 80, metricValue: 84.9 });
  assert.equal(stable.trendDirection, 'STABLE');
  assert.equal(stable.changeStatus, 'NO_CHANGE');

  const mild = compareAbaMetric({ metricType: 'TARGET_ACCURACY', previousValue: 80, metricValue: 88 });
  assert.equal(mild.trendDirection, 'IMPROVED');
  assert.equal(mild.changeStatus, 'CHANGED');
});

test('redução de comportamento é IMPROVED e aumento é WORSENED', () => {
  const reduced = compareAbaMetric({ metricType: 'BEHAVIOR_FREQUENCY', previousValue: 4, metricValue: 1 });
  assert.equal(reduced.trendDirection, 'IMPROVED');
  assert.equal(reduced.deltaPercent, -75);
  assert.equal(reduced.statusLabel, 'Melhorou nesta sessão');

  const increased = compareAbaMetric({ metricType: 'BEHAVIOR_DURATION_TOTAL', previousValue: 30, metricValue: 60 });
  assert.equal(increased.trendDirection, 'WORSENED');
  assert.equal(increased.deltaPercent, 100);
  assert.equal(increased.statusLabel, 'Piorou nesta sessão');
});

test('valor anterior zero não gera percentual infinito em contagem de comportamento', () => {
  const firstIncrease = compareAbaMetric({ metricType: 'BEHAVIOR_FREQUENCY', previousValue: 0, metricValue: 3 });
  assert.equal(firstIncrease.trendDirection, 'WORSENED');
  assert.equal(firstIncrease.deltaValue, 3);
  assert.equal(firstIncrease.deltaPercent, null);
});

test('READY_FOR_REVIEW e REGRESSION_RISK viram status clínico correto', () => {
  const ready = compareAbaMetric({
    metricType: 'MASTERY_STATUS',
    previousValue: 2,
    metricValue: 3,
    previousStatus: 'MET_TODAY',
    currentStatus: 'READY_FOR_REVIEW'
  });
  assert.equal(ready.changeStatus, 'CLINICALLY_SIGNIFICANT_CHANGE');
  assert.equal(ready.statusLabel, 'Pronto para revisão');

  const regression = compareAbaMetric({
    metricType: 'MAINTENANCE_STATUS',
    previousValue: 3,
    metricValue: -1,
    previousStatus: 'MAINTAINED',
    currentStatus: 'REGRESSION_RISK'
  });
  assert.equal(regression.changeStatus, 'REGRESSION_SIGNAL');
  assert.equal(regression.trendDirection, 'WORSENED');
  assert.equal(regression.statusLabel, 'Sinal de regressão');
});

test('compareSessionMetrics calcula deltas por sessão e por direção', () => {
  const currentSummary = {
    id: 'summary-current',
    session_id: 'session-current',
    patient_id: 'patient-1',
    clinic_id: 'clinic-1',
    organization_id: 'clinic-1',
    ended_at: '2026-05-25T12:00:00.000Z',
    frequency_summary: [{ behaviorName: 'Agressão', occurrences: 1 }],
    mastery_summary: [{ targetId: 'target-1', name: 'Nomeia cores', statusCode: 'READY_FOR_REVIEW' }]
  };
  const previousSummary = {
    id: 'summary-previous',
    session_id: 'session-previous',
    patient_id: 'patient-1',
    clinic_id: 'clinic-1',
    organization_id: 'clinic-1',
    ended_at: '2026-05-24T12:00:00.000Z',
    frequency_summary: [{ behaviorName: 'Agressão', occurrences: 4 }],
    mastery_summary: [{ targetId: 'target-1', name: 'Nomeia cores', statusCode: 'MET_TODAY' }]
  };
  const snapshots = compareSessionMetrics('session-current', 'session-previous', {
    currentSummary,
    previousSummary,
    currentTargetSummaries: [{ target_id: 'target-1', target_name: 'Nomeia cores', accuracy_percent: 80, independence_percent: 80, attempts_today: 5 }],
    previousTargetSummaries: [{ target_id: 'target-1', target_name: 'Nomeia cores', accuracy_percent: 60, independence_percent: 60, attempts_today: 5 }]
  });
  const independence = snapshots.find((item) => item.metricType === 'TARGET_INDEPENDENCE');
  const behavior = snapshots.find((item) => item.metricType === 'BEHAVIOR_FREQUENCY');
  const mastery = snapshots.find((item) => item.metricType === 'MASTERY_STATUS');
  assert.equal(independence?.trendDirection, 'IMPROVED');
  assert.equal(independence?.previousValue, 60);
  assert.equal(independence?.deltaPercent, 20);
  assert.equal(behavior?.trendDirection, 'IMPROVED');
  assert.equal(behavior?.deltaPercent, -75);
  assert.equal(mastery?.changeStatus, 'CLINICALLY_SIGNIFICANT_CHANGE');
});

test('aggregateClinicalChangesBySession consolida várias mudanças em uma barra por sessão', () => {
  const points = [
    {
      id: 'skill-1',
      sessionId: 'session-40',
      metricType: 'TARGET_INDEPENDENCE',
      metricLabel: 'Nomeia 2 itens',
      changedAt: '2026-05-25T12:00:00.000Z',
      previousValue: 0,
      metricValue: 100,
      deltaValue: 100,
      deltaPercent: 100,
      trendDirection: 'IMPROVED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      metricDirection: 'HIGHER_IS_BETTER'
    },
    {
      id: 'behavior-1',
      sessionId: 'session-40',
      metricType: 'BEHAVIOR_FREQUENCY',
      metricLabel: 'Agressão',
      changedAt: '2026-05-25T12:02:00.000Z',
      previousValue: 11,
      metricValue: 1,
      deltaValue: -10,
      deltaPercent: -91,
      trendDirection: 'IMPROVED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      metricDirection: 'LOWER_IS_BETTER'
    },
    {
      id: 'mastery-1',
      sessionId: 'session-40',
      metricType: 'MASTERY_STATUS',
      metricLabel: 'Contato visual',
      changedAt: '2026-05-25T12:04:00.000Z',
      previousValue: 2,
      metricValue: 3,
      currentStatus: 'READY_FOR_REVIEW',
      deltaValue: 1,
      deltaPercent: null,
      trendDirection: 'IMPROVED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      statusLabel: 'Pronto para revisão',
      metricDirection: 'STATUS_BASED'
    },
    {
      id: 'maintenance-1',
      sessionId: 'session-40',
      metricType: 'MAINTENANCE_STATUS',
      metricLabel: 'Probe de manutenção',
      changedAt: '2026-05-25T12:06:00.000Z',
      previousValue: 1,
      metricValue: 3,
      currentStatus: 'MAINTAINED',
      deltaValue: 2,
      deltaPercent: null,
      trendDirection: 'IMPROVED',
      changeStatus: 'CHANGED',
      metricDirection: 'STATUS_BASED'
    },
    {
      id: 'regression-1',
      sessionId: 'session-40',
      metricType: 'REGRESSION_RISK',
      metricLabel: 'Estereotipia',
      changedAt: '2026-05-25T12:08:00.000Z',
      previousValue: 3,
      metricValue: -1,
      currentStatus: 'REGRESSION_RISK',
      deltaValue: -4,
      deltaPercent: null,
      trendDirection: 'WORSENED',
      changeStatus: 'REGRESSION_SIGNAL',
      metricDirection: 'STATUS_BASED'
    }
  ];

  const groups = aggregateClinicalChangesBySession(points, { groupBy: 'session', visualMagnitudeCap: 120 });
  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.equal(group.totalChanges, 5);
  assert.equal(group.relevantChanges, 5);
  assert.equal(group.categoryCounts.skill, 1);
  assert.equal(group.categoryCounts.behavior, 1);
  assert.equal(group.categoryCounts.mastery, 1);
  assert.equal(group.categoryCounts.maintenance, 1);
  assert.equal(group.categoryCounts.regression, 1);
  assert.equal(group.skillMagnitude, 100);
  assert.equal(group.behaviorMagnitude, 91);
  assert.equal(group.masteryCount, 1);
  assert.equal(group.maintenanceCount, 1);
  assert.equal(group.regressionCount, 1);
  assert.equal(group.hasRegressionAlert, true);
  assert.equal(group.hasReviewReady, true);
  assert.equal(getClinicalChangeDrilldown(groups, group.groupKey)?.changes.length, 5);
});

test('aggregateClinicalChangesBySession agrupa por dia sem misturar eventos brutos', () => {
  const points = [
    {
      sessionId: 'session-a',
      metricType: 'TARGET_ACCURACY',
      metricLabel: 'Imitação',
      changedAt: '2026-05-25T09:00:00.000Z',
      previousValue: 40,
      metricValue: 60,
      deltaValue: 20,
      deltaPercent: 20,
      trendDirection: 'IMPROVED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      metricDirection: 'HIGHER_IS_BETTER'
    },
    {
      sessionId: 'session-b',
      metricType: 'BEHAVIOR_FREQUENCY',
      metricLabel: 'Agressão',
      changedAt: '2026-05-25T15:00:00.000Z',
      previousValue: 5,
      metricValue: 3,
      deltaValue: -2,
      deltaPercent: -40,
      trendDirection: 'IMPROVED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      metricDirection: 'LOWER_IS_BETTER'
    }
  ];

  const bySession = aggregateClinicalChangesBySession(points, { groupBy: 'session' });
  const byDay = aggregateClinicalChangesBySession(points, { groupBy: 'day' });
  assert.equal(bySession.length, 2);
  assert.equal(byDay.length, 1);
  assert.equal(byDay[0].groupKey, 'day:2026-05-25');
  assert.equal(byDay[0].totalChanges, 2);
  assert.equal(byDay[0].skillMagnitude, 20);
  assert.equal(byDay[0].behaviorMagnitude, 40);
});

test('aggregateClinicalChangesBySession cap visual preserva magnitude real de outlier', () => {
  const [group] = aggregateClinicalChangesBySession([
    {
      sessionId: 'session-outlier',
      metricType: 'BEHAVIOR_DURATION_TOTAL',
      metricLabel: 'Birra',
      changedAt: '2026-05-25T16:00:00.000Z',
      previousValue: 10,
      metricValue: 100,
      deltaValue: 90,
      deltaPercent: 900,
      trendDirection: 'WORSENED',
      changeStatus: 'CLINICALLY_SIGNIFICANT_CHANGE',
      metricDirection: 'LOWER_IS_BETTER'
    }
  ], { groupBy: 'session', visualMagnitudeCap: 120 });

  assert.equal(group.totalRawMagnitude, 900);
  assert.equal(group.totalVisualMagnitude, 120);
  assert.equal(group.behaviorMagnitude, 120);
  assert.equal(group.topChange?.rawMagnitude, 900);
  assert.equal(group.topChange?.visualMagnitude, 120);
});

test('aggregateClinicalChangesBySession mantem barra visivel para eventos reais com delta zero', () => {
  const points = Array.from({ length: 7 }, (_, index) => ({
    id: `behavior-zero-${index}`,
    sessionId: 'session-zero',
    metricType: 'BEHAVIOR_FREQUENCY',
    metricLabel: 'Choro',
    changedAt: `2026-06-05T12:0${index}:00.000Z`,
    previousValue: 0,
    metricValue: 0,
    deltaValue: 0,
    deltaPercent: 0,
    trendDirection: 'INSUFFICIENT_DATA',
    changeStatus: 'FIRST_MEASUREMENT',
    metricDirection: 'LOWER_IS_BETTER'
  }));

  const [group] = aggregateClinicalChangesBySession(points, { groupBy: 'day', visualMagnitudeCap: 120 });

  assert.equal(group.totalChanges, 7);
  assert.equal(group.relevantChanges, 7);
  assert.equal(group.categoryCounts.behavior, 7);
  assert.equal(group.behaviorMagnitude, 7);
  assert.equal(group.totalVisualMagnitude, 7);
  assert.equal(group.topChange?.rawMagnitude, 1);
  assert.equal(group.topChange?.visualMagnitude, 1);
});

test('buildSessionMetricSnapshotsFromSummaries cria snapshot geral quando não há target por sessão', () => {
  const snapshots = buildSessionMetricSnapshotsFromSummaries({
    currentSummary: { session_id: 's2', patient_id: 'p1', clinic_id: 'c1', ended_at: '2026-05-25T10:00:00.000Z', accuracy_percent: 90, independence_percent: 80 },
    previousSummary: { session_id: 's1', patient_id: 'p1', clinic_id: 'c1', ended_at: '2026-05-24T10:00:00.000Z', accuracy_percent: 70, independence_percent: 60 }
  });
  assert.ok(snapshots.some((item) => item.metricType === 'TARGET_ACCURACY' && item.trendDirection === 'IMPROVED'));
  assert.ok(snapshots.some((item) => item.metricType === 'TARGET_INDEPENDENCE' && item.previousValue === 60));
});

test('duration summary gera métrica de episódios derivada para gráficos', () => {
  const snapshots = buildSessionMetricSnapshotsFromSummaries({
    currentSummary: {
      session_id: 's2',
      patient_id: 'p1',
      clinic_id: 'c1',
      ended_at: '2026-05-25T10:00:00.000Z',
      duration_summary: [{ behaviorName: 'Choro', episodes: 2, totalSeconds: 120, averageSeconds: 60 }]
    },
    previousSummary: {
      session_id: 's1',
      patient_id: 'p1',
      clinic_id: 'c1',
      ended_at: '2026-05-24T10:00:00.000Z',
      duration_summary: [{ behaviorName: 'Choro', episodes: 1, totalSeconds: 40, averageSeconds: 40 }]
    }
  });
  const episodeSnapshot = snapshots.find((item) => item.metricType === 'BEHAVIOR_DURATION_EPISODES' && item.metricLabel === 'Choro');
  assert.equal(episodeSnapshot?.metricValue, 2);
  assert.equal(episodeSnapshot?.previousValue, 1);
  assert.ok(snapshots.some((item) => item.metricType === 'BEHAVIOR_DURATION_TOTAL' && item.metricValue === 120));
});

test('linha clínica de target retorna pontos por sessão e resumo econômico', () => {
  const rows = [
    {
      id: 'r1',
      session_id: 's1',
      session_label: 'Sessão 1',
      target_id: 'target-1',
      target_name: 'Contato visual',
      ended_at: '2026-05-25T10:00:00.000Z',
      accuracy_percent: 40,
      independence_percent: 30,
      prompted_today: 5,
      errors_today: 2,
      attempts_today: 10,
      most_used_prompt: 'Gestual'
    },
    {
      id: 'r2',
      session_id: 's2',
      session_label: 'Sessão 2',
      target_id: 'target-1',
      target_name: 'Contato visual',
      ended_at: '2026-05-26T10:00:00.000Z',
      accuracy_percent: 70,
      independence_percent: 60,
      prompted_today: 3,
      errors_today: 1,
      attempts_today: 10,
      most_used_prompt: 'Verbal'
    }
  ];
  const points = buildAbaClinicalLinePointsFromTargetSummaries(rows, { metric: 'TARGET_COMPARE_RESPONSES', groupBy: 'session' });
  assert.equal(points.length, 2);
  assert.equal(points[1].secondaryValues?.accuracyPct, 70);
  assert.equal(points[1].secondaryValues?.independencePct, 60);
  assert.equal(points[1].secondaryValues?.promptedPct, 30);
  assert.equal(points[1].secondaryValues?.errorPct, 10);
  assert.equal(points[1].attemptsCount, 10);

  const weekly = aggregateAbaClinicalLinePoints(points, 'week', 'TARGET_COMPARE_RESPONSES');
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].attemptsCount, 20);
  assert.equal(weekly[0].secondaryValues?.accuracyPct, 55);

  const summary = buildAbaClinicalLineSummary(points);
  assert.equal(summary.currentValue, 60);
  assert.equal(summary.previousValue, 30);
  assert.equal(summary.delta, 30);
});

test('backend expõe endpoints ABA summary-driven com selects explícitos', () => {
  for (const route of [
    '/api/aba/patients/:patientId/clinical-line-chart',
    '/api/aba/patients/:patientId/charts/targets',
    '/api/aba/patients/:patientId/charts/behaviors',
    '/api/aba/patients/:patientId/charts/mastery',
    '/api/aba/patients/:patientId/charts/maintenance',
    '/api/aba/patients/:patientId/charts/session-changes',
    '/api/aba/patients/:patientId/charts/overview'
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[/:]/g, (match) => (match === '/' ? '\\/' : match)), 'm'), `${route} deve existir.`);
  }
  assert.match(serverCode, /const ABA_SESSION_METRIC_SNAPSHOT_SELECT = \[[\s\S]*?metric_value[\s\S]*?change_status[\s\S]*?\]\.join\(','\)/m);
  assert.match(serverCode, /buildSessionMetricSnapshots\(sessionId\)/);
  assert.match(serverCode, /fetchAbaSnapshotRows\({[\s\S]*?metricTypes: targetMetrics/m);
  assert.match(serverCode, /from\('aba_behavior_daily_summaries'\)[\s\S]*?select\(ABA_BEHAVIOR_DAILY_CHART_SELECT\)/m);
  assert.match(serverCode, /BEHAVIOR_DURATION_EPISODES[\s\S]*?duration_episode_count/m);
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

test('frontend carrega gráficos ABA sem chunk lazy dedicado e usa dataService dedicado', () => {
  assert.match(patientDetailCode, /import \{ AbaClinicalChartsPanel \} from '\.\/AbaClinicalChartsPanel'/);
  assert.doesNotMatch(patientDetailCode, /const AbaClinicalChartsPanel = React\.lazy/);
  assert.match(patientDetailCode, /activeTab === 'aba-charts'[\s\S]*?<AbaClinicalChartsPanel/m);
  assert.match(panelCode, /dataService\.getAbaClinicalChart\(patientId, tab as any/);
  assert.match(panelCode, /chartTabs[\s\S]*?Mudanças por sessão/);
  assert.match(panelCode, /viewMode[\s\S]*?'line'/);
  assert.match(panelCode, /LineFilters/);
  assert.match(panelCode, /ClinicalLineTooltip/);
  assert.match(panelCode, /dataService\.getAbaClinicalLineChart/);
  assert.match(panelCode, /BEHAVIOR_DURATION_EPISODES/);
  assert.match(dataServiceCode, /async getAbaClinicalChart\(patientId: string, chart:/);
  assert.match(dataServiceCode, /async getAbaClinicalLineChart\(patientId: string/);
  assert.match(dataServiceCode, /async saveAbaGraphAnnotation\(patientId: string/);
});

test('frontend apresenta deltas clínicos, status e timelines sem misturar escalas', () => {
  assert.match(panelCode, /formatDelta[\s\S]*?p\.p\./m, 'Deltas percentuais devem ser exibidos em pontos percentuais.');
  assert.doesNotMatch(panelCode, /\$\{Number\(point\.deltaPercent\)\.toFixed\(1\)\}%/, 'Painel não deve renderizar delta percentual cru.');
  assert.match(panelCode, /overviewCards[\s\S]*?Maior melhora em habilidade[\s\S]*?Maior redução de comportamento[\s\S]*?Metas prontas para revisão[\s\S]*?Sinais de regressão[\s\S]*?Primeiras medições/m);
  assert.match(panelCode, /metricAxisLabels[\s\S]*?Acurácia \(%\)[\s\S]*?Independência \(%\)[\s\S]*?Ocorrências[\s\S]*?Duração total[\s\S]*?% de ocorrência por intervalo/m);
  assert.match(panelCode, /masteryBuckets/);
  assert.match(panelCode, /Dados insuficientes[\s\S]*?Critério não atingido[\s\S]*?Critério atingido hoje[\s\S]*?Pronto para revisão[\s\S]*?Maestria aprovada/m);
  assert.match(panelCode, /maintenanceTimeline/);
  assert.match(panelCode, /Sondagem pendente[\s\S]*?Mantido[\s\S]*?Em observação[\s\S]*?Risco de regressão[\s\S]*?Sondagem não realizada/m);
  assert.match(panelCode, /changeSentence[\s\S]*?previous[\s\S]*?current[\s\S]*?→/m);
  assert.match(panelCode, /GOAL_LINE/);
  assert.match(panelCode, /CONDITION_LINE/);
  assert.match(panelCode, /Evento externo/);
});

test('frontend usa visão agregada com drilldown em vez de plotar todos os targets', () => {
  assert.match(panelCode, /aggregateClinicalChangesBySession/);
  assert.match(panelCode, /getClinicalChangeDrilldown/);
  assert.match(panelCode, /showAggregatedChart[\s\S]*activeTab === 'overview'[\s\S]*activeTab === 'session-changes'/m);
  assert.match(panelCode, /\(activeTab === 'targets' && !hasSpecificTarget\)/);
  assert.match(panelCode, /\(activeTab === 'behaviors' && !hasSpecificBehavior\)/);
  assert.match(panelCode, /stackId="changes"/);
  assert.match(panelCode, /setSelectedChangeGroupKey/);
  assert.match(panelCode, /Linha do tempo clínica/);
  assert.match(panelCode, /Ver detalhes/);
  assert.match(panelCode, /<option value="">Todos<\/option>/);
  assert.match(panelCode, /!showAggregatedChart && chartRows\.length > 0/);
  assert.doesNotMatch(panelCode, /activeTab === 'session-changes' && chartRows\.length > 0/);
});

test('frontend evita textos genericos e ingles cru na camada visivel dos graficos ABA', () => {
  assert.doesNotMatch(panelCode, /label:\s*'Habilidade \/ Target'/);
  assert.doesNotMatch(panelCode, />Target</);
  assert.doesNotMatch(panelCode, /Target\/meta/);
  assert.doesNotMatch(panelCode, /Sem targets/);
  assert.doesNotMatch(panelCode, /Probe pendente|Watch|Missed|Masterizado aprovado|Manutencao|Acuracia|Independencia|Frequencia|Duracao|Episodios|Numero|Validas|Revisao|Ultimo|Sessao|Metrica clinica/);
  assert.doesNotMatch(panelCode, /magnitude real|real \/|0 real \/ 0 visual|sem destaque/);
  assert.match(panelCode, /Resumo da sessão sem item específico/);
  assert.match(panelCode, /Sem dados suficientes para interpretar/);
  assert.match(panelCode, /clinicalChangeBrief/);
  assert.match(panelCode, /translatedStatusLabel/);
});

test('script npm do épico está registrado', () => {
  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['test:aba-clinical-charts'], 'tsx tests/abaClinicalCharts.test.ts');
});

test('container responsivo mede dimensoes antes de montar graficos recharts', () => {
  assert.doesNotMatch(safeResponsiveContainerCode, /import\s*\{[\s\S]*ResponsiveContainer[\s\S]*\}\s*from\s*['"]recharts['"]/);
  assert.doesNotMatch(safeResponsiveContainerCode, /<ResponsiveContainer/);
  assert.match(safeResponsiveContainerCode, /getBoundingClientRect\(\)/);
  assert.match(safeResponsiveContainerCode, /ResizeObserver/);
  assert.match(safeResponsiveContainerCode, /size\.width > 0 && size\.height > 0/);
  assert.match(safeResponsiveContainerCode, /React\.cloneElement/);
  assert.match(safeResponsiveContainerCode, /width:\s*size\.width/);
  assert.match(safeResponsiveContainerCode, /height:\s*size\.height/);
  assert.match(panelCode, /<SafeResponsiveContainer width="100%" height="100%" minWidth=\{0\} minHeight=\{340\}>/);
  assert.match(panelCode, /<SafeResponsiveContainer width="100%" height="100%" minWidth=\{0\} minHeight=\{320\}>/);
  assert.match(panelCode, /stackedMinWidth = Math\.max\(760,[\s\S]*\* 72\)/);
  assert.match(panelCode, /h-\[360px\] min-w-0 overflow-x-auto[\s\S]*style=\{\{ minWidth: stackedMinWidth \}\}/m);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA clinical charts checks: ${passed}/${tests.length}`);
