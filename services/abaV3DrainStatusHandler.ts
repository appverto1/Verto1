type Deps = {
  sanitizeString: (value: any, maxLength?: number) => string;
  isUuid: (value: any) => boolean;
  supabase: any;
  handleAbaV3RolloutRpcError: (res: any, error: any) => any;
};

export function createAbaV3DrainStatusHandler(deps: Deps) {
  const { sanitizeString, isUuid, supabase, handleAbaV3RolloutRpcError } = deps;
  return async (req: any, res) => {
      try {
        const organizationId = sanitizeString(req.query?.organizationId || req.query?.organization_id, 120);
        const scopeType = sanitizeString(req.query?.scopeType || req.query?.scope_type || 'TARGET', 20).toUpperCase();
        const patientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120) || null;
        const programId = sanitizeString(req.query?.programId || req.query?.program_id, 180) || null;
        const targetId = sanitizeString(req.query?.targetId || req.query?.target_id, 180) || null;
        if (!isUuid(organizationId) || !['CLINIC','PATIENT','PROGRAM','TARGET'].includes(scopeType)) {
          return res.status(400).json({ success: false, code: 'ABA_V3_DRAIN_SCOPE_INVALID', error: 'Escopo de drenagem ABA V3 inválido.' });
        }
        if (patientId && !isUuid(patientId)) {
          return res.status(422).json({ success: false, code: 'ABA_V3_DRAIN_SCOPE_INVALID', error: 'Paciente da drenagem ABA V3 inválido.' });
        }
        const { data, error } = await supabase.rpc('get_aba_v3_rollout_drain_status', {
          p_organization_id: organizationId,
          p_scope_type: scopeType,
          p_patient_id: patientId,
          p_program_id: programId,
          p_target_id: targetId
        });
        if (error) return handleAbaV3RolloutRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: data || null });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    };
}
