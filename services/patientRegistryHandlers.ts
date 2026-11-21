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
