import {
  HISTORY_LEGACY_SELECT_COLUMNS,
  HISTORY_SELECT_COLUMNS,
  NOTE_LEGACY_SELECT_COLUMNS,
  NOTE_SELECT_COLUMNS,
  extractMissingColumnNameFromSupabaseError,
  isSchemaFallbackErrorFromSupabase
} from './routeSchemaFallbacks';

type SupabaseLike = { from: (table: string) => any };
type LoggerLike = Pick<Console, 'warn'>;

export const NOTE_WRITE_SELECT_COLUMNS = NOTE_SELECT_COLUMNS;
export const NOTE_WRITE_LEGACY_SELECT_COLUMNS = NOTE_LEGACY_SELECT_COLUMNS;
export const HISTORY_WRITE_SELECT_COLUMNS = HISTORY_SELECT_COLUMNS;
export const HISTORY_WRITE_LEGACY_SELECT_COLUMNS = HISTORY_LEGACY_SELECT_COLUMNS;

const NOTE_WRITE_OPTIONAL_COLUMNS = new Set([
  'id',
  'patient_email',
  'text',
  'content',
  'note',
  'visibility',
  'type',
  'subject',
  'score',
  'image',
  'image_url',
  'original_id',
  'assigned_task_id',
  'source',
  'portability_scope',
  'is_portable',
  'shared_with_patient',
  'shared_with_professionals',
  'original_organization_id',
  'original_author_id',
  'created_by',
  'therapist_id',
  'user_id',
  'created_at',
  'updated_at',
  'is_active',
  'deleted_at'
]);

const HISTORY_WRITE_OPTIONAL_COLUMNS = new Set([
  'id',
  'patient_email',
  'type',
  'score',
  'energy',
  'note',
  'icon',
  'image',
  'image_path',
  'date_group',
  'therapist_id',
  'assigned_task_id',
  'source',
  'task_data',
  'pro_score',
  'max_score',
  'protocol_id',
  'protocol_title',
  'domain_id',
  'domain_name',
  'skill_id',
  'skill_name',
  'created_at',
  'updated_at',
  'is_active',
  'deleted_at'
]);

function cleanString(value: unknown, maxLength = 1000): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value: unknown, maxLength: number): string {
  return escapeHtml(cleanString(value, maxLength).replace(/\u0000/g, ''));
}

function cleanEmail(value: unknown): string {
  const normalized = cleanString(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function cleanUrl(value: unknown): string {
  const raw = cleanString(value, 4000);
  if (!raw) return '';
  if (/^(https?:|data:image\/)/i.test(raw)) return raw;
  return '';
}

function safeNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = cleanString(value, 4000);
    if (normalized) return normalized;
  }
  return '';
}

function boolLike(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = cleanString(value, 20).toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function cleanObject<T extends Record<string, any>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== '')) as Partial<T>;
}

function joinColumns(columns: string[]) {
  return Array.from(new Set(columns.filter(Boolean))).join(',');
}

export function clinicalPayloadKeys(input: any): string[] {
  return Object.keys(input && typeof input === 'object' ? input : {}).sort();
}

