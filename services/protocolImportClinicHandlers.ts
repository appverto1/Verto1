// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createProtocolImportRequestHandler(getDeps: () => { enforcePayloadLimit: any; sanitizeString: (value: unknown, maxLength?: number) => string; asSafeNumber: any; isAllowedScreenshotDataUrl: any; identifyVertoProtocolCandidate: any; currentClinicId: any; crypto: any; buildScreenshotEvidenceSummary: any; sanitizeClinicalPayload: any; isUuid: any; sanitizeEmail: any; supabase: any; extractMissingColumnName: any; persistActivityLog: any }) {
  return async (req: any, res) => {
    const { enforcePayloadLimit, sanitizeString, asSafeNumber, isAllowedScreenshotDataUrl, identifyVertoProtocolCandidate, currentClinicId, crypto, buildScreenshotEvidenceSummary, sanitizeClinicalPayload, isUuid, sanitizeEmail, supabase, extractMissingColumnName, persistActivityLog } = getDeps();
    try {
      if (!enforcePayloadLimit(req, res, 28 * 1024 * 1024, 'Evidencias do protocolo')) return;

      const user = req.session.user;
      const evidenceMode = sanitizeString(req.body?.evidenceMode, 40) || 'screenshots';
      const protocolName = sanitizeString(req.body?.protocolName, 180);
      const applicableAgeGroup = sanitizeString(req.body?.applicableAgeGroup, 40) || 'all';
      const ageMin = asSafeNumber(req.body?.ageMin, 0, 120);
      const rawAgeMax = req.body?.ageMax;
      const ageMax = rawAgeMax === null || rawAgeMax === undefined || rawAgeMax === ''
        ? null
        : asSafeNumber(rawAgeMax, 0, 120);
      const totalPages = asSafeNumber(req.body?.totalPages, 1, 5000) || 0;
      const requestedCoverageMaxPage = asSafeNumber(req.body?.coverageMaxPage, 1, 5000) || 0;
      const fullProtocolConfirmed = Boolean(req.body?.fullProtocolConfirmed);
      const rightsAccepted = Boolean(req.body?.rightsAccepted);
      const rawScreenshotChallenges = Array.isArray(req.body?.screenshotChallenges) ? req.body.screenshotChallenges : [];

      if (evidenceMode !== 'screenshots') {
        return res.status(400).json({ success: false, error: 'A Verto agora aceita somente validacao por screenshots neste fluxo.' });
      }

      if (!protocolName) {
        return res.status(400).json({ success: false, error: 'Informe o nome do protocolo.' });
      }
      if (!fullProtocolConfirmed || !rightsAccepted) {
        return res.status(400).json({ success: false, error: 'Confirme que o protocolo esta completo e que possui direito de uso.' });
      }
      if (ageMin === null || (ageMax !== null && ageMax < ageMin)) {
        return res.status(400).json({ success: false, error: 'Informe uma idade valida para o protocolo.' });
      }

      const maxAllowedCoveragePage = totalPages ? Math.max(1, Math.ceil(totalPages * 0.3)) : 100;
      const coverageMaxPage = requestedCoverageMaxPage || maxAllowedCoveragePage;
      if (coverageMaxPage > maxAllowedCoveragePage + 1) {
        return res.status(400).json({ success: false, error: 'A janela de paginas solicitadas nao confere com a regra de amostragem.' });
      }

      const screenshotChallenges = rawScreenshotChallenges
        .slice(0, 6)
        .map((item: any, index: number) => {
          const pageNumber = asSafeNumber(item?.pageNumber, 1, maxAllowedCoveragePage) || 0;
          const prompt = sanitizeString(item?.prompt, 240) || `Envie um print da pagina ${pageNumber}.`;
          const fileName = sanitizeString(item?.fileName, 240) || `pagina-${pageNumber}.png`;
          const fileType = sanitizeString(item?.fileType, 120) || 'image/png';
          const fileSize = asSafeNumber(item?.fileSize, 0, 8_000_000) || 0;
          const dataUrl = isAllowedScreenshotDataUrl(item?.dataUrl)
            ? sanitizeString(item.dataUrl, 8_000_000)
            : null;
          return pageNumber && dataUrl ? {
            id: `shot-${index + 1}`,
            pageNumber,
            prompt,
            fileName,
            fileType,
            fileSize,
            dataUrl
          } : null;
        })
        .filter(Boolean) as Array<{
          id: string;
          pageNumber: number;
          prompt: string;
          fileName: string;
          fileType: string;
          fileSize: number;
          dataUrl: string;
        }>;

      if (screenshotChallenges.length === 0) {
        return res.status(400).json({ success: false, error: 'Envie ao menos um screenshot valido em PNG, JPG ou WEBP.' });
      }

      const declaredPages = new Set<number>();
      for (const challenge of screenshotChallenges) {
        if (declaredPages.has(challenge.pageNumber)) {
          return res.status(400).json({ success: false, error: 'As paginas solicitadas precisam ser unicas.' });
        }
        declaredPages.add(challenge.pageNumber);
      }

      const candidate = identifyVertoProtocolCandidate(protocolName);
      const clinicId = currentClinicId(user);
      const requestId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const evidenceSummary = buildScreenshotEvidenceSummary({
        totalPages: totalPages || null,
        coverageMaxPage: coverageMaxPage || null,
        applicableAgeGroup,
        ageMin,
        ageMax,
        screenshots: screenshotChallenges
      });
      const screenshotEvidence = {
        mode: 'screenshots',
        applicableAgeGroup,
        ageMin,
        ageMax,
        totalPages: totalPages || null,
        coverageMaxPage,
        screenshots: screenshotChallenges
      };
      const totalEvidenceBytes = screenshotChallenges.reduce((sum, item) => sum + (item.fileSize || 0), 0);
      const payload = sanitizeClinicalPayload({
        id: requestId,
        clinicId,
        requesterUserId: user?.id,
        requesterName: user?.name || user?.email,
        requesterEmail: user?.email,
        evidenceMode: 'screenshots',
        applicableAgeGroup,
        ageMin,
        ageMax,
        protocolName,
        fileName: `${protocolName}.screenshots`,
        fileType: 'screenshots',
        fileSize: totalEvidenceBytes,
        status: 'pending',
        quarantineStatus: 'review_ready',
        scanStatus: 'clean',
        safePreviewStatus: 'generated',
        rawFileAccess: 'blocked',
        canonicalKey: candidate.canonicalKey,
        canonicalName: candidate.canonicalName,
        confidence: candidate.confidence,
        fullProtocolConfirmed,
        rightsAccepted,
        safePreviewText: evidenceSummary,
        scanReport: {
          engine: 'verto-screenshot-intake',
          scannedAt: nowIso,
          evidence: screenshotEvidence,
          flags: [],
          riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
        },
        createdAt: nowIso
      });
      const auditPayload = sanitizeClinicalPayload({
        ...payload,
        scanReport: {
          engine: 'verto-screenshot-intake',
          scannedAt: nowIso,
            evidence: {
              mode: 'screenshots',
            applicableAgeGroup,
            ageMin,
            ageMax,
            totalPages: totalPages || null,
            coverageMaxPage,
            screenshots: screenshotChallenges.map((item) => ({
              pageNumber: item.pageNumber,
              prompt: item.prompt,
              fileName: item.fileName,
              fileType: item.fileType,
              fileSize: item.fileSize
            }))
          },
          flags: [],
          riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
        },
        hasFileData: false,
        hasScreenshotEvidence: screenshotChallenges.length > 0,
        previewImage: {
          dataUrl: screenshotChallenges[0]?.dataUrl || null
        }
      });

      let storedInTable = false;
      try {
        const insertPayload: Record<string, any> = {
          id: requestId,
          clinic_id: isUuid(clinicId) ? clinicId : null,
          requester_user_id: sanitizeString(user?.id, 120) || null,
          requester_name: sanitizeString(user?.name || user?.email, 180),
          requester_email: sanitizeEmail(user?.email),
          protocol_name: protocolName,
          file_name: `${protocolName}.screenshots`,
          file_type: 'screenshots',
          file_size: totalEvidenceBytes,
          file_data_url: screenshotChallenges[0]?.dataUrl || null,
          status: 'pending',
          quarantine_status: 'review_ready',
          scan_status: 'clean',
          safe_preview_status: 'generated',
          raw_file_access: 'blocked',
          safe_preview_text: evidenceSummary,
          scan_report: {
            engine: 'verto-screenshot-intake',
            scannedAt: nowIso,
            evidence: screenshotEvidence,
            flags: [],
            riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
          },
          suggested_canonical_key: candidate.canonicalKey,
          suggested_canonical_name: candidate.canonicalName,
          suggested_confidence: candidate.confidence,
          rights_accepted: rightsAccepted,
          full_protocol_confirmed: fullProtocolConfirmed,
          created_at: nowIso,
          updated_at: nowIso
        };
        let insertError: any = null;
        const removedProtocolColumns = new Set<string>();
        for (let attempt = 0; attempt < 10; attempt += 1) {
          ({ error: insertError } = await supabase.from('protocol_import_requests').insert([insertPayload]));
          if (!insertError) break;

          const missingColumn = extractMissingColumnName(insertError);
          if (!missingColumn || removedProtocolColumns.has(missingColumn) || !(missingColumn in insertPayload)) {
            break;
          }
          removedProtocolColumns.add(missingColumn);
          delete insertPayload[missingColumn];
        }
        storedInTable = !insertError;
        if (insertError) {
          console.warn('[Protocol Import] table insert fallback:', insertError.message || insertError);
        }
      } catch (tableError: any) {
        console.warn('[Protocol Import] table unavailable fallback:', tableError?.message || String(tableError));
      }

      await persistActivityLog({
        userId: sanitizeString(user?.id, 120),
        clinicId: sanitizeString(clinicId, 120),
        actorName: sanitizeString(user?.name || user?.email || 'Profissional', 180),
        title: 'Solicitacao de protocolo importado',
        content: `Protocolo ${protocolName} enviado para validacao. Sugestao Verto: ${candidate.canonicalName}.`,
        type: 'protocol_import_request',
        actionType: 'protocol_import_requested',
        payloadDetails: JSON.stringify(auditPayload)
      });

      return res.json({
        success: true,
        data: {
          id: requestId,
          status: 'pending',
          suggestedCanonicalName: candidate.canonicalName,
          suggestedConfidence: candidate.confidence,
          screenshotCount: screenshotChallenges.length,
          storedInTable
        }
      });
    } catch (error: any) {
      console.error('[Protocol Import] request error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Nao foi possivel enviar o protocolo para validacao.' });
    }
  };
}

