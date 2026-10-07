export const AUTOMATIC_SESSION_CLOSURE_KEYS = new Set([
  'open_duration', 'open_interval_collection', 'therapeutic_measurement_timer_open',
  'unsaved_local_records', 'server_sync_required', 'v3_failed_trials_require_resolution'
]);

export function isQueuedRecordForSession(record: {
  id: string; entity_id?: string; type: string; endpoint: string; data?: any;
}, sessionId: string, entityIds: string[] = []) {
  if (!['aba', 'aba_v3'].includes(record.type)) return false;
  const explicitSessionId = record.data?.session_id || record.data?.sessionId;
  if (explicitSessionId) return String(explicitSessionId) === sessionId;
  return String(record.entity_id || record.id) === sessionId
    || record.endpoint.startsWith(`/api/aba/sessions/${encodeURIComponent(sessionId)}/`)
    || entityIds.includes(String(record.entity_id || record.id));
}

export function therapeuticTimerCompletion(timer: {
  startedAt: string; runningSince: string | null; accumulatedMs: number;
}, endedAt: string) {
  const endMs = Date.parse(endedAt);
  const startMs = Date.parse(timer.startedAt);
  const runningMs = timer.runningSince ? Date.parse(timer.runningSince) : endMs;
  if (![endMs, startMs, runningMs].every(Number.isFinite) || endMs < startMs) {
    throw new Error('O cronômetro possui horários inválidos. O registro foi preservado.');
  }
  const totalMs = Math.max(0, Number(timer.accumulatedMs || 0))
    + (timer.runningSince ? Math.max(0, endMs - runningMs) : 0);
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error('O cronômetro ainda não possui tempo observado para salvar.');
  }
  return { totalMs, seconds: totalMs / 1000, effectiveStartedAt: new Date(endMs - totalMs).toISOString() };
}

export async function waitForSessionWrites(hasWrites: () => boolean, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (hasWrites()) {
    if (Date.now() >= deadline) throw new Error('A gravação ainda está em andamento. Os dados foram preservados; tente finalizar novamente.');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
