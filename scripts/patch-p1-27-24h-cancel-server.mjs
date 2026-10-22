import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
// One-time exact-anchor patch, narrowly limited to the already authenticated
// portal request-cancel route. Does not access infrastructure or secrets.
const p='server.ts';
let source=readFileSync(p,'utf8');
const oldText=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({
        appointment,
        user: req.session.user,
        requestType: 'CANCEL',`;
const newText=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));

      const reminderNotificationId = sanitizeString(req.body?.notificationId || req.body?.notification_id, 120);
      if (reminderNotificationId && !isUuid(reminderNotificationId)) {
        return res.status(400).json(portalSafeError(400));
      }
      if (reminderNotificationId) {
        // The ID is only a locator. PostgreSQL must verify the persisted 24h
        // portal notification, SENT job, clinic, patient, recipient and slot
        // under a single appointment lock. A 12h/legacy/mismatched reminder
        // NEVER receives automatic cancellation privileges.
        const automatic = await supabase.rpc('cancel_appointment_from_24h_reminder_v1', {
          p_organization_id: appointment.organization_id || appointment.clinic_id,
          p_appointment_id: appointment.id,
          p_patient_id: appointment.patient_id,
          p_actor_id: req.session.user?.id,
          p_notification_id: reminderNotificationId,
          p_deployment_env: deploymentEnv,
          p_reason: sanitizeTextField(req.body?.reason, 600) || null,
          p_note: sanitizeTextField(req.body?.note || req.body?.observation, 1000) || null
        });
        if (automatic.error) {
          // Fail closed: never cancel outside the atomic DB gate. A missing
          // migration or invalid delivery falls back to clinic authorization.
          console.warn('[PortalAppointments] 24h cancellation gate unavailable:', sanitizeString(automatic.error.code, 40));
        } else if (automatic.data?.autoCanceled === true) {
          const cancelledAppointment = automatic.data.appointment;
          let notificationIds: string[] = [];
          try {
            const ack = await acknowledgePortalAppointmentNotifications({
              appointment: cancelledAppointment,
              user: req.session.user,
              action: 'cancelled_by_valid_24h_reminder',
              notificationId: reminderNotificationId
            });
            if (ack.ok) notificationIds = ack.notificationIds;
          } catch (ackError: any) {
            console.warn('[PortalAppointments] automatic cancellation persisted; notification acknowledgement failed:', ackError?.message || String(ackError));
          }
          void regenerateClosureForAppointments([appointment.id], req.session.user, 'appointment_auto_cancelled_from_24h_reminder');
          const serialized = await serializePortalAppointmentForFamilyView(cancelledAppointment);
          return res.json(buildPortalAppointmentActionResult({
            action: 'cancelled_by_valid_24h_reminder',
            appointment: serialized,
            message: 'Sessão cancelada automaticamente a partir do lembrete de 24 horas.',
            user: req.session.user,
            notificationIds,
            alreadyAnswered: automatic.data.idempotent === true
          }));
        } else if (automatic.data?.reason === 'ALREADY_CANCELLED_BY_OTHER_ACTION') {
          return res.status(409).json(portalSafeError(409));
        }
      }

      // Manual route (including 12h, no notification or unverified delivery):
      // only records a request pending clinic authorization.
      const requestRow = await createOrUpdateAppointmentActionRequest({
        appointment,
        user: req.session.user,
        requestType: 'CANCEL',`;
assert.equal(source.split(oldText).length-1,1,'portal cancel route anchor changed');
source=source.replace(oldText,newText);
assert.match(source,/cancel_appointment_from_24h_reminder_v1/);
assert.match(source,/patient_confirmation_status: 'CANCEL_REQUESTED'/);
writeFileSync(p,source,'utf8');
console.log('P1-27: verified 24h cancellation installed in portal request route');
