// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createAdminProtocolImportsReadHandler(getDeps: () => { supabase: any; PROTOCOL_IMPORT_REQUEST_SELECT: any; VERTO_PROTOCOL_PANEL_RESET_AT: any; parseStoredJsonObject: any; sanitizeString: (value: unknown, maxLength?: number) => string; sanitizeEmail: any; isAllowedScreenshotDataUrl: any; sanitizeSafePreviewText: any; sanitizeClinicalPayload: any; loadProtocolAccessMap: any; buildProtocolAccessScopeKey: any }) {
  return async (_req: any, res) => {
    const { supabase, PROTOCOL_IMPORT_REQUEST_SELECT, VERTO_PROTOCOL_PANEL_RESET_AT, parseStoredJsonObject, sanitizeString, sanitizeEmail, isAllowedScreenshotDataUrl, sanitizeSafePreviewText, sanitizeClinicalPayload, loadProtocolAccessMap, buildProtocolAccessScopeKey } = getDeps();
    try {
      let requests: any[] = [];
      try {
        const { data, error } = await supabase
          .from('protocol_import_requests')
          .select(PROTOCOL_IMPORT_REQUEST_SELECT)
          .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('created_at', { ascending: false })
          .limit(200);
        if (!error && Array.isArray(data)) {
          requests = data.map((row: any) => {
            const scanReport = parseStoredJsonObject(row.scan_report);
            return {
              id: sanitizeString(row.id, 120),
              clinicId: sanitizeString(row.clinic_id, 120) || null,
              requesterUserId: sanitizeString(row.requester_user_id, 120) || null,
              requesterName: sanitizeString(row.requester_name, 180),
              requesterEmail: sanitizeEmail(row.requester_email),
              protocolName: sanitizeString(row.protocol_name, 180),
              fileName: sanitizeString(row.file_name, 240),
              fileType: sanitizeString(row.file_type, 120),
              fileSize: Number(row.file_size || 0),
              status: sanitizeString(row.status, 40) || 'pending',
              canonicalKey: sanitizeString(row.approved_canonical_key || row.suggested_canonical_key, 180),
              canonicalName: sanitizeString(row.approved_canonical_name || row.suggested_canonical_name, 180),
              confidence: Number(row.suggested_confidence || 0),
            hasFileData: Boolean(row.file_data_url),
            fileDataUrl: isAllowedScreenshotDataUrl(row.file_data_url) ? sanitizeString(row.file_data_url, 8_000_000) : null,
              quarantineStatus: sanitizeString(row.quarantine_status, 40) || 'quarantined',
              scanStatus: sanitizeString(row.scan_status, 40) || 'pending',
              safePreviewStatus: sanitizeString(row.safe_preview_status, 40) || 'not_generated',
              rawFileAccess: sanitizeString(row.raw_file_access, 40) || 'blocked',
              safePreviewText: sanitizeSafePreviewText(row.safe_preview_text || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(scanReport),
              createdAt: sanitizeString(row.created_at, 80),
              reviewedAt: sanitizeString(row.reviewed_at, 80) || null
            };
          });
        }
      } catch {
        // fallback below
      }

      if (requests.length === 0) {
        const { data: logs } = await supabase
          .from('activity_logs')
          .select('id, payload_details, timestamp')
          .eq('type', 'protocol_import_request')
          .eq('is_active', true)
          .is('deleted_at', null)
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(200);
        requests = (logs || []).map((log: any) => {
          try {
            const payload = JSON.parse(String(log.payload_details || '{}'));
            return {
              id: sanitizeString(payload.id || log.id, 120),
              clinicId: sanitizeString(payload.clinicId, 120) || null,
              requesterUserId: sanitizeString(payload.requesterUserId, 120) || null,
              requesterName: sanitizeString(payload.requesterName, 180),
              requesterEmail: sanitizeEmail(payload.requesterEmail),
              protocolName: sanitizeString(payload.protocolName, 180),
              fileName: sanitizeString(payload.fileName, 240),
              fileType: sanitizeString(payload.fileType, 120),
              fileSize: Number(payload.fileSize || 0),
              createdAt: sanitizeString(payload.createdAt || log.timestamp, 80),
              status: sanitizeString(payload.status, 40) || 'pending',
              canonicalKey: sanitizeString(payload.canonicalKey, 180),
              canonicalName: sanitizeString(payload.canonicalName, 180),
              confidence: Number(payload.confidence || 0),
              hasFileData: Boolean(payload.hasFileData),
              fileDataUrl: isAllowedScreenshotDataUrl(payload.previewImage?.dataUrl) ? sanitizeString(payload.previewImage.dataUrl, 8_000_000) : null,
              quarantineStatus: sanitizeString(payload.quarantineStatus, 40) || 'quarantined',
              scanStatus: sanitizeString(payload.scanStatus, 40) || 'pending',
              safePreviewStatus: sanitizeString(payload.safePreviewStatus, 40) || 'not_generated',
              rawFileAccess: 'blocked',
              safePreviewText: sanitizeSafePreviewText(payload.safePreviewText || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(parseStoredJsonObject(payload.scanReport))
            };
          } catch {
            return null;
          }
        }).filter(Boolean);
      }

      try {
        const { data: scanLogs } = await supabase
          .from('activity_logs')
          .select('payload_details, timestamp')
          .eq('type', 'protocol_import_review')
          .eq('is_active', true)
          .is('deleted_at', null)
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(300);
        const scansByRequestId = new Map<string, any>();
        for (const log of scanLogs || []) {
          try {
            const payload = JSON.parse(String((log as any).payload_details || '{}'));
            const requestId = sanitizeString(payload.requestId, 120);
            if (!requestId || scansByRequestId.has(requestId) || !payload.scanStatus) continue;
            scansByRequestId.set(requestId, {
              scanStatus: sanitizeString(payload.scanStatus, 40) || 'pending',
              quarantineStatus: sanitizeString(payload.quarantineStatus, 40) || 'quarantined',
              safePreviewStatus: sanitizeString(payload.safePreviewStatus, 40) || 'not_generated',
              rawFileAccess: 'blocked',
              safePreviewText: sanitizeSafePreviewText(payload.safePreviewText || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(parseStoredJsonObject(payload.scanReport)),
              scannedAt: sanitizeString((log as any).timestamp, 80)
            });
          } catch {
            // ignore malformed log payload
          }
        }
        if (scansByRequestId.size) {
          requests = requests.map((request) => {
            const scan = scansByRequestId.get(sanitizeString(request.id, 120));
            return scan ? { ...request, ...scan } : request;
          });
        }
      } catch {
        // The queue must remain visible even if scan log hydration is unavailable.
      }

      const protocolAccessMap = await loadProtocolAccessMap();
      requests = requests.map((request) => {
        const scopeKey = buildProtocolAccessScopeKey({
          clinicId: request.clinicId,
          requesterUserId: request.requesterUserId,
          requesterEmail: request.requesterEmail
        });
        return {
          ...request,
          accessScopeKey: scopeKey,
          authorizedProtocolKeys: protocolAccessMap.get(scopeKey) || []
        };
      });

      return res.json({ success: true, data: requests });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel listar solicitacoes de protocolos.' });
    }
  };
}

export function createAdminProtocolAccessWriteHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; normalizeApprovedProtocolKey: any; VERTO_PROTOCOL_BY_KEY: any; supabase: any; isUuid: any; revokeProtocolGrantForRequest: any; loadProtocolAccessMap: any; persistActivityLog: any; getUserFromAccessToken: any; supabaseUrl: any; supabasePublicClientKey: any; createClient: any; vertoDeploymentEnv: any; syncApprovedProtocolsToClinicState: any }) {
  return async (req: any, res) => {
    const { sanitizeString, normalizeApprovedProtocolKey, VERTO_PROTOCOL_BY_KEY, supabase, isUuid, revokeProtocolGrantForRequest, loadProtocolAccessMap, persistActivityLog, getUserFromAccessToken, supabaseUrl, supabasePublicClientKey, createClient, vertoDeploymentEnv, syncApprovedProtocolsToClinicState } = getDeps();
    try {
      const scopeKey = sanitizeString(req.body?.scopeKey, 220);
      const protocolKey = normalizeApprovedProtocolKey(req.body?.protocolKey);
      const enabled = Boolean(req.body?.enabled);
      const requestId = sanitizeString(req.body?.requestId, 120);
      if (!scopeKey || !requestId || !VERTO_PROTOCOL_BY_KEY.has(protocolKey)) {
        return res.status(400).json({ success: false, error: 'Informe a clinica, a solicitacao e o protocolo Verto.' });
      }
      const { data: requestRow, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('clinic_id,status,approved_canonical_key')
        .eq('id', requestId)
        .maybeSingle();
      const requestClinicId = sanitizeString((requestRow as any)?.clinic_id, 120);
      if (requestError || !isUuid(requestClinicId) || scopeKey !== `clinic:${requestClinicId}`) {
        return res.status(409).json({ success: false, error: 'A solicitacao nao pertence ao acervo informado.' });
      }

      if (!enabled) {
        const requestStatus = sanitizeString((requestRow as any)?.status, 40).toLowerCase();
        const approvedProtocolKey = normalizeApprovedProtocolKey((requestRow as any)?.approved_canonical_key);
        if (requestStatus !== 'approved' || !VERTO_PROTOCOL_BY_KEY.has(approvedProtocolKey) || approvedProtocolKey !== protocolKey) {
          return res.status(409).json({ success: false, error: 'O grant informado nao corresponde a uma liberacao aprovada desta clinica.' });
        }
        const actorId = sanitizeString(req.session.user?.id || req.session.user?.user_id, 120);
        if (!isUuid(actorId)) {
          return res.status(401).json({ success: false, error: 'Identidade autenticada obrigatoria para revogar o acervo.' });
        }

        const revokeResult = await revokeProtocolGrantForRequest({
          clinicId: requestClinicId,
          requestId,
          actorId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
          auditAction: 'sync_revoked_protocols_to_clinic_state'
        });
        const accessMap = await loadProtocolAccessMap();
        const protocolKeys = accessMap.get(scopeKey) || [];
        const changedProtocol = VERTO_PROTOCOL_BY_KEY.get(approvedProtocolKey);

        await persistActivityLog({
          userId: actorId,
          clinicId: requestClinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
          title: 'Acervo de protocolos atualizado',
          content: 'Grant ' + approvedProtocolKey + ' revogado para ' + scopeKey + '.',
          type: 'protocol_access_updated',
          actionType: 'protocol_access_updated',
          payloadDetails: JSON.stringify({ scopeKey, protocolKeys, changedProtocolKey: approvedProtocolKey, requestId, enabled: false, updatedAt: new Date().toISOString() })
        });

        return res.json({ success: true, data: {
          scopeKey,
          protocolKeys,
          requestStatus: 'approved',
          canonicalKey: changedProtocol?.key || approvedProtocolKey,
          canonicalName: changedProtocol?.name || approvedProtocolKey,
          revoked: true,
          protocolSync: {
            synced: revokeResult.protocolSync.synced,
            added: revokeResult.protocolSync.added,
            refreshed: revokeResult.protocolSync.refreshed,
            removed: revokeResult.protocolSync.removed
          }
        } });
      }

      const authHeader = sanitizeString(req.headers?.authorization, 4096);
      const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const { user: tokenUser, error: tokenError } = accessToken ? await getUserFromAccessToken(accessToken) : { user: null, error: 'missing_token' };
      if (!accessToken || !supabaseUrl || !supabasePublicClientKey || tokenError || !tokenUser || sanitizeString(tokenUser.id, 120) !== sanitizeString(req.session.user?.id, 120)) {
        return res.status(401).json({ success: false, error: 'Identidade autenticada obrigatoria para atualizar o acervo.' });
      }
      const actorSupabase = createClient(supabaseUrl, supabasePublicClientKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${accessToken}`, 'x-verto-deployment-env': vertoDeploymentEnv } }
      });
      const { error: approveError } = await actorSupabase.rpc('approve_protocol_import_request_v1', {
        p_request_id: requestId,
        p_canonical_key: protocolKey
      });
      if (approveError) return res.status(409).json({ success: false, error: 'Nao foi possivel atualizar o grant canonico.' });

      const protocolSyncResult = await syncApprovedProtocolsToClinicState({
        clinicId: requestClinicId,
        performedBy: sanitizeString(req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        auditAction: 'sync_approved_protocols_to_clinic_state'
      });
      const accessMap = await loadProtocolAccessMap();
      const protocolKeys = accessMap.get(scopeKey) || [];
      const changedProtocol = VERTO_PROTOCOL_BY_KEY.get(protocolKey);

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: requestClinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Acervo de protocolos atualizado',
        content: `Acervo ${scopeKey} atualizado com ${protocolKeys.length} protocolo(s).`,
        type: 'protocol_access_updated',
        actionType: 'protocol_access_updated',
        payloadDetails: JSON.stringify({ scopeKey, protocolKeys, changedProtocolKey: protocolKey, requestId, enabled: true, updatedAt: new Date().toISOString() })
      });

      return res.json({ success: true, data: {
        scopeKey, protocolKeys, requestStatus: 'approved', canonicalKey: changedProtocol?.key || protocolKey,
        canonicalName: changedProtocol?.name || protocolKey,
        protocolSync: { synced: protocolSyncResult.synced, added: protocolSyncResult.added, refreshed: protocolSyncResult.refreshed }
      } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel atualizar o acervo de protocolos.' });
    }
  };
}

export function createAdminProtocolImportApproveHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; normalizeApprovedProtocolKey: any; identifyVertoProtocolCandidate: any; VERTO_PROTOCOL_BY_KEY: any; supabase: any; parseStoredJsonObject: any; isAllowedScreenshotDataUrl: any; supabaseUrl: any; supabasePublicClientKey: any; getUserFromAccessToken: any; createClient: any; vertoDeploymentEnv: any; extractSupabaseErrorMessage: any; isUuid: any; syncApprovedProtocolsToClinicState: any; persistActivityLog: any; currentClinicId: any }) {
  return async (req: any, res) => {
    const { sanitizeString, normalizeApprovedProtocolKey, identifyVertoProtocolCandidate, VERTO_PROTOCOL_BY_KEY, supabase, parseStoredJsonObject, isAllowedScreenshotDataUrl, supabaseUrl, supabasePublicClientKey, getUserFromAccessToken, createClient, vertoDeploymentEnv, extractSupabaseErrorMessage, isUuid, syncApprovedProtocolsToClinicState, persistActivityLog, currentClinicId } = getDeps();
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const canonicalName = sanitizeString(req.body?.canonicalName, 180);
      if (!requestId || !canonicalName) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao e o protocolo Verto aprovado.' });
      }
      const requestedCanonicalKey = normalizeApprovedProtocolKey(req.body?.canonicalKey);
      const inferredCanonicalKey = identifyVertoProtocolCandidate(canonicalName).canonicalKey;
      const canonicalKey = VERTO_PROTOCOL_BY_KEY.has(requestedCanonicalKey)
        ? requestedCanonicalKey
        : inferredCanonicalKey;
      if (!VERTO_PROTOCOL_BY_KEY.has(canonicalKey)) {
        return res.status(400).json({ success: false, error: 'Selecione um protocolo existente na Biblioteca Verto.' });
      }

      const { data: currentRequest, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('clinic_id, scan_status, quarantine_status, file_type, file_data_url, scan_report')
        .eq('id', requestId)
        .maybeSingle();
      if (requestError || !currentRequest) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada.' });
      }
      const requestClinicId = sanitizeString((currentRequest as any)?.clinic_id, 120);
      const currentScanReport = parseStoredJsonObject((currentRequest as any)?.scan_report);
      const screenshotEvidence = currentScanReport?.evidence?.mode === 'screenshots'
        ? (currentScanReport?.evidence?.screenshots || [])
        : [];
      const hasScreenshotImage = screenshotEvidence.some((shot: any) => isAllowedScreenshotDataUrl(shot?.dataUrl))
        || isAllowedScreenshotDataUrl((currentRequest as any)?.file_data_url);
      const canApproveScreenshotEvidence = sanitizeString((currentRequest as any)?.file_type, 80) === 'screenshots' && hasScreenshotImage;
      if ((currentRequest as any)?.scan_status && (currentRequest as any)?.scan_status !== 'clean' && !canApproveScreenshotEvidence) {
        return res.status(409).json({ success: false, error: 'Este protocolo ainda nao passou por uma varredura segura limpa.' });
      }

      const authHeader = sanitizeString(req.headers?.authorization, 4096);
      const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!accessToken || !supabaseUrl || !supabasePublicClientKey) {
        return res.status(401).json({ success: false, error: 'Sessao autenticada obrigatoria para aprovar protocolos.' });
      }
      const { user: tokenUser, error: tokenError } = await getUserFromAccessToken(accessToken);
      if (tokenError || !tokenUser || sanitizeString(tokenUser.id, 120) !== sanitizeString(req.session.user?.id, 120)) {
        return res.status(401).json({ success: false, error: 'Identidade da sessao nao confere com a credencial de aprovacao.' });
      }
      const actorSupabase = createClient(supabaseUrl, supabasePublicClientKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${accessToken}`, 'x-verto-deployment-env': vertoDeploymentEnv } }
      });
      const { error: approveError } = await actorSupabase.rpc('approve_protocol_import_request_v1', {
        p_request_id: requestId,
        p_canonical_key: canonicalKey
      });
      if (approveError) {
        const message = extractSupabaseErrorMessage(approveError);
        const status = message.includes('platform_admin_required') ? 403 : message.includes('request_not_found') ? 404 : 409;
        return res.status(status).json({ success: false, error: 'Nao foi possivel concluir a aprovacao atomica do protocolo.' });
      }

      await supabase
        .from('protocol_import_requests')
        .update({ approved_canonical_name: canonicalName })
        .eq('id', requestId)
        .eq('status', 'approved');

      let protocolSyncResult: any = null;
      if (isUuid(requestClinicId)) {
        protocolSyncResult = await syncApprovedProtocolsToClinicState({
          clinicId: requestClinicId,
          performedBy: sanitizeString(req.session.user?.id, 120),
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
          auditAction: 'sync_approved_protocols_to_clinic_state'
        });
      }
      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Protocolo aprovado para uso',
        content: `Solicitacao ${requestId} aprovada e vinculada ao protocolo Verto ${canonicalName}.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_approved',
        payloadDetails: JSON.stringify({
          requestId,
          canonicalKey,
          canonicalName,
          atomicApproval: true,
          protocolSync: protocolSyncResult
            ? {
                synced: protocolSyncResult.synced,
                added: protocolSyncResult.added,
                refreshed: protocolSyncResult.refreshed
              }
            : null
        })
      });

      return res.json({ success: true, data: { requestId, status: 'approved', canonicalKey, canonicalName, protocolSync: protocolSyncResult } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel aprovar o protocolo.' });
    }
  };
}

export function createAdminProtocolImportRejectHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; supabase: any; persistActivityLog: any; currentClinicId: any }) {
  return async (req: any, res) => {
    const { sanitizeString, supabase, persistActivityLog, currentClinicId } = getDeps();
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      let updatedTable = false;
      try {
        const { error } = await supabase
          .from('protocol_import_requests')
          .update({
            status: 'rejected',
            reviewed_by: sanitizeString(req.session.user?.id, 120) || null,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId);
        updatedTable = !error;
      } catch {
        updatedTable = false;
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Protocolo recusado',
        content: `Solicitacao ${requestId} foi recusada pela Verto.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_rejected',
        payloadDetails: JSON.stringify({ requestId, status: 'rejected', updatedTable })
      });

      return res.json({ success: true, data: { requestId, status: 'rejected' } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel recusar o protocolo.' });
    }
  };
}

export function createAdminProtocolImportScanHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; supabase: any; scanProtocolUpload: any; extractMissingColumnName: any; persistActivityLog: any; currentClinicId: any; sanitizeSafePreviewText: any; sanitizeClinicalPayload: any }) {
  return async (req: any, res) => {
    const { sanitizeString, supabase, scanProtocolUpload, extractMissingColumnName, persistActivityLog, currentClinicId, sanitizeSafePreviewText, sanitizeClinicalPayload } = getDeps();
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      const { data: requestRow, error: fetchError } = await supabase
        .from('protocol_import_requests')
        .select('id, protocol_name, file_name, file_type, file_size, file_data_url')
        .eq('id', requestId)
        .maybeSingle();
      if (fetchError || !requestRow) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada.' });
      }

      const dataUrl = sanitizeString((requestRow as any).file_data_url, 14_000_000);
      if (!dataUrl) {
        return res.status(409).json({ success: false, error: 'Arquivo bruto nao esta disponivel para varredura.' });
      }

      const scan = scanProtocolUpload(
        dataUrl,
        sanitizeString((requestRow as any).file_name || (requestRow as any).protocol_name, 240),
        sanitizeString((requestRow as any).file_type, 120)
      );
      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        scan_status: scan.scanStatus,
        quarantine_status: scan.quarantineStatus,
        safe_preview_status: scan.safePreviewStatus,
        raw_file_access: 'blocked',
        safe_preview_text: scan.safePreviewText,
        scan_report: scan.scanReport,
        updated_at: nowIso
      };
      let updateError: any = null;
      let updatedTable = false;
      const removedProtocolColumns = new Set<string>();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        ({ error: updateError } = await supabase
          .from('protocol_import_requests')
          .update(updatePayload)
          .eq('id', requestId));
        if (!updateError) {
          updatedTable = true;
          break;
        }

        const missingColumn = extractMissingColumnName(updateError);
        if (!missingColumn || removedProtocolColumns.has(missingColumn) || !(missingColumn in updatePayload)) {
          break;
        }
        removedProtocolColumns.add(missingColumn);
        delete updatePayload[missingColumn];
      }
      if (updateError) {
        console.warn('[Protocol Import] scan table update fallback:', updateError.message || updateError);
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Varredura segura de protocolo',
        content: `Solicitacao ${requestId} processada com status ${scan.scanStatus}.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_scanned',
        payloadDetails: JSON.stringify({
          requestId,
          scanStatus: scan.scanStatus,
          quarantineStatus: scan.quarantineStatus,
          safePreviewStatus: scan.safePreviewStatus,
          safePreviewText: sanitizeSafePreviewText(scan.safePreviewText, 4000),
          updatedTable,
          scanReport: scan.scanReport
        })
      });

      return res.json({
        success: true,
        data: {
          id: requestId,
          scanStatus: scan.scanStatus,
          quarantineStatus: scan.quarantineStatus,
          safePreviewStatus: scan.safePreviewStatus,
          rawFileAccess: 'blocked',
          safePreviewText: sanitizeSafePreviewText(scan.safePreviewText, 4000),
          scanReport: sanitizeClinicalPayload(scan.scanReport)
        }
      });
    } catch (error: any) {
      console.error('[Protocol Import] scan error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Nao foi possivel processar a varredura segura do protocolo.' });
    }
  };
}
