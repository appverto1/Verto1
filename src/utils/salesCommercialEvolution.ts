export type CustomCapacityPolicy = {
  enabled: boolean;
  blockSizePatients: number;
  blockPriceCents: number;
  includedStorageMbPerPatient: number;
  gracePeriodDays: number;
  billingAdjustment: 'next_cycle';
  blocksClinicalAccess: false;
};

export const DEFAULT_CUSTOM_CAPACITY_POLICY: Readonly<CustomCapacityPolicy> =
  Object.freeze({
    enabled: true,
    blockSizePatients: 10,
    blockPriceCents: 7_990,
    includedStorageMbPerPatient: 100,
    gracePeriodDays: 7,
    billingAdjustment: 'next_cycle',
    blocksClinicalAccess: false
  });

export type CustomCapacitySelection = {
  mode: 'automatic' | 'manual';
  selectedBlocks?: number | null;
};

export type CustomCapacitySnapshot = {
  schemaVersion: 1;
  policy: CustomCapacityPolicy;
  demandPatients: number;
  baseLimitPatients: number;
  basePriceCents: number;
  minimumBlocks: number;
  selectedBlocks: number;
  selectionMode: 'automatic' | 'manual';
  manualOverrideRemoved: boolean;
  addedCapacityPatients: number;
  totalContractedLimitPatients: number;
  includedStorageMb: number;
  blocksMonthlyRevenueCents: number;
  clinicalCoreMonthlyRevenueCents: number;
};

const isSafeNonNegativeInteger = (value: unknown, maximum = 1_000_000_000) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;

export function validateCustomCapacityPolicy(
  value: unknown
): value is CustomCapacityPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  const expectedKeys = [
    'enabled',
    'blockSizePatients',
    'blockPriceCents',
    'includedStorageMbPerPatient',
    'gracePeriodDays',
    'billingAdjustment',
    'blocksClinicalAccess'
  ];
  if (
    Object.keys(policy).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(policy, key))
  ) {
    return false;
  }
  return (
    typeof policy.enabled === 'boolean' &&
    Number.isSafeInteger(policy.blockSizePatients) &&
    Number(policy.blockSizePatients) > 0 &&
    Number(policy.blockSizePatients) <= 10_000 &&
    isSafeNonNegativeInteger(policy.blockPriceCents) &&
    Number.isSafeInteger(policy.includedStorageMbPerPatient) &&
    Number(policy.includedStorageMbPerPatient) > 0 &&
    Number(policy.includedStorageMbPerPatient) <= 1_000_000 &&
    Number.isSafeInteger(policy.gracePeriodDays) &&
    Number(policy.gracePeriodDays) >= 0 &&
    Number(policy.gracePeriodDays) <= 365 &&
    policy.billingAdjustment === 'next_cycle' &&
    policy.blocksClinicalAccess === false
  );
}

