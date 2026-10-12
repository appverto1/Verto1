// GET /api/private-pricing/catalog
export function createPrivatePricingCatalogReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, PRIVATE_PATIENT_AGREEMENT_SELECT, PRIVATE_PRICE_RULE_SELECT, TUSS_SERVICE_CATALOG_SELECT, CLINIC_PAYER_SELECT, privateSessionPricingErrorResponse } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      const patientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120);
      if (!isUuid(organizationId)) return res.status(400).json({ success: false, error: 'Clínica inválida.' });
      if (patientId && !isUuid(patientId)) return res.status(400).json({ success: false, error: 'Paciente inválido.' });

      if (patientId) {
        const patientScope = await supabase
          .from('patients')
          .select('id')
          .eq('id', patientId)
          .eq('clinic_id', organizationId)
          .limit(1)
          .maybeSingle();
        if (patientScope.error) throw patientScope.error;
        if (!patientScope.data?.id) return res.status(403).json({ success: false, error: 'Paciente não pertence à clínica atual.' });
      }

      let agreementQuery = supabase
        .from('patient_private_pricing_agreements')
        .select(PRIVATE_PATIENT_AGREEMENT_SELECT)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(patientId ? 200 : 1000);
      if (patientId) agreementQuery = agreementQuery.eq('patient_id', patientId);
      const [rulesResult, agreementsResult, servicesResult, payersResult] = await Promise.all([
        supabase
          .from('private_session_price_rules')
          .select(PRIVATE_PRICE_RULE_SELECT)
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(1000),
        agreementQuery,
        supabase
          .from('tuss_service_catalog')
          .select(TUSS_SERVICE_CATALOG_SELECT)
          .eq('organization_id', organizationId)
          .eq('active', true)
          .order('name', { ascending: true })
          .limit(1000),
        supabase
          .from('clinic_payers')
          .select(CLINIC_PAYER_SELECT)
          .eq('organization_id', organizationId)
          .eq('status', 'ACTIVE')
          .order('name', { ascending: true })
          .limit(500)
      ]);
      const primaryError = [rulesResult, agreementsResult, servicesResult, payersResult]
        .map((result: any) => result.error)
        .find(Boolean);
      if (primaryError) throw primaryError;

      return res.json({
        success: true,
        data: {
          rules: rulesResult.data || [],
          agreements: agreementsResult.data || [],
          services: servicesResult.data || [],
          payers: payersResult.data || []
        },
        meta: { queryCount: patientId ? 5 : 4 }
      });
    } catch (error: any) {
      const safe = privateSessionPricingErrorResponse(error);
      return res.status(safe.status).json({ success: false, error: safe.error });
    }

  };
}

// GET /api/private-pricing/appointments/:appointmentId/snapshot
export function createPrivatePricingSnapshotReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, PRIVATE_FINANCIAL_SNAPSHOT_SELECT, privateSessionPricingErrorResponse } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      const appointmentId = sanitizeString(req.params.appointmentId, 120);
      if (!isUuid(organizationId) || !isUuid(appointmentId)) {
        return res.status(400).json({ success: false, error: 'Sessão inválida para leitura da política financeira.' });
      }
      const result = await supabase
        .from('appointment_private_financial_snapshots')
        .select(PRIVATE_FINANCIAL_SNAPSHOT_SELECT)
        .eq('organization_id', organizationId)
        .eq('appointment_id', appointmentId)
        .order('snapshot_version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) throw result.error;
      return res.json({ success: true, data: result.data || null });
    } catch (error: any) {
      const safe = privateSessionPricingErrorResponse(error);
      return res.status(safe.status).json({ success: false, error: safe.error });
    }

  };
}

