import crypto from 'crypto';

export type VertoDeploymentEnvironment = 'staging' | 'production';

const ALLOWED_DEPLOYMENT_ENVIRONMENTS = new Set<VertoDeploymentEnvironment>(['staging', 'production']);
const NON_PRODUCTION_HOST_HINTS = ['staging', 'stage', 'preview', 'test', 'dev', 'localhost', '127.0.0.1'];

const clean = (value: unknown, maxLength = 500) => String(value ?? '').trim().slice(0, maxLength);

export function normalizeVertoDeploymentEnvironment(value: unknown): VertoDeploymentEnvironment | null {
  const normalized = clean(value, 40).toLowerCase();
  return ALLOWED_DEPLOYMENT_ENVIRONMENTS.has(normalized as VertoDeploymentEnvironment)
    ? normalized as VertoDeploymentEnvironment
    : null;
}

export function resolveVertoDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VertoDeploymentEnvironment | null {
  return normalizeVertoDeploymentEnvironment(env.VERTO_DEPLOYMENT_ENV);
}

export function matchesVertoDeploymentEnvironment(
  value: unknown,
  expected: VertoDeploymentEnvironment,
): boolean {
  return normalizeVertoDeploymentEnvironment(value) === expected;
}

export function requireVertoDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VertoDeploymentEnvironment {
  const resolved = resolveVertoDeploymentEnvironment(env);
  if (!resolved) {
    throw new Error('VERTO_DEPLOYMENT_ENV deve ser definida explicitamente como staging ou production.');
  }
  return resolved;
}

export function vapidPublicKeyFingerprint(value: unknown): string | null {
  const publicKey = clean(value, 2000);
  if (!publicKey) return null;
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 24);
}

function parseHttpUrl(value: unknown): URL | null {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function hasEnvironmentHint(value: unknown, hints: string[]) {
  const normalized = clean(value, 240).toLowerCase();
  return Boolean(normalized && hints.some((hint) => normalized.includes(hint)));
}

export function validateVertoDeploymentConfiguration(params: {
  env?: NodeJS.ProcessEnv;
  requireEnvironment?: boolean;
}) {
  const env = params.env || process.env;
  const errors: string[] = [];
  const warnings: string[] = [];
  const deploymentEnv = resolveVertoDeploymentEnvironment(env);
  const rawDeploymentEnv = clean(env.VERTO_DEPLOYMENT_ENV, 80);

  if (!deploymentEnv) {
    if (params.requireEnvironment || rawDeploymentEnv) {
      errors.push('VERTO_DEPLOYMENT_ENV deve ser staging ou production.');
    }
    return {
      ok: errors.length === 0,
      deploymentEnv,
      appBaseUrl: null,
      appHost: null,
      supabaseProjectRef: clean(env.SUPABASE_EXPECTED_PROJECT_REF, 120) || null,
      railwayEnvironment: clean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT, 160) || null,
      vapidPublicKeyFingerprint: vapidPublicKeyFingerprint(env.VAPID_PUBLIC_KEY),
      errors,
      warnings,
    };
  }

  const appBaseUrl = parseHttpUrl(env.VERTO_APP_BASE_URL || env.APP_BASE_URL);
  const appHost = appBaseUrl?.hostname.toLowerCase() || null;
  const railwayEnvironment = clean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT, 160) || null;
  const expectedProjectRef = clean(env.SUPABASE_EXPECTED_PROJECT_REF, 120) || null;

  if (params.requireEnvironment && !appBaseUrl) {
    errors.push('VERTO_APP_BASE_URL deve ser uma URL HTTP/HTTPS valida em deploy.');
  }
  if (params.requireEnvironment && appBaseUrl?.protocol !== 'https:') {
    errors.push('VERTO_APP_BASE_URL deve utilizar HTTPS em deploy.');
  }

  if (deploymentEnv === 'production') {
    if (appHost && hasEnvironmentHint(appHost, NON_PRODUCTION_HOST_HINTS)) {
      errors.push('VERTO_DEPLOYMENT_ENV=production conflita com um hostname que aparenta ser nao-producao.');
    }
    if (railwayEnvironment && hasEnvironmentHint(railwayEnvironment, ['staging', 'stage', 'preview', 'test', 'dev'])) {
      errors.push('VERTO_DEPLOYMENT_ENV=production conflita com o ambiente Railway identificado como nao-producao.');
    }
  } else if (railwayEnvironment && hasEnvironmentHint(railwayEnvironment, ['production', 'prod'])) {
    errors.push('VERTO_DEPLOYMENT_ENV=staging conflita com o ambiente Railway identificado como producao.');
  }

  if (!expectedProjectRef) {
    warnings.push('SUPABASE_EXPECTED_PROJECT_REF ausente: a associacao entre runtime e projeto Supabase nao pode ser verificada completamente.');
  }
  if (!clean(env.VAPID_PUBLIC_KEY, 2000)) {
    warnings.push('VAPID_PUBLIC_KEY ausente: push permanece desabilitado neste runtime.');
  }

  return {
    ok: errors.length === 0,
    deploymentEnv,
    appBaseUrl: appBaseUrl?.toString() || null,
    appHost,
    supabaseProjectRef: expectedProjectRef,
    railwayEnvironment,
    vapidPublicKeyFingerprint: vapidPublicKeyFingerprint(env.VAPID_PUBLIC_KEY),
    errors,
    warnings,
  };
}
