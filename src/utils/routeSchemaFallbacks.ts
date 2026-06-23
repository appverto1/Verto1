type SupabaseLike = {
  from: (table: string) => any;
};

type LoggerLike = Pick<Console, 'warn'>;

// Centraliza selects tolerantes a schemas legados usados por rotas do portal.
export type PatientListRole = 'coordinator' | 'receptionist' | 'therapist' | 'admin' | 'owner' | string;

export const PROFILE_SELECT_COLUMNS = [
  'id',
  'email',
  'name',
  'role',
  'clinic_id',
  'subscription_status',
  'subscription_id',
  'plan_name',
  'plan_price',
  'billing_model',
  'is_demo_user',
  'demo_role',
  'demo_access_mode',
  'demo_expires_at',
  'type',
  'status',
  'phone',
  'age',
  'cpf',
  'crp',
  'council',
  'council_number',
  'specialties',
  'mini_curriculum',
  'profile_picture',
  'profile_picture_path',
  'signature_url',
  'signature_data_url',
  'two_factor_enabled',
  'email_verified_at',
  'phone_verified_at',
  'first_login_completed',
  'created_at',
  'updated_at'
];

export const PROFILE_AUTH_SELECT_COLUMNS = [
  ...PROFILE_SELECT_COLUMNS,
  'two_factor_secret'
];

export const PROFILE_LEGACY_SELECT_COLUMNS = [
  'id',
  'email',
  'name',
  'role',
  'clinic_id',
  'status',
  'created_at'
];

export const INVITATION_SELECT_COLUMNS = [
  'id',
  'email',
  'clinic_id',
  'clinic_name',
  'role',
  'status',
  'invited_by',
  'required_onboarding_fields',
  'created_at',
  'updated_at',
  'accepted_at',
  'canceled_at',
  'canceled_by'
];

export const INVITATION_LEGACY_SELECT_COLUMNS = [
  'id',
  'email',
  'clinic_id',
  'role',
  'status',
  'created_at'
];

export const PATIENT_LIST_SELECT_COLUMNS = [
  'id',
  'name',
  'email',
  'cpf',
  'phone',
  'age',
  'diagnosis',
  'type',
  'social_name',
  'birth_date',
  'gender',
  'patient_profile_type',
  'panel_type',
  'profile_type',
  'insurance_type',
  'insurance_name',
  'insurance_card_number',
  'patient_group',
  'lead_source',
  'notes',
  'rg',
  'cep',
  'responsible_name',
  'responsible_birth_date',
  'responsible_cpf',
  'responsible_phone',
  'responsible_email',
  'responsible_relationship',
  'metadata',
  'onboarding_status',
  'anamnesis_required',
  'anamnesis_requested_at',
  'anamnesis_submitted_at',
  'anamnesis_reviewed_at',
  'relationship_status',
  'status',
  'clinic_id',
  'is_demo',
  'therapist_id',
  'professional_id',
  'is_active',
  'deleted_at',
  'created_at',
  'updated_at'
];

export const PATIENT_LIST_LEGACY_SELECT_COLUMNS = [
  'id',
  'name',
  'email',
  'age',
  'diagnosis',
  'status',
  'clinic_id',
  'therapist_id',
  'created_at',
  'updated_at'
];

export const NOTE_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'type',
  'subject',
  'content',
  'assigned_task_id',
  'source',
  'portability_scope',
  'is_portable',
  'shared_with_patient',
  'shared_with_professionals',
  'original_organization_id',
  'original_author_id',
  'created_at',
  'is_active',
  'deleted_at'
];

export const NOTE_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'type',
  'subject',
  'content',
  'created_at'
];

export const PROFESSIONAL_PROFILE_SELECT_COLUMNS = [
  'user_id',
  'full_name',
  'birth_date',
  'gender',
  'country_code',
  'phone',
  'profile_photo_url',
  'clinic_name',
  'clinic_logo_url',
  'clinic_phone',
  'specialty',
  'council',
  'council_number',
  'signature_data_url',
  'requires_onboarding',
  'onboarding_completed_at',
  'address',
  'metadata',
  'created_at',
  'updated_at'
];

export const PROFESSIONAL_PROFILE_LEGACY_SELECT_COLUMNS = [
  'user_id',
  'full_name',
  'phone',
  'profile_photo_url',
  'council',
  'council_number',
  'signature_data_url',
  'metadata'
];

export const HISTORY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'type',
  'title',
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
];

export const HISTORY_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'type',
  'title',
  'score',
  'energy',
  'note',
  'icon',
  'therapist_id',
  'created_at'
];

export const TASK_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'title',
  'description',
  'color',
  'completed',
  'is_daily_reminder',
  'linked_task',
  'scheduled_at',
  'therapist_id',
  'pro_score',
  'max_score',
  'created_at',
  'updated_at',
  'is_active',
  'deleted_at'
];

export const TASK_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'title',
  'description',
  'completed',
  'created_at'
];

export const ASSIGNED_TASK_SELECT_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'patient_email',
  'professional_id',
  'task_type',
  'task_data',
  'scheduled_at',
  'patient_effort',
  'patient_effort_emoji',
  'patient_effort_label',
  'patient_comment',
  'pro_score',
  'max_score',
  'pro_review_note',
  'reviewed_by',
  'status',
  'completed_at',
  'reviewed_at',
  'last_history_event_id',
  'last_private_note_id',
  'parent_assigned_task_id',
  'created_at',
  'updated_at'
];

export const ASSIGNED_TASK_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_email',
  'task_type',
  'task_data',
  'scheduled_at',
  'status',
  'created_at'
];

export const PATIENT_LOG_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'professional_id',
  'type',
  'value',
  'timestamp',
  'created_at'
];

export const PATIENT_LOG_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'type',
  'value',
  'timestamp',
  'created_at'
];

export const PATIENT_FILE_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'file_name',
  'storage_path',
  'mime_type',
  'file_size_bytes',
  'source',
  'created_at',
  'metadata'
];

export const PATIENT_FILE_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'file_name',
  'storage_path',
  'mime_type',
  'created_at'
];

export const PATIENT_RECORD_SELECT_COLUMNS = [
  'patient_id',
  'clinic_id',
  'pseudonym_id',
  'payload_encrypted',
  'payload_preview',
  'updated_at'
];

export const PATIENT_RECORD_LEGACY_SELECT_COLUMNS = [
  'patient_id',
  'payload_encrypted'
];

export const PATIENT_ANAMNESIS_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'professional_id',
  'title',
  'reference_date',
  'profile_type',
  'template_version',
  'anamnesis_data',
  'patient_file_id',
  'created_at'
];

export const PATIENT_ANAMNESIS_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'title',
  'reference_date',
  'anamnesis_data',
  'created_at'
];

export const CLINIC_STATE_SELECT_COLUMNS = [
  'clinic_id',
  'rooms',
  'appointments',
  'protocols',
  'specialty_settings',
  'updated_at'
];

