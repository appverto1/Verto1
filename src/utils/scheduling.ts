export type ScheduleLocationType = 'clinica' | 'online' | 'domicilio' | 'escola' | 'outro';

export type ScheduleConflictType = 'professional' | 'room' | 'patient' | 'team';

export type ScheduleConflict = {
  conflictType: ScheduleConflictType;
  humanMessage: string;
  blocking: boolean;
  date?: string;
  startTime?: string;
  endTime?: string;
  relatedEventId?: string;
};

export type ScheduleConflictResult = {
  hasConflict: boolean;
  conflicts: ScheduleConflict[];
  blocking: boolean;
  humanMessage: string;
};

export const BLOCKING_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in_progress'];
export const NON_BLOCKING_APPOINTMENT_STATUSES = ['canceled', 'cancelled', 'no_show', 'deleted', 'completed'];
export const DEFAULT_SESSION_DURATION_MINUTES = 50;
export const SESSION_DURATION_QUICK_OPTIONS = [30, 45, 50, 60, 90];
export const SCHEDULE_LOCATION_OPTIONS: Array<{ value: ScheduleLocationType; label: string }> = [
  { value: 'clinica', label: 'Clínica' },
  { value: 'online', label: 'Online' },
  { value: 'domicilio', label: 'Domicílio' },
  { value: 'escola', label: 'Escola' },
  { value: 'outro', label: 'Outro' }
];

export function normalizeScheduleLocationType(value: any): ScheduleLocationType {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normalized.includes('clinic') || normalized.includes('sala')) return 'clinica';
  if (normalized.includes('online') || normalized.includes('remoto')) return 'online';
  if (normalized.includes('domic')) return 'domicilio';
  if (normalized.includes('escola')) return 'escola';
  if (normalized.includes('outro')) return 'outro';
  return 'clinica';
}

export function isClinicLocationType(value: any): boolean {
  return normalizeScheduleLocationType(value) === 'clinica';
}

export function timeToMinutes(value: any): number {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 60 + (Number(match[2]) || 0);
}

export function minutesToTime(value: number): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function addMinutesToTime(startTime: any, durationMinutes: any): string {
  return minutesToTime(timeToMinutes(startTime) + normalizeDurationMinutes(durationMinutes));
}

export function normalizeDurationMinutes(value: any, fallback = DEFAULT_SESSION_DURATION_MINUTES): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(15, Math.min(720, Math.round(numeric)));
}

export function getAppointmentDurationOption(value: any, fallback = DEFAULT_SESSION_DURATION_MINUTES): string {
  const duration = normalizeDurationMinutes(value, fallback);
  return SESSION_DURATION_QUICK_OPTIONS.includes(duration) ? String(duration) : 'custom';
}

export function buildRecurrenceDateKeys(params: {
  startDate: any;
  count?: any;
  pattern?: any;
}): string[] {
  const dateKey = String(params.startDate || '').slice(0, 10);
  const count = Math.min(120, Math.max(1, Math.round(Number(params.count || 1) || 1)));
  const pattern = String(params.pattern || 'weekly').toLowerCase();
  const first = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? new Date(`${dateKey}T00:00:00`) : null;
  if (!first || Number.isNaN(first.getTime())) return [];
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(first);
    if (pattern === 'monthly') {
      next.setMonth(first.getMonth() + index);
    } else {
      next.setDate(first.getDate() + index * (pattern === 'biweekly' ? 14 : 7));
    }
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  });
}

export function appointmentTimesOverlap(startA: any, endA: any, startB: any, endB: any): boolean {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
}

export function isoRangesOverlap(startA: any, endA: any, startB: any, endB: any): boolean {
  const aStart = new Date(startA).getTime();
  const aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  const bEnd = new Date(endB).getTime();
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  return aStart < bEnd && aEnd > bStart;
}

export function getAppointmentDurationMinutes(appointment: any, fallback = DEFAULT_SESSION_DURATION_MINUTES): number {
  const raw =
    appointment?.duration_minutes ??
    appointment?.durationMinutes ??
    appointment?.scheduled_duration_minutes ??
    appointment?.scheduledDurationMinutes ??
    appointment?.duration;
  return normalizeDurationMinutes(raw, fallback);
}

