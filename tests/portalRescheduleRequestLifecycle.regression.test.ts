import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PORTAL_RESCHEDULE_MAX_OPTIONS,
  normalizeRescheduleOptions,
} from '../src/services/portalRescheduleAvailability';

// Runtime regression: the legacy server.ts validator uses an unqualified
// PORTAL_RESCHEDULE_MAX_OPTIONS. This must resolve before the Express route
// handles a three-slot request; otherwise a ReferenceError becomes HTTP 500.
assert.equal(PORTAL_RESCHEDULE_MAX_OPTIONS, 3);
assert.equal(globalThis.PORTAL_RESCHEDULE_MAX_OPTIONS, 3);
assert.equal(PORTAL_RESCHEDULE_MAX_OPTIONS, globalThis.PORTAL_RESCHEDULE_MAX_OPTIONS);

const slots = [0, 1, 2, 3].map((i) => {
  const start = new Date(Date.parse('2026-10-20T11:50:00.000Z') + i * 86_400_000);
  return {
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 50 * 60_000).toISOString(),
  };
});
const normalized = normalizeRescheduleOptions(slots);
assert.equal(normalized.length, 3, 'at most three slot suggestions');
assert.deepEqual(normalized.map((item) => item.scheduledStart), slots.slice(0, 3).map((item) => item.scheduledStart));
assert.equal(normalizeRescheduleOptions(slots.slice(0, 3)).length, 3, 'three suggestions are preserved');
assert.equal(normalizeRescheduleOptions([slots[0], slots[0], slots[1]]).length, 2, 'duplicates ignored');
assert.equal(normalizeRescheduleOptions([]).length, 0, 'empty request produces no suggestions');

const server = readFileSync('server.ts', 'utf8');
const availability = readFileSync('src/services/portalRescheduleAvailability.ts', 'utf8');
const sql = readFileSync('supabase/migrations/20260828010000_portal_interaction_notification_jobs_v1.sql', 'utf8');
const markerGuard = readFileSync('supabase/migrations/20261008194000_claimed_reminder_marker_guard_v1.sql', 'utf8');
const cron = readFileSync('services/cronService.ts', 'utf8');

assert.match(availability, /globalThis\.PORTAL_RESCHEDULE_MAX_OPTIONS\s*=\s*PORTAL_RESCHEDULE_MAX_OPTIONS/,
  'canonical runtime binding must match exported cap');

const start = server.indexOf("app.post('/api/portal/appointments/:appointmentId/request-reschedule'");
const end = server.indexOf("app.post('/api/portal/appointments/:appointmentId/request-cancel'", start);
assert.ok(start >= 0 && end > start, 'patient request route exists');
const request = server.slice(start, end);
assert.match(request, /checkAuth, requirePatientPortalModule\('appointments_communication'\)/);
assert.match(request, /fetchPortalAppointmentForUser\(req\.params\.appointmentId, req\.session\.user\)/);
assert.match(request, /readClinicPatientReschedulePolicy/);
assert.match(request, /resolveValidPortalRescheduleOptions/);
assert.match(request, /createOrUpdateAppointmentActionRequest/);
assert.match(request, /requestType: 'RESCHEDULE'/);
assert.match(request, /metadata: \{ rescheduleOptions: selectedOptions, reschedulePayloadVersion: 1 \}/);
assert.match(request, /requestedStart: primaryOption\?\.scheduledStart/);
assert.match(request, /patient_confirmation_status: 'RESCHEDULE_REQUESTED'/);

const validationStart = server.indexOf('const resolveValidPortalRescheduleOptions = async');
const validationEnd = server.indexOf('const notifyPortalRescheduleApproval = async', validationStart);
const validation = server.slice(validationStart, validationEnd);
assert.match(validation, /selectedOptions\.slice\(0, PORTAL_RESCHEDULE_MAX_OPTIONS\)/);
assert.match(validation, /dateFrom: selectedDate/);
assert.match(validation, /maxDays: 1/);
assert.match(validation, /availableSlots\.find/);

const approveStart = server.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'");
const approveEnd = server.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'", approveStart);
assert.ok(approveStart >= 0 && approveEnd > approveStart, 'clinic approval route exists');
const approve = server.slice(approveStart, approveEnd);
assert.match(approve, /requireClinicCapability\('calendar.requests.manage'\)/);
assert.match(approve, /parseSelectedRescheduleOptionIndex/);
assert.match(approve, /approvedAssignment\.approvalAllowed/);
assert.match(approve, /supabase\.rpc\('approve_appointment_reschedule_v2'/);
assert.match(approve, /acknowledgeStaleAppointmentReminderNotifications\(nextAppointment\)/);
assert.match(approve, /notifyPortalRescheduleApproval\(/);
assert.match(approve, /triggerAppointmentReminderScan\('appointment_reschedule_approved'\)/);

// The approval SQL (verified independently against Staging Supabase) sets the
// new appointment instant and clears both old delivery markers atomically.
const approvalSql = readFileSync('supabase/migrations/20260719153000_atomic_appointment_reschedule_approval.sql', 'utf8');
assert.match(approvalSql, /scheduled_at\s*=\s*p_scheduled_start/);
assert.match(approvalSql, /notification_24h_sent_at\s*=\s*null/);
assert.match(approvalSql, /notification_12h_sent_at\s*=\s*null/);

// The database trigger cancels stale jobs and queues each new schedule cycle;
// a scheduled worker actually dispatches them each minute (the manual trigger
// is deliberately a no-op, to avoid duplicated global scans).
assert.match(sql, /create trigger trg_appointments_notification_jobs_v1/);
assert.match(sql, /update public\.notification_jobs[\s\S]*set status='CANCELED'/);
assert.match(sql, /APPOINTMENT_REMINDER_24H/);
assert.match(sql, /APPOINTMENT_REMINDER_12H/);
assert.match(sql, /'appointment:'\|\|new\.id::text\|\|':24h:'/);
assert.match(sql, /'appointment:'\|\|new\.id::text\|\|':12h:'/);
assert.match(sql, /on conflict \(idempotency_key\) do update/);
assert.match(cron, /cron\.schedule\('\* \* \* \* \*'/);
assert.match(cron, /validateClaimedAppointmentReminder\(job, appointment, patient/);
assert.match(markerGuard, /a\.scheduled_at = nullif\(j\.payload->>'scheduledAt', ''\)::timestamptz/);

console.log('PASS: three portal reschedule slots, clinic approval and 24h/12h reminder lifecycle');
