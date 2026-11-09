import { patientFinancialPlanClinicalScopeKey } from '../src/utils/patientFinancialPlan';

type ValidationResult = { ok: true } | { ok: false; error: string; code: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown) => String(value || '').trim().toLowerCase();

/**
 * New financial plans must select an ACTIVE therapist in the authenticated
 * clinic, with a specialty that matches that plan. The membership is checked
 * server-side immediately before reconciliation. The v3 transaction checks
 * the same relationship again under PostgreSQL locks, preventing stale UI or
 * forged IDs from authorizing a binding.
 *
 * Legacy financial plans remain editable when their identity and specialty
 * have not changed, even if the clinic no longer offers that specialty.
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
    .select('user_id,specialty')
    .eq('clinic_id', params.clinicId)
    .eq('role', 'therapist')
    .eq('status', 'active');
  if (members.error || !Array.isArray(members.data)) {
    return { ok: false, code: 'CLINIC_FINANCIAL_SPECIALTIES_UNAVAILABLE',
      error: 'Não foi possível validar os profissionais ativos da clínica. Tente novamente.' };
  }

  const eligible = new Map<string, string>();
  for (const member of members.data) {
    const memberId = id(member.user_id);
    const specialty = patientFinancialPlanClinicalScopeKey({
      serviceType: 'CUSTOM', customServiceName: member.specialty
    });
    if (UUID.test(memberId) && specialty) eligible.set(memberId, specialty);
  }
  const available = new Set(eligible.values());
  const invalid = rows.filter((row: any) => {
    const scope = patientFinancialPlanClinicalScopeKey({
      serviceType: row.service_type, customServiceName: row.custom_service_name,
    });
    const professional = id(row.professional_user_id);
    return !scope || !available.has(scope) ||
      !UUID.test(professional) || eligible.get(professional) !== scope;
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
    const rowId = id(row.id);
    const clientKey = String(row.client_plan_key || '').trim();
    const old = previous.data.find((item: any) =>
      (UUID.test(rowId) && id(item.id) === rowId) ||
      (clientKey && String(item.client_plan_key || '') === clientKey)
    );
    const previousScope = old && patientFinancialPlanClinicalScopeKey({
      serviceType: old.service_type, customServiceName: old.custom_service_name
    });
    const requestedScope = patientFinancialPlanClinicalScopeKey({
      serviceType: row.service_type, customServiceName: row.custom_service_name
    });
    const unchanged = old && previousScope === requestedScope &&
      String(old.service_type || '').toUpperCase() === String(row.service_type || '').toUpperCase() &&
      String(old.custom_service_name || '').trim() === String(row.custom_service_name || '').trim();
    if (!unchanged) {
      if (!id(row.professional_user_id) && requestedScope && available.has(requestedScope)) {
        return { ok: false, code: 'FINANCIAL_PLAN_PROFESSIONAL_REQUIRED',
          error: 'Selecione o profissional ativo responsável pelo plano financeiro antes de salvar.' };
      }
      return { ok: false, code: 'FINANCIAL_PLAN_SPECIALTY_NOT_ACTIVE',
        error: 'O profissional e a especialidade devem estar ativos e vinculados à mesma clínica.' };
    }
    // Historical edits may omit a professional. An explicitly supplied but
    // invalid new assignment is never trusted, even for historical records.
    const proposedProfessional = id(row.professional_user_id);
    if (proposedProfessional && (!UUID.test(proposedProfessional) || eligible.get(proposedProfessional) !== requestedScope)) {
      return { ok: false, code: 'FINANCIAL_PLAN_PROFESSIONAL_NOT_ELIGIBLE',
        error: 'O profissional selecionado não está ativo nesta especialidade da clínica.' };
    }
  }
  return { ok: true };
}
