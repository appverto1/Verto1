import { ensureFreshSession, getSupabase } from '../lib/supabase';
import {
  generateId,
  getEndpointCacheMeta,
  getLatestTypeUpdate,
  getRecordById,
  getRecordsByType,
  markRecordSyncStatus,
  markRecordSyncFailure,
  saveEncryptedRecord,
  setEndpointCacheMeta
} from './localDb';
import { resolveAbaPromptLevel } from '../utils/abaPromptLevels';
import { isAbaV2Enabled } from '../utils/featureFlags';
import { sanitizeTechnicalErrorMessage } from '../utils/displayLabels';
import { isIdempotentConflictPayload } from '../utils/offlineSyncResilience';
import { normalizePatientProfileType } from '../utils/patientProfileType';

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

function normalizeListLimit(value: unknown, fallback = 50, max = 50): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(1, Math.round(numeric)));
}

const PERSISTED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYNTHETIC_CLINICAL_ID_RE = /^(maintenance-|session-|target-|local-|temp-|tmp-|offline-)|^\d{9,}$/i;
const PERSISTED_MAINTENANCE_SCHEDULE_ID_RE = /^maintenance-[a-z0-9][a-z0-9-]{7,}$/i;

function isPersistedUuid(value: unknown): boolean {
  const id = String(value || '').trim();
  return PERSISTED_UUID_RE.test(id) && !SYNTHETIC_CLINICAL_ID_RE.test(id);
}

function isPersistedMaintenanceScheduleId(value: unknown): boolean {
  const id = String(value || '').trim();
  if (isPersistedUuid(id)) return true;
  if (!PERSISTED_MAINTENANCE_SCHEDULE_ID_RE.test(id)) return false;
  return !/(^|-)local-|(^|-)temp-|(^|-)tmp-|(^|-)offline-/i.test(id);
}

function isSyntheticClinicalId(value: unknown): boolean {
  const id = String(value || '').trim();
  return !id || SYNTHETIC_CLINICAL_ID_RE.test(id);
}

function invalidClinicalIdResponse(error: string, data: any = null) {
  return { success: false, data, error, message: error };
}

function endpointWithLimit(endpoint: string, limit: number): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}limit=${encodeURIComponent(String(limit))}`;
}

function endpointWithPagination(endpoint: string, options: { page?: number; pageSize?: number; limit?: number } = {}): string {
  const pageSize = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
  const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`;
}

