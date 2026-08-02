export type PatientGlobalIdentityUpdateInput = {
  existingAccount: boolean;
  portalType: string;
  clinicId?: string | null;
};

/**
 * A identidade global de uma conta existente não muda quando ela recebe um
 * novo vínculo de paciente. O contexto de paciente é persistido em `patients`
 * e selecionado separadamente na sessão.
 */
export function buildPatientGlobalIdentityUpdate(
  input: PatientGlobalIdentityUpdateInput,
): Record<string, unknown> | null {
  if (input.existingAccount) return null;

  return {
    role: 'patient',
    type: input.portalType,
    clinic_id: input.clinicId || undefined,
    status: 'pending_activation',
    first_login_completed: false,
  };
}
