import type { VertoDeploymentEnvironment } from './deploymentEnvironment';

type DeliveryQueueArgs = {
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };
  deploymentEnv: VertoDeploymentEnvironment;
  workerId: string;
  trigger: string;
  logger: Pick<Console, 'warn' | 'error'>;
  processNotificationJobs: (rows?: any[]) => Promise<unknown>;
  processClinicAnnouncements: (rows?: any[]) => Promise<unknown>;
};

let warnedLegacySchema = false;

/**
 * The one-minute job remains punctual. Only its two empty REST claims are
 * consolidated into one server-side transaction; delivery pipelines stay
 * independent and idempotent. On an older schema, both legacy claims remain
 * available until the new migration is installed.
 */
export async function dispatchDueDeliveryQueues(options: DeliveryQueueArgs) {
  let result: { data: any; error: any };
  try {
    result = await options.supabase.rpc('claim_due_delivery_queues_v1', {
      p_deployment_env: options.deploymentEnv,
      p_worker: options.workerId,
      p_notification_limit: 100,
      p_announcement_limit: 20,
    });
  } catch (error: any) {
    options.logger.error('[Delivery Queues] Falha de transporte na consulta consolidada.', {
      code: String(error?.code || 'DELIVERY_CLAIM_NETWORK_ERROR').slice(0, 64),
    });
    return { skipped: true, batched: false, failed: true };
  }

  if (result.error) {
    const code = String(result.error.code || '').toUpperCase();
    // Database migration and Railway may deploy at different times.
    // Only an absent RPC permits the old two-claim path; auth/scope errors
    // must fail closed and are never retried under weaker authorization.
    if (code !== 'PGRST202' && code !== '42883') {
      options.logger.error('[Delivery Queues] Claim transacional indisponível.', { code });
      return { skipped: true, batched: false, failed: true };
    }
    if (!warnedLegacySchema) {
      warnedLegacySchema = true;
      options.logger.warn('[Delivery Queues] Migration pendente; mantendo claims legados.', { code });
    }
    const settled = await Promise.allSettled([
      options.processNotificationJobs(),
      options.processClinicAnnouncements(),
    ]);
    settled.forEach((entry, index) => {
      if (entry.status === 'rejected') {
        options.logger.error('[Delivery Queues] Processamento legado falhou.', {
          queue: index === 0 ? 'notifications' : 'announcements',
        });
      }
    });
    return { skipped: false, batched: false, failed: settled.some((entry) => entry.status === 'rejected') };
  }

  const data = result.data;
  if (!data || !Array.isArray(data.notification_jobs) || !Array.isArray(data.clinic_announcements)) {
    options.logger.error('[Delivery Queues] Retorno transacional inválido; não processar dados desconhecidos.', {
      code: 'INVALID_DELIVERY_CLAIM_RESPONSE',
    });
    return { skipped: true, batched: true, failed: true };
  }

  const settled = await Promise.allSettled([
    options.processNotificationJobs(data.notification_jobs),
    options.processClinicAnnouncements(data.clinic_announcements),
  ]);
  settled.forEach((entry, index) => {
    if (entry.status === 'rejected') {
      options.logger.error('[Delivery Queues] Fila reclamada falhou; recuperação durável preservada.', {
        queue: index === 0 ? 'notifications' : 'announcements',
      });
    }
  });
  return {
    skipped: false,
    batched: true,
    failed: settled.some((entry) => entry.status === 'rejected'),
    notificationCount: data.notification_jobs.length,
    announcementCount: data.clinic_announcements.length,
  };
}
