import crypto from 'crypto';
import { resolveVertoBackgroundWorkerMode } from './backgroundWorkerMode';

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

type RateLimitStoreOptions = {
  supabase: SupabaseLike;
  scope: string;
  windowMs: number;
};

const ECONOMY_SUPPRESSED_AUTOMATIC_JOB_LEASES = new Set([
  'active-patient-startup-reconciliation',
  'active-patient-retry-drain',
  'active-patient-daily-reconciliation',
]);

const sha256 = (value: unknown) =>
  crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

const asDate = (value: unknown, fallbackMs: number) => {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now() + fallbackMs);
};

export function shouldSuppressDistributedJobLeaseForEconomy(
  jobKey: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalizedJobKey = String(jobKey || '').trim().slice(0, 160);
  if (!ECONOMY_SUPPRESSED_AUTOMATIC_JOB_LEASES.has(normalizedJobKey)) return false;
  return resolveVertoBackgroundWorkerMode({ env }) === 'economy';
}

export class SupabaseRateLimitStore {
  readonly prefix: string;
  private readonly supabase: SupabaseLike;
  private readonly scope: string;
  private windowMs: number;

  constructor(options: RateLimitStoreOptions) {
    this.supabase = options.supabase;
    this.scope = String(options.scope || 'default').trim().slice(0, 120) || 'default';
    this.windowMs = Math.max(1_000, Math.floor(Number(options.windowMs) || 60_000));
    this.prefix = `verto:${this.scope}:`;
  }

  init(options: { windowMs?: number }) {
    const configuredWindow = Number(options?.windowMs);
    if (Number.isFinite(configuredWindow) && configuredWindow >= 1_000) {
      this.windowMs = Math.floor(configuredWindow);
    }
  }

  private keyHash(key: string) {
    return sha256(`${this.scope}:${String(key || '')}`);
  }

  async increment(key: string) {
    const { data, error } = await this.supabase.rpc('runtime_rate_limit_increment_v1', {
      p_scope: this.scope,
      p_key_hash: this.keyHash(key),
      p_window_ms: this.windowMs
    });
    if (error) throw new Error(`DISTRIBUTED_RATE_LIMIT_INCREMENT_FAILED: ${error.message || error}`);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      totalHits: Math.max(1, Number(row?.total_hits || row?.totalHits || 1)),
      resetTime: asDate(row?.reset_at || row?.resetAt, this.windowMs)
    };
  }

  async decrement(key: string) {
    const { error } = await this.supabase.rpc('runtime_rate_limit_decrement_v1', {
      p_scope: this.scope,
      p_key_hash: this.keyHash(key)
    });
    if (error) throw new Error(`DISTRIBUTED_RATE_LIMIT_DECREMENT_FAILED: ${error.message || error}`);
  }

  async resetKey(key: string) {
    const { error } = await this.supabase
      .from('runtime_rate_limits')
      .delete()
      .eq('scope', this.scope)
      .eq('key_hash', this.keyHash(key));
    if (error) throw new Error(`DISTRIBUTED_RATE_LIMIT_RESET_FAILED: ${error.message || error}`);
  }
}

export const hashRuntimeSessionToken = (token: unknown) => sha256(String(token || ''));