export const CLINIC_STATE_LEGACY_SELECT_COLUMNS = [
  'clinic_id',
  'rooms',
  'appointments',
  'protocols',
  'updated_at'
];

export const CLINIC_ANAMNESIS_TEMPLATE_SELECT_COLUMNS = [
  'template_json',
  'updated_at'
];

export const CLINIC_ANAMNESIS_TEMPLATE_LEGACY_SELECT_COLUMNS = [
  'template_json'
];

export const PAYMENT_SELECT_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'patient_name',
  'amount',
  'payment_date',
  'due_date',
  'method',
  'status',
  'receipt_url',
  'receipt_file_name',
  'receipt_content_type',
  'type',
  'insurance_name',
  'specialty',
  'base_amount',
  'additional_amount',
  'additional_scope',
  'is_recurring',
  'recurrence_group_id',
  'recurrence_index',
  'recurrence_total',
  'recurrence_frequency',
  'notes',
  'created_by',
  'created_at',
  'updated_at'
];

export const PAYMENT_LEGACY_SELECT_COLUMNS = [
  'id',
  'patient_id',
  'patient_name',
  'amount',
  'payment_date',
  'method',
  'status',
  'receipt_url',
  'created_at'
];

export const PROFESSIONAL_PAYMENT_SELECT_COLUMNS = [
  'id',
  'clinic_id',
  'professional_id',
  'professional_name',
  'specialty',
  'amount',
  'payment_date',
  'due_date',
  'method',
  'status',
  'receipt_url',
  'receipt_file_name',
  'receipt_content_type',
  'base_amount',
  'additional_amount',
  'additional_scope',
  'is_recurring',
  'recurrence_group_id',
  'recurrence_index',
  'recurrence_total',
  'recurrence_frequency',
  'notes',
  'created_by',
  'created_at',
  'updated_at'
];

export const PROFESSIONAL_PAYMENT_LEGACY_SELECT_COLUMNS = [
  'id',
  'professional_id',
  'professional_name',
  'amount',
  'payment_date',
  'due_date',
  'method',
  'status',
  'created_at'
];

export const FINANCIAL_ENTRY_SELECT_COLUMNS = [
  'id',
  'clinic_id',
  'entry_type',
  'category',
  'description',
  'amount',
  'occurred_on',
  'status',
  'source',
  'notes',
  'created_by',
  'created_at',
  'updated_at'
];

export const FINANCIAL_ENTRY_LEGACY_SELECT_COLUMNS = [
  'id',
  'entry_type',
  'category',
  'description',
  'amount',
  'occurred_on',
  'status',
  'created_at'
];

export const PROFILE_SELECT = PROFILE_SELECT_COLUMNS.join(',');
export const PROFILE_LEGACY_SELECT = PROFILE_LEGACY_SELECT_COLUMNS.join(',');
export const INVITATION_SELECT = INVITATION_SELECT_COLUMNS.join(',');
export const INVITATION_LEGACY_SELECT = INVITATION_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_LIST_SELECT = PATIENT_LIST_SELECT_COLUMNS.join(',');
export const PATIENT_LIST_LEGACY_SELECT = PATIENT_LIST_LEGACY_SELECT_COLUMNS.join(',');
export const NOTE_SELECT = NOTE_SELECT_COLUMNS.join(',');
export const NOTE_LEGACY_SELECT = NOTE_LEGACY_SELECT_COLUMNS.join(',');
export const PROFESSIONAL_PROFILE_SELECT = PROFESSIONAL_PROFILE_SELECT_COLUMNS.join(',');
export const PROFESSIONAL_PROFILE_LEGACY_SELECT = PROFESSIONAL_PROFILE_LEGACY_SELECT_COLUMNS.join(',');
export const HISTORY_SELECT = HISTORY_SELECT_COLUMNS.join(',');
export const HISTORY_LEGACY_SELECT = HISTORY_LEGACY_SELECT_COLUMNS.join(',');
export const TASK_SELECT = TASK_SELECT_COLUMNS.join(',');
export const TASK_LEGACY_SELECT = TASK_LEGACY_SELECT_COLUMNS.join(',');
export const ASSIGNED_TASK_SELECT = ASSIGNED_TASK_SELECT_COLUMNS.join(',');
export const ASSIGNED_TASK_LEGACY_SELECT = ASSIGNED_TASK_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_LOG_SELECT = PATIENT_LOG_SELECT_COLUMNS.join(',');
export const PATIENT_LOG_LEGACY_SELECT = PATIENT_LOG_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_FILE_SELECT = PATIENT_FILE_SELECT_COLUMNS.join(',');
export const PATIENT_FILE_LEGACY_SELECT = PATIENT_FILE_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_RECORD_SELECT = PATIENT_RECORD_SELECT_COLUMNS.join(',');
export const PATIENT_RECORD_LEGACY_SELECT = PATIENT_RECORD_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_ANAMNESIS_SELECT = PATIENT_ANAMNESIS_SELECT_COLUMNS.join(',');
export const PATIENT_ANAMNESIS_LEGACY_SELECT = PATIENT_ANAMNESIS_LEGACY_SELECT_COLUMNS.join(',');
export const CLINIC_STATE_SELECT = CLINIC_STATE_SELECT_COLUMNS.join(',');
export const CLINIC_STATE_LEGACY_SELECT = CLINIC_STATE_LEGACY_SELECT_COLUMNS.join(',');
export const CLINIC_ANAMNESIS_TEMPLATE_SELECT = CLINIC_ANAMNESIS_TEMPLATE_SELECT_COLUMNS.join(',');
export const CLINIC_ANAMNESIS_TEMPLATE_LEGACY_SELECT = CLINIC_ANAMNESIS_TEMPLATE_LEGACY_SELECT_COLUMNS.join(',');
export const PAYMENT_SELECT = PAYMENT_SELECT_COLUMNS.join(',');
export const PAYMENT_LEGACY_SELECT = PAYMENT_LEGACY_SELECT_COLUMNS.join(',');
export const PROFESSIONAL_PAYMENT_SELECT = PROFESSIONAL_PAYMENT_SELECT_COLUMNS.join(',');
export const PROFESSIONAL_PAYMENT_LEGACY_SELECT = PROFESSIONAL_PAYMENT_LEGACY_SELECT_COLUMNS.join(',');
export const FINANCIAL_ENTRY_SELECT = FINANCIAL_ENTRY_SELECT_COLUMNS.join(',');
export const FINANCIAL_ENTRY_LEGACY_SELECT = FINANCIAL_ENTRY_LEGACY_SELECT_COLUMNS.join(',');

const PROFILE_OPTIONAL_COLUMNS = new Set([
  'email',
  'name',
  'clinic_id',
  'subscription_status',
  'subscription_id',
  'plan_name',
  'plan_price',
  'type',
  'status',
  'phone',
  'age',
  'cpf',
  'crp',
  'council',
  'council_number',
  'specialties',
  'mini_curriculum',
  'profile_picture',
  'profile_picture_path',
  'signature_url',
  'signature_data_url',
  'two_factor_enabled',
  'two_factor_secret',
  'email_verified_at',
  'phone_verified_at',
  'first_login_completed',
  'created_at',
  'updated_at'
]);

