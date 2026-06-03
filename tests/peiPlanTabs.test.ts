import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPeiMaintenanceRows,
  buildPeiPlanHistoryEvents,
  groupPeiMaintenanceRows,
  summarizePeiMaintenanceRows,
} from '../src/utils/peiMaintenancePanel.ts';

const root = process.cwd();
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('aba Plano possui subabas internas e Ensino e o padrao', () => {
  assert.match(patientDetailCode, /activePeiPlanSubtab[\s\S]*?useState<PeiPlanSubtab>\('teaching'\)/);
  assert.match(patientDetailCode, /PEI_PLAN_SUBTABS\.map/);
  for (const label of ['Ensino', 'Manutenção', 'Generalização', 'Histórico']) {
    assert.ok(patientDetailCode.includes(label), `${label} deve aparecer como subaba do Plano`);
  }
  assert.doesNotMatch(patientDetailCode, /id="tab-maintenance"|setActiveTab\('maintenance'\)/);
});

test('Ensino preserva lista atual de metas e acao de sessao', () => {
  const teachingBlock = patientDetailCode.match(/activePeiPlanSubtab === 'teaching'[\s\S]*?activePeiPlanSubtab === 'maintenance'/)?.[0] || '';
  assert.match(teachingBlock, /Adicionar Meta do Protocolo/);
  assert.match(teachingBlock, /Metas Ativas/);
  assert.match(teachingBlock, /patient\.pei && patient\.pei\.length > 0/);
  assert.match(patientDetailCode, /requestSessionStart\('fullscreen'\)/);
  assert.match(teachingBlock, /MasteryDots/);
});

test('Manutencao carrega painel sob demanda e usa summaries existentes', () => {
  assert.match(patientDetailCode, /activePeiPlanSubtab !== 'maintenance'/);
  assert.match(patientDetailCode, /refreshPeiMaintenancePanel/);
  assert.match(patientDetailCode, /dataService\.getAbaMaintenanceOverview\(String\(patient\.id\), \{ page: 1, pageSize: 50 \}\)/);
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
  assert.match(patientDetailCode, /Escolha uma sessão para esta sondagem/);
  assert.match(patientDetailCode, /dataService\.getAbaFutureAppointmentsForMaintenance/);
  assert.match(patientDetailCode, /dataService\.confirmMaintenanceScheduleLink/);
  assert.match(patientDetailCode, /dataService\.skipMaintenanceScheduleLink/);
  assert.match(patientDetailCode, /dataService\.scheduleMaintenanceForNextSession/);
  assert.match(patientDetailCode, /dataService\.createMaintenanceScheduleForTarget/);
});

test('ciclo 7 14 30 60 e generalizacao aparecem em linguagem clinica', () => {
  assert.match(patientDetailCode, /Plano de manutencao/);
  assert.match(patientDetailCode, /7, 14, 30 e 60 dias/);
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
