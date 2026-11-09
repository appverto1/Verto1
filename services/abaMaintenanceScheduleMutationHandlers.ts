// ABA-M13: extraction of editing, cancellation and completion handlers.
// Keep auth middleware and route order in server.ts; resolve existing dependencies lazily.

export function createAbaMaintenanceScheduleEditHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, isUuid, canAccessPatientInCurrentClinic, ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES, normalizeAbaMaintenanceScheduleStatus, fetchTargetForMaintenance, readMaintenanceStoredPayload, fetchMaintenanceAppointmentById, sanitizeIsoDateTime, cleanObject, sanitizeClinicalPayload, readClinicalDateInput, updateAbaScheduleWithSchemaFallback, isLegacyMaintenanceScheduleConstraintError, buildLegacyMaintenanceScheduleRow, persistActivityLog, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de edição de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Sondagem de manutenção inválida.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .eq('organization_id', organizationId)
        .limit(1);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      const patientId = sanitizeString(schedule?.patient_id, 120);
      const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
      if (!schedule?.id || !isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      if (!ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES.includes(normalizeAbaMaintenanceScheduleStatus(schedule.status))) {
        return res.status(409).json({ success: false, error: 'SCHEDULE_INACTIVE', message: 'Esta sondagem não está ativa.' });
      }
      if (!isUuid(targetId)) {
        return res.status(404).json({ success: false, error: 'TARGET_NOT_FOUND', message: 'Habilidade não encontrada.' });
      }
      const target = await fetchTargetForMaintenance({ targetId, patientId, clinicId: sanitizeString(schedule.clinic_id || clinicId, 120), organizationId: sanitizeString(schedule.organization_id || organizationId, 120) });
      if (!target?.id) {
        return res.status(404).json({ success: false, error: 'TARGET_NOT_FOUND', message: 'Habilidade não encontrada.' });
      }
      const requested = sanitizeString(req.body?.mode || req.body?.scheduleMode || req.body?.schedule_mode, 80).toUpperCase();
      const mode = requested === 'APPOINTMENT'
        ? 'APPOINTMENT'
        : requested === 'NEXT_SESSION' || requested === 'NEXT_PATIENT_SESSION'
          ? 'NEXT_SESSION'
          : requested === 'DATE' || requested === 'CUSTOM_DATE'
            ? 'DATE'
            : '';
      if (!mode) {
        return res.status(400).json({ success: false, error: 'INVALID_MODE', message: 'Modo de agendamento inválido.' });
      }
      const now = new Date().toISOString();
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      let patch: Record<string, any> = {};
      let actionType = 'MAINTENANCE_SCHEDULE_UPDATED';
      let message = 'Agendamento de manutenção atualizado.';
      if (mode === 'APPOINTMENT') {
        const appointmentId = sanitizeString(req.body?.appointmentId || req.body?.appointment_id, 180);
        if (!isUuid(appointmentId)) {
          return res.status(400).json({ success: false, error: 'MISSING_APPOINTMENT_ID', message: 'Escolha uma sessão para vincular a sondagem.' });
        }
        const appointment = await fetchMaintenanceAppointmentById({
          appointmentId,
          patientId,
          clinicId: sanitizeString(schedule.clinic_id || clinicId, 120),
          organizationId: sanitizeString(schedule.organization_id || organizationId, 120)
        });
        if (!appointment?.id) {
          return res.status(404).json({ success: false, error: 'APPOINTMENT_NOT_FOUND', message: 'Sessão não encontrada.' });
        }
        const scheduledFor = sanitizeIsoDateTime(appointment.scheduled_at || appointment.scheduled_start_at || appointment.scheduledStartAt || now);
        patch = cleanObject({
          status: 'SCHEDULED',
          appointment_id: appointmentId,
          candidate_appointment_id: null,
          due_date: scheduledFor,
          target_due_date: scheduledFor,
          scheduled_for: scheduledFor,
          schedule_mode: 'CUSTOM_DATE',
          metadata: sanitizeClinicalPayload({
            ...(schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {}),
            auditAction: actionType,
            scheduleType: 'APPOINTMENT',
            scheduleReason: 'APPOINTMENT_UPDATED'
          }),
          raw_payload: sanitizeClinicalPayload({
            ...raw,
            targetName: target?.name || raw.targetName || null,
            scheduleType: 'APPOINTMENT',
            clinicalDate: null,
            noAutomaticClinicalMutation: true
          }),
          updated_at: now
        });
      } else if (mode === 'NEXT_SESSION') {
        actionType = 'MAINTENANCE_SCHEDULE_MOVED_TO_NEXT_SESSION';
        message = 'Sondagem aguardando futura sessão.';
        patch = cleanObject({
          status: 'PENDING_NEXT_SESSION',
          appointment_id: null,
          candidate_appointment_id: null,
          due_date: null,
          target_due_date: null,
          scheduled_for: null,
          schedule_mode: 'NEXT_PATIENT_SESSION',
          metadata: sanitizeClinicalPayload({
            ...(schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {}),
            auditAction: actionType,
            legacyAction: 'MAINTENANCE_NEXT_SESSION_SET',
            nextSessionPolicy: true,
            scheduleReason: 'MOVED_TO_NEXT_SESSION'
          }),
          raw_payload: sanitizeClinicalPayload({
            ...raw,
            targetName: target?.name || raw.targetName || null,
            scheduledForNextSession: true,
            nextSessionPolicy: true,
            noAutomaticClinicalMutation: true
          }),
          updated_at: now
        });
      } else {
        const clinicalDate = readClinicalDateInput(req.body?.dueDate || req.body?.due_date);
        if (!clinicalDate) {
          return res.status(400).json({ success: false, error: 'MISSING_DUE_DATE', message: 'Escolha uma data para agendar a sondagem.' });
        }
        patch = cleanObject({
          status: 'SCHEDULED',
          appointment_id: null,
          candidate_appointment_id: null,
          due_date: clinicalDate,
          target_due_date: clinicalDate,
          scheduled_for: null,
          schedule_mode: 'CUSTOM_DATE',
          metadata: sanitizeClinicalPayload({
            ...(schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {}),
            auditAction: actionType,
            scheduleType: 'DATE',
            scheduleReason: 'CUSTOM_DATE_UPDATED'
          }),
          raw_payload: sanitizeClinicalPayload({
            ...raw,
            targetName: target?.name || raw.targetName || null,
            scheduleType: 'DATE',
            clinicalDate,
            noAutomaticClinicalMutation: true
          }),
          updated_at: now
        });
      }
      let update = await updateAbaScheduleWithSchemaFallback(scheduleId, patch, sanitizeString(schedule.clinic_id || clinicId, 120), sanitizeString(schedule.organization_id || organizationId, 120), patientId);
      if (update.error && isLegacyMaintenanceScheduleConstraintError(update.error)) {
        update = await updateAbaScheduleWithSchemaFallback(scheduleId, buildLegacyMaintenanceScheduleRow(patch, now, update.error), sanitizeString(schedule.clinic_id || clinicId, 120), sanitizeString(schedule.organization_id || organizationId, 120), patientId);
      }
      if (update.error) throw update.error;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(schedule.clinic_id || clinicId, 120),
        actorName: 'Equipe',
        title: mode === 'NEXT_SESSION' ? 'Sondagem aguardando futura sessão' : 'Agendamento de manutencao atualizado',
        content: mode === 'NEXT_SESSION'
          ? 'Maintenance Schedule foi movido para aguardar futura sessão.'
          : 'Maintenance Schedule foi atualizado sem criar duplicidade.',
        type: 'clinical',
        actionType,
        payload: { scheduleId, targetId, patientId, mode }
      });
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [{ ...schedule, ...patch }],
        sanitizeString(schedule.clinic_id || clinicId, 120),
        sanitizeString(schedule.organization_id || organizationId, 120),
        req.session.user
      );
      return res.json({ success: true, message, data: enrichedSchedule || { ...schedule, ...patch }, schedule: enrichedSchedule || { ...schedule, ...patch } });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível atualizar o agendamento.' });
    }
  };
}

export function createAbaMaintenanceScheduleCancelHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, isUuid, canAccessPatientInCurrentClinic, ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES, normalizeAbaMaintenanceScheduleStatus, readMaintenanceStoredPayload, cleanObject, sanitizeClinicalPayload, updateAbaScheduleWithSchemaFallback, isLegacyMaintenanceScheduleConstraintError, buildLegacyMaintenanceScheduleRow, persistActivityLog } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 24 * 1024, 'Payload de cancelamento de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Sondagem de manutenção inválida.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .eq('organization_id', organizationId)
        .limit(1);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      const patientId = sanitizeString(schedule?.patient_id, 120);
      const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
      if (!schedule?.id || !isUuid(patientId) || !(await canAccessPatientInCurrentClinic(patientId, req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      if (!ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES.includes(normalizeAbaMaintenanceScheduleStatus(schedule.status))) {
        return res.status(409).json({ success: false, error: 'SCHEDULE_INACTIVE', message: 'Esta sondagem não está ativa.' });
      }
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      const now = new Date().toISOString();
      const patch = cleanObject({
        status: 'CANCELLED',
        cancelled_at: now,
        cancelled_by: sanitizeString(req.session.user?.id, 120),
        metadata: sanitizeClinicalPayload({
          ...(schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {}),
          auditAction: 'MAINTENANCE_SCHEDULE_CANCELLED',
          cancelReason: sanitizeString(req.body?.reason || req.body?.cancelReason || req.body?.cancel_reason, 240) || null
        }),
        raw_payload: sanitizeClinicalPayload({
          ...raw,
          cancelledAt: now,
          noAutomaticClinicalMutation: true
        }),
        updated_at: now
      });
      let update = await updateAbaScheduleWithSchemaFallback(scheduleId, patch, sanitizeString(schedule.clinic_id || clinicId, 120), sanitizeString(schedule.organization_id || organizationId, 120), patientId);
      if (update.error && isLegacyMaintenanceScheduleConstraintError(update.error)) {
        update = await updateAbaScheduleWithSchemaFallback(scheduleId, buildLegacyMaintenanceScheduleRow(patch, now, update.error), sanitizeString(schedule.clinic_id || clinicId, 120), sanitizeString(schedule.organization_id || organizationId, 120), patientId);
      }
      if (update.error) throw update.error;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(schedule.clinic_id || clinicId, 120),
        actorName: 'Equipe',
        title: 'Sondagem de manutencao cancelada',
        content: 'Maintenance Schedule foi marcado como cancelado sem exclusao fisica.',
        type: 'clinical',
        actionType: 'MAINTENANCE_SCHEDULE_CANCELLED',
        payload: { scheduleId, targetId, patientId }
      });
      return res.json({ success: true, message: 'Sondagem de manutenção cancelada.', data: { ...schedule, ...patch }, schedule: { ...schedule, ...patch } });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível atualizar o agendamento.' });
    }
  };
}

export function createAbaMaintenanceScheduleCompleteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, sanitizeIsoDateTime, cleanObject, updateAbaScheduleWithSchemaFallback, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de conclusão de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Identificador inválido.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId);
      query = applyAbaTenantScope(query, req.session.user, clinicId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      if (!existing.data?.id || !(await canAccessPatientInCurrentClinic(sanitizeString(existing.data.patient_id, 120), req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      const completedAt = sanitizeIsoDateTime(req.body?.completed_at || req.body?.completedAt || new Date().toISOString());
      const update = await updateAbaScheduleWithSchemaFallback(scheduleId, cleanObject({
        status: 'COMPLETED',
        completed_at: completedAt,
        completed_by: sanitizeString(req.session.user?.id, 120),
        updated_at: new Date().toISOString()
      }), existing.data.clinic_id, existing.data.organization_id, existing.data.patient_id);
      if (update.error) throw update.error;
      const completedSchedule = { ...existing.data, status: 'COMPLETED', completed_at: completedAt, completed_by: sanitizeString(req.session.user?.id, 120) };
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [completedSchedule],
        sanitizeString(existing.data.clinic_id, 120) || clinicId,
        sanitizeString(existing.data.organization_id, 120) || sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120),
        req.session.user
      );
      return res.json({ success: true, data: enrichedSchedule || completedSchedule });
    } catch {
      return res.status(500).json({ success: false, error: 'Não foi possível atualizar a manutenção agora.' });
    }
  };
}
