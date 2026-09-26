import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import {
  installVertoBackgroundWorkerCronGuard,
  installVertoBackgroundWorkerWarmupGuard,
  normalizeVertoBackgroundWorkerMode,
  resolveVertoBackgroundWorkerMode,
  shouldSuppressVertoEconomyWarmup,
} from '../services/backgroundWorkerMode.ts';
import {
  shouldSuppressDistributedJobLeaseForEconomy,
  tryAcquireDistributedJobLease,
} from '../services/distributedRuntimeState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const deploymentEnv = (
  environment: 'staging' | 'production',
  workerMode?: string,
): NodeJS.ProcessEnv => ({
  VERTO_DEPLOYMENT_ENV: environment,
  VERTO_BACKGROUND_WORKER_MODE: workerMode,
});

assert.equal(normalizeVertoBackgroundWorkerMode('active'), 'active');
assert.equal(normalizeVertoBackgroundWorkerMode('ECONOMY'), 'economy');
assert.equal(normalizeVertoBackgroundWorkerMode('disabled'), null);

// Server-owned defaults: staging is economy-by-default; production behavior is preserved.
assert.equal(resolveVertoBackgroundWorkerMode({ env: deploymentEnv('staging') }), 'economy');
assert.equal(resolveVertoBackgroundWorkerMode({ env: deploymentEnv('staging', 'economy') }), 'economy');
assert.equal(resolveVertoBackgroundWorkerMode({ env: deploymentEnv('staging', 'active') }), 'active');
assert.equal(resolveVertoBackgroundWorkerMode({ env: deploymentEnv('production') }), 'active');
assert.equal(resolveVertoBackgroundWorkerMode({ env: deploymentEnv('production', 'active') }), 'active');
assert.throws(
  () => resolveVertoBackgroundWorkerMode({ env: deploymentEnv('production', 'economy') }),
  /proibido em production/i,
);
assert.throws(
  () => resolveVertoBackgroundWorkerMode({ env: deploymentEnv('staging', 'disabled') }),
  /active ou economy/i,
);

// The centralized node-cron guard turns recurring schedules into stopped tasks in economy.
let directScheduleCalls = 0;
let stoppedTaskCreations = 0;
const fakeEconomyScheduler: any = {
  schedule: () => {
    directScheduleCalls += 1;
    return { started: true };
  },
  createTask: (expression: string) => {
    stoppedTaskCreations += 1;
    return { expression, started: false };
  },
};
const guardResult = installVertoBackgroundWorkerCronGuard({
  env: deploymentEnv('staging'),
  scheduler: fakeEconomyScheduler,
  logger: { log: () => undefined },
});
assert.deepEqual(guardResult, { installed: true, mode: 'economy' });
const stoppedTask = fakeEconomyScheduler.schedule('* * * * *', () => undefined, { timezone: 'UTC' });
assert.equal(stoppedTask.started, false);
assert.equal(stoppedTaskCreations, 1);
assert.equal(directScheduleCalls, 0, 'economy must never call the original auto-starting schedule function');

let activeScheduleCalls = 0;
const fakeActiveScheduler: any = {
  schedule: () => {
    activeScheduleCalls += 1;
    return { started: true };
  },
  createTask: () => ({ started: false }),
};
const activeGuard = installVertoBackgroundWorkerCronGuard({
  env: deploymentEnv('staging', 'active'),
  scheduler: fakeActiveScheduler,
  logger: { log: () => undefined },
});
assert.deepEqual(activeGuard, { installed: false, mode: 'active' });
assert.equal(fakeActiveScheduler.schedule('* * * * *', () => undefined).started, true);
assert.equal(activeScheduleCalls, 1);

// Exercise the real node-cron v4 singleton used by cronService/no-show: createTask must stay stopped.
const realGuard = installVertoBackgroundWorkerCronGuard({
  env: deploymentEnv('staging'),
  scheduler: cron,
  logger: { log: () => undefined },
});
assert.deepEqual(realGuard, { installed: true, mode: 'economy' });
const realStoppedTask = cron.schedule('0 0 1 1 *', () => undefined, { timezone: 'UTC' });
assert.equal(typeof (realStoppedTask as any).start, 'function');
assert.equal((realStoppedTask as any).getStatus?.(), 'stopped');
(realStoppedTask as any).destroy?.();

// Startup warmups are also automatic work; economy suppresses only the three inventoried warmup callbacks.
const notificationWarmup = () => { void 'notification_jobs_startup'; };
const clinicWarmup = () => { void 'startup_warmup'; };
const unrelatedTimeout = () => { void 'unrelated'; };
assert.equal(shouldSuppressVertoEconomyWarmup(notificationWarmup, 5_000), true);
assert.equal(shouldSuppressVertoEconomyWarmup(clinicWarmup, 8_000), true);
assert.equal(shouldSuppressVertoEconomyWarmup(clinicWarmup, 30_000), true);
assert.equal(shouldSuppressVertoEconomyWarmup(unrelatedTimeout, 5_000), false);
assert.equal(shouldSuppressVertoEconomyWarmup(clinicWarmup, 10_000), false);

