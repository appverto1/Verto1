import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPeiMaintenanceRows,
  formatPeiMaintenanceAppointmentLabel,
  formatPeiMaintenanceScheduleLabel,
  groupPeiMaintenanceRows,
  resolveMaintenanceTargetDisplay,
  summarizePeiMaintenanceRows,
} from '../src/utils/peiMaintenancePanel.ts';

const root = process.cwd();
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const maintenancePanelCode = readFileSync(join(root, 'src/utils/peiMaintenancePanel.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('resumo operacional calcula pendencias sem eventos brutos', () => {
  const rows = buildPeiMaintenanceRows({
    schedules: [
      { id: 'today', target_id: 't1', target_name: 'Contato visual', status: 'SCHEDULED', scheduled_for: '2026-06-03T13:00:00.000Z', appointment_id: 'appt-1' },
      { id: 'late', target_id: 't2', target_name: 'Imitacao motora', status: 'PENDING_LINK', target_due_date: '2026-06-01T13:00:00.000Z' },
      { id: 'confirm', target_id: 't3', target_name: 'Mando', status: 'PENDING_CONFIRMATION', candidate_appointment_id: 'appt-2' },
      { id: 'next', target_id: 't4', target_name: 'Tato', status: 'PENDING_NEXT_SESSION' }
    ],
    now: new Date('2026-06-03T16:00:00.000Z')
  });
  const summary = summarizePeiMaintenanceRows(rows);
  assert.equal(summary.today, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.pendingConfirmation, 1);
  assert.equal(summary.unlinked, 1);
  assert.equal(summary.pending, 4);
});

test('labels escondem identificadores tecnicos quando nome do target veio cru', () => {
  const rows = buildPeiMaintenanceRows({
    schedules: [
      {
        id: 's1',
        target_id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0001',
        target_name: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0001',
        status: 'PENDING_NEXT_SESSION'
      }
    ]
  });
  assert.equal(rows[0].targetName, 'Habilidade sem nome');
  assert.doesNotMatch(rows[0].statusLabel, /6b0a0b10/);
});

test('resolvedor central prioriza nome real, protocolo, dominio e marco clinico', () => {
  const display = resolveMaintenanceTargetDisplay({
    schedule: {
      id: 's1',
      target_id: 'target-1',
      target_name: 'target-1',
      status: 'PENDING_CONFIRMATION',
      schedule_day: 14
    },
    target: {
      id: 'target-1',
      name: 'Contato visual',
      protocol_title: 'VB-MAPP',
      domain_name: 'Social'
    },
    recentResult: {
      accuracy_percent: 80,
      independence_percent: 60
    }
  });
  assert.equal(display.targetDisplayName, 'Contato visual');
  assert.equal(display.protocolDisplayName, 'VB-MAPP');
  assert.equal(display.domainDisplayName, 'Social');
  assert.equal(display.clinicalMilestoneLabel, '14 dias');
  assert.equal(display.recentResultLabel, '80% acuracia - 60% independencia');
  assert.equal(resolveMaintenanceTargetDisplay({ schedule: { target_id: 'target-2', target_missing: true } }).targetDisplayName, 'Habilidade nao encontrada');
});

test('cards humanos descrevem vinculo, atraso, confirmacao e ciclo concluido', () => {
  assert.equal(formatPeiMaintenanceScheduleLabel({ status: 'PENDING_NEXT_SESSION' }), 'Aguardando proxima sessao');
  assert.equal(formatPeiMaintenanceScheduleLabel({ status: 'PENDING_CONFIRMATION' }), 'Pendente de confirmacao');
  assert.match(formatPeiMaintenanceScheduleLabel({ status: 'PENDING', target_due_date: '2026-06-01T12:00:00.000Z' }, new Date('2026-06-03T12:00:00.000Z')), /Atrasada ha 2 dia/);
  assert.match(formatPeiMaintenanceScheduleLabel({ status: 'SCHEDULED', appointment_id: 'appt-1', scheduled_for: '2026-06-03T12:00:00.000Z' }, new Date('2026-06-02T12:00:00.000Z')), /Vinculada a consulta/);
  const completedRows = buildPeiMaintenanceRows({
    schedules: [{ id: 'c1', target_id: 'target-c', target_name: 'Esperar', status: 'COMPLETED', schedule_day: 60 }],
    probeResults: [{ id: 'r1', target_id: 'target-c', target_name: 'Esperar', status: 'MAINTAINED' }]
  });
  assert.equal(completedRows[0].statusLabel, 'Habilidade mantida');
  assert.equal(groupPeiMaintenanceRows(completedRows).completed.length, 1);
});

