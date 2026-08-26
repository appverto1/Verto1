/**
 * Converts an absolute instant (ISO/Date) to the wall-clock value expected by
 * <input type="datetime-local"> without leaking UTC into the UI.
 *
 * datetime-local has no timezone. We therefore shift by the browser's offset
 * only for display and convert the selected local wall-clock time back to ISO
 * when persisting. This preserves the same instant across save/reopen cycles.
 */
export const toDateTimeLocalValue = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';

  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
};

/**
 * Converts the wall-clock value emitted by datetime-local into a canonical ISO
 * instant. The browser interprets YYYY-MM-DDTHH:mm in its local timezone.
 */
export const fromDateTimeLocalValue = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};
