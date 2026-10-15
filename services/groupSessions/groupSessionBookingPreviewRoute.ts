import type { Express } from 'express';
import { previewNewGroupBooking } from './groupSessionBookingPreview';

export function registerGroupSessionBookingPreviewRoute(app: Express, deps: any) {
  app.post('/api/appointments/groups/booking-preview',
    deps.portalActionLimiter, deps.noStoreDynamicResponse, deps.checkAuth,
    deps.requireClinicModule('appointments_communication'),
    deps.requireClinicCapability('calendar.appointment.create'),
    deps.requireClinicCapability('patient.demographics.edit'),
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
        });
        if (!result.ok) {
          const status = result.code.includes('MIGRATION_REQUIRED') ? 503 :
            result.code.includes('OUT_OF_SCOPE') ? 404 :
            result.code.includes('INVALID') ? 422 : 409;
          return res.status(status).json({success:false,code:result.code});
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
