// ABA-M14: maintenance probe link/assignment/relink/skip handlers.
// Express route order and middlewares remain in server.ts. Dependencies are resolved lazily.

export function createAbaMaintenanceConfirmLinkHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, readMaintenanceStoredPayload, isUuid, fetchMaintenanceAppointmentById, updateAbaScheduleWithSchemaFallback, cleanObject, sanitizeClinicalPayload, persistActivityLog, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de confirmacao de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Identificador inválido.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .limit(1);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      if (!schedule?.id || !(await canAccessPatientInCurrentClinic(sanitizeString(schedule.patient_id, 120), req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      const metadata = schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
      const appointmentId = sanitizeString(
        req.body?.appointmentId ||
        req.body?.appointment_id ||
        schedule.candidate_appointment_id ||
        schedule.candidateAppointmentId ||
        raw.candidateAppointmentId ||
        metadata.candidateAppointmentId ||
        metadata.confirmedAppointmentId,
        180
      );
      if (!appointmentId) {
        return res.status(400).json({ success: false, error: 'MISSING_CANDIDATE_APPOINTMENT', message: 'Escolha uma sessão antes de confirmar o vínculo.' });
      }
      if (!isUuid(appointmentId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Escolha uma sessão real antes de confirmar o vínculo.' });
      }
      const appointment = await fetchMaintenanceAppointmentById({
        appointmentId,
        patientId: sanitizeString(schedule.patient_id, 120),
        clinicId: sanitizeString(schedule.clinic_id, 120) || clinicId,
        organizationId: sanitizeString(schedule.organization_id, 120) || organizationId
      });
      if (!appointment?.id) {
        return res.status(409).json({ success: false, error: 'APPOINTMENT_PATIENT_MISMATCH', message: 'Esta sessão não pertence ao paciente desta sondagem.' });
      }
      const now = new Date().toISOString();
      const confirmedBy = sanitizeString(req.session.user?.id, 120) || null;
      const update = await updateAbaScheduleWithSchemaFallback(scheduleId, cleanObject({
        status: 'SCHEDULED',
        appointment_id: appointmentId,
        candidate_appointment_id: null,
        scheduled_for: appointment.scheduled_at,
        due_date: appointment.scheduled_at,
        confirmed_at: now,
        confirmed_by: confirmedBy,
        metadata: sanitizeClinicalPayload({
          auditAction: 'MAINTENANCE_PROBE_LINK_CONFIRMED',
          confirmedAppointmentId: appointmentId,
          confirmedAt: now
        }),
        raw_payload: sanitizeClinicalPayload({
          ...raw,
          confirmedAppointmentId: appointmentId,
          confirmedAt: now,
          candidateAppointmentId: null,
          noAutomaticClinicalMutation: true
        }),
        updated_at: now
      }), schedule.clinic_id || clinicId, schedule.organization_id || organizationId, schedule.patient_id);
      if (update.error) throw update.error;
      void persistActivityLog({
        userId: confirmedBy || '',
        clinicId: schedule.clinic_id || clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: 'Vinculo de sondagem confirmado',
        content: 'Maintenance Probe foi vinculada a sessão apos confirmacao humana.',
        type: 'clinical',
        actionType: 'MAINTENANCE_PROBE_LINK_CONFIRMED',
        payload: { scheduleId, appointmentId, patientId: schedule.patient_id }
      });
      const confirmedSchedule = {
        ...schedule,
        status: 'SCHEDULED',
        appointment_id: appointmentId,
        scheduled_for: appointment.scheduled_at,
        confirmed_at: now,
        confirmed_by: confirmedBy
      };
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [confirmedSchedule],
        sanitizeString(schedule.clinic_id, 120) || clinicId,
        sanitizeString(schedule.organization_id, 120) || organizationId,
        req.session.user
      );
      return res.json({
        success: true,
        message: 'Vínculo confirmado.',
        schedule: enrichedSchedule || confirmedSchedule,
        data: enrichedSchedule || confirmedSchedule
      });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível atualizar a manutenção agora.' });
    }
  };
}

export function createAbaMaintenanceAssignAppointmentHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, isUuid, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, fetchMaintenanceAppointmentById, readMaintenanceStoredPayload, updateAbaScheduleWithSchemaFallback, cleanObject, sanitizeClinicalPayload, persistActivityLog, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de atribuicao de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      const appointmentId = sanitizeString(req.body?.appointmentId || req.body?.appointment_id, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Identificador inválido.' });
      }
      if (!isUuid(appointmentId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Escolha uma sessão real antes de atribuir a sondagem.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .limit(1);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      if (!schedule?.id || !(await canAccessPatientInCurrentClinic(sanitizeString(schedule.patient_id, 120), req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      const appointment = await fetchMaintenanceAppointmentById({
        appointmentId,
        patientId: sanitizeString(schedule.patient_id, 120),
        clinicId: sanitizeString(schedule.clinic_id, 120) || clinicId,
        organizationId: sanitizeString(schedule.organization_id, 120) || organizationId
      });
      if (!appointment?.id) {
        return res.status(409).json({ success: false, error: 'APPOINTMENT_PATIENT_MISMATCH', message: 'Esta sessão não pertence ao paciente desta sondagem.' });
      }
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      const metadata = schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
      const now = new Date().toISOString();
      const assignedBy = sanitizeString(req.session.user?.id, 120) || null;
      const update = await updateAbaScheduleWithSchemaFallback(scheduleId, cleanObject({
        status: 'SCHEDULED',
        appointment_id: appointmentId,
        candidate_appointment_id: null,
        scheduled_for: appointment.scheduled_at,
        due_date: appointment.scheduled_at,
        confirmed_at: now,
        confirmed_by: assignedBy,
        metadata: sanitizeClinicalPayload({
          ...metadata,
          auditAction: 'MAINTENANCE_SCHEDULE_ASSIGNED',
          legacyAuditAction: 'MAINTENANCE_PROBE_ASSIGNED_TO_APPOINTMENT',
          assignedAppointmentId: appointmentId,
          assignedAt: now
        }),
        raw_payload: sanitizeClinicalPayload({
          ...raw,
          assignedAppointmentId: appointmentId,
          confirmedAppointmentId: appointmentId,
          candidateAppointmentId: null,
          noAutomaticClinicalMutation: true
        }),
        updated_at: now
      }), schedule.clinic_id || clinicId, schedule.organization_id || organizationId, schedule.patient_id);
      if (update.error) throw update.error;
      if (!update.data || sanitizeString(update.data.id, 180) !== scheduleId) {
        return res.status(409).json({ success: false, error: 'PERSISTENCE_NOT_CONFIRMED', message: 'Não foi possível confirmar a persistência da sondagem.' });
      }
      void persistActivityLog({
        userId: assignedBy || '',
        clinicId: schedule.clinic_id || clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: 'Sondagem atribuida a sessao',
        content: 'Maintenance Probe foi vinculada a uma sessão escolhida pela equipe.',
        type: 'clinical',
        actionType: 'MAINTENANCE_SCHEDULE_ASSIGNED',
        payload: { scheduleId, appointmentId, patientId: schedule.patient_id }
      });
      const assignedSchedule = {
        ...schedule,
        status: 'SCHEDULED',
        appointment_id: appointmentId,
        candidate_appointment_id: null,
        scheduled_for: appointment.scheduled_at,
        confirmed_at: now,
        confirmed_by: assignedBy
      };
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [assignedSchedule],
        sanitizeString(schedule.clinic_id, 120) || clinicId,
        sanitizeString(schedule.organization_id, 120) || organizationId,
        req.session.user
      );
      return res.json({
        success: true,
        message: 'Sondagem atribuída à sessão.',
        schedule: enrichedSchedule || assignedSchedule,
        data: enrichedSchedule || assignedSchedule
      });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível atribuir a sondagem agora.' });
    }
  };
}

export function createAbaMaintenanceRelinkTargetHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, isUuid, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, fetchTargetForMaintenance, readMaintenanceStoredPayload, updateAbaScheduleWithSchemaFallback, cleanObject, sanitizeClinicalPayload, persistActivityLog, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de revisao de vinculo de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      const targetId = sanitizeString(req.body?.targetId || req.body?.target_id, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId) || !isUuid(targetId)) {
        return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Escolha uma habilidade real antes de salvar o vínculo.' });
      }
      let scheduleQuery = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .limit(1);
      scheduleQuery = applyAbaTenantScope(scheduleQuery, req.session.user, clinicId, organizationId);
      const existing = await scheduleQuery.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      if (!schedule?.id || !(await canAccessPatientInCurrentClinic(sanitizeString(schedule.patient_id, 120), req.session.user))) {
        return res.status(404).json({ success: false, error: 'SCHEDULE_NOT_FOUND', message: 'Sondagem de manutenção não encontrada.' });
      }
      const target = await fetchTargetForMaintenance({
        targetId,
        patientId: sanitizeString(schedule.patient_id, 120),
        clinicId: sanitizeString(schedule.clinic_id, 120) || clinicId,
        organizationId: sanitizeString(schedule.organization_id, 120) || organizationId
      });
      if (!target?.id) {
        return res.status(404).json({ success: false, error: 'TARGET_NOT_FOUND', message: 'Habilidade não encontrada para este paciente.' });
      }
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      const metadata = schedule.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
      const now = new Date().toISOString();
      const update = await updateAbaScheduleWithSchemaFallback(scheduleId, cleanObject({
        target_id: targetId,
        metadata: sanitizeClinicalPayload({
          ...metadata,
          auditAction: 'MAINTENANCE_SCHEDULE_RELINKED',
          relinkedTargetId: targetId,
          relinkedAt: now
        }),
        raw_payload: sanitizeClinicalPayload({
          ...raw,
          targetName: target?.name || raw.targetName || null,
          targetRelinkedAt: now,
          noAutomaticClinicalMutation: true
        }),
        updated_at: now
      }), schedule.clinic_id || clinicId, schedule.organization_id || organizationId, schedule.patient_id);
      if (update.error) throw update.error;
      if (!update.data || sanitizeString(update.data.id, 180) !== scheduleId) {
        return res.status(409).json({ success: false, error: 'PERSISTENCE_NOT_CONFIRMED', message: 'Não foi possível confirmar a persistência da sondagem.' });
      }
      const relinkedBy = sanitizeString(req.session.user?.id, 120) || null;
      void persistActivityLog({
        userId: relinkedBy || '',
        clinicId: schedule.clinic_id || clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: 'Vinculo da habilidade atualizado',
        content: 'Maintenance Schedule foi vinculado a uma habilidade real do PEI.',
        type: 'clinical',
        actionType: 'MAINTENANCE_SCHEDULE_RELINKED',
        payload: { scheduleId, targetId, patientId: schedule.patient_id }
      });
      const relinkedSchedule = {
        ...schedule,
        target_id: targetId,
        raw_payload: { ...raw, targetName: target?.name || raw.targetName || null },
        updated_at: now
      };
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [relinkedSchedule],
        sanitizeString(schedule.clinic_id, 120) || clinicId,
        sanitizeString(schedule.organization_id, 120) || organizationId,
        req.session.user
      );
      return res.json({
        success: true,
        message: 'Vínculo da habilidade atualizado.',
        schedule: enrichedSchedule || relinkedSchedule,
        data: enrichedSchedule || relinkedSchedule
      });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível revisar o vínculo agora.' });
    }
  };
}

export function createAbaMaintenanceSkipLinkHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, hasPersistedMaintenanceScheduleId, supabase, ABA_MAINTENANCE_SCHEDULE_SELECT, applyAbaTenantScope, hasMissingFinancialSchema, canAccessPatientInCurrentClinic, readMaintenanceStoredPayload, updateAbaScheduleWithSchemaFallback, cleanObject, sanitizeClinicalPayload, persistActivityLog, enrichMaintenanceRowsWithTargetDisplay } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de adiamento de Maintenance Probe')) return;
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const scheduleId = sanitizeString(req.params.scheduleId, 180);
      if (!hasPersistedMaintenanceScheduleId(scheduleId)) {
        return res.status(400).json({ success: false, error: 'Identificador inválido.' });
      }
      let query = supabase
        .from('aba_maintenance_schedules')
        .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
        .eq('id', scheduleId)
        .limit(1);
      query = applyAbaTenantScope(query, req.session.user, clinicId, organizationId);
      const existing = await query.maybeSingle();
      if (existing.error) {
        if (hasMissingFinancialSchema(existing.error)) return res.status(503).json({ success: false, error: 'Schema ABA de manutenção ainda não aplicado.' });
        throw existing.error;
      }
      const schedule = existing.data || null;
      if (!schedule?.id || !(await canAccessPatientInCurrentClinic(sanitizeString(schedule.patient_id, 120), req.session.user))) {
        return res.status(404).json({ success: false, error: 'Sondagem de manutenção não encontrada.' });
      }
      const raw = readMaintenanceStoredPayload(schedule.raw_payload || schedule.rawPayload);
      const appointmentId = sanitizeString(
        req.body?.appointmentId || req.body?.appointment_id || raw.candidateAppointmentId,
        180
      );
      const ignoredAppointmentIds = Array.from(new Set([
        ...(Array.isArray(raw.ignoredAppointmentIds) ? raw.ignoredAppointmentIds : []),
        appointmentId
      ].map((value: any) => sanitizeString(value, 180)).filter(Boolean))).slice(-20);
      const previousStatus = sanitizeString(raw.pendingConfirmationPreviousStatus, 40).toUpperCase();
      const nextStatus = ['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING'].includes(previousStatus)
        ? previousStatus
        : 'PENDING_NEXT_SESSION';
      const now = new Date().toISOString();
      const update = await updateAbaScheduleWithSchemaFallback(scheduleId, cleanObject({
        status: nextStatus,
        appointment_id: null,
        candidate_appointment_id: null,
        due_date: null,
        target_due_date: null,
        scheduled_for: null,
        schedule_mode: 'NEXT_PATIENT_SESSION',
        metadata: sanitizeClinicalPayload({
          auditAction: 'MAINTENANCE_PROBE_LINK_SKIPPED',
          skippedAppointmentId: appointmentId,
          skippedAt: now
        }),
        raw_payload: sanitizeClinicalPayload({
          ...raw,
          candidateAppointmentId: null,
          candidateScheduledAt: null,
          pendingConfirmationPreviousStatus: null,
          ignoredAppointmentIds,
          linkSkippedAt: now,
          clinicalDate: null,
          scheduleType: 'NEXT_SESSION',
          scheduledForNextSession: true,
          nextSessionPolicy: true,
          noAutomaticClinicalMutation: true
        }),
        updated_at: now
      }), schedule.clinic_id || clinicId, schedule.organization_id || organizationId, schedule.patient_id);
      if (update.error) throw update.error;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: schedule.clinic_id || clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email, 180) || 'Equipe',
        title: 'Vinculo de sondagem adiado',
        content: 'Maintenance Probe continuou pendente para vinculo posterior.',
        type: 'clinical',
        actionType: 'MAINTENANCE_PROBE_LINK_SKIPPED',
        payload: { scheduleId, appointmentId, patientId: schedule.patient_id }
      });
      const skippedSchedule = {
        ...schedule,
        status: nextStatus,
        appointment_id: null,
        candidate_appointment_id: null,
        due_date: null,
        target_due_date: null,
        scheduled_for: null,
        schedule_mode: 'NEXT_PATIENT_SESSION',
        raw_payload: {
          ...raw,
          candidateAppointmentId: null,
          candidateScheduledAt: null,
          pendingConfirmationPreviousStatus: null,
          ignoredAppointmentIds,
          linkSkippedAt: now,
          clinicalDate: null,
          scheduleType: 'NEXT_SESSION',
          scheduledForNextSession: true,
          nextSessionPolicy: true,
          noAutomaticClinicalMutation: true
        }
      };
      const [enrichedSchedule] = await enrichMaintenanceRowsWithTargetDisplay(
        [skippedSchedule],
        sanitizeString(schedule.clinic_id, 120) || clinicId,
        sanitizeString(schedule.organization_id, 120) || organizationId,
        req.session.user
      );
      return res.json({
        success: true,
        message: 'Sondagem mantida para depois.',
        schedule: enrichedSchedule || skippedSchedule,
        data: enrichedSchedule || skippedSchedule
      });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível atualizar a manutenção agora.' });
    }
  };
}
