import cron from 'node-cron';
import crypto from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  findPushSubscriptionsForRecipients,
  sendAppointmentNotification,
  sendPatientPortalNotification,
} from './pushNotificationService';
import {
  buildPatientReminderNotificationPayload,
  resolveBrandingContext,
} from '../src/services/notificationBranding';
import { resolvePortalPatientDisplayName } from '../src/utils/patientDisplayName';
import { isVertoInstitutionalAsset } from '../src/constants/vertoBranding';
import {
  releaseDistributedJobLease,
  tryAcquireDistributedJobLease
} from './distributedRuntimeState';
import { matchesVertoDeploymentEnvironment, normalizeVertoDeploymentEnvironment, type VertoDeploymentEnvironment } from './deploymentEnvironment';
import { createClinicAnnouncementCronService } from './clinicAnnouncementCronService';
import { dispatchDueDeliveryQueues } from './deliveryQueueBatch';
import { createAppointmentReminderBrandingService } from './appointmentReminderBranding';
import { validateClaimedAppointmentReminder } from './appointmentReminderJobGuards';
export type { ClinicAnnouncementDispatchSummary } from './clinicAnnouncementCronService';

dayjs.extend(utc);
dayjs.extend(timezone);

type CronServiceOptions = {
  supabase: any;
  deploymentEnv?: VertoDeploymentEnvironment | null;
  vapidPublicKey?: string | null;
  vapidPrivateKey?: string | null;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  runtimeOwnerId?: string | null;
  requireDistributedLease?: boolean;
};

type ActiveCronServiceOptions = {
  supabase: any;
  deploymentEnv: VertoDeploymentEnvironment;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
  runtimeOwnerId: string;
  requireDistributedLease: boolean;
};

export type AppointmentReminderRunSummary = {
  skipped: boolean;
  totalCandidates: number;
  sent24h: number;
  sent12h: number;
  failed: number;
};

type ReminderKind = '24h' | '12h';

