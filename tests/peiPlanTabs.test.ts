import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPeiMaintenanceRows,
  buildPeiPlanHistoryEvents,
  groupPeiMaintenanceRows,
  isPeiMaintenanceEligibleSkill,
  summarizePeiMaintenanceRows,
} from '../src/utils/peiMaintenancePanel.ts';
import {
  buildPeiSessionProgressReset,
  getPeiClinicalRowMarker,
  getPeiHistoryProgressMarker,
  getPeiProgressResetMarker,
  isPeiClinicalRowAfterProgressReset,
} from '../src/utils/peiSessionReset.ts';

const root = process.cwd();
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const coordinatorDashboardCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('aba Plano possui áreas internas e Programas mantém teaching como padrão', () => {
  assert.match(patientDetailCode, /activePeiPlanSubtab[\s\S]*?useState<PeiPlanSubtab>\('teaching'\)/);
  assert.match(patientDetailCode, /PEI_PLAN_SUBTABS\.map/);
  for (const label of ['Programas', 'Manutenção', 'Generalização', 'Histórico']) {
    assert.ok(patientDetailCode.includes(label), `${label} deve aparecer como subaba do Plano`);
  }
  assert.match(patientDetailCode, /tab\.id === 'teaching'[\s\S]*?\? 'Programas'/);
  assert.match(patientDetailCode, /data-therapeutic-plan-navigation/);
  assert.doesNotMatch(patientDetailCode, /id="tab-maintenance"|setActiveTab\('maintenance'\)/);
});

test('Ensino preserva lista atual de metas e acao de sessao', () => {
  const teachingBlock = patientDetailCode.match(/activePeiPlanSubtab === 'teaching'[\s\S]*?activePeiPlanSubtab === 'maintenance'/)?.[0] || '';
  assert.match(teachingBlock, /Adicionar Meta do Protocolo/);
  assert.match(teachingBlock, /Metas Ativas/);
  assert.match(teachingBlock, /peiGoals && peiGoals\.length > 0/);
  assert.match(patientDetailCode, /requestSessionStart\('fullscreen'\)/);
  assert.match(teachingBlock, /MasteryDots/);
});

test('Ensino exibe criterio e origem sem editor inline da habilidade', () => {
  const teachingBlock = patientDetailCode.match(/activePeiPlanSubtab === 'teaching'[\s\S]*?activePeiPlanSubtab === 'maintenance'/)?.[0] || '';
  assert.match(teachingBlock, /Criterio de maestria/);
  assert.match(teachingBlock, /Origem: \{masteryDisplay\.sourceLabel\}/);
  assert.match(teachingBlock, /Hoje: \{masteryDisplay\.progressLabel\}/);
  assert.doesNotMatch(teachingBlock, /Editar criterio/);
  assert.doesNotMatch(teachingBlock, /savePeiMasteryCriteria\(goal\)/);
  assert.doesNotMatch(patientDetailCode, /masteryCriteriaEditorGoalId|masteryCriteriaForm|isSavingMasteryCriteria/);
});

