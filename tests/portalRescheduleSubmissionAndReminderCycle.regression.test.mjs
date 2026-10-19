import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boot = readFileSync('services/portalAppointmentReadHandlers.ts', 'utf8');
const slots = readFileSync('src/services/portalRescheduleAvailability.ts', 'utf8');
const actions = readFileSync('tests/agendaPortalActionsP0.regression.test.mjs', 'utf8');
const sql = readFileSync('supabase/migrations/20260719153000_atomic_appointment_reschedule_approval.sql', 'utf8');
const resolution = readFileSync('supabase/migrations/20260720143000_atomic_appointment_action_request_resolution.sql', 'utf8');
const cron = readFileSync('services/cronService.ts', 'utf8');
const guards = readFileSync('services/appointmentReminderJobGuards.ts', 'utf8');

// The unqualified name in the legacy submit route must be initialized
// when server.ts imports its extracted portal appointments module.
assert.match(boot, /^import '\.\.\/src\/services\/portalRescheduleAvailability';/m);
assert.match(slots, /export const PORTAL_RESCHEDULE_MAX_OPTIONS = 3;/);
assert.match(slots, /globalThis\.PORTAL_RESCHEDULE_MAX_OPTIONS = PORTAL_RESCHEDULE_MAX_OPTIONS;/);
assert.match(actions, /selectedOptions\\.slice\\(0, PORTAL_RESCHEDULE_MAX_OPTIONS\\)/);

// A clinic approval changes the original appointment, notifies the patient and
// resets both sent-markers so 24h and 12h are evaluated against the NEW time.
assert.match(sql, /update public\.appointments[\s\S]*scheduled_at\s*=\s*p_scheduled_start/);
assert.match(sql, /patient_response = null/);
assert.match(sql, /patient_confirmation_status = null/);
for (const marker of [
  /notification_24h_sent_at\s*=\s*null/,
  /notification_12h_sent_at\s*=\s*null/,
  /notification_sent\s*=\s*false/,
  /notification_12h_sent\s*=\s*false/,
]) assert.match(sql, marker);
assert.match(resolution, /approve_appointment_reschedule\(/);
assert.match(cron, /const key = `\$\{appointment\.appointmentId\}:\$\{appointment\.scheduledAt\}`/);
assert.match(cron, /REMINDER_STEPS = \[/);
assert.match(cron, /hoursBefore: 24/);
assert.match(cron, /hoursBefore: 12/);
assert.match(cron, /recentlySentReminders/);
assert.match(cron, /reconcileApprovedReschedulesForReminders/);
assert.match(guards, /persistedStart !== queuedStart/);
assert.match(guards, /APPOINTMENT_REMINDER_SCHEDULE_CHANGED/);
console.log('portalRescheduleSubmissionAndReminderCycle: PASS');
