const normalizeDisplayName = (value: unknown, maxLength = 180) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const readMetadata = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const firstDisplayName = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = normalizeDisplayName(value);
    if (normalized) return normalized;
  }
  return '';
};

const isGenericPatientDisplayName = (value: unknown) => {
  const normalized = normalizeDisplayName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return !normalized || ['paciente', 'patient', 'paciente nao identificado', 'patient not identified'].includes(normalized);
};

const firstMeaningfulPatientDisplayName = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = normalizeDisplayName(value);
    if (normalized && !isGenericPatientDisplayName(normalized)) return normalized;
  }
  return '';
};

export const resolveClinicalPatientDisplayName = (patient: any, fallback?: unknown) =>
  firstDisplayName(patient?.name, patient?.patient_name, patient?.patientName, fallback, 'Paciente');

export const resolvePortalPatientDisplayName = (patient: any, fallback?: unknown) => {
  const metadata = readMetadata(patient?.metadata || patient?.patient_metadata || patient?.patientMetadata);
  return firstMeaningfulPatientDisplayName(
    metadata.portalDisplayName,
    metadata.portal_display_name,
    metadata.preferredName,
    metadata.preferred_name,
    patient?.name,
    patient?.patient_name,
    patient?.patientName,
    fallback,
  );
};
