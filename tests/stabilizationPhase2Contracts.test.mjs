import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const cron = fs.readFileSync(new URL('../services/cronService.ts', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../services/distributedRuntimeState.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../supabase/migrations/20260804024000_distributed_runtime_state.sql', import.meta.url), 'utf8');
const rpcs = fs.readFileSync(new URL('../supabase/migrations/20260804111500_distributed_runtime_state_rpcs.sql', import.meta.url), 'utf8');

assert.match(server, /new SupabaseRateLimitStore\(\{ supabase, scope, windowMs \}\)/);
assert.ok((server.match(/store: distributedRateLimitStore\(/g) || []).length >= 17);
assert.match(server, /await isActiveSessionToken\(sessionUserId, sessionToken\)/);
assert.match(server, /await invalidateActiveSession\(challenge\.userId\)/);
assert.match(server, /distributedRuntimeState: !requiresDistributedRuntimeState\(\)/);
assert.match(server, /runWithDistributedJobLease\('active-patient-retry-drain'/);
assert.match(server, /requireDistributedLease: requiresDistributedRuntimeState\(\)/);

assert.match(cron, /runtime_try_acquire_job_lease_v1|tryAcquireDistributedJobLease/);
assert.match(cron, /jobKey: 'appointment-reminder-scan'/);
assert.match(cron, /outra réplica possui o lease/);

assert.match(runtime, /createHash\('sha256'\)/);
assert.match(runtime, /runtime_active_sessions/);
assert.match(runtime, /runtime_rate_limit_increment_v1/);
assert.match(runtime, /runtime_validate_active_session_v2/);
assert.doesNotMatch(runtime, /token:\s*token[,}]/);

assert.match(schema, /create table if not exists public\.runtime_active_sessions/);
assert.match(schema, /create table if not exists public\.runtime_rate_limits/);
assert.match(schema, /create table if not exists public\.runtime_job_leases/);
assert.match(rpcs, /runtime_rate_limit_increment_v1/);
assert.match(rpcs, /runtime_try_acquire_job_lease_v1/);
assert.match(rpcs, /runtime_cleanup_distributed_state_v1/);

console.log('stabilizationPhase2Contracts.test.mjs: ok');
