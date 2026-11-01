import { isRecoverableFailedOfflineSyncRecord, type OfflineSyncStatus } from './offlineSyncResilience';
import { appointmentClinicalSpecialtyKey } from './sessionSpecialtyIsolation';
import { clinicalSpecialtyScopeKey } from './clinicalSpecialties';


/**
 * Fail-closed scope check before reusing a locally persisted clinical session
 * from an explicit Agenda appointment. This is a UI safety barrier, NOT an
 * authorization check. The server/SQL must still validate the persisted link.
 *
 * Never infer that a missing appointment id means it is safe to attach a
 * different appointment: legacy sessions require an authenticated recovery.
 */
export function scheduledAbaSessionScopeMismatch(
  existing: any,
  appointment: any,
  expected: { patientId: string; clinicId: string },
): string | null {
  if (!existing || !appointment) return 'SESSION_CONTEXT_MISSING';
  const id = (value: unknown) => String(value ?? '').trim();
  const sessionPatientId = id(existing.patientId || existing.patient_id);
  const appointmentPatientId = id(appointment.patientId || appointment.patient_id);
  const sessionClinicId = id(existing.clinicId || existing.clinic_id);
  const appointmentClinicId = id(appointment.clinicId || appointment.clinic_id || appointment.organizationId || appointment.organization_id);
  const sessionAppointmentId = id(existing.appointmentId || existing.appointment_id);
  const appointmentId = id(appointment.appointment_id || appointment.appointmentId || appointment.id);
  const expectedClinicId = id(expected.clinicId);
  if (!expected.patientId || !expectedClinicId || !appointmentId ||
      !appointmentPatientId || !sessionPatientId || !sessionClinicId ||
      !appointmentClinicId) return 'SESSION_SCOPE_UNVERIFIED';
  if (sessionPatientId !== id(expected.patientId) || appointmentPatientId !== id(expected.patientId) ||
      sessionClinicId !== expectedClinicId || appointmentClinicId !== expectedClinicId)
    return 'SESSION_PATIENT_CLINIC_MISMATCH';
  if (!sessionAppointmentId) return 'SESSION_LEGACY_LINK_REVIEW_REQUIRED';
  if (sessionAppointmentId !== appointmentId) return 'SESSION_APPOINTMENT_MISMATCH';

  const sessionProfessionalId = id(existing.professionalId || existing.professional_id || existing.therapistId || existing.therapist_id);
  const appointmentProfessionalId = id(appointment.professionalId || appointment.professional_id || appointment.therapistId || appointment.therapist_id);
  if (!sessionProfessionalId || !appointmentProfessionalId)
    return 'SESSION_PROFESSIONAL_UNVERIFIED';
  if (sessionProfessionalId !== appointmentProfessionalId)
    return 'SESSION_PROFESSIONAL_MISMATCH';

  const appointmentSpecialty = appointmentClinicalSpecialtyKey(appointment);
  const sessionSpecialty = clinicalSpecialtyScopeKey(existing.serviceType || existing.service_type);
  const sessionPlanSpecialty = clinicalSpecialtyScopeKey(existing.therapeuticPlanSpecialty || existing.therapeutic_plan_specialty);
  if (appointmentSpecialty && !sessionSpecialty && !sessionPlanSpecialty)
    return 'SESSION_SPECIALTY_UNVERIFIED';
  if (appointmentSpecialty && (
    (sessionSpecialty && sessionSpecialty !== appointmentSpecialty) ||
    (sessionPlanSpecialty && sessionPlanSpecialty !== appointmentSpecialty)
  )) return 'SESSION_SPECIALTY_MISMATCH';

  const appointmentPlanId = id(appointment.therapeuticPlanId || appointment.therapeutic_plan_id);
  const sessionPlanId = id(existing.therapeuticPlanId || existing.therapeutic_plan_id);
  if (appointmentPlanId && appointmentPlanId !== sessionPlanId)
    return 'SESSION_THERAPEUTIC_PLAN_MISMATCH';
  if (!['active', 'in_progress'].includes(id(existing.status).toLowerCase()))
    return 'SESSION_NOT_ACTIVE';
  return null;
}

/**
 * Appointment recovery must be server-authoritative. A queued/optimistic write,
 * another patient's session or a different appointment cannot open SessionMode.
 */