const PROFILE_SCHEMA_FALLBACK_MAX_ATTEMPTS = PROFILE_OPTIONAL_COLUMNS.size + 2;

const INVITATION_OPTIONAL_COLUMNS = new Set([
  'clinic_name',
  'invited_by',
  'required_onboarding_fields',
  'updated_at',
  'accepted_at',
  'canceled_at',
  'canceled_by'
]);

const PATIENT_LIST_OPTIONAL_COLUMNS = new Set([
  'cpf',
  'phone',
  'type',
  'social_name',
  'birth_date',
  'gender',
  'patient_profile_type',
  'panel_type',
  'profile_type',
  'insurance_type',
  'insurance_name',
  'insurance_card_number',
  'patient_group',
  'lead_source',
  'notes',
  'rg',
  'cep',
  'responsible_name',
  'responsible_birth_date',
  'responsible_cpf',
  'responsible_phone',
  'responsible_email',
  'responsible_relationship',
  'metadata',
  'onboarding_status',
  'anamnesis_required',
  'anamnesis_requested_at',
  'anamnesis_submitted_at',
  'anamnesis_reviewed_at',
  'relationship_status',
  'professional_id',
  'is_active',
  'deleted_at'
]);

const NOTE_OPTIONAL_COLUMNS = new Set([
  'patient_email',
  'type',
  'visibility',
  'subject',
  'content',
  'note',
  'assigned_task_id',
  'source',
  'portability_scope',
  'is_portable',
  'shared_with_patient',
  'shared_with_professionals',
  'original_organization_id',
  'original_author_id',
  'created_by',
  'created_at',
  'updated_at',
  'is_active',
  'deleted_at',
  'pinned',
  'category',
  'note_type',
  'author_name',
  'created_by_name',
  'organization_id',
  'clinic_id'
]);

const PROFESSIONAL_PROFILE_OPTIONAL_COLUMNS = new Set([
  'full_name',
  'birth_date',
  'gender',
  'country_code',
  'phone',
  'profile_photo_url',
  'clinic_name',
  'clinic_logo_url',
  'clinic_phone',
  'specialty',
  'council',
  'council_number',
  'signature_data_url',
  'requires_onboarding',
  'onboarding_completed_at',
  'address',
  'metadata',
  'created_at',
  'updated_at'
]);

const HISTORY_OPTIONAL_COLUMNS = new Set([
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
  'updated_at',
  'is_active',
  'deleted_at'
]);

const TASK_OPTIONAL_COLUMNS = new Set([
  'patient_email',
  'title',
  'description',
  'type',
  'icon',
  'color',
  'completed',
  'is_daily_reminder',
  'linked_task',
  'scheduled_at',
  'therapist_id',
  'pro_score',
  'max_score',
  'created_at',
  'updated_at',
  'is_active',
  'deleted_at'
]);

const ASSIGNED_TASK_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'professional_id',
  'scheduled_at',
  'patient_effort',
  'patient_effort_emoji',
  'patient_effort_label',
  'patient_comment',
  'pro_score',
  'max_score',
  'pro_review_note',
  'reviewed_by',
  'status',
  'completed_at',
  'reviewed_at',
  'last_history_event_id',
  'last_private_note_id',
  'parent_assigned_task_id',
  'updated_at'
]);

const PATIENT_LOG_OPTIONAL_COLUMNS = new Set([
  'professional_id',
  'timestamp'
]);

const PATIENT_FILE_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'file_size_bytes',
  'source',
  'metadata'
]);

const PATIENT_RECORD_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'pseudonym_id',
  'payload_preview',
  'updated_at'
]);

const PATIENT_ANAMNESIS_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'professional_id',
  'profile_type',
  'template_version',
  'patient_file_id'
]);

const CLINIC_STATE_OPTIONAL_COLUMNS = new Set([
  'specialty_settings',
  'updated_at'
]);

const CLINIC_ANAMNESIS_TEMPLATE_OPTIONAL_COLUMNS = new Set([
  'updated_at'
]);

const PAYMENT_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'due_date',
  'method',
  'receipt_url',
  'receipt_file_name',
  'receipt_content_type',
  'type',
  'insurance_name',
  'specialty',
  'base_amount',
  'additional_amount',
  'additional_scope',
  'is_recurring',
  'recurrence_group_id',
  'recurrence_index',
  'recurrence_total',
  'recurrence_frequency',
  'notes',
  'created_by',
  'updated_at'
]);

const PROFESSIONAL_PAYMENT_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'professional_id',
  'specialty',
  'due_date',
  'method',
  'receipt_url',
  'receipt_file_name',
  'receipt_content_type',
  'base_amount',
  'additional_amount',
  'additional_scope',
  'is_recurring',
  'recurrence_group_id',
  'recurrence_index',
  'recurrence_total',
  'recurrence_frequency',
  'notes',
  'created_by',
  'updated_at'
]);

const FINANCIAL_ENTRY_OPTIONAL_COLUMNS = new Set([
  'clinic_id',
  'source',
  'notes',
  'created_by',
  'updated_at'
]);

function cleanString(value: unknown, maxLength = 1000): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function joinColumns(columns: string[]): string {
  return Array.from(new Set(columns.filter(Boolean))).join(',');
}

function errorLogFields(error: any) {
  return {
    code: cleanString(error?.code, 40) || null,
    message: cleanString(error?.message || error, 500) || null,
    details: cleanString(error?.details, 500) || null,
    hint: cleanString(error?.hint, 500) || null
  };
}

export function extractMissingColumnNameFromSupabaseError(error: any): string | null {
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000);
  if (!message) return null;

  const directMatch = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (directMatch?.[1]) return cleanString(directMatch[1], 120).toLowerCase();

  const qualifiedMatch = message.match(/column\s+[a-zA-Z0-9_]+\."?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (qualifiedMatch?.[1]) return cleanString(qualifiedMatch[1], 120).toLowerCase();

  const postgrestCacheMatch = message.match(
    /could\s+not\s+find\s+the\s+'?([a-zA-Z0-9_]+)'?\s+column\s+of\s+'?[a-zA-Z0-9_.]+'?\s+in\s+the\s+schema\s+cache/i
  );
  if (postgrestCacheMatch?.[1]) return cleanString(postgrestCacheMatch[1], 120).toLowerCase();

  return null;
}

function isMissingRelationError(error: any): boolean {
  const code = cleanString(error?.code, 20).toUpperCase();
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  return (
    code === '42P01' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('could not find') && message.includes('relationship') && message.includes('schema cache'))
  );
}

