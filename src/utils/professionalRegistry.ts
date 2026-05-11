export const formatProfessionalRegistry = (value: unknown): string => {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 7);

  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

export const normalizeProfessionalRegistry = (value: unknown): string => {
  return formatProfessionalRegistry(value).trim();
};
