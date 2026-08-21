import { ensureFreshSession, getSupabase } from '../lib/supabase';
import {
  generateId,
  getEndpointCacheMeta,
  getLatestTypeUpdate,
  getRecordById,
  getRecordsByType,
  discardFailedOfflineEntityMutations,
  markRecordSyncStatus,
  markRecordSyncFailure,
  saveEncryptedRecord,
  setEndpointCacheMeta
} from './localDb';
import {
  buildAbaPromptSnapshot,
  normalizeAbaPromptTypeConfig,
  resolveAbaPromptLevel,
  resolveTrialPromptInfo
} from '../utils/abaPromptLevels';
import { isAbaV2Enabled, isAbaV3UiEnabled } from '../utils/featureFlags';
import { sanitizeTechnicalErrorMessage } from '../utils/displayLabels';
import { isIdempotentConflictPayload } from '../utils/offlineSyncResilience';
import { normalizePatientProfileType } from '../utils/patientProfileType';
import {
  mirrorPatientInsuranceEligibilityAliases,
  normalizePatientInsuranceEligibility,
} from '../utils/patientInsuranceEligibility';
import { normalizeClinicalTextRecord } from '../utils/clinicalText';
import {
  normalizePatientListResponse,
  PATIENT_LIST_INVALID_RESPONSE_CODE,
} from '../utils/patientList';
import type { NewFeatureKey } from '../constants/featureMetadata';

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

