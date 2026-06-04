import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPeiMaintenanceRows,
  formatPeiMaintenanceAppointmentLabel,
  formatPeiMaintenanceScheduleLabel,
  groupPeiMaintenanceRows,
  groupPeiMaintenanceRowsTargetFirst,
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

test('labels escondem identificadores tecnicos quando target nao foi hidratado', () => {
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
  assert.equal(rows[0].targetName, 'Habilidade nao encontrada');
  assert.doesNotMatch(rows[0].statusLabel, /6b0a0b10/);
});

test('schedule orfao nao herda schedule id como target real', () => {
  const rows = buildPeiMaintenanceRows({
    schedules: [
      {
        id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0001',
        status: 'PENDING_LINK',
        target_due_date: '2026-06-01T13:00:00.000Z'
      }
    ]
  });
  assert.equal(rows[0].targetId, '');
  assert.equal(rows[0].targetName, 'Habilidade nao vinculada');
  assert.equal(rows[0].needsTargetReview, true);
});

test('schedule sem target_id nao usa metadata antiga como habilidade real', () => {
  const rows = buildPeiMaintenanceRows({
    schedules: [
      {
        id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0001',
        target_name: 'Imitacao antiga',
        metadata: { target_name: 'Imitacao antiga' },
        status: 'PENDING_LINK'
      }
    ]
  });
  assert.equal(rows[0].targetName, 'Habilidade nao vinculada');
  assert.equal(rows[0].needsTargetReview, true);
});

test('classifica cards reais e orfaos com flags operacionais explicitas', () => {
  const targetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0002';
  const scheduleId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0003';
  const rows = buildPeiMaintenanceRows({
    goals: [
      { id: targetId, name: 'Imita movimentos', clinical_status: 'MAINTENANCE', protocol_title: 'VB-MAPP', domain_name: 'Imitacao' }
    ],
    schedules: [
      {
        id: scheduleId,
        target_id: targetId,
        target: { id: targetId, name: 'Imita movimentos', protocol_title: 'VB-MAPP', domain_name: 'Imitacao' },
        status: 'PENDING_NEXT_SESSION'
      },
      {
        id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0004',
        status: 'PENDING_LINK'
      }
    ]
  });
  const valid = rows.find((row: any) => row.targetId === targetId);
  const orphan = rows.find((row: any) => row.cardKind === 'SCHEDULE_ORFAO');
  assert.equal(valid.cardKind, 'SCHEDULE_VALIDO');
  assert.equal(valid.hasRealTarget, true);
  assert.equal(valid.needsTargetReview, false);
  assert.equal(valid.canWaitNextSession, true);
  assert.equal(valid.canAssignAppointment, true);
  assert.equal(orphan.needsTargetReview, true);
  assert.equal(orphan.canScheduleMaintenance, false);
});

