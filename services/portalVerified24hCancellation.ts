/**
 * P1-27. The browser only submits a notification ID. Only the backend's
 * service-role RPC can check its persisted origin and atomically cancel
 * a session. All non-24h/non-eligible requests keep the existing clinic
 * approval flow, including notifications from 12h reminders.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeText = (value: unknown, n: number) =>
  String(value == null ? '' : value).trim().slice(0, n);

export async function tryCancelFromVerified24hReminder(params: {
  supabase: any;
  deploymentEnv: string;
  appointment: any;
  actor: any;
  notificationId: unknown;
  reason?: unknown;
  note?: unknown;
}): Promise<{ applied: boolean; idempotent?: boolean; appointment?: any; request?: any; reason?: string }> {
  const notificationId = safeText(params.notificationId, 120);
  if (!UUID.test(notificationId)) return { applied: false, reason: 'NOTIFICATION_MISSING' };
  const appointment = params.appointment || {};
  const organizationId = safeText(appointment.organization_id || appointment.clinic_id, 120);
  const clinicId = safeText(appointment.clinic_id, 120);
  const patientId = safeText(appointment.patient_id, 120);
  const appointmentId = safeText(appointment.id, 120);
  const actorId = safeText(params.actor?.id, 120);
  const deploymentEnv = safeText(params.deploymentEnv, 80);
  if (![organizationId, clinicId, patientId, appointmentId, actorId].every(id => UUID.test(id)) ||
    !deploymentEnv) return { applied: false, reason: 'SCOPE_INVALID' };
  const result = await params.supabase.rpc('cancel_appointment_from_verified_24h_reminder_v1', {
    p_organization_id: organizationId,
    p_clinic_id: clinicId,
    p_patient_id: patientId,
    p_appointment_id: appointmentId,
    p_actor_id: actorId,
    p_actor_email: safeText(params.actor?.email, 320).toLowerCase(),
    p_notification_id: notificationId,
    p_deployment_env: deploymentEnv,
    p_reason: safeText(params.reason, 600),
    p_note: safeText(params.note, 1000),
  });
  if (result.error) {
    // Missing schema while staging is not yet deployed is not permission.
    // Fail back to the *manual request* workflow; never directly update status.
    const code = String(result.error.code || '');
    if (code === '42883' || code === 'PGRST202' || code === '42P01') {
      return { applied: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw result.error;
  }
  const outcome = result.data;
  if (!outcome || outcome.applied !== true) {
    return { applied: false, reason: safeText(outcome?.reason, 80) || 'NOT_ELIGIBLE' };
  }
  if (!outcome.appointment || String(outcome.appointment.id) !== appointmentId ||
      String(outcome.appointment.patient_id) !== patientId ||
      !['cancelled','canceled'].includes(String(outcome.appointment.status || '').toLowerCase())) {
    throw new Error('VERIFIED_24H_CANCELLATION_RESPONSE_INCONSISTENT');
  }
  return {
    applied: true,
    idempotent: outcome.idempotent === true,
    appointment: outcome.appointment,
    request: outcome.request || null,
  };
}
