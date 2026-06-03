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

const safeTargetName = (value: any, fallback = 'Target em manutencao') => {
  const label = normalizeText(value);
  if (!label || UUID_LIKE.test(label)) return fallback;
  return label;
};

const getTargetKey = (...values: any[]) => {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized.toLowerCase();
  }
  return '';
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
    const key =
      getTargetKey(seed.target_id, seed.targetId, seed.skillId, seed.skill_id, seed.name, seed.target_name, seed.targetName) ||
      `target-${rowsByKey.size + 1}`;
    const existing = rowsByKey.get(key);
    if (existing) return existing;
    const row = {
      key,
      targetId: normalizeText(seed.target_id || seed.targetId || seed.id || ''),
      targetName: safeTargetName(seed.name || seed.target_name || seed.targetName || seed.raw_payload?.targetName || seed.rawPayload?.targetName),
      protocol: safeTargetName(seed.protocolTitle || seed.protocol_title || seed.protocol || seed.protocol_name, 'Sem protocolo informado'),
      domain: safeTargetName(seed.domainName || seed.domain_name || seed.domain || seed.program_name, 'Sem dominio informado'),
      clinicalStatus: normalizeStatus(seed.status || seed.clinical_status || seed.clinicalStatus || ''),
      goal: seed.goal || seed,
      schedules: [] as any[],
      probeResults: [] as any[],
      alerts: [] as any[],
    };
    rowsByKey.set(key, row);
    return row;
  };

  (Array.isArray(input.goals) ? input.goals : [])
    .filter((goal) => ['completed', 'acquired', 'adquirido', 'maintenance', 'maintained'].includes(String(goal?.status || '').toLowerCase()))
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
      title: safeTargetName(schedule?.target_name || schedule?.targetName || schedule?.raw_payload?.targetName || schedule?.rawPayload?.targetName, 'Sondagem de manutencao'),
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
      title: safeTargetName(result?.target_name || result?.targetName || result?.raw_payload?.targetName || result?.rawPayload?.targetName, 'Probe de manutencao'),
      detail: status === 'MAINTAINED' ? 'Probe concluida com habilidade mantida' : `Probe concluida: ${status || 'registrada'}`,
      source: 'Resultado',
    });
  });
  (Array.isArray(input.alerts) ? input.alerts : []).forEach((alert) => {
    events.push({
      id: `alert-${normalizeText(alert?.id || alert?.target_id || alert?.targetId)}`,
      date: alert?.created_at || alert?.createdAt,
      title: safeTargetName(alert?.target_name || alert?.targetName, 'Alerta de manutencao'),
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
