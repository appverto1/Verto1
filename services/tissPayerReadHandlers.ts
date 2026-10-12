// GET /api/admin/tiss/provider-profile
export function createTissProviderProfileReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, payerSafeError, fetchTissPreGuideProfile, CLINIC_TISS_PROFILE_SELECT, sendNoStoreJson } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const data = await fetchTissPreGuideProfile('clinic_tiss_profiles', CLINIC_TISS_PROFILE_SELECT, organizationId);
      return sendNoStoreJson(res, { success: true, data });
    } catch (error: any) {
      console.warn('[TissPreGuide] provider profile read failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/admin/tiss/payer-profiles/:payerId
export function createTissPayerProfileReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, payerSafeError, fetchTissPreGuideProfile, PAYER_TISS_PROFILE_SELECT, fetchPayerForAdmin, sendNoStoreJson } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const payerId = sanitizeString(req.params.payerId, 120);
      if (!isUuid(organizationId) || !isUuid(payerId)) return res.status(400).json(payerSafeError(400));
      if (!(await fetchPayerForAdmin(payerId, organizationId))) return res.status(404).json(payerSafeError(404));
      const data = await fetchTissPreGuideProfile('payer_tiss_profiles', PAYER_TISS_PROFILE_SELECT, organizationId, 'payer_id', payerId);
      return sendNoStoreJson(res, { success: true, data });
    } catch (error: any) {
      console.warn('[TissPreGuide] payer profile read failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/patients/tiss-authorizations
export function createPatientTissAuthorizationsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, sanitizeTextField, isUuid, supabase, payerSafeError, PATIENT_PAYER_AUTHORIZATION_SELECT, canAccessPatientBillingInCurrentClinic, fetchPayerForAdmin, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, hydratePatientPayerAuthorizations } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const patientId = sanitizeString(req.query?.patientId ?? req.query?.patient_id, 120);
      const payerId = sanitizeString(req.query?.payerId ?? req.query?.payer_id, 120);
      const rawLimit = Number(req.query?.limit || 500);
      const limit = Math.min(1000, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 500));
      let query = supabase
        .from('patient_payer_authorizations')
        .select(PATIENT_PAYER_AUTHORIZATION_SELECT)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (patientId) {
        if (!isUuid(patientId) || !(await canAccessPatientBillingInCurrentClinic(patientId, req.session.user))) {
          return res.status(404).json(payerSafeError(404));
        }
        query = query.eq('patient_id', patientId);
      }
      if (payerId) {
        if (!isUuid(payerId) || !(await fetchPayerForAdmin(payerId, organizationId))) {
          return res.status(404).json(payerSafeError(404));
        }
        query = query.eq('payer_id', payerId);
      }
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) return sendNoStoreJson(res, { success: true, data: [] });
        throw error;
      }
      const rows = Array.isArray(data) ? data : [];
      return sendNoStoreJson(res, {
        success: true,
        data: await hydratePatientPayerAuthorizations(organizationId, rows, { includePatients: true })
      });
    } catch (error: any) {
      console.warn('[TissPreGuide] patient authorization overview failed:', {
        code: sanitizeString(error?.code, 40) || null,
        message: sanitizeTextField(error?.message, 300) || String(error)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível carregar as autorizações TISS dos pacientes.', code: 'AUTHORIZATION_OVERVIEW_FAILED' });
    }

  };
}

// GET /api/patients/:patientId/tiss-authorizations
export function createPatientTissAuthorizationReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, sanitizeTextField, isUuid, supabase, payerSafeError, PATIENT_PAYER_AUTHORIZATION_SELECT, canAccessPatientBillingInCurrentClinic, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, hydratePatientPayerAuthorizations } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const patientId = sanitizeString(req.params.patientId, 120);
      if (!isUuid(organizationId) || !isUuid(patientId)) return res.status(400).json(payerSafeError(400));
      if (!(await canAccessPatientBillingInCurrentClinic(patientId, req.session.user))) {
        return res.status(404).json(payerSafeError(404));
      }
      const { data, error } = await supabase
        .from('patient_payer_authorizations')
        .select(PATIENT_PAYER_AUTHORIZATION_SELECT)
        .eq('organization_id', organizationId)
        .eq('patient_id', patientId)
        .order('updated_at', { ascending: false })
        .limit(120);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) return sendNoStoreJson(res, { success: true, data: [] });
        throw error;
      }
      const rows = Array.isArray(data) ? data : [];
      return sendNoStoreJson(res, {
        success: true,
        data: await hydratePatientPayerAuthorizations(organizationId, rows)
      });
    } catch (error: any) {
      console.warn('[TissPreGuide] patient authorization list failed:', {
        patientId: sanitizeString(req.params.patientId, 120) || null,
        code: sanitizeString(error?.code, 40) || null,
        message: sanitizeTextField(error?.message, 300) || String(error)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível carregar as autorizações TISS do paciente.', code: 'AUTHORIZATION_LIST_FAILED' });
    }

  };
}

