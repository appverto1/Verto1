import type { Express } from 'express';
import { summarizeClinicalOutcomeSeries, type ClinicalOutcomeObservation } from '../src/utils/clinicalOutcomeAnalytics';
import { filterTherapeuticPlanScopesForActor } from '../src/utils/therapeuticPlanAccess';

type SharedChartRouteDeps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireAnyClinicCapability: (...capabilities: string[]) => any;
  portalActionLimiter: any;
  enforcePayloadLimit: (req: any, res: any, limit: number, label?: string) => boolean;
  sanitizeString: (value: any, maxLength?: number) => string;
  currentClinicId: (user: any) => string | null;
};

export function registerPatientSharedChartRoutes(app: Express, deps: SharedChartRouteDeps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireAnyClinicCapability, portalActionLimiter,
    enforcePayloadLimit, sanitizeString, currentClinicId } = deps;
  const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  const sanitizeTextField = (value: unknown, limit = 256) => String(value ?? '').trim().slice(0, limit);
  const isMissingRelationError = (error: any) => /42P01|PGRST205|relation .* does not exist/i.test(String(error?.code || '') + ' ' + String(error?.message || ''));
  const hasMissingFinancialSchema = (error: any) => /PGRST202|42P01|42703|schema cache/i.test(String(error?.code || '') + ' ' + String(error?.message || ''));
  const sendRouteDbError = (res: any, _route: string, error: any, _details?: any) => {
    const raw = String(error?.code || '') + ' ' + String(error?.message || '');
    if (/SHARED_CHART_GLOBAL_OWNER_CONFLICT/.test(raw)) return res.status(409).json({ success: false, error: 'SHARED_CHART_GLOBAL_OWNER_CONFLICT' });
    const status = /42501|denied|SHARED_CHART_CASE_/.test(raw) ? 403 : 503;
    return res.status(status).json({ success: false, error: status === 403 ? 'SHARED_CHART_ACCESS_DENIED' : 'SHARED_CHART_UNAVAILABLE' });
  };
  const requestIdForLogs = (_req: any) => '';
  const checkSharedChartProfessionalPatientScope = async (req: any, res: any, next: any) => {
    const user = req.session?.user;
    const actorId = sanitizeString(user?.id || user?.user_id, 120);
    const patientId = sanitizeString(req.params.patientId, 120);
    const clinicId = sanitizeString(currentClinicId(user), 120);
    if (![actorId, patientId, clinicId].every(isUuid)) return res.status(403).json({ success: false, error: 'SHARED_CHART_SCOPE_DENIED' });
    // The capability middleware already verified the active clinic membership.
    // Chart management is governed by the case-specific DB authority, not by
    // the separate patient-file access policy.
    const authority = await supabase.rpc('patient_shared_chart_case_authority_v1', {
      p_actor_id: actorId, p_clinic_id: clinicId, p_patient_id: patientId,
    });
    if (authority.error) return res.status(503).json({ success: false, error: 'SHARED_CHART_ACCESS_UNAVAILABLE' });
    const canPublish = authority.data?.canPublish === true;
    const canDelegate = authority.data?.canDelegate === true;
    if (!canPublish && !canDelegate) {
      // Preserve read-only governance visibility for an assigned professional
      // who can view the patient but has not been delegated chart publication.
      const check = await supabase.rpc('patient_file_actor_has_patient_access_v1', {
        p_actor_id: actorId, p_clinic_id: clinicId, p_patient_id: patientId,
      });
      if (check.error) return res.status(503).json({ success: false, error: 'SHARED_CHART_ACCESS_UNAVAILABLE' });
      if (check.data !== true) return res.status(403).json({ success: false, error: 'SHARED_CHART_SCOPE_DENIED' });
    }
    req.sharedChartCaseAuthority = { canPublish, canDelegate };
    req.resolvedPatientId = patientId;
    req.resolvedPatientClinicId = clinicId;
    return next();
  };
  const requirePatientSharedChartPortalScope = async (req: any, res: any, next: any) => {
    const user = req.session?.user;
    if (String(user?.role || '').toLowerCase() !== 'patient') return res.status(403).json({ success: false, error: 'PORTAL_PATIENT_ROLE_REQUIRED' });
    const clinicId = sanitizeString(currentClinicId(user), 120);
    const requestedId = sanitizeString(req.params.patientId, 120);
    const userId = sanitizeString(user?.id || user?.user_id, 120);
    if (!isUuid(clinicId) || !isUuid(requestedId)) return res.status(403).json({ success: false, error: 'PORTAL_PATIENT_SCOPE_DENIED' });
    const linked = sanitizeString(user?.patientPortalPatientId ||
      (user?.activeAccessContext?.kind === 'patient_portal' ? user?.activeAccessContext?.patientId : ''), 120);
    let permitted = isUuid(linked) && linked === requestedId;
    if (!permitted && !isUuid(linked)) {
      // Guardians may have multiple patients. Validate live clinic-specific responsibility.
      const filters: Array<PromiseLike<any>> = [];
      if (isUuid(userId)) filters.push(supabase.from('patients').select('id').eq('id', requestedId).eq('clinic_id', clinicId).eq('responsible_user_id', userId).eq('is_active', true).is('deleted_at', null).limit(1));
      const email = String(user?.email || '').trim().toLowerCase();
      if (email) filters.push(supabase.from('patients').select('id').eq('id', requestedId).eq('clinic_id', clinicId).eq('responsible_email', email).eq('is_active', true).is('deleted_at', null).limit(1));
      if (isUuid(userId) && userId === requestedId) filters.push(supabase.from('patients').select('id').eq('id', requestedId).eq('clinic_id', clinicId).eq('is_active', true).is('deleted_at', null).limit(1));
      const checks = await Promise.all(filters);
      permitted = checks.some(result => !result.error && Array.isArray(result.data) && result.data.some((row: any) => row.id === requestedId));
    }
    if (!permitted) return res.status(403).json({ success: false, error: 'PORTAL_PATIENT_SCOPE_DENIED' });
    // A session-bound patient id can outlive a clinical relationship. Recheck
    // its live state in the SAME scoped DB read before projecting clinical data.
    const patient = await supabase.from('patients')
      .select('id,clinic_id,is_active,deleted_at,archived_at,relationship_status,global_patient_identity_id')
      .eq('id',requestedId).eq('clinic_id',clinicId).limit(1).maybeSingle();
    const livePatient = patient.data && patient.data.is_active === true
      && !patient.data.deleted_at && !patient.data.archived_at
      && !['ended','inactive','terminated','revoked'].includes(
        String(patient.data.relationship_status || '').trim().toLowerCase()
      );
    if (patient.error || !livePatient) return res.status(403).json({ success: false, error: 'PORTAL_PATIENT_SCOPE_DENIED' });
    req.portalContext = { patientIds: [requestedId], resolvedPatientId: requestedId, clinicId,
      globalPatientIdentityId: patient.data.global_patient_identity_id || null };
    return next();
  };

  const finiteClinicalOutcomeNumber = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const normalizeClinicalOutcomeDirectionFromV3 = (value: any) => {
    const normalized = sanitizeString(value, 80).toUpperCase();
    if (normalized === 'DECREASE_IS_BETTER') return 'lower_is_better';
    if (normalized === 'TARGET_RANGE_IS_BETTER') return 'target_range';
    if (normalized === 'NO_DIRECTIONAL_JUDGMENT') return 'no_directional_judgment';
    return 'higher_is_better';
  };

  const normalizeClinicalOutcomeValueFromV3 = (row: any) => {
    const canonicalUnit = sanitizeString(row?.canonical_value_unit, 80).toUpperCase();
    const preferredUnitCode = sanitizeString(row?.unit_code, 80);
    const preferredUnitLabel = sanitizeString(row?.unit_label, 120);
    const finiteValue = finiteClinicalOutcomeNumber(row?.value_number);

    if (canonicalUnit === 'CATEGORY') {
      return { value: null, valueText: sanitizeString(row?.value_text, 180) || null, unit: '' };
    }
    if (canonicalUnit === 'EVENTS_PER_HOUR') {
      return { value: finiteValue, valueText: null, unit: 'eventos/h' };
    }
    if (canonicalUnit === 'MILLISECOND') {
      if (finiteValue === null) return { value: null, valueText: null, unit: 'ms' };
      const requested = `${preferredUnitCode} ${preferredUnitLabel}`.trim().toLowerCase();
      if (/\b(hour|hours|hora|horas|h)\b/.test(requested)) return { value: finiteValue / 3_600_000, valueText: null, unit: preferredUnitLabel || 'h' };
      if (/\b(minute|minutes|minuto|minutos|min)\b/.test(requested)) return { value: finiteValue / 60_000, valueText: null, unit: preferredUnitLabel || 'min' };
      if (/\b(second|seconds|segundo|segundos|sec|s)\b/.test(requested) && !/milli|mili/.test(requested)) return { value: finiteValue / 1_000, valueText: null, unit: preferredUnitLabel || 's' };
      return { value: finiteValue, valueText: null, unit: preferredUnitLabel || preferredUnitCode || 'ms' };
    }
    if (canonicalUnit === 'COUNT') {
      return { value: finiteValue, valueText: null, unit: preferredUnitLabel || preferredUnitCode || 'contagem' };
    }
    return {
      value: finiteValue,
      valueText: sanitizeString(row?.value_text, 180) || null,
      unit: preferredUnitLabel || preferredUnitCode || sanitizeString(row?.canonical_value_unit, 80),
    };
  };

  const normalizeClinicalPlanOutcomesV3ForDashboard = (
    rows: any[],
    visiblePlanMap: Map<string, any>,
    objectivePlanMap: Map<string, Set<string>>,
    targetById: Map<string, any>,
    programById: Map<string, any>,
    ptsVersionBySessionPlan: Map<string, number>,
    historyBindingBySessionTarget: Map<string, any> = new Map(),
  ) => {
    const normalized: any[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const sourceKind = sanitizeString(row?.source_kind, 40).toUpperCase();
      const objectiveId = sanitizeString(row?.therapeutic_objective_id, 120);
      const directPlanId = sanitizeString(row?.plan_id, 120);
      const planIds = sourceKind === 'PLAN_GOAL' || sourceKind === 'ABA_TARGET'
        ? (visiblePlanMap.has(directPlanId) ? [directPlanId] : [])
        : Array.from(objectivePlanMap.get(objectiveId) || []);
      if (!planIds.length) continue;

      const normalizedValue = normalizeClinicalOutcomeValueFromV3(row);
      const observedAt = sanitizeString(row?.observed_at, 80) || `${sanitizeString(row?.clinical_date, 20)}T00:00:00.000Z`;
      const coverageStatus = sanitizeString(row?.coverage_status, 80).toUpperCase();
      const missingReason = coverageStatus && coverageStatus !== 'OBSERVED' ? coverageStatus.toLowerCase() : null;
      const metricKey = sanitizeString(row?.metric_key, 120);
      const programTargetMatch = metricKey.match(/^program_target:([^:]+):/i);
      const semanticTargetId = sourceKind === 'ABA_TARGET'
        ? sanitizeString(row?.value_details?.aba_target_id || row?.target_id, 180)
        : sanitizeString(programTargetMatch?.[1], 180);
      const semanticTarget = semanticTargetId ? targetById.get(semanticTargetId) || null : null;
      const semanticProgram = semanticTarget?.program_id ? programById.get(String(semanticTarget.program_id)) || null : null;
      const historyBinding = sourceKind === 'ABA_TARGET' ? historyBindingBySessionTarget.get(`${sanitizeString(row?.session_id, 180)}::${semanticTargetId}`) || null : null;
      const historyVersionStatus = sourceKind === 'ABA_TARGET' ? (historyBinding?.program_version_id ? 'VERSION_BOUND' : 'LEGACY_UNVERSIONED') : 'VERSION_BOUND';
      const targetMasteryCriteria = semanticTarget?.mastery_criteria && typeof semanticTarget.mastery_criteria === 'object' && !Array.isArray(semanticTarget.mastery_criteria) && Object.keys(semanticTarget.mastery_criteria).length > 0
        ? semanticTarget.mastery_criteria
        : null;
      const programMasteryCriteria = semanticProgram?.mastery_criteria && typeof semanticProgram.mastery_criteria === 'object' && !Array.isArray(semanticProgram.mastery_criteria) && Object.keys(semanticProgram.mastery_criteria).length > 0
        ? semanticProgram.mastery_criteria
        : null;
      for (const planId of planIds) {
        const plan = visiblePlanMap.get(planId) || {};
        const sourceSessionId = sanitizeString(row?.session_id, 180);
        const boundPlanVersion = sourceSessionId ? ptsVersionBySessionPlan.get(`${sourceSessionId}::${planId}`) : undefined;
        normalized.push({
          id: `cmv3:${sanitizeString(row?.expectation_id, 120)}:${planId}`,
          planId,
          planVersion: Number(boundPlanVersion || plan?.edit_version || 1),
          goalId: sanitizeString(row?.goal_id, 120) || objectiveId || null,
          programId: sanitizeString(row?.program_id || semanticProgram?.id, 180) || null,
          sessionId: sanitizeString(row?.session_id, 180) || null,
          professionalId: null,
          specialty: sanitizeTextField(row?.specialty || plan?.specialty, 120) || null,
          itemId: sourceKind === 'ABA_TARGET'
            ? sanitizeString(row?.value_details?.series_key || row?.item_id || row?.target_id, 260) || null
            : sanitizeString(row?.item_id || row?.target_id, 260) || null,
          itemLabel: sanitizeTextField(row?.item_label || row?.metric_label, 220) || null,
          metricKey: metricKey || sanitizeString(row?.definition_id, 120),
          metricLabel: sanitizeTextField(row?.metric_label, 180) || sanitizeString(row?.metric_key, 120) || 'Métrica clínica',
          metricType: sanitizeString(row?.semantic_family, 40).toLowerCase(),
          unit: normalizedValue.unit,
          direction: normalizeClinicalOutcomeDirectionFromV3(row?.directionality),
          value: normalizedValue.value,
          valueText: normalizedValue.valueText,
          numerator: finiteClinicalOutcomeNumber(row?.numerator),
          denominator: finiteClinicalOutcomeNumber(row?.denominator),
          observedAt,
          context: 'clinic',
          source: sanitizeString(row?.read_model_source, 120) === 'ABA_V3_TARGET_CHART_READ_MODEL' ? 'ABA V3 canônico' : 'V3 canônico',
          instrumentId: sanitizeString(row?.read_model_source, 120) === 'ABA_V3_TARGET_CHART_READ_MODEL' ? 'ABA_V3_PHASE' : null,
          instrumentVersion: sanitizeString(row?.value_details?.phase_assignment_id, 180) || null,
          definitionVersion: Math.max(1, Number(row?.definition_version || 1)),
          missingReason,
          projectionStale: row?.projection_stale === true,
          sourceAuthority: 'canonical',
          metadata: {
            cmv3: true,
            sourceKind,
            targetId: row?.target_id || null,
            definitionId: row?.definition_id || null,
            definitionVersionId: row?.definition_version_id || null,
            expectationId: row?.expectation_id || null,
            coverageStatus: row?.coverage_status || null,
            canonicalValueUnit: row?.canonical_value_unit || null,
            valueDetails: row?.value_details || {},
            projectionQueueStatus: row?.projection_queue_status || null,
            sourceLatestRecordedAt: row?.source_latest_recorded_at || null,
            computedAt: row?.computed_at || null,
            readModelSource: row?.read_model_source || null,
            abaTargetId: sourceKind === 'ABA_TARGET' ? semanticTargetId || null : null,
            programTargetId: sourceKind === 'THERAPEUTIC_OBJECTIVE' ? semanticTargetId || null : null,
            targetDescription: semanticTarget?.description || null,
            masteryCriteria: targetMasteryCriteria || programMasteryCriteria || null,
            programMasteryCriteria: programMasteryCriteria || null,
            criterionSource: targetMasteryCriteria ? 'TARGET' : programMasteryCriteria ? 'PROGRAM_INHERITED' : null,
            targetType: semanticTarget?.target_type || null,
            targetPhase: sourceKind === 'ABA_TARGET' ? (historyBinding?.target_status_snapshot || null) : (semanticTarget?.phase || null),
            programMeasurementType: sourceKind === 'ABA_TARGET' ? (historyBinding?.measurement_type_snapshot || null) : (semanticProgram?.measurement_type || null),
            historyVersionStatus,
            programVersionId: historyBinding?.program_version_id || null,
            programVersion: historyBinding?.program_version_snapshot || null,
            sourceFamily: row?.value_details?.source_family || null,
            requiresReview: row?.value_details?.requires_review === true,
            phaseAssignmentId: row?.value_details?.phase_assignment_id || null,
            phaseType: row?.value_details?.phase_type || null,
            phaseLabel: row?.value_details?.phase_label || null,
          },
          minimumDataPoints: 4,
          recencyWindowDays: 30,
          sourceRecordType: 'cmv3_projection',
        });
      }
    }
    return normalized;
  };

  const clinicalOutcomeCrossSourceFingerprint = (row: any) => {
    const observed = new Date(String(row?.observedAt || ''));
    const observedSecond = Number.isFinite(observed.getTime()) ? Math.floor(observed.getTime() / 1000) : String(row?.observedAt || '');
    const numeric = finiteClinicalOutcomeNumber(row?.value);
    const numerator = finiteClinicalOutcomeNumber(row?.numerator);
    const denominator = finiteClinicalOutcomeNumber(row?.denominator);
    return [
      sanitizeString(row?.planId, 120),
      sanitizeString(row?.goalId, 120),
      sanitizeString(row?.metricKey, 120).toLowerCase(),
      sanitizeString(row?.unit, 80).toLowerCase(),
      sanitizeString(row?.direction, 80).toLowerCase(),
      sanitizeTextField(row?.specialty, 120).toLowerCase(),
      observedSecond,
      numeric !== null ? String(Math.round(numeric * 1_000_000) / 1_000_000) : sanitizeString(row?.valueText, 180),
      numerator !== null ? String(numerator) : '',
      denominator !== null ? String(denominator) : '',
    ].join('::');
  };

  const mergeClinicalOutcomeRowsV3First = (canonicalRows: any[], legacyRows: any[]) => {
    const canonical = Array.isArray(canonicalRows) ? canonicalRows : [];
    const legacy = Array.isArray(legacyRows) ? legacyRows : [];
    const canonicalFingerprints = new Set(canonical.map(clinicalOutcomeCrossSourceFingerprint));
    const canonicalAbaSessionTargets = new Set(
      canonical
        .filter((row) => sanitizeString(row?.metadata?.readModelSource, 120) === 'ABA_V3_TARGET_CHART_READ_MODEL')
        .map((row) => {
          const sessionId = sanitizeString(row?.sessionId, 180);
          const targetId = sanitizeString(row?.metadata?.abaTargetId, 180);
          return sessionId && targetId ? `${sessionId}::${targetId}` : '';
        })
        .filter(Boolean)
    );
    let deduplicatedLegacyCount = 0;
    const preservedLegacy = legacy.filter((row) => {
      const legacySessionId = sanitizeString(row?.sessionId, 180);
      const legacyTargetId = sanitizeString(row?.itemId, 180);
      const canonicalOwnsSessionTarget = row?.sourceRecordType === 'aba_snapshot'
        && legacySessionId
        && legacyTargetId
        && canonicalAbaSessionTargets.has(`${legacySessionId}::${legacyTargetId}`);
      if (!canonicalOwnsSessionTarget && !canonicalFingerprints.has(clinicalOutcomeCrossSourceFingerprint(row))) return true;
      deduplicatedLegacyCount += 1;
      return false;
    });
    const rows = [...canonical, ...preservedLegacy];
    rows.sort((left, right) => new Date(String(left?.observedAt || 0)).getTime() - new Date(String(right?.observedAt || 0)).getTime());
    return { rows, deduplicatedLegacyCount };
  };

  const isClinicalPlanV3ReaderUnavailable = (error: any) => {
    const code = sanitizeString(error?.code, 80).toUpperCase();
    const message = sanitizeString(error?.message || error?.details || error, 400).toLowerCase();
    return code === 'PGRST202'
      || ((message.includes('read_clinical_outcomes_converged_v3') || message.includes('read_clinical_plan_outcomes_v3'))
        && (message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find')));
  };


  type SharedChartDescriptor = {
    schemaVersion: 1;
    family: 'PLAN_PTS' | 'ABA_V3';
    domain: string;
    metricSignature: string;
    axis: 'date' | 'session';
    comparePrevious: boolean;
    seriesKeys?: string[];
    seriesRefs?: Array<{
      targetId: string;
      measurementModelVersion: string;
      phaseAssignmentId: string;
      metricKey: string;
      seriesKey: string;
    }>;
  };

  const normalizeSharedChartDescriptor = (value: any): SharedChartDescriptor | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Number(value.schemaVersion) !== 1) return null;
    const family = sanitizeString(value.family, 32).toUpperCase();
    const domain = sanitizeString(value.domain, 40).toLowerCase();
    const metricSignature = sanitizeString(value.metricSignature, 320);
    const axis = sanitizeString(value.axis, 20).toLowerCase();
    if (!metricSignature || (axis !== 'date' && axis !== 'session')) return null;

    if (family === 'PLAN_PTS') {
      if (!['skills', 'behaviors', 'mastery', 'maintenance'].includes(domain)) return null;
      const seriesKeys = Array.from(new Set(
        (Array.isArray(value.seriesKeys) ? value.seriesKeys : [])
          .map((item: any) => sanitizeString(item, 720))
          .filter(Boolean)
      )).slice(0, 4) as string[];
      if (seriesKeys.length < 1 || seriesKeys.length > 3) return null;
      const normalized: SharedChartDescriptor = {
        schemaVersion: 1,
        family: 'PLAN_PTS',
        domain,
        metricSignature,
        seriesKeys,
        axis: axis as 'date' | 'session',
        comparePrevious: value.comparePrevious === true,
      };
      return JSON.stringify(normalized).length <= 7800 ? normalized : null;
    }

    if (family === 'ABA_V3') {
      if (!['skills', 'behaviors', 'maintenance'].includes(domain)) return null;
      const refs = (Array.isArray(value.seriesRefs) ? value.seriesRefs : []).map((item: any) => ({
        targetId: sanitizeString(item?.targetId, 180),
        measurementModelVersion: sanitizeString(item?.measurementModelVersion, 80),
        phaseAssignmentId: sanitizeString(item?.phaseAssignmentId, 180),
        metricKey: sanitizeString(item?.metricKey, 160),
        seriesKey: sanitizeString(item?.seriesKey, 320),
      }));
      if (
        refs.length < 1
        || refs.length > 12
        || refs.some((item: any) => !item.targetId || !item.measurementModelVersion || !item.phaseAssignmentId || !item.metricKey || !item.seriesKey)
      ) return null;
      const deduped = Array.from(new Map<string, any>(refs.map((item: any) => [
        [item.targetId, item.measurementModelVersion, item.phaseAssignmentId, item.metricKey, item.seriesKey].join('::'),
        item,
      ])).values()) as any[];
      if (deduped.length !== refs.length) return null;
      const normalized: SharedChartDescriptor = {
        schemaVersion: 1,
        family: 'ABA_V3',
        domain,
        metricSignature,
        seriesRefs: deduped,
        axis: axis as 'date' | 'session',
        comparePrevious: value.comparePrevious === true,
      };
      return JSON.stringify(normalized).length <= 7800 ? normalized : null;
    }
    return null;
  };

  const sharedChartKey = (descriptor: SharedChartDescriptor) => (
    descriptor.family + ':' + crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex').slice(0, 40)
  );

  const projectSharedClinicalSeries = (series: any) => ({
    key: sanitizeString(series?.key, 720),
    metricKey: sanitizeString(series?.metricKey, 160),
    metricLabel: sanitizeTextField(series?.metricLabel, 220),
    itemLabel: sanitizeTextField(series?.itemLabel, 220),
    unit: sanitizeString(series?.unit, 80),
    direction: sanitizeString(series?.direction, 80),
    points: (Array.isArray(series?.observations) ? series.observations : []).slice(-180).map((row: any) => ({
      observedAt: sanitizeString(row?.observedAt, 80),
      value: row?.value === null || row?.value === undefined || !Number.isFinite(Number(row.value)) ? null : Number(row.value),
      valueText: sanitizeTextField(row?.valueText, 180) || null,
      numerator: row?.numerator === null || row?.numerator === undefined || !Number.isFinite(Number(row.numerator)) ? null : Number(row.numerator),
      denominator: row?.denominator === null || row?.denominator === undefined || !Number.isFinite(Number(row.denominator)) ? null : Number(row.denominator),
      missingReason: sanitizeString(row?.missingReason, 120) || null,
    })),
  });

  const loadSharedPlanChartProjection = async (params: {
    clinicId: string;
    patientId: string;
    descriptor: SharedChartDescriptor;
    actorId?: string | null;
    actorRole?: string | null;
  }) => {
    const { clinicId, patientId, descriptor } = params;
    const requestedKeys = Array.isArray(descriptor.seriesKeys) ? descriptor.seriesKeys : [];
    const requestedPlanIds = Array.from(new Set(
      requestedKeys.map((key) => sanitizeString(String(key).split('::')[0], 120)).filter(isUuid)
    ));
    if (requestedKeys.length < 1 || requestedPlanIds.length < 1 || requestedPlanIds.length > 3) return null;

    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - 730 * 86_400_000);
    const dateFromIso = dateFrom.toISOString();
    const dateToIso = dateTo.toISOString();
    const [planResult, linkResult, programResult, definitionResult, observationResult, ptsContextResult] = await Promise.all([
      supabase
        .from('patient_therapeutic_plans')
        .select('id,organization_id,clinic_id,patient_id,mode,specialty,responsible_professional_id,participant_professional_ids,participant_specialties,common_objectives,specialty_objectives,pts_payload,pts_schema_version,review_due_date,last_reviewed_at,status,edit_version,created_at,updated_at')
        .eq('organization_id', clinicId)
        .eq('patient_id', patientId)
        .in('id', requestedPlanIds)
        .limit(3),
      params.actorId
        ? supabase
            .from('patient_professional_links')
            .select('patient_id,professional_id,status,permissions')
            .eq('organization_id', clinicId)
            .eq('patient_id', patientId)
            .eq('status', 'active')
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('aba_programs')
        .select('id,patient_id,therapeutic_plan_id,therapeutic_objective_id,domain_id,domain_name,name,status,measurement_type,mastery_criteria,responsible_professional_ids,created_by')
        .eq('organization_id', clinicId)
        .eq('patient_id', patientId)
        .in('therapeutic_plan_id', requestedPlanIds)
        .limit(300),
      supabase
        .from('clinical_measure_definitions')
        .select('id,plan_id,goal_id,program_id,specialty,name,metric_key,metric_type,unit,direction,target_type,target_value,target_min,target_max,instrument_id,instrument_version,definition_version,minimum_data_points,aggregation_method,recency_window_days,active')
        .eq('organization_id', clinicId)
        .eq('patient_id', patientId)
        .in('plan_id', requestedPlanIds)
        .eq('active', true)
        .limit(500),
      supabase
        .from('clinical_observations')
        .select('id,plan_id,plan_version,goal_id,program_id,session_id,professional_id,specialty,measure_definition_id,metric_key,metric_label,metric_type,unit,direction,value,numerator,denominator,observed_at,context,source,instrument_id,instrument_version,definition_version,missing_reason,metadata')
        .eq('organization_id', clinicId)
        .eq('patient_id', patientId)
        .in('plan_id', requestedPlanIds)
        .gte('observed_at', dateFromIso)
        .lte('observed_at', dateToIso)
        .order('observed_at', { ascending: true })
        .limit(2000),
      supabase
        .from('patient_pts_collection_contexts_v1')
        .select('source_session_id,plan_id,specialty_plan_id,version_number,context_opened_at')
        .eq('organization_id', clinicId)
        .eq('patient_id', patientId)
        .gte('context_opened_at', dateFromIso)
        .lte('context_opened_at', dateToIso)
        .limit(2000),
    ]);

    const criticalError = [planResult.error, linkResult.error, programResult.error].find(Boolean);
    if (criticalError) throw criticalError;
    if (definitionResult.error && !isMissingRelationError(definitionResult.error) && !hasMissingFinancialSchema(definitionResult.error)) throw definitionResult.error;
    if (observationResult.error && !isMissingRelationError(observationResult.error) && !hasMissingFinancialSchema(observationResult.error)) throw observationResult.error;
    if (ptsContextResult.error && !isMissingRelationError(ptsContextResult.error) && !hasMissingFinancialSchema(ptsContextResult.error)) throw ptsContextResult.error;

    const allPlans = planResult.data || [];
    const allowedPlans = params.actorId
      ? filterTherapeuticPlanScopesForActor(allPlans, {
          actorId: sanitizeString(params.actorId, 120),
          actorRole: sanitizeString(params.actorRole, 40).toLowerCase(),
          professionalLinks: linkResult.data || [],
        })
      : allPlans;
    const allowedPlanIds = new Set(allowedPlans.map((plan: any) => String(plan.id)));
    if (requestedPlanIds.some((planId) => !allowedPlanIds.has(planId))) return null;

    const programs = (programResult.data || []).filter((program: any) => allowedPlanIds.has(String(program.therapeutic_plan_id)));
    const programIds = programs.map((program: any) => sanitizeString(program.id, 180)).filter(Boolean);
    const targetResult = programIds.length
      ? await supabase
          .from('aba_targets')
          .select('id,program_id,name,description,target_type,measurement_type,phase,clinical_status,mastery_criteria')
          .eq('organization_id', clinicId)
          .eq('patient_id', patientId)
          .in('program_id', programIds)
          .limit(1000)
      : { data: [], error: null };
    if (targetResult.error) throw targetResult.error;

    const planMap = new Map<string, any>(allowedPlans.map((plan: any) => [String(plan.id), plan]));
    const programById = new Map<string, any>(programs.map((program: any) => [String(program.id), program]));
    const targetById = new Map<string, any>((targetResult.data || []).map((target: any) => [String(target.id), target]));
    const objectivePlanMap = new Map<string, Set<string>>();
    for (const program of programs) {
      const objectiveId = sanitizeString(program?.therapeutic_objective_id, 120);
      const planId = sanitizeString(program?.therapeutic_plan_id, 120);
      if (!isUuid(objectiveId) || !allowedPlanIds.has(planId)) continue;
      const current = objectivePlanMap.get(objectiveId) || new Set<string>();
      current.add(planId);
      objectivePlanMap.set(objectiveId, current);
    }

    const ptsVersionBySessionPlan = new Map<string, number>();
    for (const row of ptsContextResult.error ? [] : ptsContextResult.data || []) {
      const sessionId = sanitizeString((row as any)?.source_session_id, 180);
      const planId = sanitizeString((row as any)?.plan_id, 120);
      const specialtyPlanId = sanitizeString((row as any)?.specialty_plan_id, 120);
      const version = Number((row as any)?.version_number || 0);
      if (sessionId && version > 0) {
        if (planId) ptsVersionBySessionPlan.set([sessionId, planId].join('::'), version);
        if (specialtyPlanId) ptsVersionBySessionPlan.set([sessionId, specialtyPlanId].join('::'), version);
      }
    }

    let canonicalRows: any[] = [];
    const v3Result = await supabase.rpc('read_clinical_outcomes_converged_v3', {
      p_organization_id: clinicId,
      p_patient_id: patientId,
      p_date_from: dateFromIso.slice(0, 10),
      p_date_to: dateToIso.slice(0, 10),
      p_plan_ids: requestedPlanIds,
      p_therapeutic_objective_ids: Array.from(objectivePlanMap.keys()),
      p_program_ids: programIds,
      p_limit: 5000,
    });
    if (v3Result.error) {
      if (!isClinicalPlanV3ReaderUnavailable(v3Result.error)) throw v3Result.error;
    } else {
      canonicalRows = normalizeClinicalPlanOutcomesV3ForDashboard(
        v3Result.data || [],
        planMap,
        objectivePlanMap,
        targetById,
        programById,
        ptsVersionBySessionPlan
      );
    }

    const definitionById = new Map<string, any>((definitionResult.error ? [] : definitionResult.data || [])
      .filter((definition: any) => allowedPlanIds.has(String(definition.plan_id)))
      .map((definition: any) => [String(definition.id), definition]));
    const legacyRows: ClinicalOutcomeObservation[] = (observationResult.error ? [] : observationResult.data || [])
      .filter((row: any) => allowedPlanIds.has(String(row.plan_id)))
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
          metadata: {},
          minimumDataPoints: Number(definition.minimum_data_points || 4),
          recencyWindowDays: Number(definition.recency_window_days || 30),
        } as ClinicalOutcomeObservation;
      });

    const mergedRows = mergeClinicalOutcomeRowsV3First(canonicalRows, legacyRows).rows;
    const seriesByKey = new Map<string, any>(
      summarizeClinicalOutcomeSeries(mergedRows).map((series: any) => [series.key, series])
    );
    const selected = requestedKeys.map((key) => seriesByKey.get(key)).filter(Boolean);
    if (selected.length !== requestedKeys.length) return null;
    return {
      family: 'PLAN_PTS',
      domain: descriptor.domain,
      metricSignature: descriptor.metricSignature,
      axis: descriptor.axis,
      comparePrevious: descriptor.comparePrevious,
      series: selected.map(projectSharedClinicalSeries),
    };
  };

  const loadSharedAbaV3ChartProjection = async (
    clinicId: string,
    patientId: string,
    descriptor: SharedChartDescriptor
  ) => {
    const refs = Array.isArray(descriptor.seriesRefs) ? descriptor.seriesRefs : [];
    const targetIds = Array.from(new Set(refs.map((ref) => ref.targetId).filter(Boolean)));
    if (targetIds.length < 1 || targetIds.length > 3) return null;
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - 365 * 86_400_000);
    const { data, error } = await supabase.rpc('get_aba_chart_series_bundle_v3', {
      p_organization_id: clinicId,
      p_patient_id: patientId,
      p_target_ids: targetIds,
      p_from: dateFrom.toISOString(),
      p_to: dateTo.toISOString(),
      p_limit: 180,
    });
    if (error) throw error;
    const segments = Array.isArray(data?.segments) ? data.segments : [];
    const segmentByRef = new Map<string, any>(segments.map((segment: any) => [[
      sanitizeString(segment?.target_id, 180),
      sanitizeString(segment?.measurement_model_version, 80),
      sanitizeString(segment?.phase_assignment_id, 180),
      sanitizeString(segment?.metric_key, 160),
      sanitizeString(segment?.series_key, 320),
    ].join('::'), segment]));
    const selected = refs.map((ref) => segmentByRef.get([
      ref.targetId,
      ref.measurementModelVersion,
      ref.phaseAssignmentId,
      ref.metricKey,
      ref.seriesKey,
    ].join('::'))).filter(Boolean);
    if (selected.length !== refs.length) return null;
    return {
      family: 'ABA_V3',
      domain: descriptor.domain,
      metricSignature: descriptor.metricSignature,
      axis: descriptor.axis,
      comparePrevious: descriptor.comparePrevious,
      series: selected.map((segment: any) => ({
        targetId: sanitizeString(segment?.target_id, 180),
        targetLabel: sanitizeTextField(segment?.target_name, 220),
        metricKey: sanitizeString(segment?.metric_key, 160),
        metricLabel: sanitizeTextField(segment?.metric_label, 220),
        seriesKey: sanitizeString(segment?.series_key, 320),
        seriesLabel: sanitizeTextField(segment?.series_label, 220),
        unit: sanitizeString(segment?.unit, 80),
        points: (Array.isArray(segment?.points) ? segment.points : []).slice(-180).map((point: any) => ({
          occurredAt: sanitizeString(point?.occurred_at, 80),
          value: point?.value === null || point?.value === undefined || !Number.isFinite(Number(point.value)) ? null : Number(point.value),
          numerator: point?.numerator === null || point?.numerator === undefined || !Number.isFinite(Number(point.numerator)) ? null : Number(point.numerator),
          denominator: point?.denominator === null || point?.denominator === undefined || !Number.isFinite(Number(point.denominator)) ? null : Number(point.denominator),
        })),
      })),
    };
  };

  const resolveSharedChartProjection = async (params: {
    clinicId: string;
    patientId: string;
    descriptor: SharedChartDescriptor;
    actorId?: string | null;
    actorRole?: string | null;
  }) => {
    if (params.descriptor.family === 'PLAN_PTS') return loadSharedPlanChartProjection(params);
    if (params.descriptor.family === 'ABA_V3') {
      return loadSharedAbaV3ChartProjection(params.clinicId, params.patientId, params.descriptor);
    }
    return null;
  };

  const readSharedChartSelection = async (clinicId: string, patientId: string) => {
    const { data, error } = await supabase
      .from('patient_shared_chart_selections')
      .select('chart_family,chart_key,reference_version,chart_reference,updated_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  app.get(
    '/api/patients/:patientId/shared-chart-selection',
    noStoreDynamicResponse,
    checkAuth,
    requireAnyClinicCapability('reports.clinical.indicators', 'aba.analytics.view'),
    checkSharedChartProfessionalPatientScope,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const clinicId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        if (!isUuid(patientId) || !isUuid(clinicId)) {
          return res.status(400).json({ success: false, error: 'SHARED_CHART_SCOPE_INVALID' });
        }
        const row = await readSharedChartSelection(clinicId, patientId);
        const authority = req.sharedChartCaseAuthority;
        const descriptor = normalizeSharedChartDescriptor(row?.chart_reference);
        return res.json({
          success: true,
          governance: {
            canPublish: authority.data?.canPublish === true,
            canDelegate: authority.data?.canDelegate === true,
          },
          data: row && descriptor ? {
            chartKey: sanitizeString(row.chart_key, 256),
            referenceVersion: Number(row.reference_version || 1),
            updatedAt: sanitizeString(row.updated_at, 80) || null,
            descriptor,
          } : null,
        });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/patients/:patientId/shared-chart-selection [GET]', error);
      }
    }
  );

  app.put(
    '/api/patients/:patientId/shared-chart-selection',
    portalActionLimiter,
    noStoreDynamicResponse,
    checkAuth,
    requireAnyClinicCapability('reports.clinical.indicators', 'aba.analytics.view'),
    checkSharedChartProfessionalPatientScope,
    async (req: any, res) => {
      try {
        if (!enforcePayloadLimit(req, res, 12 * 1024, 'Seleção do gráfico do paciente')) return;
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const clinicId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        if (![patientId, clinicId, actorId].every(isUuid)) {
          return res.status(400).json({ success: false, error: 'SHARED_CHART_SCOPE_INVALID' });
        }
        if (req.sharedChartCaseAuthority?.canPublish !== true) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_CASE_PUBLISH_DENIED' });
        }
        const descriptor = normalizeSharedChartDescriptor(req.body?.descriptor);
        if (!descriptor) return res.status(400).json({ success: false, error: 'SHARED_CHART_DESCRIPTOR_INVALID' });

        const capabilities = req.authorizationContext?.capabilities;
        if (descriptor.family === 'PLAN_PTS' && !capabilities?.has?.('reports.clinical.indicators')) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_SOURCE_ACCESS_DENIED' });
        }
        if (descriptor.family === 'ABA_V3' && !capabilities?.has?.('aba.analytics.view')) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_SOURCE_ACCESS_DENIED' });
        }

        const projection = await resolveSharedChartProjection({
          clinicId,
          patientId,
          descriptor,
          actorId,
          actorRole: req.effectiveClinicRole,
        });
        if (!projection) {
          return res.status(422).json({ success: false, error: 'SHARED_CHART_REFERENCE_NOT_RESOLVABLE' });
        }

        const chartKey = sharedChartKey(descriptor);
        const { data, error } = await supabase.rpc('set_patient_shared_chart_selection_v2', {
          p_actor_id: actorId,
          p_clinic_id: clinicId,
          p_patient_id: patientId,
          p_chart_family: descriptor.family,
          p_chart_key: chartKey,
          p_reference_version: descriptor.schemaVersion,
          p_chart_reference: descriptor,
        });
        if (error) throw error;
        return res.json({
          success: true,
          data: {
            chartKey,
            referenceVersion: Number(data?.reference_version || descriptor.schemaVersion),
            descriptor,
          },
        });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/patients/:patientId/shared-chart-selection [PUT]', error);
      }
    }
  );

  app.delete(
    '/api/patients/:patientId/shared-chart-selection',
    portalActionLimiter,
    noStoreDynamicResponse,
    checkAuth,
    requireAnyClinicCapability('reports.clinical.indicators', 'aba.analytics.view'),
    checkSharedChartProfessionalPatientScope,
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
        const clinicId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        if (![patientId, clinicId, actorId].every(isUuid)) {
          return res.status(400).json({ success: false, error: 'SHARED_CHART_SCOPE_INVALID' });
        }
        if (req.sharedChartCaseAuthority?.canPublish !== true) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_CASE_PUBLISH_DENIED' });
        }
        const { data, error } = await supabase.rpc('clear_patient_shared_chart_selection_v2', {
          p_actor_id: actorId,
          p_clinic_id: clinicId,
          p_patient_id: patientId,
        });
        if (error) throw error;
        return res.json({ success: true, cleared: data === true });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/patients/:patientId/shared-chart-selection [DELETE]', error);
      }
    }
  );

  // Readonly case delegation list; fetched only on explicit management action.
  app.get(
    '/api/patients/:patientId/shared-chart/delegations',
    noStoreDynamicResponse,
    checkAuth,
    requireAnyClinicCapability('reports.clinical.indicators', 'aba.analytics.view'),
    checkSharedChartProfessionalPatientScope,
    async (req: any, res) => {
      try {
        const clinicId = sanitizeString(req.resolvedPatientClinicId, 120);
        const patientId = sanitizeString(req.resolvedPatientId, 120);
        if (req.sharedChartCaseAuthority?.canDelegate !== true) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_CASE_LEAD_REQUIRED' });
        }
        const links = await supabase.from('patient_professional_links')
          .select('professional_id').eq('organization_id', clinicId)
          .eq('patient_id', patientId).eq('status', 'active').limit(100);
        if (links.error) throw links.error;
        const ids = Array.from(new Set((links.data || [])
          .map((row: any) => sanitizeString(row.professional_id, 120)).filter(isUuid))) as string[];
        if (!ids.length) return res.json({ success: true, data: [] });
        const [members, profiles, grants] = await Promise.all([
          supabase.from('clinic_memberships').select('user_id,role')
            .eq('clinic_id',clinicId).eq('status','active').in('user_id',ids).limit(100),
          supabase.from('professional_profiles').select('user_id,full_name').in('user_id',ids).limit(100),
          supabase.from('patient_shared_graph_delegations').select('professional_user_id,revoked_at')
            .eq('clinic_id',clinicId).eq('patient_id',patientId)
            .in('professional_user_id',ids).limit(100),
        ]);
        if (members.error || profiles.error || grants.error) throw members.error || profiles.error || grants.error;
        const names = new Map((profiles.data || []).map((p: any) => [p.user_id, sanitizeTextField(p.full_name, 120)]));
        const activeGrants = new Set((grants.data || []).filter((g: any) => !g.revoked_at).map((g: any) => g.professional_user_id));
        const people = (members.data || [])
          .filter((m: any) => ['therapist','supervisor'].includes(String(m.role || '').toLowerCase()))
          .map((m: any) => ({
            id: m.user_id, name: names.get(m.user_id) || 'Profissional',
            delegated: activeGrants.has(m.user_id),
          }));
        return res.json({ success: true, data: people });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/patients/:patientId/shared-chart/delegations [GET]', error);
      }
    }
  );

  app.post(
    '/api/patients/:patientId/shared-chart/delegations',
    portalActionLimiter,
    noStoreDynamicResponse,
    checkAuth,
    requireAnyClinicCapability('reports.clinical.indicators', 'aba.analytics.view'),
    checkSharedChartProfessionalPatientScope,
    async (req: any, res) => {
      try {
        if (!enforcePayloadLimit(req, res, 2048, 'Autorização de gráfico por caso')) return;
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        const clinicId = sanitizeString(req.resolvedPatientClinicId, 120);
        const patientId = sanitizeString(req.resolvedPatientId, 120);
        const professionalId = sanitizeString(req.body?.professionalId, 120);
        const allow = req.body?.allow;
        if (!isUuid(professionalId) || typeof allow !== 'boolean') {
          return res.status(400).json({ success: false, error: 'SHARED_CHART_DELEGATION_INVALID' });
        }
        if (req.sharedChartCaseAuthority?.canDelegate !== true) {
          return res.status(403).json({ success: false, error: 'SHARED_CHART_CASE_LEAD_REQUIRED' });
        }
        const result = await supabase.rpc('set_patient_shared_chart_case_delegation_v2', {
          p_actor_id: actorId, p_clinic_id: clinicId, p_patient_id: patientId,
          p_professional_id: professionalId, p_allow: allow,
        });
        if (result.error) throw result.error;
        return res.json({ success: result.data === true });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/patients/:patientId/shared-chart/delegations [POST]', error);
      }
    }
  );

  app.get(
    '/api/portal/patients/:patientId/shared-chart',
    noStoreDynamicResponse,
    checkAuth,
    requirePatientSharedChartPortalScope,
    async (req: any, res) => {
      try {
        const context = req.portalContext;
        const requestedPatientId = sanitizeString(req.params.patientId, 120);
        const allowedPatientIds = new Set(
          (Array.isArray(context?.patientIds) ? context.patientIds : [])
            .map((id: any) => sanitizeString(id, 120))
            .filter(Boolean)
        );
        const patientId = allowedPatientIds.has(requestedPatientId)
          ? requestedPatientId
          : sanitizeString(context?.resolvedPatientId, 120);
        const clinicId = sanitizeString(context?.clinicId, 120);
        if (!isUuid(patientId) || !isUuid(clinicId) || !allowedPatientIds.has(patientId)) {
          return res.status(403).json({ success: false, error: 'PORTAL_PATIENT_SCOPE_DENIED' });
        }

        const row = await readSharedChartSelection(clinicId, patientId);
        if (!row) return res.json({ success: true, data: null });
        // A shared identity is not authorization to view another clinic's chart.
        // The canonical verified-ID registry is checked only when available.
        const globalId = sanitizeString(context?.globalPatientIdentityId, 120);
        if (isUuid(globalId)) {
          const global = await supabase.from('patient_shared_graph_publications')
            .select('clinic_id,patient_id,graph_type,graph_key,status')
            .eq('global_patient_identity_id',globalId).limit(1).maybeSingle();
          if (global.error) throw global.error;
          const item = global.data;
          if (!item || item.status !== 'ACTIVE' || item.clinic_id !== clinicId
              || item.patient_id !== patientId || item.graph_type !== row.chart_family
              || item.graph_key !== row.chart_key) {
            return res.json({ success: true, data: null });
          }
        }
        const descriptor = normalizeSharedChartDescriptor(row.chart_reference);
        if (!descriptor || descriptor.family !== sanitizeString(row.chart_family, 32).toUpperCase()) {
          return res.json({ success: true, data: null });
        }
        const projection = await resolveSharedChartProjection({ clinicId, patientId, descriptor });
        if (!projection) return res.json({ success: true, data: null });
        return res.json({
          success: true,
          data: {
            chartKey: sanitizeString(row.chart_key, 256),
            referenceVersion: Number(row.reference_version || descriptor.schemaVersion),
            ...projection,
          },
        });
      } catch (error: any) {
        return sendRouteDbError(res, '/api/portal/patients/:patientId/shared-chart [GET]', error, {
          requestId: requestIdForLogs(req),
          patientId: sanitizeString(req.params.patientId, 120),
        });
      }
    }
  );


}