type ReminderAppointment = {
  appointmentId: string;
  clinicId?: string | null;
  clinicName?: string | null;
  clinicLogoUrl?: string | null;
  patientId: string;
  patientName?: string | null;
  patientEmail?: string | null;
  patientClinicId?: string | null;
  recipientUserId?: string | null;
  professionalDisplayName?: string | null;
  professionalLogoUrl?: string | null;
  scheduledAt: string;
  status?: string | null;
  patientResponse?: string | null;
  patientConfirmationStatus?: string | null;
  notification24SentAt?: string | null;
  notification12SentAt?: string | null;
  legacyNotification24Sent?: boolean | null;
  legacyNotification12Sent?: boolean | null;
  hasAppointmentsTableSource: boolean;
  hasClinicStateSource: boolean;
  canRequestReschedule?: boolean;
};

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_CLINIC_NOTIFICATION_NAME = 'Clínica';
const REMINDER_LOOKBACK_MINUTES = 12 * 60;
const REMINDER_LOOKAHEAD_MINUTES = 1;
const REMINDER_12H_MAX_LATE_MINUTES = 10 * 60;
const QUIET_HOURS_START = 22;
const QUIET_HOURS_END = 6;
const QUIET_RELEASE_CATCHUP_MINUTES = 10;
const REMINDER_DEDUPE_TTL_MS = 30 * 60 * 60 * 1000;
const CLINIC_BRANDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const REMINDER_STEPS = [
  {
    kind: '24h' as ReminderKind,
    hoursBefore: 24,
  },
  {
    kind: '12h' as ReminderKind,
    hoursBefore: 12,
  }
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let started = false;
let running = false;
let activeOptions: ActiveCronServiceOptions | null = null;
const recentlySentReminders = new Map<string, number>();

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const sanitizeEmail = (value: unknown) => {
  const email = sanitizeText(value, 320).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

const parseReminderSourcePayload = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const isUuid = (value: unknown) => UUID_REGEX.test(sanitizeText(value, 120));

export const extractReminderMissingColumnName = (error: unknown) => {
  const message = sanitizeText((error as any)?.message || error, 1000);
  if (!message) return '';
  const direct = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (direct?.[1]) return direct[1].toLowerCase();
  const qualified = message.match(/column\s+[a-zA-Z0-9_]+\."?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (qualified?.[1]) return qualified[1].toLowerCase();
  const schemaCache = message.match(/could\s+not\s+find\s+the\s+'?([a-zA-Z0-9_]+)'?\s+column/i);
  return schemaCache?.[1]?.toLowerCase() || '';
};

export const extractReminderClinicLogoStoragePath = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('patient-photos/')) return raw.slice('patient-photos/'.length);
  if (raw.startsWith('/api/storage/patient-photos/view?')) {
    try {
      return new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('path') || '';
    } catch {
      return '';
    }
  }
  const storageMatch = raw.match(/\/storage\/v1\/object\/(?:sign|public)\/patient-photos\/([^?]+)/i);
  if (!storageMatch?.[1]) return '';
  try {
    return decodeURIComponent(storageMatch[1]);
  } catch {
    return storageMatch[1];
  }
};

const isGenericClinicNotificationName = (value: unknown) => {
  const normalized = sanitizeText(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return !normalized || ['sua clinica', 'minha clinica', 'clinica', 'clinica verto', 'verto'].includes(normalized);
};

const sanitizeClinicNotificationLogoUrl = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const text = /^data:image\//i.test(raw) ? raw.slice(0, 1_000_000) : raw.slice(0, 2_000);
  if (!text) return '';
  if (isVertoInstitutionalAsset(text)) return '';
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  if (/^https?:\/\//i.test(text) || (text.startsWith('/') && !text.startsWith('//'))) return text;
  if (text.startsWith('patient-photos/') || /^[\w./-]+\.(png|jpe?g|webp)$/i.test(text)) {
    return `/api/storage/patient-photos/view?path=${encodeURIComponent(text)}`;
  }
  return '';
};

export const isActiveAppointmentStatus = (status: unknown) => {
  const normalized = sanitizeText(status || 'scheduled', 40).toLowerCase();
  return ![
    'cancelled',
    'canceled',
    'completed',
    'rescheduled',
    'reschedule',
    'deleted',
    'inactive'
  ].includes(normalized);
};

const hasResponse = (appointment: ReminderAppointment) => {
  const patientResponse = sanitizeText(appointment.patientResponse, 40).toLowerCase();
  const legacyResponse = sanitizeText(appointment.patientConfirmationStatus, 40).toLowerCase();
  return Boolean(patientResponse || legacyResponse);
};

const buildScheduledAtFromClinicStateAppointment = (appointment: any) => {
  const explicit = sanitizeText(
    appointment?.scheduled_at || appointment?.scheduledAt,
    80,
  );
  if (explicit && dayjs(explicit).isValid()) return dayjs(explicit).toISOString();

  const date = sanitizeText(appointment?.date, 20);
  const time = sanitizeText(appointment?.time, 10);
  if (!date || !time) return '';

  const candidate = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', BRAZIL_TIMEZONE);
  return candidate.isValid() ? candidate.utc().toISOString() : '';
};

export const isReminderQuietHours = (moment: dayjs.Dayjs) => {
  const hour = moment.tz(BRAZIL_TIMEZONE).hour();
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
};

export const getReminderDeliveryDueUtc = (scheduledAt: string, hoursBefore: number) => {
  const scheduled = dayjs(scheduledAt);
  if (!scheduled.isValid()) return dayjs('');
  const rawDueLocal = scheduled.tz(BRAZIL_TIMEZONE).subtract(hoursBefore, 'hour');
  const hour = rawDueLocal.hour();
  if (hour >= QUIET_HOURS_START) return rawDueLocal.add(1, 'day').hour(QUIET_HOURS_END).minute(0).second(0).millisecond(0).utc();
  if (hour < QUIET_HOURS_END) return rawDueLocal.hour(QUIET_HOURS_END).minute(0).second(0).millisecond(0).utc();
  return rawDueLocal.utc();
};

type ReminderCandidateWindow = { kind: ReminderKind; startUtc: dayjs.Dayjs; endUtc: dayjs.Dayjs };
export const buildReminderCandidateWindows = (nowUtc: dayjs.Dayjs): ReminderCandidateWindow[] => {
  const localNow = nowUtc.tz(BRAZIL_TIMEZONE);
  if (isReminderQuietHours(localNow)) return [];
  const dueStart = nowUtc.subtract(REMINDER_LOOKBACK_MINUTES, 'minute');
  const dueEnd = nowUtc.add(REMINDER_LOOKAHEAD_MINUTES, 'minute');
  const windows: ReminderCandidateWindow[] = REMINDER_STEPS.map((step) => ({
    kind: step.kind,
    startUtc: dueStart.add(step.hoursBefore, 'hour'),
    endUtc: dueEnd.add(step.hoursBefore, 'hour')
  }));
  if (localNow.hour() === QUIET_HOURS_END && localNow.minute() < QUIET_RELEASE_CATCHUP_MINUTES) {
    const releaseLocal = localNow.hour(QUIET_HOURS_END).minute(0).second(0).millisecond(0);
    const quietStartLocal = releaseLocal.subtract(8, 'hour');
    for (const step of REMINDER_STEPS) windows.push({ kind: step.kind, startUtc: quietStartLocal.utc().add(step.hoursBefore, 'hour'), endUtc: releaseLocal.utc().add(step.hoursBefore, 'hour') });
  }
  return windows;
};

export const reminderScheduleCycleKey = (scheduledAt: unknown) => {
  const parsed = dayjs(sanitizeText(scheduledAt, 120));
  return parsed.isValid()
    ? parsed.utc().format('YYYYMMDDTHHmmss[Z]')
    : 'unscheduled';
};

export const reminderDedupeKey = (appointment: ReminderAppointment, kind: ReminderKind) =>
  `${appointment.appointmentId}:${reminderScheduleCycleKey(appointment.scheduledAt)}:${kind}`;

export const buildPortalReminderIdempotencyKey = (
  appointment: ReminderAppointment,
  recipientKey: string,
) => `${appointment.appointmentId}:appointment:${reminderScheduleCycleKey(appointment.scheduledAt)}:${recipientKey}`;

const pruneRecentReminderMemory = (nowMs: number) => {
  for (const [key, sentAtMs] of recentlySentReminders.entries()) {
    if (nowMs - sentAtMs > REMINDER_DEDUPE_TTL_MS) {
      recentlySentReminders.delete(key);
    }
  }
};

const wasReminderRecentlySent = (appointment: ReminderAppointment, kind: ReminderKind, nowMs: number) => {
  pruneRecentReminderMemory(nowMs);
  const sentAtMs = recentlySentReminders.get(reminderDedupeKey(appointment, kind));
  return Boolean(sentAtMs && nowMs - sentAtMs <= REMINDER_DEDUPE_TTL_MS);
};

const mergeAppointment = (
  appointments: Map<string, ReminderAppointment>,
  incoming: ReminderAppointment,
) => {
  const existing = appointments.get(incoming.appointmentId);
  if (!existing) {
    appointments.set(incoming.appointmentId, incoming);
    return;
  }

  const sameScheduleCycle =
    reminderScheduleCycleKey(existing.scheduledAt) === reminderScheduleCycleKey(incoming.scheduledAt);

  appointments.set(incoming.appointmentId, {
    ...existing,
    clinicId: existing.clinicId || incoming.clinicId,
    clinicName: existing.clinicName || incoming.clinicName,
    clinicLogoUrl: existing.clinicLogoUrl || incoming.clinicLogoUrl,
    patientId: existing.patientId || incoming.patientId,
    patientName: existing.patientName || incoming.patientName,
    patientEmail: existing.patientEmail || incoming.patientEmail,
    patientClinicId: existing.patientClinicId || incoming.patientClinicId,
    recipientUserId: existing.recipientUserId || incoming.recipientUserId,
    professionalDisplayName: existing.professionalDisplayName || incoming.professionalDisplayName,
    professionalLogoUrl: existing.professionalLogoUrl || incoming.professionalLogoUrl,
    scheduledAt: existing.scheduledAt || incoming.scheduledAt,
    status: existing.status || incoming.status,
    patientResponse: existing.patientResponse || (sameScheduleCycle ? incoming.patientResponse : null),
    patientConfirmationStatus:
      existing.patientConfirmationStatus || (sameScheduleCycle ? incoming.patientConfirmationStatus : null),
    notification24SentAt:
      existing.notification24SentAt || (sameScheduleCycle ? incoming.notification24SentAt : null),
    notification12SentAt:
      existing.notification12SentAt || (sameScheduleCycle ? incoming.notification12SentAt : null),
    legacyNotification24Sent: Boolean(
      existing.legacyNotification24Sent || (sameScheduleCycle && incoming.legacyNotification24Sent),
    ),
    legacyNotification12Sent: Boolean(
      existing.legacyNotification12Sent || (sameScheduleCycle && incoming.legacyNotification12Sent),
    ),
    hasAppointmentsTableSource: existing.hasAppointmentsTableSource || incoming.hasAppointmentsTableSource,
    hasClinicStateSource: existing.hasClinicStateSource || incoming.hasClinicStateSource
  });
};

export const approvedRescheduleMatchesAppointment = (request: any, appointment: any) => {
  const appointmentId = sanitizeText(appointment?.id, 120);
  if (!isUuid(appointmentId) || sanitizeText(request?.appointment_id, 120) !== appointmentId) return false;
  if (sanitizeText(request?.status, 40).toUpperCase() !== 'APPROVED') return false;
  if (sanitizeText(request?.request_type, 40).toUpperCase() !== 'RESCHEDULE') return false;
  const requestOrganizationId = sanitizeText(request?.organization_id, 120);
  const appointmentClinicId = sanitizeText(appointment?.clinic_id, 120);
  if (requestOrganizationId && appointmentClinicId && requestOrganizationId !== appointmentClinicId) return false;
  const metadata = parseReminderSourcePayload(request?.metadata);
  const approvedStart = sanitizeText(
    metadata?.approvedStart || metadata?.approved_start || request?.requested_start,
    120,
  );
  const scheduledAt = sanitizeText(appointment?.scheduled_at, 120);
  const approvedDate = dayjs(approvedStart);
  const scheduledDate = dayjs(scheduledAt);
  return approvedDate.isValid() &&
    scheduledDate.isValid() &&
    approvedDate.valueOf() === scheduledDate.valueOf();
};

async function reconcileApprovedReschedulesForReminders(
  options: ActiveCronServiceOptions,
  rows: any[],
) {
  const candidatesById = new Map<string, any>();
  for (const row of rows) {
    const status = sanitizeText(row?.status, 40).toLowerCase();
    const appointmentId = sanitizeText(row?.id, 120);
    if (isUuid(appointmentId) && ['rescheduled', 'remarcada', 'remarcado'].includes(status)) {
      candidatesById.set(appointmentId, row);
    }
  }
  if (candidatesById.size === 0) return new Set<string>();

  const candidateIds = Array.from(candidatesById.keys());
  const { data, error } = await options.supabase
    .from('appointment_action_requests')
    .select('appointment_id, organization_id, requested_start, status, request_type, metadata, resolved_at')
    .in('appointment_id', candidateIds)
    .eq('request_type', 'RESCHEDULE')
    .eq('status', 'APPROVED')
    .order('resolved_at', { ascending: false })
    .limit(Math.min(1000, candidateIds.length * 3));

  if (error) {
    options.logger.warn('[Appointment Reminder Cron] Compatibilidade de remarcacoes aprovadas indisponivel.', {
      count: candidateIds.length,
      message: error.message,
    });
    return new Set<string>();
  }

  const approvedIds = new Set<string>();
  for (const request of data || []) {
    const appointmentId = sanitizeText(request?.appointment_id, 120);
    if (approvedIds.has(appointmentId)) continue;
    const appointment = candidatesById.get(appointmentId);
    if (appointment && approvedRescheduleMatchesAppointment(request, appointment)) {
      approvedIds.add(appointmentId);
    }
  }

  if (approvedIds.size > 0) {
    const repairedAt = dayjs().utc().toISOString();
    const { data: repairedRows, error: repairError } = await options.supabase
      .from('appointments')
      .update({ status: 'scheduled', updated_at: repairedAt })
      .in('id', Array.from(approvedIds))
      .in('status', ['RESCHEDULED', 'rescheduled', 'REMARCADA', 'remarcada', 'REMARCADO', 'remarcado'])
      .select('id');
    if (repairError) {
      options.logger.warn('[Appointment Reminder Cron] Status legado de remarcacao nao foi normalizado.', {
        count: approvedIds.size,
        message: repairError.message,
      });
      return new Set<string>();
    } else {
      const repairedIds = new Set<string>(
        (Array.isArray(repairedRows) ? repairedRows : [])
          .map((row: any) => sanitizeText(row?.id, 120))
          .filter((id: string) => isUuid(id)),
      );
      options.logger.log('[Appointment Reminder Cron] Remarcacoes aprovadas normalizadas para lembretes.', {
        count: repairedIds.size,
      });
      return repairedIds;
    }
  }

  return new Set<string>();
}

async function fetchAppointmentsTable(
  options: ActiveCronServiceOptions,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
  reminderKind?: ReminderKind,
) {
  const appointments = new Map<string, ReminderAppointment>();
  const rows: any[] = [];
  const pageSize = 500;
  for (let page = 0; page < 40; page += 1) {
    const from = page * pageSize;
    let query = options.supabase
      .from('appointments')
      .select('id, clinic_id, patient_id, scheduled_at, status, patient_response, notification_24h_sent_at, notification_12h_sent_at, is_active, deleted_at')
      .gte('scheduled_at', queryScheduledStartUtc.toISOString())
      .lt('scheduled_at', queryScheduledEndUtc.toISOString());
    if (reminderKind === '24h') query = query.is('notification_24h_sent_at', null);
    if (reminderKind === '12h') query = query.is('notification_12h_sent_at', null);
    const { data, error } = await query
      .order('scheduled_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      options.logger.warn('[Appointment Reminder Cron] Query appointments falhou.', {
        message: error.message,
        page,
      });
      return { appointments, available: false };
    }
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    if (page === 39) {
      options.logger.error('[Appointment Reminder Cron] Janela canonica excedeu o limite seguro de paginacao.', {
        windowStart: queryScheduledStartUtc.toISOString(),
        windowEnd: queryScheduledEndUtc.toISOString(),
        rowsRead: rows.length,
      });
    }
  }
  const approvedRescheduleIds = await reconcileApprovedReschedulesForReminders(options, rows);

  for (const row of rows) {
    const appointmentId = sanitizeText(row?.id, 120);
    const patientId = sanitizeText(row?.patient_id, 120);
    const scheduledAt = sanitizeText(row?.scheduled_at, 80);
    if (!appointmentId || !patientId || !scheduledAt) continue;
    const isApprovedReschedule = approvedRescheduleIds.has(appointmentId);
    if (!isActiveAppointmentStatus(row?.status) && !isApprovedReschedule) continue;
    if (row?.is_active === false || row?.deleted_at) continue;

    mergeAppointment(appointments, {
      appointmentId,
      clinicId: sanitizeText(row?.clinic_id, 120) || null,
      patientId,
      patientName: null,
      patientEmail: null,
      patientClinicId: null,
      recipientUserId: null,
      professionalDisplayName: null,
      professionalLogoUrl: null,
      scheduledAt,
      status: isApprovedReschedule ? 'scheduled' : sanitizeText(row?.status, 40).toLowerCase(),
      patientResponse: sanitizeText(row?.patient_response, 40).toLowerCase(),
      patientConfirmationStatus: null,
      notification24SentAt: sanitizeText(row?.notification_24h_sent_at, 80) || null,
      notification12SentAt: sanitizeText(row?.notification_12h_sent_at, 80) || null,
      legacyNotification24Sent: false,
      legacyNotification12Sent: false,
      hasAppointmentsTableSource: true,
      hasClinicStateSource: false
    });
  }

  return { appointments, available: true };
}

