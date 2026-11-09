// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createPatientProfessionalLinksReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; supabase: any; isUuid: any; scopeProfessionalProfilePhotoUrlForClinic: any; resolveProfessionalProfilePhotoUrl: any; composePatientProfessionalLinks: any; isPatientProfessionalLinkManager: any; logRouteDbError: any; requestIdForLogs: any; isMissingRelationError: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, supabase, isUuid, scopeProfessionalProfilePhotoUrlForClinic, resolveProfessionalProfilePhotoUrl, composePatientProfessionalLinks, isPatientProfessionalLinkManager, logRouteDbError, requestIdForLogs, isMissingRelationError } = getDeps();
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(req.resolvedPatientClinicId || currentClinicId(req.session.user), 120);
      const linksSelect = 'id,organization_id,clinic_id,patient_id,professional_id,specialty,case_role,relationship_type,starts_at,ends_at,status,permissions,created_by,ended_by,created_at,updated_at';
      const usersSelect = 'id,name,email,profile_picture';
      const profilesSelect = 'user_id,specialty,council,council_number,profile_photo_url,metadata';
      const membershipsSelect = 'user_id,clinic_id,role,status,can_supervise';
      let stage = 'links';
      let table = 'patient_professional_links';
      let select = linksSelect;
      try {
        const canInspectInconsistentLinks =
          req.authorizationContext?.capabilities?.has('team.case.manage') === true;
        let linksQuery = supabase
          .from('patient_professional_links')
          .select(linksSelect)
          .eq('patient_id', patientId)
          .order('status', { ascending: true })
          .order('created_at', { ascending: true });
        if (!canInspectInconsistentLinks) {
          linksQuery = linksQuery.eq('organization_id', clinicId);
        }
        const { data: links, error } = await linksQuery;
        if (error) throw error;
        const professionalIds = Array.from(new Set(
          (links || []).map((link: any) => sanitizeString(link.professional_id, 120)).filter(isUuid),
        ));
        let professionals: any[] = [];
        let professionalProfiles: any[] = [];
        let memberships: any[] = [];
        if (professionalIds.length > 0) {
          stage = 'professionals';
          table = 'users';
          select = usersSelect;
          const professionalsResult = await supabase
            .from('users')
            .select(usersSelect)
            .in('id', professionalIds);
          if (professionalsResult.error) throw professionalsResult.error;
          professionals = (professionalsResult.data || []).map((professional: any) => ({
            ...professional,
            profile_picture: scopeProfessionalProfilePhotoUrlForClinic(
              professional?.profile_picture,
              clinicId,
              professional?.id,
            )
          }));

          if (professionalIds.length > 0) {
            stage = 'profiles';
            table = 'professional_profiles';
            select = profilesSelect;
            const profilesResult = await supabase
              .from('professional_profiles')
              .select(profilesSelect)
              .in('user_id', professionalIds);
            if (profilesResult.error) throw profilesResult.error;
            const professionalById = new Map(professionals.map((professional: any) => [String(professional.id), professional]));
            professionalProfiles = await Promise.all((profilesResult.data || []).map(async (profile: any) => ({
              ...profile,
              profile_photo_url: await resolveProfessionalProfilePhotoUrl(profile, professionalById.get(String(profile.user_id)))
            })));
            professionalProfiles = professionalProfiles.map((profile: any) => ({
              ...profile,
              profile_photo_url: scopeProfessionalProfilePhotoUrlForClinic(
                profile?.profile_photo_url,
                clinicId,
                profile?.user_id,
              )
            }));

            stage = 'memberships';
            table = 'clinic_memberships';
            select = membershipsSelect;
            const membershipsResult = await supabase
              .from('clinic_memberships')
              .select(membershipsSelect)
              .eq('clinic_id', clinicId)
              .in('user_id', professionalIds);
            if (membershipsResult.error) throw membershipsResult.error;
            memberships = membershipsResult.data || [];
          }
        }

        const composed = composePatientProfessionalLinks({
          clinicId,
          links: links || [],
          users: professionals,
          profiles: professionalProfiles,
          memberships
        });
        const actorId = sanitizeString(req.session.user?.id, 120);
        const actorRole = sanitizeString(req.effectiveClinicRole, 40).toLowerCase();
        const actorMembership = {
          user_id: actorId,
          clinic_id: clinicId,
          role: actorRole,
          status: 'active',
          can_supervise: req.authorizationContext?.canSupervise === true,
        };
        const canManage = isPatientProfessionalLinkManager({
          actorId,
          actorRole,
          clinicId,
          patientId,
          membership: actorMembership,
          patientLink: req.patientProfessionalLink,
          supervisionLink: req.patientSupervisionLink,
          canSupervise: req.authorizationContext?.canSupervise === true,
        });
        return res.json({
          success: true,
          ...composed,
          canManage,
        });
      } catch (error: any) {
        logRouteDbError('/api/patients/:patientId/professional-links [GET]', error, {
          patientId,
          requestId: requestIdForLogs(req),
          stage,
          table,
          select
        });
        return res.status(isMissingRelationError(error) ? 503 : 500).json({
          success: false,
          error: isMissingRelationError(error)
            ? 'MULTIDISCIPLINARY_SCHEMA_PENDING'
            : 'PATIENT_PROFESSIONAL_LINKS_UNAVAILABLE',
        });
      }
    };
}

