export const normalizeId = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length > 80 || !/\d{4}-\d\d-\d\d/.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
};
export const responded = new Set(['confirmed', 'confirmado', 'accepted', 'cancelled', 'canceled', 'cancel_requested', 'cancellation_requested', 'reschedule_requested', 'rescheduled', 'rejected']);