export function normalizeNoteMutationPayload(input: any, context: {
  resolvedPatientId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  nowIso?: string;
}) {
  const text = cleanText(firstString(input?.text, input?.content, input?.note, input?.body, input?.description), 12000);
  const patientId = cleanString(context.resolvedPatientId || input?.patient_id || input?.patientId, 120);
  if (!patientId) return { payload: null, error: 'patient_id e texto sao obrigatorios.' };
  if (!text) return { payload: null, error: 'patient_id e texto sao obrigatorios.' };

  const visibilityRaw = cleanString(input?.visibility || input?.type, 60).toLowerCase();
  const visibility = visibilityRaw === 'shared_clinic' || visibilityRaw === 'professional'
    ? 'shared_clinic'
    : ['shared_patient', 'shared', 'patient', 'family'].includes(visibilityRaw)
      ? 'shared_patient'
      : 'private';
  const typeRaw = cleanString(input?.type, 40).toLowerCase();
  const type = ['shared', 'patient', 'family'].includes(typeRaw)
    ? 'shared'
    : typeRaw === 'professional'
      ? 'professional'
      : visibility === 'shared_patient'
        ? 'shared'
        : 'private';
  const portabilityScope =
    visibility === 'shared_patient'
      ? 'PATIENT'
      : visibility === 'shared_clinic'
        ? 'PROFESSIONALS'
        : 'PRIVATE';
  const markedPortable = boolLike(input?.is_portable ?? input?.isPortable, false);

  const payload = cleanObject({
    id: cleanString(input?.id || input?.clientRecordId || input?.localId, 120) || undefined,
    patient_id: patientId,
    patient_email: cleanEmail(input?.patient_email || input?.patientEmail || context.userEmail),
    text,
    content: text,
    note: text,
    visibility,
    type,
    subject: cleanText(input?.subject || input?.title || 'Geral', 100) || 'Geral',
    score: input?.score !== undefined ? safeNumber(input.score, 0, 100) : undefined,
    image: cleanUrl(input?.image || input?.image_url || input?.imageUrl),
    image_url: cleanUrl(input?.image_url || input?.imageUrl || input?.image),
    original_id: cleanString(input?.original_id || input?.originalId, 120) || undefined,
    assigned_task_id: cleanString(input?.assigned_task_id || input?.assignedTaskId, 120) || undefined,
    source: cleanString(input?.source || 'offline_sync', 80),
    portability_scope: portabilityScope,
    is_portable: portabilityScope === 'PROFESSIONALS' ? markedPortable : portabilityScope === 'PATIENT',
    shared_with_patient: portabilityScope === 'PATIENT',
    shared_with_professionals: portabilityScope === 'PROFESSIONALS' && markedPortable,
    original_organization_id: cleanString(input?.original_organization_id || input?.originalOrganizationId, 120) || undefined,
    original_author_id: cleanString(input?.original_author_id || input?.originalAuthorId || context.userId, 120) || undefined,
    created_by: cleanString(input?.created_by || input?.createdBy || context.userId, 120),
    therapist_id: cleanString(input?.therapist_id || input?.therapistId || context.userId, 120),
    user_id: cleanString(input?.user_id || input?.userId || context.userId, 120),
    created_at: cleanString(input?.created_at || input?.createdAt || context.nowIso || new Date().toISOString(), 40)
  });

  return { payload, error: null };
}

export function normalizeHistoryMutationPayload(input: any, context: {
  resolvedPatientId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  nowIso?: string;
  dateGroup?: string | null;
}) {
  const patientId = cleanString(context.resolvedPatientId || input?.patient_id || input?.patientId, 120);
  if (!patientId) return { payload: null, error: 'patient_id e titulo sao obrigatorios.' };

  const safeType = cleanString(input?.type || input?.kind || 'task', 80) || 'task';
  const title = cleanText(firstString(
    input?.title,
    input?.target_name,
    input?.targetName,
    input?.behavior_name,
    input?.behaviorName,
    input?.task_title,
    input?.taskTitle,
    safeType === 'photo' ? 'Foto diaria' : 'Registro clinico'
  ), 180);
  if (!title) return { payload: null, error: 'patient_id e titulo sao obrigatorios.' };

  const taskData = input?.task_data && typeof input.task_data === 'object'
    ? input.task_data
    : input?.taskData && typeof input.taskData === 'object'
      ? input.taskData
      : undefined;

  const payload = cleanObject({
    id: cleanString(input?.id || input?.clientRecordId || input?.localId, 120) || undefined,
    patient_id: patientId,
    patient_email: cleanEmail(input?.patient_email || input?.patientEmail || context.userEmail),
    type: safeType,
    title,
    score: input?.score !== undefined ? safeNumber(input.score, 0, 100) : undefined,
    energy: input?.energy !== undefined ? safeNumber(input.energy, 0, 100) : undefined,
    note: cleanText(firstString(input?.note, input?.text, input?.content, input?.description), 12000),
    icon: cleanString(input?.icon, 40),
    image: cleanUrl(input?.image || input?.image_url || input?.imageUrl),
    image_path: cleanString(input?.image_path || input?.imagePath, 600) || undefined,
    date_group: cleanString(input?.date_group || input?.dateGroup || context.dateGroup, 80) || undefined,
    therapist_id: cleanString(input?.therapist_id || input?.therapistId || context.userId, 120),
    assigned_task_id: cleanString(input?.assigned_task_id || input?.assignedTaskId, 120) || undefined,
    source: cleanString(input?.source || 'offline_sync', 80),
    task_data: taskData,
    pro_score: input?.pro_score !== undefined || input?.proScore !== undefined ? safeNumber(input?.pro_score ?? input?.proScore, 0, 100) : undefined,
    max_score: input?.max_score !== undefined || input?.maxScore !== undefined ? safeNumber(input?.max_score ?? input?.maxScore, 1, 100) : undefined,
    protocol_id: cleanString(input?.protocol_id || input?.protocolId, 120) || undefined,
    protocol_title: cleanText(input?.protocol_title || input?.protocolTitle, 240) || undefined,
    domain_id: cleanString(input?.domain_id || input?.domainId, 120) || undefined,
    domain_name: cleanText(input?.domain_name || input?.domainName, 240) || undefined,
    skill_id: cleanString(input?.skill_id || input?.skillId, 120) || undefined,
    skill_name: cleanText(input?.skill_name || input?.skillName, 240) || undefined,
    created_at: cleanString(input?.created_at || input?.createdAt || context.nowIso || new Date().toISOString(), 40)
  });

  return { payload, error: null };
}

