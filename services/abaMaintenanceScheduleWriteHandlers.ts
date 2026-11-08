// ABA-M12: extract only the two existing maintenance schedule write handlers.
// Express middleware and registration order remain in server.ts; runtime dependencies are lazy.

export function createAbaMaintenanceScheduleWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, supabase, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, createMaintenanceScheduleForTarget, readMaintenanceStoredPayload, sanitizePeiLocalIdentifier, cleanObject, logRouteDbError } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload de agendamento de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const targetId = sanitizeString(req.params.targetId, 180);
      const bodyTargetId = sanitizeString(req.body?.targetId || req.body?.target_id, 180);
      let patientId = sanitizeString(req.body?.patient_id || req.body?.patientId, 120);
      if (!isUuid(targetId)) {
        return res.status(400).json({ success: false, error: 'MISSING_TARGET_ID', message: 'Não foi possível identificar a habilidade.' });
      }
      if (bodyTargetId && bodyTargetId !== targetId) {
        return res.status(400).json({ success: false, error: 'TARGET_ID_MISMATCH', message: 'Não foi possível identificar a habilidade.' });
      }
      if (!patientId && targetId) {
        let targetQuery = supabase
          .from('aba_targets')
          .select('id,clinic_id,patient_id,organization_id')
          .eq('id', targetId)
          .limit(1);
        targetQuery = applyAbaTenantScope(targetQuery, req.session.user, clinicId, organizationId);
        const targetResult = await targetQuery.maybeSingle();
        if (targetResult.error && !hasMissingFinancialSchema(targetResult.error)) throw targetResult.error;
        patientId = sanitizeString(targetResult.data?.patient_id, 120);
      }
      if (!isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Paciente fora do escopo da clínica.' });
      }
      const requestedMode = sanitizeString(req.body?.mode, 80).toUpperCase();
      if (requestedMode && requestedMode !== 'DATE' && requestedMode !== 'NEXT_SESSION' && requestedMode !== 'APPOINTMENT') {
        return res.status(400).json({ success: false, error: 'INVALID_MODE', message: 'Modo de agendamento inválido.' });
      }
      const scheduleModeFromPayload = requestedMode === 'DATE'
        ? 'CUSTOM_DATE'
        : requestedMode === 'APPOINTMENT'
          ? 'CUSTOM_DATE'
        : requestedMode === 'NEXT_SESSION'
          ? 'NEXT_PATIENT_SESSION'
          : (req.body?.scheduleMode || req.body?.schedule_mode);
      const dueDate = req.body?.dueDate || req.body?.due_date || null;
      const appointmentIdFromPayload = req.body?.appointmentId || req.body?.appointment_id || null;
      if (requestedMode === 'APPOINTMENT' && !sanitizeString(appointmentIdFromPayload, 180)) {
        return res.status(400).json({ success: false, error: 'MISSING_APPOINTMENT_ID', message: 'Escolha uma sessão para vincular a sondagem.' });
      }
      const customDateOrAppointmentMode = requestedMode === 'DATE' || requestedMode === 'APPOINTMENT' || sanitizeString(scheduleModeFromPayload, 80).toUpperCase() === 'CUSTOM_DATE';
      if (customDateOrAppointmentMode && !sanitizeString(dueDate, 80) && !sanitizeString(appointmentIdFromPayload, 180)) {
        return res.status(400).json({ success: false, error: 'MISSING_DUE_DATE', message: 'Escolha uma data para agendar a sondagem.' });
      }
      const result = await createMaintenanceScheduleForTarget({
        targetId,
        patientId,
        organizationId,
        clinicId,
        scheduleMode: scheduleModeFromPayload,
        dueDate,
        appointmentId: appointmentIdFromPayload,
        targetName: req.body?.targetName || req.body?.target_name || req.body?.name,
        protocolName: req.body?.protocolName || req.body?.protocol_name || req.body?.protocol,
        domainName: req.body?.domainName || req.body?.domain_name || req.body?.domain,
        description: req.body?.description,
        intervals: req.body?.intervals || req.body?.maintenanceDays || req.body?.maintenance_days,
        createdBy: sanitizeString(req.session.user?.id, 120),
        masteryEvaluationId: req.body?.masteryEvaluationId || req.body?.mastery_evaluation_id,
        peiGoalId: req.body?.peiGoalId || req.body?.goalId || req.body?.goal_id,
        skillId: req.body?.skillId || req.body?.skill_id,
        localTargetRef: req.body?.localTargetRef || req.body?.local_target_ref,
        approvedAt: req.body?.approvedAt || req.body?.approved_at
      });
      if (!result.ok) {
        const resultMessage = sanitizeString((result as any).error, 240);
        const errorCode = resultMessage.includes('Sessão') || resultMessage.includes('Consulta')
          ? 'APPOINTMENT_NOT_FOUND'
          : (result as any).status === 404
            ? 'TARGET_NOT_FOUND'
            : (result as any).status === 409
              ? 'MAINTENANCE_SCHEDULE_CONFLICT'
              : (result as any).status === 400
                ? 'ID_INVALIDO'
                : 'UNEXPECTED_ERROR';
        return res.status((result as any).status || 400).json({ success: false, error: errorCode, message: resultMessage || 'Não foi possível agendar a manutenção.' });
      }
      const schedules = Array.isArray(result.data) ? result.data : [];
      const hydrateScheduleResponse = (schedule: any) => {
        if (!schedule) return null;
        const raw = readMaintenanceStoredPayload(schedule?.raw_payload || schedule?.rawPayload);
        const target = schedule?.target && typeof schedule.target === 'object' ? schedule.target : {};
        const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
        const peiGoalId = sanitizePeiLocalIdentifier(schedule?.peiGoalId || schedule?.goalId || schedule?.goal_id || masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id || raw.peiGoalId || raw.pei_goal_id || raw.goalId || raw.goal_id || req.body?.peiGoalId || req.body?.goalId || req.body?.goal_id, 180);
        const skillId = sanitizePeiLocalIdentifier(schedule?.skillId || schedule?.skill_id || masteryCriteria?.skillId || masteryCriteria?.skill_id || raw.skillId || raw.skill_id || req.body?.skillId || req.body?.skill_id, 180);
        const localTargetRef = sanitizePeiLocalIdentifier(schedule?.localTargetRef || masteryCriteria?.localTargetRef || masteryCriteria?.local_target_ref || raw.localTargetRef || raw.local_target_ref || req.body?.localTargetRef || peiGoalId, 180);
        const clinicalIdentitySource = sanitizeString(schedule?.clinicalIdentitySource || masteryCriteria?.source || raw.clinicalIdentitySource || raw.source, 120);
        const scheduleId = sanitizeString(schedule?.id || schedule?.schedule_id || schedule?.scheduleId, 180);
        return cleanObject({
          id: scheduleId || null,
          scheduleId: scheduleId || null,
          persisted: Boolean(scheduleId),
          hasRealSchedule: Boolean(scheduleId),
          targetId,
          status: sanitizeString(schedule?.status, 80) || null,
          dueDate: schedule?.target_due_date || schedule?.targetDueDate || schedule?.due_date || schedule?.dueDate || null,
          due_date: schedule?.due_date || schedule?.dueDate || null,
          target_due_date: schedule?.target_due_date || schedule?.targetDueDate || null,
          scheduled_for: schedule?.scheduled_for || schedule?.scheduledFor || null,
          scheduledFor: schedule?.scheduled_for || schedule?.scheduledFor || null,
          scheduleMode: sanitizeString(schedule?.schedule_mode || schedule?.scheduleMode, 80) || null,
          appointmentId: schedule?.appointment_id || schedule?.appointmentId || null,
          candidateAppointmentId: schedule?.candidate_appointment_id || schedule?.candidateAppointmentId || null,
          targetName: sanitizeString(schedule?.targetName || schedule?.target_name || target?.name || raw.targetName, 240) || null,
          protocolName: sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || target?.protocol_title || raw.protocolTitle, 240) || null,
          domainName: sanitizeString(schedule?.domainName || schedule?.domain_name || target?.domain_name || raw.domainName, 240) || null,
          peiGoalId: peiGoalId || null,
          goalId: peiGoalId || null,
          goal_id: peiGoalId || null,
          skillId: skillId || null,
          skill_id: skillId || null,
          localTargetRef: localTargetRef || null,
          clinicalIdentitySource: clinicalIdentitySource || null
        });
      };
      const schedule = hydrateScheduleResponse(schedules[0] || null);
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[pei-maintenance-schedule]', {
          scheduleRequestTargetId: targetId,
          persistedScheduleTargetId: schedule?.targetId || null,
          scheduleId: schedule?.id || null,
          status: schedule?.status || null
        });
      }
      if (!schedule?.id || schedule?.targetId !== targetId) {
        return res.status(500).json({
          success: false,
          error: 'PERSISTENCE_NOT_CONFIRMED',
          message: 'Não foi possível confirmar a persistência do agendamento.'
        });
      }
      return res.json({ success: true, message: 'Sondagem de manutenção agendada.', schedule, data: schedule ? [schedule] : [] });
    } catch (error: any) {
      logRouteDbError('/api/aba/targets/:targetId/maintenance-schedules', error, {
        targetId: sanitizeString(req.params?.targetId, 180),
        bodyTargetId: sanitizeString(req.body?.targetId || req.body?.target_id, 180),
        patientId: sanitizeString(req.body?.patient_id || req.body?.patientId, 120),
        mode: sanitizeString(req.body?.mode || req.body?.scheduleMode || req.body?.schedule_mode, 80)
      });
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível agendar a manutenção.' });
    }
  };
}

export function createAbaMaintenanceNextSessionWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, canAccessPatientInCurrentClinic, createMaintenanceScheduleForTarget } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de agendamento para futura sessão')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const patientId = sanitizeString(req.body?.patient_id || req.body?.patientId, 120);
      const targetId = sanitizeString(req.params.targetId, 180);
      if (!isUuid(targetId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Habilidade inválida para agendamento de manutenção.' });
      }
      if (!isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Paciente fora do escopo da clínica.' });
      }
      const result = await createMaintenanceScheduleForTarget({
        targetId,
        patientId,
        organizationId,
        clinicId,
        scheduleMode: 'NEXT_PATIENT_SESSION',
        createdBy: sanitizeString(req.session.user?.id, 120),
        masteryEvaluationId: req.body?.masteryEvaluationId || req.body?.mastery_evaluation_id,
        peiGoalId: req.body?.peiGoalId || req.body?.goalId || req.body?.goal_id,
        skillId: req.body?.skillId || req.body?.skill_id,
        localTargetRef: req.body?.localTargetRef || req.body?.local_target_ref
      });
      if (!result.ok) return res.status((result as any).status || 400).json({ success: false, error: (result as any).status === 404 ? 'TARGET_NOT_FOUND' : (result as any).status === 400 ? 'ID_INVALIDO' : 'UNEXPECTED_ERROR', message: (result as any).error || 'Não foi possível aguardar futura sessão.', data: (result as any).data || [] });
      const schedules = Array.isArray(result.data) ? result.data : [];
      return res.json({ success: true, message: 'Sondagem aguardando futura sessão.', schedule: schedules[0] || null, data: schedules });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível aguardar futura sessão.' });
    }
  };
}
