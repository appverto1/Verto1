export function createAbaSessionSummaryWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, buildSessionMetricSnapshots, cleanObject, currentClinicId, currentClinicTimeZone, enforcePayloadLimit, evaluateAndPersistSessionMaintenance, evaluateAndPersistSessionMastery, extractMissingColumnName, hasMissingFinancialSchema, isUuid, normalizeCareSetting, parseStoredJsonObject, persistActivityLog, regenerateClosureForAppointments, resolveAbaAppointmentIdForClinicalWrite, resolveAbaRequestSource, runTissPipelineForAppointment, sanitizeClinicalPayload, sanitizeIsoDateTime, sanitizeString, sanitizeTextField, stableHashPayload, writeAbaRowWithSchemaFallback, supabase } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 192 * 1024, 'Payload do resumo da sessão ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      if (!clinicId) return res.status(400).json({ success: false, error: 'Clínica não identificada.' });
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      const sessionId = sanitizeString(req.body?.session_id || req.body?.sessionId, 180);
      if (!sessionId) return res.status(400).json({ success: false, error: 'Sessão inválida.' });
      const previousSummaryResult = await supabase
        .from('aba_session_summaries')
        .select('id,session_note,updated_at')
        .eq('session_id', sessionId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const previousSummary = previousSummaryResult.error ? null : previousSummaryResult.data;
      if (previousSummaryResult.error && !hasMissingFinancialSchema(previousSummaryResult.error) && !extractMissingColumnName(previousSummaryResult.error)) {
        throw previousSummaryResult.error;
      }
      const endedAt = sanitizeIsoDateTime(req.body?.ended_at || req.body?.endedAt);
      const startedAt = sanitizeIsoDateTime(req.body?.started_at || req.body?.startedAt, endedAt);
      const durationSeconds = req.body?.duration_seconds !== undefined || req.body?.durationSeconds !== undefined
        ? asSafeNumber(req.body?.duration_seconds ?? req.body?.durationSeconds, 0, 86400)
        : Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
      const sessionSummaryAppointmentId = await resolveAbaAppointmentIdForClinicalWrite({
        requestedAppointmentId: req.body?.appointment_id || req.body?.appointmentId,
        sessionId,
        patientId,
        clinicId,
        user: req.session.user
      });
      let persistedSessionContext: any = null;
      const sessionContextResult = await supabase
        .from('aba_sessions')
        .select('id,care_setting,school_id,school_unit_id,location_name_snapshot,location_context_snapshot')
        .eq('id', sessionId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .limit(1)
        .maybeSingle();
      if (!sessionContextResult.error) {
        persistedSessionContext = sessionContextResult.data || null;
      } else if (!hasMissingFinancialSchema(sessionContextResult.error)) {
        throw sessionContextResult.error;
      }
      const persistedLocationContext = parseStoredJsonObject(persistedSessionContext?.location_context_snapshot);
      const rawSummaryCareSetting = persistedSessionContext?.care_setting || persistedLocationContext?.careSetting;
      const summaryCareSetting = rawSummaryCareSetting ? normalizeCareSetting(rawSummaryCareSetting, null) : null;
      const summaryLocationName = sanitizeString(
        persistedSessionContext?.location_name_snapshot || persistedLocationContext?.locationName,
        180,
      ) || null;
      const summaryLocationContext = sanitizeClinicalPayload({
        careSetting: summaryCareSetting,
        schoolId: persistedSessionContext?.school_id || persistedLocationContext?.schoolId || null,
        schoolUnitId: persistedSessionContext?.school_unit_id || persistedLocationContext?.schoolUnitId || null,
        locationName: summaryLocationName,
        locationSource: persistedLocationContext?.locationSource || null,
        locationTimezone: persistedLocationContext?.locationTimezone || 'America/Sao_Paulo',
      });
      let masterySummaryPayload = sanitizeClinicalPayload(req.body?.mastery_summary || req.body?.masterySummary || []);
      let maintenanceSummaryPayload = sanitizeClinicalPayload(req.body?.maintenance_summary || req.body?.maintenanceSummary || []);
      try {
        const evaluatedMastery = await evaluateAndPersistSessionMastery({
          sessionId,
          patientId,
          clinicId,
          therapistId: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
          evaluatedAt: endedAt
        });
        if (evaluatedMastery.length > 0) {
          masterySummaryPayload = sanitizeClinicalPayload(evaluatedMastery);
        }
      } catch (masteryError: any) {
        console.warn('[ABA Mastery] Falha ao avaliar maestria no encerramento:', masteryError?.message || String(masteryError));
      }
      try {
        const evaluatedMaintenance = await evaluateAndPersistSessionMaintenance({
          sessionId,
          patientId,
          clinicId,
          therapistId: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
          evaluatedAt: endedAt,
          appointmentId: sessionSummaryAppointmentId
        });
        if (evaluatedMaintenance.length > 0) {
          maintenanceSummaryPayload = sanitizeClinicalPayload(evaluatedMaintenance);
        }
      } catch (maintenanceError: any) {
        console.warn('[ABA Maintenance] Falha ao avaliar manutencao no encerramento:', maintenanceError?.message || String(maintenanceError));
      }

      const requestSource = resolveAbaRequestSource(req.body);
      const payload = cleanObject({
        id: sanitizeString(req.body?.id || req.body?.summary_id || req.body?.summaryId || `summary-${sessionId}`, 180),
        organization_id: sanitizeString(req.body?.organization_id || req.body?.organizationId || clinicId, 120),
        clinic_id: clinicId,
        session_id: sessionId,
        appointment_id: sessionSummaryAppointmentId,
        patient_id: patientId,
        therapist_id: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
        care_setting: summaryCareSetting,
        location_name_snapshot: summaryLocationName,
        location_context_snapshot: summaryLocationContext,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        total_trials: asSafeNumber(req.body?.total_trials ?? req.body?.totalTrials, 0, 100000) || 0,
        independent_trials: asSafeNumber(req.body?.independent_trials ?? req.body?.independentTrials, 0, 100000) || 0,
        prompted_trials: asSafeNumber(req.body?.prompted_trials ?? req.body?.promptedTrials, 0, 100000) || 0,
        error_trials: asSafeNumber(req.body?.error_trials ?? req.body?.errorTrials, 0, 100000) || 0,
        accuracy_percent: asSafeNumber(req.body?.accuracy_percent ?? req.body?.accuracyPercent, 0, 100) || 0,
        independence_percent: asSafeNumber(req.body?.independence_percent ?? req.body?.independencePercent, 0, 100) || 0,
        trial_types_used: sanitizeClinicalPayload(req.body?.trial_types_used || req.body?.trialTypesUsed || []),
        total_behavior_events: asSafeNumber(req.body?.total_behavior_events ?? req.body?.totalBehaviorEvents, 0, 100000) || 0,
        frequency_summary: sanitizeClinicalPayload(req.body?.frequency_summary || req.body?.frequencySummary || []),
        duration_summary: sanitizeClinicalPayload(req.body?.duration_summary || req.body?.durationSummary || []),
        interval_summary: sanitizeClinicalPayload(req.body?.interval_summary || req.body?.intervalSummary || []),
        abc_summary: sanitizeClinicalPayload(req.body?.abc_summary || req.body?.abcSummary || []),
        mastery_summary: masterySummaryPayload,
        maintenance_summary: maintenanceSummaryPayload,
        blocking_items: sanitizeClinicalPayload(req.body?.blocking_items || req.body?.blockingItems || req.body?.pending_items || req.body?.pendingItems || []),
        warning_items: sanitizeClinicalPayload(req.body?.warning_items || req.body?.warningItems || req.body?.pending_warnings || req.body?.pendingWarnings || []),
        pending_items: sanitizeClinicalPayload(req.body?.pending_items || req.body?.pendingItems || []),
        pending_warnings: sanitizeClinicalPayload(req.body?.pending_warnings || req.body?.pendingWarnings || []),
        session_note: sanitizeTextField(req.body?.session_note ?? req.body?.sessionNote, 4000),
        sync_status: 'synced',
        source: requestSource,
        summary_payload: sanitizeClinicalPayload({
          ...(req.body?.summary_payload || req.body?.summaryPayload || {}),
          source: requestSource,
          appointmentId: sessionSummaryAppointmentId || undefined,
          careSetting: summaryCareSetting,
          locationName: summaryLocationName,
          patientName: sanitizeString(req.body?.patient_name || req.body?.patientName, 180),
          therapistName: sanitizeString(req.body?.therapist_name || req.body?.therapistName, 180),
          teachingSummary: req.body?.teaching_summary || req.body?.teachingSummary || undefined,
          trialTypesUsed: req.body?.trial_types_used || req.body?.trialTypesUsed || undefined,
          abcSummary: req.body?.abc_summary || req.body?.abcSummary || undefined,
          masterySummary: masterySummaryPayload,
          maintenanceSummary: maintenanceSummaryPayload,
          blockingItems: req.body?.blocking_items || req.body?.blockingItems || undefined,
          warningItems: req.body?.warning_items || req.body?.warningItems || undefined,
          pendingWarnings: req.body?.pending_warnings || req.body?.pendingWarnings || undefined,
          sessionNote: req.body?.session_note ?? req.body?.sessionNote ?? undefined,
          syncStatus: 'synced'
        }),
        created_at: req.body?.created_at || req.body?.createdAt ? sanitizeIsoDateTime(req.body?.created_at || req.body?.createdAt) : new Date().toISOString()
      });

      const result = await writeAbaRowWithSchemaFallback('aba_session_summaries', payload, 'upsert');
      if (result.error) {
        if (hasMissingFinancialSchema(result.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        throw result.error;
      }
      try {
        await buildSessionMetricSnapshots(sessionId);
      } catch (snapshotError: any) {
        console.warn('[ABA Charts] Falha ao gerar snapshots da sessão:', snapshotError?.message || String(snapshotError));
      }
      let appointmentIdForClosure = sessionSummaryAppointmentId || '';
      if (!appointmentIdForClosure) {
        const sessionLinkResult = await supabase
          .from('aba_sessions')
          .select('id, appointment_id')
          .eq('id', sessionId)
          .eq('patient_id', patientId)
          .maybeSingle();
        if (!sessionLinkResult.error) {
          appointmentIdForClosure = sanitizeString(sessionLinkResult.data?.appointment_id, 180);
        } else if (!hasMissingFinancialSchema(sessionLinkResult.error)) {
          console.warn('[Closure] vínculo da sessão ABA não encontrado para revalidação:', sessionLinkResult.error.message);
        }
      }
      if (isUuid(appointmentIdForClosure)) {
        await regenerateClosureForAppointments(
          [appointmentIdForClosure],
          req.session.user,
          'aba_session_summary_saved'
        );
        await runTissPipelineForAppointment({
          appointmentId: appointmentIdForClosure,
          user: req.session.user,
          reason: 'session_completed',
          mode: 'best_effort',
          revalidateAppointment: revalidateAppointmentBillingForAppointment,
          forceClosure: true,
          logger: console
        });
      }
      const persistedSummaryId = sanitizeString((result.data as any)?.id || payload.id, 180);
      const previousSessionNote = sanitizeTextField(previousSummary?.session_note, 4000);
      const nextSessionNote = sanitizeTextField(payload.session_note, 4000);
      const noteChanged = previousSessionNote !== nextSessionNote;
      const summaryAuditAction = previousSummary?.id ? 'aba_session_document_updated' : 'aba_session_document_created';
      const auditPersisted = await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Profissional', 180),
        title: previousSummary?.id ? 'Documento da sessão atualizado' : 'Documento da sessão registrado',
        content: noteChanged
          ? 'O documento clínico da sessão foi atualizado, incluindo a observação da sessão.'
          : `${previousSummary?.id ? 'O documento clínico da sessão foi atualizado.' : 'O documento clínico da sessão foi registrado.'}`,
        type: 'clinical',
        action: summaryAuditAction,
        actionType: summaryAuditAction,
        payloadDetails: JSON.stringify({
          summaryId: persistedSummaryId,
          sessionId,
          patientId,
          appointmentId: appointmentIdForClosure || null,
          noteChanged,
          source: requestSource
        }),
        resourceType: 'aba_session_report',
        resourceId: persistedSummaryId || sessionId,
        patientId,
        sessionId,
        timezone: currentClinicTimeZone(req.session.user),
        immutableAudit: true,
        idempotencyKey: `aba-session-document:${clinicId}:${sessionId}:${stableHashPayload({
          summaryId: persistedSummaryId || null,
          sessionNote: nextSessionNote,
          endedAt,
          totalTrials: payload.total_trials,
          totalBehaviorEvents: payload.total_behavior_events,
          source: requestSource
        })}`
      });
      return res.json({
        success: true,
        auditPersisted,
        ...(auditPersisted ? {} : { warning: 'Documento da sessão salvo; auditoria pendente de reconciliação.' }),
        data: { ...payload, id: persistedSummaryId || payload.id }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
export function createAbaTrialWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertAbaSessionCanAcceptClinicalWrite, buildAbaPromptSnapshot, cleanObject, currentClinicId, enforcePayloadLimit, hasMissingFinancialSchema, inferAbaCorrect, isAbaMaintenanceProbeCollection, isAbaV3ReadApiEnabled, isUuid, normalizeAbaCollectionType, persistActivityLog, resolveAbaAppointmentIdForClinicalWrite, resolveAbaPromptLevel, resolveAbaRequestSource, resolveTrialPromptInfo, sanitizeClinicalPayload, sanitizeIsoDateTime, sanitizeString, sanitizeTextField, validateMaintenanceProbeClinicalLink, writeAbaRowWithSchemaFallback, supabase, crypto } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 128 * 1024, 'Payload da tentativa ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      if (!clinicId) return res.status(400).json({ success: false, error: 'Clínica não identificada.' });
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      const requestedRawPayload = req.body?.raw_payload && typeof req.body.raw_payload === 'object' && !Array.isArray(req.body.raw_payload)
        ? req.body.raw_payload
        : req.body?.rawPayload && typeof req.body.rawPayload === 'object' && !Array.isArray(req.body.rawPayload)
          ? req.body.rawPayload
          : {};
      const therapeuticMeasurementType = sanitizeString(requestedRawPayload?.measurementType || requestedRawPayload?.measurement_type, 80).toLowerCase();
      const therapeuticMeasurementWrite = requestedRawPayload?.therapeuticMeasurement === true || requestedRawPayload?.therapeutic_measurement === true || sanitizeString(requestedRawPayload?.source, 100) === 'therapeutic_program_measurement';
      const allowedTherapeuticMeasurementTypes = new Set(['correct_incorrect', 'frequency', 'duration', 'latency', 'task_analysis', 'percentage']);
      if (therapeuticMeasurementWrite && !allowedTherapeuticMeasurementTypes.has(therapeuticMeasurementType)) {
        return res.status(400).json({ success: false, error: 'Forma de coleta terapêutica inválida.' });
      }
      if (therapeuticMeasurementWrite) {
        const measurementValue = Number(requestedRawPayload?.measurementValue ?? requestedRawPayload?.measurement_value);
        if (!Number.isFinite(measurementValue)) return res.status(400).json({ success: false, error: 'Medida terapêutica inválida.' });
        if (['duration', 'latency', 'frequency'].includes(therapeuticMeasurementType) && measurementValue < 0) {
          return res.status(400).json({ success: false, error: 'Medida terapêutica não pode ser negativa.' });
        }
        if (['percentage', 'task_analysis'].includes(therapeuticMeasurementType) && (measurementValue < 0 || measurementValue > 100)) {
          return res.status(400).json({ success: false, error: 'Percentual terapêutico deve estar entre 0 e 100.' });
        }
        if (therapeuticMeasurementType === 'correct_incorrect' && ![0, 1].includes(measurementValue)) {
          return res.status(400).json({ success: false, error: 'Resposta terapêutica deve ser Acerto ou Erro.' });
        }
      }

      const score = req.body?.response_score !== undefined || req.body?.responseScore !== undefined || req.body?.score !== undefined
        ? asSafeNumber(req.body?.response_score ?? req.body?.responseScore ?? req.body?.score, -100000, 100000)
        : null;
      const maxScore = req.body?.max_score !== undefined || req.body?.maxScore !== undefined
        ? asSafeNumber(req.body?.max_score ?? req.body?.maxScore, 0, 100000)
        : null;
      const correct = inferAbaCorrect(score, maxScore, req.body?.is_correct ?? req.body?.isCorrect ?? req.body?.correct);
      const promptLevel = resolveAbaPromptLevel({
        promptLevelKey: req.body?.prompt_level_key || req.body?.promptLevelKey || req.body?.promptLevel,
        promptLevelName: req.body?.prompt_level_name || req.body?.promptLevelName,
        score,
        maxScore,
        correct: req.body?.is_correct ?? req.body?.isCorrect ?? correct,
        independent: req.body?.is_independent ?? req.body?.isIndependent ?? req.body?.independent
      });
      const legacyPromptAudit = {
        prompt_level_key: promptLevel.key,
        prompt_level_name: promptLevel.label
      };
      const promptTypeId = sanitizeString(req.body?.prompt_type_id || req.body?.promptTypeId, 120) || null;
      let promptTypeRow: any = null;
      if (promptTypeId) {
        if (!isUuid(promptTypeId)) return res.status(400).json({ success: false, error: 'Tipo de ajuda inválido.' });
        const promptTypeResult = await supabase
          .from('aba_prompt_types')
          .select('id,organization_id,key,name,category,independence_score,intrusiveness_order,counts_as_independent,show_in_session,active,description,is_system_default')
          .eq('id', promptTypeId)
          .eq('organization_id', clinicId)
          .maybeSingle();
        if (promptTypeResult.error) {
          if (hasMissingFinancialSchema(promptTypeResult.error)) return res.status(503).json({ success: false, error: 'Schema de tipos de ajuda ABA ainda não aplicado.' });
          throw promptTypeResult.error;
        }
        if (!promptTypeResult.data) return res.status(403).json({ success: false, error: 'Tipo de ajuda não pertence a esta clínica.' });
        promptTypeRow = promptTypeResult.data;
      }
      const promptInput = {
        ...(req.body || {}),
        promptTypeId,
        prompt_type_id: promptTypeId,
        promptTypeNameSnapshot: req.body?.promptTypeNameSnapshot || req.body?.prompt_type_name_snapshot || promptTypeRow?.name,
        promptCategorySnapshot: req.body?.promptCategorySnapshot || req.body?.prompt_category_snapshot || promptTypeRow?.category,
        promptIndependenceScoreSnapshot: req.body?.promptIndependenceScoreSnapshot ?? req.body?.prompt_independence_score_snapshot ?? promptTypeRow?.independence_score,
        promptIntrusivenessOrderSnapshot: req.body?.promptIntrusivenessOrderSnapshot ?? req.body?.prompt_intrusiveness_order_snapshot ?? promptTypeRow?.intrusiveness_order,
        promptLevelKey: req.body?.prompt_level_key || req.body?.promptLevelKey || req.body?.promptLevel || promptTypeRow?.key || promptLevel.key,
        promptLevelName: req.body?.prompt_level_name || req.body?.promptLevelName || promptTypeRow?.name || promptLevel.label,
        score,
        maxScore,
        correct: req.body?.is_correct ?? req.body?.isCorrect ?? correct,
        independent: req.body?.is_independent ?? req.body?.isIndependent ?? req.body?.independent
      };
      const promptInfo = resolveTrialPromptInfo(promptInput, promptTypeRow ? [promptTypeRow] : undefined);
      const promptSnapshot = buildAbaPromptSnapshot(promptInput, promptTypeRow ? [promptTypeRow] : undefined);
      const promptKey = promptInfo.key || promptLevel.key;
      const independent = therapeuticMeasurementWrite ? false : correct && promptInfo.isIndependent;
      const targetName = sanitizeTextField(req.body?.target_name || req.body?.targetName || req.body?.title, 240);
      if (!targetName) return res.status(400).json({ success: false, error: 'Target é obrigatório.' });

      const occurredAt = sanitizeIsoDateTime(req.body?.occurred_at || req.body?.occurredAt);
      const sessionId = sanitizeString(req.body?.session_id || req.body?.sessionId, 180) || null;
      const collectionType = normalizeAbaCollectionType(req.body?.collection_type || req.body?.collectionType || req.body?.trial_type || req.body?.trialType);
      const targetId = sanitizeString(req.body?.target_id || req.body?.targetId, 180) || null;
      const maintenanceScheduleId = sanitizeString(req.body?.maintenance_schedule_id || req.body?.maintenanceScheduleId || req.body?.schedule_id || req.body?.scheduleId, 180) || null;
      const sessionWrite = await assertAbaSessionCanAcceptClinicalWrite(sessionId, clinicId, req.session.user);
      if (!sessionWrite.ok) return res.status((sessionWrite as any).status || 409).json({ success: false, error: (sessionWrite as any).error });

      // Defense-in-depth during V2 -> V3 rollout: an outdated/stale frontend must
      // never be able to persist a Legacy trial for a session+target whose server-side
      // collection plan is V3. The read RPC is authoritative and non-mutating.
      if (isAbaV3ReadApiEnabled() && sessionId && targetId) {
        const { data: v3PlanData, error: v3PlanError } = await supabase.rpc('get_aba_v3_session_collection_plan', {
          p_organization_id: clinicId,
          p_patient_id: patientId,
          p_session_id: sessionId,
          p_target_ids: [targetId]
        });
        if (v3PlanError) {
          const v3PlanMessage = sanitizeString(v3PlanError?.message || '', 700);
          if (hasMissingFinancialSchema(v3PlanError) || /get_aba_v3_session_collection_plan|PGRST202|42883|42P01/i.test(v3PlanMessage)) {
            return res.status(503).json({
              success: false,
              code: 'ABA_V3_LEGACY_GUARD_UNAVAILABLE',
              error: 'Não foi possível validar com segurança o modelo de coleta desta tentativa.'
            });
          }
          throw v3PlanError;
        }
        const v3PlanTargets = Array.isArray((v3PlanData as any)?.targets) ? (v3PlanData as any).targets : [];
        const v3TargetPlan = v3PlanTargets.find((item: any) => sanitizeString(item?.target_id, 180) === targetId);
        const plannedModel = sanitizeString(v3TargetPlan?.measurement_model_version, 60).toUpperCase();
        if (plannedModel === 'V3' || plannedModel === 'V3_BLOCKED') {
          return res.status(409).json({
            success: false,
            code: 'ABA_V3_LEGACY_WRITE_BLOCKED',
            measurementModelVersion: plannedModel,
            error: 'Esta tentativa pertence ao modelo ABA V3 e não pode ser gravada pela rota Legacy V2.'
          });
        }
      }
      const requestedAppointmentId = await resolveAbaAppointmentIdForClinicalWrite({
        requestedAppointmentId: req.body?.appointment_id || req.body?.appointmentId,
        sessionId,
        patientId,
        clinicId,
        user: req.session.user
      });
      let appointmentId = requestedAppointmentId;
      let maintenanceClinicalDate: string | null = null;
      if (isAbaMaintenanceProbeCollection(collectionType)) {
        const linkValidation = await validateMaintenanceProbeClinicalLink({
          maintenanceScheduleId,
          targetId,
          patientId,
          clinicId,
          organizationId: sanitizeString(req.body?.organization_id || req.body?.organizationId || req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120),
          sessionId,
          appointmentId: requestedAppointmentId,
          occurredAt,
          timeZone: req.body?.timeZone || req.body?.timezone,
          user: req.session.user
        });
        if (!linkValidation.ok) return res.status((linkValidation as any).status || 409).json({ success: false, error: (linkValidation as any).error });
        appointmentId = (linkValidation as any).appointmentId || requestedAppointmentId || null;
        maintenanceClinicalDate = (linkValidation as any).clinicalDate || null;
      }
      const requestSource = resolveAbaRequestSource(req.body);
      const payload = cleanObject({
        id: sanitizeString(req.body?.id || req.body?.trial_id || req.body?.trialId || crypto.randomUUID(), 180),
        clinic_id: clinicId,
        patient_id: patientId,
        appointment_id: appointmentId,
        session_id: sessionId,
        target_id: targetId,
        target_name: targetName,
        program_id: sanitizeString(req.body?.program_id || req.body?.programId, 180) || null,
        protocol_id: sanitizeString(req.body?.protocol_id || req.body?.protocolId, 180) || null,
        protocol_title: sanitizeString(req.body?.protocol_title || req.body?.protocolTitle, 240) || null,
        domain_id: sanitizeString(req.body?.domain_id || req.body?.domainId, 180) || null,
        domain_name: sanitizeString(req.body?.domain_name || req.body?.domainName, 240) || null,
        collection_type: collectionType,
        trial_type: collectionType,
        maintenance_schedule_id: isAbaMaintenanceProbeCollection(collectionType) ? maintenanceScheduleId : null,
        response_score: score,
        max_score: maxScore,
        correct,
        independent,
        prompt_level_key: therapeuticMeasurementWrite ? null : (promptKey || null),
        prompt_level_id: therapeuticMeasurementWrite ? null : (sanitizeString(req.body?.prompt_level_id || req.body?.promptLevelId || promptTypeId || promptKey, 180) || null),
        prompt_level_name: therapeuticMeasurementWrite ? null : (promptInfo.label || promptLevel.label),
        prompt_type_id: therapeuticMeasurementWrite ? null : promptSnapshot.prompt_type_id,
        prompt_type_name_snapshot: therapeuticMeasurementWrite ? null : promptSnapshot.prompt_type_name_snapshot,
        prompt_category_snapshot: therapeuticMeasurementWrite ? null : promptSnapshot.prompt_category_snapshot,
        prompt_independence_score_snapshot: therapeuticMeasurementWrite ? null : promptSnapshot.prompt_independence_score_snapshot,
        prompt_intrusiveness_order_snapshot: therapeuticMeasurementWrite ? null : promptSnapshot.prompt_intrusiveness_order_snapshot,
        latency_ms: req.body?.latency_ms !== undefined || req.body?.latencyMs !== undefined
          ? asSafeNumber(req.body?.latency_ms ?? req.body?.latencyMs, 0, 3_600_000)
          : null,
        notes: sanitizeTextField(req.body?.notes, 4000),
        occurred_at: sanitizeIsoDateTime(req.body?.occurred_at || req.body?.occurredAt || req.body?.timestamp, occurredAt),
        therapist_id: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
        sync_status: 'synced',
        source: requestSource,
        source_history_id: sanitizeString(req.body?.source_history_id || req.body?.sourceHistoryId, 180) || null,
        raw_payload: sanitizeClinicalPayload({
          ...(req.body?.raw_payload || req.body?.rawPayload || {}),
          source: requestSource,
          appointmentId: appointmentId || undefined,
          maintenanceScheduleId: isAbaMaintenanceProbeCollection(collectionType) ? maintenanceScheduleId : undefined,
          maintenance_schedule_id: isAbaMaintenanceProbeCollection(collectionType) ? maintenanceScheduleId : undefined,
          clinicalDate: maintenanceClinicalDate || undefined,
          trialType: sanitizeString(req.body?.trialType || req.body?.trial_type || req.body?.collection_type || req.body?.collectionType, 80),
          legacyPromptAudit,
          promptLevel: promptKey,
          ...promptSnapshot,
          isIndependent: independent,
          isCorrect: correct,
          therapistId: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
          timestamp: sanitizeIsoDateTime(req.body?.timestamp || req.body?.occurred_at || req.body?.occurredAt, occurredAt)
        }),
        created_at: new Date().toISOString()
      });

      const result = await writeAbaRowWithSchemaFallback('aba_trials', payload, 'upsert');
      if (result.error) {
        if (hasMissingFinancialSchema(result.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        throw result.error;
      }
      if (isAbaMaintenanceProbeCollection(collectionType)) {
        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120) || '',
          clinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Equipe', 180),
          title: 'Tentativa de Maintenance Probe registrada',
          content: 'Tentativa clínica real de Maintenance Probe foi gravada na sessão ABA.',
          type: 'clinical',
          actionType: 'MAINTENANCE_PROBE_TRIAL_RECORDED',
          payload: {
            organizationId: sanitizeString(req.body?.organization_id || req.body?.organizationId || req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120),
            patientId,
            targetId,
            scheduleId: maintenanceScheduleId,
            sessionId,
            trialId: payload.id,
            result: correct ? (independent ? 'independent' : 'prompted') : 'error'
          }
        });
      }
      return res.json({ success: true, data: { ...payload, id: (result.data as any)?.id || payload.id } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
export function createAbaBehaviorEventWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertAbaSessionCanAcceptClinicalWrite, cleanObject, currentClinicId, enforcePayloadLimit, hasMissingFinancialSchema, isUuid, normalizeAbaBehaviorMeasurementType, normalizeAbaEventStatus, normalizeAbaSyncStatus, resolveAbaAppointmentIdForClinicalWrite, resolveAbaRequestSource, sanitizeClinicalPayload, sanitizeIsoDateTime, sanitizeString, sanitizeTextField, writeAbaRowWithSchemaFallback, supabase } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 128 * 1024, 'Payload do comportamento ABA')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      if (!clinicId) return res.status(400).json({ success: false, error: 'Clínica não identificada.' });
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      const behaviorName = sanitizeTextField(req.body?.behavior_name || req.body?.behaviorName || req.body?.name, 240);
      if (!behaviorName) return res.status(400).json({ success: false, error: 'Comportamento é obrigatório.' });
      const occurredAt = sanitizeIsoDateTime(req.body?.occurred_at || req.body?.occurredAt || req.body?.timestamp);
      const startedAt = req.body?.started_at || req.body?.startedAt
        ? sanitizeIsoDateTime(req.body?.started_at || req.body?.startedAt, occurredAt)
        : null;
      const endedAt = req.body?.ended_at || req.body?.endedAt
        ? sanitizeIsoDateTime(req.body?.ended_at || req.body?.endedAt, occurredAt)
        : null;
      const sessionId = sanitizeString(req.body?.session_id || req.body?.sessionId, 180) || null;
      const behaviorId = sanitizeString(req.body?.behavior_id || req.body?.behaviorId, 180) || null;
      const measurementType = normalizeAbaBehaviorMeasurementType(req.body?.measurement_type || req.body?.measurementType || req.body?.method);
      const intervalNumber = req.body?.interval_number !== undefined || req.body?.intervalNumber !== undefined
        ? asSafeNumber(req.body?.interval_number ?? req.body?.intervalNumber, 0, 100000)
        : req.body?.interval_index !== undefined || req.body?.intervalIndex !== undefined
          ? asSafeNumber(req.body?.interval_index ?? req.body?.intervalIndex, 0, 100000)
          : null;
      const intervalStartedAt = req.body?.interval_started_at || req.body?.intervalStartedAt
        ? sanitizeIsoDateTime(req.body?.interval_started_at || req.body?.intervalStartedAt, startedAt || occurredAt)
        : null;
      const intervalEndedAt = req.body?.interval_ended_at || req.body?.intervalEndedAt
        ? sanitizeIsoDateTime(req.body?.interval_ended_at || req.body?.intervalEndedAt, occurredAt)
        : null;
      const intervalOccurred = typeof req.body?.interval_occurred === 'boolean'
        ? req.body.interval_occurred
        : typeof req.body?.intervalOccurred === 'boolean'
          ? req.body.intervalOccurred
          : null;
      const occurred = typeof req.body?.occurred === 'boolean' ? req.body.occurred : intervalOccurred;
      const clientSyncStatus = normalizeAbaSyncStatus(req.body?.sync_status || req.body?.syncStatus, 'local');
      const requestSource = resolveAbaRequestSource(req.body);
      const isAuthorizedComplement = Boolean(req.body?.clinical_complement || req.body?.clinicalComplement || req.body?.authorizedComplement);
      const sessionWrite = await assertAbaSessionCanAcceptClinicalWrite(sessionId, clinicId, req.session.user, {
        allowCompletedComplement: isAuthorizedComplement
      });
      if (!sessionWrite.ok) return res.status((sessionWrite as any).status || 409).json({ success: false, error: (sessionWrite as any).error });
      const appointmentId = await resolveAbaAppointmentIdForClinicalWrite({
        requestedAppointmentId: req.body?.appointment_id || req.body?.appointmentId,
        sessionId,
        patientId,
        clinicId,
        user: req.session.user
      });
      const incomingRawPayload = req.body?.raw_payload || req.body?.rawPayload || {};
      const behaviorContextSnapshot = sanitizeClinicalPayload({
        ...(incomingRawPayload?.contextSnapshot || incomingRawPayload?.context_snapshot || {}),
        location: sanitizeTextField(req.body?.location, 240) || incomingRawPayload?.contextSnapshot?.location || incomingRawPayload?.context_snapshot?.location,
        severity: req.body?.severity !== undefined ? asSafeNumber(req.body?.severity, 0, 5) : incomingRawPayload?.contextSnapshot?.severity ?? incomingRawPayload?.context_snapshot?.severity ?? null,
        durationSeconds: req.body?.duration_seconds !== undefined || req.body?.durationSeconds !== undefined
          ? asSafeNumber(req.body?.duration_seconds ?? req.body?.durationSeconds, 0, 86400)
          : incomingRawPayload?.contextSnapshot?.durationSeconds ?? incomingRawPayload?.context_snapshot?.durationSeconds ?? null,
        quantity: req.body?.count_delta !== undefined || req.body?.countDelta !== undefined
          ? asSafeNumber(req.body?.count_delta ?? req.body?.countDelta, -10000, 10000)
          : incomingRawPayload?.contextSnapshot?.quantity ?? incomingRawPayload?.context_snapshot?.quantity ?? null,
        collectionMethod: measurementType,
        behaviorName,
        behaviorId: behaviorId || null,
        sessionId: sessionId || null,
        patientId,
        professionalId: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120) || null,
        timestamp: occurredAt,
        abc: {
          antecedent: sanitizeTextField(req.body?.antecedent, 500) || undefined,
          behavior: behaviorName,
          consequence: sanitizeTextField(req.body?.consequence, 500) || undefined
        }
      });

      let payload: Record<string, any> = cleanObject({
        id: sanitizeString(req.body?.id || req.body?.event_id || req.body?.eventId || crypto.randomUUID(), 180),
        clinic_id: clinicId,
        patient_id: patientId,
        appointment_id: appointmentId,
        session_id: sessionId,
        behavior_id: behaviorId,
        behavior_name: behaviorName,
        measurement_type: measurementType,
        count_delta: req.body?.count_delta !== undefined || req.body?.countDelta !== undefined
          ? asSafeNumber(req.body?.count_delta ?? req.body?.countDelta, -10000, 10000)
          : null,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: req.body?.duration_seconds !== undefined || req.body?.durationSeconds !== undefined
          ? asSafeNumber(req.body?.duration_seconds ?? req.body?.durationSeconds, 0, 86400)
          : null,
        status: normalizeAbaEventStatus(req.body?.status, measurementType === 'duration' && !endedAt ? 'IN_PROGRESS' : 'COMPLETED'),
        interval_number: intervalNumber,
        interval_index: intervalNumber,
        interval_started_at: intervalStartedAt,
        interval_ended_at: intervalEndedAt,
        interval_occurred: intervalOccurred,
        occurred,
        severity: req.body?.severity !== undefined ? asSafeNumber(req.body?.severity, 0, 5) : null,
        antecedent: sanitizeTextField(req.body?.antecedent, 500),
        consequence: sanitizeTextField(req.body?.consequence, 500),
        location: sanitizeTextField(req.body?.location, 240),
        response_by_therapist: sanitizeTextField(req.body?.response_by_therapist || req.body?.responseByTherapist, 1000),
        notes: sanitizeTextField(req.body?.notes, 4000),
        occurred_at: occurredAt,
        therapist_id: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
        sync_status: 'synced',
        source: requestSource,
        raw_payload: sanitizeClinicalPayload({
          ...incomingRawPayload,
          contextSnapshot: behaviorContextSnapshot,
          context_snapshot: behaviorContextSnapshot,
          source: requestSource,
          patientId,
          appointmentId: appointmentId || undefined,
          sessionId: sessionId || undefined,
          behaviorId: behaviorId || undefined,
          method: measurementType,
          intervalNumber: intervalNumber ?? undefined,
          intervalStartedAt: intervalStartedAt || undefined,
          intervalEndedAt: intervalEndedAt || undefined,
          occurred: occurred ?? undefined,
          therapistId: sanitizeString(req.body?.therapist_id || req.body?.therapistId || req.session.user?.id, 120),
          timestamp: occurredAt,
          clientSyncStatus,
          syncStatus: 'synced'
        }),
        created_at: new Date().toISOString()
      });

      if (payload.measurement_type === 'duration' && !endedAt && payload.id) {
        const { data: existingDuration } = await supabase
          .from('aba_behavior_events')
          .select('ended_at,duration_seconds,raw_payload')
          .eq('id', payload.id)
          .maybeSingle();
        if (existingDuration?.ended_at) {
          payload = cleanObject({
            ...payload,
            ended_at: existingDuration.ended_at,
            duration_seconds: existingDuration.duration_seconds ?? payload.duration_seconds,
            raw_payload: sanitizeClinicalPayload({
              ...(payload.raw_payload || {}),
              staleOpenWriteIgnored: true,
              preservedCompletedAt: existingDuration.ended_at
            })
          });
        }
      }

      const result = await writeAbaRowWithSchemaFallback('aba_behavior_events', payload, 'upsert');
      if (result.error) {
        if (hasMissingFinancialSchema(result.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        throw result.error;
      }
      return res.json({ success: true, data: result.data || payload });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
export function createAbaBehaviorEventDeleteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, extractMissingColumnName, hasGlobalClinicAccess, hasMissingFinancialSchema, isUuid, sanitizeString, supabase } = getDeps();
    try {
      const eventId = sanitizeString(req.params?.eventId || req.body?.event_id || req.body?.eventId || req.body?.id, 180);
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!eventId) return res.status(400).json({ success: false, error: 'Evento inválido.' });
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      const now = new Date().toISOString();
      let softDeletePatch: Record<string, any> = {
        is_active: false,
        deleted_at: now,
        status: 'CANCELED',
        updated_at: now
      };
      let softDeleteError: any = null;
      while (Object.keys(softDeletePatch).length > 0) {
        if (!('is_active' in softDeletePatch) && !('deleted_at' in softDeletePatch) && !('status' in softDeletePatch)) break;
        let query = supabase
          .from('aba_behavior_events')
          .update(softDeletePatch)
          .eq('id', eventId)
          .eq('patient_id', patientId);
        if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
        if (sanitizeString(req.session.user?.role, 40).toLowerCase() === 'therapist') {
          query = query.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const result = await query;
        softDeleteError = result.error;
        if (!softDeleteError) return res.json({ success: true, data: { id: eventId, deleted: true, softDeleted: true } });
        if (hasMissingFinancialSchema(softDeleteError)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        const missingColumn = extractMissingColumnName(softDeleteError);
        if (missingColumn && missingColumn in softDeletePatch) {
          delete softDeletePatch[missingColumn];
          continue;
        }
        break;
      }
      const hasSoftDeleteField = 'is_active' in softDeletePatch || 'deleted_at' in softDeletePatch || 'status' in softDeletePatch;
      if (softDeleteError && hasSoftDeleteField) throw softDeleteError;
      let query = supabase
        .from('aba_behavior_events')
        .delete()
        .eq('id', eventId)
        .eq('patient_id', patientId);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      if (sanitizeString(req.session.user?.role, 40).toLowerCase() === 'therapist') {
        query = query.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
      }
      const { error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        throw error;
      }
      return res.json({ success: true, data: { id: eventId, deleted: true, softDeleted: false } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
