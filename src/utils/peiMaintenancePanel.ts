import {
  deriveMaintenanceScheduleStatus,
  formatMaintenanceScheduleDueLabel,
  getNextMaintenanceProbeForTarget,
} from './abaMaintenanceScheduling';

export type PeiPlanSubtab = 'teaching' | 'maintenance' | 'generalization' | 'history';

export type PeiMaintenanceGroupKey =
  | 'today'
  | 'overdue'
  | 'unlinked'
  | 'confirmation'
  | 'activeCycle'
  | 'completed';

export type PeiMaintenanceTargetFirstGroupKey =
  | 'maintenanceSkills'
  | 'eligibleSkills'
  | 'scheduled'
  | 'waitingNextSession'
  | 'overdue'
  | 'technical';

export const PEI_PLAN_SUBTABS: Array<{ id: PeiPlanSubtab; label: string }> = [
  { id: 'teaching', label: 'Ensino' },
  { id: 'maintenance', label: 'Manutencao' },
  { id: 'generalization', label: 'Generalizacao' },
  { id: 'history', label: 'Historico' },
];

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_LINKLESS_STATUSES = new Set(['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING']);
const COMPLETED_STATUSES = new Set(['COMPLETED', 'MAINTAINED', 'MAINTENANCE_COMPLETED']);
const REGRESSION_STATUSES = new Set(['WATCH', 'REGRESSION_RISK']);

const normalizeText = (value: any) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeStatus = (value: any) => normalizeText(value).toUpperCase();

const readObjectPayload = (...values: any[]) => {
  const merged: Record<string, any> = {};
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(merged, value);
      continue;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(merged, parsed);
      } catch {
        // Ignore malformed legacy payloads; display falls through to safe fallback.
      }
    }
  }
  return merged;
};

const firstDisplayText = (...values: any[]) => {
  for (const value of values) {
    const label = normalizeText(value);
    if (label && !UUID_LIKE.test(label)) return label;
  }
  return '';
};

const safeTargetName = (value: any, fallback = 'Habilidade sem nome') => {
  const label = normalizeText(value);
  if (!label || UUID_LIKE.test(label)) return fallback;
  return label;
};

const isPersistedUuid = (value: any) => UUID_LIKE.test(normalizeText(value));

const getTargetKey = (...values: any[]) => {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized.toLowerCase();
  }
  return '';
};

const isMaintenanceRelevantGoal = (goal: any) => {
  const status = String(goal?.status || goal?.clinical_status || goal?.clinicalStatus || goal?.phase || '').toLowerCase();
  const clinicalStatus = normalizeStatus(goal?.clinical_status || goal?.clinicalStatus || goal?.status || goal?.phase);
  return (
    ['completed', 'acquired', 'adquirido', 'maintenance', 'maintained', 'mastered'].includes(status) ||
    ['MASTERED', 'MAINTENANCE', 'MAINTAINED', 'ACQUIRED'].includes(clinicalStatus)
  );
};

const getScheduleReferenceDate = (schedule: any) =>
  schedule?.scheduled_for ||
  schedule?.scheduledFor ||
  schedule?.due_date ||
  schedule?.dueDate ||
  schedule?.target_due_date ||
  schedule?.targetDueDate ||
  null;

const getResultReferenceDate = (result: any) =>
  result?.occurred_at || result?.occurredAt || result?.created_at || result?.createdAt || null;

