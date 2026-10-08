import fs from 'node:fs';

const path = 'server.ts';
let source = fs.readFileSync(path, 'utf8');

const replacements = [
  {
    label: 'confirmation',
    old: `      const notificationUpdate = await acknowledgePortalAppointmentNotifications({
        appointment: persistedAppointment,
        user: req.session.user,
        action: 'confirmed_by_family',
        notificationId: req.body?.notificationId || req.body?.notification_id
      });
      if (!notificationUpdate.ok) {
        return res.status((notificationUpdate as any).status || 404).json(portalSafeError((notificationUpdate as any).status || 404));
      }`,
    neu: `      let notificationIds: string[] = [];
      try {
        const notificationUpdate = await acknowledgePortalAppointmentNotifications({
          appointment: persistedAppointment,
          user: req.session.user,
          action: 'confirmed_by_family',
          notificationId: req.body?.notificationId || req.body?.notification_id
        });
        if (notificationUpdate.ok) {
          notificationIds = notificationUpdate.notificationIds;
        } else {
          console.warn('[PortalAppointments] confirmation persisted but notification acknowledgement was skipped.', {
            status: (notificationUpdate as any).status || null,
            error: (notificationUpdate as any).error || null
          });
        }
      } catch (notificationError: any) {
        console.warn('[PortalAppointments] confirmation persisted but notification acknowledgement failed.', {
          message: sanitizeString(notificationError?.message || String(notificationError), 300)
        });
      }`
  },
  {
    label: 'reschedule',
    old: `      const notificationUpdate = await acknowledgePortalAppointmentNotifications({
        appointment: persistedAppointment,
        user: req.session.user,
        action: 'reschedule_requested_by_family',
        notificationId: req.body?.notificationId || req.body?.notification_id
      });
      if (!notificationUpdate.ok) {
        return res.status((notificationUpdate as any).status || 404).json(portalSafeError((notificationUpdate as any).status || 404));
      }`,
    neu: `      let notificationIds: string[] = [];
      try {
        const notificationUpdate = await acknowledgePortalAppointmentNotifications({
          appointment: persistedAppointment,
          user: req.session.user,
          action: 'reschedule_requested_by_family',
          notificationId: req.body?.notificationId || req.body?.notification_id
        });
        if (notificationUpdate.ok) {
          notificationIds = notificationUpdate.notificationIds;
        } else {
          console.warn('[PortalAppointments] reschedule request persisted but notification acknowledgement was skipped.', {
            status: (notificationUpdate as any).status || null,
            error: (notificationUpdate as any).error || null
          });
        }
      } catch (notificationError: any) {
        console.warn('[PortalAppointments] reschedule request persisted but notification acknowledgement failed.', {
          message: sanitizeString(notificationError?.message || String(notificationError), 300)
        });
      }`
  },
  {
    label: 'cancel',
    old: `      const notificationUpdate = await acknowledgePortalAppointmentNotifications({
        appointment: persistedAppointment,
        user: req.session.user,
        action: 'cancel_requested_by_family',
        notificationId: req.body?.notificationId || req.body?.notification_id
      });
      if (!notificationUpdate.ok) {
        return res.status((notificationUpdate as any).status || 404).json(portalSafeError((notificationUpdate as any).status || 404));
      }`,
    neu: `      let notificationIds: string[] = [];
      try {
        const notificationUpdate = await acknowledgePortalAppointmentNotifications({
          appointment: persistedAppointment,
          user: req.session.user,
          action: 'cancel_requested_by_family',
          notificationId: req.body?.notificationId || req.body?.notification_id
        });
        if (notificationUpdate.ok) {
          notificationIds = notificationUpdate.notificationIds;
        } else {
          console.warn('[PortalAppointments] cancellation request persisted but notification acknowledgement was skipped.', {
            status: (notificationUpdate as any).status || null,
            error: (notificationUpdate as any).error || null
          });
        }
      } catch (notificationError: any) {
        console.warn('[PortalAppointments] cancellation request persisted but notification acknowledgement failed.', {
          message: sanitizeString(notificationError?.message || String(notificationError), 300)
        });
      }`
  },
];

for (const item of replacements) {
  if (!source.includes(item.old)) {
    if (source.includes(item.neu)) continue;
    throw new Error(`Expected block not found: ${item.label}`);
  }
  source = source.replace(item.old, item.neu);
}

const resultReplacements = [
  ['notificationIds: notificationUpdate.notificationIds\n      }));', 'notificationIds\n      }));'],
  ['notificationIds: notificationUpdate.notificationIds,\n        actionRequest:', 'notificationIds,\n        actionRequest:']
];
for (const [oldText, newText] of resultReplacements) {
  if (source.includes(oldText)) source = source.replace(oldText, newText);
}

if (source.includes('notificationIds: notificationUpdate.notificationIds')) {
  throw new Error('A portal action still references notificationUpdate outside the best-effort block.');
}

fs.writeFileSync(path, source);
console.log('P0 agenda post-write patch applied.');
