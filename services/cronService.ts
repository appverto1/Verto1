import cron from 'node-cron';
import webpush from 'web-push';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

type CronServiceOptions = {
  supabase: any;
  vapidPublicKey?: string | null;
  vapidPrivateKey?: string | null;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
};

type ReminderAppointment = {
  source: 'appointments_table' | 'clinic_state';
  clinicId?: string;
  appointmentId: string;
  patientId: string;
  scheduledAt: string;
  notification_sent?: boolean | null;
  notification_12h_sent?: boolean | null;
};

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';
const BRAZIL_NOTIFICATION_START_MINUTE = 8 * 60;
const BRAZIL_NOTIFICATION_END_MINUTE = 21 * 60;
const CRON_LOOKBACK_MINUTES = 20;
const REMINDER_STEPS = [
  {
    kind: '24h',
    hoursBefore: 24,
    sentColumn: 'notification_sent',
    sentAtColumn: 'notification_sent_at',
    requiresPreviousSent: false,
    title: 'Lembrete de Consulta',
    body: 'Sua consulta pela Verto e amanha. Clique aqui para confirmar ou remarcar.'
  },
  {
    kind: '12h',
    hoursBefore: 12,
    sentColumn: 'notification_12h_sent',
    sentAtColumn: 'notification_12h_sent_at',
    requiresPreviousSent: false,
    title: 'Confirmacao de Consulta',
    body: 'Sua consulta esta chegando. Confirme sua presenca para ajudar a evitar faltas e remarcacoes.'
  }
] as const;
let started = false;
let running = false;

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const isGonePushError = (error: any) => {
  const statusCode = Number(error?.statusCode ?? error?.status);
  return statusCode === 404 || statusCode === 410;
};

const minutesFromStartOfDay = (date: dayjs.Dayjs) => date.hour() * 60 + date.minute();

const isWithinBrazilNotificationWindow = (date: dayjs.Dayjs) => {
  const minutes = minutesFromStartOfDay(date.tz(BRAZIL_TIMEZONE));
  return minutes >= BRAZIL_NOTIFICATION_START_MINUTE && minutes <= BRAZIL_NOTIFICATION_END_MINUTE;
};

const resolveAdjustedReminderTimeUtc = (scheduledAt: string, hoursBefore: number) => {
  const idealBrazil = dayjs(scheduledAt).tz(BRAZIL_TIMEZONE).subtract(hoursBefore, 'hour');
  const idealMinute = minutesFromStartOfDay(idealBrazil);
  const reminderDayStart = idealBrazil.startOf('day');

  if (idealMinute < BRAZIL_NOTIFICATION_START_MINUTE) {
    return reminderDayStart.add(BRAZIL_NOTIFICATION_START_MINUTE, 'minute').utc();
  }

  if (idealMinute > BRAZIL_NOTIFICATION_END_MINUTE) {
    return reminderDayStart.add(BRAZIL_NOTIFICATION_END_MINUTE, 'minute').utc();
  }

  return idealBrazil.utc();
};

const buildScheduledAtFromClinicStateAppointment = (appointment: any) => {
  const explicit = sanitizeText(
    appointment?.scheduled_at || appointment?.scheduledAt,
    80,
  );
  if (explicit) return explicit;

  const date = sanitizeText(appointment?.date, 20);
  const time = sanitizeText(appointment?.time, 10);
  if (!date || !time) return '';

  const candidate = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', BRAZIL_TIMEZONE);
  if (!candidate.isValid()) return '';
  return candidate.utc().toISOString();
};

async function deleteInvalidSubscription(supabase: any, endpoint: string, logger: CronServiceOptions['logger']) {
  const safeEndpoint = sanitizeText(endpoint, 2000);
  if (!safeEndpoint) return;

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', safeEndpoint);

  if (error) {
    logger?.warn?.('[Appointment Reminder Cron] Falha ao remover push subscription invalida.', {
      endpoint: safeEndpoint.slice(0, 80),
      message: error.message
    });
  }
}

async function sendReminderToPatient(params: {
  supabase: any;
  appointmentId: string;
  patientId: string;
  title: string;
  body: string;
  logger: CronServiceOptions['logger'];
}) {
  const { supabase, appointmentId, patientId, title, body, logger } = params;

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('user_id', patientId)
    .limit(20);

  if (error) {
    logger?.warn?.('[Appointment Reminder Cron] Nao foi possivel buscar inscricoes push.', {
      appointmentId,
      patientId,
      message: error.message
    });
    return { sent: 0, failed: 0 };
  }

  const rows = Array.isArray(subscriptions) ? subscriptions : [];
  if (!rows.length) return { sent: 0, failed: 0 };

  const payload = JSON.stringify({
    title,
    body,
    url: `/consulta?appointment_id=${encodeURIComponent(appointmentId)}`,
    appointmentId
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!row?.subscription) continue;
      await webpush.sendNotification(row.subscription, payload);
      sent += 1;
    } catch (error: any) {
      failed += 1;
      logger?.warn?.('[Appointment Reminder Cron] Falha em uma inscricao push. Continuando fila.', {
        appointmentId,
        patientId,
        statusCode: error?.statusCode ?? error?.status ?? null,
        message: error?.message || String(error)
      });

      if (isGonePushError(error)) {
        await deleteInvalidSubscription(supabase, row?.endpoint, logger);
      }
    }
  }

  return { sent, failed };
}

