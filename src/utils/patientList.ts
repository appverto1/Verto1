export const PATIENT_LIST_INVALID_RESPONSE_CODE = 'PATIENT_LIST_INVALID_RESPONSE';

export type PatientListResponse =
  | { success: true; data: any[]; source: 'data' | 'array' | 'patients' | 'items' }
  | { success: false; code: typeof PATIENT_LIST_INVALID_RESPONSE_CODE; error: string };

export const normalizePatientStatus = (status: unknown): string =>
  String(status ?? '').trim().toUpperCase();

export const isPatientRemovedFromMainList = (patient: any): boolean =>
  normalizePatientStatus(patient?.status) === 'DELETED' ||
  patient?.deleted_at != null ||
  patient?.deletedAt != null ||
  patient?.is_active === false ||
  patient?.isActive === false;

export const isPatientVisibleInMainList = (patient: any): boolean =>
  Boolean(patient && typeof patient === 'object') && !isPatientRemovedFromMainList(patient);

export function normalizePatientListResponse(payload: unknown): PatientListResponse {
  if (Array.isArray(payload)) {
    return { success: true, data: payload, source: 'array' };
  }

  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: PATIENT_LIST_INVALID_RESPONSE_CODE,
      error: 'A resposta da lista de pacientes possui formato inválido.',
    };
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.success === true && Array.isArray(candidate.data)) {
    return { success: true, data: candidate.data, source: 'data' };
  }
  if (Array.isArray(candidate.patients)) {
    return { success: true, data: candidate.patients, source: 'patients' };
  }
  if (Array.isArray(candidate.items)) {
    return { success: true, data: candidate.items, source: 'items' };
  }

  return {
    success: false,
    code: PATIENT_LIST_INVALID_RESPONSE_CODE,
    error: 'A resposta da lista de pacientes não contém uma coleção válida.',
  };
}

const getCanonicalProfessionalLinkArrays = (patient: any): any[][] => [
  patient?.patient_professional_links,
  patient?.patientProfessionalLinks,
  patient?.professional_links,
  patient?.professionalLinks,
].filter(Array.isArray);

export function resolvePatientProfessionalIds(patient: any): string[] {
  const canonicalLinkArrays = getCanonicalProfessionalLinkArrays(patient);
  if (canonicalLinkArrays.length > 0) {
    const canonicalProfessionalIds = Array.from(
      new Set(
        canonicalLinkArrays
          .flat()
          .filter((link: any) => {
            const status = String(link?.status ?? 'active').trim().toLowerCase();
            return status === 'active' && link?.permissions?.read !== false;
          })
          .map((link: any) =>
            String(
              link?.professional_id ||
                link?.professionalId ||
                link?.therapist_id ||
                link?.therapistId ||
                '',
            ).trim(),
          )
          .filter(Boolean),
      ),
    );
    if (canonicalProfessionalIds.length > 0) return canonicalProfessionalIds;
  }

  const legacyId = String(
    patient?.therapist_id ||
      patient?.therapistId ||
      patient?.professional_id ||
      patient?.professionalId ||
      patient?.responsible_professional_id ||
      patient?.responsibleProfessionalId ||
      patient?.assigned_professional_id ||
      patient?.assignedProfessionalId ||
      patient?.primary_professional_id ||
      patient?.primaryProfessionalId ||
      patient?.metadata?.therapist_id ||
      patient?.metadata?.professional_id ||
      patient?.metadata?.responsible_professional_id ||
      '',
  ).trim();
  return legacyId ? [legacyId] : [];
}

export function patientMatchesProfessionalFilter(patient: any, professionalId: unknown): boolean {
  const normalizedProfessionalId = String(professionalId ?? '').trim();
  if (!normalizedProfessionalId || normalizedProfessionalId === 'all') return true;
  const professionalIds = resolvePatientProfessionalIds(patient);
  if (normalizedProfessionalId === 'unassigned') return professionalIds.length === 0;
  return professionalIds.includes(normalizedProfessionalId);
}

export const normalizePatientDirectoryText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFC')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

export function patientMatchesNameFilter(patient: any, query: unknown): boolean {
  const normalizedQuery = normalizePatientDirectoryText(query);
  if (!normalizedQuery) return true;
  return normalizePatientDirectoryText(patient?.name).includes(normalizedQuery);
}

export function sortPatientsAlphabetically<T = any>(patients: T[]): T[] {
  return [...(Array.isArray(patients) ? patients : [])].sort((left: any, right: any) => {
    const leftName = String(left?.name ?? '').normalize('NFC').trim();
    const rightName = String(right?.name ?? '').normalize('NFC').trim();
    const byName = leftName.localeCompare(rightName, 'pt-BR', {
      sensitivity: 'base',
      numeric: true,
      ignorePunctuation: true,
    });
    if (byName !== 0) return byName;
    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''), 'pt-BR');
  });
}