function isAuthOrPermissionError(error: any): boolean {
  const code = cleanString(error?.code, 40).toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    code === '401' ||
    code === '403' ||
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    code === '28P01' ||
    message.includes('permission denied') ||
    message.includes('row-level security') ||
    message.includes('jwt') ||
    message.includes('unauthorized') ||
    message.includes('forbidden')
  );
}

export function isSchemaFallbackErrorFromSupabase(error: any): boolean {
  if (!error || isAuthOrPermissionError(error)) return false;
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  return (
    Boolean(extractMissingColumnNameFromSupabaseError(error)) ||
    isMissingRelationError(error) ||
    (message.includes('schema cache') && message.includes('could not find')) ||
    (message.includes('column') && message.includes('does not exist')) ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function findMentionedColumn(error: any, columns: Set<string>): string | null {
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  if (!message) return null;
  for (const column of columns) {
    const escaped = column.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i');
    if (pattern.test(message)) return column;
  }
  return null;
}

function warnSchemaFallback(logger: LoggerLike | undefined, params: {
  route: string;
  table: string;
  missingColumn?: string | null;
  removedColumn?: string | null;
  nextSelect: string;
  stage?: 'primary_select' | 'legacy_select' | 'fallback_empty';
  patientId?: string | null;
  requestId?: string | null;
  error?: any;
}) {
  const removedColumn = cleanString(params.removedColumn || params.missingColumn, 120) || null;
  logger?.warn?.(`[Schema fallback:${params.route}]`, {
    route: params.route,
    patientId: cleanString(params.patientId, 120) || null,
    requestId: cleanString(params.requestId, 160) || null,
    stage: params.stage || 'primary_select',
    table: params.table,
    removedColumn,
    missingColumn: removedColumn,
    nextSelect: params.nextSelect,
    error: params.error ? errorLogFields(params.error) : undefined
  });
}

async function fetchListWithColumnFallback(params: {
  supabase: SupabaseLike;
  route: string;
  table: string;
  initialColumns: string[];
  legacyColumns?: string[];
  optionalColumns: Set<string>;
  logger?: LoggerLike;
  maxAttempts?: number;
  fallbackEmptyOnSchemaError?: boolean;
  patientId?: string | null;
  requestId?: string | null;
  buildQuery: (selectColumns: string, removedColumns: Set<string>) => any;
}) {
  const runStage = async (stage: 'primary_select' | 'legacy_select', baseColumns: string[]) => {
    let columns = [...baseColumns];
    const removedColumns = new Set<string>();
    let lastError: any = null;

    for (let attempt = 0; attempt < (params.maxAttempts || 12); attempt += 1) {
      const result = await params.buildQuery(joinColumns(columns), removedColumns);

      if (!result.error) {
        return {
          data: Array.isArray(result.data) ? result.data : [],
          error: null,
          select: joinColumns(columns),
          removedColumns,
          stage
        };
      }

      lastError = result.error;
      const missingColumn =
        extractMissingColumnNameFromSupabaseError(result.error) ||
        findMentionedColumn(result.error, params.optionalColumns);

      if (!missingColumn || !params.optionalColumns.has(missingColumn) || removedColumns.has(missingColumn)) {
        break;
      }

      removedColumns.add(missingColumn);
      if (columns.includes(missingColumn)) {
        columns = columns.filter((column) => column !== missingColumn);
      }

      warnSchemaFallback(params.logger, {
        route: params.route,
        table: params.table,
        missingColumn,
        nextSelect: joinColumns(columns),
        stage,
        patientId: params.patientId,
        requestId: params.requestId,
        error: result.error
      });
    }

    return {
      data: null,
      error: lastError,
      select: joinColumns(columns),
      removedColumns,
      stage
    };
  };

  const primaryResult = await runStage('primary_select', params.initialColumns);
  if (!primaryResult.error) return primaryResult;

  let finalResult = primaryResult;
  if (params.legacyColumns?.length) {
    warnSchemaFallback(params.logger, {
      route: params.route,
      table: params.table,
      missingColumn: extractMissingColumnNameFromSupabaseError(primaryResult.error) || 'schema',
      nextSelect: joinColumns(params.legacyColumns),
      stage: 'legacy_select',
      patientId: params.patientId,
      requestId: params.requestId,
      error: primaryResult.error
    });
    const legacyResult = await runStage('legacy_select', params.legacyColumns);
    if (!legacyResult.error) return legacyResult;
    finalResult = legacyResult;
  }

  if (params.fallbackEmptyOnSchemaError && isSchemaFallbackErrorFromSupabase(finalResult.error)) {
    warnSchemaFallback(params.logger, {
      route: params.route,
      table: params.table,
      missingColumn: extractMissingColumnNameFromSupabaseError(finalResult.error) || 'schema',
      nextSelect: finalResult.select,
      stage: 'fallback_empty',
      patientId: params.patientId,
      requestId: params.requestId,
      error: finalResult.error
    });
    return {
      data: [],
      error: null,
      select: finalResult.select,
      removedColumns: finalResult.removedColumns,
      stage: 'fallback_empty'
    };
  }

  return finalResult;
}

async function fetchMaybeSingleWithColumnFallback(params: {
  supabase: SupabaseLike;
  route: string;
  table: string;
  initialColumns: string[];
  optionalColumns: Set<string>;
  logger?: LoggerLike;
  maxAttempts?: number;
  buildQuery: (selectColumns: string, removedColumns: Set<string>) => any;
}) {
  let columns = [...params.initialColumns];
  const removedColumns = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < (params.maxAttempts || 10); attempt += 1) {
    const result = await params.buildQuery(joinColumns(columns), removedColumns);

    if (!result.error) {
      return {
        data: result.data || null,
        error: null,
        select: joinColumns(columns),
        removedColumns
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, params.optionalColumns);

    if (!missingColumn || !params.optionalColumns.has(missingColumn) || removedColumns.has(missingColumn)) {
      break;
    }

    removedColumns.add(missingColumn);
    if (columns.includes(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
    }

    warnSchemaFallback(params.logger, {
      route: params.route,
      table: params.table,
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return {
    data: null,
    error: lastError,
    select: joinColumns(columns),
    removedColumns
  };
}

export async function fetchProfileWithSchemaFallback(params: {
  supabase: SupabaseLike;
  userId: string | null;
  logger?: LoggerLike;
  includeTwoFactorSecret?: boolean;
}) {
  let columns = params.includeTwoFactorSecret ? [...PROFILE_AUTH_SELECT_COLUMNS] : [...PROFILE_SELECT_COLUMNS];
  let lastError: any = null;

  for (let attempt = 0; attempt < PROFILE_SCHEMA_FALLBACK_MAX_ATTEMPTS; attempt += 1) {
    const result = await params.supabase
      .from('users')
      .select(joinColumns(columns))
      .eq('id', cleanString(params.userId, 120))
      .maybeSingle();

    if (!result.error) {
      return {
        data: result.data || null,
        error: null,
        select: joinColumns(columns)
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, PROFILE_OPTIONAL_COLUMNS);
    if (!missingColumn || !PROFILE_OPTIONAL_COLUMNS.has(missingColumn) || !columns.includes(missingColumn)) break;

    columns = columns.filter((column) => column !== missingColumn);
    warnSchemaFallback(params.logger, {
      route: '/api/profile/:userId',
      table: 'users',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
}

export async function fetchProfileByEmailWithSchemaFallback(params: {
  supabase: SupabaseLike;
  email: string | null;
  logger?: LoggerLike;
}) {
  let columns = [...PROFILE_SELECT_COLUMNS];
  let lastError: any = null;
  let shouldOrderByCreatedAt = true;
  const email = cleanString(params.email, 320).toLowerCase();

  for (let attempt = 0; attempt < PROFILE_SCHEMA_FALLBACK_MAX_ATTEMPTS; attempt += 1) {
    let query = params.supabase
      .from('users')
      .select(joinColumns(columns))
      .ilike('email', email);

    if (shouldOrderByCreatedAt && columns.includes('created_at')) {
      query = query.order('created_at', { ascending: false });
    }

    const result = await query.limit(1).maybeSingle();

    if (!result.error) {
      return {
        data: result.data || null,
        error: null,
        select: joinColumns(columns)
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, PROFILE_OPTIONAL_COLUMNS);
    if (!missingColumn || !PROFILE_OPTIONAL_COLUMNS.has(missingColumn)) break;

    if (missingColumn === 'created_at') {
      shouldOrderByCreatedAt = false;
    }

    if (columns.includes(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
    }

    warnSchemaFallback(params.logger, {
      route: '/api/auth/login',
      table: 'users',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
}

export async function fetchProfessionalProfileWithSchemaFallback(params: {
  supabase: SupabaseLike;
  userId: string | null;
  logger?: LoggerLike;
}) {
  let columns = [...PROFESSIONAL_PROFILE_SELECT_COLUMNS];
  let lastError: any = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await params.supabase
      .from('professional_profiles')
      .select(joinColumns(columns))
      .eq('user_id', cleanString(params.userId, 120))
      .maybeSingle();

    if (!result.error) {
      return {
        data: result.data || null,
        error: null,
        select: joinColumns(columns)
      };
    }

    if (isMissingRelationError(result.error)) {
      warnSchemaFallback(params.logger, {
        route: '/api/profile/:userId',
        table: 'professional_profiles',
        missingColumn: 'relation',
        nextSelect: 'null'
      });
      return { data: null, error: null, select: joinColumns(columns) };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, PROFESSIONAL_PROFILE_OPTIONAL_COLUMNS);
    if (
      !missingColumn ||
      !PROFESSIONAL_PROFILE_OPTIONAL_COLUMNS.has(missingColumn) ||
      !columns.includes(missingColumn)
    ) {
      break;
    }

    columns = columns.filter((column) => column !== missingColumn);
    warnSchemaFallback(params.logger, {
      route: '/api/profile/:userId',
      table: 'professional_profiles',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
}

export async function fetchPatientEmailForNotesWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId: string | null;
  route?: string;
  requestId?: string | null;
  logger?: LoggerLike;
}) {
  let filterIsActive = true;
  let filterDeletedAt = true;
  let lastError: any = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let query = params.supabase
      .from('patients')
      .select('email')
      .eq('id', cleanString(params.patientId, 120));

    if (filterIsActive) query = query.eq('is_active', true);
    if (filterDeletedAt) query = query.is('deleted_at', null);

    const result = await query.maybeSingle();
    if (!result.error) {
      return { data: result.data || null, error: null };
    }

    lastError = result.error;
    const missingColumn = extractMissingColumnNameFromSupabaseError(result.error);
    if (missingColumn === 'is_active' && filterIsActive) {
      filterIsActive = false;
    } else if (missingColumn === 'deleted_at' && filterDeletedAt) {
      filterDeletedAt = false;
    } else {
      break;
    }

    warnSchemaFallback(params.logger, {
      route: params.route || '/api/notes/:patientId',
      table: 'patients',
      missingColumn,
      nextSelect: 'email',
      stage: 'primary_select',
      patientId: params.patientId,
      requestId: params.requestId,
      error: result.error
    });
  }

  if (lastError && isSchemaFallbackErrorFromSupabase(lastError)) {
    warnSchemaFallback(params.logger, {
      route: params.route || '/api/notes/:patientId',
      table: 'patients',
      missingColumn: extractMissingColumnNameFromSupabaseError(lastError) || 'schema',
      nextSelect: 'email',
      stage: 'fallback_empty',
      patientId: params.patientId,
      requestId: params.requestId,
      error: lastError
    });
    return { data: null, error: null };
  }

  return { data: null, error: lastError };
}

export async function fetchHistoryWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId?: string | null;
  patientEmail?: string | null;
  excludePatientId?: string | null;
  patientIds?: string[];
  limit: number;
  route?: string;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: params.route || '/api/history/:patientId',
    table: 'history',
    initialColumns: HISTORY_SELECT_COLUMNS,
    optionalColumns: new Set([...HISTORY_OPTIONAL_COLUMNS, 'patient_email']),
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('history').select(selectColumns);
      const patientId = cleanString(params.patientId, 120);
      const patientEmail = cleanString(params.patientEmail, 320).toLowerCase();
      const excludePatientId = cleanString(params.excludePatientId, 120);
      const patientIds = Array.from(new Set((params.patientIds || []).map((id) => cleanString(id, 120)).filter(Boolean)));

      if (patientEmail && removedColumns.has('patient_email')) return { data: [], error: null };
      if (patientId) query = query.eq('patient_id', patientId);
      if (patientEmail) query = query.eq('patient_email', patientEmail);
      if (excludePatientId) query = query.neq('patient_id', excludePatientId);
      if (patientIds.length > 0) query = query.in('patient_id', patientIds);
      if (!removedColumns.has('is_active')) query = query.eq('is_active', true);
      if (!removedColumns.has('deleted_at')) query = query.is('deleted_at', null);

      return query.order('created_at', { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchTasksWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId?: string | null;
  patientEmail?: string | null;
  excludePatientId?: string | null;
  patientIds?: string[];
  emailMatch?: 'eq' | 'ilike';
  limit: number;
  route?: string;
  requestId?: string | null;
  logger?: LoggerLike;
}) {
  const result = await fetchListWithColumnFallback({
    supabase: params.supabase,
    route: params.route || '/api/tasks/:patientId',
    table: 'tasks',
    initialColumns: TASK_SELECT_COLUMNS,
    legacyColumns: TASK_LEGACY_SELECT_COLUMNS,
    optionalColumns: new Set([...TASK_OPTIONAL_COLUMNS, 'patient_email']),
    logger: params.logger,
    fallbackEmptyOnSchemaError: true,
    patientId: params.patientId,
    requestId: params.requestId,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('tasks').select(selectColumns);
      const patientId = cleanString(params.patientId, 120);
      const patientEmail = cleanString(params.patientEmail, 320).toLowerCase();
      const excludePatientId = cleanString(params.excludePatientId, 120);
      const patientIds = Array.from(new Set((params.patientIds || []).map((id) => cleanString(id, 120)).filter(Boolean)));

      if (patientEmail && removedColumns.has('patient_email')) return { data: [], error: null };
      if (patientId) query = query.eq('patient_id', patientId);
      if (patientEmail) {
        query = params.emailMatch === 'ilike'
          ? query.ilike('patient_email', patientEmail)
          : query.eq('patient_email', patientEmail);
      }
      if (excludePatientId) query = query.neq('patient_id', excludePatientId);
      if (patientIds.length > 0) query = query.in('patient_id', patientIds);
      if (!removedColumns.has('is_active')) query = query.eq('is_active', true);
      if (!removedColumns.has('deleted_at')) query = query.is('deleted_at', null);

      if (!removedColumns.has('created_at')) query = query.order('created_at', { ascending: false });
      return query.limit(params.limit);
    }
  });

  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map(normalizeTaskRowForUi) : result.data
  };
}

export async function fetchAssignedTasksWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId?: string | null;
  patientEmail?: string | null;
  patientIds?: string[];
  clinicId?: string | null;
  status?: string | null;
  emailMatch?: 'eq' | 'ilike';
  orderBy?: 'scheduled_at' | 'completed_at' | 'created_at';
  limit: number;
  route?: string;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: params.route || '/api/assigned-tasks/:patientId',
    table: 'assigned_tasks',
    initialColumns: ASSIGNED_TASK_SELECT_COLUMNS,
    optionalColumns: new Set([...ASSIGNED_TASK_OPTIONAL_COLUMNS, 'patient_email']),
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('assigned_tasks').select(selectColumns);
      const patientId = cleanString(params.patientId, 120);
      const patientEmail = cleanString(params.patientEmail, 320).toLowerCase();
      const clinicId = cleanString(params.clinicId, 120);
      const status = cleanString(params.status, 80);
      const patientIds = Array.from(new Set((params.patientIds || []).map((id) => cleanString(id, 120)).filter(Boolean)));

      if (patientEmail && removedColumns.has('patient_email')) return { data: [], error: null };
      if (patientId) query = query.eq('patient_id', patientId);
      if (patientEmail) {
        query = params.emailMatch === 'ilike'
          ? query.ilike('patient_email', patientEmail)
          : query.eq('patient_email', patientEmail);
      }
      if (patientIds.length > 0) query = query.in('patient_id', patientIds);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);
      if (status && !removedColumns.has('status')) query = query.eq('status', status);

      const preferredOrder = params.orderBy || 'scheduled_at';
      const orderColumn = removedColumns.has(preferredOrder) ? 'created_at' : preferredOrder;
      return query.order(orderColumn, { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchPatientLogsWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/patient-logs/:patientId',
    table: 'patient_logs',
    initialColumns: PATIENT_LOG_SELECT_COLUMNS,
    optionalColumns: PATIENT_LOG_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      const orderColumn = removedColumns.has('timestamp') ? 'created_at' : 'timestamp';
      return params.supabase
        .from('patient_logs')
        .select(selectColumns)
        .eq('patient_id', cleanString(params.patientId, 120))
        .order(orderColumn, { ascending: false })
        .limit(params.limit);
    }
  });
}

export async function fetchPatientFilesWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId: string | null;
  clinicId: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/patient-files/:patientId',
    table: 'patient_files',
    initialColumns: PATIENT_FILE_SELECT_COLUMNS,
    optionalColumns: PATIENT_FILE_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase
        .from('patient_files')
        .select(selectColumns)
        .eq('patient_id', cleanString(params.patientId, 120));

      const clinicId = cleanString(params.clinicId, 120);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);

      return query.order('created_at', { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchPatientRecordWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId: string | null;
  clinicId?: string | null;
  scopeByClinic?: boolean;
  logger?: LoggerLike;
}) {
  return fetchMaybeSingleWithColumnFallback({
    supabase: params.supabase,
    route: '/api/patient-records/:patientId',
    table: 'patient_records',
    initialColumns: PATIENT_RECORD_SELECT_COLUMNS,
    optionalColumns: PATIENT_RECORD_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase
        .from('patient_records')
        .select(selectColumns)
        .eq('patient_id', cleanString(params.patientId, 120));

      const clinicId = cleanString(params.clinicId, 120);
      if (params.scopeByClinic && clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);

      return query.maybeSingle();
    }
  });
}

export async function fetchPatientAnamnesisWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId: string | null;
  clinicId?: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/patient-anamnesis/:patientId',
    table: 'patient_anamnesis_submissions',
    initialColumns: PATIENT_ANAMNESIS_SELECT_COLUMNS,
    optionalColumns: PATIENT_ANAMNESIS_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase
        .from('patient_anamnesis_submissions')
        .select(selectColumns)
        .eq('patient_id', cleanString(params.patientId, 120));

      const clinicId = cleanString(params.clinicId, 120);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);

      return query.order('created_at', { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchClinicStateWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId: string | null;
  logger?: LoggerLike;
}) {
  return fetchMaybeSingleWithColumnFallback({
    supabase: params.supabase,
    route: '/api/clinic/state',
    table: 'clinic_state',
    initialColumns: CLINIC_STATE_SELECT_COLUMNS,
    optionalColumns: CLINIC_STATE_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns) => params.supabase
      .from('clinic_state')
      .select(selectColumns)
      .eq('clinic_id', cleanString(params.clinicId, 120))
      .maybeSingle()
  });
}

export async function fetchClinicAnamnesisTemplateWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId: string | null;
  logger?: LoggerLike;
}) {
  return fetchMaybeSingleWithColumnFallback({
    supabase: params.supabase,
    route: '/api/clinic/anamnesis-template',
    table: 'clinic_anamnesis_templates',
    initialColumns: CLINIC_ANAMNESIS_TEMPLATE_SELECT_COLUMNS,
    optionalColumns: CLINIC_ANAMNESIS_TEMPLATE_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns) => params.supabase
      .from('clinic_anamnesis_templates')
      .select(selectColumns)
      .eq('clinic_id', cleanString(params.clinicId, 120))
      .maybeSingle()
  });
}

export async function fetchPaymentsWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId?: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/payments',
    table: 'payments',
    initialColumns: PAYMENT_SELECT_COLUMNS,
    optionalColumns: PAYMENT_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('payments').select(selectColumns);
      const clinicId = cleanString(params.clinicId, 120);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);
      return query.order('payment_date', { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchProfessionalPaymentsWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId?: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/financial/professional-payments',
    table: 'professional_payments',
    initialColumns: PROFESSIONAL_PAYMENT_SELECT_COLUMNS,
    optionalColumns: PROFESSIONAL_PAYMENT_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('professional_payments').select(selectColumns);
      const clinicId = cleanString(params.clinicId, 120);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);
      return query.order(removedColumns.has('due_date') ? 'payment_date' : 'due_date', { ascending: false }).limit(params.limit);
    }
  });
}

