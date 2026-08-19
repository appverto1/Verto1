import webpush from 'web-push';
import {
  buildPatientReminderNotificationPayload,
  resolveBrandingContext,
} from '../src/services/notificationBranding';
import { isVertoInstitutionalAsset } from '../src/constants/vertoBranding';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

type PushSubscriptionInput = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type NormalizedPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type AppointmentPushSubscriptionEntry = {
  row: any;
  subscription: NormalizedPushSubscription;
};

type ResolvePatientIdsParams = {
  supabase: any;
  patientId?: string | null;
  patientEmail?: string | null;
  clinicId?: string | null;
  userId?: string | null;
  allowCrossClinicEmailFallback?: boolean;
  logger?: Logger;
};

type SavePushSubscriptionParams = {
  supabase: any;
  subscription: PushSubscriptionInput;
  patientId: string;
  userId?: string | null;
  userEmail?: string | null;
  clinicId?: string | null;
  resolvedPatientClinicId?: string | null;
  role?: string | null;
  logger?: Logger;
};

export type SendPatientPortalNotificationParams = {
  supabase: any; patientId: string; patientEmail?: string | null; clinicId?: string | null;
  title: string; body: string; url?: string; tag?: string; data?: Record<string, unknown>;
  branding?: { displayName?: string | null; logoUrl?: string | null };
  preloadedSubscriptions?: AppointmentPushSubscriptionEntry[]; logger?: Logger;
};

type SendAppointmentNotificationParams = {
  supabase: any;
  patientId: string;
  prevalidatedPatientIds?: string[];
  patientEmail?: string | null;
  appointment: {
    id: string;
    clinicId?: string | null;
    professionalId?: string | null;
    scheduledAt?: string | null;
    timeLabel?: string | null;
    dateLabel?: string | null;
    reminderKind?: string | null;
    clinicName?: string | null;
    clinicLogoUrl?: string | null;
    clinicPrimaryColor?: string | null;
    patientName?: string | null;
    professionalDisplayName?: string | null;
    professionalLogoUrl?: string | null;
    canRequestReschedule?: boolean;
  };
  clinicId?: string | null;
  professionalId?: string | null;
  clinicName?: string | null;
  clinicLogoUrl?: string | null;
  clinicPrimaryColor?: string | null;
  patientName?: string | null;
  professionalDisplayName?: string | null;
  professionalLogoUrl?: string | null;
  title?: string;
  body?: string;
  reminderKind?: string;
  preloadedSubscriptions?: AppointmentPushSubscriptionEntry[];
  logger?: Logger;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const sanitizeBrandLogoText = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (isVertoInstitutionalAsset(text)) return '';
  if (/^data:image\//i.test(text)) return text.slice(0, 1_000_000);
  return text.slice(0, 2000);
};

const sanitizeEmail = (value: unknown) => {
  const email = sanitizeText(value, 320).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

const sanitizeOptionalId = (value: unknown, maxLength = 120) => {
  const text = sanitizeText(value, maxLength);
  return ['null', 'undefined'].includes(text.toLowerCase()) ? '' : text;
};

const isUuid = (value: unknown) => UUID_REGEX.test(sanitizeText(value, 120));

const extractMissingColumnName = (error: any): string | null => {
  const message = String(error?.message || error?.hint || '');
  const quoted = message.match(/column\s+"([^"]+)"/i)?.[1];
  if (quoted) return quoted;
  const postgrest = message.match(/'([^']+)'\s+column/i)?.[1];
  return postgrest || null;
};

const isGonePushError = (error: any) => {
  const statusCode = Number(error?.statusCode ?? error?.status);
  return statusCode === 404 || statusCode === 410;
};

const isDuplicatePushError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key');
};

const isRemovablePushColumn = (column: string | null) =>
  Boolean(
    column &&
      [
        'patient_id',
        'p256dh',
        'auth',
        'subscription',
        'user_id',
        'user_email',
        'clinic_id',
        'role',
        'created_at',
        'updated_at'
      ].includes(column)
  );

const safeJsonSubscription = (value: any): PushSubscriptionInput | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
};

export const normalizePushSubscription = (rowOrSubscription: any): NormalizedPushSubscription | null => {
  const direct = safeJsonSubscription(rowOrSubscription);
  const embedded = safeJsonSubscription(rowOrSubscription?.subscription);
  const source = embedded || direct || {};
  const endpoint = sanitizeText(source?.endpoint || rowOrSubscription?.endpoint, 2000);
  const p256dh = sanitizeText(source?.keys?.p256dh || rowOrSubscription?.p256dh, 2000);
  const auth = sanitizeText(source?.keys?.auth || rowOrSubscription?.auth, 2000);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth }
  };
};

