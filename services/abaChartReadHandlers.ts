// ABA chart GET handlers; auth, order and route registration remain in server.ts.
// Existing dependencies are captured lazily when an authorized request reaches a handler.
export const createAbaChartReadHandlers = (getDeps: () => any) => ({
  'targets': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN targets
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { points: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      const targetMetrics = ['TARGET_ACCURACY', 'TARGET_INDEPENDENCE', 'TARGET_TRIAL_COUNT'];
      const rows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        metricTypes: targetMetrics,
        targetId: params.targetId,
        metricType: targetMetrics.includes(params.metricType) ? params.metricType : undefined,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: params.limit,
        significantOnly: params.significantOnly,
        specialty: params.specialty,
        professionalId: params.professionalId
      });
      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'targets',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        targetId: params.targetId
      });
      return res.json({ success: true, data: { points: rows.map(normalizeAbaSnapshotPoint), annotations }, source: 'aba_session_metric_snapshots' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END targets
  },
  'behaviors': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN behaviors
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { points: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      const behaviorMetrics = ['BEHAVIOR_FREQUENCY', 'BEHAVIOR_DURATION_EPISODES', 'BEHAVIOR_DURATION_TOTAL', 'BEHAVIOR_DURATION_AVG', 'BEHAVIOR_INTERVAL_OCCURRENCE'];
      let dailyQuery = supabase
        .from('aba_behavior_daily_summaries')
        .select(ABA_BEHAVIOR_DAILY_CHART_SELECT)
        .eq('patient_id', patientId)
        .gte('date', params.dateFrom)
        .lte('date', params.dateTo)
        .order('date', { ascending: true })
        .limit(params.limit);
      dailyQuery = applyAbaChartTenantScope(dailyQuery, req.session.user, clinicId, organizationId);
      if (params.behaviorId) dailyQuery = dailyQuery.eq('behavior_id', params.behaviorId);
      const dailyResult = await dailyQuery;
      if (dailyResult.error && !hasMissingFinancialSchema(dailyResult.error)) throw dailyResult.error;

      const snapshotRows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        metricTypes: behaviorMetrics,
        behaviorId: params.behaviorId,
        metricType: behaviorMetrics.includes(params.metricType) ? params.metricType : undefined,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: params.limit,
        significantOnly: params.significantOnly,
        specialty: params.specialty,
        professionalId: params.professionalId
      });

      const dailyPoints = ((dailyResult.error ? [] : dailyResult.data) || []).flatMap((row: any) => {
        const base = {
          id: row.id,
          sessionId: null,
          targetId: null,
          behaviorId: row.behavior_id,
          metricLabel: row.behavior_name || row.behavior_key || 'Comportamento',
          previousValue: null,
          deltaValue: null,
          deltaPercent: null,
          trendDirection: 'INSUFFICIENT_DATA',
          changeStatus: 'FIRST_MEASUREMENT',
          statusLabel: 'Primeira medição',
          metricDirection: 'LOWER_IS_BETTER',
          changedAt: `${row.date}T12:00:00.000Z`
        };
        const points = [
          { ...base, id: `${row.id}-frequency`, metricType: 'BEHAVIOR_FREQUENCY', value: Number(row.frequency_count || 0) },
          { ...base, id: `${row.id}-duration-episodes`, metricType: 'BEHAVIOR_DURATION_EPISODES', value: Number(row.duration_episode_count || 0) },
          { ...base, id: `${row.id}-duration-total`, metricType: 'BEHAVIOR_DURATION_TOTAL', value: Number(row.duration_total_seconds || 0) },
          { ...base, id: `${row.id}-interval`, metricType: 'BEHAVIOR_INTERVAL_OCCURRENCE', value: Number(row.interval_occurrence_percent || 0) }
        ];
        return params.metricType ? points.filter((point) => point.metricType === params.metricType) : points;
      });

      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'behaviors',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        behaviorId: params.behaviorId
      });
      let contextPatterns: any[] = [];
      try {
        let behaviorContextQuery = supabase
          .from('aba_behavior_events')
          .select('id,behavior_id,behavior_name,measurement_type,count_delta,duration_seconds,severity,location,antecedent,consequence,occurred_at,created_at,session_id,therapist_id,raw_payload')
          .eq('patient_id', patientId)
          .gte('occurred_at', params.dateFromIso)
          .lte('occurred_at', params.dateToIso)
          .order('occurred_at', { ascending: false })
          .limit(Math.min(Math.max(params.limit * 4, 120), 500));
        behaviorContextQuery = applyAbaChartTenantScope(behaviorContextQuery, req.session.user, clinicId, organizationId);
        if (params.behaviorId) behaviorContextQuery = behaviorContextQuery.eq('behavior_id', params.behaviorId);
        const behaviorContextResult = await behaviorContextQuery;
        if (!behaviorContextResult.error) {
          contextPatterns = analyzeBehaviorContextPatterns(behaviorContextResult.data || []);
        }
      } catch (contextError) {
        console.warn('[ABA Behavior Context] context pattern load skipped', {
          patientIdPresent: Boolean(patientId),
          behaviorIdPresent: Boolean(params.behaviorId),
          message: (contextError as any)?.message
        });
      }
      const patternById = new Map(contextPatterns.filter((pattern) => pattern.behaviorId).map((pattern) => [String(pattern.behaviorId), pattern]));
      const patternByName = new Map(contextPatterns.map((pattern) => [String(pattern.behaviorName || '').trim().toLowerCase(), pattern]));
      const attachContextPattern = (point: any) => {
        const behaviorKey = String(point.behaviorId || '').trim();
        const nameKey = String(point.metricLabel || '').trim().toLowerCase();
        const contextPattern = (behaviorKey && patternById.get(behaviorKey)) || patternByName.get(nameKey) || null;
        return contextPattern ? { ...point, contextPattern } : point;
      };
      const points = (snapshotRows.length > 0 ? snapshotRows.map(normalizeAbaSnapshotPoint) : params.specialty || params.professionalId ? [] : dailyPoints.slice(0, params.limit)).map(attachContextPattern);
      return res.json({ success: true, data: { points, dailySummaries: dailyResult.error ? [] : dailyResult.data || [], annotations, contextPatterns }, source: snapshotRows.length > 0 ? 'aba_session_metric_snapshots' : 'aba_behavior_daily_summaries' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END behaviors
  },
  'mastery': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN mastery
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { points: [], evaluations: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      let evaluationQuery = supabase
        .from('aba_mastery_evaluations')
        .select(ABA_MASTERY_LIST_SELECT)
        .eq('patient_id', patientId)
        .gte('evaluated_at', params.dateFromIso)
        .lte('evaluated_at', params.dateToIso)
        .order('evaluated_at', { ascending: true })
        .limit(params.limit);
      evaluationQuery = applyAbaChartTenantScope(evaluationQuery, req.session.user, clinicId, organizationId);
      if (params.targetId) evaluationQuery = evaluationQuery.eq('target_id', params.targetId);
      const evaluationResult = await evaluationQuery;
      if (evaluationResult.error && !hasMissingFinancialSchema(evaluationResult.error)) throw evaluationResult.error;
      const snapshotRows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        metricTypes: ['MASTERY_STATUS'],
        targetId: params.targetId,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: params.limit,
        significantOnly: params.significantOnly,
        specialty: params.specialty,
        professionalId: params.professionalId
      });
      const fallbackPoints = ((evaluationResult.error ? [] : evaluationResult.data) || []).map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        targetId: row.target_id,
        behaviorId: null,
        metricType: 'MASTERY_STATUS',
        metricLabel: row.target_name || row.target_id || 'Habilidade',
        value: row.status === 'READY_FOR_REVIEW' ? 3 : row.status === 'MASTERED_APPROVED' ? 4 : row.status === 'MET_TODAY' ? 2 : 1,
        previousValue: null,
        deltaValue: null,
        deltaPercent: null,
        trendDirection: 'INSUFFICIENT_DATA',
        changeStatus: row.status === 'READY_FOR_REVIEW' ? 'CLINICALLY_SIGNIFICANT_CHANGE' : 'FIRST_MEASUREMENT',
        statusLabel: row.status === 'READY_FOR_REVIEW' ? 'Pronto para revisão' : 'Primeira medição',
        metricDirection: 'STATUS_BASED',
        changedAt: row.evaluated_at,
        sourceSummaryId: null
      }));
      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'mastery',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        targetId: params.targetId
      });
      return res.json({ success: true, data: { points: snapshotRows.length > 0 ? snapshotRows.map(normalizeAbaSnapshotPoint) : params.specialty || params.professionalId ? [] : fallbackPoints, evaluations: evaluationResult.error ? [] : evaluationResult.data || [], annotations }, source: snapshotRows.length > 0 ? 'aba_session_metric_snapshots' : params.specialty || params.professionalId ? 'aba_session_metric_snapshots' : 'aba_mastery_evaluations' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END mastery
  },
  'maintenance': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN maintenance
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { points: [], schedules: [], probeResults: [], alerts: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      const applyScope = (query: any) => applyAbaChartTenantScope(query, req.session.user, clinicId, organizationId);
      const [scheduleResult, probeResult, alertResult] = await Promise.all([
        applyScope(
          supabase
            .from('aba_maintenance_schedules')
            .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
            .eq('patient_id', patientId)
            .gte('scheduled_for', params.dateFromIso)
            .lte('scheduled_for', params.dateToIso)
            .order('scheduled_for', { ascending: true })
            .limit(params.limit)
        ),
        applyScope(
          supabase
            .from('aba_maintenance_probe_results')
            .select(ABA_MAINTENANCE_PROBE_RESULT_SELECT)
            .eq('patient_id', patientId)
            .gte('occurred_at', params.dateFromIso)
            .lte('occurred_at', params.dateToIso)
            .order('occurred_at', { ascending: true })
            .limit(params.limit)
        ),
        applyScope(
          supabase
            .from('aba_regression_alerts')
            .select(ABA_REGRESSION_ALERT_SELECT)
            .eq('patient_id', patientId)
            .gte('created_at', params.dateFromIso)
            .lte('created_at', params.dateToIso)
            .order('created_at', { ascending: true })
            .limit(params.limit)
        )
      ]);
      const firstError = [scheduleResult, probeResult, alertResult].find((result: any) => result.error)?.error;
      if (firstError && !hasMissingFinancialSchema(firstError)) throw firstError;
      const snapshotRows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        metricTypes: ['MAINTENANCE_STATUS', 'REGRESSION_RISK'],
        targetId: params.targetId,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: params.limit,
        significantOnly: params.significantOnly,
        specialty: params.specialty,
        professionalId: params.professionalId
      });
      const [schedules, probeResults, alerts] = await Promise.all([
        enrichMaintenanceRowsWithTargetDisplay((scheduleResult as any).error ? [] : (scheduleResult as any).data || [], clinicId, organizationId, req.session.user),
        enrichMaintenanceRowsWithTargetDisplay((probeResult as any).error ? [] : (probeResult as any).data || [], clinicId, organizationId, req.session.user),
        enrichMaintenanceRowsWithTargetDisplay((alertResult as any).error ? [] : (alertResult as any).data || [], clinicId, organizationId, req.session.user)
      ]);
      const fallbackPoints = probeResults.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        targetId: row.target_id,
        behaviorId: null,
        metricType: 'MAINTENANCE_STATUS',
        metricLabel: row.targetName || row.target_name || row.raw_payload?.targetName || row.target_id || 'Habilidade',
        value: row.status === 'MAINTAINED' ? 3 : row.status === 'WATCH' ? 1 : -1,
        previousValue: null,
        deltaValue: null,
        deltaPercent: null,
        trendDirection: row.status === 'MAINTAINED' ? 'IMPROVED' : row.status === 'REGRESSION_RISK' ? 'WORSENED' : 'STABLE',
        changeStatus: row.status === 'REGRESSION_RISK' ? 'REGRESSION_SIGNAL' : 'FIRST_MEASUREMENT',
        statusLabel: row.status === 'REGRESSION_RISK' ? 'Sinal de regressão' : row.status === 'WATCH' ? 'Estável' : 'Melhorou nesta sessão',
        metricDirection: 'STATUS_BASED',
        changedAt: row.occurred_at,
        sourceSummaryId: null
      }));
      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'maintenance',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        targetId: params.targetId
      });
      return res.json({
        success: true,
        data: {
          points: snapshotRows.length > 0 ? snapshotRows.map(normalizeAbaSnapshotPoint) : params.specialty || params.professionalId ? [] : fallbackPoints,
          schedules,
          probeResults,
          alerts,
          annotations
        },
        source: snapshotRows.length > 0 ? 'aba_session_metric_snapshots' : params.specialty || params.professionalId ? 'aba_session_metric_snapshots' : 'aba_maintenance_probe_results'
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END maintenance
  },
  'session-changes': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN session-changes
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { points: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      const rows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        targetId: params.targetId,
        behaviorId: params.behaviorId,
        metricType: params.metricType || undefined,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: params.limit,
        significantOnly: params.significantOnly,
        specialty: params.specialty,
        professionalId: params.professionalId
      });
      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'session-changes',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        targetId: params.targetId,
        behaviorId: params.behaviorId
      });
      return res.json({ success: true, data: { points: rows.map(normalizeAbaSnapshotPoint), annotations }, source: 'aba_session_metric_snapshots' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END session-changes
  },
  'overview': async (req: any, res: any) => {
    const { supabase, resolveAbaChartPatientScope, isUuid, parseAbaChartParams, fetchAbaSnapshotRows, fetchAbaGraphAnnotations, normalizeAbaSnapshotPoint, applyAbaChartTenantScope, hasMissingFinancialSchema, analyzeBehaviorContextPatterns, enrichMaintenanceRowsWithTargetDisplay, isAbaSignificantChange, buildAbaChartInsight, ABA_BEHAVIOR_DAILY_CHART_SELECT, ABA_MASTERY_LIST_SELECT, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT } = getDeps();
    // ORIGINAL_BEGIN overview
    try {
      const { patientId, clinicId, organizationId } = resolveAbaChartPatientScope(req);
      if (!isUuid(patientId)) return res.json({ success: true, data: { summary: null, points: [], insights: [], annotations: [] } });
      const params = parseAbaChartParams(req.query);
      let summaryQuery = supabase
        .from('aba_patient_aba_summaries')
        .select(ABA_PATIENT_SUMMARY_SELECT)
        .eq('patient_id', patientId)
        .limit(1);
      summaryQuery = applyAbaChartTenantScope(summaryQuery, req.session.user, clinicId, organizationId);
      const summaryResult = await summaryQuery.maybeSingle();
      if (summaryResult.error && !hasMissingFinancialSchema(summaryResult.error)) throw summaryResult.error;
      const rows = await fetchAbaSnapshotRows({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso,
        limit: Math.min(params.limit, 40),
        significantOnly: false,
        ascending: false,
        specialty: params.specialty,
        professionalId: params.professionalId
      });
      const insightRows = rows
        .filter((row: any) => isAbaSignificantChange(row?.change_status, row?.trend_direction) || row?.change_status === 'FIRST_MEASUREMENT')
        .slice(0, 5);
      const annotations = await fetchAbaGraphAnnotations({
        patientId,
        clinicId,
        organizationId,
        user: req.session.user,
        chartType: 'overview',
        dateFromIso: params.dateFromIso,
        dateToIso: params.dateToIso
      });
      return res.json({
        success: true,
        data: {
          summary: summaryResult.error ? null : summaryResult.data || null,
          points: rows.map(normalizeAbaSnapshotPoint).reverse(),
          insights: insightRows.map(buildAbaChartInsight),
          annotations
        },
        source: 'aba_patient_aba_summaries,aba_session_metric_snapshots'
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
    // ORIGINAL_END overview
  }
});
