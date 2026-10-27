// Verto CRM prospecting endpoints. Backend permission checks are mandatory.
// The optional provided platform guard is server.ts's canonical MFA guard. In the
// small-module bridge, use the same DB-backed active-platform-admin + TOTP checks.
type Dependencies = {
  supabase: any;
  checkAuth: any;
  checkPlatformAdmin?: any;
  isUuid?: (value: string) => boolean;
  sanitizeString?: (value: unknown, limit: number) => string;
};

export function registerSalesProspectingRoutes(
  app: any,
  deps: Dependencies,
) {
  const { supabase, checkAuth } = deps;
  const sanitizeString = deps.sanitizeString ||
    ((value: unknown, limit: number) => String(value ?? '').trim().slice(0, limit));
  const isUuid = deps.isUuid ||
    ((value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
  const checkPlatformAdmin = deps.checkPlatformAdmin ||
    (async (req: any, res: any, next: any) => {
      const user = req.session?.user;
      const userId = sanitizeString(user?.id, 120);
      if (!isUuid(userId)) {
        return res.status(403).json({ success: false, error: 'PLATFORM_ADMIN_REQUIRED' });
      }
      let authorized = false;
      try {
        const { data, error } = await supabase.from('platform_admins')
          .select('user_id,active').eq('user_id', userId).eq('active', true).limit(1).maybeSingle();
        if (error) throw error;
        authorized = data?.user_id === userId && data?.active === true;
      } catch {
        return res.status(503).json({ success: false, error: 'PLATFORM_ADMIN_AUTHORITY_UNAVAILABLE' });
      }
      if (!authorized) return res.status(403).json({ success: false, error: 'PLATFORM_ADMIN_REQUIRED' });
      const verifiedAt = Date.parse(sanitizeString(user?.mfaVerifiedAt, 80));
      if (user?.mfaVerified !== true || sanitizeString(user?.mfaMethod, 20).toLowerCase() !== 'totp'
          || !Number.isFinite(verifiedAt)) {
        return res.status(401).json({ success: false, error: 'PLATFORM_ADMIN_MFA_REQUIRED' });
      }
      user.isPlatformAdmin = true;
      return next();
    });

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
          if (/IDEMPOTENCY_CONFLICT|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_NOT_ALLOWED|DECISOR_ALREADY_CONTACTED/.test(message)) {
            return res.status(409).json({ success: false, error: 'Limite atingido, lead indisponível ou decisor já contatado.' });
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