export function createClinicProtocolImportsReadHandler(getDeps: () => { applyNoStoreHeaders: any; sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; VERTO_PROTOCOL_PANEL_RESET_AT: any; isUuid: any; isProd: any; supabase: any; PROTOCOL_IMPORT_REQUEST_SELECT: any; parseStoredJsonObject: any; asSafeNumber: any; extractSupabaseErrorMessage: any; loadProtocolAccessMap: any; buildProtocolAccessScopeKeys: any; VERTO_PROTOCOL_BY_KEY: any; normalizeApprovedProtocolKey: any; identifyVertoProtocolCandidate: any; redactForLogs: any; sendNoStoreJson: any }) {
  return async (req: any, res) => {
    const { applyNoStoreHeaders, sanitizeString, currentClinicId, VERTO_PROTOCOL_PANEL_RESET_AT, isUuid, isProd, supabase, PROTOCOL_IMPORT_REQUEST_SELECT, parseStoredJsonObject, asSafeNumber, extractSupabaseErrorMessage, loadProtocolAccessMap, buildProtocolAccessScopeKeys, VERTO_PROTOCOL_BY_KEY, normalizeApprovedProtocolKey, identifyVertoProtocolCandidate, redactForLogs, sendNoStoreJson } = getDeps();
    try {
      applyNoStoreHeaders(res);
      const user = req.session.user;
      const userId = sanitizeString(user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      const workspaceId = sanitizeString(user?.activeWorkspaceId || user?.workspaceId || user?.workspace_id, 120);
      const organizationId = sanitizeString(user?.organizationId || user?.organization_id, 120);
      const tableFilters = [
        `created_at >= ${VERTO_PROTOCOL_PANEL_RESET_AT}`,
        isUuid(clinicId)
          ? `clinic_id = ${clinicId}`
          : userId
            ? `requester_user_id = ${userId}`
            : 'no clinic_id/requester_user_id filter'
      ];
      const diagnostics: Record<string, any> | null = isProd ? null : {
        route: 'GET /api/protocol-import-requests',
        userId,
        workspaceId: workspaceId || null,
        organizationId: organizationId || null,
        clinicId: clinicId || null,
        table: 'protocol_import_requests',
        filters: tableFilters,
        tableRowsReturned: 0,
        legacyRowsMatched: 0,
        authorizedScopeKeys: [],
        authorizedProtocolKeys: 0,
        returnedCount: 0,
        wouldReturnEmpty: true,
        possiblyFilteredByScope: false
      };
      let requests: any[] = [];

      try {
        let query = supabase
          .from('protocol_import_requests')
          .select(PROTOCOL_IMPORT_REQUEST_SELECT)
          .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('created_at', { ascending: false })
          .limit(50);

        if (isUuid(clinicId)) {
          query = query.eq('clinic_id', clinicId);
        } else if (userId) {
          query = query.eq('requester_user_id', userId);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          if (diagnostics) diagnostics.tableRowsReturned = data.length;
          requests = data.map((row: any) => {
            const scanReport = parseStoredJsonObject(row.scan_report);
            return {
              id: sanitizeString(row.id, 120),
              protocolName: sanitizeString(row.protocol_name, 180),
              fileName: sanitizeString(row.file_name, 240),
              status: sanitizeString(row.status, 40) || 'pending',
              canonicalKey: sanitizeString(row.approved_canonical_key || row.suggested_canonical_key, 180),
              canonicalName: sanitizeString(row.approved_canonical_name || row.suggested_canonical_name, 180),
              confidence: Number(row.suggested_confidence || 0),
              applicableAgeGroup: sanitizeString(scanReport?.evidence?.applicableAgeGroup, 40) || 'all',
              ageMin: asSafeNumber(scanReport?.evidence?.ageMin, 0, 120),
              ageMax: scanReport?.evidence?.ageMax === null || scanReport?.evidence?.ageMax === undefined
                ? null
                : asSafeNumber(scanReport?.evidence?.ageMax, 0, 120),
              createdAt: sanitizeString(row.created_at, 80),
              reviewedAt: sanitizeString(row.reviewed_at, 80) || null
            };
          });
        } else if (error && diagnostics) {
          diagnostics.tableError = {
            code: sanitizeString(error?.code, 40) || null,
            message: extractSupabaseErrorMessage(error)
          };
        }
      } catch (tableError: any) {
        if (diagnostics) {
          diagnostics.tableError = {
            message: sanitizeString(tableError?.message || String(tableError), 500)
          };
        }
        requests = [];
      }

      if (requests.length === 0) {
        const { data: logs } = await supabase
          .from('activity_logs')
          .select('payload_details, timestamp')
          .eq('type', 'protocol_import_request')
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(50);

        let legacyRowsMatched = 0;
        requests = (logs || []).map((log: any) => {
          try {
            const payload = JSON.parse(String(log.payload_details || '{}'));
            const requesterUserId = sanitizeString(payload.requesterUserId, 120);
            const payloadClinicId = sanitizeString(payload.clinicId, 120);
            if ((userId && requesterUserId === userId) || (clinicId && payloadClinicId === clinicId)) {
              legacyRowsMatched += 1;
              return {
                id: sanitizeString(payload.id, 120),
                protocolName: sanitizeString(payload.protocolName, 180),
                fileName: sanitizeString(payload.fileName, 240),
                status: sanitizeString(payload.status, 40) || 'pending',
                canonicalName: sanitizeString(payload.canonicalName, 180),
                confidence: Number(payload.confidence || 0),
                applicableAgeGroup: sanitizeString(payload.applicableAgeGroup, 40) || 'all',
                ageMin: asSafeNumber(payload.ageMin, 0, 120),
                ageMax: payload.ageMax === null || payload.ageMax === undefined ? null : asSafeNumber(payload.ageMax, 0, 120),
                createdAt: sanitizeString(payload.createdAt || log.timestamp, 80),
                reviewedAt: null
              };
            }
            return null;
          } catch {
            return null;
          }
        }).filter(Boolean);
        if (diagnostics) diagnostics.legacyRowsMatched = legacyRowsMatched;
      }

      const accessMap = await loadProtocolAccessMap();
      const scopeKeys = buildProtocolAccessScopeKeys({ clinicId, requesterUserId: userId, requesterEmail: user?.email });
      const authorizedProtocolKeys = Array.from(new Set(
        scopeKeys.flatMap((scopeKey) => accessMap.get(scopeKey) || [])
      )).filter((protocolKey) => VERTO_PROTOCOL_BY_KEY.has(protocolKey));
      if (diagnostics) {
        diagnostics.authorizedScopeKeys = scopeKeys;
        diagnostics.authorizedProtocolKeys = authorizedProtocolKeys.length;
      }
      const authorizedProtocolKeySet = new Set(authorizedProtocolKeys);
      requests = requests.filter((request) => {
        const status = String(request.status || '').toLowerCase();
        if (status !== 'approved') return true;
        const canonicalKey = normalizeApprovedProtocolKey(
          request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey
        );
        return authorizedProtocolKeySet.has(canonicalKey);
      });
      const existingAuthorizedKeys = new Set(
        requests
          .filter((request) => String(request.status || '').toLowerCase() === 'approved')
          .map((request) => normalizeApprovedProtocolKey(request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey))
      );
      for (const protocolKey of authorizedProtocolKeys) {
        if (existingAuthorizedKeys.has(protocolKey)) continue;
        const protocol = VERTO_PROTOCOL_BY_KEY.get(protocolKey);
        if (!protocol) continue;
        requests.unshift({
          id: `access-${scopeKeys[0]}-${protocolKey}`,
          protocolName: protocol.name,
          fileName: 'Acervo Verto',
          status: 'approved',
          canonicalKey: protocol.key,
          canonicalName: protocol.name,
          confidence: 1,
          applicableAgeGroup: protocol.applicableAgeGroup,
          ageMin: protocol.ageMin,
          ageMax: protocol.ageMax,
          completionPercent: protocol.completionPercent,
          statusLabel: protocol.statusLabel,
          createdAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
          fromProtocolAccess: true
        });
      }

      if (diagnostics) {
        try {
          let filteredCountQuery = supabase
            .from('protocol_import_requests')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT);
          if (isUuid(clinicId)) {
            filteredCountQuery = filteredCountQuery.eq('clinic_id', clinicId);
          } else if (userId) {
            filteredCountQuery = filteredCountQuery.eq('requester_user_id', userId);
          }
          const [totalRequests, filteredRequests, canonicalProtocols, legacyRequests] = await Promise.all([
            supabase
              .from('protocol_import_requests')
              .select('id', { count: 'exact', head: true })
              .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT),
            filteredCountQuery,
            supabase
              .from('verto_canonical_protocols')
              .select('id', { count: 'exact', head: true }),
            supabase
              .from('activity_logs')
              .select('id', { count: 'exact', head: true })
              .eq('type', 'protocol_import_request')
              .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          ]);
          diagnostics.totalProtocolImportRequests = totalRequests.count ?? null;
          diagnostics.filteredProtocolImportRequests = filteredRequests.count ?? null;
          diagnostics.totalCanonicalProtocols = canonicalProtocols.count ?? null;
          diagnostics.totalLegacyProtocolImportLogs = legacyRequests.count ?? null;
          diagnostics.possiblyFilteredByScope =
            Number(totalRequests.count || 0) > 0 &&
            Number(filteredRequests.count || 0) === 0 &&
            requests.length === 0;
        } catch (diagnosticError: any) {
          diagnostics.countError = sanitizeString(diagnosticError?.message || String(diagnosticError), 500);
        }

        diagnostics.returnedCount = requests.length;
        diagnostics.wouldReturnEmpty = requests.length === 0;
        console.info('[Protocol Import] list diagnostics', redactForLogs(diagnostics));
      }

      return sendNoStoreJson(res, { success: true, data: requests });
    } catch (error: any) {
      return sendNoStoreJson(res, { success: false, error: 'Nao foi possivel listar seus protocolos importados.' }, 500);
    }
  };
}

export function createClinicProtocolGrantRevokeHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; supabase: any; normalizeApprovedProtocolKey: any; VERTO_PROTOCOL_BY_KEY: any; revokeProtocolGrantForRequest: any; loadProtocolAccessMap: any; persistActivityLog: any; extractSupabaseErrorMessage: any; logRouteDbError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, normalizeApprovedProtocolKey, VERTO_PROTOCOL_BY_KEY, revokeProtocolGrantForRequest, loadProtocolAccessMap, persistActivityLog, extractSupabaseErrorMessage, logRouteDbError } = getDeps();
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const user = req.session.user;
      const actorId = sanitizeString(user?.id || user?.user_id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      if (!isUuid(requestId) || !isUuid(actorId) || !isUuid(clinicId)) {
        return res.status(400).json({ success: false, error: 'Escopo de revogacao invalido.' });
      }

      const { data: requestRow, error: requestError } = await supabase
        .from('protocol_import_requests')
        .select('id,clinic_id,status,approved_canonical_key')
        .eq('id', requestId)
        .eq('clinic_id', clinicId)
        .limit(1)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!requestRow?.id) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada nesta clinica.' });
      }
      if (sanitizeString(requestRow.status, 40).toLowerCase() !== 'approved') {
        return res.status(409).json({ success: false, error: 'Somente uma liberacao aprovada pode ser revogada.' });
      }

      const canonicalKey = normalizeApprovedProtocolKey(requestRow.approved_canonical_key);
      if (!VERTO_PROTOCOL_BY_KEY.has(canonicalKey)) {
        return res.status(409).json({ success: false, error: 'O grant aprovado nao possui uma chave canonica valida.' });
      }

      const revokeResult = await revokeProtocolGrantForRequest({
        clinicId,
        requestId,
        actorId,
        actorName: sanitizeString(user?.name || user?.email || 'Equipe', 180),
        auditAction: 'sync_revoked_protocols_to_clinic_state'
      });
      const accessMap = await loadProtocolAccessMap();
      const scopeKey = 'clinic:' + clinicId;
      const protocolKeys = accessMap.get(scopeKey) || [];

      await persistActivityLog({
        userId: actorId,
        clinicId,
        actorName: sanitizeString(user?.name || user?.email || 'Equipe', 180),
        title: 'Protocolo removido da biblioteca',
        content: 'Grant ' + canonicalKey + ' revogado para a clinica atual.',
        type: 'protocol_access_updated',
        actionType: 'protocol_grant_revoked',
        payloadDetails: JSON.stringify({ requestId, canonicalKey, enabled: false, updatedAt: new Date().toISOString() })
      });

      return res.json({
        success: true,
        data: {
          requestId,
          canonicalKey,
          protocolKeys,
          revoked: true,
          protocolSync: {
            synced: revokeResult.protocolSync.synced,
            added: revokeResult.protocolSync.added,
            refreshed: revokeResult.protocolSync.refreshed,
            removed: revokeResult.protocolSync.removed
          }
        }
      });
    } catch (error: any) {
      const message = extractSupabaseErrorMessage(error);
      const status = message.includes('required') || message.includes('denied') ? 403
        : message.includes('not_found') ? 404
          : 409;
      logRouteDbError('/api/protocol-import-requests/:requestId/revoke [POST]', error, {
        requestId: sanitizeString(req.params.requestId, 120),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120)
      });
      return res.status(status).json({ success: false, error: 'Nao foi possivel remover o protocolo da biblioteca.' });
    }
  };
}

export function createClinicProtocolRequestDeleteHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; supabase: any; isUuid: any; persistActivityLog: any; logRouteDbError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, supabase, isUuid, persistActivityLog, logRouteDbError } = getDeps();
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const user = req.session.user;
      const userId = sanitizeString(user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      let lookup = supabase
        .from('protocol_import_requests')
        .select('id,status')
        .eq('id', requestId);
      if (isUuid(clinicId)) {
        lookup = lookup.eq('clinic_id', clinicId);
      } else if (userId) {
        lookup = lookup.eq('requester_user_id', userId);
      } else {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const { data: requestRow, error: lookupError } = await lookup.limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      if (!requestRow?.id) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada.' });
      }
      if (sanitizeString(requestRow.status, 40).toLowerCase() === 'approved') {
        return res.status(409).json({
          success: false,
          error: 'A revogacao de protocolo aprovado exige o fluxo canonico de grants.'
        });
      }

      let query = supabase
        .from('protocol_import_requests')
        .delete()
        .eq('id', requestId)
        .neq('status', 'approved');

      if (isUuid(clinicId)) {
        query = query.eq('clinic_id', clinicId);
      } else {
        query = query.eq('requester_user_id', userId);
      }

      const { error } = await query;
      if (error) throw error;

      void persistActivityLog({
        type: 'protocol_import_request_deleted',
        title: 'Solicitacao de protocolo excluida',
        details: 'Solicitacao de protocolo ' + requestId + ' excluida pelo solicitante.',
        userId,
        clinicId,
        payload: { requestId }
      });

      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/protocol-import-requests/:requestId [DELETE]', error, {
        requestId: sanitizeString(req.params.requestId, 120)
      });
      return res.status(500).json({ success: false, error: 'Nao foi possivel excluir a solicitacao de protocolo.' });
    }
  };
}
