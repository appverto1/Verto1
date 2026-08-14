export const SALES_TRIAL_DAY_OPTIONS = [0, 7, 14, 30] as const;

export type SalesTrialDays = (typeof SALES_TRIAL_DAY_OPTIONS)[number];

export function parseSalesTrialDays(value: unknown): SalesTrialDays | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return SALES_TRIAL_DAY_OPTIONS.includes(numeric as SalesTrialDays)
    ? (numeric as SalesTrialDays)
    : null;
}

export function normalizeSalesTrialDays(
  value: unknown,
  fallback: SalesTrialDays = 0,
): SalesTrialDays {
  return parseSalesTrialDays(value) ?? fallback;
}

export type FrozenSalesOfferTrialSource = {
  trial_days?: unknown;
  modular_snapshot?: { trialDays?: unknown } | null;
  simulation_snapshot?: { input?: { trialDays?: unknown } | null } | null;
};

export function resolveFrozenSalesOfferTrialDays(
  offer: FrozenSalesOfferTrialSource,
): SalesTrialDays {
  const candidates = [
    ['sales_offers.trial_days', offer?.trial_days],
    ['sales_offers.modular_snapshot.trialDays', offer?.modular_snapshot?.trialDays],
    ['sales_offers.simulation_snapshot.input.trialDays', offer?.simulation_snapshot?.input?.trialDays],
  ] as const;

  const parsed: SalesTrialDays[] = [];
  for (const [source, value] of candidates) {
    if (value === null || value === undefined || value === '') continue;
    const trialDays = parseSalesTrialDays(value);
    if (trialDays === null) {
      throw new Error(`MODULAR_CHECKOUT_RECONCILIATION_FAILED:${source}`);
    }
    parsed.push(trialDays);
  }

  if (new Set(parsed).size > 1) {
    throw new Error('MODULAR_CHECKOUT_RECONCILIATION_FAILED:trial_snapshot_mismatch');
  }

  return parsed[0] ?? 0;
}
