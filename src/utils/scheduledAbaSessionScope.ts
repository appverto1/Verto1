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
  if (!appointmentSpecialty && (sessionSpecialty || sessionPlanSpecialty))
    return 'SESSION_SPECIALTY_UNVERIFIED';
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

