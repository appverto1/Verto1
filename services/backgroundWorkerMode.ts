import cron from 'node-cron';
import {
  normalizeVertoDeploymentEnvironment,
  type VertoDeploymentEnvironment,
} from './deploymentEnvironment';

export type VertoBackgroundWorkerMode = 'active' | 'economy';

const ALLOWED_BACKGROUND_WORKER_MODES = new Set<VertoBackgroundWorkerMode>(['active', 'economy']);
const guardedSchedulers = new WeakSet<object>();
const guardedTimerApis = new WeakSet<object>();

const clean = (value: unknown, maxLength = 80) =>
  String(value ?? '').trim().slice(0, maxLength).toLowerCase();

export function normalizeVertoBackgroundWorkerMode(value: unknown): VertoBackgroundWorkerMode | null {
  const normalized = clean(value);
  return ALLOWED_BACKGROUND_WORKER_MODES.has(normalized as VertoBackgroundWorkerMode)
    ? normalized as VertoBackgroundWorkerMode
    : null;
}

export function resolveVertoBackgroundWorkerMode(params: {
  env?: NodeJS.ProcessEnv;
  deploymentEnv?: VertoDeploymentEnvironment | null;
} = {}): VertoBackgroundWorkerMode {
  const env = params.env || process.env;
  const deploymentEnv = params.deploymentEnv || normalizeVertoDeploymentEnvironment(env.VERTO_DEPLOYMENT_ENV);
  if (!deploymentEnv) {
    throw new Error('VERTO_DEPLOYMENT_ENV deve ser staging ou production antes de resolver background workers.');
  }

  const rawMode = clean(env.VERTO_BACKGROUND_WORKER_MODE);
  if (!rawMode) return deploymentEnv === 'staging' ? 'economy' : 'active';

  const mode = normalizeVertoBackgroundWorkerMode(rawMode);
  if (!mode) {
    throw new Error('VERTO_BACKGROUND_WORKER_MODE deve ser active ou economy.');
  }
  if (deploymentEnv === 'production' && mode !== 'active') {
    throw new Error('VERTO_BACKGROUND_WORKER_MODE=economy é proibido em production.');
  }
  return mode;
}

export function backgroundWorkersAreAutomatic(params: {
  env?: NodeJS.ProcessEnv;
  deploymentEnv?: VertoDeploymentEnvironment | null;
} = {}): boolean {
  return resolveVertoBackgroundWorkerMode(params) === 'active';
}

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
  installVertoBackgroundWorkerCronGuard({
    deploymentEnv: startupDeploymentEnv,
    logger: console,
  });
  installVertoBackgroundWorkerWarmupGuard({
    deploymentEnv: startupDeploymentEnv,
    logger: console,
  });
}
