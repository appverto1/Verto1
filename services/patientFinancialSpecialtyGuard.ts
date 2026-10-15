import { patientFinancialPlanClinicalScopeKey } from '../utils/patientFinancialPlan';

type ValidationResult = { ok: true } | { ok: false; error: string; code: string };

/**
 * Reject new plans for specialties not actually served by active, accepted
 * professionals in this clinic. All access is tenant-scoped. Previously saved
 * plans for now-unavailable specialties are grandfathered only when their
 * identifier and specialty remain unchanged, so unrelated patient edits never
 * silently destroy historical financial records.
 */
export async function validateActiveClinicFinancialPlanSpecialties(params: {
  supabase: any;
  clinicId: string;
  patientId: string;
  rows: any[];
}): Promise<ValidationResult> {
  const rows = Array.isArray(params.rows) ? params.rows : [];
  if (!rows.length) return { ok: true };

  const members = await params.supabase.from('clinic_memberships')
    .select('specialty')
    .eq('clinic_id', params.clinicId)
    .eq('role', 'therapist')
    .eq('status', 'active');
  if (members.error || !Array.isArray(members.data)) {
    return { ok: false, code: 'CLINIC_FINANCIAL_SPECIALTIES_UNAVAILABLE',
      error: 'Não foi possível validar as especialidades da equipe. Tente novamente.' };
  }

  const active = new Set(
    members.data
      .map((member: any) => patientFinancialPlanClinicalScopeKey({
        serviceType: 'CUSTOM',
        customServiceName: member.specialty
      }))
      .filter(Boolean)
  );
  const invalid = rows.filter((row: any) => {
    const scope = patientFinancialPlanClinicalScopeKey({
      serviceType: row.service_type,
      customServiceName: row.custom_service_name,
    });
    return !scope || !active.has(scope);
  });
  if (!invalid.length) return { ok: true };

  const previous = await params.supabase.from('patient_financial_plans')
    .select('id,client_plan_key,service_type,custom_service_name,status')
    .eq('organization_id', params.clinicId)
    .eq('patient_id', params.patientId)
    .eq('status', 'ACTIVE');
  if (previous.error || !Array.isArray(previous.data)) {
    return { ok: false, code: 'CLINIC_FINANCIAL_SPECIALTIES_UNAVAILABLE',
      error: 'Não foi possível validar os planos financeiros anteriores. Tente novamente.' };
  }

  for (const row of invalid) {
    const rowId = String(row.id || '').trim();
    const clientKey = String(row.client_plan_key || '').trim();
    const old = previous.data.find((item: any) =>
      (rowId && String(item.id || '') === rowId) ||
      (clientKey && String(item.client_plan_key || '') === clientKey)
    );
    const previousScope = old && patientFinancialPlanClinicalScopeKey({
      serviceType: old.service_type,
      customServiceName: old.custom_service_name
    });
    const requestedScope = patientFinancialPlanClinicalScopeKey({
      serviceType: row.service_type,
      customServiceName: row.custom_service_name
    });
    if (!old || previousScope !== requestedScope ||
        String(old.service_type || '').toUpperCase() !== String(row.service_type || '').toUpperCase() ||
        String(old.custom_service_name || '').trim() !== String(row.custom_service_name || '').trim()) {
      return { ok: false, code: 'FINANCIAL_PLAN_SPECIALTY_NOT_ACTIVE',
        error: 'Não é possível cadastrar plano financeiro de especialidade sem profissional ativo e vinculado à clínica.' };
    }
  }
  return { ok: true };
}
