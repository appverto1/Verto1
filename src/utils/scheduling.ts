export type ScheduleLocationType = 'clinica' | 'online' | 'domicilio' | 'escola' | 'outro';
export type CareSetting = 'CLINIC' | 'ONLINE' | 'PATIENT_HOME' | 'SCHOOL' | 'OTHER';

export type ScheduleConflictType = 'professional' | 'room' | 'patient' | 'team' | 'specialty';

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

export const DEFAULT_APPOINTMENT_TIMEZONE = 'America/Sao_Paulo';
export const BLOCKING_APPOINTMENT_STATUSES = [
  'pending',
  'pendente',
  'cancel_requested',
  'cancelamento_solicitado',
  'reschedule_requested',
  'remarcacao_solicitada',
  'scheduled',
  'agendada',
  'agendado',
  'confirmed',
  'confirmada',
  'confirmado',
  'in_progress',
  'em_andamento',
  'completed',
  'concluida',
  'concluido',
  'realizada',
  'realizado',
  'rescheduled_active',
  'remarcada_ativa',
  'remarcado_ativo'
];
export const NON_BLOCKING_APPOINTMENT_STATUSES = [
  'canceled',
  'cancelled',
  'cancelada',
  'cancelado',
  'no_show',
  'missed',
  'falta',
  'faltou',
  'deleted',
  'archived',
  'inactive',
  'rescheduled',
  'remarcada',
  'remarcado',
  'rescheduled_old',
  'rescheduled_previous',
  'rescheduled_inactive',
  'remarcada_antiga',
  'remarcado_antigo'
];
export const BLOCKING_APPOINTMENT_STATUS_QUERY_VALUES = Array.from(new Set(
  BLOCKING_APPOINTMENT_STATUSES.flatMap((status) => [
    status,
    status.toUpperCase(),
    status.replace(/_/g, '-'),
    status.replace(/_/g, ' ').toUpperCase()
  ])
));
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

export function normalizeCareSetting(value: any, legacyLocationType?: any): CareSetting {
  const normalized = String(value || '').trim().toUpperCase();
  if (['CLINIC', 'ONLINE', 'PATIENT_HOME', 'SCHOOL', 'OTHER'].includes(normalized)) {
    return normalized as CareSetting;
  }
  const legacy = normalizeScheduleLocationType(legacyLocationType ?? value);
  if (legacy === 'clinica') return 'CLINIC';
  if (legacy === 'online') return 'ONLINE';
  if (legacy === 'domicilio') return 'PATIENT_HOME';
  if (legacy === 'escola') return 'SCHOOL';
  return 'OTHER';
}

export function careSettingToLocationType(value: any): ScheduleLocationType {
  const setting = normalizeCareSetting(value);
  if (setting === 'CLINIC') return 'clinica';
  if (setting === 'ONLINE') return 'online';
  if (setting === 'PATIENT_HOME') return 'domicilio';
  if (setting === 'SCHOOL') return 'escola';
  return 'outro';
}

export function isClinicLocationType(value: any): boolean {
  return normalizeScheduleLocationType(value) === 'clinica';
}

