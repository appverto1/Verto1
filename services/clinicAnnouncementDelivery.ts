import {
  findPushSubscriptionsForRecipients,
  sendPatientPortalNotification,
} from './pushNotificationService';
import type { VertoDeploymentEnvironment } from './deploymentEnvironment';

export type ActiveCronServiceOptions = {
  supabase: any;
  deploymentEnv: VertoDeploymentEnvironment;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
  runtimeOwnerId: string;
  requireDistributedLease: boolean;
};

type ClinicAnnouncementDeliveryDeps = {
  sanitizeText: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string;
  isUuid: (value: unknown) => boolean;
  resolveReminderClinicBranding: (
    options: Pick<ActiveCronServiceOptions, 'supabase' | 'logger'>,
    clinicId?: string | null,
  ) => Promise<{ clinicName: string; clinicLogoUrl: string | null }>;
};

export function createClinicAnnouncementDeliveryService(deps: ClinicAnnouncementDeliveryDeps) {
  const { sanitizeText, sanitizeEmail, isUuid, resolveReminderClinicBranding } = deps;

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
      pushStatus: sanitizeText(row?.push_status, 30).toUpperCase(),
    }))
    .filter((row: any) => isUuid(row.patientId));
  // A retry must not deliver push twice to recipients already acknowledged as
  // SENT by the previous attempt. The portal materialization is idempotent.
  const pendingPushRecipients = recipients.filter((recipient: any) => recipient.pushStatus !== 'SENT');
  const previouslySentPushCount = recipients.length - pendingPushRecipients.length;

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
        recipients: pendingPushRecipients.map((recipient: any) => ({
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
  let pushSentCount = previouslySentPushCount;
  let pushFailedCount = 0;

  for (const recipient of pendingPushRecipients) {
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

  return { dispatchClinicAnnouncementById };
}
