// Surgical extraction: preserve route ordering, authorization middleware, database writes and responses.
export function createPatientFilePermissionsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, isUuid, currentClinicId, fetchPatientFilesWithSchemaFallback, supabase, normalizePatientFileAccessScope, isPatientFileVisibleToPortal, sendRouteDbError, requestIdForLogs } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const fileId = sanitizeString(req.params.fileId, 120);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(patientId) || !isUuid(fileId) || !isUuid(actorId)) {
        return res.status(400).json({ success: false, error: 'Arquivo inválido.' });
      }

      const fileResult = await fetchPatientFilesWithSchemaFallback({
        supabase,
        patientId,
        clinicId,
        fileId,
        limit: 1,
        logger: console
      });
      if (fileResult.error) throw fileResult.error;
      const row = Array.isArray(fileResult.data) ? fileResult.data[0] : null;
      if (!row?.id) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
      if (sanitizeString(row.uploaded_by, 120) !== actorId) {
        return res.status(403).json({ success: false, code: 'PATIENT_FILE_ACCESS_OWNER_REQUIRED', error: 'Somente quem enviou este arquivo pode gerenciar quem pode vê-lo.' });
      }

      const grantsResult = await supabase
        .from('patient_file_access_grants')
        .select('grantee_user_id')
        .eq('file_id', fileId)
        .limit(100);
      if (grantsResult.error) {
        const message = String(grantsResult.error?.message || '').toLowerCase();
        if (message.includes('patient_file_access_grants') || message.includes('does not exist')) {
          return res.status(503).json({ success: false, code: 'PATIENT_FILE_ACCESS_MIGRATION_REQUIRED', error: 'A atualização de níveis de acesso dos arquivos ainda não foi aplicada no banco.' });
        }
        throw grantsResult.error;
      }

      return res.json({
        success: true,
        data: {
          fileId,
          accessScope: normalizePatientFileAccessScope(row.access_scope),
          patientPortalVisible: isPatientFileVisibleToPortal(row),
          selectedUserIds: (grantsResult.data || []).map((grant: any) => sanitizeString(grant?.grantee_user_id, 120)).filter(Boolean),
          canManageAccess: true
        }
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patient-files/:patientId/:fileId/permissions [GET]', error, {
        patientId: sanitizeString(req.resolvedPatientId || req.params.patientId, 120),
        fileId: sanitizeString(req.params.fileId, 120),
        requestId: requestIdForLogs(req)
      });
    }
  };
}
export function createPatientFilePermissionsWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { enforcePayloadLimit, sanitizeString, currentClinicId, isPatientFileAccessScope, isUuid, fetchPatientFilesWithSchemaFallback, supabase, persistActivityLog, currentClinicTimeZone, normalizePatientFileAccessScope, sendRouteDbError, requestIdForLogs } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 16 * 1024, 'Permissões de arquivo do paciente')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const fileId = sanitizeString(req.params.fileId, 120);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const requestedClinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const rawAccessScope = sanitizeString(req.body?.accessScope ?? req.body?.access_scope, 40).toUpperCase();
      if (!isPatientFileAccessScope(rawAccessScope)) {
        return res.status(400).json({ success: false, code: 'PATIENT_FILE_ACCESS_SCOPE_INVALID', error: 'Nível de acesso do arquivo inválido.' });
      }
      const accessScope = rawAccessScope;
      const rawPatientPortalVisible = req.body?.patientPortalVisible ?? req.body?.patient_portal_visible;
      if (typeof rawPatientPortalVisible !== 'boolean') {
        return res.status(400).json({ success: false, code: 'PATIENT_FILE_PORTAL_VISIBILITY_INVALID', error: 'A visibilidade para paciente/responsável deve ser verdadeira ou falsa.' });
      }
      const patientPortalVisible = rawPatientPortalVisible;
      const rawSelected = Array.isArray(req.body?.selectedUserIds) ? req.body.selectedUserIds : Array.isArray(req.body?.selected_user_ids) ? req.body.selected_user_ids : [];
      const normalizedSelected = rawSelected.map((value: any) => sanitizeString(value, 120));
      if (!isUuid(patientId) || !isUuid(fileId) || !isUuid(actorId)) {
        return res.status(400).json({ success: false, error: 'Permissões de arquivo inválidas.' });
      }
      if (rawSelected.length > 100 || normalizedSelected.some((value: string) => !isUuid(value))) {
        return res.status(400).json({ success: false, error: 'Lista de pessoas selecionadas inválida ou acima do limite.' });
      }
      const selectedUserIds = Array.from(new Set(normalizedSelected));
      if (accessScope === 'SELECTED' && selectedUserIds.length === 0) {
        return res.status(400).json({ success: false, code: 'PATIENT_FILE_ACCESS_SELECTED_EMPTY', error: 'Selecione ao menos uma pessoa para este nível de acesso.' });
      }

      const fileResult = await fetchPatientFilesWithSchemaFallback({
        supabase,
        patientId,
        clinicId: requestedClinicId,
        fileId,
        limit: 1,
        logger: console
      });
      if (fileResult.error) throw fileResult.error;
      const row = Array.isArray(fileResult.data) ? fileResult.data[0] : null;
      if (!row?.id) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
      if (sanitizeString(row.uploaded_by, 120) !== actorId) {
        return res.status(403).json({ success: false, code: 'PATIENT_FILE_ACCESS_OWNER_REQUIRED', error: 'Somente quem enviou este arquivo pode alterar o nível de acesso.' });
      }
      const fileClinicId = sanitizeString(row.clinic_id || requestedClinicId, 120);
      if (!isUuid(fileClinicId)) return res.status(409).json({ success: false, error: 'Clínica do arquivo inválida.' });

      const result = await supabase.rpc('set_patient_file_access_v1', {
        p_file_id: fileId,
        p_patient_id: patientId,
        p_clinic_id: fileClinicId,
        p_actor_id: actorId,
        p_access_scope: accessScope,
        p_patient_portal_visible: patientPortalVisible,
        p_selected_user_ids: accessScope === 'SELECTED' ? selectedUserIds : []
      });
      if (result.error) {
        const rawMessage = String(result.error?.message || '');
        if (rawMessage.includes('PATIENT_FILE_ACCESS_OWNER_REQUIRED')) {
          return res.status(403).json({ success: false, code: 'PATIENT_FILE_ACCESS_OWNER_REQUIRED', error: 'Somente quem enviou este arquivo pode alterar o nível de acesso.' });
        }
        if (rawMessage.includes('PATIENT_FILE_ACCESS_GRANTEE_OUTSIDE_CASE_TEAM')) {
          return res.status(400).json({ success: false, code: 'PATIENT_FILE_ACCESS_GRANTEE_OUTSIDE_CASE_TEAM', error: 'Selecione apenas profissionais ativos da equipe deste paciente.' });
        }
        if (rawMessage.includes('set_patient_file_access_v1') || rawMessage.toLowerCase().includes('does not exist')) {
          return res.status(503).json({ success: false, code: 'PATIENT_FILE_ACCESS_MIGRATION_REQUIRED', error: 'A atualização de níveis de acesso dos arquivos ainda não foi aplicada no banco.' });
        }
        throw result.error;
      }

      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
      const auditOk = await persistActivityLog({
        userId: actorId,
        clinicId: fileClinicId,
        actorName,
        title: 'Acesso ao arquivo atualizado',
        content: `${actorName} atualizou quem pode visualizar o arquivo "${sanitizeString(row.file_name, 220) || 'arquivo'}".`,
        type: 'clinical',
        action: 'patient_file_access_updated',
        actionType: 'patient_file_access_updated',
        payloadDetails: JSON.stringify({ fileId, accessScope, patientPortalVisible, selectedUsersCount: accessScope === 'SELECTED' ? selectedUserIds.length : 0 }),
        resourceType: 'patient_file',
        resourceId: fileId,
        patientId,
        timezone: currentClinicTimeZone(req.session.user),
        immutableAudit: true,
        idempotencyKey: null
      });
      if (!auditOk) {
        console.warn('[PatientFiles] Permissões persistidas, mas auditoria ficou pendente.', { fileId, patientId, actorId });
      }

      const data = result.data && typeof result.data === 'object' ? result.data : {};
      return res.json({
        success: true,
        auditPersisted: auditOk,
        data: {
          fileId,
          accessScope: normalizePatientFileAccessScope(data.accessScope || accessScope),
          patientPortalVisible: data.patientPortalVisible === true || patientPortalVisible,
          selectedUserIds: Array.isArray(data.selectedUserIds) ? data.selectedUserIds : (accessScope === 'SELECTED' ? selectedUserIds : []),
          canManageAccess: true
        }
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patient-files/:patientId/:fileId/permissions [PATCH]', error, {
        patientId: sanitizeString(req.resolvedPatientId || req.params.patientId, 120),
        fileId: sanitizeString(req.params.fileId, 120),
        requestId: requestIdForLogs(req)
      });
    }
  };
}
