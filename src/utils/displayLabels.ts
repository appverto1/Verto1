export const HIDDEN_TECHNICAL_FIELDS = [
  'id',
  'uuid',
  'user_id',
  'userId',
  'patient_id',
  'patientId',
  'therapist_id',
  'therapistId',
  'professional_id',
  'professionalId',
  'clinic_id',
  'clinicId',
  'organization_id',
  'organizationId',
  'appointment_id',
  'appointmentId',
  'workspace_id',
  'workspaceId',
  'session_id',
  'sessionId',
  'aba_session_id',
  'abaSessionId',
  'payer_id',
  'payerId',
  'export_id',
  'exportId',
  'document_id',
  'documentId',
  'requirement_id',
  'requirementId',
  'procedure_id',
  'procedureId',
  'protocol_id',
  'protocolId',
  'target_id',
  'targetId',
  'behavior_id',
  'behaviorId',
  'supabase_id',
  'supabaseId',
  'created_by',
  'createdBy',
  'updated_by',
  'updatedBy',
  'resolved_by',
  'resolvedBy',
  'source_id',
  'sourceId',
  'source_summary_id',
  'sourceSummaryId',
  'request_id',
  'requestId',
  'raw_payload',
  'rawPayload',
  'table_name',
  'tableName',
  'bucket_name',
  'bucketName',
  'schema_cache',
  'schemaCache'
] as const;

const HIDDEN_FIELD_SET = new Set(HIDDEN_TECHNICAL_FIELDS.map((field) => field.toLowerCase()));
const NORMALIZED_HIDDEN_FIELD_SET = new Set(
  HIDDEN_TECHNICAL_FIELDS.map((field) => field.toLowerCase().replace(/[^a-z0-9]/g, ''))
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_INSIDE_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const HEX_32_PATTERN = /^[0-9a-f]{32}$/i;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const LONG_DASHED_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i;
const LONG_TOKEN_PATTERN = /^[a-z0-9._~+/=-]{40,}$/i;
const SHORT_INTERNAL_ID_PATTERN = /^(?:auth|user|usr|org|clinic|workspace|session|patient|therapist|professional|target|behavior|protocol|procedure)[-_][a-z0-9._-]+$/i;
const INTERNAL_PREFIX_PATTERN = /^(?:auth|user|usr|org|clinic|workspace|session|patient|therapist|professional|supabase|railway|postgrest)[-_][a-z0-9._-]{12,}$/i;
const INFRA_TERMS_PATTERN = /\b(supabase|railway|postgrest|schema cache|bucket|database schema|jwt|service role|anon key)\b/i;

const TECHNICAL_FALLBACK = 'Nao informado';

const cleanString = (value: any) => String(value ?? '').replace(/\s+/g, ' ').trim();

const firstReadableString = (source: any, keys: string[]) => {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = cleanString(source?.[key]);
    if (value && !isTechnicalId(value) && !INFRA_TERMS_PATTERN.test(value)) return value;
  }
  return '';
};

export const containsTechnicalId = (value: any): boolean => {
  const text = cleanString(value);
  return Boolean(text && UUID_INSIDE_PATTERN.test(text));
};

export const isTechnicalId = (value: any): boolean => {
  const text = cleanString(value);
  if (!text) return false;
  if (UUID_PATTERN.test(text) || UUID_INSIDE_PATTERN.test(text)) return true;
  if (HEX_32_PATTERN.test(text) || ULID_PATTERN.test(text)) return true;
  if (SHORT_INTERNAL_ID_PATTERN.test(text)) return true;
  if (INTERNAL_PREFIX_PATTERN.test(text)) return true;
  if (text.length >= 24 && LONG_DASHED_ID_PATTERN.test(text)) return true;
  if (!/\s/.test(text) && LONG_TOKEN_PATTERN.test(text)) return true;
  return false;
};

