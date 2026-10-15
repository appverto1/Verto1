// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createPatientSelfHistoryReadHandler(getDeps: () => { resolveCanonicalPatientPortalScope: any; parseBoundedListLimit: any; fetchHistoryWithSchemaFallback: any; supabase: any; fetchAssignedTasksWithSchemaFallback: any; isMissingRelationError: any; sanitizeString: (value: unknown, maxLength?: number) => string; crypto: any; cleanObject: any; effortEmojiForPercent: any; asSafeNumber: any; effortLabelForPercent: any; fetchTasksWithSchemaFallback: any; requestIdForLogs: any; sanitizeTextField: any; enrichPatientPhotoHistoryRow: any; updatePatientStatusIfNeeded: any; buildSessionUserPayload: any }) {
  return async (req: any, res) => {
    const { resolveCanonicalPatientPortalScope, parseBoundedListLimit, fetchHistoryWithSchemaFallback, supabase, fetchAssignedTasksWithSchemaFallback, isMissingRelationError, sanitizeString, crypto, cleanObject, effortEmojiForPercent, asSafeNumber, effortLabelForPercent, fetchTasksWithSchemaFallback, requestIdForLogs, sanitizeTextField, enrichPatientPhotoHistoryRow, updatePatientStatusIfNeeded, buildSessionUserPayload } = getDeps();
    try {
      const portalScope = await resolveCanonicalPatientPortalScope(req.session.user);
      if (!portalScope) {
        return res.status(409).json({
          success: false,
          code: 'PATIENT_PORTAL_CONTEXT_REQUIRED',
          error: 'Selecione novamente o acesso do paciente para continuar.'
        });
      }

      const limit = parseBoundedListLimit(req.query?.limit, 20, 50);
      const historyByIdResult = await fetchHistoryWithSchemaFallback({
        supabase,
        patientId: portalScope.patientId,
        limit,
        route: '/api/patient/self/history',
        logger: console
      });
      if (historyByIdResult.error) throw historyByIdResult.error;
      const historyById = Array.isArray(historyByIdResult.data) ? historyByIdResult.data : [];

      const dedupedHistory = Array.from(
        new Map(
          historyById.map((item: any) => {
            const key = String(item?.id || `${item?.patient_id || ''}|${item?.type || ''}|${item?.title || ''}|${item?.created_at || ''}|${item?.score ?? ''}`);
            return [key, item];
          })
        ).values()
      );

      const assignedRowsResult = await fetchAssignedTasksWithSchemaFallback({
        supabase,
        patientId: portalScope.patientId,
        clinicId: portalScope.clinicId,
        status: 'completed',
        orderBy: 'completed_at',
        limit,
        route: '/api/patient/self/history',
        logger: console
      });
      if (assignedRowsResult.error && !isMissingRelationError(assignedRowsResult.error)) {
        throw assignedRowsResult.error;
      }
      const assignedRows = Array.isArray(assignedRowsResult.data) ? assignedRowsResult.data : [];

      const persistedAssignedTaskHistoryIds = new Set(
        dedupedHistory
          .map((item: any) => sanitizeString(item?.assigned_task_id || item?.assignedTaskId, 120))
          .filter(Boolean)
      );
      const mappedAssignedHistory = Array.from(new Map(assignedRows.map((task: any) => [String(task?.id || crypto.randomUUID()), task])).values())
        .filter((task: any) => !persistedAssignedTaskHistoryIds.has(sanitizeString(task?.id, 120)))
        .map((task: any) => {
        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
        return {
          id: `assigned:${task.id}`,
          patient_id: task.patient_id,
          patient_email: task.patient_email,
          type: task.task_type || 'task',
          title: taskData.title || 'Tarefa concluída',
          score: task.pro_score ?? null,
          energy: task.patient_effort ?? null,
          note: task.patient_comment || task.pro_review_note || '',
          icon: taskData.icon || '📌',
          created_at: task.completed_at || task.updated_at || task.created_at,
          assigned_task_id: task.id,
          source: 'assigned_task_completion',
          task_data: cleanObject({
            ...taskData,
            patientEffort: task.patient_effort ?? taskData?.patientEffort ?? null,
            patient_effort: task.patient_effort ?? taskData?.patient_effort ?? null,
            patientEffortEmoji: task.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || effortEmojiForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patient_effort_emoji: task.patient_effort_emoji || taskData?.patient_effort_emoji || taskData?.patientEffortEmoji || effortEmojiForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patientEffortLabel: task.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || effortLabelForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patient_effort_label: task.patient_effort_label || taskData?.patient_effort_label || taskData?.patientEffortLabel || effortLabelForPercent(asSafeNumber(task.patient_effort, 0, 100))
          })
        };
      });

      const tasksByIdResult = await fetchTasksWithSchemaFallback({
        supabase,
        patientId: portalScope.patientId,
        limit,
        route: '/api/patient/self/history',
        requestId: requestIdForLogs(req),
        logger: console
      });
      if (tasksByIdResult.error) {
        console.warn('[PatientSelfHistory] tasks by id warning:', tasksByIdResult.error.message || String(tasksByIdResult.error));
      }
      const taskRows = Array.isArray(tasksByIdResult.data) ? tasksByIdResult.data : [];
      const mappedTaskScoreHistory = Array.from(
        new Map(
          taskRows.map((t: any) => [String(t?.id || crypto.randomUUID()), t])
        ).values()
      )
        .filter((t: any) => t?.pro_score !== null && t?.pro_score !== undefined)
        .map((t: any) => ({
          id: `taskscore:${t.id}`,
          patient_id: t.patient_id,
          patient_email: t.patient_email,
          type: String(t.type || 'task'),
          title: sanitizeTextField(t.title || 'Tarefa avaliada', 180),
          score: asSafeNumber(t.pro_score, 0, 100),
          energy: null,
          note: '',
          icon: sanitizeString(t.icon, 40) || '🎯',
          created_at: t.updated_at || t.created_at
        }));

      const patientVisibleHistory = [...dedupedHistory, ...mappedAssignedHistory, ...mappedTaskScoreHistory].filter((row: any) => {
        const type = sanitizeString(row?.type, 80).toLowerCase();
        const source = sanitizeString(row?.source, 120).toLowerCase();
        if (['audit', 'system', 'internal', 'supervision', 'professional_private'].includes(type)) return false;
        if (/^(closure_|internal_|supervision_|technical_)/.test(source)) return false;
        return true;
      });
      const consolidatedHistory = patientVisibleHistory
        .sort((a: any, b: any) => {
          const aTs = new Date(a?.created_at || 0).getTime();
          const bTs = new Date(b?.created_at || 0).getTime();
          return bTs - aTs;
        })
        .slice(0, limit);
      const enrichedHistory = consolidatedHistory.map(enrichPatientPhotoHistoryRow);

      const treatmentStatus = await updatePatientStatusIfNeeded(req.session.user);
      req.session.user.treatmentStatus = treatmentStatus;
      req.session.user = buildSessionUserPayload(req.session.user);
      void req.session.save(() => {});

      res.json({ success: true, data: enrichedHistory, treatmentStatus });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  };
}

