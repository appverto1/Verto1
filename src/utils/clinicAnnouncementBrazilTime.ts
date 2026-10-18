/**
 * Clinic announcements are scheduled in Brasília, regardless of the device's
 * timezone. The backend still receives an absolute ISO timestamp.
 * No network/database reads or third-party timezone dependency.
 */
const BRAZIL_ZONE = 'America/Sao_Paulo';
const brazilInputFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BRAZIL_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const localClockPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const formatBrazilScheduleInput = (instant: Date) =>
  brazilInputFormatter.format(instant).replace(' ', 'T');

export const parseBrazilScheduleInput = (localValue: string): Date | null => {
  const match = localClockPattern.exec(localValue);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const utcValidation = new Date(wallClock);
  if (utcValidation.getUTCFullYear() !== year || utcValidation.getUTCMonth() + 1 !== month ||
      utcValidation.getUTCDate() !== day) return null;
  let guess = wallClock + 3 * 60 * 60 * 1000;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = localClockPattern.exec(formatBrazilScheduleInput(new Date(guess)));
    if (!parts) return null;
    const [, y, mo, d, h, mi] = parts.map(Number);
    const actualWallClock = Date.UTC(y, mo - 1, d, h, mi);
    guess += wallClock - actualWallClock;
  }
  const instant = new Date(guess);
  return formatBrazilScheduleInput(instant) === localValue ? instant : null;
};

export const isBrazilQuietHour = (instant: Date) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: BRAZIL_ZONE, hour: '2-digit', hourCycle: 'h23'
  }).format(instant));
  return hour >= 22 || hour < 6;
};

export const formatBrazilHistoryTimestamp = (instant: Date) =>
  instant.toLocaleString('pt-BR', {
    timeZone: BRAZIL_ZONE, day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
