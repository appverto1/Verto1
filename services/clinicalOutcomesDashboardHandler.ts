// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createClinicalOutcomesDashboardHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; supabase: any; applyAbaChartTenantScope: any; ABA_SESSION_METRIC_SNAPSHOT_SELECT: any; isMissingRelationError: any; hasMissingFinancialSchema: any; normalizeClinicalSpecialty: any; filterTherapeuticPlanScopesForActor: any; filterClinicalGraphPlanScopesForActor: any; canEditTherapeuticPlanScope: any; filterTherapeuticPlanProgramsForActor: any; isClinicalPlanV3ReaderUnavailable: any; normalizeClinicalPlanOutcomesV3ForDashboard: any; finiteClinicalOutcomeNumber: any; normalizeAbaSnapshotPoint: any; clinicalGraphLegacySnapshotVisibleToActor: any; abaMetricUnit: any; mergeClinicalOutcomeRowsV3First: any; sanitizeTextField: any; sendRouteDbError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, applyAbaChartTenantScope, ABA_SESSION_METRIC_SNAPSHOT_SELECT, isMissingRelationError, hasMissingFinancialSchema, normalizeClinicalSpecialty, filterTherapeuticPlanScopesForActor, filterClinicalGraphPlanScopesForActor, canEditTherapeuticPlanScope, filterTherapeuticPlanProgramsForActor, isClinicalPlanV3ReaderUnavailable, normalizeClinicalPlanOutcomesV3ForDashboard, finiteClinicalOutcomeNumber, normalizeAbaSnapshotPoint, clinicalGraphLegacySnapshotVisibleToActor, abaMetricUnit, mergeClinicalOutcomeRowsV3First, sanitizeTextField, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      if (!isUuid(patientId)) {
        return res.json({ success: true, data: { plans: [], observations: [], contributions: [], phases: [], specialties: [] } });
      }
      const requestedDateFrom = sanitizeString(req.query?.dateFrom, 10);
      const requestedDateTo = sanitizeString(req.query?.dateTo, 10);
      const hasExplicitRange = Boolean(requestedDateFrom || requestedDateTo);
      if (hasExplicitRange && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDateTo))) {
        return res.status(400).json({ success: false, error: 'CLINICAL_OUTCOMES_PERIOD_INVALID', message: 'Informe o período clínico com data inicial e final válidas.' });
      }

      const requestedDaysFallback = Math.max(7, Math.min(730, Number(req.query?.days || 90) || 90));
      const dateTo = hasExplicitRange
        ? new Date(`${requestedDateTo}T23:59:59.999Z`)
        : new Date();
      const dateFrom = hasExplicitRange
        ? new Date(`${requestedDateFrom}T00:00:00.000Z`)
        : new Date(dateTo.getTime() - requestedDaysFallback * 86_400_000);
      if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime()) || dateTo < dateFrom) {
        return res.status(400).json({ success: false, error: 'CLINICAL_OUTCOMES_PERIOD_INVALID', message: 'O período clínico informado é inválido.' });
      }
      const requestedDays = Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86_400_000));
      if (requestedDays > 730) {
        return res.status(400).json({ success: false, error: 'CLINICAL_OUTCOMES_PERIOD_TOO_LARGE', message: 'O período máximo para os gráficos clínicos é de 730 dias.' });
      }
      const dateFromIso = dateFrom.toISOString();
      const dateToIso = dateTo.toISOString();

      const [planResult, linkResult, supervisionResult, programResult, targetResult, snapshotResult, definitionResult, observationResult, contributionResult, phaseResult, ptsContextResult, taskReviewResult] = await Promise.all([
        supabase
          .from('patient_therapeutic_plans')
          .select('id,organization_id,clinic_id,patient_id,mode,specialty,responsible_professional_id,participant_professional_ids,participant_specialties,common_objectives,specialty_objectives,pts_payload,pts_schema_version,review_due_date,last_reviewed_at,status,edit_version,created_at,updated_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(50),
        supabase
          .from('patient_professional_links')
          .select('patient_id,professional_id,status,permissions')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('status', 'active')
          .limit(20),
        supabase
          .from('clinical_supervision_links')
          .select('clinic_id,patient_id,supervisor_user_id,supervised_user_id,status')
          .eq('clinic_id', clinicId).eq('patient_id', patientId).eq('supervisor_user_id', actorId).eq('status', 'active').limit(100),
        supabase
          .from('aba_programs')
          .select('id,patient_id,therapeutic_plan_id,therapeutic_objective_id,domain_id,domain_name,name,status,measurement_type,mastery_criteria,responsible_professional_ids,created_by')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .limit(300),
        supabase
          .from('aba_targets')
          .select('id,program_id,name,description,target_type,measurement_type,phase,clinical_status,mastery_criteria')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .limit(1000),
        applyAbaChartTenantScope(
          supabase
            .from('aba_session_metric_snapshots')
            .select(ABA_SESSION_METRIC_SNAPSHOT_SELECT)
            .eq('patient_id', patientId)
            .gte('changed_at', dateFromIso)
            .lte('changed_at', dateToIso)
            .order('changed_at', { ascending: true })
            .limit(1000),
          req.session.user,
          clinicId,
          organizationId
        ),
        supabase
          .from('clinical_measure_definitions')
          .select('id,plan_id,goal_id,program_id,specialty,name,metric_key,metric_type,unit,direction,target_type,target_value,target_min,target_max,instrument_id,instrument_version,definition_version,minimum_data_points,aggregation_method,recency_window_days,active')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('active', true)
          .limit(500),
        supabase
          .from('clinical_observations')
          .select('id,plan_id,plan_version,goal_id,program_id,session_id,professional_id,specialty,measure_definition_id,metric_key,metric_label,metric_type,unit,direction,value,numerator,denominator,observed_at,context,source,instrument_id,instrument_version,definition_version,missing_reason,metadata')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .gte('observed_at', dateFromIso)
          .lte('observed_at', dateToIso)
          .order('observed_at', { ascending: true })
          .limit(2000),
        supabase
          .from('clinical_goal_contributions')
          .select('id,pts_plan_id,pts_goal_id,specialty_plan_id,specialty_goal_id,specialty,contribution_type,status,validated_by,validated_at,updated_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .limit(500),
        supabase
          .from('clinical_plan_phases')
          .select('id,plan_id,goal_id,program_id,metric_key,phase_type,label,reason,started_at,ended_at,plan_version,created_by,created_at')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .lte('started_at', dateToIso)
          .order('started_at', { ascending: true })
          .limit(500),
        isUuid(organizationId)
          ? supabase
              .from('patient_pts_collection_contexts_v1')
              .select('source_session_id,plan_id,specialty_plan_id,version_number,context_opened_at')
              .eq('organization_id', organizationId)
              .eq('patient_id', patientId)
              .gte('context_opened_at', dateFromIso)
              .lte('context_opened_at', dateToIso)
              .limit(2000)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('adult_task_reviews')
          .select('assigned_task_id,therapeutic_plan_id,therapeutic_objective_id,therapeutic_program_id,clinical_target_id,clinical_link_snapshot,evidence_kind,task_title,patient_effort,patient_effort_label,patient_comment,pro_score,max_score,pro_review_note,completed_at,reviewed_at')
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .gte('reviewed_at', dateFromIso)
          .lte('reviewed_at', dateToIso)
          .order('reviewed_at', { ascending: true })
          .limit(500),
      ]);

      const criticalError = [planResult.error, linkResult.error, supervisionResult.error, programResult.error, targetResult.error, snapshotResult.error].find(Boolean);
      if (criticalError) throw criticalError;
      const clinicalSchemaResults = [definitionResult, observationResult, contributionResult, phaseResult];
      const clinicalSchemaAvailable = clinicalSchemaResults.every((result: any) => !result.error);
      const unexpectedClinicalError = clinicalSchemaResults.map((result: any) => result.error).find((error: any) => error && !isMissingRelationError(error) && !hasMissingFinancialSchema(error));
      if (unexpectedClinicalError) throw unexpectedClinicalError;
      if (ptsContextResult.error && !isMissingRelationError(ptsContextResult.error) && !hasMissingFinancialSchema(ptsContextResult.error)) {
        throw ptsContextResult.error;
      }
      const taskReviewSchemaAvailable = !taskReviewResult.error;
      if (taskReviewResult.error && !isMissingRelationError(taskReviewResult.error) && !hasMissingFinancialSchema(taskReviewResult.error) && !/column .* does not exist|adult_task_reviews/i.test(String(taskReviewResult.error?.message || ''))) {
        throw taskReviewResult.error;
      }
      const ptsVersionBySessionPlan = new Map<string, number>();
      for (const contextRow of ptsContextResult.error ? [] : ptsContextResult.data || []) {
        const sessionId = sanitizeString((contextRow as any)?.source_session_id, 180);
        const ptsPlanId = sanitizeString((contextRow as any)?.plan_id, 120);
        const specialtyPlanId = sanitizeString((contextRow as any)?.specialty_plan_id, 120);
        const versionNumber = Number((contextRow as any)?.version_number || 0);
        if (sessionId && versionNumber > 0) {
          if (ptsPlanId) ptsVersionBySessionPlan.set(`${sessionId}::${ptsPlanId}`, versionNumber);
          if (specialtyPlanId) ptsVersionBySessionPlan.set(`${sessionId}::${specialtyPlanId}`, versionNumber);
        }
      }

      const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
      const actorSpecialty =
        normalizeClinicalSpecialty(
          req.patientActorSpecialty ||
          req.session.user?.activeAccessContext?.specialty
        ) || null;
      const hasGraphSupervisionAccess =
        actorRole === 'supervisor' || Boolean(req.patientSupervisionLink);
      const graphActorScope = {
        actorRole,
        actorSpecialty,
        hasSupervisionAccess: hasGraphSupervisionAccess
      };
      const accessContext = { actorId, actorRole, professionalLinks: linkResult.data || [], supervisionLinks: supervisionResult.data || [] };
      const allPlans = planResult.data || [];
      const rebacVisiblePlans = filterTherapeuticPlanScopesForActor(allPlans, accessContext);
      const graphVisiblePlanScopes = filterClinicalGraphPlanScopesForActor(rebacVisiblePlans, graphActorScope);
      const visiblePlans = graphVisiblePlanScopes.map((plan: any) => ({
        ...plan,
        canEdit: canEditTherapeuticPlanScope(plan, accessContext)
      }));
      const visiblePlanIds = new Set(visiblePlans.map((plan: any) => String(plan.id)));
      const visiblePrograms = filterTherapeuticPlanProgramsForActor(programResult.data || [], graphVisiblePlanScopes, accessContext);
      const visibleProgramIds = new Set(visiblePrograms.map((program: any) => String(program.id)));
      const visibleProgramIdList = Array.from(visibleProgramIds).map((programId) => sanitizeString(programId, 180)).filter(Boolean);
      const historyBindingResult = isUuid(clinicId) && visibleProgramIdList.length > 0
        ? await supabase.from('aba_session_target_measurement_bindings')
          .select('session_id,target_id,program_id,measurement_model_version,program_version_id,program_version_snapshot,measurement_type_snapshot,target_status_snapshot,decision_at')
          .eq('organization_id', clinicId).eq('patient_id', patientId)
          .in('program_id', visibleProgramIdList)
          .gte('decision_at', dateFromIso).lte('decision_at', dateToIso).limit(5000)
        : { data: [], error: null };
      if (historyBindingResult.error) throw historyBindingResult.error;
      const programById = new Map(visiblePrograms.map((program: any) => [String(program.id), program]));
      const targetById = new Map((targetResult.data || []).filter((target: any) => visibleProgramIds.has(String(target.program_id))).map((target: any) => [String(target.id), target]));
      const definitionById = new Map((definitionResult.error ? [] : definitionResult.data || []).filter((definition: any) => visiblePlanIds.has(String(definition.plan_id))).map((definition: any) => [String(definition.id), definition]));

      const historyBindingBySessionTarget = new Map((historyBindingResult.data || []).map((binding: any) => [`${String(binding.session_id)}::${String(binding.target_id)}`, binding]));
      const visiblePlanMap = new Map(visiblePlans.map((plan: any) => [String(plan.id), plan]));
      const visiblePlanIdList = Array.from(visiblePlanIds).filter((planId: string) => isUuid(planId));
      const objectivePlanMap = new Map<string, Set<string>>();
      for (const program of visiblePrograms) {
        const objectiveId = sanitizeString(program?.therapeutic_objective_id, 120);
        const planId = sanitizeString(program?.therapeutic_plan_id, 120);
        if (!isUuid(objectiveId) || !visiblePlanIds.has(planId)) continue;
        const current = objectivePlanMap.get(objectiveId) || new Set<string>();
        current.add(planId);
        objectivePlanMap.set(objectiveId, current);
      }
      const visibleObjectiveIds = Array.from(objectivePlanMap.keys());
      let v3ReadModelAvailable = isUuid(clinicId);
      let v3PlanOutcomeRows: any[] = [];
      let v3RpcCount = 0;
      if (isUuid(clinicId) && (visiblePlanIdList.length > 0 || visibleObjectiveIds.length > 0)) {
        const v3Result = await supabase.rpc('read_clinical_outcomes_converged_v3', {
          p_organization_id: clinicId,
          p_patient_id: patientId,
          p_date_from: dateFromIso.slice(0, 10),
          p_date_to: dateToIso.slice(0, 10),
          p_plan_ids: visiblePlanIdList,
          p_therapeutic_objective_ids: visibleObjectiveIds,
          p_program_ids: visibleProgramIdList,
          p_limit: 5000,
        });
        v3RpcCount = 1;
        if (v3Result.error) {
          if (isClinicalPlanV3ReaderUnavailable(v3Result.error)) {
            v3ReadModelAvailable = false;
          } else {
            throw v3Result.error;
          }
        } else {
          v3PlanOutcomeRows = normalizeClinicalPlanOutcomesV3ForDashboard(v3Result.data || [], visiblePlanMap, objectivePlanMap, targetById, programById, ptsVersionBySessionPlan, historyBindingBySessionTarget);
        }
      }

      const structuredObservations = (observationResult.error ? [] : observationResult.data || [])
        .filter((row: any) => visiblePlanIds.has(String(row.plan_id)))
        .map((row: any) => {
          const definition: any = definitionById.get(String(row.measure_definition_id || '')) || {};
          return {
            id: String(row.id),
            planId: row.plan_id,
            planVersion: row.plan_version,
            goalId: row.goal_id,
            programId: row.program_id,
            sessionId: row.session_id,
            professionalId: row.professional_id,
            specialty: row.specialty || definition.specialty || null,
            metricKey: row.metric_key || definition.metric_key,
            metricLabel: row.metric_label || definition.name || row.metric_key,
            metricType: row.metric_type || definition.metric_type || 'numeric',
            unit: row.unit ?? definition.unit ?? '',
            direction: row.direction || definition.direction || 'higher_is_better',
            value: row.value === null || row.value === undefined ? null : Number(row.value),
            numerator: row.numerator === null || row.numerator === undefined ? null : Number(row.numerator),
            denominator: row.denominator === null || row.denominator === undefined ? null : Number(row.denominator),
            observedAt: row.observed_at,
            context: row.context || 'clinic',
            source: row.source || 'professional_observation',
            instrumentId: row.instrument_id || definition.instrument_id || null,
            instrumentVersion: row.instrument_version || definition.instrument_version || null,
            definitionVersion: Number(row.definition_version || definition.definition_version || 1),
            missingReason: row.missing_reason || null,
            metadata: {
              ...(row.metadata || {}),
              targetType: definition.target_type || null,
              targetValue: finiteClinicalOutcomeNumber(definition.target_value),
              targetMin: finiteClinicalOutcomeNumber(definition.target_min),
              targetMax: finiteClinicalOutcomeNumber(definition.target_max),
            },
            minimumDataPoints: Number(definition.minimum_data_points || 4),
            recencyWindowDays: Number(definition.recency_window_days || 30),
            sourceRecordType: 'clinical_observation',
            sourceAuthority: 'legacy',
            projectionStale: false
          };
        });

      const abaObservations = (snapshotResult.data || []).map((row: any) => {
        const point = normalizeAbaSnapshotPoint(row);
        const target: any = targetById.get(String(point.targetId || '')) || null;
        const program: any = target ? programById.get(String(target.program_id || '')) : null;
        const planId = program?.therapeutic_plan_id ? String(program.therapeutic_plan_id) : null;
        if (planId && !visiblePlanIds.has(planId)) return null;
        if (
          !planId &&
          !clinicalGraphLegacySnapshotVisibleToActor(point.specialty, graphActorScope)
        ) return null;
        return {
          id: String(point.id),
          planId,
          planVersion: planId && point.sessionId ? ptsVersionBySessionPlan.get(`${String(point.sessionId)}::${planId}`) || null : null,
          goalId: program?.therapeutic_objective_id || null,
          programId: program?.id || null,
          sessionId: point.sessionId || null,
          professionalId: point.professionalId || null,
          specialty: point.specialty || null,
          itemId: point.targetId || point.behaviorId || null,
          itemLabel: target?.name || point.metricLabel || null,
          metricKey: point.metricType,
          metricLabel: point.metricLabel || point.metricType,
          metricType: point.metricType,
          unit: abaMetricUnit(String(point.metricType || '')).trim(),
          direction: String(point.metricDirection || '').toLowerCase() === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better',
          value: point.value === null || point.value === undefined
            ? null
            : Number.isFinite(Number(point.value)) ? Number(point.value) : null,
          numerator: null,
          denominator: point.attemptsCount || null,
          observedAt: point.changedAt,
          context: 'clinic',
          source: 'aba_session_metric_snapshot',
          instrumentId: null,
          instrumentVersion: null,
          definitionVersion: 1,
          missingReason: null,
          metadata: {
            changeStatus: point.changeStatus,
            statusLabel: point.statusLabel,
            specialtySource: point.specialtySource,
            targetDescription: target?.description || null,
            masteryCriteria: target?.mastery_criteria && typeof target.mastery_criteria === 'object' && Object.keys(target.mastery_criteria).length > 0
              ? target.mastery_criteria
              : program?.mastery_criteria || null,
            programMasteryCriteria: program?.mastery_criteria || null,
            criterionSource: target?.mastery_criteria && typeof target.mastery_criteria === 'object' && Object.keys(target.mastery_criteria).length > 0 ? 'TARGET' : program?.mastery_criteria ? 'PROGRAM_INHERITED' : null,
            targetType: target?.target_type || null,
            targetPhase: target?.phase || null,
          },
          minimumDataPoints: 4,
          recencyWindowDays: 30,
          sourceRecordType: 'aba_snapshot',
          sourceAuthority: 'legacy',
          projectionStale: false
        };
      }).filter(Boolean);

      const visibleContributions = (contributionResult.error ? [] : contributionResult.data || []).filter((row: any) => (
        visiblePlanIds.has(String(row.pts_plan_id)) && visiblePlanIds.has(String(row.specialty_plan_id))
      ));
      const visiblePhases = (phaseResult.error ? [] : phaseResult.data || []).filter((row: any) => visiblePlanIds.has(String(row.plan_id)));
      const legacyOutcomeRows = [...structuredObservations, ...abaObservations];
      const mergedOutcomes = mergeClinicalOutcomeRowsV3First(v3PlanOutcomeRows, legacyOutcomeRows);
      const legacyObservationCount = mergedOutcomes.rows.filter((row: any) => row?.sourceAuthority !== 'canonical').length;
      const activityEvidence = (taskReviewSchemaAvailable ? taskReviewResult.data || [] : [])
        .filter((row: any) => visiblePlanIds.has(String(row?.therapeutic_plan_id || '')))
        .map((row: any) => ({
          assignedTaskId: row.assigned_task_id,
          planId: row.therapeutic_plan_id,
          goalId: row.therapeutic_objective_id || null,
          programId: row.therapeutic_program_id || null,
          targetId: row.clinical_target_id || null,
          clinicalLinkSnapshot: row.clinical_link_snapshot && typeof row.clinical_link_snapshot === 'object' ? row.clinical_link_snapshot : {},
          evidenceKind: 'contextual_task_review',
          taskTitle: row.task_title,
          patientEffort: row.patient_effort,
          patientEffortLabel: row.patient_effort_label || null,
          patientComment: row.patient_comment || null,
          professionalScore: row.pro_score,
          maxScore: row.max_score,
          professionalReviewNote: row.pro_review_note || null,
          completedAt: row.completed_at || null,
          reviewedAt: row.reviewed_at || null,
          sourceAuthority: 'contextual',
          isClinicalMetric: false,
        }));
      const specialties = Array.from(new Set([
        ...visiblePlans.map((plan: any) => sanitizeTextField(plan.specialty, 120)),
        ...mergedOutcomes.rows.map((row: any) => sanitizeTextField(row?.specialty, 120))
      ].filter(Boolean))).sort((left, right) => left.localeCompare(right, 'pt-BR'));

      return res.json({
        success: true,
        data: {
          plans: visiblePlans,
          programs: visiblePrograms.map((program: any) => ({
            id: program.id,
            name: program.name,
            status: program.status,
            therapeuticPlanId: program.therapeutic_plan_id || null,
            therapeuticObjectiveId: program.therapeutic_objective_id || null,
            domainId: program.domain_id || null,
            domainName: program.domain_name || null,
            measurementType: program.measurement_type || null,
            masteryCriteria: program.mastery_criteria || null
          })),
          observations: mergedOutcomes.rows,
          activityEvidence,
          contributions: visibleContributions,
          phases: visiblePhases,
          specialties,
          schemaAvailable: clinicalSchemaAvailable || v3ReadModelAvailable,
          activityEvidenceAvailable: taskReviewSchemaAvailable,
          v3Available: v3ReadModelAvailable,
          v3ObservationCount: v3PlanOutcomeRows.length,
          legacyObservationCount
        },
        meta: {
          queryCount: 10 + v3RpcCount + (ptsContextResult.error ? 0 : 1),
          rpcCount: v3RpcCount,
          batched: true,
          periodDays: requestedDays,
          dateFrom: dateFromIso,
          dateTo: dateToIso,
          doesNotAverageSpecialties: true,
          canonicalSource: 'CMV3_PLAN_PROJECTIONS_PLUS_ABA_V3_READ_MODEL',
          v3ObservationCount: v3PlanOutcomeRows.length,
          legacyObservationCount,
          deduplicatedLegacyCount: mergedOutcomes.deduplicatedLegacyCount,
          rawEventsRead: false,
          legacyFallbackPreserved: true
        }
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patients/:patientId/clinical-outcomes-dashboard [GET]', error, {
        fallbackMessage: 'Não foi possível carregar os gráficos clínicos agora.'
      });
    }
  };
}
