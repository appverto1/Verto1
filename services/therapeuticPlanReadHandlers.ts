// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createTherapeuticPlanReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; resolveHistoricalTherapeuticPlanReadCutoff: any; supabase: any; isUuid: any; THERAPEUTIC_PROGRAM_SELECT: any; THERAPEUTIC_TARGET_SELECT: any; hasMissingFinancialSchema: any; isMissingRelationError: any; normalizePtsClinicalPayload: any; filterTherapeuticPlanScopesForActor: any; resolveTherapeuticPlanScopeAccess: any; filterTherapeuticPlanProgramsForActor: any; isTherapeuticPlanManager: any; PATIENT_CASE_TEAM_MEMBERSHIP_ROLES: any; resolveProfessionalProfilePhotoUrl: any; scopeProfessionalProfilePhotoUrlForClinic: any; normalizeClinicalSpecialty: any; sanitizeTextField: any; isAbaV2ApiEnabled: any; sendRouteDbError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, resolveHistoricalTherapeuticPlanReadCutoff, supabase, isUuid, THERAPEUTIC_PROGRAM_SELECT, THERAPEUTIC_TARGET_SELECT, hasMissingFinancialSchema, isMissingRelationError, normalizePtsClinicalPayload, filterTherapeuticPlanScopesForActor, resolveTherapeuticPlanScopeAccess, filterTherapeuticPlanProgramsForActor, isTherapeuticPlanManager, PATIENT_CASE_TEAM_MEMBERSHIP_ROLES, resolveProfessionalProfilePhotoUrl, scopeProfessionalProfilePhotoUrlForClinic, normalizeClinicalSpecialty, sanitizeTextField, isAbaV2ApiEnabled, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      if (req.patientProfessionalHistoricalReadOnly === true) {
        const historicalCutoff = resolveHistoricalTherapeuticPlanReadCutoff(
          req.patientProfessionalLink,
        );
        if (!historicalCutoff) {
          return res.status(403).json({
            success: false,
            error: 'THERAPEUTIC_PLAN_HISTORICAL_ACCESS_INVALID',
            message: 'O encerramento do vínculo não possui as datas necessárias para liberar o histórico.',
          });
        }
        const { data: historicalVersions, error: historyError } = await supabase
          .from('patient_therapeutic_plan_versions')
          .select('id,plan_id,version,snapshot,authored_by,created_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .contains('authorized_reader_ids', [actorId])
          .lte('created_at', historicalCutoff.updatedAt)
          .lt('created_at', historicalCutoff.exclusiveCivilEndAt)
          .order('created_at', { ascending: false })
          .limit(100);
        if (historyError) throw historyError;
        const historicalPlanIds = Array.from(
          new Set(
            (historicalVersions || [])
              .map((version: any) => sanitizeString(version?.plan_id, 120))
              .filter(isUuid),
          ),
        );
        const historicalProgramVersionsResult = historicalPlanIds.length
          ? await supabase
              .from('aba_program_versions')
              .select('id,program_id,version,snapshot,created_at')
              .eq('organization_id', organizationId)
              .eq('patient_id', patientId)
              .lte('created_at', historicalCutoff.updatedAt)
              .lt('created_at', historicalCutoff.exclusiveCivilEndAt)
              .order('created_at', { ascending: false })
              .limit(1000)
          : { data: [], error: null };
        if (historicalProgramVersionsResult.error) {
          throw historicalProgramVersionsResult.error;
        }
        const allowedHistoricalPlanIds = new Set(historicalPlanIds);
        const latestHistoricalProgramVersions = new Map<string, any>();
        for (const row of historicalProgramVersionsResult.data || []) {
          const snapshot = row?.snapshot;
          const program = snapshot?.program;
          if (!snapshot || typeof snapshot !== 'object' || !program || typeof program !== 'object') continue;
          const planId = sanitizeString(
            (program as any)?.therapeutic_plan_id || (program as any)?.therapeuticPlanId,
            120,
          );
          const programId = sanitizeString(row?.program_id || (program as any)?.id, 180);
          if (!programId || !allowedHistoricalPlanIds.has(planId)) continue;
          const previous = latestHistoricalProgramVersions.get(programId);
          const shouldReplace =
            !previous ||
            Number(row?.version || 0) > Number(previous?.version || 0) ||
            (
              Number(row?.version || 0) === Number(previous?.version || 0) &&
              String(row?.created_at || '') > String(previous?.created_at || '')
            );
          if (shouldReplace) latestHistoricalProgramVersions.set(programId, row);
        }
        const historicalPrograms = Array.from(
          latestHistoricalProgramVersions.values(),
        ).map((row: any) => ({
          ...(row.snapshot?.program || {}),
          targets: Array.isArray(row.snapshot?.targets) ? row.snapshot.targets : [],
          history: Array.isArray(row.snapshot?.history) ? row.snapshot.history : [],
          historical_version: Number(row.version || 0),
          historical_version_created_at: row.created_at || null,
          read_only_history: true,
        }));
        const historicalObjectives = Array.from(
          new Map(
            historicalPrograms
              .map((program: any) => {
                const source = latestHistoricalProgramVersions.get(
                  sanitizeString(program?.id, 180),
                )?.snapshot;
                const objective = source?.objective;
                return objective && typeof objective === 'object'
                  ? [sanitizeString((objective as any).id, 120), objective]
                  : null;
              })
              .filter((entry: any): entry is [string, any] => Boolean(entry?.[0])),
          ).values(),
        );
        const historicalTargets = historicalPrograms.flatMap((program: any) =>
          Array.isArray(program?.targets) ? program.targets : [],
        );
        return res.json({
          success: true,
          data: {
            programs: historicalPrograms,
            objectives: historicalObjectives,
            targets: historicalTargets,
            planScopes: [],
            professionalLinks: [],
            historicalPlanVersions: historicalVersions || [],
            historicalPrograms,
            readOnlyHistory: true,
            accessEndedAt: historicalCutoff.updatedAt,
          },
          meta: {
            queryCount: 1 + (historicalPlanIds.length ? 1 : 0),
            batched: true,
            historicalSnapshotOnly: true,
            patientId,
            organizationId,
          },
        });
      }
      const [programResult, targetResult, objectiveResult, auditResult, trialResult, planScopeResult, professionalLinkResult, supervisionLinkResult, ptsWorkspaceResult] = await Promise.all([
        supabase
          .from('aba_programs')
          .select(THERAPEUTIC_PROGRAM_SELECT)
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase
          .from('aba_targets')
          .select(THERAPEUTIC_TARGET_SELECT)
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .order('sort_order', { ascending: true })
          .limit(1000),
        supabase
          .from('patient_therapeutic_objectives')
          .select('id,organization_id,clinic_id,patient_id,category,title,description,status,priority,review_due_date,created_at,updated_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .order('priority', { ascending: false })
          .limit(200),
        supabase
          .from('aba_program_audit_events')
          .select('id,organization_id,patient_id,program_id,event_type,before_state,after_state,created_by,created_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('aba_trials')
          .select('id,program_id,target_id,occurred_at')
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .not('program_id', 'is', null)
          .order('occurred_at', { ascending: false })
          .limit(500),
        supabase
          .from('patient_therapeutic_plans')
          .select('id,organization_id,clinic_id,patient_id,mode,specialty,responsible_professional_id,participant_professional_ids,participant_specialties,common_objectives,specialty_objectives,pts_payload,pts_schema_version,review_due_date,last_reviewed_at,scope_snapshot,source_template_id,source_template_version,status,edit_version,created_by,updated_by,created_at,updated_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(50),
        supabase
          .from('patient_professional_links')
          .select('id,organization_id,clinic_id,patient_id,professional_id,specialty,case_role,relationship_type,permissions,status')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('status', 'active')
          .order('relationship_type', { ascending: false })
          .limit(50),
        supabase
          .from('clinical_supervision_links')
          .select('id,clinic_id,supervisor_user_id,supervised_user_id,patient_id,status,starts_at,ended_at')
          .eq('clinic_id', clinicId)
          .eq('supervisor_user_id', actorId)
          .eq('status', 'active')
          .or(`patient_id.eq.${patientId},patient_id.is.null`)
          .limit(100),
        supabase.rpc('read_patient_pts_workspace_v2', {
          p_organization_id: organizationId,
          p_patient_id: patientId,
        })
      ]);
      const ptsWorkspaceErrorCode = sanitizeString(ptsWorkspaceResult.error?.message || ptsWorkspaceResult.error?.code, 400);
      const ptsWorkspaceSchemaMissing = Boolean(ptsWorkspaceResult.error) && (
        ptsWorkspaceErrorCode.includes('PGRST202')
        || ptsWorkspaceErrorCode.includes('read_patient_pts_workspace_v2')
      );
      const firstError = [programResult.error, targetResult.error, objectiveResult.error, auditResult.error, trialResult.error, planScopeResult.error, professionalLinkResult.error, supervisionLinkResult.error, ptsWorkspaceSchemaMissing ? null : ptsWorkspaceResult.error].find(Boolean);
      if (firstError) {
        if (hasMissingFinancialSchema(firstError) || isMissingRelationError(firstError)) {
          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_UNAVAILABLE', message: 'A estrutura do Plano terapêutico ainda não foi aplicada.' });
        }
        throw firstError;
      }

      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const professionalLinks = professionalLinkResult.data || [];
      const supervisionLinks = supervisionLinkResult.data || [];
      const accessContext = {
        actorId,
        actorRole,
        professionalLinks,
        supervisionLinks
      };
      const ptsWorkspace = !ptsWorkspaceSchemaMissing && ptsWorkspaceResult.data && typeof ptsWorkspaceResult.data === 'object'
        ? ptsWorkspaceResult.data as any
        : { documents: [], versions: [], events: [] };
      const ptsDocuments = Array.isArray(ptsWorkspace.documents) ? ptsWorkspace.documents : [];
      const ptsVersions = Array.isArray(ptsWorkspace.versions) ? ptsWorkspace.versions : [];
      const ptsEvents = Array.isArray(ptsWorkspace.events) ? ptsWorkspace.events : [];
      const ptsDocumentByPlanId = new Map<string, any>(ptsDocuments.map((document: any) => [String(document.plan_id), document]));
      const ptsVersionsByDocumentId = new Map<string, any[]>();
      const ptsVersionNumberById = new Map<string, number>();
      for (const version of ptsVersions) {
        const documentId = String(version?.document_id || '');
        if (!documentId) continue;
        const rows = ptsVersionsByDocumentId.get(documentId) || [];
        rows.push(version);
        ptsVersionsByDocumentId.set(documentId, rows);
        if (version?.id) ptsVersionNumberById.set(String(version.id), Number(version.version_number || 0));
      }
      const ptsEventsByDocumentId = new Map<string, any[]>();
      for (const event of ptsEvents) {
        const documentId = String(event?.document_id || '');
        if (!documentId) continue;
        const rows = ptsEventsByDocumentId.get(documentId) || [];
        rows.push({
          ...event,
          occurred_under_version_number: ptsVersionNumberById.get(String(event?.occurred_under_version_id || '')) || null,
        });
        ptsEventsByDocumentId.set(documentId, rows);
      }
      const buildPtsReadModel = (scope: any, documentEvents: any[] = []) => {
        const participantIds = Array.from(new Set([
          String(scope?.responsible_professional_id || ''),
          ...(Array.isArray(scope?.participant_professional_ids) ? scope.participant_professional_ids.map(String) : []),
        ].filter(Boolean)));
        const specialties = Array.isArray(scope?.participant_specialties) ? scope.participant_specialties.map(String) : [];
        const normalizedPts = normalizePtsClinicalPayload(scope?.pts_payload || {}, {
          participantIds,
          specialties,
          defaultCaseManagerId: String(scope?.responsible_professional_id || ''),
          defaultStartedAt: String(scope?.created_at || '').slice(0, 10),
        });
        const goalStatusById = new Map<string, string>(normalizedPts.goals.map((goal: any) => [String(goal.id), String(goal.status || 'pending')]));
        const riskStatusById = new Map(normalizedPts.risks.map((risk: any) => [String(risk.id), String(risk.status || 'active')]));
        let nextReviewDate = sanitizeString(scope?.review_due_date || normalizedPts.nextReviewDate, 10) || null;
        let lastReviewAt = scope?.last_reviewed_at || null;
        const orderedEvents = (Array.isArray(documentEvents) ? documentEvents : []).slice().sort((left: any, right: any) => {
          const leftAt = new Date(left?.occurred_at || left?.recorded_at || 0).getTime();
          const rightAt = new Date(right?.occurred_at || right?.recorded_at || 0).getTime();
          return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);
        });
        for (const event of orderedEvents) {
          const eventType = sanitizeString(event?.event_type, 60).toUpperCase();
          const entityId = sanitizeString(event?.entity_id, 120);
          const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
          if (eventType === 'GOAL_STATUS_UPDATED' && entityId) {
            const status = sanitizeString(payload?.status, 30).toLowerCase();
            if (['pending', 'in_progress', 'achieved', 'paused', 'cancelled'].includes(status)) goalStatusById.set(entityId, status);
          }
          if (eventType === 'RISK_OPENED' && entityId) riskStatusById.set(entityId, 'active');
          if (['RISK_STATUS_UPDATED', 'RISK_RESOLVED'].includes(eventType) && entityId) {
            const status = eventType === 'RISK_RESOLVED' ? 'resolved' : sanitizeString(payload?.status, 30).toLowerCase();
            if (['active', 'controlled', 'resolved'].includes(status)) riskStatusById.set(entityId, status);
          }
          if (eventType === 'REVIEW_RECORDED') {
            lastReviewAt = event?.occurred_at || event?.recorded_at || lastReviewAt;
            const eventNextReviewDate = sanitizeString(payload?.nextReviewDate || payload?.next_review_date, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(eventNextReviewDate)) nextReviewDate = eventNextReviewDate;
          }
        }
        const goalStatuses = Array.from(goalStatusById.values());
        const riskStatuses = Array.from(riskStatusById.values());
        return {
          goalsInProgress: goalStatuses.filter((status) => ['pending', 'in_progress'].includes(status)).length,
          achievedGoals: goalStatuses.filter((status) => status === 'achieved').length,
          activeRisks: riskStatuses.filter((status) => status === 'active').length,
          controlledRisks: riskStatuses.filter((status) => status === 'controlled').length,
          nextReviewDate,
          lastReviewAt,
        };
      };

      const visiblePlanScopes = filterTherapeuticPlanScopesForActor(
        planScopeResult.data || [],
        accessContext
      ).map((scope: any) => {
        const scopeAccess = resolveTherapeuticPlanScopeAccess(scope, accessContext);
        const canEdit = scopeAccess.canEdit;
        const accessReason = scopeAccess.reason;
        if (String(scope?.mode || '').toLowerCase() !== 'interdisciplinary') return { ...scope, canEdit, accessReason };
        const document = ptsDocumentByPlanId.get(String(scope.id));
        if (!document) return { ...scope, canEdit, accessReason, pts_lineage: null, pts_events: [], pts_read_model: buildPtsReadModel(scope, []) };
        const documentVersions = ptsVersionsByDocumentId.get(String(document.id)) || [];
        const activeVersion = documentVersions.find((version: any) => String(version?.lifecycle_status) === 'ACTIVE') || null;
        const draftVersion = documentVersions.find((version: any) => String(version?.lifecycle_status) === 'DRAFT') || null;
        const versionMeta = (version: any, includeSnapshot = false) => version ? {
          id: version.id,
          versionNumber: Number(version.version_number || 0),
          lifecycleStatus: String(version.lifecycle_status || ''),
          draftRevision: Number(version.draft_revision || 0),
          replacesVersionId: version.replaces_version_id || null,
          effectiveFrom: version.effective_from || null,
          activatedAt: version.activated_at || null,
          supersededAt: version.superseded_at || null,
          updatedAt: version.updated_at || null,
          createdAt: version.created_at || null,
          authoredBy: version.authored_by || null,
          ...(includeSnapshot ? { snapshot: version.snapshot || {} } : {}),
        } : null;
        const documentEvents = ptsEventsByDocumentId.get(String(document.id)) || [];
        return {
          ...scope,
          canEdit,
          accessReason,
          pts_lineage: {
            documentId: document.id,
            activeVersion: versionMeta(activeVersion),
            draftVersion: versionMeta(draftVersion, true),
            currentVersionNumber: Number(activeVersion?.version_number || draftVersion?.version_number || 1),
          },
          pts_events: documentEvents,
          pts_read_model: buildPtsReadModel(scope, documentEvents),
        };
      });
      const visibleProgramRows = filterTherapeuticPlanProgramsForActor(
        programResult.data || [],
        planScopeResult.data || [],
        accessContext
      );
      const visibleProgramIds = new Set(
        visibleProgramRows.map((program: any) => String(program.id))
      );
      const visibleObjectiveIds = new Set(
        visibleProgramRows
          .map((program: any) =>
            sanitizeString(program?.therapeutic_objective_id, 120)
          )
          .filter(Boolean)
      );
      const visibleObjectiveRows = isTherapeuticPlanManager(actorRole)
        ? objectiveResult.data || []
        : (objectiveResult.data || []).filter((objective: any) =>
            visibleObjectiveIds.has(String(objective.id))
          );
      const visibleTargetRows = (targetResult.data || []).filter((target: any) =>
        visibleProgramIds.has(String(target.program_id))
      );
      const linkedProfessionalIds = Array.from(new Set(
        professionalLinks
          .map((link: any) => sanitizeString(link?.professional_id, 120))
          .filter(isUuid)
      ));
      const [linkedProfilesResult, linkedMembershipsResult, linkedUsersResult] = linkedProfessionalIds.length
        ? await Promise.all([
            supabase
              .from('professional_profiles')
              .select('user_id,full_name,specialty,profile_photo_url,metadata')
              .in('user_id', linkedProfessionalIds)
              .limit(200),
            supabase
              .from('clinic_memberships')
              .select('user_id,clinic_id,role,status,specialty')
              .eq('clinic_id', clinicId)
              .in('role', Array.from(PATIENT_CASE_TEAM_MEMBERSHIP_ROLES))
              .eq('status', 'active')
              .in('user_id', linkedProfessionalIds)
              .limit(200),
            supabase
              .from('users')
              .select('id,name,email,profile_picture')
              .in('id', linkedProfessionalIds)
              .limit(200)
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null }
          ];
      if (linkedProfilesResult.error) throw linkedProfilesResult.error;
      if (linkedMembershipsResult.error) throw linkedMembershipsResult.error;
      if (linkedUsersResult.error) throw linkedUsersResult.error;
      const linkedUserById = new Map(
        (linkedUsersResult.data || []).map((user: any) => [String(user.id), user])
      );
      const rawLinkedProfileById = new Map(
        (linkedProfilesResult.data || []).map((profile: any) => [String(profile.user_id), profile])
      );
      const resolvedLinkedProfiles = await Promise.all(
        linkedProfessionalIds.map(async (professionalId) => {
          const profile: any = rawLinkedProfileById.get(String(professionalId)) || {};
          const user: any = linkedUserById.get(String(professionalId)) || {};
          return {
            ...profile,
            user_id: profile?.user_id || professionalId,
            full_name: profile?.full_name || user?.name || null,
            profile_photo_url: await resolveProfessionalProfilePhotoUrl(profile, user)
          };
        })
      );
      const scopedLinkedProfiles = resolvedLinkedProfiles.map((profile: any) => ({
        ...profile,
        profile_photo_url: scopeProfessionalProfilePhotoUrlForClinic(
          profile?.profile_photo_url,
          clinicId,
          profile?.user_id,
        )
      }));
      const linkedProfileById = new Map(
        scopedLinkedProfiles.map((profile: any) => [String(profile.user_id), profile])
      );
      const linkedMembershipById = new Map(
        (linkedMembershipsResult.data || []).map((membership: any) => [
          String(membership.user_id),
          membership,
        ])
      );
      const enrichedProfessionalLinks = professionalLinks.map((link: any) => {
        const professionalId = String(link.professional_id);
        const profile: any = linkedProfileById.get(professionalId) || {};
        const membership: any = linkedMembershipById.get(professionalId) || null;
        const membershipSpecialty = normalizeClinicalSpecialty(membership?.specialty);
        const profileSpecialty = normalizeClinicalSpecialty(profile?.specialty);
        const hasActiveClinicalMembership = Boolean(membership);
        const canWritePlan = link?.permissions?.write !== false;
        const planEligible =
          hasActiveClinicalMembership &&
          Boolean(membershipSpecialty) &&
          canWritePlan;
        return {
          ...link,
          name: sanitizeString(profile?.full_name, 180) || 'Profissional',
          profile_photo_url: profile?.profile_photo_url || null,
          specialty:
            membershipSpecialty ||
            profileSpecialty ||
            sanitizeTextField(link?.specialty, 120) ||
            null,
          specialtySnapshot:
            sanitizeTextField(link?.specialty, 120) || null,
          membershipRole: sanitizeString(membership?.role, 40) || null,
          planEligible,
          planEligibilityReason: !hasActiveClinicalMembership
            ? 'Profissional sem vínculo clínico ativo nesta clínica.'
            : !membershipSpecialty
              ? 'Especialidade clínica ainda não cadastrada na equipe desta clínica.'
              : !canWritePlan
                ? 'Vínculo sem permissão de escrita neste plano.'
                : null
        };
      });

      const targetsByProgram = new Map<string, any[]>();
      for (const target of visibleTargetRows) {
        const programId = sanitizeString((target as any)?.program_id, 180);
        if (!programId) continue;
        const list = targetsByProgram.get(programId) || [];
        list.push(target);
        targetsByProgram.set(programId, list);
      }
      const historyByProgram = new Map<string, any[]>();
      for (const event of auditResult.data || []) {
        const programId = sanitizeString((event as any)?.program_id, 180);
        if (!programId || !visibleProgramIds.has(programId)) continue;
        const list = historyByProgram.get(programId) || [];
        list.push(event);
        historyByProgram.set(programId, list);
      }
      const lastAppliedByAnyProgram = new Map<string, string>();
      for (const trial of trialResult.data || []) {
        const programId = sanitizeString((trial as any)?.program_id, 180);
        const occurredAt = sanitizeString((trial as any)?.occurred_at, 80);
        if (programId && occurredAt && !lastAppliedByAnyProgram.has(programId)) {
          lastAppliedByAnyProgram.set(programId, occurredAt);
        }
      }
      const programs = visibleProgramRows.map((program: any) => ({
        ...program,
        targets: targetsByProgram.get(String(program.id)) || [],
        history: historyByProgram.get(String(program.id)) || [],
        last_applied_at: lastAppliedByAnyProgram.get(String(program.id)) || null
      }));

      // PTS consumes an explicit, intentionally small shared projection. It
      // never receives the private specialty-plan payload merely because the
      // professional can read the shared PTS. The source plan id is omitted
      // unless the current actor can independently open that specialty plan.
      const visiblePlanScopeIds = new Set(visiblePlanScopes.map((scope: any) => String(scope?.id || '')).filter(Boolean));
      const rawPlanScopeById = new Map((planScopeResult.data || []).map((scope: any) => [String(scope?.id || ''), scope]));
      const visiblePtsPlanIds = new Set(
        visiblePlanScopes
          .filter((scope: any) => String(scope?.mode || '').toLowerCase() === 'interdisciplinary')
          .map((scope: any) => String(scope?.id || ''))
          .filter(Boolean)
      );
      const hasVisiblePts = visiblePtsPlanIds.size > 0;
      const ptsSharedEvidence = hasVisiblePts
        ? (programResult.data || []).flatMap((program: any) => {
            const sourcePlanId = sanitizeString(program?.therapeutic_plan_id, 120);
            const sourcePlan: any = rawPlanScopeById.get(sourcePlanId) || null;
            const sourceMode = String(sourcePlan?.mode || '').toLowerCase();
            const explicitlyShared = program?.advanced_settings?.shareWithPts === true || program?.advanced_settings?.share_with_pts === true;
            if (!explicitlyShared || sourceMode !== 'specialty') return [];

            const canOpenSourcePlan = visiblePlanScopeIds.has(sourcePlanId);
            return [{
              id: sanitizeString(program?.id, 180),
              name: sanitizeTextField(program?.name, 240) || 'Evidência compartilhada',
              objective: sanitizeTextField(program?.objective || program?.description, 1000) || null,
              category: sanitizeString(program?.category, 80) || null,
              status: sanitizeString(program?.status, 40) || 'draft',
              sourceSpecialty: sanitizeTextField(sourcePlan?.specialty, 120) || 'Especialidade não informada',
              sourcePlanId: canOpenSourcePlan ? sourcePlanId : null,
              canOpenSourcePlan,
              sharingMode: 'explicit_specialty_summary',
              lastAppliedAt: lastAppliedByAnyProgram.get(String(program?.id || '')) || null,
              reviewDueDate: program?.review_due_date || null,
              updatedAt: program?.updated_at || null,
            }];
          })
        : [];
      // Historical programs that were created directly under the old PTS model
      // remain readable so no clinical history disappears, but they are NOT
      // promoted to the current shared-evidence boundary. Keeping a separate
      // projection prevents legacy data from looking like an explicit share.
      const ptsLegacyEvidence = hasVisiblePts
        ? (programResult.data || []).flatMap((program: any) => {
            const sourcePlanId = sanitizeString(program?.therapeutic_plan_id, 120);
            const sourcePlan: any = rawPlanScopeById.get(sourcePlanId) || null;
            const sourceMode = String(sourcePlan?.mode || '').toLowerCase();
            if (sourceMode !== 'interdisciplinary' || !visiblePtsPlanIds.has(sourcePlanId)) return [];
            return [{
              id: sanitizeString(program?.id, 180),
              name: sanitizeTextField(program?.name, 240) || 'Registro clínico legado',
              objective: sanitizeTextField(program?.objective || program?.description, 1000) || null,
              category: sanitizeString(program?.category, 80) || null,
              status: sanitizeString(program?.status, 40) || 'draft',
              sourceSpecialty: 'Interdisciplinar',
              sourcePlanId: null,
              canOpenSourcePlan: false,
              sharingMode: 'legacy_history_only',
              lastAppliedAt: lastAppliedByAnyProgram.get(String(program?.id || '')) || null,
              reviewDueDate: program?.review_due_date || null,
              updatedAt: program?.updated_at || null,
            }];
          })
        : [];

      return res.json({
        success: true,
        data: {
          programs,
          objectives: visibleObjectiveRows,
          targets: visibleTargetRows,
          planScopes: visiblePlanScopes,
          professionalLinks: enrichedProfessionalLinks,
          ptsSharedEvidence,
          ptsLegacyEvidence,
          capabilities: {
            actorId,
            actorRole,
            programsEnabled: isAbaV2ApiEnabled(),
            canManageAllPlans: isTherapeuticPlanManager(actorRole),
            canReviewSupervisedPlans: supervisionLinks.length > 0,
            canCreatePlans:
              isTherapeuticPlanManager(actorRole) ||
              enrichedProfessionalLinks.some((link: any) =>
                String(link?.professional_id) === actorId &&
                link?.planEligible === true
              )
          }
        },
        meta: {
          queryCount: 8 + (linkedProfessionalIds.length ? 3 : 0) + (ptsWorkspaceSchemaMissing ? 0 : 1),
          batched: true,
          patientId,
          organizationId
        }
      });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/patients/:patientId/therapeutic-plan [GET]', error, {
        fallbackMessage: 'Não foi possível carregar o Plano terapêutico agora.'
      });
    }
  };
}

export function createTherapeuticTemplatesReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; supabase: any; THERAPEUTIC_TEMPLATE_SELECT: any; hasMissingFinancialSchema: any; isMissingRelationError: any; isUuid: any; sendRouteDbError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, supabase, THERAPEUTIC_TEMPLATE_SELECT, hasMissingFinancialSchema, isMissingRelationError, isUuid, sendRouteDbError } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const actorRole = sanitizeString(req.effectiveClinicRole, 80).toLowerCase();
      const canManageLibrary = ['director', 'coordinator'].includes(actorRole);
      const includeArchived = String(req.query?.includeArchived || '').toLowerCase() === 'true';
      const templateQuery = supabase
        .from('aba_program_templates')
        .select(THERAPEUTIC_TEMPLATE_SELECT)
        .or(`source_scope.eq.VERTO,organization_id.eq.${organizationId},owner_user_id.eq.${actorId}`)
        .in('status', includeArchived ? ['PUBLISHED', 'DRAFT', 'PENDING_APPROVAL', 'ARCHIVED'] : ['PUBLISHED', 'DRAFT', 'PENDING_APPROVAL'])
        .order('source_scope', { ascending: false })
        .order('name', { ascending: true })
        .limit(300);
      const [templateResult, usageResult] = await Promise.all([
        templateQuery,
        supabase
          .from('aba_programs')
          .select('origin_id')
          .eq('organization_id', organizationId)
          .eq('origin_type', 'template')
          .not('origin_id', 'is', null)
          .limit(5000)
      ]);
      if (templateResult.error || usageResult.error) {
        const firstError = templateResult.error || usageResult.error;
        if (hasMissingFinancialSchema(firstError) || isMissingRelationError(firstError)) {
          return res.status(503).json({ success: false, error: 'THERAPEUTIC_PLAN_SCHEMA_UNAVAILABLE', message: 'A biblioteca de programas ainda não foi aplicada.' });
        }
        throw firstError;
      }
      const authorIds = Array.from(new Set(
        (templateResult.data || [])
          .map((template: any) => sanitizeString(template.created_by, 120))
          .filter(isUuid)
      ));
      const { data: authors, error: authorError } = authorIds.length
        ? await supabase
            .from('users')
            .select('id,name')
            .in('id', authorIds)
            .limit(300)
        : { data: [], error: null };
      if (authorError) throw authorError;
      const authorById = new Map((authors || []).map((author: any) => [String(author.id), sanitizeString(author.name, 180) || 'Profissional']));
      const usageByTemplate = new Map<string, number>();
      for (const row of usageResult.data || []) {
        const templateId = sanitizeString((row as any)?.origin_id, 180);
        if (templateId) usageByTemplate.set(templateId, (usageByTemplate.get(templateId) || 0) + 1);
      }
      const visible = (templateResult.data || [])
        .filter((template: any) => {
          const scope = String(template.source_scope || '').toUpperCase();
          const status = String(template.status || '').toUpperCase();
          const visibility = sanitizeString(template.visibility, 20) === 'private' ? 'private' : 'clinic';
          if (scope === 'PERSONAL' || visibility === 'private') {
            return String(template.owner_user_id || '') === actorId;
          }
          return canManageLibrary || status === 'PUBLISHED';
        })
        .map((template: any) => ({
          ...template,
          author_name: authorById.get(String(template.created_by)) || (String(template.source_scope).toUpperCase() === 'VERTO' ? 'Verto' : 'Profissional'),
          patient_usage_count: usageByTemplate.get(String(template.id)) || 0
        }));
      return res.json({ success: true, data: visible, meta: { queryCount: authorIds.length ? 3 : 2, batched: true } });
    } catch (error) {
      return sendRouteDbError(res, '/api/aba/program-templates [GET]', error, {
        fallbackMessage: 'Não foi possível carregar a biblioteca de programas.'
      });
    }
  };
}
