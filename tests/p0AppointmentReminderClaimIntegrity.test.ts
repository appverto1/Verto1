import assert from 'node:assert/strict';
import { validateClaimedAppointmentReminder } from '../services/appointmentReminderJobGuards';

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
check('already-sent 24h job suppressed', job, { ...appointment, notification_24h_sent_at: nowIso }, patient);
check('already-sent 12h supersedes older 24h', job, { ...appointment, notification_12h_sent_at: nowIso }, patient);
check('late 24h cannot collide with 12h after outage', job, appointment, patient, '2026-10-09T07:00:00Z');

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

console.log('PASS P0 appointment reminders: reschedule, cross-clinic, stale claims, recurrence and dedupe');
