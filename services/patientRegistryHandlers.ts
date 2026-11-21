// Surgical extraction: preserve route ordering, authorization middleware, database writes and responses.
type ResolvedClinicCapabilityContext = { role: string; userId: string; clinicId: string; capabilities: ReadonlySet<string> };
export function createPatientListHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, isUuid, parseBoundedListLimit, resolvePatientListScopedPatientIds, fetchPatientsWithSchemaFallback, supabase, patientListColumnsForCapabilities, isExplicitDemoUser, patientFinancialPlanSelectForCapabilities, isMissingRelationError, serializePatientMediaForClient, redactPatientListRowForCapabilities, sendRouteDbError, currentClinicId } = getDeps();
    try {
      const requestedPatientId = sanitizeString(req.query?.patientId || req.query?.patient_id, 120);
      if (requestedPatientId && !isUuid(requestedPatientId)) {
        return res.status(400).json({ success: false, error: 'Paciente inválido.' });
      }
      const limit = requestedPatientId ? 1 : parseBoundedListLimit(req.query?.limit, 200, 500);
      const context = req.authorizationContext as ResolvedClinicCapabilityContext | undefined;
      if (!context) {
        return res.status(403).json({
          success: false,
          error: 'CLINIC_CAPABILITY_CONTEXT_REQUIRED'
        });
      }

      const resolvedScopedPatientIds = await resolvePatientListScopedPatientIds(context);
      const scopedPatientIds = requestedPatientId
        ? resolvedScopedPatientIds === null
          ? [requestedPatientId]
          : resolvedScopedPatientIds.includes(requestedPatientId)
            ? [requestedPatientId]
            : []
        : resolvedScopedPatientIds;
      const result = await fetchPatientsWithSchemaFallback({
        supabase,
        role: context.role,
        userId: context.userId,
        clinicId: context.clinicId,
        patientIds: scopedPatientIds,
        selectColumns: patientListColumnsForCapabilities(context.capabilities),
        limit,
        logger: console
      });

      if (result.error) throw result.error;
      const patients = isExplicitDemoUser(req.session.user)
        ? (result.data || []).filter((patient: any) => patient?.is_demo === true)
        : result.data || [];
      const patientsAlphabetical = patients.slice().sort((left: any, right: any) =>
        sanitizeString(left?.name || left?.nome, 180).localeCompare(
          sanitizeString(right?.name || right?.nome, 180),
          'pt-BR',
          { sensitivity: 'base', numeric: true }
        )
      );

      const returnedPatientIds = patientsAlphabetical
        .map((patient: any) => sanitizeString(patient?.id, 120))
        .filter(Boolean);

      // patient_financial_plans is the canonical source for patient billing rules.
      // Keep the patient list hydration consistent with the dedicated/detail read paths
      // so a workspace refresh cannot replace a persisted financial plan with an empty
      // React snapshot. Fetch in bounded batches (never one query per patient) and keep
      // the Etapa 1 TISS read boundary capability-aware.
      let activeFinancialPlansByPatient: Map<string, any[]> | null = null;
      if (context.capabilities.has('patient.demographics.edit') && returnedPatientIds.length > 0) {
        activeFinancialPlansByPatient = new Map<string, any[]>();
        const financialPlanSelect = patientFinancialPlanSelectForCapabilities(context.capabilities);
        const patientIdBatches: string[][] = [];
        for (let index = 0; index < returnedPatientIds.length; index += 100) {
          patientIdBatches.push(returnedPatientIds.slice(index, index + 100));
        }
        for (const patientIdBatch of patientIdBatches) {
          const financialPlanResult = await supabase
            .from('patient_financial_plans')
            .select(financialPlanSelect)
            .eq('organization_id', context.clinicId)
            .eq('status', 'ACTIVE')
            .in('patient_id', patientIdBatch)
            .order('created_at', { ascending: true });
          if (financialPlanResult.error) {
            if (isMissingRelationError(financialPlanResult.error)) {
              activeFinancialPlansByPatient = null;
              break;
            }
            throw financialPlanResult.error;
          }
          for (const plan of financialPlanResult.data || []) {
            const patientId = sanitizeString((plan as any)?.patient_id, 120);
            if (!patientId) continue;
            const current = activeFinancialPlansByPatient.get(patientId) || [];
            current.push(plan);
            activeFinancialPlansByPatient.set(patientId, current);
          }
        }
      }

      let activeProfessionalLinksByPatient: Map<string, any[]> | null = null;
      if (
        context.capabilities.has('team.view') &&
        returnedPatientIds.length > 0
      ) {
        const professionalLinkResult = await supabase
          .from('patient_professional_links')
          .select('patient_id,professional_id,relationship_type,status')
          .eq('organization_id', context.clinicId)
          .eq('status', 'active')
          .in('patient_id', returnedPatientIds);
        if (professionalLinkResult.error) {
          if (!isMissingRelationError(professionalLinkResult.error)) {
            throw professionalLinkResult.error;
          }
        } else {
          activeProfessionalLinksByPatient = new Map<string, any[]>();
          for (const link of professionalLinkResult.data || []) {
            const patientId = sanitizeString(link?.patient_id, 120);
            if (!patientId) continue;
            const current = activeProfessionalLinksByPatient.get(patientId) || [];
            current.push({
              professional_id: sanitizeString(link?.professional_id, 120),
              relationship_type: sanitizeString(link?.relationship_type, 40),
              status: 'active',
            });
            activeProfessionalLinksByPatient.set(patientId, current);
          }
        }
      }

      return res.json({
        success: true,
        data: patientsAlphabetical.map((patient: any) => {
          const serialized = serializePatientMediaForClient(patient);
          const patientId = sanitizeString(patient?.id, 120);
          const withCanonicalFinancialPlans = activeFinancialPlansByPatient
            ? {
                ...serialized,
                financialPlans: activeFinancialPlansByPatient.get(patientId) || [],
                financial_plans: activeFinancialPlansByPatient.get(patientId) || [],
              }
            : serialized;
          const withProfessionalLinks = activeProfessionalLinksByPatient
            ? {
                ...withCanonicalFinancialPlans,
                professional_links:
                  activeProfessionalLinksByPatient.get(patientId) || [],
              }
            : withCanonicalFinancialPlans;
          return redactPatientListRowForCapabilities(
            withProfessionalLinks,
            context.capabilities,
          );
        }),
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patients [GET]', error, {
        userId: sanitizeString(req.session?.user?.id, 120),
        role: sanitizeString(req.authorizationContext?.role || req.session?.user?.role, 40),
        clinicId: sanitizeString(req.authorizationContext?.clinicId || currentClinicId(req.session?.user), 120),
        limit: parseBoundedListLimit(req.query?.limit, 200, 500)
      });
    }
  };
}