// GET /api/tiss/professional-profile/me
export function createTissOwnProfessionalProfileReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, payerSafeError, fetchTissPreGuideProfile, sendNoStoreJson, PROFESSIONAL_BILLING_PROFILE_SELECT } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const professionalId = sanitizeString(req.session.user?.id, 120);
      if (!isUuid(organizationId) || !isUuid(professionalId)) return res.status(400).json(payerSafeError(400));
      const data = await fetchTissPreGuideProfile(
        'professional_billing_profiles',
        PROFESSIONAL_BILLING_PROFILE_SELECT,
        organizationId,
        'professional_id',
        professionalId,
      );
      return sendNoStoreJson(res, { success: true, data });
    } catch (error: any) {
      console.warn('[TissPreGuide] own professional profile read failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/admin/tiss/professional-profiles
export function createTissProfessionalProfilesReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, PROFESSIONAL_BILLING_PROFILE_SELECT } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const { data, error } = await supabase
        .from('professional_billing_profiles')
        .select(PROFESSIONAL_BILLING_PROFILE_SELECT)
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .limit(1000);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [] });
        }
        throw error;
      }
      return sendNoStoreJson(res, { success: true, data: Array.isArray(data) ? data : [] });
    } catch (error: any) {
      console.warn('[TissPreGuide] professional profiles list failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/admin/tiss/professional-profiles/:professionalId
export function createTissProfessionalProfileReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, payerSafeError, fetchTissPreGuideProfile, sendNoStoreJson, PROFESSIONAL_BILLING_PROFILE_SELECT, assertProfessionalBillingProfileScope } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const professionalId = sanitizeString(req.params.professionalId, 120);
      if (!isUuid(organizationId) || !isUuid(professionalId)) return res.status(400).json(payerSafeError(400));
      const owner = await assertProfessionalBillingProfileScope(organizationId, professionalId);
      if (!owner) return res.status(404).json(payerSafeError(404));
      const data = await fetchTissPreGuideProfile('professional_billing_profiles', PROFESSIONAL_BILLING_PROFILE_SELECT, organizationId, 'professional_id', professionalId);
      return sendNoStoreJson(res, { success: true, data });
    } catch (error: any) {
      console.warn('[TissPreGuide] professional profile read failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/tiss/pre-guides
export function createTissPreGuidesReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, tissPreGuideQuickFilterCodes, APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT, APPOINTMENT_TISS_PRE_GUIDE_LIST_BASE_SELECT, extractMissingColumnName, isOptionalTissPreGuideColumn, serializeTissPreGuide } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const page = Math.max(1, Math.round(Number(req.query?.page || 1) || 1));
      const pageSize = parseBoundedListLimit(req.query?.pageSize || req.query?.limit, 50, 200);
      const from = sanitizeString(req.query?.from, 80);
      const to = sanitizeString(req.query?.to, 80);
      const status = sanitizeString(req.query?.status, 40).toLowerCase();
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const patientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120);
      const professionalId = sanitizeString(req.query?.professionalId || req.query?.professional_id, 120);
      const quickFilter = sanitizeString(req.query?.quickFilter || req.query?.quick_filter, 80).toLowerCase();
      const applyFilters = (source: any, includeQuickFilter = true) => {
        let query = source.eq('organization_id', organizationId);
        if (from) query = query.gte('scheduled_start', from);
        if (to) query = query.lte('scheduled_start', to);
        if (['valid', 'pending_data', 'not_applicable', 'draft', 'cancelled'].includes(status)) query = query.eq('status', status);
        if (isUuid(payerId)) query = query.eq('payer_id', payerId);
        if (isUuid(patientId)) query = query.eq('patient_id', patientId);
        if (isUuid(professionalId)) query = query.eq('professional_id', professionalId);
        if (includeQuickFilter) {
          if (quickFilter === 'valid') query = query.eq('status', 'valid');
          if (quickFilter === 'pending') query = query.eq('status', 'pending_data');
          if (quickFilter === 'not_applicable') query = query.eq('status', 'not_applicable');
          const errorCodes = tissPreGuideQuickFilterCodes[quickFilter];
          if (errorCodes?.length) query = query.overlaps('validation_error_codes', errorCodes);
        }
        return query;
      };
      const offset = (page - 1) * pageSize;
      const buildListQuery = (selectColumns: string) => applyFilters(
        supabase
          .from('appointment_tiss_pre_guides')
          .select(selectColumns, { count: 'exact' })
      )
        .order('scheduled_start', { ascending: false })
        .range(offset, offset + pageSize - 1);
      const kpiQuery = applyFilters(
        supabase
          .from('appointment_tiss_pre_guides')
          .select('status,validation_error_codes'),
        false
      ).limit(5000);
      let listResult = await buildListQuery(APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT);
      if (listResult.error && isOptionalTissPreGuideColumn(extractMissingColumnName(listResult.error))) {
        listResult = await buildListQuery(APPOINTMENT_TISS_PRE_GUIDE_LIST_BASE_SELECT);
      }
      const kpiResult = await kpiQuery;
      if (listResult.error) {
        if (hasMissingFinancialSchema(listResult.error) || isMissingRelationError(listResult.error)) {
          return sendNoStoreJson(res, { success: true, data: [], page, pageSize, total: 0, kpis: {} });
        }
        throw listResult.error;
      }
      if (kpiResult.error && !hasMissingFinancialSchema(kpiResult.error) && !isMissingRelationError(kpiResult.error)) throw kpiResult.error;
      const kpiRows = Array.isArray(kpiResult.data) ? kpiResult.data : [];
      const countCodes = (codes: string[]) => kpiRows.filter((row: any) =>
        Array.isArray(row?.validation_error_codes) && row.validation_error_codes.some((code: string) => codes.includes(code))
      ).length;
      const kpis = {
        total: kpiRows.length,
        valid: kpiRows.filter((row: any) => row?.status === 'valid').length,
        pending: kpiRows.filter((row: any) => row?.status === 'pending_data').length,
        notApplicable: kpiRows.filter((row: any) => row?.status === 'not_applicable').length,
        missingProvider: countCodes(tissPreGuideQuickFilterCodes.missing_provider),
        missingPayerProfile: countCodes(tissPreGuideQuickFilterCodes.missing_payer_profile),
        missingProfessionalRegistry: countCodes(tissPreGuideQuickFilterCodes.missing_professional_registry),
        missingCbo: countCodes(tissPreGuideQuickFilterCodes.missing_cbo),
        missingTuss: countCodes(tissPreGuideQuickFilterCodes.missing_tuss),
        missingAuthorization: countCodes(tissPreGuideQuickFilterCodes.missing_authorization),
        authorizationExpired: countCodes(tissPreGuideQuickFilterCodes.authorization_expired),
        missingCard: countCodes(tissPreGuideQuickFilterCodes.missing_card),
        missingGuideAuthorization: countCodes(tissPreGuideQuickFilterCodes.missing_guide_authorization),
    missingAmount: countCodes(tissPreGuideQuickFilterCodes.missing_amount)
      };
      return sendNoStoreJson(res, {
        success: true,
        data: (listResult.data || []).map(serializeTissPreGuide),
        page,
        pageSize,
        total: Number(listResult.count || 0),
        kpis
      });
    } catch (error: any) {
      console.warn('[TissPreGuide] list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar as Pré-guias TISS agora.' });
    }

  };
}

