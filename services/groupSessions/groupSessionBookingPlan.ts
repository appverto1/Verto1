import { createHash } from 'node:crypto';
import { clinicalSpecialtyScopeKey } from '../../src/utils/clinicalSpecialties';
import { createServerGroupSessionId } from './groupSessionWriteValidation';
import { resolveGroupPatientRates } from './groupSessionFinancialValidation';
import { validateGroupBookingResources } from './groupSessionResourceValidation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeId = (raw: unknown) => String(raw || '').trim().toLowerCase();

export type NewGroupBookingPlan = {
  clinicId: string;
  groupId: string;
  modality: 'GROUP';
  specialty: string;
  date: string;
  startTime: string;
  /** Absolute UTC instant; distinguishes repeated local wall-clock times. */
  scheduledStartAt: string;
  durationMinutes: number;
  roomId: string;
  professionalIds: string[];
  idempotencyKey: string;
  /** Server-derived payload fingerprint for the future transactional idempotency ledger. */
  idempotencyFingerprint: string;
  patients: Array<{ patientId: string; financialPlanId: string; priceCents: number }>;
};
/** Stable across client ordering and repeated previews, but sensitive to every
 * field affecting occupancy or billing. Never include the random group UUID:
 * the DB write will persist its own identity on first successful execution.
 */
export function fingerprintGroupBooking(plan: Omit<NewGroupBookingPlan, 'groupId' | 'idempotencyFingerprint'>): string {
  const members = plan.patients.map(row => [
    normalizeId(row.patientId), normalizeId(row.financialPlanId), row.priceCents,
  ] as const).sort((a,b) => a[0].localeCompare(b[0]));
  const canonical = JSON.stringify([
    'GROUP_BOOKING_V1',
    normalizeId(plan.clinicId), clinicalSpecialtyScopeKey(plan.specialty),
    plan.date, plan.startTime, plan.scheduledStartAt, plan.durationMinutes,
    normalizeId(plan.roomId), [...plan.professionalIds].map(normalizeId).sort(),
    members,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export type NewGroupBookingDecision =
  | { ok: true; plan: NewGroupBookingPlan }
  | { ok: false; code: string; patientId?: string };

/**
 * Compose one trusted booking intention, without database writes. The caller
 * MUST get clinic-scoped patients, professionals, rooms and active financial
 * plans from the DB. It MUST persist the complete batch atomically under a
 * clinic/idempotency lock, and re-check real-time availability in that same
 * transaction. A preview / UI value can never authorize a charge or booking.
 */
export function prepareNewGroupBooking(params: {
  authenticatedClinicId: string;
  specialty: unknown;
  date: unknown;
  startTime: unknown;
  scheduledStartAt: unknown;
  durationMinutes: unknown;
  roomId: unknown;
  patientIds: unknown;
  professionalIds: unknown;
  idempotencyKey: unknown;
  clinicPatientRows: Array<{ id: string; clinic_id: string }>;
  clinicProfessionalRows: Array<{ user_id: string; clinic_id: string; role: string; status: string; specialty: string }>;
  clinicRoomRows: Array<{ id: string; clinic_id?: string; organization_id?: string; is_active?: boolean; capacity?: number | null }>;
  activeFinancialPlanRows: any[];
}): NewGroupBookingDecision {
  const clinicId = normalizeId(params.authenticatedClinicId);
  if (!UUID.test(clinicId)) return { ok: false, code: 'GROUP_CLINIC_INVALID' };
  const patientIds = Array.isArray(params.patientIds) ? params.patientIds.map(normalizeId) : [];
  const professionalIds = Array.isArray(params.professionalIds) ? params.professionalIds.map(normalizeId) : [];
  if (patientIds.length < 2 || patientIds.length > 30 ||
      professionalIds.length < 1 || professionalIds.length > 8 ||
      [...patientIds, ...professionalIds].some(id => !UUID.test(id)) ||
      new Set(patientIds).size !== patientIds.length ||
      new Set(professionalIds).size !== professionalIds.length) {
    return { ok: false, code: 'GROUP_PARTICIPANTS_INVALID' };
  }

  const specialty = String(params.specialty || '').trim().slice(0, 120);
  const date = String(params.date || '').trim();
  const startTime = String(params.startTime || '').trim();
  const timestamp = String(params.scheduledStartAt || '').trim();
  const parsedInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
    ? Date.parse(timestamp) : NaN;
  const scheduledStartAt = Number.isFinite(parsedInstant) && parsedInstant % 60_000 === 0
    ? new Date(parsedInstant).toISOString() : '';
  const durationMinutes = Number(params.durationMinutes);
  const roomId = normalizeId(params.roomId);
  const idempotencyKey = String(params.idempotencyKey || '').trim();
  if (!specialty || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !scheduledStartAt ||
      !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360 ||
      !UUID.test(roomId) || !/^[a-zA-Z0-9:._-]{12,120}$/.test(idempotencyKey)) {
    return { ok: false, code: 'GROUP_SLOT_INVALID' };
  }
  // A lexical yyyy-mm-dd alone does not prove calendar validity.
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, code: 'GROUP_DATE_INVALID' };
  }

  const validPatients = new Set(params.clinicPatientRows
    .filter(row => normalizeId(row.clinic_id) === clinicId).map(row => normalizeId(row.id)));
  if (patientIds.some(value => !validPatients.has(value))) {
    return { ok: false, code: 'GROUP_MEMBER_OUT_OF_SCOPE' };
  }
  const resources = validateGroupBookingResources({
    clinicId,
    specialty,
    professionalIds,
    patientCount: patientIds.length,
    roomId,
    membershipRows: params.clinicProfessionalRows,
    roomRows: params.clinicRoomRows,
  });
  if (!resources.ok) return { ok: false, code: resources.code };

  const rates = resolveGroupPatientRates({
    authenticatedClinicId: clinicId,
    specialty,
    patientIds,
    activeFinancialPlanRows: params.activeFinancialPlanRows,
    scheduledStartAt,
    localDate: date,
  });
  if (!rates.ok) return { ok: false, code: rates.code, ...('patientId' in rates ? { patientId: rates.patientId } : {}) };

  const bookingData = {
    clinicId,
    modality: 'GROUP' as const,
    specialty,
    date,
    startTime,
    scheduledStartAt,
    durationMinutes,
    roomId,
    professionalIds,
    idempotencyKey,
    patients: rates.rates.map(rate => ({
      patientId: rate.patientId,
      financialPlanId: rate.financialPlanId,
      priceCents: rate.amountCents
    })),
  };
  // The client is never permitted to choose the group ID on creation.
  return {
    ok: true,
    plan: {
      ...bookingData,
      groupId: createServerGroupSessionId(),
      idempotencyFingerprint: fingerprintGroupBooking(bookingData),
    },
  };
}
