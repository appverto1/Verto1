import { clinicalSpecialtyScopeKey } from './clinicalSpecialties';
import { sessionPlanMatchesAppointmentSpecialty } from './sessionSpecialtyIsolation';

export type SessionTabSpecialtyOption = {
  id: string;
  specialty: string;
  label: string;
};

/**
 * A session started from the patient's Sessão tab must not silently switch to
 * a generic collection or mix specialties. Only active, server-authorized
 * specialty plans for this patient are eligible; Agenda also pins the
 * appointment's specialty. This is UI filtering, not backend authorization.
 */
export function sessionTabSpecialtyOptions(scopes: unknown, appointment?: any): SessionTabSpecialtyOption[] {
  if (!Array.isArray(scopes)) return [];
  const seen = new Set<string>();
  return scopes.flatMap((plan: any) => {
    const id = String(plan?.id || '').trim();
    const specialty = String(plan?.specialty || '').trim();
    if (!id || !specialty || seen.has(id) ||
        !clinicalSpecialtyScopeKey(specialty) ||
        String(plan?.mode || '').trim().toLowerCase() !== 'specialty' ||
        String(plan?.status || '').trim().toLowerCase() !== 'active' ||
        plan?.canEdit !== true ||
        (appointment && !sessionPlanMatchesAppointmentSpecialty(plan, appointment))) return [];
    seen.add(id);
    const title = String(plan?.title || plan?.name || '').trim();
    return [{ id, specialty, label: title && title !== specialty ? `${specialty} · ${title}` : specialty }];
  });
}
