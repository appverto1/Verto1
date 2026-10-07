import crypto from 'crypto';

type BrandingLogger = Pick<Console, 'log' | 'warn' | 'error'>;

type ClinicBrandingResolverOptions = {
  supabase: any;
  logger: BrandingLogger;
};

type AppointmentReminderBrandingDeps = {
  sanitizeText: (value: unknown, maxLength?: number) => string;
  isUuid: (value: unknown) => boolean;
  extractReminderMissingColumnName: (error: unknown) => string;
  extractReminderClinicLogoStoragePath: (value: unknown) => string;
  isGenericClinicNotificationName: (value: unknown) => boolean;
  sanitizeClinicNotificationLogoUrl: (value: unknown) => string;
  defaultClinicName: string;
  cacheTtlMs: number;
};

export function createAppointmentReminderBrandingService(deps: AppointmentReminderBrandingDeps) {
  const {
    sanitizeText,
    isUuid,
    extractReminderMissingColumnName,
    extractReminderClinicLogoStoragePath,
    isGenericClinicNotificationName,
    sanitizeClinicNotificationLogoUrl,
    defaultClinicName,
    cacheTtlMs,
  } = deps;

  const clinicBrandingCache = new Map<string, {
    clinicName: string;
    clinicLogoUrl: string | null;
    expiresAtMs: number;
  }>();

  const invalidateReminderClinicBranding = (clinicId?: string | null) => {
    const safeClinicId = sanitizeText(clinicId, 120);
    if (safeClinicId) clinicBrandingCache.delete(safeClinicId);
  };

  const notificationAssetSigningSecret = () =>
    sanitizeText(process.env.SESSION_SECRET, 500);

  const notificationAssetSignature = (clinicId: string, storagePath: string) => {
    const secret = notificationAssetSigningSecret();
    if (!secret) return '';
    return crypto
      .createHmac('sha256', secret)
      .update(`${clinicId}:${storagePath}`)
      .digest('hex');
  };

  const buildStableClinicNotificationLogoUrl = (
    clinicId: unknown,
    storagePath: unknown,
  ): string | null => {
    const safeClinicId = sanitizeText(clinicId, 120);
    const safeStoragePath = extractReminderClinicLogoStoragePath(storagePath) || sanitizeText(storagePath, 2000);
    if (!isUuid(safeClinicId) || !safeStoragePath || safeStoragePath.includes('..')) return null;
    const signature = notificationAssetSignature(safeClinicId, safeStoragePath);
    if (!signature) return null;
    const baseUrl = sanitizeText(
      process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || 'https://www.appverto.com.br',
      500,
    ).replace(/\/+$/, '');
    if (!/^https:\/\//i.test(baseUrl)) return null;
    const query = new URLSearchParams({
      clinic_id: safeClinicId,
      path: safeStoragePath,
      signature,
    });
    return `${baseUrl}/api/public/notification-assets/clinic-logo?${query.toString()}`;
  };

  const verifyStableClinicNotificationLogoSignature = (params: {
    clinicId: unknown;
    storagePath: unknown;
    signature: unknown;
  }): boolean => {
    const clinicId = sanitizeText(params.clinicId, 120);
    const storagePath = sanitizeText(params.storagePath, 2000);
    const signature = sanitizeText(params.signature, 128).toLowerCase();
    if (!isUuid(clinicId) || !storagePath || storagePath.includes('..') || !/^[a-f0-9]{64}$/.test(signature)) {
      return false;
    }
    const expected = notificationAssetSignature(clinicId, storagePath);
    if (!expected) return false;
    const providedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  };

  const resolvePushSafeClinicLogoUrl = async (
    options: ClinicBrandingResolverOptions,
    candidates: unknown[],
    clinicId?: string | null,
  ) => {
    for (const candidate of candidates) {
      const storagePath = extractReminderClinicLogoStoragePath(candidate);
      if (storagePath && !storagePath.includes('..')) {
        const stableUrl = buildStableClinicNotificationLogoUrl(clinicId, storagePath);
        if (stableUrl) return stableUrl;
        options.logger.warn('[Appointment Reminder Cron] Logo institucional não recebeu URL pública estável.', {
          clinicId: sanitizeText(clinicId, 120) || null,
          storagePath,
        });
        continue;
      }

      const safeUrl = sanitizeClinicNotificationLogoUrl(candidate);
      if (/^https?:\/\//i.test(safeUrl) || (safeUrl.startsWith('/') && !safeUrl.startsWith('/api/'))) {
        return safeUrl;
      }
    }
    return null;
  };

  const resolveReminderClinicBranding = async (
    options: ClinicBrandingResolverOptions,
    clinicId?: string | null,
  ) => {
    const safeClinicId = sanitizeText(clinicId, 120);
    if (!isUuid(safeClinicId)) {
      return { clinicName: defaultClinicName, clinicLogoUrl: null };
    }
    const cached = clinicBrandingCache.get(safeClinicId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return { clinicName: cached.clinicName, clinicLogoUrl: cached.clinicLogoUrl };
    }
    if (cached) clinicBrandingCache.delete(safeClinicId);

    const read = (columns: string) =>
      options.supabase
        .from('clinics')
        .select(columns)
        .eq('id', safeClinicId)
        .limit(1)
        .maybeSingle();

    let data: any = null;
    let error: any = null;
    let clinicColumns = ['id', 'name', 'display_name', 'legal_name', 'logo_url', 'owner_user_id'];
    while (clinicColumns.length >= 2) {
      const result = await read(clinicColumns.join(','));
      data = result.data;
      error = result.error;
      if (!error) break;
      const missingColumn = extractReminderMissingColumnName(error);
      if (!missingColumn || !clinicColumns.includes(missingColumn)) break;
      clinicColumns = clinicColumns.filter((column) => column !== missingColumn);
    }
    if (error) {
      options.logger.warn('[Appointment Reminder Cron] Branding da clinica nao carregado.', {
        clinicId: safeClinicId,
        message: error.message
      });
      const fallback = {
        clinicName: defaultClinicName,
        clinicLogoUrl: null,
        expiresAtMs: Date.now() + cacheTtlMs,
      };
      clinicBrandingCache.set(safeClinicId, fallback);
      return fallback;
    }

    let profileBrandingRows: any[] = [];
    const readProfileBranding = (columns: string) =>
      options.supabase
        .from('professional_profiles')
        .select(columns)
        .eq('clinic_id', safeClinicId)
        .order('updated_at', { ascending: false })
        .limit(20);
    let profileBranding = await readProfileBranding('user_id,full_name,clinic_name,clinic_logo_url,metadata,updated_at');
    if (profileBranding.error && extractReminderMissingColumnName(profileBranding.error) === 'metadata') {
      profileBranding = await readProfileBranding('user_id,full_name,clinic_name,clinic_logo_url,updated_at');
    }
    if (!profileBranding.error) {
      profileBrandingRows = Array.isArray(profileBranding.data) ? profileBranding.data : [];
    } else if (extractReminderMissingColumnName(profileBranding.error) === 'clinic_id' && isUuid(data?.owner_user_id)) {
      let ownerProfile = await options.supabase
        .from('professional_profiles')
        .select('user_id,full_name,clinic_name,clinic_logo_url,metadata,updated_at')
        .eq('user_id', data.owner_user_id)
        .limit(1)
        .maybeSingle();
      if (ownerProfile.error && extractReminderMissingColumnName(ownerProfile.error) === 'metadata') {
        ownerProfile = await options.supabase
          .from('professional_profiles')
          .select('user_id,full_name,clinic_name,clinic_logo_url,updated_at')
          .eq('user_id', data.owner_user_id)
          .limit(1)
          .maybeSingle();
      }
      if (!ownerProfile.error && ownerProfile.data) profileBrandingRows = [ownerProfile.data];
    }
    const institutionalProfile = profileBrandingRows.find((row: any) => {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return sanitizeText(row?.clinic_name || metadata.clinicName || metadata.clinicSettings?.clinicName, 160) ||
        sanitizeClinicNotificationLogoUrl(row?.clinic_logo_url || metadata.clinicLogoUrl || metadata.clinicSettings?.clinicLogoUrl);
    });
    const profileWithUsableName = profileBrandingRows.find((row: any) => {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return !isGenericClinicNotificationName(
        row?.clinic_name ||
          metadata.clinicName ||
          metadata.clinicSettings?.clinicName ||
          metadata.clinic_settings?.clinicName
      );
    });
    const profileWithUsableLogo = profileBrandingRows.find((row: any) => {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return sanitizeClinicNotificationLogoUrl(
        row?.clinic_logo_url ||
          metadata.clinicLogoUrl ||
          metadata.clinicSettings?.clinicLogoUrl ||
          metadata.clinic_settings?.clinicLogoUrl ||
          metadata.clinicLogoPath ||
          metadata.clinicSettings?.clinicLogoPath ||
          metadata.clinic_settings?.clinicLogoPath
      );
    });
    const profileNameSource = profileWithUsableName || institutionalProfile;
    const profileLogoSource = profileWithUsableLogo || institutionalProfile;
    const profileNameMetadata = profileNameSource?.metadata && typeof profileNameSource.metadata === 'object'
      ? profileNameSource.metadata
      : {};
    const profileLogoMetadata = profileLogoSource?.metadata && typeof profileLogoSource.metadata === 'object'
      ? profileLogoSource.metadata
      : {};
    const clinicName = sanitizeText(data?.display_name || data?.name || data?.legal_name, 160);
    const profileClinicName = sanitizeText(
      profileNameSource?.clinic_name ||
        profileNameMetadata.clinicName ||
        profileNameMetadata.clinicSettings?.clinicName ||
        profileNameMetadata.clinic_settings?.clinicName,
      160
    );
    const clinicLogoUrl = await resolvePushSafeClinicLogoUrl(options, [
      profileLogoSource?.clinic_logo_url,
      profileLogoMetadata.clinicLogoUrl,
      profileLogoMetadata.clinicSettings?.clinicLogoUrl,
      profileLogoMetadata.clinic_settings?.clinicLogoUrl,
      profileLogoMetadata.clinicLogoPath,
      profileLogoMetadata.clinicSettings?.clinicLogoPath,
      profileLogoMetadata.clinic_settings?.clinicLogoPath,
      data?.logo_url,
    ], safeClinicId);
    const ownerProfessionalName = sanitizeText(profileNameSource?.full_name, 180);
    const clinicNameIsOwnerName = Boolean(
      clinicName && ownerProfessionalName &&
      clinicName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() ===
        ownerProfessionalName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    );
    const branding = {
      clinicName: !isGenericClinicNotificationName(profileClinicName)
        ? profileClinicName
        : (!isGenericClinicNotificationName(clinicName) && !clinicNameIsOwnerName ? clinicName : defaultClinicName),
      clinicLogoUrl,
      expiresAtMs: Date.now() + cacheTtlMs,
    };
    clinicBrandingCache.set(safeClinicId, branding);
    return { clinicName: branding.clinicName, clinicLogoUrl: branding.clinicLogoUrl };
  };

  return {
    invalidateReminderClinicBranding,
    buildStableClinicNotificationLogoUrl,
    verifyStableClinicNotificationLogoSignature,
    resolvePushSafeClinicLogoUrl,
    resolveReminderClinicBranding,
  };
}