test('modal de atribuicao lista proximas sessoes com dados clinicos sem UUID visivel', () => {
  const label = formatPeiMaintenanceAppointmentLabel({
    id: '0aabb3ef-79fe-4c18-96d8-cc7b02588aa0',
    scheduled_at: '2026-06-03T13:20:00.000Z',
    service_type: 'ABA',
    therapist_name: 'Terapeuta Mateus',
    room_name: 'Sala 1',
    status: 'scheduled'
  });
  assert.match(label, /03\/06/);
  assert.match(label, /ABA/);
  assert.match(label, /Terapeuta Mateus/);
  assert.match(label, /Sala 1/);
  assert.doesNotMatch(label, /0aabb3ef/);
  assert.match(patientDetailCode, /formatPeiMaintenanceAppointmentLabel\(appointment\)/);
});

test('acoes do painel chamam rotas seguras existentes', () => {
  assert.match(patientDetailCode, /handlePeiAssignToAppointment/);
  assert.match(patientDetailCode, /handlePeiWaitNextSessionFromModal/);
  assert.match(patientDetailCode, /handlePeiConfirmCandidateLink/);
  assert.match(patientDetailCode, /handlePeiSkipCandidateLink/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/confirm-link'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/skip-link'/);
  assert.match(serverCode, /fetchMaintenanceAppointmentById/);
  assert.match(serverCode, /canAccessPatientInCurrentClinic/);
});

test('interfaces de manutencao usam display central sem placeholders antigos', () => {
  const uiCode = [patientDetailCode, calendarCode, sessionModeCode, maintenancePanelCode].join('\n');
  assert.match(calendarCode, /resolveMaintenanceTargetDisplay/);
  assert.match(sessionModeCode, /resolveMaintenanceTargetDisplay/);
  assert.match(patientDetailCode, /resolveMaintenanceTargetDisplay/);
  assert.doesNotMatch(uiCode, /Target em manuten[cç]ao|Target em manutenção|Sem maintenance probe agendado|Marco clinico: a definir|Marco clínico: a definir/);
});

test('backend resolve targets de manutencao em lote com colunas explicitas', () => {
  assert.match(serverCode, /const enrichMaintenanceRowsWithTargetDisplay/);
  assert.match(serverCode, /\.from\('aba_targets'\)[\s\S]*?\.select\(ABA_TARGET_RECOMMENDATION_SELECT\)[\s\S]*?\.in\('id', targetIds\)/m);
  assert.match(serverCode, /'candidate_appointment_id'[\s\S]*?'confirmed_at'[\s\S]*?'metadata'/m);
  assert.doesNotMatch(serverCode, /from\('aba_maintenance_schedules'\)[\s\S]{0,200}\.select\('\*'\)/m);
});

test('acoes nao enviam ids sinteticos para endpoints de manutencao', () => {
  assert.match(patientDetailCode, /const getPersistedUuid/);
  assert.match(patientDetailCode, /disabled=\{loading \|\| !hasRealSchedule\}/);
  assert.match(dataServiceCode, /SYNTHETIC_CLINICAL_ID_RE/);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(targetId\)\)[\s\S]*?Habilidade inválida para agendamento de manutenção/m);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(scheduleId\)\)[\s\S]*?Sondagem de manutenção inválida para confirmar vínculo/m);
  assert.match(calendarCode, /if \(!isPersistedUuid\(scheduleId\)\)/);
  assert.match(dataServiceCode, /async confirmMaintenanceScheduleLink\(scheduleId: string[\s\S]*?if \(!isPersistedUuid\(scheduleId\)\)[\s\S]*?const endpoint = `\/api\/aba\/maintenance-schedules\/\$\{encodeURIComponent\(String\(scheduleId\)\)\}\/confirm-link`/m);
});

test('backend valida ids invalidos e recent-session-events local sem ruido', () => {
  assert.match(serverCode, /if \(!isUuid\(targetId\)\)[\s\S]*?Habilidade inválida para agendamento de manutenção/m);
  assert.match(serverCode, /if \(!isUuid\(scheduleId\)\)[\s\S]*?Identificador inválido/m);
  assert.match(serverCode, /Escolha uma sessão antes de confirmar o vínculo/);
  assert.match(serverCode, /Sondagem de manutenção não encontrada/);
  assert.match(serverCode, /requestedSessionId[\s\S]*?!isUuid\(requestedSessionId\)[\s\S]*?success: true, data: \[\]/m);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(sessionId\)\) return \{ success: true, data: \[\] \}/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] PEI maintenance panel checks: ${passed}/${tests.length}`);
