import { normalizeAppointmentModality, type AppointmentModality } from './groupSessionRules';

export type SpecialtySessionPrice = {
  modality: AppointmentModality;
  amountCents: number;
};

/**
 * One active plan per patient + specialty may offer two independent rates.
 * Never charge the individual rate for a group session or vice-versa.
 * The database resolver must remain the authority for billed amounts.
 */
export function resolveFinancialPlanSessionPrice(plan: any, requestedModality: unknown): SpecialtySessionPrice | null {
  const modality = normalizeAppointmentModality(requestedModality);
  if (!plan || String(plan.status || 'ACTIVE').trim().toUpperCase() !== 'ACTIVE') return null;
  const raw = modality === 'GROUP'
    ? plan.group_amount_cents ?? plan.groupAmountCents
    : plan.amount_cents ?? plan.amountCents;
  if (raw === null || raw === undefined || raw === '') return null;
  const cents = Number(raw);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 1000000000) return null;
  return { modality, amountCents: cents };
}

export function canScheduleModalityFromPlan(plan: any, requestedModality: unknown): boolean {
  return resolveFinancialPlanSessionPrice(plan, requestedModality) !== null;
}
