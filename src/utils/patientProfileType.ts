export const PATIENT_PROFILE_TYPE_OPTIONS = [
  { value: 'KIDS', label: 'Paciente Kids' },
  { value: 'TEEN', label: 'Paciente Adolescente' },
  { value: 'ADULT', label: 'Paciente Adulto' },
  { value: 'ABA', label: 'Paciente ABA' },
  { value: 'GENERAL', label: 'Paciente Geral' },
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
  teen: 'TEEN',
  adolescente: 'TEEN',
  adolescent: 'TEEN',
  adult: 'ADULT',
  adulto: 'ADULT',
  adult_tea: 'ADULT',
  adult_conventional: 'ADULT',
  conventional: 'ADULT',
  aba: 'ABA',
  general: 'GENERAL',
  geral: 'GENERAL',
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
  return PATIENT_PROFILE_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || 'Paciente Adulto';
};

export const mapPatientProfileTypeToLegacyPortalType = (value: any) => {
  const normalized = normalizePatientProfileType(value);
  if (normalized === 'KIDS' || normalized === 'ABA') return 'kids_tea';
  if (normalized === 'TEEN') return 'kids_tea';
  return 'adult_conventional';
};