const timerRegistrations: Array<{ delay: number; source: string }> = [];
const fakeTimerApi: any = {
  setTimeout: (handler: (...args: any[]) => any, delay = 0) => {
    timerRegistrations.push({ delay: Number(delay), source: Function.prototype.toString.call(handler) });
    return { delay };
  },
};
const warmupGuard = installVertoBackgroundWorkerWarmupGuard({
  env: deploymentEnv('staging'),
  timerApi: fakeTimerApi,
  logger: { log: () => undefined },
});
assert.deepEqual(warmupGuard, { installed: true, mode: 'economy' });
fakeTimerApi.setTimeout(notificationWarmup, 5_000);
fakeTimerApi.setTimeout(unrelatedTimeout, 5_000);
assert.equal(timerRegistrations.length, 2);
assert.equal(timerRegistrations[0].delay, 0, 'suppressed warmup becomes a no-op timer');
assert.equal(timerRegistrations[1].delay, 5_000, 'unrelated timers remain untouched');

const automaticBillingLeaseKeys = [
  'active-patient-startup-reconciliation',
  'active-patient-retry-drain',
  'active-patient-daily-reconciliation',
];
for (const jobKey of automaticBillingLeaseKeys) {
  assert.equal(
    shouldSuppressDistributedJobLeaseForEconomy(jobKey, deploymentEnv('staging')),
    true,
    `${jobKey} must not create a Supabase round-trip in staging economy`,
  );
  assert.equal(
    shouldSuppressDistributedJobLeaseForEconomy(jobKey, deploymentEnv('staging', 'active')),
    false,
  );
  assert.equal(
    shouldSuppressDistributedJobLeaseForEconomy(jobKey, deploymentEnv('production')),
    false,
  );
}

let rpcCalls = 0;
const fakeSupabase = {
  from: () => {
    throw new Error('unexpected table access');
  },
  rpc: async () => {
    rpcCalls += 1;
    return { data: true, error: null };
  },
};

const suppressed = await tryAcquireDistributedJobLease({
  supabase: fakeSupabase,
  jobKey: 'active-patient-retry-drain',
  ownerId: 'test-owner',
  leaseSeconds: 60,
  env: deploymentEnv('staging'),
});
assert.equal(suppressed, false);
assert.equal(rpcCalls, 0, 'economy must suppress the lease before any Supabase RPC');

const stagingActive = await tryAcquireDistributedJobLease({
  supabase: fakeSupabase,
  jobKey: 'active-patient-retry-drain',
  ownerId: 'test-owner',
  leaseSeconds: 60,
  env: deploymentEnv('staging', 'active'),
});
assert.equal(stagingActive, true);
assert.equal(rpcCalls, 1);

const productionDefault = await tryAcquireDistributedJobLease({
  supabase: fakeSupabase,
  jobKey: 'active-patient-retry-drain',
  ownerId: 'test-owner',
  leaseSeconds: 60,
  env: deploymentEnv('production'),
});
assert.equal(productionDefault, true);
assert.equal(rpcCalls, 2);

// Non-background leases remain available for deterministic one-shot/manual operations.
const unrelatedLease = await tryAcquireDistributedJobLease({
  supabase: fakeSupabase,
  jobKey: 'appointment-auto-no-show-scan',
  ownerId: 'test-owner',
  leaseSeconds: 60,
  env: deploymentEnv('staging'),
});
assert.equal(unrelatedLease, true);
assert.equal(rpcCalls, 3);

const cronService = read('services/cronService.ts');
const noShowService = read('services/appointmentNoShowService.ts');
const backgroundWorkerMode = read('services/backgroundWorkerMode.ts');
const distributedRuntime = read('services/distributedRuntimeState.ts');
const server = read('server.ts');
const envExample = read('.env.example');

// All known node-cron recurring workers use the singleton guarded by backgroundWorkerMode.
assert.equal((cronService.match(/cron\.schedule\(/g) || []).length, 2);
assert.equal((noShowService.match(/cron\.schedule\(/g) || []).length, 1);
assert.match(cronService, /from 'node-cron'/);
assert.match(noShowService, /from 'node-cron'/);
assert.match(backgroundWorkerMode, /from 'node-cron'/);
assert.match(backgroundWorkerMode, /scheduler\.createTask/);
assert.match(backgroundWorkerMode, /notification_jobs_startup/);
assert.match(backgroundWorkerMode, /startup_warmup/);
assert.match(backgroundWorkerMode, /VERTO_BACKGROUND_WORKER_MODE=economy é proibido em production/);
assert.match(cronService, /runAppointmentReminderScan/);
assert.match(cronService, /runClinicAnnouncementDispatchScan/);
assert.match(noShowService, /runAppointmentNoShowScan/);

for (const jobKey of automaticBillingLeaseKeys) {
  assert.match(server, new RegExp(jobKey));
  assert.match(distributedRuntime, new RegExp(jobKey));
}
assert.match(server, /enqueueDueCapacityContractBillingSync\('scheduled_capacity_grace'\)/);
assert.match(server, /drainActivePatientSyncQueue\('scheduled_retry_drain'\)/);
assert.match(server, /reconcileActivePatientSyncQueue/);
assert.match(server, /drainActivePatientSyncQueue/);

assert.match(envExample, /VERTO_BACKGROUND_WORKER_MODE=/);
assert.doesNotMatch(envExample, /VITE_VERTO_BACKGROUND_WORKER_MODE/);
assert.doesNotMatch(backgroundWorkerMode, /localStorage|querystring|window\.location/);

console.log('backgroundWorkerEconomyMode.test.ts: OK');
