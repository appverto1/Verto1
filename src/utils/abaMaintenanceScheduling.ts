import { DEFAULT_ABA_MAINTENANCE_DAYS } from './abaMasteryEngine';

export type AbaMaintenanceScheduleMode =
  | 'DEFAULT_SEQUENCE'
  | 'CUSTOM_DATE'
  | 'NEXT_PATIENT_SESSION'
  | 'NEXT_AVAILABLE_SESSION';

export type AbaMaintenanceScheduleStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'UNSCHEDULED'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'MISSED'
  | 'CANCELLED';

export type MaintenanceAppointmentCandidate = {
  id?: string | null;
  appointment_id?: string | null;
  scheduled_at?: string | null;
  scheduledAt?: string | null;
  date?: string | null;
  time?: string | null;
  status?: string | null;
};

export type MaintenanceAppointmentMatch = {
  appointmentId: string | null;
  scheduledFor: string | null;
  targetDueDate: string;
  status: AbaMaintenanceScheduleStatus;
  matchType: 'AFTER_TARGET_DUE_DATE' | 'BEFORE_TARGET_DUE_DATE' | 'NO_APPOINTMENT_IN_WINDOW';
  toleranceStart: string;
  toleranceEnd: string;
};

export type MaintenanceSchedulePreview = {
  scheduleDay: number;
  targetDueDate: string;
  scheduledFor: string | null;
  appointmentId: string | null;
  status: AbaMaintenanceScheduleStatus;
  toleranceStart: string;
  toleranceEnd: string;
  scheduleMode: AbaMaintenanceScheduleMode;
  message: string;
};

export type NextMaintenanceProbe = {
  schedule: any | null;
  dueDate: string | null;
  appointmentId: string | null;
  status: AbaMaintenanceScheduleStatus | 'NO_SCHEDULE';
  isOverdue: boolean;
  isToday: boolean;
  isForNextSession: boolean;
  noSchedule: boolean;
  label: string;
};

const ACTIVE_APPOINTMENT_STATUSES = new Set(['scheduled', 'pending', 'confirmed', 'in_progress', 'rescheduled', 'reschedule']);
const ACTIVE_SCHEDULE_STATUSES = new Set(['PENDING', 'SCHEDULED', 'UNSCHEDULED', 'DUE_TODAY', 'OVERDUE', 'MISSED']);

export const isoOrNow = (value: unknown) => {
  const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

export const addDaysIso = (value: unknown, days: number) => {
  const date = new Date(isoOrNow(value));
  date.setUTCDate(date.getUTCDate() + Math.round(Number(days) || 0));
  return date.toISOString();
};

export const normalizeMaintenanceScheduleMode = (value: unknown): AbaMaintenanceScheduleMode => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CUSTOM_DATE') return 'CUSTOM_DATE';
  if (normalized === 'NEXT_PATIENT_SESSION') return 'NEXT_PATIENT_SESSION';
  if (normalized === 'NEXT_AVAILABLE_SESSION') return 'NEXT_AVAILABLE_SESSION';
  return 'DEFAULT_SEQUENCE';
};

export const normalizeMaintenanceScheduleStatus = (value: unknown): AbaMaintenanceScheduleStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SCHEDULED') return 'SCHEDULED';
  if (normalized === 'UNSCHEDULED') return 'UNSCHEDULED';
  if (normalized === 'DUE_TODAY') return 'DUE_TODAY';
  if (normalized === 'OVERDUE') return 'OVERDUE';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (normalized === 'MISSED') return 'MISSED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  return 'PENDING';
};

export const normalizeMaintenanceDayList = (value: unknown = DEFAULT_ABA_MAINTENANCE_DAYS) => {
  const raw = Array.isArray(value) && value.length > 0 ? value : DEFAULT_ABA_MAINTENANCE_DAYS;
  const days = raw
    .map((day) => Math.max(1, Math.round(Number(day) || 0)))
    .filter(Boolean);
  return Array.from(new Set(days)).sort((a, b) => a - b);
};

