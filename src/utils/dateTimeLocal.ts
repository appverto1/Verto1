import {
  buildAppointmentDateTime,
  formatDateInAppointmentTimezone,
  formatTimeInAppointmentTimezone,
} from './scheduling';
import { DEFAULT_CLINIC_TIME_ZONE, resolveClinicTimeZone } from './clinicTimeZone';

/**
 * Converts an absolute instant (ISO/Date) to the wall-clock value expected by
 * <input type="datetime-local"> in the clinic's canonical IANA timezone.
 *
 * datetime-local intentionally has no timezone. Clinical timestamps therefore
 * must never inherit the operator device timezone; the clinic timezone is the
 * display authority and the database remains UTC.
 */
export const toDateTimeLocalValue = (
  value: string | Date | null | undefined,
  timeZone = DEFAULT_CLINIC_TIME_ZONE,
): string => {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const resolvedTimeZone = resolveClinicTimeZone({ timeZone });
  const dateKey = formatDateInAppointmentTimezone(parsed, resolvedTimeZone);
  const timeKey = formatTimeInAppointmentTimezone(parsed, resolvedTimeZone);
  return dateKey && timeKey ? `${dateKey}T${timeKey}` : '';
};

/**
 * Converts a clinic wall-clock datetime emitted by datetime-local into a
 * canonical UTC ISO instant using the clinic's IANA timezone. The device/browser
 * timezone is deliberately ignored.
 */
export const fromDateTimeLocalValue = (
  value: string | null | undefined,
  timeZone = DEFAULT_CLINIC_TIME_ZONE,
): string => {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!match) return '';
  const resolvedTimeZone = resolveClinicTimeZone({ timeZone });
  const parsed = buildAppointmentDateTime(match[1], match[2], resolvedTimeZone);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
};
