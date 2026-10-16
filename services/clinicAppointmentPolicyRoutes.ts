import { registerGroupSessionRoutes } from './groupSessions/groupSessionRoutes';
import {registerClinicSchedulingSpecialtyRoute} from './groupSessions/clinicSchedulingSpecialtyRoute';
import { clinicPolicyPayloadHash } from './clinicPolicyPayloadHash';
import type { Express } from 'express';
import { registerModulePurchaseEligibilityRoutes } from './modulePurchaseEligibilityRoutes';
import { registerHelpCenterRoutes } from './helpCenterRoutes';
import { registerGroupSessionPricePreviewRoute } from './groupSessions/groupSessionPricePreviewRoute';
import { registerGroupSessionBookingPreviewRoute } from './groupSessions/groupSessionBookingPreviewRoute';
import { registerGroupSessionFinancialRateRoutes } from './groupSessions/groupSessionFinancialRateRoutes';

type ClinicAppointmentPolicyRouteDeps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: any) => any;
  requireAnyClinicCapability: (...capabilities: any[]) => any;
  requireClinicModule: (moduleKey: any) => any;
  portalActionLimiter: any;
  enforcePayloadLimit: (req: any, res: any, maxBytes: number, label?: string) => boolean;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
  serializeGroupAppointment?: (row: any) => any;
  onGroupAppointmentsPersisted?: (params: any) => Promise<void>;
};

