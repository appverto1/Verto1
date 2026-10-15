import { clinicalSpecialtyScopeKey } from '../../src/utils/clinicalSpecialties';

const normalizeId = (value: unknown) => String(value ?? '').trim().toLowerCase();

type ProfessionalMembership = {
  user_id?: string; id?: string; clinic_id?: string;
  role?: string; status?: string; specialty?: string;
};
type Room = {
  id: string; clinic_id?: string; organization_id?: string;
  is_active?: boolean; capacity?: number | null;
};

export type GroupResourceDecision =
  | { ok: true; roomCapacity: number }
  | { ok: false; code: string };

/**
 * The persisted clinic_memberships row, not a browser-supplied team entry, is
 * the authority for the professional's active clinic and clinical specialty.
 * Only batch, clinic-scoped database records should be passed here.
 */
export function validateGroupBookingResources(params: {
  clinicId: string;
  specialty: string;
  professionalIds: string[];
  patientCount: number;
  roomId: string;
  membershipRows: ProfessionalMembership[];
  roomRows: Room[];
}): GroupResourceDecision {
  const clinicId = normalizeId(params.clinicId);
  const specialtyKey = clinicalSpecialtyScopeKey(params.specialty);
  const professionalIds = params.professionalIds.map(normalizeId);
  if (!clinicId || !specialtyKey || professionalIds.length < 1 || professionalIds.length > 8 ||
      new Set(professionalIds).size !== professionalIds.length ||
      !Number.isInteger(params.patientCount) || params.patientCount < 2 || params.patientCount > 30) {
    return { ok: false, code: 'GROUP_RESOURCES_INVALID' };
  }
  const room = params.roomRows.find(value =>
    normalizeId(value.id) === normalizeId(params.roomId) &&
    normalizeId(value.clinic_id || value.organization_id) === clinicId &&
    value.is_active === true
  );
  if (!room) return { ok: false, code: 'GROUP_ROOM_UNAVAILABLE' };
  const capacity = Number(room.capacity);
  if (room.capacity == null || !Number.isSafeInteger(capacity) || capacity < 2 || capacity > 1000) {
    return { ok: false, code: 'GROUP_ROOM_CAPACITY_REQUIRED' };
  }
  if (params.patientCount > capacity) return { ok: false, code: 'GROUP_ROOM_CAPACITY_EXCEEDED' };

  for (const selectedId of professionalIds) {
    const activeMemberships = params.membershipRows.filter(member =>
      normalizeId(member.user_id) === selectedId &&
      normalizeId(member.clinic_id) === clinicId &&
      normalizeId(member.status) === 'active' &&
      normalizeId(member.role) === 'therapist'
    );
    if (activeMemberships.length !== 1) return { ok: false, code: 'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID' };
    if (clinicalSpecialtyScopeKey(activeMemberships[0].specialty) !== specialtyKey) {
      return { ok: false, code: 'GROUP_PROFESSIONAL_SPECIALTY_MISMATCH' };
    }
  }
  return { ok: true, roomCapacity: capacity };
}