// GET /api/tiss/official-documents
export function createTissOfficialDocumentsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, sanitizeTextField, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, TISS_OFFICIAL_DOCUMENT_SELECT, TISS_OFFICIAL_DOCUMENT_TRACKING_SELECT, serializeTissOfficialDocument, serializeTissOfficialTracking, normalizeNonNegativeCents, normalizeTissXmlCompetenceMonth } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const page = Math.max(1, Math.round(Number(req.query?.page || 1) || 1));
      const pageSize = parseBoundedListLimit(req.query?.pageSize || req.query?.limit, 20, 100);
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const competenceMonth = normalizeTissXmlCompetenceMonth(req.query?.competenceMonth || req.query?.competence_month);
      let query = supabase
        .from('tiss_official_documents')
        .select(TISS_OFFICIAL_DOCUMENT_SELECT, { count: 'exact' })
        .eq('organization_id', organizationId);
      if (isUuid(payerId)) query = query.eq('payer_id', payerId);
      if (competenceMonth) query = query.eq('competence_month', competenceMonth);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query
        .order('generated_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return res.status(503).json({
            success: false,
            code: 'TISS_OFFICIAL_SCHEMA_MISSING',
            error: 'A estrutura de documentos TISS oficiais ainda não está disponível no banco.'
          });
        }
        throw error;
      }
      const documentRows = data || [];
      let trackingByDocumentId = new Map<string, any>();
      const documentIds = documentRows.map((row: any) => sanitizeString(row?.id, 120)).filter((id: string) => isUuid(id));
      if (documentIds.length > 0) {
        const trackingResult = await supabase
          .from('tiss_official_document_tracking')
          .select(TISS_OFFICIAL_DOCUMENT_TRACKING_SELECT)
          .eq('organization_id', organizationId)
          .in('official_document_id', documentIds);
        if (!trackingResult.error && Array.isArray(trackingResult.data)) {
          trackingByDocumentId = new Map(
            trackingResult.data.map((row: any) => [sanitizeString(row?.official_document_id, 120), row])
          );
        } else if (trackingResult.error && !hasMissingFinancialSchema(trackingResult.error) && !isMissingRelationError(trackingResult.error)) {
          throw trackingResult.error;
        }
      }
      return sendNoStoreJson(res, {
        success: true,
        data: documentRows.map((row: any) => ({
          ...serializeTissOfficialDocument(row),
          tracking: serializeTissOfficialTracking(trackingByDocumentId.get(sanitizeString(row?.id, 120))) || {
            officialDocumentId: sanitizeString(row?.id, 120) || null,
            status: 'generated',
            totalSentAmountCents: normalizeNonNegativeCents(row?.total_amount_cents),
            totalPaidAmountCents: 0,
            totalGlossedAmountCents: 0,
            totalPendingAmountCents: normalizeNonNegativeCents(row?.total_amount_cents)
          }
        })),
        page,
        pageSize,
        total: Number(count || 0)
      });
    } catch (error: any) {
      console.warn('[TissOfficial] list failed:', {
        code: sanitizeString(error?.code, 80) || null,
        message: sanitizeTextField(error?.message, 300) || String(error)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível carregar os documentos TISS oficiais agora.' });
    }

  };
}

