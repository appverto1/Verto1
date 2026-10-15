import { appointmentBlocksConflict, getAppointmentProfessionalIds } from '../../src/utils/scheduling';

const id = (value: unknown) => String(value ?? '').trim().toLowerCase();
const absoluteTime = (value: unknown): number | null => {
  const valueText = String(value || '').trim();
  // Never interpret timezone-free strings according to the process local TZ.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:(?:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(valueText))
    return null;
  const parsed = Date.parse(valueText);
  return Number.isFinite(parsed) ? parsed : null;
};

export type GroupSlotDecision =
  | { ok: true; code: 'GROUP_SLOT_AVAILABLE' }
  | { ok: false; code: 'GROUP_SLOT_INVALID' | 'GROUP_SLOT_UNVERIFIABLE' | 'GROUP_SLOT_SCOPE_MISMATCH' | 'GROUP_PATIENT_BUSY' | 'GROUP_PROFESSIONAL_BUSY' | 'GROUP_ROOM_BUSY' };

/**
 * Non-authoritative preflight against persisted clinic-scoped appointments.
 *
 * A new group never overrides an existing booking, even another group.
 * Its final write transaction MUST repeat the collision check while holding
 * locks and MUST not trust a preview decision or client-provided availability.
 */
export function checkNewGroupSlotAgainstAppointments(params: {
  authenticatedClinicId: string;
  patientIds: string[];
  professionalIds: string[];
  roomId: string;
  roomPreventsOverlap: boolean;
  scheduledStartAt: string;
  scheduledEndAt: string;
  existingAppointments: any[];
}): GroupSlotDecision {
  const clinicId = id(params.authenticatedClinicId);
  const patients = new Set((params.patientIds || []).map(id).filter(Boolean));
  const professionals = new Set((params.professionalIds || []).map(id).filter(Boolean));
  const roomId = id(params.roomId);
  const start = absoluteTime(params.scheduledStartAt);
  const end = absoluteTime(params.scheduledEndAt);
  if (!clinicId || !roomId || !patients.size || !professionals.size ||
      patients.size !== params.patientIds?.length || professionals.size !== params.professionalIds?.length ||
      start === null || end === null || end <= start || end - start > 360 * 60_000 ||
      !Array.isArray(params.existingAppointments) || typeof params.roomPreventsOverlap !== 'boolean') {
    return { ok: false, code: 'GROUP_SLOT_INVALID' };
  }

  for (const appointment of params.existingAppointments) {
    if (id(appointment?.clinic_id || appointment?.organization_id) !== clinicId)
      return { ok: false, code: 'GROUP_SLOT_SCOPE_MISMATCH' };
    if (appointment?.deleted_at || appointment?.is_active === false || !appointmentBlocksConflict(appointment))
      continue;

    const oldStart = absoluteTime(appointment?.scheduled_start_at || appointment?.scheduled_at);
    const explicitEnd = appointment?.scheduled_end_at;
    const oldDuration = Number(appointment?.scheduled_duration_minutes ?? appointment?.duration_minutes);
    const oldEnd = explicitEnd ? absoluteTime(explicitEnd) :
      oldStart !== null && Number.isFinite(oldDuration) && oldDuration > 0 && oldDuration <= 360
        ? oldStart + oldDuration * 60_000 : null;
    if (oldStart === null || oldEnd === null || oldEnd <= oldStart)
      return { ok: false, code: 'GROUP_SLOT_UNVERIFIABLE' };
    if (start >= oldEnd || oldStart >= end) continue;

    if (patients.has(id(appointment?.patient_id)))
      return { ok: false, code: 'GROUP_PATIENT_BUSY' };
    // A canonical group appointment can keep additional professionals in its
    // persisted source snapshot. Include them for *blocking* collisions, never
    // for granting membership or bypassing a conflict.
    const source = appointment?.source_payload;
    if (source !== undefined && source !== null &&
        (typeof source !== 'object' || Array.isArray(source))) {
      return { ok: false, code: 'GROUP_SLOT_UNVERIFIABLE' };
    }
    const extraProfessionalIds = [
      ...(Array.isArray(source?.professional_ids) ? source.professional_ids : []),
      ...(Array.isArray(source?.professionalIds) ? source.professionalIds : []),
      ...(Array.isArray(source?.team_professional_ids) ? source.team_professional_ids : []),
      ...(Array.isArray(source?.teamProfessionalIds) ? source.teamProfessionalIds : []),
    ];
    if ([...getAppointmentProfessionalIds(appointment), ...extraProfessionalIds]
      .some(value => professionals.has(id(value))))
      return { ok: false, code: 'GROUP_PROFESSIONAL_BUSY' };
    if (params.roomPreventsOverlap && id(appointment?.room_id) === roomId)
      return { ok: false, code: 'GROUP_ROOM_BUSY' };
  }
  return { ok: true, code: 'GROUP_SLOT_AVAILABLE' };
}
