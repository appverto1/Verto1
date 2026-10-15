import { randomUUID } from 'node:crypto';
import {
  canShareGroupBooking,
  getAppointmentGroupId,
  groupBookingIncludesPatient,
} from '../../src/utils/groupSessionRules';
import { validateGroupBookingResources } from './groupSessionResourceValidation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown) => String(value || '').trim().toLowerCase();

export type GroupJoinDecision =
  | { ok: true; groupId: string; authorizedForOverlap: true; patientIds: string[] }
  | { ok: false; code: string; authorizedForOverlap: false };

export function createServerGroupSessionId(): string {
  return randomUUID();
}

/**
 * Only use this validator with data obtained from authenticated, clinic-scoped
 * backend reads: never pass browser-supplied patient or professional rows.
 *
 * This verifies eligibility to JOIN an existing persisted group, not permission
 * to create a new one. A new group must receive a server-generated UUID and be
 * created through the transactional appointment-write flow.
 *
 * It performs no DB requests; caller supplies batched, already-authorized rows.
 */
export function authorizeExistingGroupJoin(params: {
  authenticatedClinicId: string;
  requestedGroupId: string;
  candidateAppointment: any;
  existingGroupAppointments: any[];
  clinicPatientRows: Array<{ id: string; clinic_id: string }>;
  clinicProfessionalRows: Array<{ user_id: string; clinic_id: string; role: string; status: string; specialty: string }>;
  clinicRoomRows: Array<{ id: string; clinic_id?: string; organization_id?: string; is_active?: boolean; capacity?: number | null }>;
  patientIds: string[];
  professionalIds: string[];
}): GroupJoinDecision {
  const clinicId = id(params.authenticatedClinicId);
  const groupId = id(params.requestedGroupId);
  if (!UUID.test(clinicId) || !UUID.test(groupId))
    return { ok: false, code: 'GROUP_SCOPE_INVALID', authorizedForOverlap: false };
  if (!Array.isArray(params.existingGroupAppointments) || params.existingGroupAppointments.length === 0)
    return { ok: false, code: 'GROUP_NOT_FOUND', authorizedForOverlap: false };

  const patients = params.patientIds.map(id);
  const professionals = params.professionalIds.map(id);
  if (!patients.length || patients.length > 30 || !professionals.length || professionals.length > 8)
    return { ok: false, code: 'GROUP_CAPACITY_INVALID', authorizedForOverlap: false };
  if (
    patients.some(value => !UUID.test(value)) ||
    professionals.some(value => !UUID.test(value)) ||
    new Set(patients).size !== patients.length ||
    new Set(professionals).size !== professionals.length
  ) return { ok: false, code: 'GROUP_PARTICIPANTS_INVALID', authorizedForOverlap: false };

  const clinicPatientIds = new Set(params.clinicPatientRows
    .filter(row => id(row.clinic_id) === clinicId).map(row => id(row.id)));
  if (patients.some(value => !clinicPatientIds.has(value))) {
    return { ok: false, code: 'GROUP_MEMBERSHIP_DENIED', authorizedForOverlap: false };
  }

  const candidate = params.candidateAppointment;
  const candidatePatient = id(candidate?.patient_id || candidate?.patientId);
  const candidateProfessionals = [
    candidate?.therapist_id, candidate?.therapistId,
    candidate?.professional_id, candidate?.professionalId,
    ...(Array.isArray(candidate?.professional_ids) ? candidate.professional_ids : []),
    ...(Array.isArray(candidate?.professionalIds) ? candidate.professionalIds : []),
    ...(Array.isArray(candidate?.team_professional_ids) ? candidate.team_professional_ids : []),
    ...(Array.isArray(candidate?.teamProfessionalIds) ? candidate.teamProfessionalIds : []),
  ].map(id).filter(Boolean);
  const uniqueCandidateProfessionals = [...new Set(candidateProfessionals)].sort();
  if (
    id(candidate?.clinic_id || candidate?.clinicId) !== clinicId ||
    getAppointmentGroupId(candidate) !== groupId ||
    !patients.includes(candidatePatient) ||
    uniqueCandidateProfessionals.length !== professionals.length ||
    uniqueCandidateProfessionals.some((value, index) => value !== [...professionals].sort()[index])
  ) return { ok: false, code: 'GROUP_CANDIDATE_INVALID', authorizedForOverlap: false };

  // Every persisted row must belong to this exact group, clinic and slot.
  // Never authorize from a detached draft or a foreign clinic row.
  const validRows = params.existingGroupAppointments.every(row => (
    id(row?.clinic_id || row?.clinicId) === clinicId &&
    getAppointmentGroupId(row) === groupId &&
    ['pending', 'scheduled', 'confirmed', 'in_progress']
      .includes(String(row?.status || 'scheduled').trim().toLowerCase()) &&
    canShareGroupBooking(candidate, row)
  ));
  if (!validRows) return { ok: false, code: 'GROUP_SLOT_CONFLICT', authorizedForOverlap: false };

  // Limit the whole group, not merely the current join request. A batch of
  // repeated small additions must never bypass the logical 30-patient ceiling.
  const existingPatientIds = params.existingGroupAppointments.map(row => id(row?.patient_id || row?.patientId));
  if (existingPatientIds.some(value => !UUID.test(value)) ||
      new Set(existingPatientIds).size !== existingPatientIds.length ||
      existingPatientIds.length + patients.length > 30) {
    return { ok: false, code: 'GROUP_CAPACITY_INVALID', authorizedForOverlap: false };
  }

  const resources = validateGroupBookingResources({
    clinicId,
    specialty: String(candidate?.service_type || candidate?.serviceType || candidate?.approach || ''),
    professionalIds: professionals,
    patientCount: existingPatientIds.length + patients.length,
    roomId: id(candidate?.room_id || candidate?.roomId),
    membershipRows: params.clinicProfessionalRows,
    roomRows: params.clinicRoomRows,
  });
  if (!resources.ok) return { ok: false, code: resources.code, authorizedForOverlap: false };

  if (params.existingGroupAppointments.some(row => patients.includes(id(row?.patient_id || row?.patientId))) ||
      patients.some(patientId => groupBookingIncludesPatient(params.existingGroupAppointments, {
        ...candidate, patient_id: patientId, id: '',
      }))) {
    return { ok: false, code: 'GROUP_DUPLICATE_PATIENT', authorizedForOverlap: false };
  }

  return { ok: true, groupId, authorizedForOverlap: true, patientIds: patients };
}