// GET /api/tiss/official-documents/tracking
export function createTissDocumentTrackingListReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, TISS_OFFICIAL_DOCUMENT_TRACKING_SELECT, OFFICIAL_XML_TRACKING_STATUSES, serializeTissOfficialTracking } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const page = Math.max(1, Math.round(Number(req.query?.page || 1) || 1));
      const pageSize = parseBoundedListLimit(req.query?.pageSize || req.query?.limit, 20, 100);
      const status = sanitizeString(req.query?.status, 80);
      let query = supabase
        .from('tiss_official_document_tracking')
        .select(TISS_OFFICIAL_DOCUMENT_TRACKING_SELECT, { count: 'exact' })
        .eq('organization_id', organizationId);
      if (OFFICIAL_XML_TRACKING_STATUSES.has(status)) query = query.eq('status', status);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query
        .order('updated_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [], page, pageSize, total: 0 });
        }
        throw error;
      }
      return sendNoStoreJson(res, {
        success: true,
        data: (data || []).map(serializeTissOfficialTracking).filter(Boolean),
        page,
        pageSize,
        total: Number(count || 0)
      });
    } catch (error: any) {
      console.warn('[TissOfficialTracking] list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar o acompanhamento dos lotes XML agora.' });
    }

  };
}

// GET /api/tiss/xml-drafts
export function createTissXmlDraftsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, TISS_XML_DRAFT_SELECT, normalizeTissXmlCompetenceMonth, serializeTissXmlDraft } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const page = Math.max(1, Math.round(Number(req.query?.page || 1) || 1));
      const pageSize = parseBoundedListLimit(req.query?.pageSize || req.query?.limit, 20, 100);
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const competenceMonth = normalizeTissXmlCompetenceMonth(req.query?.competenceMonth || req.query?.competence_month);
      let query = supabase
        .from('tiss_xml_drafts')
        .select(TISS_XML_DRAFT_SELECT, { count: 'exact' })
        .eq('organization_id', organizationId);
      if (isUuid(payerId)) query = query.eq('payer_id', payerId);
      if (competenceMonth) query = query.eq('competence_month', competenceMonth);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query
        .order('generated_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [], page, pageSize, total: 0 });
        }
        throw error;
      }
      return sendNoStoreJson(res, {
        success: true,
        data: (data || []).map((row: any) => serializeTissXmlDraft(row)),
        page,
        pageSize,
        total: Number(count || 0)
      });
    } catch (error: any) {
      console.warn('[TissXmlDraft] list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar os rascunhos XML TISS agora.' });
    }

  };
}

