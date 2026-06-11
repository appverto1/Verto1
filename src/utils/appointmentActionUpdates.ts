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

export const mergePersistedAppointments = (current: any[], persisted: any[]) => {
  const byId = new Map(
    (Array.isArray(current) ? current : [])
      .filter((appointment) => String(appointment?.id || "").trim())
      .map((appointment) => [String(appointment.id), appointment]),
  );

  for (const appointment of Array.isArray(persisted) ? persisted : []) {
    const id = String(appointment?.id || "").trim();
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...appointment });
  }

  return sortAppointments(Array.from(byId.values()));
};

export const removePersistedAppointments = (current: any[], appointmentIds: unknown[]) => {
  const ids = new Set((Array.isArray(appointmentIds) ? appointmentIds : []).map((id) => String(id)));
  return sortAppointments((Array.isArray(current) ? current : []).filter((appointment) => !ids.has(String(appointment?.id))));
};

export const emitAppointmentDomainEvents = (events: AppointmentDomainEvent[] | undefined) => {
  if (typeof window === "undefined" || !Array.isArray(events)) return;
  for (const event of events) {
    if (!event?.eventId || !event?.appointmentId || !event?.eventType) continue;
    window.dispatchEvent(new CustomEvent("verto:appointment-domain-event", { detail: event }));
  }
};
