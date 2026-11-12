/**
 * Pure projections for adult clinical homework and longitudinal reviews.
 * Reads already-loaded data; persistence, authorization and clinical Save
 * remain in the existing patient panel and backend handlers.
 */

const ADULT_EFFORT_SEMANTICS_V2 = 'effort_min_0_max_100_v2';

export const getEffortEmoji = (value: any) => {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return '😐';
  if (percent < 20) return '🙂';
  if (percent < 40) return '😌';
  if (percent < 60) return '😐';
  if (percent < 80) return '😕';
  return '😫';
};

export const normalizeEffortPercent = (value: any) => {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
};

export const getAssignedTaskData = (task: any) =>
  task?.task_data && typeof task.task_data === 'object'
    ? task.task_data
    : task?.taskData && typeof task.taskData === 'object'
      ? task.taskData
      : {};

export const resolveAdultEffortSemantics = (task: any, taskData: any = getAssignedTaskData(task)) =>
  String(
    taskData?.patientEffortSemantics ||
    taskData?.patient_effort_semantics ||
    task?.patientEffortSemantics ||
    task?.patient_effort_semantics ||
    ''
  ).trim();

export const hasCanonicalAdultEffortSemantics = (task: any, taskData?: any) =>
  resolveAdultEffortSemantics(task, taskData) === ADULT_EFFORT_SEMANTICS_V2;

export const resolveAssignedTaskNumber = (...values: any[]) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

export const resolveAssignedTaskProfessionalScore = (task: any) => {
  const taskData = getAssignedTaskData(task);
  return resolveAssignedTaskNumber(
    task?.pro_score,
    task?.professionalScore,
    taskData?.pro_score,
    taskData?.proScore
  );
};

export const resolveAssignedTaskPatientEffort = (task: any, taskData: any = getAssignedTaskData(task)) =>
  resolveAssignedTaskNumber(
    task?.patient_effort,
    task?.patientEffort,
    taskData?.patientEffort,
    taskData?.patient_effort,
    task?.energy
  );

export const resolveAssignedTaskReviewNote = (task: any) => {
  const taskData = getAssignedTaskData(task);
  return String(
    task?.pro_review_note ??
    task?.proReviewNote ??
    taskData?.pro_review_note ??
    taskData?.proReviewNote ??
    taskData?.reviewNote ??
    task?.evolutionNote ??
    ''
  );
};