// GET /api/tiss/xml-drafts/:draftId
export function createTissXmlDraftReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, TISS_XML_DRAFT_DETAIL_SELECT, serializeTissXmlDraft } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const draftId = sanitizeString(req.params.draftId, 120);
      if (!isUuid(organizationId) || !isUuid(draftId)) return res.status(400).json(payerSafeError(400));
      const { data, error } = await supabase
        .from('tiss_xml_drafts')
        .select(TISS_XML_DRAFT_DETAIL_SELECT)
        .eq('organization_id', organizationId)
        .eq('id', draftId)
        .maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) return res.status(404).json(payerSafeError(404));
        throw error;
      }
      if (!data) return res.status(404).json(payerSafeError(404));
      return sendNoStoreJson(res, { success: true, data: serializeTissXmlDraft(data, true) });
    } catch (error: any) {
      console.warn('[TissXmlDraft] detail failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar o rascunho XML TISS agora.' });
    }

  };
}

// GET /api/tiss/revenue-cycle/events
export function createTissRevenueEventsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, TISS_REVENUE_CYCLE_EVENT_SELECT, serializeTissRevenueCycleEvent } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const preGuideId = sanitizeString(req.query?.preGuideId || req.query?.pre_guide_id, 120);
      const appointmentId = sanitizeString(req.query?.appointmentId || req.query?.appointment_id, 120);
      const xmlDraftId = sanitizeString(req.query?.xmlDraftId || req.query?.xml_draft_id, 120);
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const limit = parseBoundedListLimit(req.query?.limit, 40, 100);
      let query = supabase
        .from('tiss_revenue_cycle_events')
        .select(TISS_REVENUE_CYCLE_EVENT_SELECT)
        .eq('organization_id', organizationId);
      if (isUuid(preGuideId)) query = query.eq('pre_guide_id', preGuideId);
      if (isUuid(appointmentId)) query = query.eq('appointment_id', appointmentId);
      if (isUuid(xmlDraftId)) query = query.eq('xml_draft_id', xmlDraftId);
      if (isUuid(payerId)) query = query.eq('payer_id', payerId);
      const { data, error } = await query
        .order('performed_at', { ascending: false })
        .limit(limit);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [] });
        }
        throw error;
      }
      return sendNoStoreJson(res, {
        success: true,
        data: (data || []).map(serializeTissRevenueCycleEvent)
      });
    } catch (error: any) {
      console.warn('[TissRevenueCycle] events list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar o histórico do ciclo TISS agora.' });
    }

  };
}

// GET /api/tiss/billing-batch-drafts
export function createTissBillingBatchDraftsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, TISS_BILLING_BATCH_DRAFT_SELECT, normalizeTissXmlCompetenceMonth, serializeTissBillingBatchDraft } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const page = Math.max(1, Math.round(Number(req.query?.page || 1) || 1));
      const pageSize = parseBoundedListLimit(req.query?.pageSize || req.query?.limit, 20, 100);
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const competenceMonth = normalizeTissXmlCompetenceMonth(req.query?.competenceMonth || req.query?.competence_month);
      const status = sanitizeString(req.query?.status, 40).toLowerCase();
      let query = supabase
        .from('tiss_billing_batch_drafts')
        .select(TISS_BILLING_BATCH_DRAFT_SELECT, { count: 'exact' })
        .eq('organization_id', organizationId);
      if (isUuid(payerId)) query = query.eq('payer_id', payerId);
      if (competenceMonth) query = query.eq('competence_month', competenceMonth);
      if (['draft', 'validated', 'cancelled', 'superseded'].includes(status)) query = query.eq('status', status);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) {
          return sendNoStoreJson(res, { success: true, data: [], page, pageSize, total: 0 });
        }
        throw error;
      }
      return sendNoStoreJson(res, {
        success: true,
        data: (data || []).map(serializeTissBillingBatchDraft),
        page,
        pageSize,
        total: Number(count || 0)
      });
    } catch (error: any) {
      console.warn('[TissBillingBatchDraft] list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar os lotes rascunho TISS agora.' });
    }

  };
}

