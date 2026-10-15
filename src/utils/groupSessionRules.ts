const getIds = (row: any): string[] => Array.from(new Set([
  row?.therapist_id, row?.therapistId, row?.professional_id, row?.professionalId,
  ...(Array.isArray(row?.professional_ids) ? row.professional_ids : []),
  ...(Array.isArray(row?.professionalIds) ? row.professionalIds : []),
  ...(Array.isArray(row?.team_professional_ids) ? row.team_professional_ids : []),
  ...(Array.isArray(row?.teamProfessionalIds) ? row.teamProfessionalIds : [])
].map((id) => String(id || '').trim()).filter(Boolean)));
const clock = (value: any) => String(value || '').trim().slice(0, 5);
const minutes = (value: any) => Number(value || 0);
export type AppointmentModality = 'INDIVIDUAL' | 'GROUP';

export function normalizeAppointmentModality(value: unknown): AppointmentModality {
  return String(value || '').trim().toUpperCase() === 'GROUP' ? 'GROUP' : 'INDIVIDUAL';
}

export function getAppointmentGroupId(value: any): string {
  const raw = String(value?.sessionGroupId || value?.session_group_id || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw) ? raw : '';
}

const sortedProfessionals = (appointment: any): string[] =>
  getIds(appointment).sort();

const comparable = (value: any): string => String(value || '').trim().toLowerCase();

/**
 * A group is ONE physical appointment with multiple patient-specific records.
 * A forged/shared identifier is not sufficient: the server also checks scope,
 * date, room, duration, specialty and team before permitting overlap.
 */
export function canShareGroupBooking(current: any, existing: any): boolean {
  const groupId = getAppointmentGroupId(current);
  if (!groupId || groupId !== getAppointmentGroupId(existing)) return false;
  if (normalizeAppointmentModality(current?.sessionModality || current?.session_modality) !== 'GROUP'
    || normalizeAppointmentModality(existing?.sessionModality || existing?.session_modality) !== 'GROUP') return false;
  const currentClinic = comparable(current?.clinicId || current?.clinic_id);
  const existingClinic = comparable(existing?.clinicId || existing?.clinic_id);
  if (!currentClinic || !existingClinic || currentClinic !== existingClinic) return false;
  if (comparable(current?.date) !== comparable(existing?.date)) return false;
  if (clock(current?.time || current?.start_time)
    !== normalizeAppointmentTime(existing?.time || existing?.start_time)) return false;
  if (minutes(current?.duration_minutes || current?.durationMinutes)
    !== normalizeDurationMinutes(existing?.duration_minutes || existing?.durationMinutes)) return false;
  if (comparable(current?.room_id || current?.roomId || current?.room)
    !== comparable(existing?.room_id || existing?.roomId || existing?.room)) return false;
  if (comparable(current?.location_type || current?.locationType)
    !== comparable(existing?.location_type || existing?.locationType)) return false;
  if (comparable(current?.service_type || current?.serviceType || current?.approach || current?.type)
    !== comparable(existing?.service_type || existing?.serviceType || existing?.approach || existing?.type)) return false;
  const idsA = sortedProfessionals(current);
  const idsB = sortedProfessionals(existing);
  return idsA.length > 0 && idsA.length === idsB.length && idsA.every((id, i) => id === idsB[i]);
}

export function groupBookingIncludesPatient(rows: any[], candidate: any): boolean {
  const groupId = getAppointmentGroupId(candidate);
  const patientId = String(candidate?.patient_id || candidate?.patientId || '').trim();
  if (!groupId || !patientId) return false;
  return rows.some(row => getAppointmentGroupId(row) === groupId
    && String(row?.patient_id || row?.patientId || '').trim() === patientId
    && String(row?.id || '') !== String(candidate?.id || ''));
}
