// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createAbaSessionLiveSummaryReadHandler(getDeps: () => { resolveAbaSessionReadScope: any; supabase: any; ABA_SESSION_LIVE_SUMMARY_SELECT: any; sanitizeString: (value: unknown, maxLength?: number) => string; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { resolveAbaSessionReadScope, supabase, ABA_SESSION_LIVE_SUMMARY_SELECT, sanitizeString, hasGlobalClinicAccess, hasMissingFinancialSchema } = getDeps();
    try {
      const scope = await resolveAbaSessionReadScope(req.params.sessionId, req.session.user);
      if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
      let query = supabase
        .from('aba_session_live_summaries')
        .select(ABA_SESSION_LIVE_SUMMARY_SELECT)
        .eq('session_id', sanitizeString(req.params.sessionId, 180))
        .eq('patient_id', (scope as any).patientId);
      if (!hasGlobalClinicAccess(req.session.user) && (scope as any).clinicId) query = query.eq('clinic_id', (scope as any).clinicId);
      const { data, error } = await query.maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: null });
        throw error;
      }
      return res.json({ success: true, data: data || null });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaSessionReportReadHandler(getDeps: () => { resolveAbaSessionReadScope: any; supabase: any; ABA_SESSION_REPORT_SELECT: any; sanitizeString: (value: unknown, maxLength?: number) => string; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any; persistActivityLog: any; currentClinicId: any; currentClinicTimeZone: any }) {
  return async (req: any, res) => {
    const { resolveAbaSessionReadScope, supabase, ABA_SESSION_REPORT_SELECT, sanitizeString, hasGlobalClinicAccess, hasMissingFinancialSchema, persistActivityLog, currentClinicId, currentClinicTimeZone } = getDeps();
    try {
      const scope = await resolveAbaSessionReadScope(req.params.sessionId, req.session.user);
      if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
      let query = supabase
        .from('aba_session_summaries')
        .select(ABA_SESSION_REPORT_SELECT)
        .eq('session_id', sanitizeString(req.params.sessionId, 180))
        .eq('patient_id', (scope as any).patientId)
        .order('ended_at', { ascending: false })
        .limit(1);
      if (!hasGlobalClinicAccess(req.session.user) && (scope as any).clinicId) query = query.eq('clinic_id', (scope as any).clinicId);
      const { data, error } = await query.maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: null });
        throw error;
      }
      if (data) {
        const actorId = sanitizeString(req.session.user?.id, 120);
        const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
        const auditEventId = sanitizeString(req.headers?.['x-audit-event-id'], 180);
        const auditOk = await persistActivityLog({
          userId: actorId,
          clinicId: sanitizeString((scope as any).clinicId || currentClinicId(req.session.user), 120),
          actorName,
          title: 'Relatório de sessão visualizado',
          content: `${actorName} visualizou o relatório clínico da sessão.`,
          type: 'clinical',
          action: 'aba_session_report_viewed',
          actionType: 'aba_session_report_viewed',
          payloadDetails: JSON.stringify({ sessionId: sanitizeString(req.params.sessionId, 180), actorRole: sanitizeString(req.session.user?.role, 40) || null }),
          resourceType: 'aba_session_report',
          resourceId: sanitizeString(req.params.sessionId, 180),
          patientId: sanitizeString((scope as any).patientId, 120),
          sessionId: sanitizeString(req.params.sessionId, 180),
          timezone: currentClinicTimeZone(req.session.user),
          immutableAudit: true,
          idempotencyKey: auditEventId ? `session-report-view:${actorId}:${sanitizeString(req.params.sessionId, 180)}:${auditEventId}` : null
        });
        if (!auditOk) {
          return res.status(503).json({ success: false, code: 'AUDIT_LOG_UNAVAILABLE', error: 'Não foi possível registrar a auditoria desta visualização.' });
        }
      }
      return res.json({ success: true, data: data || null });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaSessionRecordsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; resolveAbaSessionReadScope: any; hasGlobalClinicAccess: any; supabase: any; ABA_TRIAL_LIST_SELECT: any; ABA_BEHAVIOR_EVENT_LIST_SELECT: any; hasMissingFinancialSchema: any; isMissingRelationError: any; isUuid: any; parseStoredJsonObject: any; sanitizeTextField: any }) {
  return async (req: any, res) => {
    const { sanitizeString, resolveAbaSessionReadScope, hasGlobalClinicAccess, supabase, ABA_TRIAL_LIST_SELECT, ABA_BEHAVIOR_EVENT_LIST_SELECT, hasMissingFinancialSchema, isMissingRelationError, isUuid, parseStoredJsonObject, sanitizeTextField } = getDeps();
    try {
      const requestedSessionId = sanitizeString(req.params.sessionId, 180);
      if (!requestedSessionId || requestedSessionId.startsWith('draft-')) {
        return res.json({ success: true, data: [] });
      }
      const scope = await resolveAbaSessionReadScope(requestedSessionId, req.session.user);
      if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
      const patientId = sanitizeString((scope as any).patientId, 120);
      const clinicId = sanitizeString((scope as any).clinicId, 120);
      const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit || '120'), 10) || 120));
      const applyLegacyClinic = (query: any) => (!hasGlobalClinicAccess(req.session.user) && clinicId ? query.eq('clinic_id', clinicId) : query);
      const applyV3Clinic = (query: any) => (!hasGlobalClinicAccess(req.session.user) && clinicId ? query.eq('organization_id', clinicId) : query);

      const [legacyTrialsResult, behaviorResult, v3TrialsResult] = await Promise.all([
        applyLegacyClinic(
          supabase
            .from('aba_trials')
            .select(ABA_TRIAL_LIST_SELECT)
            .eq('session_id', requestedSessionId)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(limit)
        ),
        applyLegacyClinic(
          supabase
            .from('aba_behavior_events')
            .select(ABA_BEHAVIOR_EVENT_LIST_SELECT)
            .eq('session_id', requestedSessionId)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(limit)
        ),
        applyV3Clinic(
          supabase
            .from('aba_effective_trials_v3')
            .select('id,organization_id,patient_id,session_id,program_id,target_id,client_event_id,trial_type,occurred_at,collector_user_id,client_metadata,created_at')
            .eq('session_id', requestedSessionId)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(limit)
        )
      ]);

      const legacyErrors = [legacyTrialsResult, behaviorResult].map((result: any) => result.error).filter(Boolean);
      const firstLegacyError = legacyErrors[0];
      if (firstLegacyError && !hasMissingFinancialSchema(firstLegacyError)) throw firstLegacyError;

      const v3Unavailable = Boolean((v3TrialsResult as any).error && (hasMissingFinancialSchema((v3TrialsResult as any).error) || isMissingRelationError((v3TrialsResult as any).error)));
      if ((v3TrialsResult as any).error && !v3Unavailable) throw (v3TrialsResult as any).error;
      const v3Trials = v3Unavailable ? [] : ((v3TrialsResult as any).data || []);
      const v3TrialIds = v3Trials.map((row: any) => sanitizeString(row?.id, 120)).filter((id: string) => isUuid(id));
      const targetIds = Array.from(new Set(v3Trials.map((row: any) => sanitizeString(row?.target_id, 180)).filter(Boolean)));

      let v3Steps: any[] = [];
      let targetRows: any[] = [];
      let v3Revisions: any[] = [];
      if (v3TrialIds.length > 0) {
        const revisionLookup = v3TrialIds.join(',');
        const [stepsResult, targetsResult, revisionsResult] = await Promise.all([
          supabase
            .from('aba_trial_steps_v3')
            .select('trial_id,sequence_no,step_type,opportunity_role,outcome,prompt_key,latency_ms,occurred_at')
            .in('trial_id', v3TrialIds)
            .order('sequence_no', { ascending: true }),
          targetIds.length > 0
            ? supabase.from('aba_targets').select('id,name,program_id').in('id', targetIds)
            : Promise.resolve({ data: [], error: null } as any),
          supabase
            .from('aba_trial_revisions_v3')
            .select('trial_id,replacement_trial_id,event_type,reason,actor_id,occurred_at')
            .or(`trial_id.in.(${revisionLookup}),replacement_trial_id.in.(${revisionLookup})`)
            .order('occurred_at', { ascending: false })
            .limit(Math.min(400, Math.max(40, v3TrialIds.length * 3)))
        ]);
        if (stepsResult.error && !hasMissingFinancialSchema(stepsResult.error) && !isMissingRelationError(stepsResult.error)) throw stepsResult.error;
        if (targetsResult.error && !hasMissingFinancialSchema(targetsResult.error) && !isMissingRelationError(targetsResult.error)) throw targetsResult.error;
        if (revisionsResult.error && !hasMissingFinancialSchema(revisionsResult.error) && !isMissingRelationError(revisionsResult.error)) throw revisionsResult.error;
        v3Steps = stepsResult.error ? [] : (stepsResult.data || []);
        targetRows = targetsResult.error ? [] : (targetsResult.data || []);
        v3Revisions = revisionsResult.error ? [] : (revisionsResult.data || []);
      }

      const stepsByTrial = new Map<string, any[]>();
      v3Steps.forEach((step: any) => {
        const trialId = sanitizeString(step?.trial_id, 120);
        if (!trialId) return;
        const list = stepsByTrial.get(trialId) || [];
        list.push(step);
        stepsByTrial.set(trialId, list);
      });
      const targetsById = new Map(targetRows.map((row: any) => [sanitizeString(row?.id, 180), row]));
      const latestRevisionByEffectiveTrial = new Map<string, any>();
      v3Revisions.forEach((revision: any) => {
        const eventType = sanitizeString(revision?.event_type, 40).toUpperCase();
        const effectiveTrialId = ['CORRECT', 'SUPERSEDE'].includes(eventType)
          ? sanitizeString(revision?.replacement_trial_id, 120)
          : sanitizeString(revision?.trial_id, 120);
        if (!effectiveTrialId || latestRevisionByEffectiveTrial.has(effectiveTrialId)) return;
        latestRevisionByEffectiveTrial.set(effectiveTrialId, revision);
      });
      const v3TrialTypeToCollectionType: Record<string, string> = {
        TEACHING: 'dtt',
        PROBE: 'probe',
        BASELINE_PROBE: 'baseline',
        MAINTENANCE_PROBE: 'maintenance_probe',
        GENERALIZATION: 'generalization',
        TASK_ANALYSIS: 'task_analysis',
        OTHER: 'other'
      };

      const rows = [
        ...(((legacyTrialsResult as any).error ? [] : (legacyTrialsResult as any).data || []).map((row: any) => ({
          kind: 'trial',
          tableName: 'aba_trials',
          measurement_model_version: 'LEGACY_V2',
          occurredAt: row.occurred_at || row.created_at,
          ...row
        }))),
        ...(((behaviorResult as any).error ? [] : (behaviorResult as any).data || []).map((row: any) => ({
          kind: 'behavior',
          tableName: 'aba_behavior_events',
          occurredAt: row.occurred_at || row.created_at,
          ...row
        }))),
        ...(v3Trials.map((row: any) => {
          const target = targetsById.get(sanitizeString(row?.target_id, 180)) || {};
          const metadata = parseStoredJsonObject(row?.client_metadata);
          const latestRevision = latestRevisionByEffectiveTrial.get(sanitizeString(row?.id, 120)) || null;
          return {
            kind: 'trial',
            tableName: 'aba_trials_v3',
            measurement_model_version: 'V3',
            id: row.id,
            trial_id: row.id,
            client_event_id: row.client_event_id,
            patient_id: row.patient_id,
            session_id: row.session_id,
            program_id: row.program_id || target?.program_id || null,
            target_id: row.target_id,
            target_name: target?.name || null,
            therapist_id: row.collector_user_id || null,
            trial_type: row.trial_type,
            collection_type: v3TrialTypeToCollectionType[sanitizeString(row?.trial_type, 60).toUpperCase()] || 'dtt',
            occurred_at: row.occurred_at,
            created_at: row.created_at,
            client_metadata: metadata,
            last_revision_reason: latestRevision ? sanitizeTextField(latestRevision?.reason, 1000) || null : null,
            last_revision_event_type: latestRevision ? sanitizeString(latestRevision?.event_type, 40).toUpperCase() || null : null,
            last_revision_at: latestRevision?.occurred_at || null,
            steps: stepsByTrial.get(sanitizeString(row?.id, 120)) || [],
            sync_status: 'synced',
            occurredAt: row.occurred_at || row.created_at
          };
        }))
      ]
        .sort((a: any, b: any) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime())
        .slice(0, limit);

      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaRecentSessionEventsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; isUuid: any; resolveAbaSessionReadScope: any; parseAbaRecordListLimit: any; hasGlobalClinicAccess: any; supabase: any; ABA_TRIAL_LIST_SELECT: any; ABA_BEHAVIOR_EVENT_LIST_SELECT: any; ABA_MASTERY_LIST_SELECT: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, isUuid, resolveAbaSessionReadScope, parseAbaRecordListLimit, hasGlobalClinicAccess, supabase, ABA_TRIAL_LIST_SELECT, ABA_BEHAVIOR_EVENT_LIST_SELECT, ABA_MASTERY_LIST_SELECT, hasMissingFinancialSchema } = getDeps();
    try {
      const requestedSessionId = sanitizeString(req.params.sessionId, 180);
      if (!isUuid(requestedSessionId)) {
        return res.json({ success: true, data: [] });
      }
      const scope = await resolveAbaSessionReadScope(req.params.sessionId, req.session.user);
      if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
      const limit = parseAbaRecordListLimit(req.query?.limit);
      const sessionId = requestedSessionId;
      const patientId = (scope as any).patientId;
      const clinicId = (scope as any).clinicId;
      const applyClinic = (query: any) => (!hasGlobalClinicAccess(req.session.user) && clinicId ? query.eq('clinic_id', clinicId) : query);
      const [trialsResult, behaviorResult, masteryResult] = await Promise.all([
        applyClinic(
          supabase
            .from('aba_trials')
            .select(ABA_TRIAL_LIST_SELECT)
            .eq('session_id', sessionId)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(limit)
        ),
        applyClinic(
          supabase
            .from('aba_behavior_events')
            .select(ABA_BEHAVIOR_EVENT_LIST_SELECT)
            .eq('session_id', sessionId)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(limit)
        ),
        applyClinic(
          supabase
            .from('aba_mastery_evaluations')
            .select(ABA_MASTERY_LIST_SELECT)
            .eq('session_id', sessionId)
            .eq('patient_id', patientId)
            .order('evaluated_at', { ascending: false })
            .limit(limit)
        )
      ]);
      const firstError = [trialsResult, behaviorResult, masteryResult].find((result: any) => result.error)?.error;
      if (firstError) {
        if (hasMissingFinancialSchema(firstError)) return res.json({ success: true, data: [] });
        throw firstError;
      }
      const rows = [
        ...((trialsResult as any).data || []).map((row: any) => ({ kind: 'trial', tableName: 'aba_trials', occurredAt: row.occurred_at || row.created_at, ...row })),
        ...((behaviorResult as any).data || []).map((row: any) => ({ kind: 'behavior', tableName: 'aba_behavior_events', occurredAt: row.occurred_at || row.created_at, ...row })),
        ...((masteryResult as any).data || []).map((row: any) => ({ kind: 'mastery', tableName: 'aba_mastery_evaluations', occurredAt: row.evaluated_at || row.created_at, ...row }))
      ].sort((a: any, b: any) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime()).slice(0, limit);
      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaPatientSummaryReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; supabase: any; ABA_PATIENT_SUMMARY_SELECT: any; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, ABA_PATIENT_SUMMARY_SELECT, hasGlobalClinicAccess, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: null });
      let query = supabase
        .from('aba_patient_aba_summaries')
        .select(ABA_PATIENT_SUMMARY_SELECT)
        .eq('patient_id', patientId);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      const { data, error } = await query.maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: null });
        throw error;
      }
      return res.json({ success: true, data: data || null });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaSessionsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; supabase: any; ABA_SESSION_LIST_SELECT: any; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, supabase, ABA_SESSION_LIST_SELECT, hasGlobalClinicAccess, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      let query = supabase
        .from('aba_sessions')
        .select(ABA_SESSION_LIST_SELECT)
        .eq('patient_id', patientId)
        .order('started_at', { ascending: false })
        .range(from, to);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      if (sanitizeString(req.session.user?.role, 40).toLowerCase() === 'therapist') {
        query = query.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
      }
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: data || [], page, pageSize });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaTrialsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; supabase: any; ABA_TRIAL_LIST_SELECT: any; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, supabase, ABA_TRIAL_LIST_SELECT, hasGlobalClinicAccess, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      let query = supabase
        .from('aba_trials')
        .select(ABA_TRIAL_LIST_SELECT)
        .eq('patient_id', patientId)
        .order('occurred_at', { ascending: false })
        .range(from, to);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: data || [], page, pageSize });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaBehaviorEventsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; supabase: any; ABA_BEHAVIOR_EVENT_LIST_SELECT: any; hasGlobalClinicAccess: any; extractMissingColumnName: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, supabase, ABA_BEHAVIOR_EVENT_LIST_SELECT, hasGlobalClinicAccess, extractMissingColumnName, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      let filterIsActive = true;
      let filterDeletedAt = true;
      let filterCanceled = true;
      let data: any[] | null = null;
      let error: any = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let query = supabase
          .from('aba_behavior_events')
          .select(ABA_BEHAVIOR_EVENT_LIST_SELECT)
          .eq('patient_id', patientId)
          .order('occurred_at', { ascending: false })
          .range(from, to);
        if (filterIsActive) query = query.eq('is_active', true);
        if (filterDeletedAt) query = query.is('deleted_at', null);
        if (filterCanceled) query = query.neq('status', 'CANCELED');
        if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
        if (sanitizeString(req.session.user?.role, 40).toLowerCase() === 'therapist') {
          query = query.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const result = await query;
        data = result.data;
        error = result.error;
        if (!error) break;
        const missingColumn = extractMissingColumnName(error);
        if (missingColumn === 'is_active' && filterIsActive) {
          filterIsActive = false;
          continue;
        }
        if (missingColumn === 'deleted_at' && filterDeletedAt) {
          filterDeletedAt = false;
          continue;
        }
        if (missingColumn === 'status' && filterCanceled) {
          filterCanceled = false;
          continue;
        }
        break;
      }
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: data || [], page, pageSize });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createAbaMasteryEvaluationsReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; supabase: any; ABA_MASTERY_LIST_SELECT: any; hasGlobalClinicAccess: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, supabase, ABA_MASTERY_LIST_SELECT, hasGlobalClinicAccess, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      let query = supabase
        .from('aba_mastery_evaluations')
        .select(ABA_MASTERY_LIST_SELECT)
        .eq('patient_id', patientId)
        .order('evaluated_at', { ascending: false })
        .range(from, to);
      if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: data || [], page, pageSize });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