export function normalizeAppointmentStatus(value: any): string {
  return String(value || 'scheduled')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeAppointmentTime(value: any): string {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isValidAppointmentTime(value: any): boolean {
  return /^\d{2}:\d{2}$/.test(String(value || '').trim()) && normalizeAppointmentTime(value) === String(value || '').trim();
}

export function normalizeAppointmentDate(value: any): string {
  const dateKey = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedDateParts(value: Date, timezone = DEFAULT_APPOINTMENT_TIMEZONE): ZonedDateParts | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || DEFAULT_APPOINTMENT_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(value);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const parsed = {
      year: Number(byType.get('year')),
      month: Number(byType.get('month')),
      day: Number(byType.get('day')),
      hour: Number(byType.get('hour')),
      minute: Number(byType.get('minute')),
      second: Number(byType.get('second'))
    };
    return Object.values(parsed).every(Number.isFinite) ? parsed : null;
  } catch {
    return null;
  }
}

function getTimezoneOffsetMinutes(value: Date, timezone = DEFAULT_APPOINTMENT_TIMEZONE): number {
  const parts = getZonedDateParts(value, timezone);
  if (!parts) return -value.getTimezoneOffset();
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return (localAsUtc - value.getTime()) / 60000;
}

export function formatDateInAppointmentTimezone(value: any, timezone = DEFAULT_APPOINTMENT_TIMEZONE): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const parts = getZonedDateParts(date, timezone);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatTimeInAppointmentTimezone(value: any, timezone = DEFAULT_APPOINTMENT_TIMEZONE): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const parts = getZonedDateParts(date, timezone);
  if (!parts) return '';
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatDateTimeInAppointmentTimezone(value: any, timezone = DEFAULT_APPOINTMENT_TIMEZONE): string {
  const dateKey = formatDateInAppointmentTimezone(value, timezone);
  const timeKey = formatTimeInAppointmentTimezone(value, timezone);
  if (!dateKey || !timeKey) return '';
  const [, month, day] = dateKey.split('-');
  return `${day}/${month} ${timeKey}`;
}

export function buildAppointmentDateTime(date: any, time: any, timezone = DEFAULT_APPOINTMENT_TIMEZONE): Date | null {
  const dateKey = normalizeAppointmentDate(date);
  const timeKey = normalizeAppointmentTime(time);
  if (!dateKey || !timeKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = timeKey.split(':').map(Number);
  if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;

  const localAsUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  let utcMs = localAsUtc;
  for (let index = 0; index < 2; index += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcMs), timezone);
    utcMs = localAsUtc - offsetMinutes * 60000;
  }
  const result = new Date(utcMs);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function buildClinicDateRange(fromDate: any, toDate: any, timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const fromKey = normalizeAppointmentDate(fromDate);
  const toKey = normalizeAppointmentDate(toDate);
  const from = fromKey ? buildAppointmentDateTime(fromKey, '00:00', timezone) : null;
  const toStart = toKey ? buildAppointmentDateTime(toKey, '23:59', timezone) : null;
  const to = toStart ? new Date(toStart.getTime() + 59999) : null;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from.toISOString() : '',
    to: to && !Number.isNaN(to.getTime()) ? to.toISOString() : ''
  };
}

export function buildClinicMonthDateRange(reference: any = new Date(), timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const referenceKey = formatDateInAppointmentTimezone(reference, timezone) || formatDateInAppointmentTimezone(new Date(), timezone);
  const [yearText, monthText] = referenceKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return buildClinicDateRange('', '', timezone);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return buildClinicDateRange(
    `${yearText}-${monthText}-01`,
    `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`,
    timezone
  );
}

export function calculateAppointmentEnd(startAt: any, durationMinutes: any): Date | null {
  if (startAt === null || startAt === undefined || startAt === '') return null;
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + normalizeDurationMinutes(durationMinutes) * 60 * 1000);
}

