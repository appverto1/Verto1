import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dayjs from 'dayjs';
import { chooseDueReminder, isActiveAppointmentStatus } from '../services/cronService';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const cron = read('services/cronService.ts');
const pushService = read('services/pushNotificationService.ts');
const server = read('server.ts');
const migration = read('supabase/migrations/20260611143000_portal_notifications.sql');

assert.match(migration, /create table if not exists public\.portal_notifications/);
assert.match(migration, /idempotency_key text not null/);
assert.match(migration, /create unique index if not exists portal_notifications_idempotency_key_uidx/);
assert.match(migration, /recipient_user_id = auth\.uid\(\)/);
assert.match(migration, /revoke insert, delete, update on table public\.portal_notifications from anon, authenticated/);
assert.match(migration, /grant update \(read_at, acknowledged_at, updated_at\)/);
assert.match(cron, /appointmentId\}:appointment:\$\{recipientKey\}/);
assert.match(cron, /type: 'appointment_reminder'/);
assert.match(cron, /\.eq\('appointment_id', params\.appointment\.appointmentId\)/);
assert.match(cron, /\.in\('type', \['appointment_reminder', 'appointment_reminder_24h', 'appointment_reminder_12h'\]\)/);
assert.match(cron, /if \(existingResult\.data\.acknowledged_at\) return false/);
assert.match(cron, /\.update\(updatePayload\)/);
assert.doesNotMatch(cron, /if \(!had24h\)/);
assert.match(cron, /if \(hasPatientResponse\)/);
assert.match(cron, /persistPortalReminder/);
assert.match(cron, /if \(result\.sent > 0\)/);
assert.doesNotMatch(cron, /persisted \|\| result\.sent > 0/);
assert.match(cron, /\.select\('id, clinic_id, patient_id, scheduled_at, status, patient_response, notification_24h_sent_at, notification_12h_sent_at, is_active, deleted_at'\)/);
assert.doesNotMatch(cron, /patient_confirmation_status, notification_24h_sent_at/);
assert.match(cron, /hydrateReminderAppointmentPatients/);
assert.match(cron, /\.select\('id,name,email,clinic_id,responsible_user_id,is_active,deleted_at'\)/);
assert.match(pushService, /\.in\(column, values\)/);
assert.doesNotMatch(pushService, /\.limit\(5000\)/);
assert.match(pushService, /allowCrossClinicEmailFallback:\s*false/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /actions:\s*\[/);
assert.match(read('src/services/notificationBranding.ts'), /const clinicLogoUrl = firstUrl\(input\.branding\.logoUrl\) \|\| null/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /DEFAULT_VERTO_LOGO/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /image:\s*input\.branding\.logoUrl/);
assert.doesNotMatch(read('public/sw.js'), /actions,/);
assert.doesNotMatch(read('public/sw.js'), /notification_action/);
assert.match(server, /POST|post\('\/api\/internal\/notifications\/run-appointment-reminders/);
assert.match(server, /APPOINTMENT_REMINDER_CRON_SECRET/);
assert.match(server, /crypto\.timingSafeEqual/);
assert.match(server, /appointmentReminderCronLimiter/);
assert.doesNotMatch(cron, /\.select\(\s*['"`]\*['"`]\s*\)/);
assert.doesNotMatch(server, /\.select\(\s*['"`]\*['"`]\s*\)/);

assert.equal(isActiveAppointmentStatus('confirmed'), true);
assert.equal(isActiveAppointmentStatus('RESCHEDULED'), false);
assert.equal(isActiveAppointmentStatus('deleted'), false);

const reminderAppointment = {
  appointmentId: 'appointment-1',
  patientId: 'patient-1',
  scheduledAt: '2026-07-15T19:00:00.000Z',
  status: 'confirmed',
  patientResponse: null,
  patientConfirmationStatus: null,
  notification24SentAt: null,
  notification12SentAt: null,
  legacyNotification24Sent: false,
  legacyNotification12Sent: false,
  hasAppointmentsTableSource: true,
  hasClinicStateSource: false,
};

assert.equal(
  chooseDueReminder(
    reminderAppointment as any,
    dayjs('2026-07-14T18:59:00.000Z'),
    dayjs('2026-07-14T19:01:00.000Z'),
  )?.kind,
  '24h',
);
assert.equal(
  chooseDueReminder(
    reminderAppointment as any,
    dayjs('2026-07-15T06:59:00.000Z'),
    dayjs('2026-07-15T07:01:00.000Z'),
  )?.kind,
  '12h',
);
assert.equal(
  chooseDueReminder(
    { ...reminderAppointment, patientResponse: 'confirmed' } as any,
    dayjs('2026-07-15T06:59:00.000Z'),
    dayjs('2026-07-15T07:01:00.000Z'),
  ),
  null,
);

console.log('appointment notification persistence checks passed');
