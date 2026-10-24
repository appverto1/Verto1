export type PortalRescheduleConflictAppointment = {
  id?: string | null;
  patientId?: string | null;
  patient_id?: string | null;
  professionalId?: string | null;
  professional_id?: string | null;
  therapistId?: string | null;
  therapist_id?: string | null;
  roomId?: string | null;
  room_id?: string | null;
  locationType?: string | null;
  location_type?: string | null;
  scheduledStart?: string | null;
  scheduled_start?: string | null;
  scheduled_start_at?: string | null;
  scheduledAt?: string | null;
  scheduled_at?: string | null;
  startTime?: string | null;
  start_time?: string | null;
  scheduledEnd?: string | null;
  scheduled_end?: string | null;
  scheduled_end_at?: string | null;
  endTime?: string | null;
  end_time?: string | null;
  durationMinutes?: number | string | null;
  duration_minutes?: number | string | null;
  scheduled_duration_minutes?: number | string | null;
  status?: string | null;
};

export type PortalRescheduleSlot = {
  id: string;
  date: string;
  dateLabel: string;
  start: string;
  end: string;
  label: string;
  scheduledStart: string;
  scheduledEnd: string;
};

export type PortalRescheduleSlotGroup = {
  date: string;
  label: string;
  slots: PortalRescheduleSlot[];
};

export type PortalRescheduleOption = {
  scheduledStart: string;
  scheduledEnd: string;
  date?: string;
  dateLabel?: string;
  start?: string;
  end?: string;
  label?: string;
};

export type PortalRescheduleAvailabilityResult = {
  days: PortalRescheduleSlotGroup[];
  totalSlots: number;
  windowDays: number;
  maxSelectable: number;
  weekStart?: string;
  weekEnd?: string;
  rangeLabel?: string;
  nextDateFrom?: string;
};

export type PortalWorkPeriod = {
  start?: string | null;
  end?: string | null;
  locationTypes?: string[];
  location_types?: string[];
  roomIds?: string[];
  room_ids?: string[];
};

export type PortalWorkDay = {
  enabled?: boolean;
  active?: boolean;
  periods?: PortalWorkPeriod[];
  ranges?: PortalWorkPeriod[];
  shifts?: PortalWorkPeriod[];
  intervals?: PortalWorkPeriod[];
  breaks?: PortalWorkPeriod[];
  lunchStart?: string | null;
  lunchEnd?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
};

export type PortalScheduleException = {
  date?: string | null;
  start?: string | null;
  end?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  type?: string | null;
  blocksAvailability?: boolean;
  blocks_availability?: boolean;
  active?: boolean;
};

export type PortalProfessionalWorkingSchedule = {
  active?: boolean;
  days?: Record<string, PortalWorkDay | PortalWorkPeriod[] | boolean>;
  weekly?: Record<string, PortalWorkDay | PortalWorkPeriod[] | boolean>;
  weeklySchedule?: Record<string, PortalWorkDay | PortalWorkPeriod[] | boolean>;
  weekly_schedule?: Record<string, PortalWorkDay | PortalWorkPeriod[] | boolean>;
  exceptions?: PortalScheduleException[];
  blocks?: PortalScheduleException[];
  scheduleExceptions?: PortalScheduleException[];
  schedule_exceptions?: PortalScheduleException[];
  holidays?: string[];
  clinicHolidays?: string[];
  clinic_holidays?: string[];
  stepMinutes?: number | string | null;
  step_minutes?: number | string | null;
  minLeadMinutes?: number | string | null;
  min_lead_minutes?: number | string | null;
  maxSlotsPerDay?: number | string | null;
  max_slots_per_day?: number | string | null;
  sessionBufferMinutes?: number | string | null;
  session_buffer_minutes?: number | string | null;
  defaultSessionDurationMinutes?: number | string | null;
  default_session_duration_minutes?: number | string | null;
  allowedLocationTypes?: string[];
  allowed_location_types?: string[];
  allowedRoomIds?: string[];
  allowed_room_ids?: string[];
};

export const PORTAL_RESCHEDULE_MAX_OPTIONS = 3;

// Compatibility for the existing server.ts reschedule validator, which refers
// to PORTAL_RESCHEDULE_MAX_OPTIONS as an unqualified identifier. server.ts is
// currently too large to safely update via the GitHub contents interface;
// provide the same canonical constant to that legacy entrypoint at runtime.
// This avoids a ReferenceError on POST /api/portal/appointments/:id/request-reschedule.
// Remove this adapter when server.ts is modularized to use an explicit import.
declare global {
  var PORTAL_RESCHEDULE_MAX_OPTIONS: number;
}
globalThis.PORTAL_RESCHEDULE_MAX_OPTIONS = PORTAL_RESCHEDULE_MAX_OPTIONS;

