import { ensureFreshSession, getSupabase } from '../lib/supabase';
import {
  generateId,
  getEndpointCacheMeta,
  getLatestTypeUpdate,
  getRecordById,
  getRecordsByType,
  markRecordSyncStatus,
  saveEncryptedRecord,
  setEndpointCacheMeta
} from './localDb';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DataErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
  }
}

async function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  
  const errInfo: DataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.id,
      email: user?.email,
    },
    operationType,
    path
  }
  console.error('Data Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function getAuthHeaders(includeBearer = true) {
  const session = await ensureFreshSession();
  const token = session?.access_token;
  const headers: any = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json; charset=utf-8'
  };
  if (includeBearer && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithAuthRetry(url: string, init: RequestInit) {
  let response = await fetch(url, init);
  if (response.status !== 401) return response;

  const retryHeaders = {
    ...(init.headers as Record<string, string>),
    ...(await getAuthHeaders(true))
  };
  response = await fetch(url, { ...init, headers: retryHeaders });
  return response;
}

async function safeJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { success: false, error: `HTTP ${response.status}`, raw: text };
  }
}

function normalizeApiErrorMessage(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const message = value.message || value.error || value.details;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(value);
    } catch {
      return '[erro nÃ£o serializÃ¡vel]';
    }
  }
  return String(value || 'Erro desconhecido');
}

function parseJsonObject(value: any) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function ensureArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function normalizeNoteVisibility(value: any): 'private' | 'shared_patient' | 'shared_clinic' {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'private';
  if (raw === 'shared_clinic' || raw === 'professional') return 'shared_clinic';
  if (raw === 'shared_patient' || raw === 'shared' || raw === 'patient' || raw === 'family') return 'shared_patient';
  return 'private';
}

type OfflineType = 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment';

async function buildConditionalHeaders(endpoint: string, type: OfflineType, includeBearer = false) {
  const headers = await getAuthHeaders(includeBearer);
  const meta = await getEndpointCacheMeta(endpoint);
  const latest = await getLatestTypeUpdate(type);

  if (meta?.etag) headers['If-None-Match'] = meta.etag;
  if (meta?.last_modified) headers['If-Modified-Since'] = meta.last_modified;
  if (latest) headers['X-Last-Updated'] = String(latest);

  return headers;
}

async function cacheResponseMetadata(endpoint: string, response: Response, lastUpdated?: number | null) {
  await setEndpointCacheMeta({
    endpoint,
    etag: response.headers.get('etag'),
    last_modified: response.headers.get('last-modified'),
    last_seen_updated: lastUpdated || null
  });
}

function createIdempotencyKey(scope: string, entityId?: string) {
  const baseId = entityId || generateId();
  return `${scope}:${baseId}:${Date.now()}:${crypto.randomUUID()}`;
}

// Helper to handle offline-first saving
async function saveOfflineFirst(id: string, data: any, type: OfflineType, endpoint: string, method: 'POST' | 'PATCH' = 'POST') {
  const idempotencyKey = createIdempotencyKey(`${method}:${endpoint}`, id);
  const payloadWithIdempotency = {
    ...(data || {}),
    idempotencyKey
  };

  // 1. Save locally first
  try {
    await saveEncryptedRecord({
      id,
      data: payloadWithIdempotency,
      type,
      sync_status: 'pending',
      last_updated: Date.now(),
      method,
      endpoint
    });
  } catch (offlineError) {
    console.error(`[offline-cache] failed to persist ${type} locally:`, offlineError);
  }

  // 2. Try to sync with server
  try {
    const response = await fetchWithAuthRetry(endpoint, {
      method,
      headers: {
        ...(await getAuthHeaders()),
        'X-Idempotency-Key': idempotencyKey
      },
      credentials: 'include',
      body: JSON.stringify(payloadWithIdempotency)
    });

    if (response.ok) {
      const result = await safeJson(response);
      // 3. Mark as synced if successful
      await markRecordSyncStatus(id, 'synced');
      return result;
    }
    const errorPayload = await safeJson(response);
    const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408;

    if (!isRetryable) {
      // Validation/auth errors should not remain in pending loop forever.
      await markRecordSyncStatus(id, 'synced');
      return {
        success: false,
        offline: false,
        pending: false,
        status: response.status,
        error:
          errorPayload?.error ||
          errorPayload?.message ||
          `Falha ao persistir (${response.status})`,
        details: errorPayload,
        data: payloadWithIdempotency
      };
    }

    return {
      success: false,
      offline: true,
      pending: true,
      status: response.status,
      error:
        errorPayload?.error ||
        errorPayload?.message ||
        `Falha ao persistir (${response.status})`,
      details: errorPayload,
      data: payloadWithIdempotency
    };
  } catch (error) {
    console.log(`Working offline: ${type} saved locally.`);
    return { success: true, data: payloadWithIdempotency, offline: true, pending: true };
  }
}