const formatShortDateTime = (value: any) => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day} as ${time}`;
};

const statusLabelForMaintenance = (scheduleOrProbe: any, now = new Date()) => {
  const status = normalizeStatus(scheduleOrProbe?.status || scheduleOrProbe?.probeStatus || scheduleOrProbe?.result_status);
  if (status === 'MAINTAINED') return 'Habilidade mantida';
  if (status === 'REGRESSION_RISK') return 'Risco de regressao';
  if (status === 'WATCH') return 'Atencao';
  if (status === 'PENDING_CONFIRMATION') return 'Pendente de confirmacao';
  if (status === 'PENDING_NEXT_SESSION') return 'Aguardando proxima sessao';
  if (status === 'PENDING_LINK' || status === 'PENDING_SCHEDULING' || status === 'UNSCHEDULED') return 'Sem sessao vinculada';
  if (status === 'COMPLETED') return 'Concluida';
  if (status === 'SCHEDULED') return 'Agendada';
  const derived = scheduleOrProbe ? deriveMaintenanceScheduleStatus(scheduleOrProbe, now) : '';
  if (derived === 'DUE_TODAY') return 'Para hoje';
  if (derived === 'OVERDUE') return 'Atrasada';
  return status || 'Pendente';
};

export function resolveMaintenanceTargetDisplay(input: {
  schedule?: any;
  probe?: any;
  target?: any;
  appointment?: any;
  recentResult?: any;
  now?: Date;
} | any = {}) {
  const source = input?.schedule || input?.probe || input || {};
  const probe = input?.probe || source;
  const target = input?.target || source?.target || source?.aba_target || source?.targets || {};
  const metadata = readObjectPayload(source?.metadata, source?.raw_payload, source?.rawPayload);
  const probeMetadata = readObjectPayload(probe?.metadata, probe?.raw_payload, probe?.rawPayload);
  const targetId = normalizeText(source?.target_id || source?.targetId || probe?.target_id || probe?.targetId || target?.id);
  const hasExplicitMissingTarget = Boolean(targetId && source?.target_missing === true);
  const targetLabel = firstDisplayText(
    target?.name,
    target?.title,
    target?.target_name,
    target?.targetName,
    target?.skill_name,
    target?.skillName,
    target?.objective
  );
  const sourceLabel = targetId
    ? firstDisplayText(
        source?.target_name,
        source?.targetName,
        source?.name,
        source?.title,
        source?.skill_name,
        source?.skillName,
        source?.objective,
        metadata?.target_name,
        metadata?.targetName,
        probe?.target_name,
        probe?.targetName,
        probe?.objective,
        probeMetadata?.target_name,
        probeMetadata?.targetName
      )
    : '';
  const hasResolvedTarget = Boolean(normalizeText(target?.id || target?.target_id || target?.targetId));
  const targetDisplayName =
    targetLabel ||
    sourceLabel ||
    (!targetId ? 'Habilidade nao vinculada' : hasExplicitMissingTarget ? 'Habilidade nao encontrada' : hasResolvedTarget ? 'Habilidade sem nome' : 'Habilidade nao encontrada');
  const protocolDisplayName =
    firstDisplayText(
      target?.protocol?.name,
      target?.protocol_name,
      target?.protocolName,
      target?.protocol_title,
      target?.protocolTitle,
      source?.protocol_name,
      source?.protocolName,
      source?.protocol_title,
      source?.protocolTitle,
      metadata?.protocol_name,
      metadata?.protocolName,
      metadata?.protocol_title,
      metadata?.protocolTitle,
      probeMetadata?.protocol_name,
      probeMetadata?.protocolName
    ) || 'Sem protocolo informado';
  const domainDisplayName =
    firstDisplayText(
      target?.domain?.name,
      target?.domain_name,
      target?.domainName,
      target?.program?.name,
      target?.program_name,
      target?.programName,
      source?.domain_name,
      source?.domainName,
      source?.program_name,
      source?.programName,
      metadata?.domain_name,
      metadata?.domainName,
      metadata?.program_name,
      metadata?.programName,
      probeMetadata?.domain_name,
      probeMetadata?.domainName
    ) || 'Sem dominio informado';
  const now = input?.now || new Date();
  const recentResult = input?.recentResult || probe || null;
  const schedule = input?.schedule || source;
  const scheduleDay = Number(schedule?.schedule_day ?? schedule?.scheduleDay);
  const clinicalMilestoneLabel =
    Number.isFinite(scheduleDay) && scheduleDay > 0
      ? `${Math.round(scheduleDay)} dias`
      : schedule?.interval_label || schedule?.intervalLabel || formatPeiMaintenanceScheduleLabel(schedule, now);
  const linkedSessionLabel = schedule?.appointment_id || schedule?.appointmentId
    ? formatPeiMaintenanceScheduleLabel(schedule, now)
    : '';
  const accuracy = recentResult?.accuracy_percent ?? recentResult?.accuracyPercent;
  const independence = recentResult?.independence_percent ?? recentResult?.independencePercent;
  const recentResultLabel = accuracy !== undefined || independence !== undefined
    ? `${accuracy ?? 0}% acuracia - ${independence ?? 0}% independencia`
    : '';
  const statusLabel = statusLabelForMaintenance(schedule, now);
  return {
    targetDisplayName,
    protocolDisplayName,
    domainDisplayName,
    contextLabel: `${protocolDisplayName} - ${domainDisplayName}`,
    statusLabel,
    clinicalMilestoneLabel,
    linkedSessionLabel,
    recentResultLabel,
    badgeLabel: statusLabel,
    targetId,
    hasTargetId: Boolean(targetId),
    targetMissing: hasExplicitMissingTarget,
    hasResolvedTarget,
    hasRealTarget: Boolean(isPersistedUuid(targetId) && hasResolvedTarget && !hasExplicitMissingTarget),
    needsTargetReview: !targetId || hasExplicitMissingTarget || !hasResolvedTarget,
    reviewBadgeLabel: !targetId ? 'Revisar vinculo' : hasExplicitMissingTarget ? 'Revisar dados' : '',
  };
}

export const formatPeiMaintenanceAppointmentLabel = (appointment: any) => {
  const when = formatShortDateTime(
    appointment?.scheduled_at ||
    appointment?.scheduledAt ||
    appointment?.scheduledStartAt ||
    appointment?.date
  );
  const type = safeTargetName(appointment?.service_type || appointment?.serviceType || appointment?.approach || appointment?.type, 'Sessao');
  const professional = safeTargetName(
    appointment?.therapistName ||
      appointment?.therapist_name ||
      appointment?.professionalName ||
      appointment?.professional_name,
    'Equipe'
  );
  const location = safeTargetName(
    appointment?.roomName ||
      appointment?.room_name ||
      appointment?.location ||
      appointment?.local,
    'Local a definir'
  );
  return [when || 'Data a definir', type, professional, location].filter(Boolean).join(' - ');
};

export const formatPeiMaintenanceScheduleLabel = (schedule: any, now = new Date()) => {
  if (!schedule) return 'Sem sondagem agendada';
  const status = deriveMaintenanceScheduleStatus(schedule, now);
  if (status === 'PENDING_NEXT_SESSION') return 'Aguardando proxima sessao';
  if (status === 'PENDING_CONFIRMATION') return 'Pendente de confirmacao';
  if (status === 'OVERDUE') {
    const reference = getScheduleReferenceDate(schedule);
    const due = reference ? new Date(reference) : null;
    const diffDays = due && !Number.isNaN(due.getTime())
      ? Math.max(1, Math.ceil((now.getTime() - due.getTime()) / 86_400_000))
      : 1;
    return `Atrasada ha ${diffDays} dia(s)`;
  }
  if (status === 'DUE_TODAY') return 'Para hoje';
  if (schedule?.appointment_id || schedule?.appointmentId) {
    const when = formatShortDateTime(schedule?.scheduled_for || schedule?.scheduledFor || schedule?.due_date || schedule?.dueDate);
    return when ? `Vinculada a consulta de ${when}` : 'Vinculada a consulta';
  }
  return formatMaintenanceScheduleDueLabel(schedule, now);
};

export function buildPeiMaintenanceRows(input: {
  goals?: any[];
  schedules?: any[];
  probeResults?: any[];
  alerts?: any[];
  now?: Date;
}) {
  const now = input.now || new Date();
  const rowsByKey = new Map<string, any>();

  const ensureRow = (seed: any = {}) => {
    const display = resolveMaintenanceTargetDisplay(seed.goal ? { target: seed, schedule: seed } : seed);
    const key =
      getTargetKey(seed.target_id, seed.targetId, seed.skillId, seed.skill_id, seed.goal ? seed.id : '', seed.name, seed.target_name, seed.targetName) ||
      `target-${rowsByKey.size + 1}`;
    const existing = rowsByKey.get(key);
    if (existing) return existing;
    const targetId = normalizeText(seed.target_id || seed.targetId || (seed.goal ? seed.id : '') || '');
    const row = {
      key,
      targetId,
      targetName: display.targetDisplayName,
      protocol: display.protocolDisplayName,
      domain: display.domainDisplayName,
      clinicalStatus: normalizeStatus(seed.status || seed.clinical_status || seed.clinicalStatus || ''),
      hasRealTarget: Boolean(display.hasRealTarget || (seed.goal && isPersistedUuid(targetId))),
      needsTargetReview: Boolean(display.needsTargetReview && !(seed.goal && isPersistedUuid(targetId))),
      targetMissing: display.targetMissing,
      goal: seed.goal || seed,
      schedules: [] as any[],
      probeResults: [] as any[],
      alerts: [] as any[],
    };
    rowsByKey.set(key, row);
    return row;
  };

  (Array.isArray(input.goals) ? input.goals : [])
    .filter(isMaintenanceRelevantGoal)
    .forEach((goal) => ensureRow({ ...goal, goal }));

  (Array.isArray(input.schedules) ? input.schedules : []).forEach((schedule) => {
    const raw = schedule?.raw_payload && typeof schedule.raw_payload === 'object' ? schedule.raw_payload : {};
    const row = ensureRow({
      ...schedule,
      name: schedule?.target_name || schedule?.targetName || raw.targetName,
      protocolTitle: schedule?.protocol_title || schedule?.protocolTitle || raw.protocolTitle,
      domainName: schedule?.domain_name || schedule?.domainName || raw.domainName,
    });
    row.schedules.push(schedule);
  });

  (Array.isArray(input.probeResults) ? input.probeResults : []).forEach((result) => {
    const raw = result?.raw_payload && typeof result.raw_payload === 'object' ? result.raw_payload : {};
    const row = ensureRow({
      ...result,
      name: result?.target_name || result?.targetName || raw.targetName,
    });
    row.probeResults.push(result);
  });

  (Array.isArray(input.alerts) ? input.alerts : []).forEach((alert) => {
    const row = ensureRow(alert);
    row.alerts.push(alert);
  });

  return Array.from(rowsByKey.values()).map((row) => {
    const sortedSchedules = row.schedules
      .slice()
      .sort((a: any, b: any) => new Date(getScheduleReferenceDate(a) || 0).getTime() - new Date(getScheduleReferenceDate(b) || 0).getTime());
    const nextProbe = getNextMaintenanceProbeForTarget(sortedSchedules, now);
    const sortedResults = row.probeResults
      .slice()
      .sort((a: any, b: any) => new Date(getResultReferenceDate(b) || 0).getTime() - new Date(getResultReferenceDate(a) || 0).getTime());
    const lastResult = sortedResults[0] || null;
    const activeAlert = row.alerts.find((alert: any) => !(alert?.resolved_at || alert?.resolvedAt)) || null;
    const completedCount = sortedSchedules.filter((schedule: any) => COMPLETED_STATUSES.has(normalizeStatus(schedule?.status))).length;
    const cycleDays = sortedSchedules
      .map((schedule: any) => Number(schedule?.schedule_day ?? schedule?.scheduleDay))
      .filter((day: number) => Number.isFinite(day) && day > 0);
    const hasCycle = cycleDays.some((day: number) => [7, 14, 30, 60].includes(day)) || sortedSchedules.length >= 4;
    const allCycleCompleted = hasCycle && sortedSchedules.length > 0 && completedCount >= sortedSchedules.length;
    const resultStatus = normalizeStatus(lastResult?.status);
    const derivedStatus = nextProbe.schedule ? deriveMaintenanceScheduleStatus(nextProbe.schedule, now) : 'NO_SCHEDULE';
    const nextScheduleId = normalizeText(nextProbe.schedule?.id || nextProbe.schedule?.schedule_id || nextProbe.schedule?.scheduleId);
    const hasRealSchedule = isPersistedUuid(nextScheduleId);
    const hasSyntheticSchedule = sortedSchedules.some((schedule: any) => {
      const id = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
      return id && !isPersistedUuid(id);
    });
    const hasMissingTargetLabel = /habilidade\s+(nao|não)\s+(vinculada|encontrada)/i.test(String(row.targetName || ''));
    const hasRealTarget = Boolean(isPersistedUuid(row.targetId) && !row.targetMissing && !nextProbe.schedule?.target_missing && !hasMissingTargetLabel && row.hasRealTarget !== false);
    const needsTargetReview = !hasRealTarget || Boolean(row.targetMissing || nextProbe.schedule?.target_missing) || hasMissingTargetLabel;
    const cardKind = hasSyntheticSchedule && !hasRealSchedule
      ? 'ITEM_SINTETICO_LOCAL'
      : needsTargetReview && hasRealSchedule
        ? 'SCHEDULE_ORFAO'
        : hasRealTarget && hasRealSchedule
          ? 'SCHEDULE_VALIDO'
          : hasRealTarget
            ? 'TARGET_REAL_SEM_SCHEDULE'
            : 'SCHEDULE_ORFAO';
    const canOperateOnTarget = hasRealTarget && cardKind !== 'ITEM_SINTETICO_LOCAL';
    const group: PeiMaintenanceGroupKey =
      allCycleCompleted || (!nextProbe.schedule && COMPLETED_STATUSES.has(resultStatus))
        ? 'completed'
        : derivedStatus === 'DUE_TODAY'
          ? 'today'
          : derivedStatus === 'OVERDUE'
            ? 'overdue'
            : derivedStatus === 'PENDING_CONFIRMATION'
              ? 'confirmation'
              : ACTIVE_LINKLESS_STATUSES.has(String(derivedStatus))
                ? 'unlinked'
                : 'activeCycle';

    return {
      ...row,
      schedules: sortedSchedules,
      probeResults: sortedResults,
      activeAlert,
      lastResult,
      nextSchedule: nextProbe.schedule,
      nextProbe,
      cardKind,
      cardId: hasRealSchedule ? nextScheduleId : row.targetId || row.key,
      scheduleId: hasRealSchedule ? nextScheduleId : '',
      hasRealTarget,
      hasRealSchedule,
      needsTargetReview,
      canScheduleMaintenance: canOperateOnTarget,
      canWaitNextSession: canOperateOnTarget,
      canAssignAppointment: canOperateOnTarget && (hasRealSchedule || derivedStatus === 'NO_SCHEDULE'),
      canReviewLink: needsTargetReview && cardKind !== 'ITEM_SINTETICO_LOCAL',
      availableActions: needsTargetReview
        ? ['REVIEW_TARGET']
        : ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT'],
      group,
      hasCycle,
      completedCount,
      totalCycleCount: sortedSchedules.length,
      isMaintained: allCycleCompleted || COMPLETED_STATUSES.has(resultStatus),
      isRegressionRisk: REGRESSION_STATUSES.has(resultStatus) || Boolean(activeAlert),
      statusLabel:
        allCycleCompleted || COMPLETED_STATUSES.has(resultStatus)
          ? 'Habilidade mantida'
          : resultStatus === 'REGRESSION_RISK'
            ? 'Risco de regressao'
            : resultStatus === 'WATCH'
              ? 'Atencao'
              : formatPeiMaintenanceScheduleLabel(nextProbe.schedule, now),
    };
  });
}

export function summarizePeiMaintenanceRows(rows: any[]) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    pending: safeRows.filter((row) => row.group !== 'completed').length,
    today: safeRows.filter((row) => row.group === 'today').length,
    overdue: safeRows.filter((row) => row.group === 'overdue').length,
    unlinked: safeRows.filter((row) => row.group === 'unlinked').length,
    pendingConfirmation: safeRows.filter((row) => row.group === 'confirmation').length,
    completedCycles: safeRows.filter((row) => row.group === 'completed').length,
  };
}

export function groupPeiMaintenanceRows(rows: any[]) {
  const groups: Record<PeiMaintenanceGroupKey, any[]> = {
    today: [],
    overdue: [],
    unlinked: [],
    confirmation: [],
    activeCycle: [],
    completed: [],
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = (row?.group || 'activeCycle') as PeiMaintenanceGroupKey;
    groups[key]?.push(row);
  });
  return groups;
}

export function groupPeiMaintenanceRowsTargetFirst(rows: any[]) {
  const groups: Record<PeiMaintenanceTargetFirstGroupKey, any[]> = {
    maintenanceSkills: [],
    eligibleSkills: [],
    scheduled: [],
    waitingNextSession: [],
    overdue: [],
    technical: [],
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const status = normalizeStatus(row?.nextSchedule?.status || row?.status || row?.nextProbe?.status);
    const clinicalStatus = normalizeStatus(row?.clinicalStatus || row?.goal?.clinical_status || row?.goal?.clinicalStatus || row?.goal?.status || row?.goal?.phase);
    const needsTargetReview = Boolean(
      row?.needsTargetReview ||
      row?.targetMissing ||
      row?.nextSchedule?.target_missing ||
      row?.cardKind === 'SCHEDULE_ORFAO' ||
      row?.cardKind === 'ITEM_SINTETICO_LOCAL' ||
      !row?.hasRealTarget
    );
    if (needsTargetReview) {
      groups.technical.push(row);
      return;
    }
    if (row?.group === 'overdue') {
      groups.overdue.push(row);
      return;
    }
    if (row?.group === 'unlinked' || status === 'PENDING_NEXT_SESSION') {
      groups.waitingNextSession.push(row);
      return;
    }
    if (row?.hasRealSchedule && row?.group !== 'completed') {
      groups.scheduled.push(row);
      return;
    }
    if (['MAINTENANCE', 'MAINTAINED'].includes(clinicalStatus) || row?.hasCycle || row?.isMaintained) {
      groups.maintenanceSkills.push(row);
      return;
    }
    groups.eligibleSkills.push(row);
  });
  return groups;
}

export function buildPeiPlanHistoryEvents(input: {
  goals?: any[];
  masteryEvaluations?: any[];
  schedules?: any[];
  probeResults?: any[];
  alerts?: any[];
  history?: any[];
}) {
  const events: any[] = [];
  (Array.isArray(input.goals) ? input.goals : []).forEach((goal) => {
    const createdAt = goal?.created_at || goal?.createdAt || goal?.date || null;
    if (!createdAt && !goal?.status) return;
    events.push({
      id: `goal-${normalizeText(goal?.id || goal?.name)}`,
      date: createdAt,
      title: safeTargetName(goal?.name, 'Meta do PEI'),
      detail: goal?.status === 'completed' ? 'Meta adquirida' : 'Meta no plano de ensino',
      source: 'PEI',
    });
  });
  (Array.isArray(input.masteryEvaluations) ? input.masteryEvaluations : []).forEach((evaluation) => {
    const status = normalizeStatus(evaluation?.evaluation_status || evaluation?.evaluationStatus);
    events.push({
      id: `mastery-${normalizeText(evaluation?.id || evaluation?.target_id || evaluation?.targetName)}`,
      date: evaluation?.evaluated_at || evaluation?.evaluatedAt || evaluation?.created_at || evaluation?.createdAt,
      title: safeTargetName(evaluation?.target_name || evaluation?.targetName, 'Meta avaliada'),
      detail: status === 'MASTERED' || status === 'MET' ? 'Maestria pronta para revisao' : 'Avaliacao de maestria registrada',
      source: 'Maestria',
    });
  });
  (Array.isArray(input.schedules) ? input.schedules : []).forEach((schedule) => {
    const status = deriveMaintenanceScheduleStatus(schedule);
    events.push({
      id: `schedule-${normalizeText(schedule?.id || schedule?.target_id || schedule?.targetId)}`,
      date: schedule?.confirmed_at || schedule?.confirmedAt || schedule?.created_at || schedule?.createdAt || getScheduleReferenceDate(schedule),
      title: resolveMaintenanceTargetDisplay({ schedule }).targetDisplayName,
      detail:
        status === 'PENDING_CONFIRMATION'
          ? 'Probe pendente de confirmacao'
          : schedule?.appointment_id || schedule?.appointmentId
            ? 'Probe vinculada a sessao'
            : 'Probe agendada',
      source: 'Manutencao',
    });
  });
  (Array.isArray(input.probeResults) ? input.probeResults : []).forEach((result) => {
    const status = normalizeStatus(result?.status);
    events.push({
      id: `probe-${normalizeText(result?.id || result?.target_id || result?.targetId)}`,
      date: getResultReferenceDate(result),
      title: resolveMaintenanceTargetDisplay({ probe: result }).targetDisplayName,
      detail: status === 'MAINTAINED' ? 'Probe concluida com habilidade mantida' : `Probe concluida: ${status || 'registrada'}`,
      source: 'Resultado',
    });
  });
  (Array.isArray(input.alerts) ? input.alerts : []).forEach((alert) => {
    events.push({
      id: `alert-${normalizeText(alert?.id || alert?.target_id || alert?.targetId)}`,
      date: alert?.created_at || alert?.createdAt,
      title: resolveMaintenanceTargetDisplay({ probe: alert }).targetDisplayName,
      detail: safeTargetName(alert?.message, 'Risco de regressao'),
      source: 'Alerta',
    });
  });
  (Array.isArray(input.history) ? input.history : [])
    .filter((item) => String(item?.type || '').toLowerCase().includes('pei') || String(item?.subject || '').toLowerCase().includes('pei'))
    .forEach((item) => {
      events.push({
        id: `history-${normalizeText(item?.id || item?.date || item?.created_at)}`,
        date: item?.created_at || item?.date,
        title: safeTargetName(item?.title || item?.subject, 'Evento do PEI'),
        detail: safeTargetName(item?.note || item?.text || item?.description, 'Registro persistido'),
        source: 'Historico',
      });
    });
  return events
    .filter((event) => event.title || event.detail)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 80);
}
