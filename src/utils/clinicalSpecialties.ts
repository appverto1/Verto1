export const CLINICAL_SPECIALTY_OPTIONS = [
  'Psicoterapeuta',
  'Fonoaudiólogo',
  'Terapeuta Ocupacional',
  'Nutricionista',
  'Psicomotricista',
  'Psicopedagogo',
  'Arteterapeuta',
  'Musicoterapeuta',
  'Fisioterapeuta',
] as const;

export type ClinicalSpecialty = (typeof CLINICAL_SPECIALTY_OPTIONS)[number];

export type ClinicalSpecialtyScopeKey =
  | 'psychotherapy'
  | 'speech_therapy'
  | 'occupational_therapy'
  | 'nutrition'
  | 'psychomotricity'
  | 'psychopedagogy'
  | 'art_therapy'
  | 'music_therapy'
  | 'physiotherapy';

const specialtyScopeByCanonical = new Map<ClinicalSpecialty, ClinicalSpecialtyScopeKey>([
  ['Psicoterapeuta', 'psychotherapy'],
  ['Fonoaudiólogo', 'speech_therapy'],
  ['Terapeuta Ocupacional', 'occupational_therapy'],
  ['Nutricionista', 'nutrition'],
  ['Psicomotricista', 'psychomotricity'],
  ['Psicopedagogo', 'psychopedagogy'],
  ['Arteterapeuta', 'art_therapy'],
  ['Musicoterapeuta', 'music_therapy'],
  ['Fisioterapeuta', 'physiotherapy'],
]);

const normalizeSpecialtyAlias = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Canonical operational key shared by professional specialties and appointment
 * service labels. ABA deliberately has no key because it is an approach/model,
 * not a clinical specialty.
 */
export function clinicalSpecialtyScopeKey(
  value: unknown,
): ClinicalSpecialtyScopeKey | null {
  const canonical = normalizeClinicalSpecialty(value);
  if (canonical) return specialtyScopeByCanonical.get(canonical) ?? null;

  const normalized = normalizeSpecialtyAlias(value);
  if (!normalized || normalized === 'aba') return null;

  if (['speech therapy', 'fono', 'fonoaudiologia', 'fonoaudiologo', 'fonoaudiologa'].includes(normalized)) return 'speech_therapy';
  if (['occupational therapy', 'terapia ocupacional', 'terapeuta ocupacional', 'to'].includes(normalized)) return 'occupational_therapy';
  if (['psychology', 'psicologia', 'psicoterapia', 'psicoterapeuta', 'psicologo', 'psicologa'].includes(normalized)) return 'psychotherapy';
  if (['nutrition', 'nutricao', 'nutricionista'].includes(normalized)) return 'nutrition';
  if (['psychomotricity', 'psicomotricidade', 'psicomotricista'].includes(normalized)) return 'psychomotricity';
  if (['psychopedagogy', 'psicopedagogia', 'psicopedagogo', 'psicopedagoga'].includes(normalized)) return 'psychopedagogy';
  if (['art therapy', 'arteterapia', 'arteterapeuta'].includes(normalized)) return 'art_therapy';
  if (['music therapy', 'musicoterapia', 'musicoterapeuta'].includes(normalized)) return 'music_therapy';
  if (['physiotherapy', 'fisioterapia', 'fisioterapeuta'].includes(normalized)) return 'physiotherapy';

  if (normalized === 'speech therapy') return 'speech_therapy';
  if (normalized === 'occupational therapy') return 'occupational_therapy';
  if (normalized === 'psychopedagogy') return 'psychopedagogy';
  if (normalized === 'physiotherapy') return 'physiotherapy';
  return null;
}

export function clinicalSpecialtiesMatch(left: unknown, right: unknown): boolean {
  const leftKey = clinicalSpecialtyScopeKey(left);
  const rightKey = clinicalSpecialtyScopeKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

/**
 * Scheduling authority: only an accepted, active therapist membership in the
 * current clinic makes a specialty available. A global professional profile is
 * intentionally not consulted here (it may belong to another clinic).
 */
export function activeClinicAppointmentSpecialty(member: any): ClinicalSpecialty | null {
  if (String(member?.role || '').trim().toLowerCase() !== 'therapist') return null;
  if (String(member?.status || '').trim().toLowerCase() !== 'active') return null;
  return normalizeClinicalSpecialty(member?.clinicSpecialty);
}

export const DEFAULT_CLINICAL_SPECIALTY: ClinicalSpecialty =
  CLINICAL_SPECIALTY_OPTIONS[0];

export type ClinicalSpecialtyOption = {
  value: string;
  label: string;
  legacy: boolean;
};

const cleanSpecialty = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim();

const canonicalByNormalizedValue = new Map(
  CLINICAL_SPECIALTY_OPTIONS.map((specialty) => [
    specialty.toLocaleLowerCase('pt-BR'),
    specialty,
  ]),
);

/**
 * Normalizes values that may be persisted by new forms.
 *
 * Historical free-text values are intentionally not converted to a different
 * profession. They remain readable through readClinicalSpecialty(), but new
 * writes are restricted to the versioned product list above.
 */
export function normalizeClinicalSpecialty(
  value: unknown,
): ClinicalSpecialty | null {
  const cleaned = cleanSpecialty(value);
  if (!cleaned) return null;
  return (
    canonicalByNormalizedValue.get(cleaned.toLocaleLowerCase('pt-BR')) ?? null
  );
}

export function readClinicalSpecialty(value: unknown): string {
  const cleaned = cleanSpecialty(value);
  if (!cleaned) return '';
  return normalizeClinicalSpecialty(cleaned) ?? cleaned;
}

export function readClinicalSpecialtyFromSource(
  source: any,
  fallback = '',
): string {
  const requiredFields =
    source?.requiredOnboardingFields ||
    source?.required_onboarding_fields ||
    {};
  const metadata = source?.metadata || {};
  const value =
    source?.specialty ||
    source?.specialtyName ||
    source?.specialty_name ||
    source?.professionalSpecialty ||
    source?.professional_specialty ||
    requiredFields?.specialty ||
    requiredFields?.specialtyName ||
    requiredFields?.specialty_name ||
    metadata?.specialty ||
    metadata?.specialtyName ||
    metadata?.specialty_name ||
    // Read-only compatibility for invitations and profiles created before the
    // canonical specialty field was wired into team management.
    source?.professionalTitle ||
    source?.professional_title ||
    source?.profileRole ||
    requiredFields?.professionalTitle ||
    requiredFields?.professional_title ||
    metadata?.professionalTitle ||
    metadata?.professional_title;
  return readClinicalSpecialty(value) || readClinicalSpecialty(fallback);
}

export function getClinicalSpecialtyOptions(
  currentValue?: unknown,
): ClinicalSpecialtyOption[] {
  const current = readClinicalSpecialty(currentValue);
  const currentCanonical = normalizeClinicalSpecialty(current);
  const legacyOption =
    current && !currentCanonical
      ? [
          {
            value: current,
            label: `${current} (cadastro anterior)`,
            legacy: true,
          },
        ]
      : [];

  return [
    ...legacyOption,
    ...CLINICAL_SPECIALTY_OPTIONS.map((specialty) => ({
      value: specialty,
      label: specialty,
      legacy: false,
    })),
  ];
}
