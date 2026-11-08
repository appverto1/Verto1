// ABA-M07: PTS draft creation, CAS saving, activation and append-only events.
// The four clinical handler bodies are preserved verbatim. Authentication,
// tenant authorization and route registration order remain in server.ts.
export function createPtsVersionWriteHandlers(getDeps: () => any) {
  return {
    createDraft: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, loadPtsPlanWriteContext, ptsDraftInput, normalizePtsEventPayload, sanitizeClinicalPayload, supabase, crypto, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 8 * 1024, 'Criação de versão do PTS')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const planId = sanitizeString(req.params.planId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      if (!isUuid(planId) || !isUuid(patientId)) return res.status(400).json({ success: false, error: 'PTS_SCOPE_INVALID' });
      const access = await loadPtsPlanWriteContext({ patientId, planId, organizationId, actorId, actorRole });
      if (!access.plan) return res.status(404).json({ success: false, error: 'PTS_NOT_FOUND' });
      if (!access.allowed) return res.status(403).json({ success: false, error: 'PTS_EDIT_DENIED' });
      const { data, error } = await supabase.rpc('create_patient_pts_draft_v2', {
        p_plan_id: planId,
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_actor_id: actorId,
        p_now: new Date().toISOString(),
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 400);
        if (code.includes('PGRST202') || code.includes('create_patient_pts_draft_v2')) {
          return res.status(503).json({ success: false, error: 'PTS_SCHEMA_MIGRATION_REQUIRED', message: 'A migração de versionamento do PTS precisa ser aplicada antes desta ação.' });
        }
        throw error;
      }
      return res.status(201).json({ success: true, data, message: 'Rascunho criado sem alterar a versão vigente.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft [POST]', error, { fallbackMessage: 'Não foi possível criar a nova versão do PTS.' });
    }
    },
    saveDraft: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, loadPtsPlanWriteContext, ptsDraftInput, normalizePtsEventPayload, sanitizeClinicalPayload, supabase, crypto, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Rascunho do PTS')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const planId = sanitizeString(req.params.planId, 120);
      const versionId = sanitizeString(req.params.versionId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const expectedDraftRevision = Number(req.body?.expectedDraftRevision ?? req.body?.expected_draft_revision);
      if (!isUuid(planId) || !isUuid(versionId) || !isUuid(patientId) || !Number.isSafeInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
        return res.status(400).json({ success: false, error: 'PTS_DRAFT_SCOPE_INVALID' });
      }
      const access = await loadPtsPlanWriteContext({ patientId, planId, organizationId, actorId, actorRole });
      if (!access.plan) return res.status(404).json({ success: false, error: 'PTS_NOT_FOUND' });
      if (!access.allowed) return res.status(403).json({ success: false, error: 'PTS_EDIT_DENIED' });
      const input = ptsDraftInput(access.plan, req.body || {});
      if (input.error) return res.status(422).json({ success: false, error: input.error, message: 'Revise os campos do PTS antes de salvar.' });
      const { data, error } = await supabase.rpc('save_patient_pts_draft_v2', {
        p_plan_id: planId,
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_version_id: versionId,
        p_expected_draft_revision: expectedDraftRevision,
        p_common_objectives: input.commonObjectives,
        p_specialty_objectives: input.specialtyObjectives,
        p_pts_payload: input.ptsPayload,
        p_review_due_date: input.reviewDueDate,
        p_actor_id: actorId,
        p_now: new Date().toISOString(),
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 400);
        if (code.includes('PTS_DRAFT_VERSION_CONFLICT')) return res.status(409).json({ success: false, error: 'PTS_DRAFT_VERSION_CONFLICT', message: 'Este rascunho foi atualizado em outro contexto. Recarregue antes de continuar.' });
        if (code.includes('PTS_DRAFT_NOT_FOUND')) return res.status(409).json({ success: false, error: 'PTS_DRAFT_NOT_FOUND', message: 'Esta versão não é mais um rascunho editável.' });
        if (code.includes('PGRST202') || code.includes('save_patient_pts_draft_v2')) return res.status(503).json({ success: false, error: 'PTS_SCHEMA_MIGRATION_REQUIRED' });
        throw error;
      }
      return res.json({ success: true, data, message: 'Rascunho salvo. A versão vigente não foi alterada.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft/:versionId [PATCH]', error, { fallbackMessage: 'Não foi possível salvar o rascunho do PTS.' });
    }
    },
    activateDraft: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, loadPtsPlanWriteContext, ptsDraftInput, normalizePtsEventPayload, sanitizeClinicalPayload, supabase, crypto, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Ativação do PTS')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const planId = sanitizeString(req.params.planId, 120);
      const versionId = sanitizeString(req.params.versionId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const expectedDraftRevision = Number(req.body?.expectedDraftRevision ?? req.body?.expected_draft_revision);
      if (!isUuid(planId) || !isUuid(versionId) || !isUuid(patientId) || !Number.isSafeInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
        return res.status(400).json({ success: false, error: 'PTS_DRAFT_SCOPE_INVALID' });
      }
      const access = await loadPtsPlanWriteContext({ patientId, planId, organizationId, actorId, actorRole });
      if (!access.plan) return res.status(404).json({ success: false, error: 'PTS_NOT_FOUND' });
      if (!access.allowed) return res.status(403).json({ success: false, error: 'PTS_EDIT_DENIED' });
      const input = ptsDraftInput(access.plan, req.body || {});
      if (input.error) return res.status(422).json({ success: false, error: input.error, message: 'Revise os campos do PTS antes de ativar.' });
      const { data, error } = await supabase.rpc('activate_patient_pts_draft_v3', {
        p_plan_id: planId,
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_version_id: versionId,
        p_expected_draft_revision: expectedDraftRevision,
        p_common_objectives: input.commonObjectives,
        p_specialty_objectives: input.specialtyObjectives,
        p_pts_payload: input.ptsPayload,
        p_review_due_date: input.reviewDueDate,
        p_actor_id: actorId,
        p_now: new Date().toISOString(),
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 500);
        if (code.includes('PTS_DRAFT_VERSION_CONFLICT') || code.includes('PTS_DRAFT_ACTIVATION_CONFLICT')) return res.status(409).json({ success: false, error: 'PTS_DRAFT_VERSION_CONFLICT', message: 'O rascunho mudou durante a ativação. Recarregue e revise antes de tentar novamente.' });
        if (code.includes('PGRST202') || code.includes('activate_patient_pts_draft_v3')) return res.status(503).json({ success: false, error: 'PTS_SCHEMA_MIGRATION_REQUIRED', message: 'A atualização de persistência do PTS ainda não foi aplicada neste ambiente.' });
        // Older database functions rolled the save back when activation validation
        // failed. Never claim that the draft was preserved in that state.
        if (code.includes('PTS_DRAFT_VALIDATION_FAILED')) return res.status(503).json({ success: false, error: 'PTS_ACTIVATION_PERSISTENCE_MIGRATION_REQUIRED', draftPreserved: false, message: 'Atualize a migration do PTS antes de ativar. O sistema não confirmou a persistência desta tentativa.' });
        throw error;
      }
      if (data && typeof data === 'object' && (data as any).validationFailed === true) {
        return res.status(422).json({
          success: false,
          error: 'PTS_DRAFT_VALIDATION_FAILED',
          blockingScope: 'activation_only',
          draftPreserved: true,
          data: (data as any).version || null,
          message: 'O rascunho foi salvo. Complete os campos indicados para ativar o PTS; isso não impede continuar editando e salvando o plano.',
        });
      }
      return res.json({ success: true, data, message: 'PTS ativado. A versão anterior foi preservada integralmente.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-draft/:versionId/activate [POST]', error, { fallbackMessage: 'Não foi possível ativar o PTS.' });
    }
    },
    appendEvent: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, loadPtsPlanWriteContext, ptsDraftInput, normalizePtsEventPayload, sanitizeClinicalPayload, supabase, crypto, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 32 * 1024, 'Evento do PTS')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const planId = sanitizeString(req.params.planId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const eventType = sanitizeString(req.body?.eventType || req.body?.event_type, 60).toUpperCase();
      const idempotencyKey = sanitizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 180);
      const sessionId = sanitizeString(req.body?.sessionId || req.body?.session_id, 180);
      const requestedEntityId = sanitizeString(req.body?.entityId || req.body?.entity_id, 120);
      const entityId = requestedEntityId || (eventType === 'RISK_OPENED' ? crypto.randomUUID() : '');
      const occurredAtRaw = sanitizeString(req.body?.occurredAt || req.body?.occurred_at, 80);
      const occurredAtDate = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
      if (!isUuid(planId) || !isUuid(patientId) || idempotencyKey.length < 16 || Number.isNaN(occurredAtDate.getTime()) || occurredAtDate.getTime() > Date.now() + 5 * 60 * 1000) {
        return res.status(400).json({ success: false, error: 'PTS_EVENT_REQUEST_INVALID' });
      }
      if (['RISK_STATUS_UPDATED', 'RISK_RESOLVED', 'GOAL_STATUS_UPDATED'].includes(eventType) && !entityId) {
        return res.status(422).json({ success: false, error: 'PTS_EVENT_ENTITY_REQUIRED' });
      }
      const access = await loadPtsPlanWriteContext({ patientId, planId, organizationId, actorId, actorRole });
      if (!access.plan) return res.status(404).json({ success: false, error: 'PTS_NOT_FOUND' });
      if (!access.allowed) return res.status(403).json({ success: false, error: 'PTS_EDIT_DENIED' });
      const normalizedEvent = normalizePtsEventPayload(eventType, req.body || {});
      if (normalizedEvent.error || !normalizedEvent.payload) return res.status(422).json({ success: false, error: normalizedEvent.error || 'PTS_EVENT_PAYLOAD_INVALID' });

      let boundVersionId: string | null = null;
      if (sessionId) {
        if (!isUuid(organizationId)) return res.status(422).json({ success: false, error: 'PTS_COLLECTION_ORGANIZATION_INVALID' });
        const resolveResult = await supabase.rpc('resolve_patient_pts_plan_version_v1', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
          p_plan_id: planId,
          p_source_session_id: sessionId,
          p_actor_id: actorId,
          p_now: new Date().toISOString(),
        });
        if (resolveResult.error) throw resolveResult.error;
        const { data: contextRow, error: contextError } = await supabase
          .from('patient_pts_collection_contexts_v1')
          .select('pts_version_id')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('source_session_id', sessionId)
          .eq('plan_id', planId)
          .limit(1)
          .maybeSingle();
        if (contextError) throw contextError;
        boundVersionId = sanitizeString(contextRow?.pts_version_id, 120) || null;
        if (!boundVersionId) return res.status(409).json({ success: false, error: 'PTS_COLLECTION_CONTEXT_REQUIRED' });
      }

      const { data, error } = await supabase.rpc('append_patient_pts_event_v2', {
        p_plan_id: planId,
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_event_type: eventType,
        p_entity_id: entityId || null,
        p_occurred_at: occurredAtDate.toISOString(),
        p_payload: sanitizeClinicalPayload(normalizedEvent.payload),
        p_actor_id: actorId,
        p_idempotency_key: idempotencyKey,
        p_bound_version_id: boundVersionId,
        p_now: new Date().toISOString(),
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 500);
        if (code.includes('PTS_EVENT_IDEMPOTENCY_CONFLICT')) return res.status(409).json({ success: false, error: 'PTS_EVENT_IDEMPOTENCY_CONFLICT' });
        if (code.includes('PTS_EVENT_ACTIVE_VERSION_REQUIRED')) return res.status(409).json({ success: false, error: 'PTS_ACTIVE_VERSION_REQUIRED' });
        if (code.includes('PGRST202') || code.includes('append_patient_pts_event_v2')) return res.status(503).json({ success: false, error: 'PTS_SCHEMA_MIGRATION_REQUIRED' });
        throw error;
      }
      return res.status(201).json({ success: true, data, message: 'Evento clínico registrado sem alterar a versão publicada do PTS.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans/:planId/pts-events [POST]', error, { fallbackMessage: 'Não foi possível registrar o evento do PTS.' });
    }
    },
  };
}