async function fetchReminderAppointments(
  options: Required<CronServiceOptions>,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const appointmentsToNotify = new Map<string, ReminderAppointment>();

  const { data: tableAppointments, error: tableError } = await options.supabase
    .from('appointments')
    .select('id, patient_id, scheduled_at, status, notification_sent, notification_12h_sent')
    .neq('status', 'cancelled')
    .neq('status', 'canceled')
    .neq('status', 'reschedule')
    .eq('is_active', true)
    .is('deleted_at', null)
    .or('notification_sent.is.false,notification_sent.is.null,notification_12h_sent.is.false,notification_12h_sent.is.null')
    .gte('scheduled_at', queryScheduledStartUtc.toISOString())
    .lt('scheduled_at', queryScheduledEndUtc.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(250);

  if (tableError) {
    options.logger.warn('[Appointment Reminder Cron] Query de agendamentos na tabela appointments falhou.', {
      message: tableError.message
    });
  } else {
    for (const appointment of tableAppointments || []) {
      const appointmentId = sanitizeText(appointment?.id, 120);
      const patientId = sanitizeText(appointment?.patient_id, 120);
      const scheduledAt = sanitizeText(appointment?.scheduled_at, 80);
      if (!appointmentId || !patientId || !scheduledAt) continue;

      appointmentsToNotify.set(`table:${appointmentId}`, {
        source: 'appointments_table',
        appointmentId,
        patientId,
        scheduledAt,
        notification_sent: Boolean(appointment?.notification_sent),
        notification_12h_sent: Boolean(appointment?.notification_12h_sent)
      });
    }
  }

  const { data: clinicStates, error: clinicStateError } = await options.supabase
    .from('clinic_state')
    .select('clinic_id, appointments')
    .limit(200);

  if (clinicStateError) {
    options.logger.warn('[Appointment Reminder Cron] Query de clinic_state falhou.', {
      message: clinicStateError.message
    });
  } else {
    for (const state of clinicStates || []) {
      const clinicId = sanitizeText(state?.clinic_id, 120);
      const appointments = Array.isArray(state?.appointments) ? state.appointments : [];

      for (const appointment of appointments) {
        const appointmentId = sanitizeText(appointment?.id, 120);
        const patientId = sanitizeText(appointment?.patientId || appointment?.patient_id, 120);
        const scheduledAt = buildScheduledAtFromClinicStateAppointment(appointment);
        const status = sanitizeText(appointment?.status, 40).toLowerCase();
        if (!appointmentId || !patientId || !scheduledAt) continue;
        if (status === 'canceled' || status === 'cancelled' || status === 'reschedule') continue;

        const scheduledMoment = dayjs(scheduledAt);
        if (
          scheduledMoment.isBefore(queryScheduledStartUtc) ||
          !scheduledMoment.isBefore(queryScheduledEndUtc)
        ) {
          continue;
        }

        if (Boolean(appointment?.notification_sent) && Boolean(appointment?.notification_12h_sent)) {
          continue;
        }

        appointmentsToNotify.set(`clinic:${clinicId}:${appointmentId}`, {
          source: 'clinic_state',
          clinicId,
          appointmentId,
          patientId,
          scheduledAt,
          notification_sent: Boolean(appointment?.notification_sent),
          notification_12h_sent: Boolean(appointment?.notification_12h_sent)
        });
      }
    }
  }

  return Array.from(appointmentsToNotify.values()).sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );
}

async function markReminderAsSent(params: {
  supabase: any;
  appointment: ReminderAppointment;
  sentColumn: string;
  sentAtColumn: string;
  logger: CronServiceOptions['logger'];
}) {
  const { supabase, appointment, sentColumn, sentAtColumn, logger } = params;
  const sentAt = dayjs().utc().toISOString();

  if (appointment.source === 'appointments_table') {
    const { error } = await supabase
      .from('appointments')
      .update({
        [sentColumn]: true,
        [sentAtColumn]: sentAt
      })
      .eq('id', appointment.appointmentId);

    if (error) {
      logger?.warn?.('[Appointment Reminder Cron] Push enviado, mas update do marcador na tabela appointments falhou.', {
        appointmentId: appointment.appointmentId,
        reminderKind: sentColumn,
        message: error.message
      });
    }
    return;
  }

  if (appointment.source !== 'clinic_state' || !appointment.clinicId) return;

  const { data, error } = await supabase
    .from('clinic_state')
    .select('appointments')
    .eq('clinic_id', appointment.clinicId)
    .maybeSingle();

  if (error) {
    logger?.warn?.('[Appointment Reminder Cron] Falha ao reler clinic_state para marcar notificacao.', {
      clinicId: appointment.clinicId,
      appointmentId: appointment.appointmentId,
      message: error.message
    });
    return;
  }

  const appointments = Array.isArray(data?.appointments) ? data.appointments : [];
  const nextAppointments = appointments.map((row: any) => {
    if (sanitizeText(row?.id, 120) !== appointment.appointmentId) return row;
    return {
      ...row,
      [sentColumn]: true,
      [sentAtColumn]: sentAt
    };
  });

  const { error: updateError } = await supabase
    .from('clinic_state')
    .update({
      appointments: nextAppointments,
      updated_at: sentAt
    })
    .eq('clinic_id', appointment.clinicId);

  if (updateError) {
    logger?.warn?.('[Appointment Reminder Cron] Push enviado, mas update do marcador em clinic_state falhou.', {
      clinicId: appointment.clinicId,
      appointmentId: appointment.appointmentId,
      reminderKind: sentColumn,
      message: updateError.message
    });
  }
}

