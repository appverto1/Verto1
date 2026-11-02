/**
 * P0-504 pure decision primitives. These NEVER mutate appointment, session,
 * attendance or patient receivables. Durable server state and transactional
 * authorization remain mandatory before any action.
 */
export type ContinuationChoice = 5 | 10 | 15 | 'FULL';
export type ContinuationTime = {
  scheduledEndAt: string;
  actualStartedAt: string;
  scheduledBaseDurationMinutes: number;
  persistedEffectiveEndAt?: string | null;
};
export type AutoCloseProof = {
  status: string;
  effectiveEndAt: string;
  continuationQuestionAt: string | null;
  now: string;
  lastDurableClinicalWriteAt: string | null;
  serverObservedClinicalCursor: boolean;
  pendingClinicalWrites: boolean;
  pendingOfflineSync: boolean;
  openClinicalTimers: boolean;
  extensionInProgress: boolean;
  pendingCollectionReview: boolean;
  appointmentId: string | null;
};

const instant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
const baseMinutes = (value: unknown): number | null => (
  typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 240 ? value : null
);

export function resolveCanonicalSessionEnd(input: ContinuationTime): string | null {
  const scheduled = instant(input.scheduledEndAt);
  const actual = instant(input.actualStartedAt);
  const duration = baseMinutes(input.scheduledBaseDurationMinutes);
  if (scheduled === null || actual === null || duration === null) return null;
  const persisted = input.persistedEffectiveEndAt ? instant(input.persistedEffectiveEndAt) : null;
  if (input.persistedEffectiveEndAt && persisted === null) return null;
  // Beginning late must never shorten the clinically reserved base duration.
  const end = Math.max(scheduled, actual + duration * 60_000, persisted ?? Number.NEGATIVE_INFINITY);
  return Number.isFinite(end) ? new Date(end).toISOString() : null;
}

export function previewSessionContinuation(input: ContinuationTime, choice: ContinuationChoice) {
  const canonicalEnd = resolveCanonicalSessionEnd(input);
  if (!canonicalEnd) return null;
  const minutes = choice === 'FULL' ? baseMinutes(input.scheduledBaseDurationMinutes) : choice;
  if (minutes === null || ![5, 10, 15, 30, 45, 50, 60, 90, 120, 180, 240].includes(minutes)) {
    // FULL also accepts other configured integer durations (e.g. 40 min).
    if (choice !== 'FULL' || minutes === null) return null;
  }
  if (choice !== 'FULL' && ![5, 10, 15].includes(minutes)) return null;
  const until = Date.parse(canonicalEnd) + minutes * 60_000;
  if (!Number.isFinite(until)) return null;
  return {
    choice,
    additionalMinutes: minutes,
    proposedEndAt: new Date(until).toISOString(),
    additionalBillableSessions: choice === 'FULL' ? 1 : 0,
    requiresExplicitConfirmation: true as const,
    requiresBackendConflictAndAuthorizationCheck: true as const,
  };
}

export function financialContinuationPreview(
  unitPriceCents: unknown, choice: ContinuationChoice, unitsAlreadyCommitted: number,
) {
  if (typeof unitPriceCents !== 'number' || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 ||
      !Number.isSafeInteger(unitsAlreadyCommitted) || unitsAlreadyCommitted < 1 ||
      unitsAlreadyCommitted > 1000) return null;
  const price = Number(unitPriceCents);
  const extra = choice === 'FULL' ? 1 : 0;
  const baseTotal = price * unitsAlreadyCommitted;
  const extraTotal = price * extra;
  if (!Number.isSafeInteger(baseTotal + extraTotal)) return null;
  return {
    originalUnitPriceCents: price,
    alreadyCommittedCents: baseTotal,
    additionalCents: extraTotal,
    quotedTotalCents: baseTotal + extraTotal,
    additionalBillableUnits: extra,
    // Quote only. Never issue a receivable outside the existing canonical engine.
    actualChargeCreated: false as const,
  };
}

export function canAutoCloseClinicalSession(proof: AutoCloseProof): boolean {
  const end = instant(proof.effectiveEndAt);
  const question = instant(proof.continuationQuestionAt);
  const now = instant(proof.now);
  if (!proof.appointmentId || !['active', 'in_progress'].includes(proof.status.toLowerCase())) return false;
  if (end === null || question === null || now === null || question < end || now < question + 5 * 60_000) return false;
  if (!proof.serverObservedClinicalCursor || proof.pendingClinicalWrites || proof.pendingOfflineSync ||
      proof.openClinicalTimers || proof.extensionInProgress || proof.pendingCollectionReview) return false;
  if (proof.lastDurableClinicalWriteAt !== null) {
    const last = instant(proof.lastDurableClinicalWriteAt);
    if (last === null || last >= question) return false;
  }
  // A positive decision is only eligibility for a locked server-side recheck,
  // never permission to mutate or mark ATTENDED / COMPLETE / BILLABLE.
  return true;
}
