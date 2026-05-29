export type PatientPortabilityScope = {
  demographics: boolean;
  sharedNotes: boolean;
  patientVisibleNotes: boolean;
  reports: boolean;
  peiSummary: boolean;
  abaSummary: boolean;
  files: boolean;
  professionalSharedNotes: boolean;
};

export const DEFAULT_PATIENT_PORTABILITY_SCOPE: PatientPortabilityScope = {
  demographics: true,
  sharedNotes: false,
  patientVisibleNotes: true,
  reports: false,
  peiSummary: false,
  abaSummary: false,
  files: false,
  professionalSharedNotes: false
};

const boolLike = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  }
  return fallback;
};

export function normalizePatientPortabilityScope(input: unknown): PatientPortabilityScope {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    demographics: boolLike(source.demographics, DEFAULT_PATIENT_PORTABILITY_SCOPE.demographics),
    sharedNotes: boolLike(source.sharedNotes ?? source.shared_notes, DEFAULT_PATIENT_PORTABILITY_SCOPE.sharedNotes),
    patientVisibleNotes: boolLike(
      source.patientVisibleNotes ?? source.patient_visible_notes,
      DEFAULT_PATIENT_PORTABILITY_SCOPE.patientVisibleNotes
    ),
    reports: boolLike(source.reports, DEFAULT_PATIENT_PORTABILITY_SCOPE.reports),
    peiSummary: boolLike(source.peiSummary ?? source.pei_summary, DEFAULT_PATIENT_PORTABILITY_SCOPE.peiSummary),
    abaSummary: boolLike(source.abaSummary ?? source.aba_summary, DEFAULT_PATIENT_PORTABILITY_SCOPE.abaSummary),
    files: boolLike(source.files, DEFAULT_PATIENT_PORTABILITY_SCOPE.files),
    professionalSharedNotes: boolLike(
      source.professionalSharedNotes ?? source.professional_shared_notes,
      DEFAULT_PATIENT_PORTABILITY_SCOPE.professionalSharedNotes
    )
  };
}

export function normalizeNotePortabilityVisibility(note: any): 'PRIVATE' | 'PATIENT' | 'PROFESSIONALS' {
  const raw = String(note?.portability_scope || note?.visibility || note?.type || '').trim().toUpperCase();
  if (['PATIENT', 'PACIENTE', 'FAMILY', 'FAMILIA'].includes(raw)) return 'PATIENT';
  if (['PROFESSIONALS', 'PROFESSIONAL', 'PROFISSIONAIS', 'PROFISSIONAL', 'TEAM'].includes(raw)) return 'PROFESSIONALS';
  return 'PRIVATE';
}

export function isNotePortableWithConsent(note: any, scopeInput: unknown): boolean {
  const scope = normalizePatientPortabilityScope(scopeInput);
  const visibility = normalizeNotePortabilityVisibility(note);

  if (visibility === 'PRIVATE') return false;
  if (visibility === 'PATIENT') {
    return scope.patientVisibleNotes && note?.shared_with_patient !== false;
  }
  return (
    scope.professionalSharedNotes &&
    note?.is_portable === true &&
    note?.shared_with_professionals !== false
  );
}

const safeText = (value: unknown, maxLength = 400) =>
  String(value ?? '').trim().slice(0, maxLength);

export function buildPatientPortabilitySnapshot(params: {
  patient?: any;
  notes?: any[];
  scope?: unknown;
}) {
  const scope = normalizePatientPortabilityScope(params.scope);
  const patient = params.patient || {};
  const portableNotes = (Array.isArray(params.notes) ? params.notes : [])
    .filter((note) => isNotePortableWithConsent(note, scope))
    .slice(0, 200)
    .map((note) => ({
      type: normalizeNotePortabilityVisibility(note),
      subject: safeText(note?.subject || note?.title, 180) || null,
      content: safeText(note?.content || note?.note || note?.text, 4000),
      createdAt: safeText(note?.created_at || note?.createdAt, 80) || null
    }));

  return {
    scope,
    demographics: scope.demographics
      ? {
          name: safeText(patient?.name, 180) || null,
          age: Number.isFinite(Number(patient?.age)) ? Number(patient.age) : null,
          status: safeText(patient?.status, 40) || null
        }
      : null,
    notes: portableNotes
  };
}
