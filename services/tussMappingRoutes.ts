import type { Express } from 'express';

type TussMappingRouteDeps = {
  checkAuth: any;
  requireClinicModule: any;
  requireClinicCapability: any;
  portalActionLimiter: any;
  sanitizeString: any;
  currentClinicId: any;
  isUuid: any;
  payerSafeError: any;
  parseBoundedListLimit: any;
  supabase: any;
  PAYER_TUSS_MAPPING_SELECT: any;
  hasMissingFinancialSchema: any;
  TUSS_SERVICE_CATALOG_SELECT: any;
  TUSS_CODE_SELECT: any;
  serializePayerTussMapping: any;
  enforcePayloadLimit: any;
  normalizeTissCivilDate: any;
  guideTypes040300: any;
  tussValidityRangeIsValid: any;
  fetchPayerForAdmin: any;
  fetchTussServiceCatalogById: any;
  fetchTussCodeById: any;
  fetchPayerTussMappingById: any;
  tussConfigurationScopeIsConsistent: any;
  cleanObject: any;
  crypto: any;
  sanitizeTextField: any;
  normalizeTussBillingUnit: any;
  normalizeTussQuantityRule: any;
  mergePayerTussMappingCodeMetadata: any;
  isTussUniqueConflict: any;
  markTissPreGuidesStale: any;
  collectTissPipelineAffectedFutureAppointmentIds: any;
  runTissPipelineForAppointments: any;
  revalidateAppointmentBillingForAppointment: any;
};

