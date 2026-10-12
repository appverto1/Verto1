import assert from 'node:assert/strict';
import fs from 'node:fs';

const agenda = fs.readFileSync('src/components/Calendar.tsx', 'utf8');
const cron = fs.readFileSync('services/clinicAnnouncementCronService.ts', 'utf8');
const delivery = fs.readFileSync('services/clinicAnnouncementDelivery.ts', 'utf8');
const reminderCron = fs.readFileSync('services/cronService.ts', 'utf8');
const auth = fs.readFileSync('src/constants/authorizationModel.ts', 'utf8');

// Professionals' local clinic state must never override the server's scoped
// appointment list. Admin/coordinator merge behavior remains unchanged.
assert.match(agenda, /const isTherapistActor = String\(currentUser\?\.role \|\| ''\).*=== 'therapist'/);
assert.match(agenda, /const localEvents = useMemo\(\(\) => \(isTherapistActor \? \[\] : agenda \|\| \[\]\)/);
assert.match(agenda, /isTherapistActor \? \(remoteState\.loaded \? serverEvents : \[\]\) : mergeCalendarEventsForRender/);
assert.match(agenda, /if \(result\?\.error === 'CALENDAR_SCOPE_DENIED' \|\| result\?\.error === 'CLINIC_SCOPE_DENIED'\)/);
assert.match(agenda, /setSelectedEvent\(null\);[\s\S]*setRemoteRefreshNonce\(\(value\) => value \+ 1\)/);

// A clinic without insurance/TISS must not fetch prohibited closure details.
assert.match(agenda, /if \(canUseTissBilling\) \{\s*dataService\.getClosureAppointmentDetail\(normalized\.id\)/);
assert.match(agenda, /if \(!appointmentId \|\| !canUseTissBilling\) return;/);
assert.match(agenda, /if \(canUseTissBilling\) \{\s*dataService\.getClosureAppointmentDetail\(appointmentId\)/);
assert.match(agenda, /\{canUseTissBilling && !detailCancellationState\.isCancelled && \(/);
assert.match(auth, /therapist: internal\([\s\S]*?'calendar\.own\.view'/);
assert.doesNotMatch(auth.slice(auth.indexOf('therapist: internal('), auth.indexOf('receptionist: internal(')), /'calendar\.clinic\.view'/);

// Patient appointment reminders already use the durable queue with tenancy,
// DB claims and atomic markers. The hotfix must not replace that pipeline.
assert.match(reminderCron, /claim_due_notification_jobs_v1/);
assert.match(reminderCron, /mark_sent_appointment_notification_jobs_v1/);
assert.match(reminderCron, /validateClaimedAppointmentReminder\(job, appointment, patient/);
assert.match(reminderCron, /onConflict: 'deployment_env,idempotency_key'/);

// Retries of a partially delivered clinic announcement cannot deliver push
// again to a recipient whose previous push_status was SENT.
assert.match(delivery, /pushStatus: sanitizeText\(row\?\.push_status, 30\)\.toUpperCase\(\)/);
assert.match(delivery, /pendingPushRecipients = recipients\.filter\(\(recipient: any\) => recipient\.pushStatus !== 'SENT'\)/);
assert.match(delivery, /recipients: pendingPushRecipients\.map/);
assert.match(delivery, /for \(const recipient of pendingPushRecipients\)/);
assert.match(delivery, /let pushSentCount = previouslySentPushCount/);
assert.match(delivery, /materialize_clinic_announcement_portal_notifications_v1/);
assert.match(cron, /claim_due_clinic_announcements_v1/);

console.log('therapistCalendarScopeAndAnnouncements.regression.test.mjs: ok');
