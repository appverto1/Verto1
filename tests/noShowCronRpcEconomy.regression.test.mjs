import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('services/appointmentNoShowService.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260807010000_session_completion_and_no_show_policy.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const reminderCron = readFileSync('services/cronService.ts', 'utf8');
const announcementCron = readFileSync('services/clinicAnnouncementCronService.ts', 'utf8');

// No-show is classified atomically in the service-role database transaction.
// The SKIP LOCKED selection prevents duplicate writes under parallel workers.
const classifyStart = migration.indexOf('create or replace function public.classify_overdue_appointments_no_show_v1(');
const classifyEnd = migration.indexOf('revoke all on function public.classify_overdue_appointments_no_show_v1', classifyStart);
assert.ok(classifyStart >= 0 && classifyEnd > classifyStart, 'no-show RPC must exist');
const rpc = migration.slice(classifyStart, classifyEnd);
assert.match(rpc, /auth\.role\(\)[\s\S]*'service_role'/i);
assert.match(rpc, /for update of appointment skip locked/i);
assert.match(rpc, /no_show_classified_at is null/i);
assert.match(rpc, /no_show_review_required_at is null/i);
assert.match(rpc, /insert into public\.appointment_attendance_audit_events/i);
assert.match(rpc, /where id = v_row\.id/i);

// Preserve minute-accurate classification and callbacks; remove only the redundant
// acquisition and release of a separate distributed job lease (two RPC calls/minute).
assert.match(service, /rpc\('classify_overdue_appointments_no_show_v1'/);
assert.match(service, /p_limit: 250/);
assert.match(service, /cron\.schedule\([\s\S]*?'\* \* \* \* \*'/);
assert.match(service, /onAppointmentsClassified\(classified\)/);
assert.match(service, /if \(!options \|\| running\)/);
assert.match(service, /finally \{\s*running = false;/);
assert.doesNotMatch(service, /runtime_try_acquire_job_lease_v1|runtime_release_job_lease_v1|tryAcquireDistributedJobLease|releaseDistributedJobLease/);
assert.match(server, /startAppointmentNoShowCron\(\{/);

// Appointment reminders and clinic announcements retain one-minute queues and
// are independent of the no-show optimization.
assert.match(reminderCron, /claim_due_notification_jobs_v1/);
assert.match(reminderCron, /cron\.schedule\('\* \* \* \* \*'/);
assert.match(announcementCron, /claim_due_clinic_announcements_v1/);
assert.match(announcementCron, /cron\.schedule\([\s\S]*?'\* \* \* \* \*'/);
console.log('noShowCronRpcEconomy.regression.test.mjs: ok');
