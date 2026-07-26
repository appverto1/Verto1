import crypto from 'crypto';
import type { Express } from 'express';

type ClinicAppointmentPolicyRouteDeps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireRoles: (...roles: string[]) => any;
  portalActionLimiter: any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
};

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result: any, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

const payloadHash = (value: any) =>
  crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

export function registerClinicAppointmentPolicyRoutes(
  app: Express,
  deps: ClinicAppointmentPolicyRouteDeps
) {
  const {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    requireRoles,
    portalActionLimiter,
    sanitizeString,
    currentClinicId
  } = deps;

  app.get(
    '/api/clinic/appointment-policy',
    noStoreDynamicResponse,
    checkAuth,
    requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'),
    async (req: any, res: any) => {
      try {
        const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
        if (!clinicId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        const result = await supabase
          .from('clinics')
          .select('id,allow_patient_reschedule,updated_at')
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
            updatedAt: result.data.updated_at || null,
            canManage: ['owner', 'admin', 'coordinator'].includes(
              sanitizeString(req.session?.user?.role, 40).toLowerCase()
            )
          }
        });
      } catch (error: any) {
        console.warn('[ClinicAppointmentPolicy] read failed', {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(error?.message, 200)
        });
        return res.status(500).json({
          success: false,
          error: 'CLINIC_POLICY_READ_FAILED',
          message: 'Não foi possível carregar a política de reagendamento.'
        });
      }
    }
  );

  app.patch(
    '/api/clinic/appointment-policy',
    portalActionLimiter,
    noStoreDynamicResponse,
    checkAuth,
    requireRoles('coordinator', 'admin', 'owner'),
    async (req: any, res: any) => {
      try {
        const clinicId = sanitizeString(currentClinicId(req.session?.user), 120);
        const actorId = sanitizeString(req.session?.user?.id, 120);
        const idempotencyKey = sanitizeString(req.body?.idempotencyKey, 180);
        if (!clinicId || !actorId) return res.status(403).json({ success: false, error: 'CLINIC_REQUIRED' });
        if (typeof req.body?.allowPatientReschedule !== 'boolean') {
          return res.status(422).json({
            success: false,
            error: 'CLINIC_POLICY_VALUE_REQUIRED',
            message: 'Informe se pacientes podem solicitar reagendamento.'
          });
        }
        if (!idempotencyKey) {
          return res.status(422).json({
            success: false,
            error: 'CLINIC_POLICY_IDEMPOTENCY_REQUIRED',
            message: 'A alteração precisa de uma chave idempotente.'
          });
        }
        const operation = {
          allowPatientReschedule: req.body.allowPatientReschedule,
          reason: sanitizeString(req.body?.reason, 1000) || null,
          idempotencyKey
        };
        const result = await supabase.rpc('set_clinic_patient_reschedule_policy_v1', {
          p_actor_id: actorId,
          p_clinic_id: clinicId,
          p_allow_patient_reschedule: operation.allowPatientReschedule,
          p_reason: operation.reason,
          p_idempotency_key: idempotencyKey,
          p_payload_hash: payloadHash(operation)
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
        console.warn('[ClinicAppointmentPolicy] write failed', {
          code: sanitizeString(error?.code, 80),
          message: sanitizeString(message, 200)
        });
        return res.status(500).json({
          success: false,
          error: 'CLINIC_POLICY_WRITE_FAILED',
          message: 'Não foi possível salvar a política de reagendamento.'
        });
      }
    }
  );
}
