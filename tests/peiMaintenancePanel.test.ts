import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPeiMaintenanceEligibleSkills,
  buildPeiMaintenanceRows,
  formatPeiMaintenanceAppointmentLabel,
  formatPeiMaintenanceScheduleLabel,
  getPeiMaintenanceProgressPercent,
  groupPeiMaintenanceRows,
  groupPeiMaintenanceRowsTargetFirst,
  isPeiMaintenanceEligibleSkill,
  mapMaintenancePanelResponse,
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

test('mapper target-first preserva habilidade elegivel mesmo com muitas pendencias tecnicas', () => {
  const targetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0015';
  const mapped = mapMaintenancePanelResponse({
    eligibleSkills: [
      {
        targetId,
        targetName: 'Realiza duas atividades simples de encaixe ou construcao',
        protocol: 'VB-MAPP - Nivel 1',
        domain: 'Brincar independente'
      }
    ],
    maintenanceSkills: [],
    scheduledProbes: [],
    waitingNextSession: [],
    overdueProbes: [],
    regressionRisk: [],
    technicalIssues: Array.from({ length: 50 }, (_, index) => ({
      scheduleId: `6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0${String(200 + index).padStart(3, '0')}`,
      targetName: ''
    }))
  }, { patientId: 'patient-1', requestId: 12, loadedAt: 123456 });

  assert.equal(mapped.source, 'maintenance-panel-target-first');
  assert.equal(mapped.requestId, 12);
  assert.equal(mapped.loadedAt, 123456);
  assert.equal(mapped.summary.eligibleSkills, 1);
  assert.equal(mapped.summary.technical, 50);
  assert.equal(mapped.sections.eligibleSkills[0].targetName, 'Realiza duas atividades simples de encaixe ou construcao');
  assert.equal(mapped.sections.eligibleSkills[0].targetId, targetId);
  assert.equal(mapped.sections.eligibleSkills[0].canScheduleMaintenance, true);
  assert.equal(mapped.sections.technical[0].isTechnicalIssue, true);
  assert.deepEqual(mapped.sections.technical[0].availableActions, ['REVIEW_TARGET']);
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

test('etapa 1 lista apenas habilidades adquiridas reais do PEI', () => {
  const targetId = '6b0a0b10-1e4c-4a4c-9f68-4f6a0caa0030';
  const skills = buildPeiMaintenanceEligibleSkills([
    { id: 'goal-1', target_id: targetId, name: 'Contato visual', status: 'ACQUIRED', protocolTitle: 'VB-MAPP', domainName: 'Social', description: 'Olha quando chamado.' },
    { id: 'goal-1-duplicate', target_id: targetId, name: 'Contato visual duplicado', status: 'ACQUIRED', protocolTitle: 'VB-MAPP', domainName: 'Social' },
    { id: 'goal-2', name: 'Imita gesto', clinical_status: 'MASTERED', protocolTitle: 'VB-MAPP', domainName: 'Imitacao' },
    { id: 'goal-3', name: 'Emparelha igual', status: 'in_progress', progress: 100, protocolTitle: 'VB-MAPP', domainName: 'Matching' },
    { id: 'goal-4', name: 'Solicita item', status: 'in_progress', progress: 40, protocolTitle: 'VB-MAPP', domainName: 'Mando' },
    { name: 'Nomeia objeto', badgeLabel: 'Adquirido', protocolTitle: 'VB-MAPP', domainName: 'Tato' },
    { name: 'Nomeia objeto', badgeLabel: 'Adquirido', protocolTitle: 'VB-MAPP', domainName: 'Tato' }
  ]);

  assert.equal(skills.length, 4);
  assert.equal(skills[0].name, 'Contato visual');
  assert.equal(skills[0].description, 'Olha quando chamado.');
  assert.equal(skills.every((skill) => skill.statusLabel === 'Adquirido'), true);
  assert.equal(skills.some((skill) => skill.name === 'Solicita item'), false);
  assert.equal(skills.filter((skill) => skill.name === 'Nomeia objeto').length, 1);
});

test('etapa 1 reconhece progresso 100 e bloqueia treino sem criterio concluido', () => {
  assert.equal(isPeiMaintenanceEligibleSkill({ status: 'in_progress', progress_percent: 100 }), true);
  assert.equal(isPeiMaintenanceEligibleSkill({ mastery_status: 'MASTERED' }), true);
  assert.equal(isPeiMaintenanceEligibleSkill({ clinical_status: 'ACQUIRED' }), true);
  assert.equal(isPeiMaintenanceEligibleSkill({ status: 'in_progress', progress: 80 }), false);
  assert.equal(getPeiMaintenanceProgressPercent({ progress: '100%' }), 100);
});

test('habilidade adquirida preserva progresso clinico 100 mesmo com progresso cru antigo', () => {
  assert.equal(getPeiMaintenanceProgressPercent({ status: 'ACQUIRED', progress: 50 }), 100);
  assert.equal(getPeiMaintenanceProgressPercent({ statusLabel: 'Adquirido', progress: 50, progressPercent: 100 }), 100);
  const [skill] = buildPeiMaintenanceEligibleSkills([
    { id: 'goal-progress-legacy', name: 'Pareia 10 itens identicos', statusLabel: 'Adquirido', progress: 50, progressPercent: 100 }
  ]);
  assert.equal(skill.progressPercent, 100);
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

test('subaba manutencao etapa 2 renderiza botao de agendamento simples', () => {
  const maintenancePanelStart = patientDetailCode.indexOf('const renderPeiMaintenancePanel = () => {');
  const maintenancePanelEnd = patientDetailCode.indexOf('const renderPeiGeneralizationPanel', maintenancePanelStart);
  assert.notEqual(maintenancePanelStart, -1);
  const maintenancePanelUi = patientDetailCode.slice(maintenancePanelStart, maintenancePanelEnd);
  assert.match(maintenancePanelUi, /Habilidades adquiridas no Ensino, prontas para sondagem de manutenção/);
  assert.match(maintenancePanelUi, /Elegíveis/);
  assert.match(maintenancePanelUi, /Em manutenção/);
  assert.match(maintenancePanelUi, /Agendadas/);
  assert.match(maintenancePanelUi, /Aguardando sessão/);
  assert.match(maintenancePanelUi, /Habilidades elegíveis para manutenção/);
  assert.match(maintenancePanelUi, /Agendar manutenção/);
  assert.match(maintenancePanelUi, /canManagePeiMaintenance && hasRealTarget/);
  assert.match(maintenancePanelUi, /openPeiMaintenanceScheduleModal\(goal, 'NEXT_PATIENT_SESSION'\)/);
  assert.match(maintenancePanelUi, /peiMaintenanceEligibleRows\.map/);
  assert.doesNotMatch(maintenancePanelUi, /renderPeiMaintenanceGroup|renderPeiMaintenanceMetric|renderPeiMaintenanceActions|Atribuir a uma sessão|Plano de manutenção|Escolher sessão existente|Pendências técnicas/);
});

test('subaba manutencao preserva duplicatas do ensino e hidrata target do painel', () => {
  const eligibleStart = patientDetailCode.indexOf('const peiMaintenanceEligibleRows = useMemo');
  const eligibleEnd = patientDetailCode.indexOf('const peiGeneralizationRows', eligibleStart);
  assert.notEqual(eligibleStart, -1);
  const eligibleCode = patientDetailCode.slice(eligibleStart, eligibleEnd);
  assert.match(eligibleCode, /const localRows = peiMaintenanceHydratedGoals/);
  assert.match(eligibleCode, /panelByComposite/);
  assert.match(eligibleCode, /panelTargetId/);
  assert.match(eligibleCode, /key: `goal:\$\{goalId \|\| index\}:\$\{targetId \|\| compositeKey \|\| index\}`/);
  assert.match(eligibleCode, /progressPercent: 100/);
  assert.match(eligibleCode, /const rows = localRows\.length > 0 \? \[\.\.\.localRows, \.\.\.panelOnlyRows\]/);
});

test('modal etapa 2 mostra somente data ou proxima sessao e payload novo', () => {
  const modalStart = patientDetailCode.indexOf('{peiMaintenanceScheduleRow && createPortal(');
  const modalEnd = patientDetailCode.indexOf('{peiMaintenanceReviewRow && createPortal', modalStart);
  assert.notEqual(modalStart, -1);
  const modalCode = patientDetailCode.slice(modalStart, modalEnd);
  assert.match(modalCode, /Agendar sondagem de manutenção/);
  assert.match(modalCode, /Defina quando esta habilidade será sondada/);
  assert.match(modalCode, /Status:[\s\S]*Progresso:/m);
  assert.match(modalCode, /Escolher data/);
  assert.match(modalCode, /Aguardar próxima sessão/);
  assert.match(modalCode, /Salvar agendamento/);
  assert.doesNotMatch(modalCode, /Escolher sessão existente|Escolher data específica|Plano de manutenção|Atribuir a uma sessão/);

  const handlerStart = patientDetailCode.indexOf('const handlePeiScheduleModalSave');
  const handlerEnd = patientDetailCode.indexOf('const handlePeiScheduleNextSession', handlerStart);
  assert.notEqual(handlerStart, -1);
  const handlerCode = patientDetailCode.slice(handlerStart, handlerEnd);
  assert.match(handlerCode, /Esta habilidade não está disponível para manutenção/);
  assert.match(handlerCode, /Escolha uma data para agendar a sondagem/);
  assert.match(handlerCode, /const scheduleMode = isDateMode \? 'DATE' : 'NEXT_SESSION'/);
  assert.match(handlerCode, /dueDate: isDateMode \? peiMaintenanceScheduleDate : null/);
  assert.match(handlerCode, /dataService\.createMaintenanceScheduleForTarget\(targetId, payload\)/);
  assert.match(handlerCode, /Sondagem de manutenção agendada para a data escolhida/);
  assert.match(handlerCode, /Sondagem aguardando próxima sessão/);
  assert.doesNotMatch(handlerCode, /scheduleMaintenanceForNextSession|requestSessionStart|saveAbaSession|createAbaSession|POST \/api\/aba\/sessions/);
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
  assert.match(patientDetailCode, /mapMaintenancePanelResponse/);
  assert.match(patientDetailCode, /peiMaintenancePanelRequestSeqRef/);
  assert.match(patientDetailCode, /requestId !== peiMaintenancePanelRequestSeqRef\.current/);
  assert.match(patientDetailCode, /peiMaintenancePanelPatientIdRef\.current !== requestPatientId/);
  assert.match(patientDetailCode, /ignoredAsStale/);
  assert.match(patientDetailCode, /source: 'maintenance-panel-target-first'/);
  assert.match(patientDetailCode, /setAbaMaintenancePanel\(mappedPanel\)/);
  assert.doesNotMatch(patientDetailCode, /setAbaMaintenancePanel\(panelData\)/);
  assert.doesNotMatch(patientDetailCode, /groupPeiMaintenanceRowsTargetFirst\(peiMaintenanceRows\)/);
  assert.match(patientDetailCode, /peiAcquiredTeachingGoals/);
  const maintenancePanelStart = patientDetailCode.indexOf('const renderPeiMaintenancePanel = () => {');
  const maintenancePanelEnd = patientDetailCode.indexOf('const renderPeiGeneralizationPanel', maintenancePanelStart);
  assert.notEqual(maintenancePanelStart, -1);
  const maintenancePanelCode = patientDetailCode.slice(maintenancePanelStart, maintenancePanelEnd);
  assert.match(maintenancePanelCode, /Habilidades adquiridas no Ensino/);
  assert.match(maintenancePanelCode, /peiMaintenanceEligibleRows\.map/);
  assert.doesNotMatch(maintenancePanelCode, /renderPeiMaintenanceGroup|renderPeiMaintenanceMetric|Atualizar manutenção|Pendências técnicas|Plano de manutenção|shouldShowPeiMaintenancePanelLoading/);
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

test('refresh da manutencao usa apenas painel target-first e ignora respostas stale', () => {
  const refreshStart = patientDetailCode.indexOf('const refreshPeiMaintenancePanel');
  const refreshEnd = patientDetailCode.indexOf('useEffect(() => {', refreshStart);
  const refreshCode = patientDetailCode.slice(refreshStart, refreshEnd);
  assert.match(refreshCode, /dataService\.getAbaMaintenancePanel\(requestPatientId, \{ page: 1, pageSize: 100 \}\)/);
  assert.match(refreshCode, /mapMaintenancePanelResponse\(panelData/);
  assert.match(refreshCode, /requestId !== peiMaintenancePanelRequestSeqRef\.current/);
  assert.match(refreshCode, /setAbaMaintenancePanel\(mappedPanel\)/);
  assert.doesNotMatch(refreshCode, /getAbaMaintenanceOverview/);
  assert.doesNotMatch(refreshCode, /groupPeiMaintenanceRowsTargetFirst/);
  assert.doesNotMatch(refreshCode, /buildPeiMaintenanceRows/);
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

test('backend da etapa 2 usa PEI targets e schedules ativos por target em lote', () => {
  const routeStart = serverCode.indexOf("app.get('/api/patients/:patientId/aba/maintenance-panel'");
  const legacyStart = serverCode.indexOf('const { page, pageSize, from, to } = parseAbaPageParams', routeStart);
  const stepTwoRoute = serverCode.slice(routeStart, legacyStart);
  assert.match(stepTwoRoute, /checkPatientAccess/);
  assert.match(stepTwoRoute, /getPatientPeiTargets/);
  assert.match(stepTwoRoute, /\.from\('aba_targets'\)[\s\S]*?\.select\(ABA_TARGET_RECOMMENDATION_SELECT\)/m);
  assert.match(stepTwoRoute, /\.from\('aba_maintenance_schedules'\)[\s\S]*?\.select\(ABA_MAINTENANCE_SCHEDULE_SELECT\)[\s\S]*?\.in\('target_id', eligibleTargetIds\)[\s\S]*?\.in\('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES\)/m);
  assert.match(stepTwoRoute, /source: 'patient_pei_targets_step2'/);
  assert.match(stepTwoRoute, /source\?\.peiGoalIndex/);
  assert.match(stepTwoRoute, /const hasRealTarget = isUuid\(targetId\)/);
  assert.match(stepTwoRoute, /const internalKey = isPeiSource/);
  assert.match(stepTwoRoute, /canScheduleMaintenance: hasRealTarget/);
  assert.match(stepTwoRoute, /availableActions: hasRealTarget \? \['SCHEDULE_MAINTENANCE'\] : \[\]/);
  assert.match(stepTwoRoute, /progressPercent: 100/);
  assert.match(dataServiceCode, /table: 'patient_pei,aba_targets,aba_maintenance_schedules'/);
  assert.doesNotMatch(stepTwoRoute, /aba_maintenance_probe_results|aba_regression_alerts|fetchFutureAppointmentsForMaintenance/);
  assert.doesNotMatch(stepTwoRoute, /select\('\*'\)/);
});

test('endpoint de agendamento aceita DATE ou NEXT_SESSION com upsert ativo', () => {
  const endpointStart = serverCode.indexOf("app.post('/api/aba/targets/:targetId/maintenance-schedules'");
  const nextEndpointStart = serverCode.indexOf("app.post('/api/aba/targets/:targetId/maintenance-schedules/next-session'", endpointStart);
  assert.notEqual(endpointStart, -1);
  const endpointCode = serverCode.slice(endpointStart, nextEndpointStart);
  assert.match(endpointCode, /requestedMode[\s\S]*?'DATE'[\s\S]*?'NEXT_SESSION'/m);
  assert.match(endpointCode, /scheduleModeFromPayload[\s\S]*?'CUSTOM_DATE'[\s\S]*?'NEXT_PATIENT_SESSION'/m);
  assert.match(endpointCode, /MISSING_DUE_DATE/);
  assert.match(endpointCode, /Escolha uma data para agendar a sondagem/);
  assert.match(endpointCode, /createMaintenanceScheduleForTarget/);
  assert.match(endpointCode, /hydrateScheduleResponse/);
  assert.match(endpointCode, /targetId/);
  assert.match(endpointCode, /dueDate/);
  assert.doesNotMatch(endpointCode, /scheduleId|select\('\*'\)|\/api\/aba\/sessions|saveAbaSession|createAbaSession/);

  const helperStart = serverCode.indexOf('const createMaintenanceScheduleForTarget = async');
  const helperEnd = serverCode.indexOf('const fetchNextMaintenanceProbeForTarget', helperStart);
  const helperCode = serverCode.slice(helperStart, helperEnd);
  assert.match(helperCode, /\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('patient_id', patientId\)[\s\S]*?\.eq\('target_id', targetId\)[\s\S]*?\.in\('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES\)/m);
  assert.match(helperCode, /MAINTENANCE_SCHEDULE_CREATED/);
  assert.match(helperCode, /MAINTENANCE_SCHEDULE_UPDATED/);
  assert.match(helperCode, /status: 'PENDING_NEXT_SESSION'/);
  assert.match(helperCode, /status: 'SCHEDULED'/);
  assert.doesNotMatch(helperCode, /CUSTOM_DATE_PENDING_LINK/);
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

test('agendamento simples da etapa 2 nao inicia sessao nem mostra opcoes futuras', () => {
  const modalStart = patientDetailCode.indexOf('{peiMaintenanceScheduleRow && createPortal(');
  const modalEnd = patientDetailCode.indexOf('{peiMaintenanceReviewRow && createPortal', modalStart);
  const modalCode = patientDetailCode.slice(modalStart, modalEnd);
  const handlerStart = patientDetailCode.indexOf('const handlePeiScheduleModalSave');
  const handlerEnd = patientDetailCode.indexOf('const handlePeiScheduleNextSession', handlerStart);
  const handlerCode = patientDetailCode.slice(handlerStart, handlerEnd);
  assert.match(modalCode, /Agendar sondagem de manutenção/);
  assert.match(modalCode, /Escolher data/);
  assert.match(modalCode, /Aguardar próxima sessão/);
  assert.doesNotMatch(modalCode, /Escolher sessão existente|Escolher data específica|Plano de manutenção|Atribuir a uma sessão/);
  assert.doesNotMatch(handlerCode, /requestSessionStart\('fullscreen'\)|POST \/api\/aba\/sessions|saveAbaSession|startSession|createAbaSession|SessionMode/);
  assert.doesNotMatch(calendarCode, /onStartSession\?\(\{ \.\.\.detailEvent, maintenanceProbe: probe/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] PEI maintenance panel checks: ${passed}/${tests.length}`);