test('painel target-first separa habilidades reais de pendencias tecnicas', () => {
  const maintenanceTargetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0010';
  const waitingTargetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0011';
  const eligibleTargetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0012';
  const rows = buildPeiMaintenanceRows({
    goals: [
      { id: maintenanceTargetId, name: 'Imita 2 movimentos motores grossos', clinical_status: 'MAINTENANCE', protocol_title: 'VB-MAPP - Nivel 1', domain_name: 'Imitacao Motora Nivel 1' },
      { id: waitingTargetId, name: 'Pega pequenos objetos com movimento de pinca', clinical_status: 'MAINTENANCE', protocol_title: 'VB-MAPP - Nivel 1', domain_name: 'Motricidade fina' },
      { id: eligibleTargetId, name: 'Nomeia objetos familiares', clinical_status: 'MASTERED', protocol_title: 'VB-MAPP - Nivel 1', domain_name: 'Tato' }
    ],
    schedules: [
      { id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0013', target_id: waitingTargetId, target: { id: waitingTargetId, name: 'Pega pequenos objetos com movimento de pinca' }, status: 'PENDING_NEXT_SESSION' },
      { id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0014', status: 'PENDING_LINK' }
    ]
  });
  const groups = groupPeiMaintenanceRowsTargetFirst(rows);
  assert.equal(groups.maintenanceSkills.some((row: any) => row.targetId === maintenanceTargetId), true);
  assert.equal(groups.waitingNextSession.some((row: any) => row.targetId === waitingTargetId), true);
  assert.equal(groups.eligibleSkills.some((row: any) => row.targetId === eligibleTargetId), true);
  assert.equal(groups.technical.length, 1);
  assert.equal(groups.technical[0].canScheduleMaintenance, false);
});

test('target-first separa risco de regressao do fluxo agendado', () => {
  const targetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0020';
  const rows = buildPeiMaintenanceRows({
    goals: [
      { id: targetId, name: 'Solicita ajuda', clinical_status: 'MAINTENANCE', protocol_title: 'VB-MAPP', domain_name: 'Mando' }
    ],
    schedules: [
      { id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0021', target_id: targetId, target: { id: targetId, name: 'Solicita ajuda' }, status: 'SCHEDULED', target_due_date: '2026-06-10T12:00:00.000Z' }
    ],
    probeResults: [
      { id: '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0022', target_id: targetId, status: 'REGRESSION_RISK', occurred_at: '2026-06-03T12:00:00.000Z' }
    ]
  });
  const groups = groupPeiMaintenanceRowsTargetFirst(rows);
  assert.equal(groups.regressionRisk.some((row: any) => row.targetId === targetId), true);
  assert.equal(groups.scheduled.some((row: any) => row.targetId === targetId), false);
});

test('habilidades do PEI com status local ou progresso 100 aparecem como elegiveis clinicas', () => {
  const rows = buildPeiMaintenanceRows({
    goals: [
      { id: 'pei-local-1', name: 'Imita 2 movimentos motores grossos', status: 'ADQUIRIDO', protocolTitle: 'VB-MAPP - Nivel 1', domainName: 'Imitacao Motora Nivel 1' },
      { id: 'pei-local-2', name: 'Pega pequenos objetos com movimento de pinca', status: 'in_progress', progress: 100, protocolTitle: 'VB-MAPP - Nivel 1', domainName: 'Motricidade fina' }
    ]
  });
  const groups = groupPeiMaintenanceRowsTargetFirst(rows);
  assert.equal(groups.eligibleSkills.length, 2);
  assert.equal(groups.technical.length, 0);
  assert.equal(groups.eligibleSkills.every((row: any) => row.cardKind === 'TARGET_REAL_SEM_SCHEDULE'), true);
  assert.equal(groups.eligibleSkills.every((row: any) => row.hasPeiClinicalSource), true);
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
  assert.match(patientDetailCode, /handlePeiScheduleModalSave/);
  assert.match(patientDetailCode, /openPeiMaintenanceReviewModal/);
  assert.match(patientDetailCode, /getAbaLinkableTargetsForMaintenance/);
  assert.match(patientDetailCode, /dataService\.createMaintenanceScheduleForTarget\(targetId,[\s\S]*?appointmentId/m);
  assert.match(patientDetailCode, /Sondagem atribu/);
  assert.match(patientDetailCode, /canScheduleMaintenance/);
  assert.match(patientDetailCode, /canWaitNextSession/);
  assert.match(patientDetailCode, /canAssignAppointment/);
  assert.match(patientDetailCode, /rowClinicalContext/);
  assert.match(patientDetailCode, /groupPeiMaintenanceRowsTargetFirst/);
  assert.match(patientDetailCode, /peiMaintenanceTargetFirstGroups/);
  assert.match(patientDetailCode, /Atenção \/ risco de regressão/);
  assert.match(patientDetailCode, /isPeiMaintenanceTechnicalExpanded/);
  assert.match(patientDetailCode, /Recolher pendências técnicas/);
  assert.match(patientDetailCode, /Habilidades em manutenção/);
  assert.match(patientDetailCode, /Habilidades elegíveis para manutenção/);
  assert.match(patientDetailCode, /Pendências técnicas de manutenção/);
  assert.match(patientDetailCode, /normalizePeiMaintenanceMatchKey/);
  assert.match(patientDetailCode, /peiMaintenanceHydratedGoals/);
  assert.match(patientDetailCode, /aba_target_id/);
  assert.match(patientDetailCode, /abaTargetId/);
  assert.match(patientDetailCode, /goals: \[\.\.\.peiMaintenanceHydratedGoals, \.\.\.peiMaintenanceLinkableTargets\]/);
  assert.match(patientDetailCode, /peiMaintenanceHydratedGoals\.forEach\(addTargetOption\)/);
  assert.match(patientDetailCode, /group !== 'completed' && group !== 'confirmation' && \(/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/:patientId\/aba\/maintenance-panel'/);
  assert.match(serverCode, /app\.patch\('\/api\/aba\/maintenance-schedules\/:scheduleId\/assign-appointment'/);
  assert.match(serverCode, /app\.patch\('\/api\/aba\/maintenance-schedules\/:scheduleId\/relink-target'/);
  assert.match(serverCode, /MAINTENANCE_SCHEDULE_RELINKED/);
  assert.match(serverCode, /MAINTENANCE_SCHEDULE_CREATED/);
  assert.match(serverCode, /MAINTENANCE_SCHEDULE_ASSIGNED/);
  assert.match(serverCode, /MAINTENANCE_NEXT_SESSION_SET/);
  assert.match(patientDetailCode, /Este paciente ainda n[Ã£a]o possui habilidades no PEI|Este paciente ainda não possui habilidades no PEI/);
  assert.doesNotMatch(patientDetailCode, /Ainda n[Ã£a]o h[Ã¡a] habilidade real do PEI dispon[Ã­i]vel para selecionar|Ainda não há habilidade real do PEI disponível para selecionar/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/:patientId\/aba\/targets\/linkable'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/confirm-link'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/assign-appointment'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/skip-link'/);
  assert.match(serverCode, /app\.post\('\/api\/aba\/maintenance-schedules\/:scheduleId\/relink-target'/);
  assert.match(serverCode, /fetchMaintenanceAppointmentById/);
  assert.match(serverCode, /canAccessPatientInCurrentClinic/);
});

test('interfaces de manutencao usam display central sem placeholders antigos', () => {
  const uiCode = [patientDetailCode, calendarCode, sessionModeCode, maintenancePanelCode].join('\n');
  const rowStart = patientDetailCode.indexOf('const renderPeiMaintenanceRow');
  const rowEnd = patientDetailCode.indexOf('const renderPeiMaintenanceGroup', rowStart);
  const rowCode = patientDetailCode.slice(rowStart, rowEnd);
  assert.match(calendarCode, /resolveMaintenanceTargetDisplay/);
  assert.match(sessionModeCode, /resolveMaintenanceTargetDisplay/);
  assert.match(patientDetailCode, /resolveMaintenanceTargetDisplay/);
  assert.match(rowCode, /displayTargetName/);
  assert.match(rowCode, /Sondagem sem habilidade vinculada/);
  assert.match(rowCode, /Esta sondagem antiga precisa ser associada a uma habilidade real/);
  assert.doesNotMatch(rowCode, /Esta sondagem precisa ser vinculada a uma habilidade do PEI/);
  assert.doesNotMatch(uiCode, /Target em manuten[cç]ao|Target em manutenção|Sem maintenance probe agendado|Marco clinico: a definir|Marco clínico: a definir/);
});

test('backend resolve targets de manutencao em lote com colunas explicitas', () => {
  assert.match(serverCode, /const enrichMaintenanceRowsWithTargetDisplay/);
  assert.match(serverCode, /\.from\('aba_targets'\)[\s\S]*?\.select\(ABA_TARGET_RECOMMENDATION_SELECT\)[\s\S]*?\.in\('id', targetIds\)/m);
  assert.match(serverCode, /skills/);
  assert.match(serverCode, /orphanSchedules/);
  assert.match(serverCode, /getPatientPeiTargets/);
  assert.match(serverCode, /patient_pei/);
  assert.match(serverCode, /debugCounts/);
  assert.match(serverCode, /targetsFromPei/);
  assert.match(serverCode, /eligibleSkills/);
  assert.match(serverCode, /maintenanceSkills/);
  assert.match(serverCode, /scheduledProbes/);
  assert.match(serverCode, /waitingNextSession/);
  assert.match(serverCode, /overdueProbes/);
  assert.match(serverCode, /regressionRisk/);
  assert.match(serverCode, /technicalIssues/);
  assert.match(serverCode, /latestMasteryByTargetId/);
  assert.match(serverCode, /activeScheduleByTargetId/);
  assert.match(serverCode, /latestResultByTargetId/);
  assert.match(serverCode, /const kind = needsTargetReview \? 'SCHEDULE_ORFAO' : 'SCHEDULE_VALIDO'/);
  assert.match(serverCode, /cardKind: kind/);
  assert.match(serverCode, /cardKind: 'TARGET_REAL_SEM_SCHEDULE'/);
  assert.match(serverCode, /hasRealTarget: targetResolved/);
  assert.match(serverCode, /canScheduleMaintenance: targetResolved/);
  assert.match(serverCode, /canReviewLink: needsTargetReview/);
  assert.match(serverCode, /type: legacyType/);
  assert.match(serverCode, /kind: 'TARGET_REAL_SEM_SCHEDULE'/);
  assert.match(serverCode, /type: 'TARGET_WITHOUT_SCHEDULE'/);
  assert.match(serverCode, /canWaitNextSession: true/);
  assert.match(serverCode, /canAssignAppointment: true/);
  assert.match(serverCode, /availableActions: needsTargetReview[\s\S]*?\? \['REVIEW_TARGET'\]/m);
  assert.match(serverCode, /'candidate_appointment_id'[\s\S]*?'confirmed_at'[\s\S]*?'metadata'/m);
  assert.doesNotMatch(serverCode, /from\('aba_maintenance_schedules'\)[\s\S]{0,200}\.select\('\*'\)/m);
});

test('acoes nao enviam ids sinteticos para endpoints de manutencao', () => {
  assert.match(patientDetailCode, /const getPersistedUuid/);
  assert.match(patientDetailCode, /disabled=\{actionLoading\('confirm'\) \|\| !hasRealSchedule \|\| needsTargetReview\}/);
  assert.match(patientDetailCode, /group !== 'completed' && group !== 'confirmation' && \(/);
  assert.match(dataServiceCode, /SYNTHETIC_CLINICAL_ID_RE/);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(targetId\)\)[\s\S]*?Habilidade inválida para agendamento de manutenção/m);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(scheduleId\)\)[\s\S]*?Sondagem de manutenção inválida para confirmar vínculo/m);
  assert.match(calendarCode, /if \(!isPersistedUuid\(scheduleId\)\)/);
  assert.match(dataServiceCode, /async confirmMaintenanceScheduleLink\(scheduleId: string[\s\S]*?if \(!isPersistedUuid\(scheduleId\)\)[\s\S]*?const endpoint = `\/api\/aba\/maintenance-schedules\/\$\{encodeURIComponent\(String\(scheduleId\)\)\}\/confirm-link`/m);
  assert.match(dataServiceCode, /async assignMaintenanceScheduleToAppointment\(scheduleId: string[\s\S]*?if \(!isPersistedUuid\(appointmentId\)\)/m);
  assert.match(dataServiceCode, /async relinkMaintenanceScheduleTarget\(scheduleId: string[\s\S]*?if \(!isPersistedUuid\(targetId\)\)/m);
  assert.match(dataServiceCode, /async getAbaLinkableTargetsForMaintenance\(patientId: string/);
  assert.match(dataServiceCode, /async getAbaMaintenancePanel\(patientId: string/);
});

test('backend valida ids invalidos e recent-session-events local sem ruido', () => {
  assert.match(serverCode, /if \(!isUuid\(targetId\)\)[\s\S]*?Habilidade inválida para agendamento de manutenção/m);
  assert.match(serverCode, /if \(!isUuid\(scheduleId\)\)[\s\S]*?Identificador inválido/m);
  assert.match(serverCode, /Escolha uma sessão antes de confirmar o vínculo/);
  assert.match(serverCode, /Sondagem de manutenção não encontrada/);
  assert.match(serverCode, /MISSING_CANDIDATE_APPOINTMENT/);
  assert.match(serverCode, /APPOINTMENT_PATIENT_MISMATCH/);
  assert.match(serverCode, /requestedSessionId[\s\S]*?!isUuid\(requestedSessionId\)[\s\S]*?success: true, data: \[\]/m);
  assert.match(dataServiceCode, /if \(!isPersistedUuid\(sessionId\)\) return \{ success: true, data: \[\] \}/);
});

test('botoes de manutencao abrem modais ou mostram feedback sem iniciar sessao fora da sessao ativa', () => {
  assert.match(patientDetailCode, /Agendar sondagem de manutenção/);
  assert.match(patientDetailCode, /Escolher sessão existente/);
  assert.match(patientDetailCode, /Escolher data específica/);
  assert.match(patientDetailCode, /Plano de manutenção/);
  assert.match(patientDetailCode, /openPeiMaintenanceReviewModal/);
  assert.doesNotMatch(patientDetailCode, /Inicie a sess[ãa]o para usar esta Maintenance Probe|Inicie a sessÃ£o para usar esta Maintenance Probe/);
  const maintenanceActionsStart = patientDetailCode.indexOf('const renderPeiMaintenanceActions');
  const maintenanceActionsEnd = patientDetailCode.indexOf('const renderPeiMaintenanceRow', maintenanceActionsStart);
  const maintenanceActionsCode = patientDetailCode.slice(maintenanceActionsStart, maintenanceActionsEnd);
  assert.doesNotMatch(maintenanceActionsCode, /requestSessionStart\('fullscreen'\)/);
  assert.doesNotMatch(calendarCode, /onStartSession\?\(\{ \.\.\.detailEvent, maintenanceProbe: probe/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] PEI maintenance panel checks: ${passed}/${tests.length}`);