// GET /api/patient-finance/ledger
export function createPatientFinanceLedgerReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, PATIENT_FINANCE_CHARGE_SELECT, patientFinanceErrorResponse, PATIENT_FINANCE_APPOINTMENT_SELECT, PATIENT_FINANCE_POLICY_SELECT, PRIVATE_FINANCIAL_SNAPSHOT_SELECT, extractMissingColumnName, PATIENT_FINANCE_APPOINTMENT_LEGACY_SELECT, hasMissingFinancialSchema, isMissingRelationError, APPOINTMENT_BILLING_CONTEXT_SELECT } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      if (!isUuid(organizationId)) return res.status(400).json({ success: false, error: 'Clínica inválida para o financeiro de pacientes.' });
      const requestedMonth = sanitizeString(req.query?.month, 7);
      const monthMatch = requestedMonth.match(/^(\d{4})-(\d{2})$/);
      const baseDate = monthMatch
        ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
        : new Date();
      const rangeStart = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
      const rangeEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 2, 0, 23, 59, 59, 999);
      const readLedgerAppointments = (select: string) => supabase
        .from('appointments')
        .select(select)
        .or(`organization_id.eq.${organizationId},clinic_id.eq.${organizationId}`)
        .gte('scheduled_at', rangeStart.toISOString())
        .lte('scheduled_at', rangeEnd.toISOString())
        .is('deleted_at', null)
        .order('scheduled_at', { ascending: false })
        .limit(1000);

      const chargesResult = await supabase
        .from('payments')
        .select(PATIENT_FINANCE_CHARGE_SELECT)
        .or(`organization_id.eq.${organizationId},clinic_id.eq.${organizationId}`)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (chargesResult.error) {
        const safe = patientFinanceErrorResponse(chargesResult.error);
        return res.status(safe.status).json({ success: false, error: safe.error });
      }
      const visibleChargeIds = Array.from(new Set(
        (chargesResult.data || [])
          .map((charge: any) => sanitizeString(charge?.id, 120))
          .filter(Boolean),
      ));
      const emptyRelatedResult = () => Promise.resolve({
        data: { items: [], transactions: [], events: [] },
        error: null
      });
      const emptyItemsResult = () => Promise.resolve({ data: [], error: null });
      const readLedgerItemSnapshots = () => supabase
        .from('payment_appointment_items')
        .select([
          'id',
          'organization_id',
          'clinic_id',
          'payment_id',
          'appointment_id',
          'patient_id',
          'professional_id',
          'patient_name_snapshot',
          'professional_name_snapshot',
          'service_type_snapshot',
          'specialty_snapshot',
          'appointment_scheduled_at',
          'quantity',
          'unit_amount',
          'subtotal',
          'active',
          'created_at',
          'patient_financial_plan_id',
          'patient_financial_plan_logical_id',
          'patient_financial_plan_version',
          'payer_id_snapshot',
          'payer_name_snapshot',
          'competence_month',
          'completion_at'
        ].join(','))
        .eq('organization_id', organizationId)
        .in('payment_id', visibleChargeIds)
        .order('appointment_scheduled_at', { ascending: false })
        .limit(1000);

      const [relatedResult, itemSnapshotsResult, initialAppointmentsResult, policyResult, snapshotsResult] = await Promise.all([
        visibleChargeIds.length > 0
          ? supabase.rpc('get_patient_finance_ledger_children_v1', {
              p_organization_id: organizationId,
              p_payment_ids: visibleChargeIds,
              p_limit: 1000
            })
          : emptyRelatedResult(),
        visibleChargeIds.length > 0 ? readLedgerItemSnapshots() : emptyItemsResult(),
        readLedgerAppointments(PATIENT_FINANCE_APPOINTMENT_SELECT),
        supabase
          .from('clinic_patient_finance_policies')
          .select(PATIENT_FINANCE_POLICY_SELECT)
          .eq('organization_id', organizationId)
          .maybeSingle(),
        supabase
          .from('appointment_private_financial_snapshots')
          .select(PRIVATE_FINANCIAL_SNAPSHOT_SELECT)
          .eq('organization_id', organizationId)
          .gte('scheduled_at', rangeStart.toISOString())
          .lte('scheduled_at', rangeEnd.toISOString())
          .order('created_at', { ascending: false })
          .limit(1500)
      ]);
      let appointmentsResult = initialAppointmentsResult;
      let appointmentQueryCount = 1;
      if (extractMissingColumnName(appointmentsResult.error) === 'source_payload') {
        appointmentsResult = await readLedgerAppointments(PATIENT_FINANCE_APPOINTMENT_LEGACY_SELECT);
        appointmentQueryCount += 1;
      }

      const itemSnapshotsError = itemSnapshotsResult.error;
      const canFallbackToLedgerRpcItems = Boolean(itemSnapshotsError && hasMissingFinancialSchema(itemSnapshotsError));
      const primaryError = [relatedResult, appointmentsResult, snapshotsResult, canFallbackToLedgerRpcItems ? null : itemSnapshotsResult]
        .map((result: any) => result?.error)
        .find(Boolean);
      if (primaryError) {
        const safe = patientFinanceErrorResponse(primaryError);
        return res.status(safe.status).json({ success: false, error: safe.error });
      }
      if (policyResult.error && !hasMissingFinancialSchema(policyResult.error) && !isMissingRelationError(policyResult.error)) throw policyResult.error;
      const relatedPayload = relatedResult.data && typeof relatedResult.data === 'object'
        ? relatedResult.data as Record<string, any>
        : null;
      if (
        visibleChargeIds.length > 0 &&
        (!relatedPayload ||
          !Array.isArray(relatedPayload.items) ||
          !Array.isArray(relatedPayload.transactions) ||
          !Array.isArray(relatedPayload.events))
      ) {
        const invalidBatchError: any = new Error('PATIENT_FINANCE_LEDGER_BATCH_INVALID');
        invalidBatchError.code = 'PATIENT_FINANCE_LEDGER_BATCH_INVALID';
        throw invalidBatchError;
      }

      const appointmentIds = (appointmentsResult.data || [])
        .map((appointment: any) => sanitizeString(appointment?.id, 120))
        .filter((id: string) => isUuid(id));
      let billingContexts: any[] = [];
      if (appointmentIds.length > 0) {
        const billingResult = await supabase
          .from('appointment_billing_contexts')
          .select(APPOINTMENT_BILLING_CONTEXT_SELECT)
          .eq('organization_id', organizationId)
          .in('appointment_id', appointmentIds)
          .limit(Math.min(appointmentIds.length, 1000));
        if (!billingResult.error) billingContexts = billingResult.data || [];
        else if (!hasMissingFinancialSchema(billingResult.error)) throw billingResult.error;
      }

      const monthlySessionChargeIds = new Set(
        (chargesResult.data || [])
          .filter((charge: any) => sanitizeString(charge?.source, 80) === 'MONTHLY_SESSION_AGGREGATE')
          .map((charge: any) => sanitizeString(charge?.id, 120))
          .filter(Boolean),
      );
      const ledgerItemRows = canFallbackToLedgerRpcItems
        ? (relatedPayload?.items || [])
        : (Array.isArray(itemSnapshotsResult.data) ? itemSnapshotsResult.data : []);
      const visibleLedgerItems = ledgerItemRows.filter((item: any) => (
        !monthlySessionChargeIds.has(sanitizeString(item?.payment_id, 120)) || item?.active === true
      ));

      return res.json({
        success: true,
        data: {
          charges: chargesResult.data || [],
          items: visibleLedgerItems,
          transactions: relatedPayload?.transactions || [],
          events: relatedPayload?.events || [],
          appointments: appointmentsResult.data || [],
          privateSnapshots: snapshotsResult.data || [],
          billingContexts,
          policy: policyResult.data || {
            organization_id: organizationId,
            receivable_trigger: 'MANUAL',
            create_forecast_on_schedule: true,
            cancellation_policy: 'NO_CHARGE',
            cancellation_percentage: 0,
            cancellation_tolerance_hours: 0,
            charge_no_show: false,
            reschedule_keeps_charge: true
          }
        },
        meta: {
          queryCount:
            3 +
            appointmentQueryCount +
            (appointmentIds.length > 0 ? 1 : 0) +
            (visibleChargeIds.length > 0 ? 2 : 0),
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString()
        }
      });
    } catch (error: any) {
      const safe = patientFinanceErrorResponse(error);
      return res.status(safe.status).json({ success: false, error: safe.error });
    }

  };
}