export async function resolvePatientIdsForPush(params: ResolvePatientIdsParams): Promise<string[]> {
  const ids = new Set<string>();
  const explicitPatientId = sanitizeText(params.patientId, 120);
  const userId = sanitizeText(params.userId, 120);
  const email = sanitizeEmail(params.patientEmail);
  const clinicId = sanitizeText(params.clinicId, 120);
  const summarizePatientRows = (rows: any[]) =>
    (rows || []).slice(0, 20).map((row: any) => ({
      id: sanitizeText(row?.id, 120) || null,
      email: sanitizeText(row?.email, 320) || null,
      normalizedEmail: sanitizeEmail(row?.email) || null,
      clinic_id: sanitizeText(row?.clinic_id, 120) || null,
      status: sanitizeText(row?.status, 60) || null,
      is_active: row?.is_active ?? null,
      has_deleted_at: Boolean(row?.deleted_at)
    }));
  const hasDeletedAt = (row: any) =>
    row?.has_deleted_at === true ||
    (row?.deleted_at !== null && row?.deleted_at !== undefined && row?.deleted_at !== '');
  const hasClinicId = (row: any) =>
    row?.clinic_id !== null && row?.clinic_id !== undefined && String(row.clinic_id).trim() !== '';
  const chooseAcceptedPatientRows = (rows: any[]) =>
    (rows || []).filter((row: any) =>
      row?.is_active === true &&
      hasDeletedAt(row) === false &&
      hasClinicId(row)
    );
  const logLookup = (phase: string, details: Record<string, any>) => {
    params.logger?.log?.('[PushPatientResolve]', {
      phase,
      requestedPatientId: explicitPatientId || null,
      requestedPatientEmail: email || null,
      userId: userId || null,
      clinicId: clinicId || null,
      ...details
    });
  };

  const addPatientRows = (rows: any[]) => {
    for (const row of rows || []) {
      const id = sanitizeText(row?.id, 120);
      if (id) ids.add(id);
    }
  };

  if (isUuid(explicitPatientId)) {
    let query = params.supabase
      .from('patients')
      .select('id, email, clinic_id, status, is_active, deleted_at')
      .eq('id', explicitPatientId)
      .limit(1);
    if (clinicId && isUuid(clinicId)) {
      query = query.eq('clinic_id', clinicId);
    }
    const { data, error } = await query;
    logLookup('explicit_patient_id', {
      error: error?.message || null,
      returned: summarizePatientRows(data || [])
    });
    if (!error) addPatientRows(chooseAcceptedPatientRows(data || []));
  }

  if (email) {
    let query = params.supabase
      .from('patients')
      .select('id, email, clinic_id, status, is_active, deleted_at')
      .ilike('email', email)
      .limit(100);
    if (clinicId && isUuid(clinicId)) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data, error } = await query;
    logLookup('email_exact_ilike', {
      error: error?.message || null,
      returned: summarizePatientRows(data || []),
      accepted: summarizePatientRows(chooseAcceptedPatientRows(data || []))
    });
    if (!error) addPatientRows(chooseAcceptedPatientRows(data || []));

    if (
      !ids.size &&
      clinicId &&
      isUuid(clinicId) &&
      params.allowCrossClinicEmailFallback !== false
    ) {
      const fallback = await params.supabase
        .from('patients')
        .select('id, email, clinic_id, status, is_active, deleted_at')
        .ilike('email', email)
        .limit(100);
      logLookup('email_across_clinics_after_scoped_miss', {
        error: fallback.error?.message || null,
        returned: summarizePatientRows(fallback.data || []),
        accepted: summarizePatientRows(chooseAcceptedPatientRows(fallback.data || []))
      });
      if (!fallback.error) addPatientRows(chooseAcceptedPatientRows(fallback.data || []));
    }

    if (!ids.size) {
      let fuzzyQuery = params.supabase
        .from('patients')
        .select('id, email, clinic_id, status, is_active, deleted_at')
        .ilike('email', `%${email}%`)
        .limit(100);
      if (clinicId && isUuid(clinicId)) {
        fuzzyQuery = fuzzyQuery.eq('clinic_id', clinicId);
      }
      const fuzzy = await fuzzyQuery;
      const acceptedMatches = chooseAcceptedPatientRows(fuzzy.data || []);
      logLookup('email_trimmed_fallback', {
        error: fuzzy.error?.message || null,
        returned: summarizePatientRows(fuzzy.data || []),
        accepted: summarizePatientRows(acceptedMatches),
        ignoredDeleted: summarizePatientRows((fuzzy.data || []).filter((row: any) => hasDeletedAt(row) || row?.is_active === false))
      });
      addPatientRows(acceptedMatches);
    }
  }

  if (!ids.size && isUuid(userId)) {
    const { data, error } = await params.supabase
      .from('patients')
      .select('id, email, clinic_id, status, is_active, deleted_at')
      .eq('id', userId)
      .limit(1);
    logLookup('auth_user_id_as_patient_id', {
      error: error?.message || null,
      returned: summarizePatientRows(data || []),
      accepted: summarizePatientRows(chooseAcceptedPatientRows(data || []))
    });
    if (!error) addPatientRows(chooseAcceptedPatientRows(data || []));
  }

  logLookup('resolved', {
    patientIds: Array.from(ids)
  });

  return Array.from(ids);
}