export async function fetchFinancialEntriesWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId?: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  return fetchListWithColumnFallback({
    supabase: params.supabase,
    route: '/api/financial/entries',
    table: 'clinic_financial_entries',
    initialColumns: FINANCIAL_ENTRY_SELECT_COLUMNS,
    optionalColumns: FINANCIAL_ENTRY_OPTIONAL_COLUMNS,
    logger: params.logger,
    buildQuery: (selectColumns, removedColumns) => {
      let query = params.supabase.from('clinic_financial_entries').select(selectColumns);
      const clinicId = cleanString(params.clinicId, 120);
      if (clinicId && !removedColumns.has('clinic_id')) query = query.eq('clinic_id', clinicId);
      return query.order('occurred_on', { ascending: false }).limit(params.limit);
    }
  });
}

function noteIsReadableWithoutVisibility(note: any): boolean {
  const visibility = cleanString(note?.visibility, 40).toLowerCase();
  const legacyType = cleanString(note?.type, 40).toLowerCase();
  const metadata = note?.metadata && typeof note.metadata === 'object' ? note.metadata : {};
  return ['patient', 'shared', 'family', 'shared_patient'].includes(visibility) ||
    ['patient', 'shared', 'family', 'shared_patient'].includes(legacyType) ||
    note?.shared_with_patient === true ||
    metadata?.sharedWithPatient === true ||
    metadata?.visibleToPatient === true ||
    ['patient', 'shared', 'family', 'shared_patient'].includes(cleanString(metadata?.visibility, 40).toLowerCase());
}

