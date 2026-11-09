// ABA-M11: original PEI maintenance target route, moved without clinical changes.
// Route registration and auth middlewares remain in server.ts; dependencies are bound lazily.
export function createPeiMaintenanceTargetEnsureHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, canAccessPatientInCurrentClinic, ensurePeiMaintenanceTargetForPatient, cleanObject } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload de habilidade adquirida para manutenção')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId || req.body?.patient_id || req.body?.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Paciente fora do escopo da clínica.' });
      }
      const result = await ensurePeiMaintenanceTargetForPatient({
        patientId,
        clinicId,
        organizationId,
        sessionUser: req.session.user,
        payload: req.body || {}
      });
      if (!result.ok) {
        return res.status((result as any).status || 400).json({
          success: false,
          error: (result as any).status === 404 ? 'PEI_SKILL_NOT_FOUND' : 'TARGET_ENSURE_FAILED',
          message: (result as any).error || 'Não foi possível preparar a habilidade para manutenção.'
        });
      }
      const target = (result as any).target || {};
      const targetId = sanitizeString((result as any).targetId || target?.id, 180);
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[pei-maintenance-target]', { ensureTargetId: targetId || null, patientIdPresent: Boolean(patientId) });
      }
      const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
      const peiGoalId = sanitizeString(masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id || req.body?.peiGoalId || req.body?.goalId || req.body?.goal_id, 180);
      const skillId = sanitizeString(masteryCriteria?.skillId || masteryCriteria?.skill_id || req.body?.skillId || req.body?.skill_id, 180);
      const localTargetRef = sanitizeString(masteryCriteria?.localTargetRef || masteryCriteria?.local_target_ref || req.body?.localTargetRef || peiGoalId, 180);
      const responseTarget = cleanObject({
        ...target,
        id: targetId,
        targetId,
        target_id: targetId,
        targetName: sanitizeString(target?.targetName || target?.name, 240) || null,
        target_name: sanitizeString(target?.target_name || target?.name, 240) || null,
        protocolName: sanitizeString(target?.protocolName || target?.protocol_title, 240) || null,
        domainName: sanitizeString(target?.domainName || target?.domain_name, 240) || null,
        peiGoalId: peiGoalId || null,
        goalId: peiGoalId || null,
        goal_id: peiGoalId || null,
        skillId: skillId || null,
        skill_id: skillId || null,
        localTargetRef: localTargetRef || null
      });
      return res.json({
        success: true,
        message: 'Habilidade pronta para manutenção.',
        targetId,
        masteryEvaluationId: (result as any).masteryEvaluationId || null,
        materialized: Boolean((result as any).materialized),
        target: responseTarget,
        data: responseTarget
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: error?.message || 'Não foi possível preparar a habilidade para manutenção.' });
    }
  };
}