async function fetchClinicStateAppointments(
  options: ActiveCronServiceOptions,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const appointments = new Map<string, ReminderAppointment>();
  let states: any[] = [];
  const compactRows: any[] = [];
  const pageSize = 500;
  const maxPages = 200;
  const legacyBlobFallbackMaxPages = 4;
  let afterClinicId: string | null = null;
  let afterOrdinality: number | null = null;
  let compactError: any = null;
  let compactComplete = false;
  const seenCursors = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const compactResult = await options.supabase.rpc('get_legacy_due_appointments_v1', {
      p_window_start: queryScheduledStartUtc.toISOString(),
      p_window_end: queryScheduledEndUtc.toISOString(),
      p_limit: pageSize,
      p_after_clinic_id: afterClinicId,
      p_after_ordinality: afterOrdinality,
    });
    if (compactResult.error || !Array.isArray(compactResult.data)) {
      compactError = compactResult.error || new Error('LEGACY_APPOINTMENT_PAGE_INVALID');
      break;
    }
    const rows = compactResult.data;
    compactRows.push(...rows);
    if (rows.length < pageSize) {
      compactComplete = true;
      break;
    }
    const lastRow = rows[rows.length - 1];
    const nextClinicId = sanitizeText(lastRow?.clinic_id, 120);
    const nextOrdinality = Number(lastRow?.appointment_ordinality);
    const cursorKey = `${nextClinicId}:${nextOrdinality}`;
    if (!nextClinicId || !Number.isSafeInteger(nextOrdinality) || nextOrdinality < 1 || seenCursors.has(cursorKey)) {
      compactError = new Error('LEGACY_APPOINTMENT_CURSOR_INVALID');
      break;
    }
    seenCursors.add(cursorKey);
    afterClinicId = nextClinicId;
    afterOrdinality = nextOrdinality;
  }
  if (!compactComplete && !compactError) {
    compactError = new Error('LEGACY_APPOINTMENT_PAGE_LIMIT_REACHED');
  }

  if (compactComplete) {
    states = compactRows.map((row: any) => ({
      clinic_id: row?.clinic_id,
      appointments: row?.appointment ? [row.appointment] : [],
    }));
  } else {
    options.logger.warn('[Appointment Reminder Cron] RPC legado compacto indisponivel; usando leitura compativel.', {
      message: compactError?.message,
    });
    for (let page = 0; page < legacyBlobFallbackMaxPages; page += 1) {
      const from = page * pageSize;
      const legacyResult = await options.supabase
        .from('clinic_state')
        .select('clinic_id, appointments')
        .order('clinic_id')
        .range(from, from + pageSize - 1);
      if (legacyResult.error) {
        options.logger.warn('[Appointment Reminder Cron] Query clinic_state falhou.', {
          message: legacyResult.error.message
        });
        return appointments;
      }
      const rows = legacyResult.data || [];
      states.push(...rows);
      if (rows.length < pageSize) break;
      if (page === legacyBlobFallbackMaxPages - 1) {
        options.logger.error('[Appointment Reminder Cron] Fallback legado atingiu o limite seguro; aplique a migration de economia para reativar a leitura compacta.', {
          clinicRowsRead: states.length,
          limit: legacyBlobFallbackMaxPages * pageSize,
        });
      }
    }
  }

  for (const state of states) {
    const clinicId = sanitizeText(state?.clinic_id, 120);
    const rows = Array.isArray(state?.appointments) ? state.appointments : [];
    for (const appointment of rows) {
      const source = parseReminderSourcePayload(appointment?.source_payload || appointment?.sourcePayload);
      const appointmentId = sanitizeText(appointment?.id, 120);
      const patientId = sanitizeText(appointment?.patientId || appointment?.patient_id, 120);
      const scheduledAt = buildScheduledAtFromClinicStateAppointment(appointment);
      const scheduled = dayjs(scheduledAt);
      if (!appointmentId || !patientId || !scheduled.isValid()) continue;
      if (!isActiveAppointmentStatus(appointment?.status)) continue;
      if (scheduled.isBefore(queryScheduledStartUtc) || !scheduled.isBefore(queryScheduledEndUtc)) continue;

      mergeAppointment(appointments, {
        appointmentId,
        clinicId,
        patientId,
        patientName:
          sanitizeText(
            appointment?.patientName ||
              appointment?.patient_name ||
              appointment?.name ||
              source?.patientName ||
              source?.patient_name,
            180,
          ) || null,
        patientEmail: sanitizeEmail(appointment?.patientEmail || appointment?.patient_email),
        patientClinicId: null,
        recipientUserId: null,
        professionalDisplayName:
          sanitizeText(
            appointment?.professionalDisplayName ||
              appointment?.professionalName ||
              appointment?.professional_name ||
              appointment?.therapistName ||
              appointment?.therapist_name ||
              appointment?.professional ||
              source?.professionalName ||
              source?.professional_name ||
              source?.therapistName ||
              source?.therapist_name,
            180,
          ) || null,
        professionalLogoUrl:
          sanitizeText(
            appointment?.professionalLogoUrl ||
              appointment?.professional_logo_url ||
              appointment?.professionalAvatarUrl ||
              appointment?.professional_avatar_url ||
              appointment?.therapistAvatarUrl ||
              appointment?.therapist_avatar_url ||
              source?.professionalLogoUrl ||
              source?.professionalAvatarUrl ||
              source?.therapistAvatarUrl,
            2000,
          ) || null,
        scheduledAt,
        status: sanitizeText(appointment?.status || 'pending', 40).toLowerCase(),
        patientResponse: sanitizeText(appointment?.patientResponse || appointment?.patient_response, 40).toLowerCase(),
        patientConfirmationStatus: sanitizeText(
          appointment?.patientConfirmationStatus || appointment?.patient_confirmation_status,
          40,
        ).toLowerCase(),
        notification24SentAt:
          sanitizeText(
            appointment?.notification_24h_sent_at ||
              appointment?.notification24hSentAt ||
              appointment?.notification_sent_at,
            80,
          ) || null,
        notification12SentAt:
          sanitizeText(
            appointment?.notification_12h_sent_at ||
              appointment?.notification12hSentAt,
            80,
          ) || null,
        legacyNotification24Sent: Boolean(appointment?.notification_sent),
        legacyNotification12Sent: Boolean(appointment?.notification_12h_sent),
        hasAppointmentsTableSource: false,
        hasClinicStateSource: true
      });
    }
  }

  return appointments;
}