export function calculateCustomCapacity(
  args: {
    currentPatients: number;
    expectedPatients: number;
    baseLimitPatients: number;
    basePriceCents: number;
    selection?: CustomCapacitySelection;
  },
  policy: CustomCapacityPolicy
): CustomCapacitySnapshot {
  if (!validateCustomCapacityPolicy(policy)) {
    throw new Error('CUSTOM_CAPACITY_POLICY_INVALID');
  }
  for (const [key, value] of Object.entries({
    currentPatients: args.currentPatients,
    expectedPatients: args.expectedPatients,
    baseLimitPatients: args.baseLimitPatients,
    basePriceCents: args.basePriceCents
  })) {
    if (!isSafeNonNegativeInteger(value, key === 'basePriceCents' ? 1_000_000_000 : 100_000)) {
      throw new Error(`CUSTOM_CAPACITY_INVALID:${key}`);
    }
  }
  if (args.baseLimitPatients < 1 || args.currentPatients < 1 || args.expectedPatients < 1) {
    throw new Error('CUSTOM_CAPACITY_INVALID:patients');
  }
  const demandPatients = Math.max(args.currentPatients, args.expectedPatients);
  const minimumBlocks = policy.enabled
    ? Math.ceil(
        Math.max(demandPatients - args.baseLimitPatients, 0) /
          policy.blockSizePatients
      )
    : 0;
  const requestedMode = args.selection?.mode === 'manual' ? 'manual' : 'automatic';
  const requestedBlocks = args.selection?.selectedBlocks;
  const manualValid =
    requestedMode === 'manual' &&
    Number.isSafeInteger(requestedBlocks) &&
    Number(requestedBlocks) >= minimumBlocks &&
    Number(requestedBlocks) <= 10_000;
  const selectedBlocks = manualValid
    ? Number(requestedBlocks)
    : minimumBlocks;
  const totalContractedLimitPatients =
    args.baseLimitPatients + selectedBlocks * policy.blockSizePatients;
  const blocksMonthlyRevenueCents = selectedBlocks * policy.blockPriceCents;
  return {
    schemaVersion: 1,
    policy: { ...policy },
    demandPatients,
    baseLimitPatients: args.baseLimitPatients,
    basePriceCents: args.basePriceCents,
    minimumBlocks,
    selectedBlocks,
    selectionMode: manualValid ? 'manual' : 'automatic',
    manualOverrideRemoved: requestedMode === 'manual' && !manualValid,
    addedCapacityPatients: selectedBlocks * policy.blockSizePatients,
    totalContractedLimitPatients,
    includedStorageMb:
      totalContractedLimitPatients * policy.includedStorageMbPerPatient,
    blocksMonthlyRevenueCents,
    clinicalCoreMonthlyRevenueCents:
      args.basePriceCents + blocksMonthlyRevenueCents
  };
}

export type OfferItemDiscountType = 'percentage' | 'fixed_amount' | 'free';
export type OfferItemDiscountStatus =
  | 'scheduled'
  | 'active'
  | 'expired'
  | 'revoked';

export type OfferItemDiscount = {
  type: OfferItemDiscountType;
  percentageBasisPoints?: number;
  amountOffCents?: number;
  startsAt: string;
  endsAt: string | null;
  durationCount?: number;
  durationUnit?: 'days' | 'months' | 'billing_cycles';
  priceBeforeDiscountCents: number;
  discountedPriceCents: number;
  priceAfterExpirationCents: number;
  reason: string;
  internalNotes?: string;
  status: OfferItemDiscountStatus;
};

export type OfferCommercialPhaseLine = {
  itemKey: string;
  publicName: string;
  billingInterval: 'monthly' | 'one_time';
  normalPriceCents: number;
  activePriceCents: number;
  discountCents: number;
  itemDiscountCents: number;
  globalDiscountCents: number;
  discount: OfferItemDiscount | null;
  directCostCents: number | null;
};

export type OfferCommercialPhase = {
  phaseNumber: number;
  startsAt: string;
  endsAt: string | null;
  lines: OfferCommercialPhaseLine[];
  recurringRevenueCents: number;
  recurringCostCents: number | null;
  contributionCents: number | null;
  ebitdaCents: number | null;
  marginBasisPoints: number | null;
  invoiceAmountCents: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;
const dateMs = (value: string) => {
  if (!ISO_DATE.test(value)) return Number.NaN;
  return Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value);
};

export function addCommercialDuration(
  startsAt: string,
  count: number,
  unit: 'days' | 'months' | 'billing_cycles'
): string {
  const parsed = dateMs(startsAt);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(parsed)) {
    throw new Error('OFFER_ITEM_DISCOUNT_DURATION_INVALID');
  }
  const date = new Date(parsed);
  if (unit === 'days') date.setUTCDate(date.getUTCDate() + count);
  else date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString();
}