type ActivePatientSyncQueueResult = { queued: boolean; activePatientCount: number; queueVersion: number | null; growthMilestone: number | null };
export function createPatientRegistrationHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertCanActivateBillablePatient, buildPatientIdentityPersistenceFields, cleanObject, currentClinicId, derivePatientSpecialtyKeysFromPayload, encryptJsonPayload, enforcePayloadLimit, extractMissingColumnName, fetchClinicDemoState, findDuplicatePatientInClinic, findPatientSpecialtyConflictAcrossClinics, getBillableActivePatientCount, hasAnamnesisAnswers, isUuid, normalizeBrazilMobilePhone, normalizeCpf, normalizePatientInsuranceEligibilityPayload, normalizePatientInsuranceTypeForPersistence, patientPayloadRequestsGenericPayerCapability, patientPayloadRequestsInsuranceCreateCapability, persistActivityLog, persistPatientFinancialPlans, pseudonymizeValue, queueActivePatientSync, redactPatientRecordPayloadForCapabilities, requestIdForLogs, requireClinicCapability, resolvePatientInsurancePayerSelection, sanitizeClinicalPayload, sanitizeEmail, sanitizePhone, sanitizeString, sendBillingUpgradeRequired, sendRouteDbError, upsertPatientWithSchemaFallback, supabase, crypto, ONBOARDING_READY_FOR_CARE, ONBOARDING_ANAMNESIS_SUBMITTED, ONBOARDING_NOT_STARTED, PATIENT_STATUS_ACTIVE, PATIENT_STATUS_PENDING_ANAMNESIS, RELATIONSHIP_CONFIRMED } = getDeps();
    try {
      const context = req.authorizationContext as ResolvedClinicCapabilityContext;
      const aggregateRecordPayloadRaw =
        req.body?.recordPayload && typeof req.body.recordPayload === 'object' && !Array.isArray(req.body.recordPayload)
          ? req.body.recordPayload
          : null;
      if (aggregateRecordPayloadRaw && !enforcePayloadLimit(req, res, 768 * 1024, 'Cadastro e prontuário do paciente')) return;
      const safeName = sanitizeString(req.body?.name || req.body?.nome, 160);
      const safeClinicId = sanitizeString(context.clinicId, 100);
      const demoClinicState = await fetchClinicDemoState(safeClinicId);
      const requestedTherapistId = sanitizeString(req.body?.therapist_id, 100);
      const canAssignPrimaryProfessional = context.capabilities.has('team.patient_primary.manage');
      if (
        requestedTherapistId &&
        requestedTherapistId !== context.userId &&
        !canAssignPrimaryProfessional
      ) {
        return res.status(403).json({
          success: false,
          error: 'TEAM_PATIENT_PRIMARY_CAPABILITY_REQUIRED'
        });
      }
      const safeTherapistId = requestedTherapistId ||
        (context.role === 'therapist' ? context.userId : '');
      const rawEmail = req.body?.email;
      const safeEmail = sanitizeEmail(rawEmail);
      const rawCpf = req.body?.cpf || req.body?.anamnesisData?.cpf;
      const safeCpf = normalizeCpf(rawCpf);
      const rawPhone = req.body?.phone || req.body?.telefone;
      const safePhone = normalizeBrazilMobilePhone(rawPhone);
      const safeClientRecordId = sanitizeString(
        req.body?.clientRecordId || req.body?.client_record_id || req.body?.localId || req.body?.idempotencyKey,
        120
      );
      const requestedSpecialtyKeys = derivePatientSpecialtyKeysFromPayload(req.body || {});
      const anamnesisRequired = req.body?.anamnesisRequired === false || req.body?.anamnesis_required === false
        ? false
        : true;
      const hasSubmittedAnamnesis = hasAnamnesisAnswers(req.body?.anamnesisData || req.body?.anamnesis_data || req.body?.anamnese);
      const initialOnboardingStatus = !anamnesisRequired
        ? ONBOARDING_READY_FOR_CARE
        : hasSubmittedAnamnesis
          ? ONBOARDING_ANAMNESIS_SUBMITTED
          : ONBOARDING_NOT_STARTED;
      const initialPatientStatus = !anamnesisRequired
        ? PATIENT_STATUS_ACTIVE
        : PATIENT_STATUS_PENDING_ANAMNESIS;
      const requestedPatientStatus = sanitizeString(req.body?.status, 40);
      const hasClinicalCreatePayload = [
        req.body?.diagnosis,
        req.body?.notes,
        req.body?.anamnesisData,
        req.body?.anamnesis_data,
        req.body?.anamnese,
        aggregateRecordPayloadRaw,
      ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');
      if (hasClinicalCreatePayload && !context.capabilities.has('clinical.record.view')) {
        return res.status(403).json({
          success: false,
          error: 'CLINICAL_RECORD_CAPABILITY_REQUIRED'
        });
      }
      const hasGenericPayerCreatePayload = patientPayloadRequestsGenericPayerCapability(req.body);
      if (
        hasGenericPayerCreatePayload &&
        !context.capabilities.has('finance.entries.manage') &&
        !context.capabilities.has('patient.insurance.create')
      ) {
        return res.status(403).json({ success: false, error: 'PATIENT_PAYER_CONTEXT_CAPABILITY_REQUIRED' });
      }
      const hasInsuranceCreatePayload = patientPayloadRequestsInsuranceCreateCapability(req.body);
      if (hasInsuranceCreatePayload && !context.capabilities.has('patient.insurance.create')) {
        return res.status(403).json({
          success: false,
          error: 'PATIENT_INSURANCE_CREATE_CAPABILITY_REQUIRED'
        });
      }
      const payerSelection = await resolvePatientInsurancePayerSelection({
        clinicId: safeClinicId,
        body: req.body || {},
        requireSelection:
          normalizePatientInsuranceTypeForPersistence(
            req.body?.insuranceType || req.body?.insurance_type || req.body?.convenioTipo,
          ) === 'convenio',
      });
      if (!payerSelection.ok) {
        return res.status(payerSelection.status).json({
          success: false,
          error: payerSelection.error,
          code: 'PATIENT_INSURANCE_PAYER_INVALID',
        });
      }
      const identityPayload = {
        ...(req.body || {}),
        insurancePayerId: payerSelection.payerId,
        insurance_payer_id: payerSelection.payerId,
        convenioPayerId: payerSelection.payerId,
        convenio_payer_id: payerSelection.payerId,
        insuranceType: payerSelection.insuranceType,
        convenioTipo: payerSelection.insuranceType,
        ...(payerSelection.payerName
          ? {
              insuranceName: payerSelection.payerName,
              convenioNome: payerSelection.payerName,
            }
          : {}),
      };
      const safeBody = cleanObject({
        id: isUuid(sanitizeString(req.body?.id, 120)) ? sanitizeString(req.body?.id, 120) : undefined,
        name: safeName,
        email: safeEmail,
        cpf: safeCpf,
        phone: safePhone || sanitizePhone(rawPhone),
        age: asSafeNumber(req.body?.age, 0, 130),
        diagnosis: sanitizeString(req.body?.diagnosis, 2000),
        ...buildPatientIdentityPersistenceFields(identityPayload),
        status: !anamnesisRequired ? (requestedPatientStatus || initialPatientStatus) : initialPatientStatus,
        onboarding_status: initialOnboardingStatus,
        anamnesis_required: anamnesisRequired,
        anamnesis_submitted_at: hasSubmittedAnamnesis ? new Date().toISOString() : undefined,
        relationship_status: RELATIONSHIP_CONFIRMED,
        clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
        therapist_id: isUuid(safeTherapistId) ? safeTherapistId : undefined,
        is_demo: demoClinicState.isDemo ? true : undefined,
        metadata: demoClinicState.isDemo
          ? {
              demo: true,
              source: demoClinicState.demoKind || demoClinicState.demoSource || 'demo'
            }
          : undefined,
        client_record_id: safeClientRecordId || undefined,
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!safeBody.name) {
        return res.status(400).json({ error: 'Nome do paciente é obrigatório.' });
      }
      if (demoClinicState.isDemo) {
        const submittedEmail = sanitizeString(rawEmail, 320).toLowerCase();
        if (submittedEmail && !submittedEmail.endsWith('.invalid')) {
          return res.status(400).json({
            error: 'Use apenas e-mail fictício terminado em .invalid no ambiente demo.'
          });
        }
        if (sanitizeString(rawCpf, 80) || sanitizeString(rawPhone, 80)) {
          return res.status(400).json({
            error: 'CPF e telefone reais não devem ser informados no ambiente demo.'
          });
        }
      }
      if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() && !safeEmail) {
        return res.status(400).json({ error: 'E-mail inválido. Informe um domínio válido.' });
      }
      if (rawCpf !== undefined && rawCpf !== null && String(rawCpf).trim() && !safeCpf) {
        return res.status(400).json({ error: 'CPF inválido. Informe 11 dígitos.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !safePhone) {
        return res.status(400).json({ error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).' });
      }

      const duplicatePatient = await findDuplicatePatientInClinic({
        clinicId: safeBody.clinic_id || safeClinicId,
        name: safeBody.name,
        email: safeBody.email,
        cpf: safeBody.cpf,
        excludePatientId: safeBody.id,
        clientRecordId: safeClientRecordId
      });
      if (duplicatePatient) {
        const existingPatientData = cleanObject({
          id: duplicatePatient.patientId,
          name: duplicatePatient.patientName,
          email: sanitizeEmail(duplicatePatient.row?.email) || safeBody.email,
          cpf: normalizeCpf(duplicatePatient.row?.cpf) || safeBody.cpf,
          phone: sanitizePhone(duplicatePatient.row?.phone) || safeBody.phone,
          status: sanitizeString(duplicatePatient.row?.status, 40) || initialPatientStatus,
          onboarding_status: sanitizeString(duplicatePatient.row?.onboarding_status, 60) || initialOnboardingStatus,
          anamnesis_required: duplicatePatient.row?.anamnesis_required !== false,
          clinic_id: safeBody.clinic_id,
          therapist_id: safeBody.therapist_id
        });
        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuario', 180),
          title: 'Cadastro de paciente confirmado',
          content: 'Operação idempotente confirmada sem duplicar paciente.',
          type: 'management',
          actionType: 'PATIENT_ALREADY_EXISTS_SAME_CLINIC',
          payload: {
            field: duplicatePatient.field,
            hasEmail: Boolean(safeBody.email),
            hasCpf: Boolean(safeBody.cpf)
          }
        });
        return res.json({
          success: true,
          idempotent: true,
          code: 'PATIENT_ALREADY_EXISTS_SAME_CLINIC',
          message: 'Cadastro confirmado.',
          data: existingPatientData
        });
      }

      const crossClinicSpecialtyConflict = await findPatientSpecialtyConflictAcrossClinics({
        clinicId: safeBody.clinic_id || safeClinicId,
        email: safeBody.email,
        cpf: safeBody.cpf,
        requestedSpecialtyKeys,
        excludePatientId: safeBody.id
      });
      if (crossClinicSpecialtyConflict) {
        return res.status(409).json({
          success: false,
          code: 'PATIENT_SPECIALTY_CONFLICT_OTHER_CLINIC',
          status: 'SPECIALTY_CONFLICT_REQUIRES_REVIEW',
          error: 'Este paciente já está vinculado a outra clínica nesta mesma especialidade.',
          details: {
            patientId: crossClinicSpecialtyConflict.patientId,
            specialty: crossClinicSpecialtyConflict.specialtyKey
          }
        });
      }

      const activePatientCountBeforeMutation = await getBillableActivePatientCount({
        supabase,
        clinicId: safeBody.clinic_id || safeClinicId
      });
      const activationCheck = await assertCanActivateBillablePatient({
        clinicId: safeBody.clinic_id || safeClinicId,
        patientId: safeBody.id,
        targetStatus: safeBody.status,
        actorUserId: sanitizeString(req.session.user?.id, 120),
        trigger: 'patient_create'
      });
      if (!activationCheck.ok) {
        return sendBillingUpgradeRequired(res, activationCheck.payload);
      }

      let data: any = null;
      let recordPersisted = false;
      let financialPlanSyncWarning: string | null = null;

      if (aggregateRecordPayloadRaw) {
        const patientIdForInsert = isUuid(sanitizeString(safeBody.id, 120))
          ? sanitizeString(safeBody.id, 120)
          : crypto.randomUUID();
        const patientPayloadForAtomicInsert = { ...safeBody, id: patientIdForInsert };
        const redactedRecordPayload = redactPatientRecordPayloadForCapabilities(
          aggregateRecordPayloadRaw,
          req.session.user,
          context.capabilities,
        );
        const sanitizedRecordPayload = normalizePatientInsuranceEligibilityPayload(
          sanitizeClinicalPayload(redactedRecordPayload) || {},
        );
        const encryptedRecordPayload = encryptJsonPayload(sanitizedRecordPayload);
        const pseudonymSeed = [
          sanitizeString(sanitizedRecordPayload?.cpf, 30),
          sanitizeString(sanitizedRecordPayload?.email, 320),
          sanitizePhone(sanitizedRecordPayload?.telefone) || '',
        ].filter(Boolean).join('|') || patientIdForInsert;
        const patientRecordRow = cleanObject({
          patient_id: patientIdForInsert,
          clinic_id: safeClinicId,
          therapist_id: isUuid(sanitizeString(req.session.user?.id, 120)) ? sanitizeString(req.session.user?.id, 120) : null,
          pseudonym_id: `pt_${pseudonymizeValue(pseudonymSeed)}`,
          payload_encrypted: encryptedRecordPayload || null,
          payload_preview: cleanObject({
            nome: sanitizeString(sanitizedRecordPayload?.nome || safeBody.name, 120),
            nomeSocial: sanitizeString(sanitizedRecordPayload?.nomeSocial || safeBody.social_name, 120),
            grupo: sanitizeString(sanitizedRecordPayload?.grupo || safeBody.patient_group, 60),
            convenioNome: sanitizeString(sanitizedRecordPayload?.convenioNome || safeBody.insurance_name, 120),
          }),
          updated_at: new Date().toISOString(),
        });
        const aggregateMutation = await supabase.rpc('verto_create_patient_aggregate_atomic', {
          p_patient: patientPayloadForAtomicInsert,
          p_patient_record: patientRecordRow,
        });
        if (aggregateMutation.error) {
          const message = String(aggregateMutation.error?.message || '').toLowerCase();
          if (sanitizeString(aggregateMutation.error?.code, 40) === '42883' || message.includes('verto_create_patient_aggregate_atomic')) {
            return res.status(503).json({
              success: false,
              code: 'PERSISTENCE_GUARANTEES_MIGRATION_REQUIRED',
              error: 'A migração de garantias de persistência ainda não foi aplicada no Supabase.',
            });
          }
          throw aggregateMutation.error;
        }
        if (aggregateMutation.data?.success === false) {
          return res.status(409).json({
            success: false,
            code: 'PATIENT_ATOMIC_PERSISTENCE_REJECTED',
            error: aggregateMutation.data?.error || 'O cadastro não foi persistido atomicamente.',
          });
        }
        data = aggregateMutation.data?.data || patientPayloadForAtomicInsert;
        recordPersisted = true;

        if (
          context.capabilities.has('patient.demographics.edit') &&
          Object.prototype.hasOwnProperty.call(aggregateRecordPayloadRaw, 'financialPlans')
        ) {
          const financialPlanSync = await persistPatientFinancialPlans({
            patientId: patientIdForInsert,
            clinicId: safeClinicId,
            actorId: sanitizeString(req.session.user?.id, 120),
            financialPlans: Array.isArray(aggregateRecordPayloadRaw.financialPlans)
              ? aggregateRecordPayloadRaw.financialPlans
              : [],
          });
          if (!financialPlanSync.success) {
            return res.status(409).json({
              success: false,
              code: sanitizeString((financialPlanSync as any).code, 120) || 'PATIENT_FINANCIAL_PLAN_PERSISTENCE_FAILED',
              patientPersisted: true,
              financialPlanPersisted: false,
              error: sanitizeString(financialPlanSync.error || financialPlanSync.warning || 'O paciente foi salvo, mas o plano financeiro canônico não foi persistido.', 500),
            });
          }
        }
      } else {
        const mutation = await upsertPatientWithSchemaFallback(safeBody);
        if (mutation.error) {
          const missingColumn = extractMissingColumnName(mutation.error);
          if (missingColumn && Object.prototype.hasOwnProperty.call(safeBody, missingColumn)) {
            return res.status(503).json({
              success: false,
              code: 'PATIENT_PERSISTENCE_SCHEMA_MISMATCH',
              field: missingColumn,
              error: `O campo ${missingColumn} ainda não existe no schema ativo. Nenhum campo foi descartado silenciosamente.`,
            });
          }
          throw mutation.error;
        }
        data = mutation.data;
      }

      const clinicForSync = sanitizeString(
        (data as any)?.clinic_id || safeBody.clinic_id || currentClinicId(req.session.user),
        120
      );
      const billingSync = isUuid(clinicForSync)
        ? await queueActivePatientSync(clinicForSync, 'patient_upsert', {
            previousActivePatientCount: activePatientCountBeforeMutation
          })
        : null;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Paciente cadastrado/atualizado',
        content: `Paciente ${safeBody.name} foi salvo no sistema.`,
        type: 'management'
      });
      res.json({
        success: true,
        data,
        billing: billingSync,
        recordPersisted,
        ...(financialPlanSyncWarning ? { warning: financialPlanSyncWarning } : {}),
      });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/patients [POST]', error, {
        userId: sanitizeString(req.session?.user?.id, 120),
        role: sanitizeString(req.session?.user?.role, 40),
        clinicId: sanitizeString(currentClinicId(req.session?.user), 120),
        hasEmail: Boolean(req.body?.email),
        hasCpf: Boolean(req.body?.cpf || req.body?.anamnesisData?.cpf),
        requestId: requestIdForLogs(req)
      });
    }
  };
}
export function createPatientDemographicsWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertCanActivateBillablePatient, assessPatientPayerMutationBoundary, buildPatientIdentityPersistenceFields, cleanObject, currentClinicId, decryptJsonPayload, encryptJsonPayload, enforcePayloadLimit, extractMissingColumnName, extractPatientPhotosStoragePath, fetchClinicDemoState, getBillableActivePatientCount, hasGlobalClinicAccess, inspectFinancialPlanInsuranceOperationalFields, isBillableActivePatientStatus, isExplicitDemoUser, isMissingRelationError, isUuid, normalizeBrazilMobilePhone, normalizeCanonicalPatientName, normalizeCpf, normalizePatientInsuranceEligibilityPayload, normalizePatientInsuranceTypeForPersistence, patientNameWordCount, patientPayloadRequestsInsuranceOperationalOutsideFinancialPlans, persistActivityLog, persistPatientFinancialPlans, pseudonymizeValue, queueActivePatientSync, redactPatientRecordPayloadForCapabilities, requireClinicCapability, resolvePatientInsurancePayerSelection, resolvePatientPhotoUrl, sanitizeClinicalPayload, sanitizeEmail, sanitizePhone, sanitizeString, sendBillingUpgradeRequired, shouldPreserveExistingPatientFullName, updatePatientPortalUserMirrorWithSchemaFallback, supabase, crypto, PATIENT_STATUS_ACTIVE, PATIENT_STATUS_PENDING_ANAMNESIS } = getDeps();
    try {
      const context = req.authorizationContext as ResolvedClinicCapabilityContext;
      const explicitDemoUser = isExplicitDemoUser(req.session.user);
      const canChangeClinic = false;
      const role = context.role;
      const scopedClinicId = context.clinicId;
      const demoClinicState = await fetchClinicDemoState(scopedClinicId);
      const rawEmail = req.body?.email;
      const rawPhone = req.body?.phone;
      const safeEmail = rawEmail !== undefined ? sanitizeEmail(rawEmail) : undefined;
      const safePhone = rawPhone !== undefined ? normalizeBrazilMobilePhone(rawPhone) : undefined;
      const rawCpf = req.body?.cpf;
      const safeCpf = rawCpf !== undefined ? normalizeCpf(rawCpf) : undefined;
      const rawTherapistId = req.body?.therapist_id;
      const safeTherapistId = rawTherapistId !== undefined ? sanitizeString(rawTherapistId, 120) : undefined;
      const canAssignTherapist = context.capabilities.has('team.patient_primary.manage');

      if (explicitDemoUser && req.body?.clinic_id !== undefined) {
        return res.status(403).json({
          success: false,
          error: 'A conta demo não pode transferir pacientes entre clínicas.'
        });
      }
      if (demoClinicState.isDemo) {
        const demoEmails = [
          rawEmail,
          req.body?.responsibleEmail,
          req.body?.responsible_email
        ].map((value) => sanitizeString(value, 320).toLowerCase()).filter(Boolean);
        if (demoEmails.some((email) => !email.endsWith('.invalid'))) {
          return res.status(400).json({
            success: false,
            error: 'Use apenas e-mail fictício terminado em .invalid no ambiente demo.'
          });
        }
        const submittedDemoPii = [
          rawCpf,
          rawPhone,
          req.body?.responsibleCpf,
          req.body?.responsible_cpf,
          req.body?.responsiblePhone,
          req.body?.responsible_phone
        ].some((value) => Boolean(sanitizeString(value, 120)));
        if (submittedDemoPii) {
          return res.status(400).json({
            success: false,
            error: 'CPF e telefone reais não devem ser informados no ambiente demo.'
          });
        }
      }
      if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() && !safeEmail) {
        return res.status(400).json({ success: false, error: 'E-mail inválido. Informe um domínio válido.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !safePhone) {
        return res.status(400).json({ success: false, error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).' });
      }
      if (rawCpf !== undefined && rawCpf !== null && String(rawCpf).trim() && !safeCpf) {
        return res.status(400).json({ success: false, error: 'CPF inválido. Informe 11 dígitos.' });
      }

      const payerMutationBoundary = await assessPatientPayerMutationBoundary({
        clinicId: scopedClinicId,
        patientId: sanitizeString(req.params.id, 120),
        body: req.body,
        capabilities: context.capabilities,
      });
      if (!payerMutationBoundary.ok) {
        return res.status(payerMutationBoundary.status).json({ success: false, error: payerMutationBoundary.error });
      }
      const requestedPlanInsuranceFields = inspectFinancialPlanInsuranceOperationalFields(
        payerMutationBoundary.explicitPlans.plans,
      );
      const hasInsurancePatchOutsideFinancialPlans = patientPayloadRequestsInsuranceOperationalOutsideFinancialPlans(req.body);
      if (
        !context.capabilities.has('patient.insurance.edit') &&
        (
          hasInsurancePatchOutsideFinancialPlans ||
          requestedPlanInsuranceFields.any
        )
      ) {
        return res.status(403).json({ success: false, error: 'PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED' });
      }
      const hasClinicalPatch = [
        req.body?.diagnosis,
        req.body?.notes,
        req.body?.anamnesisData,
        req.body?.anamnesis_data,
        req.body?.anamnese,
      ].some((value) => value !== undefined);
      const aggregateRecordPayloadRaw =
        req.body?.recordPayload && typeof req.body.recordPayload === 'object' && !Array.isArray(req.body.recordPayload)
          ? req.body.recordPayload
          : null;
      if (aggregateRecordPayloadRaw && !enforcePayloadLimit(req, res, 768 * 1024, 'Atualização e prontuário do paciente')) return;
      if (hasClinicalPatch && !context.capabilities.has('clinical.record.view')) {
        return res.status(403).json({ success: false, error: 'CLINICAL_RECORD_CAPABILITY_REQUIRED' });
      }
      if (aggregateRecordPayloadRaw && !context.capabilities.has('clinical.record.view')) {
        return res.status(403).json({ success: false, error: 'CLINICAL_RECORD_CAPABILITY_REQUIRED' });
      }
      if (rawTherapistId !== undefined && !canAssignTherapist) {
        return res.status(403).json({ success: false, error: 'TEAM_PATIENT_PRIMARY_CAPABILITY_REQUIRED' });
      }
      if (req.body?.clinic_id !== undefined && !context.capabilities.has('patient.clinic_link.manage')) {
        return res.status(403).json({ success: false, error: 'PATIENT_CLINIC_LINK_CAPABILITY_REQUIRED' });
      }

      const requestedStatusPatch = req.body?.status !== undefined ? sanitizeString(req.body?.status, 40) : undefined;
      const requestedOnboardingPatch = sanitizeString(req.body?.onboardingStatus || req.body?.onboarding_status, 80).toUpperCase();
      const requestedAnamnesisRequired = req.body?.anamnesisRequired ?? req.body?.anamnesis_required;
      const safeStatusPatch =
        requestedStatusPatch?.toUpperCase() === PATIENT_STATUS_ACTIVE &&
        requestedAnamnesisRequired !== false &&
        !['READY_FOR_CARE', 'ANAMNESIS_REVIEWED'].includes(requestedOnboardingPatch)
          ? PATIENT_STATUS_PENDING_ANAMNESIS
          : requestedStatusPatch;
      let currentPatientForNameGuard: any = null;
      if (req.body?.name !== undefined) {
        let currentPatientQuery = supabase
          .from('patients')
          .select('id, name, clinic_id, therapist_id')
          .eq('id', req.params.id)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (scopedClinicId) {
          currentPatientQuery = currentPatientQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          currentPatientQuery = currentPatientQuery.eq('is_demo', true);
        }
        const { data: currentPatientData, error: currentPatientError } = await currentPatientQuery.maybeSingle();
        if (!currentPatientError) {
          currentPatientForNameGuard = currentPatientData;
        } else if (!isMissingRelationError(currentPatientError)) {
          console.warn('[Patients] name guard lookup warning:', currentPatientError?.message || String(currentPatientError));
        }
      }
      const requestedPatientName =
        req.body?.name !== undefined ? normalizeCanonicalPatientName(req.body?.name) : undefined;
      const preserveExistingFullName = req.body?.name !== undefined
        ? shouldPreserveExistingPatientFullName(currentPatientForNameGuard?.name, requestedPatientName)
        : false;
      if (preserveExistingFullName) {
        console.warn('[Patients] Preservando nome completo canônico contra payload curto.', {
          patientId: sanitizeString(req.params.id, 120),
          currentWords: patientNameWordCount(currentPatientForNameGuard?.name),
          incomingWords: patientNameWordCount(requestedPatientName)
        });
      }
      const rawProfilePicturePath = req.body?.profilePicturePath ?? req.body?.profile_picture_path;
      const safeProfilePicturePath = rawProfilePicturePath !== undefined
        ? extractPatientPhotosStoragePath(rawProfilePicturePath)
        : undefined;
      const safeProfilePicture =
        req.body?.profilePicture !== undefined || req.body?.profile_picture !== undefined || safeProfilePicturePath !== undefined
          ? await resolvePatientPhotoUrl(req.body?.profilePicture || req.body?.profile_picture, safeProfilePicturePath)
          : undefined;

      const hasIdentityPersistencePatch = [
        'type',
        'patientProfileType',
        'patient_profile_type',
        'panelType',
        'panel_type',
        'profileType',
        'profile_type',
        'socialName',
        'social_name',
        'birthDate',
        'birth_date',
        'dataNascimento',
        'gender',
        'genero',
        'insuranceType',
        'insurance_type',
        'insuranceName',
        'insurance_name',
        'insuranceCardNumber',
        'insurance_card_number',
        'insuranceCardValidUntil',
        'insurance_card_valid_until',
        'insurancePlanCategory',
        'insurance_plan_category',
        'insuranceHolderName',
        'insurance_holder_name',
        'insuranceHolderCpf',
        'insurance_holder_cpf',
        'insuranceHolderRelationship',
        'insurance_holder_relationship',
        'insuranceEligibilityNotes',
        'eligibilityNotes',
        'eligibility_notes',
        'convenioTipo',
        'convenioNome',
        'convenioCarteirinha',
        'convenioCarteirinhaValidade',
        'convenioPlanoCategoria',
        'convenioTitularNome',
        'convenioTitularCpf',
        'convenioTitularRelacao',
        'convenioElegibilidadeObs',
        'group',
        'patient_group',
        'source',
        'lead_source',
        'rg',
        'cep',
        'responsibleName',
        'responsible_name',
        'responsibleBirthDate',
        'responsible_birth_date',
        'responsibleCpf',
        'responsible_cpf',
        'responsiblePhone',
        'responsible_phone',
        'responsibleEmail',
        'responsible_email',
        'responsibleRelationship',
        'responsible_relationship',
        'responsavelRelacao',
        'guardian',
        'address',
        'isMinor',
        'is_minor',
        'menorDeIdade',
        'profilePicture',
        'profile_picture',
        'profilePicturePath',
        'profile_picture_path',
        'insurancePayerId',
        'insurance_payer_id',
        'convenioPayerId',
        'convenio_payer_id'
      ].some((key) => req.body?.[key] !== undefined);
      const hasInsuranceCoveragePatch = [
        'insuranceType',
        'insurance_type',
        'convenioTipo',
        'insuranceName',
        'insurance_name',
        'convenioNome',
        'insurancePayerId',
        'insurance_payer_id',
        'convenioPayerId',
        'convenio_payer_id',
      ].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
      let patientIdentityPayload = req.body || {};
      if (hasInsuranceCoveragePatch) {
        const targetClinicId = sanitizeString(
          canChangeClinic && req.body?.clinic_id !== undefined
            ? req.body.clinic_id
            : scopedClinicId,
          120,
        );
        let existingInsurancePayerId = '';
        let currentInsuranceQuery = supabase
          .from('patients')
          .select('id,clinic_id,therapist_id,insurance_payer_id')
          .eq('id', req.params.id)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          currentInsuranceQuery = currentInsuranceQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          currentInsuranceQuery = currentInsuranceQuery.eq('is_demo', true);
        }
        if (role === 'therapist') {
          currentInsuranceQuery = currentInsuranceQuery.eq(
            'therapist_id',
            sanitizeString(req.session.user?.id, 120),
          );
        }
        const { data: currentInsurancePatient, error: currentInsuranceError } =
          await currentInsuranceQuery.maybeSingle();
        if (currentInsuranceError && !extractMissingColumnName(currentInsuranceError)) {
          throw currentInsuranceError;
        }
        existingInsurancePayerId = sanitizeString(
          currentInsurancePatient?.insurance_payer_id,
          120,
        );
        const payerSelection = await resolvePatientInsurancePayerSelection({
          clinicId: targetClinicId,
          body: req.body || {},
          requireSelection:
            normalizePatientInsuranceTypeForPersistence(
              req.body?.insuranceType || req.body?.insurance_type || req.body?.convenioTipo,
            ) === 'convenio',
          allowInactivePayerId: existingInsurancePayerId || null,
        });
        if (!payerSelection.ok) {
          return res.status(payerSelection.status).json({
            success: false,
            error: payerSelection.error,
            code: 'PATIENT_INSURANCE_PAYER_INVALID',
          });
        }
        patientIdentityPayload = {
          ...(req.body || {}),
          insurancePayerId: payerSelection.payerId,
          insurance_payer_id: payerSelection.payerId,
          convenioPayerId: payerSelection.payerId,
          convenio_payer_id: payerSelection.payerId,
          insuranceType: payerSelection.insuranceType,
          convenioTipo: payerSelection.insuranceType,
          ...(payerSelection.payerName
            ? {
                insuranceName: payerSelection.payerName,
                convenioNome: payerSelection.payerName,
              }
            : {}),
        };
      }
      const updates = cleanObject({
        name: req.body?.name !== undefined && !preserveExistingFullName ? (requestedPatientName || undefined) : undefined,
        email: safeEmail,
        phone: safePhone !== undefined ? safePhone : undefined,
        cpf: safeCpf !== undefined ? safeCpf : undefined,
        age: req.body?.age !== undefined ? asSafeNumber(req.body?.age, 0, 130) : undefined,
        diagnosis: req.body?.diagnosis !== undefined ? sanitizeString(req.body?.diagnosis, 2000) : undefined,
        ...(hasIdentityPersistencePatch ? buildPatientIdentityPersistenceFields(patientIdentityPayload, { partial: true }) : {}),
        profile_picture: safeProfilePicture !== undefined ? safeProfilePicture : undefined,
        profile_picture_path: safeProfilePicturePath !== undefined ? safeProfilePicturePath : undefined,
        therapist_id:
          canAssignTherapist && rawTherapistId !== undefined
            ? (isUuid(safeTherapistId) ? safeTherapistId : null)
            : undefined,
        clinic_id: canChangeClinic && req.body?.clinic_id !== undefined ? sanitizeString(req.body?.clinic_id, 100) : undefined,
        status: req.body?.status !== undefined ? safeStatusPatch : undefined
      });

      let billingSourceClinicId = '';
      let activePatientCountBeforeMutation: number | null = null;
      if (updates.status !== undefined || updates.clinic_id !== undefined) {
        let billingScopeQuery = supabase
          .from('patients')
          .select('id, clinic_id')
          .eq('id', req.params.id)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          billingScopeQuery = billingScopeQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          billingScopeQuery = billingScopeQuery.eq('is_demo', true);
        }
        if (role === 'therapist') {
          billingScopeQuery = billingScopeQuery.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const { data: billingPatient, error: billingPatientError } = await billingScopeQuery.maybeSingle();
        if (billingPatientError) throw billingPatientError;
        billingSourceClinicId = sanitizeString(billingPatient?.clinic_id, 120);
        if (isUuid(billingSourceClinicId)) {
          activePatientCountBeforeMutation = await getBillableActivePatientCount({
            supabase,
            clinicId: billingSourceClinicId
          });
        }
      }

      if (updates.status !== undefined && isBillableActivePatientStatus(updates.status)) {
        let activationScopeQuery = supabase
          .from('patients')
          .select('id, clinic_id, status, is_active, deleted_at, therapist_id')
          .eq('id', req.params.id);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          activationScopeQuery = activationScopeQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          activationScopeQuery = activationScopeQuery.eq('is_demo', true);
        }
        if (role === 'therapist') {
          activationScopeQuery = activationScopeQuery.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const { data: activationPatient, error: activationPatientError } = await activationScopeQuery.maybeSingle();
        if (activationPatientError) throw activationPatientError;
        if (!activationPatient?.id) {
          return res.status(404).json({ success: false, error: 'Paciente não encontrado no escopo da clínica.' });
        }
        const activationCheck = await assertCanActivateBillablePatient({
          clinicId: updates.clinic_id || activationPatient.clinic_id || scopedClinicId,
          patientId: sanitizeString(req.params.id, 120),
          targetStatus: updates.status,
          actorUserId: sanitizeString(req.session.user?.id, 120),
          trigger: 'patient_patch'
        });
        if (!activationCheck.ok) {
          return sendBillingUpgradeRequired(res, activationCheck.payload);
        }
      }

      let updatedPatient: any = null;
      let error: any = null;
      const safePatientUpdates: Record<string, any> = { ...updates };

      if (aggregateRecordPayloadRaw) {
        let aggregateScopeQuery = supabase
          .from('patients')
          .select('id, clinic_id, therapist_id, status, email')
          .eq('id', req.params.id)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          aggregateScopeQuery = aggregateScopeQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) aggregateScopeQuery = aggregateScopeQuery.eq('is_demo', true);
        if (role === 'therapist') {
          aggregateScopeQuery = aggregateScopeQuery.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const { data: aggregatePatient, error: aggregateScopeError } = await aggregateScopeQuery.maybeSingle();
        if (aggregateScopeError) throw aggregateScopeError;
        if (!aggregatePatient?.id) {
          return res.status(404).json({ success: false, error: 'Paciente não encontrado no escopo da clínica.' });
        }

        const aggregateClinicId = sanitizeString(aggregatePatient?.clinic_id || scopedClinicId, 120);
        if (!isUuid(aggregateClinicId)) {
          return res.status(400).json({ success: false, error: 'Clínica inválida para persistência do paciente.' });
        }
        const redactedRecordPayload = redactPatientRecordPayloadForCapabilities(
          aggregateRecordPayloadRaw,
          req.session.user,
          context.capabilities,
        );
        const sanitizedRecordPatch = sanitizeClinicalPayload(redactedRecordPayload);
        const existingRecordResult = await supabase
          .from('patient_records')
          .select('payload_encrypted')
          .eq('patient_id', req.params.id)
          .eq('clinic_id', aggregateClinicId)
          .maybeSingle();
        if (existingRecordResult.error) {
          if (isMissingRelationError(existingRecordResult.error)) {
            return res.status(503).json({
              success: false,
              code: 'PERSISTENCE_GUARANTEES_MIGRATION_REQUIRED',
              error: 'A persistência criptografada do prontuário ainda não está disponível no banco.'
            });
          }
          throw existingRecordResult.error;
        }
        const existingEncryptedPayload = String(existingRecordResult.data?.payload_encrypted || '').trim();
        const existingRecordPayload = decryptJsonPayload(existingEncryptedPayload) || {};
        if (existingEncryptedPayload && !existingRecordPayload) {
          return res.status(409).json({
            success: false,
            error: 'Não foi possível descriptografar o prontuário existente. Nenhum dado foi sobrescrito.'
          });
        }
        const mergedRecordPayload = normalizePatientInsuranceEligibilityPayload(sanitizeClinicalPayload(cleanObject({
          ...existingRecordPayload,
          ...sanitizedRecordPatch
        })) || {});
        const encryptedRecordPayload = encryptJsonPayload(mergedRecordPayload);
        const pseudonymSeed = [
          sanitizeString(mergedRecordPayload?.cpf, 30),
          sanitizeString(mergedRecordPayload?.email, 320),
          sanitizePhone(mergedRecordPayload?.telefone) || ''
        ].filter(Boolean).join('|') || sanitizeString(req.params.id, 120);
        const patientRecordRow = cleanObject({
          patient_id: sanitizeString(req.params.id, 120),
          clinic_id: aggregateClinicId,
          therapist_id: isUuid(sanitizeString(req.session.user?.id, 120)) ? sanitizeString(req.session.user?.id, 120) : null,
          pseudonym_id: `pt_${pseudonymizeValue(pseudonymSeed)}`,
          payload_encrypted: encryptedRecordPayload || null,
          payload_preview: cleanObject({
            nome: sanitizeString(mergedRecordPayload?.nome, 120),
            nomeSocial: sanitizeString(mergedRecordPayload?.nomeSocial, 120),
            grupo: sanitizeString(mergedRecordPayload?.grupo, 60),
            convenioNome: sanitizeString(mergedRecordPayload?.convenioNome, 120)
          }),
          updated_at: new Date().toISOString()
        });
        const aggregateMutation = await supabase.rpc('verto_update_patient_aggregate_atomic', {
          p_patient_id: sanitizeString(req.params.id, 120),
          p_clinic_id: aggregateClinicId,
          p_patient_patch: safePatientUpdates,
          p_patient_record: patientRecordRow,
          p_expected_record_ciphertext: existingEncryptedPayload || null,
          p_idempotency_key: sanitizeString(
            req.body?.idempotencyKey || req.body?.idempotency_key || req.headers?.['x-idempotency-key'],
            260
          ) || null
        });
        if (aggregateMutation.error) {
          const message = String(aggregateMutation.error?.message || '').toLowerCase();
          if (sanitizeString(aggregateMutation.error?.code, 40) === '42883' || message.includes('verto_update_patient_aggregate_atomic')) {
            return res.status(503).json({
              success: false,
              code: 'PERSISTENCE_GUARANTEES_MIGRATION_REQUIRED',
              error: 'A migração de garantias de persistência ainda não foi aplicada no Supabase.'
            });
          }
          throw aggregateMutation.error;
        }
        if (aggregateMutation.data?.success === false) {
          return res.status(409).json({
            success: false,
            conflict: aggregateMutation.data?.conflict === true,
            code: sanitizeString(aggregateMutation.data?.code, 80) || 'PATIENT_ATOMIC_PERSISTENCE_REJECTED',
            error: aggregateMutation.data?.error || 'A alteração não foi persistida atomicamente.'
          });
        }
        updatedPatient = aggregateMutation.data?.data || aggregatePatient;
      } else if (Object.keys(safePatientUpdates).length > 0) {
        let patientUpdateQuery = supabase
          .from('patients')
          .update(safePatientUpdates)
          .eq('id', req.params.id)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          patientUpdateQuery = patientUpdateQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          patientUpdateQuery = patientUpdateQuery.eq('is_demo', true);
        }
        if (role === 'therapist') {
          patientUpdateQuery = patientUpdateQuery.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
        }
        const result = await patientUpdateQuery
          .select('id, clinic_id, status, email, therapist_id')
          .maybeSingle();
        updatedPatient = result.data;
        error = result.error;
        if (error) {
          const missingColumn = extractMissingColumnName(error);
          if (missingColumn) {
            return res.status(503).json({
              success: false,
              code: 'PATIENT_PERSISTENCE_SCHEMA_MISMATCH',
              field: missingColumn,
              error: `O campo ${missingColumn} ainda não existe no schema ativo. Nenhum campo foi descartado silenciosamente.`
            });
          }
        }
      } else {
        let patientSelectQuery = supabase
          .from('patients')
          .select('id, clinic_id, status, email, therapist_id')
          .eq('id', req.params.id);
        if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
          patientSelectQuery = patientSelectQuery.eq('clinic_id', scopedClinicId);
        }
        if (explicitDemoUser) {
          patientSelectQuery = patientSelectQuery.eq('is_demo', true);
        }
        const selectResult = await patientSelectQuery.maybeSingle();
        updatedPatient = selectResult.data;
        error = selectResult.error;
      }
      
      if (error) throw error;
      if (aggregateRecordPayloadRaw && Object.prototype.hasOwnProperty.call(aggregateRecordPayloadRaw, 'financialPlans')) {
        const canonicalFinancialPlanSync = await persistPatientFinancialPlans({
          patientId: sanitizeString(req.params.id, 120),
          clinicId: sanitizeString(updatedPatient?.clinic_id || scopedClinicId, 120),
          actorId: sanitizeString(req.session.user?.id, 120),
          financialPlans: Array.isArray(aggregateRecordPayloadRaw.financialPlans) ? aggregateRecordPayloadRaw.financialPlans : [],
          preserveInsuranceContext: payerMutationBoundary.preserveInsuranceContext,
          preserveOmittedInsuranceOperationalFields: !context.capabilities.has('patient.insurance.edit'),
          redactInsuranceOperationalFieldsFromResult: !context.capabilities.has('patient.insurance.view'),
        });
        if (!canonicalFinancialPlanSync.success) {
          return res.status(409).json({
            success: false,
            code: sanitizeString((canonicalFinancialPlanSync as any).code, 120) || 'PATIENT_FINANCIAL_PLAN_PERSISTENCE_FAILED',
            patientPersisted: true,
            financialPlanPersisted: false,
            error: sanitizeString(canonicalFinancialPlanSync.error || canonicalFinancialPlanSync.warning || 'Os dados cadastrais foram preservados, mas o plano financeiro canônico não foi atualizado.', 500),
          });
        }
      }
      const explicitClinicPatch = Object.prototype.hasOwnProperty.call(updates, 'clinic_id')
        ? updates.clinic_id
        : undefined;
      const clinicForSync = sanitizeString(
        explicitClinicPatch ?? updatedPatient?.clinic_id ?? billingSourceClinicId ?? currentClinicId(req.session.user),
        120
      ) || billingSourceClinicId;
      let billingSync: ActivePatientSyncQueueResult | null = null;
      if (isUuid(billingSourceClinicId) && billingSourceClinicId !== clinicForSync) {
        await queueActivePatientSync(billingSourceClinicId, 'patient_patch_source_clinic', {
          previousActivePatientCount: activePatientCountBeforeMutation
        });
      }
      if (isUuid(clinicForSync)) {
        billingSync = await queueActivePatientSync(clinicForSync, 'patient_patch', {
          previousActivePatientCount:
            billingSourceClinicId === clinicForSync ? activePatientCountBeforeMutation : null
        });
      }

      const patientEmail = sanitizeEmail(updatedPatient?.email);
      if (patientEmail) {
        const nextPatientStatus = sanitizeString(
          updates?.status !== undefined ? updates.status : updatedPatient?.status,
          40
        ).toLowerCase();
        const hasClinicLink = Boolean(sanitizeString(updatedPatient?.clinic_id, 120));
        const mappedUserStatus =
          nextPatientStatus === 'inactive' || !hasClinicLink
            ? 'waiting_treatment'
            : nextPatientStatus || 'active';

        const userMirrorResult = await updatePatientPortalUserMirrorWithSchemaFallback({
          email: patientEmail,
          status: mappedUserStatus,
          clinicId: hasClinicLink ? sanitizeString(updatedPatient?.clinic_id, 120) : null
        });
        if (!userMirrorResult.success) {
          const missingColumn = extractMissingColumnName(userMirrorResult.error);
          if (missingColumn) {
            return res.status(503).json({
              success: false,
              code: 'PATIENT_USER_PERSISTENCE_SCHEMA_MISMATCH',
              field: missingColumn,
              error: `O schema de usuários não possui o campo obrigatório ${missingColumn}. A alteração canônica do paciente foi preservada.`
            });
          }
          throw userMirrorResult.error;
        }
      }

      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Cadastro de paciente atualizado',
        content:
          canAssignTherapist && rawTherapistId !== undefined
            ? `Responsável terapêutico do paciente foi atualizado para ${isUuid(safeTherapistId) ? 'profissional selecionado' : 'não atribuído'}.`
            : 'Dados cadastrais do paciente foram atualizados.',
        type: 'management'
      });
      res.json({ success: true, data: updatedPatient, billing: billingSync });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  };
}
