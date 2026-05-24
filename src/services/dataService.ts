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
import { resolveAbaPromptLevel } from '../utils/abaPromptLevels';

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
    emailMasked: string | null | undefined;
  }
}

function maskEmailForLog(email?: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  const safeLocal = local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function stripEphemeralProfileMedia(result: any) {
  if (!result?.data?.professional_profile) return result;
  const professionalProfile = { ...result.data.professional_profile };
  professionalProfile.profile_photo_url = null;
  professionalProfile.clinic_logo_url = null;
  professionalProfile.signature_data_url = null;
  return {
    ...result,
    data: {
      ...result.data,
      professional_profile: professionalProfile
    }
  };
}

function isTechnicalActivityLog(log: any): boolean {
  const fields = [
    log?.title,
    log?.content,
    log?.details,
    log?.action,
    log?.action_type,
    log?.payload_details,
    log?.request_path,
    log?.request_method
  ]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);
  const joined = fields.join(' ');
  const title = String(log?.title || '').toLowerCase();
  const type = String(log?.type || '').toLowerCase();

  if (joined.includes('/api/clinic/state') || joined.includes('/clinic/state')) return true;
  if (joined.includes('http ') && joined.includes('payload=')) return true;
  if (type === 'audit' && (joined.includes(' no endpoint ') || title.includes('registrada em '))) return true;
  return /^(criou|atualizou|removeu|alterou)\s+\//i.test(title);
}

function filterActivityLogsForClinicView(logs: any[]): any[] {
  return (Array.isArray(logs) ? logs : []).filter((log) => {
    if (String(log?.status || '').toLowerCase() === 'archived') return false;
    return !isTechnicalActivityLog(log);
  });
}

async function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  
  const errInfo: DataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.id,
      emailMasked: maskEmailForLog(user?.email),
    },
    operationType,
    path
  }
  console.error('Data Error: ', JSON.stringify(errInfo));
  throw new Error(errInfo.error);
}

async function fileToDataUrl(file: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo para upload'));
    reader.readAsDataURL(file);
  });
}