export function timeToMinutes(value: any): number {
  const normalizedTime = normalizeAppointmentTime(value);
  const match = normalizedTime.match(/^(\d{2}):(\d{2})$/);
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
  const dateKey = normalizeAppointmentDate(params.startDate);
  const count = Math.min(120, Math.max(1, Math.round(Number(params.count || 1) || 1)));
  const pattern = String(params.pattern || 'weekly').toLowerCase();
  const first = dateKey ? new Date(`${dateKey}T00:00:00`) : null;
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

export type WeeklyScheduleSlot = {
  id?: string;
  weekday: number;
  time: string;
  specialty: string;
  professionalId?: string;
  professionalName?: string;
  durationMinutes?: number;
};

export type WeeklyScheduleOccurrence = WeeklyScheduleSlot & {
  slotId: string;
  date: string;
  weekIndex: number;
};

export const WEEKLY_SCHEDULE_DAYS = [
  { value: 1, shortLabel: 'Seg', label: 'Segunda-feira' },
  { value: 2, shortLabel: 'Ter', label: 'Terça-feira' },
  { value: 3, shortLabel: 'Qua', label: 'Quarta-feira' },
  { value: 4, shortLabel: 'Qui', label: 'Quinta-feira' },
  { value: 5, shortLabel: 'Sex', label: 'Sexta-feira' },
  { value: 6, shortLabel: 'Sáb', label: 'Sábado' },
  { value: 0, shortLabel: 'Dom', label: 'Domingo' },
] as const;

const normalizeWeeklyScheduleSpecialty = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function normalizeWeeklyScheduleSlots(slots: any[]): WeeklyScheduleSlot[] {
  return (Array.isArray(slots) ? slots : [])
    .map((slot: any, index: number) => ({
      id: String(slot?.id || slot?.slotId || `slot-${index + 1}`),
      weekday: Math.max(0, Math.min(6, Math.round(Number(slot?.weekday) || 0))),
      time: normalizeAppointmentTime(slot?.time),
      specialty: String(slot?.specialty || slot?.approach || slot?.serviceType || slot?.service_type || '').trim(),
      professionalId: String(slot?.professionalId || slot?.professional_id || slot?.therapistId || slot?.therapist_id || '').trim() || undefined,
      professionalName: String(slot?.professionalName || slot?.professional_name || slot?.therapistName || slot?.therapist_name || slot?.professional || '').trim() || undefined,
      durationMinutes: normalizeDurationMinutes(slot?.durationMinutes || slot?.duration_minutes || DEFAULT_SESSION_DURATION_MINUTES),
    }))
    .filter((slot) => Boolean(slot.time && slot.specialty));
}

export function buildWeeklyScheduleOccurrences(params: {
  startDate: any;
  weeks?: any;
  slots?: any[];
  maxOccurrences?: number;
}): WeeklyScheduleOccurrence[] {
  const startDateKey = normalizeAppointmentDate(params.startDate);
  const start = startDateKey ? new Date(`${startDateKey}T00:00:00`) : null;
  if (!start || Number.isNaN(start.getTime())) return [];
  const weeks = Math.min(52, Math.max(1, Math.round(Number(params.weeks || 1) || 1)));
  const maxOccurrences = Math.min(240, Math.max(1, Number(params.maxOccurrences || 120) || 120));
  const slots = normalizeWeeklyScheduleSlots(params.slots || []);
  if (slots.length === 0) return [];

  const monday = new Date(start);
  const mondayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - mondayOffset);

  const occurrences: WeeklyScheduleOccurrence[] = [];
  for (let weekIndex = 0; weekIndex < weeks; weekIndex += 1) {
    for (const slot of slots) {
      const candidate = new Date(monday);
      const dayOffsetFromMonday = (slot.weekday + 6) % 7;
      candidate.setDate(monday.getDate() + weekIndex * 7 + dayOffsetFromMonday);
      const date = localDateKey(candidate);
      if (date < startDateKey) continue;
      occurrences.push({
        ...slot,
        slotId: String(slot.id || ''),
        date,
        weekIndex,
      });
      if (occurrences.length >= maxOccurrences) break;
    }
    if (occurrences.length >= maxOccurrences) break;
  }
  return occurrences.sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const byTime = timeToMinutes(left.time) - timeToMinutes(right.time);
    if (byTime !== 0) return byTime;
    return String(left.slotId).localeCompare(String(right.slotId));
  });
}

export function findWeeklyScheduleDraftConflicts(slotsInput: any[]): ScheduleConflictResult {
  const slots = normalizeWeeklyScheduleSlots(slotsInput);
  const conflicts: ScheduleConflict[] = [];
  const addConflict = (conflict: ScheduleConflict) => {
    if (!conflicts.some((item) => item.humanMessage === conflict.humanMessage)) conflicts.push(conflict);
  };
  for (let index = 0; index < slots.length; index += 1) {
    const current = slots[index];
    const currentEnd = addMinutesToTime(current.time, current.durationMinutes);
    for (let otherIndex = index + 1; otherIndex < slots.length; otherIndex += 1) {
      const other = slots[otherIndex];
      if (current.weekday !== other.weekday) continue;
      const otherEnd = addMinutesToTime(other.time, other.durationMinutes);
      if (!appointmentTimesOverlap(current.time, currentEnd, other.time, otherEnd)) continue;
      const sameSpecialty = normalizeWeeklyScheduleSpecialty(current.specialty) === normalizeWeeklyScheduleSpecialty(other.specialty);
      const sameProfessional = Boolean(
        current.professionalId && other.professionalId && current.professionalId === other.professionalId
      ) || Boolean(
        current.professionalName && other.professionalName && current.professionalName === other.professionalName
      );
      const dayLabel = WEEKLY_SCHEDULE_DAYS.find((day) => day.value === current.weekday)?.label || 'Mesmo dia';
      const reasons = [
        'mesmo paciente',
        ...(sameProfessional ? ['mesmo profissional'] : []),
        ...(sameSpecialty ? [`mesma especialidade (${current.specialty})`] : []),
      ];
      addConflict({
        conflictType: sameSpecialty ? 'specialty' : 'patient',
        humanMessage: `${dayLabel}: ${current.time}-${currentEnd} conflita com ${other.time}-${otherEnd} (${reasons.join(', ')}).`,
        blocking: true,
        startTime: current.time,
        endTime: currentEnd,
      });
    }
  }
  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    blocking: conflicts.some((conflict) => conflict.blocking),
    humanMessage: conflicts[0]?.humanMessage || 'Agenda semanal sem conflitos internos.',
  };
}

