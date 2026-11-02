// Synthetic group-session fixtures must remain ahead of the financial plan valid_from=now().
// Preserve original weekdays, spacing and clinic-local hour by advancing whole weeks.
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_MONDAY = Date.UTC(2026, 10, 2);
const leadTime = Date.now() + 14 * DAY_MS - BASE_MONDAY;
const shiftWeeks = Math.max(0, Math.ceil(leadTime / (7 * DAY_MS)));
const shiftMs = shiftWeeks * 7 * DAY_MS;

export function shiftGroupFixtureDates(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\b2026-(?:11|12)-\d{2}\b/g, (day) => {
    const parsed = Date.parse(day + 'T00:00:00Z');
    return Number.isFinite(parsed)
      ? new Date(parsed + shiftMs).toISOString().slice(0, 10)
      : day;
  });
}
