type SupabaseLike = {
  from: (table: string) => any;
};

type LoggerLike = Pick<Console, 'warn'>;

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
  'status',
  'clinic_id',
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
  'visibility',
  'subject',
  'content',
  'note',
  'assigned_task_id',
  'source',
  'created_by',
  'created_at',
  'updated_at',
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
  'note',
  'created_by',
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

const PROFILE_OPTIONAL_COLUMNS = new Set([
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
  'professional_id',
  'is_active',
  'deleted_at'
]);

const NOTE_OPTIONAL_COLUMNS = new Set([
  'visibility',
  'assigned_task_id',
  'source',
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

function cleanString(value: unknown, maxLength = 1000): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function joinColumns(columns: string[]): string {
  return Array.from(new Set(columns.filter(Boolean))).join(',');
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

function findMentionedColumn(error: any, columns: Set<string>): string | null {
  const message = cleanString(error?.message || error?.details || error?.hint || error, 1000).toLowerCase();
  if (!message) return null;
  for (const column of columns) {
    if (message.includes(column.toLowerCase())) return column;
  }
  return null;
}

function warnSchemaFallback(logger: LoggerLike | undefined, params: {
  route: string;
  table: string;
  missingColumn: string;
  nextSelect: string;
}) {
  const nodeProcess = (globalThis as any)?.process;
  if (nodeProcess?.env?.NODE_ENV === 'production') return;
  logger?.warn?.(`[Schema fallback:${params.route}]`, {
    table: params.table,
    missingColumn: params.missingColumn,
    nextSelect: params.nextSelect
  });
}

export async function fetchProfileWithSchemaFallback(params: {
  supabase: SupabaseLike;
  userId: string | null;
  logger?: LoggerLike;
}) {
  let columns = [...PROFILE_SELECT_COLUMNS];
  let lastError: any = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
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
      route: '/api/notes/:patientId',
      table: 'patients',
      missingColumn,
      nextSelect: 'email'
    });
  }

  return { data: null, error: lastError };
}

function noteIsReadableWithoutVisibility(note: any): boolean {
  const visibility = cleanString(note?.visibility, 40).toLowerCase();
  const legacyType = cleanString(note?.type, 40).toLowerCase();
  return ['patient', 'shared', 'family', 'shared_patient'].includes(visibility) ||
    ['patient', 'shared', 'family', 'shared_patient'].includes(legacyType);
}

export async function fetchNotesWithSchemaFallback(params: {
  supabase: SupabaseLike;
  patientId?: string | null;
  patientEmail?: string | null;
  excludePatientId?: string | null;
  role: string;
  limit: number;
  logger?: LoggerLike;
}) {
  let columns = [...NOTE_SELECT_COLUMNS];
  let filterIsActive = true;
  let filterDeletedAt = true;
  let filterVisibility = cleanString(params.role, 40).toLowerCase() === 'patient';
  let lastError: any = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let query = params.supabase.from('notes').select(joinColumns(columns));
    if (params.patientId) query = query.eq('patient_id', cleanString(params.patientId, 120));
    if (params.patientEmail) query = query.eq('patient_email', cleanString(params.patientEmail, 320).toLowerCase());
    if (params.excludePatientId) query = query.neq('patient_id', cleanString(params.excludePatientId, 120));
    if (filterIsActive) query = query.eq('is_active', true);
    if (filterDeletedAt) query = query.is('deleted_at', null);
    if (filterVisibility && columns.includes('visibility')) {
      query = query.in('visibility', ['patient', 'shared', 'family', 'shared_patient']);
    }

    const result = await query
      .order('created_at', { ascending: false })
      .limit(params.limit);

    if (!result.error) {
      const rows = Array.isArray(result.data) ? result.data : [];
      return {
        data: filterVisibility && !columns.includes('visibility')
          ? rows.filter(noteIsReadableWithoutVisibility)
          : rows,
        error: null,
        select: joinColumns(columns)
      };
    }

    lastError = result.error;
    const missingColumn =
      extractMissingColumnNameFromSupabaseError(result.error) ||
      findMentionedColumn(result.error, NOTE_OPTIONAL_COLUMNS);
    if (!missingColumn) break;

    let handled = false;
    if (missingColumn === 'visibility') {
      filterVisibility = false;
      columns = columns.filter((column) => column !== 'visibility');
      handled = true;
    } else if (missingColumn === 'is_active') {
      filterIsActive = false;
      columns = columns.filter((column) => column !== 'is_active');
      handled = true;
    } else if (missingColumn === 'deleted_at') {
      filterDeletedAt = false;
      columns = columns.filter((column) => column !== 'deleted_at');
      handled = true;
    } else if (NOTE_OPTIONAL_COLUMNS.has(missingColumn) && columns.includes(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
      handled = true;
    }

    if (!handled) break;

    warnSchemaFallback(params.logger, {
      route: '/api/notes/:patientId',
      table: 'notes',
      missingColumn,
      nextSelect: joinColumns(columns)
    });
  }

  return { data: null, error: lastError, select: joinColumns(columns) };
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

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let query = params.supabase
      .from('patients')
      .select(joinColumns(columns));

    if (filterIsActive) query = query.eq('is_active', true);
    if (filterDeletedAt) query = query.is('deleted_at', null);

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