export function appointmentTimesOverlap(startA: any, endA: any, startB: any, endB: any): boolean {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
}

const readBooleanLike = (value: any): boolean | null => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'sim', 's'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'n'].includes(normalized)) return false;
  return null;
};

export function roomPreventsOverlappingAppointments(room: any, fallback = true): boolean {
  const explicitPrevent = readBooleanLike(
    room?.prevent_overlapping_appointments ??
      room?.preventOverlappingAppointments ??
      room?.prevent_overlap ??
      room?.preventOverlap ??
      room?.blocks_overlap ??
      room?.blocksOverlap
  );
  if (explicitPrevent !== null) return explicitPrevent;

  const explicitAllow = readBooleanLike(
    room?.allow_overlapping_appointments ??
      room?.allowOverlappingAppointments ??
      room?.allow_overlap ??
      room?.allowOverlap
  );
  if (explicitAllow !== null) return !explicitAllow;

  const roomLabel = String(room?.name || room?.label || room?.roomName || room?.room_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/(online|tele|remoto|virtual)/.test(roomLabel)) return false;
  return fallback;
}

export function findScheduleRoomConfig(rooms: any[] = [], roomId: any, roomName?: any) {
  const id = String(roomId || '').trim();
  const name = String(roomName || '').trim().toLowerCase();
  return (Array.isArray(rooms) ? rooms : []).find((room) => {
    const currentId = String(room?.id || room?.room_id || room?.roomId || '').trim();
    const currentName = String(room?.name || room?.roomName || room?.room_name || '').trim().toLowerCase();
    return (id && currentId === id) || (name && currentName === name);
  }) || null;
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
  const timezone = getAppointmentTimezone(appointment);
  const endDate = getAppointmentEndDateTime(appointment);
  if (endDate) return formatTimeInAppointmentTimezone(endDate, timezone);

  const explicit = normalizeAppointmentTime(appointment?.endTime || appointment?.end_time);
  if (explicit) return explicit;
  return addMinutesToTime(appointment?.time || '08:00', getAppointmentDurationMinutes(appointment, fallback));
}

export function buildLocalDateTimeIso(date: any, time: any): string | null {
  const parsed = buildAppointmentDateTime(date, time);
  return parsed ? parsed.toISOString() : null;
}

function getAppointmentTimezone(appointment: any): string {
  return String(
    appointment?.timezone ||
      appointment?.time_zone ||
      appointment?.clinic_timezone ||
      appointment?.clinicTimezone ||
      DEFAULT_APPOINTMENT_TIMEZONE
  ).trim() || DEFAULT_APPOINTMENT_TIMEZONE;
}

