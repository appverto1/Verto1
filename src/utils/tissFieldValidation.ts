export const TISS_PROVIDER_CODE_MAX_LENGTH = 14;

export const normalizeTissCivilDate = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return text;
};

export const isValidTissCivilDate = (value: unknown): boolean => Boolean(normalizeTissCivilDate(value));

export const getTissProviderCodeLengthError = (
  value: unknown,
  label = "Código do prestador",
): string => {
  const text = String(value ?? "").trim();
  if (text.length <= TISS_PROVIDER_CODE_MAX_LENGTH) return "";
  return `${label} deve ter no máximo ${TISS_PROVIDER_CODE_MAX_LENGTH} caracteres. “${text}” possui ${text.length}; o valor não foi salvo nem truncado.`;
};