// GET /api/tiss/billing-batch-drafts/:batchId
export function createTissBillingBatchDraftReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, TISS_BILLING_BATCH_DRAFT_SELECT, serializeTissBillingBatchDraft } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const batchId = sanitizeString(req.params.batchId, 120);
      if (!isUuid(organizationId) || !isUuid(batchId)) return res.status(400).json(payerSafeError(400));
      const { data, error } = await supabase
        .from('tiss_billing_batch_drafts')
        .select(TISS_BILLING_BATCH_DRAFT_SELECT)
        .eq('organization_id', organizationId)
        .eq('id', batchId)
        .maybeSingle();
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) return res.status(404).json(payerSafeError(404));
        throw error;
      }
      if (!data) return res.status(404).json(payerSafeError(404));
      return sendNoStoreJson(res, { success: true, data: serializeTissBillingBatchDraft(data) });
    } catch (error: any) {
      console.warn('[TissBillingBatchDraft] detail failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar o lote rascunho TISS agora.' });
    }

  };
}

// GET /api/tiss/pre-guides/coverage
export function createTissPreGuidesCoverageReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, sanitizeTextField, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, parseBoundedListLimit, parseClosureDateRange, fetchClosurePeriodAppointmentRows, loadOrganizationRowsByAppointmentIds, APPOINTMENT_BILLING_CONTEXT_SELECT, mergeBillingContextMetadata, resolveTissPreGuideEligibilityContextsInBatch, evaluateTissPreGuideEligibility } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const range = parseClosureDateRange(req.query || {});
      if (!range.ok) return res.status(400).json({ success: false, error: 'Período inválido para verificar cobertura de Pré-guias TISS.' });
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      const patientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120);
      const professionalId = sanitizeString(req.query?.professionalId || req.query?.professional_id, 120);
      if ((payerId && !isUuid(payerId)) || (patientId && !isUuid(patientId)) || (professionalId && !isUuid(professionalId))) {
        return res.status(400).json({ success: false, error: 'Filtros inválidos para verificar cobertura de Pré-guias TISS.' });
      }

      const appointmentRows = await fetchClosurePeriodAppointmentRows({
        clinicId: organizationId,
        user: req.session.user,
        fromIso: range.fromIso,
        toIso: range.toIso,
        limit: parseBoundedListLimit(req.query?.limit, 500, 2000)
      });
      const scopedAppointments = appointmentRows.filter((appointment: any) => {
        if (patientId && sanitizeString(appointment?.patient_id, 120) !== patientId) return false;
        const rowProfessionalId = sanitizeString(appointment?.therapist_id || appointment?.professional_id, 120);
        if (professionalId && rowProfessionalId !== professionalId) return false;
        return true;
      });
      const appointmentIds = Array.from(new Set(
        scopedAppointments
          .map((appointment: any) => sanitizeString(appointment?.id, 120))
          .filter((appointmentId: string) => isUuid(appointmentId))
      ));

      const contextQuery = appointmentIds.length > 0
        ? loadOrganizationRowsByAppointmentIds({
            organizationId,
            appointmentIds,
            table: 'appointment_billing_contexts',
            selectColumns: APPOINTMENT_BILLING_CONTEXT_SELECT,
          })
        : Promise.resolve({ data: [], error: null } as any);

      const billingItemQuery = appointmentIds.length > 0
        ? loadOrganizationRowsByAppointmentIds({
            organizationId,
            appointmentIds,
            table: 'appointment_billing_items',
            selectColumns: 'id,appointment_id,service_catalog_id,tuss_code_id,amount_cents',
          })
        : Promise.resolve({ data: [], error: null } as any);

      let preGuideQuery = supabase
        .from('appointment_tiss_pre_guides')
        .select('appointment_id,status,stale_reason,validation_error_codes')
        .eq('organization_id', organizationId)
        .gte('scheduled_start', range.fromIso)
        .lte('scheduled_start', range.toIso);
      if (isUuid(payerId)) preGuideQuery = preGuideQuery.eq('payer_id', payerId);
      if (isUuid(patientId)) preGuideQuery = preGuideQuery.eq('patient_id', patientId);
      if (isUuid(professionalId)) preGuideQuery = preGuideQuery.eq('professional_id', professionalId);

      const [contextResult, billingItemResult, preGuideResult] = await Promise.all([
        contextQuery,
        billingItemQuery,
        preGuideQuery.limit(5000)
      ]);

      if (contextResult.error && !hasMissingFinancialSchema(contextResult.error) && !isMissingRelationError(contextResult.error)) throw contextResult.error;
      if (billingItemResult.error && !hasMissingFinancialSchema(billingItemResult.error) && !isMissingRelationError(billingItemResult.error)) throw billingItemResult.error;
      if (preGuideResult.error && !hasMissingFinancialSchema(preGuideResult.error) && !isMissingRelationError(preGuideResult.error)) throw preGuideResult.error;

      const contextsByAppointment = new Map<string, any>(
        (contextResult.error ? [] : contextResult.data || [])
          .map((row: any) => [sanitizeString(row?.appointment_id, 120), mergeBillingContextMetadata(row)])
      );
      const billingItemsByAppointment = new Map<string, any>(
        (billingItemResult.error ? [] : billingItemResult.data || [])
          .map((row: any) => [sanitizeString(row?.appointment_id, 120), row])
      );
      const preGuideRows = preGuideResult.error ? [] : Array.isArray(preGuideResult.data) ? preGuideResult.data : [];
      const preGuidesByAppointment = new Map<string, any>(
        preGuideRows
          .map((row: any) => [sanitizeString(row?.appointment_id, 120), row])
          .filter(([appointmentId]: any) => isUuid(appointmentId))
      );
      const eligibilityBatch = await resolveTissPreGuideEligibilityContextsInBatch({
        organizationId,
        appointments: scopedAppointments,
        contextsByAppointment
      });
      const effectiveContextsByAppointment = eligibilityBatch.contextsByAppointment;

      const coverage = {
        totalAppointmentsInPeriod: scopedAppointments.length,
        billableAppointments: 0,
        eligibleForPreGuide: 0,
        materializedPreGuides: preGuideRows.length,
        missingPreGuides: 0,
        stalePreGuides: preGuideRows.filter((row: any) => Boolean(sanitizeString(row?.stale_reason, 600))).length,
        validPreGuides: preGuideRows.filter((row: any) => row?.status === 'valid').length,
        pendingPreGuides: preGuideRows.filter((row: any) => row?.status === 'pending_data').length,
        notApplicablePreGuides: preGuideRows.filter((row: any) => row?.status === 'not_applicable').length,
        withResolvedTuss: 0,
        withoutBillingItem: 0,
        notBillableAppointments: 0,
        withoutFinancialContext: 0
      };

      for (const appointment of scopedAppointments) {
        const appointmentId = sanitizeString(appointment?.id, 120);
        const billingContext = effectiveContextsByAppointment.get(appointmentId) || contextsByAppointment.get(appointmentId) || {};
        const eligibility = evaluateTissPreGuideEligibility({ appointment, billingContext });
        if (eligibility.financialContext === 'INSURANCE') coverage.billableAppointments += 1;
        if (eligibility.reason === 'not_applicable') coverage.notBillableAppointments += 1;
        if (eligibility.reason === 'missing_financial_context') coverage.withoutFinancialContext += 1;
        const billingItem = billingItemsByAppointment.get(appointmentId);
        if (billingItem?.service_catalog_id && billingItem?.tuss_code_id) coverage.withResolvedTuss += 1;
        if (!billingItem?.id) coverage.withoutBillingItem += 1;
        if (!eligibility.eligible) continue;
        if (payerId && eligibility.payerId !== payerId) continue;
        coverage.eligibleForPreGuide += 1;
        if (!preGuidesByAppointment.has(appointmentId)) coverage.missingPreGuides += 1;
      }

      return sendNoStoreJson(res, {
        success: true,
        data: coverage,
        coverage
      });
    } catch (error: any) {
      console.warn('[TissPreGuide] coverage failed:', {
        code: sanitizeString(error?.code, 40) || null,
        message: sanitizeTextField(error?.message, 300) || String(error)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível verificar a cobertura das Pré-guias TISS agora.' });
    }

  };
}