export function getAppointmentStartDateTime(appointment: any): Date | null {
  const timezone = getAppointmentTimezone(appointment);
  const explicit =
    appointment?.start_time ||
    appointment?.startTime ||
    appointment?.scheduled_at ||
    appointment?.scheduledAt ||
    appointment?.scheduled_start ||
    appointment?.scheduledStart;
  if (explicit) {
    const explicitTime = normalizeAppointmentTime(explicit);
    if (explicitTime) return buildAppointmentDateTime(appointment?.date, explicitTime, timezone);
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return buildAppointmentDateTime(appointment?.date, appointment?.time, timezone);
}

export function getAppointmentEndDateTime(appointment: any): Date | null {
  const timezone = getAppointmentTimezone(appointment);
  const start = getAppointmentStartDateTime(appointment);
  if (start) return calculateAppointmentEnd(start, getAppointmentDurationMinutes(appointment));

  const explicit =
    appointment?.end_time ||
    appointment?.endTime ||
    appointment?.scheduled_end ||
    appointment?.scheduledEnd ||
    appointment?.scheduled_end_at ||
    appointment?.scheduledEndAt;
  if (explicit) {
    const explicitTime = normalizeAppointmentTime(explicit);
    if (explicitTime) return buildAppointmentDateTime(appointment?.date, explicitTime, timezone);
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function appointmentBlocksConflict(appointment: any): boolean {
  const normalized = normalizeAppointmentStatus(appointment?.status || 'scheduled');
  if (NON_BLOCKING_APPOINTMENT_STATUSES.includes(normalized)) return false;
  if (['cancel_requested', 'cancelamento_solicitado', 'reschedule_requested', 'remarcacao_solicitada'].includes(normalized)) return true;
  if (/cancel|deleted|archived|inactive|no_show|missed|falt/.test(normalized)) return false;
  if (/^(rescheduled|remarcad)/.test(normalized)) {
    return /active|ativ/.test(normalized);
  }
  return BLOCKING_APPOINTMENT_STATUSES.includes(normalized);
}

export function getAppointmentRoomId(appointment: any): string {
  return String(appointment?.room_id || appointment?.roomId || appointment?.room || '').trim();
}

export function getAppointmentLocationType(appointment: any): ScheduleLocationType {
  return getAppointmentRoomId(appointment)
    ? 'clinica'
    : normalizeScheduleLocationType(
        appointment?.location_type ||
          appointment?.locationType ||
          appointment?.location ||
          appointment?.local
      );
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

export function resolveRecurringAppointmentBillingFields(input: {
  occurrenceIndex: number;
  totalOccurrences: number;
  guideNumber?: string | null;
  authorizationCode?: string | null;
  applyAuthorizationToRecurrence?: boolean;
  reuseGuideAcrossRecurrence?: boolean;
}) {
  const occurrenceIndex = Math.max(0, Number(input.occurrenceIndex) || 0);
  const totalOccurrences = Math.max(1, Number(input.totalOccurrences) || 1);
  const guideNumber = String(input.guideNumber || '').trim();
  const authorizationCode = String(input.authorizationCode || '').trim();
  const isFirstOccurrence = occurrenceIndex === 0;
  return {
    authorizationCode:
      totalOccurrences === 1 ||
      input.applyAuthorizationToRecurrence !== false ||
      isFirstOccurrence
        ? authorizationCode
        : '',
    guideNumber:
      totalOccurrences === 1 ||
      input.reuseGuideAcrossRecurrence === true ||
      isFirstOccurrence
        ? guideNumber
        : '',
  };
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
  room_prevent_overlapping_appointments?: any;
  roomPreventOverlappingAppointments?: any;
  rooms?: any[];
  location_type?: any;
  date?: any;
  start_time?: any;
  end_time?: any;
  duration_minutes?: any;
  session_buffer_minutes?: any;
  sessionBufferMinutes?: any;
  exclude_event_id?: any;
  exclude_event_ids?: any[];
  recurrence_dates?: any[];
  service_type?: any;
  serviceType?: any;
  specialty?: any;
}): ScheduleConflictResult {
  const appointments = Array.isArray(input.appointments) ? input.appointments : [];
  const recurrenceDates = Array.isArray(input.recurrence_dates) && input.recurrence_dates.length > 0
    ? input.recurrence_dates
    : [input.date];
  const locationType = normalizeScheduleLocationType(input.location_type);
  const startTime = normalizeAppointmentTime(input.start_time);
  const durationMinutes = normalizeDurationMinutes(input.duration_minutes);
  const endTime = addMinutesToTime(startTime, durationMinutes);
  const sessionBufferMinutes = Math.min(
    120,
    Math.max(0, Math.round(Number(input.session_buffer_minutes ?? input.sessionBufferMinutes ?? 0) || 0))
  );
  const bufferedEndTime = addMinutesToTime(startTime, durationMinutes + sessionBufferMinutes);
  const patientId = String(input.patient_id || '').trim();
  const patientName = String(input.patient_name || '').trim();
  const serviceType = String(input.service_type || input.serviceType || input.specialty || '').trim();
  const normalizedServiceType = normalizeWeeklyScheduleSpecialty(serviceType);
  const roomId = String(input.room_id || '').trim();
  const roomName = String(input.room_name || roomId || 'Sala').trim();
  const roomConfig = findScheduleRoomConfig(input.rooms || [], roomId, roomName);
  const selectedRoomPolicySource = {
    ...(roomConfig || {}),
    name: roomConfig?.name || roomName,
    prevent_overlapping_appointments:
      roomConfig?.prevent_overlapping_appointments ??
      roomConfig?.preventOverlappingAppointments ??
      input.room_prevent_overlapping_appointments ??
      input.roomPreventOverlappingAppointments
  };
  const professionalIds = new Set((input.professional_ids || []).map((value) => String(value || '').trim()).filter(Boolean));
  const professionalNames = new Set((input.professional_names || []).map((value) => String(value || '').trim()).filter(Boolean));
  const excludeIds = new Set(
    [
      input.exclude_event_id,
      ...(Array.isArray(input.exclude_event_ids) ? input.exclude_event_ids : [])
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const conflicts: ScheduleConflict[] = [];

  const addConflict = (conflict: ScheduleConflict) => {
    if (!conflicts.some((item) => item.humanMessage === conflict.humanMessage)) conflicts.push(conflict);
  };

  for (const date of recurrenceDates) {
    const dateKey = normalizeAppointmentDate(date);
    if (!dateKey || !startTime || !endTime) continue;

    for (const appointment of appointments) {
      if (excludeIds.has(String(appointment?.id || ''))) continue;
      if (!appointmentBlocksConflict(appointment)) continue;
      const timezone = getAppointmentTimezone(appointment);
      const existingDate = normalizeAppointmentDate(appointment?.date) ||
        formatDateInAppointmentTimezone(getAppointmentStartDateTime(appointment), timezone);
      if (existingDate !== dateKey) continue;

      const existingStart = normalizeAppointmentTime(appointment?.time) ||
        formatTimeInAppointmentTimezone(getAppointmentStartDateTime(appointment), timezone);
      const existingEnd = getAppointmentEndTime(appointment);
      if (!existingStart || !existingEnd) continue;
      const existingBufferedEnd = sessionBufferMinutes > 0 ? addMinutesToTime(existingEnd, sessionBufferMinutes) : existingEnd;
      if (!appointmentTimesOverlap(startTime, bufferedEndTime, existingStart, existingBufferedEnd || existingEnd)) continue;

      const existingPatientId = getAppointmentPatientId(appointment);
      const existingPatientName = getAppointmentPatientName(appointment);
      const samePatient =
        (patientId && existingPatientId && patientId === existingPatientId) ||
        (!patientId && patientName && existingPatientName.toLowerCase() === patientName.toLowerCase());
      if (samePatient) {
        const existingServiceType = String(
          appointment?.service_type || appointment?.serviceType || appointment?.approach || appointment?.type || ''
        ).trim();
        const sameSpecialty = Boolean(
          normalizedServiceType &&
          normalizeWeeklyScheduleSpecialty(existingServiceType) === normalizedServiceType
        );
        addConflict({
          conflictType: sameSpecialty ? 'specialty' : 'patient',
          humanMessage: sameSpecialty
            ? `${patientName || existingPatientName || 'Paciente'} já possui ${serviceType || existingServiceType} das ${existingStart} às ${existingEnd}.`
            : `${patientName || existingPatientName || 'Paciente'} já possui outra sessão das ${existingStart} às ${existingEnd}.`,
          blocking: true,
          date: dateKey,
          startTime: existingStart,
          endTime: existingEnd,
          relatedEventId: String(appointment?.id || '')
        });
      }

      if (locationType === 'clinica' && roomId && getAppointmentRoomId(appointment) === roomId) {
        const existingRoomPolicySource = {
          ...selectedRoomPolicySource,
          prevent_overlapping_appointments:
            selectedRoomPolicySource.prevent_overlapping_appointments ??
            appointment?.prevent_overlapping_appointments ??
            appointment?.preventOverlappingAppointments ??
            appointment?.room_prevent_overlapping_appointments ??
            appointment?.roomPreventOverlappingAppointments
        };
        if (roomPreventsOverlappingAppointments(existingRoomPolicySource, true)) {
          addConflict({
            conflictType: 'room',
            humanMessage: `${roomName} já está ocupada das ${existingStart} às ${existingEnd}.`,
            blocking: true,
            date: dateKey,
            startTime: existingStart,
            endTime: existingEnd,
            relatedEventId: String(appointment?.id || '')
          });
        }
      }

      const existingProfessionalIds = getAppointmentProfessionalIds(appointment);
      const existingProfessionalNames = getAppointmentProfessionalNames(appointment);
      const professionalIdConflict = existingProfessionalIds.some((id) => professionalIds.has(id));
      const professionalNameConflict = existingProfessionalNames.some((name) => professionalNames.has(name));
      if (professionalIdConflict || professionalNameConflict) {
        const professionalName =
          existingProfessionalNames.find((name) => professionalNames.has(name)) ||
          existingProfessionalNames[0] ||
          Array.from(professionalNames)[0] ||
          'Profissional';
        addConflict({
          conflictType: existingProfessionalIds.length > 1 ? 'team' : 'professional',
          humanMessage: `${professionalName} já possui sessão das ${existingStart} às ${existingEnd}.`,
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
    humanMessage: conflicts[0]?.humanMessage || 'Horário disponível.'
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
      const month = formatDateInAppointmentTimezone(start).slice(0, 7);
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
    const workDate = formatDateInAppointmentTimezone(start);
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