export function createPatientFilesReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; isUuid: any; currentClinicId: any; fetchPatientFilesWithSchemaFallback: any; supabase: any; parseBoundedListLimit: any; isResponsiblePortalRole: any; filterPatientFilesForActor: any; isMissingRelationError: any; readPatientRecordPayloadForFiles: any; buildPatientFilesFromPayload: any; normalizePatientFileStorageUsage: any; readPatientFileStorageUsage: any; normalizePatientFileAccessScope: any; isPatientFileVisibleToPortal: any; sendRouteDbError: any; requestIdForLogs: any }) {
  return async (req: any, res) => {
    const { sanitizeString, isUuid, currentClinicId, fetchPatientFilesWithSchemaFallback, supabase, parseBoundedListLimit, isResponsiblePortalRole, filterPatientFilesForActor, isMissingRelationError, readPatientRecordPayloadForFiles, buildPatientFilesFromPayload, normalizePatientFileStorageUsage, readPatientFileStorageUsage, normalizePatientFileAccessScope, isPatientFileVisibleToPortal, sendRouteDbError, requestIdForLogs } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      if (!patientId) return res.status(400).json({ success: false, error: 'patientId inválido.' });
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });

      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
      const requestedFileId = sanitizeString(req.query?.fileId, 120);
      const fileResult = await fetchPatientFilesWithSchemaFallback({
        supabase,
        patientId,
        clinicId,
        fileId: requestedFileId || null,
        limit: requestedFileId ? 1 : parseBoundedListLimit(req.query?.limit, 50, 100),
        logger: console
      });
      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const actorId = sanitizeString(req.session.user?.id, 120);
      const isPatientPortal = isResponsiblePortalRole(role);
      const rawCanonicalRows = Array.isArray(fileResult.data) ? fileResult.data : [];
      const data = fileResult.error
        ? []
        : await filterPatientFilesForActor({
            supabase,
            rows: rawCanonicalRows,
            actorId,
            actorRole: role,
            logger: console
          });
      const error = fileResult.error;

      if (error) {
        if (isMissingRelationError(error) || String(error?.message || '').toLowerCase().includes('patient_files')) {
          const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
          const rawFallbackFiles = Array.isArray(fallbackPayload?.payload?.files)
            ? fallbackPayload.payload.files
            : [];
          const fallbackFiles = await buildPatientFilesFromPayload(
            patientId,
            requestedFileId
              ? rawFallbackFiles.filter((row: any) => sanitizeString(row?.id, 120) === requestedFileId)
              : rawFallbackFiles
          );
          const fallbackUsedBytes = rawFallbackFiles.reduce(
            (total: number, row: any) => total + Math.max(0, Number(row?.sizeBytes ?? row?.size ?? row?.file_size_bytes ?? 0) || 0),
            0
          );
          return res.status(200).json({
            success: true,
            data: fallbackFiles,
            storageUsage: normalizePatientFileStorageUsage({ usedBytes: fallbackUsedBytes }),
            warning: 'Tabela patient_files não criada; usando fallback do prontuário.'
          });
        }
        throw error;
      }

      if (requestedFileId && rawCanonicalRows.length > 0 && data.length === 0) {
        return res.json({ success: true, data: [] });
      }

      let storageUsage: any = null;
      if (!requestedFileId && isUuid(clinicId)) {
        const usageResult = await readPatientFileStorageUsage(patientId, clinicId);
        if (usageResult.error) {
          console.warn('[PatientFiles] Não foi possível ler uso de armazenamento:', usageResult.error?.message || String(usageResult.error));
        } else {
          storageUsage = usageResult.data;
        }
      }

      const canonicalRows = Array.isArray(data) ? data : [];
      const withUrls: any[] = canonicalRows.map((row: any) => ({
        id: row.id,
        patientId: row.patient_id,
        fileName: row.file_name,
        path: row.storage_path,
        mimeType: row.mime_type,
        sizeBytes: row.file_size_bytes,
        source: row.source || 'upload',
        createdAt: row.created_at,
        metadata: row.metadata || {},
        uploadedBy: row.uploaded_by || null,
        accessScope: normalizePatientFileAccessScope(row.access_scope),
        patientPortalVisible: isPatientFileVisibleToPortal(row),
        canManageAccess: Boolean(actorId && sanitizeString(row.uploaded_by, 120) === actorId),
        requiresAuditedAccess: true,
        signedUrl: null,
        url: null
      }));

      // Links escolares e institucionais apontam para um arquivo canônico.
      // Uma busca por ID não precisa ler e descriptografar todo o prontuário
      // legado quando a linha já existe em patient_files.
      if (requestedFileId && withUrls.length > 0) {
        return res.json({ success: true, data: withUrls });
      }

      const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
      const rawFallbackFiles = Array.isArray(fallbackPayload?.payload?.files)
        ? fallbackPayload.payload.files
        : [];
      const fallbackFiles = await buildPatientFilesFromPayload(
        patientId,
        requestedFileId
          ? rawFallbackFiles.filter((row: any) => sanitizeString(row?.id, 120) === requestedFileId)
          : rawFallbackFiles
      );

      const merged = new Map<string, any>();
      const canonicalKeys = new Set(rawCanonicalRows.flatMap((row: any) => [
        sanitizeString(row?.id, 120),
        sanitizeString(row?.storage_path, 500)
      ]).filter(Boolean));
      const visibleFallbackFiles = (isPatientPortal ? fallbackFiles.filter(isPatientFileVisibleToPortal) : fallbackFiles)
        .filter((row: any) => {
          const fallbackId = sanitizeString(row?.id, 120);
          const fallbackPath = sanitizeString(row?.path, 500);
          return (!fallbackId || !canonicalKeys.has(fallbackId)) && (!fallbackPath || !canonicalKeys.has(fallbackPath));
        });
      [...withUrls, ...visibleFallbackFiles].forEach((row: any) => {
        const key = sanitizeString(row?.id, 120) || sanitizeString(row?.path, 500);
        if (!key || merged.has(key)) return;
        merged.set(key, row);
      });

      return res.json({
        success: true,
        data: Array.from(merged.values()),
        ...(storageUsage ? { storageUsage } : {})
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patient-files/:patientId [GET]', error, {
        patientId: sanitizeString(req.resolvedPatientId || req.params.patientId, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        requestId: requestIdForLogs(req)
      });
    }
  };
}

