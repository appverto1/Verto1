import { checkNewGroupSlotAgainstAppointments, type GroupSlotDecision } from './groupSessionAvailability';

const id = (value: unknown) => String(value ?? '').trim().toLowerCase();
const ABSOLUTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

type Candidate = {
  supabase: any;
  clinicId: string;
  patientIds: string[];
  professionalIds: string[];
  roomId: string;
  roomPreventsOverlap: boolean;
  date: string;
  startTime: string;
  durationMinutes: number;
  scheduledStartAt: unknown;
};

export type GroupPreviewAvailabilityDecision = GroupSlotDecision |
  { ok: false; code: 'GROUP_PREVIEW_TIME_INVALID' | 'GROUP_PREVIEW_TIMEZONE_INVALID' | 'GROUP_PREVIEW_APPOINTMENTS_TRUNCATED' | 'GROUP_PREVIEW_APPOINTMENTS_READ_FAILED' };

function localDayAndTime(instant: Date, timeZone: string): { day: string; clock: string } | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
    if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return null;
    return { day: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
  } catch {
    return null;
  }
}

/**
 * Non-authoritative availability preflight. The passed timestamps are not trusted:
 * resolve clinic timezone from the DB and verify their local wall clock first.
 * Fetch all candidate-time appointments once, not once per patient/professional.
 *
 * A future booking RPC must still re-check with transaction-scoped locks.
 */
export async function previewGroupBookingAvailability(params: Candidate): Promise<GroupPreviewAvailabilityDecision> {
  const raw = String(params.scheduledStartAt || '').trim();
  if (!ABSOLUTE_ISO.test(raw)) return { ok: false, code: 'GROUP_PREVIEW_TIME_INVALID' };
  const start = new Date(raw);
  const startMs = start.getTime();
  if (!Number.isFinite(startMs) || !Number.isInteger(params.durationMinutes) ||
      params.durationMinutes < 15 || params.durationMinutes > 360) {
    return { ok: false, code: 'GROUP_PREVIEW_TIME_INVALID' };
  }
  const end = new Date(startMs + params.durationMinutes * 60_000);

  const clinicResult = await params.supabase.from('clinics')
    .select('id,timezone').eq('id', id(params.clinicId)).limit(1).maybeSingle();
  if (clinicResult.error) throw clinicResult.error;
  if (id(clinicResult.data?.id) !== id(params.clinicId)) {
    return { ok: false, code: 'GROUP_PREVIEW_TIMEZONE_INVALID' };
  }
  const local = localDayAndTime(start, String(clinicResult.data?.timezone || ''));
  if (!local || local.day !== params.date || local.clock !== params.startTime) {
    return { ok: false, code: 'GROUP_PREVIEW_TIMEZONE_INVALID' };
  }

  // Allow a full day of look-back for historical long appointments; this does
  // not confer authority to book. Any truncated response is rejected.
  const from = new Date(startMs - 24 * 60 * 60_000).toISOString();
  const to = end.toISOString();
  const filter = `and(scheduled_start_at.gte.${from},scheduled_start_at.lt.${to}),and(scheduled_at.gte.${from},scheduled_at.lt.${to})`;
  const rows = await params.supabase.from('appointments')
    .select('id,clinic_id,patient_id,therapist_id,room_id,status,scheduled_at,scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,source_payload,is_active,deleted_at')
    .eq('clinic_id', id(params.clinicId)).is('deleted_at', null)
    .or(filter).limit(251);
  if (rows.error) throw rows.error;
  if (!Array.isArray(rows.data) || rows.data.length >= 251) {
    return { ok: false, code: 'GROUP_PREVIEW_APPOINTMENTS_TRUNCATED' };
  }
  return checkNewGroupSlotAgainstAppointments({
    authenticatedClinicId: params.clinicId,
    patientIds: params.patientIds, professionalIds: params.professionalIds,
    roomId: params.roomId, roomPreventsOverlap: params.roomPreventsOverlap,
    scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString(),
    existingAppointments: rows.data,
  });
}
