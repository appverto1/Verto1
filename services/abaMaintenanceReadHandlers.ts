// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createSessionMaintenanceProbesReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; isUuid: any; resolveAbaSessionReadScope: any; currentClinicId: any; dateKeyInMaintenanceTimeZone: any; supabase: any; ABA_MAINTENANCE_SCHEDULE_SELECT: any; ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES: any; applyAbaTenantScope: any; hasMissingFinancialSchema: any; isMissingRelationError: any; enrichMaintenanceRowsWithTargetDisplay: any; hasPersistedMaintenanceScheduleId: any; cleanObject: any; validateAbaSessionTargetPlanScope: any; resolveMaintenanceProbeAvailability: any; readMaintenanceStoredPayload: any }) {
  return async (req: any, res) => {
    const { sanitizeString, isUuid, resolveAbaSessionReadScope, currentClinicId, dateKeyInMaintenanceTimeZone, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES, applyAbaTenantScope, hasMissingFinancialSchema, isMissingRelationError, enrichMaintenanceRowsWithTargetDisplay, hasPersistedMaintenanceScheduleId, cleanObject, validateAbaSessionTargetPlanScope, resolveMaintenanceProbeAvailability, readMaintenanceStoredPayload } = getDeps();
    try {
      const requestedSessionId = sanitizeString(req.params.sessionId, 180);
      if (!isUuid(requestedSessionId)) {
        return res.status(400).json({ success: false, error: 'INVALID_SESSION_ID', message: 'Sessão ABA inválida.' });
      }
      const scope = await resolveAbaSessionReadScope(requestedSessionId, req.session.user);
      if (!scope.ok) return res.status((scope as any).status || 400).json({ success: false, error: (scope as any).error });
      const session = (scope as any).session || {};
      const patientId = sanitizeString((scope as any).patientId, 120);
      const clinicId = sanitizeString((scope as any).clinicId || currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const requestedAppointmentId = sanitizeString(req.query?.appointmentId || req.query?.appointment_id, 180);
      const sessionAppointmentId = sanitizeString(session?.appointment_id, 180);
      const activeAppointmentId = isUuid(requestedAppointmentId) ? requestedAppointmentId : sessionAppointmentId;
      const timeZone = sanitizeString(req.query?.timeZone || req.query?.timezone || req.session.user?.timeZone || req.session.user?.timezone || 'America/Sao_Paulo', 80) || 'America/Sao_Paulo';
      const sessionClinicalDate = req.query?.clinicalDate ||
        req.query?.clinical_date ||
        session?.reference_date ||
        session?.scheduled_start_at ||
        session?.actual_start_at ||
        session?.started_at ||
        session?.created_at ||
        new Date().toISOString();
      const sessionClinicalDateKey = dateKeyInMaintenanceTimeZone(sessionClinicalDate as any, timeZone);

      let scheduleQuery = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
        .order('target_due_date', { ascending: true })
        .limit(100);
      scheduleQuery = applyAbaTenantScope(scheduleQuery, req.session.user, clinicId, organizationId);
      const scheduleResult = await scheduleQuery;
      if (scheduleResult.error) {
        if (hasMissingFinancialSchema(scheduleResult.error) || isMissingRelationError(scheduleResult.error)) {
          return res.json({ success: true, data: { available: [], upcoming: [] }, available: [], upcoming: [] });
        }
        throw scheduleResult.error;
      }

      let appointmentScheduleRows: any[] = [];
      if (isUuid(activeAppointmentId)) {
        let appointmentScheduleQuery = supabase
          .from('aba_maintenance_schedules')
          .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .eq('appointment_id', activeAppointmentId)
          .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
          .order('target_due_date', { ascending: true })
          .limit(100);
        appointmentScheduleQuery = applyAbaTenantScope(appointmentScheduleQuery, req.session.user, clinicId, organizationId);
        const appointmentScheduleResult = await appointmentScheduleQuery;
        if (appointmentScheduleResult.error) {
          if (!hasMissingFinancialSchema(appointmentScheduleResult.error) && !isMissingRelationError(appointmentScheduleResult.error)) {
            throw appointmentScheduleResult.error;
          }
        } else {
          appointmentScheduleRows = Array.isArray(appointmentScheduleResult.data) ? appointmentScheduleResult.data : [];
        }
      }

      const scheduleRowsById = new Map<string, any>();
      [...appointmentScheduleRows, ...((scheduleResult.data || []) as any[])].forEach((row: any) => {
        const scheduleId = sanitizeString(row?.id || row?.schedule_id || row?.scheduleId, 180);
        if (!scheduleId) return;
        if (!scheduleRowsById.has(scheduleId)) scheduleRowsById.set(scheduleId, row);
      });
      const enrichedSchedules = await enrichMaintenanceRowsWithTargetDisplay(Array.from(scheduleRowsById.values()), clinicId, organizationId, req.session.user);
      const filteredOutReasons: Record<string, number> = {};
      const trackFilteredOut = (reason: string) => {
        filteredOutReasons[reason] = (filteredOutReasons[reason] || 0) + 1;
      };
      const realTargetSchedules = (Array.isArray(enrichedSchedules) ? enrichedSchedules : []).filter((schedule: any) => {
        const scheduleId = sanitizeString(schedule?.id || schedule?.schedule_id || schedule?.scheduleId, 180);
        const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
        const targetPatientId = sanitizeString(schedule?.target?.patient_id || schedule?.target?.patientId, 120);
        const appointmentId = sanitizeString(schedule?.appointment_id || schedule?.appointmentId, 180);
        const appointmentPatientId = sanitizeString(schedule?.appointment?.patient_id || schedule?.appointment?.patientId, 120);
        if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
          trackFilteredOut('missing_schedule');
          return false;
        }
        if (!isUuid(targetId) || schedule?.target_missing || !schedule?.target?.id) {
          trackFilteredOut('missing_target');
          return false;
        }
        if (appointmentId && schedule?.appointment?.id && appointmentPatientId && appointmentPatientId !== patientId) {
          trackFilteredOut('patient_mismatch');
          return false;
        }
        if (targetPatientId && targetPatientId !== patientId) {
          trackFilteredOut('patient_mismatch');
          return false;
        }
        return true;
      }).map((schedule: any) => {
        const appointmentId = sanitizeString(schedule?.appointment_id || schedule?.appointmentId, 180);
        const appointment = appointmentId ? schedule?.appointment || null : null;
        const linkedToActiveAppointment = Boolean(isUuid(activeAppointmentId) && appointmentId === activeAppointmentId);
        const missingLinkedAppointment = Boolean(appointmentId && !appointment?.id && !linkedToActiveAppointment);
        return cleanObject({
          ...schedule,
          appointment_status: missingLinkedAppointment
            ? 'cancelled'
            : (appointment?.status || appointment?.appointment_status || appointment?.recurrence_instance_status || schedule?.appointment_status || schedule?.appointmentStatus || null),
          appointmentStatus: missingLinkedAppointment
            ? 'cancelled'
            : (appointment?.status || appointment?.appointment_status || appointment?.recurrence_instance_status || schedule?.appointmentStatus || schedule?.appointment_status || null)
        });
      });

      const sessionTherapeuticPlanId = sanitizeString(session?.therapeutic_plan_id, 120);
      let sessionScopedTargetSchedules = realTargetSchedules;
      if (sessionTherapeuticPlanId && realTargetSchedules.length > 0) {
        const targetScope = await validateAbaSessionTargetPlanScope({
          organizationId,
          patientId,
          therapeuticPlanId: sessionTherapeuticPlanId,
          targetIds: realTargetSchedules
            .map((schedule: any) => sanitizeString(schedule?.target_id || schedule?.targetId, 180))
            .filter(Boolean),
        });
        const conflictingTargetIds = new Set(targetScope.conflictingTargetIds || []);
        if (conflictingTargetIds.size > 0) {
          sessionScopedTargetSchedules = realTargetSchedules.filter((schedule: any) => {
            const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
            if (!conflictingTargetIds.has(targetId)) return true;
            trackFilteredOut('different_specialty_plan');
            return false;
          });
        }
      }

      const availability = resolveMaintenanceProbeAvailability(sessionScopedTargetSchedules, {
        appointmentId: isUuid(activeAppointmentId) ? activeAppointmentId : null,
        sessionId: requestedSessionId,
        sessionClinicalDate: sessionClinicalDateKey,
        occurredAt: session?.actual_start_at || session?.started_at || new Date().toISOString(),
        timeZone
      });

      const availabilityReasonForResponse = (item: any) => {
        const schedule = item?.schedule || {};
        const reason = sanitizeString(item?.reason, 80) || 'UPCOMING_OR_DIFFERENT_SESSION';
        if (reason !== 'UPCOMING_OR_DIFFERENT_SESSION') return reason;
        const appointmentId = sanitizeString(schedule?.appointment_id || schedule?.appointmentId, 180);
        if (appointmentId) return 'FUTURE_APPOINTMENT';
        const referenceDate = schedule?.target_due_date || schedule?.targetDueDate || schedule?.due_date || schedule?.dueDate || schedule?.scheduled_for || schedule?.scheduledFor || item?.referenceDate || null;
        return referenceDate ? 'FUTURE_DATE' : 'NOT_AVAILABLE_IN_SESSION';
      };

      const itemForResponse = (item: any, reason: string) => {
        const schedule = item?.schedule || item || {};
        const target = schedule?.target || {};
        const appointment = schedule?.appointment || null;
        const scheduleId = sanitizeString(schedule?.id || schedule?.schedule_id || schedule?.scheduleId, 180);
        const targetId = sanitizeString(schedule?.target_id || schedule?.targetId || target?.id, 180);
        if (!hasPersistedMaintenanceScheduleId(scheduleId) || !isUuid(targetId)) return null;
        return cleanObject({
          scheduleId,
          targetId,
          targetName: sanitizeString(schedule?.targetName || schedule?.target_name || target?.name, 240) || 'Habilidade em manutenção',
          protocolName: sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || target?.protocol_title, 240) || null,
          domainName: sanitizeString(schedule?.domainName || schedule?.domain_name || target?.domain_name, 240) || null,
          dueDate: schedule?.target_due_date || schedule?.targetDueDate || schedule?.due_date || schedule?.dueDate || schedule?.scheduled_for || schedule?.scheduledFor || null,
          appointmentId: schedule?.appointment_id || schedule?.appointmentId || null,
          appointmentStartAt: appointment?.scheduled_at || appointment?.scheduled_start_at || schedule?.scheduled_for || schedule?.scheduledFor || null,
          status: sanitizeString(schedule?.status, 80) || null,
          availabilityReason: reason
        });
      };

      const available = availability.availableItems
        .filter((item) => !item.blockedAppointmentStatus)
        .map((item) => itemForResponse(item, availabilityReasonForResponse(item)))
        .filter(Boolean);
      const upcoming = availability.upcomingItems
        .map((item) => itemForResponse(item, availabilityReasonForResponse(item)))
        .filter(Boolean);
      const diagnostics = cleanObject({
        resultCount: available.length + upcoming.length,
        appointmentScheduleCount: appointmentScheduleRows.length,
        sessionScheduleCount: sessionScopedTargetSchedules.filter((schedule: any) => (
          sanitizeString(schedule?.session_id || schedule?.sessionId || readMaintenanceStoredPayload(schedule?.raw_payload || schedule?.rawPayload)?.sessionId || '', 180) === requestedSessionId
        )).length,
        filteredOutCount: Object.values(filteredOutReasons).reduce((total, count) => total + count, 0),
        filteredOutReasons,
        appointmentLookupUsed: isUuid(activeAppointmentId),
        appointmentIdPresent: isUuid(activeAppointmentId)
      });
      return res.json({
        success: true,
        data: { available, upcoming, diagnostics },
        available,
        upcoming,
        diagnostics,
        session: cleanObject({
          id: requestedSessionId,
          patientId,
          appointmentId: isUuid(activeAppointmentId) ? activeAppointmentId : null,
          clinicalDate: sessionClinicalDateKey,
          timeZone
        })
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: error?.message || 'Não foi possível carregar Maintenance Probes desta sessão.' });
    }
  };
}