async function hydrateReminderAppointmentPatients(
  options: ActiveCronServiceOptions,
  appointments: ReminderAppointment[],
) {
  const patientIdsToHydrate = Array.from(new Set(
    appointments
      .map((appointment) => sanitizeText(appointment.patientId, 120))
      .filter((id) => isUuid(id))
  ));
  if (patientIdsToHydrate.length === 0) return appointments;

  const patientChunks: string[][] = [];
  for (let index = 0; index < patientIdsToHydrate.length; index += 100) {
    patientChunks.push(patientIdsToHydrate.slice(index, index + 100));
  }
  const patientRows: any[] = [];
  let patientLoadError: any = null;
  for (let index = 0; index < patientChunks.length; index += 4) {
    const chunkResults = await Promise.all(patientChunks.slice(index, index + 4).map(async (ids) => {
      let result = await options.supabase
        .from('patients')
        .select('id,name,email,clinic_id,responsible_user_id,is_active,deleted_at,metadata')
        .in('id', ids)
        .limit(ids.length);
      if (result.error && extractReminderMissingColumnName(result.error) === 'metadata') {
        result = await options.supabase
          .from('patients')
          .select('id,name,email,clinic_id,responsible_user_id,is_active,deleted_at')
          .in('id', ids)
          .limit(ids.length);
      }
      return result;
    }));
    for (const result of chunkResults) {
      if (result.error) {
        patientLoadError = result.error;
        break;
      }
      patientRows.push(...(result.data || []));
    }
    if (patientLoadError) break;
  }
  if (patientLoadError) {
    options.logger.warn('[Appointment Reminder Cron] Dados dos pacientes nao carregados.', {
      count: patientIdsToHydrate.length,
      message: patientLoadError.message
    });
    return appointments;
  }

  const patientsById = new Map<string, { name: string; email: string; clinicId: string; recipientUserId: string }>();
  for (const row of patientRows) {
    const id = sanitizeText(row?.id, 120);
    const name = resolvePortalPatientDisplayName(row);
    if (!id || row?.is_active === false || row?.deleted_at) continue;
    patientsById.set(id, {
      name,
      email: sanitizeEmail(row?.email),
      clinicId: sanitizeText(row?.clinic_id, 120),
      recipientUserId: isUuid(row?.responsible_user_id) ? sanitizeText(row.responsible_user_id, 120) : '',
    });
  }

  return appointments.flatMap((appointment) => {
    const patient = patientsById.get(appointment.patientId);
    if (isUuid(appointment.patientId) && !patient) {
      options.logger.warn('[Appointment Reminder Cron] Consulta ignorada por paciente inativo ou ausente.', {
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
      });
      return [];
    }
    if (
      patient?.clinicId &&
      appointment.clinicId &&
      patient.clinicId !== appointment.clinicId
    ) {
      options.logger.warn('[Appointment Reminder Cron] Consulta ignorada por divergencia de tenant.', {
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
      });
      return [];
    }
    return [{
      ...appointment,
      patientName: patient?.name || sanitizeText(appointment.patientName, 180) || null,
      patientEmail: sanitizeEmail(appointment.patientEmail) || patient?.email || null,
      patientClinicId: patient?.clinicId || null,
      recipientUserId: patient?.recipientUserId || null,
    }];
  });
}

async function fetchReminderAppointments(
  options: ActiveCronServiceOptions,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
  reminderKind?: ReminderKind,
) {
  const tableResult = await fetchAppointmentsTable(
    options,
    queryScheduledStartUtc,
    queryScheduledEndUtc,
    reminderKind,
  );
  const tableAppointments = tableResult.appointments;
  if (!tableResult.available) {
    options.logger.warn(
      '[Appointment Reminder Cron] Fonte canonica indisponivel; preservando consultas do espelho legado.',
    );
  }
  // During the non-destructive transition, legacy-only rows must remain eligible.
  // The RPC filters the JSON in PostgreSQL and returns only this reminder window;
  // it never transfers every historical clinic_state.appointments blob.
  const clinicAppointments = await fetchClinicStateAppointments(
    options,
    queryScheduledStartUtc,
    queryScheduledEndUtc,
  );
  for (const appointment of clinicAppointments.values()) {
    mergeAppointment(tableAppointments, appointment);
  }

  const appointments = Array.from(tableAppointments.values()).sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );
  const hydrated = await hydrateReminderAppointmentPatients(options, appointments);
  const clinicIds = Array.from(new Set(
    hydrated
      .map((appointment) => sanitizeText(appointment.clinicId || appointment.patientClinicId, 120))
      .filter((clinicId) => isUuid(clinicId))
  ));
  const policyByClinicId = new Map<string, boolean>(clinicIds.map((clinicId) => [clinicId, true]));
  if (clinicIds.length > 0) {
    const policyResult = await options.supabase
      .from('clinics')
      .select('id,allow_patient_reschedule')
      .in('id', clinicIds)
      .limit(clinicIds.length);
    if (!policyResult.error) {
      for (const clinic of policyResult.data || []) {
        policyByClinicId.set(
          sanitizeText(clinic?.id, 120),
          clinic?.allow_patient_reschedule !== false
        );
      }
    } else if (extractReminderMissingColumnName(policyResult.error) !== 'allow_patient_reschedule') {
      options.logger.warn('[Appointment Reminder Cron] Politicas de reagendamento indisponiveis.', {
        clinicCount: clinicIds.length,
        message: policyResult.error.message
      });
    }
  }
  return hydrated.map((appointment) => ({
    ...appointment,
    canRequestReschedule:
      policyByClinicId.get(sanitizeText(appointment.clinicId || appointment.patientClinicId, 120)) !== false
  }));
}

async function updateAppointmentsTableMarker(params: {
  supabase: any;
  appointmentId: string;
  kind: ReminderKind;
  sentAt: string;
  logger: ActiveCronServiceOptions['logger'];
}) {
  if (!isUuid(params.appointmentId)) return;

  let payload: Record<string, any> =
    params.kind === '24h'
      ? {
          notification_24h_sent_at: params.sentAt,
          updated_at: params.sentAt
        }
      : {
          notification_12h_sent_at: params.sentAt,
          updated_at: params.sentAt
        };

  while (Object.keys(payload).length > 0) {
    const { error } = await params.supabase
      .from('appointments')
      .update(payload)
      .eq('id', params.appointmentId);
    if (!error) return;

    const missingColumn = String(error.message || '').match(/column\s+"([^"]+)"/i)?.[1];
    if (!missingColumn || !(missingColumn in payload)) {
      params.logger.warn('[Appointment Reminder Cron] Marcador appointments falhou.', {
        appointmentId: params.appointmentId,
        kind: params.kind,
        message: error.message
      });
      return;
    }
    delete payload[missingColumn];
  }
}

async function updateClinicStateMarker(params: {
  supabase: any;
  clinicId: string;
  appointmentId: string;
  kind: ReminderKind;
  sentAt: string;
  logger: ActiveCronServiceOptions['logger'];
}) {
  const { data, error } = await params.supabase
    .from('clinic_state')
    .select('appointments')
    .eq('clinic_id', params.clinicId)
    .maybeSingle();

  if (error) {
    params.logger.warn('[Appointment Reminder Cron] Falha ao reler clinic_state.', {
      clinicId: params.clinicId,
      appointmentId: params.appointmentId,
      message: error.message
    });
    return;
  }

  const appointments = Array.isArray(data?.appointments) ? data.appointments : [];
  const nextAppointments = appointments.map((row: any) => {
    if (sanitizeText(row?.id, 120) !== params.appointmentId) return row;
    if (params.kind === '24h') {
      return {
        ...row,
        notification_24h_sent_at: params.sentAt,
        notification24hSentAt: params.sentAt,
        notification_sent: true,
        notification_sent_at: params.sentAt
      };
    }
    return {
      ...row,
      notification_12h_sent_at: params.sentAt,
      notification12hSentAt: params.sentAt,
      notification_12h_sent: true
    };
  });

  const { error: updateError } = await params.supabase
    .from('clinic_state')
    .update({
      appointments: nextAppointments,
      updated_at: params.sentAt
    })
    .eq('clinic_id', params.clinicId);

  if (updateError) {
    params.logger.warn('[Appointment Reminder Cron] Marcador clinic_state falhou.', {
      clinicId: params.clinicId,
      appointmentId: params.appointmentId,
      kind: params.kind,
      message: updateError.message
    });
  }
}

async function markReminderAsSent(params: {
  supabase: any;
  appointment: ReminderAppointment;
  kind: ReminderKind;
  logger: ActiveCronServiceOptions['logger'];
}) {
  const sentAt = dayjs().utc().toISOString();
  await updateAppointmentsTableMarker({
    supabase: params.supabase,
    appointmentId: params.appointment.appointmentId,
    kind: params.kind,
    sentAt,
    logger: params.logger
  });

  if (params.appointment.hasClinicStateSource && params.appointment.clinicId) {
    await updateClinicStateMarker({
      supabase: params.supabase,
      clinicId: params.appointment.clinicId,
      appointmentId: params.appointment.appointmentId,
      kind: params.kind,
      sentAt,
      logger: params.logger
    });
  }
}

export const chooseDueReminder = (
  appointment: ReminderAppointment,
  reminderWindowStartUtc: dayjs.Dayjs,
  reminderWindowEndUtc: dayjs.Dayjs,
) => {
  // Prefer the most recent due step. If the backend was unavailable across both windows,
  // send only the 12h follow-up instead of delivering two stale reminders at once.
  for (const step of [...REMINDER_STEPS].reverse()) {
    const alreadySent =
      step.kind === '24h'
        ? Boolean(appointment.notification24SentAt || appointment.legacyNotification24Sent)
        : Boolean(appointment.notification12SentAt || appointment.legacyNotification12Sent);
    if (alreadySent) continue;
    // Never send an older 24h reminder after the newer 12h step has already been delivered.
    if (
      step.kind === '24h' &&
      Boolean(appointment.notification12SentAt || appointment.legacyNotification12Sent)
    ) continue;

    if (step.kind === '12h' && hasResponse(appointment)) continue;

    const dueUtc = getReminderDeliveryDueUtc(appointment.scheduledAt, step.hoursBefore);
    if (!dueUtc.isValid()) continue;
    if (dueUtc.isBefore(reminderWindowStartUtc) || dueUtc.isAfter(reminderWindowEndUtc)) continue;

    const lateMinutes = Math.max(0, reminderWindowEndUtc.diff(dueUtc, 'minute'));
    if (step.kind === '12h' && lateMinutes > REMINDER_12H_MAX_LATE_MINUTES) continue;
    return step;
  }
  return null;
};

