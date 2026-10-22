import { clinicalSpecialtiesMatch } from '../src/utils/clinicalSpecialties';

/**
 * Specialty plans are clinically activated by an active specialist on the
 * patient's case. This never authorizes cross-specialty or cross-clinic access.
 * Supervisors and managers retain their existing separate approval authority.
 */
export const isSelfAuthoredSpecialtyPlan = (params: {
  actorId: string; actorRole: string; mode?: unknown;
  responsibleProfessionalId?: unknown; membership?: any; patientLink?: any;
  specialty?: unknown; clinicId: string; organizationId: string; patientId: string;
}): boolean => {
  const member = params.membership;
  const link = params.patientLink;
  return params.actorRole === 'therapist' &&
    params.mode === 'specialty' &&
    Boolean(params.actorId) &&
    String(params.responsibleProfessionalId || '') === params.actorId &&
    String(member?.user_id || '') === params.actorId &&
    String(member?.clinic_id || '') === params.clinicId &&
    String(member?.role || '') === 'therapist' &&
    String(member?.status || '') === 'active' &&
    clinicalSpecialtiesMatch(member?.specialty, params.specialty) &&
    String(link?.professional_id || '') === params.actorId &&
    String(link?.organization_id || '') === params.organizationId &&
    String(link?.patient_id || '') === params.patientId &&
    String(link?.status || '') === 'active' &&
    link?.permissions?.write !== false;
};

export const canActivateSpecialtyPlanForCase = async (params: {
  supabase: any; clinicId: string; organizationId: string; patientId: string;
  actorId: string; actorRole: string; plan: any;
}): Promise<boolean> => {
  const plan = params.plan;
  if (params.actorRole !== 'therapist' ||
      String(plan?.mode || '') !== 'specialty' ||
      String(plan?.responsible_professional_id || '') !== params.actorId ||
      String(plan?.clinic_id || '') !== params.clinicId ||
      String(plan?.organization_id || '') !== params.organizationId ||
      String(plan?.patient_id || '') !== params.patientId ||
      String(plan?.status || '') === 'archived') return false;

  const [memberResult, linkResult] = await Promise.all([
    params.supabase.from('clinic_memberships')
      .select('user_id,clinic_id,role,status,specialty')
      .eq('user_id', params.actorId).eq('clinic_id', params.clinicId)
      .eq('role', 'therapist').eq('status', 'active').limit(1).maybeSingle(),
    params.supabase.from('patient_professional_links')
      .select('organization_id,patient_id,professional_id,status,permissions')
      .eq('organization_id', params.organizationId).eq('patient_id', params.patientId)
      .eq('professional_id', params.actorId).eq('status','active').limit(1).maybeSingle(),
  ]);
  if (memberResult.error || linkResult.error) {
    throw memberResult.error || linkResult.error;
  }
  return isSelfAuthoredSpecialtyPlan({
    actorId: params.actorId, actorRole: params.actorRole,
    mode: plan.mode, responsibleProfessionalId: plan.responsible_professional_id,
    membership: memberResult.data, patientLink: linkResult.data,
    specialty: plan.specialty, clinicId: params.clinicId, organizationId: params.organizationId, patientId: params.patientId,
  });
};
