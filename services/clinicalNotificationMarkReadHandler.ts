// Extraction-only: route registration and checkAuth middleware remain in server.ts.
// Preserve the existing recipient/clinic filters, write payload, and response contracts.
export function createClinicalNotificationMarkReadHandler(getDeps: () => any) {
  return async (req: any, res: any) => {
    const { sanitizeString, currentClinicId, isUuid, supabase, sendRouteDbError, requestIdForLogs } = getDeps();
    const actorId = sanitizeString(req.session?.user?.id, 120);
    const activeClinicId = sanitizeString(currentClinicId(req.session?.user), 120);
    const notificationId = sanitizeString(req.params?.notificationId, 120);
    const source = sanitizeString(req.body?.source || req.query?.source, 40);
    if (!isUuid(actorId) || !isUuid(notificationId)) return res.status(400).json({ success: false, error: 'Notificação inválida.' });
    try {
      const now = new Date().toISOString();
      const table = source === 'clinical_inbox' ? 'clinical_inbox_notifications' : 'clinical_note_mentions';
      let updateQuery = supabase.from(table).update({ read_at: now, updated_at: now }).eq('id', notificationId).eq('recipient_user_id', actorId);
      if (source === 'clinical_inbox' && isUuid(activeClinicId)) updateQuery = updateQuery.eq('clinic_id', activeClinicId);
      const { data, error } = await updateQuery.select('id,read_at').maybeSingle();
      if (error) throw error;
      if (!data?.id) return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
      return res.json({ success: true, data: { id: data.id, readAt: data.read_at } });
    } catch (error: any) {
      return sendRouteDbError(res, '/api/clinical-notifications/:notificationId/read [PATCH]', error, { actorId, notificationId, requestId: requestIdForLogs(req) });
    }
  };
}