export function registerClinicAppointmentPolicyRoutes(
  app: Express,
  deps: ClinicAppointmentPolicyRouteDeps
) {
  registerClinicSchedulingSpecialtyRoute(app, deps);
  if (deps.serializeGroupAppointment) registerGroupSessionRoutes(app, deps);

  const {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    requireAnyClinicCapability,
    requireClinicModule,
    portalActionLimiter,
    enforcePayloadLimit,
    sanitizeString,
    currentClinicId
  } = deps;

  app.get(
    '/api/clinic/appointment-policy',
    noStoreDynamicResponse,
    checkAuth,
    requireClinicModule('appointments_communication'),
    requireAnyClinicCapability('calendar.own.view', 'calendar.clinic.view', 'calendar.team.view', 'clinic.settings.view'),
    async (req: any, res: any) => {
      try {
        const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
        if (!clinicId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        const result = await supabase
          .from('clinics')
          .select('id,allow_patient_reschedule,auto_no_show_enabled,no_show_tolerance_minutes,no_show_mode,updated_at')
          .eq('id', clinicId)
          .limit(1)
          .maybeSingle();
        if (result.error) throw result.error;
        if (!result.data?.id) return res.status(404).json({ success: false, error: 'CLINIC_NOT_FOUND' });
        return res.json({
          success: true,
          data: {
            clinicId: result.data.id,
            allowPatientReschedule: result.data.allow_patient_reschedule !== false,
            autoNoShowEnabled: result.data.auto_no_show_enabled !== false,
            noShowToleranceMinutes: Number(result.data.no_show_tolerance_minutes || 30),
            noShowMode: String(result.data.no_show_mode || 'AUTO').toUpperCase() === 'REVIEW' ? 'REVIEW' : 'AUTO',
            updatedAt: result.data.updated_at || null,
            canManage: req.authorizationContext?.capabilities?.has('clinic.settings.edit') === true
          }
        });
      } catch (error: any) {
        const message = String(error?.message || error?.code || '');
        if (/auto_no_show_enabled|no_show_tolerance_minutes|no_show_mode|PGRST202|42703/i.test(message)) {
          return res.status(503).json({
            success: false,
            error: 'SESSION_ATTENDANCE_POLICY_MIGRATION_REQUIRED',
            retryable: false,
            message: 'A atualização de presença e falta ainda precisa ser aplicada no banco.'
          });
        }
        console.warn('[ClinicAppointmentPolicy] read failed', {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(message, 200)
        });
        return res.status(500).json({
          success: false,
          error: 'CLINIC_POLICY_READ_FAILED',
          message: 'Não foi possível carregar a política operacional da agenda.'
        });
      }
    }
  );

  app.patch(
    '/api/clinic/appointment-policy',
    portalActionLimiter,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicModule('appointments_communication'),
    requireClinicCapability('clinic.settings.edit'),
    async (req: any, res: any) => {
      try {
        if (!enforcePayloadLimit(req, res, 16 * 1024, 'Política operacional da agenda')) return;
        const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
        const actorId = sanitizeString(req.session?.user?.id, 120);
        const idempotencyKey = sanitizeString(req.body?.idempotencyKey, 180);
        if (!clinicId || !actorId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        if (!idempotencyKey) {
          return res.status(422).json({
            success: false,
            error: 'CLINIC_POLICY_IDEMPOTENCY_REQUIRED',
            message: 'A alteração precisa de uma chave idempotente.'
          });
        }

        const currentResult = await supabase
          .from('clinics')
          .select('id,allow_patient_reschedule,auto_no_show_enabled,no_show_tolerance_minutes,no_show_mode')
          .eq('id', clinicId)
          .limit(1)
          .maybeSingle();
        if (currentResult.error) throw currentResult.error;
        if (!currentResult.data?.id) {
          return res.status(404).json({ success: false, error: 'CLINIC_NOT_FOUND' });
        }

        const allowPatientReschedule = typeof req.body?.allowPatientReschedule === 'boolean'
          ? req.body.allowPatientReschedule
          : currentResult.data.allow_patient_reschedule !== false;
        const autoNoShowEnabled = typeof req.body?.autoNoShowEnabled === 'boolean'
          ? req.body.autoNoShowEnabled
          : currentResult.data.auto_no_show_enabled !== false;
        const noShowToleranceMinutes = req.body?.noShowToleranceMinutes === undefined
          ? Number(currentResult.data.no_show_tolerance_minutes || 30)
          : Number(req.body.noShowToleranceMinutes);
        const noShowMode = sanitizeString(
          req.body?.noShowMode || currentResult.data.no_show_mode || 'AUTO',
          20
        ).toUpperCase();

        if (!Number.isInteger(noShowToleranceMinutes) || noShowToleranceMinutes < 5 || noShowToleranceMinutes > 180) {
          return res.status(422).json({
            success: false,
            error: 'CLINIC_POLICY_NO_SHOW_TOLERANCE_INVALID',
            message: 'A tolerância para falta deve ser um número inteiro entre 5 e 180 minutos.'
          });
        }
        if (!['AUTO', 'REVIEW'].includes(noShowMode)) {
          return res.status(422).json({
            success: false,
            error: 'CLINIC_POLICY_NO_SHOW_MODE_INVALID',
            message: 'Escolha classificação automática ou revisão pela equipe.'
          });
        }

        const operation = {
          allowPatientReschedule,
          autoNoShowEnabled,
          noShowToleranceMinutes,
          noShowMode,
          reason: sanitizeString(req.body?.reason, 1000) || null,
          idempotencyKey
        };
        const result = await supabase.rpc('set_clinic_appointment_policy_v2', {
          p_actor_id: actorId,
          p_clinic_id: clinicId,
          p_allow_patient_reschedule: operation.allowPatientReschedule,
          p_auto_no_show_enabled: operation.autoNoShowEnabled,
          p_no_show_tolerance_minutes: operation.noShowToleranceMinutes,
          p_no_show_mode: operation.noShowMode,
          p_reason: operation.reason,
          p_idempotency_key: idempotencyKey,
          p_payload_hash: clinicPolicyPayloadHash(operation)
        });
        if (result.error) throw result.error;
        return res.json(result.data);
      } catch (error: any) {
        const message = String(error?.message || error?.code || '');
        if (/IDEMPOTENCY_CONFLICT/i.test(message)) {
          return res.status(409).json({
            success: false,
            error: 'CLINIC_POLICY_IDEMPOTENCY_CONFLICT',
            message: 'Esta tentativa já foi usada com outro valor.'
          });
        }
        if (/ACCESS_DENIED|ACTOR_MISMATCH/i.test(message)) {
          return res.status(403).json({
            success: false,
            error: 'CLINIC_POLICY_ACCESS_DENIED',
            message: 'Você não possui permissão para alterar esta configuração.'
          });
        }
        if (/set_clinic_appointment_policy_v2|auto_no_show_enabled|no_show_tolerance_minutes|no_show_mode|PGRST202|42883|42703/i.test(message)) {
          return res.status(503).json({
            success: false,
            error: 'SESSION_ATTENDANCE_POLICY_MIGRATION_REQUIRED',
            retryable: false,
            message: 'A atualização de presença e falta ainda precisa ser aplicada no banco.'
          });
        }
        console.warn('[ClinicAppointmentPolicy] write failed', {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(message, 200)
        });
        return res.status(500).json({
          success: false,
          error: 'CLINIC_POLICY_WRITE_FAILED',
          message: 'Não foi possível salvar a política operacional da agenda.'
        });
      }
    }
  );

  registerModulePurchaseEligibilityRoutes(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    sanitizeString,
    currentClinicId
  });

  registerHelpCenterRoutes(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    currentClinicId,
    actionLimiter: portalActionLimiter
  });

  // The server's existing clinic-calendar route registrar delegates to this
  // isolated read-only module. No change to its 4.6 MB entrypoint is required.
  registerGroupSessionPricePreviewRoute(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    requireClinicModule,
    portalActionLimiter,
    enforcePayloadLimit,
    currentClinicId
  });

  registerGroupSessionBookingPreviewRoute(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    requireClinicModule,
    portalActionLimiter,
    enforcePayloadLimit,
    currentClinicId
  });

  // Group-rate edits are separately authorized, and the DB's single RPC
  // owns history-safe persistence; the large entrypoint remains untouched.
  registerGroupSessionFinancialRateRoutes(app, {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireClinicCapability,
    requireClinicModule,
    portalActionLimiter,
    enforcePayloadLimit,
    currentClinicId
  });
}
