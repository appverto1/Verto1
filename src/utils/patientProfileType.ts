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

// A categoria do cadastro e o perfil da coleta devem ser coerentes. A escolha
// explícita do formulário só é persistida ao clicar em Salvar; não inferir a
// categoria de um paciente adulto a partir de defaults antigos de KIDS.
export const resolvePatientProfileTypeForCategory = (
  category: any,
  currentProfileType: any,
): PatientProfileType => {
  const key = cleanProfileKey(category);
  if (key === 'infantil' || key === 'adolescente') return 'KIDS';
  if (key === 'adulto' || key === 'idoso') {
    return normalizePatientProfileType(currentProfileType) === 'ABA' ? 'ABA' : 'ADULT';
  }
  return normalizePatientProfileType(currentProfileType);
};

export const resolvePatientRegistrationCategory = (patient: any): string => {
  const stored = cleanProfileKey(patient?.patient_group || patient?.group || patient?.grupo);
  if (['infantil', 'adolescente', 'adulto', 'idoso'].includes(stored)) return stored;
  const storedProfile = patient?.patientProfileType || patient?.patient_profile_type ||
    patient?.panelType || patient?.panel_type || patient?.profileType || patient?.profile_type || patient?.type;
  return normalizePatientProfileType(storedProfile) === 'KIDS' ? 'infantil' : 'adulto';
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


export type PatientPortalKind = 'KIDS' | 'ADULT_ABA' | 'ADULT_CONVENTIONAL';

const parseAgeValue = (value: any): number | null => {
  // Number(null) and Number('') are zero: missing ages must not become babies.
  if (value === null || value === undefined || String(value).trim() === '') return null;
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
  // The persisted triplet is written together by the clinical Save action.
  // It is authoritative for current workflows even when age or a legacy
  // registration category differs. Incomplete/mismatched legacy profiles
  // retain the existing age/category safeguards until explicitly saved.
  const savedProfile = patient?.patient_profile_type ?? patient?.patientProfileType;
  const savedPanel = patient?.panel_type ?? patient?.panelType;
  const savedLegacyType = patient?.type;
  const isKnownProfile = (value: any) =>
    typeof value === 'string' && ['KIDS', 'ABA', 'ADULT'].includes(value.trim().toUpperCase());
  if (isKnownProfile(savedProfile) && isKnownProfile(savedPanel) &&
      typeof savedLegacyType === 'string') {
    const profile = normalizePatientProfileType(savedProfile);
    // The old registration pipeline sometimes wrote a generic adult default
    // on an explicitly pediatric category. The new Save keeps them consistent.
    // Do not reinterpret inconsistent historic rows until the portal is saved.
    const storedCategory = cleanProfileKey(patient?.patient_group ?? patient?.group ?? patient?.grupo);
    const conflictsWithLegacyChild = profile !== 'KIDS' &&
      ['infantil', 'adolescente'].includes(storedCategory);
    if (!conflictsWithLegacyChild &&
        normalizePatientProfileType(savedPanel) === profile &&
        mapPatientProfileTypeToLegacyPortalType(profile) === cleanProfileKey(savedLegacyType)) {
      return profile === 'KIDS' ? 'KIDS' : profile === 'ABA' ? 'ADULT_ABA' : 'ADULT_CONVENTIONAL';
    }
  }

  const explicitCandidates = [
    patient?.patientProfileType,
    patient?.patient_profile_type,
    patient?.panelType,
    patient?.panel_type,
    patient?.profileType,
    patient?.profile_type,
    patient?.type,
    patient?.portalType,
    patient?.portal_type,
    patient?.anamnesisData?.patientProfileType,
    patient?.anamnesisData?.profileType,
    patient?.anamnesisData?.formType,
  ];

  const age =
    parseAgeValue(patient?.age) ??
    ageFromBirthDate(patient?.birth_date) ??
    ageFromBirthDate(patient?.birthDate) ??
    ageFromBirthDate(patient?.dataNascimento) ??
    ageFromBirthDate(patient?.anamnesisData?.dataNascimento);
  const group = cleanProfileKey(patient?.patient_group || patient?.group || patient?.grupo || patient?.patientGroup || '');
  // Some imported adult records store age=0 as an unset placeholder. A stored
  // adult clinic category must not turn their collection into pediatric ABA.
  const effectiveAge = age === 0 && ['adulto', 'idoso'].includes(group) ? null : age;
  const pediatricGroup = ['infantil', 'crianca', 'criancas', 'kids', 'child', 'adolescente', 'teen'].includes(group);
  const isPediatric = (effectiveAge !== null && effectiveAge < 18) || (effectiveAge === null && pediatricGroup);

  // Older records can carry a generic ADULT default alongside a persisted
  // KIDS portal/panel field. Never route a confirmed pediatric patient into
  // the adult collection screen because of that stale generic default.
  const hasExplicitKids = explicitCandidates.some((candidate) => {
    const key = cleanProfileKey(candidate);
    return ['kids_tea', 'kids', 'kid', 'child', 'infantil', 'crianca', 'crianca_tea', 'teen', 'adolescente', 'adolescent'].includes(key);
  });
  if (hasExplicitKids && isPediatric) return 'KIDS';
  if (pediatricGroup && isPediatric) return 'KIDS';
  // This product defines ADULT as an adult workflow: stale ADULT defaults on
  // a child under 13 must not open conventional/adult collection.
  if (effectiveAge !== null && effectiveAge <= 12) return 'KIDS';

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

  return effectiveAge !== null && effectiveAge <= 12 ? 'KIDS' : 'ADULT_CONVENTIONAL';
};

export const isAdultPatientPortal = (patient: any) => resolvePatientPortalKind(patient) !== 'KIDS';
