import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { sendAppointmentNotification } from './pushNotificationService';

dayjs.extend(utc);
dayjs.extend(timezone);

type CronServiceOptions = {
  supabase: any;
  vapidPublicKey?: string | null;
  vapidPrivateKey?: string | null;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
};

type ReminderKind = '24h' | '12h';

type ReminderAppointment = {
  appointmentId: string;
  clinicId?: string | null;
  patientId: string;
  patientEmail?: string | null;
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
};

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';
const CRON_LOOKBACK_MINUTES = 180;
const QUERY_AHEAD_HOURS = 28;

const REMINDER_STEPS = [
  {
    kind: '24h' as ReminderKind,
    hoursBefore: 24,
    title: 'Confirmacao de consulta - Verto',
    fallbackBody: 'Voce tem uma consulta amanha pela Verto. Confirme, remarque ou cancele pelo app.'
  },
  {
    kind: '12h' as ReminderKind,
    hoursBefore: 12,
    title: 'Consulta chegando - Verto',
    fallbackBody: 'Sua consulta esta chegando. Confirme, remarque ou cancele pelo app.'
  }
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let started = false;
let running = false;
let activeOptions: Required<CronServiceOptions> | null = null;

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const sanitizeEmail = (value: unknown) => {
  const email = sanitizeText(value, 320).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

const isUuid = (value: unknown) => UUID_REGEX.test(sanitizeText(value, 120));

const isActiveAppointmentStatus = (status: unknown) => {
  const normalized = sanitizeText(status || 'scheduled', 40).toLowerCase();
  return ![
    'confirmed',
    'cancelled',
    'canceled',
    'completed',
    'rescheduled',
    'reschedule'
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

const formatReminderBody = (scheduledAt: string, fallback: string) => {
  const scheduled = dayjs(scheduledAt).tz(BRAZIL_TIMEZONE);
  if (!scheduled.isValid()) return fallback;
  return `Voce tem consulta em ${scheduled.format('DD/MM')} as ${scheduled.format('HH:mm')}. O que deseja fazer?`;
};

const getReminderDueUtc = (scheduledAt: string, hoursBefore: number) =>
  dayjs(scheduledAt).tz(BRAZIL_TIMEZONE).subtract(hoursBefore, 'hour').utc();

const mergeAppointment = (
  appointments: Map<string, ReminderAppointment>,
  incoming: ReminderAppointment,
) => {
  const existing = appointments.get(incoming.appointmentId);
  if (!existing) {
    appointments.set(incoming.appointmentId, incoming);
    return;
  }

  appointments.set(incoming.appointmentId, {
    ...existing,
    clinicId: existing.clinicId || incoming.clinicId,
    patientId: existing.patientId || incoming.patientId,
    patientEmail: existing.patientEmail || incoming.patientEmail,
    scheduledAt: existing.scheduledAt || incoming.scheduledAt,
    status: existing.status || incoming.status,
    patientResponse: existing.patientResponse || incoming.patientResponse,
    patientConfirmationStatus: existing.patientConfirmationStatus || incoming.patientConfirmationStatus,
    notification24SentAt: existing.notification24SentAt || incoming.notification24SentAt,
    notification12SentAt: existing.notification12SentAt || incoming.notification12SentAt,
    legacyNotification24Sent: Boolean(existing.legacyNotification24Sent || incoming.legacyNotification24Sent),
    legacyNotification12Sent: Boolean(existing.legacyNotification12Sent || incoming.legacyNotification12Sent),
    hasAppointmentsTableSource: existing.hasAppointmentsTableSource || incoming.hasAppointmentsTableSource,
    hasClinicStateSource: existing.hasClinicStateSource || incoming.hasClinicStateSource
  });
};

async function fetchAppointmentsTable(
  options: Required<CronServiceOptions>,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const appointments = new Map<string, ReminderAppointment>();
  const { data, error } = await options.supabase
    .from('appointments')
    .select('*')
    .gte('scheduled_at', queryScheduledStartUtc.toISOString())
    .lt('scheduled_at', queryScheduledEndUtc.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(500);

  if (error) {
    options.logger.warn('[Appointment Reminder Cron] Query appointments falhou.', {
      message: error.message
    });
    return appointments;
  }

  for (const row of data || []) {
    const appointmentId = sanitizeText(row?.id, 120);
    const patientId = sanitizeText(row?.patient_id, 120);
    const scheduledAt = sanitizeText(row?.scheduled_at, 80);
    if (!appointmentId || !patientId || !scheduledAt) continue;
    if (!isActiveAppointmentStatus(row?.status)) continue;
    if (row?.is_active === false || row?.deleted_at) continue;

    mergeAppointment(appointments, {
      appointmentId,
      patientId,
      patientEmail: sanitizeEmail(row?.patient_email),
      scheduledAt,
      status: sanitizeText(row?.status, 40).toLowerCase(),
      patientResponse: sanitizeText(row?.patient_response, 40).toLowerCase(),
      patientConfirmationStatus: sanitizeText(row?.patient_confirmation_status, 40).toLowerCase(),
      notification24SentAt: sanitizeText(row?.notification_24h_sent_at || row?.notification_sent_at, 80) || null,
      notification12SentAt: sanitizeText(row?.notification_12h_sent_at, 80) || null,
      legacyNotification24Sent: Boolean(row?.notification_sent),
      legacyNotification12Sent: Boolean(row?.notification_12h_sent),
      hasAppointmentsTableSource: true,
      hasClinicStateSource: false
    });
  }

  return appointments;
}

async function fetchClinicStateAppointments(
  options: Required<CronServiceOptions>,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const appointments = new Map<string, ReminderAppointment>();
  const { data, error } = await options.supabase
    .from('clinic_state')
    .select('clinic_id, appointments')
    .limit(500);

  if (error) {
    options.logger.warn('[Appointment Reminder Cron] Query clinic_state falhou.', {
      message: error.message
    });
    return appointments;
  }

  for (const state of data || []) {
    const clinicId = sanitizeText(state?.clinic_id, 120);
    const rows = Array.isArray(state?.appointments) ? state.appointments : [];
    for (const appointment of rows) {
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
        patientEmail: sanitizeEmail(appointment?.patientEmail || appointment?.patient_email),
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

async function fetchReminderAppointments(
  options: Required<CronServiceOptions>,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const tableAppointments = await fetchAppointmentsTable(
    options,
    queryScheduledStartUtc,
    queryScheduledEndUtc,
  );
  const clinicAppointments = await fetchClinicStateAppointments(
    options,
    queryScheduledStartUtc,
    queryScheduledEndUtc,
  );

  for (const appointment of clinicAppointments.values()) {
    mergeAppointment(tableAppointments, appointment);
  }

  return Array.from(tableAppointments.values()).sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );
}

async function updateAppointmentsTableMarker(params: {
  supabase: any;
  appointmentId: string;
  kind: ReminderKind;
  sentAt: string;
  logger: Required<CronServiceOptions>['logger'];
}) {
  if (!isUuid(params.appointmentId)) return;

  let payload: Record<string, any> =
    params.kind === '24h'
      ? {
          notification_24h_sent_at: params.sentAt,
          notification_sent: true,
          notification_sent_at: params.sentAt,
          updated_at: params.sentAt
        }
      : {
          notification_12h_sent_at: params.sentAt,
          notification_12h_sent: true,
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
  logger: Required<CronServiceOptions>['logger'];
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
      notification_12h_sent: true,
      notification_12h_sent_at: params.sentAt
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
  logger: Required<CronServiceOptions>['logger'];
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

const chooseDueReminder = (
  appointment: ReminderAppointment,
  reminderWindowStartUtc: dayjs.Dayjs,
  reminderWindowEndUtc: dayjs.Dayjs,
) => {
  for (const step of REMINDER_STEPS) {
    const alreadySent =
      step.kind === '24h'
        ? Boolean(appointment.notification24SentAt || appointment.legacyNotification24Sent)
        : Boolean(appointment.notification12SentAt || appointment.legacyNotification12Sent);
    if (alreadySent) continue;

    if (step.kind === '12h') {
      const had24h =
        Boolean(appointment.notification24SentAt || appointment.legacyNotification24Sent);
      if (!had24h || hasResponse(appointment)) continue;
    }

    const dueUtc = getReminderDueUtc(appointment.scheduledAt, step.hoursBefore);
    if (!dueUtc.isValid()) continue;
    if (!dueUtc.isBefore(reminderWindowStartUtc) && !dueUtc.isAfter(reminderWindowEndUtc)) {
      return step;
    }
  }
  return null;
};

async function runAppointmentReminderJob(options: Required<CronServiceOptions>, trigger: string) {
  if (running) return;
  running = true;

  try {
    const nowUtc = dayjs().utc();
    const reminderWindowStartUtc = nowUtc.subtract(CRON_LOOKBACK_MINUTES, 'minute');
    const reminderWindowEndUtc = nowUtc.add(2, 'minute');
    const queryScheduledStartUtc = nowUtc;
    const queryScheduledEndUtc = nowUtc.add(QUERY_AHEAD_HOURS, 'hour');
    const appointments = await fetchReminderAppointments(
      options,
      queryScheduledStartUtc,
      queryScheduledEndUtc,
    );

    let sent24h = 0;
    let sent12h = 0;
    let failed = 0;

    for (const appointment of appointments) {
      if (!appointment.appointmentId || !appointment.patientId || !appointment.scheduledAt) continue;
      if (!isActiveAppointmentStatus(appointment.status)) continue;

      const dueReminder = chooseDueReminder(
        appointment,
        reminderWindowStartUtc,
        reminderWindowEndUtc,
      );
      if (!dueReminder) continue;

      try {
        const scheduled = dayjs(appointment.scheduledAt).tz(BRAZIL_TIMEZONE);
        const result = await sendAppointmentNotification({
          supabase: options.supabase,
          patientId: appointment.patientId,
          patientEmail: appointment.patientEmail,
          appointment: {
            id: appointment.appointmentId,
            scheduledAt: appointment.scheduledAt,
            reminderKind: dueReminder.kind,
            dateLabel: scheduled.isValid() ? scheduled.format('DD/MM/YYYY') : null,
            timeLabel: scheduled.isValid() ? scheduled.format('HH:mm') : null
          },
          title: dueReminder.title,
          body: formatReminderBody(appointment.scheduledAt, dueReminder.fallbackBody),
          reminderKind: dueReminder.kind,
          logger: options.logger
        });

        if (result.sent > 0) {
          await markReminderAsSent({
            supabase: options.supabase,
            appointment,
            kind: dueReminder.kind,
            logger: options.logger
          });
          if (dueReminder.kind === '24h') sent24h += result.sent;
          if (dueReminder.kind === '12h') sent12h += result.sent;
        }
        failed += result.failed;
      } catch (error: any) {
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
      businessTimezone: BRAZIL_TIMEZONE
    });
  } catch (error: any) {
    options.logger.error('[Appointment Reminder Cron] Falha geral nao bloqueante.', {
      trigger,
      message: error?.message || String(error)
    });
  } finally {
    running = false;
  }
}

export function triggerAppointmentReminderScan(trigger = 'manual_trigger') {
  if (!activeOptions) return false;
  void runAppointmentReminderJob(activeOptions, trigger);
  return true;
}

export function startAppointmentReminderCron(options: CronServiceOptions) {
  const logger = options.logger || console;

  if (started) {
    logger.warn('[Appointment Reminder Cron] Servico ja iniciado. Ignorando nova inicializacao.');
    return;
  }

  if (!options.supabase) {
    logger.warn('[Appointment Reminder Cron] Supabase ausente. Servico nao iniciado.');
    return;
  }

  if (!options.vapidPublicKey || !options.vapidPrivateKey) {
    logger.warn('[Appointment Reminder Cron] VAPID ausente. Servico nao iniciado.');
    return;
  }

  started = true;
  activeOptions = {
    supabase: options.supabase,
    vapidPublicKey: options.vapidPublicKey,
    vapidPrivateKey: options.vapidPrivateKey,
    logger
  };

  cron.schedule(
    '*/15 * * * *',
    () => {
      void runAppointmentReminderJob(activeOptions as Required<CronServiceOptions>, 'node_cron_15_minutes');
    },
    { timezone: 'UTC' }
  );

  setTimeout(() => {
    void runAppointmentReminderJob(activeOptions as Required<CronServiceOptions>, 'startup_warmup');
  }, 20 * 1000);

  logger.log('[Appointment Reminder Cron] Servico iniciado no backend Node.js a cada 15 minutos.', {
    timezone: 'UTC',
    businessTimezone: BRAZIL_TIMEZONE
  });
}