export function classifyClinicalMutationError(error: any): { status: number; kind: string } {
  const code = cleanString(error?.code, 40).toUpperCase();
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return { status: 403, kind: 'permission' };
  }
  if (code === '23505') return { status: 409, kind: 'duplicate' };
  if (code === '23502' || code === '23503' || code === '23514' || code === '22P02') {
    return { status: 400, kind: 'constraint' };
  }
  if (isSchemaFallbackErrorFromSupabase(error)) return { status: 503, kind: 'schema' };
  return { status: 500, kind: 'unexpected' };
}

export async function writeClinicalRowWithSchemaFallback(params: {
  supabase: SupabaseLike;
  route: string;
  table: 'notes' | 'history';
  payload: Record<string, any>;
  selectColumns: string[];
  legacySelectColumns: string[];
  optionalColumns?: Set<string>;
  logContext?: Record<string, any>;
  logger?: LoggerLike;
}) {
  let candidate = { ...(params.payload || {}) };
  let selectColumns = [...params.selectColumns];
  let stage: 'primary_select' | 'legacy_select' = 'primary_select';
  const optionalColumns = params.optionalColumns || (params.table === 'notes' ? NOTE_WRITE_OPTIONAL_COLUMNS : HISTORY_WRITE_OPTIONAL_COLUMNS);
  const removedColumns = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const result = await params.supabase
      .from(params.table)
      .upsert([candidate], { onConflict: 'id' })
      .select(joinColumns(selectColumns))
      .single();

    if (!result.error) {
      return { data: result.data, error: null, payload: candidate, stage, removedColumns };
    }

    lastError = result.error;
    const missingColumn = extractMissingColumnNameFromSupabaseError(result.error);
    const canRemovePayloadColumn = missingColumn && optionalColumns.has(missingColumn) && Object.prototype.hasOwnProperty.call(candidate, missingColumn);
    const canRemoveSelectColumn = missingColumn && optionalColumns.has(missingColumn) && selectColumns.includes(missingColumn);

    if (canRemovePayloadColumn || canRemoveSelectColumn) {
      if (canRemovePayloadColumn) {
        const { [missingColumn]: _removed, ...rest } = candidate;
        candidate = rest;
      }
      if (canRemoveSelectColumn) {
        selectColumns = selectColumns.filter((column) => column !== missingColumn);
      }
      removedColumns.add(missingColumn);
      params.logger?.warn?.(`[Clinical write fallback:${params.route}]`, {
        route: params.route,
        ...(params.logContext || {}),
        table: params.table,
        stage,
        removedColumn: missingColumn,
        select: joinColumns(selectColumns),
        error: {
          code: cleanString(result.error?.code, 40) || null,
          message: cleanString(result.error?.message, 500) || null,
          details: cleanString(result.error?.details, 500) || null,
          hint: cleanString(result.error?.hint, 500) || null
        }
      });
      continue;
    }

    if (stage === 'primary_select') {
      stage = 'legacy_select';
      selectColumns = [...params.legacySelectColumns];
      params.logger?.warn?.(`[Clinical write fallback:${params.route}]`, {
        route: params.route,
        ...(params.logContext || {}),
        table: params.table,
        stage,
        removedColumn: missingColumn || 'schema',
        select: joinColumns(selectColumns),
        error: {
          code: cleanString(result.error?.code, 40) || null,
          message: cleanString(result.error?.message, 500) || null,
          details: cleanString(result.error?.details, 500) || null,
          hint: cleanString(result.error?.hint, 500) || null
        }
      });
      continue;
    }

    break;
  }

  return { data: null, error: lastError, payload: candidate, stage, removedColumns };
}