export function createPatientSelfAssignedTasksReadHandler(getDeps: () => { resolveCanonicalPatientPortalScope: any; parseBoundedListLimit: any; fetchAssignedTasksWithSchemaFallback: any; supabase: any; isMissingRelationError: any; crypto: any; sanitizeString: (value: unknown, maxLength?: number) => string; fetchTasksWithSchemaFallback: any; requestIdForLogs: any; uuidFromStableString: any; sanitizeEmail: any; sanitizeTextField: any; asSafeNumber: any; parseTaskScheduleToMs: any }) {
  return async (req: any, res) => {
    const { resolveCanonicalPatientPortalScope, parseBoundedListLimit, fetchAssignedTasksWithSchemaFallback, supabase, isMissingRelationError, crypto, sanitizeString, fetchTasksWithSchemaFallback, requestIdForLogs, uuidFromStableString, sanitizeEmail, sanitizeTextField, asSafeNumber, parseTaskScheduleToMs } = getDeps();
    try {
      const portalScope = await resolveCanonicalPatientPortalScope(req.session.user);
      if (!portalScope) {
        return res.status(409).json({
          success: false,
          code: 'PATIENT_PORTAL_CONTEXT_REQUIRED',
          error: 'Selecione novamente o acesso do paciente para continuar.'
        });
      }

      const limit = parseBoundedListLimit(req.query?.limit, 20, 50);
      const assignedResult = await fetchAssignedTasksWithSchemaFallback({
        supabase,
        patientId: portalScope.patientId,
        clinicId: portalScope.clinicId,
        orderBy: 'scheduled_at',
        limit,
        route: '/api/patient/self/assigned-tasks',
        logger: console
      });
      if (assignedResult.error) {
        if (isMissingRelationError(assignedResult.error) || /assigned_tasks/i.test(String(assignedResult.error?.message || ''))) {
          return res.status(200).json({ success: true, data: [], warning: 'Tabela assigned_tasks não criada.' });
        }
        throw assignedResult.error;
      }

      const nowIso = new Date().toISOString();
      const mergedAssigned = Array.from(
        new Map(
          (Array.isArray(assignedResult.data) ? assignedResult.data : []).map((row: any) => [
            String(row?.id || crypto.randomUUID()),
            row
          ])
        ).values()
      );

      // Fallback robusto: caso assigned_tasks esteja vazio/indisponível para este paciente,
      // também lemos tarefas pendentes da tabela legacy `tasks` com scheduled_at.
      const isPendingLegacyTask = (task: any) => {
        const status = sanitizeString(task?.status, 40).toLowerCase();
        if (status) return status !== 'completed' && status !== 'done';
        if (typeof task?.is_completed === 'boolean') return !task.is_completed;
        if (typeof task?.done === 'boolean') return !task.done;
        if (typeof task?.completed === 'boolean') return !task.completed;
        return true;
      };
      const legacyTasksByIdResult = await fetchTasksWithSchemaFallback({
        supabase,
        patientId: portalScope.patientId,
        limit,
        route: '/api/patient/self/assigned-tasks',
        requestId: requestIdForLogs(req),
        logger: console
      });
      if (legacyTasksByIdResult.error) {
        console.warn('[PatientSelfAssignedTasks] fallback tasks by id warning:', legacyTasksByIdResult.error.message || String(legacyTasksByIdResult.error));
      }
      const legacyTasksById = Array.isArray(legacyTasksByIdResult.data) ? legacyTasksByIdResult.data : [];

      const legacyTaskRows = Array.from(
        new Map(
          legacyTasksById.map((row: any) => [
            String(row?.id || crypto.randomUUID()),
            row
          ])
        ).values()
      );
      const legacyBridgeIdByTaskId = new Map(
        legacyTaskRows
          .map((task: any) => {
            const legacyTaskId = sanitizeString(task?.id, 120);
            if (!legacyTaskId) return null;
            return [
              legacyTaskId,
              uuidFromStableString(`legacy-assigned-task:${portalScope.clinicId}:${portalScope.patientId}:${legacyTaskId}`)
            ] as const;
          })
          .filter(Boolean) as Array<readonly [string, string]>
      );
      const deterministicBridgeIds = Array.from(new Set(legacyBridgeIdByTaskId.values()));
      const existingBridgeAssignedIds = new Set<string>();
      if (deterministicBridgeIds.length > 0) {
        const { data: bridgeRows, error: bridgeRowsError } = await supabase
          .from('assigned_tasks')
          .select('id')
          .eq('clinic_id', portalScope.clinicId)
          .eq('patient_id', portalScope.patientId)
          .in('id', deterministicBridgeIds);
        if (bridgeRowsError) throw bridgeRowsError;
        for (const bridgeRow of Array.isArray(bridgeRows) ? bridgeRows : []) {
          const bridgeId = sanitizeString(bridgeRow?.id, 120);
          if (bridgeId) existingBridgeAssignedIds.add(bridgeId);
        }
      }

      const bridgedLegacyTaskIds = new Set(
        mergedAssigned
          .map((row: any) => {
            const taskData = row?.task_data && typeof row.task_data === 'object' ? row.task_data : {};
            return sanitizeString(taskData?.legacyTaskId || taskData?.legacy_task_id, 120);
          })
          .filter(Boolean)
      );

      const mergedLegacyTasks = legacyTaskRows
        .filter(isPendingLegacyTask)
        .filter((task: any) => {
          const legacyTaskId = sanitizeString(task?.id, 120);
          const bridgeId = legacyBridgeIdByTaskId.get(legacyTaskId);
          return Boolean(
            legacyTaskId &&
            !bridgedLegacyTaskIds.has(legacyTaskId) &&
            (!bridgeId || !existingBridgeAssignedIds.has(bridgeId))
          );
        })
        .map((task: any) => ({
        id: String(task?.id || crypto.randomUUID()),
        patient_id: sanitizeString(task?.patient_id, 120) || null,
        patient_email: sanitizeEmail(task?.patient_email),
        professional_id: sanitizeString(task?.therapist_id, 120) || null,
        task_type: sanitizeString(task?.type, 60) || 'task',
        task_data: {
          title: sanitizeString(task?.title, 240) || 'Tarefa agendada',
          description: sanitizeTextField(task?.description, 4000) || '',
          icon: sanitizeString(task?.icon, 40) || '🎯',
          color: sanitizeString(task?.color, 80) || 'bg-blue-100 text-blue-600',
          linkedTask: sanitizeString(task?.linked_task, 120) || undefined,
          maxScore: asSafeNumber(task?.max_score, 1, 100) ?? 4,
          legacyTaskId: sanitizeString(task?.id, 120) || undefined,
          legacy_task_id: sanitizeString(task?.id, 120) || undefined,
          legacySource: 'tasks',
          legacy_source: 'tasks'
        },
        scheduled_at: sanitizeString((task as any)?.scheduled_at, 80) || sanitizeString(task?.created_at, 80) || null,
        status: 'pending',
        _source: 'tasks_fallback'
      }));

      const merged = Array.from(
        new Map(
          [...mergedAssigned, ...mergedLegacyTasks].map((row: any) => [
            `${String(row?._source || 'assigned')}::${String(row?.id || crypto.randomUUID())}`,
            row
          ])
        ).values()
      );

      const visibleTasks = merged.filter((task: any) => {
        const scheduledAt = sanitizeString(task?.scheduled_at, 60);
        if (!scheduledAt) return true;
        const scheduledMs = parseTaskScheduleToMs(scheduledAt);
        const nowMs = Date.now();
        if (typeof scheduledMs === 'number' && Number.isFinite(scheduledMs)) return scheduledMs <= nowMs;
        return scheduledAt <= nowIso;
      });

      return res.json({ success: true, data: visibleTasks.slice(0, limit) });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  };
}
