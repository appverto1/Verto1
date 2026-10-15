import { resolveGroupPatientRates } from './groupSessionFinancialValidation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown) => String(value || '').trim().toLowerCase();

export type GroupPricePreviewResult =
  | { ok: true; rates: Array<{ patientId: string; financialPlanId: string; amountCents: number }> }
  | { ok: false; code: string; patientId?: string };

/**
 * Read-only price preview, not a reservation or financial commitment.
 * Tenant and membership checks come from the authenticated server context.
 * Two batched, column-limited queries regardless of patient count.
 * The canonical write/charge flow must resolve the rate again transactionally.
 */
export async function previewGroupSessionRates(params: {
  supabase: any;
  authenticatedClinicId: string;
  specialty: string;
  patientIds: unknown;
}): Promise<GroupPricePreviewResult> {
  const clinicId = id(params.authenticatedClinicId);
  if (!UUID.test(clinicId)) return { ok: false, code: 'GROUP_PREVIEW_CLINIC_INVALID' };
  if (!Array.isArray(params.patientIds)) return { ok: false, code: 'GROUP_PREVIEW_PATIENTS_INVALID' };

  const patients = params.patientIds.map(id);
  if (!patients.length || patients.length > 30 || patients.some(x => !UUID.test(x)) ||
      new Set(patients).size !== patients.length) {
    return { ok: false, code: 'GROUP_PREVIEW_PATIENTS_INVALID' };
  }
  const specialty = String(params.specialty || '').trim().slice(0, 120);
  if (!specialty) return { ok: false, code: 'GROUP_PREVIEW_SPECIALTY_INVALID' };

  const foundPatients = await params.supabase.from('patients')
    .select('id').eq('clinic_id', clinicId).in('id', patients).limit(patients.length);
  if (foundPatients.error) throw foundPatients.error;
  const authorized = new Set((foundPatients.data || []).map((row: any) => id(row.id)));
  if (patients.some(x => !authorized.has(x))) return { ok: false, code: 'GROUP_PREVIEW_PATIENT_OUT_OF_SCOPE' };

  const plans = await params.supabase.from('patient_financial_plans')
    .select('id,organization_id,patient_id,status,billing_mode,service_type,custom_service_name,service_name_snapshot,group_amount_cents')
    .eq('organization_id', clinicId).eq('status', 'ACTIVE').in('patient_id', patients).limit(200);
  if (plans.error) throw plans.error;
  // Fail closed if a response was truncated; we must never guess a unique plan
  // from a partial result set.
  if ((plans.data || []).length >= 200) return { ok: false, code: 'GROUP_PREVIEW_TOO_MANY_PLANS' };
  return resolveGroupPatientRates({
    authenticatedClinicId: clinicId,
    specialty,
    patientIds: patients,
    activeFinancialPlanRows: plans.data || []
  });
}
