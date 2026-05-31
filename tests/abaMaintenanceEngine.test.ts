import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMaintenanceSchedulesForMasteryApproval,
  buildRegressionAlertFromMaintenanceResult,
  evaluateMaintenanceStatus
} from '../src/utils/abaMasteryEngine.ts';
import {
  buildDefaultMaintenanceSchedulePreview,
  deriveMaintenanceScheduleStatus,
  findBestAppointmentForMaintenanceProbe,
  selectMaintenanceScheduleForProbe
} from '../src/utils/abaMaintenanceScheduling.ts';

const root = process.cwd();
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260525160000_aba_maintenance_regression.sql'), 'utf8');
const planningMigrationSql = readFileSync(join(root, 'supabase/migrations/20260527120000_aba_next_session_planning.sql'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const flowDoc = readFileSync(join(root, 'ABA_MAINTENANCE_PROBE_FLOW.md'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const criteria = {
  id: 'criteria-1',
  organization_id: 'clinic-1',
  target_id: 'target-1',
  name: '80/80 manutencao',
  min_accuracy_percent: 80,
  min_independence_percent: 80,
  min_trials_per_session: 3,
  min_consecutive_days: 1,
  require_first_trial_independent: false,
  cold_probe_only: false,
  min_distinct_therapists: 1,
  maintenance_required: true,
  maintenance_days: [7, 14, 30, 60],
  is_active: true
};

const trial = (overrides: any = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  target_id: 'target-1',
  target_name: 'Nomeia cores',
  session_id: 'session-1',
  collection_type: 'maintenance_probe',
  correct: overrides.correct ?? overrides.trialOutcome !== 'error',
  independent: overrides.independent ?? overrides.trialOutcome !== 'prompted',
  trialOutcome: overrides.trialOutcome || 'independent',
  occurred_at: overrides.occurred_at || '2026-05-25T12:00:00.000Z',
  ...overrides
});

const evaluate = (overrides: any = {}) => evaluateMaintenanceStatus({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  targetId: 'target-1',
  targetName: 'Nomeia cores',
  sessionId: 'session-1',
  maintenanceScheduleId: 'schedule-1',
  criteria,
  trials: [trial({ id: 'm1' }), trial({ id: 'm2' }), trial({ id: 'm3' })],
  previousProbeResults: [],
  occurredAt: '2026-05-25T13:00:00.000Z',
  ...overrides
});

test('criacao de maintenance schedules usa marcos 7, 14, 30 e 60 sem data rigida', () => {
  const schedules = buildMaintenanceSchedulesForMasteryApproval({
    organizationId: 'clinic-1',
    patientId: 'patient-1',
    targetId: 'target-1',
    masteryEvaluationId: 'evaluation-1',
    approvedAt: '2026-05-01T12:00:00.000Z'
  });
  assert.deepEqual(schedules.map((item) => item.schedule_day), [7, 14, 30, 60]);
  assert.equal(schedules[0].status, 'PENDING_LINK');
  assert.equal(schedules[0].target_due_date, '2026-05-08T12:00:00.000Z');
  assert.equal(schedules[0].scheduled_for, null);
});

test('schedule 7 dias vincula sessao existente no dia correto ou proxima na janela', () => {
  const preview = buildDefaultMaintenanceSchedulePreview({
    approvedAt: '2026-05-01T12:00:00.000Z',
    maintenanceDays: [7],
    appointments: [
      { id: 'appointment-before', scheduled_at: '2026-05-07T12:00:00.000Z', status: 'scheduled' },
      { id: 'appointment-after', scheduled_at: '2026-05-09T12:00:00.000Z', status: 'scheduled' }
    ]
  });
  assert.equal(preview[0].targetDueDate, '2026-05-08T12:00:00.000Z');
  assert.equal(preview[0].appointmentId, 'appointment-after');
  assert.equal(preview[0].scheduledFor, '2026-05-09T12:00:00.000Z');
  assert.equal(preview[0].status, 'SCHEDULED');
});

test('sem sessao na janela cria preview PENDING_LINK sem quebrar', () => {
  const preview = buildDefaultMaintenanceSchedulePreview({
    approvedAt: '2026-05-01T12:00:00.000Z',
    maintenanceDays: [14],
    appointments: [{ id: 'far-away', scheduled_at: '2026-06-20T12:00:00.000Z', status: 'scheduled' }]
  });
  assert.equal(preview[0].status, 'PENDING_LINK');
  assert.equal(preview[0].scheduledFor, null);
  assert.match(preview[0].message, /Sem sessao agendada/);
});

test('findBestAppointmentForMaintenanceProbe prefere sessao futura mais proxima', () => {
  const match = findBestAppointmentForMaintenanceProbe([
    { id: 'before', scheduled_at: '2026-05-07T12:00:00.000Z', status: 'scheduled' },
    { id: 'after', scheduled_at: '2026-05-08T16:00:00.000Z', status: 'scheduled' }
  ], '2026-05-08T12:00:00.000Z', { scheduleDay: 7, limit: 10 });
  assert.equal(match.appointmentId, 'after');
  assert.equal(match.matchType, 'AFTER_TARGET_DUE_DATE');
});

test('status derivado diferencia due today e overdue sem mutacao automatica', () => {
  assert.equal(deriveMaintenanceScheduleStatus({
    status: 'SCHEDULED',
    scheduled_for: '2026-05-28T12:00:00.000Z'
  }, new Date('2026-05-28T15:00:00.000Z')), 'DUE_TODAY');
  assert.equal(deriveMaintenanceScheduleStatus({
    status: 'PENDING',
    target_due_date: '2026-05-25T12:00:00.000Z'
  }, new Date('2026-05-28T15:00:00.000Z')), 'OVERDUE');
});

test('registro escolhe schedule por appointment, hoje, vencido e janela', () => {
  const selectedByAppointment = selectMaintenanceScheduleForProbe([
    { id: 'due-today', target_due_date: '2026-05-28T12:00:00.000Z', status: 'PENDING' },
    { id: 'linked', appointment_id: 'appointment-1', target_due_date: '2026-05-30T12:00:00.000Z', status: 'SCHEDULED' }
  ], { appointmentId: 'appointment-1', occurredAt: '2026-05-28T13:00:00.000Z' });
  assert.equal(selectedByAppointment?.id, 'linked');

  const selectedOverdue = selectMaintenanceScheduleForProbe([
    { id: 'future-window', target_due_date: '2026-05-30T12:00:00.000Z', window_start: '2026-05-27T00:00:00.000Z', window_end: '2026-06-02T00:00:00.000Z', status: 'PENDING' },
    { id: 'oldest-overdue', target_due_date: '2026-05-20T12:00:00.000Z', status: 'PENDING' }
  ], { occurredAt: '2026-05-28T13:00:00.000Z' });
  assert.equal(selectedOverdue?.id, 'oldest-overdue');
});

test('maintenance probe adequado retorna MAINTAINED', () => {
  const result = evaluate();
  assert.equal(result.status, 'MAINTAINED');
  assert.equal(result.accuracyPercent, 100);
  assert.equal(result.independencePercent, 100);
  assert.equal(result.shouldCreateRegressionAlert, false);
});

test('apenas Maintenance Probe entra na avaliacao de manutencao', () => {
  const result = evaluate({
    trials: [
      trial({ id: 'm1' }),
      trial({ id: 'dtt-error', collection_type: 'dtt', correct: false, independent: false, trialOutcome: 'error' }),
      trial({ id: 'm2' }),
      trial({ id: 'm3' })
    ]
  });
  assert.equal(result.totalTrials, 3);
  assert.equal(result.status, 'MAINTAINED');
});

test('queda leve abaixo do criterio retorna WATCH', () => {
  const result = evaluate({
    trials: [
      trial({ id: 'm1' }),
      trial({ id: 'm2' }),
      trial({ id: 'm3', trialOutcome: 'prompted', independent: false })
    ]
  });
  assert.equal(result.status, 'WATCH');
  assert.equal(result.independencePercent, 67);
  assert.equal(result.shouldCreateRegressionAlert, false);
});

test('resultado muito abaixo do criterio retorna REGRESSION_RISK', () => {
  const result = evaluate({
    trials: [
      trial({ id: 'm1', trialOutcome: 'error', correct: false, independent: false }),
      trial({ id: 'm2', trialOutcome: 'error', correct: false, independent: false }),
      trial({ id: 'm3' })
    ]
  });
  assert.equal(result.status, 'REGRESSION_RISK');
  assert.equal(result.accuracyPercent, 33);
  assert.equal(result.shouldCreateRegressionAlert, true);
});

test('multiplas falhas consecutivas geram alerta sugerido', () => {
  const result = evaluate({
    trials: [
      trial({ id: 'm1' }),
      trial({ id: 'm2' }),
      trial({ id: 'm3', trialOutcome: 'prompted', independent: false })
    ],
    previousProbeResults: [
      { status: 'WATCH', occurred_at: '2026-05-14T12:00:00.000Z' }
    ]
  });
  assert.equal(result.status, 'WATCH');
  assert.equal(result.consecutiveFailureCount, 2);
  const alert = buildRegressionAlertFromMaintenanceResult({ result: { ...result, id: 'probe-1' } });
  assert.equal(alert?.severity, 'LOW');
  assert.match(alert?.message || '', /2 probes consecutivos abaixo do criterio/);
});

test('migration cria tabelas, estados clinicos, schedules e alertas sem mutar target automaticamente', () => {
  for (const tableName of ['aba_maintenance_schedules', 'aba_maintenance_probe_results', 'aba_regression_alerts']) {
    assert.match(migrationSql, new RegExp(`create table if not exists public\\.${tableName}`, 'i'));
    assert.match(migrationSql, new RegExp(`alter table public\\.${tableName} enable row level security`, 'i'));
  }
  for (const status of ['ACQUISITION', 'READY_FOR_REVIEW', 'MASTERED', 'MAINTENANCE', 'REGRESSION_RISK', 'REGRESSION_CONFIRMED']) {
    assert.match(migrationSql, new RegExp(status));
  }
  assert.match(migrationSql, /aba_create_maintenance_schedules_for_mastery/i);
  assert.match(migrationSql, /array\[7, 14, 30, 60\]/i);
  assert.match(migrationSql, /aba_regression_alert_after_probe_result/i);
  assert.match(planningMigrationSql, /target_due_date/i);
  assert.match(planningMigrationSql, /appointment_id/i);
  assert.match(planningMigrationSql, /source_mastery_evaluation_id/i);
  assert.match(planningMigrationSql, /interval_label/i);
  assert.match(planningMigrationSql, /completed_by/i);
  assert.match(planningMigrationSql, /DUE_TODAY/i);
  assert.match(planningMigrationSql, /OVERDUE/i);
  assert.match(serverCode, /PENDING_NEXT_SESSION/i);
  assert.match(serverCode, /PENDING_CONFIRMATION/i);
  assert.match(serverCode, /PENDING_LINK/i);
  assert.match(planningMigrationSql, /alter table public\.appointments[\s\S]*add column if not exists organization_id[\s\S]*add column if not exists deleted_at[\s\S]*add column if not exists is_active/i);
  assert.match(planningMigrationSql, /a\.organization_id::text = p_organization_id/i);
  assert.match(planningMigrationSql, /UNSCHEDULED/i);
  assert.match(planningMigrationSql, /aba_find_best_appointment_for_maintenance_probe/i);
  assert.match(planningMigrationSql, /idx_aba_maintenance_schedules_org_appointment_status/i);
  assert.match(planningMigrationSql, /idx_aba_maintenance_probe_results_org_patient_target_created/i);
  assert.doesNotMatch(migrationSql, /update\s+public\.aba_targets[\s\S]{0,220}REGRESSION_CONFIRMED/i);
});

test('backend e frontend usam summaries e rotas de manutencao paginadas', () => {
  assert.match(serverCode, /evaluateAndPersistSessionMaintenance[\s\S]*?collection_type', 'maintenance_probe'/m);
  assert.match(serverCode, /app\.get\('\/api\/aba\/maintenance-overview\/:patientId'[\s\S]*?select\(ABA_MAINTENANCE_SCHEDULE_SELECT\)[\s\S]*?select\(ABA_MAINTENANCE_PROBE_RESULT_SELECT\)[\s\S]*?select\(ABA_REGRESSION_ALERT_SELECT\)/m);
  assert.match(serverCode, /app\.get\('\/api\/aba\/patients\/:patientId\/maintenance-schedules'/m);
  assert.match(serverCode, /app\.post\('\/api\/aba\/targets\/:targetId\/maintenance-schedules'/m);
  assert.match(serverCode, /app\.post\('\/api\/aba\/targets\/:targetId\/maintenance-schedules\/next-session'/m);
  assert.match(serverCode, /app\.get\('\/api\/aba\/targets\/:targetId\/next-maintenance-probe'/m);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/complete'/m);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-probe-results'/m);
  assert.match(serverCode, /selectMaintenanceScheduleForProbe/);
  assert.match(serverCode, /completeMaintenanceScheduleAfterProbe/);
  assert.match(serverCode, /persistTargetMaintenanceApproval/);
  assert.match(dataServiceCode, /async getAbaMaintenanceOverview\(patientId: string/);
  assert.match(dataServiceCode, /appointmentId\?: string \| null/);
  assert.match(dataServiceCode, /async createMaintenanceScheduleForTarget\(targetId: string/);
  assert.match(dataServiceCode, /async scheduleMaintenanceForNextSession\(targetId: string/);
  assert.match(dataServiceCode, /async saveAbaMaintenanceProbeResult\(result: any\)/);
  assert.match(sessionModeCode, /dataService\.getAbaMaintenanceOverview\(patientId/);
  assert.match(sessionModeCode, /appointmentId: activeAppointmentId/);
  assert.match(sessionModeCode, /Probes de manutencao pendentes/);
  assert.match(sessionModeCode, /Agendar para proxima sessao/);
  assert.match(sessionModeCode, /Sem sondagem agendada/);
  assert.match(patientDetailCode, /maintenance_targets_count[\s\S]*?pending_maintenance_probes_count[\s\S]*?active_regression_risks_count/m);
});

test('documentacao curta explica fluxo atual e corrigido', () => {
  assert.match(flowDoc, /Auditoria do fluxo atual/);
  assert.match(flowDoc, /Fluxo corrigido/);
  assert.match(flowDoc, /nao promove target sozinho/);
  assert.match(flowDoc, /appointment_id/);
});

test('Maintenance Probe nao regride PEI nem target automaticamente no legado', () => {
  assert.match(appCode, /abaCollectionType !== 'maintenance_probe'/);
  assert.doesNotMatch(serverCode, /from\('aba_targets'\)[\s\S]{0,240}\.update\([\s\S]{0,240}REGRESSION_CONFIRMED/m);
});

test('SessionMode previne duplicidade explicita entre treino e Maintenance Probe', () => {
  assert.match(sessionModeCode, /setPendingMaintenanceProbeTrial/);
  assert.match(sessionModeCode, /findPreviousTrainingTrialForGoal/);
  assert.match(sessionModeCode, /isDuplicateRiskTrainingCollection\(record\.collectionType\)/);
  assert.match(sessionModeCode, /Registrar nova tentativa/);
  assert.match(sessionModeCode, /Converter tentativa anterior/);
  assert.match(sessionModeCode, /convertPreviousTrialToMaintenanceProbe/);
  assert.match(sessionModeCode, /collectionType: 'maintenance_probe'/);
  assert.match(sessionModeCode, /conversionPreservedOriginalTimestamp/);
  assert.match(sessionModeCode, /saveActivityLog/);
});

test('banner de manutencao comunica tipo atual e botao nao registra tentativa', () => {
  const activationStart = sessionModeCode.indexOf('const activateMaintenanceProbeMode');
  const activationEnd = sessionModeCode.indexOf('const registerFrequency', activationStart);
  const activationBody = sessionModeCode.slice(activationStart, activationEnd);
  assert.match(sessionModeCode, /Este target está em manutenção\./);
  assert.match(sessionModeCode, /Tipo atual da próxima tentativa/);
  assert.match(sessionModeCode, /Para avaliar manutenção, use Maintenance Probe\./);
  assert.match(sessionModeCode, /Maintenance Probe ativo para a próxima tentativa/);
  assert.match(activationBody, /setCollectionType\('maintenance_probe'\)[\s\S]*?showClinicalToast/m);
  assert.doesNotMatch(activationBody, /handleTrialClick|persistTrialRecord|addRecord/m);
});

test('agendamento flexivel trata 7 14 30 60 como marcos clinicos', () => {
  assert.match(planningMigrationSql, /target_due_date/);
  assert.match(planningMigrationSql, /scheduled_for/);
  assert.match(planningMigrationSql, /appointment_id/);
  assert.match(planningMigrationSql, /p_schedule_day integer default 7/);
  assert.match(planningMigrationSql, /limit greatest\(1, least\(coalesce\(p_limit, 20\), 50\)\)/);
  assert.match(sessionModeCode, /Plano de manutencao 7\/14\/30\/60/);
  assert.match(sessionModeCode, /O plano cria quatro checagens apos a maestria/);
});

test('resumos separam treino/aquisicao de sondagem de manutencao no front', () => {
  assert.match(sessionModeCode, /if \(isMaintenanceProbeCollection\(record\.collectionType\)\) return false/);
  assert.match(sessionModeCode, /if \(!isMaintenanceProbeCollection\(record\.collectionType\)\) return false/);
  assert.doesNotMatch(sessionModeCode, /REGRESSION_CONFIRMED[\s\S]{0,240}updateRecord/m);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] ABA maintenance engine checks: ${passed}/${tests.length}`);