test('Restaurar dados de sessao zera progresso PEI antes de abrir sessao', () => {
  const resetAt = new Date('2026-06-04T12:00:00.000Z').getTime();
  const resetPei = buildPeiSessionProgressReset([
    {
      id: 'goal-1',
      name: 'Contato visual',
      status: 'completed',
      progress: 100,
      progressPercent: 100,
      clinical_status: 'COMPLETED',
      clinicalStatus: 'COMPLETED',
      mastery_status: 'MASTERED',
      masteryStatus: 'MASTERED',
      criteriaMet: true,
      isMastered: true
    },
    { id: 'goal-2', name: 'Imitacao', status: 'in_progress', progress: 60 },
    { id: 'goal-3', name: 'Arquivado', status: 'archived', progress: 80 }
  ], resetAt);

  assert.equal(resetPei[0].status, 'in_progress');
  assert.equal(resetPei[0].progress, 0);
  assert.equal(resetPei[0].progressPercent, 0);
  assert.equal(resetPei[0].clinical_status, 'ACQUISITION');
  assert.equal(resetPei[0].clinicalStatus, 'ACQUISITION');
  assert.equal(resetPei[0].mastery_status, null);
  assert.equal(resetPei[0].masteryStatus, null);
  assert.equal('criteriaMet' in resetPei[0], false);
  assert.equal('isMastered' in resetPei[0], false);
  assert.equal(isPeiMaintenanceEligibleSkill(resetPei[0]), false);
  assert.equal(resetPei[0].sessionProgressResetAt, resetAt);
  assert.equal(resetPei[0].sessionRestorePreviousStatus, 'completed');
  assert.equal(resetPei[1].progressResetAt, resetAt);
  assert.equal(resetPei[2].status, 'archived');
  assert.equal(getPeiProgressResetMarker(resetPei[0]), resetAt);
  assert.equal(getPeiHistoryProgressMarker({ id: 'history-1', createdAt: '2026-06-04T12:01:00.000Z' }) > resetAt, true);
  assert.equal(getPeiClinicalRowMarker({ created_at: '2026-06-04T11:59:00.000Z' }) < resetAt, true);
  assert.equal(isPeiClinicalRowAfterProgressReset(resetPei[0], { created_at: '2026-06-04T11:59:00.000Z' }), false);
  assert.equal(isPeiClinicalRowAfterProgressReset(resetPei[0], { created_at: '2026-06-04T12:01:00.000Z' }), true);

  const resetPeiWithoutMaintenance = buildPeiSessionProgressReset([
    {
      id: 'goal-maintenance',
      name: 'Nomeia objetos',
      status: 'completed',
      progress: 100,
      clinical_status: 'MAINTENANCE',
      clinicalStatus: 'MAINTENANCE',
      mastery_status: 'MASTERED',
      masteryStatus: 'MASTERED',
      phase: 'maintenance',
      maintenanceScheduleId: 'schedule-1',
      maintenance_required: true,
      criteriaMet: true,
      isMastered: true
    }
  ], resetAt, { clearMaintenance: true });
  assert.equal(resetPeiWithoutMaintenance[0].status, 'in_progress');
  assert.equal(resetPeiWithoutMaintenance[0].clinical_status, 'ACQUISITION');
  assert.equal(resetPeiWithoutMaintenance[0].clinicalStatus, 'ACQUISITION');
  assert.equal(resetPeiWithoutMaintenance[0].phase, 'teaching');
  assert.equal(resetPeiWithoutMaintenance[0].mastery_status, null);
  assert.equal(resetPeiWithoutMaintenance[0].masteryStatus, null);
  assert.equal('maintenanceScheduleId' in resetPeiWithoutMaintenance[0], false);
  assert.equal('criteriaMet' in resetPeiWithoutMaintenance[0], false);
  assert.equal(resetPeiWithoutMaintenance[0].sessionMaintenanceClearedAt, resetAt);
  assert.equal(isPeiMaintenanceEligibleSkill(resetPeiWithoutMaintenance[0]), false);

  assert.match(patientDetailCode, /const updatedPei = buildPeiSessionProgressReset\(patient\.pei, resetAt, \{[\s\S]*?clearMaintenance: shouldClearMaintenance[\s\S]*?\}\)/);
  assert.match(patientDetailCode, /clearMaintenanceOnSessionRestore/);
  assert.match(patientDetailCode, /Apagar manutenções/);
  assert.match(patientDetailCode, /dataService\.clearPatientAbaMaintenance/);
  assert.match(dataServiceCode, /async clearPatientAbaMaintenance\(patientId: string/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/patients\/:patientId\/maintenance-schedules\/clear'/);
  assert.match(serverCode, /MAINTENANCE_SESSION_RESET_CLEAR/);
  assert.match(serverCode, /clinical_status: 'ACQUISITION'/);
  assert.match(patientDetailCode, /const updateResult = await onUpdatePatient/);
  assert.match(patientDetailCode, /setSessionPatientOverride\(restoredPatient\)/);
  assert.match(patientDetailCode, /patient=\{\{ \.\.\.sessionModePatient/);
  assert.match(patientDetailCode, /isPeiClinicalRowAfterProgressReset\(goal, evaluation\)/);
  assert.match(patientDetailCode, /isPeiClinicalRowAfterProgressReset\(goal, schedule\)/);
  const teachingBlock = patientDetailCode.match(/activePeiPlanSubtab === 'teaching'[\s\S]*?activePeiPlanSubtab === 'maintenance'/)?.[0] || '';
  assert.doesNotMatch(teachingBlock, /patientCategory === 'CrianÃ§a' && !isGoalAcquired\(goal\)|patientCategory === 'Criança' && !isGoalAcquired\(goal\)/);
  assert.doesNotMatch(teachingBlock, /\{ \.\.\.g, id: Date\.now\(\), progress: 0/);
  assert.match(teachingBlock, /buildPeiSessionProgressReset\(\[g\], resetAt\)\[0\]/);
  assert.match(sessionModeCode, /isPeiClinicalRowAfterProgressReset/);
  assert.match(sessionModeCode, /filter\(\(schedule: any\) => isPeiClinicalRowAfterProgressReset\(goal, schedule\)\)/);
  assert.match(sessionModeCode, /filter\(\(result: any\) => isPeiClinicalRowAfterProgressReset\(goal, result\)\)/);
});

test('sessao iniciada no coordenador preserva metadados ABA da tentativa', () => {
  assert.match(coordinatorDashboardCode, /evalComment\?: string, sessionMeta\?: any/);
  assert.match(coordinatorDashboardCode, /return onRecordTrial\(pid, title, score, evalComment, sessionMeta\)/);
});

test('Manutencao exibe apenas habilidades adquiridas do Ensino neste passo', () => {
  const maintenancePanelStart = patientDetailCode.indexOf('const renderPeiMaintenancePanel = () => {');
  const maintenancePanelEnd = patientDetailCode.indexOf('const renderPeiGeneralizationPanel', maintenancePanelStart);
  const maintenancePanelCode = patientDetailCode.slice(maintenancePanelStart, maintenancePanelEnd);
  assert.match(patientDetailCode, /const peiAcquiredTeachingGoals/);
  assert.match(patientDetailCode, /const badge = tab\.id === 'maintenance'[\s\S]*?peiMaintenanceEligibleRows\.length \+ peiMaintenanceScheduledRows\.length \+ peiMaintenanceWaitingRows\.length[\s\S]*?: 0/);
  assert.match(maintenancePanelCode, /Habilidades adquiridas no Ensino/);
  assert.match(maintenancePanelCode, /peiMaintenanceEligibleRows\.map/);
  assert.doesNotMatch(maintenancePanelCode, /Atualizar manutenção|Pendências técnicas|Plano de manutenção|renderPeiMaintenanceGroup|renderPeiMaintenanceMetric/);
  assert.match(dataServiceCode, /async getAbaMaintenancePanel\(patientId: string/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/:patientId\/aba\/maintenance-panel'/);
  assert.match(dataServiceCode, /async getAbaMaintenanceOverview\(patientId: string/);
  assert.match(serverCode, /app\.get\('\/api\/aba\/maintenance-overview\/:patientId'/);
});

test('agrupamento de manutencao separa hoje, atrasadas, sem sessao, confirmacao e concluidas', () => {
  const rows = buildPeiMaintenanceRows({
    goals: [{ id: 'target-6', name: 'Imita acao', status: 'completed' }],
    schedules: [
      { id: 's1', target_id: 'target-1', target_name: 'Nomeia cores', status: 'SCHEDULED', scheduled_for: '2026-06-03T15:00:00.000Z', appointment_id: 'appt-1' },
      { id: 's2', target_id: 'target-2', target_name: 'Pede ajuda', status: 'PENDING', target_due_date: '2026-06-01T12:00:00.000Z' },
      { id: 's3', target_id: 'target-3', target_name: 'Espera vez', status: 'PENDING_NEXT_SESSION' },
      { id: 's4', target_id: 'target-4', target_name: 'Segue rotina', status: 'PENDING_CONFIRMATION', candidate_appointment_id: 'appt-2' },
      { id: 's5', target_id: 'target-5', target_name: 'Emparelha igual', status: 'COMPLETED', schedule_day: 7, completed_at: '2026-06-02T12:00:00.000Z' }
    ],
    probeResults: [
      { id: 'r5', target_id: 'target-5', target_name: 'Emparelha igual', status: 'MAINTAINED', occurred_at: '2026-06-02T12:00:00.000Z' }
    ],
    now: new Date('2026-06-03T16:00:00.000Z')
  });
  const groups = groupPeiMaintenanceRows(rows);
  const summary = summarizePeiMaintenanceRows(rows);
  assert.equal(groups.today.length, 1);
  assert.equal(groups.overdue.length, 1);
  assert.equal(groups.unlinked.length, 1);
  assert.equal(groups.confirmation.length, 1);
  assert.equal(groups.completed.length, 1);
  assert.equal(summary.pendingConfirmation, 1);
  assert.equal(summary.completedCycles, 1);
});

test('painel permite atribuir, confirmar e adiar vinculo de Maintenance Probe', () => {
  assert.match(patientDetailCode, /dataService\.getAbaFutureAppointmentsForMaintenance/);
  assert.match(patientDetailCode, /dataService\.confirmMaintenanceScheduleLink/);
  assert.match(patientDetailCode, /dataService\.skipMaintenanceScheduleLink/);
  assert.match(patientDetailCode, /dataService\.assignMaintenanceScheduleToAppointment/);
  assert.match(patientDetailCode, /dataService\.scheduleMaintenanceForNextSession/);
  assert.match(patientDetailCode, /dataService\.createMaintenanceScheduleForTarget/);
});

test('Manutencao passo atual nao exibe plano 7 14 30 60 e generalizacao permanece', () => {
  const maintenancePanelStart = patientDetailCode.indexOf('const renderPeiMaintenancePanel = () => {');
  const maintenancePanelEnd = patientDetailCode.indexOf('const renderPeiGeneralizationPanel', maintenancePanelStart);
  const maintenancePanelCode = patientDetailCode.slice(maintenancePanelStart, maintenancePanelEnd);
  assert.doesNotMatch(maintenancePanelCode, /Plano de manutencao|Plano de manutenção|7, 14, 30 e 60 dias/);
  assert.match(patientDetailCode, /Habilidade mantida/);
  assert.match(patientDetailCode, /Nenhuma habilidade pronta para generalização no momento/);
});

test('Historico do PEI usa eventos persistidos sem inventar timeline', () => {
  const events = buildPeiPlanHistoryEvents({
    goals: [{ id: 'goal-1', name: 'Contato visual', status: 'completed', created_at: '2026-05-01T12:00:00.000Z' }],
    probeResults: [{ id: 'probe-1', target_name: 'Contato visual', status: 'MAINTAINED', occurred_at: '2026-05-10T12:00:00.000Z' }],
    history: [{ id: 'h1', subject: 'PEI', title: 'Meta revisada', text: 'Registro persistido', created_at: '2026-05-11T12:00:00.000Z' }]
  });
  assert.equal(events.length, 3);
  assert.equal(events[0].source, 'Historico');
  assert.match(patientDetailCode, /buildPeiPlanHistoryEvents/);
});

test('nenhum select star foi introduzido', () => {
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
  assert.doesNotMatch(dataServiceCode, /\.select\('\*'\)/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] PEI plan tabs checks: ${passed}/${tests.length}`);