const reminderBrandingService = createAppointmentReminderBrandingService({
  sanitizeText,
  isUuid,
  extractReminderMissingColumnName,
  extractReminderClinicLogoStoragePath,
  isGenericClinicNotificationName,
  sanitizeClinicNotificationLogoUrl,
  defaultClinicName: DEFAULT_CLINIC_NOTIFICATION_NAME,
  cacheTtlMs: CLINIC_BRANDING_CACHE_TTL_MS,
});

export const invalidateReminderClinicBranding = reminderBrandingService.invalidateReminderClinicBranding;
export const buildStableClinicNotificationLogoUrl = reminderBrandingService.buildStableClinicNotificationLogoUrl;
export const verifyStableClinicNotificationLogoSignature = reminderBrandingService.verifyStableClinicNotificationLogoSignature;
export const resolvePushSafeClinicLogoUrl = reminderBrandingService.resolvePushSafeClinicLogoUrl;
const resolveReminderClinicBranding = reminderBrandingService.resolveReminderClinicBranding;

async function persistPortalReminder(params: {
  options: ActiveCronServiceOptions;
  appointment: ReminderAppointment;
  kind: ReminderKind;
  title: string;
  body: string;
  scheduledFor: string;
}) {
  const recipientUserId = isUuid(params.appointment.recipientUserId)
    ? sanitizeText(params.appointment.recipientUserId, 120)
    : null;
  const recipientEmail = sanitizeEmail(params.appointment.patientEmail) || null;
  if (!recipientUserId && !recipientEmail) return false;

  const recipientKey = recipientUserId || recipientEmail;
  const idempotencyKey = `${params.options.deploymentEnv}:${buildPortalReminderIdempotencyKey(params.appointment, recipientKey)}`;
  const sentAt = dayjs().utc().toISOString();
  const notificationMetadata = {
    deploymentEnv: params.options.deploymentEnv,
    reminderKind: params.kind,
    scheduledAt: params.appointment.scheduledAt,
    clinicName: params.appointment.clinicName || null,
    clinicLogoUrl: params.appointment.clinicLogoUrl || null,
    patientName: params.appointment.patientName || null,
    allowedActions: {
      canConfirm: true,
      canCancel: true,
      canRequestReschedule: params.appointment.canRequestReschedule !== false
    }
  };

  if (isUuid(params.appointment.appointmentId)) {
    let existingQuery = params.options.supabase
      .from('portal_notifications')
      .select('id, acknowledged_at, title, message, scheduled_for, metadata, created_at')
      .eq('deployment_env', params.options.deploymentEnv)
      .eq('patient_id', params.appointment.patientId)
      .eq('appointment_id', params.appointment.appointmentId)
      .eq('idempotency_key', idempotencyKey)
      .in('type', ['appointment_reminder', 'appointment_reminder_24h', 'appointment_reminder_12h'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (recipientUserId && recipientEmail) {
      existingQuery = existingQuery.or(`recipient_user_id.eq.${recipientUserId},recipient_email.eq.${recipientEmail}`);
    } else if (recipientUserId) {
      existingQuery = existingQuery.eq('recipient_user_id', recipientUserId);
    } else if (recipientEmail) {
      existingQuery = existingQuery.eq('recipient_email', recipientEmail);
    }

    const existingResult = await existingQuery.maybeSingle();
    if (existingResult.error) {
      const missingTable = String(existingResult.error.code || '') === '42P01' || /portal_notifications/i.test(String(existingResult.error.message || ''));
      if (missingTable) return false;
      params.options.logger.warn('[Appointment Reminder Cron] Dedupe de notificacao interna falhou; tentando upsert idempotente.', {
        appointmentId: params.appointment.appointmentId,
        reminderKind: params.kind,
        message: existingResult.error.message
      });
    } else if (existingResult.data?.id) {
      if (existingResult.data.acknowledged_at) return false;
      const existingMetadata = existingResult.data.metadata && typeof existingResult.data.metadata === 'object'
        ? existingResult.data.metadata
        : {};
      const existingScheduledFor = dayjs(existingResult.data.scheduled_for);
      const requestedScheduledFor = dayjs(params.scheduledFor);
      const scheduledForMatches = existingScheduledFor.isValid() && requestedScheduledFor.isValid()
        ? existingScheduledFor.valueOf() === requestedScheduledFor.valueOf()
        : sanitizeText(existingResult.data.scheduled_for, 120) === sanitizeText(params.scheduledFor, 120);
      const sameReminder =
        sanitizeText(existingResult.data.title, 240) === sanitizeText(params.title, 240) &&
        sanitizeText(existingResult.data.message, 1000) === sanitizeText(params.body, 1000) &&
        scheduledForMatches &&
        sanitizeText(existingMetadata.reminderKind, 40) === params.kind &&
        sanitizeText(existingMetadata.scheduledAt, 120) === sanitizeText(params.appointment.scheduledAt, 120);
      if (sameReminder) return true;
      const metadata = existingResult.data.metadata && typeof existingResult.data.metadata === 'object'
        ? { ...existingResult.data.metadata, ...notificationMetadata }
        : notificationMetadata;
      let updatePayload: Record<string, any> = {
        type: 'appointment_reminder',
        title: params.title,
        message: params.body,
        sent_at: sentAt,
        scheduled_for: params.scheduledFor,
        idempotency_key: idempotencyKey,
        metadata,
        updated_at: sentAt
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error: updateError } = await params.options.supabase
          .from('portal_notifications')
          .update(updatePayload)
          .eq('deployment_env', params.options.deploymentEnv)
          .eq('id', existingResult.data.id);
        if (!updateError) return true;
        if (attempt === 0 && /column\s+"?updated_at"?/i.test(String(updateError.message || ''))) {
          const { updated_at: _removed, ...withoutUpdatedAt } = updatePayload;
          updatePayload = withoutUpdatedAt;
          continue;
        }
        params.options.logger.warn('[Appointment Reminder Cron] Notificacao interna pendente nao atualizada.', {
          appointmentId: params.appointment.appointmentId,
          reminderKind: params.kind,
          message: updateError.message
        });
        return false;
      }
    }
  }

  const { error } = await params.options.supabase
    .from('portal_notifications')
    .upsert({
      deployment_env: params.options.deploymentEnv,
      organization_id: isUuid(params.appointment.clinicId || params.appointment.patientClinicId)
        ? sanitizeText(params.appointment.clinicId || params.appointment.patientClinicId, 120)
        : null,
      clinic_id: isUuid(params.appointment.clinicId || params.appointment.patientClinicId)
        ? sanitizeText(params.appointment.clinicId || params.appointment.patientClinicId, 120)
        : null,
      recipient_user_id: recipientUserId,
      recipient_email: recipientEmail,
      patient_id: params.appointment.patientId,
      appointment_id: isUuid(params.appointment.appointmentId) ? params.appointment.appointmentId : null,
      type: 'appointment_reminder',
      title: params.title,
      message: params.body,
      sent_at: sentAt,
      scheduled_for: params.scheduledFor,
      idempotency_key: idempotencyKey,
      metadata: notificationMetadata
    }, { onConflict: 'deployment_env,idempotency_key' });

  if (error) {
    const missingTable = String(error.code || '') === '42P01' || /portal_notifications/i.test(String(error.message || ''));
    params.options.logger.warn('[Appointment Reminder Cron] Notificação interna não persistida.', {
      appointmentId: params.appointment.appointmentId,
      reminderKind: params.kind,
      schemaPending: missingTable,
      message: error.message
    });
    return false;
  }
  return true;
}

async function runAppointmentReminderJob(
  options: ActiveCronServiceOptions,
  trigger: string
): Promise<AppointmentReminderRunSummary> {
  if (running) {
    return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };
  }
  running = true;
  let distributedLeaseAcquired = false;

  let summary: AppointmentReminderRunSummary = {
    skipped: false,
    totalCandidates: 0,
    sent24h: 0,
    sent12h: 0,
    failed: 0
  };
  try {
    if (options.requireDistributedLease) {
      distributedLeaseAcquired = await tryAcquireDistributedJobLease({
        supabase: options.supabase,
        jobKey: 'appointment-reminder-scan',
        ownerId: options.runtimeOwnerId,
        leaseSeconds: 20 * 60
      });
      if (!distributedLeaseAcquired) {
        options.logger.log('[Appointment Reminder Cron] Execução ignorada; outra réplica possui o lease.', { trigger });
        return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };
      }
    }
    const nowUtc = dayjs().utc();
    if (isReminderQuietHours(nowUtc)) {
      options.logger.log('[Appointment Reminder Cron] Execução adiada pelo horário de não perturbe.', { trigger, businessTimezone: BRAZIL_TIMEZONE, quietHours: '22:00-06:00' });
      return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };
    }
    const reminderWindowStartUtc = nowUtc.subtract(REMINDER_LOOKBACK_MINUTES, 'minute');
    const reminderWindowEndUtc = nowUtc.add(REMINDER_LOOKAHEAD_MINUTES, 'minute');
    const candidateWindows = buildReminderCandidateWindows(nowUtc);
    const appointmentsBySchedule = new Map<string, ReminderAppointment>();
    for (const window of candidateWindows) {
      const rows = await fetchReminderAppointments(options, window.startUtc, window.endUtc, window.kind);
      for (const appointment of rows) {
        const key = `${appointment.appointmentId}:${appointment.scheduledAt}`;
        if (!appointmentsBySchedule.has(key)) appointmentsBySchedule.set(key, appointment);
      }
    }
    const appointments = Array.from(appointmentsBySchedule.values());
    summary.totalCandidates = appointments.length;

    let sent24h = 0;
    let sent12h = 0;
    let failed = 0;

    const dueAppointments: Array<{
      appointment: ReminderAppointment;
      dueReminder: (typeof REMINDER_STEPS)[number];
      dedupeKey: string;
    }> = [];
    for (const appointment of appointments) {
      if (!appointment.appointmentId || !appointment.patientId || !appointment.scheduledAt) continue;
      if (!isActiveAppointmentStatus(appointment.status)) continue;

      const dueReminder = chooseDueReminder(
        appointment,
        reminderWindowStartUtc,
        reminderWindowEndUtc,
      );
      if (!dueReminder) continue;
      const nowMs = Date.now();
      const dedupeKey = reminderDedupeKey(appointment, dueReminder.kind);
      if (wasReminderRecentlySent(appointment, dueReminder.kind, nowMs)) {
        options.logger?.log?.('[Appointment Reminder Cron] Lembrete duplicado ignorado em memoria.', {
          appointmentId: appointment.appointmentId,
          patientId: appointment.patientId,
          reminderKind: dueReminder.kind
        });
        continue;
      }
      recentlySentReminders.set(dedupeKey, nowMs);
      dueAppointments.push({ appointment, dueReminder, dedupeKey });
    }

    let subscriptionBatch: {
      complete: boolean;
      subscriptionsByRecipientKey: Map<string, any[]>;
    } = { complete: false, subscriptionsByRecipientKey: new Map() };
    if (options.vapidPublicKey && options.vapidPrivateKey) {
      try {
        subscriptionBatch = await findPushSubscriptionsForRecipients({
          supabase: options.supabase,
          deploymentEnv: options.deploymentEnv,
          recipients: dueAppointments.map(({ appointment, dedupeKey }) => ({
            key: dedupeKey,
            patientIds: [appointment.patientId],
            legacyUserIds: [appointment.patientId],
            patientEmail: appointment.patientEmail,
            clinicId: appointment.clinicId || appointment.patientClinicId,
          })),
          logger: options.logger,
        });
      } catch (subscriptionError: any) {
        // Keep the functional per-recipient lookup as a controlled fallback.
        // The reminders remain eligible and the in-memory dedupe keys are not
        // stranded when one batch preload has a transient failure.
        options.logger.warn('[Appointment Reminder Cron] Preload de assinaturas falhou; usando lookup individual.', {
          message: subscriptionError?.message,
          reminders: dueAppointments.length,
        });
      }
    } else {
      subscriptionBatch = { complete: true, subscriptionsByRecipientKey: new Map() };
    }

    for (const { appointment, dueReminder, dedupeKey } of dueAppointments) {
      try {
        const scheduled = dayjs(appointment.scheduledAt).tz(BRAZIL_TIMEZONE);
        const clinicBranding = await resolveReminderClinicBranding(options, appointment.clinicId);
        const clinicName = (
          !isGenericClinicNotificationName(clinicBranding.clinicName)
            ? clinicBranding.clinicName
            : appointment.clinicName
        ) || DEFAULT_CLINIC_NOTIFICATION_NAME;
        // The notification image must be derived from the appointment clinic on
        // the server. Never inherit a logo carried by a collector payload.
        const clinicLogoUrl = clinicBranding.clinicLogoUrl || null;
        const brandedAppointment = {
          ...appointment,
          clinicName,
          clinicLogoUrl,
        };
        const branding = resolveBrandingContext({
          clinic: {
            id: appointment.clinicId || null,
            displayName: clinicName,
            logoUrl: clinicLogoUrl,
          },
          professional: {
            displayName: appointment.professionalDisplayName,
            logoUrl: appointment.professionalLogoUrl,
          },
          allowProfessionalFallback: false,
          fallbackName: DEFAULT_CLINIC_NOTIFICATION_NAME,
        });
        const reminderPayload = buildPatientReminderNotificationPayload({
          appointmentId: appointment.appointmentId,
          scheduledAt: appointment.scheduledAt,
          dateLabel: scheduled.isValid() ? scheduled.format('DD/MM/YYYY') : null,
          timeLabel: scheduled.isValid() ? scheduled.format('HH:mm') : null,
          patientName: appointment.patientName,
          reminderKind: dueReminder.kind,
          branding,
          canRequestReschedule: appointment.canRequestReschedule !== false,
        });
        const title = reminderPayload.title;
        const body = reminderPayload.body;
        const persisted = await persistPortalReminder({
          options,
          appointment: brandedAppointment,
          kind: dueReminder.kind,
          title,
          body,
          scheduledFor: getReminderDeliveryDueUtc(appointment.scheduledAt, dueReminder.hoursBefore).toISOString()
        });
        const result = options.vapidPublicKey && options.vapidPrivateKey
          ? await sendAppointmentNotification({
              supabase: options.supabase,
              deploymentEnv: options.deploymentEnv,
              patientId: appointment.patientId,
              prevalidatedPatientIds: [appointment.patientId],
              patientEmail: appointment.patientEmail,
              appointment: {
                id: appointment.appointmentId,
                scheduledAt: appointment.scheduledAt,
                reminderKind: dueReminder.kind,
                clinicId: appointment.clinicId || null,
                dateLabel: scheduled.isValid() ? scheduled.format('DD/MM/YYYY') : null,
                timeLabel: scheduled.isValid() ? scheduled.format('HH:mm') : null,
                clinicName,
                clinicLogoUrl,
                patientName: appointment.patientName,
                professionalDisplayName: appointment.professionalDisplayName,
                professionalLogoUrl: appointment.professionalLogoUrl,
                canRequestReschedule: appointment.canRequestReschedule !== false
              },
              clinicId: appointment.clinicId || null,
              reminderKind: dueReminder.kind,
              preloadedSubscriptions: subscriptionBatch.complete
                ? subscriptionBatch.subscriptionsByRecipientKey.get(dedupeKey) || []
                : undefined,
              logger: options.logger
            })
          : { sent: 0, failed: 0, subscriptions: 0 };

        if (result.sent > 0) {
          await markReminderAsSent({
            supabase: options.supabase,
            appointment,
            kind: dueReminder.kind,
            logger: options.logger
          });
          
          if (dueReminder.kind === '24h') {
            sent24h += 1;
            options.logger?.log?.('[Appointment Reminder] Notificacao 24h enviada.', {
              appointmentId: appointment.appointmentId,
              patientId: appointment.patientId,
              patientEmail: appointment.patientEmail
            });
          }
          if (dueReminder.kind === '12h') {
            sent12h += 1;
            options.logger?.log?.('[Appointment Reminder] Notificacao 12h enviada (24h nao respondida).', {
              appointmentId: appointment.appointmentId,
              patientId: appointment.patientId,
              patientEmail: appointment.patientEmail,
              notification24hSentAt: appointment.notification24SentAt
            });
          }
        }
        if (result.sent <= 0) {
          recentlySentReminders.delete(dedupeKey);
          failed += Math.max(1, result.failed);
          options.logger.warn('[Appointment Reminder Cron] Push nao entregue; janela permanecera aberta para retry.', {
            appointmentId: appointment.appointmentId,
            patientId: appointment.patientId,
            reminderKind: dueReminder.kind,
            portalReminderPersisted: persisted,
            subscriptionsFound: result.subscriptions,
          });
        }
        if (result.sent > 0) failed += result.failed;
      } catch (error: any) {
        recentlySentReminders.delete(dedupeKey);
        failed += 1;
        options.logger.error('[Appointment Reminder Cron] Erro isolado em consulta.', {
          appointmentId: appointment.appointmentId,
          patientId: appointment.patientId,
          message: error?.message || String(error)
        });
      }
    }

    options.logger.log('[Appointment Reminder Cron] Execucao concluida.', {
      trigger,
      totalCandidates: appointments.length,
      sent24h,
      sent12h,
      failed,
      reminderWindowStartUtc: reminderWindowStartUtc.toISOString(),
      reminderWindowEndUtc: reminderWindowEndUtc.toISOString(),
      businessTimezone: BRAZIL_TIMEZONE,
      catchupLookbackMinutes: REMINDER_LOOKBACK_MINUTES
    });
    summary = { skipped: false, totalCandidates: appointments.length, sent24h, sent12h, failed };
  } catch (error: any) {
    options.logger.error('[Appointment Reminder Cron] Falha geral nao bloqueante.', {
      trigger,
      message: error?.message || String(error)
    });
    summary.failed += 1;
  } finally {
    if (distributedLeaseAcquired) {
      try {
        await releaseDistributedJobLease({
          supabase: options.supabase,
          jobKey: 'appointment-reminder-scan',
          ownerId: options.runtimeOwnerId
        });
      } catch (leaseError: any) {
        options.logger.warn('[Appointment Reminder Cron] Falha ao liberar lease distribuído.', {
          message: leaseError?.message || String(leaseError)
        });
      }
    }
    running = false;
  }
  return summary;
}

