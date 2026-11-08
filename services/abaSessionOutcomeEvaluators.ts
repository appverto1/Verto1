// ABA-M10: literal extraction of mastery and maintenance evaluation/persistence during ABA session completion.
// Preserve the existing read/write order, tenant scopes, evaluation criteria, soft failures and no automatic target mutation.
// Dependencies are supplied from server.ts after their original declarations; no new requests, workers, migrations or retries.
export function createAbaSessionOutcomeEvaluators(getDeps: () => any) {
  const { sanitizeString, isUuid, sanitizeTextField, sanitizeClinicalPayload, sanitizeDate, cleanObject, supabase, hasMissingFinancialSchema, fetchAbaMasteryCriterion, evaluateTargetMastery, normalizeAbaMasteryStatusForLegacy, writeAbaRowWithSchemaFallback, formatAbaMasteryCriterion, abaMasteryStatusLabel, hasPersistedMaintenanceScheduleId, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, evaluateMaintenanceStatus, completeMaintenanceScheduleAfterProbe, updateAbaScheduleWithSchemaFallback, readMaintenanceStoredPayload } = getDeps();
  const evaluateAndPersistSessionMastery = async (params: {
    sessionId: string;
    patientId: string;
    clinicId: string;
    therapistId: string;
    evaluatedAt: string;
  }) => {
    const sessionId = sanitizeString(params.sessionId, 180);
    const patientId = sanitizeString(params.patientId, 120);
    const clinicId = sanitizeString(params.clinicId, 120);
    if (!sessionId || !isUuid(patientId) || !clinicId) return [];

    const trialSelect = [
      'id',
      'organization_id',
      'clinic_id',
      'patient_id',
      'session_id',
      'target_id',
      'target_name',
      'program_id',
      'collection_type',
      'maintenance_schedule_id',
      'response_score',
      'max_score',
      'correct',
      'independent',
      'prompt_level_key',
      'latency_ms',
      'raw_payload',
      'occurred_at',
      'therapist_id',
      'created_at'
    ].join(',');
    const { data: trials, error: trialsError } = await supabase
      .from('aba_trials')
      .select(trialSelect)
      .eq('session_id', sessionId)
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .order('occurred_at', { ascending: true })
      .limit(1000);
    if (trialsError) {
      if (hasMissingFinancialSchema(trialsError)) return [];
      throw trialsError;
    }

    const grouped = new Map<string, any[]>();
    for (const trial of Array.isArray(trials) ? trials : []) {
      if (sanitizeString(trial?.collection_type, 80).toLowerCase() === 'maintenance_probe') continue;
      const key = sanitizeString(trial?.target_id, 180) || sanitizeString(trial?.target_name, 240);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) || []), trial]);
    }

    const masterySummary: any[] = [];
    for (const [targetKey, targetTrials] of grouped.entries()) {
      const firstTrial = targetTrials[0] || {};
      const organizationId = sanitizeString(firstTrial.organization_id || clinicId, 120);
      const targetId = sanitizeString(firstTrial.target_id || targetKey, 180);
      const targetName = sanitizeTextField(firstTrial.target_name || targetKey, 240);
      const programId = sanitizeString(firstTrial.program_id, 180);
      const { criterion, target } = await fetchAbaMasteryCriterion({
        organizationId,
        clinicId,
        patientId,
        targetId,
        programId
      });

      let previousQuery = supabase
        .from('aba_mastery_evaluations')
        .select('id,session_id,status,evaluation_status,evaluated_at,therapist_id,consecutive_successful_days')
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .eq('target_id', targetId)
        .neq('session_id', sessionId)
        .order('evaluated_at', { ascending: false })
        .limit(30);
      if (clinicId) previousQuery = previousQuery.eq('clinic_id', clinicId);
      const previousRes = await previousQuery;
      if (previousRes.error && !hasMissingFinancialSchema(previousRes.error)) throw previousRes.error;

      const evaluation = evaluateTargetMastery({
        organizationId,
        patientId,
        targetId,
        targetName,
        sessionId,
        criteria: criterion,
        trials: targetTrials,
        previousEvaluations: previousRes.data || [],
        evaluatedAt: params.evaluatedAt
      });
      const evaluationId = `mastery-${sessionId}-${targetId}`;
      const lastTrial = targetTrials[targetTrials.length - 1] || {};
      const payload = cleanObject({
        id: evaluationId,
        organization_id: organizationId,
        clinic_id: clinicId,
        patient_id: patientId,
        session_id: sessionId,
        target_id: targetId,
        target_name: targetName,
        criteria_id: evaluation.criteriaId,
        status: evaluation.status,
        evaluation_status: normalizeAbaMasteryStatusForLegacy(evaluation.status),
        suggested_phase: evaluation.suggestedPhase,
        total_trials: evaluation.totalTrials,
        independent_trials: evaluation.independentTrials,
        prompted_trials: evaluation.promptedTrials,
        error_trials: evaluation.errorTrials,
        accuracy_percent: evaluation.accuracyPercent,
        independence_percent: evaluation.independencePercent,
        consecutive_successes: evaluation.criterionProgressCount,
        consecutive_successful_days: evaluation.consecutiveSuccessfulDays,
        min_consecutive_successes: evaluation.criterionRequiredCount || criterion?.min_consecutive_days || criterion?.minConsecutiveDays || 1,
        trials_considered: evaluation.totalTrials,
        cold_probe_trials_count: evaluation.coldProbeTrialsCount,
        distinct_therapists_count: evaluation.distinctTherapistsCount,
        first_trial_independent: evaluation.firstTrialIndependent,
        criteria: sanitizeClinicalPayload(criterion || {}),
        reasons: sanitizeClinicalPayload(evaluation.reasons),
        evaluated_at: evaluation.evaluatedAt,
        therapist_id: sanitizeString(lastTrial.therapist_id || params.therapistId, 120),
        source_trial_id: sanitizeString(lastTrial.id, 180) || null,
        raw_payload: sanitizeClinicalPayload({
          status: evaluation.status,
          criterionLabel: evaluation.criterionLabel,
          criterionProgressLabel: evaluation.criterionProgressLabel,
          successfulSessions: evaluation.successfulSessions,
          targetPhaseAtEvaluation: target?.phase || null,
          noAutomaticTargetMutation: true
        }),
        created_at: new Date().toISOString()
      });
      const writeResult = await writeAbaRowWithSchemaFallback('aba_mastery_evaluations', payload, 'upsert');
      if (writeResult.error && !hasMissingFinancialSchema(writeResult.error)) throw writeResult.error;
      masterySummary.push({
        id: evaluationId,
        targetId,
        name: targetName,
        criterion: evaluation.criterionLabel || formatAbaMasteryCriterion(criterion),
        performanceText: evaluation.performanceText,
        contributes: evaluation.status === 'MET_TODAY' || evaluation.status === 'READY_FOR_REVIEW',
        status: abaMasteryStatusLabel(evaluation.status),
        statusCode: evaluation.status,
        totalTrials: evaluation.totalTrials,
        independentTrials: evaluation.independentTrials,
        promptedTrials: evaluation.promptedTrials,
        errorTrials: evaluation.errorTrials,
        accuracyPercent: evaluation.accuracyPercent,
        independencePercent: evaluation.independencePercent,
        consecutiveSuccessfulDays: evaluation.consecutiveSuccessfulDays,
        successfulSessions: evaluation.successfulSessions,
        criterionProgressCount: evaluation.criterionProgressCount,
        criterionRequiredCount: evaluation.criterionRequiredCount,
        criterionProgressLabel: evaluation.criterionProgressLabel,
        reasons: evaluation.reasons
      });
    }
    return masterySummary;
  };

  const evaluateAndPersistSessionMaintenance = async (params: {
    sessionId: string;
    patientId: string;
    clinicId: string;
    therapistId: string;
    evaluatedAt: string;
    appointmentId?: string | null;
  }) => {
    const sessionId = sanitizeString(params.sessionId, 180);
    const patientId = sanitizeString(params.patientId, 120);
    const clinicId = sanitizeString(params.clinicId, 120);
    if (!sessionId || !isUuid(patientId) || !clinicId) return [];
    let appointmentId = isUuid(sanitizeString(params.appointmentId, 180)) ? sanitizeString(params.appointmentId, 180) : '';
    if (!appointmentId) {
      const sessionScope = await supabase
        .from('aba_sessions')
        .select('id,appointment_id')
        .eq('id', sessionId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .limit(1)
        .maybeSingle();
      if (!sessionScope.error && sessionScope.data?.appointment_id) {
        appointmentId = sanitizeString(sessionScope.data.appointment_id, 180);
      } else if (sessionScope.error && !hasMissingFinancialSchema(sessionScope.error)) {
        throw sessionScope.error;
      }
    }

    const trialSelect = [
      'id',
      'organization_id',
      'clinic_id',
      'patient_id',
      'session_id',
      'target_id',
      'target_name',
      'program_id',
      'collection_type',
      'maintenance_schedule_id',
      'response_score',
      'max_score',
      'correct',
      'independent',
      'prompt_level_key',
      'occurred_at',
      'therapist_id',
      'created_at'
    ].join(',');
    const { data: trials, error: trialsError } = await supabase
      .from('aba_trials')
      .select(trialSelect)
      .eq('session_id', sessionId)
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .eq('collection_type', 'maintenance_probe')
      .order('occurred_at', { ascending: true })
      .limit(1000);
    if (trialsError) {
      if (hasMissingFinancialSchema(trialsError)) return [];
      throw trialsError;
    }

    const grouped = new Map<string, any[]>();
    for (const trial of Array.isArray(trials) ? trials : []) {
      const key = sanitizeString(trial?.target_id, 180) || sanitizeString(trial?.target_name, 240);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) || []), trial]);
    }

    const maintenanceSummary: any[] = [];
    for (const [targetKey, targetTrials] of grouped.entries()) {
      const firstTrial = targetTrials[0] || {};
      const organizationId = sanitizeString(firstTrial.organization_id || clinicId, 120);
      const targetId = sanitizeString(firstTrial.target_id || targetKey, 180);
      const targetName = sanitizeTextField(firstTrial.target_name || targetKey, 240);
      const programId = sanitizeString(firstTrial.program_id, 180);
      const trialScheduleId = sanitizeString(firstTrial.maintenance_schedule_id, 180);
      if (!hasPersistedMaintenanceScheduleId(trialScheduleId)) continue;
      const { criterion } = await fetchAbaMasteryCriterion({
        organizationId,
        clinicId,
        patientId,
        targetId,
        programId
      });

      let schedule: any = null;
      const scheduleRes = await supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', trialScheduleId)
        .eq('organization_id', organizationId)
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('target_id', targetId)
        .maybeSingle();
      if (!scheduleRes.error) schedule = scheduleRes.data || null;
      if (scheduleRes.error && !hasMissingFinancialSchema(scheduleRes.error)) throw scheduleRes.error;
      if (!schedule?.id) continue;

      let previousProbeResults: any[] = [];
      const previousRes = await supabase
        .from('aba_maintenance_probe_results')
        .select(ABA_MAINTENANCE_PROBE_RESULT_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .eq('target_id', targetId)
        .order('occurred_at', { ascending: false })
        .limit(10);
      if (!previousRes.error) previousProbeResults = previousRes.data || [];
      if (previousRes.error && !hasMissingFinancialSchema(previousRes.error)) throw previousRes.error;

      const evaluation = evaluateMaintenanceStatus({
        organizationId,
        patientId,
        targetId,
        targetName,
        sessionId,
        maintenanceScheduleId: schedule?.id || null,
        criteria: criterion,
        trials: targetTrials,
        previousProbeResults,
        occurredAt: params.evaluatedAt
      });
      const lastMaintenanceTrial = targetTrials[targetTrials.length - 1] || firstTrial;
      const resultId = `maintenance-${trialScheduleId}-${sessionId}-${sanitizeString(lastMaintenanceTrial.id, 180) || targetId}`;
      const payload = cleanObject({
        id: resultId,
        organization_id: organizationId,
        clinic_id: clinicId,
        patient_id: patientId,
        target_id: targetId,
        maintenance_schedule_id: trialScheduleId,
        appointment_id: appointmentId || null,
        session_id: sessionId,
        trial_id: sanitizeString(lastMaintenanceTrial.id, 180) || null,
        probe_date: sanitizeDate(evaluation.occurredAt) || evaluation.occurredAt.slice(0, 10),
        clinical_date: sanitizeDate(evaluation.occurredAt) || evaluation.occurredAt.slice(0, 10),
        occurred_at: evaluation.occurredAt,
        result: evaluation.errorTrials > 0 ? 'error' : evaluation.independentTrials > 0 ? 'independent' : 'prompted',
        prompt_type: sanitizeString(lastMaintenanceTrial.prompt_level_key, 80) || null,
        passed: evaluation.status === 'MAINTAINED',
        total_trials: evaluation.totalTrials,
        independent_trials: evaluation.independentTrials,
        prompted_trials: evaluation.promptedTrials,
        error_trials: evaluation.errorTrials,
        accuracy_percent: evaluation.accuracyPercent,
        independence_percent: evaluation.independencePercent,
        status: evaluation.status,
        raw_payload: sanitizeClinicalPayload({
          targetName,
          criterion,
          minAccuracyPercent: evaluation.minAccuracyPercent,
          minIndependencePercent: evaluation.minIndependencePercent,
          reasons: evaluation.reasons,
          consecutiveFailureCount: evaluation.consecutiveFailureCount,
          shouldCreateRegressionAlert: evaluation.shouldCreateRegressionAlert,
          suggestedClinicalStatus: evaluation.suggestedClinicalStatus,
          noAutomaticTargetMutation: true,
          humanReviewRequiredForRegressionConfirmed: true
        }),
        created_by: sanitizeString(params.therapistId, 120) || null,
        updated_by: sanitizeString(params.therapistId, 120) || null,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      const writeResult = await writeAbaRowWithSchemaFallback('aba_maintenance_probe_results', payload, 'upsert');
      if (writeResult.error && !hasMissingFinancialSchema(writeResult.error)) throw writeResult.error;
      if (evaluation.status === 'MAINTAINED') {
        await completeMaintenanceScheduleAfterProbe({
          scheduleId: trialScheduleId,
          clinicId,
          organizationId,
          patientId,
          completedAt: evaluation.occurredAt,
          completedBy: params.therapistId
        });
      } else {
        const update = await updateAbaScheduleWithSchemaFallback(trialScheduleId, cleanObject({
          status: evaluation.status,
          updated_at: new Date().toISOString(),
          raw_payload: sanitizeClinicalPayload({
            ...readMaintenanceStoredPayload(schedule?.raw_payload || schedule?.rawPayload),
            lastMaintenanceProbeResultId: resultId,
            lastMaintenanceProbeStatus: evaluation.status,
            humanReviewRequired: true,
            noAutomaticTargetMutation: true
          })
        }), clinicId, organizationId, patientId);
        if (update.error && !hasMissingFinancialSchema(update.error)) throw update.error;
      }

      maintenanceSummary.push({
        id: resultId,
        targetId,
        name: targetName,
        maintenanceScheduleId: trialScheduleId,
        scheduledFor: schedule?.scheduled_for || null,
        targetDueDate: schedule?.target_due_date || null,
        appointmentId: schedule?.appointment_id || null,
        status: evaluation.status,
        totalTrials: evaluation.totalTrials,
        independentTrials: evaluation.independentTrials,
        promptedTrials: evaluation.promptedTrials,
        errorTrials: evaluation.errorTrials,
        accuracyPercent: evaluation.accuracyPercent,
        independencePercent: evaluation.independencePercent,
        consecutiveFailureCount: evaluation.consecutiveFailureCount,
        shouldCreateRegressionAlert: evaluation.shouldCreateRegressionAlert,
        reasons: evaluation.reasons,
        performanceText: evaluation.performanceText
      });
    }
    return maintenanceSummary;
  };

  return { evaluateAndPersistSessionMastery, evaluateAndPersistSessionMaintenance };
}
