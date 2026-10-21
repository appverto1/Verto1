import assert from 'node:assert/strict';
import cron from 'node-cron';
import {
  runAppointmentNoShowScan,
  startAppointmentNoShowCron,
} from '../services/appointmentNoShowService';

// Test the real service entrypoint without starting a persistent cron/timer.
const originalSchedule = cron.schedule;
const originalSetTimeout = globalThis.setTimeout;
let registeredSchedule = '';
(cron as any).schedule = (expression: string) => {
  registeredSchedule = expression;
  return { stop() {}, destroy() {} };
};
(globalThis as any).setTimeout = () => ({ unref() {} });

const calls: string[] = [];
const callbacks: any[][] = [];
const loggedErrors: any[] = [];
let finishFirstQuery!: () => void;
const firstQueryGate = new Promise<void>((resolve) => { finishFirstQuery = resolve; });
let firstQueryStarted!: () => void;
const firstQueryStartedPromise = new Promise<void>((resolve) => { firstQueryStarted = resolve; });
const supabase = {
  rpc: async (name: string, args: any) => {
    calls.push(name);
    assert.equal(name, 'classify_overdue_appointments_no_show_v1', 'no distributed lease RPC is allowed');
    assert.deepEqual(args, { p_limit: 250 });
    if (calls.length === 1) {
      firstQueryStarted();
      await firstQueryGate;
      return {
        data: {
          classified: [{ appointmentId: 'a', clinicId: 'c', patientId: 'p' }],
          classifiedCount: 1,
          flaggedCount: 0,
          failedCount: 0,
        },
        error: null,
      };
    }
    if (calls.length === 2) {
      return { data: { classified: [], classifiedCount: 0, flaggedCount: 0, failedCount: 0 }, error: null };
    }
    return { data: null, error: { code: 'XX001', message: 'simulated failure' } };
  },
};
try {
  // Even the existing server option that used to require a lease cannot trigger
  // an extra network round-trip; row locks in the RPC are the authority.
  startAppointmentNoShowCron({
    supabase,
    requireDistributedLease: true,
    runtimeOwnerId: 'test-worker',
    logger: {
      log: () => undefined,
      warn: () => undefined,
      error: (value: any) => { loggedErrors.push(value); },
    },
    onAppointmentsClassified: async (rows) => { callbacks.push(rows); },
  });
} finally {
  (cron as any).schedule = originalSchedule;
  globalThis.setTimeout = originalSetTimeout;
}
assert.equal(registeredSchedule, '* * * * *', 'minute-level no-show scheduling must not change');

const first = runAppointmentNoShowScan('first');
await firstQueryStartedPromise;
const concurrent = await runAppointmentNoShowScan('concurrent');
assert.deepEqual(concurrent, { skipped: true, classifiedCount: 0, flaggedCount: 0, failedCount: 0 });
finishFirstQuery();
const firstResult = await first;
assert.equal(firstResult.classifiedCount, 1);
assert.equal(callbacks.length, 1, 'post-classification callback executes once per returned batch');
assert.equal(callbacks[0]?.[0]?.appointmentId, 'a');
assert.deepEqual(calls, ['classify_overdue_appointments_no_show_v1']);

const idle = await runAppointmentNoShowScan('idle');
assert.equal(idle.classifiedCount, 0);
assert.equal(callbacks.length, 1);
assert.equal(calls.length, 2, 'one RPC per minute, never a lease pair');

const failed = await runAppointmentNoShowScan('failure');
assert.equal(failed.failedCount, 1);
assert.equal(loggedErrors.length, 1);
assert.equal(calls.length, 3);

console.log('noShowCronRpcEconomyExecution.test.ts: ok');
