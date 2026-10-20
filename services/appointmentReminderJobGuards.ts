/**
 * Fail-closed validation for notification_jobs already claimed by a worker.
 * A reschedule can cancel a CLAIMED job while the worker is hydrating data.
 * Compare the durable appointment, patient and schedule before producing
 * a portal notification or sending push; never trust stale queued payloads.
 */
import { normalizeId, UUID, validInstant, responded } from './appointmentReminderClaimPrimitives';

type QueuedAppointmentJob = {
  source_id?: unknown; clinic_id?: unknown; patient_id?: unknown;
  created_at?: unknown; scheduled_for?: unknown; notification_kind?: unknown;
  payload?: unknown;
};
type PersistedAppointment = {
  id?: unknown; clinic_id?: unknown; patient_id?: unknown;
  scheduled_at?: unknown; status?: unknown; is_active?: unknown;
  deleted_at?: unknown; notification_24h_sent_at?: unknown;
  notification_12h_sent_at?: unknown; patient_response?: unknown;
  patient_confirmation_status?: unknown;
};
type PersistedPatient = { id?: unknown; clinic_id?: unknown; is_active?: unknown; deleted_at?: unknown };

export function validateClaimedAppointmentReminder(
  job: QueuedAppointmentJob,
  appointment: PersistedAppointment,
  patient: PersistedPatient,
  nowIso: string,
): { allowed: boolean; reason: string } {
  const deny = (reason: string) => ({ allowed: false, reason });
  const appointmentId = normalizeId(appointment?.id);
  const patientId = normalizeId(appointment?.patient_id);
  const clinicId = normalizeId(appointment?.clinic_id);
  if (!UUID.test(appointmentId) || appointmentId !== normalizeId(job?.source_id)
    || !UUID.test(patientId) || patientId !== normalizeId(job?.patient_id)
    || patientId !== normalizeId(patient?.id)
    || !UUID.test(clinicId) || clinicId !== normalizeId(job?.clinic_id)
    || clinicId !== normalizeId(patient?.clinic_id)) {
    return deny('APPOINTMENT_REMINDER_SCOPE_CHANGED');
  }
  const status = String(appointment?.status || '').trim().toLowerCase();
  if (appointment?.is_active === false || appointment?.deleted_at
    || patient?.is_active === false || patient?.deleted_at
    || ['cancelled', 'canceled', 'no_show', 'missed', 'completed', 'deleted'].includes(status)) {
    return deny('APPOINTMENT_REMINDER_INACTIVE');
  }
  const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
    ? job.payload as Record<string, unknown> : {};
  const persistedStart = validInstant(appointment?.scheduled_at);
  const queuedStart = validInstant(payload.scheduledAt);
  const queuedDue = validInstant(job?.scheduled_for);
  const queuedCreated = validInstant(job?.created_at);
  const now = validInstant(nowIso);
  if (persistedStart === null || queuedStart === null || queuedDue === null || queuedCreated === null || now === null
    || persistedStart !== queuedStart || queuedDue > now || persistedStart <= now) {
    return deny('APPOINTMENT_REMINDER_SCHEDULE_CHANGED');
  }

  // A reschedule can occur after a reminder window has already passed.
  // The appointment trigger still writes both kinds of jobs; never deliver
  // one immediately if the job was first created at or after its due time.
  // This preserves the 12h reminder when approving a slot 15h in advance,
  // without sending a retroactive 24h reminder.
  if (queuedCreated >= queuedDue) {
    return deny('APPOINTMENT_REMINDER_CREATED_AFTER_DUE');
  }

  if (job?.notification_kind === 'APPOINTMENT_REMINDER_24H') {
    // When both reminders became due during an outage, only the newer 12h
    // reminder should be delivered, even if the old 24h job was claimed.
    // Sent markers are legacy flags without a schedule-cycle ID. A legitimate
    // reschedule may keep an old marker; the claimed queue row is the durable
    // per-cycle idempotency authority. Only suppress the older overdue step.
    if (now >= persistedStart - 12 * 60 * 60 * 1000) {
      return deny('APPOINTMENT_REMINDER_SUPERSEDED');
    }
    return { allowed: true, reason: '' };
  }
  if (job?.notification_kind === 'APPOINTMENT_REMINDER_12H') {
    const response = String(appointment?.patient_response || appointment?.patient_confirmation_status || '').trim().toLowerCase();
    if (responded.has(response)) return deny('APPOINTMENT_REMINDER_SUPERSEDED');
    return { allowed: true, reason: '' };
  }
  return deny('APPOINTMENT_REMINDER_INVALID_KIND');
}
