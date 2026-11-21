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
export function createPatientFileAuditedAccessHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { buildPatientFilesFromPayload, currentClinicId, currentClinicTimeZone, enforcePayloadLimit, fetchPatientFilesWithSchemaFallback, filterPatientFilesForActor, hasGlobalClinicAccess, isMissingRelationError, isPatientFileVisibleToPortal, isResponsiblePortalRole, isUuid, normalizePatientFileAccessScope, persistActivityLog, readPatientRecordPayloadForFiles, requestIdForLogs, sanitizeString, sanitizeUrl, sendRouteDbError, supabase } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 8 * 1024, 'Acesso auditado a arquivo do paciente')) return;
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const fileId = sanitizeString(req.params.fileId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
      const actorRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const action = sanitizeString(req.body?.action, 20).toUpperCase();
      const clientEventId = sanitizeString(req.body?.client_event_id || req.body?.clientEventId || req.headers?.['x-audit-event-id'], 180);
      if (!isUuid(patientId) || !fileId || !isUuid(actorId) || !['VIEW', 'DOWNLOAD'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Acesso de arquivo inválido.' });
      }

      const isPatientPortal = isResponsiblePortalRole(actorRole);
      let file: any = null;
      let canonicalUnavailable = false;
      const canonicalResult = await fetchPatientFilesWithSchemaFallback({
        supabase,
        patientId,
        clinicId,
        fileId,
        limit: 1,
        logger: console
      });
      if (canonicalResult.error) {
        canonicalUnavailable = isMissingRelationError(canonicalResult.error) || String(canonicalResult.error?.message || '').toLowerCase().includes('patient_files');
        if (!canonicalUnavailable) throw canonicalResult.error;
      } else if (Array.isArray(canonicalResult.data) && canonicalResult.data.length > 0) {
        const row = canonicalResult.data[0] as any;
        if (!hasGlobalClinicAccess(req.session.user) && clinicId && sanitizeString(row?.clinic_id, 120) !== clinicId) {
          return res.status(403).json({ success: false, error: 'Arquivo fora do escopo da clínica.' });
        }
        const visibleRows = await filterPatientFilesForActor({
          supabase,
          rows: [row],
          actorId,
          actorRole,
          logger: console
        });
        if (!visibleRows.length) {
          return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
        }
        const storagePath = sanitizeString(row?.storage_path, 800);
        const bucket = sanitizeString(row?.storage_bucket, 120) || 'patient-files-private';
        if (!storagePath) return res.status(409).json({ success: false, error: 'Arquivo sem caminho de armazenamento.' });
        const { data: signedData, error: signedError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(storagePath, 60 * 5);
        if (signedError || !signedData?.signedUrl) {
          return res.status(503).json({ success: false, error: 'Não foi possível liberar o arquivo com segurança.' });
        }
        file = {
          id: row.id,
          patientId: row.patient_id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          sizeBytes: row.file_size_bytes,
          source: row.source || 'upload',
          createdAt: row.created_at,
          metadata: row.metadata || {},
          uploadedBy: row.uploaded_by || null,
          accessScope: normalizePatientFileAccessScope(row.access_scope),
          patientPortalVisible: isPatientFileVisibleToPortal(row),
          canManageAccess: sanitizeString(row.uploaded_by, 120) === actorId,
          signedUrl: sanitizeUrl(signedData.signedUrl),
          url: sanitizeUrl(signedData.signedUrl)
        };
      }

      if (!file && canonicalUnavailable) {
        const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
        const rawFiles = Array.isArray(fallbackPayload?.payload?.files) ? fallbackPayload.payload.files : [];
        const rawFile = rawFiles.find((row: any) => sanitizeString(row?.id, 120) === fileId);
        if (!rawFile) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
        if (isPatientPortal && !isPatientFileVisibleToPortal(rawFile)) {
          return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
        }
        const mapped = await buildPatientFilesFromPayload(patientId, [rawFile], { includeAccessContent: true });
        file = mapped[0] || null;
      }

      if (!file) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });

      const auditAction = action === 'DOWNLOAD' ? 'patient_file_downloaded' : 'patient_file_viewed';
      const auditTitle = action === 'DOWNLOAD' ? 'Arquivo baixado' : 'Arquivo visualizado';
      const fileName = sanitizeString(file?.fileName || file?.name, 220) || 'arquivo';
      const auditOk = await persistActivityLog({
        userId: actorId,
        clinicId,
        actorName,
        title: auditTitle,
        content: `${actorName} ${action === 'DOWNLOAD' ? 'baixou' : 'visualizou'} o arquivo "${fileName}" do prontuário.`,
        type: 'clinical',
        action: auditAction,
        actionType: auditAction,
        payloadDetails: JSON.stringify({
          fileId,
          fileName,
          mimeType: sanitizeString(file?.mimeType, 120) || null,
          source: sanitizeString(file?.source, 60) || null,
          actorRole: actorRole || null
        }),
        resourceType: 'patient_file',
        resourceId: fileId,
        patientId,
        timezone: currentClinicTimeZone(req.session.user),
        immutableAudit: true,
        idempotencyKey: clientEventId ? `patient-file:${action.toLowerCase()}:${actorId}:${fileId}:${clientEventId}` : null
      });
      if (!auditOk) {
        return res.status(503).json({
          success: false,
          code: 'AUDIT_LOG_UNAVAILABLE',
          error: 'Não foi possível registrar a auditoria deste acesso. O arquivo não foi liberado.'
        });
      }

      return res.json({ success: true, data: file });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patient-files/:patientId/:fileId/access [POST]', error, {
        patientId: sanitizeString(req.resolvedPatientId || req.params.patientId, 120),
        fileId: sanitizeString(req.params.fileId, 120),
        requestId: requestIdForLogs(req)
      });
    }
  };
}
export function createPatientFileUploadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, decodeUploadHeader, enforcePayloadLimit, isPatientFileQuotaError, isPatientFileVisibleToPortal, isResponsiblePortalRole, isUuid, normalizeMime, normalizePatientFileAccessScope, normalizePatientFileStorageUsage, parseMultipartFormData, persistPatientFileFallback, persistPatientFileMutationAudit, readBoundedRawUpload, readPatientFileStorageUsage, resolvePatientIdForRequest, sanitizeString, sendPatientFileQuotaExceeded, validateBinaryUpload, supabase, crypto } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 18 * 1024 * 1024, 'Upload de arquivo do paciente')) return;
      const requestContentType = String(req.headers?.['content-type'] || '').toLowerCase();
      const rawUploadMode =
        requestContentType.startsWith('application/octet-stream') &&
        sanitizeString(req.headers?.['x-verto-upload-mode'], 40).toLowerCase() === 'raw-v1';
      const isMultipart = requestContentType.includes('multipart/form-data');
      const rawUploadBuffer = rawUploadMode ? await readBoundedRawUpload(req, 10 * 1024 * 1024) : null;
      const multipart = !rawUploadMode && isMultipart ? await parseMultipartFormData(req) : null;
      const multipartFields = multipart?.fields || {};
      const multipartFile = multipart?.file;

      const rawPatientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      let clinicId = sanitizeString(currentClinicId(req.session.user), 100);
      const uploadedBy = sanitizeString(req.session.user?.id, 120);
      const rawName =
        (rawUploadMode ? decodeUploadHeader(req.headers?.['x-verto-file-name'], 220) : '') ||
        sanitizeString(multipartFile?.fileName || multipartFields.fileName || req.body?.fileName, 220) ||
        `arquivo_${Date.now()}`;
      const safeName = rawName.replace(/[^\w.\-() ]+/g, '_').slice(0, 220);
      const uploaderRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const isPatientUploader = isResponsiblePortalRole(uploaderRole);
      const source = isPatientUploader
        ? 'family_portal_document'
        : sanitizeString(
            (rawUploadMode ? req.headers?.['x-verto-source'] : '') || multipartFields.source || req.body?.source,
            40
          ) || 'upload';
      const contentType = sanitizeString(
        (rawUploadMode ? req.headers?.['x-verto-declared-type'] : '') ||
          multipartFile?.contentType ||
          multipartFields.contentType ||
          req.body?.contentType,
        120
      ) || 'application/octet-stream';
      const dataUrl = rawUploadMode ? '' : sanitizeString(req.body?.fileBase64, 20_000_000);
      const rawMetadataHeader = rawUploadMode
        ? decodeUploadHeader(req.headers?.['x-verto-upload-metadata'], 3000)
        : '';
      const metadataRaw = rawUploadMode ? rawMetadataHeader : (multipartFields.metadata || req.body?.metadata);
      const parsedMetadata =
        typeof metadataRaw === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(metadataRaw);
                return parsed && typeof parsed === 'object' ? parsed : {};
              } catch {
                return {};
              }
            })()
          : metadataRaw && typeof metadataRaw === 'object'
            ? metadataRaw
            : {};
      const metadata = isPatientUploader
        ? {
            visibility: 'patient',
            visibleToPatient: true,
            authorRole: 'patient'
          }
        : parsedMetadata;

      const patientId = await resolvePatientIdForRequest(rawPatientId, req.session.user, {
        createIfMissing: true,
        fallbackName: sanitizeString(req.body?.metadata?.patientName, 160)
      });

      if (!clinicId && isUuid(patientId)) {
        const clinicResult = await supabase
          .from('patients')
          .select('clinic_id')
          .eq('id', patientId)
          .limit(1)
          .maybeSingle();
        clinicId = sanitizeString(clinicResult.data?.clinic_id, 100);
      }

      if (!patientId || !clinicId || !uploadedBy) {
        return res.status(400).json({ success: false, error: 'Dados obrigatórios ausentes.' });
      }
      if (!rawUploadBuffer?.length && !dataUrl && !multipartFile?.buffer?.length) {
        return res.status(400).json({ success: false, error: 'Arquivo ausente.' });
      }

      const matches = dataUrl ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
      const base64Payload = matches?.[2] || dataUrl;
      const mimeFromDataUrl = matches?.[1] || contentType;
      const fileBuffer =
        rawUploadBuffer?.length
          ? rawUploadBuffer
          : multipartFile?.buffer?.length
            ? multipartFile.buffer
            : Buffer.from(String(base64Payload || ''), 'base64');
      if (!fileBuffer.length || fileBuffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'Arquivo inválido ou acima de 10MB.' });
      }
      const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const uploadContext: UploadContext = source === 'anamnesis' ? 'anamnesis-document' : 'image-or-pdf';
      const validation = validateBinaryUpload(fileBuffer, mimeFromDataUrl, uploadContext);
      let resolvedMime: DetectedUploadMime | null = validation.ok ? validation.detectedMime : null;
      if (!resolvedMime && uploadContext === 'anamnesis-document') {
        const normalizedProvidedMime = normalizeMime(mimeFromDataUrl);
        const lowerFileName = safeName.toLowerCase();
        const utf8Probe = fileBuffer.subarray(0, Math.min(fileBuffer.length, 4096)).toString('utf8').trim().toLowerCase();

        if (
          normalizedProvidedMime === 'application/octet-stream' ||
          normalizedProvidedMime === 'text/html' ||
          normalizedProvidedMime === 'application/pdf'
        ) {
          if (lowerFileName.endsWith('.pdf')) {
            resolvedMime = 'application/pdf';
          } else if (
            lowerFileName.endsWith('.html') ||
            lowerFileName.endsWith('.htm') ||
            utf8Probe.startsWith('<!doctype html') ||
            utf8Probe.startsWith('<html') ||
            utf8Probe.includes('<body')
          ) {
            resolvedMime = 'text/html';
          }
        }
      }
      if (!resolvedMime) {
        return res.status(415).json({ success: false, error: validation.ok ? 'Formato de arquivo inválido.' : validation.error });
      }

      const bucketName = 'patient-files-private';
      const storagePath = `${clinicId}/${patientId}/${Date.now()}_${safeName}`;
      if (source === 'anamnesis') {
        const { data: duplicateFile, error: duplicateError } = await supabase
          .from('patient_files')
          .select('id, patient_id, clinic_id, uploaded_by, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, source, access_scope, patient_portal_visible, metadata, created_at, updated_at')
          .eq('patient_id', patientId)
          .eq('clinic_id', clinicId)
          .eq('source', 'anamnesis')
          .eq('metadata->>fileSha256', fileSha256)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!duplicateError && duplicateFile) {
          const { data: signedDuplicate } = await supabase.storage
            .from(sanitizeString(duplicateFile?.bucket, 120) || 'patient-files-private')
            .createSignedUrl(sanitizeString(duplicateFile?.storage_path, 800), 60 * 10);
          return res.status(200).json({
            success: true,
            deduped: true,
            data: {
              ...duplicateFile,
              uploadedBy: duplicateFile.uploaded_by || null,
              accessScope: normalizePatientFileAccessScope(duplicateFile.access_scope),
              patientPortalVisible: duplicateFile.patient_portal_visible === true || isPatientFileVisibleToPortal(duplicateFile),
              canManageAccess: sanitizeString(duplicateFile.uploaded_by, 120) === uploadedBy,
              signedUrl: signedDuplicate?.signedUrl || null,
              url: signedDuplicate?.signedUrl || null
            }
          });
        }
      }

      const quotaUsageResult = await readPatientFileStorageUsage(patientId, clinicId);
      if (quotaUsageResult.error || !quotaUsageResult.data) {
        console.error('[PatientFiles] Quota indisponível; upload bloqueado por segurança:', quotaUsageResult.error?.message || String(quotaUsageResult.error || 'sem dados'));
        return res.status(503).json({
          success: false,
          code: 'PATIENT_FILE_QUOTA_UNAVAILABLE',
          error: 'Não foi possível validar o limite de armazenamento do paciente. Tente novamente em instantes.'
        });
      }
      if (quotaUsageResult.data.usedBytes + fileBuffer.length > quotaUsageResult.data.limitBytes) {
        return sendPatientFileQuotaExceeded(res, quotaUsageResult.data, fileBuffer.length);
      }

      const persistInlineFallback = async (reason: string) => {
        const fallbackId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const inlineContent =
          resolvedMime === 'application/pdf'
            ? `data:application/pdf;base64,${fileBuffer.toString('base64')}`
            : null;
        const fallbackEntry = {
          id: fallbackId,
          fileName: safeName,
          name: safeName,
          path: null,
          bucket: null,
          mimeType: resolvedMime,
          type: resolvedMime,
          sizeBytes: fileBuffer.length,
          size: fileBuffer.length,
          source,
          createdAt,
          metadata: {
            ...metadata,
            fileSha256,
            storageFallbackReason: reason
          },
          ...(inlineContent ? { content: inlineContent, dataUrl: inlineContent } : {})
        };

        try {
          await persistPatientFileFallback({
            patientId,
            clinicId,
            sessionUser: req.session.user,
            fileEntry: fallbackEntry
          });
        } catch (fallbackError: any) {
          console.warn('[PatientFiles] Falha ao persistir fallback em patient_records:', fallbackError?.message || String(fallbackError));
        }
        const auditPersisted = await persistPatientFileMutationAudit({
          req,
          clinicId,
          patientId,
          fileId: fallbackId,
          fileName: safeName,
          mimeType: resolvedMime,
          sizeBytes: fileBuffer.length,
          source,
          action: 'UPLOAD'
        });

        return res.status(200).json({
          success: true,
          warning: auditPersisted ? reason : `${reason} Auditoria pendente de reconciliação.`,
          auditPersisted,
          data: {
            id: fallbackId,
            patientId,
            fileName: safeName,
            path: null,
            mimeType: resolvedMime,
            sizeBytes: fileBuffer.length,
            source,
            createdAt,
            metadata: fallbackEntry.metadata,
            signedUrl: null,
            url: inlineContent,
            content: inlineContent
          }
        });
      };

      try {
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        if (listError) throw listError;
        const exists = (buckets || []).find((b: any) => b.name === bucketName);
        if (!exists) {
          const { error: createError } = await supabase.storage.createBucket(bucketName, {
            public: false,
            fileSizeLimit: 10 * 1024 * 1024,
            allowedMimeTypes: [
              'application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/png',
              'image/jpeg',
              'image/webp',
              'application/json',
              'text/plain',
              'text/html'
            ]
          });
          if (createError) throw createError;
        }

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(storagePath, fileBuffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: resolvedMime
          });
        if (uploadError) throw uploadError;
      } catch (storageError: any) {
        console.warn('[PatientFiles] Storage indisponível; salvando fallback inline:', storageError?.message || String(storageError));
        return await persistInlineFallback('Storage indisponível. Arquivo salvo como fallback no prontuário.');
      }

      const insertPayload = {
        patient_id: patientId,
        clinic_id: clinicId,
        uploaded_by: uploadedBy,
        file_name: safeName,
        storage_path: storagePath,
        mime_type: resolvedMime,
        file_size_bytes: fileBuffer.length,
        source,
        access_scope: 'PATIENT_ACCESS',
        patient_portal_visible: isPatientUploader || isPatientFileVisibleToPortal({ source, metadata }),
        metadata: {
          ...metadata,
          fileSha256
        }
      };

      const { data: inserted, error: insertError } = await supabase
        .from('patient_files')
        .insert([insertPayload])
        .select('id, patient_id, clinic_id, uploaded_by, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, source, access_scope, patient_portal_visible, metadata, created_at, updated_at')
        .single();

      if (insertError) {
        if (isPatientFileQuotaError(insertError)) {
          const cleanupResult = await supabase.storage.from(bucketName).remove([storagePath]);
          if (cleanupResult.error) {
            console.warn('[PatientFiles] Falha ao remover objeto rejeitado pela quota:', cleanupResult.error.message);
          }
          const latestUsage = await readPatientFileStorageUsage(patientId, clinicId);
          return sendPatientFileQuotaExceeded(
            res,
            latestUsage.data || quotaUsageResult.data,
            fileBuffer.length
          );
        }

        const fallbackId = crypto.randomUUID();
        const { data: signedDataFallback, error: signedErrorFallback } = await supabase.storage
          .from(bucketName)
          .createSignedUrl(storagePath, 60 * 10);
        if (signedErrorFallback) {
          console.warn('[PatientFiles] Falha ao assinar URL no fallback:', signedErrorFallback.message);
        }

        const fallbackEntry = {
          id: fallbackId,
          fileName: safeName,
          name: safeName,
          path: storagePath,
          bucket: bucketName,
          mimeType: resolvedMime,
          type: resolvedMime,
          sizeBytes: fileBuffer.length,
          size: fileBuffer.length,
          source,
          createdAt: new Date().toISOString(),
          metadata: {
            ...metadata,
            fileSha256
          }
        };

        try {
          await persistPatientFileFallback({
            patientId,
            clinicId,
            sessionUser: req.session.user,
            fileEntry: fallbackEntry
          });
        } catch (fallbackError: any) {
          console.warn('[PatientFiles] Falha ao persistir fallback após erro de tabela:', fallbackError?.message || String(fallbackError));
        }
        const auditPersisted = await persistPatientFileMutationAudit({
          req,
          clinicId,
          patientId,
          fileId: fallbackId,
          fileName: safeName,
          mimeType: resolvedMime,
          sizeBytes: fileBuffer.length,
          source,
          action: 'UPLOAD'
        });

        return res.status(200).json({
          success: true,
          warning: `Falha em patient_files. Arquivo salvo via fallback no prontuário: ${insertError.message || 'erro desconhecido'}${auditPersisted ? '' : ' Auditoria pendente de reconciliação.'}`,
          auditPersisted,
          data: {
            id: fallbackId,
            patientId,
            fileName: safeName,
            path: storagePath,
            mimeType: resolvedMime,
            sizeBytes: fileBuffer.length,
            source,
            createdAt: fallbackEntry.createdAt,
            metadata,
            signedUrl: signedDataFallback?.signedUrl || null
          }
        });
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, 60 * 10);
      if (signedError) {
        console.warn('[PatientFiles] Falha ao assinar URL após upload:', signedError.message);
      }

      const auditPersisted = await persistPatientFileMutationAudit({
        req,
        clinicId,
        patientId,
        fileId: sanitizeString(inserted.id, 120),
        fileName: inserted.file_name || safeName,
        mimeType: inserted.mime_type || resolvedMime,
        sizeBytes: inserted.file_size_bytes || fileBuffer.length,
        source: inserted.source || source,
        action: 'UPLOAD'
      });
      const latestUsage = await readPatientFileStorageUsage(patientId, clinicId);

      return res.json({
        success: true,
        auditPersisted,
        storageUsage: latestUsage.data || normalizePatientFileStorageUsage({
          usedBytes: quotaUsageResult.data.usedBytes + fileBuffer.length,
          limitBytes: quotaUsageResult.data.limitBytes
        }),
        ...(auditPersisted ? {} : { warning: 'Arquivo salvo; auditoria pendente de reconciliação.' }),
        data: {
          id: inserted.id,
          patientId: inserted.patient_id,
          fileName: inserted.file_name,
          path: inserted.storage_path,
          mimeType: inserted.mime_type,
          sizeBytes: inserted.file_size_bytes,
          source: inserted.source || 'upload',
          createdAt: inserted.created_at,
          metadata: inserted.metadata || {},
          uploadedBy: inserted.uploaded_by || uploadedBy,
          accessScope: normalizePatientFileAccessScope(inserted.access_scope),
          patientPortalVisible: inserted.patient_portal_visible === true || isPatientUploader,
          canManageAccess: sanitizeString(inserted.uploaded_by || uploadedBy, 120) === uploadedBy,
          signedUrl: signedData?.signedUrl || null
        }
      });
    } catch (error: any) {
      if (error?.code === 'UPLOAD_TOO_LARGE') {
        return res.status(413).json({ success: false, error: 'O arquivo deve ter no máximo 10 MB.' });
      }
      if (error?.code === 'UPLOAD_ABORTED') {
        return res.status(400).json({ success: false, error: 'Upload interrompido antes de concluir.' });
      }
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  };
}
export function createPatientFileDeleteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, filterPatientFilesForActor, isUuid, normalizePatientFileStorageUsage, persistPatientFileFallbackList, persistPatientFileMutationAudit, readPatientFileStorageUsage, readPatientRecordPayloadForFiles, sanitizeString, supabase } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const fileId = sanitizeString(req.params.fileId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
      if (!patientId || !fileId || !clinicId) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos.' });
      }
      if (!isUuid(patientId)) return res.status(404).json({ success: false, error: 'Paciente não encontrado.' });

      const { data: existing, error: existingError } = await supabase
        .from('patient_files')
        .select('id, patient_id, clinic_id, uploaded_by, access_scope, patient_portal_visible, metadata, storage_path, file_name, mime_type, file_size_bytes, source')
        .eq('id', fileId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle();
      if (existingError && !String(existingError?.message || '').toLowerCase().includes('patient_files')) throw existingError;
      if (existingError && String(existingError?.message || '').toLowerCase().includes('patient_files')) {
        const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
        const existingFiles = Array.isArray(fallbackPayload?.payload?.files) ? fallbackPayload.payload.files : [];
        const existingFallback = existingFiles.find((item: any) => sanitizeString(item?.id, 120) === fileId);
        if (!existingFallback) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });

        const storagePath = sanitizeString(existingFallback?.path, 500);
        if (storagePath) {
          const { error: removeStorageError } = await supabase.storage
            .from(sanitizeString(existingFallback?.bucket, 120) || 'patient-files-private')
            .remove([storagePath]);
          if (removeStorageError) {
            console.warn('[PatientFiles] Falha ao remover do storage (fallback):', removeStorageError.message);
          }
        }

        const nextFiles = existingFiles.filter((item: any) => sanitizeString(item?.id, 120) !== fileId);
        await persistPatientFileFallbackList({
          patientId,
          clinicId,
          sessionUser: req.session.user,
          pseudonymId: fallbackPayload?.pseudonymId || null,
          payload: fallbackPayload?.payload || {},
          files: nextFiles
        });
        const auditPersisted = await persistPatientFileMutationAudit({
          req,
          clinicId,
          patientId,
          fileId,
          fileName: sanitizeString(existingFallback?.fileName || existingFallback?.name, 220) || 'arquivo',
          mimeType: sanitizeString(existingFallback?.mimeType || existingFallback?.type, 120) || null,
          sizeBytes: Number(existingFallback?.sizeBytes || existingFallback?.size || 0) || null,
          source: sanitizeString(existingFallback?.source, 60) || null,
          action: 'DELETE'
        });
        const fallbackUsedBytes = nextFiles.reduce(
          (total: number, row: any) => total + Math.max(0, Number(row?.sizeBytes ?? row?.size ?? row?.file_size_bytes ?? 0) || 0),
          0
        );
        return res.json({
          success: true,
          auditPersisted,
          storageUsage: normalizePatientFileStorageUsage({ usedBytes: fallbackUsedBytes }),
          ...(auditPersisted ? {} : { warning: 'Arquivo removido; auditoria pendente de reconciliação.' })
        });
      }
      if (!existing) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
      const deletableRows = await filterPatientFilesForActor({
        supabase,
        rows: [existing],
        actorId: sanitizeString(req.session.user?.id, 120),
        actorRole: sanitizeString(req.session.user?.role, 40),
        logger: console
      });
      if (!deletableRows.length) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });

      const { error: removeStorageError } = await supabase.storage
        .from('patient-files-private')
        .remove([existing.storage_path]);
      if (removeStorageError) {
        console.warn('[PatientFiles] Falha ao remover do storage:', removeStorageError.message);
      }

      const { error: deleteRowError } = await supabase
        .from('patient_files')
        .delete()
        .eq('id', fileId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId);
      if (deleteRowError) throw deleteRowError;

      const auditPersisted = await persistPatientFileMutationAudit({
        req,
        clinicId,
        patientId,
        fileId,
        fileName: sanitizeString(existing.file_name, 220) || 'arquivo',
        mimeType: sanitizeString(existing.mime_type, 120) || null,
        sizeBytes: Number(existing.file_size_bytes || 0) || null,
        source: sanitizeString(existing.source, 60) || null,
        action: 'DELETE'
      });
      const latestUsage = await readPatientFileStorageUsage(patientId, clinicId);

      return res.json({
        success: true,
        auditPersisted,
        ...(latestUsage.data ? { storageUsage: latestUsage.data } : {}),
        ...(auditPersisted ? {} : { warning: 'Arquivo removido; auditoria pendente de reconciliação.' })
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  };
}
