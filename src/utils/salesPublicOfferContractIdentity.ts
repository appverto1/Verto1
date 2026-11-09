export const normalizeContractEmail = (value: unknown) =>
  String(value || '').trim().toLowerCase();

export const isValidContractEmail = (value: unknown) => {
  const email = normalizeContractEmail(value);
  return (
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
};

// Resolve the server-frozen contract identity without looking up or constructing a public URL.
// Priority and fallback preserve the original existing-offer behavior.
export const resolveFrozenPublicOfferContractEmail = (
  preparedOffer: { contract_email?: string | null } | null | undefined,
  selectedSimulationOffer: { contract_email?: string | null } | null | undefined
): string =>
  normalizeContractEmail(
    preparedOffer?.contract_email ||
      selectedSimulationOffer?.contract_email ||
      ''
  );
