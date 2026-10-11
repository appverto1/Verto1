import cron from 'node-cron';
import crypto from 'crypto';
import { createClinicAnnouncementDeliveryService, type ActiveCronServiceOptions } from './clinicAnnouncementDelivery';
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

const { dispatchClinicAnnouncementById } = createClinicAnnouncementDeliveryService({
  sanitizeText,
  sanitizeEmail,
  isUuid,
  resolveReminderClinicBranding,
});

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