async function compressImageDataUrl(
  input: File | Blob | string,
  options: { maxDimension?: number; quality?: number; mimeType?: string } = {}
): Promise<{ dataUrl: string; contentType: string }> {
  const maxDimension = options.maxDimension || 1200; // 1200px max (vs 800px antes)
  const initialQuality = options.quality ?? 0.78; // 0.78 (vs 0.75 antes)
  const sourceDataUrl = typeof input === 'string' ? input : await fileToDataUrl(input);
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Falha ao processar imagem para compressão'));
  });
  image.src = sourceDataUrl;
  await loaded;

  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (!originalWidth || !originalHeight) {
    return {
      dataUrl: sourceDataUrl,
      contentType: options.mimeType || sourceDataUrl.match(/^data:([^;]+);base64,/)?.[1] || 'image/jpeg'
    };
  }

  const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
  const targetWidth = Math.max(1, Math.round(originalWidth * scale));
  const targetHeight = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para compressão de imagem');
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const outputType = options.mimeType || 'image/jpeg';
  const MAX_COMPRESSED_SIZE_BYTES = 500 * 1024; // 500KB max post-compression

  // Try initial quality
  let dataUrl = canvas.toDataURL(outputType, initialQuality);
  let compressedSize = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75); // Estimate base64 to binary size
  
  // If exceeds 500KB, retry with lower quality (0.60)
  if (compressedSize > MAX_COMPRESSED_SIZE_BYTES && initialQuality > 0.60) {
    console.warn(
      `[Compression] Initial quality ${initialQuality} resulted in ${(compressedSize / 1024).toFixed(2)}KB. Retrying with quality 0.60...`
    );
    dataUrl = canvas.toDataURL(outputType, 0.60);
    compressedSize = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
  }

  // If still exceeds limit after fallback, warn but continue (backend will enforce 1MB limit)
  if (compressedSize > MAX_COMPRESSED_SIZE_BYTES) {
    console.warn(
      `[Compression] Warning: Final size ${(compressedSize / 1024).toFixed(2)}KB exceeds 500KB target. Backend will enforce 1MB limit before upload.`
    );
  }

  return {
    dataUrl,
    contentType: outputType
  };
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  if (!crypto?.subtle) return null;
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function getAuthHeaders(includeBearer = true) {
  const headers: any = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json; charset=utf-8'
  };
  if (!includeBearer) return headers;

  try {
    const session = await ensureFreshSession();
    const token = session?.access_token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (error) {
    // Não bloquear chamadas autenticadas por cookie de sessão quando o refresh de token falhar.
    // O backend já valida a sessão server-side via `credentials: include`.
    console.warn('[auth-headers] ensureFreshSession falhou; seguindo com sessão por cookie.');
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

function extractLatestProtocolReference(row: any) {
  if (!row || typeof row !== 'object') {
    return {
      protocolId: '',
      levelId: '',
      protocolName: '',
      updatedAt: '',
      createdAt: '',
      source: ''
    };
  }

  const nestedTaskData = row?.task_data && typeof row.task_data === 'object' ? row.task_data : {};
  const nestedMetadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  const protocolId = String(
    row?.protocol_id ??
      row?.protocolId ??
      nestedTaskData?.protocol_id ??
      nestedTaskData?.protocolId ??
      nestedMetadata?.protocol_id ??
      nestedMetadata?.protocolId ??
      ''
  ).trim();

  const levelId = String(
    row?.level_id ??
      row?.levelId ??
      nestedTaskData?.level_id ??
      nestedTaskData?.levelId ??
      nestedMetadata?.level_id ??
      nestedMetadata?.levelId ??
      ''
  ).trim();

  const protocolName = String(
    row?.protocol_name ??
      row?.protocolTitle ??
      row?.protocol_title ??
      row?.level_name ??
      row?.levelName ??
      nestedTaskData?.protocol_name ??
      nestedTaskData?.protocolTitle ??
      nestedTaskData?.level_name ??
      nestedTaskData?.levelName ??
      nestedMetadata?.protocol_name ??
      nestedMetadata?.protocolTitle ??
      nestedMetadata?.canonicalName ??
      nestedMetadata?.level_name ??
      nestedMetadata?.levelName ??
      ''
  ).trim();

  return {
    protocolId,
    levelId,
    protocolName,
    updatedAt: String(row?.updated_at || row?.updatedAt || '').trim(),
    createdAt: String(row?.created_at || row?.createdAt || '').trim(),
    source: String(row?.source || '').trim()
  };
}

async function tryFetchLatestProtocolRow(
  supabase: any,
  table: string,
  patientColumn: string,
  patientId: string
) {
  const baseQuery = () => supabase.from(table).select('*').eq(patientColumn, patientId).limit(1);
  const attempts = [
    () => baseQuery().order('updated_at', { ascending: false }).order('created_at', { ascending: false }),
    () => baseQuery().order('created_at', { ascending: false }),
    () => baseQuery()
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await attempt();
      if (error) {
        const message = String(error?.message || '').toLowerCase();
        const retryable =
          message.includes('column') ||
          message.includes('does not exist') ||
          message.includes('schema cache') ||
          message.includes('failed to parse order');
        if (retryable) continue;
        return { row: null, error };
      }

      const row = Array.isArray(data) ? data[0] || null : data || null;
      if (row) return { row, error: null };
    } catch (error) {
      continue;
    }
  }

  return { row: null, error: null };
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

function clinicProtocolsBackupKey(workspaceId?: string | null) {
  return `verto_clinic_protocols_backup:${String(workspaceId || 'active').trim() || 'active'}`;
}

function readClinicProtocolsBackup(workspaceId?: string | null) {
  try {
    const raw = localStorage.getItem(clinicProtocolsBackupKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return ensureArray(parsed?.protocols);
  } catch {
    return [];
  }
}

function writeClinicProtocolsBackup(workspaceId: string | undefined | null, protocols: any[]) {
  try {
    localStorage.setItem(
      clinicProtocolsBackupKey(workspaceId),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        protocols: ensureArray(protocols),
      }),
    );
  } catch (error) {
    console.warn('[clinic-state] failed to persist protocol backup:', error);
  }
}

async function getLocalRecordsData(type: OfflineType) {
  try {
    const local = await getRecordsByType(type);
    return local.map((r) => r.data).filter(Boolean);
  } catch (error) {
    console.warn(`[offline-cache] failed to read local ${type} cache:`, error);
    return [];
  }
}

function mergeRecordsById(remote: any[], local: any[]) {
  const merged = new Map<string, any>();
  const getId = (item: any) => String(item?.id || item?.idempotencyKey || item?.idempotency_key || '').trim();
  for (const item of [...local, ...remote]) {
    const id = getId(item);
    if (!id) continue;
    const existing = merged.get(id) || {};
    merged.set(id, { ...existing, ...item });
  }
  return Array.from(merged.values()).sort((a, b) => {
    const ta = new Date(a?.timestamp || a?.created_at || a?.updated_at || 0).getTime();
    const tb = new Date(b?.timestamp || b?.created_at || b?.updated_at || 0).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

function normalizeNoteVisibility(value: any): 'private' | 'shared_patient' | 'shared_clinic' {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'private';
  if (raw === 'shared_clinic' || raw === 'professional') return 'shared_clinic';
  if (raw === 'shared_patient' || raw === 'shared' || raw === 'patient' || raw === 'family') return 'shared_patient';
  return 'private';
}

type OfflineType = 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment' | 'aba';

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
async function saveOfflineFirst(id: string, data: any, type: OfflineType, endpoint: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') {
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
      if (result?.queued === true) {
        return {
          success: false,
          offline: true,
          pending: true,
          status: response.status,
          warning: result?.warning,
          details: result,
          data: payloadWithIdempotency
        };
      }
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
        code: errorPayload?.code || errorPayload?.error_code || undefined,
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
      code: errorPayload?.code || errorPayload?.error_code || undefined,
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
    if (isTechnicalActivityLog(log)) {
      return { success: true, ignored: true };
    }
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
        const fileHash = await sha256Hex(payload.fileBlob);
        const metadataWithHash = {
          ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
          ...(fileHash ? { fileSha256: fileHash } : {})
        };
        if (Object.keys(metadataWithHash).length > 0) {
          formData.append('metadata', JSON.stringify(metadataWithHash));
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
    const endpoint = '/api/logs?limit=2000';
    try {
      const localLogs = filterActivityLogsForClinicView(await getLocalRecordsData('log'));
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'log'),
        credentials: 'include'
      });
      if (response.status === 304) {
        return { success: true, data: mergeRecordsById([], localLogs) };
      }
      if (response.ok) {
        const result = await response.json();
        const remoteLogs = filterActivityLogsForClinicView(ensureArray(result.data));
        let latest = 0;
        for (const l of remoteLogs) {
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
        return { ...result, success: true, data: mergeRecordsById(remoteLogs, localLogs) };
      }
    } catch (error) {
      console.log('Fetching logs from local storage...');
    }
    return { success: true, data: filterActivityLogsForClinicView(mergeRecordsById([], await getLocalRecordsData('log'))) };
  },

  async updateActivityLog(id: string, updates: any) {
    return await saveOfflineFirst(id, updates, 'log', `/api/logs/${id}`, 'PATCH');
  },

  async archiveActivityLog(id: string) {
    return await saveOfflineFirst(id, { id, status: 'archived' }, 'log', `/api/logs/${id}`, 'DELETE');
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

  async saveAbaSession(session: any) {
    const id = String(session?.id || session?.session_id || session?.sessionId || generateId());
    const data = {
      ...(session || {}),
      id,
      patient_id: session?.patient_id || session?.patientId,
      patientId: session?.patient_id || session?.patientId,
      therapist_id: session?.therapist_id || session?.therapistId,
      therapistId: session?.therapist_id || session?.therapistId,
      started_at: session?.started_at || session?.startedAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/sessions');
  },

  async updateAbaSession(sessionId: string, updates: any) {
    return await saveOfflineFirst(
      String(sessionId),
      updates || {},
      'aba',
      `/api/aba/sessions/${encodeURIComponent(String(sessionId))}`,
      'PATCH'
    );
  },

  async saveAbaSessionSummary(summary: any) {
    const id = String(summary?.id || summary?.summary_id || summary?.summaryId || generateId());
    const data = {
      ...(summary || {}),
      id,
      session_id: summary?.session_id || summary?.sessionId,
      sessionId: summary?.session_id || summary?.sessionId,
      patient_id: summary?.patient_id || summary?.patientId,
      patientId: summary?.patient_id || summary?.patientId,
      therapist_id: summary?.therapist_id || summary?.therapistId,
      therapistId: summary?.therapist_id || summary?.therapistId,
      started_at: summary?.started_at || summary?.startedAt,
      startedAt: summary?.started_at || summary?.startedAt,
      ended_at: summary?.ended_at || summary?.endedAt,
      endedAt: summary?.ended_at || summary?.endedAt,
      duration_seconds: summary?.duration_seconds ?? summary?.durationSeconds,
      durationSeconds: summary?.duration_seconds ?? summary?.durationSeconds,
      trial_types_used: summary?.trial_types_used || summary?.trialTypesUsed || [],
      trialTypesUsed: summary?.trial_types_used || summary?.trialTypesUsed || [],
      mastery_summary: summary?.mastery_summary || summary?.masterySummary || [],
      masterySummary: summary?.mastery_summary || summary?.masterySummary || [],
      blocking_items: summary?.blocking_items || summary?.blockingItems || summary?.pending_items || summary?.pendingItems || [],
      blockingItems: summary?.blocking_items || summary?.blockingItems || summary?.pending_items || summary?.pendingItems || [],
      warning_items: summary?.warning_items || summary?.warningItems || summary?.pending_warnings || summary?.pendingWarnings || [],
      warningItems: summary?.warning_items || summary?.warningItems || summary?.pending_warnings || summary?.pendingWarnings || [],
      pending_warnings: summary?.pending_warnings || summary?.pendingWarnings || [],
      pendingWarnings: summary?.pending_warnings || summary?.pendingWarnings || [],
      session_note: summary?.session_note ?? summary?.sessionNote ?? '',
      sessionNote: summary?.session_note ?? summary?.sessionNote ?? '',
      syncStatus: summary?.syncStatus || 'local',
      created_at: summary?.created_at || summary?.createdAt || new Date().toISOString(),
      createdAt: summary?.created_at || summary?.createdAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/session-summaries');
  },

  async getAbaSessions(patientId: string) {
    const endpoint = `/api/aba/sessions/${encodeURIComponent(String(patientId))}`;
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching ABA sessions from local storage...');
    }
    const local = await getRecordsByType('aba');
    return {
      success: true,
      data: local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.started_at || row?.startedAt)
        )
    };
  },

  async saveAbaTrial(trial: any) {
    const id = String(trial?.id || trial?.trial_id || trial?.trialId || generateId());
    const abaPromptLevel = resolveAbaPromptLevel({
      promptLevelKey: trial?.prompt_level_key || trial?.promptLevelKey,
      promptLevelName: trial?.prompt_level_name || trial?.promptLevelName,
      score: trial?.response_score ?? trial?.responseScore ?? trial?.score,
      maxScore: trial?.max_score ?? trial?.maxScore,
      correct: trial?.correct,
      independent: trial?.independent
    });
    const data = {
      ...(trial || {}),
      id,
      patient_id: trial?.patient_id || trial?.patientId,
      patientId: trial?.patient_id || trial?.patientId,
      session_id: trial?.session_id || trial?.sessionId,
      sessionId: trial?.session_id || trial?.sessionId,
      target_id: trial?.target_id || trial?.targetId,
      targetId: trial?.target_id || trial?.targetId,
      trialType: trial?.trialType || trial?.trial_type || trial?.collection_type || trial?.collectionType,
      promptLevel: abaPromptLevel.key,
      prompt_level_key: abaPromptLevel.key,
      promptLevelKey: abaPromptLevel.key,
      prompt_level_name: abaPromptLevel.label,
      promptLevelName: abaPromptLevel.label,
      isIndependent: Boolean(trial?.isIndependent ?? trial?.independent),
      isCorrect: Boolean(trial?.isCorrect ?? trial?.correct),
      therapist_id: trial?.therapist_id || trial?.therapistId,
      therapistId: trial?.therapist_id || trial?.therapistId,
      occurred_at: trial?.occurred_at || trial?.occurredAt || trial?.timestamp || new Date().toISOString(),
      timestamp: trial?.timestamp || trial?.occurred_at || trial?.occurredAt || new Date().toISOString(),
      syncStatus: trial?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/trials');
  },

  async getAbaTrials(patientId: string) {
    const endpoint = `/api/aba/trials/${encodeURIComponent(String(patientId))}`;
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching ABA trials from local storage...');
    }
    const local = await getRecordsByType('aba');
    return {
      success: true,
      data: local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          !(row?.evaluation_status || row?.evaluationStatus) &&
          (row?.target_name || row?.targetName || row?.collection_type || row?.collectionType)
        )
    };
  },

  async saveAbaBehaviorEvent(event: any) {
    const id = String(event?.id || event?.event_id || event?.eventId || generateId());
    const timestamp = event?.timestamp || event?.occurred_at || event?.occurredAt || new Date().toISOString();
    const data = {
      ...(event || {}),
      id,
      patient_id: event?.patient_id || event?.patientId,
      patientId: event?.patient_id || event?.patientId,
      session_id: event?.session_id || event?.sessionId,
      sessionId: event?.session_id || event?.sessionId,
      therapist_id: event?.therapist_id || event?.therapistId,
      therapistId: event?.therapist_id || event?.therapistId,
      measurement_type: event?.measurement_type || event?.measurementType,
      measurementType: event?.measurement_type || event?.measurementType,
      occurred_at: timestamp,
      timestamp,
      syncStatus: event?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/behavior-events');
  },

  async deleteAbaBehaviorEvent(eventId: string, context: any = {}) {
    const id = String(eventId || context?.id || context?.event_id || context?.eventId || generateId());
    const data = {
      ...(context || {}),
      id,
      event_id: id,
      eventId: id,
      patient_id: context?.patient_id || context?.patientId,
      patientId: context?.patient_id || context?.patientId,
      session_id: context?.session_id || context?.sessionId,
      sessionId: context?.session_id || context?.sessionId,
      deleted_at: context?.deleted_at || context?.deletedAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', `/api/aba/behavior-events/${encodeURIComponent(id)}`, 'DELETE');
  },

  async getAbaBehaviorEvents(patientId: string) {
    const endpoint = `/api/aba/behavior-events/${encodeURIComponent(String(patientId))}`;
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching ABA behavior events from local storage...');
    }
    const local = await getRecordsByType('aba');
    return {
      success: true,
      data: local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.behavior_name || row?.behaviorName || row?.measurement_type || row?.measurementType)
        )
    };
  },

  async saveAbaMasteryEvaluation(evaluation: any) {
    const id = String(evaluation?.id || evaluation?.evaluation_id || evaluation?.evaluationId || generateId());
    const data = {
      ...(evaluation || {}),
      id,
      patient_id: evaluation?.patient_id || evaluation?.patientId,
      evaluated_at: evaluation?.evaluated_at || evaluation?.evaluatedAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/mastery-evaluations');
  },

  async getAbaMasteryEvaluations(patientId: string) {
    const endpoint = `/api/aba/mastery-evaluations/${encodeURIComponent(String(patientId))}`;
    try {
      const response = await fetch(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        return result;
      }
    } catch (error) {
      console.log('Fetching ABA mastery evaluations from local storage...');
    }
    const local = await getRecordsByType('aba');
    return {
      success: true,
      data: local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.evaluation_status || row?.evaluationStatus || row?.suggested_phase || row?.suggestedPhase)
        )
    };
  },

  async addPatientLog(log: {
    id?: string;
    patient_id: string;
    professional_id?: string | null;
    type: 'task' | 'mood' | 'energy' | string;
    value: any;
    timestamp?: string;
  }) {
    const id = log.id || generateId();
    const data = {
      ...log,
      id,
      timestamp: log.timestamp || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'log', '/api/patient-logs');
  },

  async getPatientLogs(patientId: string) {
    try {
      const response = await fetch(`/api/patient-logs/${patientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient logs:', error);
      const local = await getRecordsByType('log');
      return {
        success: true,
        data: local
          .map(r => r.data)
          .filter((row: any) => String(row?.patient_id || row?.patientId || '') === String(patientId))
      };
    }
  },

  async subscribeToPatientLogs(patientId: string, onChange: () => void) {
    try {
      const supabase = await getSupabase();
      if (!supabase?.channel) return () => {};
      const channel = supabase
        .channel(`patient-logs-${patientId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'patient_logs', filter: `patient_id=eq.${patientId}` },
          () => onChange()
        )
        .subscribe();
      return () => {
        try {
          supabase.removeChannel(channel);
        } catch {
          // no-op
        }
      };
    } catch {
      return () => {};
    }
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

  async updatePayment(paymentId: string, updates: any) {
    return await saveOfflineFirst(
      String(paymentId),
      updates,
      'payment',
      `/api/payments/${encodeURIComponent(String(paymentId))}`,
      'PATCH'
    );
  },

  async getProfessionalPayments() {
    try {
      const response = await fetch('/api/financial/professional-payments', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) return await response.json();
    } catch (error) {
      console.error('Error fetching professional payments:', error);
    }
    return { success: true, data: [] };
  },

  async saveProfessionalPayment(payment: any) {
    const id = generateId();
    return await saveOfflineFirst(id, payment, 'payment', '/api/financial/professional-payments');
  },

  async updateProfessionalPayment(paymentId: string, updates: any) {
    return await saveOfflineFirst(
      String(paymentId),
      updates,
      'payment',
      `/api/financial/professional-payments/${encodeURIComponent(String(paymentId))}`,
      'PATCH'
    );
  },

  async getClinicFinancialEntries() {
    try {
      const response = await fetch('/api/financial/entries', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) return await response.json();
    } catch (error) {
      console.error('Error fetching clinic financial entries:', error);
    }
    return { success: true, data: [] };
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
        await saveEncryptedRecord({
          id: userId,
          data: stripEphemeralProfileMedia(result),
          type: 'profile',
          sync_status: 'synced',
          last_updated: Date.now(),
          method: 'POST',
          endpoint: `/api/profile/${userId}`
        });
        return result;
      }
    } catch (error) {
      console.log('Fetching profile from local storage...');
    }
    const local = await getRecordById(userId);
    return local ? local.data : { success: false };
  },

  async updatePatientSelfProfile(profile: {
    name?: string;
    address?: string;
    profilePicture?: string | null;
    profilePicturePath?: string | null;
  }) {
    try {
      const response = await fetch('/api/patient/self/profile', {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(profile || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating patient profile:', error);
      return { success: false, error: String(error) };
    }
  },

  async getUserProfileMedia(userId: string) {
    try {
      const response = await fetch(`/api/profile/${userId}/media`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error refreshing user profile media:', error);
      return { success: false, error: String(error) };
    }
  },

  async discoverLatestPatientProtocol(patientId: string) {
    const normalizedPatientId = String(patientId || '').trim();
    if (!normalizedPatientId) {
      return { success: false, error: 'patient_id ausente', data: null };
    }

    return { success: true, data: null };
  },

  async uploadFile(bucket: string, path: string, file: File) {
    // Sensible uploads (patient photos) must always pass through backend auth checks.
    if (bucket === 'patient-photos') {
      try {
        const prepared = await compressImageDataUrl(file, {
          maxDimension: 1200,
          quality: 0.78,
          mimeType: 'image/jpeg'
        });

        const response = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            bucket,
            path,
            contentType: prepared.contentType,
            fileBase64: prepared.dataUrl
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
      const shouldCompressPatientPhoto = bucket === 'patient-photos';
      const prepared = shouldCompressPatientPhoto
        ? await compressImageDataUrl(dataUrl, { maxDimension: 1200, quality: 0.78, mimeType: 'image/jpeg' })
        : { dataUrl, contentType: contentTypeHint || 'image/png' };
      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          bucket,
          path,
          contentType: prepared.contentType,
          fileBase64: prepared.dataUrl
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

  async unlinkClinicMember(memberId: string) {
    try {
      const response = await fetch(`/api/clinic/members/${memberId}/unlink`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const result = await response.json();
      if (!response.ok) return { success: false, error: result.error || 'Falha ao desvincular membro' };
      return { success: true, ...result };
    } catch (error) {
      console.error('Error unlinking clinic member:', error);
      return { success: false, error: 'Erro ao desvincular membro' };
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
      const remoteProtocols = ensureArray(clinicData?.protocols);
      const backupProtocols = readClinicProtocolsBackup(workspaceId);
      const protocols = remoteProtocols.length > 0 || clinicData?.updatedAt ? remoteProtocols : backupProtocols;
      return {
        ...result,
        data: {
          clinicId: clinicData?.clinicId || workspaceId || null,
          rooms: ensureArray(clinicData?.rooms),
          appointments: ensureArray(clinicData?.appointments),
          protocols,
          specialtySettings:
            clinicData?.specialtySettings && typeof clinicData.specialtySettings === 'object'
              ? clinicData.specialtySettings
              : {},
          updatedAt: clinicData?.updatedAt || null
        }
      };
    } catch (error) {
      console.error('Error fetching clinic state:', error);
      return {
        success: false,
        error: String(error),
        data: {
          clinicId: workspaceId || null,
          rooms: [],
          appointments: [],
          protocols: readClinicProtocolsBackup(workspaceId),
          specialtySettings: {},
          updatedAt: null
        }
      };
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
      if (Array.isArray(payload?.protocols)) {
        writeClinicProtocolsBackup(payload?.workspace_id, payload.protocols);
      }
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
      const result = await safeJson(response);
      if (Array.isArray(result?.data?.protocols)) {
        writeClinicProtocolsBackup(payload?.workspace_id, result.data.protocols);
      }
      return result;
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
          h?.date_group ||
          h?.dateGroup ||
          (h?.created_at && new Date(h.created_at).toDateString() === new Date().toDateString()
            ? 'Hoje'
            : h?.created_at
              ? new Date(h.created_at).toLocaleDateString()
              : '')
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
          completed: String(t?.status || '').toLowerCase() === 'completed',
          completed_at: t?.completed_at || null,
          reviewed_at: t?.reviewed_at || null,
          patient_effort: t?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? null,
          patientEffort: t?.patient_effort ?? taskData?.patientEffort ?? taskData?.patient_effort ?? null,
          patient_effort_emoji: t?.patient_effort_emoji ?? taskData?.patientEffortEmoji ?? taskData?.patient_effort_emoji ?? null,
          patientEffortEmoji: t?.patient_effort_emoji ?? taskData?.patientEffortEmoji ?? taskData?.patient_effort_emoji ?? null,
          patient_effort_label: t?.patient_effort_label ?? taskData?.patientEffortLabel ?? taskData?.patient_effort_label ?? null,
          patientEffortLabel: t?.patient_effort_label ?? taskData?.patientEffortLabel ?? taskData?.patient_effort_label ?? null,
          patient_comment: t?.patient_comment ?? '',
          pro_score: t?.pro_score ?? taskData?.pro_score ?? taskData?.proScore ?? null,
          professionalScore: t?.pro_score ?? taskData?.pro_score ?? taskData?.proScore ?? null,
          max_score: t?.max_score ?? taskData?.max_score ?? taskData?.maxScore ?? null,
          pro_review_note: t?.pro_review_note ?? taskData?.pro_review_note ?? taskData?.proReviewNote ?? '',
          consecutive_successes: t?.consecutive_successes ?? taskData?.consecutive_successes ?? null,
          task_data: taskData,
          taskData,
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
        financialPlans: Array.isArray(recordPayload?.financialPlans)
          ? recordPayload.financialPlans
          : Array.isArray(patient?.financialPlans)
            ? patient.financialPlans
            : [],
        monthlyTreatmentValue: Number(recordPayload?.monthlyTreatmentValue ?? patient?.monthlyTreatmentValue ?? 0) || 0,
        billingDueDay: recordPayload?.billingDueDay || patient?.billingDueDay || null,
        billingMethod: recordPayload?.billingMethod || patient?.billingMethod || null,
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

    const clinicStateData = clinicStateRes?.data || {
      clinicId: workspaceId || null,
      rooms: [],
      appointments: [],
      protocols: [],
      specialtySettings: {},
      updatedAt: null
    };
    const remoteProtocols = ensureArray(clinicStateData?.protocols);
    const backupProtocols = readClinicProtocolsBackup(workspaceId);
    const clinicStateWithProtocolFallback = {
      ...clinicStateData,
      protocols: remoteProtocols.length > 0 || clinicStateData?.updatedAt ? remoteProtocols : backupProtocols
    };

    return {
      success: true,
      data: {
        clinicState: clinicStateWithProtocolFallback,
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
