import { isRecoverableFailedOfflineSyncRecord } from './offlineSyncResilience';

export const AUTOMATIC_SESSION_CLOSURE_KEYS = new Set([
  'open_duration', 'open_interval_collection', 'therapeutic_measurement_timer_open',
  'unsaved_local_records', 'server_sync_required', 'v3_failed_trials_require_resolution'
]);

export type SessionQueueRecord = {
  id: string;
  entity_id?: string;
  type: string;
  sync_status?: string;
  last_updated?: number;
  last_error?: string | null;
  method?: string;
  endpoint: string;
  data?: any;
};

export function queuedSessionId(record: SessionQueueRecord): string {
  const explicitSessionId = String(record?.data?.session_id || record?.data?.sessionId || '').trim();
  if (explicitSessionId) return explicitSessionId;
  const match = String(record?.endpoint || '').match(/^\/api\/aba\/sessions\/([^/]+)\/(?:complete|.*)$/);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isSessionCompletionQueueRecord(record: SessionQueueRecord): boolean {
  return record?.type === 'aba'
    && String(record?.method || 'POST').toUpperCase() === 'POST'
    && /^\/api\/aba\/sessions\/[^/]+\/complete$/.test(String(record?.endpoint || ''));
}

export function isDurableDeferredSessionRecord(record: SessionQueueRecord): boolean {
  if (record?.sync_status === 'pending') return true;
  return record?.sync_status === 'failed' && isRecoverableFailedOfflineSyncRecord(record);
}

export function partitionSessionQueueForClosure(records: SessionQueueRecord[]) {
  const durable: SessionQueueRecord[] = [];
  const terminal: SessionQueueRecord[] = [];
  for (const record of records || []) {
    if (isDurableDeferredSessionRecord(record)) durable.push(record);
    else terminal.push(record);
  }
  return { durable, terminal };
}

export function hasUnresolvedSessionPredecessor(
  completion: SessionQueueRecord,
  records: SessionQueueRecord[]
): boolean {
  if (!isSessionCompletionQueueRecord(completion)) return false;
  const sessionId = queuedSessionId(completion);
  const completionOrder = Number(completion?.last_updated || 0);
  if (!sessionId) return true;
  return (records || []).some((candidate) => {
    if (!candidate || candidate.id === completion.id || isSessionCompletionQueueRecord(candidate)) return false;
    if (queuedSessionId(candidate) !== sessionId) return false;
    const candidateOrder = Number(candidate.last_updated || 0);
    return candidateOrder <= completionOrder && candidate.sync_status !== 'synced';
  });
}

export function isQueuedRecordForSession(record: SessionQueueRecord, sessionId: string, entityIds: string[] = []) {
  if (!['aba', 'aba_v3'].includes(record.type)) return false;
  const explicitSessionId = queuedSessionId(record);
  if (explicitSessionId) return explicitSessionId === sessionId;
  return String(record.entity_id || record.id) === sessionId
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
