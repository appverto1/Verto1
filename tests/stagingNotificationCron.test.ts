import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runStagingNotificationQueuesOnce } from '../services/cronService';

const workerSource = fs.readFileSync(new URL('../scripts/staging-notification-drain-once.ts', import.meta.url), 'utf8');
assert.match(workerSource, /STAGING_NOTIFICATION_CRON_ENVIRONMENT_GUARD/);
assert.match(workerSource, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(workerSource, /global:\s*\{\s*headers:\s*\{\s*'x-verto-deployment-env':\s*'staging'\s*\}\s*\}/);
assert.match(workerSource, /STAGING_NOTIFICATION_CRON_CREDENTIALS_REQUIRED/);
assert.doesNotMatch(workerSource, /server\.listen\(/);
assert.doesNotMatch(workerSource, /startAppointmentReminderCron\(/);

let claims = 0;
const fakeSupabase = {
  rpc: async (name: string, args: any) => {
    assert.equal(name, 'claim_due_delivery_queues_v1');
    assert.equal(args.p_deployment_env, 'staging');
    claims += 1;
    return {
      data: { notification_jobs: [], clinic_announcements: [] },
      error: null,
    };
  },
};
const logger = { log: () => {}, warn: () => {}, error: () => {} };
await assert.rejects(
  () => runStagingNotificationQueuesOnce({ supabase: fakeSupabase, deploymentEnv: 'production', logger }),
  /STAGING_NOTIFICATION_CRON_PRODUCTION_FORBIDDEN/,
);
await assert.rejects(
  () => runStagingNotificationQueuesOnce({ supabase: null, deploymentEnv: 'staging', logger }),
  /STAGING_NOTIFICATION_CRON_SUPABASE_REQUIRED/,
);
assert.equal(claims, 0, 'no production or unauthenticated queue claims');
const result = await runStagingNotificationQueuesOnce({
  supabase: fakeSupabase,
  deploymentEnv: 'staging',
  runtimeOwnerId: 'test-staging-cron',
  logger,
});
assert.equal(claims, 1, 'exactly one atomic queue claim per Cron invocation');
assert.equal(result?.batched, true);
assert.equal(result?.failed, false);
assert.equal(result?.notificationCount, 0);
assert.equal(result?.announcementCount, 0);
console.log('PASS: staging one-shot notification worker is isolated, idempotent and finite');
