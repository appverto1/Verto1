// Literal handler extraction. Registration and authorization middlewares remain in server.ts.

export function createPatientMaintenancePanelHandler(getDeps: () => { sanitizeString: (value: unknown, maxLength?: number) => string; currentClinicId: any; isUuid: any; parseAbaPageParams: any; hasGlobalClinicAccess: any; supabase: any; ABA_TARGET_RECOMMENDATION_SELECT: any; hasMissingFinancialSchema: any; isMissingRelationError: any; getPatientPeiTargets: any; materializePeiTargetsForMaintenance: any; normalizePeiTargetMatchKey: any; cleanObject: any; sanitizePeiLocalIdentifier: any; isMaintenanceEligibleAbaTarget: any; ABA_MAINTENANCE_SCHEDULE_SELECT: any; ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES: any; enrichMaintenanceRowsWithTargetDisplay: any; readMaintenanceStoredPayload: any; sanitizeClinicalPayload: any; ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES: any; getPersistedMaintenanceScheduleId: any; deriveMaintenanceScheduleStatus: any; ABA_MAINTENANCE_PROBE_RESULT_SELECT: any; ABA_REGRESSION_ALERT_SELECT: any; ABA_MASTERY_LIST_SELECT: any; hasPersistedMaintenanceScheduleId: any }) {
  return async (req: any, res) => {
    const { sanitizeString, currentClinicId, isUuid, parseAbaPageParams, hasGlobalClinicAccess, supabase, ABA_TARGET_RECOMMENDATION_SELECT, hasMissingFinancialSchema, isMissingRelationError, getPatientPeiTargets, materializePeiTargetsForMaintenance, normalizePeiTargetMatchKey, cleanObject, sanitizePeiLocalIdentifier, isMaintenanceEligibleAbaTarget, ABA_MAINTENANCE_SCHEDULE_SELECT, ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES, enrichMaintenanceRowsWithTargetDisplay, readMaintenanceStoredPayload, sanitizeClinicalPayload, ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES, getPersistedMaintenanceScheduleId, deriveMaintenanceScheduleStatus, ABA_MAINTENANCE_PROBE_RESULT_SELECT, ABA_REGRESSION_ALERT_SELECT, ABA_MASTERY_LIST_SELECT, hasPersistedMaintenanceScheduleId } = getDeps();
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      if (!isUuid(patientId)) return res.status(400).json({ success: false, error: 'ID_INVALIDO', message: 'Paciente inválido.' });
      {
        const { page, pageSize } = parseAbaPageParams(req.query);
        const applyClinic = (query: any) => {
          let scoped = organizationId ? query.eq('organization_id', organizationId) : query;
          return !hasGlobalClinicAccess(req.session.user) && clinicId ? scoped.eq('clinic_id', clinicId) : scoped;
        };
        const targetResult = await applyClinic(
          supabase
            .from('aba_targets')
            .select(ABA_TARGET_RECOMMENDATION_SELECT)
            .eq('patient_id', patientId)
            .order('updated_at', { ascending: false })
            .limit(200)
        );
        if (targetResult.error) {
          if (hasMissingFinancialSchema(targetResult.error) || isMissingRelationError(targetResult.error)) {
            return res.json({
              success: true,
              data: {
                eligibleSkills: [],
                maintenanceSkills: [],
                scheduledProbes: [],
                waitingNextSession: [],
                overdueProbes: [],
                regressionRisk: [],
                technicalIssues: [],
                summary: {
                  eligibleSkills: 0,
                  maintenanceSkills: 0,
                  scheduledProbes: 0,
                  waitingNextSession: 0,
                  overdueProbes: 0,
                  regressionRisk: 0,
                  technicalIssues: 0
                },
                skills: [],
                cards: [],
                schedules: [],
                probeResults: [],
                alerts: [],
                source: 'patient_pei_targets_step2'
              },
              page,
              pageSize
            });
          }
          throw targetResult.error;
        }

        let allTargets = Array.isArray((targetResult as any).data) ? (targetResult as any).data : [];
        let peiTargets = await getPatientPeiTargets(patientId, clinicId, organizationId, req.session.user);
        const materializedPeiTargets = await materializePeiTargetsForMaintenance({
          patientId,
          clinicId,
          organizationId,
          sessionUser: req.session.user,
          peiTargets,
          existingTargets: allTargets
        });
        allTargets = materializedPeiTargets.targets;
        peiTargets = materializedPeiTargets.peiTargets;
        const targetById = new Map<string, any>();
        const targetByComposite = new Map<string, any>();
        const duplicateComposite = new Set<string>();
        const targetByName = new Map<string, any>();
        const duplicateName = new Set<string>();
        const registerTargetMatch = (map: Map<string, any>, duplicates: Set<string>, key: string, target: any) => {
          if (!key) return;
          if (map.has(key)) {
            duplicates.add(key);
            map.delete(key);
            return;
          }
          if (!duplicates.has(key)) map.set(key, target);
        };
        allTargets.forEach((target: any) => {
          const targetId = sanitizeString(target?.id, 180);
          if (!isUuid(targetId)) return;
          targetById.set(targetId, target);
          const targetName = sanitizeString(target?.name || target?.description, 240);
          const protocolName = sanitizeString(target?.protocol_title, 240);
          const domainName = sanitizeString(target?.domain_name, 240);
          registerTargetMatch(targetByComposite, duplicateComposite, [targetName, protocolName, domainName].map(normalizePeiTargetMatchKey).filter(Boolean).join('|'), target);
          registerTargetMatch(targetByName, duplicateName, normalizePeiTargetMatchKey(targetName), target);
        });

        const hydratePeiTarget = (peiTarget: any) => {
          const explicitTargetId = sanitizeString(peiTarget?.targetId, 180);
          const explicitTarget = isUuid(explicitTargetId) ? targetById.get(explicitTargetId) : null;
          const compositeKey = sanitizeString(peiTarget?.matchCompositeKey, 500);
          const nameKey = sanitizeString(peiTarget?.matchNameKey, 280);
          const matchedTarget = explicitTarget ||
            (compositeKey && !duplicateComposite.has(compositeKey) ? targetByComposite.get(compositeKey) : null) ||
            (nameKey && !duplicateName.has(nameKey) ? targetByName.get(nameKey) : null) ||
            null;
          return cleanObject({
            ...peiTarget,
            targetId: isUuid(matchedTarget?.id) ? matchedTarget.id : (isUuid(explicitTargetId) ? explicitTargetId : null),
            target: matchedTarget || null,
            targetName: sanitizeString(peiTarget?.targetName || matchedTarget?.name || matchedTarget?.description, 240),
            protocolName: sanitizeString(peiTarget?.protocolName || matchedTarget?.protocol_title, 240) || 'Sem protocolo informado',
            domainName: sanitizeString(peiTarget?.domainName || matchedTarget?.domain_name, 240) || 'Sem domínio informado'
          });
        };
        const eligibleByKey = new Map<string, any>();
        const addEligibleSkill = (source: any) => {
          const target = source?.target || source || {};
          const targetId = sanitizeString(source?.targetId || source?.target_id || target?.id, 180);
          const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
          const goalId = sanitizePeiLocalIdentifier(source?.peiGoalId || source?.goalId || source?.goal_id || masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id, 180);
          const skillId = sanitizePeiLocalIdentifier(source?.skillId || source?.skill_id || masteryCriteria?.skillId || masteryCriteria?.skill_id, 180);
          const localTargetRef = sanitizePeiLocalIdentifier(source?.localTargetRef || masteryCriteria?.localTargetRef || masteryCriteria?.local_target_ref || goalId, 180);
          const targetName = sanitizeString(source?.targetName || source?.target_name || source?.name || target?.name || target?.description, 240);
          if (!targetName) return;
          const protocolName = sanitizeString(source?.protocolName || source?.protocol || source?.protocol_title || target?.protocol_title, 240) || 'Sem protocolo informado';
          const domainName = sanitizeString(source?.domainName || source?.domain || source?.domain_name || target?.domain_name, 240) || 'Sem domínio informado';
          const description = sanitizeString(source?.description || source?.objective || target?.description, 500) || null;
          const compositeKey = [targetName, protocolName, domainName].map(normalizePeiTargetMatchKey).filter(Boolean).join('|');
          const hasRealTarget = isUuid(targetId);
          const realTargetId = hasRealTarget ? targetId : '';
          const sourceIndex = sanitizePeiLocalIdentifier(source?.peiGoalIndex, 40);
          const isPeiSource = source?.source === 'patient_pei';
          // Chave unificada que independe da fonte (PEI ou ABA)
          // Prioriza: targetId real > goalId > compositeKey
          const internalKey = realTargetId
            ? `target:${realTargetId}`
            : goalId
              ? `goal:${goalId}`
              : `skill:${compositeKey}`;
          if (!internalKey) return;
          
          // Se já existe uma entrada com a mesma chave, só substitua se a nova for melhor
          if (eligibleByKey.has(internalKey)) {
            const existing = eligibleByKey.get(internalKey);
            // Prefira targets ABA reais sobre PEI targets sem targetId
            if (!isPeiSource && realTargetId && !existing?.hasRealTarget) {
              eligibleByKey.set(internalKey, cleanObject({
                key: `eligible-${eligibleByKey.size + 1}`,
                cardKind: 'PEI_ACQUIRED_SKILL',
                targetId: realTargetId,
                target_id: realTargetId || null,
                peiGoalId: goalId || null,
                goalId: goalId || null,
                goal_id: goalId || null,
                skillId: skillId || null,
                skill_id: skillId || null,
                localTargetRef: localTargetRef || null,
                hasRealTarget,
                targetName,
                protocol: protocolName,
                domain: domainName,
                protocolName,
                domainName,
                description,
                statusLabel: 'Adquirido',
                clinicalStatus: sanitizeString(source?.clinicalStatus || source?.clinical_status || target?.clinical_status || target?.phase, 80) || null,
                masteryStatus: sanitizeString(source?.masteryStatus || source?.mastery_status, 80) || null,
                progressPercent: 100,
                canScheduleMaintenance: hasRealTarget,
                canWaitNextSession: hasRealTarget,
                canAssignAppointment: false,
                canReviewLink: false,
                needsTargetReview: false,
                availableActions: hasRealTarget ? ['SCHEDULE_MAINTENANCE'] : []
              }));
            }
            return;
          }
          eligibleByKey.set(internalKey, cleanObject({
            key: `eligible-${eligibleByKey.size + 1}`,
            cardKind: 'PEI_ACQUIRED_SKILL',
            targetId: realTargetId,
            target_id: realTargetId || null,
            peiGoalId: goalId || null,
            goalId: goalId || null,
            goal_id: goalId || null,
            skillId: skillId || null,
            skill_id: skillId || null,
            localTargetRef: localTargetRef || null,
            hasRealTarget,
            targetName,
            protocol: protocolName,
            domain: domainName,
            protocolName,
            domainName,
            description,
            statusLabel: 'Adquirido',
            clinicalStatus: sanitizeString(source?.clinicalStatus || source?.clinical_status || target?.clinical_status || target?.phase, 80) || null,
            masteryStatus: sanitizeString(source?.masteryStatus || source?.mastery_status, 80) || null,
            progressPercent: 100,
            canScheduleMaintenance: hasRealTarget,
            canWaitNextSession: hasRealTarget,
            canAssignAppointment: false,
            canReviewLink: false,
            needsTargetReview: false,
            availableActions: hasRealTarget ? ['SCHEDULE_MAINTENANCE'] : []
          }));
        };

        const filteredPeiTargets = peiTargets.filter((target: any) => target?.eligibleForMaintenance);
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[pei-maintenance-panel] PEI targets eligible:', {
            total: peiTargets.length,
            eligible: filteredPeiTargets.length,
            targets: filteredPeiTargets.map((t: any) => ({
              name: t?.targetName,
              status: t?.clinicalStatus,
              eligibleForMaintenance: t?.eligibleForMaintenance,
              peiGoalId: t?.peiGoalId
            }))
          });
        }
        
        filteredPeiTargets
          .map(hydratePeiTarget)
          .forEach(addEligibleSkill);
        
        const filteredAbaTargets = allTargets.filter(isMaintenanceEligibleAbaTarget);
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[pei-maintenance-panel] ABA targets eligible:', {
            total: allTargets.length,
            eligible: filteredAbaTargets.length,
            targets: filteredAbaTargets.map((t: any) => ({
              name: t?.name || t?.description,
              status: t?.clinical_status || t?.phase,
              masteryStatus: t?.mastery_status,
              progress: t?.progress
            }))
          });
        }
        
        filteredAbaTargets
          .forEach((target: any) => addEligibleSkill({
            target,
            targetId: target?.id,
            targetName: target?.name || target?.description,
            protocolName: target?.protocol_title,
            domainName: target?.domain_name,
            description: target?.description,
            clinicalStatus: target?.clinical_status || target?.phase,
            progressPercent: 100
          }));
        const allEligibleSkills = Array.from(eligibleByKey.values());
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[pei-maintenance-panel] Deduplicated eligible skills:', {
            total: allEligibleSkills.length,
            skills: allEligibleSkills.map((s: any) => ({
              key: s?.key,
              targetName: s?.targetName,
              targetId: s?.targetId,
              hasRealTarget: s?.hasRealTarget,
              source: s?.source
            }))
          });
        }
        const eligibleTargetIds = Array.from(new Set(
          allEligibleSkills
            .map((row: any) => sanitizeString(row?.targetId || row?.target_id, 180))
            .filter((id: string) => isUuid(id))
        )).slice(0, 200);
        let activeSchedules: any[] = [];
        const activeScheduleLimit = Math.min(200, Math.max(eligibleTargetIds.length * 2, 50));
        let activeScheduleQuery = supabase
          .from('aba_maintenance_schedules')
          .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
          .eq('organization_id', organizationId)
          .eq('patient_id', patientId)
          .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
          .order('updated_at', { ascending: false })
          .limit(activeScheduleLimit);
        activeScheduleQuery = applyClinic(activeScheduleQuery);
        const activeScheduleResult = await activeScheduleQuery;
        if (activeScheduleResult.error) {
          if (!hasMissingFinancialSchema(activeScheduleResult.error) && !isMissingRelationError(activeScheduleResult.error)) throw activeScheduleResult.error;
        } else {
          activeSchedules = await enrichMaintenanceRowsWithTargetDisplay(activeScheduleResult.data || [], clinicId, organizationId, req.session.user);
        }
        const activeScheduleByTargetId = new Map<string, any>();
        const activeScheduleByPeiSourceId = new Map<string, any>();
        const duplicateSchedulesForReview: any[] = [];
        activeSchedules.forEach((schedule: any) => {
          const scheduleTargetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
          if (isUuid(scheduleTargetId) && !activeScheduleByTargetId.has(scheduleTargetId)) {
            activeScheduleByTargetId.set(scheduleTargetId, schedule);
          } else if (isUuid(scheduleTargetId)) {
            duplicateSchedulesForReview.push(schedule);
          }
        });
        const sanitizeScheduleForPanel = (schedule: any) => {
          const scheduleTargetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
          const scheduleId = sanitizeString(schedule?.id || schedule?.schedule_id || schedule?.scheduleId, 180);
          const raw = readMaintenanceStoredPayload(schedule?.raw_payload || schedule?.rawPayload);
          const target = schedule?.target && typeof schedule.target === 'object' ? schedule.target : {};
          const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
          const clinicalIdentitySource = sanitizeString(schedule?.clinicalIdentitySource || masteryCriteria?.source || raw.clinicalIdentitySource || raw.source, 120);
          return cleanObject({
            id: scheduleId || null,
            scheduleId: scheduleId || null,
            persisted: Boolean(scheduleId),
            hasRealSchedule: Boolean(scheduleId),
            target_id: isUuid(scheduleTargetId) ? scheduleTargetId : null,
            targetId: isUuid(scheduleTargetId) ? scheduleTargetId : null,
            status: sanitizeString(schedule?.status, 80) || 'SCHEDULED',
            due_date: schedule?.due_date || null,
            dueDate: schedule?.due_date || null,
            target_due_date: schedule?.target_due_date || null,
            targetDueDate: schedule?.target_due_date || null,
            scheduled_for: schedule?.scheduled_for || null,
            scheduledFor: schedule?.scheduled_for || null,
            appointment_id: schedule?.appointment_id || null,
            appointmentId: schedule?.appointment_id || null,
            appointment: schedule?.appointment || null,
            candidate_appointment_id: schedule?.candidate_appointment_id || null,
            candidateAppointmentId: schedule?.candidate_appointment_id || null,
            schedule_mode: sanitizeString(schedule?.schedule_mode, 80) || null,
            scheduleMode: sanitizeString(schedule?.schedule_mode, 80) || null,
            targetName: sanitizeString(schedule?.targetName || schedule?.target_name || raw.targetName, 240) || null,
            protocolName: sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || raw.protocolTitle, 240) || null,
            domainName: sanitizeString(schedule?.domainName || schedule?.domain_name || raw.domainName, 240) || null,
            peiGoalId: sanitizePeiLocalIdentifier(schedule?.peiGoalId || schedule?.goalId || schedule?.goal_id || masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id || raw.peiGoalId || raw.goalId || raw.goal_id, 180) || null,
            goalId: sanitizePeiLocalIdentifier(schedule?.goalId || schedule?.goal_id || schedule?.peiGoalId || masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id || raw.goalId || raw.goal_id || raw.peiGoalId, 180) || null,
            goal_id: sanitizePeiLocalIdentifier(schedule?.goal_id || schedule?.goalId || schedule?.peiGoalId || masteryCriteria?.peiGoalId || masteryCriteria?.pei_goal_id || raw.goal_id || raw.goalId || raw.peiGoalId, 180) || null,
            skillId: sanitizePeiLocalIdentifier(schedule?.skillId || schedule?.skill_id || masteryCriteria?.skillId || masteryCriteria?.skill_id || raw.skillId || raw.skill_id, 180) || null,
            skill_id: sanitizePeiLocalIdentifier(schedule?.skill_id || schedule?.skillId || masteryCriteria?.skill_id || masteryCriteria?.skillId || raw.skill_id || raw.skillId, 180) || null,
            localTargetRef: sanitizePeiLocalIdentifier(schedule?.localTargetRef || schedule?.local_target_ref || masteryCriteria?.localTargetRef || masteryCriteria?.local_target_ref || raw.localTargetRef || raw.local_target_ref, 180) || null,
            clinicalIdentitySource: clinicalIdentitySource || null,
            raw_payload: sanitizeClinicalPayload(raw),
            rawPayload: sanitizeClinicalPayload(raw)
          });
        };
        const isPeiMaterializedMaintenanceSource = (source: any) => {
          const raw = readMaintenanceStoredPayload(source?.raw_payload || source?.rawPayload);
          const target = source?.target && typeof source.target === 'object' ? source.target : {};
          const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
          const sourceLabel = sanitizeString(source?.clinicalIdentitySource || masteryCriteria?.source || raw.clinicalIdentitySource || raw.source, 120);
          return ['patient_pei_materialized', 'patient_pei_request', 'patient_pei'].includes(sourceLabel) || raw.materializedForMaintenance === true;
        };
        const getPeiMaintenanceExplicitSourceIds = (source: any) => {
          if (!source) return [];
          const raw = readMaintenanceStoredPayload(source?.raw_payload || source?.rawPayload);
          const target = source?.target && typeof source.target === 'object' ? source.target : {};
          const masteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' ? target.mastery_criteria : {};
          return [
            source?.peiGoalId,
            source?.goalId,
            source?.goal_id,
            source?.skillId,
            source?.skill_id,
            source?.localTargetRef,
            source?.local_target_ref,
            masteryCriteria?.peiGoalId,
            masteryCriteria?.pei_goal_id,
            masteryCriteria?.goalId,
            masteryCriteria?.goal_id,
            masteryCriteria?.skillId,
            masteryCriteria?.skill_id,
            masteryCriteria?.localTargetRef,
            masteryCriteria?.local_target_ref,
            raw.peiGoalId,
            raw.pei_goal_id,
            raw.goalId,
            raw.goal_id,
            raw.skillId,
            raw.skill_id,
            raw.localTargetRef,
            raw.local_target_ref
          ]
            .map((value: any) => sanitizePeiLocalIdentifier(value, 180))
            .filter((value: string, index: number, list: string[]) => Boolean(value) && list.indexOf(value) === index);
        };
        activeSchedules.forEach((schedule: any) => {
          if (!isPeiMaterializedMaintenanceSource(schedule)) return;
          getPeiMaintenanceExplicitSourceIds(schedule).forEach((sourceId: string) => {
            if (!activeScheduleByPeiSourceId.has(sourceId)) activeScheduleByPeiSourceId.set(sourceId, schedule);
          });
        });
        const maintenanceScheduleHasTimingContext = (schedule: any) => Boolean(
          schedule?.appointment_id ||
            schedule?.appointmentId ||
            schedule?.candidate_appointment_id ||
            schedule?.candidateAppointmentId ||
            schedule?.scheduled_for ||
            schedule?.scheduledFor ||
            schedule?.target_due_date ||
            schedule?.targetDueDate ||
            schedule?.due_date ||
            schedule?.dueDate
        );
        const isMaintenanceScheduleLinklessForPanel = (schedule: any, rawStatus: string, derivedStatus: string, rawPendingRestoredAsOperational = false) => {
          const pendingWithTimingContext = rawStatus === 'PENDING' && maintenanceScheduleHasTimingContext(schedule);
          return (
            (ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES.has(rawStatus) && !rawPendingRestoredAsOperational && !pendingWithTimingContext) ||
            (ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES.has(derivedStatus) && !(derivedStatus === 'PENDING' && pendingWithTimingContext))
          );
        };
        const buildScheduledPanelRow = (skill: any, schedule: any, label: string) => {
          const safeSchedule = sanitizeScheduleForPanel(schedule);
          const effectiveTargetId = safeSchedule.targetId || safeSchedule.target_id || skill?.targetId || skill?.target_id || null;
          return cleanObject({
            ...skill,
            key: `${label === 'Aguardando futura sessão' ? 'waiting' : 'scheduled'}-${effectiveTargetId || skill?.key}`,
            targetId: effectiveTargetId,
            target_id: effectiveTargetId,
            statusLabel: label,
            nextSchedule: safeSchedule,
            activeSchedule: safeSchedule,
            schedule: safeSchedule,
            schedules: [safeSchedule],
            dueDate: safeSchedule.target_due_date || safeSchedule.due_date || safeSchedule.scheduled_for || null,
            scheduleId: safeSchedule.scheduleId || safeSchedule.id || null,
            canScheduleMaintenance: true,
            canWaitNextSession: true,
            canAssignAppointment: true,
            availableActions: ['EDIT_SCHEDULE', 'CANCEL_SCHEDULE', 'MOVE_NEXT_SESSION', 'ASSIGN_APPOINTMENT']
          });
        };
        const eligibleSkills: any[] = [];
        const scheduledProbes: any[] = [];
        const waitingNextSession: any[] = [];
        const overdueProbes: any[] = [];
        const emittedActiveScheduleKeys = new Set<string>();
        const findActiveScheduleForSkill = (skill: any) => {
          const skillTargetId = sanitizeString(skill?.targetId || skill?.target_id, 180);
          if (isUuid(skillTargetId) && activeScheduleByTargetId.has(skillTargetId)) return activeScheduleByTargetId.get(skillTargetId);
          for (const sourceId of getPeiMaintenanceExplicitSourceIds(skill)) {
            const schedule = activeScheduleByPeiSourceId.get(sourceId);
            if (schedule) return schedule;
          }
          return null;
        };
        const emitActiveSchedulePanelRow = (skill: any, schedule: any) => {
          const emittedScheduleKey = getPersistedMaintenanceScheduleId(schedule);
          if (emittedScheduleKey && emittedActiveScheduleKeys.has(emittedScheduleKey)) return;
          if (emittedScheduleKey) emittedActiveScheduleKeys.add(emittedScheduleKey);
          const status = sanitizeString(schedule?.status, 80).toUpperCase();
          const derivedStatus = deriveMaintenanceScheduleStatus(schedule, new Date());
          const derivedStatusText = String(derivedStatus).toUpperCase();
          const rawPendingRestoredAsOperational = status === 'PENDING' && derivedStatusText !== 'PENDING';
          if (
            isMaintenanceScheduleLinklessForPanel(schedule, status, derivedStatusText, rawPendingRestoredAsOperational)
          ) {
            waitingNextSession.push(buildScheduledPanelRow(skill, schedule, 'Aguardando futura sessão'));
          } else if (status === 'OVERDUE' || derivedStatusText === 'OVERDUE') {
            overdueProbes.push(buildScheduledPanelRow(skill, schedule, 'Sondagem atrasada'));
          } else {
            scheduledProbes.push(buildScheduledPanelRow(skill, schedule, 'Sondagem agendada'));
          }
        };
        allEligibleSkills.forEach((skill: any) => {
          const schedule = findActiveScheduleForSkill(skill);
          if (!schedule) {
            eligibleSkills.push(skill);
            return;
          }
          emitActiveSchedulePanelRow(skill, schedule);
        });
        activeSchedules.forEach((schedule: any) => {
          const scheduleTargetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
          if (!isUuid(scheduleTargetId)) return;
          const scheduleId = getPersistedMaintenanceScheduleId(schedule);
          if (scheduleId && emittedActiveScheduleKeys.has(scheduleId)) return;
          const raw = readMaintenanceStoredPayload(schedule?.raw_payload || schedule?.rawPayload);
          emitActiveSchedulePanelRow(cleanObject({
            key: `scheduled-target-${scheduleTargetId}`,
            cardKind: 'PEI_SCHEDULED_TARGET',
            targetId: scheduleTargetId,
            target_id: scheduleTargetId,
            hasRealTarget: true,
            targetName: sanitizeString(schedule?.targetName || schedule?.target_name || raw.targetName, 240) || 'Habilidade em manutenção',
            protocol: sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || raw.protocolTitle || raw.protocolName, 240) || 'Sem protocolo informado',
            domain: sanitizeString(schedule?.domainName || schedule?.domain_name || raw.domainName, 240) || 'Sem domínio informado',
            protocolName: sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || raw.protocolTitle || raw.protocolName, 240) || 'Sem protocolo informado',
            domainName: sanitizeString(schedule?.domainName || schedule?.domain_name || raw.domainName, 240) || 'Sem domínio informado',
            description: sanitizeString(schedule?.description || raw.description, 500) || null,
            canScheduleMaintenance: true,
            canWaitNextSession: true,
            canAssignAppointment: true,
            availableActions: ['EDIT_SCHEDULE', 'CANCEL_SCHEDULE', 'MOVE_NEXT_SESSION', 'ASSIGN_APPOINTMENT']
          }), schedule);
        });
        const pagedEligibleSkills = eligibleSkills.slice(0, pageSize);
        const pagedScheduledProbes = scheduledProbes.slice(0, pageSize);
        const pagedWaitingNextSession = waitingNextSession.slice(0, pageSize);
        const pagedOverdueProbes = overdueProbes.slice(0, pageSize);
        const sanitizedSchedules = activeSchedules.map(sanitizeScheduleForPanel);
        const sanitizedDuplicateSchedules = duplicateSchedulesForReview.map(sanitizeScheduleForPanel);
        if (process.env.NODE_ENV !== 'production') {
          const panelEligibleTargetIds = eligibleSkills.map((row: any) => sanitizeString(row?.targetId || row?.target_id, 180)).filter(Boolean).slice(0, 40);
          const panelScheduledTargetIds = [...scheduledProbes, ...waitingNextSession, ...overdueProbes]
            .map((row: any) => sanitizeString(row?.targetId || row?.target_id, 180))
            .filter(Boolean)
            .slice(0, 40);
          const removedEligibleTargetIds = allEligibleSkills
            .map((row: any) => sanitizeString(row?.targetId || row?.target_id, 180))
            .filter((id: string) => isUuid(id) && activeScheduleByTargetId.has(id))
            .slice(0, 40);
          const removedEligibleSourceIds = allEligibleSkills
            .flatMap((row: any) => getPeiMaintenanceExplicitSourceIds(row))
            .filter((sourceId: string) => activeScheduleByPeiSourceId.has(sourceId))
            .slice(0, 40);
          console.debug('[pei-maintenance-panel]', {
            panelEligibleTargetIds,
            panelScheduledTargetIds,
            removedEligibleTargetIds,
            removedEligibleSourceIds,
            reasonForRemoval: 'active_schedule_target_or_pei_source_match'
          });
        }
        return res.json({
          success: true,
          data: {
            eligibleSkills: pagedEligibleSkills,
            maintenanceSkills: [],
            scheduledProbes: pagedScheduledProbes,
            waitingNextSession: pagedWaitingNextSession,
            overdueProbes: pagedOverdueProbes,
            regressionRisk: [],
            technicalIssues: [],
            summary: {
              eligibleSkills: eligibleSkills.length,
              maintenanceSkills: 0,
              scheduledProbes: scheduledProbes.length,
              waitingNextSession: waitingNextSession.length,
              overdueProbes: overdueProbes.length,
              regressionRisk: 0,
              technicalIssues: 0
            },
            skills: pagedEligibleSkills,
            cards: [...pagedEligibleSkills, ...pagedScheduledProbes, ...pagedWaitingNextSession, ...pagedOverdueProbes],
            schedules: sanitizedSchedules,
            duplicateSchedulesForReview: sanitizedDuplicateSchedules,
            probeResults: [],
            alerts: [],
            source: 'patient_pei_targets_step2'
          },
          page,
          pageSize
        });
      }
      const { page, pageSize, from, to } = parseAbaPageParams(req.query);
      const applyClinic = (query: any) => {
        let scoped = organizationId ? query.eq('organization_id', organizationId) : query;
        return !hasGlobalClinicAccess(req.session.user) && clinicId ? scoped.eq('clinic_id', clinicId) : scoped;
      };
      const [scheduleResult, targetResult, probeResult, alertResult, masteryResult] = await Promise.all([
        applyClinic(
          supabase
            .from('aba_maintenance_schedules')
            .select(ABA_MAINTENANCE_SCHEDULE_SELECT)
            .eq('patient_id', patientId)
            .in('status', ABA_ACTIVE_MAINTENANCE_SCHEDULE_STATUSES)
            .order('target_due_date', { ascending: true })
            .range(from, to)
        ),
        applyClinic(
          supabase
            .from('aba_targets')
            .select(ABA_TARGET_RECOMMENDATION_SELECT)
            .eq('patient_id', patientId)
            .order('updated_at', { ascending: false })
            .limit(200)
        ),
        applyClinic(
          supabase
            .from('aba_maintenance_probe_results')
            .select(ABA_MAINTENANCE_PROBE_RESULT_SELECT)
            .eq('patient_id', patientId)
            .order('occurred_at', { ascending: false })
            .limit(200)
        ),
        applyClinic(
          supabase
            .from('aba_regression_alerts')
            .select(ABA_REGRESSION_ALERT_SELECT)
            .eq('patient_id', patientId)
            .is('resolved_at', null)
            .order('created_at', { ascending: false })
            .limit(200)
        ),
        applyClinic(
          supabase
            .from('aba_mastery_evaluations')
            .select(ABA_MASTERY_LIST_SELECT)
            .eq('patient_id', patientId)
            .order('evaluated_at', { ascending: false })
            .limit(200)
        )
      ]);
      const firstError = [scheduleResult, targetResult, probeResult, alertResult, masteryResult].find((result: any) => result.error)?.error;
      if (firstError) {
        if (hasMissingFinancialSchema(firstError)) {
          return res.json({
            success: true,
            data: {
              eligibleSkills: [],
              maintenanceSkills: [],
              scheduledProbes: [],
              waitingNextSession: [],
              overdueProbes: [],
              regressionRisk: [],
              technicalIssues: [],
              skills: [],
              orphanSchedules: [],
              cards: [],
              schedules: [],
              targets: [],
              probeResults: [],
              alerts: []
            },
            page,
            pageSize
          });
        }
        throw firstError;
      }
      const enrichedSchedules = await enrichMaintenanceRowsWithTargetDisplay((scheduleResult as any).data || [], clinicId, organizationId, req.session.user);
      const primarySchedulesByTargetId = new Map<string, any>();
      const duplicateSchedulesForReview: any[] = [];
      const orphanScheduleRows: any[] = [];
      enrichedSchedules.forEach((schedule: any) => {
        const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
        if (!isUuid(targetId) || schedule?.target_missing) {
          orphanScheduleRows.push(schedule);
          return;
        }
        if (!primarySchedulesByTargetId.has(targetId)) {
          primarySchedulesByTargetId.set(targetId, schedule);
          return;
        }
        duplicateSchedulesForReview.push(schedule);
      });
      const schedulesForMainFlow = [...Array.from(primarySchedulesByTargetId.values()), ...orphanScheduleRows];
      let allTargets = Array.isArray((targetResult as any).data) ? (targetResult as any).data : [];
      let peiTargets = await getPatientPeiTargets(patientId, clinicId, organizationId, req.session.user);
      const materializedPeiTargets = await materializePeiTargetsForMaintenance({
        patientId,
        clinicId,
        organizationId,
        sessionUser: req.session.user,
        peiTargets,
        existingTargets: allTargets
      });
      allTargets = materializedPeiTargets.targets;
      peiTargets = materializedPeiTargets.peiTargets;
      const probeResults = Array.isArray((probeResult as any).data) ? (probeResult as any).data : [];
      const alerts = Array.isArray((alertResult as any).data) ? (alertResult as any).data : [];
      const masteryEvaluations = Array.isArray((masteryResult as any).data) ? (masteryResult as any).data : [];
      const latestResultByTargetId = new Map<string, any>();
      const latestResultByScheduleId = new Map<string, any>();
      probeResults.forEach((result: any) => {
        const targetId = sanitizeString(result?.target_id || result?.targetId, 180);
        const scheduleId = sanitizeString(result?.maintenance_schedule_id || result?.maintenanceScheduleId, 180);
        if (isUuid(targetId) && !latestResultByTargetId.has(targetId)) latestResultByTargetId.set(targetId, result);
        if (hasPersistedMaintenanceScheduleId(scheduleId) && !latestResultByScheduleId.has(scheduleId)) latestResultByScheduleId.set(scheduleId, result);
      });
      const alertByTargetId = new Map<string, any>();
      alerts.forEach((alert: any) => {
        const targetId = sanitizeString(alert?.target_id || alert?.targetId, 180);
        if (isUuid(targetId) && !alertByTargetId.has(targetId)) alertByTargetId.set(targetId, alert);
      });
      const latestMasteryByTargetId = new Map<string, any>();
      masteryEvaluations.forEach((evaluation: any) => {
        const targetId = sanitizeString(evaluation?.target_id || evaluation?.targetId, 180);
        if (isUuid(targetId) && !latestMasteryByTargetId.has(targetId)) latestMasteryByTargetId.set(targetId, evaluation);
      });
      const activeScheduleByTargetId = new Map<string, any>();
      schedulesForMainFlow.forEach((schedule: any) => {
        const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
        if (isUuid(targetId) && !schedule?.target_missing && !activeScheduleByTargetId.has(targetId)) {
          activeScheduleByTargetId.set(targetId, schedule);
        }
      });
      const targetById = new Map<string, any>();
      const targetByComposite = new Map<string, any>();
      const duplicateComposite = new Set<string>();
      const targetByName = new Map<string, any>();
      const duplicateName = new Set<string>();
      const registerTargetMatch = (map: Map<string, any>, duplicates: Set<string>, key: string, target: any) => {
        if (!key) return;
        if (map.has(key)) {
          duplicates.add(key);
          map.delete(key);
          return;
        }
        if (!duplicates.has(key)) map.set(key, target);
      };
      allTargets.forEach((target: any) => {
        const targetId = sanitizeString(target?.id, 180);
        if (!isUuid(targetId)) return;
        targetById.set(targetId, target);
        const targetName = sanitizeString(target?.name || target?.description, 240);
        const protocolName = sanitizeString(target?.protocol_title, 240);
        const domainName = sanitizeString(target?.domain_name, 240);
        registerTargetMatch(targetByComposite, duplicateComposite, [targetName, protocolName, domainName].map(normalizePeiTargetMatchKey).filter(Boolean).join('|'), target);
        registerTargetMatch(targetByName, duplicateName, normalizePeiTargetMatchKey(targetName), target);
      });
      const hydratePeiTarget = (peiTarget: any) => {
        const explicitTarget = isUuid(sanitizeString(peiTarget?.targetId, 180)) ? targetById.get(sanitizeString(peiTarget.targetId, 180)) : null;
        const compositeKey = sanitizeString(peiTarget?.matchCompositeKey, 500);
        const nameKey = sanitizeString(peiTarget?.matchNameKey, 280);
        const matchedTarget = explicitTarget ||
          (compositeKey && !duplicateComposite.has(compositeKey) ? targetByComposite.get(compositeKey) : null) ||
          (nameKey && !duplicateName.has(nameKey) ? targetByName.get(nameKey) : null) ||
          null;
        const targetId = sanitizeString(matchedTarget?.id || peiTarget?.targetId, 180);
        return cleanObject({
          ...peiTarget,
          targetId: isUuid(targetId) ? targetId : null,
          target: matchedTarget || null,
          hasRealTarget: Boolean(isUuid(targetId) && matchedTarget?.id),
          needsTargetReview: !Boolean(isUuid(targetId) && matchedTarget?.id),
          canScheduleMaintenance: Boolean(isUuid(targetId) && matchedTarget?.id),
          canWaitNextSession: Boolean(isUuid(targetId) && matchedTarget?.id),
          canAssignAppointment: Boolean(isUuid(targetId) && matchedTarget?.id),
          canReviewLink: !Boolean(isUuid(targetId) && matchedTarget?.id)
        });
      };
      const hydratedPeiTargets = peiTargets.map(hydratePeiTarget);
      const isMasteryEvaluationComplete = (evaluation: any) => {
        const status = sanitizeString(evaluation?.status || evaluation?.statusCode, 80).toUpperCase();
        const legacyStatus = sanitizeString(evaluation?.evaluation_status || evaluation?.evaluationStatus, 80).toLowerCase();
        return (
          ['READY_FOR_REVIEW', 'MASTERED_APPROVED', 'MET_TODAY'].includes(status) ||
          ['met', 'mastered'].includes(legacyStatus)
        );
      };
      const targetHasMaintenanceEligibility = (target: any) => {
        const targetId = sanitizeString(target?.id, 180);
        const latestMastery = targetId ? latestMasteryByTargetId.get(targetId) : null;
        return isMaintenanceEligibleAbaTarget(target) || isMasteryEvaluationComplete(latestMastery);
      };
      const scheduledTargetIds = new Set(
        schedulesForMainFlow
          .map((schedule: any) => sanitizeString(schedule?.target_id || schedule?.targetId, 180))
          .filter((targetId: string) => isUuid(targetId))
      );
      const skillTargetRows = allTargets.filter((target: any) => isUuid(sanitizeString(target?.id, 180)));
      const maintenanceTargetRows = allTargets.filter((target: any) => {
        const id = sanitizeString(target?.id, 180);
        if (!isUuid(id) || scheduledTargetIds.has(id)) return false;
        return targetHasMaintenanceEligibility(target);
      });
      const scheduleCards = schedulesForMainFlow.map((schedule: any) => {
        const scheduleId = sanitizeString(schedule?.id, 180);
        const targetId = sanitizeString(schedule?.target_id || schedule?.targetId, 180);
        const targetResolved = Boolean(isUuid(targetId) && !schedule?.target_missing);
        const needsTargetReview = !isUuid(targetId) || Boolean(schedule?.target_missing);
        const kind = needsTargetReview ? 'SCHEDULE_ORFAO' : 'SCHEDULE_VALIDO';
        const legacyType = needsTargetReview ? 'ORPHAN_SCHEDULE' : 'VALID_SCHEDULE';
        const targetName = sanitizeString(
          schedule?.targetName ||
            schedule?.target_name ||
            schedule?.target?.name ||
            (!targetId ? 'Habilidade não vinculada' : 'Habilidade não encontrada'),
          240
        ) || (!targetId ? 'Habilidade não vinculada' : 'Habilidade não encontrada');
        const protocolName = sanitizeString(schedule?.protocolTitle || schedule?.protocol_title || schedule?.target?.protocol_title, 240) || 'Sem protocolo informado';
        const domainName = sanitizeString(schedule?.domainName || schedule?.domain_name || schedule?.target?.domain_name, 240) || 'Sem domínio informado';
        return cleanObject({
          id: scheduleId,
          cardId: scheduleId || targetId,
          cardKind: kind,
          kind,
          type: legacyType,
          scheduleId: scheduleId || null,
          targetId: targetResolved ? targetId : null,
          hasRealTarget: targetResolved,
          targetName,
          protocolName,
          domainName,
          schedule,
          target: schedule?.target || null,
          latestResult: latestResultByScheduleId.get(scheduleId) || (targetResolved ? latestResultByTargetId.get(targetId) : null) || null,
          latestMastery: targetResolved ? latestMasteryByTargetId.get(targetId) || null : null,
          activeAlert: targetResolved ? alertByTargetId.get(targetId) || null : null,
          status: sanitizeString(schedule?.status, 80) || 'PENDING',
          canSchedule: targetResolved,
          canScheduleMaintenance: targetResolved,
          canAssign: targetResolved && hasPersistedMaintenanceScheduleId(scheduleId),
          canWaitNextSession: targetResolved,
          canAssignAppointment: targetResolved && hasPersistedMaintenanceScheduleId(scheduleId),
          canReviewLink: needsTargetReview,
          needsTargetReview,
          availableActions: needsTargetReview
            ? ['REVIEW_TARGET']
            : ['EDIT_SCHEDULE', 'CANCEL_SCHEDULE', 'MOVE_NEXT_SESSION', 'ASSIGN_APPOINTMENT']
        });
      });
      const targetCards = maintenanceTargetRows.map((target: any) => {
        const targetId = sanitizeString(target?.id, 180);
        const targetName = sanitizeString(target?.name || target?.description, 240) || 'Habilidade sem nome';
        const protocolName = sanitizeString(target?.protocol_title, 240) || 'Sem protocolo informado';
        const domainName = sanitizeString(target?.domain_name, 240) || 'Sem domínio informado';
        const latestMastery = latestMasteryByTargetId.get(targetId) || null;
        return cleanObject({
          id: targetId,
          cardId: targetId,
          cardKind: 'TARGET_REAL_SEM_SCHEDULE',
          kind: 'TARGET_REAL_SEM_SCHEDULE',
          type: 'TARGET_WITHOUT_SCHEDULE',
          scheduleId: null,
          targetId,
          hasRealTarget: true,
          targetName,
          protocolName,
          domainName,
          schedule: null,
          target,
          latestResult: latestResultByTargetId.get(targetId) || null,
          latestMastery,
          status: sanitizeString(target?.clinical_status || target?.phase, 80) || 'MAINTENANCE',
          clinicalStatus: sanitizeString(target?.clinical_status || target?.phase, 80) || null,
          masteryStatus: sanitizeString(latestMastery?.status || latestMastery?.evaluation_status, 80) || null,
          progressPercent: isMasteryEvaluationComplete(latestMastery) ? 100 : null,
          canSchedule: true,
          canScheduleMaintenance: true,
          canAssign: false,
          canWaitNextSession: true,
          canAssignAppointment: true,
          canReviewLink: false,
          needsTargetReview: false,
          availableActions: ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT']
        });
      });
      const peiTargetCards = hydratedPeiTargets
        .filter((target: any) => target?.eligibleForMaintenance)
        .filter((target: any) => {
          const targetId = sanitizeString(target?.targetId, 180);
          return !targetId || !scheduledTargetIds.has(targetId);
        })
        .map((target: any) => {
          const targetId = sanitizeString(target?.targetId, 180);
          const latestMastery = targetId ? latestMasteryByTargetId.get(targetId) || null : null;
          return cleanObject({
          id: target?.targetId || target?.peiGoalId || target?.targetName,
          cardId: target?.targetId || target?.peiGoalId || target?.targetName,
          cardKind: 'TARGET_REAL_SEM_SCHEDULE',
          kind: 'TARGET_REAL_SEM_SCHEDULE',
          type: 'TARGET_WITHOUT_SCHEDULE',
          scheduleId: null,
          targetId: target?.targetId || null,
          hasRealTarget: Boolean(target?.hasRealTarget),
          targetName: target?.targetName,
          protocolName: target?.protocolName,
          domainName: target?.domainName,
          clinicalStatus: target?.clinicalStatus,
          masteryStatus: target?.masteryStatus,
          progressPercent: target?.progressPercent,
          schedule: null,
          target: target?.target || null,
          latestResult: targetId ? latestResultByTargetId.get(targetId) || null : null,
          latestMastery,
          status: target?.clinicalStatus || target?.masteryStatus || null,
          canSchedule: Boolean(target?.hasRealTarget),
          canScheduleMaintenance: Boolean(target?.hasRealTarget),
          canAssign: false,
          canWaitNextSession: Boolean(target?.hasRealTarget),
          canAssignAppointment: Boolean(target?.hasRealTarget),
          canReviewLink: !target?.hasRealTarget,
          needsTargetReview: !target?.hasRealTarget,
          availableActions: target?.hasRealTarget
            ? ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT']
            : ['REVIEW_TARGET']
          });
        });
      const skills = skillTargetRows.map((target: any) => {
        const targetId = sanitizeString(target?.id, 180);
        const activeSchedule = activeScheduleByTargetId.get(targetId) || null;
        const targetName = sanitizeString(target?.name || target?.description, 240) || 'Habilidade sem nome';
        const protocolName = sanitizeString(target?.protocol_title, 240) || 'Sem protocolo informado';
        const domainName = sanitizeString(target?.domain_name, 240) || 'Sem domínio informado';
        const clinicalStatus = sanitizeString(target?.clinical_status || target?.phase || target?.target_type, 80) || null;
        const latestMastery = latestMasteryByTargetId.get(targetId) || null;
        return cleanObject({
          targetId,
          targetName,
          protocolName,
          domainName,
          clinicalStatus,
          masteryStatus: sanitizeString(latestMastery?.status || latestMastery?.evaluation_status, 80) || null,
          progressPercent: isMasteryEvaluationComplete(latestMastery) ? 100 : null,
          maintenanceStatus: sanitizeString(activeSchedule?.status, 80) || clinicalStatus,
          activeSchedule,
          latestResult: latestResultByTargetId.get(targetId) || null,
          latestMastery,
          activeAlert: alertByTargetId.get(targetId) || null,
          canScheduleMaintenance: true,
          canWaitNextSession: true,
          canAssignAppointment: true,
          needsTargetReview: false
        });
      });
      const peiSkills = hydratedPeiTargets.map((target: any) => cleanObject({
        cardKind: target?.hasRealTarget ? 'TARGET_REAL_SEM_SCHEDULE' : 'PEI_GOAL_REQUIRES_TARGET',
        targetId: target?.targetId || null,
        peiGoalId: target?.peiGoalId || null,
        targetName: target?.targetName,
        protocolName: target?.protocolName,
        domainName: target?.domainName,
        clinicalStatus: target?.clinicalStatus,
        masteryStatus: target?.masteryStatus,
        progressPercent: target?.progressPercent,
        activeSchedule: target?.targetId ? activeScheduleByTargetId.get(target.targetId) || null : null,
        latestResult: target?.targetId ? latestResultByTargetId.get(target.targetId) || null : null,
        canScheduleMaintenance: Boolean(target?.hasRealTarget),
        canWaitNextSession: Boolean(target?.hasRealTarget),
        canAssignAppointment: Boolean(target?.hasRealTarget),
        needsTargetReview: !target?.hasRealTarget
      }));
      const skillsByKey = new Map<string, any>();
      [...skills, ...peiSkills].forEach((skill: any) => {
        const key = sanitizeString(skill?.targetId || skill?.peiGoalId || normalizePeiTargetMatchKey(skill?.targetName), 280);
        if (key && !skillsByKey.has(key)) skillsByKey.set(key, skill);
      });
      const normalizedSkills = Array.from(skillsByKey.values());
      const orphanSchedules = scheduleCards.filter((card: any) => card?.needsTargetReview);
      const now = new Date();
      const fallbackMaintenanceScheduleHasTimingContext = (schedule: any) => Boolean(
        schedule?.appointment_id ||
          schedule?.appointmentId ||
          schedule?.candidate_appointment_id ||
          schedule?.candidateAppointmentId ||
          schedule?.scheduled_for ||
          schedule?.scheduledFor ||
          schedule?.target_due_date ||
          schedule?.targetDueDate ||
          schedule?.due_date ||
          schedule?.dueDate
      );
      const isFallbackMaintenanceScheduleLinklessForPanel = (schedule: any, rawStatus: string, derivedStatus: string, rawPendingRestoredAsOperational = false) => {
        const pendingWithTimingContext = rawStatus === 'PENDING' && fallbackMaintenanceScheduleHasTimingContext(schedule);
        return (
          (ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES.has(rawStatus) && !rawPendingRestoredAsOperational && !pendingWithTimingContext) ||
          (ABA_LINKLESS_MAINTENANCE_SCHEDULE_STATUSES.has(derivedStatus) && !(derivedStatus === 'PENDING' && pendingWithTimingContext))
        );
      };
      const schedulePanelStatus = (schedule: any) => {
        if (!schedule) return 'Sem sondagem agendada';
        const derived = schedule ? deriveMaintenanceScheduleStatus(schedule, now) : 'NO_SCHEDULE';
        if (derived === 'OVERDUE') return 'Atrasada';
        if (derived === 'DUE_TODAY') return 'Para hoje';
        const status = sanitizeString(derived || schedule?.status, 80).toUpperCase();
        if (status === 'PENDING_NEXT_SESSION') return 'Aguardando futura sessão';
        if (status === 'PENDING_CONFIRMATION') return 'Pendente de confirmação';
        if (status === 'PENDING_LINK' || status === 'PENDING_SCHEDULING' || status === 'UNSCHEDULED') return 'Sem sessão vinculada';
        if (status === 'PENDING' && fallbackMaintenanceScheduleHasTimingContext(schedule)) return 'Agendada';
        if (status === 'SCHEDULED') return 'Agendada';
        if (status === 'COMPLETED') return 'Habilidade mantida';
        return status || 'Sem sondagem agendada';
      };
      const targetClinicalStatus = (row: any) => sanitizeString(row?.clinicalStatus || row?.clinical_status || row?.status || row?.phase || row?.target?.clinical_status, 80).toUpperCase();
      const rowHasRegressionRisk = (row: any) => {
        const resultStatus = sanitizeString(row?.latestResult?.status || row?.lastResult?.status, 80).toUpperCase();
        const clinicalStatus = targetClinicalStatus(row);
        return Boolean(row?.activeAlert || ['WATCH', 'REGRESSION_RISK', 'REGRESSION_CONFIRMED'].includes(resultStatus) || ['REGRESSION_RISK', 'REGRESSION_CONFIRMED'].includes(clinicalStatus));
      };
      const toPanelRow = (row: any, group: string) => {
        const schedule = row?.schedule || row?.activeSchedule || null;
        const scheduleId = sanitizeString(row?.scheduleId || schedule?.id, 180);
        const targetId = sanitizeString(row?.targetId || row?.target_id, 180);
        const result = row?.latestResult || null;
        const statusLabel = group === 'technical'
          ? 'Revisar vínculo'
          : group === 'regression'
            ? 'Risco de regressão'
            : schedulePanelStatus(schedule);
        return cleanObject({
          id: row?.id || targetId || scheduleId || row?.cardId,
          key: sanitizeString(row?.cardId || scheduleId || targetId || row?.id || row?.targetName, 280),
          cardId: row?.cardId || scheduleId || targetId || row?.id,
          cardKind: row?.cardKind || row?.kind || (schedule ? 'SCHEDULE_VALIDO' : 'TARGET_REAL_SEM_SCHEDULE'),
          scheduleId: scheduleId || '',
          targetId: isUuid(targetId) ? targetId : null,
          targetName: sanitizeString(row?.targetName || row?.target_name, 240) || (group === 'technical' ? 'Sondagem sem habilidade vinculada' : 'Habilidade sem nome'),
          protocol: sanitizeString(row?.protocol || row?.protocolName || row?.protocol_name, 240) || 'Sem protocolo informado',
          domain: sanitizeString(row?.domain || row?.domainName || row?.domain_name, 240) || 'Sem domínio informado',
          protocolName: sanitizeString(row?.protocolName || row?.protocol || row?.protocol_name, 240) || 'Sem protocolo informado',
          domainName: sanitizeString(row?.domainName || row?.domain || row?.domain_name, 240) || 'Sem domínio informado',
          clinicalStatus: row?.clinicalStatus || row?.status || null,
          masteryStatus: row?.masteryStatus || null,
          progressPercent: row?.progressPercent ?? null,
          activeSchedule: schedule,
          nextSchedule: schedule,
          schedule,
          schedules: schedule ? [schedule] : [],
          latestResult: result,
          lastResult: result,
          latestMastery: row?.latestMastery || null,
          activeAlert: row?.activeAlert || null,
          group: group === 'eligible'
            ? 'activeCycle'
            : group === 'waiting'
              ? 'unlinked'
              : group === 'overdue'
                ? 'overdue'
                : group === 'technical'
                  ? 'unlinked'
                  : 'activeCycle',
          hasRealTarget: Boolean(row?.hasRealTarget && isUuid(targetId)),
          hasRealSchedule: Boolean(hasPersistedMaintenanceScheduleId(scheduleId)),
          needsTargetReview: Boolean(row?.needsTargetReview || group === 'technical'),
          canScheduleMaintenance: Boolean(row?.canScheduleMaintenance && isUuid(targetId)),
          canWaitNextSession: Boolean(row?.canWaitNextSession && isUuid(targetId)),
          canAssignAppointment: Boolean(row?.canAssignAppointment && isUuid(targetId)),
          canReviewLink: Boolean(row?.canReviewLink || group === 'technical'),
          isRegressionRisk: group === 'regression' || rowHasRegressionRisk(row),
          isMaintained: sanitizeString(row?.status, 80).toUpperCase() === 'COMPLETED',
          statusLabel,
          availableActions: row?.availableActions || (group === 'technical' ? ['REVIEW_TARGET'] : ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT'])
        });
      };
      const rowTargetHasActiveSchedule = (row: any) => {
        const targetId = sanitizeString(row?.targetId || row?.target_id, 180);
        return Boolean(isUuid(targetId) && activeScheduleByTargetId.has(targetId));
      };
      const eligibleSourceCards = [...targetCards, ...peiTargetCards].filter((row: any) => !row?.needsTargetReview && !rowTargetHasActiveSchedule(row));
      const maintenanceSourceCards: any[] = [];
      const validScheduleCards = scheduleCards.filter((card: any) => !card?.needsTargetReview);
      const scheduledProbes: any[] = [];
      const waitingNextSession: any[] = [];
      const overdueProbes: any[] = [];
      const regressionRisk: any[] = [];
      validScheduleCards.forEach((card: any) => {
        const schedule = card?.schedule || {};
        const derived = deriveMaintenanceScheduleStatus(schedule, now);
        const rawStatus = sanitizeString(schedule?.status, 80).toUpperCase();
        const derivedText = String(derived).toUpperCase();
        const rawPendingRestoredAsOperational = rawStatus === 'PENDING' && derivedText !== 'PENDING';
        if (rowHasRegressionRisk(card)) {
          regressionRisk.push(toPanelRow(card, 'regression'));
        } else if (derived === 'OVERDUE') {
          overdueProbes.push(toPanelRow(card, 'overdue'));
        } else if (isFallbackMaintenanceScheduleLinklessForPanel(schedule, rawStatus, derivedText, rawPendingRestoredAsOperational)) {
          waitingNextSession.push(toPanelRow(card, 'waiting'));
        } else {
          scheduledProbes.push(toPanelRow(card, 'scheduled'));
        }
      });
      normalizedSkills
        .filter((skill: any) => rowHasRegressionRisk(skill))
        .forEach((skill: any) => {
          const key = sanitizeString(skill?.targetId || skill?.targetName, 280);
          if (!regressionRisk.some((row: any) => sanitizeString(row?.targetId || row?.targetName, 280) === key)) {
            regressionRisk.push(toPanelRow(skill, 'regression'));
          }
        });
      const eligibleSkills = eligibleSourceCards.map((row: any) => toPanelRow(row, 'eligible'));
      const maintenanceSkills = maintenanceSourceCards.map((row: any) => toPanelRow(row, 'maintenance'));
      const technicalIssues = orphanSchedules.map((row: any) => toPanelRow(row, 'technical'));
      const cards = [
        ...eligibleSkills,
        ...maintenanceSkills,
        ...scheduledProbes,
        ...waitingNextSession,
        ...overdueProbes,
        ...regressionRisk,
        ...technicalIssues
      ].slice(0, pageSize);
      return res.json({
        success: true,
        data: {
          eligibleSkills,
          maintenanceSkills,
          scheduledProbes,
          waitingNextSession,
          overdueProbes,
          regressionRisk,
          technicalIssues,
          summary: {
            maintenanceSkills: maintenanceSkills.length,
            eligibleSkills: eligibleSkills.length,
            scheduledProbes: scheduledProbes.length,
            waitingNextSession: waitingNextSession.length,
            overdueProbes: overdueProbes.length,
            regressionRisk: regressionRisk.length,
            technicalIssues: technicalIssues.length
          },
          skills: normalizedSkills,
          orphanSchedules,
          cards,
          schedules: enrichedSchedules,
          duplicateSchedulesForReview,
          targets: skillTargetRows,
          peiTargets: hydratedPeiTargets,
          probeResults,
          alerts,
          masteryEvaluations,
          debugCounts: {
            targetsFromPei: peiTargets.length,
            eligibleTargets: normalizedSkills.filter((skill: any) => skill?.canScheduleMaintenance || skill?.progressPercent >= 100 || ['COMPLETED', 'ACQUIRED', 'ADQUIRIDO', 'MASTERED', 'MAINTENANCE'].includes(sanitizeString(skill?.clinicalStatus, 80).toUpperCase())).length,
            validSchedules: scheduleCards.filter((card: any) => !card?.needsTargetReview).length,
            orphanSchedules: orphanSchedules.length
          }
        },
        page,
        pageSize
      });
    } catch {
      return res.status(500).json({ success: false, error: 'UNEXPECTED_ERROR', message: 'Não foi possível carregar manutenção agora.' });
    }
  };
}
