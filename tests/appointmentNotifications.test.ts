import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const cron = read('services/cronService.ts');
const server = read('server.ts');
const migration = read('supabase/migrations/20260611143000_portal_notifications.sql');

assert.match(migration, /create table if not exists public\.portal_notifications/);
assert.match(migration, /idempotency_key text not null/);
assert.match(migration, /create unique index if not exists portal_notifications_idempotency_key_uidx/);
assert.match(migration, /recipient_user_id = auth\.uid\(\)/);
assert.match(migration, /revoke insert, delete, update on table public\.portal_notifications from anon, authenticated/);
assert.match(migration, /grant update \(read_at, acknowledged_at, updated_at\)/);
assert.match(cron, /appointmentId\}:\$\{params\.kind\}:\$\{recipientKey\}/);
assert.match(cron, /if \(!had24h\)/);
assert.match(cron, /if \(hasPatientResponse\)/);
assert.match(cron, /persistPortalReminder/);
assert.match(cron, /persisted \|\| result\.sent > 0/);
assert.match(server, /POST|post\('\/api\/internal\/notifications\/run-appointment-reminders/);
assert.match(server, /APPOINTMENT_REMINDER_CRON_SECRET/);
assert.match(server, /crypto\.timingSafeEqual/);
assert.match(server, /appointmentReminderCronLimiter/);
assert.doesNotMatch(cron, /\.select\(\s*['"`]\*['"`]\s*\)/);
assert.doesNotMatch(server, /\.select\(\s*['"`]\*['"`]\s*\)/);

console.log('appointment notification persistence checks passed');
