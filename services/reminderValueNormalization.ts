import { isVertoInstitutionalAsset } from '../src/constants/vertoBranding';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

export const sanitizeEmail = (value: unknown) => {
  const email = sanitizeText(value, 320).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};


export const isUuid = (value: unknown) => UUID_REGEX.test(sanitizeText(value, 120));

export const extractReminderMissingColumnName = (error: unknown) => {
  const message = sanitizeText((error as any)?.message || error, 1000);
  if (!message) return '';
  const direct = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (direct?.[1]) return direct[1].toLowerCase();
  const qualified = message.match(/column\s+[a-zA-Z0-9_]+\."?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (qualified?.[1]) return qualified[1].toLowerCase();
  const schemaCache = message.match(/could\s+not\s+find\s+the\s+'?([a-zA-Z0-9_]+)'?\s+column/i);
  return schemaCache?.[1]?.toLowerCase() || '';
};

export const extractReminderClinicLogoStoragePath = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('patient-photos/')) return raw.slice('patient-photos/'.length);
  if (raw.startsWith('/api/storage/patient-photos/view?')) {
    try {
      return new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('path') || '';
    } catch {
      return '';
    }
  }
  const storageMatch = raw.match(/\/storage\/v1\/object\/(?:sign|public)\/patient-photos\/([^?]+)/i);
  if (!storageMatch?.[1]) return '';
  try {
    return decodeURIComponent(storageMatch[1]);
  } catch {
    return storageMatch[1];
  }
};

export const isGenericClinicNotificationName = (value: unknown) => {
  const normalized = sanitizeText(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return !normalized || ['sua clinica', 'minha clinica', 'clinica', 'clinica verto', 'verto'].includes(normalized);
};

export const sanitizeClinicNotificationLogoUrl = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const text = /^data:image\//i.test(raw) ? raw.slice(0, 1_000_000) : raw.slice(0, 2_000);
  if (!text) return '';
  if (isVertoInstitutionalAsset(text)) return '';
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  if (/^https?:\/\//i.test(text) || (text.startsWith('/') && !text.startsWith('//'))) return text;
  if (text.startsWith('patient-photos/') || /^[\w./-]+\.(png|jpe?g|webp)$/i.test(text)) {
    return `/api/storage/patient-photos/view?path=${encodeURIComponent(text)}`;
  }
  return '';
};

export const isActiveAppointmentStatus = (status: unknown) => {
  const normalized = sanitizeText(status || 'scheduled', 40).toLowerCase();
  return ![
    'cancelled',
    'canceled',
    'completed',
    'rescheduled',
    'reschedule',
    'deleted',
    'inactive'
  ].includes(normalized);
};
