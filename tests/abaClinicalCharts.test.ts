import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSessionMetricSnapshotsFromSummaries,
  compareAbaMetric,
  compareSessionMetrics,
  getAbaMetricDirection
} from '../src/utils/abaClinicalCharts.ts';

const root = process.cwd();
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260525173000_aba_clinical_charts.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const panelCode = readFileSync(join(root, 'src/components/AbaClinicalChartsPanel.tsx'), 'utf8');
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
  assert.match(migrationSql, /annotation_type text not null[\s\S]*?GOAL_LINE[\s\S]*?CONDITION_LINE[\s\S]*?NOTE/i);
});

test('directionality está configurada por métrica', () => {
  assert.equal(getAbaMetricDirection('TARGET_ACCURACY'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('TARGET_INDEPENDENCE'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('FUNCTIONAL_COMMUNICATION'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('ENGAGEMENT'), 'HIGHER_IS_BETTER');
  assert.equal(getAbaMetricDirection('BEHAVIOR_FREQUENCY'), 'LOWER_IS_BETTER');
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

test('buildSessionMetricSnapshotsFromSummaries cria snapshot geral quando não há target por sessão', () => {
  const snapshots = buildSessionMetricSnapshotsFromSummaries({
    currentSummary: { session_id: 's2', patient_id: 'p1', clinic_id: 'c1', ended_at: '2026-05-25T10:00:00.000Z', accuracy_percent: 90, independence_percent: 80 },
    previousSummary: { session_id: 's1', patient_id: 'p1', clinic_id: 'c1', ended_at: '2026-05-24T10:00:00.000Z', accuracy_percent: 70, independence_percent: 60 }
  });
  assert.ok(snapshots.some((item) => item.metricType === 'TARGET_ACCURACY' && item.trendDirection === 'IMPROVED'));
  assert.ok(snapshots.some((item) => item.metricType === 'TARGET_INDEPENDENCE' && item.previousValue === 60));
});

test('backend expõe endpoints ABA summary-driven com selects explícitos', () => {
  for (const route of [
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
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

test('frontend carrega gráficos ABA lazy e usa dataService dedicado', () => {
  assert.match(patientDetailCode, /const AbaClinicalChartsPanel = React\.lazy/);
  assert.match(patientDetailCode, /activeTab === 'aba-charts'[\s\S]*?<AbaClinicalChartsPanel/m);
  assert.match(panelCode, /dataService\.getAbaClinicalChart\(patientId, tab as any/);
  assert.match(panelCode, /chartTabs[\s\S]*?Mudanças por sessão/);
  assert.match(dataServiceCode, /async getAbaClinicalChart\(patientId: string, chart:/);
  assert.match(dataServiceCode, /async saveAbaGraphAnnotation\(patientId: string/);
});

test('frontend apresenta deltas clínicos, status e timelines sem misturar escalas', () => {
  assert.match(panelCode, /formatDelta[\s\S]*?p\.p\./m, 'Deltas percentuais devem ser exibidos em pontos percentuais.');
  assert.doesNotMatch(panelCode, /\$\{Number\(point\.deltaPercent\)\.toFixed\(1\)\}%/, 'Painel não deve renderizar delta percentual cru.');
  assert.match(panelCode, /overviewCards[\s\S]*?Maior melhora em habilidade[\s\S]*?Maior redução de comportamento[\s\S]*?Metas prontas para revisão[\s\S]*?Sinais de regressão[\s\S]*?Primeiras medições/m);
  assert.match(panelCode, /metricAxisLabels[\s\S]*?Acurácia \(%\)[\s\S]*?Independência \(%\)[\s\S]*?Ocorrências[\s\S]*?Duração total[\s\S]*?% de ocorrência por intervalo/m);
  assert.match(panelCode, /masteryBuckets/);
  assert.match(panelCode, /Dados insuficientes[\s\S]*?Critério não atingido[\s\S]*?Critério atingido hoje[\s\S]*?Pronto para revisão[\s\S]*?Masterizado aprovado/m);
  assert.match(panelCode, /maintenanceTimeline/);
  assert.match(panelCode, /Probe pendente[\s\S]*?Mantido[\s\S]*?Watch[\s\S]*?Risco de regressão[\s\S]*?Missed/m);
  assert.match(panelCode, /changeSentence[\s\S]*?previous[\s\S]*?current[\s\S]*?→/m);
  assert.match(panelCode, /GOAL_LINE/);
  assert.match(panelCode, /CONDITION_LINE/);
  assert.match(panelCode, /Evento externo/);
});

test('script npm do épico está registrado', () => {
  const parsed = JSON.parse(packageJson);
  assert.equal(parsed.scripts['test:aba-clinical-charts'], 'tsx tests/abaClinicalCharts.test.ts');
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA clinical charts checks: ${passed}/${tests.length}`);