function endpointWithQuery(endpoint: string, params: Record<string, any> = {}): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  if (!query) return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${query}`;
}

type ClinicalQueryAuditOptions = {
  helperName?: string;
  operation?: 'list' | 'detail' | 'write';
  table?: string;
  hasExplicitColumns?: boolean;
  requiresPatientOrSession?: boolean;
  afterWriteRefetch?: boolean;
};

function isClinicalEndpoint(endpoint: string) {
  return /\/api\/(aba|calendar|closure|conference|portal|appointments|admin\/payers|admin\/payer-requirements|notes|history|tasks|assigned-tasks|patient-anamnesis|patients|patient-records)/.test(endpoint);
}

function isDevQueryAuditEnabled() {
  return Boolean(import.meta.env?.DEV);
}

function extractEndpointLimit(endpoint: string): number | null {
  try {
    const parsed = new URL(endpoint, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const limit = Number(parsed.searchParams.get('pageSize') || parsed.searchParams.get('limit'));
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  } catch {
    const match = endpoint.match(/[?&](?:pageSize|limit)=(\d+)/);
    return match ? Number(match[1]) : null;
  }
}

function countClinicalRows(payload: any): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (payload?.data && typeof payload.data === 'object') return 1;
  if (payload?.data === null) return 0;
  return null;
}

async function logClinicalQueryResult(endpoint: string, response: Response, options: ClinicalQueryAuditOptions = {}) {
  if (!isDevQueryAuditEnabled() || !isClinicalEndpoint(endpoint)) return;
  try {
    const responseText = await response.clone().text();
    let rows: number | null = null;
    try {
      rows = countClinicalRows(JSON.parse(responseText));
    } catch {
      rows = null;
    }
    const approxBytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(responseText).length
      : responseText.length;
    console.info('[egress-query]', {
      helper: options.helperName || 'unknown',
      table: options.table || 'unknown',
      operation: options.operation || 'unknown',
      limit: extractEndpointLimit(endpoint),
      rows,
      approxBytes,
      status: response.status,
      endpoint
    });
  } catch {
    // Dev-only telemetry must never affect the clinical flow.
  }
}

function auditClinicalQuery(endpoint: string, options: ClinicalQueryAuditOptions = {}) {
  if (!import.meta.env?.DEV) return;
  if (!isClinicalEndpoint(endpoint)) return;
  const warnings: string[] = [];
  const isList = options.operation === 'list';
  if (isList && !/[?&](limit|pageSize)=/.test(endpoint)) warnings.push('sem limit/pageSize');
  if (options.hasExplicitColumns === false) warnings.push("select('*')/payload amplo");
  if (options.requiresPatientOrSession !== false) {
      const hasScopedPath = /\/api\/aba\/(session-live-summaries|session-reports|recent-session-events)\/[^/?]+/.test(endpoint) ||
      /\/api\/calendar\/events(?:\/[^/?]+\/detail)?/.test(endpoint) ||
      /\/api\/closure\/appointments(?:\/[^/?]+)?/.test(endpoint) ||
      /\/api\/conference\/monthly(?:\/[^/?]+)?/.test(endpoint) ||
      /\/api\/portal\/appointments(?:\/[^/?]+)?/.test(endpoint) ||
      /\/api\/portal\/sessions\/[^/?]+\/sign/.test(endpoint) ||
      /\/api\/appointments\/(?:[^/?]+\/action-requests|action-requests\/[^/?]+\/(?:approve|reject))/.test(endpoint) ||
      /\/api\/appointments\/[^/?]+\/billing-context/.test(endpoint) ||
      /\/api\/appointments\/[^/?]+\/required-documents\/[^/?]+\/waive/.test(endpoint) ||
      /\/api\/admin\/payers(?:\/[^/?]+\/requirements)?/.test(endpoint) ||
      /\/api\/admin\/payer-requirements\/[^/?]+/.test(endpoint) ||
      /\/api\/patients\/[^/?]+\/aba\/maintenance-panel/.test(endpoint) ||
      /\/api\/patients\/[^/?]+\/aba\/targets\/linkable/.test(endpoint) ||
      /\/api\/aba\/patients\/[^/?]+\/charts\/[^/?]+/.test(endpoint) ||
      /\/api\/aba\/patients\/[^/?]+\/(maintenance-schedules|next-session\/recommendations|next-session\/plan-items)/.test(endpoint) ||
      /\/api\/(notes|history|tasks|assigned-tasks|patient-anamnesis|patient-records)\/[^/?]+/.test(endpoint) ||
      /\/api\/aba\/(sessions|trials|behavior-events|mastery-evaluations|patient-summary|maintenance-overview)\/[^/?]+/.test(endpoint);
    const hasScopedQuery = /[?&](patientId|patient_id|sessionId|session_id|from|time_min)=/.test(endpoint);
    if (!hasScopedPath && !hasScopedQuery) warnings.push('sem patientId/sessionId aparente');
  }
  if (options.afterWriteRefetch) warnings.push('refetch amplo apos escrita');
  if (warnings.length > 0) {
    console.warn('[egress-audit]', endpoint, {
      table: options.table || 'unknown',
      operation: options.operation || 'unknown',
      warnings
    });
  }
}

async function fetchClinical(endpoint: string, init: RequestInit, audit: ClinicalQueryAuditOptions = {}) {
  auditClinicalQuery(endpoint, audit);
  const response = await fetch(endpoint, init);
  void logClinicalQueryResult(endpoint, response, audit);
  return response;
}

function sortByNewest(rows: any[], fields: string[]): any[] {
  return [...(Array.isArray(rows) ? rows : [])].sort((a: any, b: any) => {
    const aValue = fields.map((field) => a?.[field]).find(Boolean) || 0;
    const bValue = fields.map((field) => b?.[field]).find(Boolean) || 0;
    return new Date(bValue).getTime() - new Date(aValue).getTime();
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
  if (import.meta.env.DEV) {
    console.error('Data Error: ', JSON.stringify(errInfo));
  } else {
    console.error('Data Error: ', sanitizeTechnicalErrorMessage(errInfo.error));
  }
  throw new Error(sanitizeTechnicalErrorMessage(errInfo.error));
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

  const readDataUrlContentType = (value: string) => value.match(/^data:([^;]+);base64,/)?.[1] || outputType;

  // Try initial quality
  let dataUrl = canvas.toDataURL(outputType, initialQuality);
  let actualOutputType = readDataUrlContentType(dataUrl);
  let compressedSize = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75); // Estimate base64 to binary size
  
  // If exceeds 500KB, retry with lower quality (0.60)
  if (compressedSize > MAX_COMPRESSED_SIZE_BYTES && initialQuality > 0.60) {
    console.warn(
      `[Compression] Initial quality ${initialQuality} resulted in ${(compressedSize / 1024).toFixed(2)}KB. Retrying with quality 0.60...`
    );
    dataUrl = canvas.toDataURL(outputType, 0.60);
    actualOutputType = readDataUrlContentType(dataUrl);
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
    contentType: actualOutputType
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

async function sha256TextHex(value: string): Promise<string | null> {
  if (!crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function extensionForImageContentType(contentType: string) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  return 'jpg';
}

function resolveIdempotentPatientPhotoPath(path: string, contentType: string, contentHash?: string | null) {
  const normalizedPath = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const hash = String(contentHash || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!hash) {
    return { path: normalizedPath, idempotent: false, idempotencyKey: '' };
  }

  const shortHash = hash.slice(0, 32);
  const extension = extensionForImageContentType(contentType);
  const onboardingMatch = normalizedPath.match(/^onboarding\/([^/]+)\/(profile|signature|logo)(?:[-/.]|$)/i);
  if (onboardingMatch) {
    const ownerId = onboardingMatch[1];
    const kind = onboardingMatch[2].toLowerCase();
    return {
      path: `onboarding/${ownerId}/${kind}/${kind}-${shortHash}.${extension}`,
      idempotent: true,
      idempotencyKey: `onboarding:${ownerId}:${kind}:${shortHash}`
    };
  }

  const patientProfileMatch = normalizedPath.match(/^([^/]+)\/profile(?:[-/.]|$)/i);
  if (patientProfileMatch) {
    const ownerId = patientProfileMatch[1];
    return {
      path: `${ownerId}/profile/profile-${shortHash}.${extension}`,
      idempotent: true,
      idempotencyKey: `patient-profile:${ownerId}:${shortHash}`
    };
  }

  return { path: normalizedPath, idempotent: false, idempotencyKey: '' };
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
    // Não bloquear chamadas autenticadas pela sessão HTTP quando o refresh falhar.
    // O backend já valida a sessão server-side via `credentials: include`.
    console.warn('[auth-headers] ensureFreshSession falhou; seguindo com sessão HTTP existente.');
  }
  return headers;
}

async function getNoStoreAuthHeaders(includeBearer = true) {
  return {
    ...(await getAuthHeaders(includeBearer)),
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Expires: '0'
  };
}

async function safeNoStoreJson(response: Response, staleError = 'Resposta cacheada rejeitada; atualize a conferência novamente.') {
  if (response.status === 304) {
    return { success: false, stale: true, error: staleError, status: 304 };
  }
  return await safeJson(response);
}

function endpointWithCacheBust(endpoint: string) {
  return endpointWithQuery(endpoint, {
    cacheBust: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  });
}

async function fetchNoStoreJsonWithRetry(
  endpoint: string,
  init: RequestInit,
  audit: ClinicalQueryAuditOptions,
  staleError: string
) {
  const requestInit = { ...init, cache: 'no-store' as RequestCache };
  let response = await fetchClinical(endpoint, requestInit, audit);
  if (response.status === 304) {
    response = await fetchClinical(endpointWithCacheBust(endpoint), requestInit, {
      ...audit,
      helperName: `${audit.helperName || 'clinical'}:cache-bust-retry`
    });
  }
  return await safeNoStoreJson(response, staleError);
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

function repairMojibakeMessage(value: string): string {
  return String(value || '')
    .replace(/NÃ£o/g, 'Não')
    .replace(/nÃ£o/g, 'não')
    .replace(/possÃ­vel/g, 'possível')
    .replace(/serializÃ¡vel/g, 'serializável')
    .replace(/comunicaÃ§Ã£o/g, 'comunicação')
    .replace(/conexÃ£o/g, 'conexão')
    .replace(/invÃ¡lida/g, 'inválida')
    .replace(/sessÃ£o/g, 'sessão');
}

function normalizeApiErrorMessage(value: any): string {
  if (typeof value === 'string') return sanitizeTechnicalErrorMessage(repairMojibakeMessage(value));
  if (value && typeof value === 'object') {
    const message = value.message || value.error || value.details;
    if (typeof message === 'string') return sanitizeTechnicalErrorMessage(repairMojibakeMessage(message));
    try {
      return sanitizeTechnicalErrorMessage(repairMojibakeMessage(JSON.stringify(value)));
    } catch {
      return '[erro não serializável]';
    }
  }
  return sanitizeTechnicalErrorMessage(repairMojibakeMessage(String(value || 'Erro desconhecido')));
}

export function getApiErrorMessage(error: any, fallback = 'Não foi possível atualizar a manutenção.'): string {
  const responseData = error?.response?.data || error?.data || null;
  const candidates = [
    responseData?.message,
    responseData?.error,
    error?.message,
    error?.error,
    typeof error === 'string' ? error : ''
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const message = normalizeApiErrorMessage(candidate);
    if (message && message !== 'Erro desconhecido') return message;
  }
  return fallback;
}

function normalizeClinicalMutationResult(result: any, fallback: string) {
  if (result?.success === false) {
    const message = getApiErrorMessage(result, fallback);
    return { ...result, error: message, message };
  }
  return result;
}

function normalizePatientInviteSuccess(result: any) {
  const status = String(result?.status || '').trim().toUpperCase();
  if (!result?.success) return result;
  if (status === 'ALREADY_LINKED') {
    return { ...result, message: result.message || 'Responsável já estava vinculado.' };
  }
  if (status === 'LINKED_EXISTING_USER') {
    return { ...result, message: result.message || 'Responsável existente vinculado ao paciente.' };
  }
  if (status === 'RELATIONSHIP_CONFIRMATION_SENT') {
    return {
      ...result,
      status,
      message: result.message || 'Confirmação de vínculo enviada para o responsável.',
      activationEmailSent: false,
      relationshipConfirmationSent: result.relationshipConfirmationSent ?? true
    };
  }
  if (status === 'INVITE_QUEUED' || status === 'INVITE_PENDING') {
    return {
      ...result,
      status,
      message: result.message || 'Convite preparado com sucesso.',
      activationEmailSent: result.activationEmailSent ?? null
    };
  }
  if (status === 'INVITE_FAILED_RETRYABLE') {
    return {
      ...result,
      status,
      warning: result.warning || result.message || 'Paciente cadastrado, mas o convite precisará ser reenviado.',
      activationEmailSent: false
    };
  }
  return result;
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
  const baseQuery = () => supabase.from(table).select(patientColumn).eq(patientColumn, patientId).limit(1);
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

function parseJsonValue(value: any) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonObject(value: any) {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function ensureArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function normalizeArrayLike(value: any, nestedKeys: string[] = []) {
  if (Array.isArray(value)) return value;

  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) return parsed;

  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;

  if (!source) return [];

  for (const key of nestedKeys) {
    const nested = source[key];
    if (Array.isArray(nested)) return nested;
    const parsedNested = parseJsonValue(nested);
    if (Array.isArray(parsedNested)) return parsedNested;
  }

  return [];
}

function normalizeProtocolList(value: any) {
  return normalizeArrayLike(value, ['protocols', 'items', 'data', 'value']).filter(Boolean);
}

function firstDefinedValue(source: any, keys: string[]) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function normalizePeiGoals(recordPayload: any, patientFallback?: any) {
  const peiKeys = ['pei', 'peiGoals', 'pei_goals', 'goals', 'metas'];
  const recordSource = firstDefinedValue(recordPayload, peiKeys);
  if (recordSource !== undefined) {
    return normalizeArrayLike(recordSource, peiKeys);
  }

  const wrappedRecordGoals = normalizeArrayLike(recordPayload, peiKeys);
  if (wrappedRecordGoals.length > 0) return wrappedRecordGoals;

  const patientSource = firstDefinedValue(patientFallback, peiKeys);
  return patientSource !== undefined ? normalizeArrayLike(patientSource, peiKeys) : [];
}

function clinicProtocolsBackupKey(workspaceId?: string | null) {
  return `verto_clinic_protocols_backup:${String(workspaceId || 'active').trim() || 'active'}`;
}

function readClinicProtocolsBackup(workspaceId?: string | null) {
  try {
    const raw = localStorage.getItem(clinicProtocolsBackupKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeProtocolList(parsed?.protocols);
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
        protocols: normalizeProtocolList(protocols),
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

function abaV2DisabledResponse(data: any = null) {
  return {
    success: true,
    disabled: true,
    feature: 'aba_v2',
    data
  };
}

const ABA_DEFAULT_SOURCE = 'verto_web';

function firstStringValue(...values: any[]) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function buildAbaIntegrityFields(input: any = {}, options: { includeRawPayload?: boolean } = {}) {
  const rawPayload = input?.raw_payload || input?.rawPayload || {};
  const clinicId = firstStringValue(
    input?.clinic_id,
    input?.clinicId,
    input?.organization_id,
    input?.organizationId,
    rawPayload?.clinicId,
    rawPayload?.organizationId
  );
  const appointmentId = firstStringValue(
    input?.appointment_id,
    input?.appointmentId,
    rawPayload?.appointment_id,
    rawPayload?.appointmentId
  );
  const source = firstStringValue(input?.source, input?.clientSource, rawPayload?.source, rawPayload?.clientSource, ABA_DEFAULT_SOURCE);
  const syncStatus = firstStringValue(input?.sync_status, input?.syncStatus, rawPayload?.syncStatus, 'local');
  const createdAt = firstStringValue(input?.created_at, input?.createdAt, new Date().toISOString());
  const fields: any = {
    source,
    clientSource: source,
    created_at: createdAt,
    createdAt
  };
  if (clinicId) {
    fields.clinic_id = clinicId;
    fields.clinicId = clinicId;
    fields.organization_id = firstStringValue(input?.organization_id, input?.organizationId, clinicId);
    fields.organizationId = firstStringValue(input?.organizationId, input?.organization_id, clinicId);
  }
  if (appointmentId) {
    fields.appointment_id = appointmentId;
    fields.appointmentId = appointmentId;
  }
  if (options.includeRawPayload !== false) {
    const nextRawPayload = {
      ...rawPayload,
      source,
      clientSource: source,
      syncStatus
    };
    if (appointmentId) {
      nextRawPayload.appointment_id = appointmentId;
      nextRawPayload.appointmentId = appointmentId;
    }
    if (clinicId) {
      nextRawPayload.clinicId = clinicId;
      nextRawPayload.organizationId = fields.organizationId;
    }
    fields.raw_payload = nextRawPayload;
    fields.rawPayload = nextRawPayload;
  }
  return fields;
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
      retry_count: 0,
      last_attempt_at: null,
      next_retry_at: null,
      last_error: null,
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
        await markRecordSyncFailure(id, {
          status: 503,
          retryable: true,
          error: result?.warning || 'Servidor enfileirou o sync para tentar depois.'
        });
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
    if (response.status === 409 && isIdempotentConflictPayload(errorPayload)) {
      await markRecordSyncStatus(id, 'synced');
      return {
        ...errorPayload,
        success: true,
        idempotent: true,
        status: response.status,
        data: errorPayload?.data || payloadWithIdempotency
      };
    }
    const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408;

    if (!isRetryable) {
      // Validation/auth errors should not retry forever, but the local record is kept for audit/retry UI.
      await markRecordSyncFailure(id, {
        status: response.status,
        retryable: false,
        error: errorPayload?.error || errorPayload?.message || `Falha permanente (${response.status})`
      });
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

    await markRecordSyncFailure(id, {
      status: response.status,
      retryable: true,
      error:
        errorPayload?.error ||
        errorPayload?.message ||
        `Falha temporária (${response.status})`
    });
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
    await markRecordSyncFailure(id, {
      retryable: true,
      error: error instanceof Error ? error.message : String(error)
    });
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
    const endpoint = endpointWithLimit('/api/patients', 200);
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'patient'),
        credentials: 'include'
      }, { helperName: 'getPatients', operation: 'list', table: 'patients', hasExplicitColumns: true, requiresPatientOrSession: false });
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

  async getPatientFinancialPlans(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(String(patientId))}/financial-plans`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient financial plans:', error);
      return { success: false, error: String(error) };
    }
  },

  async savePatientFinancialPlans(patientId: string, financialPlans: any[]) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(String(patientId))}/financial-plans`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ financialPlans: Array.isArray(financialPlans) ? financialPlans : [] })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving patient financial plans:', error);
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
        let uploadBlob: Blob = payload.fileBlob;
        let requestedFileName = String(payload?.fileName || 'arquivo.pdf').trim() || 'arquivo.pdf';
        let requestedMime = String(payload?.contentType || payload?.fileBlob?.type || 'application/octet-stream').trim().toLowerCase();
        if (requestedMime.startsWith('image/')) {
          const prepared = await compressImageDataUrl(uploadBlob, {
            maxDimension: 1600,
            quality: 0.78,
            mimeType: 'image/webp'
          });
          uploadBlob = await (await fetch(prepared.dataUrl)).blob();
          requestedMime = 'image/webp';
          requestedFileName = requestedFileName.replace(/\.[a-z0-9]+$/i, '') + '.webp';
        }
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
        const file = new File([uploadBlob], normalizedFileName, { type: safeMime });
        formData.append('file', file, normalizedFileName);
        formData.append('fileName', normalizedFileName);
        formData.append('contentType', safeMime);
        formData.append('source', String(payload?.source || 'upload'));
        const fileHash = await sha256Hex(uploadBlob);
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

  async createPatientUser(email: string, name: string, type?: string, cpf?: string | null, extra: Record<string, any> = {}) {
    try {
      const response = await fetch('/api/patients/create-user', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, name, type, cpf: cpf || undefined, ...extra })
      });
      const result = await safeJson(response);
      if (response.ok) return normalizePatientInviteSuccess(result);
      if (response.status === 409 && isIdempotentConflictPayload(result)) {
        return normalizePatientInviteSuccess({
          ...result,
          success: true,
          idempotent: true,
          status: result?.status || 'RESOLVED_IDEMPOTENT'
        });
      }
      if (response.status === 502 || response.status === 504) {
        return {
          success: false,
          status: response.status,
          code: 'INVITE_PREPARE_UNAVAILABLE',
          error: 'Não foi possível preparar o convite agora.',
          details: null
        };
      }
      return {
        success: false,
        status: response.status,
        code: result?.code || result?.error_code || undefined,
        error: normalizeApiErrorMessage(result?.error || result?.message || 'Não foi possível criar o acesso do paciente'),
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

  async sendPatientAnamnesisRequest(patientId: string, templateId?: string | null) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/anamnesis/send`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ templateId: templateId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error sending patient anamnesis request:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getPatientAnamnesisFlow(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/anamnesis`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading patient anamnesis flow:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async savePatientAnamnesisDraft(patientId: string, answers: any, requestId?: string | null) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/anamnesis/draft`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ answers, requestId: requestId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving patient anamnesis draft:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async submitPatientAnamnesis(patientId: string, answers: any, requestId?: string | null) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/anamnesis/submit`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ answers, requestId: requestId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error submitting patient anamnesis:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async reviewPatientAnamnesis(patientId: string, requestId?: string | null, responseId?: string | null) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/anamnesis/review`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ requestId: requestId || undefined, responseId: responseId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error reviewing patient anamnesis:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getPortalPatientAnamnesis(patientId: string) {
    try {
      const response = await fetch(`/api/portal/patients/${encodeURIComponent(patientId)}/anamnesis`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading portal anamnesis:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async savePortalAnamnesisDraft(patientId: string, answers: any, requestId?: string | null) {
    try {
      const response = await fetch(`/api/portal/patients/${encodeURIComponent(patientId)}/anamnesis/draft`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ answers, requestId: requestId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving portal anamnesis draft:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async submitPortalAnamnesis(patientId: string, answers: any, requestId?: string | null) {
    try {
      const response = await fetch(`/api/portal/patients/${encodeURIComponent(patientId)}/anamnesis/submit`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ answers, requestId: requestId || undefined })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error submitting portal anamnesis:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async sendPatientRelationshipConfirmation(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/relationship-confirmation/send`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error sending relationship confirmation:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async requestPortalLoginCode(email: string, relationshipToken?: string) {
    try {
      const response = await fetch('/api/portal/auth/request-code', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, relationshipToken })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error requesting portal login code:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async verifyPortalLoginCode(email: string, code: string) {
    try {
      const response = await fetch('/api/portal/auth/verify-code', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ email, code })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error verifying portal login code:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getRelationshipConfirmation(token: string) {
    try {
      const response = await fetch(`/api/portal/relationship-confirmations/${encodeURIComponent(token)}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading relationship confirmation:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async confirmRelationship(token: string) {
    try {
      const response = await fetch(`/api/portal/relationship-confirmations/${encodeURIComponent(token)}/confirm`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error confirming relationship:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async rejectRelationship(token: string) {
    try {
      const response = await fetch(`/api/portal/relationship-confirmations/${encodeURIComponent(token)}/reject`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error rejecting relationship:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async authorizeRelationshipHistory(token: string, scope: any) {
    try {
      const response = await fetch(`/api/portal/relationship-confirmations/${encodeURIComponent(token)}/authorize-history`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ scope })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error authorizing relationship history:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getPatientSharedHistory(patientId: string) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/shared-history`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading shared history:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getPatientLongitudinalTimeline(patientId: string, params: { limit?: number; offset?: number } = {}) {
    try {
      const searchParams = new URLSearchParams();
      if (params.limit) searchParams.set('limit', String(params.limit));
      if (params.offset) searchParams.set('offset', String(params.offset));
      const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/timeline${suffix}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading patient longitudinal timeline:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async getPatientImportedHistory(patientId: string, limit = 50) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/imported-history?limit=${encodeURIComponent(String(limit))}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading patient imported history:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
    }
  },

  async createPatientSharedHistorySnapshot(patientId: string, payload: any = {}) {
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/shared-history/snapshot`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error creating patient shared history snapshot:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
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
          error: normalizeApiErrorMessage(result?.error || result?.message || `Falha ao arquivar paciente (${response.status})`),
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
    const endpoint = '/api/logs?limit=200';
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
    const endpoint = endpointWithLimit(`/api/notes/${patientId}`, 20);
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
      const response = await fetch(endpointWithLimit(`/api/notes/email/${email}`, 20), {
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
      const response = await fetch(endpointWithLimit(`/api/history/${patientId}`, 20), {
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
      const response = await fetch(endpointWithLimit(`/api/history/email/${email}`, 20), {
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
      const response = await fetch(endpointWithLimit('/api/patient/self/history', 20), {
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
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(session || {});
    const id = String(session?.id || session?.session_id || session?.sessionId || generateId());
    const data = {
      ...(session || {}),
      ...buildAbaIntegrityFields(session),
      id,
      patient_id: session?.patient_id || session?.patientId,
      patientId: session?.patient_id || session?.patientId,
      therapist_id: session?.therapist_id || session?.therapistId,
      therapistId: session?.therapist_id || session?.therapistId,
      started_at: session?.started_at || session?.startedAt || new Date().toISOString(),
      source: session?.source || session?.clientSource || ABA_DEFAULT_SOURCE
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/sessions');
  },

  async updateAbaSession(sessionId: string, updates: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ id: String(sessionId), ...(updates || {}) });
    return await saveOfflineFirst(
      String(sessionId),
      updates || {},
      'aba',
      `/api/aba/sessions/${encodeURIComponent(String(sessionId))}`,
      'PATCH'
    );
  },

  async saveAbaSessionSummary(summary: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(summary || {});
    const id = String(summary?.id || summary?.summary_id || summary?.summaryId || generateId());
    const data = {
      ...(summary || {}),
      ...buildAbaIntegrityFields(summary),
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
      maintenance_summary: summary?.maintenance_summary || summary?.maintenanceSummary || [],
      maintenanceSummary: summary?.maintenance_summary || summary?.maintenanceSummary || [],
      blocking_items: summary?.blocking_items || summary?.blockingItems || summary?.pending_items || summary?.pendingItems || [],
      blockingItems: summary?.blocking_items || summary?.blockingItems || summary?.pending_items || summary?.pendingItems || [],
      warning_items: summary?.warning_items || summary?.warningItems || summary?.pending_warnings || summary?.pendingWarnings || [],
      warningItems: summary?.warning_items || summary?.warningItems || summary?.pending_warnings || summary?.pendingWarnings || [],
      pending_warnings: summary?.pending_warnings || summary?.pendingWarnings || [],
      pendingWarnings: summary?.pending_warnings || summary?.pendingWarnings || [],
      abc_summary: summary?.abc_summary || summary?.abcSummary || [],
      abcSummary: summary?.abc_summary || summary?.abcSummary || [],
      session_note: summary?.session_note ?? summary?.sessionNote ?? '',
      sessionNote: summary?.session_note ?? summary?.sessionNote ?? '',
      source: summary?.source || summary?.clientSource || ABA_DEFAULT_SOURCE,
      syncStatus: summary?.syncStatus || 'local',
      created_at: summary?.created_at || summary?.createdAt || new Date().toISOString(),
      createdAt: summary?.created_at || summary?.createdAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/session-summaries');
  },

  async getSessionLiveSummary(sessionId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/session-live-summaries/${encodeURIComponent(String(sessionId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getSessionLiveSummary', operation: 'detail', table: 'aba_session_live_summaries', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA live summary from local state only...');
    }
    return { success: true, data: null };
  },

  async getCalendarEvents(options: {
    from: string;
    to: string;
    view?: 'day' | 'week' | 'month' | string;
    therapistId?: string;
    patientId?: string;
    type?: string;
    status?: string;
    roomId?: string;
    locationType?: string;
    limit?: number;
  }) {
    const endpoint = endpointWithQuery('/api/calendar/events', {
      from: options.from,
      to: options.to,
      view: options.view,
      therapistId: options.therapistId,
      patientId: options.patientId,
      type: options.type,
      status: options.status,
      roomId: options.roomId,
      locationType: options.locationType,
      limit: normalizeListLimit(options.limit, 120, 200)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getCalendarEvents',
        operation: 'list',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching calendar events from local agenda only...');
      return { success: false, data: [], error: 'Não foi possível carregar a agenda agora.' };
    }
  },

  async getCalendarEventDetail(eventId: string) {
    const endpoint = `/api/calendar/events/${encodeURIComponent(String(eventId))}/detail`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getCalendarEventDetail',
        operation: 'detail',
        table: 'appointments,aba_next_session_plan_items,aba_maintenance_schedules',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      return { success: false, data: null, error: 'Não foi possível carregar os detalhes da sessão agora.' };
    }
  },

  async getPortalAppointments(options: { from?: string; to?: string; limit?: number } = {}) {
    const endpoint = endpointWithQuery('/api/portal/appointments', {
      from: options.from,
      to: options.to,
      limit: normalizeListLimit(options.limit, 40, 100)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPortalAppointments',
        operation: 'list',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar suas consultas agora.' };
    }
  },

  async getPortalNotifications(limit = 12) {
    try {
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
      const response = await fetch(`/api/portal/notifications?limit=${safeLimit}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching portal notifications:', error);
      return { success: false, error: String(error), data: [] };
    }
  },

  async markPortalNotification(notificationId: string, acknowledged = false) {
    try {
      const response = await fetch(`/api/portal/notifications/${encodeURIComponent(notificationId)}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ acknowledged })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating portal notification:', error);
      return { success: false, error: String(error) };
    }
  },

  async getPortalAppointmentDetail(appointmentId: string) {
    const endpoint = `/api/portal/appointments/${encodeURIComponent(String(appointmentId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPortalAppointmentDetail',
        operation: 'detail',
        table: 'appointments,appointment_action_requests,session_signatures,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar a consulta agora.' };
    }
  },

  async confirmPortalAppointment(appointmentId: string) {
    const endpoint = `/api/portal/appointments/${encodeURIComponent(String(appointmentId))}/confirm`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      }, {
        helperName: 'confirmPortalAppointment',
        operation: 'write',
        table: 'appointments,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível confirmar a consulta agora.' };
    }
  },

  async requestPortalAppointmentReschedule(appointmentId: string, payload: any = {}) {
    const endpoint = `/api/portal/appointments/${encodeURIComponent(String(appointmentId))}/request-reschedule`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'requestPortalAppointmentReschedule',
        operation: 'write',
        table: 'appointments,appointment_action_requests,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível solicitar remarcação agora.' };
    }
  },

  async requestPortalAppointmentCancel(appointmentId: string, payload: any = {}) {
    const endpoint = `/api/portal/appointments/${encodeURIComponent(String(appointmentId))}/request-cancel`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'requestPortalAppointmentCancel',
        operation: 'write',
        table: 'appointments,appointment_action_requests,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível solicitar cancelamento agora.' };
    }
  },

  async signPortalSession(sessionId: string, payload: any = {}) {
    const endpoint = `/api/portal/sessions/${encodeURIComponent(String(sessionId))}/sign`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'signPortalSession',
        operation: 'write',
        table: 'session_signatures,appointment_status_audit_logs,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível registrar a assinatura agora.' };
    }
  },

  async getAppointmentActionRequests(appointmentId: string) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/action-requests`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getAppointmentActionRequests',
        operation: 'list',
        table: 'appointment_action_requests',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar solicitações agora.' };
    }
  },

  async approveAppointmentActionRequest(requestId: string, payload: any = {}) {
    const endpoint = `/api/appointments/action-requests/${encodeURIComponent(String(requestId))}/approve`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'approveAppointmentActionRequest',
        operation: 'write',
        table: 'appointments,appointment_action_requests,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível aprovar a solicitação agora.' };
    }
  },

  async rejectAppointmentActionRequest(requestId: string, payload: any = {}) {
    const endpoint = `/api/appointments/action-requests/${encodeURIComponent(String(requestId))}/reject`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'rejectAppointmentActionRequest',
        operation: 'write',
        table: 'appointments,appointment_action_requests,appointment_status_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível recusar a solicitação agora.' };
    }
  },

  async getPayers(options: { status?: string; limit?: number } = {}) {
    const endpoint = endpointWithQuery('/api/admin/payers', {
      status: options.status,
      limit: normalizeListLimit(options.limit, 50, 100)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayers',
        operation: 'list',
        table: 'clinic_payers',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar pagadores agora.' };
    }
  },

  async createPayer(payload: any = {}) {
    const endpoint = '/api/admin/payers';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createPayer',
        operation: 'write',
        table: 'clinic_payers,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível criar o pagador agora.' };
    }
  },

  async updatePayer(payerId: string, payload: any = {}) {
    const endpoint = `/api/admin/payers/${encodeURIComponent(String(payerId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePayer',
        operation: 'write',
        table: 'clinic_payers,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o pagador agora.' };
    }
  },

  async getPayerRequirements(payerId: string) {
    const endpoint = `/api/admin/payers/${encodeURIComponent(String(payerId))}/requirements`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerRequirements',
        operation: 'list',
        table: 'clinic_payer_requirements',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar regras do pagador agora.' };
    }
  },

  async createPayerRequirement(payerId: string, payload: any = {}) {
    const endpoint = `/api/admin/payers/${encodeURIComponent(String(payerId))}/requirements`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createPayerRequirement',
        operation: 'write',
        table: 'clinic_payer_requirements,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível criar a regra agora.' };
    }
  },

  async updatePayerRequirement(requirementId: string, payload: any = {}) {
    const endpoint = `/api/admin/payer-requirements/${encodeURIComponent(String(requirementId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePayerRequirement',
        operation: 'write',
        table: 'clinic_payer_requirements,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar a regra agora.' };
    }
  },

  async getTussServices(options: any = {}) {
    const endpoint = endpointWithQuery('/api/admin/tuss/services', {
      active: options.active ? 'true' : undefined,
      limit: normalizeListLimit(options.limit, 80, 200)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTussServices',
        operation: 'list',
        table: 'tuss_service_catalog',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar procedimentos agora.' };
    }
  },

  async createTussService(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/admin/tuss/services', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createTussService',
        operation: 'write',
        table: 'tuss_service_catalog',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível criar o procedimento agora.' };
    }
  },

  async updateTussService(serviceId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/services/${encodeURIComponent(String(serviceId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateTussService',
        operation: 'write',
        table: 'tuss_service_catalog',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o procedimento agora.' };
    }
  },

  async getTussCodes(options: any = {}) {
    const endpoint = endpointWithQuery('/api/admin/tuss/codes', {
      active: options.active ? 'true' : undefined,
      limit: normalizeListLimit(options.limit, 100, 300)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTussCodes',
        operation: 'list',
        table: 'tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar códigos TUSS agora.' };
    }
  },

  async createTussCode(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/admin/tuss/codes', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createTussCode',
        operation: 'write',
        table: 'tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível criar o código TUSS agora.' };
    }
  },

  async updateTussCode(codeId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/codes/${encodeURIComponent(String(codeId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateTussCode',
        operation: 'write',
        table: 'tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o código TUSS agora.' };
    }
  },

  async getPayerTussMappings(options: any = {}) {
    const endpoint = endpointWithQuery('/api/admin/tuss/mappings', {
      payerId: options.payerId,
      active: options.active ? 'true' : undefined,
      limit: normalizeListLimit(options.limit, 120, 300)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerTussMappings',
        operation: 'list',
        table: 'payer_tuss_mappings,tuss_service_catalog,tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar mapeamentos TUSS-ready agora.' };
    }
  },

  async createPayerTussMapping(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/admin/tuss/mappings', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createPayerTussMapping',
        operation: 'write',
        table: 'payer_tuss_mappings',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível criar o mapeamento TUSS-ready agora.' };
    }
  },

  async updatePayerTussMapping(mappingId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/mappings/${encodeURIComponent(String(mappingId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePayerTussMapping',
        operation: 'write',
        table: 'payer_tuss_mappings',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o mapeamento TUSS-ready agora.' };
    }
  },

  async revalidatePayerTussMapping(mappingId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/mappings/${encodeURIComponent(String(mappingId))}/revalidate`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'revalidatePayerTussMapping',
        operation: 'write',
        table: 'appointments,appointment_billing_contexts,appointment_billing_items,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação TUSS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, error: 'Não foi possível revalidar os atendimentos afetados agora.' };
    }
  },

  async getAppointmentBillingContext(appointmentId: string) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/billing-context`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getAppointmentBillingContext',
        operation: 'detail',
        table: 'appointment_billing_contexts,appointment_required_documents',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar pagador da consulta agora.' };
    }
  },

  async updateAppointmentBillingContext(appointmentId: string, payload: any = {}) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/billing-context`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateAppointmentBillingContext',
        operation: 'write',
        table: 'appointment_billing_contexts,appointment_billing_items,payer_requirement_audit_logs,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      const result = await safeJson(response);
      if (!result?.success) {
        return {
          ...result,
          status: response.status,
          error: result?.error || 'Não foi possível salvar o pagador da consulta agora.'
        };
      }
      return result;
    } catch {
      return { success: false, error: 'Não foi possível salvar o pagador da consulta agora.' };
    }
  },

  async resolveAppointmentBillingItem(appointmentId: string) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/billing-item/resolve`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      }, {
        helperName: 'resolveAppointmentBillingItem',
        operation: 'write',
        table: 'appointment_billing_contexts,appointment_billing_items,appointment_closure_checks,tuss_service_catalog,tuss_codes,payer_tuss_mappings',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível resolver o item faturável agora.' };
    }
  },

  async waiveAppointmentRequiredDocument(appointmentId: string, documentId: string, payload: { reason: string }) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/required-documents/${encodeURIComponent(String(documentId))}/waive`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'waiveAppointmentRequiredDocument',
        operation: 'write',
        table: 'appointment_required_documents,payer_requirement_audit_logs,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível dispensar o documento agora.' };
    }
  },

  async getClosureAppointments(options: {
    from: string;
    to: string;
    status?: string;
    patientId?: string;
    professionalId?: string;
    serviceType?: string;
    payerId?: string;
    page?: number;
    limit?: number;
    onlyPending?: boolean;
    onlyReady?: boolean;
    onlyWarnings?: boolean;
    missing?: string;
    quickFilter?: string;
    actionRevision?: string | number;
  }) {
    const endpoint = endpointWithQuery('/api/closure/appointments', {
      from: options.from,
      to: options.to,
      status: options.status,
      patientId: options.patientId,
      professionalId: options.professionalId,
      serviceType: options.serviceType,
      payerId: options.payerId,
      page: Math.max(1, Math.round(Number(options.page || 1) || 1)),
      limit: normalizeListLimit(options.limit, 50, 200),
      onlyPending: options.onlyPending ? 'true' : undefined,
      onlyReady: options.onlyReady ? 'true' : undefined,
      onlyWarnings: options.onlyWarnings ? 'true' : undefined,
      missing: options.missing,
      quickFilter: options.quickFilter,
      actionRevision: options.actionRevision
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getClosureAppointments',
        operation: 'list',
        table: 'appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A listagem do fechamento voltou do cache após revalidação. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], totals: null, error: 'Não foi possível carregar o fechamento agora.' };
    }
  },

  async revalidateClosurePeriod(options: { from: string; to: string; dryRun?: boolean }) {
    const endpoint = '/api/closure/revalidate-period';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          from: options.from,
          to: options.to,
          dryRun: Boolean(options.dryRun)
        })
      }, {
        helperName: 'revalidateClosurePeriod',
        operation: 'write',
        table: 'appointments,clinic_state,appointment_closure_checks,appointment_closure_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação do fechamento voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, error: 'Não foi possível revalidar o período agora.' };
    }
  },

  async getClosureAppointmentDetail(appointmentId: string) {
    const endpoint = `/api/closure/appointments/${encodeURIComponent(String(appointmentId))}`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getClosureAppointmentDetail',
        operation: 'detail',
        table: 'appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O detalhe do fechamento voltou do cache. Tente abrir novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o fechamento agora.' };
    }
  },

  async revalidateClosureAppointment(appointmentId: string) {
    const endpoint = `/api/closure/appointments/${encodeURIComponent(String(appointmentId))}/revalidate`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      }, {
        helperName: 'revalidateClosureAppointment',
        operation: 'write',
        table: 'appointment_billing_contexts,appointment_billing_items,appointment_closure_checks,appointment_closure_audit_logs,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação da sessão voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, error: 'Não foi possível revalidar o fechamento agora.' };
    }
  },

  async overrideClosureAppointment(appointmentId: string, payload: { readinessStatus?: string; status?: string; reason: string }) {
    const endpoint = `/api/closure/appointments/${encodeURIComponent(String(appointmentId))}/override`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'overrideClosureAppointment',
        operation: 'write',
        table: 'appointment_closure_checks,appointment_closure_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o fechamento agora.' };
    }
  },

  async getMonthlyConference(options: any = {}) {
    const endpoint = endpointWithQuery('/api/conference/monthly', {
      from: options.from,
      to: options.to,
      patientId: options.patientId,
      professionalId: options.professionalId,
      payerId: options.payerId,
      serviceType: options.serviceType,
      readinessStatus: options.readinessStatus,
      appointmentStatus: options.appointmentStatus,
      onlyPending: options.onlyPending ? 'true' : undefined,
      onlyReady: options.onlyReady ? 'true' : undefined,
      onlyNotBillable: options.onlyNotBillable ? 'true' : undefined,
      missing: options.missing,
      quickFilter: options.quickFilter,
      page: Math.max(1, Math.round(Number(options.page || 1) || 1)),
      limit: normalizeListLimit(options.limit, 50, 200),
      actionRevision: options.actionRevision
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getMonthlyConference',
        operation: 'list',
        table: 'appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A conferência mensal voltou do cache após revalidação. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], kpis: null, error: 'Não foi possível carregar a conferência agora.' };
    }
  },

  async getTissPreGuides(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/pre-guides', {
      from: options.from,
      to: options.to,
      status: options.status,
      payerId: options.payerId,
      patientId: options.patientId,
      professionalId: options.professionalId,
      quickFilter: options.quickFilter,
      page: Math.max(1, Math.round(Number(options.page || 1) || 1)),
      pageSize: normalizeListLimit(options.pageSize || options.limit, 50, 200)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissPreGuides',
        operation: 'list',
        table: 'appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A listagem de Pré-guias TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], kpis: null, error: 'Não foi possível carregar as Pré-guias TISS agora.' };
    }
  },

  async getTissPreGuideCoverage(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/pre-guides/coverage', {
      from: options.from,
      to: options.to,
      payerId: options.payerId,
      patientId: options.patientId,
      professionalId: options.professionalId,
      limit: normalizeListLimit(options.limit, 500, 2000)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissPreGuideCoverage',
        operation: 'list',
        table: 'appointment_tiss_pre_guides,appointment_billing_contexts,appointment_billing_items',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A cobertura de Pré-guias TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível verificar a cobertura das Pré-guias TISS agora.' };
    }
  },

  async getTissPreGuide(appointmentId: string) {
    const endpoint = `/api/tiss/pre-guides/${encodeURIComponent(String(appointmentId))}`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissPreGuide',
        operation: 'detail',
        table: 'appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O detalhe da Pré-guia TISS voltou do cache. Tente abrir novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar a Pré-guia TISS agora.' };
    }
  },

  async revalidateTissPreGuide(appointmentId: string) {
    const endpoint = `/api/appointments/${encodeURIComponent(String(appointmentId))}/tiss-pre-guide/revalidate`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      }, {
        helperName: 'revalidateTissPreGuide',
        operation: 'write',
        table: 'appointment_tiss_pre_guides,appointment_billing_items,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação da Pré-guia TISS voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível revalidar a Pré-guia TISS agora.' };
    }
  },

  async revalidateTissPreGuidePeriod(options: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/pre-guides/revalidate-period', {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          from: options.from,
          to: options.to,
          payerId: options.payerId || undefined,
          patientId: options.patientId || undefined,
          professionalId: options.professionalId || undefined,
          onlyBillable: true,
          limit: normalizeListLimit(options.limit, 240, 500)
        })
      }, {
        helperName: 'revalidateTissPreGuidePeriod',
        operation: 'write',
        table: 'appointment_tiss_pre_guides,appointment_billing_items,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação das Pré-guias TISS voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível gerar ou revalidar as Pré-guias TISS do período.' };
    }
  },

  async getTissXmlDrafts(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/xml-drafts', {
      payerId: options.payerId,
      competenceMonth: options.competenceMonth,
      page: Math.max(1, Math.round(Number(options.page || 1) || 1)),
      pageSize: normalizeListLimit(options.pageSize || options.limit, 20, 100)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissXmlDrafts',
        operation: 'list',
        table: 'tiss_xml_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A listagem de rascunhos XML TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os rascunhos XML TISS agora.' };
    }
  },

  async createTissXmlDraft(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/xml-drafts', {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'createTissXmlDraft',
        operation: 'write',
        table: 'tiss_xml_drafts,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A geração do XML TISS em rascunho voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível gerar o XML TISS em rascunho agora.' };
    }
  },

  async downloadTissXmlDraft(draftId: string) {
    try {
      const response = await fetchClinical(`/api/tiss/xml-drafts/${encodeURIComponent(String(draftId))}/download`, {
        method: 'GET',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'downloadTissXmlDraft',
        operation: 'detail',
        table: 'tiss_xml_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      if (!response.ok) {
        return { success: false, error: 'Não foi possível baixar o XML TISS em rascunho agora.' };
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      return {
        success: true,
        blob,
        fileName: match?.[1] || 'verto-tiss-rascunho.xml'
      };
    } catch {
      return { success: false, error: 'Não foi possível baixar o XML TISS em rascunho agora.' };
    }
  },

  async getClinicTissProfile() {
    try {
      return await fetchNoStoreJsonWithRetry('/api/admin/tiss/provider-profile', {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getClinicTissProfile',
        operation: 'detail',
        table: 'clinic_tiss_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O perfil TISS do prestador voltou do cache.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o perfil TISS do prestador.' };
    }
  },

  async updateClinicTissProfile(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/admin/tiss/provider-profile', {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateClinicTissProfile',
        operation: 'write',
        table: 'clinic_tiss_profiles,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar o perfil TISS do prestador.' };
    }
  },

  async getPayerTissProfile(payerId: string) {
    const endpoint = `/api/admin/tiss/payer-profiles/${encodeURIComponent(String(payerId))}`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerTissProfile',
        operation: 'detail',
        table: 'payer_tiss_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O perfil TISS do pagador voltou do cache.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o perfil TISS do pagador.' };
    }
  },

  async getPayerTissProfiles() {
    try {
      return await fetchNoStoreJsonWithRetry('/api/admin/tiss/payer-profiles', {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerTissProfiles',
        operation: 'list',
        table: 'payer_tiss_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'Os perfis TISS dos pagadores voltaram do cache.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os perfis TISS dos pagadores.' };
    }
  },

  async updatePayerTissProfile(payerId: string, payload: any = {}) {
    const endpoint = `/api/admin/tiss/payer-profiles/${encodeURIComponent(String(payerId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePayerTissProfile',
        operation: 'write',
        table: 'payer_tiss_profiles,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar o perfil TISS do pagador.' };
    }
  },

  async upsertPatientPayerAuthorization(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/patient-payer-authorizations', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'upsertPatientPayerAuthorization',
        operation: 'write',
        table: 'patient_payer_authorizations,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar a autorização do convênio.' };
    }
  },

  async getProfessionalBillingProfile(professionalId: string) {
    const endpoint = `/api/admin/tiss/professional-profiles/${encodeURIComponent(String(professionalId))}`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getProfessionalBillingProfile',
        operation: 'detail',
        table: 'professional_billing_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O perfil faturável do profissional voltou do cache.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o perfil faturável do profissional.' };
    }
  },

  async getOwnProfessionalBillingProfile() {
    try {
      return await fetchNoStoreJsonWithRetry('/api/tiss/professional-profile/me', {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getOwnProfessionalBillingProfile',
        operation: 'detail',
        table: 'professional_billing_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O seu perfil faturável voltou do cache.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar seu perfil faturável.' };
    }
  },

  async getProfessionalBillingProfiles() {
    try {
      return await fetchNoStoreJsonWithRetry('/api/admin/tiss/professional-profiles', {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getProfessionalBillingProfiles',
        operation: 'list',
        table: 'professional_billing_profiles',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'Os perfis faturáveis dos profissionais voltaram do cache.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os perfis faturáveis dos profissionais.' };
    }
  },

  async updateProfessionalBillingProfile(professionalId: string, payload: any = {}) {
    const endpoint = `/api/admin/tiss/professional-profiles/${encodeURIComponent(String(professionalId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateProfessionalBillingProfile',
        operation: 'write',
        table: 'professional_billing_profiles,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar o perfil faturável do profissional.' };
    }
  },

  async updateOwnProfessionalBillingProfile(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/professional-profile/me', {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateOwnProfessionalBillingProfile',
        operation: 'write',
        table: 'professional_billing_profiles,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar seu perfil faturável.' };
    }
  },

  async getMonthlyConferenceSummary(kind: 'patient' | 'professional' | 'payer' | 'service-type' | 'procedure' | 'tuss-code' | 'guide-type', options: any = {}) {
    const endpoint = endpointWithQuery(`/api/conference/monthly/summary-by-${kind}`, {
      from: options.from,
      to: options.to,
      patientId: options.patientId,
      professionalId: options.professionalId,
      payerId: options.payerId,
      serviceType: options.serviceType,
      readinessStatus: options.readinessStatus,
      appointmentStatus: options.appointmentStatus,
      onlyPending: options.onlyPending ? 'true' : undefined,
      onlyReady: options.onlyReady ? 'true' : undefined,
      onlyNotBillable: options.onlyNotBillable ? 'true' : undefined,
      missing: options.missing,
      quickFilter: options.quickFilter,
      limit: normalizeListLimit(options.limit, 200, 200),
      actionRevision: options.actionRevision
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: `getMonthlyConferenceSummary:${kind}`,
        operation: 'list',
        table: 'appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O resumo da conferência voltou do cache após revalidação. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os resumos da conferência.' };
    }
  },

  async getMonthlyConferenceSession(appointmentId: string) {
    const endpoint = `/api/conference/monthly/session/${encodeURIComponent(String(appointmentId))}`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getMonthlyConferenceSession',
        operation: 'detail',
        table: 'appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O detalhe da conferência voltou do cache. Tente abrir novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar a sessão da conferência.' };
    }
  },

  async revalidateMonthlyConferenceSession(appointmentId: string) {
    const endpoint = `/api/conference/monthly/session/${encodeURIComponent(String(appointmentId))}/revalidate`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      }, {
        helperName: 'revalidateMonthlyConferenceSession',
        operation: 'write',
        table: 'appointment_billing_contexts,appointment_billing_items,appointment_closure_checks,appointment_closure_audit_logs,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A revalidação da conferência voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, error: 'Não foi possível revalidar a sessão da conferência.' };
    }
  },

  async updateMonthlyConferenceSessionStatus(appointmentId: string, payload: { status: 'reviewed' | 'reopened' | 'non_billable'; reason?: string }) {
    const endpoint = `/api/conference/monthly/session/${encodeURIComponent(String(appointmentId))}/status`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateMonthlyConferenceSessionStatus',
        operation: 'write',
        table: 'appointment_conference_statuses,appointment_closure_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o status da conferência.' };
    }
  },

  async exportMonthlyConference(payload: any = {}) {
    const endpoint = '/api/conference/monthly/export';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'exportMonthlyConference',
        operation: 'write',
        table: 'appointment_closure_checks,appointment_billing_items,appointment_conference_statuses,operational_closure_exports,appointment_closure_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível exportar a conferência agora.' };
    }
  },

  async checkScheduleConflicts(payload: any) {
    const endpoint = '/api/calendar/events/check-conflicts';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'checkScheduleConflicts',
        operation: 'detail',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível verificar conflitos agora.' };
    }
  },

  async getPatientTimeReport(options: any = {}) {
    const endpoint = endpointWithQuery('/api/reports/time/patient', {
      patientId: options.patientId,
      patientName: options.patientName,
      from: options.from,
      to: options.to,
      serviceType: options.serviceType,
      professionalId: options.professionalId,
      status: options.status,
      limit: normalizeListLimit(options.limit, 300, 1000)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPatientTimeReport',
        operation: 'list',
        table: 'appointments,patient_monthly_service_summaries',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      return { success: false, data: null, error: 'Não foi possível carregar o relatório de tempo do paciente.' };
    }
  },

  async getProfessionalTimeReport(options: any = {}) {
    const endpoint = endpointWithQuery('/api/reports/time/professional', {
      professionalId: options.professionalId,
      professionalName: options.professionalName,
      from: options.from,
      to: options.to,
      serviceType: options.serviceType,
      patientId: options.patientId,
      status: options.status,
      limit: normalizeListLimit(options.limit, 300, 1000)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getProfessionalTimeReport',
        operation: 'list',
        table: 'appointments,professional_daily_work_summaries',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      return { success: false, data: null, error: 'Não foi possível carregar o relatório de carga horária.' };
    }
  },

  async getRecentSessionEvents(sessionId: string, limit = 20) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    if (!isPersistedUuid(sessionId)) return { success: true, data: [] };
    const safeLimit = normalizeListLimit(limit, 20, 20);
    const endpoint = endpointWithLimit(`/api/aba/recent-session-events/${encodeURIComponent(String(sessionId))}`, safeLimit);
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getRecentSessionEvents', operation: 'list', table: 'aba_recent_session_events', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching recent ABA session events from local state only...');
    }
    return { success: true, data: [] };
  },

  async getAbaSessionMaintenanceProbes(sessionId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ available: [], upcoming: [] });
    if (!isPersistedUuid(sessionId)) return { success: true, data: { available: [], upcoming: [] }, available: [], upcoming: [] };
    const endpoint = `/api/aba/sessions/${encodeURIComponent(String(sessionId))}/maintenance-probes`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaSessionMaintenanceProbes', operation: 'list', table: 'aba_maintenance_schedules,aba_targets,appointments', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar Maintenance Probes desta sessão.');
    } catch {
      return { success: false, error: 'Não foi possível carregar Maintenance Probes.', data: { available: [], upcoming: [] }, available: [], upcoming: [] };
    }
  },

  async getPatientAbaSummary(patientId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patient-summary/${encodeURIComponent(String(patientId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getPatientAbaSummary', operation: 'detail', table: 'aba_patient_aba_summaries', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA patient summary from local state only...');
    }
    return { success: true, data: null };
  },

  async getAbaMaintenanceOverview(patientId: string, options: { limit?: number; page?: number; pageSize?: number; appointmentId?: string | null } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ schedules: [], probeResults: [], alerts: [], summary: null });
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const endpoint = endpointWithPagination(`/api/aba/maintenance-overview/${encodeURIComponent(String(patientId))}`, { ...options, page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaMaintenanceOverview', operation: 'list', table: 'aba_maintenance_schedules,aba_maintenance_probe_results,aba_regression_alerts', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA maintenance overview from local storage...');
    }
    const local = await getRecordsByType('aba');
    const rows = local.map(r => r.data).filter((row: any) => String(row?.patient_id || row?.patientId || '') === String(patientId));
    return {
      success: true,
      data: {
        schedules: sortByNewest(rows.filter((row: any) => row?.scheduled_for || row?.scheduledFor || row?.schedule_day || row?.scheduleDay), ['scheduled_for', 'scheduledFor', 'created_at', 'createdAt']).slice(0, limit),
        probeResults: sortByNewest(rows.filter((row: any) => row?.maintenance_schedule_id || row?.maintenanceScheduleId || row?.maintenanceProbeResult || row?.probeStatus), ['occurred_at', 'occurredAt', 'created_at', 'createdAt']).slice(0, limit),
        alerts: sortByNewest(rows.filter((row: any) => row?.maintenance_probe_result_id || row?.maintenanceProbeResultId || row?.regressionAlert), ['created_at', 'createdAt']).slice(0, limit),
        summary: null
      },
      page,
      pageSize: limit
    };
  },

  async getAbaMaintenancePanel(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled()) {
      return abaV2DisabledResponse({
        eligibleSkills: [],
        maintenanceSkills: [],
        scheduledProbes: [],
        waitingNextSession: [],
        overdueProbes: [],
        regressionRisk: [],
        technicalIssues: []
      });
    }
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 100, 200);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const endpoint = endpointWithPagination(`/api/patients/${encodeURIComponent(String(patientId))}/aba/maintenance-panel`, { page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaMaintenancePanel', operation: 'list', table: 'patient_pei,aba_targets,aba_maintenance_schedules', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar manutenção agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar manutenção agora.');
      return { success: false, error: message, message };
    }
  },

  async getPeiMaintenanceDebugGoals(patientId: string) {
    if (!isAbaV2Enabled()) return { success: false, data: [] };
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/debug/pei-maintenance-goals`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getPeiMaintenanceDebugGoals', operation: 'list', table: 'patient_pei', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return { success: false, error: await safeJson(response) };
    } catch (error) {
      const message = getApiErrorMessage(error, 'Erro ao carregar dados de debug.');
      return { success: false, error: message };
    }
  },

  async getAbaMaintenanceSchedules(patientId: string, options: { limit?: number; status?: string } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const limit = normalizeListLimit(options.limit, 20, 50);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/maintenance-schedules`, {
      limit,
      status: options.status
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaMaintenanceSchedules', operation: 'list', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching ABA maintenance schedules from local state only...');
    }
    return { success: true, data: [] };
  },

  async getAbaFutureAppointmentsForMaintenance(patientId: string, options: { limit?: number; from?: string } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/future-appointments`, {
      limit: normalizeListLimit(options.limit, 20, 20),
      from: options.from
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaFutureAppointmentsForMaintenance', operation: 'list', table: 'appointments', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching future ABA maintenance appointments from local state only...');
    }
    return { success: true, data: [] };
  },

  async getAbaLinkableTargetsForMaintenance(patientId: string, options: { limit?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = endpointWithQuery(`/api/patients/${encodeURIComponent(String(patientId))}/aba/targets/linkable`, {
      limit: normalizeListLimit(options.limit, 200, 200)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaLinkableTargetsForMaintenance', operation: 'list', table: 'aba_targets', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar habilidades do PEI agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar habilidades do PEI agora.');
      return { success: false, data: [], error: message, message };
    }
  },

  async ensurePeiMaintenanceTarget(patientId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/maintenance-targets/ensure`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'ensurePeiMaintenanceTarget', operation: 'write', table: 'patient_records,aba_targets,aba_mastery_evaluations', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível preparar a habilidade para manutenção.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível preparar a habilidade para manutenção.');
      return { success: false, error: message, message };
    }
  },

  async createMaintenanceScheduleForTarget(targetId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    if (!isPersistedUuid(targetId)) {
      const patientId = payload?.patient_id || payload?.patientId;
      const targetName = payload?.target_name || payload?.targetName || payload?.name;
      if (patientId && targetName) {
        const ensured = await dataService.ensurePeiMaintenanceTarget(String(patientId), payload);
        const ensuredTargetId = ensured?.targetId || ensured?.target?.targetId || ensured?.target?.target_id || ensured?.target?.id || ensured?.data?.targetId || ensured?.data?.id;
        if (isPersistedUuid(ensuredTargetId)) {
          return await dataService.createMaintenanceScheduleForTarget(String(ensuredTargetId), {
            ...(payload || {}),
            targetId: ensuredTargetId,
            target_id: ensuredTargetId
          });
        }
      }
      return invalidClinicalIdResponse('Não foi possível identificar a habilidade.', []);
    }
    const endpoint = `/api/aba/targets/${encodeURIComponent(String(targetId))}/maintenance-schedules`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'createMaintenanceScheduleForTarget', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível agendar a manutenção.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível agendar a manutenção.');
      return { success: false, error: message, message };
    }
  },

  async updateMaintenanceSchedule(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para edição.');
    }
    const appointmentId = payload?.appointmentId || payload?.appointment_id;
    if (appointmentId !== undefined && appointmentId !== null && appointmentId !== '' && !isPersistedUuid(appointmentId)) {
      return invalidClinicalIdResponse('Escolha uma consulta real para vincular a sondagem.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'updateMaintenanceSchedule', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o agendamento.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o agendamento.');
      return { success: false, error: message, message };
    }
  },

  async cancelMaintenanceSchedule(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para cancelamento.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/cancel`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'cancelMaintenanceSchedule', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o agendamento.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o agendamento.');
      return { success: false, error: message, message };
    }
  },

  async clearPatientAbaMaintenance(patientId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ schedulesCleared: 0, targetsReset: 0 });
    if (!isPersistedUuid(patientId)) {
      return invalidClinicalIdResponse('Paciente inválido para apagar manutenções.', { schedulesCleared: 0, targetsReset: 0 });
    }
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/maintenance-schedules/clear`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'clearPatientAbaMaintenance', operation: 'write', table: 'aba_maintenance_schedules,aba_targets', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível apagar as manutenções agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível apagar as manutenções agora.');
      return { success: false, error: message, message };
    }
  },

  async confirmMaintenanceScheduleLink(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para confirmar vínculo.');
    }
    const appointmentId = payload?.appointmentId || payload?.appointment_id;
    if (appointmentId !== undefined && isSyntheticClinicalId(appointmentId)) {
      return invalidClinicalIdResponse('Escolha uma sessão antes de confirmar o vínculo.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/confirm-link`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'confirmMaintenanceScheduleLink', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível confirmar o vínculo agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível confirmar o vínculo agora.');
      return { success: false, error: message, message };
    }
  },

  async assignMaintenanceScheduleToAppointment(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para atribuir sessão.');
    }
    const appointmentId = payload?.appointmentId || payload?.appointment_id;
    if (!isPersistedUuid(appointmentId)) {
      return invalidClinicalIdResponse('Escolha uma sessão antes de atribuir a sondagem.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/assign-appointment`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...(payload || {}), appointmentId })
      }, { helperName: 'assignMaintenanceScheduleToAppointment', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atribuir a sondagem agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atribuir a sondagem agora.');
      return { success: false, error: message, message };
    }
  },

  async skipMaintenanceScheduleLink(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para adiar vínculo.');
    }
    const appointmentId = payload?.appointmentId || payload?.appointment_id;
    if (appointmentId !== undefined && isSyntheticClinicalId(appointmentId)) {
      return invalidClinicalIdResponse('Sessão inválida para esta sondagem.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/skip-link`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'skipMaintenanceScheduleLink', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível adiar o vínculo agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível adiar o vínculo agora.');
      return { success: false, error: message, message };
    }
  },

  async relinkMaintenanceScheduleTarget(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para revisar vínculo.');
    }
    const targetId = payload?.targetId || payload?.target_id;
    if (!isPersistedUuid(targetId)) {
      return invalidClinicalIdResponse('Escolha uma habilidade real antes de salvar o vínculo.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/relink-target`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...(payload || {}), targetId })
      }, { helperName: 'relinkMaintenanceScheduleTarget', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível revisar o vínculo agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível revisar o vínculo agora.');
      return { success: false, error: message, message };
    }
  },

  async scheduleMaintenanceForNextSession(targetId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    if (!isPersistedUuid(targetId)) {
      return invalidClinicalIdResponse('Habilidade inválida para agendamento de manutenção.', []);
    }
    const endpoint = `/api/aba/targets/${encodeURIComponent(String(targetId))}/maintenance-schedules/next-session`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'scheduleMaintenanceForNextSession', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível aguardar futura consulta agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível aguardar futura consulta agora.');
      return { success: false, error: message, message };
    }
  },

  async getNextMaintenanceProbeForTarget(targetId: string, patientId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedUuid(targetId)) return { success: true, data: null };
    const endpoint = endpointWithQuery(`/api/aba/targets/${encodeURIComponent(String(targetId))}/next-maintenance-probe`, { patientId });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getNextMaintenanceProbeForTarget', operation: 'detail', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching next maintenance probe from local state only...');
    }
    return { success: true, data: null };
  },

  async completeMaintenanceSchedule(scheduleId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    if (!isPersistedMaintenanceScheduleId(scheduleId)) {
      return invalidClinicalIdResponse('Sondagem de manutenção inválida para conclusão.');
    }
    const endpoint = `/api/aba/maintenance-schedules/${encodeURIComponent(String(scheduleId))}/complete`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'completeMaintenanceSchedule', operation: 'write', table: 'aba_maintenance_schedules', hasExplicitColumns: true });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível concluir o agendamento agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível concluir o agendamento agora.');
      return { success: false, error: message, message };
    }
  },

  async getNextSessionRecommendations(patientId: string, options: { sourceSessionId?: string; focusType?: string; limit?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/next-session/recommendations`, {
      sourceSessionId: options.sourceSessionId,
      focusType: options.focusType,
      limit: normalizeListLimit(options.limit, 20, 50)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getNextSessionRecommendations', operation: 'list', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching ABA recommendations from local state only...');
    }
    return { success: true, data: [] };
  },

  async generateNextSessionRecommendations(patientId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/next-session/recommendations/generate`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'generateNextSessionRecommendations', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível gerar sugestões agora.' };
    }
  },

  async acceptAbaRecommendation(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/accept`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'acceptAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível aceitar a sugestão agora.' };
    }
  },

  async rejectAbaRecommendation(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/reject`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'rejectAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível recusar a sugestão agora.' };
    }
  },

  async updateAbaRecommendation(recommendationId: string, patch: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      }, { helperName: 'updateAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível editar a sugestão agora.' };
    }
  },

  async applyAbaRecommendationToNextSession(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/apply-to-next-session`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'applyAbaRecommendationToNextSession', operation: 'write', table: 'aba_next_session_plan_items', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível aplicar ao plano agora.' };
    }
  },

  async getAbaNextSessionPlanItems(patientId: string, options: { status?: string; limit?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/next-session/plan-items`, {
      status: options.status || 'PLANNED',
      limit: normalizeListLimit(options.limit, 8, 20)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaNextSessionPlanItems', operation: 'list', table: 'aba_next_session_plan_items', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching ABA next-session plan from local state only...');
    }
    return { success: true, data: [] };
  },

  async updateAbaNextSessionPlanItem(planItemId: string, patch: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/next-session-plan-items/${encodeURIComponent(String(planItemId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      }, { helperName: 'updateAbaNextSessionPlanItem', operation: 'write', table: 'aba_next_session_plan_items', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      return { success: false, error: 'Não foi possível atualizar o plano agora.' };
    }
  },

  async getAbaClinicalChart(patientId: string, chart: 'targets' | 'behaviors' | 'mastery' | 'maintenance' | 'session-changes' | 'overview', options: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ points: [], insights: [], annotations: [] });
    const safeChart = ['targets', 'behaviors', 'mastery', 'maintenance', 'session-changes', 'overview'].includes(String(chart))
      ? String(chart)
      : 'overview';
    const limit = normalizeListLimit(options.limit ?? options.pageSize, 90, 180);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/charts/${safeChart}`, {
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      days: options.days,
      targetId: options.targetId,
      behaviorId: options.behaviorId,
      metricType: options.metricType,
      significantOnly: options.significantOnly,
      limit
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: `getAbaClinicalChart:${safeChart}`, operation: 'list', table: 'aba_session_metric_snapshots', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA clinical chart from local state only...');
    }
    return { success: true, data: { points: [], insights: [], annotations: [] } };
  },

  async getAbaClinicalLineChart(patientId: string, options: any = {}) {
    if (!isAbaV2Enabled()) {
      return abaV2DisabledResponse({ points: [], phases: [], annotations: [], summary: null, availableMetrics: [], availableItems: [] });
    }
    const limit = normalizeListLimit(options.limit ?? options.pageSize, 120, 180);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/clinical-line-chart`, {
      category: options.category,
      itemId: options.itemId,
      metric: options.metric,
      period: options.period,
      days: options.days,
      groupBy: options.groupBy,
      from: options.from,
      to: options.to,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      limit
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaClinicalLineChart', operation: 'list', table: 'aba_session_metric_snapshots,aba_target_live_summaries,aba_behavior_daily_summaries,aba_mastery_evaluations,aba_maintenance_probe_results', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA clinical line chart from local state only...');
    }
    return { success: true, data: { points: [], phases: [], annotations: [], summary: null, availableMetrics: [], availableItems: [] } };
  },

  async saveAbaGraphAnnotation(patientId: string, annotation: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(annotation || {});
    const id = String(annotation?.id || generateId());
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/charts/annotations`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'Content-Type': 'application/json',
          'Idempotency-Key': id
        },
        credentials: 'include',
        body: JSON.stringify({ ...(annotation || {}), id })
      }, { helperName: 'saveAbaGraphAnnotation', operation: 'write', table: 'aba_graph_annotations', hasExplicitColumns: true });
      return await safeJson(response);
    } catch (error) {
      console.log('Saving ABA graph annotation locally...');
      return await saveOfflineFirst(id, { ...(annotation || {}), id, patient_id: patientId }, 'aba', endpoint);
    }
  },

  async getSessionReport(sessionId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/session-reports/${encodeURIComponent(String(sessionId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getSessionReport', operation: 'detail', table: 'aba_session_summaries', hasExplicitColumns: true });
      if (response.ok) return await response.json();
    } catch (error) {
      console.log('Fetching ABA session report from local state only...');
    }
    return { success: true, data: null };
  },

  async getPaginatedBehaviorEvents(patientId: string, page = 1, pageSize = 20) {
    return await this.getAbaBehaviorEvents(patientId, { page, pageSize });
  },

  async getAbaSessions(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const localStart = (page - 1) * limit;
    const endpoint = endpointWithPagination(`/api/aba/sessions/${encodeURIComponent(String(patientId))}`, { ...options, page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaSessions', operation: 'list', table: 'aba_sessions', hasExplicitColumns: true });
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
      data: sortByNewest(local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.started_at || row?.startedAt)
        ), ['started_at', 'startedAt', 'created_at', 'createdAt']).slice(localStart, localStart + limit)
    };
  },

  async saveAbaTrial(trial: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(trial || {});
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
      ...buildAbaIntegrityFields(trial),
      id,
      patient_id: trial?.patient_id || trial?.patientId,
      patientId: trial?.patient_id || trial?.patientId,
      session_id: trial?.session_id || trial?.sessionId,
      sessionId: trial?.session_id || trial?.sessionId,
      target_id: trial?.target_id || trial?.targetId,
      targetId: trial?.target_id || trial?.targetId,
      trialType: trial?.trialType || trial?.trial_type || trial?.collection_type || trial?.collectionType,
      maintenance_schedule_id: trial?.maintenance_schedule_id || trial?.maintenanceScheduleId || trial?.schedule_id || trial?.scheduleId,
      maintenanceScheduleId: trial?.maintenance_schedule_id || trial?.maintenanceScheduleId || trial?.schedule_id || trial?.scheduleId,
      schedule_id: trial?.schedule_id || trial?.scheduleId || trial?.maintenance_schedule_id || trial?.maintenanceScheduleId,
      scheduleId: trial?.schedule_id || trial?.scheduleId || trial?.maintenance_schedule_id || trial?.maintenanceScheduleId,
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
      sync_status: trial?.sync_status || trial?.syncStatus || 'local',
      syncStatus: trial?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/trials');
  },

  async getAbaTrials(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const localStart = (page - 1) * limit;
    const endpoint = endpointWithPagination(`/api/aba/trials/${encodeURIComponent(String(patientId))}`, { ...options, page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaTrials', operation: 'list', table: 'aba_trials', hasExplicitColumns: true });
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
      data: sortByNewest(local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          !(row?.evaluation_status || row?.evaluationStatus) &&
          (row?.target_name || row?.targetName || row?.collection_type || row?.collectionType)
        ), ['occurred_at', 'occurredAt', 'timestamp', 'created_at', 'createdAt']).slice(localStart, localStart + limit)
    };
  },

  async saveAbaBehaviorEvent(event: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(event || {});
    const id = String(event?.id || event?.event_id || event?.eventId || generateId());
    const timestamp = event?.timestamp || event?.occurred_at || event?.occurredAt || new Date().toISOString();
    const data = {
      ...(event || {}),
      ...buildAbaIntegrityFields(event),
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
      sync_status: event?.sync_status || event?.syncStatus || 'local',
      syncStatus: event?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/behavior-events');
  },

  async deleteAbaBehaviorEvent(eventId: string, context: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ id: String(eventId || context?.id || ''), deleted: false });
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

  async getAbaBehaviorEvents(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const localStart = (page - 1) * limit;
    const endpoint = endpointWithPagination(`/api/aba/behavior-events/${encodeURIComponent(String(patientId))}`, { ...options, page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaBehaviorEvents', operation: 'list', table: 'aba_behavior_events', hasExplicitColumns: true });
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
      data: sortByNewest(local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.behavior_name || row?.behaviorName || row?.measurement_type || row?.measurementType)
        ), ['occurred_at', 'occurredAt', 'timestamp', 'created_at', 'createdAt']).slice(localStart, localStart + limit)
    };
  },

  async saveAbaIntervalRecord(record: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(record || {});
    const id = String(record?.id || record?.record_id || record?.recordId || generateId());
    const timestamp = record?.interval_ended_at || record?.intervalEndedAt || record?.occurred_at || record?.occurredAt || new Date().toISOString();
    const data = {
      ...(record || {}),
      ...buildAbaIntegrityFields(record),
      id,
      patient_id: record?.patient_id || record?.patientId,
      patientId: record?.patient_id || record?.patientId,
      session_id: record?.session_id || record?.sessionId,
      sessionId: record?.session_id || record?.sessionId,
      behavior_id: record?.behavior_id || record?.behaviorId,
      behaviorId: record?.behavior_id || record?.behaviorId,
      behavior_name: record?.behavior_name || record?.behaviorName,
      behaviorName: record?.behavior_name || record?.behaviorName,
      method: record?.method || record?.measurement_type || record?.measurementType || 'partial_interval',
      interval_number: record?.interval_number ?? record?.intervalNumber,
      intervalNumber: record?.interval_number ?? record?.intervalNumber,
      interval_duration_seconds: record?.interval_duration_seconds ?? record?.intervalDurationSeconds,
      intervalDurationSeconds: record?.interval_duration_seconds ?? record?.intervalDurationSeconds,
      interval_started_at: record?.interval_started_at || record?.intervalStartedAt,
      intervalStartedAt: record?.interval_started_at || record?.intervalStartedAt,
      interval_ended_at: timestamp,
      intervalEndedAt: timestamp,
      occurred: Boolean(record?.occurred),
      collection_status: record?.collection_status || record?.collectionStatus || record?.status,
      collectionStatus: record?.collectionStatus || record?.collection_status || record?.status,
      cancelled_at: record?.cancelled_at || record?.cancelledAt,
      cancelledAt: record?.cancelledAt || record?.cancelled_at,
      cancelled_by: record?.cancelled_by || record?.cancelledBy,
      cancelledBy: record?.cancelledBy || record?.cancelled_by,
      cancel_reason: record?.cancel_reason || record?.cancelReason,
      cancelReason: record?.cancelReason || record?.cancel_reason,
      therapist_id: record?.therapist_id || record?.therapistId,
      therapistId: record?.therapist_id || record?.therapistId,
      sync_status: record?.sync_status || record?.syncStatus || 'local',
      syncStatus: record?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/interval-records');
  },

  async saveAbaIntervalSummary(summary: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(summary || {});
    const id = String(summary?.id || summary?.summary_id || summary?.summaryId || generateId());
    const data = {
      ...(summary || {}),
      ...buildAbaIntegrityFields(summary),
      id,
      patient_id: summary?.patient_id || summary?.patientId,
      patientId: summary?.patient_id || summary?.patientId,
      session_id: summary?.session_id || summary?.sessionId,
      sessionId: summary?.session_id || summary?.sessionId,
      behavior_id: summary?.behavior_id || summary?.behaviorId,
      behaviorId: summary?.behavior_id || summary?.behaviorId,
      behavior_name: summary?.behavior_name || summary?.behaviorName,
      behaviorName: summary?.behavior_name || summary?.behaviorName,
      method: summary?.method || summary?.measurement_type || summary?.measurementType || 'partial_interval',
      total_intervals: summary?.total_intervals ?? summary?.totalIntervals,
      totalIntervals: summary?.total_intervals ?? summary?.totalIntervals,
      planned_intervals: summary?.planned_intervals ?? summary?.plannedIntervals,
      plannedIntervals: summary?.planned_intervals ?? summary?.plannedIntervals,
      answered_intervals: summary?.answered_intervals ?? summary?.answeredIntervals ?? summary?.total_intervals ?? summary?.totalIntervals,
      answeredIntervals: summary?.answered_intervals ?? summary?.answeredIntervals ?? summary?.total_intervals ?? summary?.totalIntervals,
      yes_count: summary?.yes_count ?? summary?.yesCount ?? summary?.occurredCount,
      yesCount: summary?.yes_count ?? summary?.yesCount ?? summary?.occurredCount,
      no_count: summary?.no_count ?? summary?.noCount ?? summary?.notOccurredCount,
      noCount: summary?.no_count ?? summary?.noCount ?? summary?.notOccurredCount,
      occurrence_percent: summary?.occurrence_percent ?? summary?.occurrencePercent,
      occurrencePercent: summary?.occurrence_percent ?? summary?.occurrencePercent,
      collection_status: summary?.collection_status || summary?.collectionStatus || summary?.status,
      collectionStatus: summary?.collectionStatus || summary?.collection_status || summary?.status,
      started_at: summary?.started_at || summary?.startedAt,
      startedAt: summary?.started_at || summary?.startedAt,
      ended_at: summary?.ended_at || summary?.endedAt || new Date().toISOString(),
      endedAt: summary?.ended_at || summary?.endedAt || new Date().toISOString(),
      paused_at: summary?.paused_at || summary?.pausedAt,
      pausedAt: summary?.pausedAt || summary?.paused_at,
      resumed_at: summary?.resumed_at || summary?.resumedAt,
      resumedAt: summary?.resumedAt || summary?.resumed_at,
      ended_early_at: summary?.ended_early_at || summary?.endedEarlyAt,
      endedEarlyAt: summary?.endedEarlyAt || summary?.ended_early_at,
      cancelled_at: summary?.cancelled_at || summary?.cancelledAt,
      cancelledAt: summary?.cancelledAt || summary?.cancelled_at,
      cancelled_by: summary?.cancelled_by || summary?.cancelledBy,
      cancelledBy: summary?.cancelledBy || summary?.cancelled_by,
      cancel_reason: summary?.cancel_reason || summary?.cancelReason,
      cancelReason: summary?.cancelReason || summary?.cancel_reason,
      end_reason: summary?.end_reason || summary?.endReason,
      endReason: summary?.endReason || summary?.end_reason,
      therapist_id: summary?.therapist_id || summary?.therapistId,
      therapistId: summary?.therapist_id || summary?.therapistId,
      sync_status: summary?.sync_status || summary?.syncStatus || 'local',
      syncStatus: summary?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/interval-summaries');
  },

  async saveAbaAbcEvent(event: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(event || {});
    const id = String(event?.id || event?.abc_id || event?.abcId || generateId());
    const data = {
      ...(event || {}),
      ...buildAbaIntegrityFields(event),
      id,
      patient_id: event?.patient_id || event?.patientId,
      patientId: event?.patient_id || event?.patientId,
      session_id: event?.session_id || event?.sessionId,
      sessionId: event?.session_id || event?.sessionId,
      behavior_id: event?.behavior_id || event?.behaviorId,
      behaviorId: event?.behavior_id || event?.behaviorId,
      behavior_event_id: event?.behavior_event_id || event?.behaviorEventId,
      behaviorEventId: event?.behavior_event_id || event?.behaviorEventId,
      behavior_name: event?.behavior_name || event?.behaviorName,
      behaviorName: event?.behavior_name || event?.behaviorName,
      response: event?.response || event?.response_by_therapist || event?.responseByTherapist,
      therapist_id: event?.therapist_id || event?.therapistId,
      therapistId: event?.therapist_id || event?.therapistId,
      sync_status: event?.sync_status || event?.syncStatus || 'local',
      syncStatus: event?.syncStatus || 'local',
      created_at: event?.created_at || event?.createdAt || new Date().toISOString()
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/abc-events');
  },

  async saveAbaMasteryEvaluation(evaluation: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(evaluation || {});
    const id = String(evaluation?.id || evaluation?.evaluation_id || evaluation?.evaluationId || generateId());
    const data = {
      ...(evaluation || {}),
      ...buildAbaIntegrityFields(evaluation),
      id,
      organization_id: evaluation?.organization_id || evaluation?.organizationId || evaluation?.clinic_id || evaluation?.clinicId,
      organizationId: evaluation?.organization_id || evaluation?.organizationId || evaluation?.clinic_id || evaluation?.clinicId,
      patient_id: evaluation?.patient_id || evaluation?.patientId,
      patientId: evaluation?.patient_id || evaluation?.patientId,
      session_id: evaluation?.session_id || evaluation?.sessionId,
      sessionId: evaluation?.session_id || evaluation?.sessionId,
      target_id: evaluation?.target_id || evaluation?.targetId,
      targetId: evaluation?.target_id || evaluation?.targetId,
      target_name: evaluation?.target_name || evaluation?.targetName,
      targetName: evaluation?.target_name || evaluation?.targetName,
      criteria_id: evaluation?.criteria_id || evaluation?.criteriaId,
      criteriaId: evaluation?.criteria_id || evaluation?.criteriaId,
      status: evaluation?.status || evaluation?.statusCode,
      statusCode: evaluation?.status || evaluation?.statusCode,
      evaluation_status: evaluation?.evaluation_status || evaluation?.evaluationStatus,
      evaluationStatus: evaluation?.evaluation_status || evaluation?.evaluationStatus,
      suggested_phase: evaluation?.suggested_phase || evaluation?.suggestedPhase,
      suggestedPhase: evaluation?.suggested_phase || evaluation?.suggestedPhase,
      total_trials: evaluation?.total_trials ?? evaluation?.totalTrials,
      totalTrials: evaluation?.total_trials ?? evaluation?.totalTrials,
      independent_trials: evaluation?.independent_trials ?? evaluation?.independentTrials,
      independentTrials: evaluation?.independent_trials ?? evaluation?.independentTrials,
      prompted_trials: evaluation?.prompted_trials ?? evaluation?.promptedTrials,
      promptedTrials: evaluation?.prompted_trials ?? evaluation?.promptedTrials,
      error_trials: evaluation?.error_trials ?? evaluation?.errorTrials,
      errorTrials: evaluation?.error_trials ?? evaluation?.errorTrials,
      accuracy_percent: evaluation?.accuracy_percent ?? evaluation?.accuracyPercent,
      accuracyPercent: evaluation?.accuracy_percent ?? evaluation?.accuracyPercent,
      independence_percent: evaluation?.independence_percent ?? evaluation?.independencePercent,
      independencePercent: evaluation?.independence_percent ?? evaluation?.independencePercent,
      consecutive_successes: evaluation?.consecutive_successes ?? evaluation?.consecutiveSuccesses ?? evaluation?.criterion_progress_count ?? evaluation?.criterionProgressCount,
      consecutiveSuccesses: evaluation?.consecutive_successes ?? evaluation?.consecutiveSuccesses ?? evaluation?.criterion_progress_count ?? evaluation?.criterionProgressCount,
      min_consecutive_successes: evaluation?.min_consecutive_successes ?? evaluation?.minConsecutiveSuccesses ?? evaluation?.criterion_required_count ?? evaluation?.criterionRequiredCount,
      minConsecutiveSuccesses: evaluation?.min_consecutive_successes ?? evaluation?.minConsecutiveSuccesses ?? evaluation?.criterion_required_count ?? evaluation?.criterionRequiredCount,
      consecutive_successful_days: evaluation?.consecutive_successful_days ?? evaluation?.consecutiveSuccessfulDays,
      consecutiveSuccessfulDays: evaluation?.consecutive_successful_days ?? evaluation?.consecutiveSuccessfulDays,
      criterion_progress_count: evaluation?.criterion_progress_count ?? evaluation?.criterionProgressCount,
      criterionProgressCount: evaluation?.criterion_progress_count ?? evaluation?.criterionProgressCount,
      criterion_required_count: evaluation?.criterion_required_count ?? evaluation?.criterionRequiredCount,
      criterionRequiredCount: evaluation?.criterion_required_count ?? evaluation?.criterionRequiredCount,
      criterion_progress_label: evaluation?.criterion_progress_label ?? evaluation?.criterionProgressLabel,
      criterionProgressLabel: evaluation?.criterion_progress_label ?? evaluation?.criterionProgressLabel,
      cold_probe_trials_count: evaluation?.cold_probe_trials_count ?? evaluation?.coldProbeTrialsCount,
      coldProbeTrialsCount: evaluation?.cold_probe_trials_count ?? evaluation?.coldProbeTrialsCount,
      distinct_therapists_count: evaluation?.distinct_therapists_count ?? evaluation?.distinctTherapistsCount,
      distinctTherapistsCount: evaluation?.distinct_therapists_count ?? evaluation?.distinctTherapistsCount,
      first_trial_independent: evaluation?.first_trial_independent ?? evaluation?.firstTrialIndependent,
      firstTrialIndependent: evaluation?.first_trial_independent ?? evaluation?.firstTrialIndependent,
      evaluated_at: evaluation?.evaluated_at || evaluation?.evaluatedAt || new Date().toISOString(),
      evaluatedAt: evaluation?.evaluated_at || evaluation?.evaluatedAt || new Date().toISOString(),
      therapist_id: evaluation?.therapist_id || evaluation?.therapistId,
      therapistId: evaluation?.therapist_id || evaluation?.therapistId,
      source: evaluation?.source || evaluation?.clientSource || ABA_DEFAULT_SOURCE,
      sync_status: evaluation?.sync_status || evaluation?.syncStatus || 'local',
      syncStatus: evaluation?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/mastery-evaluations');
  },

  async updateAbaTargetMasteryCriteria(patientId: string, targetId: string, criteria: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(criteria || {});
    const safePatientId = encodeURIComponent(String(patientId || '').trim());
    const safeTargetId = encodeURIComponent(String(targetId || '').trim());
    const id = `mastery-criteria-${String(targetId || generateId())}`;
    const data = {
      id,
      patient_id: patientId,
      patientId,
      target_id: targetId,
      targetId,
      criteria,
      mastery_criteria: criteria,
      masteryCriteria: criteria,
      source: 'verto_web'
    };
    return await saveOfflineFirst(id, data, 'aba', `/api/aba/patients/${safePatientId}/targets/${safeTargetId}/mastery-criteria`, 'PATCH');
  },

  async saveAbaMaintenanceProbeResult(result: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(result || {});
    const id = String(result?.id || result?.result_id || result?.resultId || generateId());
    const data = {
      ...(result || {}),
      ...buildAbaIntegrityFields(result),
      id,
      organization_id: result?.organization_id || result?.organizationId || result?.clinic_id || result?.clinicId,
      organizationId: result?.organization_id || result?.organizationId || result?.clinic_id || result?.clinicId,
      patient_id: result?.patient_id || result?.patientId,
      patientId: result?.patient_id || result?.patientId,
      target_id: result?.target_id || result?.targetId,
      targetId: result?.target_id || result?.targetId,
      target_name: result?.target_name || result?.targetName,
      targetName: result?.target_name || result?.targetName,
      maintenance_schedule_id: result?.maintenance_schedule_id || result?.maintenanceScheduleId,
      maintenanceScheduleId: result?.maintenance_schedule_id || result?.maintenanceScheduleId,
      schedule_id: result?.schedule_id || result?.scheduleId || result?.maintenance_schedule_id || result?.maintenanceScheduleId,
      scheduleId: result?.schedule_id || result?.scheduleId || result?.maintenance_schedule_id || result?.maintenanceScheduleId,
      session_id: result?.session_id || result?.sessionId,
      sessionId: result?.session_id || result?.sessionId,
      appointment_id: result?.appointment_id || result?.appointmentId,
      appointmentId: result?.appointment_id || result?.appointmentId,
      trial_id: result?.trial_id || result?.trialId,
      trialId: result?.trial_id || result?.trialId,
      probe_date: result?.probe_date || result?.probeDate,
      probeDate: result?.probe_date || result?.probeDate,
      clinical_date: result?.clinical_date || result?.clinicalDate,
      clinicalDate: result?.clinical_date || result?.clinicalDate,
      occurred_at: result?.occurred_at || result?.occurredAt || new Date().toISOString(),
      occurredAt: result?.occurred_at || result?.occurredAt || new Date().toISOString(),
      result: result?.result,
      prompt_type: result?.prompt_type || result?.promptType,
      promptType: result?.prompt_type || result?.promptType,
      passed: result?.passed,
      total_trials: result?.total_trials ?? result?.totalTrials,
      totalTrials: result?.total_trials ?? result?.totalTrials,
      independent_trials: result?.independent_trials ?? result?.independentTrials,
      independentTrials: result?.independent_trials ?? result?.independentTrials,
      prompted_trials: result?.prompted_trials ?? result?.promptedTrials,
      promptedTrials: result?.prompted_trials ?? result?.promptedTrials,
      error_trials: result?.error_trials ?? result?.errorTrials,
      errorTrials: result?.error_trials ?? result?.errorTrials,
      accuracy_percent: result?.accuracy_percent ?? result?.accuracyPercent,
      accuracyPercent: result?.accuracy_percent ?? result?.accuracyPercent,
      independence_percent: result?.independence_percent ?? result?.independencePercent,
      independencePercent: result?.independence_percent ?? result?.independencePercent,
      status: result?.status || result?.probeStatus || 'WATCH',
      probeStatus: result?.status || result?.probeStatus || 'WATCH',
      created_by: result?.created_by || result?.createdBy,
      createdBy: result?.created_by || result?.createdBy,
      updated_by: result?.updated_by || result?.updatedBy,
      updatedBy: result?.updated_by || result?.updatedBy,
      sync_status: result?.sync_status || result?.syncStatus || 'local',
      syncStatus: result?.syncStatus || 'local'
    };
    return await saveOfflineFirst(id, data, 'aba', '/api/aba/maintenance-probe-results');
  },

  async getAbaMasteryEvaluations(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const limit = normalizeListLimit(options.pageSize ?? options.limit, 20, 50);
    const page = Math.max(1, Math.round(Number(options.page || 1) || 1));
    const localStart = (page - 1) * limit;
    const endpoint = endpointWithPagination(`/api/aba/mastery-evaluations/${encodeURIComponent(String(patientId))}`, { ...options, page, pageSize: limit });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaMasteryEvaluations', operation: 'list', table: 'aba_mastery_evaluations', hasExplicitColumns: true });
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
      data: sortByNewest(local
        .map(r => r.data)
        .filter((row: any) =>
          String(row?.patient_id || row?.patientId || '') === String(patientId) &&
          (row?.evaluation_status || row?.evaluationStatus || row?.suggested_phase || row?.suggestedPhase)
        ), ['evaluated_at', 'evaluatedAt', 'created_at', 'createdAt']).slice(localStart, localStart + limit)
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
      const response = await fetch(endpointWithLimit(`/api/tasks/${patientId}`, 20), {
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
      const response = await fetch(endpointWithLimit(`/api/tasks/email/${email}`, 20), {
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
      const response = await fetch(endpointWithLimit('/api/patient/self/tasks', 20), {
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
      const response = await fetch(endpointWithLimit(`/api/assigned-tasks/${patientId}`, 20), {
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
      const response = await fetch(endpointWithLimit('/api/patient/self/assigned-tasks', 20), {
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
    const endpoint = `/api/profile/${userId}`;
    const queuePendingProfile = async (reason: string) => {
      await saveEncryptedRecord({
        id: `profile:${userId}`,
        data,
        type: 'profile',
        sync_status: 'pending',
        last_updated: Date.now(),
        method: 'POST',
        endpoint
      });
      return {
        success: false,
        queued: true,
        error: reason || 'Perfil salvo localmente. A sincronização será retomada automaticamente.'
      };
    };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
      });
      const result = await safeJson(response);
      if (response.ok && result?.success !== false) {
        await saveEncryptedRecord({
          id: `profile:${userId}`,
          data,
          type: 'profile',
          sync_status: 'synced',
          last_updated: Date.now(),
          method: 'POST',
          endpoint
        });
        return result;
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return await queuePendingProfile(result?.error || result?.message || `HTTP ${response.status}`);
      }
      return result;
    } catch (error: any) {
      console.error('Error saving user profile:', error);
      return await queuePendingProfile(error?.message || String(error));
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
    const endpoint = '/api/patient/self/profile';
    const payload = profile || {};
    const queuePendingProfile = async (reason: string) => {
      await saveEncryptedRecord({
        id: 'profile:self',
        data: payload,
        type: 'profile',
        sync_status: 'pending',
        last_updated: Date.now(),
        method: 'PATCH',
        endpoint
      });
      return {
        success: false,
        queued: true,
        error: reason || 'Perfil salvo localmente. A sincronização será retomada automaticamente.'
      };
    };
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const result = await safeJson(response);
      if (response.ok && result?.success !== false) {
        await saveEncryptedRecord({
          id: 'profile:self',
          data: payload,
          type: 'profile',
          sync_status: 'synced',
          last_updated: Date.now(),
          method: 'PATCH',
          endpoint
        });
        return result;
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return await queuePendingProfile(result?.error || result?.message || `HTTP ${response.status}`);
      }
      return result;
    } catch (error: any) {
      console.error('Error updating patient profile:', error);
      return await queuePendingProfile(error?.message || String(error));
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
          quality: 0.76,
          mimeType: 'image/webp'
        });
        const contentHash = await sha256TextHex(prepared.dataUrl) || await sha256Hex(file);
        const uploadTarget = resolveIdempotentPatientPhotoPath(path, prepared.contentType, contentHash);

        const response = await fetch('/api/storage/upload', {
          method: 'POST',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            bucket,
            path: uploadTarget.path,
            contentType: prepared.contentType,
            fileBase64: prepared.dataUrl,
            idempotent: uploadTarget.idempotent,
            idempotencyKey: uploadTarget.idempotencyKey
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
      if (import.meta.env.DEV) {
        console.warn('Upload direto indisponivel; tentando fallback pelo servidor:', sanitizeTechnicalErrorMessage(error?.message));
      }
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
        ? await compressImageDataUrl(dataUrl, { maxDimension: 1200, quality: 0.76, mimeType: 'image/webp' })
        : { dataUrl, contentType: contentTypeHint || 'image/png' };
      const contentHash = shouldCompressPatientPhoto ? await sha256TextHex(prepared.dataUrl) : null;
      const uploadTarget = shouldCompressPatientPhoto
        ? resolveIdempotentPatientPhotoPath(path, prepared.contentType, contentHash)
        : { path, idempotent: false, idempotencyKey: '' };
      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          bucket,
          path: uploadTarget.path,
          contentType: prepared.contentType,
          fileBase64: prepared.dataUrl,
          idempotent: uploadTarget.idempotent,
          idempotencyKey: uploadTarget.idempotencyKey
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

  async getClinicAnamnesisTemplates(workspaceId?: string) {
    try {
      const response = await fetch('/api/clinic/anamnesis-templates', {
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching anamnesis templates:', error);
      return { success: false, error: String(error), data: [] };
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

  async saveClinicAnamnesisTemplateRecord(template: any, workspaceId?: string) {
    try {
      const safeTemplate = parseJsonObject(template) || {};
      const response = await fetch('/api/clinic/anamnesis-templates', {
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
      console.error('Error saving anamnesis template record:', error);
      return { success: false, error: String(error) };
    }
  },

  async deleteClinicAnamnesisTemplateRecord(templateId: string, workspaceId?: string) {
    try {
      const response = await fetch(`/api/clinic/anamnesis-templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE',
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error deleting anamnesis template record:', error);
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
      const remoteProtocols = normalizeProtocolList(clinicData?.protocols);
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
      if (Array.isArray(payload?.protocols) && payload.protocols.length > 0) {
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

  async createAppointments(appointments: any[], clientRequestId?: string) {
    try {
      const stableRequestId =
        clientRequestId ||
        appointments.map((appointment) => String(appointment?.id || "")).filter(Boolean).join(",");
      const idempotencyKey = `POST:/api/appointments:${stableRequestId}`;
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: {
          ...(await getAuthHeaders()),
          "X-Idempotency-Key": idempotencyKey,
        },
        credentials: "include",
        body: JSON.stringify({ appointments, idempotencyKey }),
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return {
          success: false,
          error: result?.error || `Falha ao criar agendamento (HTTP ${response.status}).`,
        };
      }
      return result;
    } catch (error) {
      console.error("Error creating appointments:", error);
      return { success: false, error: "Não foi possível confirmar o agendamento." };
    }
  },

  async updateAppointment(appointmentId: string, appointments: any[], clientRequestId?: string) {
    try {
      const stableRequestId = clientRequestId || `${appointmentId}:${appointments.map((item) => item?.id).join(",")}`;
      const idempotencyKey = `PATCH:/api/appointments/${appointmentId}:${stableRequestId}`;
      const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "PATCH",
        headers: {
          ...(await getAuthHeaders()),
          "X-Idempotency-Key": idempotencyKey,
        },
        credentials: "include",
        body: JSON.stringify({ appointments, idempotencyKey }),
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return {
          success: false,
          error: result?.error || `Falha ao editar agendamento (HTTP ${response.status}).`,
        };
      }
      return result;
    } catch (error) {
      console.error("Error updating appointment:", error);
      return { success: false, error: "Não foi possível confirmar a alteração do agendamento." };
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
      const response = await fetch(endpointWithLimit(`/api/patient-anamnesis/${patientId}`, 20), {
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
      fetch(endpointWithLimit('/api/patients', 200), { headers: headersWithWorkspace, credentials: 'include' })
    ]);

    const clinicStateRes = await safeJson(clinicStateResponse);
    const clinicTemplateRes = await safeJson(clinicTemplateResponse);
    const patientsRes = await safeJson(patientsResponse);

    if (!clinicStateResponse.ok || clinicStateRes?.success === false) {
      return {
        success: false,
        error: clinicStateRes?.error || clinicStateRes?.warning || `Falha ao carregar estado da clínica (HTTP ${clinicStateResponse.status}).`
      };
    }

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
        fetch(endpointWithLimit(`/api/notes/${patientId}`, 20), { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(endpointWithLimit(`/api/history/${patientId}`, 20), { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(endpointWithLimit(`/api/tasks/${patientId}`, 20), { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(endpointWithLimit(`/api/assigned-tasks/${patientId}`, 20), { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(`/api/patient-records/${patientId}`, { headers: headersWithWorkspace, credentials: 'include' }),
        fetch(endpointWithLimit(`/api/patient-anamnesis/${patientId}`, 20), { headers: headersWithWorkspace, credentials: 'include' })
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
      const peiGoals = normalizePeiGoals(recordPayload, patient);

      hydratedPatients.push({
        ...patient,
        socialName: recordPayload?.nomeSocial || patient?.social_name || patient?.socialName || null,
        birthDate: recordPayload?.dataNascimento || patient?.birth_date || patient?.birthDate || null,
        gender: recordPayload?.genero || patient?.gender || null,
        insuranceType: recordPayload?.convenioTipo || patient?.insurance_type || patient?.insuranceType || 'particular',
        insuranceName: recordPayload?.convenioNome || patient?.insurance_name || patient?.insuranceName || null,
        cardNumber: recordPayload?.convenioCarteirinha || patient?.insurance_card_number || patient?.cardNumber || null,
        group: recordPayload?.grupo || patient?.patient_group || patient?.group || null,
        source: recordPayload?.comoConheceu || patient?.lead_source || patient?.source || null,
        rg: recordPayload?.rg || patient?.rg || null,
        cep: recordPayload?.cep || patient?.cep || null,
        address: recordPayload
          ? {
              cep: recordPayload?.cep || patient?.cep || null,
              logradouro: recordPayload?.logradouro || patient?.address?.logradouro || null,
              numero: recordPayload?.numero || patient?.address?.numero || null,
              complemento: recordPayload?.complemento || patient?.address?.complemento || null,
              bairro: recordPayload?.bairro || patient?.address?.bairro || null,
              cidade: recordPayload?.cidade || patient?.address?.cidade || null,
            }
          : patient?.address || null,
        notes: recordPayload?.outrasInformacoes || patient?.notes || null,
        isMinor:
          typeof recordPayload?.menorDeIdade === 'boolean'
            ? recordPayload.menorDeIdade
            : Boolean(patient?.is_minor || patient?.isMinor),
        guardian: {
          nome: recordPayload?.responsavelNome || patient?.responsible_name || patient?.guardian?.nome || null,
          dataNascimento:
            recordPayload?.responsavelDataNascimento ||
            patient?.responsible_birth_date ||
            patient?.guardian?.dataNascimento ||
            null,
          cpf: recordPayload?.responsavelCpf || patient?.responsible_cpf || patient?.guardian?.cpf || null,
          telefone: recordPayload?.responsavelTelefone || patient?.responsible_phone || patient?.guardian?.telefone || null,
          email: recordPayload?.responsavelEmail || patient?.responsible_email || patient?.guardian?.email || null,
          relacao:
            recordPayload?.responsavelRelacao ||
            patient?.responsible_relationship ||
            patient?.metadata?.responsibleRelationship ||
            patient?.guardian?.relacao ||
            null,
        },
        patientProfileType: normalizePatientProfileType(
          recordPayload?.patientProfileType ||
            recordPayload?.panelType ||
            patient?.patient_profile_type ||
            patient?.panel_type ||
            patient?.profile_type ||
            patient?.type,
        ),
        panelType: normalizePatientProfileType(
          recordPayload?.panelType ||
            recordPayload?.patientProfileType ||
            patient?.panel_type ||
            patient?.patient_profile_type ||
            patient?.profile_type ||
            patient?.type,
        ),
        anamnesisData,
        pei: peiGoals,
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
        pei: peiGoals,
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
    const remoteProtocols = normalizeProtocolList(clinicStateData?.protocols);
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
