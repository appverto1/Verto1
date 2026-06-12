import { applyActionResult, type ActionResult } from './actionResult';

export type AppointmentDomainEvent = {
  eventId: string;
  eventType: string;
  clinicId: string | null;
  patientId: string | null;
  professionalId: string | null;
  appointmentId: string;
  createdBy: string | null;
  idempotencyKey: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

const appointmentTimestamp = (appointment: any) => {
  const scheduledAt =
    appointment?.scheduledAt ||
    appointment?.scheduled_at ||
    appointment?.scheduledStartAt ||
    appointment?.scheduled_start_at;
  if (scheduledAt) {
    const parsed = new Date(scheduledAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const date = String(appointment?.date || "").trim();
  const time = String(appointment?.time || "").trim();
  const parsed = date && time ? new Date(`${date}T${time}:00`).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

export const sortAppointments = (appointments: any[]) =>
  [...appointments].sort((left, right) => {
    const byTimestamp = appointmentTimestamp(left) - appointmentTimestamp(right);
    if (byTimestamp !== 0) return byTimestamp;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });

const normalizePatientLabel = (value: any) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isGenericPatientLabel = (value: any) => {
  const normalized = normalizePatientLabel(value);
  return !normalized || normalized === "paciente" || normalized === "patient" || normalized === "cliente";
};

const parseAppointmentSourcePayload = (appointment: any) => {
  const source = appointment?.source_payload || appointment?.sourcePayload;
  if (!source) return {};
  if (typeof source === "object" && !Array.isArray(source)) return source;
  if (typeof source !== "string") return {};
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const pickPatientLabel = (candidates: any[]) => {
  const labels = candidates.map((value) => String(value || "").trim()).filter(Boolean);
  return labels.find((label) => !isGenericPatientLabel(label)) || labels[0] || "";
};

const appointmentPatientNameCandidates = (appointment: any) => {
  const source = parseAppointmentSourcePayload(appointment);
  return [
    appointment?.patientName,
    appointment?.patient_name,
    appointment?.name,
    appointment?.patient?.name,
    source?.patientName,
    source?.patient_name,
    source?.name,
    source?.patient?.name,
  ];
};

export const mergeAppointmentIdentity = (current: any = {}, incoming: any = {}) => {
  const merged = { ...(current || {}), ...(incoming || {}) };
  const patientName = pickPatientLabel([
    ...appointmentPatientNameCandidates(incoming),
    ...appointmentPatientNameCandidates(current),
  ]);
  if (!patientName) return merged;
  return {
    ...merged,
    patientName,
    patient_name: patientName,
    name: patientName,
  };
};

export const mergeAppointmentIdentityFallbacks = (incoming: any[], fallback: any[] = []) => {
  const fallbackById = new Map(
    (Array.isArray(fallback) ? fallback : [])
      .filter((appointment) => String(appointment?.id || "").trim())
      .map((appointment) => [String(appointment.id), appointment]),
  );
  return (Array.isArray(incoming) ? incoming : []).map((appointment) => {
    const id = String(appointment?.id || "").trim();
    return id && fallbackById.has(id)
      ? mergeAppointmentIdentity(fallbackById.get(id), appointment)
      : mergeAppointmentIdentity({}, appointment);
  });
};

export const mergePersistedAppointments = (current: any[], persisted: any[]) => {
  const byId = new Map(
    (Array.isArray(current) ? current : [])
      .filter((appointment) => String(appointment?.id || "").trim())
      .map((appointment) => [String(appointment.id), appointment]),
  );

  for (const appointment of Array.isArray(persisted) ? persisted : []) {
    const id = String(appointment?.id || "").trim();
    if (!id) continue;
    byId.set(id, mergeAppointmentIdentity(byId.get(id), appointment));
  }

  return sortAppointments(Array.from(byId.values()));
};

export const removePersistedAppointments = (current: any[], appointmentIds: unknown[]) => {
  const ids = new Set((Array.isArray(appointmentIds) ? appointmentIds : []).map((id) => String(id)));
  return sortAppointments((Array.isArray(current) ? current : []).filter((appointment) => !ids.has(String(appointment?.id))));
};

export const applyAppointmentActionResult = (current: any[], result: ActionResult<any>) =>
  applyActionResult({
    entity: 'appointment',
    current,
    result,
    merge: mergePersistedAppointments,
    remove: removePersistedAppointments,
    sort: sortAppointments,
  });

export const emitAppointmentDomainEvents = (events: AppointmentDomainEvent[] | undefined) => {
  if (typeof window === "undefined" || !Array.isArray(events)) return;
  for (const event of events) {
    if (!event?.eventId || !event?.appointmentId || !event?.eventType) continue;
    window.dispatchEvent(new CustomEvent("verto:appointment-domain-event", { detail: event }));
  }
};