export const isTechnicalFieldName = (fieldName: any): boolean => {
  const raw = cleanString(fieldName);
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9]/g, '');
  if (HIDDEN_FIELD_SET.has(lower) || NORMALIZED_HIDDEN_FIELD_SET.has(normalized)) return true;
  if (/^(id|uuid)$/i.test(raw)) return true;
  if (/(^|[_-])(id|uuid)$/i.test(raw)) return true;
  if (/[a-z0-9](Id|UUID)$/.test(raw)) return true;
  if (/^(rawPayload|metadata|tableName|bucketName|schemaCache)$/i.test(raw)) return true;
  return false;
};

export const maskTechnicalId = (value: any): string => {
  const text = cleanString(value);
  if (!text) return '';
  if (!isTechnicalId(text)) return text;
  const suffix = text.replace(/[^a-z0-9]/gi, '').slice(-4);
  return suffix ? `ID tecnico oculto (...${suffix})` : 'ID tecnico oculto';
};

export const safeDisplayValue = (value: any, fallback = TECHNICAL_FALLBACK): string => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toLocaleString('pt-BR');
  }
  if (Array.isArray(value)) {
    const readable = value
      .map((item) => safeDisplayValue(item, ''))
      .filter(Boolean)
      .join(', ');
    return readable || fallback;
  }
  if (typeof value === 'object') return fallback;

  const text = cleanString(value);
  if (!text) return fallback;
  if (isTechnicalId(text) || INFRA_TERMS_PATTERN.test(text)) return fallback;
  return text;
};

export const formatPatientLabel = (patient: any, fallback = 'Paciente nao identificado'): string => {
  if (typeof patient === 'string') return safeDisplayValue(patient, fallback);
  return (
    firstReadableString(patient, [
      'name',
      'patientName',
      'patient_name',
      'fullName',
      'full_name',
      'nome',
      'nomeSocial',
      'displayName',
      'display_name'
    ]) || fallback
  );
};

export const formatTherapistLabel = (professional: any, fallback = 'Terapeuta nao informado'): string => {
  if (typeof professional === 'string') return safeDisplayValue(professional, fallback);
  return (
    firstReadableString(professional, [
      'therapistName',
      'therapist_name',
      'professionalName',
      'professional_name',
      'displayName',
      'display_name',
      'fullName',
      'full_name',
      'name',
      'nome'
    ]) || fallback
  );
};

export const formatClinicLabel = (clinic: any, fallback = 'Clinica nao identificada'): string => {
  if (typeof clinic === 'string') return safeDisplayValue(clinic, fallback);
  return (
    firstReadableString(clinic, [
      'clinicName',
      'clinic_name',
      'organizationName',
      'organization_name',
      'workspaceName',
      'workspace_name',
      'name',
      'displayName',
      'display_name'
    ]) || fallback
  );
};

export const formatSessionLabel = (session: any, fallback = 'Sessao clinica'): string => {
  if (typeof session === 'string') return safeDisplayValue(session, fallback);
  const explicit = firstReadableString(session, ['label', 'title', 'name', 'sessionLabel', 'session_label']);
  if (explicit) return explicit;

  const rawDate =
    session?.startedAt ||
    session?.started_at ||
    session?.startTime ||
    session?.start_time ||
    session?.occurredAt ||
    session?.occurred_at ||
    session?.createdAt ||
    session?.created_at ||
    session?.date;
  const date = new Date(rawDate || 0);
  if (Number.isNaN(date.getTime())) return fallback;

  const dateLabel = date.toLocaleDateString('pt-BR');
  const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Sessao de ${dateLabel} as ${timeLabel}`;
};

export const filterHumanDisplayEntries = (input: Record<string, any> | null | undefined) => {
  return Object.entries(input || {}).filter(([key, value]) => {
    if (isTechnicalFieldName(key)) return false;
    if (typeof value === 'string' && isTechnicalId(value)) return false;
    return true;
  });
};

export const sanitizeTechnicalErrorMessage = (
  value: any,
  fallback = 'Nao foi possivel carregar os dados agora. Tente novamente em alguns instantes.'
): string => {
  const raw =
    value instanceof Error
      ? value.message
      : value && typeof value === 'object'
        ? value.message || value.error || value.details || ''
        : value;
  const text = cleanString(raw);
  if (!text) return fallback;
  if (containsTechnicalId(text) || INFRA_TERMS_PATTERN.test(text)) return fallback;
  return text;
};