async function runAppointmentReminderJob(options: Required<CronServiceOptions>, trigger: string) {
  if (running) return;
  running = true;

  try {
    const nowUtc = dayjs().utc();
    const nowBrazil = nowUtc.tz(BRAZIL_TIMEZONE);
    if (!isWithinBrazilNotificationWindow(nowBrazil)) {
      options.logger.log('[Appointment Reminder Cron] Fora da janela de notificacao em Brasilia. Execucao ignorada.', {
        trigger,
        nowBrazil: nowBrazil.format(),
        notificationWindowBrazil: '08:00-21:00'
      });
      return;
    }

    const reminderWindowStartUtc = nowUtc.subtract(CRON_LOOKBACK_MINUTES, 'minute');
    const reminderWindowEndUtc = nowUtc.add(1, 'minute');
    const queryScheduledStartUtc = nowUtc;
    const queryScheduledEndUtc = nowUtc.add(28, 'hour');
    const appointments = await fetchReminderAppointments(
      options,
      queryScheduledStartUtc,
      queryScheduledEndUtc,
    );

    for (const appointment of appointments || []) {
      const appointmentId = sanitizeText(appointment?.appointmentId, 120);
      const patientId = sanitizeText(appointment?.patientId, 120);
      const scheduledAt = sanitizeText(appointment?.scheduledAt, 80);
      if (!appointmentId || !patientId || !scheduledAt) continue;

      const dueReminder = REMINDER_STEPS.find((step) => {
        const alreadySent = Boolean((appointment as any)?.[step.sentColumn]);
        if (alreadySent) return false;
        if (step.requiresPreviousSent && !Boolean(appointment?.notification_sent)) return false;

        const adjustedReminderUtc = resolveAdjustedReminderTimeUtc(scheduledAt, step.hoursBefore);
        return (
          !adjustedReminderUtc.isBefore(reminderWindowStartUtc) &&
          !adjustedReminderUtc.isAfter(reminderWindowEndUtc)
        );
      });

      if (!dueReminder) continue;

      try {
        const result = await sendReminderToPatient({
          supabase: options.supabase,
          appointmentId,
          patientId,
          title: dueReminder.title,
          body: dueReminder.body,
          logger: options.logger
        });

        if (result.sent > 0) {
          await markReminderAsSent({
            supabase: options.supabase,
            appointment,
            sentColumn: dueReminder.sentColumn,
            sentAtColumn: dueReminder.sentAtColumn,
            logger: options.logger
          });
        }
      } catch (appointmentError: any) {
        options.logger.error('[Appointment Reminder Cron] Erro isolado em agendamento. Continuando loop.', {
          appointmentId,
          patientId,
          message: appointmentError?.message || String(appointmentError)
        });
      }
    }

    options.logger.log('[Appointment Reminder Cron] Execucao concluida.', {
      trigger,
      reminderWindowStartUtc: reminderWindowStartUtc.toISOString(),
      reminderWindowEndUtc: reminderWindowEndUtc.toISOString(),
      queryScheduledStartUtc: queryScheduledStartUtc.toISOString(),
      queryScheduledEndUtc: queryScheduledEndUtc.toISOString(),
      nowBrazil: nowBrazil.format(),
      notificationWindowBrazil: '08:00-21:00',
      total: appointments?.length || 0
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
  const safeOptions: Required<CronServiceOptions> = {
    supabase: options.supabase,
    vapidPublicKey: options.vapidPublicKey,
    vapidPrivateKey: options.vapidPrivateKey,
    logger
  };

  cron.schedule(
    '*/15 * * * *',
    () => {
      void runAppointmentReminderJob(safeOptions, 'node_cron_15_minutes');
    },
    { timezone: 'UTC' }
  );

  setTimeout(() => {
    void runAppointmentReminderJob(safeOptions, 'startup_warmup');
  }, 120 * 1000);

  logger.log('[Appointment Reminder Cron] Servico iniciado no backend Node.js a cada 15 minutos.', {
    timezone: 'UTC',
    businessTimezone: BRAZIL_TIMEZONE
  });
}
