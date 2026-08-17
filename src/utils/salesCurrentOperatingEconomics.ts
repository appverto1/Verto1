import type { SalesAssumptionSnapshot } from './salesProfitability';

export const SALES_CURRENT_OPERATING_MODEL_VERSION = '2026-08-mei-v1' as const;


export const salesSnapshotUsesCurrentOperatingModel = (snapshot: unknown): boolean => {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const summary = (snapshot as Record<string, unknown>).currentOperatingSummary;
  if (!summary || typeof summary !== 'object') return false;
  return (summary as Record<string, unknown>).modelVersion ===
    SALES_CURRENT_OPERATING_MODEL_VERSION;
};


const CURRENT_OPERATING_STRUCTURAL_BLOCKERS = [
  'COMMERCIAL_PRICE_PER_PATIENT_MISSING:',
  'PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:',
] as const;

export const filterSalesCurrentOperatingTechnicalBlockers = (
  codes: readonly string[] | null | undefined
): string[] =>
  Array.from(
    new Set(
      (codes || []).filter(
        (code) =>
          code === 'PRICING_TOTAL_MISMATCH' ||
          CURRENT_OPERATING_STRUCTURAL_BLOCKERS.some((prefix) =>
            code.startsWith(prefix)
          )
      )
    )
  ).sort();

export type SalesCurrentOperatingRating =
  | 'healthy'
  | 'attention'
  | 'negative'
  | 'incomplete';

export type SalesCurrentOperatingSummary = {
  modelVersion: typeof SALES_CURRENT_OPERATING_MODEL_VERSION;
  regime: 'mei';
  revenueCents: number;
  meiDasMonthlyCents: number | null;
  stripeFeeCents: number | null;
  stripeFeeBasisPoints: number | null;
  stripeFixedFeeCents: number | null;
  supabaseMonthlyCostCents: number | null;
  railwayMonthlyCostCents: number | null;
  totalOperatingCostsCents: number | null;
  operatingResultCents: number | null;
  operatingMarginBasisPoints: number | null;
  targetOperatingMarginBasisPoints: number | null;
  targetGapCents: number | null;
  rating: SalesCurrentOperatingRating;
  missingFields: Array<
    | 'meiDasMonthlyCents'
    | 'stripeFeeBasisPoints'
    | 'stripeFixedFeeCents'
    | 'supabaseMonthlyCostCents'
    | 'railwayMonthlyCostCents'
  >;
};

const multiplyBasisPoints = (amountCents: number, basisPoints: number) =>
  Math.round((amountCents * basisPoints) / 10_000);

const ratioBasisPoints = (amountCents: number, revenueCents: number) =>
  revenueCents <= 0
    ? null
    : Math.round((amountCents * 10_000) / revenueCents);

export const calculateSalesCurrentOperatingSummary = (
  revenueCents: number,
  assumptions: SalesAssumptionSnapshot
): SalesCurrentOperatingSummary => {
  const values = assumptions.values;
  const missingFields: SalesCurrentOperatingSummary['missingFields'] = [];

  if (values.meiDasMonthlyCents == null) {
    missingFields.push('meiDasMonthlyCents');
  }
  if (values.stripeFeeBasisPoints == null) {
    missingFields.push('stripeFeeBasisPoints');
  }
  if (values.stripeFixedFeeCents == null) {
    missingFields.push('stripeFixedFeeCents');
  }
  if (values.supabaseMonthlyCostCents == null) {
    missingFields.push('supabaseMonthlyCostCents');
  }
  if (values.railwayMonthlyCostCents == null) {
    missingFields.push('railwayMonthlyCostCents');
  }

  const stripeFeeCents =
    values.stripeFeeBasisPoints == null || values.stripeFixedFeeCents == null
      ? null
      : multiplyBasisPoints(revenueCents, values.stripeFeeBasisPoints) +
        values.stripeFixedFeeCents;

  const totalOperatingCostsCents =
    values.meiDasMonthlyCents == null ||
    stripeFeeCents == null ||
    values.supabaseMonthlyCostCents == null ||
    values.railwayMonthlyCostCents == null
      ? null
      : values.meiDasMonthlyCents +
        stripeFeeCents +
        values.supabaseMonthlyCostCents +
        values.railwayMonthlyCostCents;

  const operatingResultCents =
    totalOperatingCostsCents == null
      ? null
      : revenueCents - totalOperatingCostsCents;
  const operatingMarginBasisPoints =
    operatingResultCents == null
      ? null
      : ratioBasisPoints(operatingResultCents, revenueCents);
  const targetOperatingMarginBasisPoints =
    values.currentOperatingMarginTargetBasisPoints ?? 7_000;
  const targetResultCents =
    revenueCents > 0 && targetOperatingMarginBasisPoints != null
      ? multiplyBasisPoints(revenueCents, targetOperatingMarginBasisPoints)
      : null;
  const targetGapCents =
    targetResultCents == null || operatingResultCents == null
      ? null
      : Math.max(0, targetResultCents - operatingResultCents);

  let rating: SalesCurrentOperatingRating = 'incomplete';
  if (operatingResultCents != null && operatingMarginBasisPoints != null) {
    if (operatingResultCents < 0) {
      rating = 'negative';
    } else if (
      targetOperatingMarginBasisPoints != null &&
      operatingMarginBasisPoints < targetOperatingMarginBasisPoints
    ) {
      rating = 'attention';
    } else {
      rating = 'healthy';
    }
  }

  return {
    modelVersion: SALES_CURRENT_OPERATING_MODEL_VERSION,
    regime: 'mei',
    revenueCents,
    meiDasMonthlyCents: values.meiDasMonthlyCents ?? null,
    stripeFeeCents,
    stripeFeeBasisPoints: values.stripeFeeBasisPoints ?? null,
    stripeFixedFeeCents: values.stripeFixedFeeCents ?? null,
    supabaseMonthlyCostCents: values.supabaseMonthlyCostCents ?? null,
    railwayMonthlyCostCents: values.railwayMonthlyCostCents ?? null,
    totalOperatingCostsCents,
    operatingResultCents,
    operatingMarginBasisPoints,
    targetOperatingMarginBasisPoints,
    targetGapCents,
    rating,
    missingFields,
  };
};
