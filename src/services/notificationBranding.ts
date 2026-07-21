import { VERTO_BRAND_ASSETS, isVertoInstitutionalAsset } from '../constants/vertoBranding';

export type BrandingSourceType = "clinic" | "professional" | "verto_fallback";

export type BrandingContext = {
  displayName: string;
  logoUrl: string | null;
  accentColor: string;
  sourceType: BrandingSourceType;
  initialsFallback: string;
};

type BrandingInput = {
  clinic?: Record<string, any> | null;
  professional?: Record<string, any> | null;
  allowProfessionalFallback?: boolean;
  fallbackName?: string;
  fallbackLogoUrl?: string | null;
  fallbackAccentColor?: string | null;
};

type ReminderPayloadInput = {
  appointmentId: string;
  scheduledAt?: string | null;
  dateLabel?: string | null;
  timeLabel?: string | null;
  patientName?: string | null;
  reminderKind?: string | null;
  branding: BrandingContext;
  url?: string | null;
};

type ReminderModalInput = {
  appointmentId: string;
  scheduledAt?: string | null;
  dateLabel?: string | null;
  timeLabel?: string | null;
  patientName?: string | null;
  status?: string | null;
  branding: BrandingContext;
};

const DEFAULT_CLINIC_NAME = "Clínica";
export const VERTO_NOTIFICATION_ICON_URL = VERTO_BRAND_ASSETS.notificationIcon;
export const VERTO_NOTIFICATION_BADGE_URL = VERTO_BRAND_ASSETS.notificationBadge;
const APPOINTMENT_RESPONSE_COPY = "Toque para confirmar, remarcar ou cancelar.";
const FRIENDLY_ERROR_COPY = "Não foi possível concluir sua solicitação agora. Tente novamente em alguns instantes.";

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? "").trim().slice(0, maxLength);

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = sanitizeText(value, 240);
    if (text) return text;
  }
  return "";
};

const firstUrl = (...values: unknown[]) => {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    if (isVertoInstitutionalAsset(raw)) continue;
    if (/^data:image\//i.test(raw)) return raw.slice(0, 1_000_000);
    const text = raw.slice(0, 2000);
    if (/^(https?:\/\/|\/)/i.test(text)) return text;
  }
  return "";
};

const isGenericClinicName = (value: string) =>
  ["sua clinica", "sua clínica", "minha clinica", "minha clínica", "clinica", "clínica", "clinica verto", "clínica verto", "verto"].includes(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );

const normalizedIdentity = (value: unknown) =>
  sanitizeText(value, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const namesLookLikeSamePerson = (left: unknown, right: unknown) => {
  const clinicName = normalizedIdentity(left);
  const professionalName = normalizedIdentity(right);
  if (!clinicName || !professionalName) return false;
  if (clinicName === professionalName) return true;
  const clinicTokens = clinicName.split(/\s+/).filter(Boolean);
  return clinicTokens.length === 1 && professionalName.split(/\s+/).includes(clinicTokens[0]);
};

export function buildBrandingInitials(value: unknown) {
  const words = sanitizeText(value || DEFAULT_CLINIC_NAME, 120)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = words.map((word) => word.charAt(0).toUpperCase()).join("");
  return initials || "V";
}

export function resolveBrandingContext(input: BrandingInput = {}): BrandingContext {
  const clinic = input.clinic || {};
  const professional = input.professional || {};
  const hasClinicIdentity = Boolean(firstText(
    clinic.id,
    clinic.clinic_id,
    clinic.clinicId,
    clinic.organization_id,
    clinic.organizationId
  ));
  const professionalName = firstText(
    professional.professional_display_name,
    professional.professionalDisplayName,
    professional.displayName,
    professional.fullName,
    professional.full_name,
    professional.name
  );
  const clinicName = firstText(
    clinic.clinic_display_name,
    clinic.clinicDisplayName,
    clinic.displayName,
    clinic.name,
    clinic.clinic_name,
    clinic.clinicName
  );
  const clinicLogoUrl = firstUrl(
    clinic.clinic_logo_url,
    clinic.clinicLogoUrl,
    clinic.logoUrl,
    clinic.logo_url,
    clinic.logo
  );
  const clinicAccent = firstText(clinic.clinic_primary_color, clinic.clinicPrimaryColor, clinic.primaryColor, clinic.primary_color);
  const clinicNameIsUsable =
    clinicName &&
    !isGenericClinicName(clinicName) &&
    !(hasClinicIdentity && namesLookLikeSamePerson(clinicName, professionalName));
  if (clinicNameIsUsable || clinicLogoUrl) {
    const displayName = clinicNameIsUsable ? clinicName : "Clínica";
    return {
      displayName,
      logoUrl: clinicLogoUrl || null,
      accentColor: clinicAccent || input.fallbackAccentColor || "#7C3AED",
      sourceType: "clinic",
      initialsFallback: buildBrandingInitials(displayName),
    };
  }

  const professionalLogoUrl = firstUrl(
    professional.professional_logo_url,
    professional.professionalLogoUrl,
    professional.logoUrl,
    professional.logo_url,
    professional.avatarUrl,
    professional.avatar_url,
    professional.profilePicture,
    professional.profile_picture
  );
  const professionalAccent = firstText(professional.professional_primary_color, professional.primaryColor, professional.primary_color);
  const canUseProfessionalFallback = input.allowProfessionalFallback === true;
  if (canUseProfessionalFallback && (professionalName || professionalLogoUrl)) {
    const displayName = professionalName || "Profissional";
    return {
      displayName,
      logoUrl: professionalLogoUrl || null,
      accentColor: professionalAccent || input.fallbackAccentColor || "#7C3AED",
      sourceType: "professional",
      initialsFallback: buildBrandingInitials(displayName),
    };
  }

  const fallbackName = sanitizeText(input.fallbackName, 120) || DEFAULT_CLINIC_NAME;
  return {
    displayName: fallbackName,
    logoUrl: firstUrl(input.fallbackLogoUrl) || null,
    accentColor: input.fallbackAccentColor || "#7C3AED",
    sourceType: "verto_fallback",
    initialsFallback: buildBrandingInitials(fallbackName),
  };
}

function formatDateLabel(value?: string | null) {
  const safe = sanitizeText(value, 40);
  if (!safe) return "";
  const [day, month] = safe.split("/");
  return day && month ? `${day.padStart(2, "0")}/${month.padStart(2, "0")}` : safe;
}

function decorateDateLabel(dateLabel?: string | null, scheduledAt?: string | null) {
  const shortDate = formatDateLabel(dateLabel);
  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  if (!scheduled || Number.isNaN(scheduled.getTime())) return shortDate;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate()).getTime();
  const diffDays = Math.round((targetStart - todayStart) / 86400000);
  if (diffDays === 0) return `${shortDate} (hoje)`;
  if (diffDays === 1) return `${shortDate} (amanhã)`;
  return shortDate;
}

