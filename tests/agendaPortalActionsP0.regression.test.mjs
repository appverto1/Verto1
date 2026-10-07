import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const availability = fs.readFileSync('src/services/portalRescheduleAvailability.ts', 'utf8');
const cron = fs.readFileSync('services/cronService.ts', 'utf8');
const rescheduleSql = fs.readFileSync('supabase/migrations/20260719153000_atomic_appointment_reschedule_approval.sql', 'utf8');

// Confirmation: transient infrastructure failures are retryable and never expose raw DB errors.
const confirmStart = server.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'");
const confirmEnd = server.indexOf("app.get('/api/portal/appointments/:appointmentId/reschedule-slots'", confirmStart);
const confirm = server.slice(confirmStart, confirmEnd);
assert.ok(confirmStart > 0 && confirmEnd > confirmStart);
assert.match(confirm, /APPOINTMENT_CONFIRMATION_TEMPORARILY_UNAVAILABLE/);
assert.match(confirm, /retryable:\s*true/);
assert.match(confirm, /res\.status\(503\)/);
assert.match(confirm, /return res\.status\(500\)\.json\(portalSafeError\(500\)\)/);

// The three options can come from different weeks; each exact date is revalidated.
const validateStart = server.indexOf('const resolveValidPortalRescheduleOptions = async');
const validateEnd = server.indexOf('const notifyPortalRescheduleApproval = async', validateStart);
const validate = server.slice(validateStart, validateEnd);
assert.match(validate, /selectedOptions\.slice\(0, PORTAL_RESCHEDULE_MAX_OPTIONS\)/);
assert.match(validate, /formatDateInAppointmentTimezone\(selectedStartDate\)/);
assert.match(validate, /dateFrom:\s*selectedDate/);
assert.match(validate, /maxDays:\s*1/);
assert.match(validate, /availabilityByDate/);

// Cancelled/no-show/deleted appointments never block suggested availability.
assert.match(availability, /statusBlocksAvailability/);
assert.match(availability, /cancel\|desmarc\|no_show\|missed\|deleted\|archived\|rejected\|recus\|invalid/);
assert.match(availability, /if \(!statusBlocksAvailability\(appointment\.status\)\) return false/);

// Approval of a reschedule invalidates the old 24h/12h reminder markers.
assert.match(rescheduleSql, /notification_24h_sent_at\s*=\s*null/);
assert.match(rescheduleSql, /notification_12h_sent_at\s*=\s*null/);
assert.match(rescheduleSql, /notification_12h_sent\s*=\s*false/);

// Cron has schedule-cycle dedupe and never sends stale 24h after a delivered 12h.
assert.match(cron, /const key = `\$\{appointment\.appointmentId\}:\$\{appointment\.scheduledAt\}`/);
assert.match(cron, /step\.kind === '24h'[\s\S]*notification12SentAt/);
assert.match(cron, /recentlySentReminders/);

// Cancel requests use the same patient/guardian scoped appointment resolver as confirm/reschedule.
const cancelStart = server.indexOf("app.post('/api/portal/appointments/:appointmentId/request-cancel'");
const cancelEnd = server.indexOf("app.post('/api/portal/sessions/:sessionId/sign'", cancelStart);
const cancel = server.slice(cancelStart, cancelEnd);
assert.match(cancel, /fetchPortalAppointmentForUser\(req\.params\.appointmentId, req\.session\.user\)/);
assert.match(cancel, /requirePatientPortalModule\('appointments_communication'\)/);

console.log('agendaPortalActionsP0.regression.test.mjs: ok');
