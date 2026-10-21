import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const path='server.ts';
let source=readFileSync(path,'utf8');
const importAnchor="import { validateActiveClinicFinancialPlanSpecialties } from './services/patientFinancialSpecialtyGuard';";
const importNew="import { tryCancelFromVerified24hReminder } from './services/portalVerified24hCancellation';";
assert.equal(source.split(importAnchor).length-1,1,'backend imports drifted');
assert.ok(!source.includes(importNew),'patch already applied');
source=source.replace(importAnchor,importAnchor+'\n'+importNew);
const start=source.indexOf("app.post('/api/portal/appointments/:appointmentId/request-cancel',");
const end=source.indexOf("app.post('/api/portal/sessions/:sessionId/sign',",start);
assert.ok(start>0&&end>start,'portal route not found');
let route=source.slice(start,end);
const anchor=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
const replacement=`      const previousStatus = normalizeOperationalAppointmentStatus(appointment.status);
      // Attempt automatic cancellation only when the *persisted* 24h reminder,
      // sent job, session cycle, authenticated recipient and tenant all match.
      // The SQL RPC is atomic and re-checks status under the appointment lock.
      const verifiedCancellation = await tryCancelFromVerified24hReminder({
        supabase, deploymentEnv,
        appointment, actor: req.session.user,
        notificationId: req.body?.notificationId || req.body?.notification_id,
        reason: req.body?.reason,
        note: req.body?.note || req.body?.observation
      });
      if (verifiedCancellation.applied) {
        const notificationUpdate = await acknowledgePortalAppointmentNotifications({
          appointment: verifiedCancellation.appointment,
          user: req.session.user,
          action: 'cancelled_by_verified_24h_reminder',
          notificationId: req.body?.notificationId || req.body?.notification_id
        }).catch(() => ({ ok: false, notificationIds: [] as string[] }));
        // A notification acknowledgement is not part of the cancellation
        // transaction; it must not turn a committed cancellation into a 500.
        void regenerateClosureForAppointments([appointment.id], req.session.user, 'appointment_cancelled_verified_24h');
        const serializedAppointment = await serializePortalAppointmentForFamilyView(verifiedCancellation.appointment);
        return res.json(buildPortalAppointmentActionResult({
          action: 'cancel_approved_from_24h_reminder',
          appointment: serializedAppointment,
          message: 'Sessão cancelada. A clínica foi informada.',
          user: req.session.user,
          notificationIds: notificationUpdate.notificationIds,
          actionRequest: verifiedCancellation.request,
          alreadyAnswered: verifiedCancellation.idempotent === true
        }));
      }
      // All other origins, including 12h reminders or expired 24h windows,
      // remain ordinary requests awaiting clinic calendar authorization.
      if (isAppointmentTerminalForPortalAction(previousStatus)) return res.status(409).json(portalSafeError(409));
      const requestRow = await createOrUpdateAppointmentActionRequest({`;
assert.equal(route.split(anchor).length-1,1,'cancel route drifted or multiple targets');
route=route.replace(anchor,replacement);
source=source.slice(0,start)+route+source.slice(end);
assert.match(source,/cancel_approved_from_24h_reminder/);
assert.match(source,/tryCancelFromVerified24hReminder/);
writeFileSync(path,source,'utf8');
console.log('P1-27: route + import patched with one exact anchor each');