export function getAppointmentEndTime(appointment: any, fallback = DEFAULT_SESSION_DURATION_MINUTES): string {
  const explicit = appointment?.endTime || appointment?.end_time;
  if (explicit) return String(explicit).slice(0, 5);
  return addMinutesToTime(appointment?.time || '08:00', getAppointmentDurationMinutes(appointment, fallback));
}

export function buildLocalDateTimeIso(date: any, time: any): string | null {
  const dateKey = String(date || '').trim();
  const timeKey = String(time || '').trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeKey)) return null;
  const parsed = new Date(`${dateKey}T${timeKey}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function getAppointmentStartDateTime(appointment: any): Date | null {
  const explicit =
    appointment?.start_time ||
    appointment?.startTime ||
    appointment?.scheduled_at ||
    appointment?.scheduledAt ||
    appointment?.scheduled_start ||
    appointment?.scheduledStart;
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallbackIso = buildLocalDateTimeIso(appointment?.date, appointment?.time);
  if (!fallbackIso) return null;
  const parsed = new Date(fallbackIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getAppointmentEndDateTime(appointment: any): Date | null {
  const explicit =
    appointment?.end_time ||
    appointment?.endTime ||
    appointment?.scheduled_end ||
    appointment?.scheduledEnd ||
    appointment?.scheduled_end_at ||
    appointment?.scheduledEndAt;
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const start = getAppointmentStartDateTime(appointment);
  if (!start) return null;
  return new Date(start.getTime() + getAppointmentDurationMinutes(appointment) * 60 * 1000);
}

export function appointmentBlocksConflict(appointment: any): boolean {
  const normalized = String(appointment?.status || 'scheduled').toLowerCase();
  if (NON_BLOCKING_APPOINTMENT_STATUSES.includes(normalized)) return false;
  return BLOCKING_APPOINTMENT_STATUSES.includes(normalized) || normalized === 'pending';
}

export function getAppointmentRoomId(appointment: any): string {
  return String(appointment?.room_id || appointment?.roomId || appointment?.room || '').trim();
}

export function getAppointmentLocationType(appointment: any): ScheduleLocationType {
  return normalizeScheduleLocationType(appointment?.location_type || appointment?.locationType || appointment?.location || appointment?.local || appointment?.room);
}

export function getAppointmentPatientId(appointment: any): string {
  return String(appointment?.patient_id || appointment?.patientId || '').trim();
}

export function getAppointmentPatientName(appointment: any): string {
  return String(appointment?.patient_name || appointment?.patientName || appointment?.name || 'Paciente').trim();
}

export function getAppointmentProfessionalIds(appointment: any): string[] {
  const source = [
    appointment?.therapist_id,
    appointment?.therapistId,
    appointment?.professional_id,
    appointment?.professionalId,
    appointment?.responsible_professional_id,
    appointment?.responsibleProfessionalId,
    ...(Array.isArray(appointment?.professional_ids) ? appointment.professional_ids : []),
    ...(Array.isArray(appointment?.professionalIds) ? appointment.professionalIds : []),
    ...(Array.isArray(appointment?.team_professional_ids) ? appointment.team_professional_ids : []),
    ...(Array.isArray(appointment?.teamProfessionalIds) ? appointment.teamProfessionalIds : [])
  ];
  return Array.from(new Set(source.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function getAppointmentProfessionalNames(appointment: any): string[] {
  const source = [
    appointment?.therapist_name,
    appointment?.therapistName,
    appointment?.professional_name,
    appointment?.professionalName,
    appointment?.professional,
    ...(Array.isArray(appointment?.professional_names) ? appointment.professional_names : []),
    ...(Array.isArray(appointment?.professionalNames) ? appointment.professionalNames : []),
    ...(Array.isArray(appointment?.teamProfessionalNames) ? appointment.teamProfessionalNames : [])
  ];
  return Array.from(new Set(source.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function getAppointmentServiceType(appointment: any): string {
  return String(appointment?.service_type || appointment?.serviceType || appointment?.type || appointment?.approach || 'Sessao').trim();
}

export function formatMinutesHuman(minutes: number): string {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}min`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}min`;
}

export function getActualDurationMinutes(appointment: any): number {
  const explicit = Number(appointment?.actual_duration_minutes ?? appointment?.actualDurationMinutes);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);
  const start = appointment?.actual_start || appointment?.actualStart || appointment?.actual_start_at || appointment?.actualStartAt;
  const end = appointment?.actual_end || appointment?.actualEnd || appointment?.actual_end_at || appointment?.actualEndAt;
  if (start && end) {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    if (Number.isFinite(diff) && diff >= 0) return Math.round(diff / 60000);
  }
  return getAppointmentDurationMinutes(appointment);
}

export function checkLocalScheduleConflicts(input: {
  appointments: any[];
  patient_id?: any;
  patient_name?: any;
  professional_ids?: any[];
  professional_names?: any[];
  room_id?: any;
  room_name?: any;
  location_type?: any;
  date?: any;
  start_time?: any;
  end_time?: any;
  duration_minutes?: any;
  exclude_event_id?: any;
  recurrence_dates?: any[];
}): ScheduleConflictResult {
  const appointments = Array.isArray(input.appointments) ? input.appointments : [];
  const recurrenceDates = Array.isArray(input.recurrence_dates) && input.recurrence_dates.length > 0
    ? input.recurrence_dates
    : [input.date];
  const locationType = normalizeScheduleLocationType(input.location_type);
  const startTime = String(input.start_time || '').slice(0, 5);
  const endTime = String(input.end_time || addMinutesToTime(startTime, input.duration_minutes)).slice(0, 5);
  const patientId = String(input.patient_id || '').trim();
  const patientName = String(input.patient_name || '').trim();
  const roomId = String(input.room_id || '').trim();
  const roomName = String(input.room_name || roomId || 'Sala').trim();
  const professionalIds = new Set((input.professional_ids || []).map((value) => String(value || '').trim()).filter(Boolean));
  const professionalNames = new Set((input.professional_names || []).map((value) => String(value || '').trim()).filter(Boolean));
  const excludeId = String(input.exclude_event_id || '').trim();
  const conflicts: ScheduleConflict[] = [];

  const addConflict = (conflict: ScheduleConflict) => {
    if (!conflicts.some((item) => item.humanMessage === conflict.humanMessage)) conflicts.push(conflict);
  };

  for (const date of recurrenceDates) {
    const dateKey = String(date || '').slice(0, 10);
    if (!dateKey || !startTime || !endTime) continue;

    for (const appointment of appointments) {
      if (excludeId && String(appointment?.id || '') === excludeId) continue;
      if (!appointmentBlocksConflict(appointment)) continue;
      if (String(appointment?.date || '').slice(0, 10) !== dateKey) {
        const start = getAppointmentStartDateTime(appointment);
        if (!start || start.toISOString().slice(0, 10) !== dateKey) continue;
      }

      const existingStart = String(appointment?.time || '').slice(0, 5);
      const existingEnd = getAppointmentEndTime(appointment);
      if (!appointmentTimesOverlap(startTime, endTime, existingStart, existingEnd)) continue;

      const existingPatientId = getAppointmentPatientId(appointment);
      const existingPatientName = getAppointmentPatientName(appointment);
      if (
        (patientId && existingPatientId && patientId === existingPatientId) ||
        (!patientId && patientName && existingPatientName.toLowerCase() === patientName.toLowerCase())
      ) {
        addConflict({
          conflictType: 'patient',
          humanMessage: `${patientName || existingPatientName || 'Paciente'} ja possui outra sessao nesse horario.`,
          blocking: true,
          date: dateKey,
          startTime: existingStart,
          endTime: existingEnd,
          relatedEventId: String(appointment?.id || '')
        });
      }

      if (locationType === 'clinica' && roomId && getAppointmentRoomId(appointment) === roomId) {
        addConflict({
          conflictType: 'room',
          humanMessage: `${roomName} ja esta ocupada das ${existingStart} as ${existingEnd} com ${existingPatientName}.`,
          blocking: true,
          date: dateKey,
          startTime: existingStart,
          endTime: existingEnd,
          relatedEventId: String(appointment?.id || '')
        });
      }

      const existingProfessionalIds = getAppointmentProfessionalIds(appointment);
      const existingProfessionalNames = getAppointmentProfessionalNames(appointment);
      const professionalIdConflict = existingProfessionalIds.some((id) => professionalIds.has(id));
      const professionalNameConflict = existingProfessionalNames.some((name) => professionalNames.has(name));
      if (professionalIdConflict || professionalNameConflict) {
        const professionalName =
          existingProfessionalNames.find((name) => professionalNames.has(name)) ||
          Array.from(professionalNames)[0] ||
          existingProfessionalNames[0] ||
          'Profissional';
        addConflict({
          conflictType: existingProfessionalIds.length > 1 ? 'team' : 'professional',
          humanMessage: `${professionalName} ja possui atendimento das ${existingStart} as ${existingEnd}.`,
          blocking: true,
          date: dateKey,
          startTime: existingStart,
          endTime: existingEnd,
          relatedEventId: String(appointment?.id || '')
        });
      }
    }
  }

  const blocking = conflicts.some((conflict) => conflict.blocking);
  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    blocking,
    humanMessage: conflicts[0]?.humanMessage || 'Horario disponivel.'
  };
}

export function buildPatientTimeReport(appointments: any[], options: {
  patient_id?: any;
  patient_name?: any;
  from?: any;
  to?: any;
  service_type?: any;
  professional_id?: any;
  status?: any;
} = {}) {
  const fromTime = options.from ? new Date(options.from).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = options.to ? new Date(options.to).getTime() : Number.POSITIVE_INFINITY;
  const patientId = String(options.patient_id || '').trim();
  const patientName = String(options.patient_name || '').trim().toLowerCase();
  const serviceType = String(options.service_type || '').trim().toLowerCase();
  const professionalId = String(options.professional_id || '').trim();
  const statusFilter = String(options.status || '').trim().toLowerCase();
  const byServiceType: Record<string, any> = {};
  const monthlyEvolution: Record<string, number> = {};
  const metrics = {
    scheduledMinutes: 0,
    actualMinutes: 0,
    cancelledMinutes: 0,
    predictedMinutes: 0,
    completedSessionsCount: 0,
    scheduledSessionsCount: 0,
    noShowCount: 0,
    cancelledCount: 0
  };

  for (const appointment of appointments || []) {
    const start = getAppointmentStartDateTime(appointment);
    if (!start) continue;
    const startMs = start.getTime();
    if (startMs < fromTime || startMs > toTime) continue;
    if (patientId && getAppointmentPatientId(appointment) !== patientId) continue;
    if (!patientId && patientName && getAppointmentPatientName(appointment).toLowerCase() !== patientName) continue;
    if (professionalId && !getAppointmentProfessionalIds(appointment).includes(professionalId)) continue;
    const status = String(appointment?.status || 'scheduled').toLowerCase();
    if (statusFilter && status !== statusFilter) continue;
    const type = getAppointmentServiceType(appointment);
    if (serviceType && type.toLowerCase() !== serviceType) continue;
    const scheduledMinutes = getAppointmentDurationMinutes(appointment);
    const actualMinutes = getActualDurationMinutes(appointment);
    const bucket = byServiceType[type] || {
      serviceType: type,
      scheduledMinutes: 0,
      actualMinutes: 0,
      sessionsCount: 0
    };
    bucket.scheduledMinutes += scheduledMinutes;
    bucket.sessionsCount += 1;
    metrics.scheduledSessionsCount += 1;
    metrics.scheduledMinutes += scheduledMinutes;
    if (status === 'completed' || appointment?.has_session_record || appointment?.hasSessionRecord) {
      bucket.actualMinutes += actualMinutes;
      metrics.actualMinutes += actualMinutes;
      metrics.completedSessionsCount += 1;
      const month = start.toISOString().slice(0, 7);
      monthlyEvolution[month] = (monthlyEvolution[month] || 0) + actualMinutes;
    } else if (status === 'canceled' || status === 'cancelled') {
      metrics.cancelledMinutes += scheduledMinutes;
      metrics.cancelledCount += 1;
    } else if (status === 'missed' || status === 'no_show') {
      metrics.noShowCount += 1;
    } else if (start.getTime() > Date.now()) {
      metrics.predictedMinutes += scheduledMinutes;
    }
    byServiceType[type] = bucket;
  }

  return {
    ...metrics,
    averageDurationMinutes: metrics.scheduledSessionsCount > 0
      ? Math.round(metrics.scheduledMinutes / metrics.scheduledSessionsCount)
      : 0,
    byServiceType: Object.values(byServiceType),
    monthlyEvolution: Object.entries(monthlyEvolution).map(([yearMonth, actualMinutes]) => ({ yearMonth, actualMinutes }))
  };
}

export function buildProfessionalWorkReport(appointments: any[], options: {
  professional_id?: any;
  professional_name?: any;
  from?: any;
  to?: any;
  service_type?: any;
  patient_id?: any;
  status?: any;
} = {}) {
  const fromTime = options.from ? new Date(options.from).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = options.to ? new Date(options.to).getTime() : Number.POSITIVE_INFINITY;
  const professionalId = String(options.professional_id || '').trim();
  const professionalName = String(options.professional_name || '').trim();
  const patientId = String(options.patient_id || '').trim();
  const serviceType = String(options.service_type || '').trim().toLowerCase();
  const statusFilter = String(options.status || '').trim().toLowerCase();
  const byDay: Record<string, any> = {};
  const byServiceType: Record<string, number> = {};
  const metrics = {
    scheduledMinutes: 0,
    actualMinutes: 0,
    completedSessionsCount: 0,
    scheduledSessionsCount: 0,
    noShowCount: 0,
    cancelledCount: 0
  };

  for (const appointment of appointments || []) {
    const start = getAppointmentStartDateTime(appointment);
    if (!start) continue;
    const startMs = start.getTime();
    if (startMs < fromTime || startMs > toTime) continue;
    if (patientId && getAppointmentPatientId(appointment) !== patientId) continue;
    const professionalIds = getAppointmentProfessionalIds(appointment);
    const professionalNames = getAppointmentProfessionalNames(appointment);
    if (professionalId && !professionalIds.includes(professionalId)) continue;
    if (!professionalId && professionalName && !professionalNames.includes(professionalName)) continue;
    const type = getAppointmentServiceType(appointment);
    if (serviceType && type.toLowerCase() !== serviceType) continue;
    const status = String(appointment?.status || 'scheduled').toLowerCase();
    if (statusFilter && status !== statusFilter) continue;
    const scheduledMinutes = getAppointmentDurationMinutes(appointment);
    const actualMinutes = getActualDurationMinutes(appointment);
    const workDate = start.toISOString().slice(0, 10);
    const day = byDay[workDate] || {
      workDate,
      scheduledMinutes: 0,
      actualMinutes: 0,
      sessionsCount: 0
    };
    day.scheduledMinutes += scheduledMinutes;
    day.sessionsCount += 1;
    metrics.scheduledMinutes += scheduledMinutes;
    metrics.scheduledSessionsCount += 1;
    byServiceType[type] = (byServiceType[type] || 0) + scheduledMinutes;
    if (status === 'completed' || appointment?.has_session_record || appointment?.hasSessionRecord) {
      day.actualMinutes += actualMinutes;
      metrics.actualMinutes += actualMinutes;
      metrics.completedSessionsCount += 1;
    } else if (status === 'canceled' || status === 'cancelled') {
      metrics.cancelledCount += 1;
    } else if (status === 'missed' || status === 'no_show') {
      metrics.noShowCount += 1;
    }
    byDay[workDate] = day;
  }

  return {
    ...metrics,
    workedDaysCount: Object.keys(byDay).length,
    byDay: Object.values(byDay).sort((a: any, b: any) => a.workDate.localeCompare(b.workDate)),
    byServiceType: Object.entries(byServiceType).map(([type, minutes]) => ({ serviceType: type, minutes }))
  };
}
