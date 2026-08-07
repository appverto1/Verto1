import { buildClinicDateRange, formatDateInAppointmentTimezone } from './scheduling';

const TISS_TEST_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const normalizeTissPreGuideTestMonth = (value: unknown): string => {
  const normalized = String(value ?? '').trim();
  return TISS_TEST_MONTH_PATTERN.test(normalized) ? normalized : '';
};

export const currentTissPreGuideTestMonth = (reference: Date = new Date()): string => (
  formatDateInAppointmentTimezone(reference).slice(0, 7)
);

export const buildTissPreGuideTestMonthRange = (value: unknown) => {
  const month = normalizeTissPreGuideTestMonth(value);
  if (!month) return { month: '', from: '', to: '' };

  const [yearText, monthText] = month.split('-');
  const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  const range = buildClinicDateRange(
    `${month}-01`,
    `${month}-${String(lastDay).padStart(2, '0')}`,
  );
  return { month, ...range };
};

export const formatTissPreGuideTestMonthLabel = (value: unknown, fallback = 'período selecionado'): string => {
  const month = normalizeTissPreGuideTestMonth(value);
  if (!month) return fallback;
  const [yearText, monthText] = month.split('-');
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)));
};
