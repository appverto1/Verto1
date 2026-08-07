import cron from 'node-cron';
import crypto from 'crypto';
import {
  releaseDistributedJobLease,
  tryAcquireDistributedJobLease
} from './distributedRuntimeState';

type NoShowClassificationRow = {
  appointmentId?: string;
  clinicId?: string;
  patientId?: string;
};

type AppointmentNoShowServiceOptions = {
  supabase: any;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  runtimeOwnerId?: string | null;
  requireDistributedLease?: boolean;
  onAppointmentsClassified?: (rows: NoShowClassificationRow[]) => Promise<void> | void;
};

type ActiveAppointmentNoShowServiceOptions = Required<
  Pick<AppointmentNoShowServiceOptions, 'supabase' | 'logger' | 'runtimeOwnerId' | 'requireDistributedLease'>
> & Pick<AppointmentNoShowServiceOptions, 'onAppointmentsClassified'>;

let started = false;
let running = false;
let activeOptions: ActiveAppointmentNoShowServiceOptions | null = null;

const safeText = (value: any, max = 200) => String(value || '').trim().slice(0, max);

export async function runAppointmentNoShowScan(trigger = 'manual_trigger') {
  const options = activeOptions;
  if (!options || running) {
    return { skipped: true, classifiedCount: 0, flaggedCount: 0, failedCount: 0 };
  }

  running = true;
  let leaseAcquired = false;
  try {
    if (options.requireDistributedLease) {
      leaseAcquired = await tryAcquireDistributedJobLease({
        supabase: options.supabase,
        jobKey: 'appointment-auto-no-show-scan',
        ownerId: options.runtimeOwnerId,
        leaseSeconds: 240
      });
      if (!leaseAcquired) {
        return { skipped: true, classifiedCount: 0, flaggedCount: 0, failedCount: 0 };
      }
    }

    const { data, error } = await options.supabase.rpc('classify_overdue_appointments_no_show_v1', {
      p_limit: 250
    });
    if (error) throw error;

    const classified = Array.isArray(data?.classified) ? data.classified : [];
    if (classified.length > 0 && options.onAppointmentsClassified) {
      try {
        await options.onAppointmentsClassified(classified);
      } catch (callbackError: any) {
        options.logger.warn('[Appointment No-show Cron] Falha ao revalidar fechamentos após classificação.', {
          trigger: safeText(trigger, 80),
          classifiedCount: classified.length,
          message: safeText(callbackError?.message || callbackError, 240)
        });
      }
    }

    const summary = {
      skipped: false,
      classifiedCount: Number(data?.classifiedCount || classified.length || 0),
      flaggedCount: Number(data?.flaggedCount || 0),
      failedCount: Number(data?.failedCount || 0)
    };
    if (summary.classifiedCount > 0 || summary.flaggedCount > 0 || summary.failedCount > 0) {
      options.logger.log('[Appointment No-show Cron] Varredura concluída.', {
        trigger: safeText(trigger, 80),
        ...summary
      });
    }
    return summary;
  } catch (error: any) {
    options.logger.error('[Appointment No-show Cron] Falha não bloqueante na varredura.', {
      trigger: safeText(trigger, 80),
      code: safeText(error?.code, 80),
      message: safeText(error?.message || error, 240)
    });
    return { skipped: false, classifiedCount: 0, flaggedCount: 0, failedCount: 1 };
  } finally {
    if (leaseAcquired) {
      try {
        await releaseDistributedJobLease({
          supabase: options.supabase,
          jobKey: 'appointment-auto-no-show-scan',
          ownerId: options.runtimeOwnerId
        });
      } catch (leaseError: any) {
        options.logger.warn('[Appointment No-show Cron] Falha ao liberar lease distribuído.', {
          message: safeText(leaseError?.message || leaseError, 240)
        });
      }
    }
    running = false;
  }
}

export function startAppointmentNoShowCron(options: AppointmentNoShowServiceOptions) {
  const logger = options.logger || console;
  if (started) {
    logger.warn('[Appointment No-show Cron] Serviço já iniciado. Nova inicialização ignorada.');
    return;
  }
  if (!options.supabase) {
    logger.warn('[Appointment No-show Cron] Supabase ausente. Serviço não iniciado.');
    return;
  }

  started = true;
  activeOptions = {
    supabase: options.supabase,
    logger,
    runtimeOwnerId: safeText(options.runtimeOwnerId || crypto.randomUUID(), 200),
    requireDistributedLease: options.requireDistributedLease === true,
    onAppointmentsClassified: options.onAppointmentsClassified
  };

  cron.schedule(
    '* * * * *',
    () => {
      void runAppointmentNoShowScan('node_cron_each_minute');
    },
    { timezone: 'UTC' }
  );

  setTimeout(() => {
    void runAppointmentNoShowScan('startup_warmup');
  }, 30 * 1000);

  logger.log('[Appointment No-show Cron] Serviço iniciado no backend Node.js a cada minuto.', {
    timezone: 'UTC',
    distributedLease: activeOptions.requireDistributedLease
  });
}
