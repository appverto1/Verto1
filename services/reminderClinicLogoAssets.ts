import crypto from 'crypto';

type ClinicBrandingResolverOptions = {
  supabase: any;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
};

type ReminderClinicLogoAssetsDeps = {
  sanitizeText: (value: unknown, maxLength?: number) => string;
  isUuid: (value: unknown) => boolean;
  extractReminderClinicLogoStoragePath: (value: unknown) => string;
  sanitizeClinicNotificationLogoUrl: (value: unknown) => string;
};

export function createReminderClinicLogoAssetsService(deps: ReminderClinicLogoAssetsDeps) {
  const { sanitizeText, isUuid, extractReminderClinicLogoStoragePath, sanitizeClinicNotificationLogoUrl } = deps;

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

  return {
    buildStableClinicNotificationLogoUrl,
    verifyStableClinicNotificationLogoSignature,
    resolvePushSafeClinicLogoUrl,
  };
}
