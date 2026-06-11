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

type ActiveCronServiceOptions = {
  supabase: any;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
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
const REMINDER_DEDUPE_TTL_MS = 30 * 60 * 60 * 1000;
const APPOINTMENT_NOTIFICATION_CTA = 'Toque para abrir a Verto e confirmar, remarcar ou cancelar.';

const REMINDER_STEPS = [
  {
    kind: '24h' as ReminderKind,
    hoursBefore: 24,
    titlePrefix: 'Confirmacao de consulta',
    fallbackBody: `Voce tem uma consulta agendada amanha pela sua clínica. ${APPOINTMENT_NOTIFICATION_CTA}`
  },
  {
    kind: '12h' as ReminderKind,
    hoursBefore: 12,
    titlePrefix: 'Consulta chegando',
    fallbackBody: `Sua consulta esta chegando. ${APPOINTMENT_NOTIFICATION_CTA}`
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

const formatReminderBody = (scheduledAt: string, fallback: string, clinicName = 'sua clínica') => {
  const safeClinicName = sanitizeText(clinicName, 160) || 'sua clínica';
  const scheduled = dayjs(scheduledAt).tz(BRAZIL_TIMEZONE);
  if (!scheduled.isValid()) return fallback;
  const tomorrow = dayjs().tz(BRAZIL_TIMEZONE).add(1, 'day').format('YYYY-MM-DD');
  const dateLabel = scheduled.format('YYYY-MM-DD') === tomorrow
    ? 'amanha'
    : `em ${scheduled.format('DD/MM')}`;
  return `Voce tem uma consulta agendada pela ${safeClinicName} ${dateLabel} as ${scheduled.format('HH:mm')}. ${APPOINTMENT_NOTIFICATION_CTA}`;
};

const getReminderDueUtc = (scheduledAt: string, hoursBefore: number) =>
  dayjs(scheduledAt).tz(BRAZIL_TIMEZONE).subtract(hoursBefore, 'hour').utc();

const reminderDedupeKey = (appointment: ReminderAppointment, kind: ReminderKind) =>
  `${appointment.appointmentId}:${kind}`;

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

  appointments.set(incoming.appointmentId, {
    ...existing,
    clinicId: existing.clinicId || incoming.clinicId,
    clinicName: existing.clinicName || incoming.clinicName,
    clinicLogoUrl: existing.clinicLogoUrl || incoming.clinicLogoUrl,
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
  options: ActiveCronServiceOptions,
  queryScheduledStartUtc: dayjs.Dayjs,
  queryScheduledEndUtc: dayjs.Dayjs,
) {
  const appointments = new Map<string, ReminderAppointment>();
  const { data, error } = await options.supabase
    .from('appointments')
    .select('id, clinic_id, patient_id, patient_email, scheduled_at, status, patient_response, patient_confirmation_status, notification_24h_sent_at, notification_sent_at, notification_12h_sent_at, notification_sent, notification_12h_sent, is_active, deleted_at')
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
      clinicId: sanitizeText(row?.clinic_id, 120) || null,
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
  options: ActiveCronServiceOptions,
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
  options: ActiveCronServiceOptions,
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
  logger: ActiveCronServiceOptions['logger'];
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
      const hasPatientResponse = hasResponse(appointment);
      
      // Send 12h reminder only if 24h was sent AND patient hasn't responded yet
      if (!had24h) {
        // Skip 12h if 24h was never sent
        continue;
      }
      if (hasPatientResponse) {
        // Skip 12h if patient already responded to 24h
        continue;
      }
    }

    const dueUtc = getReminderDueUtc(appointment.scheduledAt, step.hoursBefore);
    if (!dueUtc.isValid()) continue;
    if (!dueUtc.isBefore(reminderWindowStartUtc) && !dueUtc.isAfter(reminderWindowEndUtc)) {
      return step;
    }
  }
  return null;
};

const clinicBrandingCache = new Map<string, { clinicName: string; clinicLogoUrl: string | null }>();

async function resolveReminderClinicBranding(
  options: ActiveCronServiceOptions,
  clinicId?: string | null,
) {
  const safeClinicId = sanitizeText(clinicId, 120);
  if (!isUuid(safeClinicId)) {
    return { clinicName: 'sua clínica', clinicLogoUrl: null };
  }
  const cached = clinicBrandingCache.get(safeClinicId);
  if (cached) return cached;

  const read = (columns: string) =>
    options.supabase
      .from('clinics')
      .select(columns)
      .eq('id', safeClinicId)
      .limit(1)
      .maybeSingle();

  let { data, error } = await read('id,name,logo_url');
  if (error && String(error.message || '').match(/column\s+"?logo_url"?/i)) {
    const fallback = await read('id,name');
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    options.logger.warn('[Appointment Reminder Cron] Branding da clinica nao carregado.', {
      clinicId: safeClinicId,
      message: error.message
    });
    const fallback = { clinicName: 'sua clínica', clinicLogoUrl: null };
    clinicBrandingCache.set(safeClinicId, fallback);
    return fallback;
  }

  const branding = {
    clinicName: sanitizeText(data?.name, 160) || 'sua clínica',
    clinicLogoUrl: sanitizeText(data?.logo_url, 2000) || null
  };
  clinicBrandingCache.set(safeClinicId, branding);
  return branding;
}

async function persistPortalReminder(params: {
  options: ActiveCronServiceOptions;
  appointment: ReminderAppointment;
  kind: ReminderKind;
  title: string;
  body: string;
  scheduledFor: string;
}) {
  const patientResult = await params.options.supabase
    .from('patients')
    .select('id, clinic_id, responsible_user_id, email')
    .eq('id', params.appointment.patientId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (patientResult.error) {
    params.options.logger.warn('[Appointment Reminder Cron] Paciente do lembrete não pôde ser confirmado.', {
      appointmentId: params.appointment.appointmentId,
      message: patientResult.error.message
    });
    return false;
  }

  const patient = patientResult.data;
  if (!patient?.id) return false;
  const recipientUserId = isUuid(patient?.responsible_user_id) ? sanitizeText(patient.responsible_user_id, 120) : null;
  const recipientEmail = sanitizeEmail(params.appointment.patientEmail || patient?.email) || null;
  if (!recipientUserId && !recipientEmail) return false;

  const recipientKey = recipientUserId || recipientEmail;
  const idempotencyKey = `${params.appointment.appointmentId}:${params.kind}:${recipientKey}`;
  const sentAt = dayjs().utc().toISOString();
  const { error } = await params.options.supabase
    .from('portal_notifications')
    .upsert({
      organization_id: isUuid(params.appointment.clinicId || patient?.clinic_id)
        ? sanitizeText(params.appointment.clinicId || patient?.clinic_id, 120)
        : null,
      clinic_id: isUuid(params.appointment.clinicId || patient?.clinic_id)
        ? sanitizeText(params.appointment.clinicId || patient?.clinic_id, 120)
        : null,
      recipient_user_id: recipientUserId,
      recipient_email: recipientEmail,
      patient_id: patient.id,
      appointment_id: isUuid(params.appointment.appointmentId) ? params.appointment.appointmentId : null,
      type: `appointment_reminder_${params.kind}`,
      title: params.title,
      message: params.body,
      sent_at: sentAt,
      scheduled_for: params.scheduledFor,
      idempotency_key: idempotencyKey,
      metadata: {
        reminderKind: params.kind,
        scheduledAt: params.appointment.scheduledAt
      }
    }, { onConflict: 'idempotency_key' });

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

  let summary: AppointmentReminderRunSummary = {
    skipped: false,
    totalCandidates: 0,
    sent24h: 0,
    sent12h: 0,
    failed: 0
  };
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
    summary.totalCandidates = appointments.length;

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

      try {
        const scheduled = dayjs(appointment.scheduledAt).tz(BRAZIL_TIMEZONE);
        const clinicBranding = await resolveReminderClinicBranding(options, appointment.clinicId);
        const clinicName = appointment.clinicName || clinicBranding.clinicName;
        const clinicLogoUrl = appointment.clinicLogoUrl || clinicBranding.clinicLogoUrl;
        const title = `${dueReminder.titlePrefix} - ${clinicName}`;
        const body = formatReminderBody(appointment.scheduledAt, dueReminder.fallbackBody, clinicName);
        const persisted = await persistPortalReminder({
          options,
          appointment,
          kind: dueReminder.kind,
          title,
          body,
          scheduledFor: getReminderDueUtc(appointment.scheduledAt, dueReminder.hoursBefore).toISOString()
        });
        const result = options.vapidPublicKey && options.vapidPrivateKey
          ? await sendAppointmentNotification({
              supabase: options.supabase,
              patientId: appointment.patientId,
              patientEmail: appointment.patientEmail,
              appointment: {
                id: appointment.appointmentId,
                scheduledAt: appointment.scheduledAt,
                reminderKind: dueReminder.kind,
                dateLabel: scheduled.isValid() ? scheduled.format('DD/MM/YYYY') : null,
                timeLabel: scheduled.isValid() ? scheduled.format('HH:mm') : null,
                clinicName,
                clinicLogoUrl
              },
              title,
              body,
              reminderKind: dueReminder.kind,
              logger: options.logger
            })
          : { sent: 0, failed: 0 };

        if (persisted || result.sent > 0) {
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
        if (!persisted && result.sent <= 0) {
          recentlySentReminders.delete(dedupeKey);
          failed += 1;
        }
        failed += result.failed;
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
      businessTimezone: BRAZIL_TIMEZONE
    });
    summary = { skipped: false, totalCandidates: appointments.length, sent24h, sent12h, failed };
  } catch (error: any) {
    options.logger.error('[Appointment Reminder Cron] Falha geral nao bloqueante.', {
      trigger,
      message: error?.message || String(error)
    });
    summary.failed += 1;
  } finally {
    running = false;
  }
  return summary;
}

export function triggerAppointmentReminderScan(trigger = 'manual_trigger') {
  if (!activeOptions) return false;
  void runAppointmentReminderJob(activeOptions, trigger);
  return true;
}

export async function runAppointmentReminderScan(trigger = 'internal_endpoint') {
  if (!activeOptions) {
    return { skipped: true, totalCandidates: 0, sent24h: 0, sent12h: 0, failed: 0 };
  }
  return await runAppointmentReminderJob(activeOptions, trigger);
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
      void runAppointmentReminderJob(activeOptions as ActiveCronServiceOptions, 'node_cron_15_minutes');
    },
    { timezone: 'UTC' }
  );

  setTimeout(() => {
    void runAppointmentReminderJob(activeOptions as ActiveCronServiceOptions, 'startup_warmup');
  }, 20 * 1000);

  logger.log('[Appointment Reminder Cron] Servico iniciado no backend Node.js a cada 15 minutos.', {
    timezone: 'UTC',
    businessTimezone: BRAZIL_TIMEZONE,
    pushEnabled: Boolean(options.vapidPublicKey && options.vapidPrivateKey)
  });
}
