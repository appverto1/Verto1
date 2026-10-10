import type { Express } from 'express';
import type { ClinicalMeasurementV3Deps } from './clinicalMeasurementV3Shared';
import { isUuid } from './clinicalMeasurementV3Shared';

// Browser access uses the application's verified HTTP session. The service-role
// RPC receives ONLY server-derived clinic/actor IDs and independently verifies
// clinic membership, patient linkage and privileges. Do not expose its RPC to anon.
export function registerAbaReinforcerCatalogRoutes(app: Express, deps: ClinicalMeasurementV3Deps) {
  const {
    supabase, noStoreDynamicResponse, checkAuth, checkPatientAccess,
    requireClinicCapability, sanitizeString, currentClinicId, enforcePayloadLimit,
  } = deps;

  const actorScope = (req: any) => {
    const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
    const clinicId = sanitizeString(currentClinicId(req.session?.user || {}), 120);
    const patientClinicId = sanitizeString(req.resolvedPatientClinicId, 120);
    const actorId = sanitizeString(req.session?.user?.id || req.session?.user?.user_id, 120);
    return {
      patientId, clinicId, actorId,
      valid: isUuid(patientId) && isUuid(clinicId) && isUuid(actorId)
        && (!patientClinicId || patientClinicId === clinicId),
    };
  };
  const forbidden = (res: any) => res.status(403).json({
    success: false, error: 'ABA_REINFORCER_ACCESS_DENIED',
    message: 'Reforçadores indisponíveis para este acesso.',
  });
  const failed = (res: any) => res.status(503).json({
    success: false, error: 'ABA_REINFORCER_UNAVAILABLE',
    message: 'Não foi possível acessar os reforçadores agora.',
  });

  app.get('/api/clinical-measurement-v3/patients/:patientId/reinforcers',
    noStoreDynamicResponse, checkAuth, requireClinicCapability('clinical.record.view'), checkPatientAccess,
    async (req: any, res: any) => {
      const scope = actorScope(req);
      if (!scope.valid) return forbidden(res);
      const includeInactive = req.query?.includeInactive === 'true';
      try {
        const result = await supabase.rpc('list_aba_patient_reinforcers_v1', {
          p_organization_id: scope.clinicId,
          p_patient_id: scope.patientId,
          p_actor_id: scope.actorId,
          p_include_inactive: includeInactive,
          p_limit: 200,
        });
        if (result.error) {
          if (String(result.error.message || '').includes('ABA_REINFORCER_READ_FORBIDDEN')) return forbidden(res);
          return failed(res);
        }
        return res.json({ success: true, data: Array.isArray(result.data) ? result.data : [] });
      } catch {
        return failed(res);
      }
    });

  app.post('/api/clinical-measurement-v3/patients/:patientId/reinforcers',
    noStoreDynamicResponse, checkAuth, requireClinicCapability('session.data.write'), checkPatientAccess,
    async (req: any, res: any) => {
      if (!enforcePayloadLimit(req, res, 4096, 'Reforçador do paciente')) return;
      const scope = actorScope(req);
      if (!scope.valid) return forbidden(res);
      const label = sanitizeString(req.body?.label, 160).trim();
      const rawLabel = String(req.body?.label ?? '');
      const rawNote = String(req.body?.note ?? '');
      const category = sanitizeString(req.body?.category, 32).trim().toUpperCase() || null;
      const note = rawNote.trim() || null;
      const reinforcerId = sanitizeString(req.body?.reinforcerId, 120) || null;
      if (!label || rawLabel.trim().length > 160 || rawNote.trim().length > 500
          || (reinforcerId !== null && !isUuid(reinforcerId))
          || (category !== null && !['SOCIAL', 'ACTIVITY', 'ITEM_OBJECT', 'SENSORY', 'FOOD', 'OTHER'].includes(category))) {
        return res.status(422).json({ success: false, error: 'ABA_REINFORCER_INPUT_INVALID', message: 'Revise os dados do reforçador.' });
      }
      try {
        const result = await supabase.rpc('save_aba_patient_reinforcer_v1', {
          p_organization_id: scope.clinicId,
          p_patient_id: scope.patientId,
          p_actor_id: scope.actorId,
          p_reinforcer_id: reinforcerId,
          p_label: label,
          p_category: category,
          p_note: note,
          p_is_active: req.body?.isActive !== false,
        });
        if (result.error) {
          if (/ABA_REINFORCER_(?:ACTOR_FORBIDDEN|NOT_FOUND|PATIENT_SCOPE_INVALID)/.test(String(result.error.message || ''))) return forbidden(res);
          if (/ABA_REINFORCER_(?:LABEL|CATEGORY|NOTE)_INVALID/.test(String(result.error.message || ''))) {
            return res.status(422).json({ success: false, error: 'ABA_REINFORCER_INPUT_INVALID', message: 'Revise os dados do reforçador.' });
          }
          return failed(res);
        }
        return res.json({ success: true, data: result.data || null });
      } catch {
        return failed(res);
      }
    });
}