function buildWhenText(input: { dateLabel?: string | null; timeLabel?: string | null; scheduledAt?: string | null }) {
  const dateLabel = decorateDateLabel(input.dateLabel, input.scheduledAt);
  const timeLabel = sanitizeText(input.timeLabel, 20);
  if (dateLabel && timeLabel) return `dia ${dateLabel} às ${timeLabel}`;
  if (timeLabel) return `às ${timeLabel}`;
  if (dateLabel) return `dia ${dateLabel}`;
  return "";
}

function buildReminderModalWhenText(input: { dateLabel?: string | null; timeLabel?: string | null; scheduledAt?: string | null }) {
  const dateLabel = decorateDateLabel(input.dateLabel, input.scheduledAt);
  const timeLabel = sanitizeText(input.timeLabel, 20);
  if (dateLabel && timeLabel) return `${dateLabel} às ${timeLabel}`;
  if (timeLabel) return `às ${timeLabel}`;
  return dateLabel;
}

function isGenericReminderPatientName(value: unknown) {
  const normalized = sanitizeText(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return !normalized || ["paciente", "patient", "paciente nao identificado", "patient not identified"].includes(normalized);
}

export function buildPatientReminderNotificationPayload(input: ReminderPayloadInput) {
  const appointmentId = sanitizeText(input.appointmentId, 120);
  const reminderKind = sanitizeText(input.reminderKind, 40) || "appointment";
  const whenText = buildWhenText(input);
  const patientName = sanitizeText(input.patientName, 160);
  const body = patientName
    ? `Lembrete de consulta de ${patientName}${whenText ? ` ${whenText}` : ""}. ${APPOINTMENT_RESPONSE_COPY}`
    : `Lembrete de consulta${whenText ? ` ${whenText}` : ""}. ${APPOINTMENT_RESPONSE_COPY}`;
  const fallbackUrl = appointmentId ? `/?appointment_id=${encodeURIComponent(appointmentId)}` : "/";
  const url = sanitizeText(input.url, 2000) || fallbackUrl;
  const clinicLogoUrl = firstUrl(input.branding.logoUrl) || null;
  return {
    title: input.branding.displayName,
    body,
    icon: clinicLogoUrl || VERTO_NOTIFICATION_ICON_URL,
    badge: VERTO_NOTIFICATION_BADGE_URL,
    tag: appointmentId ? `appointment-reminder-${appointmentId}-${reminderKind}` : undefined,
    url,
    appointmentId,
    scheduledAt: sanitizeText(input.scheduledAt, 120) || null,
    reminderKind,
    dateLabel: sanitizeText(input.dateLabel, 40),
    timeLabel: sanitizeText(input.timeLabel, 40),
    branding: input.branding,
    data: {
      url,
      appointmentId,
      reminderKind,
      brandName: input.branding.displayName,
      brandLogoUrl: clinicLogoUrl,
      brandSourceType: input.branding.sourceType,
    },
  };
}

export function buildPatientReminderModalViewModel(input: ReminderModalInput) {
  const patientName = sanitizeText(input.patientName, 160);
  const hasPatientName = !isGenericReminderPatientName(patientName);
  const whenText = buildReminderModalWhenText(input);
  return {
    brandName: input.branding.displayName,
    brandLogoUrl: input.branding.logoUrl,
    initialsFallback: input.branding.initialsFallback,
    accentColor: input.branding.accentColor,
    sourceType: input.branding.sourceType,
    headerText: input.branding.displayName,
    appointmentSummaryText: hasPatientName
      ? whenText
        ? `Olá, ${patientName}! Sua sessão está marcada para ${whenText}.`
        : `Olá, ${patientName}! Sua sessão está marcada.`
      : whenText
        ? `Sua sessão está marcada para ${whenText}.`
        : 'Sua sessão está marcada.',
    statusLabel: sanitizeText(input.status, 80),
    confirmLabel: "Confirmar presença",
    rescheduleLabel: "Remarcar consulta",
    cancelLabel: "Cancelar agendamento",
    friendlyErrorCopy: FRIENDLY_ERROR_COPY,
  };
}

export function friendlyPatientNotificationError(raw: unknown) {
  const text = sanitizeText(raw, 500);
  if (!text) return FRIENDLY_ERROR_COPY;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/sessao|session|unauthorized|login|autentic/.test(normalized)) {
    return "Acesse novamente sua conta para gerenciar esta consulta.";
  }
  if (/internal|servidor|server|stack|supabase|postgrest|token|jwt|exception|erro interno/i.test(text)) {
    return FRIENDLY_ERROR_COPY;
  }
  return text;
}