// GET /api/patient-finance/transactions/:transactionId/document
export function createPatientFinanceTransactionDocumentReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, sanitizeReceiptUrl, patientFinanceErrorResponse } = getDeps();
    try {
      const organizationId = sanitizeString(currentClinicId(req.session.user), 120);
      const transactionId = sanitizeString(req.params.transactionId, 120);
      const requestedKind = sanitizeString(req.query?.kind, 20).toLowerCase();
      if (!isUuid(organizationId) || !isUuid(transactionId) || !['proof', 'receipt'].includes(requestedKind)) {
        return res.status(400).json({ success: false, error: 'Documento financeiro inválido.' });
      }

      const documentResult = await supabase
        .from('payment_transactions')
        .select('id,organization_id,proof_url,proof_file_name,proof_content_type,receipt_url,receipt_number')
        .eq('id', transactionId)
        .eq('organization_id', organizationId)
        .limit(1)
        .maybeSingle();
      if (documentResult.error) throw documentResult.error;
      if (!documentResult.data) {
        return res.status(404).json({ success: false, error: 'Documento financeiro não encontrado nesta clínica.' });
      }

      const rawUrl = requestedKind === 'proof'
        ? documentResult.data.proof_url
        : documentResult.data.receipt_url;
      const url = sanitizeReceiptUrl(rawUrl);
      if (!url) {
        return res.status(404).json({ success: false, error: 'Documento financeiro indisponível.' });
      }

      return res.json({
        success: true,
        data: {
          id: transactionId,
          kind: requestedKind,
          url,
          fileName: requestedKind === 'proof'
            ? sanitizeString(documentResult.data.proof_file_name, 240) || null
            : `recibo-${sanitizeString(documentResult.data.receipt_number, 120) || transactionId}.pdf`,
          contentType: requestedKind === 'proof'
            ? sanitizeString(documentResult.data.proof_content_type, 120) || null
            : 'application/pdf'
        }
      });
    } catch (error: any) {
      const safe = patientFinanceErrorResponse(error);
      return res.status(safe.status).json({ success: false, error: safe.error });
    }

  };
}

