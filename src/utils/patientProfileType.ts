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


// The age-band selector in patient registration is clinical routing input, not
// merely a visual label. A previous edit could persist group=infantil while
// leaving patient_profile_type=ADULT, opening the adult collection by mistake.
export const isPediatricPatientGroup = (group: unknown): boolean => {
  const key = String(group ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return ['infantil', 'crianca', 'adolescente', 'child', 'teen', 'adolescent'].includes(key);
};

export const profileTypeForPatientGroup = (
  group: unknown,
  selectedProfile: unknown,
): PatientProfileType => isPediatricPatientGroup(group)
  ? 'KIDS'
  : normalizePatientProfileType(selectedProfile);

export type PatientPortalKind = 'KIDS' | 'ADULT_ABA' | 'ADULT_CONVENTIONAL';

const parseAgeValue = (value: any): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const ageFromBirthDate = (value: any): number | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

export const resolvePatientPortalKind = (patient: any): PatientPortalKind => {
  // Fail closed for pediatric sessions. The persisted demographic age band
  // outranks conflicting legacy ADULT defaults until both fields are repaired.
  if (isPediatricPatientGroup(
    patient?.group || patient?.patient_group || patient?.grupo ||
    patient?.anamnesisData?.grupo || patient?.anamnese?.grupo
  )) return 'KIDS';

  const explicitCandidates = [
    patient?.patientProfileType,
    patient?.patient_profile_type,
    patient?.profileType,
    patient?.profile_type,
    patient?.type,
    patient?.portalType,
    patient?.portal_type,
    patient?.anamnesisData?.patientProfileType,
    patient?.anamnesisData?.profileType,
    patient?.anamnesisData?.formType,
  ];

  for (const candidate of explicitCandidates) {
    const raw = String(candidate ?? '').trim();
    if (!raw) continue;
    const key = cleanProfileKey(raw);
    if (['kids_tea', 'kids', 'kid', 'child', 'infantil', 'crianca', 'crianca_tea', 'teen', 'adolescente', 'adolescent'].includes(key)) {
      return 'KIDS';
    }
    if (['adult_tea', 'adulto_tea', 'adulto_aba', 'aba'].includes(key) || raw.toUpperCase() === 'ABA') {
      return 'ADULT_ABA';
    }
    if (['adult_conventional', 'adulto_convencional', 'adult', 'adulto', 'conventional', 'neurotipico', 'neurotypical', 'general', 'geral'].includes(key) || raw.toUpperCase() === 'ADULT') {
      return 'ADULT_CONVENTIONAL';
    }
    if (raw.toUpperCase() === 'KIDS') return 'KIDS';
  }

  const age =
    parseAgeValue(patient?.age) ??
    ageFromBirthDate(patient?.birth_date) ??
    ageFromBirthDate(patient?.birthDate) ??
    ageFromBirthDate(patient?.dataNascimento) ??
    ageFromBirthDate(patient?.anamnesisData?.dataNascimento);

  return age !== null && age <= 12 ? 'KIDS' : 'ADULT_CONVENTIONAL';
};

export const isAdultPatientPortal = (patient: any) => resolvePatientPortalKind(patient) !== 'KIDS';
