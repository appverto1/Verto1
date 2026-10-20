import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateClaimedAppointmentReminder } from '../services/appointmentReminderJobGuards';
import { normalizeId, UUID, validInstant, responded } from '../services/appointmentReminderClaimPrimitives';

// The exact extracted primitives remain fail-closed for inconsistent identities and dates.
assert.equal(normalizeId(' ABC-123 '), 'abc-123');
assert.equal(normalizeId(42), '');
assert.equal(UUID.test('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);
assert.equal(UUID.test('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaz'), false);
assert.equal(validInstant('2026-10-08T12:00:00.000Z'), Date.parse('2026-10-08T12:00:00.000Z'));
assert.equal(validInstant('invalid-date'), null);
assert.equal(validInstant('2026-10-08T12:00:00.000Z'.repeat(4)), null);
assert.equal(validInstant(123), null);
assert.equal(responded.has('confirmed'), true);
assert.equal(responded.has('reschedule_requested'), true);
assert.equal(responded.has('pending'), false);

const appointmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clinicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherClinicId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scheduledAt = '2026-10-09T18:00:00.000Z';
const nowIso = '2026-10-08T12:00:00.000Z';

const job = {
  source_type: 'APPOINTMENT',
  source_id: appointmentId,
  clinic_id: clinicId,
  patient_id: patientId,
  notification_kind: 'APPOINTMENT_REMINDER_24H',
  created_at: '2026-10-08T10:00:00Z',
  scheduled_for: '2026-10-08T11:59:00Z',
  payload: { scheduledAt },
};
const appointment = {
  id: appointmentId, clinic_id: clinicId, patient_id: patientId,
  scheduled_at: scheduledAt, status: 'scheduled', is_active: true,
  notification_24h_sent_at: null, notification_12h_sent_at: null,
};
const patient = { id: patientId, clinic_id: clinicId, is_active: true };

function check(
  title: string, j: Record<string, unknown>, a: Record<string, unknown>,
  p: Record<string, unknown>, now = nowIso, expected = false,
) {
  assert.equal(validateClaimedAppointmentReminder(j, a, p, now).allowed, expected, title);
}

// One delivered reminder per appointment/schedule/kind and no stale schedule
check('valid queued 24h reminder', job, appointment, patient, nowIso, true);
check('old scheduled_at cannot send after rescheduling', job, { ...appointment, scheduled_at: '2026-10-10T18:00:00Z' }, patient);
check('old patient recipient cannot send after patient reassignment', job, { ...appointment, patient_id: otherClinicId }, patient);
check('foreign clinic cannot send reminder', { ...job, clinic_id: otherClinicId }, appointment, patient);
check('patient belongs to different clinic', job, appointment, { ...patient, clinic_id: otherClinicId });
check('queued patient not matching persisted patient', { ...job, patient_id: otherClinicId }, appointment, patient);
check('missing original schedule metadata fails closed', { ...job, payload: {} }, appointment, patient);
check('future job cannot send early', { ...job, scheduled_for: '2026-10-08T15:00:00Z' }, appointment, patient);
check('completed appointment does not generate reminder', job, { ...appointment, status: 'completed' }, patient);
check('cancelled appointment does not generate reminder', job, { ...appointment, status: 'cancelled' }, patient);
check('inactive patient cannot receive reminder', job, appointment, { ...patient, is_active: false });
check('deleted appointment cannot generate reminder', job, { ...appointment, deleted_at: nowIso }, patient);
check('old 24h marker cannot suppress newly scheduled reminder', job, { ...appointment, notification_24h_sent_at: nowIso }, patient, nowIso, true);
check('old 12h marker cannot suppress next schedule cycle', job, { ...appointment, notification_12h_sent_at: nowIso }, patient, nowIso, true);
check('late 24h cannot collide with 12h after outage', job, appointment, patient, '2026-10-09T07:00:00Z');

check('missing job creation time fails closed', { ...job, created_at: null }, appointment, patient);

// Approval 15h before the new session: the DB creates both slots, but the
// already-due 24h slot must be canceled; the 12h follow-up remains valid.
const fifteenHoursAhead = '2026-10-09T03:00:00Z';
const nearTermAppointment = { ...appointment, scheduled_at: fifteenHoursAhead };
check('15h reschedule does not retroactively send a 24h reminder', {
  ...job,
  created_at: nowIso,
  scheduled_for: '2026-10-08T03:00:00Z',
  payload: { scheduledAt: fifteenHoursAhead },
}, nearTermAppointment, patient);
check('15h reschedule sends only its due 12h reminder', {
  ...job,
  notification_kind: 'APPOINTMENT_REMINDER_12H',
  created_at: nowIso,
  scheduled_for: '2026-10-08T15:00:00Z',
  payload: { scheduledAt: fifteenHoursAhead },
}, nearTermAppointment, patient, '2026-10-08T15:00:00Z', true);

const tenHoursAhead = '2026-10-08T22:00:00Z';
check('10h reschedule does not send an expired 12h reminder', {
  ...job,
  notification_kind: 'APPOINTMENT_REMINDER_12H',
  created_at: nowIso,
  scheduled_for: '2026-10-08T10:00:00Z',
  payload: { scheduledAt: tenHoursAhead },
}, { ...appointment, scheduled_at: tenHoursAhead }, patient);


const followup = {
  ...job,
  notification_kind: 'APPOINTMENT_REMINDER_12H',
  scheduled_for: '2026-10-09T05:59:00Z',
};
check('valid 12h followup', followup, appointment, patient, '2026-10-09T06:00:00Z', true);
check('patient already responded, no 12h reminder', followup, { ...appointment, patient_response: 'confirmed' }, patient, '2026-10-09T06:00:00Z');
check('patient asked to reschedule, no 12h reminder', followup, { ...appointment, patient_confirmation_status: 'reschedule_requested' }, patient, '2026-10-09T06:00:00Z');
check('rejected unknown kind', { ...job, notification_kind: 'INVALID' }, appointment, patient);
check('after start time, both reminders rejected', followup, appointment, patient, '2026-10-09T18:01:00Z');

// An individual recurring appointment occurrence has its own identity and
// schedule cycle: another occurrence cannot reuse a claimed job from this one.
check('recurrence occurrence identity differs', { ...job, source_id: otherClinicId }, appointment, patient);
check('same occurrence next cycle remains eligible with a fresh job', {
  ...job,
  payload: { scheduledAt: '2026-10-10T18:00:00Z' },
  scheduled_for: '2026-10-09T11:59:00Z',
}, { ...appointment, scheduled_at: '2026-10-10T18:00:00Z' }, patient, '2026-10-09T12:00:00Z', true);

const sql = readFileSync(new URL('../supabase/migrations/20261008194000_claimed_reminder_marker_guard_v1.sql', import.meta.url), 'utf8');
const cron = readFileSync(new URL('../services/cronService.ts', import.meta.url), 'utf8');
assert.match(sql, /j\.deployment_env = v_env/);
assert.match(sql, /j\.status = 'CLAIMED'/);
assert.match(sql, /j\.clinic_id = a\.clinic_id/);
assert.match(sql, /j\.patient_id = a\.patient_id/);
assert.match(sql, /a\.scheduled_at = nullif\(j\.payload->>'scheduledAt', ''\)::timestamptz/);
assert.match(sql, /a\.scheduled_at = e\.scheduled_at/);
assert.match(sql, /revoke all on function public\.mark_sent_appointment_notification_jobs_v1/);
assert.match(sql, /grant execute on function public\.mark_sent_appointment_notification_jobs_v1[\s\S]*to service_role/);
const worker = cron.slice(cron.indexOf('async function runNotificationJobQueue('), cron.indexOf('export function triggerAppointmentReminderScan('));
assert.match(worker, /validateClaimedAppointmentReminder\(job, appointment, patient,/);
assert.match(worker, /rpc\('mark_sent_appointment_notification_jobs_v1'/);
assert.doesNotMatch(worker, /\.update\(\{ notification_24h_sent_at: sentAt \}\)\.in\('id', sent24Ids\)/);
assert.doesNotMatch(worker, /\.update\(\{ notification_12h_sent_at: sentAt \}\)\.in\('id', sent12Ids\)/);

console.log('PASS P0 appointment reminders: reschedule, cross-clinic, stale claims, recurrence and dedupe');
