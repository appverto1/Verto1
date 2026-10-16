import { prepareNewGroupBooking, type NewGroupBookingDecision } from './groupSessionBookingPlan';
import { previewGroupBookingAvailability } from './groupSessionAvailabilityPreview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown) => String(value ?? '').trim().toLowerCase();

type GroupBookingInput = {
  authenticatedClinicId: string;
  patientIds: unknown;
  professionalIds: unknown;
  specialty: unknown;
  date: unknown;
  startTime: unknown;
  durationMinutes: unknown;
  roomId: unknown;
  idempotencyKey: unknown;
  scheduledStartAt: unknown;
};

/**
 * Assemble a read-only booking plan from real clinic-scoped DB rows.
 * Queries are batched and column-limited, irrespective of group size.
 *
 * This is NOT permission to commit appointments: booking availability and
 * pricing must be revalidated under transaction locks in the final DB RPC.
 */
export async function previewNewGroupBooking(params: GroupBookingInput & { supabase: any })
  : Promise<NewGroupBookingDecision> {
  const clinicId = id(params.authenticatedClinicId);
  const patients = Array.isArray(params.patientIds) ? params.patientIds.map(id) : [];
  const professionals = Array.isArray(params.professionalIds) ? params.professionalIds.map(id) : [];
  const roomId = id(params.roomId);
  if (!UUID.test(clinicId) ||
      !Array.isArray(params.patientIds) || !Array.isArray(params.professionalIds) ||
      patients.length < 2 || patients.length > 30 ||
      professionals.length < 1 || professionals.length > 8 ||
      !UUID.test(roomId) ||
      patients.some(value => !UUID.test(value)) || new Set(patients).size !== patients.length ||
      professionals.some(value => !UUID.test(value)) || new Set(professionals).size !== professionals.length) {
    return { ok:false, code:'GROUP_PREVIEW_INPUT_INVALID' };
  }

  // Refuse malformed calendar inputs *before* spending four batched DB reads.
  // The booking plan performs this validation again after fetching canonical rows.
  const specialty = String(params.specialty || '').trim().slice(0, 120);
  const date = String(params.date || '').trim();
  const time = String(params.startTime || '').trim();
  const duration = Number(params.durationMinutes);
  const key = String(params.idempotencyKey || '').trim();
  const scheduledStartAt = String(params.scheduledStartAt || '').trim();
  // Reject malformed instants before even the four resource lookups. The
  // canonical clinic timezone check still runs after the scoped reads.
  const requestedStartMs = Date.parse(scheduledStartAt);
  const hasExplicitInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(scheduledStartAt) &&
    Number.isFinite(requestedStartMs) && requestedStartMs % 60_000 === 0;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
  if (!hasExplicitInstant || !specialty || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !Number.isInteger(duration) || duration < 15 || duration > 360 ||
      !/^[a-zA-Z0-9:._-]{12,120}$/.test(key)) {
    return { ok:false, code:'GROUP_PREVIEW_INPUT_INVALID' };
  }

  // Each request is scoped by the authenticated clinic, never by a tenant ID
  // provided in the request body. The queries can run concurrently without
  // creating per-patient N+1 reads.
  const [patientRows, memberRows, roomRows, planRows] = await Promise.all([
    params.supabase.from('patients')
      .select('id,clinic_id')
      .eq('clinic_id',clinicId).in('id',patients).limit(patients.length),
    params.supabase.from('clinic_memberships')
      .select('user_id,clinic_id,role,status,specialty')
      .eq('clinic_id',clinicId).eq('status','active')
      .in('user_id',professionals).limit(professionals.length + 1),
    params.supabase.from('clinic_rooms')
      .select('id,clinic_id,organization_id,is_active,capacity,prevent_overlapping_appointments')
      .eq('clinic_id',clinicId).eq('id',roomId).limit(1),
    params.supabase.from('patient_financial_plans')
      .select('id,organization_id,patient_id,status,billing_mode,service_type,custom_service_name,service_name_snapshot,group_amount_cents')
      .eq('organization_id',clinicId).eq('status','ACTIVE')
      .in('patient_id',patients).limit(201),
  ]);
  const errors = [patientRows,memberRows,roomRows,planRows].filter(result => result.error);
  if (errors.length) {
    const failure: any = errors[0].error;
    if (['42703','42P01','PGRST204'].includes(String(failure?.code || '')))
      return { ok:false, code:'GROUP_PRICING_MIGRATION_REQUIRED' };
    throw failure;
  }
  if ((planRows.data || []).length >= 201 || (memberRows.data || []).length > professionals.length)
    return { ok:false, code:'GROUP_PREVIEW_ROWS_TRUNCATED' };

  const prepared = prepareNewGroupBooking({
    authenticatedClinicId:clinicId,
    patientIds:patients,
    professionalIds:professionals,
    specialty:params.specialty,
    date:params.date,
    startTime:params.startTime,
    scheduledStartAt: params.scheduledStartAt,
    durationMinutes:params.durationMinutes,
    roomId,
    idempotencyKey:params.idempotencyKey,
    clinicPatientRows:patientRows.data || [],
    clinicProfessionalRows:memberRows.data || [],
    clinicRoomRows:roomRows.data || [],
    activeFinancialPlanRows:planRows.data || [],
  });
  if (!prepared.ok) return prepared;

  // Only an actual canonical room can define whether overlap is permitted.
  // The preview remains non-authoritative even after this collision check.
  const room = (roomRows.data || []).find((row: any) => id(row.id) === roomId && id(row.clinic_id) === clinicId);
  if (!room) return { ok:false, code:'GROUP_ROOM_UNAVAILABLE' };
  const availability = await previewGroupBookingAvailability({
    supabase: params.supabase,
    clinicId, patientIds: patients, professionalIds: professionals,
    roomId, roomPreventsOverlap: room.prevent_overlapping_appointments !== false,
    date, startTime: time, durationMinutes: duration,
    scheduledStartAt: params.scheduledStartAt,
  });
  if (!availability.ok) return { ok:false, code:availability.code };
  return prepared;
}
