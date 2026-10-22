// One-time source patch; exact anchor and route boundaries, no network or secrets.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
const path='server.ts';
let source=readFileSync(path,'utf8');
const beginning=source.indexOf("app.post('/api/portal/appointments/:appointmentId/request-cancel'");
const ending=source.indexOf("app.post('/api/portal/sessions/:sessionId/sign'",beginning);
assert.ok(beginning>0&&ending>beginning,'portal cancellation route exists');
const oldText=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
const newText=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      // P1-27: only a DB-proven SENT 24h reminder for this exact session
      // authorizes an immediate cancellation. Any other origin keeps the
      // pre-existing pending request + clinic approval route unchanged.
      const reminderNotificationId = sanitizeString(req.body?.notificationId || req.body?.notification_id, 120);
      if (isUuid(reminderNotificationId)) {
        const { data: automaticCancellation, error: automaticError } = await supabase.rpc(
          'cancel_appointment_from_24h_reminder_v1', {
            p_organization_id: appointment.organization_id || appointment.clinic_id,
            p_clinic_id: appointment.clinic_id,
            p_patient_id: appointment.patient_id,
            p_appointment_id: appointment.id,
            p_notification_id: reminderNotificationId,
            p_actor_id: sanitizeString(req.session.user?.id, 120),
            p_deployment_env: deploymentEnv,
            p_reason: sanitizeTextField(req.body?.reason, 600) || null,
            p_note: sanitizeTextField(req.body?.note || req.body?.observation, 1000) || null,
          }
        );
        if (automaticError) {
          const missingRpc = String(automaticError?.code || '') === 'PGRST202'
            || String(automaticError?.message || '').includes('Could not find the function');
          if (!missingRpc && !isMissingRelationError(automaticError)) throw automaticError;
        } else if (automaticCancellation?.autoCancelled === true) {
          // SQL committed request, appointment cancellation and audit together.
          // A follow-up acknowledgement must never turn success into an error.
          let notificationIds: string[] = [];
          try {
            const acknowledgement = await acknowledgePortalAppointmentNotifications({
              appointment: automaticCancellation.appointment,
              user: req.session.user,
              action: 'cancelled_by_family_from_24h_reminder',
              notificationId: reminderNotificationId
            });
            if (acknowledgement.ok) notificationIds = acknowledgement.notificationIds;
          } catch (acknowledgementError: any) {
            console.warn('[PortalAppointments] automatic cancellation acknowledgement deferred:',
              acknowledgementError?.code || 'NOTIFICATION_ACKNOWLEDGEMENT_FAILED');
          }
          void regenerateClosureForAppointments([appointment.id], req.session.user, 'appointment_cancel_24h_auto');
          const serializedAppointment = await serializePortalAppointmentForFamilyView(automaticCancellation.appointment);
          return res.json(buildPortalAppointmentActionResult({
            action: 'cancelled_by_family_from_24h_reminder',
            appointment: serializedAppointment,
            message: 'Sessão cancelada automaticamente a partir do lembrete de 24 horas.',
            user: req.session.user,
            notificationIds,
            actionRequest: automaticCancellation.actionRequest,
            alreadyAnswered: automaticCancellation.idempotent === true
          }));
        }
      }
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
const route=source.slice(beginning,ending);
assert.equal(route.split(oldText).length-1,1,'old cancellation route changed unexpectedly');
source=source.slice(0,beginning)+route.replace(oldText,newText)+source.slice(ending);
assert.equal(source.includes("cancel_appointment_from_24h_reminder_v1"),true);
writeFileSync(path,source);
console.log('P1-27 portal action: exact scoped 24h reminder branch patched');