export function normalizeOfferItemDiscount(
  input: Omit<OfferItemDiscount, 'discountedPriceCents' | 'priceAfterExpirationCents'> &
    Partial<Pick<OfferItemDiscount, 'discountedPriceCents' | 'priceAfterExpirationCents'>>
): OfferItemDiscount {
  const price = input.priceBeforeDiscountCents;
  if (
    !isSafeNonNegativeInteger(price)
    || input.reason.trim().length < 3
    || !['scheduled', 'active', 'expired', 'revoked'].includes(input.status)
  ) {
    throw new Error('OFFER_ITEM_DISCOUNT_INVALID');
  }
  const starts = dateMs(input.startsAt);
  const hasDurationCount = input.durationCount !== undefined;
  const hasDurationUnit = input.durationUnit !== undefined;
  if (hasDurationCount !== hasDurationUnit) {
    throw new Error('OFFER_ITEM_DISCOUNT_DURATION_INVALID');
  }
  const durationEndsAt = hasDurationCount && hasDurationUnit
    ? addCommercialDuration(
        input.startsAt,
        Number(input.durationCount),
        input.durationUnit!
      )
    : null;
  if (
    input.endsAt
    && durationEndsAt
    && dateMs(input.endsAt) !== dateMs(durationEndsAt)
  ) {
    throw new Error('OFFER_ITEM_DISCOUNT_DATES_INVALID');
  }
  const calculatedEndsAt = input.endsAt || durationEndsAt;
  if (
    !Number.isFinite(starts) ||
    (calculatedEndsAt !== null &&
      (!Number.isFinite(dateMs(calculatedEndsAt)) || dateMs(calculatedEndsAt) <= starts))
  ) {
    throw new Error('OFFER_ITEM_DISCOUNT_DATES_INVALID');
  }
  let discountedPriceCents = price;
  if (input.type === 'free') {
    discountedPriceCents = 0;
  } else if (input.type === 'percentage') {
    if (
      !Number.isSafeInteger(input.percentageBasisPoints) ||
      Number(input.percentageBasisPoints) < 0 ||
      Number(input.percentageBasisPoints) > 10_000
    ) {
      throw new Error('OFFER_ITEM_DISCOUNT_INVALID');
    }
    discountedPriceCents = Math.round(
      (price * (10_000 - Number(input.percentageBasisPoints))) / 10_000
    );
  } else if (input.type === 'fixed_amount') {
    if (
      !isSafeNonNegativeInteger(input.amountOffCents) ||
      Number(input.amountOffCents) > price
    ) {
      throw new Error('OFFER_ITEM_DISCOUNT_INVALID');
    }
    discountedPriceCents = price - Number(input.amountOffCents);
  } else {
    throw new Error('OFFER_ITEM_DISCOUNT_INVALID');
  }
  if (discountedPriceCents < 0 || discountedPriceCents > price) {
    throw new Error('OFFER_ITEM_DISCOUNT_INVALID');
  }
  return {
    ...input,
    endsAt: calculatedEndsAt,
    discountedPriceCents,
    priceAfterExpirationCents: price
  };
}

export function validateDiscountStacking(args: {
  globalDiscountBasisPoints: number;
  itemDiscounts: Array<OfferItemDiscount | null | undefined>;
  justification?: string | null;
}): void {
  if (
    args.globalDiscountBasisPoints > 0 &&
    args.itemDiscounts.some(Boolean) &&
    String(args.justification || '').trim().length < 12
  ) {
    throw new Error('OFFER_DISCOUNT_STACKING_JUSTIFICATION_REQUIRED');
  }
}

export function discountAppliesAt(
  discount: OfferItemDiscount,
  instant: string
): boolean {
  if (discount.status === 'revoked' || discount.status === 'expired') return false;
  const point = dateMs(instant);
  return (
    Number.isFinite(point) &&
    point >= dateMs(discount.startsAt) &&
    (discount.endsAt === null || point < dateMs(discount.endsAt))
  );
}

