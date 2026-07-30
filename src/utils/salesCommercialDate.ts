const SALES_COMMERCIAL_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC'
});

export const formatSalesCommercialDate = (
  value: unknown,
  fallback = 'Data não informada'
) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? fallback
    : SALES_COMMERCIAL_DATE_FORMATTER.format(date);
};
