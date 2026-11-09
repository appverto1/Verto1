// ABA-M15: recommendation generation and mutation handlers.
// Route order, capability gates and patient-access middleware remain in server.ts.
// Keep the existing idempotent DB RPC decision flow; resolve dependencies lazily.

export function createAbaRecommendationsGenerateHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, normalizePlanningFocusType, fetchAbaPlanningContextSummaryDriven, generateNextSessionRecommendations, abaPlanningHash, cleanObject, normalizeAbaPlanningFocusType, writeAbaRowWithSchemaFallback, normalizeAbaRecommendationType, normalizeAbaRecommendationPriority, sanitizeAbaRecommendationText, sanitizeClinicalPayload, supabase, hasMissingFinancialSchema, isMissingRelationError, enrichTherapeuticRecommendationContexts } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload de geração de planejamento ABA')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const requestedOrganizationId = sanitizeString(req.body?.organization_id || req.body?.organizationId, 120);
      if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
        return res.status(403).json({ success: false, error: 'Organização divergente do contexto autenticado.' });
      }
      const focusType = normalizePlanningFocusType(req.body?.focusType || req.body?.focus_type || req.query?.focusType || req.query?.focus_type);
      const sourceSessionId = sanitizeString(req.body?.sourceSessionId || req.body?.source_session_id || req.query?.sourceSessionId || req.query?.source_session_id, 180) || null;
      const context = await fetchAbaPlanningContextSummaryDriven({ patientId, clinicId, organizationId, sourceSessionId, focusType });
      const generated = generateNextSessionRecommendations({
        organizationId,
        patientId,
        sourceSessionId,
        focusType,
        supervisorId: actorId,
        ...context
      });
      if (generated.recommendations.length === 0) {
        return res.json({ success: true, data: [], contextHash: generated.contextHash, reusedExisting: generated.reusedExisting, identityVersion: 3 });
      }
      const focusId = `focus-${abaPlanningHash([organizationId, patientId, sourceSessionId || '', focusType, generated.contextHash])}`;
      const focusPayload = cleanObject({
        id: focusId,
        organization_id: organizationId,
        clinic_id: clinicId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        focus_type: normalizeAbaPlanningFocusType(focusType),
        status: 'GENERATED',
        created_by: actorId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      await writeAbaRowWithSchemaFallback('aba_next_session_focuses', focusPayload, 'upsert');
      const candidates = generated.recommendations.map((recommendation) => cleanObject({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sanitizeString(recommendation.source_session_id, 180) || sourceSessionId,
        next_session_focus_id: focusId,
        recommendation_type: normalizeAbaRecommendationType(recommendation.recommendation_type),
        priority: normalizeAbaRecommendationPriority(recommendation.priority),
        title: sanitizeAbaRecommendationText(recommendation.title, 240),
        summary: sanitizeAbaRecommendationText(recommendation.summary, 500),
        rationale: sanitizeAbaRecommendationText(recommendation.rationale, 1000),
        suggested_action: sanitizeAbaRecommendationText(recommendation.suggested_action, 1000),
        target_id: sanitizeString(recommendation.target_id, 120) || null,
        behavior_id: sanitizeString(recommendation.behavior_id, 120) || null,
        program_id: sanitizeString(recommendation.program_id, 120) || null,
        domain: sanitizeAbaRecommendationText(recommendation.domain, 180) || null,
        metric_name: sanitizeAbaRecommendationText(recommendation.metric_name, 160) || null,
        previous_value: recommendation.previous_value ?? null,
        current_value: recommendation.current_value ?? null,
        delta_value: recommendation.delta_value ?? null,
        evidence: sanitizeClinicalPayload(recommendation.evidence || {}),
        context_hash: sanitizeString(recommendation.context_hash || generated.contextHash, 180),
        created_at: recommendation.created_at || new Date().toISOString()
      }));
      const { data, error } = await supabase.rpc('upsert_aba_clinical_recommendations_v3', {
        p_clinic_id: clinicId,
        p_patient_id: patientId,
        p_actor_id: actorId,
        p_recommendations: candidates
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 600);
        if (code.includes('TENANT_PAYLOAD_MISMATCH') || code.includes('PATIENT_PAYLOAD_MISMATCH') || code.includes('ACTOR_FORBIDDEN') || code.includes('SCOPE_INVALID')) {
          return res.status(403).json({ success: false, error: 'Sugestão fora do escopo autenticado.' });
        }
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error) || code.includes('upsert_aba_clinical_recommendations_v3')) {
          return res.status(503).json({ success: false, error: 'Migration v3 das sugestões clínicas ainda não aplicada.' });
        }
        throw error;
      }
      const persistedRows = Array.isArray((data as any)?.recommendations) ? (data as any).recommendations : [];
      const enriched = await enrichTherapeuticRecommendationContexts({
        recommendations: persistedRows,
        patientId,
        clinicId,
        organizationId
      });
      return res.json({
        success: true,
        data: enriched.rows,
        contextHash: generated.contextHash,
        reusedExisting: generated.reusedExisting,
        identityVersion: 3
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível gerar sugestões agora.' });
    }
  };
}

export function createAbaRecommendationAcceptHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, fetchAbaRecommendationById, canAccessPatientInCurrentClinic, applyAbaRecommendationDecisionV3, abaRecommendationIdempotencyKey } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de aceite de sugestão ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const recommendation = await fetchAbaRecommendationById(sanitizeString(req.params.recommendationId, 180), clinicId);
      if (!recommendation?.id) return res.status(404).json({ success: false, error: 'Sugestão não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(recommendation.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }
      const actionType = req.body?.applyToNextSession || req.body?.createPlanItem ? 'APPLIED_TO_NEXT_SESSION' : 'ACCEPTED';
      const persisted = await applyAbaRecommendationDecisionV3({
        recommendation,
        actionType,
        payload: {},
        idempotencyKey: abaRecommendationIdempotencyKey(req),
        actor: req.session.user,
        clinicId
      });
      if (!persisted.ok) return res.status(persisted.status).json({ success: false, error: persisted.error, data: persisted.data || null, groupedRecommendationIds: persisted.groupedRecommendationIds || [] });
      return res.json({
        success: true,
        data: persisted.data,
        planItem: persisted.planItem || null,
        groupedRecommendationIds: persisted.groupedRecommendationIds || [],
        idempotent: persisted.idempotent
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível aceitar a sugestão agora.' });
    }
  };
}

export function createAbaRecommendationRejectHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, fetchAbaRecommendationById, canAccessPatientInCurrentClinic, sanitizeTextField, applyAbaRecommendationDecisionV3, abaRecommendationIdempotencyKey } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de recusa de sugestão ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const recommendation = await fetchAbaRecommendationById(sanitizeString(req.params.recommendationId, 180), clinicId);
      if (!recommendation?.id) return res.status(404).json({ success: false, error: 'Sugestão não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(recommendation.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }
      const reason = sanitizeTextField(req.body?.reason || req.body?.motivo, 500);
      if (!reason) return res.status(400).json({ success: false, error: 'Informe o motivo da recusa.' });
      const persisted = await applyAbaRecommendationDecisionV3({
        recommendation,
        actionType: 'REJECTED',
        payload: {
          reason,
          notes: sanitizeTextField(req.body?.notes || req.body?.observacao || req.body?.observation, 1000)
        },
        idempotencyKey: abaRecommendationIdempotencyKey(req),
        actor: req.session.user,
        clinicId
      });
      if (!persisted.ok) return res.status(persisted.status).json({ success: false, error: persisted.error, data: persisted.data || null, groupedRecommendationIds: persisted.groupedRecommendationIds || [] });
      return res.json({
        success: true,
        data: persisted.data,
        groupedRecommendationIds: persisted.groupedRecommendationIds || [],
        idempotent: persisted.idempotent
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível recusar a sugestão agora.' });
    }
  };
}

export function createAbaRecommendationLinkTargetHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, fetchAbaRecommendationById, canAccessPatientInCurrentClinic, supabase, hasMissingFinancialSchema, isMissingRelationError, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 24 * 1024, 'Vínculo de origem da recomendação ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const recommendationId = sanitizeString(req.params.recommendationId, 180);
      const targetId = sanitizeString(req.body?.targetId || req.body?.target_id, 180);
      if (!recommendationId || !targetId) {
        return res.status(400).json({ success: false, error: 'Selecione uma habilidade válida para completar a origem.' });
      }

      const recommendation = await fetchAbaRecommendationById(recommendationId, clinicId);
      if (!recommendation?.id || String(recommendation.organization_id || '') !== organizationId) {
        return res.status(404).json({ success: false, error: 'Recomendação não encontrada nesta clínica.' });
      }
      const patientId = sanitizeString(recommendation.patient_id, 120);
      if (!(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }

      const { data, error } = await supabase.rpc('link_therapeutic_recommendation_target', {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_recommendation_id: recommendationId,
        p_target_id: targetId,
        p_actor_id: actorId
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 400);
        if (code.includes('THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED')) {
          return res.status(409).json({ success: false, error: 'Esta recomendação já originou um programa.' });
        }
        if (code.includes('THERAPEUTIC_RECOMMENDATION_ORIGIN_ALREADY_SET')) {
          return res.status(409).json({ success: false, error: 'Esta recomendação já possui outra habilidade de origem vinculada.' });
        }
        if (code.includes('THERAPEUTIC_RECOMMENDATION_TARGET_SCOPE_INVALID') || code.includes('THERAPEUTIC_RECOMMENDATION_PROGRAM_MISMATCH')) {
          return res.status(400).json({ success: false, error: 'A habilidade selecionada não pertence ao contexto clínico desta recomendação.' });
        }
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return res.status(503).json({ success: false, error: 'A estrutura de vínculo clínico ainda não está disponível.' });
        }
        throw error;
      }
      return res.json({ success: true, data, message: 'Habilidade de origem vinculada.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/recommendations/:recommendationId/link-target [POST]', error, {
        fallbackMessage: 'Não foi possível vincular a habilidade de origem agora.'
      });
    }
  };
}

