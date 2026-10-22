// Exact-anchor modification of the 4 MB server.ts file. No network/keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const path='server.ts';
let src=fs.readFileSync(path,'utf8');
const original=String.raw`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
const replacement=String.raw`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      // P1-27: the notification identifier is only an untrusted hint. The
      // service-role-only RPC validates a SENT 24h queue job and the current
      // patient/clinic/environment/scheduled instant, then cancels atomically.
      // A 12h, absent, forged, stale or unfinalized reminder continues through
      // the existing clinic-approval request flow, never direct cancellation.
      const sourceNotificationId = sanitizeString(
        req.body?.notificationId || req.body?.notification_id, 120
      );
      const portalActorId = sanitizeString(req.session.user?.id, 120);
      if (isUuid(sourceNotificationId) && isUuid(portalActorId)) {
        const { data: automaticCancel, error: automaticCancelError } = await supabase.rpc(
          'portal_cancel_from_sent_24h_reminder_v1',
          {
            p_organization_id: appointment.organization_id || appointment.clinic_id,
            p_clinic_id: appointment.clinic_id,
            p_patient_id: appointment.patient_id,
            p_appointment_id: appointment.id,
            p_actor_id: portalActorId,
            p_actor_email: sanitizeEmail(req.session.user?.email) || null,
            p_notification_id: sourceNotificationId,
            p_deployment_env: deploymentEnv,
            p_reason: sanitizeTextField(req.body?.reason, 600) || null,
            p_note: sanitizeTextField(req.body?.note || req.body?.observation, 1000) || null
          }
        );
        if (automaticCancelError) {
          if (isMissingRelationError(automaticCancelError) || hasMissingFinancialSchema(automaticCancelError)
            || String(automaticCancelError.message || '').includes('portal_cancel_from_sent_24h_reminder_v1')) {
            return res.status(503).json({ success: false, error: 'Cancelamento indisponível. Tente novamente.' });
          }
          throw automaticCancelError;
        }
        if (automaticCancel?.canceled === true) {
          const persisted = await readPersistedAppointmentRows(
            [appointment.id], sanitizeString(appointment.clinic_id, 120)
          );
          const saved = persisted.find((row: any) => String(row.id) === String(appointment.id));
          if (!saved || normalizeOperationalAppointmentStatus(saved.status) !== 'CANCELLED') {
            return res.status(503).json({ success: false, error: 'Não foi possível verificar o cancelamento.' });
          }
          let notificationIds: string[] = [];
          try {
            const result = await acknowledgePortalAppointmentNotifications({
              appointment: saved,
              user: req.session.user,
              action: 'cancelled_from_24h_reminder',
              notificationId: sourceNotificationId
            });
            if (result.ok) notificationIds = result.notificationIds;
          } catch (error: any) {
            console.warn('[PortalAppointments] 24h cancellation notification acknowledgement failed:',
              error?.message || String(error));
          }
          void regenerateClosureForAppointments(
            [appointment.id], req.session.user, 'appointment_24h_reminder_cancelled'
          );
          const serializedAppointment = await serializePortalAppointmentForFamilyView(saved);
          return res.json(buildPortalAppointmentActionResult({
            action: 'cancelled_from_24h_reminder',
            appointment: serializedAppointment,
            message: 'Sessão cancelada a partir do lembrete de 24 horas.',
            user: req.session.user,
            notificationIds,
            actionRequest: { id: automaticCancel.requestId || null, status: 'APPROVED', request_type: 'CANCEL' }
          }));
        }
      }
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
const routeStart=src.indexOf("  app.post('/api/portal/appointments/:appointmentId/request-cancel'");
assert.ok(routeStart>0, 'portal cancel route must exist');
assert.equal(src.slice(routeStart).split(original).length-1,1,'unexpected route drift');
const within=src.slice(routeStart);
src=src.slice(0,routeStart)+within.replace(original,replacement);
assert.match(src.slice(routeStart,routeStart+6500),/portal_cancel_from_sent_24h_reminder_v1/);
assert.match(src.slice(routeStart,routeStart+9000),/createOrUpdateAppointmentActionRequest/);
fs.writeFileSync(path,src);
console.log('P1-27: 24h-only verified automatic cancellation before manual fallback');
