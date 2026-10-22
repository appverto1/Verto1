/**
 * One-time transition for legacy programs still marked awaiting_approval.
 * New specialist-authored programs are already created in teaching by the API.
 * The caller must send each candidate through the existing authenticated,
 * version-checked status endpoint; this helper grants NO permissions.
 */
export type SpecialistActivationCandidate = { id: string; version: number };

export function pendingSpecialistProgramActivations(params: {
  programs: any[];
  planScopes: any[];
  actorId: string;
  actorRole: string;
  patientId: string;
  readOnlyHistory?: boolean;
}): SpecialistActivationCandidate[] {
  if (params.readOnlyHistory || String(params.actorRole).toLowerCase() !== 'therapist') return [];
  const actorId = String(params.actorId || '').trim();
  if (!actorId) return [];
  const activeOwnedScopes = new Set(
    (Array.isArray(params.planScopes) ? params.planScopes : [])
      .filter(scope =>
        String(scope?.mode || '').toLowerCase() === 'specialty' &&
        String(scope?.status || '').toLowerCase() === 'active' &&
        scope?.canEdit === true &&
        String(scope?.responsible_professional_id || '') === actorId
      )
      .map(scope => String(scope?.id || '').trim())
      .filter(Boolean),
  );
  if (!activeOwnedScopes.size) return [];
  return (Array.isArray(params.programs) ? params.programs : [])
    .filter(program =>
      String(program?.status || '').toLowerCase() === 'awaiting_approval' &&
      activeOwnedScopes.has(String(program?.therapeutic_plan_id || program?.therapeuticPlanId || '')) &&
      (!program?.patient_id || String(program.patient_id) === String(params.patientId))
    )
    .map(program => ({ id: String(program?.id || ''), version: Number(program?.version) }))
    .filter(program => Boolean(program.id) && Number.isSafeInteger(program.version) && program.version >= 1)
    .slice(0, 30);
}