// GET /api/patient-finance/policy
export function createPatientFinancePolicyReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, PATIENT_FINANCE_POLICY_SELECT, hasMissingFinancialSchema, patientFinanceErrorResponse } = getDeps();
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = clinicId;
      if (!isUuid(organizationId)) return res.status(400).json({ success: false, error: 'Clínica inválida.' });
      const result = await supabase
        .from('clinic_patient_finance_policies')
        .select(PATIENT_FINANCE_POLICY_SELECT)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (result.error && !hasMissingFinancialSchema(result.error)) throw result.error;
      return res.json({ success: true, data: result.data || null });
    } catch (error: any) {
      const safe = patientFinanceErrorResponse(error);
      return res.status(safe.status).json({ success: false, error: safe.error });
    }

  };
}

// GET /api/payments
export function createPaymentsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, fetchPaymentsWithSchemaFallback, hasGlobalClinicAccess, parseBoundedListLimit, sendRouteDbError, requestIdForLogs, supabase } = getDeps();
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      const paymentsResult = await fetchPaymentsWithSchemaFallback({
        supabase,
        clinicId: !hasGlobalClinicAccess(req.session.user) && scopedClinicId ? scopedClinicId : null,
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        logger: console
      });
      const data = paymentsResult.data;
      const error = paymentsResult.error;

      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/payments [GET]', error, {
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        requestId: requestIdForLogs(req)
      });
    }

  };
}

// GET /api/financial/professional-payments
export function createProfessionalPaymentsReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, fetchProfessionalPaymentsWithSchemaFallback, hasGlobalClinicAccess, parseBoundedListLimit, hasMissingFinancialSchema, sendRouteDbError, requestIdForLogs, supabase } = getDeps();
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      const professionalPaymentsResult = await fetchProfessionalPaymentsWithSchemaFallback({
        supabase,
        clinicId: !hasGlobalClinicAccess(req.session.user) && scopedClinicId ? scopedClinicId : null,
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        logger: console
      });
      const data = professionalPaymentsResult.data;
      const error = professionalPaymentsResult.error;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      res.json({ success: true, data: data || [] });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/financial/professional-payments [GET]', error, {
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        requestId: requestIdForLogs(req)
      });
    }

  };
}

