/**
 * Pure view projection: task visibility stays based on the same scheduled-at
 * parsing and completion rules; only the next future task drives a clock update.
 * No writes, fetching, tenant state, or other side effects.
 */
export function derivePatientTaskVisibility(
  tasks: any,
  isKidsProfile: boolean,
  currentTime: Date,
  parseScheduledTaskDate: (value: any) => Date | null,
): { visibleTasks: any[]; nextDueAt: number } {
  const list = Array.isArray(tasks) ? tasks : [];
  if (isKidsProfile) return { visibleTasks: list, nextDueAt: Number.POSITIVE_INFINITY };
  const now = currentTime.getTime();
  let nextDueAt = Number.POSITIVE_INFINITY;
  const visibleTasks = list.filter((task: any) => {
    if (task?.completed || String(task?.status || '').toLowerCase() === 'completed') return false;
    const scheduledRaw = task?.scheduledAt || task?.scheduled_at;
    if (!scheduledRaw) return false;
    const scheduledAt = parseScheduledTaskDate(scheduledRaw);
    if (!scheduledAt) return false;
    const dueAt = scheduledAt.getTime();
    if (dueAt > now) {
      if (dueAt < nextDueAt) nextDueAt = dueAt;
      return false;
    }
    return true;
  });
  return { visibleTasks, nextDueAt };
}
