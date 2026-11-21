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
