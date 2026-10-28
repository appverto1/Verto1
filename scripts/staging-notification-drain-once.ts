/**
 * Railway Cron staging notification runner. One durable-queue claim and exit.
 * Never run against production and never start the HTTP API or a background timer.
 * Frequency: every five minutes on Railway Cron (UTC).
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { runStagingNotificationQueuesOnce } from '../services/cronService';

const deploymentEnv = String(process.env.VERTO_DEPLOYMENT_ENV || '').trim();
const workerGuard = String(process.env.VERTO_STAGING_NOTIFICATION_CRON_WORKER || '').trim();
if (deploymentEnv !== 'staging' || workerGuard !== 'enabled') {
  throw new Error('STAGING_NOTIFICATION_CRON_ENVIRONMENT_GUARD');
}
const url = String(process.env.SUPABASE_URL || '').trim();
const roleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url.startsWith('https://') || !roleKey) {
  throw new Error('STAGING_NOTIFICATION_CRON_CREDENTIALS_REQUIRED');
}

const supabase = createClient(url, roleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const result = await runStagingNotificationQueuesOnce({
  supabase,
  deploymentEnv: 'staging',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
  runtimeOwnerId: 'staging-railway-cron-' + crypto.randomUUID(),
  logger: console,
});
if (!result || result.failed) {
  console.error('[Staging Cron] Queue drain failed (durable jobs retained for retry).');
  process.exitCode = 1;
} else {
  console.log('[Staging Cron] One-shot delivery claim complete.', {
    notificationCount: result.notificationCount || 0,
    announcementCount: result.announcementCount || 0,
    skipped: result.skipped === true,
  });
}
