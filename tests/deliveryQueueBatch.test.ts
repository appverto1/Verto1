import assert from 'node:assert/strict';
import { dispatchDueDeliveryQueues } from '../services/deliveryQueueBatch.ts';

const logs: Array<{ level: string; value: string }> = [];
const logger = {
  warn: (message: string) => { logs.push({ level: 'warn', value: message }); },
  error: (message: string) => { logs.push({ level: 'error', value: message }); },
};
type Response = { data: any; error: any };
const run = async (response: Response | Error) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const notifications: Array<any[] | undefined> = [];
  const announcements: Array<any[] | undefined> = [];
  const status = await dispatchDueDeliveryQueues({
    supabase: { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (response instanceof Error) throw response;
      return response;
    }},
    deploymentEnv: 'staging',
    workerId: 'owner-1',
    trigger: 'test',
    logger,
    processNotificationJobs: async (rows) => { notifications.push(rows); },
    processClinicAnnouncements: async (rows) => { announcements.push(rows); },
  });
  return { calls, notifications, announcements, status };
};

// Empty minute: 1 request, no work lost, both queues acknowledged.
const empty = await run({ data: { notification_jobs: [], clinic_announcements: [] }, error: null });
assert.equal(empty.calls.length, 1);
assert.equal(empty.calls[0].name, 'claim_due_delivery_queues_v1');
assert.deepEqual(empty.calls[0].args, {
  p_deployment_env: 'staging', p_worker: 'owner-1',
  p_notification_limit: 100, p_announcement_limit: 20,
});
assert.deepEqual(empty.notifications, [[]]);
assert.deepEqual(empty.announcements, [[]]);
assert.equal(empty.status.batched, true);

// One queue failure must not prevent the other queue from being dispatched.
// Both handlers must begin concurrently rather than delaying notices while
// reminder push sends finish.
const starts: string[] = [];
let resolveNotifications!: () => void;
const notificationsGate = new Promise<void>((resolve) => { resolveNotifications = resolve; });
const raced = dispatchDueDeliveryQueues({
  supabase: { rpc: async () => ({
    data: { notification_jobs: [{ id: 'job-1' }], clinic_announcements: [{ announcement_id: 'announcement-1' }] },
    error: null,
  }) },
  deploymentEnv: 'production',
  workerId: 'owner-2',
  trigger: 'test',
  logger,
  processNotificationJobs: async (rows) => {
    starts.push('notifications:' + rows?.length);
    await notificationsGate;
    throw new Error('simulated delivery exception');
  },
  processClinicAnnouncements: async (rows) => { starts.push('announcements:' + rows?.length); },
});
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(starts, ['notifications:1', 'announcements:1']);
resolveNotifications();
const racedStatus = await raced;
assert.equal(racedStatus.failed, true);
assert.equal(racedStatus.notificationCount, 1);
assert.equal(racedStatus.announcementCount, 1);
assert.ok(logs.some((item) => item.value.includes('Fila reclamada falhou')));

// Migration not yet present: only the known missing-RPC codes can activate
// legacy claims, preserving reminders and scheduled notices during rollouts.
for (const code of ['PGRST202', '42883']) {
  const legacy = await run({ data: null, error: { code } });
  assert.equal(legacy.status.batched, false);
  assert.equal(legacy.status.failed, false);
  assert.deepEqual(legacy.notifications, [undefined]);
  assert.deepEqual(legacy.announcements, [undefined]);
}

// Auth, tenant mismatch, transport errors and malformed responses fail closed.
for (const code of ['42501', 'P0001', 'PGRST301']) {
  const denied = await run({ data: null, error: { code } });
  assert.equal(denied.status.skipped, true);
  assert.deepEqual(denied.notifications, []);
  assert.deepEqual(denied.announcements, []);
}
const network = await run(new Error('network unavailable'));
assert.equal(network.status.skipped, true);
const bad = await run({ data: { notification_jobs: [] }, error: null });
assert.equal(bad.status.skipped, true);
assert.deepEqual(bad.notifications, []);
assert.deepEqual(bad.announcements, []);

console.log('deliveryQueueBatch.test.ts: ok');