async function runNotificationJobQueue(options: ActiveCronServiceOptions, trigger: string, preclaimedRows?: any[]): Promise<AppointmentReminderRunSummary> {
  const claim = preclaimedRows === undefined
    ? await options.supabase.rpc('claim_due_notification_jobs_v1', {
      p_deployment_env: options.deploymentEnv,
      p_worker: options.runtimeOwnerId,
      p_limit: 100,
    })
    : { data: preclaimedRows, error: null };
  if (claim.error) {
    options.logger.error('[Notification Jobs] claim falhou; o scanner legado não será reativado.', {
      trigger,
      message: claim.error.message || String(claim.error),
    });
    return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 1 };
  }
  const claimedRows = Array.isArray(claim.data) ? claim.data : [];
  const jobs = claimedRows.filter((job: any) => matchesVertoDeploymentEnvironment(job?.deployment_env, options.deploymentEnv));
  if (jobs.length !== claimedRows.length) {
    options.logger.error('[Notification Jobs] claim retornou linha fora do namespace; linhas divergentes nao serao processadas.', {
      deploymentEnv: options.deploymentEnv,
      claimed: claimedRows.length,
      accepted: jobs.length,
    });
  }
  if (jobs.length === 0) return { skipped: false, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };

  const appointmentIds = Array.from(new Set(jobs.filter((job: any) => job?.source_type === 'APPOINTMENT').map((job: any) => sanitizeText(job?.source_id, 120)).filter(isUuid)));
  const taskIds = Array.from(new Set(jobs.filter((job: any) => job?.source_type === 'ASSIGNED_TASK').map((job: any) => sanitizeText(job?.source_id, 120)).filter(isUuid)));
  const patientIds = Array.from(new Set(jobs.map((job: any) => sanitizeText(job?.patient_id, 120)).filter(isUuid)));

  const [appointmentResult, taskResult, patientResult] = await Promise.all([
    appointmentIds.length > 0
      ? options.supabase.from('appointments').select('id,clinic_id,organization_id,patient_id,scheduled_at,status,patient_response,patient_confirmation_status,notification_24h_sent_at,notification_12h_sent_at,is_active,deleted_at').in('id', appointmentIds).limit(appointmentIds.length)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length > 0
      ? options.supabase.from('assigned_tasks').select('id,clinic_id,patient_id,patient_email,professional_id,task_type,task_data,scheduled_at,status,completed_at').in('id', taskIds).limit(taskIds.length)
      : Promise.resolve({ data: [], error: null }),
    patientIds.length > 0
      ? options.supabase.from('patients').select('id,name,email,clinic_id,responsible_user_id,is_active,deleted_at').in('id', patientIds).limit(patientIds.length)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (appointmentResult.error || taskResult.error || patientResult.error) {
    const message = appointmentResult.error?.message || taskResult.error?.message || patientResult.error?.message || 'notification job hydration failed';
    await options.supabase.rpc('finalize_notification_jobs_v1', {
      p_deployment_env: options.deploymentEnv,
      p_results: jobs.map((job: any) => ({ id: job.id, outcome: 'RETRY', error: message })),
    });
    return { skipped: false, totalCandidates: jobs.length, sent24h: 0, sent12h: 0, failed: jobs.length };
  }

  const appointmentsById = new Map((appointmentResult.data || []).map((row: any) => [String(row.id), row]));
  const tasksById = new Map((taskResult.data || []).map((row: any) => [String(row.id), row]));
  const patientsById = new Map((patientResult.data || []).map((row: any) => [String(row.id), row]));

  const deliverable: any[] = [];
  const finalResults: Array<{ id: string; outcome: string; error?: string }> = [];
  for (const job of jobs) {
    const patient = patientsById.get(String(job?.patient_id));
    if (!patient || patient?.is_active === false || patient?.deleted_at) {
      finalResults.push({ id: job.id, outcome: 'CANCELED', error: 'PATIENT_INACTIVE' });
      continue;
    }
    if (job?.source_type === 'APPOINTMENT') {
      const appointment = appointmentsById.get(String(job?.source_id));
      const status = sanitizeText(appointment?.status, 40).toLowerCase();
      if (!appointment || appointment?.is_active === false || appointment?.deleted_at || ['cancelled','canceled','no_show','missed','completed'].includes(status)) {
        finalResults.push({ id: job.id, outcome: 'CANCELED', error: 'APPOINTMENT_INACTIVE' });
        continue;
      }
      // A claimed job can become obsolete while a reschedule is committed.
      // Validate the actual persisted schedule and tenant before portal/push effects.
      const reminderGuard = validateClaimedAppointmentReminder(job, appointment, patient, new Date().toISOString());
      if (!reminderGuard.allowed) {
        finalResults.push({ id: job.id, outcome: 'CANCELED', error: reminderGuard.reason });
        continue;
      }
      if (job?.notification_kind === 'APPOINTMENT_REMINDER_12H') {
        const response = sanitizeText(appointment?.patient_response || appointment?.patient_confirmation_status, 40).toLowerCase();
        if (['confirmed','confirmado','accepted','cancelled','canceled','reschedule_requested'].includes(response)) {
          finalResults.push({ id: job.id, outcome: 'CANCELED', error: 'PATIENT_ALREADY_RESPONDED' });
          continue;
        }
      }
      deliverable.push({ job, patient, appointment });
      continue;
    }
    if (job?.source_type === 'ASSIGNED_TASK') {
      const task = tasksById.get(String(job?.source_id));
      const status = sanitizeText(task?.status, 40).toLowerCase();
      if (!task || ['completed','done','cancelled','canceled'].includes(status)) {
        finalResults.push({ id: job.id, outcome: 'CANCELED', error: 'TASK_INACTIVE' });
        continue;
      }
      deliverable.push({ job, patient, task });
      continue;
    }
    finalResults.push({ id: job.id, outcome: 'CANCELED', error: 'UNSUPPORTED_SOURCE' });
  }

  const recipients = deliverable.map(({ job, patient }: any) => ({
    key: String(job.id),
    patientIds: [String(patient.id)],
    patientEmail: sanitizeEmail(patient.email),
    legacyUserIds: isUuid(patient?.responsible_user_id) ? [String(patient.responsible_user_id)] : [],
    clinicId: sanitizeText(job?.clinic_id || patient?.clinic_id, 120),
  }));
  const subscriptionBatch = await findPushSubscriptionsForRecipients({ supabase: options.supabase, deploymentEnv: options.deploymentEnv, recipients, logger: options.logger });

  // Resolve branding once per clinic per claimed batch. Promise.all over jobs could
  // otherwise miss the TTL cache concurrently and repeat the same clinic reads.
  const clinicBrandingById = new Map<string, Awaited<ReturnType<typeof resolveReminderClinicBranding>>>();
  const clinicIdsForBatch = Array.from(new Set(
    deliverable
      .map(({ job, patient }: any) => sanitizeText(job?.clinic_id || patient?.clinic_id, 120))
      .filter((clinicId: string) => isUuid(clinicId))
  ));
  await Promise.all(clinicIdsForBatch.map(async (clinicId) => {
    clinicBrandingById.set(clinicId, await resolveReminderClinicBranding(options, clinicId));
  }));

  const portalRows: any[] = [];
  const prepared = await Promise.all(deliverable.map(async ({ job, patient, appointment, task }: any) => {
    const clinicId = sanitizeText(job?.clinic_id || patient?.clinic_id, 120);
    const clinicBranding = clinicBrandingById.get(clinicId) || { clinicName: DEFAULT_CLINIC_NOTIFICATION_NAME, clinicLogoUrl: null };
    const clinicName = clinicBranding.clinicName || DEFAULT_CLINIC_NOTIFICATION_NAME;
    const clinicLogoUrl = clinicBranding.clinicLogoUrl || null;
    const branding = resolveBrandingContext({ clinic: { id: clinicId || null, displayName: clinicName, logoUrl: clinicLogoUrl }, allowProfessionalFallback: false, fallbackName: DEFAULT_CLINIC_NOTIFICATION_NAME });
    if (appointment) {
      const scheduled = dayjs(appointment.scheduled_at).tz(BRAZIL_TIMEZONE);
      const kind: ReminderKind = job.notification_kind === 'APPOINTMENT_REMINDER_12H' ? '12h' : '24h';
      const payload = buildPatientReminderNotificationPayload({
        appointmentId: String(appointment.id),
        scheduledAt: appointment.scheduled_at,
        dateLabel: scheduled.isValid() ? scheduled.format('DD/MM/YYYY') : null,
        timeLabel: scheduled.isValid() ? scheduled.format('HH:mm') : null,
        patientName: resolvePortalPatientDisplayName(patient),
        reminderKind: kind,
        branding,
        canRequestReschedule: true,
      });
      const idempotencyKey = `${options.deploymentEnv}:notification-job:${job.id}`;
      portalRows.push({
        deployment_env: options.deploymentEnv,
        organization_id: isUuid(job?.organization_id) ? job.organization_id : (isUuid(clinicId) ? clinicId : null), clinic_id: isUuid(clinicId) ? clinicId : null,
        recipient_user_id: isUuid(sanitizeText(patient?.responsible_user_id, 120)) ? patient.responsible_user_id : null, recipient_email: sanitizeEmail(patient.email) || null,
        patient_id: patient.id, appointment_id: appointment.id, type: 'appointment_reminder', title: payload.title, message: payload.body,
        sent_at: new Date().toISOString(), scheduled_for: job.scheduled_for, idempotency_key: idempotencyKey,
        metadata: { deploymentEnv: options.deploymentEnv, appointmentId: appointment.id, reminderKind: kind, scheduledAt: appointment.scheduled_at, clinicName, clinicLogoUrl, patientName: resolvePortalPatientDisplayName(patient) }
      });
      return { job, patient, appointment, kind, title: payload.title, body: payload.body, clinicId, clinicName, clinicLogoUrl, branding };
    }
    const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
    const title = 'Lembrete de tarefa';
    const body = sanitizeText(taskData?.title || 'Você tem uma atividade pendente da clínica.', 180);
    portalRows.push({
      deployment_env: options.deploymentEnv,
      organization_id: isUuid(job?.organization_id) ? job.organization_id : (isUuid(clinicId) ? clinicId : null), clinic_id: isUuid(clinicId) ? clinicId : null,
      recipient_user_id: isUuid(sanitizeText(patient?.responsible_user_id, 120)) ? patient.responsible_user_id : null, recipient_email: sanitizeEmail(patient.email) || null,
      patient_id: patient.id, appointment_id: null, type: 'task_reminder', title, message: body, sent_at: new Date().toISOString(), scheduled_for: job.scheduled_for,
      idempotency_key: `${options.deploymentEnv}:notification-job:${job.id}:${dayjs(job.scheduled_for).tz(BRAZIL_TIMEZONE).format('YYYY-MM-DD')}`,
      metadata: { deploymentEnv: options.deploymentEnv, taskId: task.id, scheduledAt: task.scheduled_at, clinicName, clinicLogoUrl, taskTitle: body, daily: job.recurrence_rule === 'DAILY_WHILE_PENDING' }
    });
    return { job, patient, task, title, body, clinicId, clinicName, clinicLogoUrl, branding };
  }));

  let portalPersisted = true;
  if (portalRows.length > 0) {
    const portalBatch = await options.supabase.rpc('upsert_portal_notifications_batch_v1', { p_deployment_env: options.deploymentEnv, p_rows: portalRows });
    portalPersisted = !portalBatch.error;
    if (portalBatch.error) options.logger.warn('[Notification Jobs] portal batch falhou.', { message: portalBatch.error.message });
  }

  let sent24h = 0; let sent12h = 0; let failed = 0;
  const chunkSize = 8;
  for (let offset = 0; offset < prepared.length; offset += chunkSize) {
    const chunk = prepared.slice(offset, offset + chunkSize);
    const chunkResults = await Promise.all(chunk.map(async (entry: any) => {
      const preloaded = subscriptionBatch.complete ? subscriptionBatch.subscriptionsByRecipientKey.get(String(entry.job.id)) || [] : undefined;
      try {
        if (entry.appointment) {
          const push = options.vapidPublicKey && options.vapidPrivateKey ? await sendAppointmentNotification({
            supabase: options.supabase,
            deploymentEnv: options.deploymentEnv,
            patientId: String(entry.patient.id),
            prevalidatedPatientIds: [String(entry.patient.id)],
            patientEmail: sanitizeEmail(entry.patient.email),
            appointment: { id: entry.appointment.id, scheduledAt: entry.appointment.scheduled_at, reminderKind: entry.kind, clinicId: entry.clinicId, clinicName: entry.clinicName, clinicLogoUrl: entry.clinicLogoUrl, patientName: resolvePortalPatientDisplayName(entry.patient), canRequestReschedule: true },
            clinicId: entry.clinicId,
            reminderKind: entry.kind,
            preloadedSubscriptions: preloaded,
            logger: options.logger,
          }) : { sent: 0, failed: 0, subscriptions: 0 };
          return { entry, push, ok: portalPersisted };
        }
        const push = options.vapidPublicKey && options.vapidPrivateKey ? await sendPatientPortalNotification({
          supabase: options.supabase,
          deploymentEnv: options.deploymentEnv,
          patientId: String(entry.patient.id), patientEmail: sanitizeEmail(entry.patient.email), clinicId: entry.clinicId,
          title: entry.title, body: entry.body, url: `/?task_id=${encodeURIComponent(String(entry.task.id))}`,
          tag: `task-reminder-${entry.task.id}`,
          branding: entry.branding,
          data: { notificationType: 'task_reminder', taskId: entry.task.id },
          preloadedSubscriptions: preloaded,
          logger: options.logger,
        }) : { sent: 0, failed: 0, subscriptions: 0 };
        return { entry, push, ok: portalPersisted };
      } catch (error: any) {
        return { entry, push: { sent: 0, failed: 1 }, ok: false, error: error?.message || String(error) };
      }
    }));
    for (const result of chunkResults) {
      if (result.ok) {
        finalResults.push({ id: result.entry.job.id, outcome: 'SENT' });
        if (result.entry.kind === '24h') sent24h += 1;
        if (result.entry.kind === '12h') sent12h += 1;
      } else {
        failed += 1;
        finalResults.push({ id: result.entry.job.id, outcome: 'RETRY', error: result.error || 'PORTAL_NOTIFICATION_PERSIST_FAILED' });
      }
    }
  }

  if (portalPersisted) {
    const appointmentJobIds = prepared
      .filter((entry: any) => Boolean(entry.appointment))
      .map((entry: any) => sanitizeText(entry.job?.id, 120))
      .filter(isUuid);
    if (appointmentJobIds.length > 0) {
      // Atomic schedule/tenant compare in PostgreSQL prevents a raced reschedule
      // from receiving the old appointment reminder's sent marker.
      const { error: markerError } = await options.supabase.rpc('mark_sent_appointment_notification_jobs_v1', {
        p_deployment_env: options.deploymentEnv,
        p_job_ids: appointmentJobIds,
      });
      if (markerError) {
        options.logger.warn('[Notification Jobs] Marcadores de lembrete nao confirmados.', {
          code: markerError.code || 'REMINDER_MARKER_FAILED',
        });
      }
    }
  }

  if (finalResults.length > 0) await options.supabase.rpc('finalize_notification_jobs_v1', { p_deployment_env: options.deploymentEnv, p_results: finalResults });
  return { skipped: false, totalCandidates: jobs.length, sent24h, sent12h, failed };
}

async function runUnifiedDeliveryQueueScan(trigger: string) {
  const options = activeOptions;
  if (!options) return;
  // Claim subsequent due items even during a prior send; database locks and
  // claimed status avoid duplicate jobs without delaying 24h/12h reminders.
  await dispatchDueDeliveryQueues({
    supabase: options.supabase,
    deploymentEnv: options.deploymentEnv,
    workerId: options.runtimeOwnerId,
    trigger,
    logger: options.logger,
    processNotificationJobs: (rows) => runNotificationJobQueue(options, trigger, rows),
    processClinicAnnouncements: (rows) => clinicAnnouncementService.runClinicAnnouncementDispatchScan(trigger, rows),
  });
}

export function triggerAppointmentReminderScan(_trigger = 'manual_trigger') {
  // Appointment/task DB triggers already schedule precise notification_jobs.
  // Do not launch a global scan after each mutation; the one-minute queue claim will pick due work.
  return Boolean(activeOptions);
}

export async function runAppointmentReminderScan(trigger = 'internal_endpoint') {
  if (!activeOptions) return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };
  return await runNotificationJobQueue(activeOptions, trigger);
}

