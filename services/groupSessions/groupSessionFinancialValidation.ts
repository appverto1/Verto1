import { clinicalSpecialtyScopeKey } from '../../src/utils/clinicalSpecialties';
import { resolveFinancialPlanSessionPrice } from '../../src/utils/groupFinancialPlanPrice';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown) => String(value || '').trim().toLowerCase();

export type GroupPatientRate = { patientId: string; financialPlanId: string; amountCents: number };
export type GroupPriceDecision =
  | { ok: true; rates: GroupPatientRate[] }
  | { ok: false; code: string; patientId?: string };

/**
 * Resolves independent per-patient group prices from canonical DB rows.
 * No frontend amount is accepted. The caller must fetch the active plans for
 * all authorized patients in ONE scoped query and do the write transactionally.
 *
 * Insurance/TISS authorization and other billing engines are NOT covered by
 * this resolver; reject them instead of silently applying a private price.
 */
export function resolveGroupPatientRates(params: {
  authenticatedClinicId: string;
  specialty: string;
  patientIds: string[];
  activeFinancialPlanRows: any[];
  /** Optional appointment instant (UTC/offset ISO) for a date-aware preview.
   * Database price resolution at booking remains authoritative. */
  scheduledStartAt?: string;
  /** Clinic-local yyyy-mm-dd, used only for package expiry. */
  localDate?: string;
}): GroupPriceDecision {
  const clinicId = id(params.authenticatedClinicId);
  const specialty = clinicalSpecialtyScopeKey(params.specialty);
  if (!UUID.test(clinicId) || !specialty || !Array.isArray(params.activeFinancialPlanRows))
    return { ok: false, code: 'GROUP_PRICING_SCOPE_INVALID' };

  const patients = params.patientIds.map(id);
  if (!patients.length || patients.length > 30 || new Set(patients).size !== patients.length ||
      patients.some(value => !UUID.test(value))) {
    return { ok: false, code: 'GROUP_PRICING_PATIENTS_INVALID' };
  }

  const rates: GroupPatientRate[] = [];
  for (const patientId of patients) {
    const matching = params.activeFinancialPlanRows.filter(plan =>
      id(plan?.organization_id || plan?.clinic_id) === clinicId &&
      id(plan?.patient_id) === patientId &&
      String(plan?.status || '').toUpperCase() === 'ACTIVE' &&
      String(plan?.billing_mode || '').toUpperCase() === 'PRIVATE' &&
      clinicalSpecialtyScopeKey(
        plan?.service_name_snapshot || plan?.custom_service_name || plan?.service_type
      ) === specialty
    );
    // The eventual transactional resolver checks each appointment instant.
    // A preview must not quote a plan that has already ended, starts later,
    // or whose package validity ends before the local session date.
    const effectiveAt = params.scheduledStartAt ? Date.parse(params.scheduledStartAt) : NaN;
    const hasInstant = Number.isFinite(effectiveAt);
    const eligible = hasInstant ? matching.filter(plan => {
      const from = plan.valid_from == null ? -Infinity : Date.parse(String(plan.valid_from));
      const until = plan.valid_until == null ? Infinity : Date.parse(String(plan.valid_until));
      const packageUntil = plan.package_valid_until == null ? '' : String(plan.package_valid_until).slice(0, 10);
      return Number.isFinite(from) || from === -Infinity
        ? effectiveAt >= from && effectiveAt < until &&
          (!packageUntil || !params.localDate || packageUntil >= params.localDate)
        : false;
    }) : matching;
    if (eligible.length !== 1) {
      const code = eligible.length > 1 ? 'GROUP_PRICING_AMBIGUOUS' :
        matching.length > 0 ? 'GROUP_PRICING_PLAN_NOT_VALID_AT_DATE' : 'GROUP_PRICING_PLAN_MISSING';
      return { ok: false, code, patientId };
    }
    const chosen = eligible[0];
    const price = resolveFinancialPlanSessionPrice(chosen, 'GROUP');
    if (!price || !UUID.test(id(chosen?.id)))
      return { ok: false, code: 'GROUP_PRICING_RATE_MISSING', patientId };
    rates.push({ patientId, financialPlanId: id(chosen.id), amountCents: price.amountCents });
  }

  return { ok: true, rates };
}
