import { getSupabase } from '../lib/supabase';
import { dataService } from './dataService';
import { generateId, getRecordsByType, markRecordSyncFailure, markRecordSyncStatus, saveEncryptedRecord } from './localDb';

const ENDPOINT = 'supabase-rpc:record_aba_reinforcer_delivery_authenticated_v1';
const isTerminalReinforcerSyncError = (message: string) =>
  /AUTH_REQUIRED|ACCESS_DENIED|FORBIDDEN|SCOPE_INVALID|SESSION_NOT_EDITABLE|SESSION_CLOSED|REINFORCER_INACTIVE|MISMATCH|NOT_FOUND|DELIVERY_INVALID/i.test(message);

export type ReinforcerCategory = 'SOCIAL' | 'ACTIVITY' | 'ITEM_OBJECT' | 'SENSORY' | 'FOOD' | 'OTHER';

export async function listPatientReinforcers(patientId: string, includeInactive = false) {
  const result = await dataService.getAbaPatientReinforcers(patientId, includeInactive);
  if (!result?.success) {
    // The catalog is optional in a patient view without this capability.
    // Keep denied accesses silent and never display raw PostgREST messages.
    const error = new Error('Não foi possível carregar os reforçadores.');
    Object.assign(error, { status: result?.status, code: result?.code });
    throw error;
  }
  return result.data;
}

export async function savePatientReinforcer(input: {
  patientId: string;
  reinforcerId?: string | null;
  label: string;
  category?: ReinforcerCategory | null;
  note?: string | null;
  isActive?: boolean;
}) {
  const result = await dataService.saveAbaPatientReinforcer(input.patientId, {
    reinforcerId: input.reinforcerId || null,
    label: input.label,
    category: input.category || null,
    note: input.note || null,
    isActive: input.isActive !== false,
  });
  if (!result?.success) {
    const error = new Error(result?.status === 403
      ? 'Você não possui permissão para alterar os reforçadores deste paciente.'
      : 'Não foi possível salvar o reforçador.');
    Object.assign(error, { status: result?.status, code: result?.code });
    throw error;
  }
  return result.data;
}

export async function inactivatePatientReinforcer(input: { patientId: string; reinforcer: any }) {
  return savePatientReinforcer({
    patientId: input.patientId,
    reinforcerId: input.reinforcer.reinforcer_id,
    label: input.reinforcer.label,
    category: input.reinforcer.category || null,
    note: input.reinforcer.note || null,
    isActive: false,
  });
}

export async function reactivatePatientReinforcer(input: { patientId: string; reinforcer: any }) {
  return savePatientReinforcer({
    patientId: input.patientId,
    reinforcerId: input.reinforcer.reinforcer_id,
    label: input.reinforcer.label,
    category: input.reinforcer.category || null,
    note: input.reinforcer.note || null,
    isActive: true,
  });
}

export async function listRecentPatientReinforcers(patientId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('list_recent_aba_patient_reinforcers_authenticated_v1', {
    p_patient_id: patientId,
    p_limit: 20,
    p_lookback_days: 365,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function listSessionReinforcerEvents(sessionId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('list_aba_session_reinforcer_events_authenticated_v1', {
    p_session_id: sessionId,
    p_limit: 500,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getSessionReinforcerSummary(sessionId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('get_aba_session_reinforcer_summary_authenticated_v1', {
    p_session_id: sessionId,
    p_limit: 200,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function materializeReinforcerDelivery(input: {
  sessionId: string;
  patientId: string;
  reinforcerId: string;
  occurredAt?: string;
}) {
  const clientEventId = generateId();
  const data = {
    kind: 'reinforcer_delivery_v1',
    clientEventId,
    sessionId: input.sessionId,
    patientId: input.patientId,
    reinforcerId: input.reinforcerId,
    occurredAt: input.occurredAt || new Date().toISOString(),
  };
  const ok = await saveEncryptedRecord({
    id: clientEventId,
    entity_id: clientEventId,
    type: 'aba',
    sync_status: 'pending',
    last_updated: Date.now(),
    retry_count: 0,
    method: 'POST',
    endpoint: ENDPOINT,
    data,
  });
  if (!ok) throw new Error('Não foi possível salvar o registro localmente.');
  return data;
}

export async function getReinforcerIntents(sessionId: string) {
  const rows = await getRecordsByType('aba');
  return rows
    .filter((row) => row.endpoint === ENDPOINT && row.data?.kind === 'reinforcer_delivery_v1' && row.data?.sessionId === sessionId)
    .map((row) => ({
      ...row.data,
      syncState: row.sync_status === 'synced' ? 'synced' : row.sync_status === 'failed' || row.sync_status === 'conflict' ? 'failed' : 'pending',
      lastError: row.last_error || null,
    }));
}

export async function flushReinforcerDeliveries(sessionId: string) {
  const rows = (await getRecordsByType('aba')).filter(
    (row) =>
      row.endpoint === ENDPOINT &&
      row.data?.kind === 'reinforcer_delivery_v1' &&
      row.data?.sessionId === sessionId &&
      row.sync_status !== 'synced',
  );

  if (typeof navigator !== 'undefined' && !navigator.onLine && rows.length) {
    // These events already have encrypted, durable, per-user outbox records.
    // Allow the clinical session to close locally, but never defer terminal
    // failures: those must remain visible for human review.
    const terminal = rows.filter((row) => row.sync_status === 'failed' || row.sync_status === 'conflict').length;
    return { ok: terminal === 0, pending: rows.length - terminal, terminal, deferred: terminal === 0 };
  }

  let pending = 0;
  let terminal = 0;
  for (const row of rows) {
    if (row.sync_status === 'failed' || row.sync_status === 'conflict') {
      terminal += 1;
      continue;
    }
    await markRecordSyncStatus(row.id, 'pending', {
      last_attempt_at: Date.now(),
      next_retry_at: null,
    });
    try {
      const result = await dataService.recordAbaReinforcerDelivery(row.data.patientId, row.data.sessionId, {
        reinforcerId: row.data.reinforcerId,
        clientEventId: row.data.clientEventId,
        occurredAt: row.data.occurredAt,
      });
      if (!result.success) {
        const message = String(result.code || 'Falha de sincronização');
        if (result.status === 403 || isTerminalReinforcerSyncError(message)) {
          await markRecordSyncFailure(row.id, { retryable: false, error: message });
          terminal += 1;
        } else {
          await markRecordSyncFailure(row.id, { retryable: true, error: message });
          pending += 1;
        }
      } else {
        await markRecordSyncStatus(row.id, 'synced');
      }
    } catch (error: any) {
      await markRecordSyncFailure(row.id, { retryable: true, error: error?.message || error });
      pending += 1;
    }
  }
  return { ok: pending === 0 && terminal === 0, pending, terminal };
}