export function startAppointmentReminderCron(options: CronServiceOptions) {
  const logger = options.logger || console;
  if (started) {
    logger.warn('[Notification Jobs] Serviço já iniciado. Ignorando nova inicialização.');
    return;
  }
  if (!options.supabase) {
    logger.warn('[Notification Jobs] Supabase ausente. Serviço não iniciado.');
    return;
  }
  const deploymentEnv = normalizeVertoDeploymentEnvironment(options.deploymentEnv);
  if (!deploymentEnv) {
    logger.error('[Notification Jobs] VERTO_DEPLOYMENT_ENV ausente/invalida. Serviço não iniciado (fail-closed).');
    return;
  }
  started = true;
  activeOptions = {
    supabase: options.supabase,
    deploymentEnv,
    vapidPublicKey: options.vapidPublicKey || null,
    vapidPrivateKey: options.vapidPrivateKey || null,
    logger,
    runtimeOwnerId: sanitizeText(options.runtimeOwnerId || crypto.randomUUID(), 200),
    requireDistributedLease: false,
  };
  cron.schedule('* * * * *', () => { void runUnifiedDeliveryQueueScan('notification_jobs_cron_1_minute'); }, { timezone: 'UTC' });
  setTimeout(() => { void runUnifiedDeliveryQueueScan('notification_jobs_startup'); }, 5 * 1000);
  logger.log('[Notification Jobs] Filas de lembretes e avisos iniciadas com claim único.', { timezone: 'UTC', businessTimezone: BRAZIL_TIMEZONE, deploymentEnv, pushEnabled: Boolean(options.vapidPublicKey && options.vapidPrivateKey) });
}

const clinicAnnouncementService = createClinicAnnouncementCronService({
  sanitizeText,
  sanitizeEmail,
  isUuid,
  resolveClinicBranding: resolveReminderClinicBranding,
  brazilTimezone: BRAZIL_TIMEZONE,
});

export const dispatchClinicAnnouncementNow = clinicAnnouncementService.dispatchClinicAnnouncementNow;
export const runClinicAnnouncementDispatchScan = clinicAnnouncementService.runClinicAnnouncementDispatchScan;
export const startClinicAnnouncementCron = clinicAnnouncementService.startClinicAnnouncementCron;
