import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20261021123000_batched_delivery_queue_claims.sql');
const cron = read('services/cronService.ts');
const announcements = read('services/clinicAnnouncementCronService.ts');
const mode = read('services/backgroundWorkerMode.ts');
const baseMigration = read('supabase/migrations/20260902170000_notification_environment_isolation.sql');
const batch = read('services/deliveryQueueBatch.ts');

// SQL contains no new tables, triggers, polling or storage; old claims retain
// their original tenant checks, SKIP LOCKED claims and recovery windows.
assert.match(migration, /^begin;$/mi);
assert.match(migration, /^commit;\s*$/mi);
assert.match(migration, /create or replace function public\.claim_due_delivery_queues_v1/i);
assert.match(migration, /security definer\s*set search_path = pg_catalog, public/i);
assert.match(migration, /auth\.role\(\)[\s\S]*'service_role'/i);
assert.match(migration, /verto_require_notification_deployment_env_v1\(p_deployment_env\)/i);
assert.match(migration, /from public\.claim_due_notification_jobs_v1\(/i);
assert.match(migration, /from public\.claim_due_clinic_announcements_v1\(/i);
assert.match(migration, /greatest\(1, least\(coalesce\(p_notification_limit, 100\), 500\)\)/i);
assert.match(migration, /greatest\(1, least\(coalesce\(p_announcement_limit, 20\), 100\)\)/i);
assert.match(migration, /revoke all on function public\.claim_due_delivery_queues_v1\(text,text,integer,integer\)\s*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.claim_due_delivery_queues_v1\(text,text,integer,integer\)\s*to service_role/i);
assert.doesNotMatch(migration, /create table|create trigger|drop table|delete from/i);
assert.match(baseMigration, /claim_due_notification_jobs_v1[\s\S]*for update skip locked/i);
assert.match(baseMigration, /claim_due_clinic_announcements_v1[\s\S]*for update skip locked/i);

// One cron per minute preserves due-time precision; both pipelines receive
// only preclaimed rows and retain their direct/manual fallback RPCs.
assert.equal((cron.match(/cron\.schedule\(/g) || []).length, 1);
assert.doesNotMatch(announcements, /cron\.schedule\(/);
assert.match(cron, /cron\.schedule\('\* \* \* \* \*'/);
assert.match(cron, /runUnifiedDeliveryQueueScan\('notification_jobs_cron_1_minute'\)/);
assert.match(cron, /runUnifiedDeliveryQueueScan\('notification_jobs_startup'\)/);
assert.match(cron, /runNotificationJobQueue\(options, trigger, rows\)/);
assert.match(cron, /clinicAnnouncementService\.runClinicAnnouncementDispatchScan\(trigger, rows\)/);
assert.match(cron, /matchesVertoDeploymentEnvironment\(job\?\.deployment_env, options\.deploymentEnv\)/);
assert.match(cron, /runNotificationJobQueue\(activeOptions, trigger\)/);
assert.match(announcements, /preclaimedRows === undefined[\s\S]*claim_due_clinic_announcements_v1/);
assert.match(cron, /preclaimedRows === undefined[\s\S]*claim_due_notification_jobs_v1/);
assert.match(announcements, /await previousScan/, 'already claimed notices must wait for the previous delivery batch');
assert.match(announcements, /clinicAnnouncementScanTail = new Promise<void>/, 'preclaimed batches must be serialized');
assert.match(announcements, /dispatchClinicAnnouncementById/);
assert.match(cron, /finalize_notification_jobs_v1/);
assert.match(cron, /upsert_portal_notifications_batch_v1/);
assert.match(cron, /mark_sent_appointment_notification_jobs_v1/);
assert.match(mode, /'verto-notification-jobs'/);
assert.doesNotMatch(mode, /'verto-clinic-announcements'/);
assert.match(batch, /code !== 'PGRST202' && code !== '42883'/);
assert.match(batch, /Promise\.allSettled/);
assert.match(batch, /logger\.error/);

console.log('deliveryQueueBatch.regression.test.mjs: ok');