function normalizeNoteRowForUi(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const type = cleanString(row.type, 80);
  const scope = cleanString(row.portability_scope, 80);
  const visibility =
    row.shared_with_patient === true || ['patient', 'shared', 'family', 'shared_patient'].includes(type.toLowerCase())
      ? 'shared_patient'
      : row.shared_with_professionals === true
        ? 'shared_clinic'
        : row.is_portable === true && scope
          ? scope
          : 'private';

  return {
    ...row,
    note: row.note ?? row.content ?? row.subject ?? '',
    text: row.text ?? row.content ?? row.note ?? '',
    created_by: row.created_by ?? row.original_author_id ?? null,
    createdBy: row.createdBy ?? row.created_by ?? row.original_author_id ?? null,
    updated_at: row.updated_at ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? row.created_at ?? null,
    visibility: row.visibility ?? visibility
  };
}

function normalizeTaskRowForUi(row: any): any {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    type: row.type ?? 'task',
    icon: row.icon ?? '📋',
    color: row.color ?? 'bg-blue-100 text-blue-600',
    updated_at: row.updated_at ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? row.created_at ?? null
  };
}

export async function fetchNotesWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId?: string | null;
  patientEmail?: string | null;
  patientIds?: string[];
  excludePatientId?: string | null;
  role: string;
  limit: number;
  route?: string;
  requestId?: string | null;
  logger?: LoggerLike;
}) {
  const route = params.route || '/api/notes/:patientId';
  const patientId = cleanString(params.patientId, 120);
  const patientEmail = cleanString(params.patientEmail, 320).toLowerCase();
  const patientIds = Array.from(new Set((params.patientIds || []).map((id) => cleanString(id, 120)).filter(Boolean)));
  const excludePatientId = cleanString(params.excludePatientId, 120);
  if (!patientId && !patientEmail && patientIds.length === 0) {
    params.logger?.warn?.('[PatientNotes] skipped: missing patientId', {
      route,
      patientId: null,
      requestId: cleanString(params.requestId, 160) || null
    });
    return {
      data: [],
      error: null,
      select: NOTE_SELECT,
      removedColumns: new Set<string>(),
      stage: 'fallback_empty'
    };
  }

  const runStage = async (stage: 'primary_select' | 'legacy_select', baseColumns: string[]) => {
    let columns = [...baseColumns];
    const removedColumns = new Set<string>();
    let filterIsActive = true;
    let filterDeletedAt = true;
    const shouldFilterPatientReadableNotes = cleanString(params.role, 40).toLowerCase() === 'patient';
    let lastError: any = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (patientEmail && removedColumns.has('patient_email')) {
        return { data: [], error: null, select: joinColumns(columns), removedColumns, stage };
      }

      let query = params.supabase.from('notes').select(joinColumns(columns));
      if (patientId) query = query.eq('patient_id', patientId);
      if (!patientId && patientIds.length > 0) query = query.in('patient_id', patientIds);
      if (patientEmail) query = query.eq('patient_email', patientEmail);
      if (excludePatientId) query = query.neq('patient_id', excludePatientId);
      if (filterIsActive && !removedColumns.has('is_active')) query = query.eq('is_active', true);
      if (filterDeletedAt && !removedColumns.has('deleted_at')) query = query.is('deleted_at', null);
      if (!removedColumns.has('created_at')) {
        query = query.order('created_at', { ascending: false });
      }

      const result = await query.limit(params.limit);

      if (!result.error) {
        const rows = (Array.isArray(result.data) ? result.data : []).map(normalizeNoteRowForUi);
        return {
          data: shouldFilterPatientReadableNotes
            ? rows.filter(noteIsReadableWithoutVisibility)
            : rows,
          error: null,
          select: joinColumns(columns),
          removedColumns,
          stage
        };
      }

      lastError = result.error;
      const missingColumn =
        extractMissingColumnNameFromSupabaseError(result.error) ||
        findMentionedColumn(result.error, NOTE_OPTIONAL_COLUMNS);
      if (!missingColumn || !NOTE_OPTIONAL_COLUMNS.has(missingColumn) || removedColumns.has(missingColumn)) {
        break;
      }

      removedColumns.add(missingColumn);
      if (columns.includes(missingColumn)) {
        columns = columns.filter((column) => column !== missingColumn);
      }
      if (missingColumn === 'is_active') filterIsActive = false;
      if (missingColumn === 'deleted_at') filterDeletedAt = false;

      warnSchemaFallback(params.logger, {
        route,
        table: 'notes',
        missingColumn,
        nextSelect: joinColumns(columns),
        stage,
        patientId,
        requestId: params.requestId,
        error: result.error
      });
    }

    return { data: null, error: lastError, select: joinColumns(columns), removedColumns, stage };
  };

  const primaryResult = await runStage('primary_select', NOTE_SELECT_COLUMNS);
  if (!primaryResult.error) return primaryResult;

  warnSchemaFallback(params.logger, {
    route,
    table: 'notes',
    missingColumn: extractMissingColumnNameFromSupabaseError(primaryResult.error) || 'schema',
    nextSelect: NOTE_LEGACY_SELECT,
    stage: 'legacy_select',
    patientId,
    requestId: params.requestId,
    error: primaryResult.error
  });
  const legacyResult = await runStage('legacy_select', NOTE_LEGACY_SELECT_COLUMNS);
  if (!legacyResult.error) return legacyResult;

  if (isSchemaFallbackErrorFromSupabase(legacyResult.error)) {
    warnSchemaFallback(params.logger, {
      route,
      table: 'notes',
      missingColumn: extractMissingColumnNameFromSupabaseError(legacyResult.error) || 'schema',
      nextSelect: legacyResult.select,
      stage: 'fallback_empty',
      patientId,
      requestId: params.requestId,
      error: legacyResult.error
    });
    return {
      data: [],
      error: null,
      select: legacyResult.select,
      removedColumns: legacyResult.removedColumns,
      stage: 'fallback_empty'
    };
  }

  return legacyResult;
}

