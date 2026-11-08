// ABA-M11: PEI maintenance target resolution moved literally from server.ts.
// Resolve dependencies only on invocation to preserve existing initialization ordering.
export function createPeiMaintenanceTargetResolver(getDeps: () => any) {
  return async (params: {
    patientId: string;
    clinicId: string;
    organizationId: string;
    sessionUser: any;
    payload: any;
  }) => {
    const { sanitizeString, isUuid, readPeiMaintenanceEnsureSource, supabase, ABA_TARGET_RECOMMENDATION_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, isMissingRelationError, persistPeiSkillAcquiredMasteryEvent, getPatientPeiTargets, resolvePeiMaintenanceSourceTarget, materializePeiTargetsForMaintenance, fetchTargetForMaintenance } = getDeps();
    const patientId = sanitizeString(params.patientId, 120);
    const clinicId = sanitizeString(params.clinicId, 120);
    const organizationId = sanitizeString(params.organizationId || clinicId, 120);
    if (!isUuid(patientId) || !clinicId) {
      return { ok: false, status: 400, error: 'Dados insuficientes para preparar a habilidade.' };
    }
    const candidate = readPeiMaintenanceEnsureSource(params.payload || {});
    let targetQuery = supabase
      .from('aba_targets')
      .select(ABA_TARGET_RECOMMENDATION_SELECT)
      .eq('organization_id', organizationId)
      .eq('patient_id', patientId)
      .limit(500);
    targetQuery = applyAbaTenantScope(targetQuery, params.sessionUser, clinicId, organizationId);
    const targetResult = await targetQuery;
    if (targetResult.error && !hasMissingFinancialSchema(targetResult.error) && !isMissingRelationError(targetResult.error)) throw targetResult.error;
    const existingTargets = targetResult.error ? [] : (Array.isArray(targetResult.data) ? targetResult.data : []);
    const requestedTargetId = sanitizeString(candidate?.targetId, 180);
    const existingTarget = isUuid(requestedTargetId)
      ? existingTargets.find((target: any) => sanitizeString(target?.id, 180) === requestedTargetId) || null
      : null;
    if (existingTarget?.id) {
      const eventId = await persistPeiSkillAcquiredMasteryEvent({
        organizationId,
        clinicId,
        patientId,
        targetId: sanitizeString(existingTarget.id, 180),
        source: { ...candidate, targetName: candidate?.targetName || existingTarget?.name },
        changedBy: sanitizeString(params.sessionUser?.id || params.sessionUser?.user_id, 120)
      });
      return { ok: true, status: 200, target: existingTarget, targetId: sanitizeString(existingTarget.id, 180), masteryEvaluationId: eventId, materialized: false };
    }

    const peiTargets = await getPatientPeiTargets(patientId, clinicId, organizationId, params.sessionUser);
    const matchedPeiTarget = resolvePeiMaintenanceSourceTarget(peiTargets, candidate);
    const sourceTarget = matchedPeiTarget || (candidate?.eligibleForMaintenance && candidate?.targetName ? candidate : null);
    if (!sourceTarget?.targetName) {
      return { ok: false, status: 404, error: 'Habilidade adquirida não encontrada no PEI do paciente.' };
    }
    const materialized = await materializePeiTargetsForMaintenance({
      patientId,
      clinicId,
      organizationId,
      sessionUser: params.sessionUser,
      peiTargets: [sourceTarget],
      existingTargets
    });
    const hydrated = Array.isArray(materialized.peiTargets) ? materialized.peiTargets[0] : null;
    const targetId = sanitizeString(hydrated?.targetId || hydrated?.target_id || materialized.materializedTargets?.[0]?.id, 180);
    let target = (Array.isArray(materialized.targets) ? materialized.targets : []).find((item: any) => sanitizeString(item?.id, 180) === targetId) || null;
    if (!target?.id && isUuid(targetId)) {
      target = await fetchTargetForMaintenance({ targetId, patientId, clinicId, organizationId });
    }
    if (!isUuid(targetId) || !target?.id) {
      return { ok: false, status: 500, error: 'Não foi possível materializar a habilidade adquirida.' };
    }
    const eventId = await persistPeiSkillAcquiredMasteryEvent({
      organizationId,
      clinicId,
      patientId,
      targetId,
      source: { ...sourceTarget, targetName: sourceTarget?.targetName || target?.name },
      changedBy: sanitizeString(params.sessionUser?.id || params.sessionUser?.user_id, 120)
    });
    return { ok: true, status: 200, target, targetId, masteryEvaluationId: eventId, materialized: Boolean(materialized.materializedTargets?.length) };
  };
}
