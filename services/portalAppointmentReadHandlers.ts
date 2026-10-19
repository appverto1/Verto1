// Import the canonical portal reschedule contract before the legacy server.ts
// appointment mutation handlers run. The request-reschedule route reads the
// unqualified PORTAL_RESCHEDULE_MAX_OPTIONS (3); without this initializer it
// throws ReferenceError and returns 500 for valid family requests.
// TODO: replace the legacy identifier with an explicit import when the
// mutation route is extracted from server.ts.
import '../src/services/portalRescheduleAvailability';

// Extracted verbatim from server.ts; route middleware stays in the entrypoint.

export function createPortalAppointmentsListHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, getPortalPatientIdsForUser, isUuid, isResponsiblePortalRole, sanitizeEmail, currentClinicId, readPortalPatientContexts, extractMissingColumnName, sanitizeIsoDateTime, parseBoundedListLimit, queryPortalAppointmentsWithSchemaFallback, supabase, hasMissingFinancialSchema, deploymentEnv, buildCalendarAppointmentStart, isMissingRelationError, canPortalUserAccessPatient, readClinicBrandingForFamilyView, readClinicPatientReschedulePolicies, parseAppointmentSourcePayloadForFamilyView, serializePortalAppointmentForFamilyView, portalSafeError } = getDeps() as { sanitizeString: (value: any, max?: number) => string } & Record<string, any>;
    try {
      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const patientIds = await getPortalPatientIdsForUser(req.session.user);
      const authorizedPatientIdSet = new Set(patientIds.filter((patientId) => isUuid(patientId)));
      if (isResponsiblePortalRole(role) && patientIds.length === 0) {
        return res.json({ success: true, data: [] });
      }
      const patientEmails = new Set<string>();
      const patientClinicIds = new Set<string>();
      const portalPatientContextsById = new Map<string, any>();
      const sessionPatientEmail = sanitizeEmail(req.session.user?.email);
      const sessionClinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (sessionPatientEmail) patientEmails.add(sessionPatientEmail);
      if (isUuid(sessionClinicId)) patientClinicIds.add(sessionClinicId);
      if (patientIds.length > 0) {
        const patientContextResult = await readPortalPatientContexts(patientIds);
        if (patientContextResult.error && !extractMissingColumnName(patientContextResult.error)) {
          throw patientContextResult.error;
        }
        for (const patient of Array.isArray(patientContextResult.data) ? patientContextResult.data : []) {
          const patientId = sanitizeString(patient?.id, 120);
          const email = sanitizeEmail(patient?.email);
          const responsibleEmail = sanitizeEmail(patient?.responsible_email);
          const clinicId = sanitizeString(patient?.clinic_id, 120);
          if (isUuid(patientId)) portalPatientContextsById.set(patientId, patient);
          if (email) patientEmails.add(email);
          if (responsibleEmail) patientEmails.add(responsibleEmail);
          if (isUuid(clinicId)) patientClinicIds.add(clinicId);
        }
      }
      const fromIso = sanitizeIsoDateTime(req.query?.from || new Date(Date.now() - 7 * 86400000).toISOString());
      const toIso = sanitizeIsoDateTime(req.query?.to || new Date(Date.now() + 90 * 86400000).toISOString());
      const limit = parseBoundedListLimit(req.query?.limit, 40, 100);

      const applyPortalAppointmentScope = (query: any) => {
        if (patientIds.length > 0) return query.in('patient_id', patientIds);
        if (!isResponsiblePortalRole(role)) {
          const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
          if (clinicId) return query.eq('clinic_id', clinicId);
        }
        return query;
      };
      const buildPortalAppointmentRangeQuery = (dateColumn: 'scheduled_at' | 'scheduled_start_at') =>
        queryPortalAppointmentsWithSchemaFallback(
          (selectColumns) =>
            applyPortalAppointmentScope(
              supabase
                .from('appointments')
                .select(selectColumns)
                .gte(dateColumn, fromIso)
                .lte(dateColumn, toIso)
                .order(dateColumn, { ascending: true })
                .limit(limit)
            ),
          `patient_range_${dateColumn}`
        );

      const [scheduledAtResult, scheduledStartResult] = await Promise.all([
        buildPortalAppointmentRangeQuery('scheduled_at'),
        buildPortalAppointmentRangeQuery('scheduled_start_at')
      ]);
      const queryResults = [scheduledAtResult, scheduledStartResult];
      const rowsById = new Map<string, any>();
      for (const result of queryResults) {
        const error = (result as any).error;
        if (error) {
          if (hasMissingFinancialSchema(error)) continue;
          throw error;
        }
        for (const row of Array.isArray((result as any).data) ? (result as any).data : []) {
          const rowId = sanitizeString(row?.id, 120);
          if (rowId && !rowsById.has(rowId)) rowsById.set(rowId, row);
        }
      }
      if (patientEmails.size > 0 && patientClinicIds.size > 0) {
        const emailList = Array.from(patientEmails).slice(0, 10);
        const clinicList = Array.from(patientClinicIds).slice(0, 10);
        const buildPortalAppointmentEmailRangeQuery = (dateColumn: 'scheduled_at' | 'scheduled_start_at') =>
          queryPortalAppointmentsWithSchemaFallback(
            (selectColumns) =>
              supabase
                .from('appointments')
                .select(selectColumns)
                .in('patient_email', emailList)
                .in('clinic_id', clinicList)
                .gte(dateColumn, fromIso)
                .lte(dateColumn, toIso)
                .order(dateColumn, { ascending: true })
                .limit(limit),
            `patient_email_range_${dateColumn}`
          );
        const [emailScheduledAtResult, emailScheduledStartResult] = await Promise.all([
          buildPortalAppointmentEmailRangeQuery('scheduled_at'),
          buildPortalAppointmentEmailRangeQuery('scheduled_start_at')
        ]);
        for (const result of [emailScheduledAtResult, emailScheduledStartResult]) {
          const error = (result as any).error;
          if (error) {
            if (hasMissingFinancialSchema(error) || extractMissingColumnName(error) === 'patient_email') continue;
            throw error;
          }
          for (const row of Array.isArray((result as any).data) ? (result as any).data : []) {
            const rowId = sanitizeString(row?.id, 120);
            if (rowId && !rowsById.has(rowId)) rowsById.set(rowId, row);
          }
        }
      }
      if (rowsById.size < limit && patientClinicIds.size > 0) {
        const clinicList = Array.from(patientClinicIds).slice(0, 10);
        const buildPortalAppointmentClinicRangeQuery = (dateColumn: 'scheduled_at' | 'scheduled_start_at') =>
          queryPortalAppointmentsWithSchemaFallback(
            (selectColumns) =>
              supabase
                .from('appointments')
                .select(selectColumns)
                .in('clinic_id', clinicList)
                .gte(dateColumn, fromIso)
                .lte(dateColumn, toIso)
                .order(dateColumn, { ascending: true })
                .limit(Math.min(200, limit * 4)),
            `clinic_range_${dateColumn}`
          );
        const [clinicScheduledAtResult, clinicScheduledStartResult] = await Promise.all([
          buildPortalAppointmentClinicRangeQuery('scheduled_at'),
          buildPortalAppointmentClinicRangeQuery('scheduled_start_at')
        ]);
        for (const result of [clinicScheduledAtResult, clinicScheduledStartResult]) {
          const error = (result as any).error;
          if (error) {
            if (hasMissingFinancialSchema(error)) continue;
            throw error;
          }
          for (const row of Array.isArray((result as any).data) ? (result as any).data : []) {
            const rowId = sanitizeString(row?.id, 120);
            if (rowId && !rowsById.has(rowId)) rowsById.set(rowId, row);
          }
        }
      }
      const notificationScopedAppointmentIds = new Set<string>();
      if (patientIds.length > 0) {
        const notificationResult = await supabase
          .from('portal_notifications')
          .select('appointment_id')
          .eq('deployment_env', deploymentEnv)
          .in('patient_id', patientIds)
          .is('acknowledged_at', null)
          .limit(Math.min(200, limit * 4));
        if (!notificationResult.error) {
          const scopedNotificationAppointmentIds = Array.from(new Set<string>(
            (notificationResult.data || [])
              .map((row: any) => sanitizeString(row?.appointment_id, 120))
              .filter((id: string) => isUuid(id))
          ));
          for (const id of scopedNotificationAppointmentIds) notificationScopedAppointmentIds.add(id);
          const notificationAppointmentIds = scopedNotificationAppointmentIds.filter((id) => !rowsById.has(id));
          if (notificationAppointmentIds.length > 0) {
            const notificationAppointments = await queryPortalAppointmentsWithSchemaFallback(
              (selectColumns) =>
                supabase
                  .from('appointments')
                  .select(selectColumns)
                  .in('id', notificationAppointmentIds)
                  .limit(Math.min(100, notificationAppointmentIds.length)),
              'notification_appointments'
            );
            if (notificationAppointments.error) {
              if (!hasMissingFinancialSchema(notificationAppointments.error)) throw notificationAppointments.error;
            } else {
              const fromTime = new Date(fromIso).getTime();
              const toTime = new Date(toIso).getTime();
              for (const row of Array.isArray(notificationAppointments.data) ? notificationAppointments.data : []) {
                const rowId = sanitizeString(row?.id, 120);
                const startsAt = buildCalendarAppointmentStart(row).getTime();
                if (!rowId || rowsById.has(rowId)) continue;
                if (Number.isFinite(fromTime) && startsAt < fromTime) continue;
                if (Number.isFinite(toTime) && startsAt > toTime) continue;
                rowsById.set(rowId, row);
              }
            }
          }
        } else if (!isMissingRelationError(notificationResult.error)) {
          throw notificationResult.error;
        }
      }
      if (rowsById.size === 0) {
        const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
        if (!clinicId && !isResponsiblePortalRole(role)) {
          return res.json({ success: true, data: [] });
        }
      }
      const rows = Array.from(rowsById.values())
        .sort((a, b) => buildCalendarAppointmentStart(a).getTime() - buildCalendarAppointmentStart(b).getTime());
      const visibleRows = [];
      for (const row of rows) {
        if (visibleRows.length >= limit) break;
        const rowId = sanitizeString(row?.id, 120);
        const rowPatientId = sanitizeString(row?.patient_id, 120);
        if (
          notificationScopedAppointmentIds.has(rowId) ||
          authorizedPatientIdSet.has(rowPatientId) ||
          await canPortalUserAccessPatient(rowPatientId, row, req.session.user)
        ) {
          visibleRows.push(row);
        }
      }
      const clinicBrandingById = new Map<string, any>();
      await Promise.all(Array.from(patientClinicIds).map(async (clinicId) => {
        clinicBrandingById.set(clinicId, await readClinicBrandingForFamilyView(clinicId));
      }));
      const policyByClinicId = await readClinicPatientReschedulePolicies(
        visibleRows.map((row: any) => {
          const source = parseAppointmentSourcePayloadForFamilyView(row?.source_payload || row?.sourcePayload);
          return row?.clinic_id || row?.clinicId || source?.clinic_id || source?.clinicId;
        })
      );
      return res.json({
        success: true,
        data: await Promise.all(visibleRows.map((row) => {
          const source = parseAppointmentSourcePayloadForFamilyView(row?.source_payload || row?.sourcePayload);
          const patientId = sanitizeString(row?.patient_id || row?.patientId || source?.patient_id || source?.patientId, 120);
          const clinicId = sanitizeString(row?.clinic_id || row?.clinicId || source?.clinic_id || source?.clinicId, 120);
          return serializePortalAppointmentForFamilyView(row, {}, {
            patient: portalPatientContextsById.get(patientId) || null,
            clinicBranding: clinicBrandingById.get(clinicId) || null,
            allowPatientReschedule: policyByClinicId.get(clinicId) !== false
          });
        }))
      });
    } catch (error: any) {
      console.warn('[PortalAppointments] list failed:', error?.message || String(error));
      return res.status(500).json(portalSafeError(500));
    }
  };
}

export function createPortalAppointmentDetailHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { fetchPortalAppointmentForUser, portalSafeError, sanitizeString, supabase, APPOINTMENT_ACTION_REQUEST_SELECT, SESSION_SIGNATURE_SELECT, APPOINTMENT_STATUS_AUDIT_SELECT, APPOINTMENT_CLOSURE_CHECK_SELECT, CLOSURE_ABA_SESSION_SELECT, hasMissingFinancialSchema, serializePortalAppointmentForFamilyView, buildPortalAppointmentHistory, PORTAL_SESSION_CONSENT_TEXT, PORTAL_SESSION_CONSENT_TEXT_VERSION } = getDeps() as { sanitizeString: (value: any, max?: number) => string } & Record<string, any>;
    try {
      const context = await fetchPortalAppointmentForUser(req.params.appointmentId, req.session.user);
      if (!context.ok) return res.status((context as any).status || 404).json(portalSafeError((context as any).status || 404));
      const appointment = (context as any).appointment;
      const appointmentId = sanitizeString(appointment.id, 120);
      const organizationId = sanitizeString(appointment.organization_id || appointment.clinic_id, 120);
      const patientId = sanitizeString(appointment.patient_id, 120);

      const [requestsResult, signaturesResult, auditResult, closureResult, sessionResult] = await Promise.all([
        supabase
          .from('appointment_action_requests')
          .select(APPOINTMENT_ACTION_REQUEST_SELECT)
          .eq('organization_id', organizationId)
          .eq('appointment_id', appointmentId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('session_signatures')
          .select(SESSION_SIGNATURE_SELECT)
          .eq('organization_id', organizationId)
          .eq('appointment_id', appointmentId)
          .eq('status', 'SIGNED')
          .order('signed_at', { ascending: false })
          .limit(5),
        supabase
          .from('appointment_status_audit_logs')
          .select(APPOINTMENT_STATUS_AUDIT_SELECT)
          .eq('organization_id', organizationId)
          .eq('appointment_id', appointmentId)
          .order('performed_at', { ascending: false })
          .limit(20),
        supabase
          .from('appointment_closure_checks')
          .select(APPOINTMENT_CLOSURE_CHECK_SELECT)
          .eq('organization_id', organizationId)
          .eq('appointment_id', appointmentId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('aba_sessions')
          .select(CLOSURE_ABA_SESSION_SELECT)
          .eq('appointment_id', appointmentId)
          .eq('patient_id', patientId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);
      for (const result of [requestsResult, signaturesResult, auditResult, closureResult, sessionResult]) {
        if ((result as any).error && !hasMissingFinancialSchema((result as any).error)) throw (result as any).error;
      }

      const signatures = signaturesResult.error ? [] : signaturesResult.data || [];
      const closure = closureResult.error ? null : closureResult.data || null;
      const checklist = Array.isArray(closure?.checklist) ? closure.checklist : [];
      const signaturePending = checklist.some((item: any) => item?.key === 'signature_present' && item?.status === 'FAILED');
      const session = sessionResult.error ? null : sessionResult.data || null;

      return res.json({
        success: true,
        data: {
          appointment: await serializePortalAppointmentForFamilyView(appointment, {
            signatureStatus: signatures.length > 0 ? 'SIGNED' : signaturePending ? 'PENDING' : 'NOT_REQUIRED',
            signedAt: signatures[0]?.signed_at || null
          }),
          actionRequests: requestsResult.error ? [] : requestsResult.data || [],
          signatures: signatures.map((signature: any) => ({
            signedByName: sanitizeString(signature?.signed_by_name, 180) || 'Responsável',
            signedByRole: sanitizeString(signature?.signed_by_role, 40) || 'responsible',
            signatureType: signature?.signature_type || 'DIGITAL_ACCEPTANCE',
            signedAt: signature?.signed_at || null,
            status: signature?.status || 'SIGNED'
          })),
          history: buildPortalAppointmentHistory(auditResult.error ? [] : auditResult.data || []),
          closure: closure ? {
            readinessStatus: closure.readiness_status || 'UNKNOWN',
            blockingIssuesCount: Number(closure.blocking_issues_count || 0),
            warningIssuesCount: Number(closure.warning_issues_count || 0),
            mainIssues: Array.isArray(closure.main_issues) ? closure.main_issues.slice(0, 4) : [],
            signaturePending
          } : null,
          session: session?.id ? {
            id: sanitizeString(session.id, 180),
            status: session.status || null,
            startedAt: session.started_at || session.actual_start_at || null,
            endedAt: session.ended_at || session.actual_end_at || null,
            durationMinutes: session.duration_minutes || session.actual_duration_minutes || null
          } : null,
          consentText: PORTAL_SESSION_CONSENT_TEXT,
          consentTextVersion: PORTAL_SESSION_CONSENT_TEXT_VERSION
        }
      });
    } catch (error: any) {
      console.warn('[PortalAppointments] detail failed:', error?.message || String(error));
      return res.status(500).json(portalSafeError(500));
    }
  };
}

export function createPortalRescheduleSlotsHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { fetchPortalAppointmentForUser, portalSafeError, readClinicPatientReschedulePolicy, patientRescheduleDisabledResponse, normalizeOperationalAppointmentStatus, isAppointmentTerminalForPortalAction, buildPortalRescheduleAvailabilityForAppointment } = getDeps() as { sanitizeString: (value: any, max?: number) => string } & Record<string, any>;
    try {
      const context = await fetchPortalAppointmentForUser(req.params.appointmentId, req.session.user);
      if (!context.ok) return res.status((context as any).status || 404).json(portalSafeError((context as any).status || 404));
      const appointment = (context as any).appointment;
      const allowPatientReschedule = await readClinicPatientReschedulePolicy(appointment.clinic_id || appointment.clinicId);
      if (!allowPatientReschedule) return res.status(403).json(patientRescheduleDisabledResponse());
      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const result = await buildPortalRescheduleAvailabilityForAppointment(appointment, req.session.user, req.query || {});
      return res.json(result);
    } catch (error: any) {
      console.warn('[PortalReschedule] availability failed:', error?.message || String(error));
      return res.status(500).json(portalSafeError(500));
    }
  };
}
