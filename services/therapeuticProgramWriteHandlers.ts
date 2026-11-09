// ABA-M08: literal extraction of therapeutic program creation, status, editing and target writes.
// Existing auth/capability/patient middleware and route order remain in server.ts.
// Dependencies are resolved on each request, without introducing new database calls.
export function createTherapeuticProgramWriteHandlers(getDeps: () => any) {
  return {
    createProgram: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, supabase, isTherapeuticPlanManager, canActivateSpecialtyPlanForCase, sanitizeTextField, sanitizeClinicalPayload, THERAPEUTIC_PROGRAM_ORIGIN_TYPES, fetchAbaRecommendationById, THERAPEUTIC_PROGRAM_SELECT, ABA_TARGET_RECOMMENDATION_SELECT, ABA_RECOMMENDATION_TYPES, THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES, fetchClinicStateWithSchemaFallback, resolveProtocolSkillOriginForRoute, sanitizeIsoDateOnly, crypto, hasMissingFinancialSchema, isMissingRelationError, therapeuticProgramErrorMessage, persistActivityLog, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Programa terapêutico')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const role = sanitizeString(req.effectiveClinicRole, 80).toLowerCase();
      const therapeuticPlanId = sanitizeString(req.body?.therapeuticPlanId || req.body?.therapeutic_plan_id, 120);
      let therapeuticPlanScope: any = null;
      if (!therapeuticPlanId) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SCOPE_REQUIRED',
          message: 'Selecione o plano por especialidade deste programa.'
        });
      }
      if (therapeuticPlanId) {
        if (!isUuid(therapeuticPlanId)) {
          return res.status(400).json({ success: false, error: 'THERAPEUTIC_PLAN_SCOPE_INVALID' });
        }
        const { data: planScope, error: planScopeError } = await supabase
          .from('patient_therapeutic_plans')
          .select('id,organization_id,clinic_id,patient_id,mode,specialty,responsible_professional_id,participant_professional_ids,status')
          .eq('id', therapeuticPlanId)
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .neq('status', 'archived')
          .limit(1)
          .maybeSingle();
        if (planScopeError) throw planScopeError;
        if (!planScope) {
          return res.status(404).json({ success: false, error: 'THERAPEUTIC_PLAN_SCOPE_NOT_FOUND' });
        }
        if (String(planScope.mode || '').toLowerCase() !== 'specialty') {
          return res.status(422).json({
            success: false,
            error: 'THERAPEUTIC_PROGRAM_SPECIALTY_PLAN_REQUIRED',
            message: 'Novos programas devem ser criados dentro de um plano por especialidade. O PTS permanece como plano compartilhado da equipe.'
          });
        }
        const scopeParticipantIds = new Set([
          String(planScope.responsible_professional_id || ''),
          ...(planScope.participant_professional_ids || []).map(String),
        ]);
        if (!isTherapeuticPlanManager(role) && !scopeParticipantIds.has(actorId)) {
          return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_EDIT_DENIED' });
        }
        if (!isTherapeuticPlanManager(role)) {
          const { data: activeLink, error: activeLinkError } = await supabase
            .from('patient_professional_links')
            .select('permissions')
            .eq('organization_id', organizationId)
            .eq('patient_id', patientId)
            .eq('professional_id', actorId)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();
          if (activeLinkError) throw activeLinkError;
          if (!activeLink || activeLink.permissions?.write === false) {
            return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_EDIT_DENIED' });
          }
        }
        therapeuticPlanScope = planScope;
      }
      const canApprove = isTherapeuticPlanManager(role);
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();
      const specialistCanActivate = !canApprove && therapeuticPlanScope?.status === 'active'
        && await canActivateSpecialtyPlanForCase({ supabase, clinicId, patientId,
          actorId, actorRole: role, organizationId, plan: therapeuticPlanScope });
      const status = therapeuticPlanScope?.status !== 'active'
        ? 'draft' // Future plans are editable, but cannot collect clinical data.
        : canApprove
          ? (['draft', 'teaching', 'maintenance'].includes(requestedStatus) ? requestedStatus : 'teaching')
          : (requestedStatus === 'draft' ? 'draft' : specialistCanActivate ? 'teaching' : 'draft');
      const originType = sanitizeString(req.body?.originType || req.body?.origin_type || 'manual', 40).toLowerCase();
      const originId = sanitizeString(req.body?.originId || req.body?.origin_id, 180) || null;
      let resolvedProtocolId = sanitizeString(req.body?.protocolId || req.body?.protocol_id, 180) || null;
      let resolvedProtocolTitle = sanitizeTextField(req.body?.protocolTitle || req.body?.protocol_title, 240) || null;
      let resolvedDomainId = sanitizeString(req.body?.domainId || req.body?.domain_id, 180) || null;
      let resolvedDomainName = sanitizeTextField(req.body?.domainName || req.body?.domain_name, 240) || null;
      const targets = (Array.isArray(req.body?.targets) ? req.body.targets : [])
        .slice(0, 50)
        .map((target: any) => ({
          name: sanitizeTextField(typeof target === 'string' ? target : target?.name, 240),
          description: sanitizeTextField(typeof target === 'object' ? target?.description : '', 500),
          masteryCriteria: sanitizeClinicalPayload(typeof target === 'object' ? target?.masteryCriteria || target?.mastery_criteria || {} : {})
        }))
        .filter((target: any) => target.name);
      if (!targets.length) return res.status(400).json({ success: false, error: 'Adicione pelo menos um alvo inicial.' });
      if (!THERAPEUTIC_PROGRAM_ORIGIN_TYPES.has(originType)) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PROGRAM_ORIGIN_INVALID',
          message: 'A origem informada para este programa não é válida.'
        });
      }

      if (originType === 'recommendation' && !originId) {
        return res.status(422).json({ success: false, error: 'THERAPEUTIC_RECOMMENDATION_CONTEXT_INCOMPLETE', message: 'Selecione uma recomendação com origem clínica identificada.' });
      }
      if (originType === 'recommendation' && originId) {
        const recommendation = await fetchAbaRecommendationById(originId, clinicId);
        if (!recommendation?.id || String(recommendation.patient_id || '') !== patientId || String(recommendation.organization_id || '') !== organizationId) {
          return res.status(400).json({ success: false, error: 'A recomendação não pertence a este paciente.' });
        }
        const recommendationStatus = sanitizeString(recommendation.status, 40).toUpperCase();
        const recommendationType = sanitizeString(recommendation.recommendation_type, 80).toUpperCase();
        const recommendationTargetId = sanitizeString(recommendation.target_id, 180);
        const [convertedResult, targetResult] = await Promise.all([
          supabase
            .from('aba_programs')
            .select(THERAPEUTIC_PROGRAM_SELECT)
            .eq('organization_id', organizationId)
            .eq('patient_id', patientId)
            .eq('origin_type', 'recommendation')
            .eq('origin_id', originId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
          recommendationTargetId
            ? supabase
                .from('aba_targets')
                .select(ABA_TARGET_RECOMMENDATION_SELECT)
                .eq('organization_id', organizationId)
                .eq('patient_id', patientId)
                .eq('id', recommendationTargetId)
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null })
        ]);
        if (convertedResult.error || targetResult.error) throw convertedResult.error || targetResult.error;
        if (convertedResult.data?.id) {
          return res.json({ success: true, data: convertedResult.data, idempotent: true, message: 'Esta recomendação já originou este programa.' });
        }
        const recommendationTarget: any = targetResult.data;
        const recommendationProgramId = sanitizeString(recommendation.program_id, 180);
        const targetProgramId = sanitizeString(recommendationTarget?.program_id, 180);
        if (
          !ABA_RECOMMENDATION_TYPES.has(recommendationType)
          || ['REJECTED', 'EXPIRED'].includes(recommendationStatus)
          || !recommendationTarget?.id
          || (recommendationProgramId && targetProgramId && recommendationProgramId !== targetProgramId)
        ) {
          return res.status(422).json({ success: false, error: 'THERAPEUTIC_RECOMMENDATION_CONTEXT_INCOMPLETE', message: 'Esta recomendação não possui uma habilidade de origem confiável para criar um programa.' });
        }
        if (!THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES.has(recommendationType) || targetProgramId) {
          return res.status(422).json({
            success: false,
            error: 'THERAPEUTIC_RECOMMENDATION_ACTION_MISMATCH',
            message: targetProgramId
              ? 'Esta habilidade já pertence a um programa. Abra o programa existente para realizar a ação clínica indicada.'
              : 'Este tipo de recomendação deve ser tratado no programa ou alvo relacionado, sem criar um novo programa.'
          });
        }
        resolvedProtocolId = sanitizeString(recommendationTarget.protocol_id, 180) || null;
        resolvedProtocolTitle = sanitizeTextField(recommendationTarget.protocol_title, 240) || null;
        resolvedDomainId = sanitizeString(recommendationTarget.domain_id, 180) || null;
        resolvedDomainName = sanitizeTextField(recommendationTarget.domain_name || recommendation.domain, 240) || null;
      }
      if (originType === 'protocol') {
        if (!originId || !resolvedProtocolId || !resolvedDomainId) {
          return res.status(422).json({
            success: false,
            error: 'THERAPEUTIC_PROTOCOL_CONTEXT_INCOMPLETE',
            message: 'Selecione um protocolo, domínio e habilidade válidos antes de continuar.'
          });
        }
        const stateResult = await fetchClinicStateWithSchemaFallback({ supabase, clinicId, logger: console });
        if (stateResult.error) throw stateResult.error;
        const protocolOrigin = resolveProtocolSkillOriginForRoute(stateResult.data?.protocols, {
          protocolId: resolvedProtocolId,
          domainId: resolvedDomainId,
          skillId: originId
        });
        if (!protocolOrigin) {
          return res.status(422).json({
            success: false,
            error: 'THERAPEUTIC_PROTOCOL_CONTEXT_INVALID',
            message: 'A habilidade selecionada não pertence ao protocolo desta clínica. Atualize os dados e tente novamente.'
          });
        }
        resolvedProtocolId = protocolOrigin.protocolId;
        resolvedProtocolTitle = protocolOrigin.protocolTitle;
        resolvedDomainId = protocolOrigin.domainId;
        resolvedDomainName = protocolOrigin.domainName;
      }
      if (originType === 'template' && originId) {
        const templateResult = await supabase
          .from('aba_program_templates')
          .select('id,organization_id,source_scope,owner_user_id,status')
          .eq('id', originId)
          .limit(1)
          .maybeSingle();
        const template: any = templateResult.data;
        const templateScope = sanitizeString(template?.source_scope, 40).toUpperCase();
        const templateStatus = sanitizeString(template?.status, 40).toUpperCase();
        const sameOrganization = String(template?.organization_id || '') === organizationId;
        const templateAllowed = template?.id && (
          (templateScope === 'VERTO' && templateStatus === 'PUBLISHED')
          || (sameOrganization && templateScope === 'CLINIC' && templateStatus !== 'ARCHIVED' && (canApprove || templateStatus === 'PUBLISHED'))
          || (templateScope === 'PERSONAL' && templateStatus !== 'ARCHIVED' && String(template.owner_user_id || '') === actorId)
        );
        if (templateResult.error || !templateAllowed) return res.status(400).json({ success: false, error: 'O modelo selecionado não está disponível para esta clínica.' });
      }

      const idempotencyKey = sanitizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 180) || `therapeutic-program:${patientId}:${crypto.randomUUID()}`;
      const { data, error } = await supabase.rpc('create_therapeutic_program', {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_name: sanitizeTextField(req.body?.name, 240),
        p_objective: sanitizeTextField(req.body?.objective, 1000),
        p_category: sanitizeString(req.body?.category || 'OUTRO', 120),
        p_measurement_type: sanitizeString(req.body?.measurementType || req.body?.measurement_type || 'independent_prompted_no_response', 80),
        p_mastery_criteria: sanitizeClinicalPayload(req.body?.masteryCriteria || req.body?.mastery_criteria || {}),
        p_targets: sanitizeClinicalPayload(targets),
        p_advanced_settings: sanitizeClinicalPayload({
          ...(req.body?.advancedSettings || req.body?.advanced_settings || {}),
          shareWithPts:
            req.body?.advancedSettings?.shareWithPts === true
            || req.body?.advancedSettings?.share_with_pts === true
            || req.body?.advanced_settings?.shareWithPts === true
            || req.body?.advanced_settings?.share_with_pts === true,
          ...(therapeuticPlanScope?.id
            ? { therapeuticPlanId: therapeuticPlanScope.id }
            : {}),
        }),
        p_origin_type: originType,
        p_origin_id: originId,
        p_protocol_id: resolvedProtocolId,
        p_protocol_title: resolvedProtocolTitle,
        p_domain_id: resolvedDomainId,
        p_domain_name: resolvedDomainName,
        p_review_due_date: sanitizeIsoDateOnly(req.body?.reviewDueDate || req.body?.review_due_date) || null,
        p_status: status,
        p_idempotency_key: idempotencyKey,
        p_actor_id: actorId
      });
      if (error) {
        if (originType === 'recommendation' && originId && sanitizeString(error?.message || error?.code, 300).includes('THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED')) {
          const existingResult = await supabase
            .from('aba_programs')
            .select(THERAPEUTIC_PROGRAM_SELECT)
            .eq('organization_id', organizationId)
            .eq('patient_id', patientId)
            .eq('origin_type', 'recommendation')
            .eq('origin_id', originId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!existingResult.error && existingResult.data?.id) {
            return res.json({ success: true, data: existingResult.data, idempotent: true, message: 'Esta recomendação já originou este programa.' });
          }
        }
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_UNAVAILABLE', message: 'A estrutura do Plano terapêutico ainda não foi aplicada.' });
        }
        return res.status(400).json({ success: false, error: therapeuticProgramErrorMessage(error) });
      }
      const parentPlanIsDraft = sanitizeString(therapeuticPlanScope?.status, 40).toLowerCase() === 'draft';
      void persistActivityLog({
        userId: actorId,
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: parentPlanIsDraft
          ? 'Programa configurado em plano rascunho'
          : status === 'awaiting_approval'
            ? 'Programa enviado para aprovação'
            : status === 'draft'
              ? 'Rascunho de programa criado'
              : 'Programa terapêutico ativado',
        content: `${sanitizeTextField(req.body?.name, 240)} foi registrado no Plano terapêutico do paciente.`,
        type: 'clinical',
        actionType: 'THERAPEUTIC_PROGRAM_CREATED',
        payload: { patientId, originType, status, parentPlanStatus: therapeuticPlanScope?.status || null }
      });
      return res.status(201).json({
        success: true,
        data,
        message: parentPlanIsDraft
          ? 'Programa configurado no rascunho; ativação clínica após publicação do plano.'
          : status === 'awaiting_approval'
            ? 'Programa enviado para aprovação.'
            : status === 'draft'
              ? 'Rascunho salvo.'
              : 'Programa ativado e disponível nas próximas sessões.'
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-programs [POST]', error, {
        fallbackMessage: 'Não foi possível criar o programa terapêutico.'
      });
    }
    },
    updateStatus: async (req: any, res: any) => {
      const { sanitizeString, currentClinicId, isTherapeuticPlanManager, canActorEditTherapeuticProgram, supabase, canActivateSpecialtyPlanForCase, sanitizeTextField, crypto, therapeuticProgramErrorMessage, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const programId = sanitizeString(req.params.programId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const role = sanitizeString(req.effectiveClinicRole, 80).toLowerCase();
      const status = sanitizeString(req.body?.status, 40).toLowerCase();
      const allowedProgramStatuses = ['draft', 'awaiting_approval', 'teaching', 'maintenance', 'paused', 'completed', 'archived'];
      if (!allowedProgramStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'THERAPEUTIC_PROGRAM_STATUS_INVALID' });
      }
      if (!isTherapeuticPlanManager(role) && !['awaiting_approval', 'teaching'].includes(status)) {
        return res.status(403).json({ success: false, error: 'Esta fase requer gestão clínica.' });
      }
      if (!isTherapeuticPlanManager(role)) {
        const canEdit = await canActorEditTherapeuticProgram({
          actorId,
          actorRole: role,
          organizationId,
          clinicId,
          patientId,
          programId
        });
        if (!canEdit) {
          return res.status(403).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_EDIT_DENIED',
            message: 'Você não possui permissão de escrita neste plano.'
          });
        }
      }
      const { data: currentProgram, error: currentProgramError } = await supabase
        .from('aba_programs')
        .select('id,status,version,therapeutic_plan_id')
        .eq('id', programId)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .limit(1)
        .maybeSingle();
      if (currentProgramError) throw currentProgramError;
      if (!currentProgram?.id) return res.status(404).json({ success: false, error: 'THERAPEUTIC_PROGRAM_NOT_FOUND' });

      const currentProgramStatus = sanitizeString(currentProgram.status, 40).toLowerCase();
      const allowedProgramTransitions: Record<string, string[]> = {
        draft: ['draft', 'awaiting_approval', 'teaching'],
        awaiting_approval: ['awaiting_approval', 'draft', 'teaching'],
        teaching: ['teaching', 'maintenance', 'paused', 'completed'],
        maintenance: ['maintenance', 'teaching', 'paused', 'completed'],
        paused: ['paused', 'teaching', 'maintenance', 'completed'],
        completed: ['completed', 'archived'],
        archived: ['archived'],
      };
      if (!(allowedProgramTransitions[currentProgramStatus] || [currentProgramStatus]).includes(status)) {
        return res.status(409).json({
          success: false,
          error: 'THERAPEUTIC_PROGRAM_STATUS_TRANSITION_INVALID',
          message: currentProgramStatus === 'paused'
            ? 'Um programa pausado pode retomar o ensino, voltar à manutenção ou ser concluído.'
            : 'Esta transição de fase não é permitida para o programa clínico.',
        });
      }

      const therapeuticPlanId = sanitizeString(currentProgram.therapeutic_plan_id, 120);
      if (!isTherapeuticPlanManager(role) && status === 'teaching' && !therapeuticPlanId) {
        return res.status(403).json({ success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED' });
      }
      if (therapeuticPlanId && ['teaching', 'maintenance'].includes(status)) {
        const { data: parentPlan, error: parentPlanError } = await supabase
          .from('patient_therapeutic_plans')
          .select('id,status,mode,specialty,clinic_id,organization_id,patient_id,responsible_professional_id')
          .eq('id', therapeuticPlanId)
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .limit(1)
          .maybeSingle();
        if (parentPlanError) throw parentPlanError;
        if (!parentPlan?.id) return res.status(409).json({ success: false, error: 'THERAPEUTIC_PLAN_NOT_FOUND' });
        if (!isTherapeuticPlanManager(role) && status === 'teaching') {
          const mayActivate = await canActivateSpecialtyPlanForCase({
            supabase, clinicId, organizationId, patientId, actorId, actorRole: role, plan: parentPlan
          });
          if (!mayActivate) return res.status(403).json({
            success: false, error: 'THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED',
            message: 'Apenas o especialista responsável por este plano ativo pode ativar o programa para as sessões.'
          });
        }
        const parentPlanStatus = sanitizeString(parentPlan.status, 40).toLowerCase();
        if (parentPlanStatus !== 'active') {
          return res.status(409).json({
            success: false,
            error: 'THERAPEUTIC_PROGRAM_PARENT_PLAN_NOT_ACTIVE',
            message: parentPlanStatus === 'paused'
              ? 'Retome o plano antes de reativar este programa.'
              : 'Publique ou ative o plano antes de colocar o programa em ensino ou manutenção.',
          });
        }
      }

      const requestedExpectedVersion = Number(req.body?.expectedVersion ?? req.body?.expected_version);
      const expectedProgramVersion = Number.isSafeInteger(requestedExpectedVersion)
        ? requestedExpectedVersion
        : Number(currentProgram.version);
      const { data, error } = await supabase.rpc('update_therapeutic_program_status', {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_program_id: programId,
        p_status: status,
        p_expected_version: Number.isSafeInteger(expectedProgramVersion) ? expectedProgramVersion : null,
        p_reason: sanitizeTextField(req.body?.reason, 500) || null,
        p_idempotency_key: sanitizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 180) || `therapeutic-program-status:${programId}:${status}:${crypto.randomUUID()}`,
        p_actor_id: actorId
      });
      if (error) return res.status(409).json({ success: false, error: therapeuticProgramErrorMessage(error) });
      return res.json({ success: true, data, message: 'Estado do programa atualizado.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-programs/:programId/status [PATCH]', error, {
        fallbackMessage: 'Não foi possível atualizar o programa.'
      });
    }
    },
    updateProgram: async (req: any, res: any) => {
      const { enforcePayloadLimit, sanitizeString, currentClinicId, canActorEditTherapeuticProgram, supabase, sanitizeTextField, sanitizeClinicalPayload, sanitizeIsoDateOnly, crypto, hasMissingFinancialSchema, isMissingRelationError, therapeuticProgramErrorMessage, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Programa terapêutico')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const programId = sanitizeString(req.params.programId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const canEdit = await canActorEditTherapeuticProgram({
        actorId,
        actorRole,
        organizationId,
        clinicId,
        patientId,
        programId
      });
      if (!canEdit) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_EDIT_DENIED',
          message: 'Você não possui permissão de escrita neste plano.'
        });
      }
      const targets = (Array.isArray(req.body?.targets) ? req.body.targets : [])
        .slice(0, 50)
        .map((target: any) => ({
          name: sanitizeTextField(typeof target === 'string' ? target : target?.name, 240),
          description: sanitizeTextField(typeof target === 'object' ? target?.description : '', 500),
          masteryCriteria: sanitizeClinicalPayload(typeof target === 'object' ? target?.masteryCriteria || target?.mastery_criteria || {} : {})
        }))
        .filter((target: any) => target.name);
      const { data, error } = await supabase.rpc('update_therapeutic_program', {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_program_id: programId,
        p_name: sanitizeTextField(req.body?.name, 240),
        p_objective: sanitizeTextField(req.body?.objective, 1000),
        p_category: sanitizeString(req.body?.category || 'OUTRO', 120),
        p_measurement_type: sanitizeString(req.body?.measurementType || req.body?.measurement_type || 'independent_prompted_no_response', 80),
        p_mastery_criteria: sanitizeClinicalPayload(req.body?.masteryCriteria || req.body?.mastery_criteria || {}),
        p_advanced_settings: sanitizeClinicalPayload({
          ...(req.body?.advancedSettings || req.body?.advanced_settings || {}),
          shareWithPts:
            req.body?.advancedSettings?.shareWithPts === true
            || req.body?.advancedSettings?.share_with_pts === true
            || req.body?.advanced_settings?.shareWithPts === true
            || req.body?.advanced_settings?.share_with_pts === true,
        }),
        p_targets: sanitizeClinicalPayload(targets),
        p_review_due_date: sanitizeIsoDateOnly(req.body?.reviewDueDate || req.body?.review_due_date) || null,
        p_expected_version: Number.isFinite(Number(req.body?.expectedVersion ?? req.body?.expected_version)) ? Number(req.body?.expectedVersion ?? req.body?.expected_version) : null,
        p_reason: sanitizeTextField(req.body?.reason || 'Programa atualizado', 500),
        p_idempotency_key: sanitizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 180) || `therapeutic-program-update:${programId}:${crypto.randomUUID()}`,
        p_actor_id: actorId
      });
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_UNAVAILABLE', message: 'A estrutura do Plano terapêutico ainda não foi aplicada.' });
        }
        return res.status(400).json({ success: false, error: therapeuticProgramErrorMessage(error) });
      }
      return res.json({ success: true, data, message: 'Programa atualizado e versionado.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-programs/:programId [PATCH]', error, {
        fallbackMessage: 'Não foi possível atualizar o programa terapêutico.'
      });
    }
    },
    addTarget: async (req: any, res: any) => {
      const { sanitizeString, currentClinicId, canActorEditTherapeuticProgram, supabase, sanitizeTextField, crypto, therapeuticProgramErrorMessage, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const programId = sanitizeString(req.params.programId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const canEdit = await canActorEditTherapeuticProgram({
        actorId,
        actorRole,
        organizationId,
        clinicId,
        patientId,
        programId
      });
      if (!canEdit) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_EDIT_DENIED',
          message: 'Você não possui permissão de escrita neste plano.'
        });
      }
      const { data, error } = await supabase.rpc('add_therapeutic_program_target', {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_program_id: programId,
        p_name: sanitizeTextField(req.body?.name, 240),
        p_description: sanitizeTextField(req.body?.description, 500) || null,
        p_idempotency_key: sanitizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 180) || `therapeutic-target:${programId}:${crypto.randomUUID()}`,
        p_actor_id: actorId
      });
      if (error) return res.status(400).json({ success: false, error: therapeuticProgramErrorMessage(error) });
      return res.status(201).json({ success: true, data, message: 'Alvo adicionado ao programa.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-programs/:programId/targets [POST]', error, {
        fallbackMessage: 'Não foi possível adicionar o alvo.'
      });
    }
    },
  };
}