function dataUrlToBlob(dataUrl: string, fallbackContentType = 'application/octet-stream'): Blob {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Imagem comprimida inválida para upload.');
  const contentType = String(match[1] || fallbackContentType).trim() || fallbackContentType;
  const encodedPayload = match[3] || '';
  try {
    if (match[2]) {
      const binary = atob(encodedPayload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: contentType });
    }
    return new Blob([decodeURIComponent(encodedPayload)], { type: contentType });
  } catch {
    throw new Error('Falha ao preparar a imagem comprimida para upload.');
  }
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

  const familyDiaryMatch = normalizedPath.match(/^([^/]+)\/family(?:[-/.]|$)/i);
  if (familyDiaryMatch) {
    const ownerId = familyDiaryMatch[1];
    return {
      path: `${ownerId}/family/family-${shortHash}.${extension}`,
      idempotent: true,
      idempotencyKey: `patient-family:${ownerId}:${shortHash}`
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
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { raw: parsed };
      return {
        ...payload,
        success: false,
        status: response.status,
        error: payload?.error || payload?.message || `HTTP ${response.status}`
      };
    }
    return parsed;
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

function notifyClinicalOutcomesChanged(patientId: string) {
  if (typeof window === 'undefined') return;
  const safePatientId = String(patientId || '').trim();
  if (!safePatientId) return;
  window.dispatchEvent(new CustomEvent('verto:clinical-outcomes-changed', {
    detail: { patientId: safePatientId },
  }));
}

const abaDecisionIdempotencyKeys = new Map<string, string>();

function stableClinicalMutationPayload(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableClinicalMutationPayload).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => !['idempotencyKey', 'idempotency_key'].includes(key)).sort().map((key) => `${JSON.stringify(key)}:${stableClinicalMutationPayload(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function abaDecisionPayload(scope: string, payload: any = {}) {
  const cleanPayload = { ...(payload || {}) };
  delete cleanPayload.idempotencyKey;
  delete cleanPayload.idempotency_key;
  const material = `${scope}:${stableClinicalMutationPayload(cleanPayload)}`;
  let idempotencyKey = abaDecisionIdempotencyKeys.get(material);
  if (!idempotencyKey) {
    idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    abaDecisionIdempotencyKeys.set(material, idempotencyKey);
  }
  return {
    material,
    body: { ...cleanPayload, idempotencyKey },
    complete(result: any) {
      if (result?.success !== false) abaDecisionIdempotencyKeys.delete(material);
    }
  };
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
  return normalizeArrayLike(value, ['protocols', 'items', 'data', 'value'])
    .filter(Boolean)
    .map((protocol) => normalizeClinicalTextRecord(protocol));
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

type OfflineType = 'patient' | 'note' | 'history' | 'log' | 'profile' | 'task' | 'payment' | 'aba' | 'aba_v3' | 'appointment' | 'clinic_state' | 'patient_record' | 'assigned_task';

async function buildConditionalHeaders(endpoint: string, type: OfflineType, includeBearer = false) {
  const headers = await getAuthHeaders(includeBearer);
  const meta = await getEndpointCacheMeta(endpoint);
  const latest = await getLatestTypeUpdate(type);

  if (meta?.etag) headers['If-None-Match'] = meta.etag;
  if (meta?.last_modified) headers['If-Modified-Since'] = meta.last_modified;
  if (latest) headers['X-Last-Updated'] = String(latest);

  return headers;
}

async function cacheResponseMetadata(
  endpoint: string,
  response: Response,
  lastUpdated?: number | null,
  snapshotCount?: number | null,
) {
  await setEndpointCacheMeta({
    endpoint,
    etag: response.headers.get('etag'),
    last_modified: response.headers.get('last-modified'),
    last_seen_updated: lastUpdated || null,
    snapshot_count: Number.isFinite(snapshotCount) ? Number(snapshotCount) : null,
  });
}

function createIdempotencyKey(scope: string, entityId?: string) {
  const baseId = entityId || generateId();
  return `${scope}:${baseId}:${Date.now()}:${crypto.randomUUID()}`;
}

let lastOfflineMutationTimestamp = 0;
function nextOfflineMutationTimestamp() {
  const now = Date.now();
  lastOfflineMutationTimestamp = Math.max(now, lastOfflineMutationTimestamp + 1);
  return lastOfflineMutationTimestamp;
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
async function saveOfflineFirst(id: string, data: any, type: OfflineType, endpoint: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST', options: { queueEntityId?: string } = {}) {
  const idempotencyKey = createIdempotencyKey(`${method}:${endpoint}`, id);
  // Every mutation gets its own durable outbox row. Reusing an id while a prior
  // request is in-flight can let the older response acknowledge/delete the newer edit.
  const queueId = `${type}:${id}:${crypto.randomUUID()}`;
  const queueEntityId = String(options?.queueEntityId || id).trim() || id;
  const payloadWithIdempotency = {
    ...(data || {}),
    idempotencyKey
  };
  let locallyPersisted = false;

  // 1. Save locally first
  try {
    await saveEncryptedRecord({
      id: queueId,
      entity_id: queueEntityId,
      data: payloadWithIdempotency,
      type,
      sync_status: 'pending',
      last_updated: nextOfflineMutationTimestamp(),
      retry_count: 0,
      last_attempt_at: null,
      next_retry_at: null,
      last_error: null,
      method,
      endpoint
    });
    locallyPersisted = true;
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
        await markRecordSyncFailure(queueId, {
          status: 503,
          retryable: true,
          error: result?.warning || 'Servidor enfileirou o sync para tentar depois.'
        });
        return {
          success: locallyPersisted,
          offline: true,
          pending: true,
          durable: locallyPersisted,
          status: response.status,
          warning: result?.warning,
          details: result,
          data: payloadWithIdempotency
        };
      }
      if (result?.success === false) {
        const logicalError = result?.error || result?.message || 'O servidor recusou a persistência.';
        await markRecordSyncFailure(queueId, {
          status: 400,
          retryable: false,
          error: logicalError
        });
        return {
          ...result,
          success: false,
          durable: locallyPersisted,
          pending: false,
          status: response.status,
          error: logicalError,
          data: payloadWithIdempotency
        };
      }
      // 3. Mark as synced only after an explicit successful server contract.
      await markRecordSyncStatus(queueId, 'synced');
      return {
        ...(result || {}),
        success: true,
        data: result?.data ?? payloadWithIdempotency,
        durable: true,
        pending: false
      };
    }
    const errorPayload = await safeJson(response);
    if (response.status === 409 && isIdempotentConflictPayload(errorPayload)) {
      await markRecordSyncStatus(queueId, 'synced');
      return {
        ...errorPayload,
        success: true,
        idempotent: true,
        status: response.status,
        data: errorPayload?.data || payloadWithIdempotency
      };
    }
    if (response.status === 409 && errorPayload?.conflict === true) {
      const conflictMessage =
        errorPayload?.error ||
        errorPayload?.message ||
        'Outra alteração foi confirmada antes desta. A versão local foi preservada.';
      await markRecordSyncStatus(queueId, 'conflict', {
        last_attempt_at: Date.now(),
        next_retry_at: null,
        last_error: conflictMessage
      });
      return {
        ...errorPayload,
        success: locallyPersisted,
        durable: locallyPersisted,
        pending: locallyPersisted,
        conflict: true,
        status: response.status,
        error: conflictMessage,
        data: payloadWithIdempotency
      };
    }
    const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408;

    if (!isRetryable) {
      // Validation/auth errors should not retry forever, but the local record is kept for audit/retry UI.
      await markRecordSyncFailure(queueId, {
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

    await markRecordSyncFailure(queueId, {
      status: response.status,
      retryable: true,
      error:
        errorPayload?.error ||
        errorPayload?.message ||
        `Falha temporária (${response.status})`
    });
    return {
      success: locallyPersisted,
      offline: true,
      pending: true,
      durable: locallyPersisted,
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
    if (locallyPersisted) {
      await markRecordSyncFailure(queueId, {
        retryable: true,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return {
      success: locallyPersisted,
      data: payloadWithIdempotency,
      offline: true,
      pending: locallyPersisted,
      durable: locallyPersisted,
      error: locallyPersisted ? undefined : 'Não foi possível persistir localmente nem confirmar no servidor.'
    };
  }
}

export const dataService = {
  async getFeatureAccess(featureKeys: NewFeatureKey[]) {
    const keys = Array.from(new Set((featureKeys || []).map((key) => String(key || '').trim()).filter(Boolean))).slice(0, 20);
    if (!keys.length) return { success: true, data: [] };
    try {
      const response = await fetch(`/api/user/feature-access?keys=${encodeURIComponent(keys.join(','))}`, {
        headers: await getNoStoreAuthHeaders(false),
        credentials: 'include',
        cache: 'no-store',
      });
      return await safeNoStoreJson(response, 'Não foi possível carregar o estado das novidades.');
    } catch (error: any) {
      return { success: false, data: [], error: String(error?.message || 'Não foi possível carregar o estado das novidades.') };
    }
  },

  async markFeatureAccessed(featureKey: NewFeatureKey) {
    const normalizedKey = String(featureKey || '').trim();
    if (!normalizedKey) return { success: false, error: 'FEATURE_KEY_REQUIRED' };
    try {
      const response = await fetch(`/api/user/feature-access/${encodeURIComponent(normalizedKey)}`, {
        method: 'POST',
        headers: await getAuthHeaders(false),
        credentials: 'include',
        body: JSON.stringify({}),
      });
      return await safeJson(response);
    } catch (error: any) {
      return { success: false, error: String(error?.message || 'Não foi possível registrar o primeiro acesso.') };
    }
  },

  async saveActivityLog(log: any) {
    if (isTechnicalActivityLog(log)) {
      return { success: true, ignored: true };
    }
    const id = log.id || generateId();
    const data = { ...log, id, timestamp: log.timestamp || new Date().toISOString() };
    return await saveOfflineFirst(id, data, 'log', '/api/logs');
  },

  async getPatients(options: { workspaceId?: string; forceRemote?: boolean; patientId?: string } = {}) {
    const workspaceId = String(options?.workspaceId || '').trim();
    const requestedPatientId = String(options?.patientId || '').trim();
    const endpoint = endpointWithQuery('/api/patients', {
      limit: requestedPatientId ? 1 : 200,
      patientId: requestedPatientId || undefined
    });
    const forceRemote = options?.forceRemote === true;
    try {
      const headers = forceRemote
        ? await getNoStoreAuthHeaders(false)
        : await buildConditionalHeaders(endpoint, 'patient');
      if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
      const response = await fetchClinical(endpoint, {
        headers,
        credentials: 'include',
        ...(forceRemote ? { cache: 'no-store' as RequestCache } : {})
      }, { helperName: 'getPatients', operation: 'list', table: 'patients', hasExplicitColumns: true, requiresPatientOrSession: false });
      if (response.status === 304) {
        const [local304, cacheMeta] = await Promise.all([
          getRecordsByType('patient'),
          getEndpointCacheMeta(endpoint),
        ]);
        const cachedPatients = local304
          .map((r) => mirrorPatientInsuranceEligibilityAliases(r.data || {}, { useResponsibleFallback: true }))
          .filter((patient: any) => {
            const patientWorkspaceId = String(patient?.clinic_id || patient?.clinicId || '').trim();
            const patientId = String(patient?.id || '').trim();
            return (!workspaceId || !patientWorkspaceId || patientWorkspaceId === workspaceId) &&
              (!requestedPatientId || patientId === requestedPatientId);
          });
        const rawSnapshotCount = cacheMeta?.snapshot_count;
        const expectedSnapshotCount = typeof rawSnapshotCount === 'number' ? rawSnapshotCount : Number.NaN;
        const hasKnownSnapshotCount = Number.isFinite(expectedSnapshotCount) && expectedSnapshotCount >= 0;
        const cacheLooksComplete = hasKnownSnapshotCount && cachedPatients.length === expectedSnapshotCount;

        // A 304 only proves that the remote representation did not change; it does not
        // prove that IndexedDB still contains the complete representation that produced
        // that ETag. A partial/cleared local cache previously made 3 patients render as 1.
        // Revalidate once without conditional headers instead of treating a partial cache
        // as authoritative. Healthy complete caches still keep the zero-egress 304 path.
        if (!cacheLooksComplete && !forceRemote) {
          console.warn('[PatientList] Snapshot local incompleto após 304; refazendo leitura canônica sem cache.', {
            cachedCount: cachedPatients.length,
            expectedSnapshotCount: hasKnownSnapshotCount ? expectedSnapshotCount : null,
          });
          return await dataService.getPatients({ ...options, forceRemote: true });
        }
        if (!cacheLooksComplete) {
          return {
            success: false,
            error: 'A cópia local da lista de pacientes está incompleta e a leitura canônica não pôde ser confirmada.',
          };
        }
        return { success: true, data: cachedPatients };
      }
      if (response.ok) {
        const result = await response.json();
        const patientList = normalizePatientListResponse(result);
        if (!patientList.success) {
          console.error('[PatientList] Invalid API response contract.', {
            code: PATIENT_LIST_INVALID_RESPONSE_CODE,
          });
          return patientList;
        }
        const normalizedPatients = patientList.data.map((p: any) =>
          mirrorPatientInsuranceEligibilityAliases(p || {}, { useResponsibleFallback: true })
        );
        let latest = 0;
        try {
          for (const p of normalizedPatients) {
            const patientId = String(p?.id || '').trim();
            if (!patientId) continue;
            const updatedAtMs = p?.updated_at ? new Date(p.updated_at).getTime() : Date.now();
            latest = Math.max(latest, Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());
            await saveEncryptedRecord({
              id: patientId,
              data: p,
              type: 'patient',
              sync_status: 'synced',
              last_updated: latest,
              method: 'POST',
              endpoint
            });
          }
          await cacheResponseMetadata(endpoint, response, latest || null, normalizedPatients.length);
        } catch (cacheError) {
          console.warn('[PatientList] Cache local indisponível; mantendo snapshot remoto canônico.', cacheError);
        }

        // A resposta autenticada do servidor é a autoridade da listagem. O cache só
        // pode sobrepor um paciente remoto quando existe mutação local ainda pendente.
        // Assim, IndexedDB vazio/corrompido nunca transforma uma lista remota válida em [].
        const patientsById = new Map<string, any>();
        for (const patient of normalizedPatients) {
          const patientId = String(patient?.id || '').trim();
          if (patientId) patientsById.set(patientId, patient);
        }
        try {
          const localRecords = await getRecordsByType('patient');
          for (const record of localRecords) {
            if (record?.sync_status === 'synced') continue;
            const { recordPayload: _recordPayload, idempotencyKey: _idempotencyKey, ...patientData } = record?.data || {};
            const localPatient = mirrorPatientInsuranceEligibilityAliases(patientData, { useResponsibleFallback: true });
            const patientId = String(localPatient?.id || '').trim();
            const patientWorkspaceId = String(localPatient?.clinic_id || localPatient?.clinicId || '').trim();
            if (
              !patientId ||
              (workspaceId && patientWorkspaceId && patientWorkspaceId !== workspaceId) ||
              (requestedPatientId && patientId !== requestedPatientId)
            ) continue;
            const remotePatient = patientsById.get(patientId);
            patientsById.set(patientId, remotePatient ? { ...remotePatient, ...localPatient } : localPatient);
          }
        } catch (cacheError) {
          console.warn('[PatientList] Overlay offline indisponível; renderizando snapshot remoto.', cacheError);
        }
        return { ...result, success: true, data: Array.from(patientsById.values()) };
      }
      const errorPayload = await safeJson(response);
      return {
        success: false,
        status: response.status,
        error:
          errorPayload?.error ||
          errorPayload?.message ||
          `Não foi possível carregar os pacientes (HTTP ${response.status}).`,
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as any).code === PATIENT_LIST_INVALID_RESPONSE_CODE
      ) {
        return {
          success: false,
          code: PATIENT_LIST_INVALID_RESPONSE_CODE,
          error: 'A resposta da lista de pacientes possui formato inválido.',
        };
      }
      console.log('Fetching patients from local storage...');
    }
    const local = await getRecordsByType('patient');
    return {
      success: true,
      data: local
        .map((r) => mirrorPatientInsuranceEligibilityAliases(r.data || {}, { useResponsibleFallback: true }))
        .filter((patient: any) => {
          const patientWorkspaceId = String(patient?.clinic_id || patient?.clinicId || '').trim();
          const patientId = String(patient?.id || '').trim();
          return (!workspaceId || !patientWorkspaceId || patientWorkspaceId === workspaceId) &&
            (!requestedPatientId || patientId === requestedPatientId);
        })
    };
  },

  async savePatient(patient: any, options: { recordPayload?: any } = {}) {
    const id = patient.id || generateId();
    const recordPayload = options?.recordPayload && typeof options.recordPayload === 'object'
      ? options.recordPayload
      : undefined;
    const data = {
      ...patient,
      id,
      created_at: patient.created_at || new Date().toISOString(),
      ...(recordPayload ? { recordPayload } : {})
    };
    if (patient?.id) {
      return await saveOfflineFirst(id, data, 'patient', `/api/patients/${id}`, 'PATCH');
    }
    return await saveOfflineFirst(id, data, 'patient', '/api/patients');
  },

  async savePatientRecord(patientId: string, payload: any) {
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) {
      console.warn('[PatientPortal] skipped patient-scoped save: missing resolvedPatientId');
      return { success: false, error: 'Paciente não resolvido para este acesso.' };
    }
    const workspaceId = String(payload?.workspace_id || '').trim();
    return await saveOfflineFirst(
      `record:${safePatientId}`,
      {
        workspace_id: workspaceId || undefined,
        payload
      },
      'patient_record',
      `/api/patient-records/${safePatientId}`,
      'POST'
    );
  },

  async getPatientRecord(patientId: string) {
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) {
      console.warn('[PatientPortal] skipped patient-scoped fetch: missing resolvedPatientId');
      return { success: false, data: null, error: 'Paciente não resolvido para este acesso.' };
    }
    const readPendingAggregateRecordPayload = async () => {
      const pendingPatient = (await getRecordsByType('patient')).find((record) =>
        String(record?.entity_id || record?.id || '').trim() === safePatientId &&
        record?.sync_status !== 'synced' &&
        record?.data?.recordPayload &&
        typeof record.data.recordPayload === 'object'
      );
      return pendingPatient?.data?.recordPayload && typeof pendingPatient.data.recordPayload === 'object'
        ? pendingPatient.data.recordPayload
        : null;
    };
    try {
      const response = await fetch(`/api/patient-records/${safePatientId}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      const pendingAggregatePayload = await readPendingAggregateRecordPayload();
      if (!response.ok || result?.success === false) {
        const local = await getRecordById(`record:${safePatientId}`);
        const localPayload = local?.data?.payload && typeof local.data.payload === 'object' ? local.data.payload : null;
        if (localPayload || pendingAggregatePayload) {
          return {
            success: true,
            data: {
              patient_id: safePatientId,
              payload: {
                ...(localPayload || {}),
                ...(pendingAggregatePayload || {})
              }
            },
            offline: true,
            pending: Boolean(pendingAggregatePayload)
          };
        }
        return result;
      }
      const parsedPayload = parseJsonObject(result?.data?.payload) || {};
      const remotePayloadForCache = mirrorPatientInsuranceEligibilityAliases(
        parsedPayload,
        { useResponsibleFallback: true }
      );
      await saveEncryptedRecord({
        id: `record:${safePatientId}`,
        entity_id: `record:${safePatientId}`,
        data: { payload: remotePayloadForCache || null },
        type: 'patient_record',
        sync_status: 'synced',
        last_updated: Date.now(),
        method: 'POST',
        endpoint: `/api/patient-records/${safePatientId}`
      });
      // Re-read through the cache/outbox overlay after caching the remote row so
      // a successful GET can never hide an unconfirmed local clinical edit.
      const effectiveLocalRecord = await getRecordById(`record:${safePatientId}`);
      const effectiveLocalPayload =
        effectiveLocalRecord?.data?.payload && typeof effectiveLocalRecord.data.payload === 'object'
          ? effectiveLocalRecord.data.payload
          : {};
      const effectivePayload = {
        ...parsedPayload,
        ...effectiveLocalPayload,
        ...(pendingAggregatePayload || {})
      };
      const normalizedPayload = mirrorPatientInsuranceEligibilityAliases(
        effectivePayload,
        { useResponsibleFallback: true }
      );
      return {
        ...result,
        data: result?.data
          ? {
              ...result.data,
              payload: normalizedPayload || result.data.payload || null
            }
          : result?.data,
        pending: Boolean(
          pendingAggregatePayload ||
          (effectiveLocalRecord && effectiveLocalRecord.sync_status !== 'synced')
        )
      };
    } catch (error) {
      console.error('Error fetching patient record:', error);
      const [local, pendingAggregatePayload] = await Promise.all([
        getRecordById(`record:${safePatientId}`),
        readPendingAggregateRecordPayload()
      ]);
      const localPayload = local?.data?.payload && typeof local.data.payload === 'object' ? local.data.payload : null;
      if (localPayload || pendingAggregatePayload) {
        return {
          success: true,
          data: {
            patient_id: safePatientId,
            payload: {
              ...(localPayload || {}),
              ...(pendingAggregatePayload || {})
            }
          },
          offline: true,
          pending: Boolean(pendingAggregatePayload)
        };
      }
      return { success: false, error: String(error) };
    }
  },

  async getPatientDetailSnapshot(patient: any) {
    const patientId = String(patient?.id || '').trim();
    if (!patientId) {
      return { success: false, error: 'Paciente não resolvido para este acesso.' };
    }
    const recordResult = await dataService.getPatientRecord(patientId);
    if (!recordResult?.success || !recordResult?.data) return recordResult;

    const recordPayload = parseJsonObject(recordResult.data.payload) || {};
    const anamnesisData = parseJsonObject(recordPayload?.anamnese) || null;
    const insuranceEligibility = normalizePatientInsuranceEligibility(
      { ...patient, payload: recordPayload, anamnesisData },
      { useResponsibleFallback: true },
    );
    const hydratedPatient = {
      ...patient,
      socialName: recordPayload?.nomeSocial || patient?.social_name || patient?.socialName || null,
      birthDate: recordPayload?.dataNascimento || patient?.birth_date || patient?.birthDate || null,
      gender: recordPayload?.genero || patient?.gender || null,
      insuranceType: insuranceEligibility.insuranceType,
      insuranceName: insuranceEligibility.insuranceName || null,
      cardNumber: insuranceEligibility.insuranceCardNumber || null,
      insuranceCardNumber: insuranceEligibility.insuranceCardNumber || null,
      insurance_card_number: insuranceEligibility.insuranceCardNumber || null,
      insuranceCardValidUntil: insuranceEligibility.insuranceCardValidUntil || null,
      insurance_card_valid_until: insuranceEligibility.insuranceCardValidUntil || null,
      insurancePlanCategory: insuranceEligibility.insurancePlanCategory || null,
      insurance_plan_category: insuranceEligibility.insurancePlanCategory || null,
      insuranceHolderName: insuranceEligibility.insuranceHolderName || null,
      insurance_holder_name: insuranceEligibility.insuranceHolderName || null,
      insuranceHolderCpf: insuranceEligibility.insuranceHolderCpf || null,
      insurance_holder_cpf: insuranceEligibility.insuranceHolderCpf || null,
      insuranceHolderRelationship: insuranceEligibility.insuranceHolderRelationship || null,
      insurance_holder_relationship: insuranceEligibility.insuranceHolderRelationship || null,
      eligibilityNotes: insuranceEligibility.insuranceEligibilityNotes || null,
      eligibility_notes: insuranceEligibility.insuranceEligibilityNotes || null,
      convenioTipo: insuranceEligibility.convenioTipo,
      convenioNome: insuranceEligibility.convenioNome,
      convenioCarteirinha: insuranceEligibility.convenioCarteirinha,
      convenioCarteirinhaValidade: insuranceEligibility.convenioCarteirinhaValidade,
      convenioPlanoCategoria: insuranceEligibility.convenioPlanoCategoria,
      convenioTitularNome: insuranceEligibility.convenioTitularNome,
      convenioTitularCpf: insuranceEligibility.convenioTitularCpf,
      convenioTitularRelacao: insuranceEligibility.convenioTitularRelacao,
      convenioElegibilidadeObs: insuranceEligibility.convenioElegibilidadeObs,
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
        telefone:
          recordPayload?.responsavelTelefone ||
          patient?.responsible_phone ||
          patient?.guardian?.telefone ||
          null,
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
      pei: normalizePeiGoals(recordPayload, patient),
      evaluationLinks:
        recordPayload?.evaluationLinks && typeof recordPayload.evaluationLinks === 'object'
          ? recordPayload.evaluationLinks
          : patient?.evaluationLinks || {},
      interventionTaskLinks:
        recordPayload?.interventionTaskLinks &&
        typeof recordPayload.interventionTaskLinks === 'object'
          ? recordPayload.interventionTaskLinks
          : patient?.interventionTaskLinks || {},
      lastAnamnesisAt: recordPayload?.lastAnamnesisAt || patient?.lastAnamnesisAt || null,
      financialPlans: Array.isArray(recordPayload?.financialPlans)
        ? recordPayload.financialPlans
        : Array.isArray(patient?.financialPlans)
          ? patient.financialPlans
          : [],
      monthlyTreatmentValue:
        Number(recordPayload?.monthlyTreatmentValue ?? patient?.monthlyTreatmentValue ?? 0) || 0,
      billingDueDay: recordPayload?.billingDueDay || patient?.billingDueDay || null,
      billingMethod: recordPayload?.billingMethod || patient?.billingMethod || null,
      patientRecordPayload: recordPayload,
      patientRecordLoaded: true,
    };
    return { success: true, data: hydratedPatient };
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
    const safePatientId = String(patientId || '').trim();
    return await saveOfflineFirst(
      `financial-plans:${safePatientId}`,
      { financialPlans: Array.isArray(financialPlans) ? financialPlans : [] },
      'patient_record',
      `/api/patients/${encodeURIComponent(safePatientId)}/financial-plans`,
      'PUT'
    );
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

  async getPatientFile(patientId: string, fileId: string) {
    try {
      const query = new URLSearchParams({ fileId: String(fileId || '').trim() });
      const response = await fetch(`/api/patient-files/${encodeURIComponent(String(patientId))}?${query.toString()}`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      return {
        ...result,
        data: Array.isArray(result?.data) ? result.data[0] || null : result?.data || null
      };
    } catch (error) {
      console.error('Error fetching patient file:', error);
      return { success: false, error: String(error), data: null };
    }
  },

  async accessPatientFile(patientId: string, fileId: string, action: 'view' | 'download') {
    try {
      const clientEventId = crypto.randomUUID();
      const response = await fetch(`/api/patient-files/${encodeURIComponent(String(patientId))}/${encodeURIComponent(String(fileId))}/access`, {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'X-Audit-Event-Id': clientEventId
        },
        credentials: 'include',
        body: JSON.stringify({ action: action.toUpperCase(), client_event_id: clientEventId })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error accessing patient file:', error);
      return { success: false, error: String(error), data: null };
    }
  },

  async getPatientFilePermissions(patientId: string, fileId: string) {
    try {
      const response = await fetch(`/api/patient-files/${encodeURIComponent(String(patientId))}/${encodeURIComponent(String(fileId))}/permissions`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient file permissions:', error);
      return { success: false, error: String(error), data: null };
    }
  },

  async updatePatientFilePermissions(patientId: string, fileId: string, payload: {
    accessScope: 'OWNER' | 'CASE_TEAM' | 'PATIENT_ACCESS' | 'SELECTED';
    patientPortalVisible: boolean;
    selectedUserIds?: string[];
  }) {
    try {
      const response = await fetch(`/api/patient-files/${encodeURIComponent(String(patientId))}/${encodeURIComponent(String(fileId))}/permissions`, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessScope: payload.accessScope,
          patientPortalVisible: payload.patientPortalVisible === true,
          selectedUserIds: Array.isArray(payload.selectedUserIds) ? payload.selectedUserIds.slice(0, 100) : []
        })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating patient file permissions:', error);
      return { success: false, error: String(error), data: null };
    }
  },

  async uploadPatientFile(patientId: string, payload: any) {
    try {
      if (payload?.fileBlob instanceof Blob) {
        let uploadBlob: Blob = payload.fileBlob;
        let requestedFileName = String(payload?.fileName || 'arquivo.pdf').trim() || 'arquivo.pdf';
        const originalSize = Number(payload?.fileBlob?.size || 0);
        if (!Number.isFinite(originalSize) || originalSize <= 0 || originalSize > 10 * 1024 * 1024) {
          return { success: false, error: 'O arquivo deve ter no máximo 10 MB.' };
        }
        const lowerFileName = requestedFileName.toLowerCase();
        const mimeByExtension: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp'
        };
        const matchedExtension = Object.keys(mimeByExtension).find((extension) => lowerFileName.endsWith(extension)) || '';
        let requestedMime = String(payload?.contentType || payload?.fileBlob?.type || '').trim().toLowerCase();
        // Browsers/OSes sometimes report DOCX as application/zip, application/msword
        // or application/octet-stream. The extension only normalizes the declared MIME;
        // the backend still validates the real bytes before persistence.
        if (matchedExtension && mimeByExtension[matchedExtension]) {
          requestedMime = mimeByExtension[matchedExtension];
        } else if (!requestedMime) {
          requestedMime = 'application/octet-stream';
        }
        if (requestedMime.startsWith('image/')) {
          const prepared = await compressImageDataUrl(uploadBlob, {
            maxDimension: 1600,
            quality: 0.78,
            mimeType: 'image/webp'
          });
          uploadBlob = dataUrlToBlob(prepared.dataUrl, prepared.contentType || 'image/webp');
          requestedMime = 'image/webp';
          requestedFileName = requestedFileName.replace(/\.[a-z0-9]+$/i, '') + '.webp';
        }
        const supportedMimeTypes = new Set([
          'application/pdf',
          'application/json',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/png',
          'image/jpeg',
          'image/jpg',
          'image/webp'
        ]);
        if (!supportedMimeTypes.has(requestedMime)) {
          return { success: false, error: 'Formato não suportado. Envie PDF, JPG, PNG, WEBP ou DOCX.' };
        }
        const safeMime = requestedMime === 'image/jpg' ? 'image/jpeg' : requestedMime;
        const extensionByMime: Record<string, string> = {
          'application/pdf': '.pdf',
          'application/json': '.json',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/webp': '.webp'
        };
        const requiredExtension = extensionByMime[safeMime] || '';
        const normalizedFileName =
          requiredExtension && !requestedFileName.toLowerCase().endsWith(requiredExtension)
            ? `${requestedFileName}${requiredExtension}`
            : requestedFileName;
        const metadataPayload =
          payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
        let encodedMetadata = '';
        try {
          encodedMetadata = encodeURIComponent(JSON.stringify(metadataPayload));
        } catch {
          encodedMetadata = '';
        }

        const authHeaders = await getAuthHeaders();
        const { ['Content-Type']: _, ['content-type']: __, ...headersWithoutContentType } = authHeaders as any;
        const uploadHeaders: Record<string, string> = {
          ...headersWithoutContentType,
          'Content-Type': 'application/octet-stream',
          'X-Verto-Upload-Mode': 'raw-v1',
          'X-Verto-File-Name': encodeURIComponent(normalizedFileName),
          'X-Verto-Declared-Type': safeMime,
          'X-Verto-Source': String(payload?.source || 'upload').slice(0, 40)
        };
        // The backend recomputes SHA-256 and validates MIME/magic bytes. Do not
        // hash the file in the browser before transport: a local crypto failure
        // must never prevent a valid upload from reaching the authoritative API.
        if (encodedMetadata.length > 0 && encodedMetadata.length <= 3000) {
          uploadHeaders['X-Verto-Upload-Metadata'] = encodedMetadata;
        }

        return await new Promise<any>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/patient-files/${encodeURIComponent(String(patientId))}`, true);
          xhr.withCredentials = true;
          Object.entries(uploadHeaders).forEach(([key, value]) => {
            if (typeof value === 'string' && value) xhr.setRequestHeader(key, value);
          });
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || typeof payload?.onProgress !== 'function') return;
            const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
            payload.onProgress(percent);
          };
          xhr.onload = () => {
            let parsed: any = {};
            try {
              parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            } catch {
              parsed = {
                success: xhr.status >= 200 && xhr.status < 300,
                error: xhr.responseText || `Falha HTTP ${xhr.status}`
              };
            }
            if (!parsed || typeof parsed !== 'object') parsed = {};
            if (typeof parsed.success !== 'boolean') {
              parsed.success = xhr.status >= 200 && xhr.status < 300;
            }
            if (!parsed.success && !parsed.error) {
              parsed.error = `Falha HTTP ${xhr.status}`;
            }
            resolve({ ...parsed, status: xhr.status });
          };
          xhr.onerror = () => resolve({
            success: false,
            status: 0,
            error: 'Falha de rede durante o envio do arquivo.'
          });
          xhr.onabort = () => resolve({
            success: false,
            status: 0,
            error: 'Envio do arquivo cancelado.'
          });
          xhr.ontimeout = () => resolve({
            success: false,
            status: 0,
            error: 'Tempo limite excedido durante o envio do arquivo.'
          });
          xhr.timeout = 120000;
          xhr.send(uploadBlob);
        });
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
      const responseErrorCode =
        result?.code ||
        result?.error_code ||
        (typeof result?.error === 'string' && /^[A-Z0-9_]+$/.test(result.error) ? result.error : undefined);
      return {
        success: false,
        status: response.status,
        code: responseErrorCode,
        requiresReauthentication:
          response.status === 401 &&
          ['SERVER_SESSION_REQUIRED', 'SESSION_REVOKED'].includes(String(responseErrorCode || '')),
        error: normalizeApiErrorMessage(result?.message || result?.error || 'Não foi possível criar o acesso do paciente'),
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
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
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

  async getPatientLongitudinalTimeline(patientId: string, params: { limit?: number; cursor?: string } = {}) {
    try {
      const searchParams = new URLSearchParams();
      if (params.limit) searchParams.set('limit', String(params.limit));
      if (params.cursor) searchParams.set('cursor', String(params.cursor));
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

  async updatePatient(id: string, updates: any, options: { recordPayload?: any } = {}) {
    const aggregatePayload = options?.recordPayload && typeof options.recordPayload === 'object'
      ? { ...(updates || {}), recordPayload: options.recordPayload }
      : updates;
    return await saveOfflineFirst(id, aggregatePayload, 'patient', `/api/patients/${id}`, 'PATCH');
  },

  async deletePatient(id: string) {
    return await saveOfflineFirst(id, { id }, 'patient', `/api/patients/${id}`, 'DELETE');
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

  async getClinicalNoteMentions(limit = 12) {
    try {
      const response = await fetchClinical(endpointWithLimit('/api/clinical-note-mentions', normalizeListLimit(limit, 12, 30)), {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getClinicalNoteMentions',
        operation: 'list',
        table: 'clinical_note_mentions',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar suas menções.');
      return { success: false, data: [], error: message, message };
    }
  },

  async markClinicalNoteMentionRead(mentionId: string) {
    try {
      const response = await fetchClinical(`/api/clinical-note-mentions/${encodeURIComponent(String(mentionId))}/read`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'markClinicalNoteMentionRead',
        operation: 'write',
        table: 'clinical_note_mentions',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar a notificação.');
      return { success: false, error: message, message };
    }
  },

  async deleteNote(noteId: string) {
    return await saveOfflineFirst(noteId, { id: noteId }, 'note', `/api/notes/${noteId}`, 'DELETE');
  },

  async updateNote(noteId: string, updates: any) {
    return await saveOfflineFirst(noteId, updates || {}, 'note', `/api/notes/${noteId}`, 'PATCH');
  },

  async getHistory(patientId: string, params: { limit?: number; cursor?: string; from?: string; to?: string } = {}) {
    try {
      const endpoint = endpointWithQuery(`/api/history/${encodeURIComponent(patientId)}`, {
        limit: normalizeListLimit(params.limit, 40, 100),
        cursor: params.cursor,
        from: params.from,
        to: params.to
      });
      const response = await fetch(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      if (response.ok) {
        const result = await response.json();
        await Promise.all((Array.isArray(result?.data) ? result.data : []).map((h: any) =>
          saveEncryptedRecord({ id: h.id, data: h, type: 'history', sync_status: 'synced', last_updated: Date.now(), method: 'POST', endpoint: '/api/history' })
        ));
        return result;
      }
    } catch (error) {
      console.log('Fetching history from local storage...');
    }
    const local = await getRecordsByType('history');
    return {
      success: true,
      data: local.filter(r => r.data.patient_id === patientId).map(r => r.data),
      pagination: { limit: normalizeListLimit(params.limit, 40, 100), hasMore: false, nextCursor: null },
      offline: true
    };
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

  async completeAbaSession(sessionId: string, payload: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ id: String(sessionId), ...(payload || {}) });
    const response = await fetchClinical(
      `/api/aba/sessions/${encodeURIComponent(String(sessionId))}/complete`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      {
        helperName: 'completeAbaSession',
        operation: 'write',
        table: 'aba_sessions,aba_session_summaries,appointments,appointment_attendance_audit_events,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      }
    );
    const result = await response.json().catch(() => ({}));
    return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async reopenAppointmentNoShow(appointmentId: string, payload: any) {
    const response = await fetchClinical(
      `/api/appointments/${encodeURIComponent(String(appointmentId))}/reopen-no-show`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      {
        helperName: 'reopenAppointmentNoShow',
        operation: 'write',
        table: 'appointments,appointment_attendance_audit_events,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      }
    );
    const result = await response.json().catch(() => ({}));
    return response.ok ? result : { success: false, status: response.status, ...result };
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
    signal?: AbortSignal;
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
        credentials: 'include',
        signal: options.signal
      }, {
        helperName: 'getCalendarEvents',
        operation: 'list',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return { success: false, data: [], aborted: true };
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
        credentials: 'include',
        cache: 'no-store'
      }, {
        helperName: 'getPortalAppointments',
        operation: 'list',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar suas sessões agora.' };
    }
  },

  async getPortalContext() {
    try {
      const response = await fetchClinical('/api/portal/context', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPortalContext',
        operation: 'detail',
        table: 'patients,clinics',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível identificar o paciente vinculado a este acesso.' };
    }
  },

  async consumePortalMilestoneCelebration() {
    try {
      const response = await fetchClinical('/api/portal/milestone-celebration/consume', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
      }, {
        helperName: 'consumePortalMilestoneCelebration',
        operation: 'update',
        table: 'patient_milestone_celebration_receipts,notes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar a comemoração agora.' };
    }
  },

  async getPortalNotifications(limit = 12, options: { includeAcknowledged?: boolean; type?: 'clinic_announcement' } = {}) {
    try {
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
      const params = new URLSearchParams({ limit: String(safeLimit) });
      if (options.includeAcknowledged) params.set('includeAcknowledged', 'true');
      if (options.type === 'clinic_announcement') params.set('type', 'clinic_announcement');
      const response = await fetch(`/api/portal/notifications?${params.toString()}`, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
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
      return { success: false, data: null, error: 'Não foi possível carregar a sessão agora.' };
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
      return { success: false, error: 'Não foi possível confirmar a sessão agora.' };
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

  async getPortalAppointmentRescheduleSlots(appointmentId: string, params: any = {}) {
    const query = new URLSearchParams();
    if (params?.dateFrom) query.set('dateFrom', String(params.dateFrom));
    if (params?.maxDays) query.set('maxDays', String(params.maxDays));
    const endpoint = `/api/portal/appointments/${encodeURIComponent(String(appointmentId))}/reschedule-slots${query.toString() ? `?${query}` : ''}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
      }, {
        helperName: 'getPortalAppointmentRescheduleSlots',
        operation: 'list',
        table: 'appointments',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível carregar horários disponíveis agora.' };
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

  async getAppointmentActionRequestAvailability(requestId: string, options: { includeSuggestions?: boolean; dateFrom?: string; forceSchemaCheck?: boolean } = {}) {
    const search = new URLSearchParams();
    if (options.includeSuggestions) search.set('mode', 'suggestions');
    if (options.dateFrom) search.set('dateFrom', options.dateFrom);
    if (options.forceSchemaCheck) search.set('refresh', '1');
    const query = search.toString();
    const endpoint = `/api/appointments/action-requests/${encodeURIComponent(String(requestId))}/availability${query ? `?${query}` : ''}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store'
      }, {
        helperName: 'getAppointmentActionRequestAvailability',
        operation: 'detail',
        table: 'appointments,appointment_action_requests,clinic_memberships,professional_profiles,clinic_rooms',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível verificar os horários agora.' };
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

  async getPayerOptions(options: { limit?: number } = {}) {
    const endpoint = endpointWithQuery('/api/payer-options', {
      limit: normalizeListLimit(options.limit, 80, 100)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerOptions',
        operation: 'list',
        table: 'clinic_payers',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os convênios da clínica agora.' };
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

  async getPayerRequirementDeleteImpact(requirementId: string) {
    const endpoint = `/api/admin/payer-requirements/${encodeURIComponent(String(requirementId))}/delete-impact`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerRequirementDeleteImpact',
        operation: 'detail',
        table: 'clinic_payer_requirements,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível conferir dependências da exceção agora.' };
    }
  },

  async deletePayerRequirement(requirementId: string) {
    const endpoint = `/api/admin/payer-requirements/${encodeURIComponent(String(requirementId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'deletePayerRequirement',
        operation: 'write',
        table: 'clinic_payer_requirements,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível excluir a exceção agora.' };
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

  async getTussDeleteImpact(entityType: string, entityId: string) {
    const endpoint = `/api/admin/tuss/${encodeURIComponent(String(entityType))}/${encodeURIComponent(String(entityId))}/delete-impact`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTussDeleteImpact',
        operation: 'detail',
        table: 'tuss_service_catalog,tuss_codes,payer_tuss_mappings,payer_procedure_prices,appointment_billing_items,appointment_tiss_pre_guides,patient_payer_authorizations',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível conferir dependências agora.' };
    }
  },

  async deleteTussEntity(entityType: string, entityId: string) {
    const endpoint = `/api/admin/tuss/${encodeURIComponent(String(entityType))}/${encodeURIComponent(String(entityId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'deleteTussEntity',
        operation: 'write',
        table: 'tuss_service_catalog,tuss_codes,payer_tuss_mappings,payer_procedure_prices,payer_requirement_audit_logs',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível excluir o cadastro agora.' };
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

  async syncPayerTussMappingAuthorizations(mappingId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/mappings/${encodeURIComponent(String(mappingId))}/sync-authorizations`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'syncPayerTussMappingAuthorizations',
        operation: 'write',
        table: 'patient_payer_authorizations,appointment_tiss_pre_guides,tiss_revenue_cycle_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A sincronização de autorizações voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível sincronizar autorizações e Pré-guias agora.' };
    }
  },

  async getPayerProcedurePrices(options: any = {}) {
    const endpoint = endpointWithQuery('/api/admin/tuss/prices', {
      payerId: options.payerId,
      serviceCatalogId: options.serviceCatalogId,
      active: options.active ? 'true' : undefined,
      limit: normalizeListLimit(options.limit, 120, 300)
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPayerProcedurePrices',
        operation: 'list',
        table: 'payer_procedure_prices,tuss_service_catalog,tuss_codes,payer_tuss_mappings',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar a tabela negociada agora.' };
    }
  },

  async createPayerProcedurePrice(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/admin/tuss/prices', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createPayerProcedurePrice',
        operation: 'write',
        table: 'payer_procedure_prices',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível salvar o valor negociado agora.' };
    }
  },

  async updatePayerProcedurePrice(priceId: string, payload: any = {}) {
    const endpoint = `/api/admin/tuss/prices/${encodeURIComponent(String(priceId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePayerProcedurePrice',
        operation: 'write',
        table: 'payer_procedure_prices',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar o valor negociado agora.' };
    }
  },

  async getAppointmentBillingContext(appointmentId: string, options: any = {}) {
    const endpoint = endpointWithQuery(`/api/appointments/${encodeURIComponent(String(appointmentId))}/billing-context`, {
      payerId: options.payerId,
      payerName: options.payerName,
      serviceType: options.serviceType,
      serviceCatalogId: options.serviceCatalogId,
      procedureCode: options.procedureCode
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getAppointmentBillingContext',
        operation: 'detail',
        table: 'appointment_billing_contexts,appointment_required_documents,patient_payer_authorizations,payer_tuss_mappings,tuss_service_catalog,tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar pagador da sessão agora.' };
    }
  },

  async getAppointmentBillingSuggestion(options: any = {}) {
    const endpoint = endpointWithQuery('/api/appointments/billing-suggestion', {
      patientId: options.patientId,
      payerId: options.payerId,
      payerName: options.payerName,
      serviceType: options.serviceType,
      serviceCatalogId: options.serviceCatalogId,
      procedureCode: options.procedureCode,
      appointmentDate: options.appointmentDate,
      currentAppointmentId: options.currentAppointmentId || options.appointmentId
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getAppointmentBillingSuggestion',
        operation: 'detail',
        table: 'patient_payer_authorizations,patient_financial_plans,payer_tuss_mappings,tuss_service_catalog,tuss_codes',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      });
      return await safeJson(response);
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar autorizações disponíveis agora.' };
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
        table: 'appointment_billing_contexts,appointment_billing_items,patient_payer_authorizations,payer_requirement_audit_logs,appointment_closure_checks',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      const result = await safeJson(response);
      if (!result?.success) {
        return {
          ...result,
          status: response.status,
          error: result?.error || 'Não foi possível salvar o pagador da sessão agora.'
        };
      }
      return result;
    } catch {
      return { success: false, error: 'Não foi possível salvar o pagador da sessão agora.' };
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

  async getTissPreGuideTestOptions(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/pre-guides/test-options', {
      from: options.from,
      to: options.to,
      payerId: options.payerId,
      patientId: options.patientId,
      limit: normalizeListLimit(options.limit, 200, 500)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        signal: options.signal
      }, {
        helperName: 'getTissPreGuideTestOptions',
        operation: 'list',
        table: 'appointments,patients,appointment_billing_contexts,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'As sessões para teste de Pré-guia voltaram do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], patients: [], error: 'Não foi possível carregar as sessões para teste de Pré-guia agora.' };
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

  async getTissXmlDraft(draftId: string) {
    try {
      return await fetchNoStoreJsonWithRetry(`/api/tiss/xml-drafts/${encodeURIComponent(String(draftId))}`, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissXmlDraft',
        operation: 'detail',
        table: 'tiss_xml_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O rascunho XML TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o rascunho XML TISS agora.' };
    }
  },

  async validateTissXmlDraft(draftId: string) {
    try {
      const response = await fetchClinical(`/api/tiss/xml-drafts/${encodeURIComponent(String(draftId))}/validate`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'validateTissXmlDraft',
        operation: 'write',
        table: 'tiss_xml_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A validação do XML TISS em rascunho voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível validar o XML TISS em rascunho agora.' };
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

  async listTissOfficialDocuments(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/official-documents', {
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
        helperName: 'listTissOfficialDocuments',
        operation: 'list',
        table: 'tiss_official_documents',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A listagem de documentos TISS oficiais voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os documentos TISS oficiais agora.' };
    }
  },

  async createTissOfficialDocument(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/official-documents', {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'createTissOfficialDocument',
        operation: 'write',
        table: 'tiss_official_documents,appointment_tiss_pre_guides,tiss_revenue_cycle_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A geração do XML TISS oficial voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível gerar o XML TISS oficial agora.' };
    }
  },

  async getTissOfficialDocument(documentId: string) {
    try {
      return await fetchNoStoreJsonWithRetry(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}`, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissOfficialDocument',
        operation: 'detail',
        table: 'tiss_official_documents',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O documento TISS oficial voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o documento TISS oficial agora.' };
    }
  },

  async downloadTissOfficialDocument(documentId: string) {
    try {
      const response = await fetchClinical(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/download`, {
        method: 'GET',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'downloadTissOfficialDocument',
        operation: 'detail',
        table: 'tiss_official_documents',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      if (!response.ok) {
        return { success: false, error: 'Não foi possível baixar o XML TISS oficial agora.' };
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      return {
        success: true,
        blob,
        fileName: match?.[1] || 'verto-tiss-oficial.xml'
      };
    } catch {
      return { success: false, error: 'Não foi possível baixar o XML TISS oficial agora.' };
    }
  },

  async getTissOfficialDocumentTracking(documentId: string) {
    try {
      return await fetchNoStoreJsonWithRetry(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/tracking`, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissOfficialDocumentTracking',
        operation: 'detail',
        table: 'tiss_official_document_tracking,tiss_official_guide_tracking,tiss_official_tracking_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O acompanhamento do lote XML voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o acompanhamento do lote XML agora.' };
    }
  },

  async markTissOfficialDocumentSent(documentId: string, payload: any = {}) {
    try {
      const response = await fetchClinical(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/tracking/sent`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'markTissOfficialDocumentSent',
        operation: 'write',
        table: 'tiss_official_document_tracking,tiss_official_tracking_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'O registro de envio do lote XML voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível registrar o envio do lote XML agora.' };
    }
  },

  async registerTissOfficialDocumentReturn(documentId: string, payload: any = {}) {
    try {
      const response = await fetchClinical(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/tracking/return`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'registerTissOfficialDocumentReturn',
        operation: 'write',
        table: 'tiss_official_document_tracking,tiss_official_guide_tracking,tiss_official_tracking_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'O retorno do lote XML voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível registrar o retorno da operadora agora.' };
    }
  },

  async updateTissOfficialGuideTracking(documentId: string, guideId: string, payload: any = {}) {
    try {
      const response = await fetchClinical(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/guides/${encodeURIComponent(String(guideId))}/tracking`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'updateTissOfficialGuideTracking',
        operation: 'write',
        table: 'tiss_official_guide_tracking,tiss_official_document_tracking,tiss_official_tracking_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'O acompanhamento da guia voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível atualizar a guia do lote XML agora.' };
    }
  },

  async updateTissOfficialGuideAppeal(documentId: string, guideId: string, payload: any = {}) {
    try {
      const response = await fetchClinical(`/api/tiss/official-documents/${encodeURIComponent(String(documentId))}/guides/${encodeURIComponent(String(guideId))}/appeal`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'updateTissOfficialGuideAppeal',
        operation: 'write',
        table: 'tiss_official_guide_tracking,tiss_official_document_tracking,tiss_official_tracking_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'O recurso de glosa voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível registrar o recurso de glosa agora.' };
    }
  },

  async getTissRevenueCycleEvents(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/revenue-cycle/events', {
      preGuideId: options.preGuideId,
      appointmentId: options.appointmentId,
      xmlDraftId: options.xmlDraftId,
      payerId: options.payerId,
      limit: normalizeListLimit(options.limit, 40, 100)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissRevenueCycleEvents',
        operation: 'list',
        table: 'tiss_revenue_cycle_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O histórico do ciclo TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar o histórico do ciclo TISS agora.' };
    }
  },

  async getTissBillingBatchDrafts(options: any = {}) {
    const endpoint = endpointWithQuery('/api/tiss/billing-batch-drafts', {
      payerId: options.payerId,
      competenceMonth: options.competenceMonth,
      status: options.status,
      page: Math.max(1, Math.round(Number(options.page || 1) || 1)),
      pageSize: normalizeListLimit(options.pageSize || options.limit, 20, 100)
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissBillingBatchDrafts',
        operation: 'list',
        table: 'tiss_billing_batch_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'A listagem de lotes rascunho TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar os lotes rascunho TISS agora.' };
    }
  },

  async getTissBillingBatchDraft(batchId: string) {
    try {
      return await fetchNoStoreJsonWithRetry(`/api/tiss/billing-batch-drafts/${encodeURIComponent(String(batchId))}`, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getTissBillingBatchDraft',
        operation: 'detail',
        table: 'tiss_billing_batch_drafts',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'O lote rascunho TISS voltou do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: null, error: 'Não foi possível carregar o lote rascunho TISS agora.' };
    }
  },

  async createTissBillingBatchDraft(payload: any = {}) {
    try {
      const response = await fetchClinical('/api/tiss/billing-batch-drafts', {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      }, {
        helperName: 'createTissBillingBatchDraft',
        operation: 'write',
        table: 'tiss_billing_batch_drafts,appointment_tiss_pre_guides,tiss_revenue_cycle_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'A criação do lote rascunho TISS voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível criar o lote rascunho TISS agora.' };
    }
  },

  async cancelTissBillingBatchDraft(batchId: string) {
    try {
      const response = await fetchClinical(`/api/tiss/billing-batch-drafts/${encodeURIComponent(String(batchId))}/cancel`, {
        method: 'POST',
        cache: 'no-store',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'cancelTissBillingBatchDraft',
        operation: 'write',
        table: 'tiss_billing_batch_drafts,appointment_tiss_pre_guides,tiss_revenue_cycle_events',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return await safeNoStoreJson(response, 'O cancelamento do lote rascunho TISS voltou do cache. Tente novamente.');
    } catch {
      return { success: false, error: 'Não foi possível cancelar o lote rascunho TISS agora.' };
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

  async getPatientTissAuthorizations(patientId: string) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/tiss-authorizations`;
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPatientTissAuthorizations',
        operation: 'list',
        table: 'patient_payer_authorizations,payer_tuss_mappings,payer_procedure_prices',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      }, 'As autorizações TISS do paciente voltaram do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar as autorizações TISS do paciente.' };
    }
  },

  async getPatientTissAuthorizationsOverview(params: any = {}) {
    const endpoint = endpointWithQuery('/api/patients/tiss-authorizations', {
      patientId: params.patientId || params.patient_id || '',
      payerId: params.payerId || params.payer_id || '',
      limit: params.limit || 500
    });
    try {
      return await fetchNoStoreJsonWithRetry(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPatientTissAuthorizationsOverview',
        operation: 'list',
        table: 'patient_payer_authorizations,patients,clinic_payers,payer_tuss_mappings,payer_procedure_prices',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      }, 'As autorizações TISS dos pacientes voltaram do cache. Tente atualizar novamente.');
    } catch {
      return { success: false, data: [], error: 'Não foi possível carregar as autorizações TISS dos pacientes.' };
    }
  },

  async deletePatientTissAuthorization(patientId: string, authorizationId: string) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/tiss-authorizations/${encodeURIComponent(String(authorizationId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'deletePatientTissAuthorization',
        operation: 'write',
        table: 'patient_payer_authorizations,appointment_tiss_pre_guides',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível excluir a autorização TISS.' };
    }
  },

  async setPatientTissAuthorizationActive(patientId: string, authorizationId: string, active: boolean) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/tiss-authorizations/${encodeURIComponent(String(authorizationId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ active: active === true })
      }, {
        helperName: 'setPatientTissAuthorizationActive',
        operation: 'write',
        table: 'patient_payer_authorizations',
        hasExplicitColumns: true,
        requiresPatientOrSession: true
      });
      return await safeJson(response);
    } catch {
      return { success: false, error: 'Não foi possível atualizar a autorização TISS.' };
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

  async getPatientTherapeuticPlan(patientId: string, options: { force?: boolean } = {}) {
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-plan${options.force ? `?_reload=${Date.now()}` : ''}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, {
        helperName: 'getPatientTherapeuticPlan',
        operation: 'list',
        table: 'aba_programs,aba_targets,patient_therapeutic_objectives,aba_program_audit_events,aba_trials',
        hasExplicitColumns: true
      });
      return normalizeClinicalTextRecord(
        normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar o Plano terapêutico agora.'),
      );
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar o Plano terapêutico agora.');
      return { success: false, data: { programs: [], objectives: [], targets: [] }, error: message, message };
    }
  },

  async getTherapeuticProgramTemplates(options: { force?: boolean; includeArchived?: boolean } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const search = new URLSearchParams();
    if (options.force) search.set('_reload', String(Date.now()));
    if (options.includeArchived) search.set('includeArchived', 'true');
    const endpoint = `/api/aba/program-templates${search.toString() ? `?${search.toString()}` : ''}`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, {
        helperName: 'getTherapeuticProgramTemplates',
        operation: 'list',
        table: 'aba_program_templates',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalTextRecord(
        normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar a biblioteca de programas.'),
      );
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar a biblioteca de programas.');
      return { success: false, data: [], error: message, message };
    }
  },

  async createPatientTherapeuticPlanScope(patientId: string, payload: any = {}) {
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-plans`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createPatientTherapeuticPlanScope',
        operation: 'write',
        table: 'patient_therapeutic_plans,patient_professional_links',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível criar o escopo do Plano terapêutico.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível criar o escopo do Plano terapêutico.');
      return { success: false, error: message, message };
    }
  },

  async getPatientProfessionalLinks(patientId: string) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/professional-links`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'getPatientProfessionalLinks',
        operation: 'list',
        table: 'patient_professional_links,users',
        hasExplicitColumns: true
      });
      return normalizeClinicalTextRecord(await safeJson(response));
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar os profissionais vinculados.');
      return { success: false, links: [], error: message, message };
    }
  },

  async setPatientPrimaryProfessional(patientId: string, professionalId: string | null) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/primary-professional`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PUT',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ professionalId: professionalId || null })
      }, {
        helperName: 'setPatientPrimaryProfessional',
        operation: 'write',
        table: 'patient_professional_links,patients',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(
        await safeJson(response),
        'Não foi possível atualizar o profissional responsável.',
      );
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o profissional responsável.');
      return { success: false, error: message, message };
    }
  },

  async updatePatientTherapeuticPlanScope(patientId: string, planId: string, payload: any = {}) {
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-plans/${encodeURIComponent(String(planId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updatePatientTherapeuticPlanScope',
        operation: 'write',
        table: 'patient_therapeutic_plans,patient_therapeutic_plan_versions,patient_professional_links',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o escopo do Plano terapêutico.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o escopo do Plano terapêutico.');
      return { success: false, error: message, message };
    }
  },

  async createTherapeuticProgram(patientId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-programs`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'createTherapeuticProgram',
        operation: 'write',
        table: 'patient_therapeutic_objectives,aba_programs,aba_targets,aba_program_versions,aba_program_audit_events',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível criar o programa terapêutico.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível criar o programa terapêutico.');
      return { success: false, error: message, message };
    }
  },

  async updateTherapeuticProgramStatus(patientId: string, programId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-programs/${encodeURIComponent(String(programId))}/status`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateTherapeuticProgramStatus',
        operation: 'write',
        table: 'aba_programs,aba_program_versions,aba_program_audit_events',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o programa.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o programa.');
      return { success: false, error: message, message };
    }
  },

  async updateTherapeuticProgram(patientId: string, programId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-programs/${encodeURIComponent(String(programId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateTherapeuticProgram',
        operation: 'write',
        table: 'patient_therapeutic_objectives,aba_programs,aba_targets,aba_program_versions,aba_program_audit_events',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o programa terapêutico.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o programa terapêutico.');
      return { success: false, error: message, message };
    }
  },

  async addTherapeuticProgramTarget(patientId: string, programId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/patients/${encodeURIComponent(String(patientId))}/therapeutic-programs/${encodeURIComponent(String(programId))}/targets`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'addTherapeuticProgramTarget',
        operation: 'write',
        table: 'aba_targets,aba_programs,aba_program_versions,aba_program_audit_events',
        hasExplicitColumns: true
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível adicionar o alvo.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível adicionar o alvo.');
      return { success: false, error: message, message };
    }
  },

  async saveTherapeuticProgramTemplate(payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = '/api/aba/program-templates';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'saveTherapeuticProgramTemplate',
        operation: 'write',
        table: 'aba_program_templates,aba_programs,aba_targets',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível salvar o modelo.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível salvar o modelo.');
      return { success: false, error: message, message };
    }
  },

  async updateTherapeuticProgramTemplate(templateId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/program-templates/${encodeURIComponent(String(templateId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, {
        helperName: 'updateTherapeuticProgramTemplate',
        operation: 'write',
        table: 'aba_program_templates',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível atualizar o modelo.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível atualizar o modelo.');
      return { success: false, error: message, message };
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

  async getAbaSessionQuickCollectionPreferences() {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ locations: [], quickBehaviorShortcuts: [], preferencesFound: false });
    const endpoint = '/api/aba/session-quick-collection/preferences';
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, {
        helperName: 'getAbaSessionQuickCollectionPreferences',
        operation: 'detail',
        table: 'aba_session_locations,aba_user_session_preferences',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      const result = await safeJson(response);
      return response.ok ? result : normalizeClinicalMutationResult(result, 'Não foi possível carregar as preferências da coleta rápida.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar as preferências da coleta rápida.');
      return { success: false, error: message, message, data: { locations: [], quickBehaviorShortcuts: [], preferencesFound: false } };
    }
  },

  async createAbaSessionLocation(name: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = '/api/aba/session-locations';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name })
      }, {
        helperName: 'createAbaSessionLocation',
        operation: 'write',
        table: 'aba_session_locations',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível adicionar o local.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível adicionar o local.');
      return { success: false, error: message, message };
    }
  },

  async updateAbaSessionLocation(locationId: string, name: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/session-locations/${encodeURIComponent(String(locationId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name })
      }, {
        helperName: 'updateAbaSessionLocation',
        operation: 'write',
        table: 'aba_session_locations',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível renomear o local.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível renomear o local.');
      return { success: false, error: message, message };
    }
  },

  async removeAbaSessionLocation(locationId: string) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/session-locations/${encodeURIComponent(String(locationId))}`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include'
      }, {
        helperName: 'removeAbaSessionLocation',
        operation: 'write',
        table: 'aba_session_locations',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível remover o local.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível remover o local.');
      return { success: false, error: message, message };
    }
  },

  async saveAbaQuickBehaviorShortcuts(shortcuts: any[]) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = '/api/aba/session-quick-collection/preferences';
    try {
      const response = await fetchClinical(endpoint, {
        method: 'PUT',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quickBehaviorShortcuts: shortcuts })
      }, {
        helperName: 'saveAbaQuickBehaviorShortcuts',
        operation: 'write',
        table: 'aba_user_session_preferences',
        hasExplicitColumns: true,
        requiresPatientOrSession: false
      });
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível salvar os atalhos rápidos.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível salvar os atalhos rápidos.');
      return { success: false, error: message, message };
    }
  },

  async getAbaSessionMaintenanceProbes(sessionId: string, options: { appointmentId?: string | null; clinicalDate?: string | null; timeZone?: string | null; force?: boolean } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse({ available: [], upcoming: [] });
    if (!isPersistedUuid(sessionId)) return { success: true, data: { available: [], upcoming: [] }, available: [], upcoming: [] };
    const params = new URLSearchParams();
    if (options.appointmentId) params.set('appointmentId', String(options.appointmentId));
    if (options.clinicalDate) params.set('clinicalDate', String(options.clinicalDate));
    if (options.timeZone) params.set('timeZone', String(options.timeZone));
    if (options.force) params.set('_reload', String(Date.now()));
    const queryString = params.toString();
    const endpoint = `/api/aba/sessions/${encodeURIComponent(String(sessionId))}/maintenance-probes${queryString ? `?${queryString}` : ''}`;
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
      return invalidClinicalIdResponse('Escolha uma sessão real para vincular a sondagem.');
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
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível aguardar futura sessão agora.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível aguardar futura sessão agora.');
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

  async getNextSessionRecommendations(patientId: string, options: { sourceSessionId?: string; focusType?: string; limit?: number; before?: string; force?: boolean } = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse([]);
    const endpoint = endpointWithQuery(`/api/aba/patients/${encodeURIComponent(String(patientId))}/next-session/recommendations`, {
      sourceSessionId: options.sourceSessionId,
      focusType: options.focusType,
      limit: normalizeListLimit(options.limit, 20, 50),
      before: options.before,
      reload: options.force ? Date.now() : undefined,
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getNextSessionRecommendations', operation: 'list', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return normalizeClinicalTextRecord(await safeJson(response));
    } catch (error) {
      if (import.meta.env.DEV) console.log('Fetching ABA recommendations from local state only...');
      return { success: false, error: 'Não foi possível carregar as recomendações agora.' };
    }
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
      return normalizeClinicalTextRecord(await safeJson(response));
    } catch (error) {
      return { success: false, error: 'Não foi possível gerar sugestões agora.' };
    }
  },

  async acceptAbaRecommendation(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/accept`;
    try {
      const decision = abaDecisionPayload(`accept:${recommendationId}`, payload);
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decision.body)
      }, { helperName: 'acceptAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      const result = normalizeClinicalTextRecord(await safeJson(response));
      decision.complete(result);
      return result;
    } catch (error) {
      return { success: false, error: 'Não foi possível aceitar a sugestão agora.' };
    }
  },

  async rejectAbaRecommendation(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/reject`;
    try {
      const decision = abaDecisionPayload(`reject:${recommendationId}`, payload);
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decision.body)
      }, { helperName: 'rejectAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      const result = normalizeClinicalTextRecord(await safeJson(response));
      decision.complete(result);
      return result;
    } catch (error) {
      return { success: false, error: 'Não foi possível recusar a sugestão agora.' };
    }
  },

  async updateAbaRecommendation(recommendationId: string, patch: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}`;
    try {
      const decision = abaDecisionPayload(`edit:${recommendationId}`, patch);
      const response = await fetchClinical(endpoint, {
        method: 'PATCH',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decision.body)
      }, { helperName: 'updateAbaRecommendation', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      const result = normalizeClinicalTextRecord(await safeJson(response));
      decision.complete(result);
      return result;
    } catch (error) {
      return { success: false, error: 'Não foi possível editar a sugestão agora.' };
    }
  },

  async linkAbaRecommendationTarget(recommendationId: string, payload: { targetId: string }) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/link-target`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      }, { helperName: 'linkAbaRecommendationTarget', operation: 'write', table: 'aba_clinical_recommendations', hasExplicitColumns: true });
      return normalizeClinicalTextRecord(await safeJson(response));
    } catch (error) {
      return { success: false, error: 'Não foi possível vincular a habilidade de origem agora.' };
    }
  },

  async applyAbaRecommendationToNextSession(recommendationId: string, payload: any = {}) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/recommendations/${encodeURIComponent(String(recommendationId))}/apply-to-next-session`;
    try {
      const decision = abaDecisionPayload(`apply:${recommendationId}`, payload);
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(decision.body)
      }, { helperName: 'applyAbaRecommendationToNextSession', operation: 'write', table: 'aba_next_session_plan_items', hasExplicitColumns: true });
      const result = normalizeClinicalTextRecord(await safeJson(response));
      decision.complete(result);
      return result;
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

  async saveClinicalObservation(patientId: string, payload: any = {}) {
    const endpoint = `/api/patients/${encodeURIComponent(String(patientId))}/clinical-observations`;
    try {
      const response = await fetchClinical(endpoint, {
        method: 'POST',
        headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {}),
      }, {
        helperName: 'saveClinicalObservation',
        operation: 'write',
        table: 'clinical_observations,patient_therapeutic_plans,patient_professional_links',
        hasExplicitColumns: true,
      });
      const result = normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível registrar a evidência clínica.');
      if (result?.success !== false) notifyClinicalOutcomesChanged(patientId);
      return result;
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível registrar a evidência clínica.');
      return { success: false, error: message, message };
    }
  },

  async getClinicalOutcomesDashboard(patientId: string, options: any = {}) {
    const endpoint = endpointWithQuery(`/api/patients/${encodeURIComponent(String(patientId))}/clinical-outcomes-dashboard`, {
      days: options.days,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      planId: options.planId,
    });
    try {
      const response = await fetchClinical(endpoint, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      }, {
        helperName: 'getClinicalOutcomesDashboard',
        operation: 'list',
        table: 'patient_therapeutic_plans,read_clinical_outcomes_converged_v3,clinical_measure_definitions,clinical_observations,clinical_goal_contributions,clinical_plan_phases,aba_session_metric_snapshots',
        hasExplicitColumns: true,
      });
      return await safeJson(response);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Não foi possível carregar os gráficos clínicos agora.');
      return {
        success: false,
        data: { plans: [], programs: [], observations: [], contributions: [], phases: [], specialties: [], schemaAvailable: false },
        error: message,
        message,
      };
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
      specialty: options.specialty,
      professionalId: options.professionalId,
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
      specialty: options.specialty,
      professionalId: options.professionalId,
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
    if (!isAbaV2Enabled() && !isAbaV3UiEnabled()) return abaV2DisabledResponse(null);
    const endpoint = `/api/aba/session-reports/${encodeURIComponent(String(sessionId))}`;
    try {
      const auditEventId = crypto.randomUUID();
      const response = await fetchClinical(endpoint, {
        headers: {
          ...(await getNoStoreAuthHeaders(false)),
          'X-Audit-Event-Id': auditEventId
        },
        credentials: 'include',
        cache: 'no-store'
      }, { helperName: 'getSessionReport', operation: 'detail', table: 'aba_session_summaries', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar o relatório desta sessão.');
    } catch (error) {
      console.log('Fetching ABA session report from local state only...');
    }
    return { success: false, error: 'Não foi possível carregar o relatório desta sessão.', data: null };
  },

  async getSessionReportRecords(sessionId: string, limit = 120) {
    if (!isAbaV2Enabled() && !isAbaV3UiEnabled()) return abaV2DisabledResponse([]);
    if (!String(sessionId || '').trim() || String(sessionId).startsWith('draft-')) return { success: true, data: [] };
    const safeLimit = normalizeListLimit(limit, 120, 200);
    const endpoint = endpointWithLimit(`/api/aba/session-reports/${encodeURIComponent(String(sessionId))}/records`, safeLimit);
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getSessionReportRecords', operation: 'list', table: 'aba_trials,aba_behavior_events,aba_effective_trials_v3,aba_trial_steps_v3', hasExplicitColumns: true });
      if (response.ok) return await response.json();
      return normalizeClinicalMutationResult(await safeJson(response), 'Não foi possível carregar os registros desta sessão.');
    } catch (error) {
      console.log('Fetching ABA session report records from local state only...');
    }
    return { success: false, error: 'Não foi possível carregar os registros desta sessão.', data: [] };
  },

  async getPaginatedBehaviorEvents(patientId: string, page = 1, pageSize = 20) {
    return await this.getAbaBehaviorEvents(patientId, { page, pageSize });
  },

  async getAbaSessions(patientId: string, options: { limit?: number; page?: number; pageSize?: number } = {}) {
    if (!isAbaV2Enabled() && !isAbaV3UiEnabled()) return abaV2DisabledResponse([]);
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

  async getAbaPromptTypes() {
    if (!isAbaV2Enabled() && !isAbaV3UiEnabled()) return abaV2DisabledResponse(normalizeAbaPromptTypeConfig());
    const endpoint = '/api/aba/prompt-types';
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getAbaPromptTypes', operation: 'list', table: 'aba_prompt_types', hasExplicitColumns: true });
      if (response.ok) {
        const result = await response.json();
        return {
          ...result,
          data: normalizeAbaPromptTypeConfig(result?.data)
        };
      }
    } catch (error) {
      console.log('Fetching ABA prompt types from default configuration...');
    }
    return { success: true, data: normalizeAbaPromptTypeConfig() };
  },

  async saveAbaPromptType(promptType: any) {
    if (!isAbaV2Enabled() && !isAbaV3UiEnabled()) return abaV2DisabledResponse(promptType || {});
    const id = String(promptType?.id || promptType?.prompt_type_id || promptType?.promptTypeId || generateId());
    const data = {
      ...(promptType || {}),
      id,
      name: promptType?.name || promptType?.label,
      category: promptType?.category || 'Geral',
      independence_score: promptType?.independence_score ?? promptType?.independenceScore,
      independenceScore: promptType?.independence_score ?? promptType?.independenceScore,
      intrusiveness_order: promptType?.intrusiveness_order ?? promptType?.intrusivenessOrder,
      intrusivenessOrder: promptType?.intrusiveness_order ?? promptType?.intrusivenessOrder,
      counts_as_independent: Boolean(promptType?.counts_as_independent ?? promptType?.countsAsIndependent),
      countsAsIndependent: Boolean(promptType?.counts_as_independent ?? promptType?.countsAsIndependent),
      show_in_session: promptType?.show_in_session ?? promptType?.showInSession ?? true,
      showInSession: promptType?.show_in_session ?? promptType?.showInSession ?? true,
      active: promptType?.active ?? true,
      description: promptType?.description || ''
    };
    const hasPersistedId = Boolean(promptType?.id || promptType?.prompt_type_id || promptType?.promptTypeId);
    const endpoint = hasPersistedId ? `/api/aba/prompt-types/${encodeURIComponent(id)}` : '/api/aba/prompt-types';
    return await saveOfflineFirst(id, data, 'aba', endpoint, hasPersistedId ? 'PATCH' : 'POST');
  },

  async resolveAbaV3SessionTargetBinding(input: { patientId: string; sessionId: string; targetId: string }) {
    // Clinical routing is server-authoritative. Do not gate this resolver by the
    // browser build flag: a stale bundle must still honor a V3 session plan.
    const patientId = String(input?.patientId || '').trim();
    const sessionId = String(input?.sessionId || '').trim();
    const targetId = String(input?.targetId || '').trim();
    if (!patientId || !sessionId || !targetId) return { success: false, error: 'Escopo ABA V3 incompleto.' };
    const endpoint = `/api/aba/v3/sessions/${encodeURIComponent(sessionId)}/targets/${encodeURIComponent(targetId)}/resolve-binding`;
    try {
      const response = await fetchWithAuthRetry(endpoint, {
        method: 'POST',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ patient_id: patientId })
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível resolver a coleta ABA V3.' };
      }
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível resolver a coleta ABA V3.' };
    }
  },

  async saveAbaV3TrialAction(trial: any) {
    // The server collection feature + session binding authorize this write. The
    // VITE UI flag must never force an authoritative V3 trial back through V2.
    const clientEventId = String(trial?.client_event_id || trial?.clientEventId || trial?.id || generateId()).trim();
    const data = {
      patient_id: trial?.patient_id || trial?.patientId,
      session_id: trial?.session_id || trial?.sessionId,
      target_id: trial?.target_id || trial?.targetId,
      client_event_id: clientEventId,
      action_key: trial?.action_key || trial?.actionKey,
      prompt_type_id: trial?.prompt_type_id || trial?.promptTypeId || undefined,
      prompt_key: trial?.prompt_key || trial?.promptKey || undefined,
      trial_type: trial?.trial_type || trial?.trialType || trial?.collection_type || trial?.collectionType,
      occurred_at: trial?.occurred_at || trial?.occurredAt || trial?.timestamp || new Date().toISOString(),
      source_device_id: trial?.source_device_id || trial?.sourceDeviceId || undefined,
      maintenance_schedule_id: trial?.maintenance_schedule_id || trial?.maintenanceScheduleId || undefined,
      client_metadata: trial?.client_metadata || trial?.clientMetadata || {}
    };
    return await saveOfflineFirst(clientEventId, data, 'aba_v3', '/api/aba/v3/trials', 'POST');
  },

  async saveAbaV3TrialRevision(input: any) {
    const originalTrialId = String(input?.original_trial_id || input?.originalTrialId || '').trim();
    const originalClientEventId = String(input?.original_client_event_id || input?.originalClientEventId || '').trim();
    const clientRevisionEventId = String(input?.client_revision_event_id || input?.clientRevisionEventId || generateId()).trim();
    const replacementClientEventId = String(input?.replacement_client_event_id || input?.replacementClientEventId || generateId()).trim();
    const eventType = String(input?.event_type || input?.eventType || '').trim().toUpperCase();
    const data = {
      patient_id: input?.patient_id || input?.patientId,
      session_id: input?.session_id || input?.sessionId,
      original_trial_id: originalTrialId || undefined,
      original_client_event_id: originalClientEventId || undefined,
      event_type: eventType,
      client_revision_event_id: clientRevisionEventId,
      replacement_client_event_id: eventType === 'CORRECT' ? replacementClientEventId : undefined,
      reason: input?.reason,
      action_key: input?.action_key || input?.actionKey || undefined,
      prompt_type_id: input?.prompt_type_id || input?.promptTypeId || undefined,
      prompt_key: input?.prompt_key || input?.promptKey || undefined,
      client_metadata: input?.client_metadata || input?.clientMetadata || {}
    };
    const queueEntityId = originalTrialId || originalClientEventId || clientRevisionEventId;
    return await saveOfflineFirst(
      clientRevisionEventId,
      data,
      'aba_v3',
      '/api/aba/v3/trial-revisions',
      'POST',
      { queueEntityId }
    );
  },

  async discardAbaV3FailedTrial(clientEventId: string) {
    const safeClientEventId = String(clientEventId || '').trim();
    if (!safeClientEventId) return { success: false, error: 'Tentativa local não identificada.' };
    const discarded = await discardFailedOfflineEntityMutations('aba_v3', safeClientEventId);
    return { success: true, discarded };
  },

  async getAbaV3BehaviorCatalog(patientId: string) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.', data: [] };
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: false, error: 'Paciente não identificado.', data: [] };
    try {
      const response = await fetchWithAuthRetry(`/api/aba/v3/patients/${encodeURIComponent(safePatientId)}/behavior-catalog`, {
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível carregar os comportamentos ABA V3.', data: [] };
      return { ...result, success: true, data: Array.isArray(result?.data) ? result.data : [] };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar os comportamentos ABA V3.', data: [] };
    }
  },

  async resolveAbaV3BehaviorCollection(input: { patientId: string; sessionId: string; behaviorId: string }) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const patientId = String(input?.patientId || '').trim();
    const sessionId = String(input?.sessionId || '').trim();
    const behaviorId = String(input?.behaviorId || '').trim();
    if (!patientId || !sessionId || !behaviorId) return { success: false, error: 'Escopo do comportamento ABA V3 incompleto.' };
    const endpoint = `/api/aba/v3/sessions/${encodeURIComponent(sessionId)}/behaviors/${encodeURIComponent(behaviorId)}/resolve-collection`;
    try {
      const response = await fetchWithAuthRetry(endpoint, {
        method: 'POST',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ patient_id: patientId })
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível resolver o comportamento ABA V3.' };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível resolver o comportamento ABA V3.' };
    }
  },

  async saveAbaV3BehaviorAction(action: any) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const clientEventId = String(action?.client_event_id || action?.clientEventId || generateId()).trim();
    const data = {
      patient_id: action?.patient_id || action?.patientId,
      session_id: action?.session_id || action?.sessionId,
      behavior_id: action?.behavior_id || action?.behaviorId,
      action_type: action?.action_type || action?.actionType,
      client_event_id: clientEventId,
      episode_event_id: action?.episode_event_id || action?.episodeEventId || undefined,
      count_delta: action?.count_delta ?? action?.countDelta ?? 1,
      occurred_at: action?.occurred_at || action?.occurredAt || action?.timestamp || new Date().toISOString(),
      metadata: action?.metadata || action?.client_metadata || action?.clientMetadata || {}
    };
    const queueEntityId = String(action?.causal_entity_id || action?.causalEntityId || action?.episode_event_id || action?.episodeEventId || clientEventId).trim() || clientEventId;
    return await saveOfflineFirst(clientEventId, data, 'aba_v3', '/api/aba/v3/behavior-actions', 'POST', { queueEntityId });
  },

  async startAbaV3IntervalRun(input: any) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const data = {
      patient_id: input?.patient_id || input?.patientId,
      session_id: input?.session_id || input?.sessionId,
      behavior_id: input?.behavior_id || input?.behaviorId,
      client_run_event_id: input?.client_run_event_id || input?.clientRunEventId || generateId(),
      measurement_method: input?.measurement_method || input?.measurementMethod,
      interval_seconds: input?.interval_seconds ?? input?.intervalSeconds,
      planned_intervals: input?.planned_intervals ?? input?.plannedIntervals,
      started_at: input?.started_at || input?.startedAt || new Date().toISOString(),
      metadata: input?.metadata || {}
    };
    try {
      const response = await fetchWithAuthRetry('/api/aba/v3/interval-runs', {
        method: 'POST',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(data)
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível iniciar a coleta por intervalo V3.' };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'A coleta por intervalo V3 precisa de conexão para iniciar.' };
    }
  },

  async saveAbaV3IntervalObservation(input: any) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const runId = String(input?.interval_run_id || input?.intervalRunId || '').trim();
    const clientEventId = String(input?.client_event_id || input?.clientEventId || generateId()).trim();
    if (!runId) return { success: false, error: 'Coleta por intervalo V3 não identificada.' };
    const data = {
      patient_id: input?.patient_id || input?.patientId,
      session_id: input?.session_id || input?.sessionId,
      interval_index: input?.interval_index ?? input?.intervalIndex,
      observation_code: input?.observation_code || input?.observationCode,
      client_event_id: clientEventId,
      metadata: input?.metadata || {}
    };
    return await saveOfflineFirst(clientEventId, data, 'aba_v3', `/api/aba/v3/interval-runs/${encodeURIComponent(runId)}/observations`, 'POST', { queueEntityId: runId });
  },

  async finalizeAbaV3IntervalRun(input: any) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const runId = String(input?.interval_run_id || input?.intervalRunId || '').trim();
    const clientEventId = String(input?.client_event_id || input?.clientEventId || `interval-finalize-${runId}-${input?.close_reason || input?.closeReason || 'complete'}`).trim();
    if (!runId) return { success: false, error: 'Coleta por intervalo V3 não identificada.' };
    const data = {
      patient_id: input?.patient_id || input?.patientId,
      session_id: input?.session_id || input?.sessionId,
      ended_at: input?.ended_at || input?.endedAt || new Date().toISOString(),
      close_reason: input?.close_reason || input?.closeReason || 'CLIENT_COMPLETE',
      client_event_id: clientEventId
    };
    return await saveOfflineFirst(clientEventId, data, 'aba_v3', `/api/aba/v3/interval-runs/${encodeURIComponent(runId)}/finalize`, 'POST', { queueEntityId: runId });
  },

  async getAbaV3TaskAnalysisDefinition(input: { patientId: string; sessionId: string; targetId: string }) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const patientId = String(input?.patientId || '').trim();
    const sessionId = String(input?.sessionId || '').trim();
    const targetId = String(input?.targetId || '').trim();
    if (!patientId || !sessionId || !targetId) return { success: false, error: 'Escopo da análise de tarefa ABA V3 incompleto.' };
    const endpoint = `/api/aba/v3/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(sessionId)}/targets/${encodeURIComponent(targetId)}/task-analysis-definition`;
    try {
      const response = await fetchWithAuthRetry(endpoint, { method: 'GET', headers: await getNoStoreAuthHeaders(), credentials: 'include' });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível carregar a análise de tarefa V3.' };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar a análise de tarefa V3.' };
    }
  },

  async saveAbaV3TaskAnalysisRun(input: any) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.' };
    const clientEventId = String(input?.client_event_id || input?.clientEventId || generateId()).trim();
    const data = {
      patient_id: input?.patient_id || input?.patientId,
      session_id: input?.session_id || input?.sessionId,
      target_id: input?.target_id || input?.targetId,
      client_event_id: clientEventId,
      occurred_at: input?.occurred_at || input?.occurredAt || new Date().toISOString(),
      completed_at: input?.completed_at || input?.completedAt || new Date().toISOString(),
      lifecycle_status: input?.lifecycle_status || input?.lifecycleStatus || 'COMPLETE',
      results: Array.isArray(input?.results) ? input.results : [],
      metadata: input?.metadata || {}
    };
    return await saveOfflineFirst(clientEventId, data, 'aba_v3', '/api/aba/v3/task-analysis-runs', 'POST');
  },

  async getAbaV3SessionCollectionPlan(input: { patientId: string; sessionId: string; targetIds?: string[] }) {
    // Probe the authoritative server plan even when the current browser bundle
    // has the optional V3 presentation flag disabled. This is one read per
    // active session and prevents stale clients from attempting Legacy writes.
    const patientId = String(input?.patientId || '').trim();
    const sessionId = String(input?.sessionId || '').trim();
    const targetIds = Array.from(new Set((Array.isArray(input?.targetIds) ? input.targetIds : []).map((value) => String(value || '').trim()).filter(Boolean))).slice(0, 200);
    if (!patientId || !sessionId) return { success: false, error: 'Escopo do plano de coleta ABA V3 incompleto.', data: { targets: [], v3_behavior_ids: [], complete: false } };
    try {
      const response = await fetchWithAuthRetry(`/api/aba/v3/sessions/${encodeURIComponent(sessionId)}/collection-plan`, {
        method: 'POST',
        headers: { ...(await getNoStoreAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patient_id: patientId, target_ids: targetIds })
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível carregar o plano de coleta ABA V3.', data: { targets: [], v3_behavior_ids: [], complete: false } };
      }
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar o plano de coleta ABA V3.', data: { targets: [], v3_behavior_ids: [], complete: false } };
    }
  },

  async saveClinicalPlanMeasurementV3(patientId: string, payload: any = {}) {
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: false, error: 'Paciente não identificado.', data: null };
    try {
      const response = await fetchWithAuthRetry(`/api/clinical-measurement-v3/patients/${encodeURIComponent(safePatientId)}/plan-measurements`, {
        method: 'POST',
        headers: { ...(await getNoStoreAuthHeaders()), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return { success: false, status: response.status, code: result?.error, error: result?.message || result?.error || 'Não foi possível registrar a medição clínica V3.', data: null };
      }
      const successResult = { ...result, success: true };
      notifyClinicalOutcomesChanged(safePatientId);
      return successResult;
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível registrar a medição clínica V3.', data: null };
    }
  },

  async getClinicalPlanOutcomesV3(patientId: string, options: { days?: number; planId?: string } = {}) {
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: false, error: 'Paciente não identificado.', data: { rows: [] } };
    const endpoint = endpointWithQuery(`/api/clinical-measurement-v3/patients/${encodeURIComponent(safePatientId)}/plan-outcomes`, {
      days: Math.max(7, Math.min(Number(options.days || 90), 730)),
      planId: String(options.planId || '').trim() || undefined,
    });
    try {
      const response = await fetchClinical(endpoint, {
        method: 'GET',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include',
      }, {
        helperName: 'getClinicalPlanOutcomesV3',
        operation: 'list',
        table: 'read_clinical_outcomes_converged_v3',
        hasExplicitColumns: true,
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        return {
          success: false,
          status: response.status,
          code: result?.error,
          error: result?.message || result?.error || 'Não foi possível carregar as séries clínicas V3.',
          data: { rows: [] },
        };
      }
      return { ...result, success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Não foi possível carregar as séries clínicas V3.',
        data: { rows: [] },
      };
    }
  },


  async getClinicalMeasurementV3Catalog(patientId: string) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'Clinical Measurement V3 UI desabilitada.', data: { targets: [] } };
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: false, error: 'Paciente não identificado.', data: { targets: [] } };
    try {
      const response = await fetchWithAuthRetry(`/api/clinical-measurement-v3/patients/${encodeURIComponent(safePatientId)}/catalog`, {
        method: 'GET',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, error: result?.error || 'Não foi possível carregar as métricas clínicas V3.', data: { targets: [] } };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar as métricas clínicas V3.', data: { targets: [] } };
    }
  },

  async getClinicalMeasurementV3View(patientId: string, targetId: string, options: { definitionId?: string; days?: number } = {}) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'Clinical Measurement V3 UI desabilitada.', data: null };
    const safePatientId = String(patientId || '').trim();
    const safeTargetId = String(targetId || '').trim();
    const definitionId = String(options.definitionId || '').trim();
    if (!safePatientId || !safeTargetId) return { success: false, error: 'Escopo clínico V3 incompleto.', data: null };
    const days = Math.max(1, Math.min(Number(options.days || 90), 366));
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - (days - 1) * 86400000);
    const endpoint = endpointWithQuery(`/api/clinical-measurement-v3/patients/${encodeURIComponent(safePatientId)}/targets/${encodeURIComponent(safeTargetId)}/view`, {
      definitionId: definitionId || undefined,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    });
    try {
      const response = await fetchWithAuthRetry(endpoint, {
        method: 'GET',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.error, error: result?.error || 'Não foi possível carregar a visão clínica V3.', data: null };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar a visão clínica V3.', data: null };
    }
  },

  async getAbaV3ChartCatalog(patientId: string) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.', data: { targets: [] } };
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: false, error: 'Paciente ABA V3 não identificado.', data: { targets: [] } };
    try {
      const response = await fetchWithAuthRetry(`/api/aba/v3/patients/${encodeURIComponent(safePatientId)}/chart-catalog?days=366`, {
        method: 'GET',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível carregar o catálogo de gráficos ABA V3.', data: { targets: [] } };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar o catálogo de gráficos ABA V3.', data: { targets: [] } };
    }
  },

  async getAbaV3TargetChartSeries(patientId: string, targetId: string, options: { days?: number; limit?: number } = {}) {
    if (!isAbaV3UiEnabled()) return { success: false, code: 'feature_disabled', error: 'ABA V3 UI desabilitada.', data: { segments: [], available_metrics: [] } };
    const safePatientId = String(patientId || '').trim();
    const safeTargetId = String(targetId || '').trim();
    if (!safePatientId || !safeTargetId) return { success: false, error: 'Alvo ABA V3 não identificado.', data: { segments: [], available_metrics: [] } };
    const endpoint = endpointWithQuery(`/api/aba/v3/patients/${encodeURIComponent(safePatientId)}/targets/${encodeURIComponent(safeTargetId)}/chart-series`, {
      days: Math.max(1, Math.min(Number(options.days || 90), 366)),
      limit: Math.max(1, Math.min(Number(options.limit || 90), 180))
    });
    try {
      const response = await fetchWithAuthRetry(endpoint, {
        method: 'GET',
        headers: await getNoStoreAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) return { success: false, status: response.status, code: result?.code, error: result?.error || 'Não foi possível carregar os gráficos ABA V3.', data: { segments: [], available_metrics: [] } };
      return { ...result, success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Não foi possível carregar os gráficos ABA V3.', data: { segments: [], available_metrics: [] } };
    }
  },

  async saveAbaTrial(trial: any) {
    if (!isAbaV2Enabled()) return abaV2DisabledResponse(trial || {});
    const id = String(trial?.id || trial?.trial_id || trial?.trialId || generateId());
    const abaPromptInfo = resolveTrialPromptInfo(trial);
    const promptSnapshot = buildAbaPromptSnapshot(trial);
    const abaPromptLevel = resolveAbaPromptLevel({
      promptLevelKey: trial?.prompt_level_key || trial?.promptLevelKey,
      promptLevelName: trial?.prompt_level_name || trial?.promptLevelName,
      score: trial?.response_score ?? trial?.responseScore ?? trial?.score,
      maxScore: trial?.max_score ?? trial?.maxScore,
      correct: trial?.correct,
      independent: trial?.independent
    });
    const legacyPromptAudit = {
      prompt_level_key: abaPromptLevel.key,
      prompt_level_name: abaPromptLevel.label
    };
    const data = {
      ...(trial || {}),
      ...buildAbaIntegrityFields(trial),
      legacyPromptAudit,
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
      promptLevel: abaPromptInfo.key || abaPromptLevel.key,
      prompt_level_key: abaPromptInfo.key || abaPromptLevel.key,
      promptLevelKey: abaPromptInfo.key || abaPromptLevel.key,
      prompt_level_name: abaPromptInfo.label || abaPromptLevel.label,
      promptLevelName: abaPromptInfo.label || abaPromptLevel.label,
      ...promptSnapshot,
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
    const promptInfo = resolveTrialPromptInfo(result);
    const promptSnapshot = buildAbaPromptSnapshot(result);
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
      prompt_type: result?.prompt_type || result?.promptType || promptInfo.key,
      promptType: result?.prompt_type || result?.promptType || promptInfo.key,
      ...promptSnapshot,
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

  async getPatientMasteryGrowth(patientId: string, options: { portal?: boolean } = {}) {
    const safePatientId = String(patientId || '').trim();
    if (!safePatientId) return { success: true, data: [] };
    const endpoint = options.portal
      ? `/api/portal/patients/${encodeURIComponent(safePatientId)}/mastery-growth`
      : `/api/aba/patients/${encodeURIComponent(safePatientId)}/mastery-growth`;
    try {
      const response = await fetchClinical(endpoint, {
        headers: await buildConditionalHeaders(endpoint, 'aba'),
        credentials: 'include'
      }, { helperName: 'getPatientMasteryGrowth', operation: 'list', table: 'aba_mastery_evaluations', hasExplicitColumns: true });
      const result = await response.json().catch(() => ({ success: false, data: [] }));
      if (!response.ok || result?.success === false) {
        return { success: false, data: [], error: result?.error || `HTTP ${response.status}` };
      }
      return { success: true, data: Array.isArray(result?.data) ? result.data : [] };
    } catch (error: any) {
      return { success: false, data: [], error: error?.message || 'Não foi possível carregar o crescimento de maestria.' };
    }
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
    return await saveOfflineFirst(historyId, updates || {}, 'history', `/api/history/${historyId}`, 'PATCH');
  },

  async deleteHistoryItem(historyId: string) {
    return await saveOfflineFirst(historyId, { id: historyId }, 'history', `/api/history/${historyId}`, 'DELETE');
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
    return await saveOfflineFirst(taskId, updates || {}, 'task', `/api/tasks/${taskId}`, 'PATCH');
  },

  async deleteTask(taskId: string) {
    return await saveOfflineFirst(taskId, { id: taskId }, 'task', `/api/tasks/${taskId}`, 'DELETE');
  },

  async getAssignedTasks(patientId: string) {
    const safePatientId = String(patientId || '').trim();
    const readLocalAssignedTasks = async () =>
      (await getRecordsByType('assigned_task'))
        .map((record) => record?.data || {})
        .filter((row: any) => String(row?.patient_id || row?.patientId || '') === safePatientId);
    try {
      const response = await fetch(endpointWithLimit(`/api/assigned-tasks/${safePatientId}`, 20), {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      const localRows = await readLocalAssignedTasks();
      if (!response.ok || result?.success === false) {
        return localRows.length > 0
          ? { success: true, data: localRows, offline: true, pending: true }
          : result;
      }
      const remoteRows = ensureArray(result?.data);
      await Promise.all(remoteRows.map((row: any) => {
        const rowId = String(row?.id || '').trim();
        if (!rowId) return Promise.resolve(false);
        return saveEncryptedRecord({
          id: rowId,
          entity_id: rowId,
          data: row,
          type: 'assigned_task',
          sync_status: 'synced',
          last_updated: row?.updated_at ? new Date(row.updated_at).getTime() || Date.now() : Date.now(),
          method: 'POST',
          endpoint: '/api/assigned-tasks'
        });
      }));
      const merged = new Map<string, any>();
      for (const row of remoteRows) {
        const rowId = String(row?.id || '').trim();
        if (rowId) merged.set(rowId, row);
      }
      for (const row of await readLocalAssignedTasks()) {
        const rowId = String(row?.id || '').trim();
        if (rowId) merged.set(rowId, { ...(merged.get(rowId) || {}), ...row });
      }
      return { ...result, data: Array.from(merged.values()) };
    } catch (error) {
      console.error('Error fetching assigned tasks:', error);
      const localRows = await readLocalAssignedTasks();
      return localRows.length > 0
        ? { success: true, data: localRows, offline: true, pending: true }
        : { success: false, error: String(error), data: [] };
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
    const id = String(payload?.id || generateId()).trim();
    return await saveOfflineFirst(
      id,
      { ...(payload || {}), id },
      'assigned_task',
      '/api/assigned-tasks',
      'POST'
    );
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

  async getPatientFinanceLedger(month?: string) {
    try {
      const endpoint = endpointWithQuery('/api/patient-finance/ledger', { month });
      const response = await fetchWithAuthRetry(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient finance ledger:', error);
      return { success: false, data: null, error: 'Não foi possível carregar o financeiro de pacientes agora.' };
    }
  },

  async getPatientFinanceTransactionDocument(transactionId: string, kind: 'proof' | 'receipt') {
    try {
      const endpoint = endpointWithQuery(
        `/api/patient-finance/transactions/${encodeURIComponent(String(transactionId))}/document`,
        { kind }
      );
      const response = await fetchWithAuthRetry(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching patient finance document:', error);
      return { success: false, data: null, error: 'Não foi possível abrir o documento financeiro agora.' };
    }
  },

  async getPrivatePricingCatalog(patientId?: string) {
    try {
      const endpoint = endpointWithQuery('/api/private-pricing/catalog', {
        patientId: patientId || undefined
      });
      const response = await fetchWithAuthRetry(endpoint, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching private pricing catalog:', error);
      return { success: false, data: null, error: 'Não foi possível carregar a configuração de preços particulares agora.' };
    }
  },

  async resolvePrivateSessionPrice(payload: any) {
    try {
      const response = await fetchWithAuthRetry('/api/private-pricing/resolve', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error resolving private session price:', error);
      return { success: false, data: null, error: 'Não foi possível calcular o valor particular agora.' };
    }
  },

  async savePrivateSessionPriceRule(payload: any) {
    try {
      const idempotencyKey = String(payload?.idempotencyKey || generateId());
      const response = await fetchWithAuthRetry('/api/private-pricing/rules', {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'X-Idempotency-Key': idempotencyKey
        },
        credentials: 'include',
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving private session price rule:', error);
      return { success: false, error: 'Não foi possível salvar a regra de preço agora.' };
    }
  },

  async savePatientPrivatePricingAgreement(patientId: string, payload: any) {
    try {
      const idempotencyKey = String(payload?.idempotencyKey || generateId());
      const response = await fetchWithAuthRetry(
        `/api/private-pricing/patients/${encodeURIComponent(String(patientId))}/agreements`,
        {
          method: 'POST',
          headers: {
            ...(await getAuthHeaders()),
            'X-Idempotency-Key': idempotencyKey
          },
          credentials: 'include',
          body: JSON.stringify({ ...payload, idempotencyKey })
        }
      );
      return await safeJson(response);
    } catch (error) {
      console.error('Error saving patient private pricing agreement:', error);
      return { success: false, error: 'Não foi possível salvar o acordo particular agora.' };
    }
  },

  async getPrivateAppointmentFinancialSnapshot(appointmentId: string) {
    try {
      const response = await fetchWithAuthRetry(
        `/api/private-pricing/appointments/${encodeURIComponent(String(appointmentId))}/snapshot`,
        {
          headers: await getAuthHeaders(),
          credentials: 'include'
        }
      );
      return await safeJson(response);
    } catch (error) {
      console.error('Error fetching private appointment financial snapshot:', error);
      return {
        success: false,
        data: null,
        error: 'Não foi possível carregar a política financeira congelada desta sessão agora.'
      };
    }
  },

  async createPatientFinancialCharge(payload: any) {
    try {
      const idempotencyKey = String(payload?.idempotencyKey || generateId());
      const response = await fetchWithAuthRetry('/api/patient-finance/charges', {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'X-Idempotency-Key': idempotencyKey
        },
        credentials: 'include',
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error creating patient financial charge:', error);
      return { success: false, error: 'Não foi possível criar a cobrança agora.' };
    }
  },

  async applyPatientFinancialOperation(paymentId: string, payload: any) {
    try {
      const idempotencyKey = String(payload?.idempotencyKey || generateId());
      const response = await fetchWithAuthRetry(`/api/patient-finance/charges/${encodeURIComponent(String(paymentId))}/operations`, {
        method: 'POST',
        headers: {
          ...(await getAuthHeaders()),
          'X-Idempotency-Key': idempotencyKey
        },
        credentials: 'include',
        body: JSON.stringify({ ...payload, idempotencyKey })
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error applying patient financial operation:', error);
      return { success: false, error: 'Não foi possível concluir a operação financeira agora.' };
    }
  },

  async sendPatientFinancialReminder(paymentId: string) {
    try {
      const response = await fetchWithAuthRetry(`/api/patient-finance/charges/${encodeURIComponent(String(paymentId))}/reminder`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({})
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error sending patient financial reminder:', error);
      return { success: false, error: 'Não foi possível enviar o lembrete financeiro agora.' };
    }
  },

  async updatePatientFinancePolicy(payload: any) {
    try {
      const response = await fetchWithAuthRetry('/api/patient-finance/policy', {
        method: 'PUT',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error updating patient finance policy:', error);
      return { success: false, error: 'Não foi possível salvar a política financeira agora.' };
    }
  },

  async savePayment(payment: any) {
    const id = generateId();
    return await saveOfflineFirst(id, payment, 'payment', '/api/payments');
  },

  async savePaymentsBatch(payments: any[]) {
    const items = (Array.isArray(payments) ? payments : []).map((payment) => ({
      ...(payment || {}),
      id: String(payment?.id || generateId())
    }));
    const seriesId = String(items[0]?.recurrence_group_id || items[0]?.recurrenceGroupId || generateId());
    const result = await saveOfflineFirst(
      `payment-series:${seriesId}`,
      { items, requestedAt: new Date().toISOString() },
      'payment',
      '/api/payments/batch',
      'POST'
    );
    const persistedItems = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.data?.items)
        ? result.data.items
        : items;
    return { ...result, data: persistedItems };
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

  async updatePaymentsBatch(paymentIds: string[], updates: any) {
    const ids = Array.from(new Set((Array.isArray(paymentIds) ? paymentIds : []).map((id) => String(id || '').trim()).filter(Boolean)));
    const seriesId = String(updates?.recurrence_group_id || updates?.recurrenceGroupId || ids[0] || generateId());
    return await saveOfflineFirst(
      `payment-series-update:${seriesId}`,
      { ids, updates: updates || {}, requestedAt: new Date().toISOString() },
      'payment',
      '/api/payments/batch',
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

  async saveProfessionalPaymentsBatch(payments: any[]) {
    const items = (Array.isArray(payments) ? payments : []).map((payment) => ({
      ...(payment || {}),
      id: String(payment?.id || generateId())
    }));
    const seriesId = String(items[0]?.recurrence_group_id || items[0]?.recurrenceGroupId || generateId());
    const result = await saveOfflineFirst(
      `professional-payment-series:${seriesId}`,
      { items, requestedAt: new Date().toISOString() },
      'payment',
      '/api/financial/professional-payments/batch',
      'POST'
    );
    const persistedItems = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.data?.items)
        ? result.data.items
        : items;
    return { ...result, data: persistedItems };
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

  async updateProfessionalPaymentsBatch(paymentIds: string[], updates: any) {
    const ids = Array.from(new Set((Array.isArray(paymentIds) ? paymentIds : []).map((id) => String(id || '').trim()).filter(Boolean)));
    const seriesId = String(updates?.recurrence_group_id || updates?.recurrenceGroupId || ids[0] || generateId());
    return await saveOfflineFirst(
      `professional-payment-series-update:${seriesId}`,
      { ids, updates: updates || {}, requestedAt: new Date().toISOString() },
      'payment',
      '/api/financial/professional-payments/batch',
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
    const result = await saveOfflineFirst(`profile:${userId}`, data, 'profile', endpoint, 'POST');
    return result?.pending === true ? { ...result, queued: true } : result;
  },

  async getOnboardingContext() {
    try {
      const response = await fetch('/api/onboarding/context', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (response.ok) return result;
      return {
        ...result,
        success: false,
        error: result?.error || result?.message || 'Não foi possível carregar o vínculo com a clínica.'
      };
    } catch (error: any) {
      console.error('Error fetching onboarding context:', error);
      return { success: false, error: 'Não foi possível carregar o vínculo com a clínica.' };
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
    patientId?: string;
    name?: string;
    portalDisplayName?: string;
    address?: string;
    profilePicture?: string | null;
    profilePicturePath?: string | null;
  }) {
    const endpoint = '/api/patient/self/profile';
    const result = await saveOfflineFirst('profile:self', profile || {}, 'profile', endpoint, 'PATCH');
    return result?.pending === true ? { ...result, queued: true } : result;
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
    return await saveOfflineFirst(
      String(taskId),
      payload || {},
      'assigned_task',
      `/api/assigned-tasks/${encodeURIComponent(String(taskId))}`,
      'PATCH'
    );
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

  async getClinicMemberAuthorization(memberId: string) {
    try {
      const response = await fetch(`/api/clinic/members/${encodeURIComponent(String(memberId))}/authorization`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error: result?.message || result?.error || 'Não foi possível carregar as permissões deste membro.'
        };
      }
      return result;
    } catch (error) {
      console.error('Error fetching clinic member authorization:', error);
      return { success: false, error: 'Não foi possível carregar as permissões deste membro.' };
    }
  },

  async updateClinicMemberPermissionOverride(
    memberId: string,
    permissionKey: string,
    effect: 'allow' | 'deny' | null,
    reason?: string,
  ) {
    try {
      const response = await fetch(`/api/clinic/members/${encodeURIComponent(String(memberId))}/authorization`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ permissionKey, effect, reason: reason || undefined })
      });
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error: result?.message || result?.error || 'Não foi possível atualizar esta permissão.'
        };
      }
      return result;
    } catch (error) {
      console.error('Error updating clinic member permission override:', error);
      return { success: false, error: 'Não foi possível atualizar esta permissão.' };
    }
  },

  async getClinicCapabilityMembers(permissionKey: string) {
    try {
      const response = await fetch(`/api/clinic/authorization/capabilities/${encodeURIComponent(String(permissionKey))}/members`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error: result?.message || result?.error || 'Não foi possível carregar os profissionais para este acesso.'
        };
      }
      return result;
    } catch (error) {
      console.error('Error fetching clinic capability members:', error);
      return { success: false, error: 'Não foi possível carregar os profissionais para este acesso.' };
    }
  },

  async updateClinicCapabilityMembers(
    permissionKey: string,
    memberIds: string[],
    effect: 'allow' | 'deny' | null,
    reason?: string,
  ) {
    try {
      const response = await fetch(`/api/clinic/authorization/capabilities/${encodeURIComponent(String(permissionKey))}/members`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ memberIds, effect, reason: reason || undefined })
      });
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error: result?.message || result?.error || 'Não foi possível atualizar os acessos selecionados.'
        };
      }
      return result;
    } catch (error) {
      console.error('Error updating clinic capability members:', error);
      return { success: false, error: 'Não foi possível atualizar os acessos selecionados.' };
    }
  },

  async getMemberWorkSchedule(memberId: string) {
    try {
      const response = await fetch(`/api/clinic/members/${encodeURIComponent(String(memberId))}/work-schedule`, {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      const result = await safeJson(response);
      return response.ok ? result : { success: false, error: result?.error || 'Não foi possível carregar horários de trabalho.' };
    } catch (error) {
      console.error('Error fetching member work schedule:', error);
      return { success: false, error: String(error) };
    }
  },

  async updateMemberWorkSchedule(memberId: string, workSchedule: any) {
    try {
      const response = await fetch(`/api/clinic/members/${encodeURIComponent(String(memberId))}/work-schedule`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ workSchedule })
      });
      const result = await safeJson(response);
      return response.ok ? result : { success: false, error: result?.error || 'Não foi possível salvar horários de trabalho.' };
    } catch (error) {
      console.error('Error updating member work schedule:', error);
      return { success: false, error: String(error) };
    }
  },

  async applyMemberWorkSchedule(memberId: string, payload: {
    workSchedule: any;
    targetMode?: string;
    targetMemberIds?: string[];
    preserveExceptions?: boolean;
  }) {
    try {
      const response = await fetch(`/api/clinic/members/${encodeURIComponent(String(memberId))}/work-schedule/apply`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const result = await safeJson(response);
      return response.ok ? result : { success: false, error: result?.error || 'Não foi possível aplicar escala em massa.' };
    } catch (error) {
      console.error('Error applying member work schedule:', error);
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
      const payload = await safeJson(response);
      if (response.ok) {
        return payload;
      }
      return {
        ...payload,
        success: false,
        error: payload.error || payload.message || 'Falha ao enviar convite'
      };
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

  async updateMemberRole(memberId: string, role: string, metadata?: Record<string, any>) {
    try {
      const response = await fetch(`/api/clinic/members/${memberId}/role`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ role, ...(metadata || {}) })
      });
      if (response.ok) {
        return await response.json();
      }
      const err = await response.json();
      return { success: false, error: err.message || err.error || 'Falha ao atualizar acesso' };
    } catch (error) {
      console.error('Error updating member role:', error);
      return { success: false, error: String(error) };
    }
  },

  async updateMemberSupervisionEligibility(memberId: string, canSupervise: boolean) {
    try {
      const response = await fetch(
        `/api/clinic/members/${encodeURIComponent(String(memberId))}/supervision-eligibility`,
        {
          method: 'PATCH',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ canSupervise: canSupervise === true }),
        },
      );
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          ...result,
          success: false,
          error: result?.message || result?.error || 'Não foi possível atualizar a supervisão.',
        };
      }
      return result;
    } catch (error) {
      console.error('Error updating member supervision eligibility:', error);
      return { success: false, error: 'Não foi possível atualizar a supervisão.' };
    }
  },

  async updateMemberSpecialty(memberId: string, specialty: string) {
    try {
      const response = await fetch(
        `/api/clinic/members/${encodeURIComponent(String(memberId))}/specialty`,
        {
          method: 'PATCH',
          headers: await getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ specialty }),
        },
      );
      const result = await safeJson(response);
      if (!response.ok) {
        return {
          success: false,
          error:
            result?.message ||
            result?.error ||
            'Não foi possível atualizar a especialidade clínica.',
        };
      }
      return result;
    } catch (error) {
      console.error('Error updating member specialty:', error);
      return {
        success: false,
        error: 'Não foi possível atualizar a especialidade clínica.',
      };
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
      return {
        success: false,
        error: err.error || 'Failed to accept invitation',
        message: err.message || null,
      };
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

  async selectAccessContext(accessContextId: string, fallbackClinicId?: string) {
    const safeAccessContextId = String(accessContextId || '').trim();
    if (!safeAccessContextId) {
      return { success: false, error: 'Selecione um ambiente válido.' };
    }

    try {
      const response = await fetch('/api/access-contexts/select', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ accessContextId: safeAccessContextId })
      });
      const result = await safeJson(response);
      if (response.ok) return result;

      // Compatibilidade temporária com servidores que ainda expõem somente
      // seleção de workspace. Nunca aplicar esse fallback a portal de paciente.
      const safeFallbackClinicId = String(fallbackClinicId || '').trim();
      if ([404, 405].includes(response.status) && safeFallbackClinicId) {
        return await dataService.selectWorkspace(safeFallbackClinicId);
      }
      return {
        success: false,
        error: result?.message || 'Não foi possível acessar este ambiente.',
        code: result?.code || result?.error || null,
      };
    } catch (error) {
      console.error('Error selecting access context:', error);
      return { success: false, error: 'Não foi possível acessar este ambiente.' };
    }
  },

  async getClinicAuthorizationContext() {
    try {
      const response = await fetch('/api/clinic/authorization/me', {
        headers: await getAuthHeaders(),
        credentials: 'include'
      });
      return await safeJson(response);
    } catch (error) {
      console.error('Error loading clinic authorization context:', error);
      return { success: false, error: normalizeApiErrorMessage(error) };
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
    const workspaceKey = String(workspaceId || 'active').trim() || 'active';
    const entityId = `clinic-state:${workspaceKey}`;
    const buildFromLocal = async (error?: unknown) => {
      const localRecord = await getRecordById(entityId);
      const localState = localRecord?.data || {};
      const backupProtocols = readClinicProtocolsBackup(workspaceId);
      return {
        success: Boolean(localRecord),
        offline: true,
        pending: Boolean(localRecord && localRecord.sync_status !== 'synced'),
        error: localRecord ? undefined : String(error || 'Estado da clínica indisponível.'),
        data: {
          clinicId: localState?.clinicId || localState?.clinic_id || workspaceId || null,
          rooms: ensureArray(localState?.rooms),
          appointments: ensureArray(localState?.appointments),
          protocols: Array.isArray(localState?.protocols) ? normalizeProtocolList(localState.protocols) : backupProtocols,
          specialtySettings:
            localState?.specialtySettings && typeof localState.specialtySettings === 'object'
              ? localState.specialtySettings
              : {},
          updatedAt: localState?.updatedAt || localState?.updated_at || null,
          revision: Number(localState?.revision || 0) || 0,
          sectionVersions:
            localState?._localSectionVersionsAfter && typeof localState._localSectionVersionsAfter === 'object'
              ? localState._localSectionVersionsAfter
              : localState?.sectionVersions && typeof localState.sectionVersions === 'object'
                ? localState.sectionVersions
                : {},
          pendingPersistence: Boolean(localRecord && localRecord.sync_status !== 'synced')
        }
      };
    };

    try {
      const response = await fetch('/api/clinic/state', {
        headers: {
          ...(await getAuthHeaders()),
          ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {})
        },
        credentials: 'include'
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        const localFallback = await buildFromLocal(result?.error || result?.warning || `HTTP ${response.status}`);
        return localFallback.success ? localFallback : result;
      }

      const clinicData = result?.data || {};
      await saveEncryptedRecord({
        id: entityId,
        entity_id: entityId,
        data: { ...clinicData, workspace_id: workspaceId || undefined },
        type: 'clinic_state',
        sync_status: 'synced',
        last_updated: clinicData?.updatedAt ? new Date(clinicData.updatedAt).getTime() || Date.now() : Date.now(),
        method: 'POST',
        endpoint: '/api/clinic/state'
      });
      const effectiveRecord = await getRecordById(entityId);
      const effectiveState = effectiveRecord?.data || clinicData;
      const remoteProtocols = normalizeProtocolList(clinicData?.protocols);
      const backupProtocols = readClinicProtocolsBackup(workspaceId);
      const protocols = Array.isArray(effectiveState?.protocols)
        ? normalizeProtocolList(effectiveState.protocols)
        : remoteProtocols.length > 0 || clinicData?.updatedAt ? remoteProtocols : backupProtocols;
      return {
        ...result,
        data: {
          clinicId: effectiveState?.clinicId || clinicData?.clinicId || workspaceId || null,
          rooms: ensureArray(effectiveState?.rooms),
          appointments: ensureArray(effectiveState?.appointments),
          protocols,
          specialtySettings:
            effectiveState?.specialtySettings && typeof effectiveState.specialtySettings === 'object'
              ? effectiveState.specialtySettings
              : {},
          updatedAt: clinicData?.updatedAt || effectiveState?.updatedAt || null,
          revision: Number(clinicData?.revision || 0) || 0,
          sectionVersions:
            effectiveRecord && effectiveRecord.sync_status !== 'synced' &&
            effectiveState?._localSectionVersionsAfter && typeof effectiveState._localSectionVersionsAfter === 'object'
              ? effectiveState._localSectionVersionsAfter
              : clinicData?.sectionVersions && typeof clinicData.sectionVersions === 'object'
                ? clinicData.sectionVersions
                : {},
          pendingPersistence: Boolean(effectiveRecord && effectiveRecord.sync_status !== 'synced')
        }
      };
    } catch (error) {
      console.error('Error fetching clinic state:', error);
      return await buildFromLocal(error);
    }
  },

  async saveClinicState(payload: {
    workspace_id?: string;
    rooms?: any[];
    appointments?: any[];
    protocols?: any[];
    specialtySettings?: Record<string, number>;
    expectedRevision?: number;
    expectedSectionVersions?: Record<string, number>;
  }) {
    try {
      if (Array.isArray(payload?.protocols)) {
        writeClinicProtocolsBackup(payload?.workspace_id, payload.protocols);
      }
      const workspaceKey = String(payload?.workspace_id || 'active').trim() || 'active';
      const expectedVersions =
        payload?.expectedSectionVersions && typeof payload.expectedSectionVersions === 'object'
          ? payload.expectedSectionVersions
          : {};
      const localSectionVersionsAfter: Record<string, number> = { ...expectedVersions };
      if (Array.isArray(payload?.rooms)) localSectionVersionsAfter.rooms = Number(expectedVersions.rooms || 0) + 1;
      if (Array.isArray(payload?.appointments)) localSectionVersionsAfter.appointments = Number(expectedVersions.appointments || 0) + 1;
      if (Array.isArray(payload?.protocols)) localSectionVersionsAfter.protocols = Number(expectedVersions.protocols || 0) + 1;
      if (payload?.specialtySettings && typeof payload.specialtySettings === 'object') {
        localSectionVersionsAfter.specialtySettings = Number(expectedVersions.specialtySettings || 0) + 1;
      }
      const result = await saveOfflineFirst(
        `clinic-state:${workspaceKey}`,
        {
          ...(payload || {}),
          workspace_id: payload?.workspace_id || undefined,
          _localSectionVersionsAfter: localSectionVersionsAfter
        },
        'clinic_state',
        '/api/clinic/state',
        'POST'
      );
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
    const stableRequestId =
      clientRequestId ||
      appointments.map((appointment) => String(appointment?.id || "")).filter(Boolean).join(",") ||
      generateId();
    const idempotencyKey = `POST:/api/appointments:${stableRequestId}`;
    const endpoint = "/api/appointments";
    const payload = { appointments, idempotencyKey };
    const buildPendingAppointments = () =>
      (appointments || []).map((appointment) => ({
        ...(appointment || {}),
        id: appointment?.id || appointment?.clientAppointmentId || generateId(),
        clientAppointmentId: appointment?.clientAppointmentId || appointment?.id || stableRequestId,
        idempotencyKey,
        pendingSync: true,
        syncStatus: 'pending_sync',
        sync_status: 'pending_sync',
        appointment_status: appointment?.appointment_status || appointment?.status || 'pending',
        status: appointment?.status || 'pending'
      }));
    const queueOfflineAppointment = async (reason: string) => {
      const pendingAppointments = buildPendingAppointments();
      await saveEncryptedRecord({
        id: `appointment:${idempotencyKey}`,
        data: {
          ...payload,
          clientAppointmentId: stableRequestId,
          offlineReason: reason,
          queuedAt: new Date().toISOString()
        },
        type: 'appointment',
        sync_status: 'pending',
        last_updated: Date.now(),
        retry_count: 0,
        last_attempt_at: null,
        next_retry_at: null,
        last_error: reason,
        method: 'POST',
        endpoint
      });
      return {
        success: true,
        queued: true,
        offline: true,
        pending: true,
        idempotencyKey,
        appointments: pendingAppointments,
        data: pendingAppointments,
        message: 'Agendamento salvo localmente. Ele sera sincronizado automaticamente quando a internet voltar.'
      };
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return await queueOfflineAppointment('offline');
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...(await getAuthHeaders()),
          "X-Idempotency-Key": idempotencyKey,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const result = await safeJson(response);
      if (!response.ok || result?.success === false) {
        if ([408, 429].includes(response.status) || response.status >= 500) {
          return await queueOfflineAppointment(result?.error || `sync_retryable_${response.status}`);
        }
        return {
          success: false,
          error: result?.error || `Falha ao criar agendamento (HTTP ${response.status}).`,
        };
      }
      return result;
    } catch (error) {
      console.error("Error creating appointments:", error);
      return await queueOfflineAppointment('network_error');
    }
  },

  async getOfflineAppointmentDrafts() {
    try {
      const records = await getRecordsByType('appointment');
      const drafts = records
        .filter((record) => record.sync_status !== 'synced')
        .flatMap((record) => {
          const idempotencyKey = String(record?.data?.idempotencyKey || '').trim();
          const syncStatus = record.sync_status === 'pending' ? 'pending_sync' : record.sync_status;
          return (Array.isArray(record?.data?.appointments) ? record.data.appointments : []).map((appointment: any) => ({
            ...(appointment || {}),
            id: appointment?.id || appointment?.clientAppointmentId || record.id,
            clientAppointmentId: appointment?.clientAppointmentId || appointment?.id || record?.data?.clientAppointmentId || record.id,
            idempotencyKey,
            pendingSync: record.sync_status === 'pending',
            syncStatus,
            sync_status: syncStatus,
            status: appointment?.status || 'pending'
          }));
        });
      return { success: true, data: drafts };
    } catch (error: any) {
      console.warn('[offline-cache] failed to read appointment drafts:', error);
      return { success: false, data: [], error: error?.message || String(error) };
    }
  },

  async updateAppointment(appointmentId: string, appointments: any[], clientRequestId?: string) {
    try {
      const stableRequestId = clientRequestId || createIdempotencyKey('appointment-update', appointmentId);
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

  async getClinicRooms() {
    try {
      const response = await fetch('/api/clinic/rooms', { headers: await getNoStoreAuthHeaders(false), credentials: 'include', cache: 'no-store' });
      const result = await safeJson(response);
      if (!result?.success || !Array.isArray(result?.data)) return result;
      return { ...result, data: result.data.map((room: any) => {
        const specialties = Array.isArray(room?.specialties) ? room.specialties : String(room?.specialties || '').split(',').map((value) => value.trim()).filter(Boolean);
        const active = room?.is_active !== false && room?.isActive !== false;
        const preventsOverlap = room?.prevent_overlapping_appointments !== false && room?.preventOverlappingAppointments !== false;
        return { ...room, specialties, is_active: active, isActive: active, prevent_overlapping_appointments: preventsOverlap, preventOverlappingAppointments: preventsOverlap };
      }) };
    } catch (error) { console.error('Error fetching clinic rooms:', error); return { success: false, error: 'Não foi possível carregar as salas agora.' }; }
  },
  async createClinicRoom(payload: any) {
    try { const response = await fetch('/api/clinic/rooms', { method: 'POST', headers: await getAuthHeaders(), credentials: 'include', body: JSON.stringify(payload || {}) }); return await safeJson(response); }
    catch (error) { console.error('Error creating clinic room:', error); return { success: false, error: 'Não foi possível salvar a sala agora.' }; }
  },
  async updateClinicRoom(roomId: string, payload: any) {
    try { const response = await fetch(`/api/clinic/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', headers: await getAuthHeaders(), credentials: 'include', body: JSON.stringify(payload || {}) }); return await safeJson(response); }
    catch (error) { console.error('Error updating clinic room:', error); return { success: false, error: 'Não foi possível atualizar a sala agora.' }; }
  },
  async getClinicAnnouncements(limit = 30) {
    try { const response = await fetch(endpointWithQuery('/api/clinic/announcements', { limit }), { headers: await getNoStoreAuthHeaders(false), credentials: 'include', cache: 'no-store' }); return await safeJson(response); }
    catch (error) { console.error('Error fetching clinic announcements:', error); return { success: false, error: 'Não foi possível carregar os avisos agora.' }; }
  },
  async createClinicAnnouncement(payload: any) {
    try { const response = await fetch('/api/clinic/announcements', { method: 'POST', headers: await getAuthHeaders(), credentials: 'include', body: JSON.stringify(payload || {}) }); return await safeJson(response); }
    catch (error) { console.error('Error creating clinic announcement:', error); return { success: false, error: 'Não foi possível enviar o aviso agora.' }; }
  },

  async hydrateWorkspaceState(workspaceId?: string) {
    const workspaceKey = String(workspaceId || 'active').trim() || 'active';
    const clinicStateEntityId = `clinic-state:${workspaceKey}`;
    const buildLocalWorkspaceHydration = async (error?: unknown) => {
      let localPatientRecords: any[] = [];
      let localClinicStateRecord: any = null;
      try {
        [localPatientRecords, localClinicStateRecord] = await Promise.all([
          getRecordsByType('patient'),
          getRecordById(clinicStateEntityId),
        ]);
      } catch (cacheError) {
        console.warn('[workspace-hydration] Cache local indisponível durante fallback; mantendo falha explícita.', cacheError);
        return {
          success: false,
          error: String(error || 'Não foi possível carregar o workspace nem acessar a cópia local persistida.'),
        };
      }
      const safeWorkspaceId = String(workspaceId || '').trim();
      const localPatients = localPatientRecords
        .map((record) => {
          const { recordPayload: _recordPayload, idempotencyKey: _idempotencyKey, ...patientData } = record?.data || {};
          return mirrorPatientInsuranceEligibilityAliases(patientData, { useResponsibleFallback: true });
        })
        .filter((patient: any) => {
          const patientClinicId = String(patient?.clinic_id || patient?.clinicId || '').trim();
          return !safeWorkspaceId || !patientClinicId || patientClinicId === safeWorkspaceId;
        });
      const localClinicState = localClinicStateRecord?.data || null;
      if (!localClinicStateRecord && localPatients.length === 0) {
        return {
          success: false,
          error: String(error || 'Não foi possível carregar o workspace nem recuperar uma cópia local persistida.'),
        };
      }

      const backupProtocols = readClinicProtocolsBackup(workspaceId);
      const localProtocols = Array.isArray(localClinicState?.protocols)
        ? normalizeProtocolList(localClinicState.protocols)
        : backupProtocols;
      const effectiveLocalVersions =
        localClinicState?._localSectionVersionsAfter && typeof localClinicState._localSectionVersionsAfter === 'object'
          ? localClinicState._localSectionVersionsAfter
          : localClinicState?.sectionVersions && typeof localClinicState.sectionVersions === 'object'
            ? localClinicState.sectionVersions
            : {};
      const localSnapshot = {
        rooms: ensureArray(localClinicState?.rooms),
        appointments: ensureArray(localClinicState?.appointments),
        protocols: localProtocols,
        specialtySettings:
          localClinicState?.specialtySettings && typeof localClinicState.specialtySettings === 'object'
            ? localClinicState.specialtySettings
            : {},
      };

      return {
        success: true,
        offline: true,
        patientListCanonical: false,
        pending: Boolean(localClinicStateRecord && localClinicStateRecord.sync_status !== 'synced'),
        data: {
          clinicState: {
            clinicId: localClinicState?.clinicId || localClinicState?.clinic_id || workspaceId || null,
            ...localSnapshot,
            updatedAt: localClinicState?.updatedAt || localClinicState?.updated_at || null,
            revision: Number(localClinicState?.revision || 0) || 0,
            sectionVersions: effectiveLocalVersions,
            pendingPersistence: Boolean(localClinicStateRecord && localClinicStateRecord.sync_status !== 'synced'),
            persistedSnapshot: localSnapshot,
          },
          clinicAnamnesisTemplate: {},
          patients: localPatients,
          notes: [],
          history: [],
          tasks: [],
          clinicalRecords: [],
        },
      };
    };

    try {
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
      const patientList = normalizePatientListResponse(patientsRes);

      if (!patientsResponse.ok || !patientList.success) {
        const failureMessage =
          patientsRes?.error ||
          (patientList.success
            ? ''
            : 'A resposta da lista de pacientes não contém uma coleção válida.') ||
          `Falha ao carregar pacientes do workspace (HTTP ${patientsResponse.status}).`;
        const localFallback = await buildLocalWorkspaceHydration(failureMessage);
        if (localFallback.success) return localFallback;
        return {
          success: false,
          code: patientList.success ? undefined : PATIENT_LIST_INVALID_RESPONSE_CODE,
          error: failureMessage,
        };
      }

      const emptyClinicState = {
        clinicId: workspaceId || null,
        rooms: [],
        appointments: [],
        protocols: [],
        specialtySettings: {},
        updatedAt: null,
        revision: 0,
        sectionVersions: {}
      };
      let clinicStateData =
        clinicStateResponse.ok && clinicStateRes?.success !== false
          ? clinicStateRes?.data || emptyClinicState
          : emptyClinicState;

      // Patient visibility must not depend on an unrelated clinic-state bootstrap.
      // If clinic/state is temporarily unavailable, preserve its last local snapshot
      // when possible, but continue with the already-confirmed remote patient list.
      if (!clinicStateResponse.ok || clinicStateRes?.success === false) {
        try {
          const localClinicStateRecord = await getRecordById(clinicStateEntityId);
          if (localClinicStateRecord?.data && typeof localClinicStateRecord.data === 'object') {
            clinicStateData = { ...emptyClinicState, ...localClinicStateRecord.data };
          }
        } catch (cacheError) {
          console.warn('[workspace-hydration] Estado local da clínica indisponível; pacientes remotos permanecem válidos.', cacheError);
        }
      }

      const remotePatients = patientList.data.map((patient: any) =>
        mirrorPatientInsuranceEligibilityAliases(patient || {}, { useResponsibleFallback: true }),
      );

      // The server snapshot is already authenticated and canonical at this point.
      // IndexedDB is durability/offline support only: a local cache failure must never
      // turn a valid remote patient list into an empty React state.
      let effectiveClinicStateRecord: any = null;
      let effectivePatientRecords: any[] = [];
      try {
        await saveEncryptedRecord({
          id: clinicStateEntityId,
          entity_id: clinicStateEntityId,
          data: { ...clinicStateData, workspace_id: workspaceId || undefined },
          type: 'clinic_state',
          sync_status: 'synced',
          last_updated: clinicStateData?.updatedAt ? new Date(clinicStateData.updatedAt).getTime() || Date.now() : Date.now(),
          method: 'POST',
          endpoint: '/api/clinic/state'
        });

        for (const patient of remotePatients) {
          const patientId = String(patient?.id || '').trim();
          if (!patientId) continue;
          await saveEncryptedRecord({
            id: patientId,
            entity_id: patientId,
            data: patient,
            type: 'patient',
            sync_status: 'synced',
            last_updated: patient?.updated_at ? new Date(patient.updated_at).getTime() || Date.now() : Date.now(),
            method: 'POST',
            endpoint: '/api/patients'
          });
        }

        // Re-read canonical caches through the outbox overlay. A reload/relogin must
        // never hide a durable local mutation merely because a remote snapshot is stale.
        [effectiveClinicStateRecord, effectivePatientRecords] = await Promise.all([
          getRecordById(clinicStateEntityId),
          getRecordsByType('patient'),
        ]);
      } catch (cacheError) {
        console.warn('[workspace-hydration] Cache local indisponível; usando snapshot remoto confirmado.', cacheError);
        effectiveClinicStateRecord = null;
        effectivePatientRecords = [];
      }
      const localClinicState = effectiveClinicStateRecord?.data || clinicStateData;
      const remotePatientIds = new Set(remotePatients.map((patient: any) => String(patient?.id || '').trim()).filter(Boolean));
      const safeWorkspaceId = String(workspaceId || '').trim();
      const localPatientEntries = effectivePatientRecords
        .map((record) => {
          const { recordPayload: _recordPayload, idempotencyKey: _idempotencyKey, ...patientData } = record?.data || {};
          return {
            record,
            patient: mirrorPatientInsuranceEligibilityAliases(patientData, { useResponsibleFallback: true }),
          };
        })
        .filter(({ patient }: any) => {
          const patientId = String(patient?.id || '').trim();
          const patientClinicId = String(patient?.clinic_id || patient?.clinicId || '').trim();
          return remotePatientIds.has(patientId) || !safeWorkspaceId || !patientClinicId || patientClinicId === safeWorkspaceId;
        });
      const patientsById = new Map<string, any>();
      for (const patient of remotePatients) {
        const patientId = String(patient?.id || '').trim();
        if (patientId) patientsById.set(patientId, patient);
      }
      for (const { record, patient } of localPatientEntries) {
        const patientId = String(patient?.id || '').trim();
        if (!patientId) continue;
        const remotePatient = patientsById.get(patientId);
        // A fresh server snapshot is authoritative over an already-synced cache copy.
        // Only a genuinely pending local mutation may overlay it, preserving offline edits.
        if (remotePatient && record?.sync_status === 'synced') continue;
        patientsById.set(
          patientId,
          remotePatient
            ? mirrorPatientInsuranceEligibilityAliases(
                { ...remotePatient, ...patient },
                { useResponsibleFallback: true },
              )
            : patient,
        );
      }
      const patients = Array.from(patientsById.values());
      const remoteProtocols = normalizeProtocolList(clinicStateData?.protocols);
      const backupProtocols = readClinicProtocolsBackup(workspaceId);
      const clinicStateWithProtocolFallback = {
        ...clinicStateData,
        rooms: Array.isArray(localClinicState?.rooms) ? localClinicState.rooms : ensureArray(clinicStateData?.rooms),
        appointments: Array.isArray(localClinicState?.appointments) ? localClinicState.appointments : ensureArray(clinicStateData?.appointments),
        protocols: Array.isArray(localClinicState?.protocols)
          ? normalizeProtocolList(localClinicState.protocols)
          : remoteProtocols.length > 0 || clinicStateData?.updatedAt ? remoteProtocols : backupProtocols,
        specialtySettings:
          localClinicState?.specialtySettings && typeof localClinicState.specialtySettings === 'object'
            ? localClinicState.specialtySettings
            : clinicStateData?.specialtySettings && typeof clinicStateData.specialtySettings === 'object'
              ? clinicStateData.specialtySettings
              : {},
        revision: Number(clinicStateData?.revision || 0) || 0,
        sectionVersions:
          effectiveClinicStateRecord && effectiveClinicStateRecord.sync_status !== 'synced' &&
          localClinicState?._localSectionVersionsAfter && typeof localClinicState._localSectionVersionsAfter === 'object'
            ? localClinicState._localSectionVersionsAfter
            : clinicStateData?.sectionVersions && typeof clinicStateData.sectionVersions === 'object'
              ? clinicStateData.sectionVersions
              : {},
        pendingPersistence: Boolean(effectiveClinicStateRecord && effectiveClinicStateRecord.sync_status !== 'synced'),
        persistedSnapshot: {
          rooms: ensureArray(clinicStateData?.rooms),
          appointments: ensureArray(clinicStateData?.appointments),
          protocols: remoteProtocols.length > 0 || clinicStateData?.updatedAt ? remoteProtocols : backupProtocols,
          specialtySettings:
            clinicStateData?.specialtySettings && typeof clinicStateData.specialtySettings === 'object'
              ? clinicStateData.specialtySettings
              : {}
        }
      };

      return {
        success: true,
        patientListCanonical: true,
        data: {
          clinicState: clinicStateWithProtocolFallback,
          clinicAnamnesisTemplate: clinicTemplateRes?.data || {},
          patients,
          notes: [],
          history: [],
          tasks: [],
          clinicalRecords: []
        }
      };
    } catch (error) {
      console.error('Error hydrating workspace state:', error);
      return await buildLocalWorkspaceHydration(error);
    }
  },
  async getSchools(params: Record<string, any> = {}, options: { signal?: AbortSignal } = {}) {
    const endpoint = endpointWithQuery('/api/schools', params);
    return await fetchNoStoreJsonWithRetry(endpoint, { credentials: 'include', signal: options.signal }, {
      helperName: 'getSchools', operation: 'list', table: 'schools,school_units,school_contacts,patient_school_enrollments,school_meetings', hasExplicitColumns: true, requiresPatientOrSession: false
    }, 'A lista de escolas ficou desatualizada.');
  },

  async getSchoolAutocomplete(search = '', page = 1, pageSize = 20, options: { signal?: AbortSignal } = {}) {
    const endpoint = endpointWithQuery('/api/schools/autocomplete', { search, page, pageSize });
    return await fetchNoStoreJsonWithRetry(endpoint, { credentials: 'include', signal: options.signal }, {
      helperName: 'getSchoolAutocomplete', operation: 'list', table: 'schools', hasExplicitColumns: true, requiresPatientOrSession: false
    }, 'A busca de escolas ficou desatualizada.');
  },

  async createSchool(payload: any) {
    const response = await fetchClinical('/api/schools', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }, { helperName: 'createSchool', operation: 'write', table: 'schools,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, status: response.status, ...result };
    return result;
  },

  async updateSchool(schoolId: string, payload: any) {
    const response = await fetchClinical(`/api/schools/${encodeURIComponent(schoolId)}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }, { helperName: 'updateSchool', operation: 'write', table: 'schools,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, status: response.status, ...result };
    return result;
  },

  async getSchoolDetail(schoolId: string, options: { section?: 'summary' | 'audit'; signal?: AbortSignal } = {}) {
    const endpoint = endpointWithQuery(`/api/schools/${encodeURIComponent(schoolId)}`, { section: options.section });
    return await fetchNoStoreJsonWithRetry(endpoint, { credentials: 'include', signal: options.signal }, {
      helperName: 'getSchoolDetail', operation: 'detail', table: 'schools,school_units,school_contacts,patient_school_enrollments,school_meetings,school_document_links', hasExplicitColumns: true, requiresPatientOrSession: false
    }, 'O detalhe da escola ficou desatualizado.');
  },

  async getSchoolEnrollmentOptions(schoolId: string, options: { signal?: AbortSignal } = {}) {
    return await fetchNoStoreJsonWithRetry(`/api/schools/${encodeURIComponent(schoolId)}/enrollment-options`, { credentials: 'include', signal: options.signal }, {
      helperName: 'getSchoolEnrollmentOptions', operation: 'detail', table: 'schools,school_units,school_contacts', hasExplicitColumns: true, requiresPatientOrSession: false
    }, 'As opções do vínculo escolar ficaram desatualizadas.');
  },

  async createSchoolUnit(schoolId: string, payload: any) {
    const response = await fetchClinical(`/api/schools/${encodeURIComponent(schoolId)}/units`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'createSchoolUnit', operation: 'write', table: 'school_units', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async createSchoolContact(schoolId: string, payload: any) {
    const response = await fetchClinical(`/api/schools/${encodeURIComponent(schoolId)}/contacts`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'createSchoolContact', operation: 'write', table: 'school_contacts', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getPatientSchoolEnrollments(patientId: string) {
    return await fetchNoStoreJsonWithRetry(`/api/patients/${encodeURIComponent(patientId)}/school-enrollments`, { credentials: 'include' }, { helperName: 'getPatientSchoolEnrollments', operation: 'list', table: 'patient_school_enrollments,schools,school_units,school_contacts', hasExplicitColumns: true, requiresPatientOrSession: true }, 'Os vínculos escolares ficaram desatualizados.');
  },

  async createPatientSchoolEnrollment(patientId: string, payload: any) {
    const response = await fetchClinical(`/api/patients/${encodeURIComponent(patientId)}/school-enrollments`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'createPatientSchoolEnrollment', operation: 'write', table: 'patient_school_enrollments,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: true });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updatePatientSchoolEnrollment(patientId: string, enrollmentId: string, payload: any) {
    const response = await fetchClinical(`/api/patients/${encodeURIComponent(patientId)}/school-enrollments/${encodeURIComponent(enrollmentId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updatePatientSchoolEnrollment', operation: 'write', table: 'patient_school_enrollments,school_consents,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: true });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async endPatientSchoolEnrollment(patientId: string, enrollmentId: string, payload: any) {
    const response = await fetchClinical(`/api/patients/${encodeURIComponent(patientId)}/school-enrollments/${encodeURIComponent(enrollmentId)}/end`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'endPatientSchoolEnrollment', operation: 'write', table: 'patient_school_enrollments,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: true });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async savePatientSchoolConsent(patientId: string, payload: any) {
    const response = await fetchClinical(`/api/patients/${encodeURIComponent(patientId)}/school-consents`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'savePatientSchoolConsent', operation: 'write', table: 'school_consents', hasExplicitColumns: true, requiresPatientOrSession: true });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async searchSchoolPatients(params: Record<string, any>, options: { signal?: AbortSignal } = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery('/api/schools/patients/search', params), { credentials: 'include', signal: options.signal }, { helperName: 'searchSchoolPatients', operation: 'list', table: 'patient_school_enrollments,patients,school_consents,school_meeting_patients', hasExplicitColumns: true, requiresPatientOrSession: false }, 'A lista de pacientes por escola ficou desatualizada.');
  },

  async searchPatientsForSchool(schoolId: string, params: Record<string, any> = {}, options: { signal?: AbortSignal } = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery(`/api/schools/${encodeURIComponent(schoolId)}/patients/autocomplete`, params), { credentials: 'include', signal: options.signal }, { helperName: 'searchPatientsForSchool', operation: 'list', table: 'patients,patient_school_enrollments', hasExplicitColumns: true, requiresPatientOrSession: false }, 'A busca de pacientes ficou desatualizada.');
  },

  async getPatientCareLocations(patientId: string) {
    return await fetchNoStoreJsonWithRetry(`/api/patients/${encodeURIComponent(patientId)}/care-locations`, { credentials: 'include' }, { helperName: 'getPatientCareLocations', operation: 'detail', table: 'patients,patient_school_enrollments,schools,school_units,school_contacts', hasExplicitColumns: true, requiresPatientOrSession: true }, 'Os locais de atendimento ficaram desatualizados.');
  },

  async getClinicAppointmentPolicy() {
    return await fetchNoStoreJsonWithRetry('/api/clinic/appointment-policy', { credentials: 'include' }, { helperName: 'getClinicAppointmentPolicy', operation: 'detail', table: 'clinics', hasExplicitColumns: true, requiresPatientOrSession: false }, 'A política de reagendamento ficou desatualizada.');
  },

  async updateClinicAppointmentPolicy(payload: any) {
    const response = await fetchClinical('/api/clinic/appointment-policy', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateClinicAppointmentPolicy', operation: 'write', table: 'clinics,clinic_policy_audit_events,appointment_attendance_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getSchoolMeetings(params: Record<string, any> = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery('/api/school-meetings', params), { credentials: 'include' }, { helperName: 'getSchoolMeetings', operation: 'list', table: 'school_meetings,school_meeting_patients,school_meeting_minutes', hasExplicitColumns: true, requiresPatientOrSession: false }, 'A lista de reuniões ficou desatualizada.');
  },

  async createSchoolMeetingBatch(payload: any) {
    const response = await fetchClinical('/api/school-meetings/batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'createSchoolMeetingBatch', operation: 'write', table: 'school_meetings,school_meeting_patients,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updateSchoolMeeting(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolMeeting', operation: 'write', table: 'school_meetings,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async saveSchoolMeetingMinutes(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/minutes`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'saveSchoolMeetingMinutes', operation: 'write', table: 'school_meeting_minutes,school_meeting_patient_notes', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getSchoolCalendarEvents(params: Record<string, any> = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery('/api/school-calendar-events', params), { credentials: 'include' }, { helperName: 'getSchoolCalendarEvents', operation: 'list', table: 'school_meetings', hasExplicitColumns: true, requiresPatientOrSession: false }, 'Os eventos escolares ficaram desatualizados.');
  },

  async getSchoolIndicators(schoolId: string) {
    return await fetchNoStoreJsonWithRetry(`/api/schools/${encodeURIComponent(schoolId)}/indicators`, { credentials: 'include' }, { helperName: 'getSchoolIndicators', operation: 'detail', table: 'schools,patient_school_enrollments,school_meetings,school_consents', hasExplicitColumns: true, requiresPatientOrSession: false }, 'Os indicadores escolares ficaram desatualizados.');
  },


  async updateSchoolUnit(schoolId: string, unitId: string, payload: any) {
    const response = await fetchClinical(`/api/schools/${encodeURIComponent(schoolId)}/units/${encodeURIComponent(unitId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolUnit', operation: 'write', table: 'school_units', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updateSchoolContact(schoolId: string, contactId: string, payload: any) {
    const response = await fetchClinical(`/api/schools/${encodeURIComponent(schoolId)}/contacts/${encodeURIComponent(contactId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolContact', operation: 'write', table: 'school_contacts', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getPatientSchoolConsents(patientId: string) {
    return await fetchNoStoreJsonWithRetry(`/api/patients/${encodeURIComponent(patientId)}/school-consents`, { credentials: 'include' }, { helperName: 'getPatientSchoolConsents', operation: 'list', table: 'school_consents', hasExplicitColumns: true, requiresPatientOrSession: true }, 'As autorizações escolares ficaram desatualizadas.');
  },

  async getSchoolMeetingDetail(meetingId: string) {
    return await fetchNoStoreJsonWithRetry(`/api/school-meetings/${encodeURIComponent(meetingId)}`, { credentials: 'include' }, { helperName: 'getSchoolMeetingDetail', operation: 'detail', table: 'school_meetings,school_meeting_patients,school_meeting_participants,school_meeting_minutes,school_document_links', hasExplicitColumns: true, requiresPatientOrSession: false }, 'O detalhe da reunião ficou desatualizado.');
  },

  async addSchoolMeetingPatients(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/patients`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'addSchoolMeetingPatients', operation: 'write', table: 'school_meeting_patients', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async removeSchoolMeetingPatients(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/patients`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'removeSchoolMeetingPatients', operation: 'write', table: 'school_meeting_patients', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async addSchoolMeetingParticipant(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/participants`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'addSchoolMeetingParticipant', operation: 'write', table: 'school_meeting_participants', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updateSchoolMeetingParticipant(meetingId: string, participantId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolMeetingParticipant', operation: 'write', table: 'school_meeting_participants', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async removeSchoolMeetingParticipant(meetingId: string, participantId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'removeSchoolMeetingParticipant', operation: 'write', table: 'school_meeting_participants', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updateSchoolMeetingAttendance(meetingId: string, payload: any) {
    const response = await fetchClinical(`/api/school-meetings/${encodeURIComponent(meetingId)}/attendance`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolMeetingAttendance', operation: 'write', table: 'school_meeting_patients,school_meeting_participants', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getSchoolMeetingPatientNotes(meetingId: string, params: Record<string, any> = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery(`/api/school-meetings/${encodeURIComponent(meetingId)}/patient-notes`, params), { credentials: 'include' }, { helperName: 'getSchoolMeetingPatientNotes', operation: 'list', table: 'school_meeting_patient_notes', hasExplicitColumns: true, requiresPatientOrSession: false }, 'As notas individuais ficaram desatualizadas.');
  },

  async getSchoolDocuments(params: Record<string, any> = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery('/api/school-documents', params), { credentials: 'include' }, { helperName: 'getSchoolDocuments', operation: 'list', table: 'school_document_links,patient_files', hasExplicitColumns: true, requiresPatientOrSession: false }, 'Os documentos escolares ficaram desatualizados.');
  },

  async linkSchoolDocument(payload: any) {
    const response = await fetchClinical('/api/school-documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'linkSchoolDocument', operation: 'write', table: 'school_document_links,patient_files', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async updateSchoolDocumentLink(linkId: string, payload: any) {
    const response = await fetchClinical(`/api/school-documents/${encodeURIComponent(linkId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'updateSchoolDocumentLink', operation: 'write', table: 'school_document_links', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },

  async getSchoolMigrationReview(params: Record<string, any> = {}) {
    return await fetchNoStoreJsonWithRetry(endpointWithQuery('/api/school-migration-review', params), { credentials: 'include' }, { helperName: 'getSchoolMigrationReview', operation: 'list', table: 'school_migration_review_queue', hasExplicitColumns: true, requiresPatientOrSession: false }, 'A fila de revisão escolar ficou desatualizada.');
  },

  async resolveSchoolMigrationReview(payload: any) {
    const response = await fetchClinical('/api/school-migration-review/resolve', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { helperName: 'resolveSchoolMigrationReview', operation: 'write', table: 'school_migration_review_queue,patient_school_enrollments,school_audit_events', hasExplicitColumns: true, requiresPatientOrSession: false });
    const result = await response.json().catch(() => ({})); return response.ok ? result : { success: false, status: response.status, ...result };
  },
};
