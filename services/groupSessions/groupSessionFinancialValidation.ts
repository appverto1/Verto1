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
    if (matching.length !== 1)
      return { ok: false, code: matching.length ? 'GROUP_PRICING_AMBIGUOUS' : 'GROUP_PRICING_PLAN_MISSING', patientId };
    const chosen = matching[0];
    const price = resolveFinancialPlanSessionPrice(chosen, 'GROUP');
    if (!price || !UUID.test(id(chosen?.id)))
      return { ok: false, code: 'GROUP_PRICING_RATE_MISSING', patientId };
    rates.push({ patientId, financialPlanId: id(chosen.id), amountCents: price.amountCents });
  }

  return { ok: true, rates };
}