export function createPatientNotesReadHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; isUuid: any; parseBoundedListLimit: any; requestIdForLogs: any; fetchNotesWithRoleFilter: any; filterNotesForActor: any; crypto: any; currentClinicId: any; supabase: any; loadClinicalNoteMentionUserIdsByNote: any; sendRouteDbError: any }) {
  return async (req, res) => {
    const { sanitizeString, isUuid, parseBoundedListLimit, requestIdForLogs, fetchNotesWithRoleFilter, filterNotesForActor, crypto, currentClinicId, supabase, loadClinicalNoteMentionUserIdsByNote, sendRouteDbError } = getDeps();
    try {
      const patientId = sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const role = sanitizeString((req as any).session?.user?.role, 40).toLowerCase();
      const limit = parseBoundedListLimit((req as any).query?.limit, 20, 50);
      const requestId = requestIdForLogs(req);

      const notesByIdResult = await fetchNotesWithRoleFilter({
        patientId,
        role,
        limit,
        requestId
      });
      const notesById = notesByIdResult.data;
      const notesByIdError = notesByIdResult.error;
      if (notesByIdError) throw notesByIdError;

      const merged = filterNotesForActor(Array.isArray(notesById) ? notesById : [], req, role);
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
        .slice(0, limit);

      const clinicId = sanitizeString(currentClinicId((req as any).session?.user), 120);
      const conventionalNotes = deduped.filter((item: any) => (
        sanitizeString(item?.source, 80).toLowerCase() === 'conventional_session' &&
        isUuid(sanitizeString(item?.appointment_id || item?.appointmentId, 120))
      ));
      const appointmentIds = Array.from(new Set(
        conventionalNotes
          .map((item: any) => sanitizeString(item?.appointment_id || item?.appointmentId, 120))
          .filter(isUuid),
      ));
      const appointmentById = new Map<string, any>();
      const userNameById = new Map<string, string>();

      if (appointmentIds.length > 0 && isUuid(clinicId)) {
        const appointmentResult = await supabase
          .from('appointments')
          .select('id,organization_id,clinic_id,patient_id,scheduled_at,scheduled_start_at,actual_start_at,actual_end_at,actual_duration_minutes,service_type,therapist_id,therapist_name')
          .eq('patient_id', patientId)
          .or(`organization_id.eq.${clinicId},clinic_id.eq.${clinicId}`)
          .in('id', appointmentIds)
          .limit(Math.min(appointmentIds.length, 50));
        if (appointmentResult.error) throw appointmentResult.error;
        (appointmentResult.data || []).forEach((appointment: any) => {
          appointmentById.set(String(appointment?.id || ''), appointment);
        });

        const userIds = Array.from(new Set(
          conventionalNotes.flatMap((item: any) => {
            const appointment = appointmentById.get(String(item?.appointment_id || item?.appointmentId || ''));
            return [
              item?.therapist_id,
              item?.therapistId,
              item?.created_by,
              item?.createdBy,
              item?.original_author_id,
              item?.originalAuthorId,
              appointment?.therapist_id,
            ];
          }).map((value: any) => sanitizeString(value, 120)).filter(isUuid),
        ));
        if (userIds.length > 0) {
          const usersResult = await supabase
            .from('users')
            .select('id,name')
            .eq('clinic_id', clinicId)
            .in('id', userIds)
            .limit(Math.min(userIds.length, 100));
          if (usersResult.error) throw usersResult.error;
          (usersResult.data || []).forEach((userRow: any) => {
            const id = sanitizeString(userRow?.id, 120);
            const name = sanitizeString(userRow?.name, 180);
            if (id && name) userNameById.set(id, name);
          });
        }
      }

      const mentionUserIdsByNote = await loadClinicalNoteMentionUserIdsByNote(
        deduped.map((item: any) => sanitizeString(item?.id, 120)).filter(isUuid),
      );
      const hydrated = deduped.map((item: any) => {
        const source = sanitizeString(item?.source, 80).toLowerCase();
        if (source !== 'conventional_session') {
          return {
            ...item,
            mention_user_ids: mentionUserIdsByNote.get(String(item?.id || '')) || [],
          };
        }
        const appointmentId = sanitizeString(item?.appointment_id || item?.appointmentId, 120);
        const appointment = appointmentById.get(appointmentId) || null;
        const therapistId = sanitizeString(
          item?.therapist_id || item?.therapistId || appointment?.therapist_id,
          120,
        );
        const authorId = sanitizeString(
          item?.created_by || item?.createdBy || item?.original_author_id || item?.originalAuthorId,
          120,
        );
        const actualStartAt = appointment?.actual_start_at ? new Date(appointment.actual_start_at).getTime() : Number.NaN;
        const actualEndAt = appointment?.actual_end_at ? new Date(appointment.actual_end_at).getTime() : Number.NaN;
        const derivedDurationMinutes = Number.isFinite(actualStartAt) && Number.isFinite(actualEndAt) && actualEndAt >= actualStartAt
          ? Math.round((actualEndAt - actualStartAt) / 60000)
          : null;
        return {
          ...item,
          appointment_id: appointmentId || item?.appointment_id || null,
          appointment_date_time: appointment?.scheduled_start_at || appointment?.scheduled_at || null,
          appointment_scheduled_at: appointment?.scheduled_start_at || appointment?.scheduled_at || null,
          actual_duration_minutes: Number(appointment?.actual_duration_minutes) || derivedDurationMinutes || null,
          service_type: sanitizeString(appointment?.service_type, 180) || null,
          therapist_id: therapistId || null,
          therapist_name: userNameById.get(therapistId) || sanitizeString(appointment?.therapist_name, 180) || null,
          author_id: authorId || null,
          author_name: userNameById.get(authorId) || null,
          mention_user_ids: mentionUserIdsByNote.get(String(item?.id || '')) || [],
        };
      });
      res.json({ success: true, data: hydrated });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/notes/:patientId [GET]', error, {
        patientId: sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120),
        userId: sanitizeString((req as any).session?.user?.id, 120),
        limit: parseBoundedListLimit((req as any).query?.limit, 20, 50),
        requestId: requestIdForLogs(req)
      });
    }
  };
}