// GET /api/tiss/pre-guides/:appointmentId
export function createTissPreGuideReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, isMissingRelationError, sendNoStoreJson, APPOINTMENT_TISS_PRE_GUIDE_SELECT, APPOINTMENT_TISS_PRE_GUIDE_BASE_SELECT, extractMissingColumnName, isOptionalTissPreGuideColumn, serializeTissPreGuide } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const appointmentId = sanitizeString(req.params.appointmentId, 120);
      if (!isUuid(organizationId) || !isUuid(appointmentId)) return res.status(400).json(payerSafeError(400));
      let detailResult = await supabase
        .from('appointment_tiss_pre_guides')
        .select(APPOINTMENT_TISS_PRE_GUIDE_SELECT)
        .eq('organization_id', organizationId)
        .eq('appointment_id', appointmentId)
        .limit(1)
        .maybeSingle();
      if (detailResult.error && isOptionalTissPreGuideColumn(extractMissingColumnName(detailResult.error))) {
        detailResult = await supabase
          .from('appointment_tiss_pre_guides')
          .select(APPOINTMENT_TISS_PRE_GUIDE_BASE_SELECT)
          .eq('organization_id', organizationId)
          .eq('appointment_id', appointmentId)
          .limit(1)
          .maybeSingle();
      }
      const { data, error } = detailResult;
      if (error) {
        if (hasMissingFinancialSchema(error) || isMissingRelationError(error)) return res.status(404).json(payerSafeError(404));
        throw error;
      }
      if (!data?.id) return res.status(404).json(payerSafeError(404));
      return sendNoStoreJson(res, { success: true, data: serializeTissPreGuide(data) });
    } catch (error: any) {
      console.warn('[TissPreGuide] detail failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/payer-options
export function createPayerOptionsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, hasMissingFinancialSchema, parseBoundedListLimit, normalizePayerType } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) {
        return res.status(400).json({ success: false, error: 'Clínica inválida.' });
      }
      const limit = parseBoundedListLimit(req.query?.limit, 80, 100);
      const { data, error } = await supabase
        .from('clinic_payers')
        .select('id,name,payer_type,status')
        .eq('organization_id', organizationId)
        .eq('payer_type', 'INSURANCE')
        .in('status', ['ACTIVE', 'active', 'Ativo', 'ativo'])
        .order('name', { ascending: true })
        .limit(limit);
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({
        success: true,
        data: (Array.isArray(data) ? data : []).map((payer: any) => ({
          id: sanitizeString(payer?.id, 120),
          name: sanitizeString(payer?.name, 180),
          payerType: normalizePayerType(payer?.payer_type),
          status: 'ACTIVE',
        })),
      });
    } catch (error: any) {
      console.warn('[PayerOptions] list failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível carregar os convênios da clínica.' });
    }

  };
}

