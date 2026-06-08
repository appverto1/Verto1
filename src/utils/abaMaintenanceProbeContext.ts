import {
  deriveMaintenanceScheduleStatus,
  isActiveMaintenanceSchedule,
  resolveMaintenanceProbeAvailability
} from './abaMaintenanceScheduling';
import { isMaintenanceProbeCollection, normalizeAbaCollectionType } from './abaTrialLabels';

export type ManualMaintenanceProbeActivation = {
  targetId?: string | null;
  targetName?: string | null;
  scheduleId?: string | null;
  source?: 'available' | string | null;
  status?: string | null;
  dueDate?: string | null;
  appointmentId?: string | null;
  sessionId?: string | null;
  activatedAt?: string | null;
};

export type ActiveMaintenanceProbeForTarget = {
  active: true;
  targetId: string | null;
  targetName: string | null;
  scheduleId: string | null;
  status: string;
  dueDate: string | null;
  linkedToSession: boolean;
  manuallyActivated: boolean;
  source?: 'available' | string | null;
  schedule: any | null;
};

export const REGULAR_ABA_TRIAL_TYPES = ['dtt', 'net', 'cold_probe', 'baseline_probe'];

export const isRegularAbaTrialType = (value: unknown) => {
  const normalized = normalizeAbaCollectionType(value, '');
  return Boolean(normalized && !isMaintenanceProbeCollection(normalized) && REGULAR_ABA_TRIAL_TYPES.includes(normalized));
};

export const normalizeRegularAbaTrialType = (value: unknown, fallback: unknown = 'dtt') => {
  const normalized = normalizeAbaCollectionType(value, '');
  if (isRegularAbaTrialType(normalized)) return normalized;
  const normalizedFallback = normalizeAbaCollectionType(fallback, '');
  if (isRegularAbaTrialType(normalizedFallback)) return normalizedFallback;
  return 'dtt';
};

export const getMaintenanceTargetKey = (target: any) => {
  return String(target?.target_id || target?.targetId || target?.aba_target_id || target?.abaTargetId || target?.id || '').trim();
};

const targetNameFrom = (target: any) =>
  String(target?.name || target?.target_name || target?.targetName || '').trim();

const targetMatches = (row: any, targetId: string) => {
  const rowTargetId = String(row?.target_id || row?.targetId || row?.target?.id || row?.target || '').trim();
  return Boolean(targetId && rowTargetId && rowTargetId === targetId);
};

const scheduleDueDate = (schedule: any) =>
  schedule?.scheduled_for || schedule?.scheduledFor || schedule?.target_due_date || schedule?.targetDueDate || null;

export function getActiveMaintenanceProbeForTarget(input: {
  targetId?: string | null;
  targetName?: string | null;
  schedules?: any[];
  manualActivations?: Record<string, ManualMaintenanceProbeActivation | undefined>;
  activeAppointmentId?: string | null;
  sessionId?: string | null;
  sessionClinicalDate?: string | Date | null;
  timeZone?: string | null;
  now?: Date;
}): ActiveMaintenanceProbeForTarget | null {
  const targetId = String(input.targetId || '').trim();
  const targetName = String(input.targetName || '').trim();
  if (!targetId) return null;

  const manualActivations = input.manualActivations || {};
  const manualActivation = manualActivations[targetId];
  if (manualActivation) {
    return {
      active: true,
      targetId: targetId || String(manualActivation.targetId || '').trim() || null,
      targetName: targetName || String(manualActivation.targetName || '').trim() || null,
      scheduleId: String(manualActivation.scheduleId || '').trim() || null,
      status: String(manualActivation.status || 'MANUAL').toUpperCase(),
      dueDate: manualActivation.dueDate || null,
      linkedToSession: true,
      manuallyActivated: true,
      source: manualActivation.source || null,
      schedule: null
    };
  }

  const now = input.now || new Date();
  const activeAppointmentId = String(input.activeAppointmentId || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const targetSchedules = (Array.isArray(input.schedules) ? input.schedules : [])
    .filter((schedule) => targetMatches(schedule, targetId))
    .filter(isActiveMaintenanceSchedule);
  const availability = resolveMaintenanceProbeAvailability(targetSchedules, {
    appointmentId: activeAppointmentId,
    sessionId,
    sessionClinicalDate: input.sessionClinicalDate,
    occurredAt: now,
    timeZone: input.timeZone
  });
  const schedule = availability.availableSchedule || null;
  if (!schedule) return null;

  const status = deriveMaintenanceScheduleStatus(schedule, now);
  const scheduleAppointmentId = String(schedule?.appointment_id || schedule?.appointmentId || '').trim();
  return {
    active: true,
    targetId: targetId || String(schedule?.target_id || schedule?.targetId || '').trim() || null,
    targetName: targetName || targetNameFrom(schedule) || null,
    scheduleId: String(schedule?.id || schedule?.schedule_id || schedule?.scheduleId || '').trim() || null,
    status,
    dueDate: scheduleDueDate(schedule),
    linkedToSession: Boolean(
      (activeAppointmentId && scheduleAppointmentId && scheduleAppointmentId === activeAppointmentId) ||
      (!scheduleAppointmentId && scheduleDueDate(schedule))
    ),
    manuallyActivated: false,
    source: 'available',
    schedule
  };
}

export function resolveContextualTrialTypeForTarget(input: {
  requestedTrialType?: unknown;
  lastRegularTrialType?: unknown;
  activeProbe?: ActiveMaintenanceProbeForTarget | null;
  manualRegularOverride?: boolean;
}) {
  const regularFallback = normalizeRegularAbaTrialType(input.lastRegularTrialType, 'dtt');
  if (input.activeProbe && !input.manualRegularOverride) return 'maintenance_probe';
  const requested = normalizeAbaCollectionType(input.requestedTrialType, regularFallback);
  if (isMaintenanceProbeCollection(requested)) return regularFallback;
  return normalizeRegularAbaTrialType(requested, regularFallback);
}
