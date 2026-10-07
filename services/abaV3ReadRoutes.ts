import type { Express } from 'express';

type Deps = {
  supabase: any;
  sanitizeString: any;
  hasMissingFinancialSchema: any;
  requireAbaV3ReadFeature: any;
  checkAuth: any;
  requireClinicCapability: any;
  checkPatientAccess: any;
  enforcePayloadLimit: any;
  resolveAbaSessionReadScope: any;
  isUuid: any;
  currentClinicId: any;
  validateAbaSessionTargetPlanScope: any;
  parseAbaChartParams: any;
};

/**
 * ABA V3 read-only HTTP surface.
 *
 * This module is intentionally dependency-injected so the extraction from
 * server.ts does not alter authorization, tenant scoping, payload limits,
 * RPC contracts, or clinical semantics.
 */
export function registerAbaV3ReadRoutes(app: Express, deps: Deps) {
  const { supabase, sanitizeString, hasMissingFinancialSchema, requireAbaV3ReadFeature, checkAuth, requireClinicCapability, checkPatientAccess, enforcePayloadLimit, resolveAbaSessionReadScope, isUuid, currentClinicId, validateAbaSessionTargetPlanScope, parseAbaChartParams } = deps;

  const handleAbaV3ReadRpcError = (res: any, error: any) => {
    const message = sanitizeString(error?.message || '', 500);
    if (hasMissingFinancialSchema(error) || /get_aba_v3_session_collection_plan|get_aba_patient_chart_catalog_v3|get_aba_chart_series_bundle_v3|get_aba_target_chart_series_v3|get_aba_target_history_v3|get_aba_patient_overview_v3|get_aba_session_read_bundle_v3|PGRST202|42883|42P01/i.test(message)) {
      return res.status(503).json({ success: false, code: 'ABA_V3_SCHEMA_NOT_READY', error: 'Schema ABA V3 ainda não aplicado.' });
    }
    if (message.includes('ABA_V3_READ_WINDOW_')) {
      return res.status(400).json({ success: false, code: 'ABA_V3_READ_WINDOW_INVALID', error: 'Janela de consulta ABA V3 inválida.' });
    }
    if (/ABA_V3_SESSION_PLAN_TARGET_LIMIT/i.test(message)) {
      return res.status(422).json({ success: false, code: 'ABA_V3_SESSION_PLAN_TARGET_LIMIT', error: 'O plano de coleta aceita no máximo 200 targets por sessão.' });
    }
    if (/ABA_V3_CHART_BUNDLE_TARGET_COUNT_INVALID/i.test(message)) {
      return res.status(422).json({ success: false, code: 'ABA_V3_CHART_BUNDLE_TARGET_COUNT_INVALID', error: 'Selecione entre 1 e 3 alvos para comparação ABA V3.' });
    }
    if (/ABA_V3_SESSION_PLAN_(SCOPE_REQUIRED|SESSION_SCOPE_INVALID)/i.test(message)) {
      return res.status(403).json({ success: false, code: 'ABA_V3_SESSION_PLAN_SCOPE_DENIED', error: 'Acesso negado ao plano de coleta ABA V3.' });
    }
    if (message.includes('ABA_V3_READ_') && message.includes('_SCOPE_INVALID')) {
      return res.status(403).json({ success: false, code: 'ABA_V3_READ_SCOPE_DENIED', error: 'Acesso negado ao escopo ABA V3.' });
    }
    throw error;
  };

  app.post(
    '/api/aba/v3/sessions/:sessionId/collection-plan',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.trial.record'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        if (!enforcePayloadLimit(req, res, 24 * 1024, 'Plano de coleta ABA V3')) return;
        const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const sessionId = sanitizeString(req.params.sessionId, 180);
        const rawTargetIds = Array.isArray(req.body?.target_ids ?? req.body?.targetIds) ? (req.body?.target_ids ?? req.body?.targetIds) : [];
        const targetIds = Array.from(new Set(rawTargetIds.map((value: unknown) => sanitizeString(value, 180)).filter(Boolean))).slice(0, 200);
        if (!isUuid(patientId) || !isUuid(organizationId) || !sessionId || rawTargetIds.length > 200) {
          return res.status(400).json({ success: false, code: 'ABA_V3_SESSION_PLAN_SCOPE_INVALID', error: 'Escopo do plano de coleta ABA V3 inválido.' });
        }
        const sessionScope = await resolveAbaSessionReadScope(sessionId, req.session.user);
        if (!sessionScope.ok) return res.status((sessionScope as any).status || 400).json({ success: false, error: (sessionScope as any).error });
        if (sanitizeString((sessionScope as any).patientId, 120) !== patientId || sanitizeString((sessionScope as any).clinicId, 120) !== organizationId) {
          return res.status(403).json({ success: false, code: 'ABA_V3_SESSION_PLAN_SCOPE_DENIED', error: 'Sessão fora do escopo do paciente.' });
        }
        const sessionTherapeuticPlanId = sanitizeString((sessionScope as any)?.session?.therapeutic_plan_id, 120);
        if (sessionTherapeuticPlanId && targetIds.length > 0) {
          const targetScope = await validateAbaSessionTargetPlanScope({
            organizationId,
            patientId,
            therapeuticPlanId: sessionTherapeuticPlanId,
            targetIds,
          });
          if (!targetScope.ok) {
            return res.status(409).json({
              success: false,
              code: targetScope.code || 'ABA_SESSION_TARGET_PLAN_MISMATCH',
              error: 'Um ou mais alvos não pertencem ao plano por especialidade fixado nesta sessão.'
            });
          }
        }
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        const [collectionPlanResult, ptsContextResult] = await Promise.all([
          supabase.rpc('get_aba_v3_session_collection_plan', {
            p_organization_id: organizationId,
            p_patient_id: patientId,
            p_session_id: sessionId,
            p_target_ids: targetIds
          }),
          supabase.rpc('bind_patient_pts_collection_contexts_v1', {
            p_organization_id: organizationId,
            p_patient_id: patientId,
            p_source_session_id: sessionId,
            p_target_ids: targetIds,
            p_actor_id: actorId,
            p_now: new Date().toISOString(),
          }),
        ]);
        if (collectionPlanResult.error) return handleAbaV3ReadRpcError(res, collectionPlanResult.error);
        if (ptsContextResult.error) {
          const code = sanitizeString(ptsContextResult.error?.message || ptsContextResult.error?.code, 500);
          if (code.includes('PGRST202') || code.includes('bind_patient_pts_collection_contexts_v1')) {
            return res.status(503).json({ success: false, code: 'PTS_CONTEXT_SCHEMA_REQUIRED', error: 'O vínculo imutável entre sessão e versão do PTS ainda não está disponível.' });
          }
          throw ptsContextResult.error;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: collectionPlanResult.data || { session_id: sessionId, targets: [], v3_behavior_ids: [], complete: true } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/patients/:patientId/overview',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        if (!isUuid(patientId) || !isUuid(organizationId)) {
          return res.status(400).json({ success: false, error: 'Escopo ABA V3 inválido.' });
        }

        const { data, error } = await supabase.rpc('get_aba_patient_overview_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: data || { targets: [], review_counts: { maintenance_probes: 0, ioa: 0 } } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/sessions/:sessionId/read-model',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    async (req: any, res) => {
      try {
        const scope = await resolveAbaSessionReadScope(req.params.sessionId, req.session.user);
        if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
        const patientId = sanitizeString((scope as any).patientId, 120);
        const organizationId = sanitizeString((scope as any).clinicId, 120);
        const sessionId = sanitizeString(req.params.sessionId, 180);
        if (!isUuid(patientId) || !isUuid(organizationId) || !sessionId) {
          return res.status(400).json({ success: false, error: 'Escopo ABA V3 inválido.' });
        }

        const { data, error } = await supabase.rpc('get_aba_session_read_bundle_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_session_id: sessionId
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: data || null });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/patients/:patientId/targets/:targetId/history',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const targetId = sanitizeString(req.params.targetId, 180);
        if (!isUuid(patientId) || !isUuid(organizationId) || !targetId) {
          return res.status(400).json({ success: false, error: 'Escopo ABA V3 inválido.' });
        }

        const chart = parseAbaChartParams(req.query || {});
        if (new Date(chart.dateToIso).getTime() < new Date(chart.dateFromIso).getTime()) {
          return res.status(400).json({ success: false, error: 'Período ABA V3 inválido.' });
        }
        const { data, error } = await supabase.rpc('get_aba_target_history_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_target_id: targetId,
          p_from: chart.dateFromIso,
          p_to: chart.dateToIso,
          p_limit: chart.limit
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: data || { target_id: targetId, dtt: [], task_analysis: [], maintenance_probes: [] } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/patients/:patientId/chart-catalog',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        if (!isUuid(patientId) || !isUuid(organizationId)) {
          return res.status(400).json({ success: false, error: 'Escopo ABA V3 inválido.' });
        }
        const chart = parseAbaChartParams({ ...(req.query || {}), days: req.query?.days || 366 });
        const { data, error } = await supabase.rpc('get_aba_patient_chart_catalog_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_from: chart.dateFromIso,
          p_to: chart.dateToIso
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data: data || { targets: [] } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/patients/:patientId/chart-series-bundle',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const rawTargetIds = String(req.query?.targetIds || req.query?.target_ids || '')
          .split(',')
          .map((value) => sanitizeString(value, 180))
          .filter(Boolean);
        const targetIds = Array.from(new Set(rawTargetIds)).slice(0, 4);
        if (!isUuid(patientId) || !isUuid(organizationId) || targetIds.length < 1 || targetIds.length > 3 || rawTargetIds.length > 3) {
          return res.status(400).json({ success: false, code: 'ABA_V3_CHART_BUNDLE_SCOPE_INVALID', error: 'Selecione entre 1 e 3 alvos ABA V3 válidos.' });
        }
        const chart = parseAbaChartParams(req.query || {});
        const { data, error } = await supabase.rpc('get_aba_chart_series_bundle_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_target_ids: targetIds,
          p_from: chart.dateFromIso,
          p_to: chart.dateToIso,
          p_limit: chart.limit
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: data || {
            target_ids: targetIds,
            continuity_policy: 'BREAK_ON_PHASE_OR_MODEL_CHANGE',
            legacy_history_separate: true,
            available_metrics: [],
            segments: []
          }
        });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );

  app.get(
    '/api/aba/v3/patients/:patientId/targets/:targetId/chart-series',
    requireAbaV3ReadFeature,
    checkAuth,
    requireClinicCapability('aba.analytics.view'),
    checkPatientAccess,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const organizationId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const targetId = sanitizeString(req.params.targetId, 180);
        if (!isUuid(patientId) || !isUuid(organizationId) || !targetId) {
          return res.status(400).json({ success: false, error: 'Escopo ABA V3 inválido.' });
        }
        const chart = parseAbaChartParams(req.query || {});
        const { data, error } = await supabase.rpc('get_aba_target_chart_series_v3', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_target_id: targetId,
          p_from: chart.dateFromIso,
          p_to: chart.dateToIso,
          p_limit: chart.limit
        });
        if (error) return handleAbaV3ReadRpcError(res, error);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({
          success: true,
          data: data || {
            target_id: targetId,
            continuity_policy: 'BREAK_ON_PHASE_OR_MODEL_CHANGE',
            legacy_history_separate: true,
            available_metrics: [],
            segments: []
          }
        });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
      }
    }
  );


}