export function registerTussMappingRoutes(app: Express, deps: TussMappingRouteDeps) {
  const {
    checkAuth,
    requireClinicModule,
    requireClinicCapability,
    portalActionLimiter,
    sanitizeString,
    currentClinicId,
    isUuid,
    payerSafeError,
    parseBoundedListLimit,
    supabase,
    PAYER_TUSS_MAPPING_SELECT,
    hasMissingFinancialSchema,
    TUSS_SERVICE_CATALOG_SELECT,
    TUSS_CODE_SELECT,
    serializePayerTussMapping,
    enforcePayloadLimit,
    normalizeTissCivilDate,
    guideTypes040300,
    tussValidityRangeIsValid,
    fetchPayerForAdmin,
    fetchTussServiceCatalogById,
    fetchTussCodeById,
    fetchPayerTussMappingById,
    tussConfigurationScopeIsConsistent,
    cleanObject,
    crypto,
    sanitizeTextField,
    normalizeTussBillingUnit,
    normalizeTussQuantityRule,
    mergePayerTussMappingCodeMetadata,
    isTussUniqueConflict,
    markTissPreGuidesStale,
    collectTissPipelineAffectedFutureAppointmentIds,
    runTissPipelineForAppointments,
    revalidateAppointmentBillingForAppointment,
  } = deps;

  app.get('/api/admin/tuss/mappings', checkAuth, requireClinicModule('insurance_tiss'), requireClinicCapability('billing.mapping.manage'), async (req: any, res) => {
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!isUuid(organizationId)) return res.status(400).json(payerSafeError(400));
      const limit = parseBoundedListLimit(req.query?.limit, 120, 300);
      const payerId = sanitizeString(req.query?.payerId || req.query?.payer_id, 120);
      let query = supabase
        .from('payer_tuss_mappings')
        .select(PAYER_TUSS_MAPPING_SELECT)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (isUuid(payerId)) query = query.eq('payer_id', payerId);
      if (String(req.query?.active || '').toLowerCase() === 'true') query = query.eq('active', true);
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      const rows = Array.isArray(data) ? data : [];
      const serviceIds = Array.from(new Set(rows.map((row: any) => sanitizeString(row.service_catalog_id, 120)).filter((id: string) => isUuid(id))));
      const codeIds = Array.from(new Set(rows.map((row: any) => sanitizeString(row.tuss_code_id, 120)).filter((id: string) => isUuid(id))));
      const [servicesResult, codesResult] = await Promise.all([
        serviceIds.length > 0
          ? supabase.from('tuss_service_catalog').select(TUSS_SERVICE_CATALOG_SELECT).eq('organization_id', organizationId).in('id', serviceIds).limit(serviceIds.length)
          : Promise.resolve({ data: [], error: null } as any),
        codeIds.length > 0
          ? supabase.from('tuss_codes').select(TUSS_CODE_SELECT).eq('organization_id', organizationId).in('id', codeIds).limit(codeIds.length)
          : Promise.resolve({ data: [], error: null } as any)
      ]);
      if (servicesResult.error && !hasMissingFinancialSchema(servicesResult.error)) throw servicesResult.error;
      if (codesResult.error && !hasMissingFinancialSchema(codesResult.error)) throw codesResult.error;
      const servicesById = new Map<string, any>((servicesResult.error ? [] : servicesResult.data || []).map((row: any) => [sanitizeString(row.id, 120), row]));
      const codesById = new Map<string, any>((codesResult.error ? [] : codesResult.data || []).map((row: any) => [sanitizeString(row.id, 120), row]));
      return res.json({ success: true, data: rows.map((row: any) => serializePayerTussMapping(row, servicesById.get(sanitizeString(row.service_catalog_id, 120)), codesById.get(sanitizeString(row.tuss_code_id, 120)))) });
    } catch (error: any) {
      console.warn('[TussReady] mapping list failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }
  });

  app.post('/api/admin/tuss/mappings', portalActionLimiter, checkAuth, requireClinicModule('insurance_tiss'), requireClinicCapability('billing.mapping.manage'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de mapeamento TUSS-ready')) return;
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const payerId = sanitizeString(req.body?.payerId || req.body?.payer_id, 120);
      const serviceCatalogId = sanitizeString(req.body?.serviceCatalogId || req.body?.service_catalog_id, 120);
      const tussCodeId = sanitizeString(req.body?.tussCodeId || req.body?.tuss_code_id, 120);
      if (!isUuid(organizationId) || !isUuid(payerId) || !isUuid(serviceCatalogId) || (tussCodeId && !isUuid(tussCodeId))) return res.status(400).json(payerSafeError(400));
      const rawValidFrom = sanitizeString(req.body?.validFrom ?? req.body?.valid_from, 20);
      const rawValidTo = sanitizeString(req.body?.validTo ?? req.body?.valid_to, 20);
      const validFrom = normalizeTissCivilDate(rawValidFrom) || null;
      const validTo = normalizeTissCivilDate(rawValidTo) || null;
      const active = req.body?.active !== false;
      const supportedGuideTypes = new Set(guideTypes040300.map((item: any) => item.code));
      const guideType = sanitizeString(req.body?.guideType || req.body?.guide_type || 'sp_sadt', 40).toLowerCase();
      if (!supportedGuideTypes.has(guideType)) {
        return res.status(422).json({
          success: false,
          code: 'TUSS_MAPPING_GUIDE_TYPE_UNSUPPORTED',
          error: 'Selecione um tipo de guia suportado pelo XML TISS oficial da Verto.'
        });
      }
      if (!tussValidityRangeIsValid(rawValidFrom, rawValidTo)) {
        return res.status(400).json({ success: false, error: 'Revise a vigência do mapeamento.', code: 'INVALID_TUSS_MAPPING_CONFIGURATION' });
      }
      if (active && !validFrom) {
        return res.status(422).json({
          success: false,
          code: 'TUSS_MAPPING_VALID_FROM_REQUIRED',
          error: 'Informe a vigência inicial obrigatória do De/Para no formato AAAA-MM-DD.'
        });
      }
      const [payer, service, code] = await Promise.all([
        fetchPayerForAdmin(payerId, organizationId),
        fetchTussServiceCatalogById(organizationId, serviceCatalogId),
        tussCodeId ? fetchTussCodeById(organizationId, tussCodeId) : Promise.resolve(null)
      ]);
      if (!payer?.id || !service?.id || (tussCodeId && !code?.id)) return res.status(404).json(payerSafeError(404));
      if (!tussConfigurationScopeIsConsistent({ payerId, service, code, active })) {
        return res.status(409).json({ success: false, error: 'Procedimento ou código TUSS inativo/incompatível com esta clínica.', code: 'TUSS_CONFIGURATION_INCONSISTENT' });
      }
      const now = new Date().toISOString();
      const userId = sanitizeString(req.session.user?.id, 120);
      const payload = cleanObject({
        id: isUuid(sanitizeString(req.body?.id, 120)) ? sanitizeString(req.body?.id, 120) : crypto.randomUUID(),
        organization_id: organizationId,
        payer_id: payerId,
        service_catalog_id: serviceCatalogId,
        tuss_code_id: tussCodeId || null,
        contract_code: sanitizeString(req.body?.contractCode || req.body?.contract_code, 120) || null,
        contract_description: sanitizeTextField(req.body?.contractDescription || req.body?.contract_description, 600) || null,
        payer_specific_description: sanitizeTextField(req.body?.payerSpecificDescription || req.body?.payer_specific_description || req.body?.contractDescription || req.body?.contract_description, 600) || null,
        specialty: sanitizeString(req.body?.specialty || req.body?.especialidade || service.specialty, 120) || null,
        guide_type: guideType,
        billing_unit: normalizeTussBillingUnit(req.body?.billingUnit || req.body?.billing_unit || service.billing_unit),
        quantity_rule: normalizeTussQuantityRule(req.body?.quantityRule || req.body?.quantity_rule),
        default_quantity: Math.max(0.01, Number(req.body?.defaultQuantity || req.body?.default_quantity || 1) || 1),
        amount_cents: null,
        negotiated_amount_cents: null,
        standard_duration_minutes: req.body?.standardDurationMinutes || req.body?.standard_duration_minutes ? Math.max(1, Math.round(Number(req.body?.standardDurationMinutes || req.body?.standard_duration_minutes) || 0)) : null,
        requires_authorization: Boolean(req.body?.requiresAuthorization ?? req.body?.requires_authorization),
        requires_guide: Boolean(req.body?.requiresGuide ?? req.body?.requires_guide),
        requires_report: Boolean(req.body?.requiresReport ?? req.body?.requires_report),
        requires_signature: Boolean(req.body?.requiresSignature ?? req.body?.requires_signature),
        requires_professional_registry: Boolean(req.body?.requiresProfessionalRegistry ?? req.body?.requires_professional_registry),
        requires_patient_document: Boolean(req.body?.requiresPatientDocument ?? req.body?.requires_patient_document),
        use_actual_duration: Boolean(req.body?.useActualDuration ?? req.body?.use_actual_duration),
        active,
        valid_from: validFrom,
        valid_to: validTo,
        source: sanitizeString(req.body?.source || req.body?.fonte, 80) || 'manual',
        notes: sanitizeTextField(req.body?.notes || req.body?.observations || req.body?.observacoes, 1200) || null,
        metadata: mergePayerTussMappingCodeMetadata(req.body, {}),
        created_by: isUuid(userId) ? userId : null,
        updated_by: isUuid(userId) ? userId : null,
        created_at: now,
        updated_at: now
      });
      const insertResult = await supabase
        .from('payer_tuss_mappings')
        .insert([payload])
        .select(PAYER_TUSS_MAPPING_SELECT)
        .maybeSingle();
      let persistedData = insertResult.data;
      let persistenceError = insertResult.error;
      let idempotent = false;
      if (persistenceError && isTussUniqueConflict(persistenceError)) {
        const existing = await supabase
          .from('payer_tuss_mappings')
          .select(PAYER_TUSS_MAPPING_SELECT)
          .eq('organization_id', organizationId)
          .eq('payer_id', payerId)
          .eq('service_catalog_id', serviceCatalogId)
          .eq('active', true)
          .limit(1)
          .maybeSingle();
        if (!existing.error && existing.data?.id) {
          const existingPatch: Record<string, unknown> = cleanObject({
            ...payload,
            id: undefined,
            organization_id: undefined,
            payer_id: undefined,
            service_catalog_id: undefined,
            created_by: undefined,
            created_at: undefined,
            metadata: mergePayerTussMappingCodeMetadata(req.body, existing.data.metadata || {})
          });
          const updateResult = await supabase
            .from('payer_tuss_mappings')
            .update(existingPatch)
            .eq('organization_id', organizationId)
            .eq('payer_id', payerId)
            .eq('service_catalog_id', serviceCatalogId)
            .eq('id', existing.data.id)
            .select(PAYER_TUSS_MAPPING_SELECT)
            .maybeSingle();
          persistedData = updateResult.data;
          persistenceError = updateResult.error;
          idempotent = true;
        }
      }
      if (persistenceError) throw persistenceError;
      if (!persistedData?.id || persistedData.payer_id !== payerId || persistedData.service_catalog_id !== serviceCatalogId || persistedData.valid_from !== validFrom) {
        return res.status(409).json({
          success: false,
          code: 'TUSS_MAPPING_PERSISTENCE_MISMATCH',
          error: 'O banco não confirmou a vigência inicial enviada. O De/Para existente foi preservado; tente novamente.'
        });
      }
      await markTissPreGuidesStale({ organizationId, payerId, reason: 'De/Para TUSS do convênio alterado.' });
      const affectedAppointmentIds = await collectTissPipelineAffectedFutureAppointmentIds({ organizationId, payerId });
      const pipelineResults = affectedAppointmentIds.length > 0
        ? await runTissPipelineForAppointments({
            appointmentIds: affectedAppointmentIds,
            user: req.session.user,
            reason: 'tuss_mapping_changed',
            mode: 'best_effort',
            revalidateAppointment: revalidateAppointmentBillingForAppointment,
            logger: console,
            concurrency: 4
          })
        : [];
      return res.status(idempotent ? 200 : 201).json({
        success: true,
        idempotent,
        data: serializePayerTussMapping(persistedData, service, code),
        tissPipeline: {
          reason: 'tuss_mapping_changed',
          attempted: pipelineResults.length,
          updated: pipelineResults.filter((item) => item.ok).length,
          errors: pipelineResults.filter((item) => !item.ok).length
        }
      });
    } catch (error: any) {
      console.warn('[TussReady] mapping create failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }
  });

  app.patch('/api/admin/tuss/mappings/:mappingId', portalActionLimiter, checkAuth, requireClinicModule('insurance_tiss'), requireClinicCapability('billing.mapping.manage'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de mapeamento TUSS-ready')) return;
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const mappingId = sanitizeString(req.params.mappingId, 120);
      if (!isUuid(organizationId) || !isUuid(mappingId)) return res.status(400).json(payerSafeError(400));
      const existing = await fetchPayerTussMappingById(organizationId, mappingId);
      if (!existing?.id) return res.status(404).json(payerSafeError(404));
      const serviceCatalogId = sanitizeString(req.body?.serviceCatalogId || req.body?.service_catalog_id || existing.service_catalog_id, 120);
      const tussCodeId = sanitizeString(req.body?.tussCodeId || req.body?.tuss_code_id || existing.tuss_code_id, 120);
      const validFromProvided = req.body?.validFrom !== undefined || req.body?.valid_from !== undefined;
      const validToProvided = req.body?.validTo !== undefined || req.body?.valid_to !== undefined;
      const rawValidFrom = validFromProvided ? sanitizeString(req.body?.validFrom ?? req.body?.valid_from, 20) : '';
      const rawValidTo = validToProvided ? sanitizeString(req.body?.validTo ?? req.body?.valid_to, 20) : '';
      const effectiveValidFrom = validFromProvided
        ? normalizeTissCivilDate(rawValidFrom) || null
        : existing.valid_from;
      const effectiveValidTo = validToProvided
        ? normalizeTissCivilDate(rawValidTo) || null
        : existing.valid_to;
      const effectiveActive = req.body?.active !== undefined ? Boolean(req.body.active) : existing.active !== false;
      const guideTypeProvided = req.body?.guideType !== undefined || req.body?.guide_type !== undefined;
      const supportedGuideTypes = new Set(guideTypes040300.map((item: any) => item.code));
      const guideType = guideTypeProvided ? sanitizeString(req.body?.guideType || req.body?.guide_type, 40).toLowerCase() : '';
      if (guideTypeProvided && !supportedGuideTypes.has(guideType)) {
        return res.status(422).json({
          success: false,
          code: 'TUSS_MAPPING_GUIDE_TYPE_UNSUPPORTED',
          error: 'Selecione um tipo de guia suportado pelo XML TISS oficial da Verto.'
        });
      }
      if ((validFromProvided && rawValidFrom && !normalizeTissCivilDate(rawValidFrom)) || (validToProvided && rawValidTo && !normalizeTissCivilDate(rawValidTo)) || !tussValidityRangeIsValid(effectiveValidFrom, effectiveValidTo)) {
        return res.status(400).json({ success: false, error: 'Revise a vigência do mapeamento.', code: 'INVALID_TUSS_MAPPING_CONFIGURATION' });
      }
      if (effectiveActive && !normalizeTissCivilDate(effectiveValidFrom)) {
        return res.status(422).json({
          success: false,
          code: 'TUSS_MAPPING_VALID_FROM_REQUIRED',
          error: 'Informe a vigência inicial obrigatória do De/Para no formato AAAA-MM-DD.'
        });
      }
      const [service, code] = await Promise.all([
        fetchTussServiceCatalogById(organizationId, serviceCatalogId),
        tussCodeId ? fetchTussCodeById(organizationId, tussCodeId) : Promise.resolve(null)
      ]);
      if (!service?.id || (tussCodeId && !code?.id)) return res.status(404).json(payerSafeError(404));
      if (!tussConfigurationScopeIsConsistent({ payerId: existing.payer_id, service, code, active: effectiveActive })) {
        return res.status(409).json({ success: false, error: 'Procedimento ou código TUSS inativo/incompatível com esta clínica.', code: 'TUSS_CONFIGURATION_INCONSISTENT' });
      }
      const patch = cleanObject({
        service_catalog_id: serviceCatalogId,
        tuss_code_id: tussCodeId || null,
        contract_code: req.body?.contractCode !== undefined || req.body?.contract_code !== undefined ? sanitizeString(req.body?.contractCode || req.body?.contract_code, 120) || null : undefined,
        contract_description: req.body?.contractDescription !== undefined || req.body?.contract_description !== undefined ? sanitizeTextField(req.body?.contractDescription || req.body?.contract_description, 600) || null : undefined,
        payer_specific_description: req.body?.payerSpecificDescription !== undefined || req.body?.payer_specific_description !== undefined || req.body?.contractDescription !== undefined || req.body?.contract_description !== undefined ? sanitizeTextField(req.body?.payerSpecificDescription || req.body?.payer_specific_description || req.body?.contractDescription || req.body?.contract_description, 600) || null : undefined,
        specialty: req.body?.specialty !== undefined ? sanitizeString(req.body?.specialty, 120) || null : undefined,
        guide_type: guideTypeProvided ? guideType : undefined,
        billing_unit: req.body?.billingUnit !== undefined || req.body?.billing_unit !== undefined ? normalizeTussBillingUnit(req.body?.billingUnit || req.body?.billing_unit) : undefined,
        quantity_rule: req.body?.quantityRule !== undefined || req.body?.quantity_rule !== undefined ? normalizeTussQuantityRule(req.body?.quantityRule || req.body?.quantity_rule) : undefined,
        default_quantity: req.body?.defaultQuantity !== undefined || req.body?.default_quantity !== undefined ? Math.max(0.01, Number(req.body?.defaultQuantity || req.body?.default_quantity || 1) || 1) : undefined,
        standard_duration_minutes: req.body?.standardDurationMinutes !== undefined || req.body?.standard_duration_minutes !== undefined ? Math.max(1, Math.round(Number(req.body?.standardDurationMinutes || req.body?.standard_duration_minutes) || 0)) : undefined,
        requires_authorization: req.body?.requiresAuthorization !== undefined || req.body?.requires_authorization !== undefined ? Boolean(req.body?.requiresAuthorization ?? req.body?.requires_authorization) : undefined,
        requires_guide: req.body?.requiresGuide !== undefined || req.body?.requires_guide !== undefined ? Boolean(req.body?.requiresGuide ?? req.body?.requires_guide) : undefined,
        requires_report: req.body?.requiresReport !== undefined || req.body?.requires_report !== undefined ? Boolean(req.body?.requiresReport ?? req.body?.requires_report) : undefined,
        requires_signature: req.body?.requiresSignature !== undefined || req.body?.requires_signature !== undefined ? Boolean(req.body?.requiresSignature ?? req.body?.requires_signature) : undefined,
        requires_professional_registry: req.body?.requiresProfessionalRegistry !== undefined || req.body?.requires_professional_registry !== undefined ? Boolean(req.body?.requiresProfessionalRegistry ?? req.body?.requires_professional_registry) : undefined,
        requires_patient_document: req.body?.requiresPatientDocument !== undefined || req.body?.requires_patient_document !== undefined ? Boolean(req.body?.requiresPatientDocument ?? req.body?.requires_patient_document) : undefined,
        use_actual_duration: req.body?.useActualDuration !== undefined || req.body?.use_actual_duration !== undefined ? Boolean(req.body?.useActualDuration ?? req.body?.use_actual_duration) : undefined,
        active: req.body?.active !== undefined ? Boolean(req.body?.active) : undefined,
        valid_from: validFromProvided ? effectiveValidFrom : undefined,
        valid_to: validToProvided ? effectiveValidTo : undefined,
        source: req.body?.source !== undefined ? sanitizeString(req.body?.source, 80) || 'manual' : undefined,
        notes: req.body?.notes !== undefined ? sanitizeTextField(req.body?.notes, 1200) || null : undefined,
        metadata: (
          req.body?.metadata !== undefined ||
          req.body?.authorizedCode !== undefined ||
          req.body?.authorized_code !== undefined ||
          req.body?.authorizedCodeDescription !== undefined ||
          req.body?.authorized_code_description !== undefined ||
          req.body?.billingCode !== undefined ||
          req.body?.billing_code !== undefined ||
          req.body?.billingCodeDescription !== undefined ||
          req.body?.billing_code_description !== undefined ||
          req.body?.operatorPackageCode !== undefined ||
          req.body?.operator_package_code !== undefined ||
          req.body?.operatorPackageDescription !== undefined ||
          req.body?.operator_package_description !== undefined ||
          req.body?.billingCodeSource !== undefined ||
          req.body?.billing_code_source !== undefined
        ) ? mergePayerTussMappingCodeMetadata(req.body, existing.metadata || {}) : undefined,
        updated_by: isUuid(sanitizeString(req.session.user?.id, 120)) ? sanitizeString(req.session.user?.id, 120) : null,
        updated_at: new Date().toISOString()
      });
      const { data, error } = await supabase
        .from('payer_tuss_mappings')
        .update(patch)
        .eq('organization_id', organizationId)
        .eq('id', mappingId)
        .select(PAYER_TUSS_MAPPING_SELECT)
        .maybeSingle();
      if (error) throw error;
      if (!data?.id || data.id !== mappingId || data.service_catalog_id !== serviceCatalogId || data.valid_from !== effectiveValidFrom) {
        return res.status(409).json({
          success: false,
          code: 'TUSS_MAPPING_PERSISTENCE_MISMATCH',
          error: 'O banco não confirmou a vigência inicial enviada. O De/Para existente foi preservado; tente novamente.'
        });
      }
      await markTissPreGuidesStale({ organizationId, payerId: sanitizeString(existing.payer_id, 120), reason: 'De/Para TUSS do convênio alterado.' });
      const affectedAppointmentIds = await collectTissPipelineAffectedFutureAppointmentIds({
        organizationId,
        payerId: sanitizeString(existing.payer_id, 120)
      });
      const pipelineResults = affectedAppointmentIds.length > 0
        ? await runTissPipelineForAppointments({
            appointmentIds: affectedAppointmentIds,
            user: req.session.user,
            reason: 'tuss_mapping_changed',
            mode: 'best_effort',
            revalidateAppointment: revalidateAppointmentBillingForAppointment,
            logger: console,
            concurrency: 4
          })
        : [];
      return res.json({
        success: true,
        data: serializePayerTussMapping(data, service, code),
        tissPipeline: {
          reason: 'tuss_mapping_changed',
          attempted: pipelineResults.length,
          updated: pipelineResults.filter((item) => item.ok).length,
          errors: pipelineResults.filter((item) => !item.ok).length
        }
      });
    } catch (error: any) {
      console.warn('[TussReady] mapping update failed:', error?.message || String(error));
      return res.status(500).json(payerSafeError(500));
    }
  });
}
