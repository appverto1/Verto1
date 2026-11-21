// Surgical extraction: preserve route ordering, authorization middleware, database writes and responses.
export function createAbaSessionPatchHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, normalizeAbaSessionStatus, cleanObject, isUuid, sanitizeIsoDateTime, asSafeNumber, sanitizeTextField, supabase, hasGlobalClinicAccess, calculateAbaSessionDurationMinutes, isAbaSessionInProgressStatus, patchAppointmentOperationalFromAbaSession, regenerateClosureForAppointments, runTissPipelineForAppointment, revalidateAppointmentBillingForAppointment, extractMissingColumnName, hasMissingFinancialSchema } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload da sessão ABA')) return;
      const sessionId = sanitizeString(req.params.sessionId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!sessionId) return res.status(400).json({ success: false, error: 'Sessão inválida.' });

      const requestedPatchStatus = req.body?.status !== undefined ? normalizeAbaSessionStatus(req.body?.status) : undefined;
      if (requestedPatchStatus === 'completed') {
        return res.status(409).json({
          success: false,
          code: 'USE_ATOMIC_SESSION_COMPLETION',
          error: 'Use o fluxo de encerramento da sessão para concluir atendimento, presença e faturamento de forma atômica.'
        });
      }

      const patch = cleanObject({
        status: requestedPatchStatus,
        appointment_id: req.body?.appointment_id !== undefined || req.body?.appointmentId !== undefined
          ? (isUuid(sanitizeString(req.body?.appointment_id || req.body?.appointmentId, 180)) ? sanitizeString(req.body?.appointment_id || req.body?.appointmentId, 180) : null)
          : undefined,
        scheduled_start_at: req.body?.scheduled_start !== undefined || req.body?.scheduledStart !== undefined || req.body?.scheduled_start_at !== undefined || req.body?.scheduledStartAt !== undefined
          ? sanitizeIsoDateTime(req.body?.scheduled_start || req.body?.scheduledStart || req.body?.scheduled_start_at || req.body?.scheduledStartAt)
          : undefined,
        scheduled_end_at: req.body?.scheduled_end !== undefined || req.body?.scheduledEnd !== undefined || req.body?.scheduled_end_at !== undefined || req.body?.scheduledEndAt !== undefined
          ? sanitizeIsoDateTime(req.body?.scheduled_end || req.body?.scheduledEnd || req.body?.scheduled_end_at || req.body?.scheduledEndAt)
          : undefined,
        scheduled_duration_minutes: req.body?.scheduled_duration_minutes !== undefined || req.body?.scheduledDurationMinutes !== undefined
          ? asSafeNumber(req.body?.scheduled_duration_minutes ?? req.body?.scheduledDurationMinutes, 0, 1440)
          : undefined,
        actual_start_at: req.body?.actual_start !== undefined || req.body?.actualStart !== undefined || req.body?.actual_start_at !== undefined || req.body?.actualStartAt !== undefined
          ? sanitizeIsoDateTime(req.body?.actual_start || req.body?.actualStart || req.body?.actual_start_at || req.body?.actualStartAt)
          : undefined,
        actual_end_at: req.body?.actual_end !== undefined || req.body?.actualEnd !== undefined || req.body?.actual_end_at !== undefined || req.body?.actualEndAt !== undefined
          ? sanitizeIsoDateTime(req.body?.actual_end || req.body?.actualEnd || req.body?.actual_end_at || req.body?.actualEndAt)
          : undefined,
        actual_duration_minutes: req.body?.actual_duration_minutes !== undefined || req.body?.actualDurationMinutes !== undefined
          ? asSafeNumber(req.body?.actual_duration_minutes ?? req.body?.actualDurationMinutes, 0, 1440)
          : undefined,
        room_id: req.body?.room_id !== undefined || req.body?.roomId !== undefined ? sanitizeString(req.body?.room_id || req.body?.roomId, 180) || null : undefined,
        room_name: req.body?.room_name !== undefined || req.body?.roomName !== undefined ? sanitizeString(req.body?.room_name || req.body?.roomName, 180) || null : undefined,
        location_type: req.body?.location_type !== undefined || req.body?.locationType !== undefined ? sanitizeString(req.body?.location_type || req.body?.locationType, 80) || null : undefined,
        ended_at: req.body?.ended_at !== undefined || req.body?.endedAt !== undefined
          ? sanitizeIsoDateTime(req.body?.ended_at || req.body?.endedAt)
          : undefined,
        duration_seconds: req.body?.duration_seconds !== undefined || req.body?.durationSeconds !== undefined
          ? asSafeNumber(req.body?.duration_seconds ?? req.body?.durationSeconds, 0, 86400)
          : undefined,
        duration_minutes: req.body?.duration_minutes !== undefined || req.body?.durationMinutes !== undefined
          ? asSafeNumber(req.body?.duration_minutes ?? req.body?.durationMinutes, 0, 1440)
          : undefined,
        record_count: req.body?.record_count !== undefined || req.body?.recordCount !== undefined
          ? asSafeNumber(req.body?.record_count ?? req.body?.recordCount, 0, 100000)
          : undefined,
        notes: req.body?.notes !== undefined ? sanitizeTextField(req.body?.notes, 2000) : undefined,
        updated_at: new Date().toISOString()
      });
      let safePatch: Record<string, any> = { ...patch };
      while (Object.keys(safePatch).length > 0) {
        let query = supabase.from('aba_sessions').update(safePatch).eq('id', sessionId);
        if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
        if (sanitizeString(req.session.user?.role, 40).toLowerCase() === 'therapist') {
          query = query.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const result = await query.select('id,status,appointment_id,scheduled_start_at,scheduled_end_at,scheduled_duration_minutes,actual_start_at,actual_end_at,actual_duration_minutes,room_id,room_name,location_type,ended_at,duration_seconds,duration_minutes,record_count,updated_at').maybeSingle();
        if (!result.error) {
          const appointmentIdForClosure = sanitizeString(result.data?.appointment_id || safePatch.appointment_id, 120);
          if (isUuid(appointmentIdForClosure)) {
            const sessionData = result.data || { id: sessionId, ...safePatch };
            const actualEndAt = sessionData.actual_end_at || sessionData.ended_at || null;
            const actualDurationMinutes = calculateAbaSessionDurationMinutes(
              sessionData.actual_start_at || sessionData.started_at,
              actualEndAt,
              sessionData.actual_duration_minutes ?? sessionData.duration_minutes
            );
            const appointmentStatus = sanitizeString(sessionData.status || safePatch.status, 40).toLowerCase() === 'completed'
              ? 'COMPLETED'
              : isAbaSessionInProgressStatus(sessionData.status || safePatch.status)
                ? 'IN_PROGRESS'
                : null;
            if (appointmentStatus) {
              await patchAppointmentOperationalFromAbaSession({
                appointmentId: appointmentIdForClosure,
                user: req.session.user,
                status: appointmentStatus,
                actualStartAt: sessionData.actual_start_at || sessionData.started_at,
                actualEndAt,
                actualDurationMinutes,
                abaSessionId: sessionId
              });
            }
            await regenerateClosureForAppointments(
              [appointmentIdForClosure],
              req.session.user,
              'aba_session_updated'
            );
            if (appointmentStatus === 'COMPLETED') {
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
          }
          return res.json({ success: true, data: result.data || { id: sessionId, ...safePatch } });
        }
        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in safePatch) {
          delete safePatch[missingColumn];
          continue;
        }
        if (hasMissingFinancialSchema(result.error)) {
          return res.status(503).json({ success: false, error: 'Schema ABA ainda não aplicado.' });
        }
        throw result.error;
      }
      return res.status(400).json({ success: false, error: 'Nada para atualizar.' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  };
}
export function createAbaSessionStartHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { appointmentBelongsToProfessional, asSafeNumber, buildAbaSessionAppointmentMirrorFallback, calculateAbaSessionDurationMinutes, cleanObject, collectAbaSessionProfessionalScopeIds, currentClinicId, enforcePayloadLimit, fetchCompletedAbaSessionForAppointment, fetchConflictingInProgressAbaSessionForAppointment, fetchInProgressAbaSessionForAppointment, formatDateInAppointmentTimezone, getAppointmentForSessionStart, hasMissingFinancialSchema, isAbaSessionInProgressStatus, isUuid, loadSessionSpecialtyPlanContext, logAbaSessionStartDebug, normalizeAbaSessionStatus, normalizeCareSetting, normalizeOperationalAppointmentStatus, parseStoredJsonObject, patchAppointmentOperationalFromAbaSession, regenerateClosureForAppointments, resolveAbaRequestSource, resolveAbaSessionClinicId, resolveAppointmentProfessionalId, runTissPipelineForAppointment, sanitizeClinicalPayload, sanitizeDate, sanitizeIsoDateTime, sanitizeString, sanitizeTextField, writeAbaRowWithSchemaFallback, supabase, crypto, ABA_SESSION_STARTABLE_APPOINTMENT_STATUSES } = getDeps();
    let claimedAppointmentId = '';
    let claimedSessionId = '';
    let appointmentClaimNeedsRelease = false;
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Payload da sessão ABA')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });
      const clinicId = await resolveAbaSessionClinicId({
        patientId,
        body: req.body || {},
        user: req.session.user
      });
      if (!clinicId) return res.status(400).json({ success: false, error: 'Clínica não identificada.' });

      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const sessionActorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
      const sessionActorRole = sanitizeString(req.effectiveClinicRole || req.session.user?.clinicRole || req.session.user?.role, 40).toLowerCase();
      const requestedTherapeuticPlanId = sanitizeString(req.body?.therapeutic_plan_id || req.body?.therapeuticPlanId, 120);
      if (requestedTherapeuticPlanId && !isUuid(requestedTherapeuticPlanId)) {
        return res.status(400).json({ success: false, code: 'SESSION_THERAPEUTIC_PLAN_INVALID', error: 'Plano terapêutico inválido para esta sessão.' });
      }
      if (requestedTherapeuticPlanId) {
        const planContext = await loadSessionSpecialtyPlanContext({
          actorId: sessionActorId,
          actorRole: sessionActorRole,
          organizationId,
          clinicId,
          patientId,
          planId: requestedTherapeuticPlanId,
        });
        if (!planContext.plan) {
          return res.status(404).json({ success: false, code: 'SESSION_THERAPEUTIC_PLAN_NOT_FOUND', error: 'Plano por especialidade não encontrado para este paciente.' });
        }
        if (planContext.reason === 'invalid_scope') {
          return res.status(422).json({ success: false, code: 'SESSION_SPECIALTY_PLAN_REQUIRED', error: 'A sessão deve ser iniciada a partir de um plano por especialidade ativo, não do PTS compartilhado.' });
        }
        if (planContext.reason === 'inactive_scope') {
          return res.status(409).json({ success: false, code: 'SESSION_THERAPEUTIC_PLAN_NOT_ACTIVE', error: 'Apenas planos ativos podem iniciar sessão. Publique ou retome o plano antes de começar a coleta.' });
        }
        if (!planContext.allowed) {
          return res.status(403).json({ success: false, code: 'SESSION_THERAPEUTIC_PLAN_ACCESS_DENIED', error: 'Você não possui vínculo clínico de escrita com este plano.' });
        }
      }

      const startedAt = sanitizeIsoDateTime(req.body?.started_at || req.body?.startedAt);
      const requestSource = resolveAbaRequestSource(req.body);
      const appointmentStartRequested = ['appointment', 'agenda', 'calendar'].includes(
        sanitizeString(requestSource, 80).toLowerCase()
      );
      const rawAppointmentId = sanitizeString(req.body?.appointment_id || req.body?.appointmentId, 180);
      if (!rawAppointmentId && appointmentStartRequested) {
        logAbaSessionStartDebug({
          hasAppointmentId: false,
          appointmentFound: false,
          organizationMatched: false,
          reasonCode: 'MISSING_APPOINTMENT_ID'
        });
        return res.status(400).json({ success: false, error: 'Sessão não informada.' });
      }
      if (rawAppointmentId && !isUuid(rawAppointmentId)) {
        logAbaSessionStartDebug({
          hasAppointmentId: true,
          appointmentFound: false,
          organizationMatched: false,
          reasonCode: 'INVALID_APPOINTMENT_ID'
        });
        return res.status(400).json({
          success: false,
          code: 'INVALID_APPOINTMENT_ID',
          error: 'Sessão inválida.'
        });
      }
      const appointmentId = rawAppointmentId || null;
      let linkedAppointment: any = null;
      let existingInProgressSession: any = null;
      let resolvedProfessionalId = sanitizeString(
        req.body?.professional_id ||
          req.body?.professionalId ||
          req.body?.therapist_id ||
          req.body?.therapistId ||
          req.session.user?.id,
        120
      );
      let professionalScopeIds = collectAbaSessionProfessionalScopeIds({
        body: req.body || {},
        user: req.session.user
      });
      if (appointmentId) {
        const fallbackAppointment = buildAbaSessionAppointmentMirrorFallback({
          appointmentId,
          patientId,
          clinicId,
          body: req.body || {},
          user: req.session.user
        });
        linkedAppointment = await getAppointmentForSessionStart(
          appointmentId,
          clinicId,
          req.session.user,
          {
            fallbackAppointment,
            professionalScopeIds
          }
        );
        if (!linkedAppointment?.id) {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: false,
            organizationMatched: false,
            reasonCode: 'APPOINTMENT_NOT_FOUND'
          });
          return res.status(404).json({ success: false, error: 'Sessão não encontrada.' });
        }
        if (sanitizeString(linkedAppointment.patient_id, 120) !== patientId) {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus: normalizeOperationalAppointmentStatus(linkedAppointment.status),
            organizationMatched: true,
            reasonCode: 'PATIENT_MISMATCH'
          });
          return res.status(409).json({ success: false, error: 'Os dados da sessão não conferem com o paciente selecionado.' });
        }
        const appointmentStatus = normalizeOperationalAppointmentStatus(linkedAppointment.status);
        if (appointmentStatus === 'DELETED') {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: false,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'APPOINTMENT_DELETED'
          });
          return res.status(404).json({ success: false, error: 'Sessão não encontrada.' });
        }
        if (appointmentStatus === 'CANCELLED' || appointmentStatus === 'CANCEL_REQUESTED') {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'APPOINTMENT_CANCELLED'
          });
          return res.status(409).json({ success: false, error: 'Esta sessão está cancelada e não pode ser iniciada.' });
        }
        if (appointmentStatus === 'COMPLETED') {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'APPOINTMENT_COMPLETED'
          });
          return res.status(409).json({ success: false, error: 'Esta sessão agendada já possui uma Sessão ABA encerrada.' });
        }
        if (appointmentStatus === 'NO_SHOW' || appointmentStatus === 'MISSED') {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'APPOINTMENT_NO_SHOW'
          });
          return res.status(409).json({
            success: false,
            code: 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED',
            error: 'Este atendimento foi classificado como falta. Reabra a falta com justificativa antes de iniciar.'
          });
        }
        if (!ABA_SESSION_STARTABLE_APPOINTMENT_STATUSES.has(appointmentStatus)) {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'APPOINTMENT_STATUS_NOT_STARTABLE'
          });
          return res.status(409).json({ success: false, error: 'Esta sessão não pode ser iniciada neste status.' });
        }
        const appointmentProfessionalId = resolveAppointmentProfessionalId(linkedAppointment);
        professionalScopeIds = collectAbaSessionProfessionalScopeIds({
          body: req.body || {},
          user: req.session.user,
          appointment: linkedAppointment
        });
        const explicitProfessionalId = sanitizeString(
          req.body?.professional_id ||
            req.body?.professionalId ||
            req.body?.therapist_id ||
            req.body?.therapistId,
          120
        );
        if (
          explicitProfessionalId &&
          appointmentProfessionalId &&
          explicitProfessionalId !== appointmentProfessionalId &&
          !appointmentBelongsToProfessional(linkedAppointment, explicitProfessionalId)
        ) {
          logAbaSessionStartDebug({
            hasAppointmentId: true,
            appointmentFound: true,
            appointmentStatus,
            organizationMatched: true,
            reasonCode: 'PROFESSIONAL_MISMATCH'
          });
          return res.status(409).json({ success: false, error: 'Sessão vinculada a outro profissional.' });
        }
        resolvedProfessionalId = appointmentProfessionalId || explicitProfessionalId || resolvedProfessionalId;
        existingInProgressSession = await fetchInProgressAbaSessionForAppointment({
          appointmentId,
          patientId,
          clinicId,
          user: req.session.user,
          professionalIds: professionalScopeIds
        });
        if (!existingInProgressSession?.id) {
          const existingCompletedSession = await fetchCompletedAbaSessionForAppointment({
            appointmentId,
            patientId,
            clinicId,
            user: req.session.user,
            professionalIds: professionalScopeIds
          });
          if (existingCompletedSession?.id) {
            logAbaSessionStartDebug({
              hasAppointmentId: true,
              appointmentFound: true,
              appointmentStatus,
              organizationMatched: true,
              reasonCode: 'SESSION_ALREADY_COMPLETED'
            });
            return res.status(409).json({ success: false, error: 'Esta sessão agendada já possui uma Sessão ABA encerrada.' });
          }
          const conflictingInProgressSession = await fetchConflictingInProgressAbaSessionForAppointment({
            appointmentId,
            patientId,
            professionalId: resolvedProfessionalId,
            clinicId,
            user: req.session.user,
            scheduledStartAt: linkedAppointment?.scheduled_start_at || linkedAppointment?.scheduled_at || null,
            scheduledEndAt: linkedAppointment?.scheduled_end_at || null
          });
          if (conflictingInProgressSession?.id) {
            logAbaSessionStartDebug({
              hasAppointmentId: true,
              appointmentFound: true,
              appointmentStatus,
              organizationMatched: true,
              reasonCode: 'CONFLICTING_SESSION_IN_PROGRESS'
            });
            return res.status(409).json({ success: false, error: 'Já existe uma sessão em andamento para este paciente/profissional.' });
          }
        }
        logAbaSessionStartDebug({
          hasAppointmentId: true,
          appointmentFound: true,
          appointmentStatus,
          organizationMatched: true,
          reasonCode: existingInProgressSession?.id ? 'REUSE_IN_PROGRESS_SESSION' : 'START_ALLOWED'
        });
      }
      const existingTherapeuticPlanId = sanitizeString(existingInProgressSession?.therapeutic_plan_id, 120);
      if (existingInProgressSession?.id && requestedTherapeuticPlanId && existingTherapeuticPlanId !== requestedTherapeuticPlanId) {
        return res.status(409).json({
          success: false,
          code: 'SESSION_THERAPEUTIC_PLAN_CONTEXT_IMMUTABLE',
          error: existingTherapeuticPlanId
            ? 'Esta sessão já foi aberta em outro plano por especialidade e não pode ser reinterpretada.'
            : 'Esta sessão já foi aberta sem um plano por especialidade e não pode receber esse vínculo retroativamente.'
        });
      }
      const sessionTherapeuticPlanId = existingTherapeuticPlanId || requestedTherapeuticPlanId || null;

      const requestedSessionId = sanitizeString(req.body?.id || req.body?.session_id || req.body?.sessionId || crypto.randomUUID(), 180);
      const sessionId = sanitizeString(existingInProgressSession?.id || requestedSessionId, 180);
      const requestedStatus = normalizeAbaSessionStatus(req.body?.status);
      const sessionStatus = appointmentId && requestedStatus === 'active' ? 'in_progress' : requestedStatus;
      const resolvedActualEndAt = req.body?.actual_end || req.body?.actualEnd || req.body?.actual_end_at || req.body?.actualEndAt
        ? sanitizeIsoDateTime(req.body?.actual_end || req.body?.actualEnd || req.body?.actual_end_at || req.body?.actualEndAt)
        : null;
      const resolvedActualStartAt = existingInProgressSession?.actual_start_at || (
        req.body?.actual_start || req.body?.actualStart || req.body?.actual_start_at || req.body?.actualStartAt
          ? sanitizeIsoDateTime(req.body?.actual_start || req.body?.actualStart || req.body?.actual_start_at || req.body?.actualStartAt)
          : startedAt
      );

      if (appointmentId) {
        const actorId = sanitizeString(req.session.user?.id, 120);
        const claimResult = await supabase.rpc('claim_appointment_for_session_start_v1', {
          p_actor_id: actorId,
          p_clinic_id: clinicId,
          p_appointment_id: appointmentId,
          p_patient_id: patientId,
          p_session_id: sessionId,
          p_started_at: resolvedActualStartAt
        });
        if (claimResult.error) {
          const claimMessage = sanitizeString(claimResult.error?.message || claimResult.error?.code, 600);
          if (/SESSION_START_APPOINTMENT_NO_SHOW/i.test(claimMessage)) {
            return res.status(409).json({
              success: false,
              code: 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED',
              error: 'Este atendimento foi classificado como falta. Reabra a falta com justificativa antes de iniciar.'
            });
          }
          if (/SESSION_START_APPOINTMENT_ALREADY_IN_PROGRESS|SESSION_START_APPOINTMENT_STATUS_INVALID|SESSION_START_APPOINTMENT_CANCELLED|SESSION_START_APPOINTMENT_COMPLETED/i.test(claimMessage)) {
            return res.status(409).json({ success: false, code: 'APPOINTMENT_START_CONFLICT', error: 'O status deste atendimento mudou. Atualize a agenda e tente novamente.' });
          }
          if (/SESSION_START_ACCESS_DENIED|SESSION_START_ACTOR_MISMATCH/i.test(claimMessage)) {
            return res.status(403).json({ success: false, code: 'APPOINTMENT_START_ACCESS_DENIED', error: 'Você não possui permissão para iniciar este atendimento.' });
          }
          if (/claim_appointment_for_session_start_v1|active_aba_session_id|session_start_previous_status|PGRST202|42883|42703/i.test(claimMessage)) {
            return res.status(503).json({
              success: false,
              code: 'SESSION_ATTENDANCE_POLICY_MIGRATION_REQUIRED',
              retryable: false,
              error: 'A atualização de presença, encerramento e falta ainda precisa ser aplicada no banco.'
            });
          }
          throw claimResult.error;
        }
        claimedAppointmentId = appointmentId;
        claimedSessionId = sessionId;
        appointmentClaimNeedsRelease = claimResult.data?.claimedNow === true;
      }

      const persistedSessionStartedAt = existingInProgressSession?.started_at || startedAt;
      const existingLocationContext = parseStoredJsonObject(existingInProgressSession?.location_context_snapshot);
      const sessionLocationTimezone = sanitizeString(
        existingLocationContext?.locationTimezone ||
          existingLocationContext?.location_timezone ||
          linkedAppointment?.location_timezone ||
          req.body?.location_timezone ||
          req.body?.locationTimezone ||
          req.body?.location_context_snapshot?.locationTimezone ||
          req.body?.locationContextSnapshot?.locationTimezone,
        120
      ) || 'America/Sao_Paulo';
      const serverReferenceDate =
        sanitizeDate(existingInProgressSession?.reference_date) ||
        formatDateInAppointmentTimezone(persistedSessionStartedAt, sessionLocationTimezone) ||
        persistedSessionStartedAt.slice(0, 10);

      const payload = cleanObject({
        id: sessionId,
        organization_id: sanitizeString(linkedAppointment?.organization_id || linkedAppointment?.clinic_id || clinicId, 120),
        clinic_id: clinicId,
        patient_id: patientId,
        patient_name: sanitizeString(req.body?.patient_name || req.body?.patientName, 180),
        therapist_id: resolvedProfessionalId,
        therapeutic_plan_id: sessionTherapeuticPlanId,
        device_id: sanitizeString(req.body?.device_id || req.body?.deviceId, 180),
        source: requestSource,
        status: sessionStatus,
        appointment_id: appointmentId,
        scheduled_start_at: req.body?.scheduled_start || req.body?.scheduledStart || req.body?.scheduled_start_at || req.body?.scheduledStartAt
          ? sanitizeIsoDateTime(req.body?.scheduled_start || req.body?.scheduledStart || req.body?.scheduled_start_at || req.body?.scheduledStartAt)
          : linkedAppointment?.scheduled_start_at || linkedAppointment?.scheduled_at || null,
        scheduled_end_at: req.body?.scheduled_end || req.body?.scheduledEnd || req.body?.scheduled_end_at || req.body?.scheduledEndAt
          ? sanitizeIsoDateTime(req.body?.scheduled_end || req.body?.scheduledEnd || req.body?.scheduled_end_at || req.body?.scheduledEndAt)
          : linkedAppointment?.scheduled_end_at || null,
        scheduled_duration_minutes: req.body?.scheduled_duration_minutes !== undefined || req.body?.scheduledDurationMinutes !== undefined
          ? asSafeNumber(req.body?.scheduled_duration_minutes ?? req.body?.scheduledDurationMinutes, 0, 1440)
          : linkedAppointment?.scheduled_duration_minutes || linkedAppointment?.duration_minutes || null,
        actual_start_at: resolvedActualStartAt,
        actual_end_at: resolvedActualEndAt,
        actual_duration_minutes: req.body?.actual_duration_minutes !== undefined || req.body?.actualDurationMinutes !== undefined
          ? asSafeNumber(req.body?.actual_duration_minutes ?? req.body?.actualDurationMinutes, 0, 1440)
          : calculateAbaSessionDurationMinutes(resolvedActualStartAt, resolvedActualEndAt),
        room_id: sanitizeString(req.body?.room_id || req.body?.roomId || linkedAppointment?.room_id, 180) || null,
        room_name: sanitizeString(req.body?.room_name || req.body?.roomName || linkedAppointment?.room_name, 180) || null,
        location_type: sanitizeString(req.body?.location_type || req.body?.locationType || linkedAppointment?.location_type, 80) || null,
        care_setting: normalizeCareSetting(
          linkedAppointment?.care_setting || req.body?.care_setting || req.body?.careSetting,
          linkedAppointment?.location_type || req.body?.location_type || req.body?.locationType,
        ),
        school_id: isUuid(sanitizeString(linkedAppointment?.school_id, 120))
          ? sanitizeString(linkedAppointment?.school_id, 120)
          : null,
        school_unit_id: isUuid(sanitizeString(linkedAppointment?.school_unit_id, 120))
          ? sanitizeString(linkedAppointment?.school_unit_id, 120)
          : null,
        location_name_snapshot: sanitizeString(
          linkedAppointment?.location_name_snapshot ||
            linkedAppointment?.room_name ||
            req.body?.location_name_snapshot ||
            req.body?.locationNameSnapshot,
          180,
        ) || null,
        location_context_snapshot: sanitizeClinicalPayload({
          source: linkedAppointment?.id ? 'APPOINTMENT_SNAPSHOT' : 'SESSION_INPUT',
          appointmentId: linkedAppointment?.id || null,
          careSetting: linkedAppointment?.care_setting || req.body?.care_setting || req.body?.careSetting || null,
          schoolId: linkedAppointment?.school_id || null,
          schoolUnitId: linkedAppointment?.school_unit_id || null,
          locationName: linkedAppointment?.location_name_snapshot || linkedAppointment?.room_name || null,
          locationAddress: linkedAppointment?.location_address_snapshot || null,
          locationSource: linkedAppointment?.location_source || null,
          locationTimezone: sessionLocationTimezone,
          locationSnapshot: parseStoredJsonObject(linkedAppointment?.location_snapshot),
        }),
        service_type: sanitizeString(req.body?.service_type || req.body?.serviceType || linkedAppointment?.service_type || linkedAppointment?.approach, 120) || null,
        started_at: persistedSessionStartedAt,
        ended_at: req.body?.ended_at || req.body?.endedAt ? sanitizeIsoDateTime(req.body?.ended_at || req.body?.endedAt, startedAt) : resolvedActualEndAt,
        duration_seconds: req.body?.duration_seconds !== undefined || req.body?.durationSeconds !== undefined
          ? asSafeNumber(req.body?.duration_seconds ?? req.body?.durationSeconds, 0, 86400)
          : null,
        duration_minutes: req.body?.duration_minutes !== undefined || req.body?.durationMinutes !== undefined
          ? asSafeNumber(req.body?.duration_minutes ?? req.body?.durationMinutes, 0, 1440)
          : calculateAbaSessionDurationMinutes(resolvedActualStartAt, resolvedActualEndAt),
        reference_date: serverReferenceDate,
        record_count: existingInProgressSession?.record_count ?? (asSafeNumber(req.body?.record_count ?? req.body?.recordCount, 0, 100000) || 0),
        sync_status: 'synced',
        notes: sanitizeTextField(req.body?.notes, 2000),
        created_by: sanitizeString(req.session.user?.id, 120),
        updated_at: new Date().toISOString()
      });

      const result = await writeAbaRowWithSchemaFallback('aba_sessions', payload, 'upsert', {
        criticalColumns: sessionTherapeuticPlanId ? ['therapeutic_plan_id'] : []
      });
      if (result.error) throw result.error;
      appointmentClaimNeedsRelease = false;
      if (payload.appointment_id) {
        const appointmentStatus = payload.status === 'completed'
          ? 'COMPLETED'
          : isAbaSessionInProgressStatus(payload.status)
            ? 'IN_PROGRESS'
            : null;
        if (appointmentStatus) {
          await patchAppointmentOperationalFromAbaSession({
            appointmentId: payload.appointment_id,
            user: req.session.user,
            status: appointmentStatus,
            actualStartAt: payload.actual_start_at || payload.started_at,
            actualEndAt: payload.actual_end_at || payload.ended_at,
            actualDurationMinutes: payload.actual_duration_minutes || payload.duration_minutes,
            abaSessionId: payload.id
          });
        }
        await regenerateClosureForAppointments(
          [payload.appointment_id],
          req.session.user,
          'aba_session_saved'
        );
        if (appointmentStatus === 'COMPLETED') {
          await runTissPipelineForAppointment({
            appointmentId: payload.appointment_id,
            user: req.session.user,
            reason: 'session_completed',
            mode: 'best_effort',
            revalidateAppointment: revalidateAppointmentBillingForAppointment,
            forceClosure: true,
            logger: console
          });
        }
      }
      const data = { ...payload, id: (result.data as any)?.id || payload.id };
      return res.json({ success: true, idempotent: Boolean(existingInProgressSession?.id), data, session: data });
    } catch (error: any) {
      if (appointmentClaimNeedsRelease && isUuid(claimedAppointmentId) && claimedSessionId) {
        try {
          await supabase.rpc('release_appointment_session_start_claim_v1', {
            p_actor_id: sanitizeString(req.session.user?.id, 120),
            p_clinic_id: sanitizeString(currentClinicId(req.session.user), 120),
            p_appointment_id: claimedAppointmentId,
            p_session_id: claimedSessionId
          });
        } catch (releaseError: any) {
          console.warn('[ABA Sessions] Falha ao liberar reserva de início após erro.', {
            appointmentId: claimedAppointmentId,
            message: sanitizeString(releaseError?.message || releaseError, 240)
          });
        }
      }
      console.error('[ABA Sessions] start error:', error?.message || String(error));
      const sessionStartError = String(error?.message || error?.code || '');
      if (/therapeutic_plan_id|ABA_SESSION_SPECIALTY_PLAN_SCOPE_INVALID|ABA_SESSION_SPECIALTY_PLAN_ACCESS_DENIED|ABA_SESSION_THERAPEUTIC_PLAN_IMMUTABLE/i.test(sessionStartError)) {
        return res.status(/ACCESS_DENIED/i.test(sessionStartError) ? 403 : /IMMUTABLE/i.test(sessionStartError) ? 409 : 503).json({
          success: false,
          code: /ACCESS_DENIED/i.test(sessionStartError)
            ? 'SESSION_THERAPEUTIC_PLAN_ACCESS_DENIED'
            : /IMMUTABLE/i.test(sessionStartError)
              ? 'SESSION_THERAPEUTIC_PLAN_CONTEXT_IMMUTABLE'
              : 'SESSION_THERAPEUTIC_PLAN_SCHEMA_REQUIRED',
          error: /ACCESS_DENIED/i.test(sessionStartError)
            ? 'Você não possui vínculo clínico de escrita com este plano.'
            : /IMMUTABLE/i.test(sessionStartError)
              ? 'O plano clínico desta sessão já foi fixado e não pode ser alterado.'
              : 'A vinculação segura entre sessão e plano por especialidade ainda precisa ser aplicada no banco.'
        });
      }
      if (hasMissingFinancialSchema(error) || /claim_appointment_for_session_start_v1|active_aba_session_id|session_start_previous_status|PGRST202|42883|42703/i.test(sessionStartError)) {
        return res.status(503).json({
          success: false,
          code: 'SESSION_ATTENDANCE_POLICY_MIGRATION_REQUIRED',
          retryable: false,
          error: 'A atualização de presença, encerramento e falta ainda precisa ser aplicada no banco.'
        });
      }
      return res.status(500).json({ success: false, error: 'Não foi possível iniciar a sessão agora.' });
    }
  };
}
export function createAbaSessionCompleteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, buildSessionMetricSnapshots, currentClinicId, currentClinicTimeZone, enforcePayloadLimit, evaluateAndPersistSessionMaintenance, evaluateAndPersistSessionMastery, extractMissingColumnName, hasGlobalClinicAccess, hasMissingFinancialSchema, isAbaV3CollectionApiEnabled, isMissingRelationError, isUuid, persistActivityLog, regenerateClosureForAppointments, resolveAbaAppointmentIdForClinicalWrite, runTissPipelineForAppointment, sanitizeClinicalPayload, sanitizeIsoDateTime, sanitizeString, sanitizeTextField, stableHashPayload, supabase, APPOINTMENT_CLOSURE_CHECK_SELECT } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 192 * 1024, 'Encerramento da sessão ABA')) return;
      const sessionId = sanitizeString(req.params.sessionId, 180);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const patientId = sanitizeString(req.resolvedPatientId || req.body?.patient_id || req.body?.patientId, 120);
      if (!sessionId) return res.status(400).json({ success: false, error: 'Sessão inválida.' });
      if (!isUuid(clinicId) || !isUuid(actorId)) return res.status(403).json({ success: false, error: 'Clínica ou usuário não identificado.' });
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      const attendanceStatus = sanitizeString(req.body?.attendance_status || req.body?.attendanceStatus, 40).toUpperCase();
      const attendanceStatuses = new Set(['ATTENDED', 'LATE', 'PARTIAL', 'NO_SHOW', 'CANCELLED_PATIENT', 'CANCELLED_CLINIC']);
      if (!attendanceStatuses.has(attendanceStatus)) {
        return res.status(422).json({
          success: false,
          code: 'SESSION_COMPLETION_ATTENDANCE_INVALID',
          error: 'Selecione uma situação de presença válida.'
        });
      }

      const endedAt = sanitizeIsoDateTime(req.body?.ended_at || req.body?.endedAt || new Date().toISOString());
      const sessionNote = sanitizeTextField(req.body?.session_note ?? req.body?.sessionNote, 4000);
      const idempotencyKey = sanitizeString(
        req.body?.idempotencyKey || req.body?.idempotency_key || req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'],
        180
      );
      if (!idempotencyKey) {
        return res.status(422).json({
          success: false,
          code: 'SESSION_COMPLETION_IDEMPOTENCY_REQUIRED',
          error: 'A confirmação precisa de uma chave idempotente.'
        });
      }

      const requestedAppointmentId = sanitizeString(req.body?.appointment_id || req.body?.appointmentId, 120);
      if (requestedAppointmentId && !isUuid(requestedAppointmentId)) {
        return res.status(400).json({ success: false, error: 'Agendamento inválido.' });
      }
      const appointmentId = await resolveAbaAppointmentIdForClinicalWrite({
        requestedAppointmentId: requestedAppointmentId || null,
        sessionId,
        patientId,
        clinicId,
        user: req.session.user
      });
      if (requestedAppointmentId && !appointmentId) {
        return res.status(403).json({
          success: false,
          code: 'SESSION_COMPLETION_APPOINTMENT_SCOPE_INVALID',
          error: 'O agendamento não pertence a este paciente ou clínica.'
        });
      }

      const rawSummary = req.body?.summary && typeof req.body.summary === 'object' && !Array.isArray(req.body.summary)
        ? req.body.summary
        : {};
      const safeArray = (value: any) => sanitizeClinicalPayload(Array.isArray(value) ? value : []);
      const summaryPayload = sanitizeClinicalPayload({
        ...rawSummary,
        id: sanitizeString(`summary-${sessionId}`, 180),
        sessionId,
        patientId,
        therapistId: actorId,
        totalTrials: asSafeNumber(rawSummary?.totalTrials, 0, 100000) || 0,
        independentTrials: asSafeNumber(rawSummary?.independentTrials, 0, 100000) || 0,
        promptedTrials: asSafeNumber(rawSummary?.promptedTrials, 0, 100000) || 0,
        errorTrials: asSafeNumber(rawSummary?.errorTrials, 0, 100000) || 0,
        accuracyPercent: asSafeNumber(rawSummary?.accuracyPercent, 0, 100) || 0,
        independencePercent: asSafeNumber(rawSummary?.independencePercent, 0, 100) || 0,
        totalBehaviorEvents: asSafeNumber(rawSummary?.totalBehaviorEvents, 0, 100000) || 0,
        trialTypesUsed: safeArray(rawSummary?.trialTypesUsed),
        frequencySummary: safeArray(rawSummary?.frequencySummary),
        durationSummary: safeArray(rawSummary?.durationSummary),
        intervalSummary: safeArray(rawSummary?.intervalSummary),
        abcSummary: safeArray(rawSummary?.abcSummary),
        masterySummary: safeArray(rawSummary?.masterySummary),
        maintenanceSummary: safeArray(rawSummary?.maintenanceSummary),
        blockingItems: safeArray(rawSummary?.blockingItems),
        warningItems: safeArray(rawSummary?.warningItems),
        pendingItems: safeArray(rawSummary?.pendingItems),
        pendingWarnings: safeArray(rawSummary?.pendingWarnings),
        attendanceStatus,
        endedAt,
        createdAt: endedAt,
        sessionNote,
        source: 'verto_web'
      });
      const requestHash = stableHashPayload({
        clinicId,
        patientId,
        sessionId,
        appointmentId: appointmentId || null,
        attendanceStatus,
        endedAt,
        sessionNote,
        summary: summaryPayload
      });

      const useAbaV3Completion = isAbaV3CollectionApiEnabled();
      const completionResult = await supabase.rpc(
        useAbaV3Completion ? 'complete_aba_session_v3' : 'complete_aba_session_atomic_v1',
        useAbaV3Completion
          ? {
              p_actor_id: actorId,
              p_clinic_id: clinicId,
              p_patient_id: patientId,
              p_session_id: sessionId,
              p_appointment_id: appointmentId || null,
              p_attendance_status: attendanceStatus,
              p_ended_at: endedAt,
              p_session_note: sessionNote,
              p_legacy_v2_summary: summaryPayload,
              p_idempotency_key: idempotencyKey,
              p_payload_hash: requestHash
            }
          : {
              p_actor_id: actorId,
              p_clinic_id: clinicId,
              p_patient_id: patientId,
              p_session_id: sessionId,
              p_appointment_id: appointmentId || null,
              p_attendance_status: attendanceStatus,
              p_ended_at: endedAt,
              p_session_note: sessionNote,
              p_summary: summaryPayload,
              p_idempotency_key: idempotencyKey,
              p_payload_hash: requestHash
            }
      );
      if (completionResult.error) throw completionResult.error;

      const rpcResponse = completionResult.data && typeof completionResult.data === 'object'
        ? completionResult.data as any
        : {};
      const completionData = rpcResponse?.data && typeof rpcResponse.data === 'object'
        ? rpcResponse.data as any
        : {};
      const attended = ['ATTENDED', 'LATE', 'PARTIAL'].includes(attendanceStatus);
      const completionTherapistId = sanitizeString(completionData?.therapistId || actorId, 120);
      let masterySummary = safeArray(rawSummary?.masterySummary);
      let maintenanceSummary = safeArray(rawSummary?.maintenanceSummary);

      if (attended) {
        try {
          const evaluatedMastery = await evaluateAndPersistSessionMastery({
            sessionId,
            patientId,
            clinicId,
            therapistId: completionTherapistId,
            evaluatedAt: completionData?.endedAt || endedAt
          });
          if (evaluatedMastery.length > 0) masterySummary = sanitizeClinicalPayload(evaluatedMastery);
        } catch (masteryError: any) {
          console.warn('[ABA Mastery] Falha não bloqueante após encerramento atômico:', masteryError?.message || String(masteryError));
        }
        try {
          const evaluatedMaintenance = await evaluateAndPersistSessionMaintenance({
            sessionId,
            patientId,
            clinicId,
            therapistId: completionTherapistId,
            evaluatedAt: completionData?.endedAt || endedAt,
            appointmentId: appointmentId || null
          });
          if (evaluatedMaintenance.length > 0) maintenanceSummary = sanitizeClinicalPayload(evaluatedMaintenance);
        } catch (maintenanceError: any) {
          console.warn('[ABA Maintenance] Falha não bloqueante após encerramento atômico:', maintenanceError?.message || String(maintenanceError));
        }
        try {
          await buildSessionMetricSnapshots(sessionId);
        } catch (snapshotError: any) {
          console.warn('[ABA Charts] Falha não bloqueante ao gerar snapshots:', snapshotError?.message || String(snapshotError));
        }
      }

      let closure: any = null;
      let billingStatus = attendanceStatus === 'NO_SHOW' || attendanceStatus.startsWith('CANCELLED_')
        ? 'NOT_BILLABLE'
        : 'PENDING_REVIEW';
      const completedAppointmentId = sanitizeString(completionData?.appointmentId || appointmentId, 120);
      if (isUuid(completedAppointmentId)) {
        await regenerateClosureForAppointments(
          [completedAppointmentId],
          req.session.user,
          'aba_session_completed_atomic'
        );
        if (attended) {
          try {
            await runTissPipelineForAppointment({
              appointmentId: completedAppointmentId,
              user: req.session.user,
              reason: 'session_completed',
              mode: 'best_effort',
              revalidateAppointment: revalidateAppointmentBillingForAppointment,
              forceClosure: true,
              logger: console
            });
          } catch (tissError: any) {
            console.warn('[TISS] Falha não bloqueante após encerramento atômico:', tissError?.message || String(tissError));
          }
        }

        let closureQuery = supabase
          .from('appointment_closure_checks')
          .select(APPOINTMENT_CLOSURE_CHECK_SELECT)
          .eq('appointment_id', completedAppointmentId)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (!hasGlobalClinicAccess(req.session.user)) closureQuery = closureQuery.eq('organization_id', clinicId);
        const closureResult = await closureQuery.maybeSingle();
        if (!closureResult.error) {
          closure = closureResult.data || null;
          const readinessStatus = sanitizeString(closure?.readiness_status, 40).toUpperCase();
          if (readinessStatus === 'READY') billingStatus = 'READY';
          else if (readinessStatus === 'NOT_BILLABLE') billingStatus = 'NOT_BILLABLE';
          else if (attended) billingStatus = 'PENDING_REVIEW';
        } else if (!hasMissingFinancialSchema(closureResult.error) && !isMissingRelationError(closureResult.error)) {
          console.warn('[Closure] Falha não bloqueante ao ler fechamento após sessão:', closureResult.error.message);
        }
      }

      const summaryId = sanitizeString(completionData?.summaryId || summaryPayload?.id, 180);
      if (summaryId) {
        const summaryUpdate = await supabase
          .from('aba_session_summaries')
          .update({
            mastery_summary: masterySummary,
            maintenance_summary: maintenanceSummary,
            billing_status: billingStatus,
            summary_payload: sanitizeClinicalPayload({
              ...summaryPayload,
              masterySummary,
              maintenanceSummary,
              attendanceStatus,
              billingStatus,
              therapistId: completionTherapistId,
              appointmentId: completedAppointmentId || null,
              sessionNote
            }),
            updated_at: new Date().toISOString()
          })
          .eq('id', summaryId)
          .eq('clinic_id', clinicId);
        if (summaryUpdate.error && !hasMissingFinancialSchema(summaryUpdate.error) && !extractMissingColumnName(summaryUpdate.error)) {
          console.warn('[ABA Sessions] Falha não bloqueante ao complementar resumo atômico:', summaryUpdate.error.message);
        }
      }

      const auditPersisted = await persistActivityLog({
        userId: actorId,
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Profissional', 180),
        title: 'Sessão ABA finalizada',
        content: 'A sessão clínica foi finalizada e o relatório permaneceu disponível no prontuário conforme as permissões de acesso.',
        type: 'clinical',
        action: 'aba_session_completed',
        actionType: 'aba_session_completed',
        payloadDetails: JSON.stringify({
          sessionId,
          patientId,
          appointmentId: completedAppointmentId || null,
          summaryId: summaryId || completionData?.summaryId || null,
          attendanceStatus,
          billingStatus,
          endedAt
        }),
        resourceType: 'aba_session',
        resourceId: sessionId,
        patientId,
        sessionId,
        timezone: currentClinicTimeZone(req.session.user),
        immutableAudit: true,
        idempotencyKey: `aba-session-complete:${clinicId}:${sessionId}:${idempotencyKey}`
      });

      return res.json({
        success: true,
        auditPersisted,
        ...(auditPersisted ? {} : { warning: 'Sessão finalizada; auditoria pendente de reconciliação.' }),
        idempotentReplay: Boolean(rpcResponse?.idempotentReplay),
        data: {
          ...completionData,
          summaryId: summaryId || completionData?.summaryId,
          appointmentId: completedAppointmentId || null,
          attendanceStatus,
          billingStatus,
          closure,
          masterySummary,
          maintenanceSummary
        }
      });
    } catch (error: any) {
      const message = String(error?.message || error?.code || '');
      if (/SESSION_COMPLETION_IDEMPOTENCY_CONFLICT/i.test(message)) {
        return res.status(409).json({ success: false, code: 'SESSION_COMPLETION_IDEMPOTENCY_CONFLICT', error: 'Esta confirmação já foi enviada com dados diferentes.' });
      }
      if (/SESSION_COMPLETION_NO_SHOW_REOPEN_REQUIRED/i.test(message)) {
        return res.status(409).json({ success: false, code: 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED', error: 'O atendimento foi classificado como falta. Reabra a falta antes de concluir como comparecimento.' });
      }
      if (/SESSION_COMPLETION_ALREADY_FINALIZED/i.test(message)) {
        return res.status(409).json({ success: false, code: 'SESSION_ALREADY_FINALIZED', error: 'Esta sessão já foi encerrada.' });
      }
      if (/SESSION_COMPLETION_ABSENCE_HAS_CLINICAL_RECORDS/i.test(message)) {
        return res.status(409).json({ success: false, code: 'ABSENCE_HAS_CLINICAL_RECORDS', error: 'Não é possível registrar falta ou cancelamento porque esta sessão já possui registros clínicos.' });
      }
      if (/SESSION_COMPLETION_SESSION_NOT_FOUND/i.test(message)) {
        return res.status(404).json({
          success: false,
          code: 'SESSION_COMPLETION_NOT_FOUND',
          missingResource: 'session',
          recoverable: true,
          error: 'Sessão não encontrada no servidor.'
        });
      }
      if (/SESSION_COMPLETION_APPOINTMENT_NOT_FOUND/i.test(message)) {
        return res.status(404).json({
          success: false,
          code: 'SESSION_COMPLETION_NOT_FOUND',
          missingResource: 'appointment',
          recoverable: false,
          error: 'Agendamento vinculado à sessão não encontrado.'
        });
      }
      if (/SESSION_COMPLETION_ACCESS_DENIED|SESSION_COMPLETION_ACTOR_MISMATCH/i.test(message)) {
        return res.status(403).json({ success: false, code: 'SESSION_COMPLETION_ACCESS_DENIED', error: 'Você não possui permissão para encerrar esta sessão.' });
      }
      if (/SESSION_COMPLETION_SUMMARY_TOO_LARGE|SESSION_COMPLETION_NOTE_TOO_LARGE/i.test(message)) {
        return res.status(413).json({ success: false, code: 'SESSION_COMPLETION_PAYLOAD_TOO_LARGE', error: 'O resumo excede o tamanho permitido.' });
      }
      if (/SESSION_COMPLETION_ATTENDANCE_INVALID|SESSION_COMPLETION_ABSENCE_REASON_REQUIRED|SESSION_COMPLETION_END_TIME_INVALID|SESSION_COMPLETION_END_BEFORE_START|SESSION_COMPLETION_REQUIRED|SESSION_COMPLETION_IDEMPOTENCY_REQUIRED/i.test(message)) {
        return res.status(422).json({ success: false, code: 'SESSION_COMPLETION_VALIDATION_FAILED', error: 'Revise presença, motivo e horários antes de encerrar.' });
      }
      if (/complete_aba_session_v3|complete_aba_session_atomic_v1|attendance_status|billing_status|aba_session_completion_operations|appointment_attendance_audit_events|PGRST202|42883|42703/i.test(message)) {
        return res.status(503).json({
          success: false,
          code: 'SESSION_ATTENDANCE_POLICY_MIGRATION_REQUIRED',
          retryable: false,
          error: 'A atualização de presença, encerramento e falta ainda precisa ser aplicada no banco.'
        });
      }
      console.error('[ABA Sessions] completion error:', sanitizeString(message, 600));
      return res.status(500).json({ success: false, error: 'Não foi possível encerrar a sessão agora. Nenhum dado clínico foi descartado.' });
    }
  };
}