export const getMaintenanceToleranceDays = (scheduleDay: number) => {
  const day = Math.round(Number(scheduleDay) || 0);
  if (day <= 7) return { before: 1, after: 3 };
  if (day <= 14) return { before: 2, after: 4 };
  if (day <= 30) return { before: 5, after: 7 };
  return { before: 10, after: 14 };
};

export const isActiveAppointmentForMaintenance = (appointment: MaintenanceAppointmentCandidate) => {
  const status = String(appointment.status || 'scheduled').trim().toLowerCase();
  return ACTIVE_APPOINTMENT_STATUSES.has(status);
};

export const isActiveMaintenanceSchedule = (schedule: any) => {
  return ACTIVE_SCHEDULE_STATUSES.has(normalizeMaintenanceScheduleStatus(schedule?.status));
};

export const appointmentTimestamp = (appointment: MaintenanceAppointmentCandidate) => {
  const direct = appointment.scheduled_at || appointment.scheduledAt;
  if (direct) return isoOrNow(direct);
  const date = String(appointment.date || '').trim();
  const time = String(appointment.time || '00:00').trim();
  if (!date) return '';
  return isoOrNow(`${date}T${time.length === 5 ? `${time}:00` : time}`);
};

export function findBestAppointmentForMaintenanceProbe(
  appointments: MaintenanceAppointmentCandidate[],
  targetDueDate: string,
  options: { scheduleDay?: number; limit?: number } = {}
): MaintenanceAppointmentMatch {
  const safeLimit = Math.min(50, Math.max(1, Math.round(Number(options.limit || 20) || 20)));
  const dueMs = new Date(isoOrNow(targetDueDate)).getTime();
  const { before, after } = getMaintenanceToleranceDays(Number(options.scheduleDay || 7));
  const windowStartMs = dueMs - before * 86_400_000;
  const windowEndMs = dueMs + after * 86_400_000;
  const candidates = (Array.isArray(appointments) ? appointments : [])
    .filter(isActiveAppointmentForMaintenance)
    .map((appointment) => ({ appointment, scheduledFor: appointmentTimestamp(appointment) }))
    .filter((item) => item.scheduledFor)
    .map((item) => ({ ...item, scheduledMs: new Date(item.scheduledFor).getTime() }))
    .filter((item) => Number.isFinite(item.scheduledMs) && item.scheduledMs >= windowStartMs && item.scheduledMs <= windowEndMs)
    .sort((a, b) => {
      const aAfter = a.scheduledMs >= dueMs ? 0 : 1;
      const bAfter = b.scheduledMs >= dueMs ? 0 : 1;
      if (aAfter !== bAfter) return aAfter - bAfter;
      return Math.abs(a.scheduledMs - dueMs) - Math.abs(b.scheduledMs - dueMs);
    })
    .slice(0, safeLimit);
  const best = candidates[0];
  return best
    ? {
        appointmentId: String(best.appointment.id || best.appointment.appointment_id || ''),
        scheduledFor: best.scheduledFor,
        targetDueDate: isoOrNow(targetDueDate),
        status: 'SCHEDULED',
        matchType: best.scheduledMs >= dueMs ? 'AFTER_TARGET_DUE_DATE' : 'BEFORE_TARGET_DUE_DATE',
        toleranceStart: new Date(windowStartMs).toISOString(),
        toleranceEnd: new Date(windowEndMs).toISOString()
      }
    : {
        appointmentId: null,
        scheduledFor: null,
        targetDueDate: isoOrNow(targetDueDate),
        status: 'UNSCHEDULED',
        matchType: 'NO_APPOINTMENT_IN_WINDOW',
        toleranceStart: new Date(windowStartMs).toISOString(),
        toleranceEnd: new Date(windowEndMs).toISOString()
      };
}

