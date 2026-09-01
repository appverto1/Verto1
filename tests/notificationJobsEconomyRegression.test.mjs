import assert from 'node:assert/strict';
import fs from 'node:fs';

const cron = fs.readFileSync(new URL('../services/cronService.ts', import.meta.url), 'utf8');
const push = fs.readFileSync(new URL('../services/pushNotificationService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828010000_portal_interaction_notification_jobs_v1.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.notification_jobs/);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /STALE_CLAIM_RECOVERED/);
assert.match(migration, /sync_appointment_notification_jobs_v1/);
assert.match(migration, /sync_assigned_task_notification_jobs_v1/);
assert.match(migration, /verto_daily_notification_next_due_v1/);
assert.match(migration, /verto_notification_clinic_timezone_v1/, 'notification quiet-hours must honor the clinic canonical timezone');
assert.match(migration, /if v_active and v_daily and new\.patient_id is not null then/);
assert.match(migration, /revoke all on function public\.sync_appointment_notification_jobs_v1\(\) from public, anon, authenticated/);
assert.match(migration, /revoke all on function public\.sync_assigned_task_notification_jobs_v1\(\) from public, anon, authenticated/);
assert.match(migration, /upsert_portal_notifications_batch_v1/);
assert.match(migration, /recipient_user_id uuid, recipient_email text/);
assert.match(migration, /appointment_id uuid/);
assert.match(migration, /verto_daily_notification_next_due_v1\(j\.scheduled_for,now\(\),public\.verto_notification_clinic_timezone_v1\(j\.clinic_id\)\)/, 'recurring task reminders must preserve clinic-local cadence without drift');
assert.match(migration, /create_patient_portal_history_entry_v1/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /FAMILY_DAILY_PHOTO_LIMIT/);
assert.match(migration, /complete_patient_assigned_task_v1/);
assert.match(migration, /ASSIGNED_TASK_SCOPE_CHANGED/);
assert.match(migration, /ASSIGNED_TASK_PATIENT_CLINIC_SCOPE_INVALID/);
assert.match(migration, /notification_jobs\.status='SENT'/, 'same appointment reminder key must not be rearmed after SENT');
assert.match(migration, /drop function if exists public\.verto_notification_delivery_due_v1\(timestamptz,integer\)/, 'draft helper signature must be cleaned up idempotently');
assert.match(migration, /drop function if exists public\.complete_patient_assigned_task_v1\(uuid,uuid,integer,text,text,text,timestamptz,uuid,text\)/, 'draft task-completion RPC signature must not remain callable');
assert.match(migration, /v_quota_date := \(now\(\) at time zone v_timezone\)::date/, 'photo quota day must be derived inside PostgreSQL from the clinic timezone');
assert.match(migration, /\(h\.created_at at time zone v_timezone\)::date=v_quota_date/, 'photo quota must count server-side insertion timestamps, never client-controlled clinical dates');
assert.doesNotMatch(migration, /p\.organization_id/);

assert.match(cron, /runNotificationJobQueue/);
assert.match(cron, /claim_due_notification_jobs_v1/);
assert.match(cron, /upsert_portal_notifications_batch_v1/);
assert.match(cron, /finalize_notification_jobs_v1/);
assert.match(cron, /const chunkSize = 8/);
assert.match(cron, /const clinicBrandingById = new Map/, 'branding reads must be deduplicated by clinic inside each claimed batch');
assert.match(cron, /const clinicIdsForBatch = Array\.from\(new Set/, 'notification jobs must reuse one branding read per clinic');
assert.match(cron, /Appointment\/task DB triggers already schedule precise notification_jobs/);
const triggerBlock = cron.slice(cron.indexOf('export function triggerAppointmentReminderScan'), cron.indexOf('export async function runAppointmentReminderScan'));
assert.doesNotMatch(triggerBlock, /runAppointmentReminderJob|get_legacy_due_appointments_v1|clinic_state/);

assert.match(push, /const patientRowIndex = indexRows/);
assert.match(push, /const userRowIndex = indexRows/);
assert.match(push, /const emailRowIndex = indexRows/);

console.log('notificationJobsEconomyRegression: PASS');