export function createAbaRecommendationEditHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, fetchAbaRecommendationById, canAccessPatientInCurrentClinic, cleanObject, sanitizeAbaRecommendationText, normalizeAbaRecommendationType, normalizeAbaRecommendationPriority, sanitizeTextField, applyAbaRecommendationDecisionV3, abaRecommendationIdempotencyKey } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload de edição de sugestão ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const recommendation = await fetchAbaRecommendationById(sanitizeString(req.params.recommendationId, 180), clinicId);
      if (!recommendation?.id) return res.status(404).json({ success: false, error: 'Sugestão não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(recommendation.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }
      const payload = cleanObject({
        title: sanitizeAbaRecommendationText(req.body?.title ?? recommendation.title, 240),
        summary: sanitizeAbaRecommendationText(req.body?.summary ?? recommendation.summary, 500),
        rationale: sanitizeAbaRecommendationText(req.body?.rationale ?? recommendation.rationale, 1000),
        suggested_action: sanitizeAbaRecommendationText(req.body?.suggested_action ?? req.body?.suggestedAction ?? recommendation.suggested_action, 1000),
        recommendation_type: normalizeAbaRecommendationType(req.body?.recommendation_type ?? req.body?.recommendationType ?? recommendation.recommendation_type),
        priority: normalizeAbaRecommendationPriority(req.body?.priority ?? recommendation.priority),
        target_id: sanitizeString(req.body?.target_id ?? req.body?.targetId ?? recommendation.target_id, 120) || null,
        behavior_id: sanitizeString(req.body?.behavior_id ?? req.body?.behaviorId ?? recommendation.behavior_id, 120) || null,
        program_id: sanitizeString(req.body?.program_id ?? req.body?.programId ?? recommendation.program_id, 120) || null,
        domain: sanitizeAbaRecommendationText(req.body?.domain ?? recommendation.domain, 180) || null,
        metric_name: sanitizeAbaRecommendationText(req.body?.metric_name ?? req.body?.metricName ?? recommendation.metric_name, 160) || null,
        clinical_note: sanitizeTextField(req.body?.clinicalNote || req.body?.clinical_note || req.body?.notes || '', 1000) || null,
        apply_for_date: sanitizeString(req.body?.applyForDate || req.body?.apply_for_date, 40) || null,
        responsible_professional_id: sanitizeString(req.body?.responsibleProfessionalId || req.body?.responsible_professional_id, 120) || null,
        changed_fields: Object.keys(req.body || {}).slice(0, 50)
      });
      const persisted = await applyAbaRecommendationDecisionV3({
        recommendation,
        actionType: 'EDITED',
        payload,
        idempotencyKey: abaRecommendationIdempotencyKey(req),
        actor: req.session.user,
        clinicId
      });
      if (!persisted.ok) return res.status(persisted.status).json({ success: false, error: persisted.error, data: persisted.data || null, groupedRecommendationIds: persisted.groupedRecommendationIds || [] });
      return res.json({
        success: true,
        data: persisted.data,
        groupedRecommendationIds: persisted.groupedRecommendationIds || [],
        idempotent: persisted.idempotent
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível editar a sugestão agora.' });
    }
  };
}

export function createAbaRecommendationApplyToNextSessionHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, fetchAbaRecommendationById, canAccessPatientInCurrentClinic, applyAbaRecommendationDecisionV3, abaRecommendationIdempotencyKey } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de aplicação ao plano ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const recommendation = await fetchAbaRecommendationById(sanitizeString(req.params.recommendationId, 180), clinicId);
      if (!recommendation?.id) return res.status(404).json({ success: false, error: 'Sugestão não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(recommendation.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }
      const persisted = await applyAbaRecommendationDecisionV3({
        recommendation,
        actionType: 'APPLIED_TO_NEXT_SESSION',
        payload: {},
        idempotencyKey: abaRecommendationIdempotencyKey(req),
        actor: req.session.user,
        clinicId
      });
      if (!persisted.ok) return res.status(persisted.status).json({ success: false, error: persisted.error, data: persisted.data || null, groupedRecommendationIds: persisted.groupedRecommendationIds || [] });
      return res.json({
        success: true,
        data: persisted.data,
        planItem: persisted.planItem || null,
        groupedRecommendationIds: persisted.groupedRecommendationIds || [],
        idempotent: persisted.idempotent
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível aplicar a sugestão ao plano agora.' });
    }
  };
}
