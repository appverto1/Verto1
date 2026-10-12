import type {CapabilityKey, ClinicBaseRole} from '../src/constants/authorizationModel';
import type {CapabilityOverrideLike} from '../src/utils/authorizationRuntime';
import type {OrganizationModuleKey, OrganizationModuleAccessMode} from '../src/constants/organizationModules';
import type {PortalProfessionalWorkingSchedule} from '../src/services/portalRescheduleAvailability';
type ResolvedClinicCapabilityContext = {
  membershipId: string;
  clinicId: string;
  userId: string;
  role: ClinicBaseRole;
  canSupervise: boolean;
  overrides: CapabilityOverrideLike[];
  capabilities: ReadonlySet<CapabilityKey>;
  modules: ReadonlySet<OrganizationModuleKey>;
  moduleAccessMode: OrganizationModuleAccessMode;
  entitlementVersion: number;
};

// GET /api/clinic/members/:memberId/work-schedule
export function createClinicWorkScheduleReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { currentClinicId, fetchProfessionalWorkingSchedule, logRouteDbError, sanitizeString, supabase } = getDeps();

    try {
      const clinicId = currentClinicId(req.session.user);
      const memberId = sanitizeString(req.params.memberId, 120);
      const requesterId = sanitizeString(req.session.user?.id, 120);
      const authorizationContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      let canView = requesterId === memberId || authorizationContext.capabilities.has('calendar.team.view');
      if (
        canView
        && requesterId !== memberId
        && authorizationContext.canSupervise
        && authorizationContext.role !== 'director'
        && authorizationContext.role !== 'coordinator'
      ) {
        const { data: supervisionLink, error: supervisionError } = await supabase
          .from('clinical_supervision_links')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('supervisor_user_id', requesterId)
          .eq('supervised_user_id', memberId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (supervisionError) throw supervisionError;
        canView = Boolean(supervisionLink?.id);
      }
      if (!canView) return res.status(403).json({ success: false, error: 'Sem permissão para visualizar horários de trabalho.' });
      const data = await fetchProfessionalWorkingSchedule(clinicId, memberId);
      if (!data) return res.status(404).json({ success: false, error: 'Profissional não encontrado nesta clínica.' });
      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/clinic/members/:memberId/work-schedule [GET]', error, {
        memberId: sanitizeString(req.params?.memberId, 120)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível carregar os horários de trabalho.' });
    }

  };
}

// PATCH /api/clinic/members/:memberId/work-schedule
export function createClinicWorkScheduleWriteHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertClinicMemberForWorkSchedule, assertNoOtherWorkspaceScheduleOverlap, currentClinicId, currentClinicTimeZone, enforcePayloadLimit, extractMissingColumnName, isMissingRelationError, logRouteDbError, sanitizeProfessionalWorkingSchedule, sanitizeString, supabase } = getDeps();

    try {
      if (!enforcePayloadLimit(req, res, 24 * 1024, 'Horários de trabalho')) return;
      const clinicId = currentClinicId(req.session.user);
      const memberId = sanitizeString(req.params.memberId, 120);
      const membership = await assertClinicMemberForWorkSchedule(clinicId, memberId);
      if (!membership) return res.status(404).json({ success: false, error: 'Profissional não encontrado nesta clínica.' });
      const actorId = sanitizeString(req.session.user?.id, 120);
      const authorizationContext = req.authorizationContext as ResolvedClinicCapabilityContext;
      if (actorId !== memberId && !authorizationContext.capabilities.has('team.edit')) {
        return res.status(403).json({
          success: false,
          error: 'WORK_SCHEDULE_WRITE_FORBIDDEN',
          message: 'Você só pode editar seus próprios horários neste local.'
        });
      }
      const { data: existingProfile, error: profileError } = await supabase
        .from('professional_profiles')
        .select('user_id,full_name,metadata')
        .eq('user_id', memberId)
        .maybeSingle();
      if (profileError && !isMissingRelationError(profileError)) throw profileError;
      const currentMetadata = existingProfile?.metadata && typeof existingProfile.metadata === 'object'
        ? existingProfile.metadata
        : {};
      const fallbackDuration = asSafeNumber(
        req.body?.defaultSessionDurationMinutes ??
          req.body?.default_session_duration_minutes ??
          currentMetadata?.sessionDurationMinutes ??
          currentMetadata?.defaultSessionDurationMinutes,
        15,
        360
      ) || 50;
      const rawSchedule = req.body?.workSchedule || req.body?.work_schedule || req.body;
      const workSchedule = sanitizeProfessionalWorkingSchedule(rawSchedule, fallbackDuration);
      await assertNoOtherWorkspaceScheduleOverlap(memberId, clinicId, workSchedule);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('clinic_memberships')
        .update({
          work_schedule: workSchedule,
          availability_timezone: currentClinicTimeZone(req.session.user),
          work_schedule_configured_at: now,
          settings_updated_at: now,
          settings_updated_by: actorId
        })
        .eq('clinic_id', clinicId)
        .eq('user_id', memberId)
        .eq('status', 'active')
        .select('user_id,work_schedule,availability_timezone')
        .maybeSingle();
      if (error) throw error;
      return res.json({
        success: true,
        data: {
          memberId,
          workSchedule,
          configured: true,
          professionalName: sanitizeString(existingProfile?.full_name, 180) || null,
          scheduleScope: 'clinic_membership',
          availabilityTimezone: sanitizeString(data?.availability_timezone, 80) || currentClinicTimeZone(req.session.user)
        },
        message: 'Horários de trabalho salvos.'
      });
    } catch (error: any) {
      if (sanitizeString(error?.code, 120) === 'PROFESSIONAL_SCHEDULE_OTHER_WORKSPACE_CONFLICT') {
        return res.status(409).json({
          success: false,
          error: 'PROFESSIONAL_SCHEDULE_OTHER_WORKSPACE_CONFLICT',
          message: 'Este horário coincide com sua disponibilidade em outro local. Ajuste a escala antes de salvar.'
        });
      }
      if (extractMissingColumnName(error)) {
        return res.status(503).json({
          success: false,
          error: 'CLINIC_MEMBERSHIP_SETTINGS_MIGRATION_REQUIRED',
          message: 'A estrutura de horários por clínica precisa ser aplicada antes desta alteração.'
        });
      }
      logRouteDbError('/api/clinic/members/:memberId/work-schedule [PATCH]', error, {
        memberId: sanitizeString(req.params?.memberId, 120)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível salvar os horários de trabalho.' });
    }

  };
}

