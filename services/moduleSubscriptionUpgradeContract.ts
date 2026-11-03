// Pure commercial contract parsing and Stripe schedule boundary comparison.
// Never performs I/O, payment mutation, entitlement change or authorization.
import { buildFrozenStripeCheckoutPlan, type OfferCommercialPhase, type CustomCapacitySnapshot } from '../src/utils/salesCommercialEvolution';

const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
const unix = (value: unknown) => Math.max(0, Math.floor(Number(value || 0)));

export const parseCheckoutPlan = (offer: any) => {
  const snapshot = offer?.modular_snapshot;
  const phases = Array.isArray(snapshot?.commercialPhases) ? snapshot.commercialPhases as OfferCommercialPhase[] : [];
  if (phases.length === 0) throw new Error('MODULE_UPGRADE_OFFER_PHASES_MISSING');
  const capacity = snapshot?.capacity && typeof snapshot.capacity === 'object' ? snapshot.capacity as CustomCapacitySnapshot : null;
  return buildFrozenStripeCheckoutPlan({
    currency: text(offer?.currency, 12).toLowerCase() || 'brl',
    phases,
    capacity,
    effectiveAt: new Date().toISOString(),
  });
};

const phaseBoundary = (value: unknown) => value == null ? null : unix(value);
export const exactScheduleBoundaries = (stripePhases: any[], offerPhases: any[]) => stripePhases.length === offerPhases.length && stripePhases.every((phase, index) => {
  const offer = offerPhases[index];
  return phaseBoundary(phase.start_date) === phaseBoundary(Date.parse(offer.startsAt) / 1000) && phaseBoundary(phase.end_date) === (offer.endsAt ? phaseBoundary(Date.parse(offer.endsAt) / 1000) : null);
});
