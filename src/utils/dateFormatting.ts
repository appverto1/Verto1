const padDatePart = (value: number) => String(value).padStart(2, '0');

const parseDateOnly = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  };
};

const getDisplayDateParts = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: String(value.getFullYear()),
      month: padDatePart(value.getMonth() + 1),
      day: padDatePart(value.getDate()),
      date: value
    };
  }

  const raw = String(value).trim();
  const dateOnly = parseDateOnly(raw);
  if (dateOnly) return dateOnly;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: String(date.getFullYear()),
    month: padDatePart(date.getMonth() + 1),
    day: padDatePart(date.getDate()),
    date
  };
};

export const formatDisplayDate = (value: unknown, fallback = '-') => {
  const parts = getDisplayDateParts(value);
  if (!parts) return fallback;
  return `${parts.day}/${parts.month}/${parts.year}`;
};

export const formatDisplayTime = (value: unknown, fallback = '-') => {
  const parts = getDisplayDateParts(value);
  if (!parts) return fallback;
  return parts.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const formatDisplayDateTime = (
  value: unknown,
  options: { fallback?: string; separator?: string } = {}
) => {
  const parts = getDisplayDateParts(value);
  if (!parts) return options.fallback || '-';
  const time = parts.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${parts.day}/${parts.month}/${parts.year}${options.separator ?? ' '}${time}`;
};

export const formatDisplayMonthYear = (value: unknown, fallback = '-') => {
  const parts = getDisplayDateParts(value);
  if (!parts) return fallback;
  return `${parts.month}/${parts.year}`;
};

export const parseDisplayDate = (value: string) => {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
};
