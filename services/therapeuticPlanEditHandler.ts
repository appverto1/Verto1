// ABA-M06: literal extraction of existing therapeutic plan editing logic.
// Authentication, scoped edit capability, patient access and route order remain in server.ts.
export function createTherapeuticPlanEditHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, supabase, PATIENT_THERAPEUTIC_PLAN_SELECT, isTherapeuticPlanManager, canActivateSpecialtyPlanForCase, normalizeTherapeuticSpecialtyObjectives, normalizePtsClinicalPayload, ptsLastReviewedAt, sanitizeClinicalPayload, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Escopo do Plano terapêutico')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const planId = sanitizeString(req.params.planId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const role = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const { data: existing, error: existingError } = await supabase
        .from('patient_therapeutic_plans')
        .select(PATIENT_THERAPEUTIC_PLAN_SELECT)
        .eq('id', planId)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'THERAPEUTIC_PLAN_NOT_FOUND' });

      const canManageAny = isTherapeuticPlanManager(role);
      const permittedIds = new Set([
        String(existing.responsible_professional_id),
        ...(existing.participant_professional_ids || []).map(String),
      ]);
      if (!canManageAny && !permittedIds.has(actorId)) {
        return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_EDIT_DENIED' });
      }
      if (!canManageAny) {
        const { data: actorLink, error: actorLinkError } = await supabase
          .from('patient_professional_links')
          .select('permissions,status')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('professional_id', actorId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (actorLinkError) throw actorLinkError;
        if (!actorLink || (actorLink as any)?.permissions?.write === false) {
          return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_EDIT_DENIED' });
        }
      }

      const expectedVersion = Number(req.body?.expectedVersion ?? req.body?.expected_version);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(existing.edit_version)) {
        return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_VERSION_CONFLICT', message: 'Este plano foi atualizado por outra pessoa. Recarregue antes de salvar.' });
      }
      const currentStatus = sanitizeString(existing.status, 40).toLowerCase();
      const nextStatus = sanitizeString(req.body?.status ?? existing.status, 40).toLowerCase();
      if (!['draft', 'active', 'paused', 'completed', 'archived'].includes(nextStatus)) {
        return res.status(400).json({ success: false, error: 'THERAPEUTIC_PLAN_STATUS_INVALID' });
      }
      const allowedPlanTransitions: Record<string, string[]> = {
        draft: ['draft', 'active', 'archived'],
        active: ['active', 'paused', 'completed', 'archived'],
        paused: ['paused', 'active', 'completed', 'archived'],
        completed: ['completed', 'archived'],
        archived: ['archived'],
      };
      if (!(allowedPlanTransitions[currentStatus] || [currentStatus]).includes(nextStatus)) {
        return res.status(409).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_STATUS_TRANSITION_INVALID',
          message: currentStatus === 'paused'
            ? 'Um plano pausado pode ser retomado como ativo, concluído ou arquivado.'
            : 'Esta transição de estado não é permitida para o plano clínico.',
        });
      }

      if (!canManageAny && nextStatus === 'active' && currentStatus !== 'active') {
        const canActivate = await canActivateSpecialtyPlanForCase({
          supabase, clinicId, organizationId, patientId, actorId, actorRole: role, plan: existing
        });
        if (!canActivate) return res.status(403).json({
          success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED',
          message: 'A ativação exige que você seja o especialista responsável, com vínculo clínico ativo nesta especialidade.'
        });
      }

      const hasSpecialtyObjectivesUpdate =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'specialtyObjectives') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'specialty_objectives');
      const allowedSpecialties = String(existing.mode || '').toLowerCase() === 'specialty'
        ? [existing.specialty]
        : (Array.isArray(existing.participant_specialties) ? existing.participant_specialties : []);
      const normalizedSpecialtyObjectives = hasSpecialtyObjectivesUpdate
        ? normalizeTherapeuticSpecialtyObjectives(
            req.body?.specialtyObjectives ?? req.body?.specialty_objectives,
            allowedSpecialties,
          )
        : existing.specialty_objectives;
      if (!normalizedSpecialtyObjectives) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SPECIALTY_OBJECTIVES_INVALID',
          message: 'Os objetivos por especialidade precisam pertencer somente às especialidades participantes deste plano.',
        });
      }

      const participantIds = Array.from(new Set([
        String(existing.responsible_professional_id || ''),
        ...(Array.isArray(existing.participant_professional_ids) ? existing.participant_professional_ids.map(String) : []),
      ].filter(Boolean)));
      const isPts = String(existing.mode || '').toLowerCase() === 'interdisciplinary';
      if (isPts) {
        return res.status(409).json({
          success: false,
          error: 'PTS_VERSION_ENDPOINT_REQUIRED',
          message: 'O PTS usa versões imutáveis. Salve o rascunho ou ative a versão pelo fluxo próprio do PTS.',
        });
      }
      const ptsPayload = isPts
        ? normalizePtsClinicalPayload(
            req.body?.ptsPayload ?? req.body?.pts_payload ?? existing.pts_payload,
            {
              participantIds,
              specialties: allowedSpecialties,
              defaultCaseManagerId: String(existing.responsible_professional_id || ''),
              defaultStartedAt: String(existing.created_at || '').slice(0, 10),
            },
          )
        : (existing.pts_payload && typeof existing.pts_payload === 'object' && !Array.isArray(existing.pts_payload)
            ? existing.pts_payload
            : {});
      if (isPts) {
        const existingPtsPayload = normalizePtsClinicalPayload(existing.pts_payload, {
          participantIds,
          specialties: allowedSpecialties,
          defaultCaseManagerId: String(existing.responsible_professional_id || ''),
          defaultStartedAt: String(existing.created_at || '').slice(0, 10),
        });
        const existingReviewAuthorById = new Map(
          existingPtsPayload.reviews.map((review: any) => [String(review.id), String(review.recordedBy || '')]),
        );
        ptsPayload.reviews = ptsPayload.reviews.map((review: any) => ({
          ...review,
          recordedBy: existingReviewAuthorById.get(String(review.id)) || actorId,
        }));
      }
      const requestedReviewDueDate = sanitizeString(
        req.body?.reviewDueDate ?? req.body?.review_due_date ?? ptsPayload.nextReviewDate ?? existing.review_due_date,
        10,
      );
      const reviewDueDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedReviewDueDate)
        ? requestedReviewDueDate
        : null;
      const derivedLastReviewedAt = isPts
        ? ptsLastReviewedAt(ptsPayload)
        : existing.last_reviewed_at;
      const requestedLastReviewedAt = sanitizeString(
        req.body?.lastReviewedAt ?? req.body?.last_reviewed_at ?? derivedLastReviewedAt,
        40,
      );
      const lastReviewedAt = requestedLastReviewedAt && !Number.isNaN(new Date(requestedLastReviewedAt).getTime())
        ? new Date(requestedLastReviewedAt).toISOString()
        : null;
      const commonObjectives = sanitizeClinicalPayload(
        req.body?.commonObjectives ?? req.body?.common_objectives ?? existing.common_objectives,
      );
      const specialtyObjectives = sanitizeClinicalPayload(normalizedSpecialtyObjectives);
      const now = new Date().toISOString();

      // Activating a prepared specialty cycle must complete the previous active
      // cycle and activate the new one atomically in the database.
      const switchingSpecialtyCycle =
        String(existing.mode || '').toLowerCase() === 'specialty' &&
        nextStatus === 'active' && currentStatus !== 'active';
      const rpcName = switchingSpecialtyCycle
        ? 'activate_patient_specialty_plan_v1'
        : 'update_patient_therapeutic_plan_v3';
      const { data, error } = await supabase.rpc(rpcName, {
        p_plan_id: planId,
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_expected_version: expectedVersion,
        p_common_objectives: commonObjectives,
        p_specialty_objectives: specialtyObjectives,
        p_pts_payload: sanitizeClinicalPayload(ptsPayload),
        p_review_due_date: reviewDueDate,
        p_last_reviewed_at: lastReviewedAt,
        ...(switchingSpecialtyCycle
          ? { p_actor_can_manage_all: canManageAny }
          : { p_status: nextStatus }),
        p_actor_id: actorId,
        p_now: now,
      });
      if (error) {
        const code = sanitizeString(error?.message || error?.code, 300);
        if (code.includes('THERAPEUTIC_PLAN_VERSION_CONFLICT')) {
          return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_VERSION_CONFLICT', message: 'Este plano foi atualizado por outra pessoa. Recarregue antes de salvar.' });
        }
        if (code.includes('THERAPEUTIC_PLAN_PAYLOAD_INVALID')) {
          return res.status(422).json({ success: false, error: 'THERAPEUTIC_PLAN_PAYLOAD_INVALID', message: 'Revise os campos do PTS antes de salvar.' });
        }
        if (code.includes('SPECIALTY_PLAN_SCOPE_DENIED')) {
          return res.status(403).json({ success: false, error: 'SPECIALTY_PLAN_SCOPE_DENIED',
            message: 'A ativação exige autorização sobre o plano vigente e o futuro, ou permissão da gestão clínica.' });
        }
        if (code.includes('SPECIALTY_PLAN_NOT_ACTIVATABLE') || code.includes('SPECIALTY_PLAN_TRANSITION_FAILED')) {
          return res.status(409).json({ success: false, error: 'SPECIALTY_PLAN_ACTIVATION_CONFLICT',
            message: 'O plano não pode ser ativado neste estado. Atualize e confirme qual plano está vigente.' });
        }
        if (code.includes('PGRST202') || code.includes(rpcName)) {
          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_MIGRATION_REQUIRED',
            message: 'A migração de planos terapêuticos ainda não foi aplicada no Staging.' });
        }
        throw error;
      }
      const updated = Array.isArray(data) ? data[0] : data;
      if (!updated?.id) {
        return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_VERSION_CONFLICT', message: 'Este plano foi atualizado por outra pessoa. Recarregue antes de salvar.' });
      }
      return res.json({ success: true, data: updated, message: isPts ? 'PTS versionado sem alterar o histórico anterior.' : 'Plano versionado sem alterar versões anteriores.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans/:planId [PATCH]', error, {
        fallbackMessage: 'Não foi possível atualizar o escopo do Plano terapêutico.'
      });
    }
  };
}
