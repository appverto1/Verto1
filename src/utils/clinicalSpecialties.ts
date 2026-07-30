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