export async function savePatientPushSubscription(params: SavePushSubscriptionParams) {
  const normalized = normalizePushSubscription(params.subscription);
  if (!normalized) {
    return { success: false, error: 'Inscricao push invalida.' };
  }

  let patientId = sanitizeText(params.patientId, 120);
  const safeSessionClinicId = sanitizeOptionalId(params.clinicId, 120);
  const safeResolvedPatientClinicId = sanitizeOptionalId(params.resolvedPatientClinicId, 120);
  const clinicIdCandidates = Array.from(
    new Set([
      isUuid(safeSessionClinicId) ? safeSessionClinicId : '',
      isUuid(safeResolvedPatientClinicId) ? safeResolvedPatientClinicId : '',
      safeResolvedPatientClinicId,
      safeSessionClinicId
    ].filter(Boolean))
  );
  const safeClinicId = clinicIdCandidates[0] || '';
  const safeUserEmail = sanitizeEmail(params.userEmail);

  // Define validation functions for patient rows
  const hasDeletedAt = (row: any) =>
    row?.deleted_at !== null && row?.deleted_at !== undefined && row?.deleted_at !== '';
  const hasClinicId = (row: any) =>
    row?.clinic_id !== null && row?.clinic_id !== undefined && String(row.clinic_id).trim() !== '';
  const isValidPatientRow = (row: any) =>
    row?.is_active === true &&
    hasDeletedAt(row) === false &&
    hasClinicId(row);

  if (!isUuid(patientId) && safeUserEmail) {
    for (const clinicId of clinicIdCandidates) {
      const { data, error } = await params.supabase
        .from('patients')
        .select('id, clinic_id, is_active, deleted_at')
        .eq('clinic_id', clinicId)
        .ilike('email', safeUserEmail)
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(1);

      const validPatients = (data || []).filter(isValidPatientRow);
      const resolvedId = sanitizeText(validPatients?.[0]?.id, 120);

      params.logger?.log?.('[PushSubscriptionSave] patient_id revalidado por clinic_id.', {
        originalPatientId: patientId || null,
        resolvedPatientId: resolvedId || null,
        clinicId,
        effectiveClinicId: safeClinicId || null,
        sessionClinicId: safeSessionClinicId || null,
        resolvedPatientClinicId: safeResolvedPatientClinicId || null,
        userEmail: safeUserEmail,
        error: error?.message || null,
        validCount: validPatients.length
      });
      if (!error && isUuid(resolvedId)) {
        patientId = resolvedId;
        break;
      }
    }
  }

  // Final validation: patient must be a valid UUID and have been found (with same criteria as resolvePatientIdsForPush)
  if (!isUuid(patientId)) {
    params.logger?.warn?.('[PushSubscriptionSave] paciente invalido apos revalidacao.', {
      patientId: patientId || null,
      clinicId: safeClinicId || null,
      sessionClinicId: safeSessionClinicId || null,
      resolvedPatientClinicId: safeResolvedPatientClinicId || null,
      userEmail: safeUserEmail || null
    });
    return { success: false, error: 'Paciente invalido para inscricao push.' };
  }

  params.logger?.log?.('[PushSubscriptionSave] start', {
    patientId,
    userId: sanitizeText(params.userId, 120) || null,
    userEmail: safeUserEmail || null,
    clinicId: safeClinicId || null,
    sessionClinicId: safeSessionClinicId || null,
    resolvedPatientClinicId: safeResolvedPatientClinicId || null,
    role: sanitizeText(params.role, 40) || null,
    endpointPrefix: normalized.endpoint.slice(0, 80),
    hasP256dh: Boolean(normalized.keys.p256dh),
    hasAuth: Boolean(normalized.keys.auth)
  });

  const now = new Date().toISOString();
  let payload: Record<string, any> = {
    patient_id: patientId,
    endpoint: normalized.endpoint,
    p256dh: normalized.keys.p256dh,
    auth: normalized.keys.auth,
    subscription: normalized,
    user_id: isUuid(params.userId) ? sanitizeText(params.userId, 120) : null,
    user_email: safeUserEmail || null,
    clinic_id: safeClinicId || null,
    role: sanitizeText(params.role, 40) || null,
    created_at: now,
    updated_at: now
  };

  const removeMissingColumn = (error: any) => {
    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn || !(missingColumn in payload) || !isRemovablePushColumn(missingColumn)) {
      return false;
    }
    params.logger?.warn?.('[PushSubscriptionSave] coluna ausente removida do payload.', {
      patientId,
      missingColumn
    });
    delete payload[missingColumn];
    return true;
  };

  const updateExisting = async () => {
    for (let attempt = 0; attempt < 16 && Object.keys(payload).length > 0; attempt += 1) {
      const updatePayload = { ...payload, updated_at: now };
      delete updatePayload.created_at;
      const { data, error } = await params.supabase
        .from('push_subscriptions')
        .update(updatePayload)
        .eq('endpoint', normalized.endpoint)
        .select('endpoint')
        .limit(1);

      if (!error) {
        params.logger?.log?.('[PushSubscriptionSave] update checked.', {
          patientId,
          updated: Array.isArray(data) && data.length > 0,
          endpointPrefix: normalized.endpoint.slice(0, 80)
        });
        return { success: true, updated: Array.isArray(data) && data.length > 0, error: null };
      }
      if (removeMissingColumn(error)) continue;
      params.logger?.warn?.('[PushSubscriptionSave] update failed.', {
        patientId,
        endpointPrefix: normalized.endpoint.slice(0, 80),
        message: error.message || String(error)
      });
      return { success: false, updated: false, error };
    }
    return { success: false, updated: false, error: new Error('Nao foi possivel montar payload push.') };
  };

  const existing = await updateExisting();
  if (existing.success && existing.updated) {
    return { success: true, patientId, endpoint: normalized.endpoint };
  }
  if (!existing.success) {
    return { success: false, error: existing.error?.message || 'Erro ao atualizar inscricao push.' };
  }

  while (Object.keys(payload).length > 0) {
    const { error } = await params.supabase
      .from('push_subscriptions')
      .insert([payload]);

    if (!error) {
      params.logger?.log?.('[PushSubscriptionSave] insert succeeded.', {
        patientId,
        endpointPrefix: normalized.endpoint.slice(0, 80)
      });
      return { success: true, patientId, endpoint: normalized.endpoint };
    }
    if (isDuplicatePushError(error)) {
      params.logger?.warn?.('[PushSubscriptionSave] duplicate endpoint on insert; retrying update.', {
        patientId,
        endpointPrefix: normalized.endpoint.slice(0, 80)
      });
      const retryUpdate = await updateExisting();
      if (retryUpdate.success) {
        return { success: true, patientId, endpoint: normalized.endpoint };
      }
      return { success: false, error: retryUpdate.error?.message || error.message || 'Erro ao salvar inscricao push.' };
    }

    if (!removeMissingColumn(error)) {
      params.logger?.warn?.('[PushSubscriptionSave] insert failed.', {
        patientId,
        endpointPrefix: normalized.endpoint.slice(0, 80),
        message: error.message || String(error)
      });
      return { success: false, error: error.message || 'Erro ao salvar inscricao push.' };
    }
  }

  return { success: false, error: 'Nao foi possivel montar payload push.' };
}