export function buildOfferCommercialPhases(
  args: {
    startsAt: string;
    lines: Array<{
      itemKey: string;
      publicName: string;
      billingInterval: 'monthly' | 'one_time';
      normalPriceCents: number;
      directCostCents: number | null;
      discount?: OfferItemDiscount | null;
      globalDiscountCents?: number;
    }>;
    sharedMonthlyCostCents?: number | null;
    globalDiscountBasisPoints?: number;
    globalDiscountBaseItemKey?: string;
    globalDiscountStartsAt?: string | null;
    globalDiscountEndsAt?: string | null;
  }
): OfferCommercialPhase[] {
  const starts = dateMs(args.startsAt);
  if (!Number.isFinite(starts)) throw new Error('OFFER_PHASE_START_INVALID');
  const boundaries = new Set<number>([starts]);
  const globalStarts = args.globalDiscountStartsAt ? dateMs(args.globalDiscountStartsAt) : Number.NaN;
  const globalEnds = args.globalDiscountEndsAt ? dateMs(args.globalDiscountEndsAt) : Number.NaN;
  if (Number.isFinite(globalStarts) && globalStarts >= starts) boundaries.add(globalStarts);
  if (Number.isFinite(globalEnds) && globalEnds >= starts) boundaries.add(globalEnds);
  for (const line of args.lines) {
    if (!isSafeNonNegativeInteger(line.normalPriceCents)) {
      throw new Error(`OFFER_PHASE_PRICE_INVALID:${line.itemKey}`);
    }
    if (line.discount) {
      const discountStart = dateMs(line.discount.startsAt);
      if (discountStart >= starts) boundaries.add(discountStart);
      if (line.discount.endsAt) {
        const discountEnd = dateMs(line.discount.endsAt);
        if (discountEnd >= starts) boundaries.add(discountEnd);
      }
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.map((boundary, index) => {
    const instant = new Date(boundary).toISOString();
    let lines = args.lines.map<OfferCommercialPhaseLine>((line) => {
      const active = line.discount && discountAppliesAt(line.discount, instant)
        ? line.discount
        : null;
      const activePriceCents = active
        ? line.normalPriceCents -
          (active.priceBeforeDiscountCents - active.discountedPriceCents)
        : line.normalPriceCents;
      const itemDiscountCents = line.normalPriceCents - activePriceCents;
      const globalActive = Number(line.globalDiscountCents || 0) > 0 &&
        (!Number.isFinite(globalStarts) || boundary >= globalStarts) &&
        (!Number.isFinite(globalEnds) || boundary < globalEnds);
      const globalDiscountCents = globalActive
        ? Math.min(activePriceCents, Number(line.globalDiscountCents || 0))
        : 0;
      const finalActivePriceCents = activePriceCents - globalDiscountCents;
      return {
        ...line,
        activePriceCents: finalActivePriceCents,
        discountCents: line.normalPriceCents - finalActivePriceCents,
        itemDiscountCents,
        globalDiscountCents,
        discount: active
      };
    });
    const globalPeriodActive = Number(args.globalDiscountBasisPoints || 0) > 0 &&
      (!Number.isFinite(globalStarts) || boundary >= globalStarts) &&
      (!Number.isFinite(globalEnds) || boundary < globalEnds);
    if (globalPeriodActive) {
      const recurringIndexes = lines.map((line, lineIndex) => ({ line, lineIndex }))
        .filter(({ line }) => line.billingInterval === 'monthly');
      const basis = recurringIndexes.map(({ line }) => line.activePriceCents);
      const basisTotal = basis.reduce((sum, value) => sum + value, 0);
      const discountTotal = Math.round(basisTotal * Number(args.globalDiscountBasisPoints || 0) / 10_000);
      const allocations = basisTotal > 0
        ? basis.map((value) => Math.floor(discountTotal * value / basisTotal))
        : basis.map(() => 0);
      const remainder = discountTotal - allocations.reduce((sum, value) => sum + value, 0);
      const preferred = Math.max(0, recurringIndexes.findIndex(({ line }) => line.itemKey === (args.globalDiscountBaseItemKey || 'clinical_core')));
      if (allocations.length > 0) allocations[preferred] += remainder;
      lines = lines.map((line, lineIndex) => {
        const recurringIndex = recurringIndexes.findIndex((entry) => entry.lineIndex === lineIndex);
        if (recurringIndex < 0) return line;
        const allocated = Math.min(line.activePriceCents, allocations[recurringIndex]);
        return {
          ...line,
          activePriceCents: line.activePriceCents - allocated,
          globalDiscountCents: line.globalDiscountCents + allocated,
          discountCents: line.discountCents + allocated
        };
      });
    }
    const recurring = lines.filter((line) => line.billingInterval === 'monthly');
    const recurringRevenueCents = recurring.reduce(
      (sum, line) => sum + line.activePriceCents,
      0
    );
    const knownCosts = recurring.map((line) => line.directCostCents);
    const recurringCostCents =
      knownCosts.every((cost) => cost !== null) &&
      args.sharedMonthlyCostCents !== null
        ? knownCosts.reduce((sum, cost) => sum + Number(cost), 0) +
          Number(args.sharedMonthlyCostCents || 0)
        : null;
    const contributionCents = recurringCostCents === null
      ? null
      : recurringRevenueCents - recurringCostCents;
    const oneTime = index === 0
      ? lines
          .filter((line) => line.billingInterval === 'one_time')
          .reduce((sum, line) => sum + line.activePriceCents, 0)
      : 0;
    return {
      phaseNumber: index + 1,
      startsAt: instant,
      endsAt: ordered[index + 1]
        ? new Date(ordered[index + 1]).toISOString()
        : null,
      lines,
      recurringRevenueCents,
      recurringCostCents,
      contributionCents,
      ebitdaCents: contributionCents,
      marginBasisPoints:
        contributionCents !== null && recurringRevenueCents > 0
          ? Math.round((contributionCents * 10_000) / recurringRevenueCents)
          : null,
      invoiceAmountCents: recurringRevenueCents + oneTime
    };
  });
}

export type DiscountNotificationKind = 'before_end' | 'ends_today' | 'normal_price_applied';
export type DiscountNotificationPlan = {
  kind: DiscountNotificationKind;
  daysBeforeEnd: 30 | 15 | 7 | 0 | -1;
  scheduledFor: string;
  idempotencySuffix: string;
};

export function buildDiscountNotificationPlan(
  discountId: string,
  endsAt: string
): DiscountNotificationPlan[] {
  const end = dateMs(endsAt);
  if (!discountId || !Number.isFinite(end)) {
    throw new Error('DISCOUNT_NOTIFICATION_INVALID');
  }
  return [30, 15, 7, 0, -1].map((days) => ({
    kind: days > 0
      ? 'before_end'
      : days === 0
        ? 'ends_today'
        : 'normal_price_applied',
    daysBeforeEnd: days as 30 | 15 | 7 | 0 | -1,
    scheduledFor: new Date(end - days * 86_400_000).toISOString(),
    idempotencySuffix: `${discountId}:${days}`
  }));
}

export type FrozenStripeCheckoutPlan = {
  currency: string;
  initialLineItems: Array<{
    itemKey: string;
    description: string;
    unitAmountCents: number;
    recurring: boolean;
    metadata: Record<string, string>;
  }>;
  schedulePhases: Array<{
    startsAt: string;
    endsAt: string | null;
    items: Array<{ itemKey: string; unitAmountCents: number }>;
  }>;
  initialAmountCents: number;
  promotionalMonthlyCents: number;
  futureMonthlyCents: number;
  oneTimeCents: number;
  reconciliationHashInput: string;
};

export function buildFrozenStripeCheckoutPlan(args: {
  currency?: string;
  phases: OfferCommercialPhase[];
  capacity?: CustomCapacitySnapshot | null;
  effectiveAt?: string;
}): FrozenStripeCheckoutPlan {
  if (args.phases.length < 1) throw new Error('STRIPE_PHASES_REQUIRED');
  const effectiveAt = args.effectiveAt || args.phases[0].startsAt;
  const effectiveTime = dateMs(effectiveAt);
  if (!Number.isFinite(effectiveTime)) throw new Error('STRIPE_EFFECTIVE_DATE_INVALID');
  const activePhaseIndex = args.phases.findIndex((phase) =>
    effectiveTime >= dateMs(phase.startsAt) &&
    (phase.endsAt === null || effectiveTime < dateMs(phase.endsAt))
  );
  if (activePhaseIndex < 0) throw new Error('STRIPE_ACTIVE_PHASE_NOT_FOUND');
  const checkoutPhases = args.phases.slice(activePhaseIndex);
  const first = checkoutPhases[0];
  const initialLineItems = first.lines.flatMap((line) => {
    if (line.itemKey === 'clinical_core' && args.capacity) {
      const base = {
        itemKey: 'clinical_core',
        description: 'Verto Clínica',
        unitAmountCents: Math.max(
          0,
          line.activePriceCents - args.capacity.blocksMonthlyRevenueCents
        ),
        recurring: true,
        metadata: { revenue_line: 'clinical_core' }
      };
      return args.capacity.selectedBlocks > 0
        ? [
            base,
            {
              itemKey: 'clinical_core_capacity',
              description: 'Capacidade adicional — extensão Verto Clínica',
              unitAmountCents: args.capacity.blocksMonthlyRevenueCents,
              recurring: true,
              metadata: {
                revenue_line: 'clinical_core',
                extension: 'capacity_blocks'
              }
            }
          ]
        : [base];
    }
    return [{
      itemKey: line.itemKey,
      description: line.publicName,
      unitAmountCents: line.activePriceCents,
      recurring: line.billingInterval === 'monthly',
      metadata: { revenue_line: line.itemKey }
    }];
  });
  const schedulePhases = checkoutPhases.map((phase) => ({
    startsAt: phase.startsAt,
    endsAt: phase.endsAt,
    items: phase.lines
      .filter((line) => line.billingInterval === 'monthly')
      .flatMap((line) => {
        if (line.itemKey !== 'clinical_core' || !args.capacity) {
          return [{
            itemKey: line.itemKey,
            unitAmountCents: line.activePriceCents
          }];
        }
        const capacityPrice = args.capacity.blocksMonthlyRevenueCents;
        return args.capacity.selectedBlocks > 0
          ? [
              {
                itemKey: 'clinical_core',
                unitAmountCents: Math.max(0, line.activePriceCents - capacityPrice)
              },
              {
                itemKey: 'clinical_core_capacity',
                unitAmountCents: capacityPrice
              }
            ]
          : [{ itemKey: 'clinical_core', unitAmountCents: line.activePriceCents }];
      })
  }));
  const oneTimeCents = initialLineItems
    .filter((line) => !line.recurring)
    .reduce((sum, line) => sum + line.unitAmountCents, 0);
  const normalized = {
    currency: (args.currency || 'brl').toLowerCase(),
    initialLineItems,
    schedulePhases
  };
  return {
    ...normalized,
    initialAmountCents: initialLineItems.reduce(
      (sum, line) => sum + line.unitAmountCents,
      0
    ),
    promotionalMonthlyCents: first.recurringRevenueCents,
    futureMonthlyCents:
      checkoutPhases[checkoutPhases.length - 1].recurringRevenueCents,
    oneTimeCents,
    reconciliationHashInput: JSON.stringify(normalized)
  };
}
