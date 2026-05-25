type SupabaseLike = {
  from: (table: string) => any;
};

type LoggerLike = Pick<Console, 'warn'>;

export type PatientListRole = 'coordinator' | 'receptionist' | 'therapist' | 'admin' | 'owner' | string;

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

export const INVITATION_SELECT = INVITATION_SELECT_COLUMNS.join(',');
export const INVITATION_LEGACY_SELECT = INVITATION_LEGACY_SELECT_COLUMNS.join(',');
export const PATIENT_LIST_SELECT = PATIENT_LIST_SELECT_COLUMNS.join(',');
export const PATIENT_LIST_LEGACY_SELECT = PATIENT_LIST_LEGACY_SELECT_COLUMNS.join(',');

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
