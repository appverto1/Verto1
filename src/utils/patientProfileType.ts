export const PATIENT_PROFILE_TYPE_OPTIONS = [
  { value: 'KIDS', label: 'Kids ABA (portal infantil)' },
  { value: 'ABA', label: 'Adulto ABA (adulto TEA)' },
  { value: 'ADULT', label: 'Adulto convencional (adulto neurotípico)' },
] as const;

export type PatientProfileType = (typeof PATIENT_PROFILE_TYPE_OPTIONS)[number]['value'];

const PROFILE_TYPE_ALIASES: Record<string, PatientProfileType> = {
  kids: 'KIDS',
  kid: 'KIDS',
  child: 'KIDS',
  infantil: 'KIDS',
  crianca: 'KIDS',
  crianca_tea: 'KIDS',
  kids_tea: 'KIDS',
  teen: 'KIDS',
  adolescente: 'KIDS',
  adolescent: 'KIDS',
  adult: 'ADULT',
  adulto: 'ADULT',
  adult_tea: 'ABA',
  adulto_tea: 'ABA',
  adulto_aba: 'ABA',
  adult_conventional: 'ADULT',
  adulto_convencional: 'ADULT',
  neurotipico: 'ADULT',
  neurotypical: 'ADULT',
  conventional: 'ADULT',
  aba: 'ABA',
  general: 'ADULT',
  geral: 'ADULT',
};

const cleanProfileKey = (value: any) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');

export const normalizePatientProfileType = (value: any, fallback: PatientProfileType = 'ADULT'): PatientProfileType => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (PATIENT_PROFILE_TYPE_OPTIONS.some((option) => option.value === upper)) {
    return upper as PatientProfileType;
  }
  return PROFILE_TYPE_ALIASES[cleanProfileKey(raw)] || fallback;
};

export const getPatientProfileTypeLabel = (value: any) => {
  const normalized = normalizePatientProfileType(value);
  return PATIENT_PROFILE_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || 'Adulto convencional (adulto neurotípico)';
};

export const mapPatientProfileTypeToLegacyPortalType = (value: any) => {
  const normalized = normalizePatientProfileType(value);
  if (normalized === 'KIDS') return 'kids_tea';
  if (normalized === 'ABA') return 'adult_tea';
  return 'adult_conventional';
};
