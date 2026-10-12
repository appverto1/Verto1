import {
  normalizeVertoDeploymentEnvironment,
  type VertoDeploymentEnvironment,
} from './deploymentEnvironment';

export type VertoBackgroundWorkerMode = 'active' | 'economy';

const ALLOWED_BACKGROUND_WORKER_MODES = new Set<VertoBackgroundWorkerMode>(['active', 'economy']);

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

