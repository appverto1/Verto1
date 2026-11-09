// ABA-M05: literal extraction of existing plan creation logic.
// Route middleware and registration order remain in server.ts.
export function createTherapeuticPlanCreateHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, supabase, PATIENT_CASE_TEAM_MEMBERSHIP_ROLES, normalizeClinicalSpecialty, isTherapeuticPlanManager, normalizeTherapeuticSpecialtyObjectives, sanitizeClinicalPayload, stripPtsTrackingFieldsForDraft, normalizePtsClinicalPayload, emptyPtsClinicalPayload, ptsLastReviewedAt, crypto, PATIENT_THERAPEUTIC_PLAN_SELECT, sendRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Escopo do Plano terapêutico')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const mode = sanitizeString(req.body?.mode, 40).toLowerCase();
      const startAsDraft = mode === 'specialty' && req.body?.startAsDraft === true;
      const planLabel = mode === 'specialty' ? sanitizeString(req.body?.planLabel, 120) : '';
      const idempotencyKey = sanitizeString(
        req.body?.idempotencyKey || req.body?.idempotency_key,
        180
      );
      const responsibleProfessionalId = sanitizeString(req.body?.responsibleProfessionalId || req.body?.responsible_professional_id, 120);
      const requestedParticipants = Array.from(new Set(
        (Array.isArray(req.body?.participantProfessionalIds || req.body?.participant_professional_ids)
          ? req.body?.participantProfessionalIds || req.body?.participant_professional_ids
          : [])
          .slice(0, 5)
          .map((value: any) => sanitizeString(value, 120))
          .filter(Boolean)
      ));
      const participantProfessionalIds = Array.from(new Set([responsibleProfessionalId, ...requestedParticipants])).filter(Boolean);
      if (!['specialty', 'interdisciplinary'].includes(mode) || !responsibleProfessionalId) {
        return res.status(400).json({ success: false, error: 'THERAPEUTIC_PLAN_SCOPE_INVALID', message: 'Informe o tipo do plano e o profissional responsável.' });
      }
      if (!idempotencyKey) {
        return res.status(400).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_IDEMPOTENCY_KEY_REQUIRED',
          message: 'Reabra o formulário e tente salvar o plano novamente.'
        });
      }
      if (mode === 'interdisciplinary' && String(req.effectiveClinicRole || '').toLowerCase() === 'therapist') {
        return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_INTERDISCIPLINARY_MANAGEMENT_REQUIRED' });
      }
      if (participantProfessionalIds.some((id) => !isUuid(id))) {
        return res.status(400).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_PROFESSIONAL_INVALID',
          message: 'Selecione profissionais válidos da equipe desta clínica.'
        });
      }
      if (participantProfessionalIds.length > 5 || (mode === 'interdisciplinary' && participantProfessionalIds.length < 2)) {
        return res.status(400).json({ success: false, error: 'THERAPEUTIC_PLAN_PARTICIPANTS_INVALID', message: 'O Projeto Terapêutico Singular requer ao menos dois e no máximo cinco profissionais vinculados.' });
      }
      const { data: activeLinks, error: activeLinksError } = await supabase
        .from('patient_professional_links')
        .select('professional_id,specialty,permissions')
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .eq('status', 'active')
        .in('professional_id', participantProfessionalIds)
        .limit(5);
      if (activeLinksError) throw activeLinksError;
      const activeByProfessional = new Map((activeLinks || []).map((link: any) => [String(link.professional_id), link]));
      if (participantProfessionalIds.some((id) => !activeByProfessional.has(id))) {
        return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_PROFESSIONAL_NOT_LINKED', message: 'Todos os participantes precisam possuir vínculo ativo com este paciente.' });
      }
      const { data: participantMemberships, error: participantMembershipsError } = await supabase
        .from('clinic_memberships')
        .select('user_id,clinic_id,role,status,specialty')
        .eq('clinic_id', clinicId)
        .in('role', Array.from(PATIENT_CASE_TEAM_MEMBERSHIP_ROLES))
        .eq('status', 'active')
        .in('user_id', participantProfessionalIds)
        .limit(5);
      if (participantMembershipsError) throw participantMembershipsError;
      const membershipByProfessional = new Map(
        (participantMemberships || []).map((membership: any) => [
          String(membership.user_id),
          membership,
        ])
      );
      if (
        participantProfessionalIds.some(
          (professionalId) => !membershipByProfessional.has(professionalId)
        )
      ) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_PROFESSIONAL_MEMBERSHIP_INACTIVE',
          message: 'Todos os participantes precisam ter vínculo clínico ativo nesta clínica.'
        });
      }
      const participantSpecialties = participantProfessionalIds.map((id) =>
        normalizeClinicalSpecialty(
          (membershipByProfessional.get(id) as any)?.specialty
        )
      );
      if (participantSpecialties.some((specialty) => !specialty)) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SPECIALTY_UNAVAILABLE',
          message: 'Cadastre uma especialidade clínica válida para todos os participantes antes de criar o plano.'
        });
      }
      const role = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const canManageAny = isTherapeuticPlanManager(role);
      if (!canManageAny && responsibleProfessionalId !== actorId) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_RESPONSIBLE_INVALID',
          message: 'O profissional pode criar um plano somente quando ele próprio for o responsável.'
        });
      }
      if (mode === 'interdisciplinary' && !canManageAny && !participantProfessionalIds.includes(actorId)) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_PARTICIPATION_REQUIRED',
          message: 'Você precisa participar do Projeto Terapêutico Singular que está criando.'
        });
      }
      const participantLinks = participantProfessionalIds.map((id) => activeByProfessional.get(id) as any);
      if (participantLinks.some((link) => link?.permissions?.write === false)) {
        return res.status(403).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_PARTICIPANT_WRITE_REQUIRED',
          message: 'Todos os participantes precisam ter permissão de escrita no plano.'
        });
      }
      const specialty = mode === 'specialty'
        ? normalizeClinicalSpecialty(
            (membershipByProfessional.get(responsibleProfessionalId) as any)?.specialty
          )
        : null;
      if (mode === 'specialty' && !specialty) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SPECIALTY_UNAVAILABLE',
          message: 'A especialidade do responsável precisa estar cadastrada antes de criar o plano.'
        });
      }
      if (
        mode === 'specialty' &&
        participantSpecialties.some((participantSpecialty) =>
          String(participantSpecialty).toLocaleLowerCase('pt-BR') !==
          String(specialty).toLocaleLowerCase('pt-BR')
        )
      ) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SPECIALTY_MISMATCH',
          message: 'Colaboradores de outras especialidades devem participar pelo Projeto Terapêutico Singular.'
        });
      }
      if (!canManageAny) {
        const actorLink: any = activeByProfessional.get(actorId);
        if (!actorLink || actorLink?.permissions?.write === false) {
          return res.status(403).json({ success: false, error: 'THERAPEUTIC_PLAN_EDIT_DENIED' });
        }
      }
      const requestedSourceTemplateId = sanitizeString(
        req.body?.sourceTemplateId || req.body?.source_template_id,
        180
      );
      if (
        !requestedSourceTemplateId &&
        (req.body?.sourceTemplateVersion != null ||
          req.body?.source_template_version != null)
      ) {
        return res.status(400).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_TEMPLATE_INVALID',
          message: 'Selecione um modelo acessível antes de informar sua versão.'
        });
      }
      let sourceTemplateId: string | null = null;
      let sourceTemplateVersion: number | null = null;
      if (requestedSourceTemplateId) {
        const { data: sourceTemplate, error: sourceTemplateError } = await supabase
          .from('aba_program_templates')
          .select(
            'id,organization_id,clinic_id,source_scope,owner_user_id,visibility,status,template_version'
          )
          .eq('id', requestedSourceTemplateId)
          .eq('organization_id', organizationId)
          .eq('clinic_id', clinicId)
          .limit(1)
          .maybeSingle();
        if (sourceTemplateError) throw sourceTemplateError;
        const templateVisibility = sanitizeString(
          sourceTemplate?.visibility,
          20
        ).toLowerCase();
        const templateSourceScope = sanitizeString(
          sourceTemplate?.source_scope,
          20
        ).toUpperCase();
        const canReadSourceTemplate = Boolean(
          sourceTemplate?.id &&
            (
              (
                templateVisibility === 'private' &&
                String(sourceTemplate?.owner_user_id || '') === actorId
              ) ||
              (
                templateVisibility === 'clinic' &&
                templateSourceScope === 'CLINIC' &&
                sanitizeString(sourceTemplate?.status, 40).toUpperCase() ===
                  'PUBLISHED'
              )
            )
        );
        if (!canReadSourceTemplate) {
          return res.status(403).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_TEMPLATE_NOT_ACCESSIBLE',
            message: 'O modelo selecionado não está disponível para esta clínica.'
          });
        }
        const canonicalTemplateVersion = Number(
          sourceTemplate?.template_version
        );
        if (
          !Number.isSafeInteger(canonicalTemplateVersion) ||
          canonicalTemplateVersion < 1
        ) {
          return res.status(422).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_TEMPLATE_VERSION_INVALID',
            message: 'A versão do modelo selecionado não é válida.'
          });
        }
        sourceTemplateId = String(sourceTemplate.id);
        sourceTemplateVersion = canonicalTemplateVersion;
      }
      const now = new Date().toISOString();
      const commonObjectives = sanitizeClinicalPayload(
        req.body?.commonObjectives || req.body?.common_objectives || []
      );
      const normalizedSpecialtyObjectives = normalizeTherapeuticSpecialtyObjectives(
        req.body?.specialtyObjectives ?? req.body?.specialty_objectives ?? {},
        mode === 'specialty' ? [specialty] : participantSpecialties,
      );
      if (!normalizedSpecialtyObjectives) {
        return res.status(422).json({
          success: false,
          error: 'THERAPEUTIC_PLAN_SPECIALTY_OBJECTIVES_INVALID',
          message: 'Os objetivos por especialidade precisam pertencer somente às especialidades participantes deste plano.',
        });
      }
      const specialtyObjectives = sanitizeClinicalPayload(
        normalizedSpecialtyObjectives,
      );
      const ptsPayload = mode === 'interdisciplinary'
        ? stripPtsTrackingFieldsForDraft(normalizePtsClinicalPayload(
            req.body?.ptsPayload ?? req.body?.pts_payload ?? emptyPtsClinicalPayload({
              participantIds: participantProfessionalIds,
              specialties: participantSpecialties,
              defaultCaseManagerId: responsibleProfessionalId,
              defaultStartedAt: now.slice(0, 10),
            }),
            {
              participantIds: participantProfessionalIds,
              specialties: participantSpecialties,
              defaultCaseManagerId: responsibleProfessionalId,
              defaultStartedAt: now.slice(0, 10),
            },
          ))
        : {};
      const reviewDueDate = mode === 'interdisciplinary' && ptsPayload.nextReviewDate
        ? ptsPayload.nextReviewDate
        : null;
      const lastReviewedAt = mode === 'interdisciplinary'
        ? ptsLastReviewedAt(ptsPayload)
        : null;
      const requestHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            organizationId,
            clinicId,
            patientId,
            mode,
            specialty,
            startAsDraft,
            planLabel,
            responsibleProfessionalId,
            participantProfessionalIds: [...participantProfessionalIds].sort(),
            participantSpecialties: [...participantSpecialties].sort(),
            commonObjectives,
            specialtyObjectives,
            ptsPayload,
            reviewDueDate,
            lastReviewedAt,
            sourceTemplateId,
            sourceTemplateVersion
          })
        )
        .digest('hex');
      const { data: idempotentPlan, error: idempotentPlanError } = await supabase
        .from('patient_therapeutic_plans')
        .select(PATIENT_THERAPEUTIC_PLAN_SELECT)
        .eq('organization_id', organizationId)
        .eq('idempotency_key', idempotencyKey)
        .limit(1)
        .maybeSingle();
      if (idempotentPlanError) throw idempotentPlanError;
      if (idempotentPlan) {
        if (
          sanitizeString(idempotentPlan.request_hash, 80).toLowerCase() !==
          requestHash
        ) {
          return res.status(409).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_IDEMPOTENCY_CONFLICT',
            message: 'Esta chave de salvamento já foi usada com outro conteúdo.'
          });
        }
        return res.json({
          success: true,
          data: idempotentPlan,
          idempotent: true,
          message: 'Plano já criado anteriormente.'
        });
      }
      const payload = {
        organization_id: organizationId,
        clinic_id: clinicId,
        patient_id: patientId,
        mode,
        specialty,
        responsible_professional_id: responsibleProfessionalId,
        participant_professional_ids: participantProfessionalIds,
        participant_specialties: participantSpecialties,
        common_objectives: commonObjectives,
        specialty_objectives: specialtyObjectives,
        pts_payload: sanitizeClinicalPayload(ptsPayload),
        pts_schema_version: 1,
        review_due_date: reviewDueDate,
        last_reviewed_at: lastReviewedAt,
        scope_snapshot: sanitizeClinicalPayload({
          mode,
          specialty,
          planLabel,
          responsibleProfessionalId,
          participantProfessionalIds,
          participantSpecialties,
          capturedAt: now
        }),
        source_template_id: sourceTemplateId,
        source_template_version: sourceTemplateVersion,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        // Self-authored specialty plans are eligible for immediate clinical use.
        // Membership, case link and specialty were verified above. PTS remains draft.
        status: mode === 'specialty' && role === 'therapist' && responsibleProfessionalId === actorId && !startAsDraft ? 'active' : 'draft',
        edit_version: 1,
        created_by: actorId,
        updated_by: actorId,
        created_at: now,
        updated_at: now
      };
      const { data, error } = await supabase
        .from('patient_therapeutic_plans')
        .insert(payload)
        .select(PATIENT_THERAPEUTIC_PLAN_SELECT)
        .single();
      if (error) {
        if (String(error.code || '') === '23505') {
          const { data: retryPlan, error: retryError } = await supabase
            .from('patient_therapeutic_plans')
            .select(PATIENT_THERAPEUTIC_PLAN_SELECT)
            .eq('organization_id', organizationId)
            .eq('idempotency_key', idempotencyKey)
            .limit(1)
            .maybeSingle();
          if (retryError) throw retryError;
          if (
            retryPlan &&
            sanitizeString(retryPlan.request_hash, 80).toLowerCase() ===
              requestHash
          ) {
            return res.json({
              success: true,
              data: retryPlan,
              idempotent: true,
              message: 'Plano já criado anteriormente.'
            });
          }
          return res.status(409).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_SCOPE_EXISTS',
            message:
              mode === 'interdisciplinary'
                ? 'Já existe um Projeto Terapêutico Singular vigente para este paciente.'
                : 'Já existe um plano ativo desta especialidade. Crie o novo plano como rascunho para prepará-lo sem alterar as sessões atuais.'
          });
        }
        throw error;
      }
      return res.status(201).json({ success: true, data, message: 'Escopo do Plano terapêutico criado com histórico independente.' });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plans [POST]', error, {
        fallbackMessage: 'Não foi possível criar o escopo do Plano terapêutico.'
      });
    }
  };
}