export async function fetchPatientsWithSchemaFallback(params: {
  supabase: SupabaseLike;
  role: PatientListRole;
  userId?: string | null;
  clinicId?: string | null;
  limit: number;
  logger?: LoggerLike;
}) {
  let columns = [...PATIENT_LIST_SELECT_COLUMNS];
  let filterIsActive = true;
  let filterDeletedAt = true;
  let includeProfessionalScope = cleanString(params.role, 40).toLowerCase() === 'therapist';
  let lastError: any = null;

  for (let attempt = 0; attempt < PATIENT_LIST_OPTIONAL_COLUMNS.size + 4; attempt += 1) {
    let query = params.supabase
      .from('patients')
      .select(joinColumns(columns));

    if (filterIsActive) query = query.eq('is_active', true);
    if (filterDeletedAt) query = query.is('deleted_at', null);
    if (columns.includes('status')) {
      query = query.neq('status', 'ARCHIVED').neq('status', 'archived');
    }

    query = query
      .order('created_at', { ascending: false })
      .limit(params.limit);

    const role = cleanString(params.role, 40).toLowerCase();
    const clinicId = cleanString(params.clinicId, 120);
    const userId = cleanString(params.userId, 120);

    if (role === 'coordinator' || role === 'receptionist') {
      if (clinicId) query = query.eq('clinic_id', clinicId);
    } else if (role === 'therapist') {
      if (clinicId) query = query.eq('clinic_id', clinicId);
      if (includeProfessionalScope && columns.includes('professional_id')) {
        query = query.or(`therapist_id.eq.${userId},professional_id.eq.${userId}`);
      } else {
        query = query.eq('therapist_id', userId);
      }
    }

    const result = await query;
    if (!result.error) {
      return {
        data: Array.isArray(result.data) ? result.data : [],
        error: null,
        select: joinColumns(columns)
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, PATIENT_LIST_OPTIONAL_COLUMNS);
    if (!missingColumn) break;

    let handled = false;
    if (missingColumn === 'professional_id') {
      includeProfessionalScope = false;
      columns = columns.filter((column) => column !== 'professional_id');
      handled = true;
    } else if (missingColumn === 'is_active') {
      filterIsActive = false;
      columns = columns.filter((column) => column !== 'is_active');
      handled = true;
    } else if (missingColumn === 'deleted_at') {
      filterDeletedAt = false;
      columns = columns.filter((column) => column !== 'deleted_at');
      handled = true;
    } else if (PATIENT_LIST_OPTIONAL_COLUMNS.has(missingColumn) && columns.includes(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
      handled = true;
    }

    if (!handled) break;

    warnSchemaFallback(params.logger, {
      route: '/api/patients',
      table: 'patients',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
}

export async function fetchClinicInvitationsWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId: string | null;
  limit?: number;
  logger?: LoggerLike;
}) {
  let columns = [...INVITATION_SELECT_COLUMNS];
  let lastError: any = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await params.supabase
      .from('invitations')
      .select(joinColumns(columns))
      .eq('clinic_id', cleanString(params.clinicId, 120))
      .order('created_at', { ascending: false })
      .limit(params.limit || 200);

    if (!result.error) {
      return {
        data: Array.isArray(result.data) ? result.data : [],
        error: null,
        select: joinColumns(columns)
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, INVITATION_OPTIONAL_COLUMNS);
    if (!missingColumn || !INVITATION_OPTIONAL_COLUMNS.has(missingColumn) || !columns.includes(missingColumn)) {
      break;
    }

    columns = columns.filter((column) => column !== missingColumn);
    warnSchemaFallback(params.logger, {
      route: '/api/clinic/invitations',
      table: 'invitations',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
}

export async function fetchClinicMembershipHistoryWithSchemaFallback(params: {
  supabase: SupabaseLike;
  clinicId: string | null;
  logger?: LoggerLike;
}) {
  const clinicId = cleanString(params.clinicId, 120);
  const primarySelect = `
    user_id,
    role,
    status,
    updated_at,
    created_at,
    users:user_id (
      id,
      name,
      email
    )
  `;

  const primary = await params.supabase
    .from('clinic_memberships')
    .select(primarySelect)
    .eq('clinic_id', clinicId)
    .eq('status', 'inactive')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (!primary.error) {
    return { data: Array.isArray(primary.data) ? primary.data : [], error: null };
  }

  warnSchemaFallback(params.logger, {
    route: '/api/clinic/invitations',
    table: 'clinic_memberships',
    missingColumn: extractMissingColumnNameFromSupabaseError(primary.error) || 'users_relationship',
    nextSelect: 'user_id,role,status,updated_at,created_at'
  });

  const fallback = await params.supabase
    .from('clinic_memberships')
    .select('user_id,role,status,updated_at,created_at')
    .eq('clinic_id', clinicId)
    .eq('status', 'inactive')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (fallback.error) {
    warnSchemaFallback(params.logger, {
      route: '/api/clinic/invitations',
      table: 'clinic_memberships',
      missingColumn: extractMissingColumnNameFromSupabaseError(fallback.error) || 'membership_history',
      nextSelect: '[]'
    });
    return { data: [], error: null };
  }

  const rows = Array.isArray(fallback.data) ? fallback.data : [];
  const userIds = Array.from(new Set(
    rows
      .map((row: any) => cleanString(row?.user_id, 120))
      .filter(Boolean)
  ));
  const usersById = new Map<string, any>();

  if (userIds.length > 0) {
    const usersResult = await params.supabase
      .from('users')
      .select('id,name,email')
      .in('id', userIds)
      .limit(userIds.length);

    if (!usersResult.error && Array.isArray(usersResult.data)) {
      for (const user of usersResult.data) {
        const id = cleanString(user?.id, 120);
        if (id) usersById.set(id, user);
      }
    } else if (usersResult.error) {
      warnSchemaFallback(params.logger, {
        route: '/api/clinic/invitations',
        table: 'users',
        missingColumn: extractMissingColumnNameFromSupabaseError(usersResult.error) || 'user_lookup',
        nextSelect: 'membership rows without users'
      });
    }
  }

  return {
    data: rows.map((row: any) => ({
      ...row,
      users: usersById.get(cleanString(row?.user_id, 120)) || null
    })),
    error: null
  };
}