export function isConfirmedAbaSessionAppointmentLink(
  result: any,
  expected: { sessionId: string; patientId: string; appointmentId: string }
): boolean {
  const saved = result?.session || result?.data;
  return result?.success === true
    && result?.pending !== true
    && result?.offline !== true
    && String(saved?.id || '') === expected.sessionId
    && String(saved?.patient_id || saved?.patientId || '') === expected.patientId
    && String(saved?.appointment_id || saved?.appointmentId || '') === expected.appointmentId;
}

export const AUTOMATIC_SESSION_CLOSURE_KEYS = new Set([
  'open_duration', 'open_interval_collection', 'therapeutic_measurement_timer_open',
  'unsaved_local_records', 'server_sync_required', 'v3_failed_trials_require_resolution'
]);

export type SessionQueueRecord = {
  id: string;
  entity_id?: string;
  type: string;
  sync_status?: OfflineSyncStatus;
  last_updated?: number;
  last_error?: string | null;
  method?: string;
  endpoint: string;
  data?: any;
};

export function queuedSessionId(record: SessionQueueRecord): string {
  const explicitSessionId = String(record?.data?.session_id || record?.data?.sessionId || '').trim();
  if (explicitSessionId) return explicitSessionId;
  const match = String(record?.endpoint || '').match(/^\/api\/aba\/sessions\/([^/]+)\/(?:complete|.*)$/);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isSessionCompletionQueueRecord(record: SessionQueueRecord): boolean {
  return record?.type === 'aba'
    && String(record?.method || 'POST').toUpperCase() === 'POST'
    && /^\/api\/aba\/sessions\/[^/]+\/complete$/.test(String(record?.endpoint || ''));
}

export function isDurableDeferredSessionRecord(record: SessionQueueRecord): boolean {
  if (record?.sync_status === 'pending') return true;
  return record?.sync_status === 'failed' && isRecoverableFailedOfflineSyncRecord(record);
}

export function partitionSessionQueueForClosure(records: SessionQueueRecord[]) {
  const durable: SessionQueueRecord[] = [];
  const terminal: SessionQueueRecord[] = [];
  for (const record of records || []) {
    if (isDurableDeferredSessionRecord(record)) durable.push(record);
    else terminal.push(record);
  }
  return { durable, terminal };
}

export function hasUnresolvedSessionPredecessor(
  completion: SessionQueueRecord,
  records: SessionQueueRecord[]
): boolean {
  if (!isSessionCompletionQueueRecord(completion)) return false;
  const sessionId = queuedSessionId(completion);
  if (!sessionId) return true;
  return (records || []).some((candidate) => {
    if (!candidate || candidate.id === completion.id || isSessionCompletionQueueRecord(candidate)) return false;
    if (queuedSessionId(candidate) !== sessionId) return false;
    // Close is the final causal barrier for the session. Even a clinical write
    // persisted a few milliseconds later (clock drift / pending callbacks)
    // must be replayed before completion, or the server will reject it as closed.
    return candidate.sync_status !== 'synced';
  });
}

export function isQueuedRecordForSession(record: SessionQueueRecord, sessionId: string, entityIds: string[] = []) {
  if (!['aba', 'aba_v3'].includes(record.type)) return false;
  const explicitSessionId = queuedSessionId(record);
  if (explicitSessionId) return explicitSessionId === sessionId;
  return String(record.entity_id || record.id) === sessionId
    || entityIds.includes(String(record.entity_id || record.id));
}

export function therapeuticTimerCompletion(timer: {
  startedAt: string; runningSince: string | null; accumulatedMs: number;
}, endedAt: string) {
  const endMs = Date.parse(endedAt);
  const startMs = Date.parse(timer.startedAt);
  const runningMs = timer.runningSince ? Date.parse(timer.runningSince) : endMs;
  if (![endMs, startMs, runningMs].every(Number.isFinite) || endMs < startMs) {
    throw new Error('O cronômetro possui horários inválidos. O registro foi preservado.');
  }
  const totalMs = Math.max(0, Number(timer.accumulatedMs || 0))
    + (timer.runningSince ? Math.max(0, endMs - runningMs) : 0);
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error('O cronômetro ainda não possui tempo observado para salvar.');
  }
  return { totalMs, seconds: totalMs / 1000, effectiveStartedAt: new Date(endMs - totalMs).toISOString() };
}

export async function waitForSessionWrites(hasWrites: () => boolean, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (hasWrites()) {
    if (Date.now() >= deadline) throw new Error('A gravação ainda está em andamento. Os dados foram preservados; tente finalizar novamente.');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