export function buildDefaultMaintenanceSchedulePreview(input: {
  approvedAt?: string;
  maintenanceDays?: unknown;
  appointments?: MaintenanceAppointmentCandidate[];
}): MaintenanceSchedulePreview[] {
  const approvedAt = isoOrNow(input.approvedAt);
  const days = normalizeMaintenanceDayList(input.maintenanceDays);

  return days.map((day) => {
    const targetDueDate = addDaysIso(approvedAt, day);
    const match = findBestAppointmentForMaintenanceProbe(input.appointments || [], targetDueDate, { scheduleDay: day });
    return {
      scheduleDay: day,
      targetDueDate,
      scheduledFor: match.scheduledFor,
      appointmentId: match.appointmentId,
      status: match.status,
      toleranceStart: match.toleranceStart,
      toleranceEnd: match.toleranceEnd,
      scheduleMode: 'DEFAULT_SEQUENCE',
      message: match.appointmentId
        ? `Sondagem vinculada a uma sessao proxima do marco de ${day} dias.`
        : 'Sem sessao agendada proxima da data-alvo.'
    };
  });
}

const dateKey = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const scheduleReferenceDate = (schedule: any) =>
  schedule?.scheduled_for || schedule?.scheduledFor || schedule?.target_due_date || schedule?.targetDueDate || null;

export const deriveMaintenanceScheduleStatus = (schedule: any, now = new Date()): AbaMaintenanceScheduleStatus => {
  const status = normalizeMaintenanceScheduleStatus(schedule?.status);
  if (['COMPLETED', 'CANCELLED'].includes(status)) return status;
  const reference = scheduleReferenceDate(schedule);
  const referenceMs = reference ? new Date(reference).getTime() : NaN;
  if (!Number.isFinite(referenceMs)) return status;
  const todayKey = dateKey(now.toISOString());
  if (dateKey(reference) === todayKey) return 'DUE_TODAY';
  const todayStartMs = new Date(`${todayKey}T00:00:00.000Z`).getTime();
  if (referenceMs < todayStartMs) return 'OVERDUE';
  return status;
};

export const formatMaintenanceScheduleDueLabel = (schedule: any, now = new Date()) => {
  const scheduledFor = schedule?.scheduled_for || schedule?.scheduledFor;
  const targetDueDate = schedule?.target_due_date || schedule?.targetDueDate;
  const appointmentId = schedule?.appointment_id || schedule?.appointmentId;
  const status = deriveMaintenanceScheduleStatus(schedule, now);
  if (!schedule) return 'Sem sondagem agendada';
  if (status === 'UNSCHEDULED' && !scheduledFor && targetDueDate) return 'Sem sessao agendada proxima da data-alvo.';
  if (status === 'DUE_TODAY') return 'Proxima sondagem: hoje';
  if (status === 'OVERDUE') {
    const reference = scheduledFor || targetDueDate;
    const due = reference ? new Date(reference) : null;
    const diffDays = due && !Number.isNaN(due.getTime())
      ? Math.max(1, Math.ceil((now.getTime() - due.getTime()) / 86_400_000))
      : 1;
    return `Sondagem atrasada ha ${diffDays} dia(s)`;
  }
  if (appointmentId && status === 'SCHEDULED') {
    const reference = scheduledFor || targetDueDate;
    if (reference && dateKey(reference) === dateKey(now.toISOString())) return 'Proxima sondagem: hoje';
    if (String(schedule?.schedule_mode || schedule?.scheduleMode || '').toUpperCase() === 'NEXT_PATIENT_SESSION') {
      return reference ? `Agendada para proxima sessao: ${new Date(reference).toLocaleDateString('pt-BR')}` : 'Agendada para proxima sessao';
    }
  }
  const reference = scheduledFor || targetDueDate;
  if (!reference) return 'Sem sondagem agendada';
  const due = new Date(reference);
  if (Number.isNaN(due.getTime())) return 'Sem sondagem agendada';
  const todayKey = dateKey(now.toISOString());
  const dueKey = dateKey(reference);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (dueKey === todayKey) return 'Proxima sondagem: hoje';
  if (diffDays < 0) return `Sondagem atrasada ha ${Math.abs(diffDays)} dia(s)`;
  return `Proxima sondagem: ${due.toLocaleDateString('pt-BR')}`;
};

