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
  // All routes share the canonical owner session + DB-backed platform admin / TOTP guard.
  const salesGuard = [checkAuth, checkPlatformAdmin];
  const validColor = (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value);
  const boardError = (res: any, message = 'Não foi possível salvar o quadro.') =>
    res.status(500).json({ success: false, error: message });

  app.get('/api/owner/sales/kanban/board', ...salesGuard, async (req: any, res: any) => {
    const leadIds = [...new Set(String(req.query?.leadIds || '').split(',').filter(Boolean))];
    if (leadIds.length > 100 || leadIds.some((id) => !isUuid(id))) {
      return res.status(400).json({ success: false, error: 'Limite de 100 leads por consulta.' });
    }
    try {
      const columns = await supabase.from('sales_kanban_columns')
        .select('id,slug,kind,title,color,position,is_system')
        .order('position', { ascending: true }).order('created_at', { ascending: true });
      if (columns.error) throw columns.error;
      let placements: any[] = [];
      if (leadIds.length) {
        const found = await supabase.from('sales_kanban_placements')
          .select('lead_id,column_id').in('lead_id',leadIds).limit(100);
        if (found.error) throw found.error;
        placements = found.data || [];
      }
      return res.json({success: true, columns: columns.data || [], placements});
    } catch { return boardError(res, 'Configuração do Kanban indisponível.'); }
  });

  app.post('/api/owner/sales/kanban/columns', ...salesGuard, async (req: any, res: any) => {
    const title = sanitizeString(req.body?.title, 60).trim();
    const color = sanitizeString(req.body?.color, 7).toUpperCase();
    if (!title || !validColor(color)) return res.status(400).json({success:false,error:'Nome ou cor inválidos.'});
    try {
      const count = await supabase.from('sales_kanban_columns').select('id',{count:'exact',head:true});
      if (count.error) throw count.error;
      if ((count.count || 0) >= 24) return res.status(409).json({success:false,error:'Limite de 24 colunas.'});
      const slug = 'custom-' + crypto.randomUUID();
      const result = await supabase.from('sales_kanban_columns')
        .insert({slug,kind:'custom',is_system:false,title,color,position:count.count || 5})
        .select('id,slug,kind,title,color,position,is_system').single();
      if (result.error) throw result.error;
      return res.status(201).json({success:true,column:result.data});
    } catch { return boardError(res); }
  });

  app.patch('/api/owner/sales/kanban/columns/order', ...salesGuard, async (req: any, res: any) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 24 || ids.length < 5
        || ids.some((v: unknown) => typeof v !== 'string' || !isUuid(v))
        || new Set(ids).size !== ids.length) {
      return res.status(400).json({success:false,error:'Ordem inválida.'});
    }
    try {
      const result = await supabase.rpc('order_sales_kanban_columns_v1',{p_ids:ids});
      if (result.error) return res.status(409).json({success:false,error:'A lista mudou. Atualize o quadro e tente novamente.'});
      return res.json({success:true,count:result.data});
    } catch { return boardError(res); }
  });

  app.patch('/api/owner/sales/kanban/columns/:columnId', ...salesGuard, async (req: any, res: any) => {
    const columnId = sanitizeString(req.params?.columnId, 120);
    const title = sanitizeString(req.body?.title, 60).trim();
    const color = sanitizeString(req.body?.color, 7).toUpperCase();
    if (!isUuid(columnId) || !title || !validColor(color))
      return res.status(400).json({success:false,error:'Nome ou cor inválidos.'});
    try {
      const result = await supabase.from('sales_kanban_columns')
        .update({title,color,updated_at:new Date().toISOString()}).eq('id',columnId)
        .select('id,slug,kind,title,color,position,is_system').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return res.status(404).json({success:false,error:'Coluna não encontrada.'});
      return res.json({success:true,column:result.data});
    } catch { return boardError(res); }
  });

  app.delete('/api/owner/sales/kanban/columns/:columnId', ...salesGuard, async (req: any, res: any) => {
    const columnId = sanitizeString(req.params?.columnId,120);
    if (!isUuid(columnId)) return res.status(400).json({success:false,error:'Coluna inválida.'});
    try {
      const result = await supabase.from('sales_kanban_columns').delete()
        .eq('id',columnId).eq('is_system',false).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return res.status(409).json({success:false,error:'Colunas principais não podem ser excluídas.'});
      return res.json({success:true});
    } catch { return boardError(res); }
  });

  app.post('/api/owner/sales/kanban/leads/:leadId/move', ...salesGuard, async (req: any, res: any) => {
    const leadId = sanitizeString(req.params?.leadId,120);
    const columnId = sanitizeString(req.body?.columnId,120);
    const actorId = sanitizeString(req.session?.user?.id,120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'],120);
    if (![leadId,columnId,actorId].every(isUuid) || key.length < 12)
      return res.status(400).json({success:false,error:'Movimentação inválida.'});
    try {
      const result = await supabase.rpc('move_sales_kanban_lead_v1',{
        p_lead_id:leadId,p_column_id:columnId,p_actor_id:actorId,p_action_key:key,
      });
      if (result.error) {
        const m = String(result.error.message || '');
        if (m.includes('LEAD_NOT_FOUND') || m.includes('COLUMN_NOT_FOUND'))
          return res.status(404).json({success:false,error:'Lead ou coluna inexistente.'});
        if (/CONVERTED_LEAD_IMMUTABLE|CANNOT_HIDE_CLOSED_LEAD|PAYMENT_REQUIRED|IDEMPOTENCY_CONFLICT/.test(m))
          return res.status(409).json({success:false,error:'Movimentação incompatível com as regras comerciais.'});
        throw result.error;
      }
      return res.json({success:true,data:result.data});
    } catch { return boardError(res,'Não foi possível mover o lead.'); }
  });

  app.get('/api/owner/sales/prospecting/analytics', ...salesGuard, async (req: any, res: any) => {
    const days = Number(req.query?.days || 90);
    if (![7,30,90,365].includes(days))
      return res.status(400).json({success:false,error:'Período inválido.'});
    try {
      const result = await supabase.rpc('sales_prospecting_analytics_v1',{p_days:days});
      if (result.error) throw result.error;
      res.setHeader('Cache-Control','no-store, private');
      return res.json({success:true,data:result.data});
    } catch { return boardError(res,'Inteligência comercial indisponível.'); }
  });

}