// POST /api/clinic/members/:memberId/work-schedule/apply
export function createClinicWorkScheduleApplyHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { asSafeNumber, assertClinicMemberForWorkSchedule, cleanObject, currentClinicId, currentClinicTimeZone, enforcePayloadLimit, isUuid, logRouteDbError, professionalSchedulesOverlap, sanitizeProfessionalWorkingSchedule, sanitizeString, supabase } = getDeps();

    try {
      if (!enforcePayloadLimit(req, res, 128 * 1024, 'Aplicação de escala')) return;
      const clinicId = currentClinicId(req.session.user);
      const sourceMemberId = sanitizeString(req.params.memberId, 120);
      const sourceMembership = await assertClinicMemberForWorkSchedule(clinicId, sourceMemberId);
      if (!sourceMembership) return res.status(404).json({ success: false, error: 'Profissional de origem não encontrado nesta clínica.' });

      const targetModeRaw = sanitizeString(req.body?.targetMode || req.body?.target_mode, 40);
      const targetMode = ['selected', 'attendance', 'sameRole', 'sameProfile'].includes(targetModeRaw) ? targetModeRaw : 'selected';
      const selectedTargetIds = Array.from(new Set(
        (Array.isArray(req.body?.targetMemberIds || req.body?.target_member_ids)
          ? (req.body.targetMemberIds || req.body.target_member_ids)
          : [])
          .map((item: any) => sanitizeString(item, 120))
          .filter((item: string) => isUuid(item) && item !== sourceMemberId)
      ));
      const preserveExceptions = req.body?.preserveExceptions !== false && req.body?.preserve_exceptions !== false;

      let membershipQuery = supabase
        .from('clinic_memberships')
        .select('user_id,clinic_id,role,status,work_schedule')
        .eq('clinic_id', clinicId)
        .eq('status', 'active');

      if (targetMode === 'selected' || targetMode === 'sameProfile') {
        if (selectedTargetIds.length === 0) {
          return res.status(400).json({ success: false, error: 'Selecione pelo menos um profissional para receber a escala.' });
        }
        membershipQuery = membershipQuery.in('user_id', selectedTargetIds);
      } else if (targetMode === 'attendance') {
        membershipQuery = membershipQuery.in('role', ['therapist', 'coordinator']);
      } else {
        const sourceRole = sanitizeString(sourceMembership.role, 40);
        if (sourceRole === 'therapist' || sourceRole === 'coordinator') {
          membershipQuery = membershipQuery.in('role', ['therapist', 'coordinator']);
        } else {
          membershipQuery = membershipQuery.eq('role', sourceRole);
        }
      }

      const { data: targetMemberships, error: membershipError } = await membershipQuery;
      if (membershipError) throw membershipError;

      const targetIds = Array.from(new Set(
        (targetMemberships || [])
          .map((membership: any) => sanitizeString(membership?.user_id, 120))
          .filter((item: string) => isUuid(item) && item !== sourceMemberId)
      )).slice(0, 250);

      if ((targetMode === 'selected' || targetMode === 'sameProfile') && targetIds.length !== selectedTargetIds.length) {
        return res.status(403).json({ success: false, error: 'Um ou mais profissionais selecionados não pertencem a esta clínica.' });
      }
      if (targetIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum profissional elegível encontrado para receber a escala.' });
      }

      const rawSchedule = req.body?.workSchedule || req.body?.work_schedule || {};
      const workSchedule = sanitizeProfessionalWorkingSchedule(rawSchedule, asSafeNumber(rawSchedule?.defaultSessionDurationMinutes, 15, 360) || 50);

      const now = new Date().toISOString();
      const actorId = sanitizeString(req.session.user?.id, 120) || null;
      const membershipsByUserId = new Map(
        (targetMemberships || []).map((membership: any) => [sanitizeString(membership?.user_id, 120), membership])
      );
      const nextScheduleByUserId = new Map<string, PortalProfessionalWorkingSchedule>();
      const payloads = targetIds.map((targetId) => {
        const membership = membershipsByUserId.get(targetId) as any;
        const existingSchedule = membership?.work_schedule && typeof membership.work_schedule === 'object'
          ? sanitizeProfessionalWorkingSchedule(
              membership.work_schedule,
              workSchedule.defaultSessionDurationMinutes || 50
            )
          : null;
        const nextSchedule = cleanObject({
          ...workSchedule,
          exceptions: preserveExceptions ? (existingSchedule?.exceptions || []) : (workSchedule.exceptions || [])
        }) as PortalProfessionalWorkingSchedule;
        nextScheduleByUserId.set(targetId, nextSchedule);
        return {
          user_id: targetId,
          clinic_id: clinicId,
          role: membership?.role,
          status: membership?.status || 'active',
          work_schedule: nextSchedule,
          availability_timezone: currentClinicTimeZone(req.session.user),
          work_schedule_configured_at: now,
          settings_updated_at: now,
          settings_updated_by: actorId
        };
      });

      const { data: otherWorkspaceMemberships, error: otherWorkspaceError } = await supabase
        .from('clinic_memberships')
        .select('user_id,clinic_id,work_schedule,status')
        .in('user_id', targetIds)
        .eq('status', 'active')
        .neq('clinic_id', clinicId)
        .not('work_schedule', 'is', null)
        .limit(1000);
      if (otherWorkspaceError) throw otherWorkspaceError;
      const hasCrossWorkspaceConflict = (otherWorkspaceMemberships || []).some((membership: any) => {
        const targetId = sanitizeString(membership?.user_id, 120);
        const nextSchedule = nextScheduleByUserId.get(targetId);
        if (!nextSchedule || !membership?.work_schedule || typeof membership.work_schedule !== 'object') return false;
        return professionalSchedulesOverlap(
          nextSchedule,
          sanitizeProfessionalWorkingSchedule(
            membership.work_schedule,
            nextSchedule.defaultSessionDurationMinutes || 50
          )
        );
      });
      if (hasCrossWorkspaceConflict) {
        return res.status(409).json({
          success: false,
          error: 'PROFESSIONAL_SCHEDULE_OTHER_WORKSPACE_CONFLICT',
          message: 'A escala coincide com a disponibilidade de um profissional em outro local.'
        });
      }

      const { error: upsertError } = await supabase
        .from('clinic_memberships')
        .upsert(payloads, { onConflict: 'user_id,clinic_id' });
      if (upsertError) throw upsertError;

      return res.json({
        success: true,
        data: {
          sourceMemberId,
          affectedMemberIds: targetIds,
          affectedCount: targetIds.length,
          targetMode,
          preserveExceptions
        },
        message: `Escala aplicada para ${targetIds.length} profissional(is).`
      });
    } catch (error: any) {
      logRouteDbError('/api/clinic/members/:memberId/work-schedule/apply [POST]', error, {
        memberId: sanitizeString(req.params?.memberId, 120)
      });
      return res.status(500).json({ success: false, error: 'Não foi possível aplicar a escala em massa.' });
    }

  };
}
