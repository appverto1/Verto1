/**
 * Tenant boundaries for calendar conflict detection and administrative appointment actions.
 * Never trust clinic/organization/patient identity supplied by browser request bodies.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function resolveAuthenticatedCalendarScope(
  activeClinicId: unknown,
  sessionOrganizationId: unknown
): { clinicId: string; organizationId: string } {
  const clinicId = id(activeClinicId);
  if (!UUID.test(clinicId)) throw new Error('Contexto de clínica autenticada inválido para consultar conflitos.');
  const authenticatedOrganizationId = id(sessionOrganizationId);
  const organizationId = UUID.test(authenticatedOrganizationId) ? authenticatedOrganizationId : clinicId;
  return { clinicId, organizationId };
}

export function canManageAppointmentActionInClinic(params: {
  activeClinicId: unknown;
  appointmentClinicId: unknown;
  requestOrganizationId: unknown;
  appointmentOrganizationId: unknown;
  requestPatientId: unknown;
  appointmentPatientId: unknown;
  globalAccess?: boolean;
}): boolean {
  const activeClinicId = id(params.activeClinicId);
  const appointmentClinicId = id(params.appointmentClinicId);
  const requestOrganizationId = id(params.requestOrganizationId);
  const appointmentOrganizationId = id(params.appointmentOrganizationId);
  const requestPatientId = id(params.requestPatientId);
  const appointmentPatientId = id(params.appointmentPatientId);
  return UUID.test(appointmentClinicId)
    && UUID.test(requestOrganizationId)
    && UUID.test(appointmentOrganizationId)
    && UUID.test(requestPatientId)
    && UUID.test(appointmentPatientId)
    && requestOrganizationId === appointmentOrganizationId
    && requestPatientId === appointmentPatientId
    && (params.globalAccess === true || (UUID.test(activeClinicId) && activeClinicId === appointmentClinicId));
}
