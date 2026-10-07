import cron from 'node-cron';
import crypto from 'crypto';
import {
  findPushSubscriptionsForRecipients,
  sendPatientPortalNotification,
} from './pushNotificationService';
import {
  normalizeVertoDeploymentEnvironment,
  type VertoDeploymentEnvironment,
} from './deploymentEnvironment';

export type ClinicAnnouncementCronOptions = {
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

export type ClinicAnnouncementCronDeps = {
  sanitizeText: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string;
  isUuid: (value: unknown) => boolean;
  resolveClinicBranding: (
    options: Pick<ActiveCronServiceOptions, 'supabase' | 'logger'>,
    clinicId?: string | null,
  ) => Promise<{ clinicName: string; clinicLogoUrl: string | null }>;
  brazilTimezone: string;
};

export type ClinicAnnouncementDispatchSummary = {
  skipped: boolean;
  claimed: number;
  delivered: number;
  failed: number;
};

export function createClinicAnnouncementCronService(deps: ClinicAnnouncementCronDeps) {
  const {
    sanitizeText,
    sanitizeEmail,
    isUuid,
    resolveClinicBranding: resolveReminderClinicBranding,
    brazilTimezone: BRAZIL_TIMEZONE,
  } = deps;

  type CronServiceOptions = ClinicAnnouncementCronOptions;

let clinicAnnouncementCronStarted = false;
let clinicAnnouncementCronRunning = false;
let clinicAnnouncementOptions: ActiveCronServiceOptions | null = null;

const CLINIC_ANNOUNCEMENT_BATCH_LIMIT = 20;
const CLINIC_ANNOUNCEMENT_MAX_ATTEMPTS = 5;

async function updateClinicAnnouncementRecipientPushStatuses(
  options: ActiveCronServiceOptions,
  announcementId: string,
  statuses: Map<string, 'SENT' | 'NO_SUBSCRIPTION' | 'FAILED'>,
) {
  for (const status of ['SENT', 'NO_SUBSCRIPTION', 'FAILED'] as const) {
    const patientIds = Array.from(statuses.entries())
      .filter(([, value]) => value === status)
      .map(([patientId]) => patientId)
      .filter((patientId) => isUuid(patientId));
    if (patientIds.length === 0) continue;
    const { error } = await options.supabase
      .from('clinic_announcement_recipients')
      .update({
        push_status: status,
        push_sent_at: status === 'SENT' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('announcement_id', announcementId)
      .in('patient_id', patientIds);
    if (error) {
      options.logger.warn('[Clinic Announcement Cron] Falha ao atualizar status de push dos destinatarios.', {
        announcementId,
        status,
        count: patientIds.length,
        message: error.message,
      });
    }
  }
}

async function dispatchClinicAnnouncementById(
  options: ActiveCronServiceOptions,
  announcementId: string,
  trigger: string,
) {
  const safeAnnouncementId = sanitizeText(announcementId, 120);
  if (!isUuid(safeAnnouncementId)) {
    return { delivered: false, failed: true, reason: 'INVALID_ANNOUNCEMENT_ID' };
  }

  const { data: announcement, error: announcementError } = await options.supabase
    .from('clinic_announcements')
    .select('id,clinic_id,organization_id,category,title,message,event_date,status,scheduled_for,delivery_attempt_count,deployment_env')
    .eq('deployment_env', options.deploymentEnv)
    .eq('id', safeAnnouncementId)
    .limit(1)
    .maybeSingle();
  if (announcementError) throw announcementError;
  if (!announcement) return { delivered: false, failed: false, reason: 'NOT_FOUND' };
  if (['SENT', 'PARTIAL', 'CANCELED'].includes(sanitizeText(announcement.status, 40).toUpperCase())) {
    return { delivered: true, failed: false, reason: 'ALREADY_FINAL' };
  }

  const clinicId = sanitizeText(announcement.clinic_id, 120);
  if (!isUuid(clinicId)) throw new Error('INVALID_ANNOUNCEMENT_CLINIC');

  const materialized = await options.supabase.rpc('materialize_clinic_announcement_portal_notifications_v1', {
    p_deployment_env: options.deploymentEnv,
    p_announcement_id: safeAnnouncementId,
  });
  if (materialized.error) throw materialized.error;

  const { data: recipientRows, error: recipientsError } = await options.supabase
    .from('clinic_announcement_recipients')
    .select('patient_id,recipient_user_id,recipient_email,push_status')
    .eq('announcement_id', safeAnnouncementId)
    .order('patient_id', { ascending: true })
    .limit(500);
  if (recipientsError) throw recipientsError;

  const recipients = (Array.isArray(recipientRows) ? recipientRows : [])
    .map((row: any) => ({
      patientId: sanitizeText(row?.patient_id, 120),
      recipientUserId: sanitizeText(row?.recipient_user_id, 120),
      patientEmail: sanitizeEmail(row?.recipient_email),
    }))
    .filter((row: any) => isUuid(row.patientId));

  if (recipients.length === 0) {
    await options.supabase
      .from('clinic_announcements')
      .update({
        status: 'FAILED',
        delivery_started_at: null,
        delivery_worker_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('deployment_env', options.deploymentEnv)
      .eq('id', safeAnnouncementId);
    return { delivered: false, failed: true, reason: 'NO_RECIPIENTS' };
  }

  let batch: { complete: boolean; subscriptionsByRecipientKey: Map<string, any[]> } = {
    complete: false,
    subscriptionsByRecipientKey: new Map(),
  };
  if (options.vapidPublicKey && options.vapidPrivateKey) {
    try {
      batch = await findPushSubscriptionsForRecipients({
        supabase: options.supabase,
        deploymentEnv: options.deploymentEnv,
        recipients: recipients.map((recipient: any) => ({
          key: recipient.patientId,
          patientIds: [recipient.patientId],
          legacyUserIds: [recipient.patientId, recipient.recipientUserId].filter((value) => isUuid(value)),
          patientEmail: recipient.patientEmail,
          clinicId,
        })),
        logger: options.logger,
      });
    } catch (error: any) {
      options.logger.warn('[Clinic Announcement Cron] Preload de subscriptions falhou; usando fallback individual.', {
        announcementId: safeAnnouncementId,
        message: error?.message || String(error),
      });
    }
  }

  const branding = await resolveReminderClinicBranding(options, clinicId);
  const statuses = new Map<string, 'SENT' | 'NO_SUBSCRIPTION' | 'FAILED'>();
  let pushSentCount = 0;
  let pushFailedCount = 0;

  for (const recipient of recipients) {
    if (!options.vapidPublicKey || !options.vapidPrivateKey) {
      statuses.set(recipient.patientId, 'NO_SUBSCRIPTION');
      continue;
    }
    try {
      const result = await sendPatientPortalNotification({
        supabase: options.supabase,
        deploymentEnv: options.deploymentEnv,
        patientId: recipient.patientId,
        patientEmail: recipient.patientEmail,
        clinicId,
        title: sanitizeText(announcement.title, 180),
        body: sanitizeText(announcement.message, 1000),
        url: `/?announcement_id=${encodeURIComponent(safeAnnouncementId)}`,
        tag: `clinic-announcement-${safeAnnouncementId}`,
        branding: {
          displayName: branding.clinicName,
          logoUrl: branding.clinicLogoUrl,
        },
        data: {
          announcementId: safeAnnouncementId,
          category: sanitizeText(announcement.category, 40),
          eventDate: sanitizeText(announcement.event_date, 40) || null,
          patientId: recipient.patientId,
          scheduledFor: sanitizeText(announcement.scheduled_for, 120) || null,
        },
        preloadedSubscriptions: batch.complete
          ? (batch.subscriptionsByRecipientKey.get(recipient.patientId) || [])
          : undefined,
        logger: options.logger,
      });
      if (result.sent > 0) {
        statuses.set(recipient.patientId, 'SENT');
        pushSentCount += 1;
      } else if (result.subscriptions === 0) {
        statuses.set(recipient.patientId, 'NO_SUBSCRIPTION');
      } else {
        statuses.set(recipient.patientId, 'FAILED');
        pushFailedCount += 1;
      }
    } catch (error: any) {
      statuses.set(recipient.patientId, 'FAILED');
      pushFailedCount += 1;
      options.logger.warn('[Clinic Announcement Cron] Push de aviso falhou para um paciente.', {
        announcementId: safeAnnouncementId,
        patientId: recipient.patientId,
        message: error?.message || String(error),
      });
    }
  }

  await updateClinicAnnouncementRecipientPushStatuses(options, safeAnnouncementId, statuses);
  const finishedAt = new Date().toISOString();
  const finalStatus = pushFailedCount > 0 ? 'PARTIAL' : 'SENT';
  const { error: finalError } = await options.supabase
    .from('clinic_announcements')
    .update({
      status: finalStatus,
      push_sent_count: pushSentCount,
      push_failed_count: pushFailedCount,
      sent_at: finishedAt,
      delivery_started_at: null,
      delivery_worker_id: null,
      updated_at: finishedAt,
    })
    .eq('deployment_env', options.deploymentEnv)
      .eq('id', safeAnnouncementId);
  if (finalError) throw finalError;

  options.logger.log('[Clinic Announcement Cron] Aviso entregue.', {
    trigger,
    announcementId: safeAnnouncementId,
    clinicId,
    recipients: recipients.length,
    pushSentCount,
    pushFailedCount,
  });
  return { delivered: true, failed: false, reason: finalStatus };
}

async function recoverClinicAnnouncementAfterFailure(
  options: ActiveCronServiceOptions,
  announcementId: string,
  error: unknown,
) {
  const { data } = await options.supabase
    .from('clinic_announcements')
    .select('delivery_attempt_count')
    .eq('deployment_env', options.deploymentEnv)
    .eq('id', announcementId)
    .limit(1)
    .maybeSingle();
  const attempts = Math.max(0, Number(data?.delivery_attempt_count || 0));
  const terminal = attempts >= CLINIC_ANNOUNCEMENT_MAX_ATTEMPTS;
  const retryPayload: Record<string, any> = {
    status: terminal ? 'FAILED' : 'SCHEDULED',
    delivery_started_at: null,
    delivery_worker_id: null,
    updated_at: new Date().toISOString(),
  };
  if (!terminal) retryPayload.scheduled_for = new Date(Date.now() + 60_000).toISOString();
  await options.supabase
    .from('clinic_announcements')
    .update(retryPayload)
    .eq('deployment_env', options.deploymentEnv)
    .eq('id', announcementId)
    .is('sent_at', null);
  options.logger.error('[Clinic Announcement Cron] Falha de entrega; envio preservado para retry idempotente.', {
    announcementId,
    attempts,
    terminal,
    message: (error as any)?.message || String(error),
  });
}

async function dispatchClinicAnnouncementNow(
  announcementId: string,
  trigger = 'manual_immediate',
) {
  if (!clinicAnnouncementOptions) {
    return { delivered: false, failed: true, reason: 'SERVICE_NOT_STARTED' };
  }
  try {
    return await dispatchClinicAnnouncementById(clinicAnnouncementOptions, announcementId, trigger);
  } catch (error: any) {
    await recoverClinicAnnouncementAfterFailure(clinicAnnouncementOptions, announcementId, error);
    return { delivered: false, failed: true, reason: error?.message || String(error) };
  }
}

async function runClinicAnnouncementDispatchScan(
  trigger = 'internal_endpoint',
): Promise<ClinicAnnouncementDispatchSummary> {
  const options = clinicAnnouncementOptions;
  if (!options || clinicAnnouncementCronRunning) {
    return { skipped: true, claimed: 0, delivered: 0, failed: 0 };
  }
  clinicAnnouncementCronRunning = true;
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  try {
    const claim = await options.supabase.rpc('claim_due_clinic_announcements_v1', {
      p_deployment_env: options.deploymentEnv,
      p_worker_id: options.runtimeOwnerId,
      p_limit: CLINIC_ANNOUNCEMENT_BATCH_LIMIT,
    });
    if (claim.error) {
      options.logger.warn('[Clinic Announcement Cron] Claim indisponivel.', {
        trigger,
        message: claim.error.message,
      });
      return { skipped: true, claimed: 0, delivered: 0, failed: 0 };
    }
    const ids = (Array.isArray(claim.data) ? claim.data : [])
      .map((row: any) => sanitizeText(row?.announcement_id || row?.id || row, 120))
      .filter((id: string) => isUuid(id));
    claimed = ids.length;
    for (const announcementId of ids) {
      try {
        const result = await dispatchClinicAnnouncementById(options, announcementId, trigger);
        if (result.delivered) delivered += 1;
        if (result.failed) failed += 1;
      } catch (error: any) {
        failed += 1;
        await recoverClinicAnnouncementAfterFailure(options, announcementId, error);
      }
    }
    return { skipped: false, claimed, delivered, failed };
  } finally {
    clinicAnnouncementCronRunning = false;
  }
}

function startClinicAnnouncementCron(options: CronServiceOptions) {
  const logger = options.logger || console;
  if (clinicAnnouncementCronStarted) {
    logger.warn('[Clinic Announcement Cron] Servico ja iniciado. Ignorando nova inicializacao.');
    return;
  }
  if (!options.supabase) {
    logger.warn('[Clinic Announcement Cron] Supabase ausente. Servico nao iniciado.');
    return;
  }
  const deploymentEnv = normalizeVertoDeploymentEnvironment(options.deploymentEnv);
  if (!deploymentEnv) {
    logger.error('[Clinic Announcement Cron] VERTO_DEPLOYMENT_ENV ausente/invalida. Servico nao iniciado (fail-closed).');
    return;
  }
  clinicAnnouncementCronStarted = true;
  clinicAnnouncementOptions = {
    supabase: options.supabase,
    deploymentEnv,
    vapidPublicKey: options.vapidPublicKey || null,
    vapidPrivateKey: options.vapidPrivateKey || null,
    logger,
    runtimeOwnerId: sanitizeText(options.runtimeOwnerId || crypto.randomUUID(), 200),
    requireDistributedLease: options.requireDistributedLease === true,
  };

  cron.schedule(
    '* * * * *',
    () => {
      void runClinicAnnouncementDispatchScan('node_cron_1_minute');
    },
    { timezone: 'UTC' },
  );

  setTimeout(() => {
    void runClinicAnnouncementDispatchScan('startup_warmup');
  }, 8 * 1000);

  logger.log('[Clinic Announcement Cron] Servico iniciado no backend Node.js a cada minuto.', {
    timezone: 'UTC',
    businessTimezone: BRAZIL_TIMEZONE,
    deploymentEnv,
    pushEnabled: Boolean(options.vapidPublicKey && options.vapidPrivateKey),
  });
}


  return {
    dispatchClinicAnnouncementNow,
    runClinicAnnouncementDispatchScan,
    startClinicAnnouncementCron,
  };
}