const tokenHashesMatch = (left: string, right: string) => {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

export async function issueDistributedSessionToken(params: {
  supabase: SupabaseLike;
  userId: string;
  ttlMs: number;
}) {
  const userId = String(params.userId || '').trim().slice(0, 160);
  if (!userId) throw new Error('DISTRIBUTED_SESSION_USER_REQUIRED');
  const ttlMs = Math.max(60_000, Math.floor(Number(params.ttlMs) || 30 * 24 * 60 * 60 * 1000));
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const { error } = await params.supabase
    .from('runtime_active_sessions')
    .upsert([{
      user_id: userId,
      token_hash: hashRuntimeSessionToken(token),
      issued_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      revoked_at: null,
      updated_at: now.toISOString()
    }], { onConflict: 'user_id' });
  if (error) throw new Error(`DISTRIBUTED_SESSION_ISSUE_FAILED: ${error.message || error}`);
  return token;
}

export async function validateDistributedSessionToken(params: {
  supabase: SupabaseLike;
  userId: string;
  token: string;
}) {
  const userId = String(params.userId || '').trim().slice(0, 160);
  const token = String(params.token || '').trim().slice(0, 200);
  if (!userId || !token) return false;

  const { data, error } = await params.supabase.rpc('runtime_validate_active_session_v2', {
    p_user_id: userId,
    p_token_hash: hashRuntimeSessionToken(token)
  });
  if (error) throw new Error(`DISTRIBUTED_SESSION_VALIDATE_FAILED: ${error.message || error}`);
  return data === true;
}

export async function revokeDistributedSessionToken(params: {
  supabase: SupabaseLike;
  userId: string;
  expectedToken: string;
}) {
  const userId = String(params.userId || '').trim().slice(0, 160);
  const expectedToken = String(params.expectedToken || '').trim().slice(0, 200);
  if (!userId || !expectedToken) return;
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from('runtime_active_sessions')
    .update({ revoked_at: now, updated_at: now })
    .eq('user_id', userId)
    .eq('token_hash', hashRuntimeSessionToken(expectedToken));
  if (error) throw new Error(`DISTRIBUTED_SESSION_REVOKE_FAILED: ${error.message || error}`);
}

export async function revokeAllDistributedSessionTokens(params: {
  supabase: SupabaseLike;
  userId: string;
}) {
  const userId = String(params.userId || '').trim().slice(0, 160);
  if (!userId) return;
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from('runtime_active_sessions')
    .update({ revoked_at: now, updated_at: now })
    .eq('user_id', userId);
  if (error) throw new Error(`DISTRIBUTED_SESSION_REVOKE_ALL_FAILED: ${error.message || error}`);
}

export async function tryAcquireDistributedJobLease(params: {
  supabase: SupabaseLike;
  jobKey: string;
  ownerId: string;
  leaseSeconds: number;
  env?: NodeJS.ProcessEnv;
}) {
  const jobKey = String(params.jobKey || '').trim().slice(0, 160);
  if (shouldSuppressDistributedJobLeaseForEconomy(jobKey, params.env || process.env)) return false;

  const { data, error } = await params.supabase.rpc('runtime_try_acquire_job_lease_v1', {
    p_job_key: jobKey,
    p_owner_id: String(params.ownerId || '').trim().slice(0, 200),
    p_lease_seconds: Math.max(5, Math.min(3_600, Math.floor(Number(params.leaseSeconds) || 60)))
  });
  if (error) throw new Error(`DISTRIBUTED_JOB_LEASE_ACQUIRE_FAILED: ${error.message || error}`);
  return data === true;
}

export async function releaseDistributedJobLease(params: {
  supabase: SupabaseLike;
  jobKey: string;
  ownerId: string;
}) {
  const { error } = await params.supabase.rpc('runtime_release_job_lease_v1', {
    p_job_key: String(params.jobKey || '').trim().slice(0, 160),
    p_owner_id: String(params.ownerId || '').trim().slice(0, 200)
  });
  if (error) throw new Error(`DISTRIBUTED_JOB_LEASE_RELEASE_FAILED: ${error.message || error}`);
}

export async function checkDistributedRuntimeState(supabase: SupabaseLike) {
  const probes = [
    ['runtime_active_sessions', 'user_id'],
    ['runtime_rate_limits', 'scope'],
    ['runtime_job_leases', 'job_key'],
  ] as const;
  for (const [table, identityColumn] of probes) {
    const { error } = await supabase.from(table).select(identityColumn).limit(1);
    if (error) return false;
  }
  const { data, error } = await supabase.rpc('runtime_validate_active_session_v2', {
    p_user_id: '',
    p_token_hash: ''
  });
  return !error && data === false;
}