export async function removePatientPushSubscription(params: {
  supabase: any;
  patientId: string;
  endpoint: string;
}) {
  const patientId = sanitizeText(params.patientId, 120);
  const endpoint = sanitizeText(params.endpoint, 2000);
  if (!endpoint) return { success: true };

  let query = params.supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (isUuid(patientId)) query = query.eq('patient_id', patientId);
  const { error } = await query;
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteInvalidPushSubscription(params: {
  supabase: any;
  endpoint: string;
  logger?: Logger;
}) {
  const endpoint = sanitizeText(params.endpoint, 2000);
  if (!endpoint) return;
  const { error } = await params.supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) {
    params.logger?.warn?.('[Push] Falha ao remover subscription expirada.', {
      endpoint: endpoint.slice(0, 80),
      message: error.message
    });
  }
}

export async function findPushSubscriptionsForPatient(params: {
  supabase: any;
  patientIds: string[];
  patientEmail?: string | null;
  legacyUserIds?: string[];
  clinicId?: string | null;
  logger?: Logger;
}) {
  const patientIds = new Set(params.patientIds.filter((id) => isUuid(id)));
  const legacyUserIds = new Set((params.legacyUserIds || []).filter((id) => isUuid(id)));
  const patientEmail = sanitizeEmail(params.patientEmail);

  const clinicId = sanitizeText(params.clinicId, 120);
  const rowsByEndpoint = new Map<string, any>();
  const collect = (rows: any[], requireClinicMatch = false) => {
    for (const row of rows || []) {
      const endpoint = sanitizeText(row?.endpoint || row?.subscription?.endpoint, 2000);
      const rowClinicId = sanitizeText(row?.clinic_id, 120);
      if (!endpoint) continue;
      if (
        clinicId &&
        (rowClinicId ? rowClinicId !== clinicId : requireClinicMatch)
      ) continue;
      rowsByEndpoint.set(endpoint, row);
    }
  };
  const readBatch = async (column: 'patient_id' | 'user_id', values: string[]) => {
    if (values.length === 0) return;
    const { data, error } = await params.supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, subscription, patient_id, user_id, user_email, clinic_id')
      .in(column, values)
      .limit(500);
    if (error) {
      params.logger?.warn?.('[Push] Nao foi possivel buscar push_subscriptions em lote.', {
        column,
        count: values.length,
        message: error.message
      });
      return;
    }
    collect(Array.isArray(data) ? data : []);
  };

  await readBatch('patient_id', Array.from(patientIds));
  if (rowsByEndpoint.size === 0) {
    await readBatch('user_id', Array.from(new Set([...patientIds, ...legacyUserIds])));
  }

  if (rowsByEndpoint.size === 0 && patientEmail) {
    const { data, error } = await params.supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, subscription, patient_id, user_id, user_email, clinic_id')
      .ilike('user_email', patientEmail)
      .limit(100);
    if (error) {
      params.logger?.warn?.('[Push] Nao foi possivel buscar push_subscriptions por email.', {
        message: error.message
      });
    } else {
      collect(Array.isArray(data) ? data : [], true);
    }
  }

  const rows = Array.from(rowsByEndpoint.values());
  const exactMatches = rows.filter((row: any) => {
    const rowPatientId = sanitizeText(row?.patient_id, 120);
    const rowUserId = sanitizeText(row?.user_id, 120);
    return (
      (rowPatientId && patientIds.has(rowPatientId)) ||
      (rowUserId && (patientIds.has(rowUserId) || legacyUserIds.has(rowUserId)))
    );
  });
  const emailMatches = rows.filter((row: any) => {
    const rowEmail = sanitizeEmail(row?.user_email);
    return Boolean(patientEmail && rowEmail === patientEmail);
  });
  const matches = exactMatches.length > 0 ? exactMatches : emailMatches;

  return Array.from(
    new Map(
      matches
        .map((row: any) => {
          const subscription = normalizePushSubscription(row);
          return subscription ? [subscription.endpoint, { row, subscription }] : null;
        })
        .filter(Boolean) as Array<[string, { row: any; subscription: NormalizedPushSubscription }]>
    ).values()
  );
}