export const PORTAL_RESCHEDULE_DEFAULT_WINDOW_DAYS = 14;
export const PORTAL_RESCHEDULE_NOTE_START = '[verto-reschedule-options]';
export const PORTAL_RESCHEDULE_NOTE_END = '[/verto-reschedule-options]';

const PORTAL_TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_WORKDAY_START = '08:00';
const DEFAULT_WORKDAY_END = '18:00';
const DEFAULT_STEP_MINUTES = 30;
const DEFAULT_MIN_LEAD_MINUTES = 120;

const DAY_KEYS_BY_INDEX = [
  ['0', 'sun', 'sunday', 'domingo', 'dom'],
  ['1', 'mon', 'monday', 'segunda', 'segunda-feira', 'seg'],
  ['2', 'tue', 'tuesday', 'terca', 'terça', 'terça-feira', 'ter'],
  ['3', 'wed', 'wednesday', 'quarta', 'quarta-feira', 'qua'],
  ['4', 'thu', 'thursday', 'quinta', 'quinta-feira', 'qui'],
  ['5', 'fri', 'friday', 'sexta', 'sexta-feira', 'sex'],
  ['6', 'sat', 'saturday', 'sabado', 'sábado', 'sábado-feira', 'sab']
];

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const dateKeyInPortalTimeZone = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PORTAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const addDaysToDateKey = (dateKey: string, days: number) => {
  const base = new Date(`${dateKey}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return dateKeyInPortalTimeZone(base);
};

const getDayIndexFromDateKey = (dateKey: string) => {
  const date = new Date(`${dateKey}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getUTCDay();
};

const minutesToTime = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

const timeToMinutes = (time: unknown, fallback: number) => {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return Math.min(23 * 60 + 59, Math.max(0, hour * 60 + minute));
};

const buildDateTime = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00-03:00`);

const formatDateLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-');
  if (!year || !month || !day) return dateKey;
  return `${day}/${month}/${year}`;
};

const formatTimeLabel = (value: Date) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: PORTAL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}).format(value);

const statusBlocksAvailability = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return true;
  // A request for cancellation does not free the patient's, professional's or room's slot.
  if (/(cancel|desmarc)/i.test(normalized) && /(request|solicit|pending)/i.test(normalized)) return true;
  return !/(cancel|desmarc|no_show|missed|deleted|archived|rejected|recus|invalid)/i.test(normalized);
};

const readString = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const readDuration = (appointment: PortalRescheduleConflictAppointment, fallback: number) => clampNumber(
  appointment.scheduled_duration_minutes ??
    appointment.duration_minutes ??
    appointment.durationMinutes,
  fallback,
  15,
  360
);

const readAppointmentStart = (appointment: PortalRescheduleConflictAppointment) => {
  const value = readString(
    appointment.scheduled_start_at,
    appointment.scheduledStart,
    appointment.scheduled_start,
    appointment.scheduled_at,
    appointment.scheduledAt,
    appointment.start_time,
    appointment.startTime
  );
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const readAppointmentEnd = (appointment: PortalRescheduleConflictAppointment, fallbackDuration: number) => {
  const value = readString(
    appointment.scheduled_end_at,
    appointment.scheduledEnd,
    appointment.scheduled_end,
    appointment.end_time,
    appointment.endTime
  );
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  const start = readAppointmentStart(appointment);
  if (!start) return null;
  return new Date(start.getTime() + readDuration(appointment, fallbackDuration) * 60_000);
};

const intervalsOverlap = (startA: Date, endA: Date, startB: Date, endB: Date) =>
  startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();

const normalizeLocationType = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (/online|remoto|tele/.test(normalized)) return 'online';
  if (/domic/.test(normalized)) return 'domicilio';
  if (/escola/.test(normalized)) return 'escola';
  if (/clinic|clinica|sala|presencial/.test(normalized)) return 'clinica';
  return normalized || '';
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const toArray = <T = any>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
};

const normalizeStringList = (value: unknown) => toArray(value)
  .map((item) => readString(item))
  .filter(Boolean);

const hasRestrictionMatch = (allowed: unknown, selected: string, normalizer: (value: unknown) => string = readString) => {
  const list = normalizeStringList(allowed).map(normalizer).filter(Boolean);
  if (list.length === 0) return true;
  return Boolean(selected && list.includes(normalizer(selected)));
};

const normalizePeriod = (period: unknown, fallbackStart = DEFAULT_WORKDAY_START, fallbackEnd = DEFAULT_WORKDAY_END) => {
  const source = asRecord(period);
  const start = minutesToTime(timeToMinutes(source.start ?? source.startTime ?? source.start_time ?? fallbackStart, timeToMinutes(fallbackStart, 8 * 60)));
  const end = minutesToTime(timeToMinutes(source.end ?? source.endTime ?? source.end_time ?? fallbackEnd, timeToMinutes(fallbackEnd, 18 * 60)));
  const startMinutes = timeToMinutes(start, 0);
  const endMinutes = timeToMinutes(end, 0);
  if (endMinutes <= startMinutes) return null;
  return {
    start,
    end,
    startMinutes,
    endMinutes,
    locationTypes: normalizeStringList(source.locationTypes ?? source.location_types),
    roomIds: normalizeStringList(source.roomIds ?? source.room_ids)
  };
};

const resolveDaySource = (days: Record<string, any>, dateKey: string) => {
  const dayIndex = getDayIndexFromDateKey(dateKey);
  const possibleKeys = DAY_KEYS_BY_INDEX[dayIndex] || [String(dayIndex)];
  for (const key of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(days, key)) return days[key];
  }
  // A configured weekly schedule is an allowlist: an omitted weekday is closed.
  // Never silently open it using the default 08:00–18:00 fallback.
  return false;
};

const normalizeDayPeriods = (daySource: unknown, fallbackStart: string, fallbackEnd: string) => {
  if (daySource === false) return { periods: [], blockedPeriods: [] };
  if (Array.isArray(daySource)) {
    return {
      periods: daySource.map((period) => normalizePeriod(period, fallbackStart, fallbackEnd)).filter(Boolean) as ReturnType<typeof normalizePeriod>[],
      blockedPeriods: []
    };
  }
  const day = asRecord(daySource);
  if (day.enabled === false || day.active === false) return { periods: [], blockedPeriods: [] };
  const rawPeriods = toArray(day.periods ?? day.ranges ?? day.shifts);
  // Explicitly empty periods close the day; only missing fields retain the legacy fallback.
  const hasExplicitPeriods = Array.isArray(day.periods) || Array.isArray(day.ranges) || Array.isArray(day.shifts);
  const periods = (rawPeriods.length > 0 ? rawPeriods : hasExplicitPeriods ? [] : [{ start: fallbackStart, end: fallbackEnd }])
    .map((period) => normalizePeriod(period, fallbackStart, fallbackEnd))
    .filter(Boolean) as ReturnType<typeof normalizePeriod>[];
  const rawBlocks = [
    ...toArray(day.intervals),
    ...toArray(day.breaks)
  ];
  const lunchStart = readString(day.lunchStart, day.lunch_start);
  const lunchEnd = readString(day.lunchEnd, day.lunch_end);
  if (lunchStart && lunchEnd) rawBlocks.push({ start: lunchStart, end: lunchEnd });
  const blockedPeriods = rawBlocks
    .map((period) => normalizePeriod(period, fallbackStart, fallbackEnd))
    .filter(Boolean) as ReturnType<typeof normalizePeriod>[];
  return { periods, blockedPeriods };
};

const normalizeWorkingDays = (schedule: PortalProfessionalWorkingSchedule | null | undefined) => {
  const source = asRecord(schedule);
  const days = asRecord(source.days ?? source.weekly ?? source.weeklySchedule ?? source.weekly_schedule);
  return days;
};

// An explicitly configured empty week is closed. Only an absent weekly map
// may use the legacy 08:00–18:00 fallback.
const hasConfiguredWorkingDays = (schedule: PortalProfessionalWorkingSchedule | null | undefined) => {
  const source = asRecord(schedule);
  const days = source.days ?? source.weekly ?? source.weeklySchedule ?? source.weekly_schedule;
  return days !== null && typeof days === 'object' && !Array.isArray(days);
};

const normalizeScheduleExceptions = (
  schedule: PortalProfessionalWorkingSchedule | null | undefined,
  extraExceptions: PortalScheduleException[] | undefined,
) => {
  const source = asRecord(schedule);
  return [
    ...toArray<PortalScheduleException>(source.exceptions),
    ...toArray<PortalScheduleException>(source.blocks),
    ...toArray<PortalScheduleException>(source.scheduleExceptions),
    ...toArray<PortalScheduleException>(source.schedule_exceptions),
    ...toArray<PortalScheduleException>(extraExceptions)
  ].filter((exception) => exception && exception.active !== false);
};

const buildBlockedPeriodsForDate = (
  dateKey: string,
  schedule: PortalProfessionalWorkingSchedule | null | undefined,
  extraExceptions: PortalScheduleException[] | undefined,
  fallbackStart: string,
  fallbackEnd: string,
) => {
  const source = asRecord(schedule);
  const holidays = new Set([
    ...normalizeStringList(source.holidays),
    ...normalizeStringList(source.clinicHolidays),
    ...normalizeStringList(source.clinic_holidays)
  ]);
  if (holidays.has(dateKey)) {
    return [{ start: '00:00', end: '23:59', startMinutes: 0, endMinutes: 23 * 60 + 59, locationTypes: [], roomIds: [] }];
  }
  return normalizeScheduleExceptions(schedule, extraExceptions)
    .filter((exception) => readString(exception.date) === dateKey && exception.blocksAvailability !== false && exception.blocks_availability !== false)
    .map((exception) => normalizePeriod({
      start: exception.start ?? exception.startTime ?? exception.start_time ?? '00:00',
      end: exception.end ?? exception.endTime ?? exception.end_time ?? '23:59'
    }, fallbackStart, fallbackEnd))
    .filter(Boolean) as ReturnType<typeof normalizePeriod>[];
};

const slotOverlapsAnyBlockedPeriod = (startMinutes: number, endMinutes: number, blockedPeriods: ReturnType<typeof normalizePeriod>[]) =>
  blockedPeriods.some((period) => period && startMinutes < period.endMinutes && endMinutes > period.startMinutes);

export type RequestedRescheduleSlotConstraint = 'time' | 'professional' | 'room' | null;

export type RequestedRescheduleSlotEvaluation = {
  available: boolean;
  reasonCode:
    | 'AVAILABLE'
    | 'INVALID_TIME'
    | 'MIN_LEAD_TIME'
    | 'WORK_SCHEDULE_INACTIVE'
    | 'OUTSIDE_WORKING_HOURS'
    | 'LOCATION_NOT_ALLOWED'
    | 'ROOM_NOT_ALLOWED'
    | 'BLOCKED_PERIOD';
  constraint: RequestedRescheduleSlotConstraint;
  message: string;
};

// Requested options are validated by interval containment. The cadence used to
// generate suggestions must not reject a valid time selected by the family.
export function evaluateRequestedRescheduleSlot(params: {
  scheduledStart?: string | Date | null;
  durationMinutes?: number | string | null;
  roomId?: string | null;
  locationType?: string | null;
  now?: string | Date;
  minLeadMinutes?: number | string | null;
  workdayStart?: string | null;
  workdayEnd?: string | null;
  workingSchedule?: PortalProfessionalWorkingSchedule | null;
  scheduleExceptions?: PortalScheduleException[];
}): RequestedRescheduleSlotEvaluation {
  const start = params.scheduledStart instanceof Date
    ? params.scheduledStart
    : new Date(params.scheduledStart || '');
  if (Number.isNaN(start.getTime())) {
    return { available: false, reasonCode: 'INVALID_TIME', constraint: 'time', message: 'Este horário não pôde ser validado.' };
  }

  const schedule = params.workingSchedule && typeof params.workingSchedule === 'object'
    ? params.workingSchedule
    : null;
  if (schedule?.active === false) {
    return { available: false, reasonCode: 'WORK_SCHEDULE_INACTIVE', constraint: 'professional', message: 'A jornada deste profissional está inativa.' };
  }

  const durationMinutes = clampNumber(params.durationMinutes, 50, 15, 360);
  const sessionBufferMinutes = clampNumber(schedule?.sessionBufferMinutes ?? schedule?.session_buffer_minutes, 0, 0, 120);
  const minLeadMinutes = clampNumber(params.minLeadMinutes ?? schedule?.minLeadMinutes ?? schedule?.min_lead_minutes, DEFAULT_MIN_LEAD_MINUTES, 0, 30 * 24 * 60);
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const minimumStart = now.getTime() + minLeadMinutes * 60_000;
  if (start.getTime() <= minimumStart) {
    return {
      available: false,
      reasonCode: 'MIN_LEAD_TIME',
      constraint: 'time',
      message: start.getTime() <= now.getTime()
        ? 'Este horário já passou e não pode mais ser aprovado.'
        : 'Este horário não respeita a antecedência mínima configurada pela clínica.'
    };
  }

  const dateKey = dateKeyInPortalTimeZone(start);
  const startMinutes = timeToMinutes(formatTimeLabel(start), -1);
  const endMinutes = startMinutes + durationMinutes;
  if (startMinutes < 0 || endMinutes > 24 * 60) {
    return { available: false, reasonCode: 'INVALID_TIME', constraint: 'time', message: 'Este horário não pôde ser validado.' };
  }

  const fallbackWorkdayStart = readString(params.workdayStart) || DEFAULT_WORKDAY_START;
  const fallbackWorkdayEnd = readString(params.workdayEnd) || DEFAULT_WORKDAY_END;
  const workingDays = normalizeWorkingDays(schedule);
  const scheduleConfigured = Boolean(schedule && hasConfiguredWorkingDays(schedule));
  const daySource = scheduleConfigured
    ? resolveDaySource(workingDays, dateKey)
    : [{ start: fallbackWorkdayStart, end: fallbackWorkdayEnd }];
  const { periods, blockedPeriods } = normalizeDayPeriods(daySource, fallbackWorkdayStart, fallbackWorkdayEnd);
  const matchingTimePeriods = periods.filter((period) =>
    period && startMinutes >= period.startMinutes && endMinutes + sessionBufferMinutes <= period.endMinutes
  );
  if (matchingTimePeriods.length === 0) {
    return { available: false, reasonCode: 'OUTSIDE_WORKING_HOURS', constraint: 'professional', message: 'Este horário está fora da jornada configurada do profissional.' };
  }

  const locationType = normalizeLocationType(params.locationType);
  const roomId = readString(params.roomId);
  const scheduleAllowedLocationTypes = normalizeStringList(schedule?.allowedLocationTypes ?? schedule?.allowed_location_types);
  if (!hasRestrictionMatch(scheduleAllowedLocationTypes, locationType, normalizeLocationType)) {
    return { available: false, reasonCode: 'LOCATION_NOT_ALLOWED', constraint: 'professional', message: 'O local deste atendimento não está habilitado na jornada do profissional.' };
  }
  const locationPeriods = matchingTimePeriods.filter((period) => hasRestrictionMatch(period?.locationTypes, locationType, normalizeLocationType));
  if (locationPeriods.length === 0) {
    return { available: false, reasonCode: 'LOCATION_NOT_ALLOWED', constraint: 'professional', message: 'O local deste atendimento não está habilitado nesse período da jornada.' };
  }

  if (locationType === 'clinica') {
    const scheduleAllowedRoomIds = normalizeStringList(schedule?.allowedRoomIds ?? schedule?.allowed_room_ids);
    if (!hasRestrictionMatch(scheduleAllowedRoomIds, roomId)) {
      return { available: false, reasonCode: 'ROOM_NOT_ALLOWED', constraint: 'room', message: 'A sala selecionada não está habilitada para este profissional.' };
    }
    if (!locationPeriods.some((period) => hasRestrictionMatch(period?.roomIds, roomId))) {
      return { available: false, reasonCode: 'ROOM_NOT_ALLOWED', constraint: 'room', message: 'A sala selecionada não está habilitada nesse período da jornada.' };
    }
  }

  const dateBlockedPeriods = [
    ...blockedPeriods,
    ...buildBlockedPeriodsForDate(dateKey, schedule, params.scheduleExceptions, fallbackWorkdayStart, fallbackWorkdayEnd)
  ];
  if (slotOverlapsAnyBlockedPeriod(startMinutes, endMinutes, dateBlockedPeriods)) {
    return { available: false, reasonCode: 'BLOCKED_PERIOD', constraint: 'professional', message: 'Este horário coincide com almoço, bloqueio, folga ou feriado do profissional.' };
  }

  return { available: true, reasonCode: 'AVAILABLE', constraint: null, message: '' };
}

export function buildAvailableRescheduleSlots(params: {
  appointmentId?: string | null;
  patientId?: string | null;
  professionalId?: string | null;
  roomId?: string | null;
  locationType?: string | null;
  currentScheduledStart?: string | null;
  durationMinutes?: number | string | null;
  existingAppointments?: PortalRescheduleConflictAppointment[];
  now?: string | Date;
  dateFrom?: string | null;
  maxDays?: number | string | null;
  stepMinutes?: number | string | null;
  workdayStart?: string | null;
  workdayEnd?: string | null;
  minLeadMinutes?: number | string | null;
  maxSlotsPerDay?: number | string | null;
  maxSelectable?: number | string | null;
  workingSchedule?: PortalProfessionalWorkingSchedule | null;
  scheduleExceptions?: PortalScheduleException[];
  weekStart?: string | null;
  weekEnd?: string | null;
  nextDateFrom?: string | null;
}): PortalRescheduleAvailabilityResult {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const durationMinutes = clampNumber(params.durationMinutes, 50, 15, 360);
  const windowDays = clampNumber(params.maxDays, PORTAL_RESCHEDULE_DEFAULT_WINDOW_DAYS, 1, 30);
  const schedule = params.workingSchedule && typeof params.workingSchedule === 'object' ? params.workingSchedule : null;
  const scheduleConfigured = Boolean(schedule && hasConfiguredWorkingDays(schedule) && schedule.active !== false);
  const stepMinutes = clampNumber(
    params.stepMinutes ?? schedule?.stepMinutes ?? schedule?.step_minutes,
    scheduleConfigured ? durationMinutes : DEFAULT_STEP_MINUTES,
    10,
    120
  );
  const sessionBufferMinutes = clampNumber(schedule?.sessionBufferMinutes ?? schedule?.session_buffer_minutes, 0, 0, 120);
  const slotCadenceMinutes = sessionBufferMinutes > 0
    ? Math.max(stepMinutes, durationMinutes + sessionBufferMinutes)
    : stepMinutes;
  const minLeadMinutes = clampNumber(params.minLeadMinutes ?? schedule?.minLeadMinutes ?? schedule?.min_lead_minutes, DEFAULT_MIN_LEAD_MINUTES, 0, 30 * 24 * 60);
  const maxSlotsPerDay = clampNumber(params.maxSlotsPerDay ?? schedule?.maxSlotsPerDay ?? schedule?.max_slots_per_day, 8, 1, 24);
  const maxSelectable = clampNumber(params.maxSelectable, PORTAL_RESCHEDULE_MAX_OPTIONS, 1, PORTAL_RESCHEDULE_MAX_OPTIONS);
  const fallbackWorkdayStart = readString(params.workdayStart) || DEFAULT_WORKDAY_START;
  const fallbackWorkdayEnd = readString(params.workdayEnd) || DEFAULT_WORKDAY_END;
  const firstDateKey = params.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom)
    ? params.dateFrom
    : dateKeyInPortalTimeZone(now);
  const minStartTime = now.getTime() + minLeadMinutes * 60_000;
  const currentStartTime = new Date(params.currentScheduledStart || '').getTime();
  const patientId = readString(params.patientId);
  const professionalId = readString(params.professionalId);
  const roomId = readString(params.roomId);
  const locationType = normalizeLocationType(params.locationType);
  const existingAppointments = Array.isArray(params.existingAppointments) ? params.existingAppointments : [];
  const days: PortalRescheduleSlotGroup[] = [];
  const workingDays = normalizeWorkingDays(schedule);
  const scheduleAllowedLocationTypes = normalizeStringList(schedule?.allowedLocationTypes ?? schedule?.allowed_location_types);
  const scheduleAllowedRoomIds = normalizeStringList(schedule?.allowedRoomIds ?? schedule?.allowed_room_ids);

  for (let dayIndex = 0; dayIndex < windowDays; dayIndex += 1) {
    const dateKey = addDaysToDateKey(firstDateKey, dayIndex);
    const group: PortalRescheduleSlotGroup = { date: dateKey, label: formatDateLabel(dateKey), slots: [] };
    // An explicitly inactive professional schedule is closed, never the legacy 08:00–18:00 fallback.
    const daySource = schedule?.active === false
      ? false
      : scheduleConfigured ? resolveDaySource(workingDays, dateKey) : [{ start: fallbackWorkdayStart, end: fallbackWorkdayEnd }];
    const { periods, blockedPeriods } = normalizeDayPeriods(daySource, fallbackWorkdayStart, fallbackWorkdayEnd);
    const dateBlockedPeriods = [
      ...blockedPeriods,
      ...buildBlockedPeriodsForDate(dateKey, schedule, params.scheduleExceptions, fallbackWorkdayStart, fallbackWorkdayEnd)
    ];

    for (const period of periods) {
      if (!period) continue;
      if (!hasRestrictionMatch(scheduleAllowedLocationTypes, locationType, normalizeLocationType)) continue;
      if (!hasRestrictionMatch(period.locationTypes, locationType, normalizeLocationType)) continue;
      if (locationType === 'clinica') {
        if (!hasRestrictionMatch(scheduleAllowedRoomIds, roomId)) continue;
        if (!hasRestrictionMatch(period.roomIds, roomId)) continue;
      }
      for (let startMinute = period.startMinutes; startMinute + durationMinutes + sessionBufferMinutes <= period.endMinutes; startMinute += slotCadenceMinutes) {
        const endMinute = startMinute + durationMinutes;
        if (slotOverlapsAnyBlockedPeriod(startMinute, endMinute, dateBlockedPeriods)) continue;
      const start = buildDateTime(dateKey, minutesToTime(startMinute));
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (start.getTime() <= minStartTime) continue;
      if (Number.isFinite(currentStartTime) && Math.abs(start.getTime() - currentStartTime) < 60_000) continue;

      const hasConflict = existingAppointments.some((appointment) => {
        const appointmentId = readString(appointment.id);
        if (appointmentId && appointmentId === readString(params.appointmentId)) return false;
        if (!statusBlocksAvailability(appointment.status)) return false;
        const appointmentStart = readAppointmentStart(appointment);
        const appointmentEnd = readAppointmentEnd(appointment, durationMinutes);
        if (!appointmentStart || !appointmentEnd) return false;
        const bufferedEnd = new Date(end.getTime() + sessionBufferMinutes * 60_000);
        const appointmentBufferedEnd = new Date(appointmentEnd.getTime() + sessionBufferMinutes * 60_000);
        if (!intervalsOverlap(start, bufferedEnd, appointmentStart, appointmentBufferedEnd)) return false;
        const sameProfessional = professionalId && professionalId === readString(appointment.therapist_id, appointment.therapistId, appointment.professional_id, appointment.professionalId);
        const samePatient = patientId && patientId === readString(appointment.patient_id, appointment.patientId);
        const sameRoom = locationType === 'clinica' && roomId && roomId === readString(appointment.room_id, appointment.roomId);
        return Boolean(sameProfessional || samePatient || sameRoom);
      });
      if (hasConflict) continue;

      const slot: PortalRescheduleSlot = {
        id: `${dateKey}-${minutesToTime(startMinute)}`,
        date: dateKey,
        dateLabel: group.label,
        start: formatTimeLabel(start),
        end: formatTimeLabel(end),
        label: `${formatTimeLabel(start)} - ${formatTimeLabel(end)}`,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString()
      };
      group.slots.push(slot);
      if (group.slots.length >= maxSlotsPerDay) break;
    }
      if (group.slots.length >= maxSlotsPerDay) break;
    }
    if (group.slots.length > 0) days.push(group);
  }

  return {
    days,
    totalSlots: days.reduce((sum, group) => sum + group.slots.length, 0),
    windowDays,
    maxSelectable,
    weekStart: params.weekStart || firstDateKey,
    weekEnd: params.weekEnd || addDaysToDateKey(firstDateKey, windowDays - 1),
    rangeLabel: `${formatDateLabel(params.weekStart || firstDateKey)} a ${formatDateLabel(params.weekEnd || addDaysToDateKey(firstDateKey, windowDays - 1))}`,
    nextDateFrom: params.nextDateFrom || addDaysToDateKey(firstDateKey, windowDays)
  };
}

export function flattenRescheduleSlotGroups(days: PortalRescheduleSlotGroup[] = []) {
  return days.flatMap((group) => group.slots.map((slot) => ({ ...slot, date: slot.date || group.date, dateLabel: slot.dateLabel || group.label })));
}

export function normalizeRescheduleOptions(input: unknown, fallbackDurationMinutes = 50): PortalRescheduleOption[] {
  const rawItems = Array.isArray(input) ? input : input ? [input] : [];
  const seen = new Set<string>();
  const result: PortalRescheduleOption[] = [];
  for (const item of rawItems) {
    const source = item && typeof item === 'object' ? item as Record<string, any> : {};
    const scheduledStart = readString(source.scheduledStart, source.scheduled_start, source.startIso, source.start);
    const startDate = new Date(scheduledStart);
    if (Number.isNaN(startDate.getTime())) continue;
    const scheduledEndValue = readString(source.scheduledEnd, source.scheduled_end, source.endIso, source.end);
    const endDate = new Date(scheduledEndValue);
    const scheduledEnd = Number.isNaN(endDate.getTime())
      ? new Date(startDate.getTime() + clampNumber(fallbackDurationMinutes, 50, 15, 360) * 60_000).toISOString()
      : endDate.toISOString();
    const normalizedStart = startDate.toISOString();
    if (seen.has(normalizedStart)) continue;
    seen.add(normalizedStart);
    result.push({
      scheduledStart: normalizedStart,
      scheduledEnd,
      date: readString(source.date) || dateKeyInPortalTimeZone(startDate),
      dateLabel: readString(source.dateLabel, source.date_label) || formatDateLabel(dateKeyInPortalTimeZone(startDate)),
      start: readString(source.startLabel, source.start_time, source.start) || formatTimeLabel(startDate),
      end: readString(source.endLabel, source.end_time, source.end) || formatTimeLabel(new Date(scheduledEnd)),
      label: readString(source.label) || `${formatTimeLabel(startDate)} - ${formatTimeLabel(new Date(scheduledEnd))}`
    });
    if (result.length >= PORTAL_RESCHEDULE_MAX_OPTIONS) break;
  }
  return result;
}

export function formatRescheduleOptionLabel(option: PortalRescheduleOption) {
  const start = new Date(option.scheduledStart);
  const end = new Date(option.scheduledEnd);
  if (!Number.isNaN(start.getTime())) {
    const dateLabel = option.dateLabel || formatDateLabel(option.date || dateKeyInPortalTimeZone(start));
    const startLabel = option.start || formatTimeLabel(start);
    const endLabel = option.end || (Number.isNaN(end.getTime()) ? '' : formatTimeLabel(end));
    return endLabel ? `${dateLabel} às ${startLabel} - ${endLabel}` : `${dateLabel} às ${startLabel}`;
  }
  return option.label || 'Horário selecionado';
}

export function buildRescheduleRequestNote(note: unknown, options: PortalRescheduleOption[]) {
  const safeOptions = normalizeRescheduleOptions(options);
  const rawNote = String(note || '').trim();
  const structured = safeOptions.length > 0
    ? `${PORTAL_RESCHEDULE_NOTE_START}${JSON.stringify({ selectedSlots: safeOptions })}${PORTAL_RESCHEDULE_NOTE_END}`
    : '';
  const humanOptions = safeOptions.length > 0
    ? `Opções escolhidas:\n${safeOptions.map((option, index) => `${index + 1}. ${formatRescheduleOptionLabel(option)}`).join('\n')}`
    : '';
  const humanNote = rawNote ? `Observação:\n${rawNote}` : '';
  return [structured, humanOptions, humanNote].filter(Boolean).join('\n\n');
}

const decodeRescheduleHtmlEntities = (value: unknown) => String(value || '')
  .replace(/&quot;/gi, '"')
  .replace(/&#0*34;/gi, '"')
  .replace(/&#x0*22;/gi, '"')
  .replace(/&apos;/gi, "'")
  .replace(/&#0*39;/gi, "'")
  .replace(/&#x0*27;/gi, "'")
  .replace(/&amp;/gi, '&');

const extractRescheduleJsonObject = (value: string) => {
  const firstBrace = value.indexOf('{');
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return { json: value.slice(firstBrace, index + 1), endIndex: index + 1 };
    }
  }
  return null;
};

const parseRescheduleOptionsJson = (raw: string) => {
  const candidates = [raw.trim()];
  if (/^\{\{[\s\S]*\}\}$/.test(raw.trim())) {
    candidates.push(raw.trim().slice(1, -1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const options = normalizeRescheduleOptions(parsed?.selectedSlots || parsed?.rescheduleOptions || parsed?.options || []);
      if (options.length > 0) return options;
    } catch {
      // Try the next legacy shape without letting malformed historical content break the screen.
    }
  }
  return [] as PortalRescheduleOption[];
};

type ParsedReschedulePayload = {
  options: PortalRescheduleOption[];
  note: string;
  hasStructuredPayload: boolean;
  invalidPayload: boolean;
  source: 'metadata' | 'legacy_note' | 'none';
};

export function parseRescheduleRequestNote(note: unknown): ParsedReschedulePayload {
  const text = decodeRescheduleHtmlEntities(note);
  const markerIndex = text.indexOf(PORTAL_RESCHEDULE_NOTE_START);
  if (markerIndex < 0) {
    return {
      options: [],
      note: text.trim(),
      hasStructuredPayload: false,
      invalidPayload: false,
      source: 'none'
    };
  }

  const beforeMarker = text.slice(0, markerIndex);
  const afterMarker = text.slice(markerIndex + PORTAL_RESCHEDULE_NOTE_START.length);
  const closingMarkerIndex = afterMarker.indexOf(PORTAL_RESCHEDULE_NOTE_END);
  const extracted = closingMarkerIndex >= 0
    ? { json: afterMarker.slice(0, closingMarkerIndex), endIndex: closingMarkerIndex + PORTAL_RESCHEDULE_NOTE_END.length }
    : extractRescheduleJsonObject(afterMarker);
  const options = extracted ? parseRescheduleOptionsJson(extracted.json) : [];
  const remainder = extracted ? afterMarker.slice(extracted.endIndex) : '';
  const withoutMarker = `${beforeMarker}${remainder}`.replace(new RegExp(PORTAL_RESCHEDULE_NOTE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
  const withoutHumanOptions = withoutMarker
    .replace(/Op(?:ç|Ã§)(?:ões|Ãµes) escolhidas:\s*(?:\n\d+\.\s.*)+/i, '')
    .trim();
  const cleaned = withoutHumanOptions.replace(/^Observa(?:ç|Ã§)(?:ão|Ã£o):\s*/i, '').trim();
  return {
    options,
    note: cleaned,
    hasStructuredPayload: true,
    invalidPayload: options.length === 0,
    source: options.length > 0 ? 'legacy_note' : 'none'
  };
}

export function parseRescheduleRequestPayload(note: unknown, metadata?: unknown): ParsedReschedulePayload {
  const parsedNote = parseRescheduleRequestNote(note);
  const metadataRecord = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const metadataOptions = normalizeRescheduleOptions(
    metadataRecord.rescheduleOptions ||
      metadataRecord.reschedule_options ||
      metadataRecord.selectedSlots ||
      metadataRecord.selected_slots ||
      metadataRecord.options ||
      []
  );
  if (metadataOptions.length > 0) {
    return {
      ...parsedNote,
      options: metadataOptions,
      hasStructuredPayload: true,
      invalidPayload: false,
      source: 'metadata'
    };
  }
  return parsedNote;
}

export function buildRescheduleRequestMessage(note: unknown) {
  return parseRescheduleRequestNote(note).note;
}