export function createMaintenanceOverviewReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; hasGlobalClinicAccess: any; supabase: any; ABA_MAINTENANCE_SCHEDULE_SELECT: any; ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES: any; ABA_MAINTENANCE_PROBE_RESULT_SELECT: any; ABA_REGRESSION_ALERT_SELECT: any; ABA_PATIENT_SUMMARY_SELECT: any; hasMissingFinancialSchema: any; enrichMaintenanceRowsWithTargetDisplay: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, hasGlobalClinicAccess, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_PATIENT_SUMMARY_SELECT, hasMissingFinancialSchema, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: { schedules: [], probeResults: [], alerts: [], summary: null } });
      const appointmentId = isUuid(sanitizeString(req.query?.appointmentId || req.query?.appointment_id, 180))
        ? sanitizeString(req.query?.appointmentId || req.query?.appointment_id, 180)
        : '';
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      const applyClinic = (query: any) => {
        let scoped = organizationId ? query.eq('organization_id', organizationId) : query;
        return !hasGlobalClinicAccess(req.session.user) && clinicId ? scoped.eq('clinic_id', clinicId) : scoped;
      };
      const [scheduleResult, probeResult, alertResult, summaryResult] = await Promise.all([
        applyClinic(
          supabase
            .from('aba_maintenance_schedules')
            .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
            .eq('patient_id', patientId)
            .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
            .order('updated_at', { ascending: false })
            .range(from, to)
        ),
        applyClinic(
          supabase
            .from('aba_maintenance_probe_results')
            .select(ABA_MAINTENANCE_PROBE_RESULT_SELECT)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .range(from, to)
        ),
        applyClinic(
          supabase
            .from('aba_regression_alerts')
            .select(ABA_REGRESSION_ALERT_SELECT)
            .eq('patient_id', patientId)
            .is('resolved_at', null)
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        applyClinic(
          supabase
            .from('aba_patient_aba_summaries')
            .select(ABA_PATIENT_SUMMARY_SELECT)
            .eq('patient_id', patientId)
            .limit(1)
        ).maybeSingle()
      ]);
      const firstError = [scheduleResult, probeResult, alertResult, summaryResult].find((result: any) => result.error)?.error;
      if (firstError) {
        if (hasMissingFinancialSchema(firstError)) {
          return res.json({ success: true, data: { schedules: [], probeResults: [], alerts: [], summary: null }, page, pageSize });
        }
        throw firstError;
      }
      let schedules = (scheduleResult as any).data || [];
      if (appointmentId) {
        let linkedScheduleQuery = supabase
          .from('aba_maintenance_schedules')
          .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
          .eq('patient_id', patientId)
          .eq('appointment_id', appointmentId)
          .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
          .order('target_due_date', { ascending: true })
          .limit(20);
        linkedScheduleQuery = applyClinic(linkedScheduleQuery);
        const linkedScheduleResult = await linkedScheduleQuery;
        if (!linkedScheduleResult.error) {
          const byId = new Map<string, any>();
          [...(linkedScheduleResult.data || []), ...schedules].forEach((row: any) => {
            const id = sanitizeString(row?.id, 180);
            if (id) byId.set(id, row);
          });
          schedules = Array.from(byId.values()).slice(0, pageSize);
        } else if (!hasMissingFinancialSchema(linkedScheduleResult.error)) {
          throw linkedScheduleResult.error;
        }
      }
      const [enrichedSchedules, enrichedProbeResults, enrichedAlerts] = await Promise.all([
        enrichMaintenanceRowsWithTargetDisplay(schedules, clinicId, organizationId, req.session.user),
        enrichMaintenanceRowsWithTargetDisplay((probeResult as any).data || [], clinicId, organizationId, req.session.user),
        enrichMaintenanceRowsWithTargetDisplay((alertResult as any).data || [], clinicId, organizationId, req.session.user)
      ]);
      return res.json({
        success: true,
        data: {
          schedules: enrichedSchedules,
          probeResults: enrichedProbeResults,
          alerts: enrichedAlerts,
          summary: (summaryResult as any).data || null
        },
        page,
        pageSize
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}

export function createPeiMaintenanceDiagnosticsHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; getPatientPeiTargets: any; hasGlobalClinicAccess: any; supabase: any; ABA_TARGET_RECOMMENDATION_SELECT: any; isMaintenanceEligibleAbaTarget: any; readPatientRecordPayloadForFiles: any; parsePatientPeiArray: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, getPatientPeiTargets, hasGlobalClinicAccess, supabase, ABA_TARGET_RECOMMENDATION_SELECT, isMaintenanceEligibleAbaTarget, readPatientRecordPayloadForFiles, parsePatientPeiArray } = getDeps();
    try {
      // Endpoint de debug para investigar por que habilidades não aparecem como elegíveis
      // Mostra: PEI goals + ABA targets elegíveis
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Paciente inválido.' });

      // Get PEI targets
      const peiTargets = await getPatientPeiTargets(patientId, clinicId, organizationId, req.session.user);
      
      // Get ABA targets (para comparar qual é elegível)
      const applyClinic = (query: any) => {
        let scoped = organizationId ? query.eq('organization_id', organizationId) : query;
        return !hasGlobalClinicAccess(req.session.user) && clinicId ? scoped.eq('clinic_id', clinicId) : scoped;
      };
      const targetResult = await applyClinic(
        supabase
          .from('aba_targets')
          .select(ABA_TARGET_RECOMMENDATION_SELECT)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(200)
      );
      const allAbaTargets = targetResult.error ? [] : (targetResult.data || []);
      const abaTargetsEligible = allAbaTargets.filter(isMaintenanceEligibleAbaTarget);
      
      // Get raw data for detailed view
      const record = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
      const rawPeiGoals = parsePatientPeiArray(record?.payload || {});
      
      const peiDetails = peiTargets.map((target: any, idx: number) => {
        const rawGoal = rawPeiGoals[idx] || {};
        return {
          targetName: target?.targetName,
          protocolName: target?.protocolName,
          domainName: target?.domainName,
          eligibleForMaintenance: target?.eligibleForMaintenance,
          progressPercent: target?.progressPercent,
          clinicalStatus: target?.clinicalStatus,
          masteryStatus: target?.masteryStatus,
          peiGoalId: target?.peiGoalId,
          source: 'pei'
        };
      });

      const abaDetails = abaTargetsEligible.map((target: any) => ({
        targetName: target?.name || target?.description,
        protocolName: target?.protocol_title,
        domainName: target?.domain_name,
        eligibleForMaintenance: true,
        progressPercent: 100,
        clinicalStatus: target?.clinical_status || target?.phase,
        masteryStatus: target?.mastery_status,
        targetId: target?.id,
        source: 'aba'
      }));

      return res.json({
        success: true,
        data: {
          patientId,
          pei: {
            totalGoals: peiTargets.length,
            eligibleCount: peiTargets.filter((t: any) => t?.eligibleForMaintenance).length,
            goals: peiDetails
          },
          aba: {
            totalTargets: allAbaTargets.length,
            eligibleCount: abaTargetsEligible.length,
            targets: abaDetails
          },
          summary: {
            totalEligible: peiDetails.filter((g: any) => g.eligibleForMaintenance).length + abaDetails.length,
            fromPei: peiDetails.filter((g: any) => g.eligibleForMaintenance).length,
            fromAba: abaDetails.length
          }
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro ao carregar dados de debug.' });
    }
  };
}

export function createLinkableMaintenanceTargetsHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; supabase: any; ABA_TARGET_RECOMMENDATION_SELECT: any; applyAbaTenantScope: any; hasMissingFinancialSchema: any; getPatientPeiTargets: any; materializePeiTargetsForMaintenance: any; cleanObject: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, ABA_TARGET_RECOMMENDATION_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, getPatientPeiTargets, materializePeiTargetsForMaintenance, cleanObject } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Paciente inválido.' });
      let query = supabase
        .from('aba_targets')
        .select(ABA_TARGET_RECOMMENDATION_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .order('updated_at', { ascending: false })
        .limit(200);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      let targets = Array.isArray(data) ? data : [];
      const peiTargets = await getPatientPeiTargets(patientId, clinicId, organizationId, req.session.user);
      const materializedPeiTargets = await materializePeiTargetsForMaintenance({
        patientId,
        clinicId,
        organizationId,
        sessionUser: req.session.user,
        peiTargets,
        existingTargets: targets
      });
      targets = materializedPeiTargets.targets;
      const rows = targets
        .filter((target: any) => isUuid(sanitizeString(target?.id, 180)))
        .map((target: any) => {
          const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
          const peiGoalId = sanitizeString(masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id, 180);
          const skillId = sanitizeString(masteryCriteria?.skillId || masteryCriteria?.skill_id, 180);
          const localTargetRef = sanitizeString(masteryCriteria?.localTargetRef || masteryCriteria?.local_target_ref || peiGoalId, 180);
          return cleanObject({
            id: sanitizeString(target.id, 180),
            target_id: sanitizeString(target.id, 180),
            targetId: sanitizeString(target.id, 180),
            name: sanitizeString(target.name || target.description, 240) || 'Habilidade sem nome',
            target_name: sanitizeString(target.name || target.description, 240) || 'Habilidade sem nome',
            targetName: sanitizeString(target.name || target.description, 240) || 'Habilidade sem nome',
            protocol_title: sanitizeString(target.protocol_title, 240) || null,
            protocolTitle: sanitizeString(target.protocol_title, 240) || null,
            protocolName: sanitizeString(target.protocol_title, 240) || null,
            domain_name: sanitizeString(target.domain_name, 240) || null,
            domainName: sanitizeString(target.domain_name, 240) || null,
            clinical_status: sanitizeString(target.clinical_status || target.phase || target.target_type, 80) || null,
            clinicalStatus: sanitizeString(target.clinical_status || target.phase || target.target_type, 80) || null,
            masteryStatus: sanitizeString(target.clinical_status, 80).toUpperCase() === 'MASTERED' ? 'MASTERED' : null,
            phase: sanitizeString(target.phase, 80) || null,
            status: sanitizeString(target.clinical_status || target.phase, 80) || null,
            peiGoalId: peiGoalId || null,
            goalId: peiGoalId || null,
            goal_id: peiGoalId || null,
            skillId: skillId || null,
            skill_id: skillId || null,
            localTargetRef: localTargetRef || null,
            updated_at: sanitizeString(target.updated_at, 80) || null
          });
        });
      return res.json({ success: true, data: rows });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível carregar habilidades do PEI agora.' });
    }
  };
}

export function createMaintenanceSchedulesReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaRecordListLimit: any; supabase: any; ABA_MAINTENANCE_SCHEDULE_SELECT: any; normalizeAbaMaintenanceScheduleStatus: any; applyAbaTenantScope: any; hasMissingFinancialSchema: any; enrichMaintenanceRowsWithTargetDisplay: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaRecordListLimit, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, normalizeAbaMaintenanceScheduleStatus, applyAbaTenantScope, hasMissingFinancialSchema, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const limit = parseAbaRecordListLimit(req.query?.limit);
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .order('target_due_date', { ascending: true })
        .limit(limit);
      if (req.query?.status) query = query.eq('status', normalizeAbaMaintenanceScheduleStatus(req.query.status));
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      const enriched = await enrichMaintenanceRowsWithTargetDisplay(data || [], clinicId, organizationId, req.session.user);
      return res.json({ success: true, data: enriched });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível carregar os agendamentos agora.' });
    }
  };
}

export function createFutureMaintenanceAppointmentsHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaRecordListLimit: any; fetchFutureAppointmentsForMaintenance: any; sanitizeIsoDateTime: any; countCalendarMaintenanceProbesByAppointment: any; getMaintenanceAppointmentResponseStatus: any; getMaintenanceAppointmentStatusLabel: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaRecordListLimit, fetchFutureAppointmentsForMaintenance, sanitizeIsoDateTime, countCalendarMaintenanceProbesByAppointment, getMaintenanceAppointmentResponseStatus, getMaintenanceAppointmentStatusLabel } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const limit = parseAbaRecordListLimit(req.query?.limit);
      const appointments = await fetchFutureAppointmentsForMaintenance({
        patientId,
        clinicId,
        organizationId,
        fromIso: req.query?.from ? sanitizeIsoDateTime(req.query.from) : new Date().toISOString(),
        limit: Math.min(20, limit)
      });
      const appointmentIds = appointments.map((item: any) => sanitizeString(item?.id, 180)).filter((id: string) => isUuid(id));
      const counts = await countCalendarMaintenanceProbesByAppointment(appointmentIds, clinicId, organizationId, req.session.user);
      const data = appointments.map((appointment: any) => {
        const rawId = sanitizeString(appointment?.id, 180);
        const id = isUuid(rawId) ? rawId : null;
        const unavailableReason = id ? null : 'Esta recorrência ainda não foi salva como agendamento real. Salve o agendamento antes de vincular manutenção.';
        const countInfo = id ? counts.get(id) : null;
        const totalProbeCount = typeof countInfo === 'object'
          ? Number(countInfo.total || 0)
          : Number(countInfo || 0);
        const appointmentStatus = getMaintenanceAppointmentResponseStatus(appointment);
        const rawAppointmentStatus = sanitizeString(appointment.appointment_status || appointment.appointmentStatus, 80) || null;
        return {
          id,
          appointmentId: id,
          canLinkMaintenance: Boolean(id),
          unavailableReason,
          scheduled_at: appointment.scheduled_at,
          scheduledAt: appointment.scheduled_at,
          scheduled_start_at: appointment.scheduled_start_at || appointment.scheduled_at,
          scheduledStartAt: appointment.scheduled_start_at || appointment.scheduled_at,
          scheduled_end_at: appointment.scheduled_end_at || null,
          scheduledEndAt: appointment.scheduled_end_at || null,
          status: appointmentStatus,
          appointment_status: rawAppointmentStatus || appointmentStatus,
          appointmentStatus,
          recurrence_instance_status: sanitizeString(appointment.recurrence_instance_status || appointment.recurrenceInstanceStatus, 80) || null,
          recurrenceInstanceStatus: sanitizeString(appointment.recurrence_instance_status || appointment.recurrenceInstanceStatus, 80) || null,
          statusLabel: getMaintenanceAppointmentStatusLabel(appointment),
          is_recurring: appointment.is_recurring ?? appointment.isRecurring ?? null,
          isRecurring: appointment.is_recurring ?? appointment.isRecurring ?? null,
          recurrence_id: sanitizeString(appointment.recurrence_id || appointment.recurrenceId, 180) || null,
          recurrenceId: sanitizeString(appointment.recurrence_id || appointment.recurrenceId, 180) || null,
          type: sanitizeString(appointment.service_type || appointment.approach, 120) || 'Sessao',
          durationMinutes: Number(appointment.scheduled_duration_minutes || appointment.duration_minutes || 0) || null,
          duration_minutes: Number(appointment.scheduled_duration_minutes || appointment.duration_minutes || 0) || null,
          therapistName: sanitizeString(appointment.therapist_name, 180) || 'Profissional não definido',
          professionalName: sanitizeString(appointment.professional_name || appointment.therapist_name, 180) || 'Profissional não definido',
          location: sanitizeString(appointment.room_name || appointment.location_type, 180) || 'Local a definir',
          roomName: sanitizeString(appointment.room_name, 180) || null,
          maintenanceProbeCount: totalProbeCount,
          maintenance_probe_count: totalProbeCount
        };
      });
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível carregar próximas sessões agora.' });
    }
  };
}

export function createNextMaintenanceProbeHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; canAccessPatientInCurrentClinic: any; fetchNextMaintenanceProbeForTarget: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, canAccessPatientInCurrentClinic, fetchNextMaintenanceProbeForTarget } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.query?.organizationId || req.query?.organization_id || req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const patientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120);
      const targetId = sanitizeString(req.params.targetId, 180);
      if (!isUuid(targetId)) {
        return res.status(400).json({ success: false, error: 'Identificador inválido.' });
      }
      if (!isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
      }
      const data = await fetchNextMaintenanceProbeForTarget({ targetId, patientId, clinicId, organizationId });
      return res.json({ success: true, data });
    } catch {
      return res.status(500).json({ success: false, error: 'Não foi possível carregar a próxima sondagem agora.' });
    }
  };
}

export function createMaintenanceRecommendationsHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; parseAbaRecordListLimit: any; sanitizeIsoDateTime: any; supabase: any; ABA_CLINICAL_RECOMMENDATION_SELECT: any; hasMissingFinancialSchema: any; isMissingRelationError: any; enrichTherapeuticRecommendationContexts: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, parseAbaRecordListLimit, sanitizeIsoDateTime, supabase, ABA_CLINICAL_RECOMMENDATION_SELECT, hasMissingFinancialSchema, isMissingRelationError, enrichTherapeuticRecommendationContexts } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      const limit = parseAbaRecordListLimit(req.query?.limit);
      const beforeRaw = sanitizeString(req.query?.before, 80);
      const beforeIso = beforeRaw ? sanitizeIsoDateTime(beforeRaw, '') : '';
      let query = supabase
        .from('aba_clinical_recommendations')
        .select(ABA_CLINICAL_RECOMMENDATION_SELECT)
        .eq('organization_id', organizationId)
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .is('canonical_recommendation_id', null)
        .neq('status', 'SUPERSEDED')
        .in('status', ['SUGGESTED', 'ACCEPTED', 'EDITED', 'REJECTED', 'APPLIED_TO_NEXT_SESSION', 'EXPIRED'])
        .order('created_at', { ascending: false })
        .limit(limit + 1);
      if (beforeIso) query = query.lt('created_at', beforeIso);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return res.status(503).json({ success: false, error: 'Migration v3 das sugestões clínicas ainda não aplicada.' });
        }
        throw error;
      }
      const pageRows = (data || []).slice(0, limit);
      const hasMore = (data || []).length > limit;
      const enriched = await enrichTherapeuticRecommendationContexts({
        recommendations: pageRows,
        patientId,
        clinicId,
        organizationId
      });
      return res.json({
        success: true,
        data: enriched.rows,
        meta: {
          queryCount: enriched.queryCount + 1,
          batched: true,
          pageSize: pageRows.length,
          consolidatedCount: 0,
          identityVersion: 3,
          hasMore,
          nextCursor: hasMore && pageRows.length ? pageRows[pageRows.length - 1]?.created_at || null : null
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível carregar as sugestões agora.' });
    }
  };
}

export function createMaintenancePlanItemsHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; parseAbaRecordListLimit: any; supabase: any; ABA_NEXT_SESSION_PLAN_ITEM_SELECT: any; normalizeAbaPlanItemStatus: any; applyAbaTenantScope: any; hasMissingFinancialSchema: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, parseAbaRecordListLimit, supabase, ABA_NEXT_SESSION_PLAN_ITEM_SELECT, normalizeAbaPlanItemStatus, applyAbaTenantScope, hasMissingFinancialSchema } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const limit = parseAbaRecordListLimit(req.query?.limit);
      let query = supabase
        .from('aba_next_session_plan_items')
        .select(ABA_NEXT_SESSION_PLAN_ITEM_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .eq('status', normalizeAbaPlanItemStatus(req.query?.status || 'PLANNED'))
        .order('created_at', { ascending: false })
        .limit(limit);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: data || [] });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Não foi possível carregar o plano sugerido agora.' });
    }
  };
}
