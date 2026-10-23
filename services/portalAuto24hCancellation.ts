export async function tryAutomatic24hPortalCancellation(params: {
  supabase: any;
  appointment: any;
  actorId: string;
  deploymentEnv: string;
  reason?: unknown;
}): Promise<any> {
  const appointment = params.appointment || {};
  const result = await params.supabase.rpc('cancel_portal_appointment_from_sent_24h_v1', {
    p_organization_id: appointment.organization_id || appointment.clinic_id,
    p_appointment_id: appointment.id,
    p_patient_id: appointment.patient_id,
    p_actor_id: params.actorId,
    p_deployment_env: params.deploymentEnv,
    p_reason: typeof params.reason === 'string' ? params.reason.slice(0,600) : null,
  });
  if (result.error) {
    if (result.error.code === 'PGRST202') return { automatic: false };
    throw result.error;
  }
  return result.data?.automatic === true ? result.data : { automatic: false };
}
