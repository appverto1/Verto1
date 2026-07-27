export type AppointmentCancellationOrigin = 'patient' | 'clinic' | 'unknown' | null;

export type AppointmentCancellationState = {
  isCancelled: boolean;
  origin: AppointmentCancellationOrigin;
  status: 'declined' | 'cancelled_by_clinic' | 'cancelled' | null;
  label: 'CANCELADO PELO PACIENTE' | 'CANCELADO PELA CLÍNICA' | 'CANCELADO' | '';
  message: string;
  source: string | null;
};

const normalizeKey = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isCancelledStatus = (value: unknown) => {
  const normalized = normalizeKey(value);
  return [
    'cancel',
    'canceled',
    'cancelled',
    'cancelada',
    'cancelado',
    'cancelled_by_clinic',
    'cancelado_pela_clinica'
  ].includes(normalized);
};

const isPatientDecline = (value: unknown) => {
  const normalized = normalizeKey(value);
  return [
    'cancel_requested',
    'cancelamento_solicitado',
    'declined',
    'decline',
    'recusado',
    'recusada',
    'cancelled_by_patient',
    'cancelado_pelo_paciente'
  ].includes(normalized);
};

const isPatientSource = (value: unknown) => {
  const normalized = normalizeKey(value);
  return (
    normalized === 'portal' ||
    normalized === 'patient' ||
    normalized === 'responsible' ||
    normalized === 'family' ||
    normalized === 'appointment_status_audit_logs' ||
    normalized.includes('patient_request') ||
    normalized.includes('patient') ||
    normalized.includes('patient_portal') ||
    normalized.includes('responsible') ||
    normalized.includes('family')
  );
};

const isClinicSource = (value: unknown) => {
  const normalized = normalizeKey(value);
  return (
    normalized === 'clinic' ||
    normalized === 'agenda_management' ||
    normalized === 'appointment_confirmation_popup' ||
    normalized === 'coordinator' ||
    normalized === 'receptionist' ||
    normalized === 'therapist' ||
    normalized === 'admin' ||
    normalized === 'owner' ||
    normalized.includes('clinic') ||
    normalized.includes('agenda_management')
  );
};

export function resolveAppointmentCancellationState(appointment: any): AppointmentCancellationState {
  const appointmentStatus = appointment?.status || appointment?.appointment_status;
  const confirmationStatus =
    appointment?.patientConfirmationStatus ||
    appointment?.patient_confirmation_status ||
    appointment?.patientResponse ||
    appointment?.patient_response;
  const source =
    appointment?.patientConfirmationSource ||
    appointment?.patient_confirmation_source ||
    appointment?.patient_response_source ||
    appointment?.cancellationSource ||
    appointment?.cancellation_source ||
    null;
  const cancelled = isCancelledStatus(appointmentStatus);

  if (!cancelled) {
    return {
      isCancelled: false,
      origin: null,
      status: null,
      label: '',
      message: '',
      source: source ? String(source) : null
    };
  }

  const patientDecline = isPatientDecline(confirmationStatus);
  if (patientDecline && isPatientSource(source)) {
    return {
      isCancelled: true,
      origin: 'patient',
      status: 'declined',
      label: 'CANCELADO PELO PACIENTE',
      message: 'Sessão cancelada pelo paciente/responsável.',
      source: source ? String(source) : 'patient'
    };
  }

  if (
    isClinicSource(source) ||
    (!source && isCancelledStatus(appointmentStatus)) ||
    (!patientDecline && isPatientSource(source) && isCancelledStatus(appointmentStatus))
  ) {
    return {
      isCancelled: true,
      origin: 'clinic',
      status: 'cancelled_by_clinic',
      label: 'CANCELADO PELA CLÍNICA',
      message: 'Esta sessão foi cancelada pela clínica.',
      source: source ? String(source) : 'clinic'
    };
  }

  return {
    isCancelled: true,
    origin: 'unknown',
    status: 'cancelled',
    label: 'CANCELADO',
    message: 'Esta sessão foi cancelada.',
    source: source ? String(source) : null
  };
}