export const buildAdultCompletedTasks = (assignedTasks: any, patientTasks: any) => {
  const deduped = new Map<string, any>();
  const isLegacyCompletedTask = (task: any) => {
    const status = String(task?.status || '').toLowerCase();
    if (status) return status === 'completed' || status === 'done';
    if (typeof task?.is_completed === 'boolean') return task.is_completed;
    if (typeof task?.done === 'boolean') return task.done;
    if (typeof task?.completed === 'boolean') return task.completed;
    return false;
  };

  const completedAssigned = (assignedTasks || [])
    .filter((task: any) => String(task?.status || '').toLowerCase() === 'completed')
    .map((task: any) => {
      const taskData = getAssignedTaskData(task);
      const professionalScore = resolveAssignedTaskProfessionalScore(task);
      const executionDateRaw = task?.completed_at || task?.scheduled_at || task?.created_at;
      const reviewDateRaw = task?.reviewed_at || task?.updated_at || executionDateRaw;
      const eventDateRaw = professionalScore === null ? executionDateRaw : reviewDateRaw;
      const eventDate = eventDateRaw ? new Date(eventDateRaw) : new Date();
      const executionDate = executionDateRaw ? new Date(executionDateRaw) : eventDate;
      const reviewDate = reviewDateRaw ? new Date(reviewDateRaw) : null;
      const safeMaxScore = Math.max(
        1,
        Number(taskData?.maxScore ?? taskData?.max_score ?? task?.max_score ?? 4) || 4
      );
      const patientEffortRaw = resolveAssignedTaskPatientEffort(task, taskData);
      const patientEffort = patientEffortRaw === null ? null : normalizeEffortPercent(patientEffortRaw);
      return {
        ...task,
        taskData,
        eventDate,
        eventDateRaw,
        executionDate,
        executionDateRaw,
        reviewDate,
        reviewDateRaw,
        taskTitle: String(taskData?.title || task?.title || 'Tarefa'),
        taskType: String(task?.task_type || task?.type || 'task'),
        maxScore: safeMaxScore,
        patientEffort,
        patientEffortEmoji: patientEffort === null
          ? ''
          : String(task?.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || getEffortEmoji(patientEffort)),
        patientEffortLabel: String(task?.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || ''),
        patientEffortSemantics: resolveAdultEffortSemantics(task, taskData),
        patientComment: String(task?.patient_comment || ''),
        professionalScore,
        evolutionNote: resolveAssignedTaskReviewNote(task)
      };
    });

  const completedLegacy = (patientTasks || [])
    .filter((task: any) => isLegacyCompletedTask(task))
    .map((task: any) => {
      const professionalScore = resolveAssignedTaskProfessionalScore(task);
      const executionDateRaw = task?.completed_at || task?.scheduled_at || task?.created_at;
      const reviewDateRaw = task?.reviewed_at || task?.updated_at || executionDateRaw;
      const eventDateRaw = professionalScore === null ? executionDateRaw : reviewDateRaw;
      const eventDate = eventDateRaw ? new Date(eventDateRaw) : new Date();
      const executionDate = executionDateRaw ? new Date(executionDateRaw) : eventDate;
      const reviewDate = reviewDateRaw ? new Date(reviewDateRaw) : null;
      const safeMaxScore = Math.max(1, Number(task?.maxScore ?? task?.max_score ?? 4) || 4);
      const taskData = task?.taskData && typeof task.taskData === 'object'
        ? task.taskData
        : task?.task_data && typeof task.task_data === 'object'
          ? task.task_data
          : {};
      const patientEffortRaw = resolveAssignedTaskPatientEffort(task, taskData);
      const patientEffort = patientEffortRaw === null ? null : normalizeEffortPercent(patientEffortRaw);
      return {
        ...task,
        taskData,
        eventDate,
        eventDateRaw,
        executionDate,
        executionDateRaw,
        reviewDate,
        reviewDateRaw,
        taskTitle: String(task?.title || 'Tarefa'),
        taskType: String(task?.type || task?.task_type || 'task'),
        maxScore: safeMaxScore,
        patientEffort,
        patientEffortEmoji: patientEffort === null
          ? ''
          : String(task?.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || getEffortEmoji(patientEffort)),
        patientEffortLabel: String(task?.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || ''),
        patientEffortSemantics: resolveAdultEffortSemantics(task, taskData),
        patientComment: String(task?.patient_comment || task?.note || ''),
        professionalScore,
        evolutionNote: resolveAssignedTaskReviewNote(task) || String(task?.evolutionNote || task?.evalComment || '')
      };
    });

  [...completedAssigned, ...completedLegacy].forEach((task: any) => {
      const key = String(task?.assignedTaskId || task?.id || '') || [
        String(task?.patient_id || task?.patientId || ''),
        String(task?.taskTitle || ''),
        String(task?.eventDateRaw || ''),
      ].join('|');
      const prev = deduped.get(key);
      if (!prev || task.eventDate.getTime() >= prev.eventDate.getTime()) {
        deduped.set(key, task);
      }
    });

  return Array.from(deduped.values()).sort((a: any, b: any) => b.eventDate.getTime() - a.eventDate.getTime());

};

export const buildAdultScheduledTasks = (patientTasks: any, assignedTasks: any, isKidsProfile: boolean) => {
  if (isKidsProfile) return [];

  const fromPatientTasks = (patientTasks || []).map((task: any) => {
    const scheduledAt = task?.scheduledAt || task?.scheduled_at || task?.created_at || new Date().toISOString();
    const date = new Date(scheduledAt);
    return {
      id: String(task?.id || `local-${scheduledAt}-${task?.title || ''}`),
      title: String(task?.title || 'Tarefa'),
      description: String(task?.description || ''),
      type: String(task?.type || task?.task_type || 'task'),
      scheduledAt,
      eventDate: Number.isNaN(date.getTime()) ? new Date() : date,
      source: 'local'
    };
  });

  const fromAssigned = (assignedTasks || [])
    .filter((task: any) => String(task?.status || 'pending').toLowerCase() !== 'completed')
    .map((task: any) => {
      const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
      const scheduledAt = task?.scheduled_at || task?.created_at || new Date().toISOString();
      const date = new Date(scheduledAt);
      return {
        id: String(task?.id || `assigned-${scheduledAt}`),
        title: String(taskData?.title || task?.title || 'Tarefa'),
        description: String(taskData?.description || task?.description || ''),
        type: String(task?.task_type || task?.type || 'task'),
        scheduledAt,
        eventDate: Number.isNaN(date.getTime()) ? new Date() : date,
        source: 'server'
      };
    });

  const mergedMap = new Map<string, any>();
  [...fromPatientTasks, ...fromAssigned].forEach((task) => {
    mergedMap.set(String(task.id), task);
  });

  return Array.from(mergedMap.values()).sort((a: any, b: any) => a.eventDate.getTime() - b.eventDate.getTime());

};
