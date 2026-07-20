import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dayjs from 'dayjs';
import {
  approvedRescheduleMatchesAppointment,
  buildPortalReminderIdempotencyKey,
  chooseDueReminder,
  extractReminderClinicLogoStoragePath,
  extractReminderMissingColumnName,
  isActiveAppointmentStatus,
  reminderDedupeKey,
} from '../services/cronService';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const cron = read('services/cronService.ts');
const pushService = read('services/pushNotificationService.ts');
const server = read('server.ts');
const migration = read('supabase/migrations/20260611143000_portal_notifications.sql');
const atomicRescheduleMigration = read('supabase/migrations/20260719153000_atomic_appointment_reschedule_approval.sql');

assert.match(migration, /create table if not exists public\.portal_notifications/);
assert.match(migration, /idempotency_key text not null/);
assert.match(migration, /create unique index if not exists portal_notifications_idempotency_key_uidx/);
assert.match(migration, /recipient_user_id = auth\.uid\(\)/);
assert.match(migration, /revoke insert, delete, update on table public\.portal_notifications from anon, authenticated/);
assert.match(migration, /grant update \(read_at, acknowledged_at, updated_at\)/);
assert.match(cron, /buildPortalReminderIdempotencyKey\(params\.appointment, recipientKey\)/);
assert.match(cron, /\.eq\('idempotency_key', idempotencyKey\)/);
assert.match(cron, /const sameScheduleCycle =/);
assert.match(cron, /sameScheduleCycle \? incoming\.notification24SentAt : null/);
assert.match(cron, /sameScheduleCycle && incoming\.legacyNotification24Sent/);
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
assert.match(cron, /reconcileApprovedReschedulesForReminders/);
assert.match(cron, /\.in\('appointment_id', candidateIds\)/);
assert.match(cron, /metadata\?\.approvedStart/);
assert.match(cron, /approvedRescheduleMatchesAppointment/);
assert.match(cron, /\.update\(\{ status: 'scheduled', updated_at: repairedAt \}\)[\s\S]*?\.select\('id'\)/);
assert.match(cron, /isApprovedReschedule \? 'scheduled'/);
assert.match(pushService, /\.in\(column, values\)/);
assert.doesNotMatch(pushService, /\.limit\(5000\)/);
assert.match(pushService, /allowCrossClinicEmailFallback:\s*false/);
assert.match(cron, /createSignedUrl\(storagePath, CLINIC_LOGO_SIGNED_URL_TTL_SECONDS\)/);
assert.match(cron, /extractReminderMissingColumnName\(profileBranding\.error\) === 'clinic_id'/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /actions:\s*\[/);
assert.match(read('src/services/notificationBranding.ts'), /const clinicLogoUrl = firstUrl\(input\.branding\.logoUrl\) \|\| null/);
assert.match(read('src/services/notificationBranding.ts'), /badge: VERTO_NOTIFICATION_BADGE_URL/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /DEFAULT_VERTO_LOGO/);
assert.doesNotMatch(read('src/services/notificationBranding.ts'), /image:\s*input\.branding\.logoUrl/);
assert.doesNotMatch(read('public/sw.js'), /actions,/);
assert.doesNotMatch(read('public/sw.js'), /notification_action/);
assert.match(read('public/sw.js'), /const VERTO_NOTIFICATION_ICON = "\/branding\/verto\/verto-icon-192\.png\?v=20260716-3"/);
assert.match(read('public/sw.js'), /const VERTO_NOTIFICATION_BADGE = "\/branding\/verto\/verto-notification-badge\.png\?v=20260716-3"/);
assert.match(read('public/sw.js'), /const badgeUrl = asNotificationAssetUrl\(VERTO_NOTIFICATION_BADGE\)/);
assert.doesNotMatch(read('public/sw.js'), /const badgeUrl = asNotificationAssetUrl\(brandLogo/);
assert.match(read('public/sw.js'), /const SW_VERSION = "verto-branding-v14"/);
assert.match(read('public/sw.js'), /appointments-clinic-branding-v11/);
assert.match(read('public/sw.js'), /verto-branding-v12/);
assert.match(read('public/sw.js'), /verto-branding-v13/);
assert.match(server, /POST|post\('\/api\/internal\/notifications\/run-appointment-reminders/);
assert.match(server, /APPOINTMENT_REMINDER_CRON_SECRET/);
assert.match(server, /crypto\.timingSafeEqual/);
assert.match(server, /appointmentReminderCronLimiter/);
const approveRescheduleRoute = server.slice(
  server.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'"),
  server.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'")
);
assert.match(approveRescheduleRoute, /supabase\.rpc\('approve_appointment_reschedule'/);
assert.match(approveRescheduleRoute, /status:\s*'SCHEDULED'/);
assert.match(atomicRescheduleMigration, /set status = 'scheduled'/);
assert.match(atomicRescheduleMigration, /notification_24h_sent_at = null/);
assert.match(atomicRescheduleMigration, /notification_12h_sent_at = null/);
assert.match(atomicRescheduleMigration, /notification_sent_at = null/);
assert.match(approveRescheduleRoute, /triggerAppointmentReminderScan\('appointment_reschedule_approved'\)/);
assert.doesNotMatch(approveRescheduleRoute, /status:\s*'RESCHEDULED'/);

const portalNotificationsRoute = server.slice(
  server.indexOf("app.get('/api/portal/notifications'"),
  server.indexOf("app.get('/api/portal/appointments'", server.indexOf("app.get('/api/portal/notifications'")),
);
assert.match(portalNotificationsRoute, /readPortalPatientContexts\(notificationPatientIds\)/);
assert.match(portalNotificationsRoute, /patientNamesById\.get\(patientId\)/);
assert.match(portalNotificationsRoute, /Paciente não identificado/);
assert.doesNotMatch(portalNotificationsRoute, /\|\|\s*'Paciente';/);
assert.match(server, /\.from\('patients'\)[\s\S]*?\.in\('id', patientIds\)[\s\S]*?\.limit\(patientIds\.length\)/);
assert.doesNotMatch(cron, /\.select\(\s*['"`]\*['"`]\s*\)/);
assert.doesNotMatch(server, /\.select\(\s*['"`]\*['"`]\s*\)/);

assert.equal(isActiveAppointmentStatus('confirmed'), true);
assert.equal(isActiveAppointmentStatus('RESCHEDULED'), false);
assert.equal(isActiveAppointmentStatus('deleted'), false);
assert.equal(
  extractReminderMissingColumnName({ message: 'column professional_profiles.clinic_id does not exist' }),
  'clinic_id',
);
assert.equal(
  extractReminderClinicLogoStoragePath(
    '/api/storage/patient-photos/view?path=onboarding%2Fclinic-id%2Flogo%2Fbrand.webp',
  ),
  'onboarding/clinic-id/logo/brand.webp',
);

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

const rescheduledReminderAppointment = {
  ...reminderAppointment,
  scheduledAt: '2026-07-16T19:00:00.000Z',
  status: 'scheduled',
  notification24SentAt: null,
  notification12SentAt: null,
};

const persistedRescheduledAppointment = {
  id: '149c06e6-bdfc-42c6-8f63-971777f74c85',
  clinic_id: 'e2aa4494-d2da-4e1e-ae0d-2ea00af164d4',
  scheduled_at: '2026-07-16T19:00:00.000Z',
  status: 'RESCHEDULED',
};
const approvedRescheduleRequest = {
  appointment_id: persistedRescheduledAppointment.id,
  organization_id: persistedRescheduledAppointment.clinic_id,
  request_type: 'RESCHEDULE',
  status: 'APPROVED',
  metadata: { approvedStart: persistedRescheduledAppointment.scheduled_at },
};

assert.equal(
  approvedRescheduleMatchesAppointment(approvedRescheduleRequest, persistedRescheduledAppointment),
  true,
);
assert.equal(
  approvedRescheduleMatchesAppointment(
    { ...approvedRescheduleRequest, organization_id: '681c89af-5ee6-4f4e-93a0-99c68f1e3576' },
    persistedRescheduledAppointment,
  ),
  false,
);
assert.equal(
  approvedRescheduleMatchesAppointment(
    { ...approvedRescheduleRequest, metadata: { approvedStart: '2026-07-16T20:00:00.000Z' } },
    persistedRescheduledAppointment,
  ),
  false,
);

assert.notEqual(
  reminderDedupeKey(reminderAppointment as any, '24h'),
  reminderDedupeKey(rescheduledReminderAppointment as any, '24h'),
);
assert.notEqual(
  buildPortalReminderIdempotencyKey(reminderAppointment as any, 'patient-1'),
  buildPortalReminderIdempotencyKey(rescheduledReminderAppointment as any, 'patient-1'),
);

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
assert.equal(
  chooseDueReminder(
    rescheduledReminderAppointment as any,
    dayjs('2026-07-15T18:59:00.000Z'),
    dayjs('2026-07-15T19:01:00.000Z'),
  )?.kind,
  '24h',
);
assert.equal(
  chooseDueReminder(
    { ...rescheduledReminderAppointment, notification24SentAt: '2026-07-15T19:00:00.000Z' } as any,
    dayjs('2026-07-16T06:59:00.000Z'),
    dayjs('2026-07-16T07:01:00.000Z'),
  )?.kind,
  '12h',
);

console.log('appointment notification persistence checks passed');
