import { clinicalSpecialtyScopeKey, type ClinicalSpecialtyScopeKey } from './clinicalSpecialties';

const clean = (value: unknown) => String(value ?? '').trim();

const parseObject = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export type SessionSpecialtyPlanLike = {
  id?: unknown;
  specialty?: unknown;
  status?: unknown;
  mode?: unknown;
};

export function appointmentClinicalSpecialtyKey(appointment: any): ClinicalSpecialtyScopeKey | null {
  const source = parseObject(appointment?.source_payload ?? appointment?.sourcePayload);
  const candidates = [
    appointment?.specialty,
    appointment?.specialty_name,
    appointment?.specialtyName,
    appointment?.service_type,
    appointment?.serviceType,
    appointment?.service_name,
    appointment?.serviceName,
    appointment?.approach,
    source?.specialty,
    source?.specialty_name,
    source?.specialtyName,
    source?.service_type,
    source?.serviceType,
    source?.service_name,
    source?.serviceName,
    source?.approach,
  ];
  for (const candidate of candidates) {
    const key = clinicalSpecialtyScopeKey(candidate);
    if (key) return key;
  }
  return null;
}

export function planClinicalSpecialtyKey(plan: SessionSpecialtyPlanLike | null | undefined): ClinicalSpecialtyScopeKey | null {
  return clinicalSpecialtyScopeKey(plan?.specialty);
}

export function sessionPlanMatchesAppointmentSpecialty(
  plan: SessionSpecialtyPlanLike | null | undefined,
  appointment: any,
): boolean {
  const appointmentKey = appointmentClinicalSpecialtyKey(appointment);
  if (!appointmentKey) return true;
  return planClinicalSpecialtyKey(plan) === appointmentKey;
}

export function sessionSpecialtyPlanCandidates<T extends SessionSpecialtyPlanLike>(
  plans: readonly T[],
  appointment: any,
): T[] {
  const appointmentKey = appointmentClinicalSpecialtyKey(appointment);
  if (!appointmentKey) return [];
  return plans.filter((plan) => {
    const status = clean(plan?.status).toLowerCase();
    const mode = clean(plan?.mode).toLowerCase();
    return status === 'active'
      && mode !== 'interdisciplinary'
      && planClinicalSpecialtyKey(plan) === appointmentKey;
  });
}
