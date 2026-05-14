import webpush from 'web-push';

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

type ResolvePatientIdsParams = {
  supabase: any;
  patientId?: string | null;
  patientEmail?: string | null;
  clinicId?: string | null;
  userId?: string | null;
};

type SavePushSubscriptionParams = {
  supabase: any;
  subscription: PushSubscriptionInput;
  patientId: string;
  userId?: string | null;
  userEmail?: string | null;
  clinicId?: string | null;
  role?: string | null;
};

type SendAppointmentNotificationParams = {
  supabase: any;
  patientId: string;
  patientEmail?: string | null;
  appointment: {
    id: string;
    scheduledAt?: string | null;
    timeLabel?: string | null;
    dateLabel?: string | null;
    reminderKind?: string | null;
  };
  title?: string;
  body?: string;
  reminderKind?: string;
  logger?: Logger;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const sanitizeEmail = (value: unknown) => {
  const email = sanitizeText(value, 320).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
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

  const addPatientRows = (rows: any[]) => {
    for (const row of rows || []) {
      const id = sanitizeText(row?.id, 120);
      if (isUuid(id)) ids.add(id);
    }
  };

  if (isUuid(explicitPatientId)) {
    let query = params.supabase
      .from('patients')
      .select('id, clinic_id')
      .eq('id', explicitPatientId)
      .limit(1);
    if (clinicId && isUuid(clinicId)) {
      query = query.eq('clinic_id', clinicId);
    }
    const { data, error } = await query;
    if (!error) addPatientRows(data || []);
  }

  if (email) {
    let query = params.supabase
      .from('patients')
      .select('id, clinic_id')
      .ilike('email', email)
      .limit(100);
    if (clinicId && isUuid(clinicId)) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data, error } = await query;
    if (!error) addPatientRows(data || []);

    if (!ids.size && clinicId && isUuid(clinicId)) {
      const fallback = await params.supabase
        .from('patients')
        .select('id')
        .ilike('email', email)
        .limit(100);
      if (!fallback.error) addPatientRows(fallback.data || []);
    }
  }

  if (!ids.size && isUuid(userId)) {
    const { data, error } = await params.supabase
      .from('patients')
      .select('id')
      .eq('id', userId)
      .limit(1);
    if (!error && data?.[0]?.id) ids.add(sanitizeText(data[0].id, 120));
  }

  return Array.from(ids);
}

export async function savePatientPushSubscription(params: SavePushSubscriptionParams) {
  const normalized = normalizePushSubscription(params.subscription);
  if (!normalized) {
    return { success: false, error: 'Inscricao push invalida.' };
  }

  const patientId = sanitizeText(params.patientId, 120);
  if (!isUuid(patientId)) {
    return { success: false, error: 'Paciente invalido para inscricao push.' };
  }

  const now = new Date().toISOString();
  let payload: Record<string, any> = {
    patient_id: patientId,
    endpoint: normalized.endpoint,
    p256dh: normalized.keys.p256dh,
    auth: normalized.keys.auth,
    subscription: normalized,
    user_id: isUuid(params.userId) ? sanitizeText(params.userId, 120) : null,
    user_email: sanitizeEmail(params.userEmail) || null,
    clinic_id: sanitizeText(params.clinicId, 120) || null,
    role: sanitizeText(params.role, 40) || null,
    created_at: now,
    updated_at: now
  };

  const removeMissingColumn = (error: any) => {
    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn || !(missingColumn in payload) || !isRemovablePushColumn(missingColumn)) {
      return false;
    }
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
        return { success: true, updated: Array.isArray(data) && data.length > 0, error: null };
      }
      if (removeMissingColumn(error)) continue;
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

    if (!error) return { success: true, patientId, endpoint: normalized.endpoint };
    if (isDuplicatePushError(error)) {
      const retryUpdate = await updateExisting();
      if (retryUpdate.success) {
        return { success: true, patientId, endpoint: normalized.endpoint };
      }
      return { success: false, error: retryUpdate.error?.message || error.message || 'Erro ao salvar inscricao push.' };
    }

    if (!removeMissingColumn(error)) {
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
  logger?: Logger;
}) {
  const patientIds = new Set(params.patientIds.filter((id) => isUuid(id)));
  const legacyUserIds = new Set((params.legacyUserIds || []).filter((id) => isUuid(id)));
  const patientEmail = sanitizeEmail(params.patientEmail);

  const { data, error } = await params.supabase
    .from('push_subscriptions')
    .select('*')
    .limit(5000);

  if (error) {
    params.logger?.warn?.('[Push] Nao foi possivel buscar push_subscriptions.', {
      message: error.message
    });
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  const matches = rows.filter((row: any) => {
    const rowPatientId = sanitizeText(row?.patient_id, 120);
    const rowUserId = sanitizeText(row?.user_id, 120);
    const rowEmail = sanitizeEmail(row?.user_email);
    return (
      (rowPatientId && patientIds.has(rowPatientId)) ||
      (rowUserId && (patientIds.has(rowUserId) || legacyUserIds.has(rowUserId))) ||
      (patientEmail && rowEmail === patientEmail)
    );
  });

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

export async function sendAppointmentNotification(params: SendAppointmentNotificationParams) {
  const logger = params.logger || console;
  const patientIds = await resolvePatientIdsForPush({
    supabase: params.supabase,
    patientId: params.patientId,
    patientEmail: params.patientEmail
  });
  const legacyIds = isUuid(params.patientId) ? [params.patientId] : [];
  const rows = await findPushSubscriptionsForPatient({
    supabase: params.supabase,
    patientIds,
    patientEmail: params.patientEmail,
    legacyUserIds: legacyIds,
    logger
  });

  if (!rows.length) {
    logger.warn('[Push] Nenhuma subscription encontrada para consulta.', {
      appointmentId: params.appointment.id,
      patientId: params.patientId,
      patientEmail: sanitizeEmail(params.patientEmail) || null
    });
    return { sent: 0, failed: 0 };
  }

  const timeLabel = sanitizeText(params.appointment.timeLabel, 80);
  const dateLabel = sanitizeText(params.appointment.dateLabel, 80);
  const whenLabel = [dateLabel, timeLabel].filter(Boolean).join(' as ');
  const reminderKind = sanitizeText(params.reminderKind || params.appointment.reminderKind || 'appointment', 40);
  const payload = JSON.stringify({
    title: params.title || 'Confirmacao de Consulta - Verto',
    body:
      params.body ||
      (whenLabel
        ? `Voce tem consulta em ${whenLabel}. O que deseja fazer?`
        : 'Voce tem uma consulta pela Verto. O que deseja fazer?'),
    url: `/consulta?appointment_id=${encodeURIComponent(params.appointment.id)}`,
    appointmentId: params.appointment.id,
    scheduledAt: params.appointment.scheduledAt || null,
    reminderKind,
    dateLabel,
    timeLabel,
    actions: [
      { action: 'confirmed', title: 'Confirmar' },
      { action: 'reschedule', title: 'Remarcar' },
      { action: 'cancelled', title: 'Cancelar' }
    ]
  });

  let sent = 0;
  let failed = 0;

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
        await deleteInvalidPushSubscription({
          supabase: params.supabase,
          endpoint: entry.subscription.endpoint,
          logger
        });
      }
    }
  }

  return { sent, failed };
}