export function getNextMaintenanceProbeForTarget(schedules: any[] = [], now = new Date()): NextMaintenanceProbe {
  const active = (Array.isArray(schedules) ? schedules : [])
    .filter(isActiveMaintenanceSchedule)
    .sort((a, b) => {
      const aDate = new Date(a?.scheduled_for || a?.scheduledFor || a?.target_due_date || a?.targetDueDate || 0).getTime();
      const bDate = new Date(b?.scheduled_for || b?.scheduledFor || b?.target_due_date || b?.targetDueDate || 0).getTime();
      return aDate - bDate;
    });
  const schedule = active[0] || null;
  if (!schedule) {
    return {
      schedule: null,
      dueDate: null,
      appointmentId: null,
      status: 'NO_SCHEDULE',
      isOverdue: false,
      isToday: false,
      isForNextSession: false,
      noSchedule: true,
      label: 'Sem sondagem agendada'
    };
  }
  const dueDate = schedule.scheduled_for || schedule.scheduledFor || schedule.target_due_date || schedule.targetDueDate || null;
  const dueKey = dateKey(dueDate);
  const todayKey = dateKey(now.toISOString());
  const dueMs = dueDate ? new Date(dueDate).getTime() : NaN;
  const status = deriveMaintenanceScheduleStatus(schedule, now);
  return {
    schedule,
    dueDate,
    appointmentId: schedule.appointment_id || schedule.appointmentId || null,
    status,
    isOverdue: Number.isFinite(dueMs) && dueMs < new Date(todayKey || now.toISOString()).getTime(),
    isToday: Boolean(dueKey && dueKey === todayKey),
    isForNextSession: Boolean(schedule.appointment_id || schedule.appointmentId),
    noSchedule: false,
    label: formatMaintenanceScheduleDueLabel(schedule, now)
  };
}

export function selectMaintenanceScheduleForProbe(
  schedules: any[] = [],
  options: { appointmentId?: string | null; occurredAt?: string | Date | null } = {}
) {
  const appointmentId = String(options.appointmentId || '').trim();
  const occurred = new Date(options.occurredAt || Date.now());
  const occurredAt = Number.isNaN(occurred.getTime()) ? new Date() : occurred;
  const occurredKey = dateKey(occurredAt.toISOString());
  const occurredMs = occurredAt.getTime();
  const active = (Array.isArray(schedules) ? schedules : [])
    .filter(isActiveMaintenanceSchedule)
    .map((schedule) => {
      const reference = scheduleReferenceDate(schedule);
      const referenceMs = reference ? new Date(reference).getTime() : Number.POSITIVE_INFINITY;
      const windowStart = schedule?.window_start || schedule?.windowStart;
      const windowEnd = schedule?.window_end || schedule?.windowEnd;
      const windowStartMs = windowStart ? new Date(windowStart).getTime() : NaN;
      const windowEndMs = windowEnd ? new Date(windowEnd).getTime() : NaN;
      const sameAppointment = Boolean(appointmentId && String(schedule?.appointment_id || schedule?.appointmentId || '') === appointmentId);
      const dueToday = reference && dateKey(reference) === occurredKey;
      const overdue = Number.isFinite(referenceMs) && referenceMs < new Date(`${occurredKey}T00:00:00.000Z`).getTime();
      const inWindow = Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && occurredMs >= windowStartMs && occurredMs <= windowEndMs;
      const rank = sameAppointment ? 0 : dueToday ? 1 : overdue ? 2 : inWindow ? 3 : 4;
      return { schedule, rank, referenceMs, distance: Number.isFinite(referenceMs) ? Math.abs(referenceMs - occurredMs) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.rank === 2) return a.referenceMs - b.referenceMs;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.referenceMs - b.referenceMs;
    });

  return active[0]?.schedule || null;
}