// GET /api/financial/expenses
export function createFinancialExpensesReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { clinicExpenseScope, clinicExpenseMonthBounds, supabase, clinicExpenseSchemaMissing, fetchFinancialEntriesWithSchemaFallback, FINANCIAL_ENTRY_SELECT, MAX_CLINIC_EXPENSE_ROWS, CLINIC_EXPENSE_RULE_SELECT, sanitizeString, sendRouteDbError, requestIdForLogs } = getDeps();
    try {
      const scope = clinicExpenseScope(req);
      const bounds = clinicExpenseMonthBounds(req.query?.month);
      if (!scope) return res.status(403).json({ success: false, error: 'Contexto financeiro da clínica inválido.' });
      if (!bounds) return res.status(400).json({ success: false, error: 'Competência inválida.' });

      const materialized = await supabase.rpc('materialize_clinic_expense_occurrences_v1', {
        p_clinic_id: scope.clinicId,
        p_month: bounds.monthStart,
        p_actor_id: scope.actorId,
      });
      if (materialized.error && clinicExpenseSchemaMissing(materialized.error)) {
        const legacy = await fetchFinancialEntriesWithSchemaFallback({
          supabase,
          clinicId: scope.clinicId,
          limit: 200,
          logger: console,
        });
        if (legacy.error) throw legacy.error;
        const rows = (legacy.data || []).filter((entry: any) =>
          String(entry?.entry_type || 'expense').toLowerCase() === 'expense' &&
          String(entry?.occurred_on || '').slice(0, 7) === bounds.month,
        );
        return res.json({ success: true, schemaReady: false, data: { entries: rows, rules: [] } });
      }
      if (materialized.error) throw materialized.error;

      const [competenceResult, cashResult, legacyResult, rulesResult] = await Promise.all([
        supabase
          .from('clinic_financial_entries')
          .select(FINANCIAL_ENTRY_SELECT)
          .eq('clinic_id', scope.clinicId)
          .eq('entry_type', 'expense')
          .gte('competence_month', bounds.monthStart)
          .lt('competence_month', bounds.nextMonth)
          .order('due_date', { ascending: true })
          .limit(MAX_CLINIC_EXPENSE_ROWS),
        supabase
          .from('clinic_financial_entries')
          .select(FINANCIAL_ENTRY_SELECT)
          .eq('clinic_id', scope.clinicId)
          .eq('entry_type', 'expense')
          .eq('status', 'paid')
          .gte('paid_on', bounds.monthStart)
          .lt('paid_on', bounds.nextMonth)
          .order('paid_on', { ascending: true })
          .limit(MAX_CLINIC_EXPENSE_ROWS),
        supabase
          .from('clinic_financial_entries')
          .select(FINANCIAL_ENTRY_SELECT)
          .eq('clinic_id', scope.clinicId)
          .eq('entry_type', 'expense')
          .is('competence_month', null)
          .gte('occurred_on', bounds.monthStart)
          .lt('occurred_on', bounds.nextMonth)
          .order('occurred_on', { ascending: true })
          .limit(MAX_CLINIC_EXPENSE_ROWS),
        supabase
          .from('clinic_recurring_costs')
          .select(CLINIC_EXPENSE_RULE_SELECT)
          .eq('clinic_id', scope.clinicId)
          .lte('starts_on', bounds.monthEnd)
          .or('active.eq.true,ends_on.not.is.null')
          .or(`ends_on.is.null,ends_on.gte.${bounds.monthStart}`)
          .order('starts_on', { ascending: false })
          .order('version', { ascending: false })
          .limit(250),
      ]);
      const firstError = [competenceResult, cashResult, legacyResult, rulesResult].find((result: any) => result.error)?.error;
      if (firstError) throw firstError;
      const entriesById = new Map<string, any>();
      [...(competenceResult.data || []), ...(cashResult.data || []), ...(legacyResult.data || [])].forEach((entry: any) => {
        const id = sanitizeString(entry?.id, 120);
        if (id) entriesById.set(id, entry);
      });
      return res.json({
        success: true,
        schemaReady: true,
        data: {
          entries: Array.from(entriesById.values()),
          rules: rulesResult.data || [],
          materialized: Number(materialized.data || 0),
        },
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/financial/expenses [GET]', error, { requestId: requestIdForLogs(req) });
    }

  };
}

// GET /api/financial/entries
export function createFinancialEntriesReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, fetchFinancialEntriesWithSchemaFallback, hasGlobalClinicAccess, parseBoundedListLimit, hasMissingFinancialSchema, sendRouteDbError, requestIdForLogs, supabase } = getDeps();
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      const entriesResult = await fetchFinancialEntriesWithSchemaFallback({
        supabase,
        clinicId: !hasGlobalClinicAccess(req.session.user) && scopedClinicId ? scopedClinicId : null,
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        logger: console
      });
      const data = entriesResult.data;
      const error = entriesResult.error;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      res.json({ success: true, data: data || [] });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/financial/entries [GET]', error, {
        limit: parseBoundedListLimit(req.query?.limit, 100, 200),
        requestId: requestIdForLogs(req)
      });
    }

  };
}

// GET /api/financial/feature-survey
export function createFinancialFeatureSurveyReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, supabase, FINANCIAL_FEEDBACK_SELECT } = getDeps();
    try {
      const user = req.session.user;
      const clinicId = currentClinicId(user);
      if (!clinicId) return res.json({ success: true, submitted: false, data: null });

      const { data, error } = await supabase
        .from('financial_module_feedback')
        .select(FINANCIAL_FEEDBACK_SELECT)
        .eq('clinic_id', clinicId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      res.json({ success: true, submitted: !!data, data: data || null });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }

  };
}
