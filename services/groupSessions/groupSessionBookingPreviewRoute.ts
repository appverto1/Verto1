import type { Express } from 'express';
import { previewNewGroupBooking } from './groupSessionBookingPreview';
import { groupSessionErrorMessage } from '../../src/utils/groupSessionApiErrors';

export function registerGroupSessionBookingPreviewRoute(app: Express, deps: any) {
  app.post('/api/appointments/groups/booking-preview',
    deps.portalActionLimiter, deps.noStoreDynamicResponse, deps.checkAuth,
    deps.requireClinicModule('appointments_communication'),
    deps.requireClinicCapability('calendar.appointment.create'),
    deps.requireClinicCapability('patient.demographics.edit'),
    deps.requireClinicCapability('finance.entries.view'),
    async (req: any, res: any) => {
      try {
        if (!deps.enforcePayloadLimit(req,res,8192,'Previa de agendamento em grupo')) return;
        const result = await previewNewGroupBooking({
          supabase: deps.supabase,
          authenticatedClinicId: String(deps.currentClinicId(req.session?.user) || ''),
          patientIds: req.body?.patientIds,
          professionalIds: req.body?.professionalIds,
          specialty: req.body?.specialty,
          date: req.body?.date,
          startTime: req.body?.startTime,
          durationMinutes: req.body?.durationMinutes,
          roomId: req.body?.roomId,
          idempotencyKey: req.body?.idempotencyKey,
          scheduledStartAt: req.body?.scheduledStartAt,
        });
        if (!result.ok) {
          const status = result.code.includes('MIGRATION_REQUIRED') ? 503 :
            result.code.includes('OUT_OF_SCOPE') ? 404 :
            result.code.includes('INVALID') ? 422 : 409;
          // This is an expected, actionable conflict, not an opaque transport error.
          // The patient ID is sourced from validated clinic-scoped rows and may only
          // identify one of the explicitly requested patients.
          const patientId = 'patientId' in result && typeof result.patientId === 'string' &&
            Array.isArray(req.body?.patientIds) && req.body.patientIds.includes(result.patientId)
            ? result.patientId : undefined;
          return res.status(status).json({
            success:false, code:result.code, error:groupSessionErrorMessage(result.code),
            ...(patientId ? {patientId} : {}),
          });
        }
        return res.json({
          success:true, modality:'GROUP', reserved:false, availabilityConfirmed:false,
          patientRates:result.plan.patients.map(patient => ({patientId:patient.patientId, amountCents:patient.priceCents})),
        });
      } catch {
        return res.status(500).json({success:false,code:'GROUP_BOOKING_PREVIEW_FAILED'});
      }
    });
}