export async function findPushSubscriptionsForRecipients(params: {
  supabase: any;
  recipients: Array<{
    key: string;
    patientIds: string[];
    patientEmail?: string | null;
    legacyUserIds?: string[];
    clinicId?: string | null;
  }>;
  logger?: Logger;
}) {
  const recipients = params.recipients
    .map((recipient) => ({
      key: sanitizeText(recipient.key, 240),
      patientIds: Array.from(new Set(recipient.patientIds.filter((id) => isUuid(id)))),
      patientEmail: sanitizeEmail(recipient.patientEmail),
      legacyUserIds: Array.from(new Set((recipient.legacyUserIds || []).filter((id) => isUuid(id)))),
      clinicId: sanitizeText(recipient.clinicId, 120),
    }))
    .filter((recipient) => recipient.key && (recipient.patientIds.length > 0 || recipient.patientEmail));
  const result = new Map<string, AppointmentPushSubscriptionEntry[]>();
  for (const recipient of recipients) result.set(recipient.key, []);
  if (recipients.length === 0) return { complete: true, subscriptionsByRecipientKey: result };

  const patientIds = Array.from(new Set(recipients.flatMap((recipient) => recipient.patientIds)));
  const selectColumns = 'endpoint, p256dh, auth, subscription, patient_id, user_id, user_email, clinic_id';
  const chunkFilterValues = (values: string[], maxItems = 100, maxCharacters = 3000) => {
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentCharacters = 0;
    for (const value of values) {
      const nextCharacters = value.length + 1;
      if (current.length > 0 && (current.length >= maxItems || currentCharacters + nextCharacters > maxCharacters)) {
        chunks.push(current);
        current = [];
        currentCharacters = 0;
      }
      current.push(value);
      currentCharacters += nextCharacters;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  };
  const read = async (column: 'patient_id' | 'user_id', values: string[]) => {
    if (values.length === 0) return { rows: [] as any[], failed: false };
    const rows: any[] = [];
    for (const chunk of chunkFilterValues(values)) {
      for (let page = 0; page < 20; page += 1) {
        const from = page * 500;
        const { data, error } = await params.supabase
          .from('push_subscriptions')
          .select(selectColumns)
          .in(column, chunk)
          .order('endpoint', { ascending: true })
          .range(from, from + 499);
        if (error) {
          params.logger?.warn?.('[Push] Busca compartilhada de subscriptions falhou; usando fallback individual.', {
            column,
            count: chunk.length,
            message: error.message,
          });
          return { rows: [] as any[], failed: true };
        }
        const pageRows = Array.isArray(data) ? data : [];
        rows.push(...pageRows);
        if (pageRows.length < 500) break;
        if (page === 19) return { rows: [] as any[], failed: true };
      }
    }
    return { rows, failed: false };
  };
  const readEmails = async (values: string[]) => {
    if (values.length === 0) return { rows: [] as any[], failed: false };
    const rows: any[] = [];
    const chunks = chunkFilterValues(values, 50, 2500);
    for (const chunk of chunks) {
      const filters = chunk.map((email) => {
        const quotedEmail = `"${email.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        return `user_email.ilike.${quotedEmail}`;
      }).join(',');
      for (let page = 0; page < 20; page += 1) {
        const from = page * 500;
        const { data, error } = await params.supabase
          .from('push_subscriptions')
          .select(selectColumns)
          .or(filters)
          .order('endpoint', { ascending: true })
          .range(from, from + 499);
        if (error) {
          params.logger?.warn?.('[Push] Busca compartilhada de subscriptions por email falhou; usando fallback individual.', {
            count: chunk.length,
            message: error.message,
          });
          return { rows: [] as any[], failed: true };
        }
        const pageRows = Array.isArray(data) ? data : [];
        rows.push(...pageRows);
        if (pageRows.length < 500) break;
        if (page === 19) return { rows: [] as any[], failed: true };
      }
    }
    return { rows, failed: false };
  };

  const patientRows = await read('patient_id', patientIds);
  if (patientRows.failed) {
    return { complete: false, subscriptionsByRecipientKey: result };
  }

  const clinicMatches = (recipient: (typeof recipients)[number], row: any, requireClinic = false) => {
    const rowClinicId = sanitizeText(row?.clinic_id, 120);
    if (!recipient.clinicId) return true;
    if (!rowClinicId) return !requireClinic;
    return rowClinicId === recipient.clinicId;
  };
  const recipientsWithoutPatientSubscription = recipients.filter((recipient) => {
    const patientIdSet = new Set(recipient.patientIds);
    return !patientRows.rows.some((row: any) =>
      clinicMatches(recipient, row) && patientIdSet.has(sanitizeText(row?.patient_id, 120)),
    );
  });
  const userIds = Array.from(new Set(recipientsWithoutPatientSubscription.flatMap((recipient) => [
    ...recipient.patientIds,
    ...recipient.legacyUserIds,
  ])));
  const userRows = await read('user_id', userIds);
  if (userRows.failed) {
    return { complete: false, subscriptionsByRecipientKey: result };
  }
  const recipientsWithoutExactSubscription = recipientsWithoutPatientSubscription.filter((recipient) => {
    const userIdSet = new Set([...recipient.patientIds, ...recipient.legacyUserIds]);
    return !userRows.rows.some((row: any) =>
      clinicMatches(recipient, row) && userIdSet.has(sanitizeText(row?.user_id, 120)),
    );
  });
  const patientEmails = Array.from(new Set(
    recipientsWithoutExactSubscription.map((recipient) => recipient.patientEmail).filter(Boolean),
  ));
  const emailRows = await readEmails(patientEmails);
  if (emailRows.failed) {
    return { complete: false, subscriptionsByRecipientKey: result };
  }

  for (const recipient of recipients) {
    const patientIdSet = new Set(recipient.patientIds);
    const userIdSet = new Set([...recipient.patientIds, ...recipient.legacyUserIds]);
    const patientMatches = patientRows.rows.filter((row: any) =>
      clinicMatches(recipient, row) && patientIdSet.has(sanitizeText(row?.patient_id, 120)),
    );
    const userMatches = patientMatches.length > 0
      ? []
      : userRows.rows.filter((row: any) =>
          clinicMatches(recipient, row) && userIdSet.has(sanitizeText(row?.user_id, 120)),
        );
    const matchingRows = patientMatches.length > 0
      ? patientMatches
      : userMatches.length > 0
        ? userMatches
        : emailRows.rows.filter((row: any) =>
          clinicMatches(recipient, row, true) &&
          Boolean(recipient.patientEmail) &&
          sanitizeEmail(row?.user_email) === recipient.patientEmail,
        );
    result.set(recipient.key, Array.from(new Map(
      matchingRows
        .map((row: any) => {
          const subscription = normalizePushSubscription(row);
          return subscription
            ? [subscription.endpoint, { row, subscription } as AppointmentPushSubscriptionEntry]
            : null;
        })
        .filter(Boolean) as Array<[string, AppointmentPushSubscriptionEntry]>,
    ).values()));
  }

  return { complete: true, subscriptionsByRecipientKey: result };
}

export async function sendPatientPortalNotification(params: SendPatientPortalNotificationParams) {
  const logger = params.logger || console;
  const patientId = sanitizeText(params.patientId, 120);
  const clinicId = sanitizeText(params.clinicId, 120);
  const patientEmail = sanitizeEmail(params.patientEmail);
  const patientIds = isUuid(patientId) ? [patientId] : [];
  const rows = params.preloadedSubscriptions !== undefined ? params.preloadedSubscriptions : await findPushSubscriptionsForPatient({
    supabase: params.supabase, patientIds, patientEmail, legacyUserIds: patientIds, clinicId, logger
  });
  if (!rows.length) return { sent: 0, failed: 0, subscriptions: 0 };
  const displayName = sanitizeText(params.branding?.displayName || 'Clínica', 160) || 'Clínica';
  const logoUrl = sanitizeBrandLogoText(params.branding?.logoUrl);
  const payload = JSON.stringify({
    title: sanitizeText(params.title, 180) || displayName, body: sanitizeText(params.body, 1000),
    url: sanitizeText(params.url || '/', 1200) || '/', tag: sanitizeText(params.tag || 'clinic-announcement', 240),
    icon: logoUrl || undefined, badge: logoUrl || undefined, branding: { displayName, logoUrl: logoUrl || null },
    data: { notificationType: 'clinic_announcement', clinicId: clinicId || null, ...(params.data || {}) }
  });
  let sent = 0; let failed = 0; const invalidEndpoints = new Set<string>();
  for (const entry of rows) {
    try { await webpush.sendNotification(entry.subscription, payload); sent += 1; }
    catch (error: any) { failed += 1; logger.warn('[Push] Falha ao enviar aviso da clínica.', { patientId: isUuid(patientId) ? patientId : null, clinicId: isUuid(clinicId) ? clinicId : null, endpoint: entry.subscription.endpoint.slice(0,80), statusCode: error?.statusCode ?? error?.status ?? null, message: error?.message || String(error) }); if (isGonePushError(error)) invalidEndpoints.add(entry.subscription.endpoint); }
  }
  if (invalidEndpoints.size > 0) {
    const { error } = await params.supabase.from('push_subscriptions').delete().in('endpoint', Array.from(invalidEndpoints));
    if (error) logger.warn('[Push] Falha ao remover subscriptions expiradas de aviso.', { count: invalidEndpoints.size, message: error.message });
  }
  return { sent, failed, subscriptions: rows.length };
}

export async function sendAppointmentNotification(params: SendAppointmentNotificationParams) {
  const logger = params.logger || console;
  const prevalidatedPatientIds = Array.from(new Set(
    (params.prevalidatedPatientIds || []).filter((id) => isUuid(id))
  ));
  const patientIds = prevalidatedPatientIds.length > 0
    ? prevalidatedPatientIds
    : await resolvePatientIdsForPush({
        supabase: params.supabase,
        patientId: params.patientId,
        patientEmail: params.patientEmail,
        clinicId: params.appointment.clinicId || params.clinicId,
        allowCrossClinicEmailFallback: false,
        logger,
      });
  const legacyIds = isUuid(params.patientId) ? [params.patientId] : [];
  const rows = params.preloadedSubscriptions !== undefined
    ? params.preloadedSubscriptions
    : await findPushSubscriptionsForPatient({
        supabase: params.supabase,
        patientIds,
        patientEmail: params.patientEmail,
        legacyUserIds: legacyIds,
        clinicId: params.appointment.clinicId || params.clinicId,
        logger
      });

  if (!rows.length) {
    logger.warn('[Push] Nenhuma subscription encontrada para consulta.', {
      appointmentId: params.appointment.id,
      patientId: params.patientId,
      patientEmail: sanitizeEmail(params.patientEmail) || null
    });
    return { sent: 0, failed: 0, subscriptions: 0 };
  }

  const timeLabel = sanitizeText(params.appointment.timeLabel, 80);
  const dateLabel = sanitizeText(params.appointment.dateLabel, 80);
  const scheduledAt = sanitizeText(params.appointment.scheduledAt, 120);
  const reminderKind = sanitizeText(params.reminderKind || params.appointment.reminderKind || 'appointment', 40);
  const clinicId = sanitizeText(params.appointment.clinicId || params.clinicId, 120);
  const professionalId = sanitizeText(params.appointment.professionalId || params.professionalId, 120);
  const clinicName = sanitizeText(params.appointment.clinicName || params.clinicName, 160);
  const clinicLogoUrl = sanitizeBrandLogoText(params.appointment.clinicLogoUrl || params.clinicLogoUrl);
  const appointmentQuery = new URLSearchParams({
    appointment_id: String(params.appointment.id || ''),
    ...(dateLabel ? { appointment_date: dateLabel } : {}),
    ...(timeLabel ? { appointment_time: timeLabel } : {}),
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {})
  }).toString();
  const branding = resolveBrandingContext({
    clinic: {
      id: clinicId || null,
      displayName: clinicName,
      logoUrl: clinicLogoUrl,
      primaryColor: params.appointment.clinicPrimaryColor || params.clinicPrimaryColor,
    },
    professional: {
      id: professionalId || null,
      displayName: params.appointment.professionalDisplayName || params.professionalDisplayName,
      logoUrl: params.appointment.professionalLogoUrl || params.professionalLogoUrl,
    },
    allowProfessionalFallback: false,
    fallbackName: 'Clínica',
  });
  if (process.env.NODE_ENV !== 'production') {
    logger.log?.('[PushBranding] context resolved.', {
      appointmentId: params.appointment.id,
      brandingSourceType: branding.sourceType,
      displayName: branding.displayName,
      clinicId: isUuid(clinicId) ? clinicId : null,
      professionalId: isUuid(professionalId) ? professionalId : null
    });
  }
  const notificationPayload = buildPatientReminderNotificationPayload({
    appointmentId: params.appointment.id,
    scheduledAt: scheduledAt || null,
    dateLabel,
    timeLabel,
    patientName: params.appointment.patientName || params.patientName,
    reminderKind,
    branding,
    url: `/?${appointmentQuery}`,
    canRequestReschedule: params.appointment.canRequestReschedule !== false,
  });
  const payload = JSON.stringify({
    ...notificationPayload,
    title: notificationPayload.title,
    body: params.body || notificationPayload.body,
  });

  let sent = 0;
  let failed = 0;
  const invalidEndpoints = new Set<string>();

  for (const entry of rows) {
    try {
      await webpush.sendNotification(entry.subscription, payload);
      sent += 1;
    } catch (error: any) {
      failed += 1;
      logger.warn('[Push] Falha ao enviar notification.', {
        appointmentId: params.appointment.id,
        endpoint: entry.subscription.endpoint.slice(0, 80),
        statusCode: error?.statusCode ?? error?.status ?? null,
        message: error?.message || String(error)
      });
      if (isGonePushError(error)) {
        invalidEndpoints.add(entry.subscription.endpoint);
      }
    }
  }

  if (invalidEndpoints.size > 0) {
    const { error } = await params.supabase
      .from('push_subscriptions')
      .delete()
      .in('endpoint', Array.from(invalidEndpoints));
    if (error) {
      logger.warn('[Push] Falha ao remover subscriptions expiradas em lote.', {
        count: invalidEndpoints.size,
        message: error.message,
      });
    }
  }

  return { sent, failed, subscriptions: rows.length };
}
