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
  isEssentialEconomyNotificationSchedule,
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
assert.equal(normalizeVertoBackgroundWorkerMode(' ACTIVE '), 'active');
assert.equal(normalizeVertoBackgroundWorkerMode('economy-disabled'), null);
assert.throws(() => resolveVertoBackgroundWorkerMode({ env: { VERTO_DEPLOYMENT_ENV: 'invalid' } }), /staging ou production/);


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
assert.equal(directScheduleCalls, 0, 'economy suppresses generic automatic schedules');
assert.equal(isEssentialEconomyNotificationSchedule('* * * * *', { name:'verto-notification-jobs' }),true);
assert.equal(isEssentialEconomyNotificationSchedule('* * * * *', { name:'verto-clinic-announcements' }),false,'announcements are drained by the unified cron');
assert.equal(isEssentialEconomyNotificationSchedule('*/5 * * * *',{ name:'verto-notification-jobs' }),false,'do not allow arbitrary cadence');
assert.equal(isEssentialEconomyNotificationSchedule('* * * * *',{ name:'unrelated-worker' }),false);
const notificationTask=fakeEconomyScheduler.schedule('* * * * *',()=>undefined,{timezone:'UTC',name:'verto-notification-jobs'});
const announcementTask=fakeEconomyScheduler.schedule('* * * * *',()=>undefined,{timezone:'UTC',name:'verto-clinic-announcements'});
assert.equal(notificationTask.started,true,'essential patient reminders must run in economy');
assert.equal(announcementTask.started,false,'announcements must not register a second poller');
assert.equal(directScheduleCalls,1,'only the unified delivery cron may poll the backend');

// With an independently running staging Cron worker, even the essential queue
// schedule moves off the web process. Production and the default remain unchanged.
let externalRecurringCalls = 0;
let externalStoppedCalls = 0;
const externalScheduler: any = {
  schedule: () => { externalRecurringCalls += 1; return { started: true }; },
  createTask: () => { externalStoppedCalls += 1; return { started: false }; },
};
const externalGuard = installVertoBackgroundWorkerCronGuard({
  env: { ...deploymentEnv('staging'), VERTO_STAGING_NOTIFICATION_DISPATCH: 'external-cron' },
  scheduler: externalScheduler,
  logger: { log: () => undefined },
});
assert.deepEqual(externalGuard, { installed: true, mode: 'economy' });
assert.equal(externalScheduler.schedule('* * * * *',()=>undefined,
  {timezone:'UTC',name:'verto-notification-jobs'}).started,false);
assert.equal(externalRecurringCalls,0,'externally dispatched staging notifications must not poll inside web server');
assert.equal(externalStoppedCalls,1);

assert.equal(fakeEconomyScheduler.schedule('* * * * *',()=>undefined,{timezone:'UTC',name:'unsafe-job'}).started,false);
assert.equal(stoppedTaskCreations,3,'other work and the old announcement scheduler remain stopped');

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
// Keep the probe callbacks structurally equivalent to the runtime callbacks: the reason is an argument
// to a function call, so tsx cannot erase the marker as dead `void 'literal'` code before Function#toString.
const observedWarmupReasons: string[] = [];
const recordWarmupReason = (reason: string) => { observedWarmupReasons.push(reason); };
const notificationWarmup = () => { void recordWarmupReason('notification_jobs_startup'); };
const clinicWarmup = () => { void recordWarmupReason('startup_warmup'); };
const unrelatedTimeout = () => { void recordWarmupReason('unrelated'); };
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
const clinicAnnouncementCronService = read('services/clinicAnnouncementCronService.ts');
const recurringCronSources = [cronService, clinicAnnouncementCronService].join('\n');
const noShowService = read('services/appointmentNoShowService.ts');
const backgroundWorkerMode = read('services/backgroundWorkerMode.ts');
const backgroundWorkerModeConfig = read('services/backgroundWorkerModeConfig.ts');
const distributedRuntime = read('services/distributedRuntimeState.ts');
const server = read('server.ts');
// .env.example is intentionally excluded from the Docker build context; keep
// its source-contract checks in checkout-based CI without bundling env samples.
const envExamplePath = path.join(root, '.env.example');
const envExample = fs.existsSync(envExamplePath) ? read('.env.example') : null;

// All known node-cron recurring workers use the singleton guarded by backgroundWorkerMode.
assert.equal((recurringCronSources.match(/cron\.schedule\(/g) || []).length, 1);
assert.equal((noShowService.match(/cron\.schedule\(/g) || []).length, 1);
assert.match(recurringCronSources, /from 'node-cron'/);
assert.match(noShowService, /from 'node-cron'/);
assert.match(backgroundWorkerMode, /from 'node-cron'/);
assert.match(backgroundWorkerMode, /scheduler\.createTask/);
assert.match(backgroundWorkerMode, /notification_jobs_startup/);
assert.match(cronService, /name:\s*'verto-notification-jobs'/);
assert.doesNotMatch(clinicAnnouncementCronService, /cron\.schedule\(/, 'announcements must not run a second per-minute poller');
assert.match(backgroundWorkerMode, /isEssentialEconomyNotificationSchedule/);
assert.match(backgroundWorkerMode, /startup_warmup/);
assert.match(backgroundWorkerModeConfig, /VERTO_BACKGROUND_WORKER_MODE=economy é proibido em production/);
assert.match(backgroundWorkerMode, /from '\.\/backgroundWorkerModeConfig'/);
assert.match(cronService, /runAppointmentReminderScan/);
assert.match(recurringCronSources, /runClinicAnnouncementDispatchScan/);
assert.match(noShowService, /runAppointmentNoShowScan/);

for (const jobKey of automaticBillingLeaseKeys) {
  assert.match(server, new RegExp(jobKey));
  assert.match(distributedRuntime, new RegExp(jobKey));
}
assert.match(server, /enqueueDueCapacityContractBillingSync\('scheduled_capacity_grace'\)/);
assert.match(server, /drainActivePatientSyncQueue\('scheduled_retry_drain'\)/);
assert.match(server, /reconcileActivePatientSyncQueue/);
assert.match(server, /drainActivePatientSyncQueue/);

if (envExample !== null) {
  assert.match(envExample, /VERTO_BACKGROUND_WORKER_MODE=/);
  assert.doesNotMatch(envExample, /VITE_VERTO_BACKGROUND_WORKER_MODE/);
} else {
  assert.match(backgroundWorkerModeConfig, /VERTO_BACKGROUND_WORKER_MODE/);
  assert.doesNotMatch(backgroundWorkerModeConfig, /VITE_VERTO_BACKGROUND_WORKER_MODE/);
}
assert.doesNotMatch(backgroundWorkerMode, /localStorage|querystring|window\.location/);

console.log('backgroundWorkerEconomyMode.test.ts: OK');
