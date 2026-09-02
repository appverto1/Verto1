export type ClinicCostRecurrence = "weekly" | "monthly";

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDateOnlyUtc = (value: unknown): Date | null => {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const monthBoundsUtc = (monthKey: string) => {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || month < 1 || month > 12) return null;
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
};

export const normalizeClinicCostRecurrence = (value: unknown): ClinicCostRecurrence =>
  String(value || "").trim().toLowerCase() === "weekly" ? "weekly" : "monthly";

export const countClinicCostOccurrences = (cost: any, monthKey: string): number => {
  const bounds = monthBoundsUtc(monthKey);
  const startsOn = parseDateOnlyUtc(cost?.starts_on || cost?.startsOn || cost?.created_at || cost?.createdAt);
  if (!bounds || !startsOn || startsOn.getTime() > bounds.end.getTime()) return 0;

  if (normalizeClinicCostRecurrence(cost?.recurrence) === "monthly") return 1;

  const firstRelevantTime = Math.max(startsOn.getTime(), bounds.start.getTime());
  const elapsedDays = Math.ceil((firstRelevantTime - startsOn.getTime()) / DAY_MS);
  const firstOccurrence = new Date(startsOn.getTime() + Math.ceil(elapsedDays / 7) * 7 * DAY_MS);
  if (firstOccurrence.getTime() > bounds.end.getTime()) return 0;
  return Math.floor((bounds.end.getTime() - firstOccurrence.getTime()) / (7 * DAY_MS)) + 1;
};

export const projectClinicCostForMonth = (cost: any, monthKey: string) => {
  const occurrences = countClinicCostOccurrences(cost, monthKey);
  const unitAmount = Number(cost?.amount);
  return {
    occurrences,
    unitAmount: Number.isFinite(unitAmount) && unitAmount > 0 ? unitAmount : 0,
    total: occurrences * (Number.isFinite(unitAmount) && unitAmount > 0 ? unitAmount : 0),
  };
};
