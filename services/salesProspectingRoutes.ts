// Verto CRM prospecting endpoints.
// Keep the authority in server-injected checkAuth + checkPlatformAdmin (MFA required).
type Dependencies = {
  supabase: any;
  checkAuth: any;
  checkPlatformAdmin: any;
  isUuid: (value: string) => boolean;
  sanitizeString: (value: unknown, limit: number) => string;
};

export function registerSalesProspectingRoutes(
  app: any,
  { supabase, checkAuth, checkPlatformAdmin, isUuid, sanitizeString }: Dependencies,
) {
  app.get('/api/owner/sales/prospecting/attempts', checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
    const leadIds = [...new Set(String(req.query?.leadIds || '').split(',').filter(Boolean))];
    if (leadIds.length === 0 || leadIds.length > 100 || leadIds.some((id) => !isUuid(id))) {
      return res.status(400).json({ success: false, error: 'Lista de leads inválida.' });
    }
    try {
      const [attempts, leads] = await Promise.all([
        supabase.from('sales_prospecting_attempts')
          .select('id,lead_id,channel,outcome,occurred_at')
          .in('lead_id', leadIds)
          .order('occurred_at', { ascending: false })
          .limit(1000),
        supabase.from('sales_leads').select('id,status,lost_at')
          .in('id', leadIds).is('deleted_at', null).limit(100),
      ]);
      if (attempts.error || leads.error) throw attempts.error || leads.error;
      return res.json({ success: true, data: attempts.data || [], leads: leads.data || [] });
    } catch {
      return res.status(500).json({ success: false, error: 'Histórico indisponível.' });
    }
  });

  app.post('/api/owner/sales/leads/:leadId/prospecting-attempts',
    checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
      const leadId = sanitizeString(req.params?.leadId, 120);
      const channel = sanitizeString(req.body?.channel, 32);
      const outcome = sanitizeString(req.body?.outcome, 32);
      const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
      const actorId = sanitizeString(req.session?.user?.id, 120);
      if (!isUuid(leadId) || !isUuid(actorId)
        || !['phone', 'whatsapp_call'].includes(channel)
        || !['no_decisor', 'decisor_spoken'].includes(outcome)
        || key.length < 12 || key.length > 120) {
        return res.status(400).json({ success: false, error: 'Tentativa inválida.' });
      }
      try {
        const { data, error } = await supabase.rpc('record_sales_prospecting_attempt_v1', {
          p_lead_id: leadId, p_channel: channel, p_outcome: outcome,
          p_action_key: key, p_actor_user_id: actorId,
        });
        if (error) {
          const message = String(error.message || '');
          if (message.includes('LEAD_NOT_FOUND')) return res.status(404).json({ success: false, error: 'Lead não encontrado.' });
          if (/IDEMPOTENCY_CONFLICT|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_NOT_ALLOWED/.test(message)) {
            return res.status(409).json({ success: false, error: 'Tentativa indisponível ou limite atingido.' });
          }
          throw error;
        }
        return res.json({ success: true, data });
      } catch {
        return res.status(500).json({ success: false, error: 'Não foi possível registrar a ligação.' });
      }
    },
  );

  app.post('/api/owner/sales/leads/:leadId/mark-lost',
    checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
      const leadId = sanitizeString(req.params?.leadId, 120);
      const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
      const actorId = sanitizeString(req.session?.user?.id, 120);
      if (!isUuid(leadId) || !isUuid(actorId) || key.length < 12 || key.length > 120) {
        return res.status(400).json({ success: false, error: 'Ação inválida.' });
      }
      try {
        const { data, error } = await supabase.rpc('mark_sales_prospecting_lead_lost_v1', {
          p_lead_id: leadId, p_action_key: key, p_actor_user_id: actorId,
        });
        if (error) {
          const message = String(error.message || '');
          if (message.includes('LEAD_NOT_FOUND')) return res.status(404).json({ success: false, error: 'Lead não encontrado.' });
          if (message.includes('CONVERTED_LEAD_CANNOT_BE_LOST')) {
            return res.status(409).json({ success: false, error: 'Cliente convertido não pode ser perdido.' });
          }
          throw error;
        }
        return res.json({ success: true, data });
      } catch {
        return res.status(500).json({ success: false, error: 'Não foi possível marcar o lead como perdido.' });
      }
    },
  );
}
