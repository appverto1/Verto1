// P0 #504: pure, fail-closed policy. No mutation, invoice creation or cancellation here.
// All writes require one authenticated, transactional backend operation.
const MINUTE = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['active', 'in_progress']);
const OCCUPIED = new Set(['scheduled', 'pending', 'confirmed', 'in_progress', 'in-progress', 'attended']);

function positiveMinutes(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 15 || n > 360) throw new RangeError(label + ' invalid');
  return n;
}
function instant(value, label) {
  const n = new Date(value).getTime();
  if (!Number.isFinite(n)) throw new RangeError(label + ' invalid');
  return n;
}
function verifiedPriceCents(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new RangeError('Trusted unit price in cents required');
  }
  return value;
}
function str(value) { return String(value ?? '').trim(); }

export const CONTINUATION_OPTIONS = Object.freeze(['5', '10', '15', 'full']);
export const CONTINUATION_GRACE_MINUTES = 5;

/** Compute canonical end: never shorten a late-starting appointment. */
export function canonicalSessionEnd({ scheduledEndAt, actualStartAt, baseDurationMinutes, effectiveEndAt }) {
  const base = positiveMinutes(baseDurationMinutes, 'Base duration');
  const booked = instant(scheduledEndAt, 'Scheduled end');
  const started = instant(actualStartAt, 'Actual start');
  const baseEnd = Math.max(booked, started + base * MINUTE);
  if (effectiveEndAt == null) return new Date(baseEnd).toISOString();
  return new Date(Math.max(baseEnd, instant(effectiveEndAt, 'Effective end'))).toISOString();
}

/**
 * Price must come from an immutable, SERVER-RESOLVED financial snapshot.
 * Never use frontend prices as write authority. The preview does not charge.
 */
export function previewSessionContinuation(params) {
  const base = positiveMinutes(params.baseDurationMinutes, 'Base duration');
  const choice = str(params.choice);
  if (!CONTINUATION_OPTIONS.includes(choice)) throw new RangeError('Unknown extension');
  const additionalMinutes = choice === 'full' ? base : Number(choice);
  const endAt = canonicalSessionEnd(params);
  const nextEnd = new Date(instant(endAt, 'Effective end') + additionalMinutes * MINUTE).toISOString();
  const unitPriceCents = verifiedPriceCents(params.trustedUnitPriceCents);
  return Object.freeze({
    choice,
    additionalMinutes,
    baselineEndAt: endAt,
    nextEndAt: nextEnd,
    additionalBillableUnits: choice === 'full' ? 1 : 0,
    additionalChargeCents: choice === 'full' ? unitPriceCents : 0,
    twoUnitTotalCents: choice === 'full' ? unitPriceCents * 2 : unitPriceCents,
    bookingAndChargeMustCommitAtomically: choice === 'full',
  });
}

/**
 * Returns explicit blockers (not authorization). Only the backend may approve
 * cancellation of other patients, after clinic/role checks and row locks.
 */
export function previewContinuationConflicts({ organizationId, clinicId, professionalId, patientId, startAt, endAt, appointments }) {
  if (!UUID_RE.test(str(organizationId)) || !UUID_RE.test(str(clinicId)) ||
      !UUID_RE.test(str(professionalId)) || !UUID_RE.test(str(patientId))) {
    return Object.freeze({ safe: false, reason: 'MISSING_TRUSTED_SCOPE', conflicting: [] });
  }
  const start = instant(startAt, 'Extension start');
  const end = instant(endAt, 'Extension end');
  if (end <= start) throw new RangeError('Extension end must follow start');
  if (!Array.isArray(appointments)) return Object.freeze({ safe: false, reason: 'UNKNOWN_SCHEDULE', conflicting: [] });
  const conflicting = [];
  for (const item of appointments) {
    if (!item || !OCCUPIED.has(str(item.status).toLowerCase())) continue;
    const appClinic = str(item.clinicId ?? item.clinic_id);
    const appOrg = str(item.organizationId ?? item.organization_id);
    const appProfessional = str(item.professionalId ?? item.professional_id ?? item.therapist_id);
    const appPatient = str(item.patientId ?? item.patient_id);
    if (!UUID_RE.test(appClinic) || !UUID_RE.test(appOrg) || !UUID_RE.test(appProfessional) || !UUID_RE.test(appPatient)) {
      return Object.freeze({ safe: false, reason: 'UNVERIFIED_APPOINTMENT_SCOPE', conflicting: [] });
    }
    if (appProfessional !== str(professionalId) || appPatient === str(patientId)) continue;
    const otherStart = instant(item.scheduledStartAt ?? item.scheduled_start_at ?? item.scheduled_at, 'Other start');
    const otherEnd = instant(item.scheduledEndAt ?? item.scheduled_end_at, 'Other end');
    if (Math.max(start, otherStart) >= Math.min(end, otherEnd)) continue;
    conflicting.push(Object.freeze({
      appointmentId: str(item.id),
      patientId: appPatient,
      clinicId: appClinic,
      startAt: new Date(otherStart).toISOString(),
      endAt: new Date(otherEnd).toISOString(),
      mustNeverAutoCancel: appOrg !== str(organizationId) || appClinic !== str(clinicId) ||
        Boolean(item.active_aba_session_id) || Boolean(item.session_group_id) ||
        Boolean(item.checked_in_at),
    }));
  }
  return Object.freeze({
    safe: conflicting.every(x => !x.mustNeverAutoCancel),
    reason: conflicting.some(x => x.mustNeverAutoCancel) ? 'CONFLICT_NOT_CANCELLABLE' : null,
    conflicting: Object.freeze(conflicting),
  });
}

/**
 * Time alone is never evidence that a clinical record was flushed.
 * The server-side worker must provide an authoritative synchronization attestation.
 */
export function automaticClosureEligibility(params) {
  if (!ACTIVE.has(str(params.status).toLowerCase())) return { eligible: false, reason: 'NOT_ACTIVE' };
  if (!params.scheduledEndAt || !params.actualStartAt || !params.appointmentId ||
      !UUID_RE.test(str(params.organizationId)) || !UUID_RE.test(str(params.clinicId)) ||
      !UUID_RE.test(str(params.patientId)) || !UUID_RE.test(str(params.professionalId))) {
    return { eligible: false, reason: 'MISSING_CANONICAL_SCOPE' };
  }
  if (params.hasUnflushedClinicalWrites !== false || params.hasOpenTimers !== false ||
      params.hasPendingSync !== false || params.serverVerifiedSyncComplete !== true ||
      params.collectionStateKnown !== true) {
    return { eligible: false, reason: 'UNSAFE_OR_UNKNOWN_CLINICAL_STATE' };
  }
  let now, deadline, lastActivity, verifiedAt;
  try {
    now = instant(params.now, 'now');
    deadline = instant(canonicalSessionEnd(params), 'end');
    lastActivity = instant(params.lastConfirmedClinicalActivityAt, 'last activity');
    verifiedAt = instant(params.syncAttestedAt, 'sync attested');
  } catch {
    return { eligible: false, reason: 'UNKNOWN_CLINICAL_TIME' };
  }
  const graceEnd = Math.max(deadline, lastActivity) + CONTINUATION_GRACE_MINUTES * MINUTE;
  if (now < graceEnd) return { eligible: false, reason: 'GRACE_NOT_EXPIRED', eligibleAt: new Date(graceEnd).toISOString() };
  if (verifiedAt < graceEnd) return { eligible: false, reason: 'STALE_SYNC_ATTESTATION' };
  return { eligible: true, reason: 'VERIFIED_INACTIVE', eligibleAt: new Date(graceEnd).toISOString() };
}
