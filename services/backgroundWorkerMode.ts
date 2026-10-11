import cron from 'node-cron';
import { resolveVertoBackgroundWorkerMode, type VertoBackgroundWorkerMode } from './backgroundWorkerModeConfig';
import {
  normalizeVertoDeploymentEnvironment,
  type VertoDeploymentEnvironment,
} from './deploymentEnvironment';
import { installStagingSupabaseSchemaSelectGuard } from './supabaseSchemaSelectGuard';

export type { VertoBackgroundWorkerMode } from './backgroundWorkerModeConfig';
export { normalizeVertoBackgroundWorkerMode, resolveVertoBackgroundWorkerMode, backgroundWorkersAreAutomatic } from './backgroundWorkerModeConfig';

const guardedSchedulers = new WeakSet<object>();
const guardedTimerApis = new WeakSet<object>();

export function installVertoBackgroundWorkerCronGuard(params: {
  env?: NodeJS.ProcessEnv;
  deploymentEnv?: VertoDeploymentEnvironment | null;
  scheduler?: any;
  logger?: Pick<Console, 'log'>;
} = {}) {
  const env = params.env || process.env;
  const deploymentEnv = params.deploymentEnv || normalizeVertoDeploymentEnvironment(env.VERTO_DEPLOYMENT_ENV);
  if (!deploymentEnv) return { installed: false, mode: null as VertoBackgroundWorkerMode | null };

  const mode = resolveVertoBackgroundWorkerMode({ env, deploymentEnv });
  const scheduler = params.scheduler || cron;
  if (mode !== 'economy') return { installed: false, mode };
  if (!scheduler || typeof scheduler !== 'object') {
    throw new Error('BACKGROUND_WORKER_CRON_SCHEDULER_UNAVAILABLE');
  }
  if (guardedSchedulers.has(scheduler)) return { installed: true, mode };
  if (typeof scheduler.schedule !== 'function' || typeof scheduler.createTask !== 'function') {
    throw new Error('BACKGROUND_WORKER_CRON_GUARD_UNSUPPORTED');
  }

  scheduler.schedule = ((expression: string, task: (...args: any[]) => any, options?: any) => {
    const stoppedTask = scheduler.createTask(expression, task, options);
    params.logger?.log?.('[Background Workers] Polling node-cron suprimido pelo modo economy.', {
      deploymentEnv,
      workerMode: mode,
      expression,
    });
    return stoppedTask;
  }) as typeof scheduler.schedule;
  guardedSchedulers.add(scheduler);
  params.logger?.log?.('[Background Workers] Modo economy ativo; schedulers node-cron permanecem parados.', {
    deploymentEnv,
    workerMode: mode,
  });
  return { installed: true, mode };
}

export function shouldSuppressVertoEconomyWarmup(handler: unknown, delayMs: unknown): boolean {
  if (typeof handler !== 'function') return false;
  const delay = Number(delayMs);
  if (delay !== 5_000 && delay !== 8_000 && delay !== 30_000) return false;
  const source = Function.prototype.toString.call(handler);
  if (delay === 5_000) return source.includes('notification_jobs_startup');
  return source.includes('startup_warmup');
}

export function installVertoBackgroundWorkerWarmupGuard(params: {
  env?: NodeJS.ProcessEnv;
  deploymentEnv?: VertoDeploymentEnvironment | null;
  timerApi?: any;
  logger?: Pick<Console, 'log'>;
} = {}) {
  const env = params.env || process.env;
  const deploymentEnv = params.deploymentEnv || normalizeVertoDeploymentEnvironment(env.VERTO_DEPLOYMENT_ENV);
  if (!deploymentEnv) return { installed: false, mode: null as VertoBackgroundWorkerMode | null };

  const mode = resolveVertoBackgroundWorkerMode({ env, deploymentEnv });
  const timerApi = params.timerApi || globalThis;
  if (mode !== 'economy') return { installed: false, mode };
  if (!timerApi || (typeof timerApi !== 'object' && typeof timerApi !== 'function')) {
    throw new Error('BACKGROUND_WORKER_TIMER_API_UNAVAILABLE');
  }
  if (guardedTimerApis.has(timerApi)) return { installed: true, mode };
  if (typeof timerApi.setTimeout !== 'function') {
    throw new Error('BACKGROUND_WORKER_TIMER_GUARD_UNSUPPORTED');
  }

  const originalSetTimeout = timerApi.setTimeout.bind(timerApi);
  timerApi.setTimeout = ((handler: any, delay?: number, ...args: any[]) => {
    if (shouldSuppressVertoEconomyWarmup(handler, delay)) {
      params.logger?.log?.('[Background Workers] Warmup automático suprimido pelo modo economy.', {
        deploymentEnv,
        workerMode: mode,
        delayMs: Number(delay),
      });
      return originalSetTimeout(() => undefined, 0);
    }
    return originalSetTimeout(handler, delay, ...args);
  }) as typeof timerApi.setTimeout;
  guardedTimerApis.add(timerApi);
  return { installed: true, mode };
}

const startupDeploymentEnv = normalizeVertoDeploymentEnvironment(process.env.VERTO_DEPLOYMENT_ENV);
if (startupDeploymentEnv) {
  await installStagingSupabaseSchemaSelectGuard({
    deploymentEnv: startupDeploymentEnv,
    env: process.env,
    logger: console,
  });
  installVertoBackgroundWorkerCronGuard({
    deploymentEnv: startupDeploymentEnv,
    logger: console,
  });
  installVertoBackgroundWorkerWarmupGuard({
    deploymentEnv: startupDeploymentEnv,
    logger: console,
  });
}
