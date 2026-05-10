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
    body: 'Sua consulta pela Verto é amanhã! Clique aqui para confirmar ou remarcar.'
  },
  {
    kind: '12h',
    hoursBefore: 12,
    sentColumn: 'notification_12h_sent',
    sentAtColumn: 'notification_12h_sent_at',
    requiresPreviousSent: true,
    title: 'Confirmação de Consulta',
    body: 'Sua consulta está chegando. Confirme sua presença para ajudar a evitar faltas e remarcações.'
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

async function deleteInvalidSubscription(supabase: any, endpoint: string, logger: CronServiceOptions['logger']) {
  const safeEndpoint = sanitizeText(endpoint, 2000);
  if (!safeEndpoint) return;

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', safeEndpoint);

  if (error) {
    logger?.warn?.('[Appointment Reminder Cron] Falha ao remover push subscription inválida.', {
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
    logger?.warn?.('[Appointment Reminder Cron] Não foi possível buscar inscrições push.', {
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
      logger?.warn?.('[Appointment Reminder Cron] Falha em uma inscrição push. Continuando fila.', {
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

async function runAppointmentReminderJob(options: Required<CronServiceOptions>, trigger: string) {
  if (running) return;
  running = true;

  try {
    const nowUtc = dayjs().utc();
    const nowBrazil = nowUtc.tz(BRAZIL_TIMEZONE);
    if (!isWithinBrazilNotificationWindow(nowBrazil)) {
      options.logger.log('[Appointment Reminder Cron] Fora da janela de notificação em Brasília. Execução ignorada.', {
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

    const { data: appointments, error } = await options.supabase
      .from('appointments')
      .select('id, patient_id, scheduled_at, status, notification_sent, notification_12h_sent')
      .neq('status', 'cancelled')
      .neq('status', 'canceled')
      .neq('status', 'confirmed')
      .neq('status', 'reschedule')
      .or('notification_sent.is.false,notification_sent.is.null,notification_12h_sent.is.false,notification_12h_sent.is.null')
      .gte('scheduled_at', queryScheduledStartUtc.toISOString())
      .lt('scheduled_at', queryScheduledEndUtc.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(250);

    if (error) {
      options.logger.warn('[Appointment Reminder Cron] Query de agendamentos falhou.', {
        trigger,
        message: error.message
      });
      return;
    }

    for (const appointment of appointments || []) {
      const appointmentId = sanitizeText(appointment?.id, 120);
      const patientId = sanitizeText(appointment?.patient_id, 120);
      const scheduledAt = sanitizeText(appointment?.scheduled_at, 80);
      if (!appointmentId || !patientId || !scheduledAt) continue;

      const dueReminder = REMINDER_STEPS.find((step) => {
        const alreadySent = Boolean(appointment?.[step.sentColumn]);
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
          const { error: updateError } = await options.supabase
            .from('appointments')
            .update({
              [dueReminder.sentColumn]: true,
              [dueReminder.sentAtColumn]: dayjs().utc().toISOString()
            })
            .eq('id', appointmentId);

          if (updateError) {
            options.logger.warn('[Appointment Reminder Cron] Push enviado, mas update do marcador de notificação falhou.', {
              appointmentId,
              reminderKind: dueReminder.kind,
              message: updateError.message
            });
          }
        }
      } catch (appointmentError: any) {
        options.logger.error('[Appointment Reminder Cron] Erro isolado em agendamento. Continuando loop.', {
          appointmentId,
          patientId,
          message: appointmentError?.message || String(appointmentError)
        });
      }
    }

    options.logger.log('[Appointment Reminder Cron] Execução concluída.', {
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
    options.logger.error('[Appointment Reminder Cron] Falha geral não bloqueante.', {
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
    logger.warn('[Appointment Reminder Cron] Serviço já iniciado. Ignorando nova inicialização.');
    return;
  }

  if (!options.supabase) {
    logger.warn('[Appointment Reminder Cron] Supabase ausente. Serviço não iniciado.');
    return;
  }

  if (!options.vapidPublicKey || !options.vapidPrivateKey) {
    logger.warn('[Appointment Reminder Cron] VAPID ausente. Serviço não iniciado.');
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

  logger.log('[Appointment Reminder Cron] Serviço iniciado no backend Node.js a cada 15 minutos.', {
    timezone: 'UTC',
    businessTimezone: BRAZIL_TIMEZONE
  });
}
