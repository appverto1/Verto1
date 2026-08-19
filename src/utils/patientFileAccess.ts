export const PATIENT_FILE_ACCESS_SCOPES = ['OWNER', 'CASE_TEAM', 'PATIENT_ACCESS', 'SELECTED'] as const;
export type PatientFileAccessScope = (typeof PATIENT_FILE_ACCESS_SCOPES)[number];

export const isPatientFileAccessScope = (value: unknown): value is PatientFileAccessScope => {
  const normalized = String(value || '').trim().toUpperCase();
  return (PATIENT_FILE_ACCESS_SCOPES as readonly string[]).includes(normalized);
};

export const normalizePatientFileAccessScope = (value: unknown): PatientFileAccessScope => {
  const normalized = String(value || '').trim().toUpperCase();
  return isPatientFileAccessScope(normalized)
    ? normalized as PatientFileAccessScope
    : 'PATIENT_ACCESS';
};

export const isPatientPortalFileActorRole = (role: unknown) =>
  ['patient', 'responsible', 'responsavel', 'guardian'].includes(String(role || '').trim().toLowerCase());

export const isPatientFilePortalVisible = (row: any) => {
  if (row?.patient_portal_visible === true || row?.patientPortalVisible === true) return true;
  const source = String(row?.source || '').trim().toLowerCase();
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return (
    source === 'family_portal_document' ||
    metadata?.releasedToPatient === true ||
    metadata?.released_to_patient === true ||
    metadata?.visibleToPatient === true ||
    metadata?.visible_to_patient === true ||
    ['patient', 'family', 'shared_patient'].includes(String(metadata?.visibility || '').trim().toLowerCase())
  );
};

const permissionAllowsRead = (permissions: any) => {
  if (!permissions || typeof permissions !== 'object') return true;
  return permissions.read !== false;
};

export async function filterPatientFilesForActor(params: {
  supabase: any;
  rows: any[];
  actorId: string;
  actorRole: string;
  logger?: Pick<Console, 'warn'>;
}) {
  const rows = Array.isArray(params.rows) ? params.rows : [];
  const actorId = String(params.actorId || '').trim();
  const actorRole = String(params.actorRole || '').trim().toLowerCase();
  if (!rows.length || !actorId) return [];

  const isPortal = isPatientPortalFileActorRole(actorRole);
  if (isPortal) {
    return rows.filter((row) => String(row?.uploaded_by || row?.uploadedBy || '').trim() === actorId || isPatientFilePortalVisible(row));
  }

  const caseTeamPatientIds = Array.from(new Set(
    rows
      .filter((row) => normalizePatientFileAccessScope(row?.access_scope || row?.accessScope) === 'CASE_TEAM')
      .map((row) => String(row?.patient_id || row?.patientId || '').trim())
      .filter(Boolean)
  ));
  const selectedFileIds = Array.from(new Set(
    rows
      .filter((row) => normalizePatientFileAccessScope(row?.access_scope || row?.accessScope) === 'SELECTED')
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  ));

  const caseTeamPatientIdSet = new Set<string>();
  if (caseTeamPatientIds.length) {
    const linkResult = await params.supabase
      .from('patient_professional_links')
      .select('patient_id,permissions')
      .in('patient_id', caseTeamPatientIds)
      .eq('professional_id', actorId)
      .eq('status', 'active');
    if (linkResult.error) {
      params.logger?.warn?.('[PatientFiles] Falha ao validar equipe do caso para ACL.', {
        actorId,
        message: linkResult.error?.message || String(linkResult.error)
      });
    } else {
      for (const link of linkResult.data || []) {
        if (permissionAllowsRead(link?.permissions)) caseTeamPatientIdSet.add(String(link?.patient_id || ''));
      }
    }
  }

  const grantedFileIdSet = new Set<string>();
  if (selectedFileIds.length) {
    const grantResult = await params.supabase
      .from('patient_file_access_grants')
      .select('file_id')
      .eq('grantee_user_id', actorId)
      .in('file_id', selectedFileIds);
    if (grantResult.error) {
      params.logger?.warn?.('[PatientFiles] Falha ao validar concessões explícitas de arquivo.', {
        actorId,
        message: grantResult.error?.message || String(grantResult.error)
      });
    } else {
      for (const grant of grantResult.data || []) grantedFileIdSet.add(String(grant?.file_id || ''));
    }
  }

  return rows.filter((row) => {
    const uploaderId = String(row?.uploaded_by || row?.uploadedBy || '').trim();
    if (uploaderId && uploaderId === actorId) return true;
    const scope = normalizePatientFileAccessScope(row?.access_scope || row?.accessScope);
    if (scope === 'PATIENT_ACCESS') return true;
    if (scope === 'CASE_TEAM') return caseTeamPatientIdSet.has(String(row?.patient_id || row?.patientId || '').trim());
    if (scope === 'SELECTED') return grantedFileIdSet.has(String(row?.id || '').trim());
    return false;
  });
}