export const dataService = {
  async saveActivityLog(log: any) {
    const id = log.id || generateId();
    const data = { ...log, id, timestamp: log.timestamp || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'log', '/api/logs');
  },

  async getPatients() {
    const endpoint = '/api/patients';
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'patient'),
        credentials: 'include'
      });
      if (response.status === 304) {
        const local304 = await getRecordsByType('patient');
        return { success: true, data: local304.map((r) => r.data) };
      }
      if (response.ok) {
        const result = await response.json();
        let latest = 0;
        for (const p of result.data || []) {
          const updatedAtMs = p?.updated_at ? new Date(p.updated_at).getTime() : Date.now();
          latest = Math.max(latest, Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());
          await saveEncryptedRecord({
            id: p.id,
            data: p,
            type: 'patient',
            sync_status: 'synced',
            last_updated: latest,
            method: 'POST',
            endpoint
          });
        }
        await cacheResponseMetadata(endpoint, response, latest || null);
        return result;
      }
    } catch (error) {
      console.log('Fetching patients from local storage...');
    }
    const local = await getRecordsByType('patient');
    return { success: true, data: local.map((r) => r.data) };
  },

  async savePatient(patient: any) {
    const id = patient.id || generateId();
    const data = { ...patient, id, created_at: patient.created_at || new Date().toISOString() };
    if (patient?.id) {
      return await saveOfflineFirst(id, data, 'patient', `/api/patients/${id}`, 'PATCH');
    }
    return await saveOfflineFirst(id, data, 'patient', '/api/patients');
  },

  async savePatientRecord(patientId: string, payload: any) {
    try {
      const workspaceId = String(payload?.workspace_id || '').trim();
      const response = await fetch(`/api/patient-records/${patientId}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          workspace_id: workspaceId || undefined,
          payload
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error saving patient record:', error);
      return { success: false, error: String(error) };
    }
  },

  async getPatientRecord(patientId: string) {
    try {
      const response = await fetch(`/api/patient-records/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await response.json();
      const parsedPayload = parseJsonObject(result?.data?.payload);
      return {
        ...result,
        data: result?.data
          ? {
              ...result.data,
              payload: parsedPayload || result.data.payload || null
            }
          : result?.data
      };
    } catch (error) {
      console.error('Error fetching patient record:', error);
      return { success: false, error: String(error) };
    }
  },

  async getPatientFiles(patientId: string) {
    try {
      const response = await fetch(`/api/patient-files/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient files:', error);
      return { success: false, error: String(error) };
    }
  },

  async uploadPatientFile(patientId: string, payload: any) {
    try {
      if (payload?.fileBlob instanceof Blob) {
        const formData = new FormData();
        const requestedFileName = String(payload?.fileName || 'arquivo.pdf').trim() || 'arquivo.pdf';
        const requestedMime = String(payload?.contentType || payload?.fileBlob?.type || 'application/octet-stream').trim().toLowerCase();
        const safeMime =
          requestedMime === 'application/pdf' ||
          requestedMime === 'application/json' ||
          requestedMime.startsWith('image/')
            ? requestedMime
            : 'application/pdf';
        const extensionByMime: Record<string, string> = {
          'application/pdf': '.pdf',
          'application/json': '.json',
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/jpg': '.jpg',
          'image/webp': '.webp'
        };
        const requiredExtension = extensionByMime[safeMime] || '';
        const normalizedFileName =
          requiredExtension && !requestedFileName.toLowerCase().endsWith(requiredExtension)
            ? `${requestedFileName}${requiredExtension}`
            : requestedFileName;
        const file = new File([payload.fileBlob], normalizedFileName, { type: safeMime });
        formData.append('file', file, normalizedFileName);
        formData.append('fileName', normalizedFileName);
        formData.append('contentType', safeMime);
        formData.append('source', String(payload?.source || 'upload'));
        if (payload?.metadata && typeof payload.metadata === 'object') {
          formData.append('metadata', JSON.stringify(payload.metadata));
        }

        const authHeaders = await getAuthHeaders();
        const { ['Content-Type']: _, ['content-type']: __, ...headersWithoutContentType } = authHeaders as any;
        const response = await fetch(`/api/patient-files/${patientId}`, {
          method: 'POST',
          headers: headersWithoutContentType,
          credentials: 'include',
          body: formData
        });
        return await safeJson(response);
      }

      const response = await fetch(`/api/patient-files/${patientId}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          ...payload,
          contentType: String(payload?.contentType || 'application/json').trim() || 'application/json'
        })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error uploading patient file:', error);
      return { success: false, error: String(error) };
    }
  },

  async deletePatientFile(patientId: string, fileId: string) {
    try {
      const response = await fetch(`/api/patient-files/${patientId}/${fileId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error deleting patient file:', error);
      return { success: false, error: String(error) };
    }
  },

  async createPatientUser(email: string, name: string, type?: string, cpf?: string | null) {
    try {
      const response = await fetch('/api/patients/create-user', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, name, type, cpf: cpf || undefined })
      });
      const result = await safeJson(response);
      if (response.ok) return result;
      return {
        success: false,
        error: normalizeApiErrorMessage(result?.error || result?.message || 'Failed to create patient user'),
        details: result
      };
    } catch (error) {
      console.error('Error creating patient user:', error);
      return { success: false, error: String(error) };
    }
  },

  async resendPatientActivationEmail(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${patientId}/resend-activation`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error resending patient activation email:', error);
      return { success: false, error: String(error) };
    }
  },

  async resendPatientRecoveryEmail(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${patientId}/resend-recovery`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error resending patient recovery email:', error);
      return { success: false, error: String(error) };
    }
  },

  async updatePatient(id: string, updates: any) {
    return await saveOfflineFirst(id, updates, 'patient', `/api/patients/${id}`, 'PATCH');
  },

  async deletePatient(id: string) {
    try {
      const endpoint = `/api/patients/${id}`;
      const response = await fetchWithAuthRetry(endpoint, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error: normalizeApiErrorMessage(result?.error || result?.message || `Falha ao excluir paciente (${response.status})`),
          details: result
        };
      }
      return { success: true, data: result };
    } catch (error) {
      console.error('Error deleting patient:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getActivityLogs() {
    const endpoint = '/api/logs';
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'log'),
        credentials: 'include'
      });
      if (response.status === 304) {
        const local304 = await getRecordsByType('log');
        return { success: true, data: local304.map((r) => r.data) };
      }
      if (response.ok) {
        const result = await response.json();
        let latest = 0;
        for (const l of result.data || []) {
          const timestampMs = l?.timestamp ? new Date(l.timestamp).getTime() : Date.now();
          latest = Math.max(latest, Number.isFinite(timestampMs) ? timestampMs : Date.now());
          await saveEncryptedRecord({
            id: l.id,
            data: l,
            type: 'log',
            sync_status: 'synced',
            last_updated: latest,
            method: 'POST',
            endpoint
          });
        }
        await cacheResponseMetadata(endpoint, response, latest || null);
        return result;
      }
    } catch (error) {
      console.log('Fetching logs from local storage...');
    }
    const local = await getRecordsByType('log');
    return { success: true, data: local.map(r => r.data) };
  },

  async getNotes(patientId: string) {
    const endpoint = `/api/notes/${patientId}`;
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'note'),
        credentials: 'include'
      });
      if (response.status === 304) {
        const local304 = await getRecordsByType('note');
        return { success: true, data: local304.filter((r) => r.data.patient_id === patientId).map((r) => r.data) };
      }
      if (response.ok) {
        const result = await response.json();
        let latest = 0;
        for (const n of result.data || []) {
          const updatedAtMs = n?.updated_at ? new Date(n.updated_at).getTime() : (n?.created_at ? new Date(n.created_at).getTime() : Date.now());
          latest = Math.max(latest, Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());
          await saveEncryptedRecord({
            id: n.id,
            data: n,
            type: 'note',
            sync_status: 'synced',
            last_updated: latest,
            method: 'POST',
            endpoint
          });
        }
        await cacheResponseMetadata(endpoint, response, latest || null);
        return result;
      }
    } catch (error) {
      console.log('Fetching notes from local storage...');
    }
    const local = await getRecordsByType('note');
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getNotesByEmail(email: string) {
    try {
      const response = await fetch(`/api/notes/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching notes by email from local storage...');
    }
    const local = await getRecordsByType('note');
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async addNote(note: any) {
    const id = note.id || generateId();
    const data = { ...note, id, created_at: note.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'note', '/api/notes');
  },

  async deleteNote(noteId: string) {
    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error deleting note:', error);
      return { success: false, error: String(error) };
    }
  },

  async updateNote(noteId: string, updates: any) {
    try {
      const response = await fetchWithAuthRetry(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(updates || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating note:', error);
      return { success: false, error: String(error) };
    }
  },

  async getHistory(patientId: string) {
    try {
      const response = await fetch(`/api/history/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const h of result.data) {
          await saveEncryptedRecord({ id: h.id, data: h, type: 'history', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/history' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching history from local storage...');
    }
    const local = await getRecordsByType('history');
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getHistoryByEmail(email: string) {
    try {
      const response = await fetch(`/api/history/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching history by email from local storage...');
    }
    const local = await getRecordsByType('history');
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async getPatientSelfHistory() {
    try {
      const response = await fetch('/api/patient/self/history', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching patient self history from local storage...');
    }
    const local = await getRecordsByType('history');
    const profileResponse = await this.getCurrentUserProfile();
    const selfEmail = String(profileResponse?.data?.email || '').trim().toLowerCase();
    return {
      success: true,
      data: local
        .filter(r => String(r?.data?.patient_email || '').trim().toLowerCase() === selfEmail)
        .map(r => r.data)
    };
  },

  async addHistoryItem(item: any) {
    const id = item.id || generateId();
    const data = { ...item, id, created_at: item.created_at || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'history', '/api/history');
  },

  async updateHistoryItem(historyId: string, updates: any) {
    try {
      const response = await fetch(`/api/history/${historyId}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(updates || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating history item:', error);
      return { success: false, error: String(error) };
    }
  },

  async deleteHistoryItem(historyId: string) {
    try {
      const response = await fetch(`/api/history/${historyId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error deleting history item:', error);
      return { success: false, error: String(error) };
    }
  },

  async getTasks(patientId: string) {
    try {
      const response = await fetch(`/api/tasks/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        for (const t of result.data) {
          await saveEncryptedRecord({ id: t.id, data: t, type: 'task', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/tasks' });
        }
        return result;
      }
    } catch (error) {
      console.log('Fetching tasks from local storage...');
    }
    const local = await getRecordsByType('task');
    return { success: true, data: local.filter(r => r.data.patient_id === patientId).map(r => r.data) };
  },

  async getTasksByEmail(email: string) {
    try {
      const response = await fetch(`/api/tasks/email/${email}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching tasks by email from local storage...');
    }
    const local = await getRecordsByType('task');
    return { success: true, data: local.filter(r => r.data.patient_email === email).map(r => r.data) };
  },

  async getPatientSelfTasks() {
    try {
      const response = await fetch('/api/patient/self/tasks', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching patient self tasks from local storage...');
    }
    const local = await getRecordsByType('task');
    const profileResponse = await this.getCurrentUserProfile();
    const selfEmail = String(profileResponse?.data?.email || '').trim().toLowerCase();
    return {
      success: true,
      data: local
        .filter(r => String(r?.data?.patient_email || '').trim().toLowerCase() === selfEmail)
        .map(r => r.data)
    };
  },

  async addTask(task: any) {
    const id = task.id || generateId();
    const maxScore = Number(task?.max_score ?? task?.maxScore);
    const normalizedMaxScore = Number.isFinite(maxScore) ? Math.max(1, Math.min(100, maxScore)) : undefined;
    const data = {
      ...task,
      id,
      max_score: normalizedMaxScore ?? task?.max_score,
      maxScore: normalizedMaxScore ?? task?.maxScore,
      created_at: task.created_at || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'task', '/api/tasks');
  },

  async getPatientSelfProtocols() {
    try {
      const response = await fetch('/api/patient/self/protocols', {
        headers: await buildConditionalHeaders('/api/patient/self/protocols', 'profile'),
        credentials: 'include',
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) {
        return { success: false, data: [], error: result?.error || 'Falha ao carregar protocolos do paciente.' };
      }
      return { success: true, data: Array.isArray(result?.data) ? result.data : [] };
    } catch (error: any) {
      console.error('Error fetching patient self protocols:', error);
      return { success: false, data: [], error: normalizeApiErrorMessage(error?.message || 'Falha ao carregar protocolos do paciente.') };
    }
  },

  async updateTask(taskId: string, updates: any) {
    try {
      const response = await fetchWithAuthRetry(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(updates || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating task:', error);
      return { success: false, error: String(error) };
    }
  },

  async deleteTask(taskId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error deleting task:', error);
      return { success: false, error: String(error) };
    }
  },

  async getAssignedTasks(patientId: string) {
    try {
      const response = await fetch(`/api/assigned-tasks/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching assigned tasks:', error);
      return { success: false, error: String(error), data: [] };
    }
  },

  async getPatientSelfAssignedTasks() {
    try {
      const response = await fetch('/api/patient/self/assigned-tasks', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching self assigned tasks:', error);
      return { success: false, error: String(error), data: [] };
    }
  },

  async addAssignedTask(payload: {
    id?: string;
    patient_id: string;
    patient_email?: string | null;
    task_type?: string;
    task_data?: Record<string, any>;
    scheduled_at?: string;
    status?: 'pending' | 'completed';
    parent_assigned_task_id?: string;
  }) {
    try {
      const response = await fetchWithAuthRetry('/api/assigned-tasks', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error creating assigned task:', error);
      return { success: false, error: String(error) };
    }
  },

  async completeAssignedTask(taskId: string, payload: {
    patient_effort?: number;
    patient_comment?: string;
  }) {
    try {
      const response = await fetchWithAuthRetry(`/api/assigned-tasks/${taskId}/complete`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error completing assigned task:', error);
      return { success: false, error: String(error) };
    }
  },

  async reviewAssignedTask(taskId: string, payload: {
    pro_score: number;
    pro_review_note?: string;
    max_score?: number;
  }) {
    try {
      const response = await fetchWithAuthRetry(`/api/assigned-tasks/${taskId}/review`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error reviewing assigned task:', error);
      return { success: false, error: String(error) };
    }
  },

  async getPayments() {
    try {
      const response = await fetch('/api/payments', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
    return { success: true, data: [] };
  },

  async savePayment(payment: any) {
    const id = generateId();
    return await saveOfflineFirst(id, payment, 'payment', '/api/payments');
  },

  async saveUserProfile(userId: string, profile: any) {
    const data = { ...profile, updated_at: profile.updated_at || new Date().toISOString() };
    try {
      const response = await fetch(`/api/profile/${userId}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving user profile:', error);
      return { success: false, error: String(error) };
    }
  },

  async getUserProfile(userId: string) {
    try {
      const response = await fetch(`/api/profile/${userId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        await saveEncryptedRecord({ id: userId, data: result, type: 'profile', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: `/api/profile/${userId}` });
        return result;
      }
    } catch (error) {
      console.log('Fetching profile from local storage...');
    }
    const local = await getRecordById(userId);
    return local ? local.data : { success: false };
  },

  async uploadFile(bucket: string, path: string, file: File) {
    // Sensible uploads (patient photos) must always pass through backend auth checks.
    if (bucket === 'patient-photos') {
      try {
        const toBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Falha ao ler arquivo para upload'));
          reader.readAsDataURL(file);
        });

        const response = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            bucket,
            path,
            contentType: file.type || 'application/octet-stream',
            fileBase64: toBase64
          })
        });

        const result = await safeJson(response);
        if (response.ok && result?.success) {
          return { success: true, url: result.url, path: result.path };
        }

        return { success: false, error: result?.error || 'Falha no upload.' };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Falha no upload.' };
      }
    }

    // Files are hard to sync offline without a complex worker,
    // so we'll keep this online-only for now but handle the error.
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(data.path, 60 * 60 * 24 * 30); // 30 dias

      if (signedError) throw signedError;

      return { success: true, url: signedData.signedUrl, path: data.path };
    } catch (error: any) {
      console.warn('Direct Supabase upload failed, trying backend fallback:', error.message);
      try {
        const toBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Falha ao ler arquivo para upload'));
          reader.readAsDataURL(file);
        });

        const response = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            bucket,
            path,
            contentType: file.type || 'application/octet-stream',
            fileBase64: toBase64
          })
        });

        const result = await response.json();
        if (response.ok && result?.success) {
          return { success: true, url: result.url, path: result.path };
        }

        return { success: false, error: result?.error || 'Falha no upload (fallback).' };
      } catch (fallbackError: any) {
        console.error('Fallback upload error:', fallbackError.message);
        return { success: false, error: fallbackError.message || error.message };
      }
    }
  },

  async updateAssignedTask(taskId: string, payload: {
    task_type?: string;
    task_data?: Record<string, any>;
    scheduled_at?: string;
    status?: 'pending' | 'completed';
  }) {
    try {
      const response = await fetchWithAuthRetry(`/api/assigned-tasks/${taskId}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating assigned task:', error);
      return { success: false, error: String(error) };
    }
  },

  async uploadDataUrl(bucket: string, path: string, dataUrl: string, contentTypeHint?: string) {
    try {
      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          bucket,
          path,
          contentType: contentTypeHint || 'image/png',
          fileBase64: dataUrl
        })
      });

      const result = await safeJson(response);
      if (response.ok && result?.success && result?.url) {
        return { success: true, url: result.url, path: result.path };
      }

      return {
        success: false,
        error: result?.error || `Falha no upload base64 (${response.status}).`
      };
    } catch (error: any) {
      console.error('uploadDataUrl error:', error);
      return { success: false, error: error?.message || String(error) };
    }
  },

  async getClinicMembers() {
    try {
      const response = await fetch('/api/clinic/members', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        return await response.json();
      }
      return { success: false, error: 'Failed to fetch clinic members' };
    } catch (error) {
      console.error('Error fetching clinic members:', error);
      return { success: false, error: String(error) };
    }
  },

  async getClinicAnamnesisTemplate(workspaceId?: string) {
    try {
      const response = await fetch('/api/clinic/anamnesis-template', {
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include'
      });
      const result = await safeJson(response);
      const parsed = parseJsonObject(result?.data);
      return {
        ...result,
        data: parsed || result?.data || {}
      };
    } catch (error) {
      console.error('Error fetching anamnesis template:', error);
      return { success: false, error: String(error) };
    }
  },

  async getDefaultClinicAnamnesisTemplate() {
    try {
      const response = await fetch('/api/clinic/anamnesis-template/defaults', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching default anamnesis template:', error);
      return { success: false, error: String(error) };
    }
  },

  async saveClinicAnamnesisTemplate(template: any, workspaceId?: string) {
    try {
      const safeTemplate = parseJsonObject(template) || {};
      const response = await fetch('/api/clinic/anamnesis-template', {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ template: safeTemplate, workspace_id: workspaceId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving anamnesis template:', error);
      return { success: false, error: String(error) };
    }
  },

  async assignClinicRole(email: string, role: string) {
    try {
      const response = await fetch('/api/clinic/assign-role', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, role })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to assign role' };
    } catch (error) {
      console.error('Error assigning clinic role:', error);
      return { success: false, error: String(error) };
    }
  },
  
  async inviteToClinic(email: string, role: string, requiredOnboardingFields?: Record<string, any>) {
    try {
      const response = await fetch('/api/clinic/invite', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, role, requiredOnboardingFields })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to send invitation' };
    } catch (error) {
      console.error('Error inviting to clinic:', error);
      return { success: false, error: String(error) };
    }
  },

  async getInvitations() {
    try {
      const response = await fetch('/api/clinic/invitations', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        return await response.json();
      }
      return { success: false, error: 'Failed to fetch invitations' };
    } catch (error) {
      console.error('Error fetching invitations:', error);
      return { success: false, error: String(error) };
    }
  },

  async cancelInvitation(invitationId: string) {
    try {
      const response = await fetch(`/api/clinic/invitations/${invitationId}/cancel`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.error || 'Falha ao cancelar convite' };
    } catch (error) {
      console.error('Error cancelling invitation:', error);
      return { success: false, error: String(error) };
    }
  },

  async updateMemberRole(memberId: string, role: string) {
    try {
      const response = await fetch(`/api/clinic/members/${memberId}/role`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ role })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to update role' };
    } catch (error) {
      console.error('Error updating member role:', error);
      return { success: false, error: String(error) };
    }
  },

  async acceptInvitation(invitationId: string) {
    try {
      const response = await fetch('/api/clinic/accept-invite', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ invitationId })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.error || 'Failed to accept invitation' };
    } catch (error) {
      console.error('Error accepting invitation:', error);
      return { success: false, error: String(error) };
    }
  },

  async getWorkspaces() {
    try {
      const response = await fetch('/api/workspaces', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await response.json();
    } catch (error) {
      console.error('Error fetching workspaces:', error);
      return { success: false, error: String(error) };
    }
  },

  async selectWorkspace(clinicId: string) {
    try {
      const response = await fetch('/api/workspaces/select', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ clinicId })
      });
      return await response.json();
    } catch (error) {
      console.error('Error selecting workspace:', error);
      return { success: false, error: String(error) };
    }
  },

  async getClinicState(workspaceId?: string) {
    try {
      const response = await fetch('/api/clinic/state', {
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include'
      });
      const result = await safeJson(response);
      const clinicData = result?.data || {};
      return {
        ...result,
        data: {
          clinicId: clinicData?.clinicId || workspaceId || null,
          rooms: ensureArray(clinicData?.rooms),
          appointments: ensureArray(clinicData?.appointments),
          protocols: ensureArray(clinicData?.protocols),
          specialtySettings:
            clinicData?.specialtySettings && typeof clinicData.specialtySettings === 'object'
              ? clinicData.specialtySettings
              : {},
          updatedAt: clinicData?.updatedAt || null
        }
      };
    } catch (error) {
      console.error('Error fetching clinic state:', error);
      return { success: false, error: String(error) };
    }
  },

  async saveClinicState(payload: {
    workspace_id?: string;
    rooms?: any[];
    appointments?: any[];
    protocols?: any[];
    specialtySettings?: Record<string, number>;
  }) {
    try {
      const idempotencyKey = createIdempotencyKey('POST:/api/clinic/state');
      const response = await fetch('/api/clinic/state', {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'X-Idempotency-Key': idempotencyKey
        },
        credentials: 'include',
        body: JSON.stringify({
          ...(payload || {}),
          workspace_id: payload?.workspace_id || undefined,
          idempotencyKey
        })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving clinic state:', error);
      return { success: false, error: String(error) };
    }
  },

  async savePatientAnamnesisSubmission(patientId: string, payload: {
    title: string;
    referenceDate?: string;
    anamnesisData?: any;
    templateVersion?: number | null;
    profileType?: 'adult' | 'child';
    patientFileId?: string | null;
    workspace_id?: string | null;
  }) {
    try {
      const safePayload = {
        ...payload,
        anamnesisData: parseJsonObject(payload?.anamnesisData) || payload?.anamnesisData || {},
      };
      const response = await fetch(`/api/patient-anamnesis/${patientId}`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(safePayload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving patient anamnesis submission:', error);
      return { success: false, error: String(error) };
    }
  },

  async getPatientAnamnesisSubmissions(patientId: string) {
    try {
      const response = await fetch(`/api/patient-anamnesis/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      return {
        ...result,
        data: ensureArray(result?.data).map((entry: any) => ({
          ...entry,
          anamnesis_data: parseJsonObject(entry?.anamnesis_data) || entry?.anamnesis_data || {}
        }))
      };
    } catch (error) {
      console.error('Error fetching patient anamnesis submissions:', error);
      return { success: false, error: String(error) };
    }
  },

  async hydrateWorkspaceState(workspaceId?: string) {
    const baseHeaders = await getAuthHeaders();
    const headersWithWorkspace = {
      ...baseHeaders,
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
    };

    const [clinicStateResponse, clinicTemplateResponse, patientsResponse] = await Promise.all([
      fetch('/api/clinic/state', { headers: headersWithWorkspace, credentials: 'include' }),
      fetch('/api/clinic/anamnesis-template', { headers: headersWithWorkspace, credentials: 'include' }),
      fetch('/api/patients', { headers: headersWithWorkspace, credentials: 'include' })
    ]);

    const clinicStateRes = await safeJson(clinicStateResponse);
    const clinicTemplateRes = await safeJson(clinicTemplateResponse);
    const patientsRes = await safeJson(patientsResponse);

    if (!patientsResponse.ok || !patientsRes?.success) {
      return {
        success: false,
        error: patientsRes?.error || `Falha ao carregar pacientes do workspace (HTTP ${patientsResponse.status}).`
      };
    }

    const patients = ensureArray(patientsRes?.data);
    const notes: any[] = [];
    const history: any[] = [];
    const tasks: any[] = [];
    const clinicalRecords: any[] = [];
    const hydratedPatients: any[] = [];

    for (const patient of patients) {
      const patientId = String(patient?.id || '').trim();
      if (!patientId) continue;

      const [notesResponse, historyResponse, tasksResponse, assignedTasksResponse, recordResponse, submissionsResponse] = await Promise.all([
        fetch(`/api/notes/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/history/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/tasks/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/assigned-tasks/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/patient-records/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/patient-anamnesis/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' })
      ]);
      const [notesRes, historyRes, tasksRes, assignedTasksRes, patientRecordRes, submissionsRes] = await Promise.all([
        safeJson(notesResponse),
        safeJson(historyResponse),
        safeJson(tasksResponse),
        safeJson(assignedTasksResponse),
        safeJson(recordResponse),
        safeJson(submissionsResponse)
      ]);

      const patientNotes = ensureArray(notesRes?.data).map((n: any) => ({
        ...n,
        patientId: n?.patient_id || patientId,
        visibility: normalizeNoteVisibility(n?.visibility || n?.type),
        date: n?.created_at ? new Date(n.created_at).toLocaleString() : new Date().toLocaleString()
      }));
      const patientHistory = ensureArray(historyRes?.data).map((h: any) => ({
        ...h,
        patientId: h?.patient_id || patientId,
        time: h?.created_at
          ? new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
        dateGroup:
          h?.created_at && new Date(h.created_at).toDateString() === new Date().toDateString()
            ? 'Hoje'
            : h?.created_at
              ? new Date(h.created_at).toLocaleDateString()
              : ''
      }));
      const patientTasks = ensureArray(tasksRes?.data).map((t: any) => ({
        ...t,
        patientId: t?.patient_id || patientId
      }));
      const patientAssignedTasks = ensureArray(assignedTasksRes?.data).map((t: any) => {
        const taskData = t?.task_data && typeof t.task_data === 'object' ? t.task_data : {};
        return {
          id: String(t?.id || ''),
          assignedTaskId: String(t?.id || ''),
          patientId: t?.patient_id || patientId,
          patient_id: t?.patient_id || patientId,
          patient_email: t?.patient_email || patient?.email || null,
          title: taskData?.title || 'Tarefa agendada',
          description: taskData?.description || '',
          icon: taskData?.icon || '🎯',
          color: taskData?.color || 'bg-blue-100 text-blue-600',
          type: t?.task_type || 'task',
          maxScore: Number(taskData?.maxScore || taskData?.max_score || 4),
          scheduledAt: t?.scheduled_at || null,
          scheduled_at: t?.scheduled_at || null,
          status: t?.status || 'pending',
          task_data: taskData,
          created_at: t?.created_at || t?.scheduled_at || null
        };
      });

      notes.push(...patientNotes);
      history.push(...patientHistory);
      tasks.push(...patientTasks);
      tasks.push(...patientAssignedTasks);

      const recordPayload = parseJsonObject(patientRecordRes?.data?.payload) || {};
      const anamnesisData = parseJsonObject(recordPayload?.anamnese) || null;
      const submissions = ensureArray(submissionsRes?.data);

      hydratedPatients.push({
        ...patient,
        anamnesisData,
        pei: Array.isArray(recordPayload?.pei) ? recordPayload.pei : Array.isArray(patient?.pei) ? patient.pei : [],
        evaluationLinks:
          recordPayload?.evaluationLinks && typeof recordPayload.evaluationLinks === 'object'
            ? recordPayload.evaluationLinks
            : patient?.evaluationLinks && typeof patient.evaluationLinks === 'object'
              ? patient.evaluationLinks
              : {},
        interventionTaskLinks:
          recordPayload?.interventionTaskLinks && typeof recordPayload.interventionTaskLinks === 'object'
            ? recordPayload.interventionTaskLinks
            : patient?.interventionTaskLinks && typeof patient.interventionTaskLinks === 'object'
              ? patient.interventionTaskLinks
              : {},
        anamnesisSubmissions: submissions,
        anamnesisTemplate: clinicTemplateRes?.data || {},
        anamnesisRenewalMonths: [2, 3, 6, 12].includes(Number(recordPayload?.anamnesisRenewalMonths))
          ? Number(recordPayload.anamnesisRenewalMonths)
          : Number(patient?.anamnesisRenewalMonths || 6),
        lastAnamnesisAt: recordPayload?.lastAnamnesisAt || patient?.lastAnamnesisAt || null,
      });

      clinicalRecords.push({
        patientId,
        diagnosis: recordPayload?.diagnosis || patient?.diagnosis || null,
        anamnesisData,
        pei: Array.isArray(recordPayload?.pei) ? recordPayload.pei : Array.isArray(patient?.pei) ? patient.pei : [],
        evaluationLinks:
          recordPayload?.evaluationLinks && typeof recordPayload.evaluationLinks === 'object'
            ? recordPayload.evaluationLinks
            : {},
        interventionTaskLinks:
          recordPayload?.interventionTaskLinks && typeof recordPayload.interventionTaskLinks === 'object'
            ? recordPayload.interventionTaskLinks
            : {},
        anamneseJsonb: anamnesisData,
        anamnesisSubmissions: submissions
      });
    }

    return {
      success: true,
      data: {
        clinicState: clinicStateRes?.data || {
          clinicId: workspaceId || null,
          rooms: [],
          appointments: [],
          protocols: [],
          specialtySettings: {},
          updatedAt: null
        },
        clinicAnamnesisTemplate: clinicTemplateRes?.data || {},
        patients: hydratedPatients,
        notes,
        history,
        tasks,
        clinicalRecords
      }
    };
  }
};