// GET /api/admin/payers
export function createAdminPayersReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, isUuid, supabase, payerSafeError, hasMissingFinancialSchema, parseBoundedListLimit, CLINIC_PAYER_SELECT, serializePayer } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const limit = parseBoundedListLimit(req.query?.limit, 50, 100);
      let query = supabase
        .from('clinic_payers')
        .select(CLINIC_PAYER_SELECT)
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })
        .limit(limit);
      const status = sanitizeString(req.query?.status, 40).toUpperCase();
      if (status === 'ACTIVE') query = query.in('status', ['ACTIVE', 'active', 'Ativo', 'ativo']);
      if (status === 'INACTIVE') query = query.in('status', ['INACTIVE', 'inactive', 'Inativo', 'inativo']);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: (data || []).map(serializePayer) });
    } catch (error: any) {
      console.warn('[PayerRequirements] payer list failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}

// GET /api/admin/payers/:payerId/requirements
export function createAdminPayerRequirementsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, sanitizeString, supabase, payerSafeError, fetchPayerForAdmin, hasMissingFinancialSchema, serializePayer, CLINIC_PAYER_REQUIREMENT_SELECT, serializePayerRequirement } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const payerId = sanitizeString(req.params.payerId, 120);
      const payer = await fetchPayerForAdmin(payerId, organizationId);
      if (!payer) return res.status(404).json(payerSafeError(404));
      const { data, error } = await supabase
        .from('clinic_payer_requirements')
        .select(CLINIC_PAYER_REQUIREMENT_SELECT)
        .eq('organization_id', organizationId)
        .eq('payer_id', payerId)
        .order('service_type', { ascending: true })
        .limit(50);
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      return res.json({ success: true, data: (data || []).map(serializePayerRequirement), payer: serializePayer(payer) });
    } catch (error: any) {
      console.warn('[PayerRequirements] requirement list failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }

  };
}
