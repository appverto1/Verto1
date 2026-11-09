// ABA-M16: next-session plan-item PATCH. Preserve the existing clinic/patient scope and
// write semantics. Express authentication, capability gate and route order stay in server.ts.
// Dependencies are resolved lazily to avoid circular imports or startup side effects.
export function createAbaNextSessionPlanItemPatchHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, supabase, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, cleanObject, normalizeAbaPlanItemStatus, sanitizeTextField, normalizeAbaPlanTrialType, hasGlobalClinicAccess, ABA_NEXT_SESSION_PLAN_ITEM_SELECT } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de item do plano ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const planItemId = sanitizeString(req.params.planItemId, 180);
      if (!isUuid(planItemId)) {
        return res.status(400).json({ success: false, error: 'INVALID_PLAN_ITEM_ID' });
      }
      const { data: existingPlanItem, error: existingPlanItemError } = await supabase
        .from('aba_next_session_plan_items')
        .select('id,patient_id,clinic_id,organization_id')
        .eq('id', planItemId)
        .eq('clinic_id', clinicId)
        .limit(1)
        .maybeSingle();
      if (existingPlanItemError) {
        if (hasMissingFinancialSchema(existingPlanItemError)) {
          return res.status(503).json({ success: false, error: 'Schema de planejamento ABA ainda não aplicado.' });
        }
        throw existingPlanItemError;
      }
      const scopedPatientId = sanitizeString(existingPlanItem?.patient_id, 120);
      if (!existingPlanItem?.id || !isUuid(scopedPatientId)) {
        return res.status(404).json({ success: false, error: 'Item de plano não encontrado.' });
      }
      if (!(await canAccessPatientInCurrentClinic(scopedPatientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do seu escopo clínico.' });
      }
      const patch = cleanObject({
        status: req.body?.status !== undefined ? normalizeAbaPlanItemStatus(req.body.status) : undefined,
        instructions: req.body?.instructions !== undefined ? sanitizeTextField(req.body.instructions, 1000) : undefined,
        planned_trial_type: req.body?.planned_trial_type !== undefined || req.body?.plannedTrialType !== undefined
          ? normalizeAbaPlanTrialType(req.body?.planned_trial_type || req.body?.plannedTrialType)
          : undefined,
        updated_at: new Date().toISOString()
      });
      let query = supabase
        .from('aba_next_session_plan_items')
        .update(patch)
        .eq('id', planItemId);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      const { data, error } = await query.select(ABA_NEXT_SESSION_PLAN_ITEM_SELECT).maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.status(503).json({ success: false, error: 'Schema de planejamento ABA ainda não aplicado.' });
        throw error;
      }
      if (!data || sanitizeString(data.id, 180) !== planItemId) {
        return res.status(409).json({ success: false, error: 'PERSISTENCE_NOT_CONFIRMED', message: 'Não foi possível confirmar a persistência do item do plano ABA.' });
      }
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível atualizar o plano sugerido agora.' });
    }
  };
}
