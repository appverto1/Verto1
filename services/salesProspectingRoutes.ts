import { registerSalesAcquisitionRoutes } from './salesAcquisitionRoutes';
import { registerSalesScriptRoutes } from './salesScriptRoutes';
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

  registerSalesScriptRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString});
  registerSalesAcquisitionRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString});

  app.get('/api/owner/sales/prospecting/attempts', checkAuth, checkPlatformAdmin, async (req: any, res: any) => {
    const leadIds = [...new Set(String(req.query?.leadIds || '').split(',').filter(Boolean))];
    if (leadIds.length === 0 || leadIds.length > 100 || leadIds.some((id) => !isUuid(id))) {
      return res.status(400).json({ success: false, error: 'Lista de leads inválida.' });
    }
    try {
      const actorId=sanitizeString(req.session?.user?.id,120);
      const [attempts, leads, followups] = await Promise.all([
        supabase.from('sales_prospecting_attempts')
          .select('id,lead_id,channel,outcome,occurred_at,script_version_id,contact_result')
          .in('lead_id', leadIds)
          .order('occurred_at', { ascending: false })
          .limit(1000),
        supabase.from('sales_leads').select('id,status,lost_at')
          .in('id', leadIds).is('deleted_at', null).limit(100),
        supabase.from('sales_contact_followups')
          .select('id,lead_id,contact_due_at,status')
          .eq('actor_user_id',actorId).in('lead_id',leadIds).limit(100),
      ]);
      if (attempts.error || leads.error || followups.error) throw attempts.error || leads.error || followups.error;
      return res.json({ success: true, data: attempts.data || [], leads: leads.data || [], followups: followups.data || [] });
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
          if (message.includes('PROSPECTING_OUTSIDE_BUSINESS_HOURS')) {
            return res.status(409).json({success:false,error:'As tentativas devem ocorrer de segunda a sexta, entre 9h e 17h30 (Brasília).'});
          }
          if (message.includes('PROSPECTING_ALREADY_TODAY')) {
            return res.status(409).json({success:false,error:'Já existe uma tentativa registrada hoje para esta oportunidade. Siga a próxima sugestão em outro dia útil.'});
          }
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


  // Save actual call time; legacy instant-attempt endpoint remains unchanged for compatibility.
  app.put('/api/owner/sales/leads/:leadId/prospecting-attempt-time',
    checkAuth,checkPlatformAdmin,async(req:any,res:any)=>{
      const leadId=sanitizeString(req.params?.leadId,120);
      const actorId=sanitizeString(req.session?.user?.id,120);
      const attemptId=sanitizeString(req.body?.attemptId,120);
      const channel=sanitizeString(req.body?.channel,32);
      const occurredAt=req.body?.occurredAt;
      const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
      const scriptVersionId=req.body?.scriptVersionId??null;
      if((scriptVersionId!==null&&!isUuid(scriptVersionId))||!isUuid(leadId)||!isUuid(actorId)||(attemptId&&!isUuid(attemptId))
        ||!['phone','whatsapp_call'].includes(channel)
        ||typeof occurredAt!=='string'||occurredAt.length>40
        ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt)
        ||!Number.isFinite(Date.parse(occurredAt))||key.length<12||key.length>120)
        return res.status(400).json({success:false,error:'Data, horário ou canal inválidos.'});
      try{
        const {data,error}=await supabase.rpc('save_sales_prospecting_attempt_time_v2',{
          p_lead_id:leadId,p_attempt_id:attemptId||null,p_channel:channel,
          p_occurred_at:occurredAt,p_action_key:key,p_actor_user_id:actorId,p_script_version_id:scriptVersionId,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|ATTEMPT_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Tentativa não encontrada.'});
          if(/INVALID_ATTEMPT_TIME|PROSPECTING_OUTSIDE_BUSINESS_HOURS/.test(message))
            return res.status(400).json({success:false,error:'Informe uma data passada, de segunda a sexta, das 9h às 17h30 (Brasília).'});
          if(/PROSPECTING_ALREADY_TODAY|CHANNEL_ATTEMPT_LIMIT|PROSPECTING_NOT_ALLOWED|DECISOR_ALREADY_CONTACTED|IDEMPOTENCY_CONFLICT|SCRIPT_REQUIRED|SCRIPT_NOT_ACTIVE/.test(message))
            return res.status(409).json({success:false,error:'Já existe ligação nessa data, limite atingido ou oportunidade indisponível.'});
          throw error;
        }
        return res.json({success:true,data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o horário da tentativa.'});}
    });

  // The user-supplied timestamp is converted on the client, but is checked
  // again by the database. A successful button press is the only write.
  app.put('/api/owner/sales/leads/:leadId/decisor-contact',
    checkAuth,checkPlatformAdmin,async (req:any,res:any)=>{
      const leadId=sanitizeString(req.params?.leadId,120);
      const actorId=sanitizeString(req.session?.user?.id,120);
      const channel=sanitizeString(req.body?.channel,32);
      const attemptId=sanitizeString(req.body?.attemptId,120);
      const occurredAt=req.body?.occurredAt;
      const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
      const scriptVersionId=req.body?.scriptVersionId??null;
      const contactResult=req.body?.contactResult??null;
      if((scriptVersionId!==null&&!isUuid(scriptVersionId))||
         (contactResult!==null&&!['interested','not_interested'].includes(contactResult))||
         !isUuid(leadId)||!isUuid(actorId)||(attemptId&&!isUuid(attemptId))
         ||!['phone','whatsapp_call','whatsapp_message'].includes(channel)
         ||typeof occurredAt!=='string'||occurredAt.length>40
         ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt)
         ||!Number.isFinite(Date.parse(occurredAt))||key.length<12||key.length>120)
        return res.status(400).json({success:false,error:'Data, hora ou canal inválidos.'});
      try{
        const {data,error}=await supabase.rpc('save_sales_decisor_contact_v2',{
          p_lead_id:leadId,p_attempt_id:attemptId||null,p_channel:channel,
          p_occurred_at:occurredAt,p_action_key:key,p_actor_user_id:actorId,
          p_script_version_id:scriptVersionId,p_contact_result:contactResult,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|CONTACT_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Registro não encontrado.'});
          if(/INVALID_CONTACT_TIME|INVALID_CONTACT_RESULT|PROSPECTING_OUTSIDE_BUSINESS_HOURS/.test(message))
            return res.status(400).json({success:false,error:'Informe horário passado, em dia útil, entre 9h e 17h30 (Brasília).'});
          if(/PROSPECTING_ALREADY_TODAY|DECISOR_ALREADY_CONTACTED|CHANNEL_ATTEMPT_LIMIT|IDEMPOTENCY_CONFLICT|PROSPECTING_NOT_ALLOWED|SCRIPT_REQUIRED|SCRIPT_NOT_ACTIVE/.test(message))
            return res.status(409).json({success:false,error:'Conflito com outra tentativa ou oportunidade indisponível.'});
          throw error;
        }
        return res.json({success:true,data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o contato.'});}
    });

  app.put('/api/owner/sales/leads/:leadId/followup',
    checkAuth,checkPlatformAdmin,async (req:any,res:any)=>{
      const leadId=sanitizeString(req.params?.leadId,120);
      const actorId=sanitizeString(req.session?.user?.id,120);
      const key=sanitizeString(req.headers?.['x-idempotency-key'],120);
      const due=req.body?.contactDueAt;
      if(!isUuid(leadId)||!isUuid(actorId)||key.length<12||key.length>120
         ||(due!==null&&(typeof due!=='string'||due.length>40
           ||!/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(due)
           ||!Number.isFinite(Date.parse(due)))))
        return res.status(400).json({success:false,error:'Data ou horário de retorno inválidos.'});
      try{
        const {data,error}=await supabase.rpc('save_sales_contact_followup_v1',{
          p_lead_id:leadId,p_actor_user_id:actorId,
          p_contact_due_at:due,p_action_key:key,
        });
        if(error){
          const message=String(error.message||'');
          if(/LEAD_NOT_FOUND|FOLLOWUP_NOT_FOUND/.test(message))
            return res.status(404).json({success:false,error:'Retorno não encontrado.'});
          if(/INVALID_FOLLOWUP_DATE|IDEMPOTENCY_CONFLICT/.test(message))
            return res.status(400).json({success:false,error:'Informe uma data futura válida para o retorno.'});
          throw error;
        }
        return res.json({success:true,followup:data});
      }catch{return res.status(500).json({success:false,error:'Não foi possível salvar o retorno.'});}
    });

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
      let overrides: any[] = [];
      if (leadIds.length) {
        const [found, edited] = await Promise.all([
          supabase.from('sales_kanban_placements').select('lead_id,column_id')
            .in('lead_id',leadIds).limit(100),
          supabase.from('sales_kanban_opportunity_overrides').select('lead_id,details,hidden_at')
            .in('lead_id',leadIds).limit(100),
        ]);
        if (found.error || edited.error) throw found.error || edited.error;
        placements = found.data || [];
        overrides = edited.data || [];
      }
      return res.json({success: true, columns: columns.data || [], placements, overrides});
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

  // Owner-only manually created opportunities. Reuse the SQL authority for
  // atomic batches, idempotency and audit; never let browser-controlled roles authorize writes.
  app.post('/api/owner/sales/kanban/opportunities', ...salesGuard, async (req: any, res: any) => {
    const phones = req.body?.phones;
    const actorId = sanitizeString(req.session?.user?.id, 120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
    if (!isUuid(actorId) || key.length < 12 || key.length > 120 ||
        !Array.isArray(phones) || phones.length < 1 || phones.length > 100 ||
        phones.some((v: unknown) => typeof v !== 'string' || v.length > 40)) {
      return res.status(400).json({ success:false,error:'Informe entre 1 e 100 telefones válidos.' });
    }
    try {
      const result = await supabase.rpc('create_sales_kanban_opportunities_v1',{
        p_phones:phones,p_actor_id:actorId,p_action_key:key,
      });
      if (result.error) {
        if (/PHONE_ALREADY_EXISTS|DUPLICATE_IN_BATCH|IDEMPOTENCY_CONFLICT|23505/.test(String(result.error.message)+' '+result.error.code))
          return res.status(409).json({success:false,error:'Número já cadastrado ou repetido. Nenhuma oportunidade foi criada.'});
        if (/INVALID_PHONE|INVALID_CREATION_KEY/.test(String(result.error.message)))
          return res.status(400).json({success:false,error:'Confira o formato dos números (DDD obrigatório).'});
        throw result.error;
      }
      return res.status(201).json({success:true,leads:result.data});
    } catch {
      return boardError(res,'Não foi possível cadastrar as oportunidades.');
    }
  });

  // Read one editable record only when the owner explicitly opens its editor;
  // avoids loading sensitive notes for every Kanban card.
  app.get('/api/owner/sales/kanban/opportunities/:leadId', ...salesGuard, async (req: any, res: any) => {
    const leadId = sanitizeString(req.params?.leadId,120);
    if(!isUuid(leadId)) return res.status(400).json({success:false,error:'Oportunidade inválida.'});
    try {
      const result=await supabase.from('sales_leads')
        .select('id,name,phone,email,clinic_name,notes,status')
        .eq('id',leadId).is('deleted_at',null).limit(1).maybeSingle();
      if(result.error)throw result.error;
      if(!result.data)return res.status(404).json({success:false,error:'Oportunidade não encontrada.'});
      const extra = await supabase.from('sales_kanban_opportunity_overrides')
        .select('details,hidden_at').eq('lead_id',leadId).maybeSingle();
      if (extra.error) throw extra.error;
      if (extra.data?.hidden_at) return res.status(404).json({success:false,error:'Oportunidade não encontrada.'});
      const details = extra.data?.details || {};
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,lead:{
        id:result.data.id,name:result.data.name,phone:result.data.phone,
        email:result.data.email,clinicName:result.data.clinic_name,
        notes:result.data.notes,status:result.data.status,...details,
      }});
    }catch{return boardError(res,'Não foi possível abrir os dados da oportunidade.');}
  });

  app.patch('/api/owner/sales/kanban/opportunities/:leadId', ...salesGuard, async (req: any, res: any) => {
    const leadId = sanitizeString(req.params?.leadId,120);
    const actorId = sanitizeString(req.session?.user?.id,120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'],120);
    const patch = req.body;
    if (!isUuid(leadId) || !isUuid(actorId) || key.length < 12 || key.length > 120 ||
        !patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).length < 1 ||
        Object.keys(patch).some(k=>!['name','phone','email','clinicName','notes'].includes(k)) ||
        Object.values(patch).some(v=>typeof v !== 'string' && v !== null)) {
      return res.status(400).json({success:false,error:'Dados de edição inválidos.'});
    }
    try {
      const result = await supabase.rpc('update_sales_kanban_opportunity_v1',{
        p_lead_id:leadId,p_actor_id:actorId,p_patch:patch,p_action_key:key,
      });
      if (result.error) {
        const message=String(result.error.message||'');
        if (message.includes('LEAD_NOT_FOUND')) return res.status(404).json({success:false,error:'Oportunidade não encontrada.'});
        if (/IDEMPOTENCY_CONFLICT|23505/.test(message+' '+result.error.code))
          return res.status(409).json({success:false,error:'Conflito entre alterações simultâneas. Reabra a edição e tente novamente.'});
        if (/INVALID_EDIT/.test(message)) return res.status(400).json({success:false,error:'Verifique nome, telefone e demais campos.'});
        throw result.error;
      }
      return res.json({success:true,lead:result.data});
    } catch { return boardError(res,'Não foi possível salvar a oportunidade.'); }
  });

  app.delete('/api/owner/sales/kanban/opportunities/:leadId', ...salesGuard, async (req: any, res: any) => {
    const leadId = sanitizeString(req.params?.leadId,120);
    const actorId = sanitizeString(req.session?.user?.id,120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'],120);
    if (!isUuid(leadId) || !isUuid(actorId) || key.length < 12 || key.length > 120)
      return res.status(400).json({success:false,error:'Exclusão inválida.'});
    try {
      const result = await supabase.rpc('delete_sales_kanban_opportunity_v1',{
        p_lead_id:leadId,p_actor_id:actorId,p_action_key:key,
      });
      if (result.error) {
        const m=String(result.error.message||'');
        if (m.includes('LEAD_NOT_FOUND')) return res.status(404).json({success:false,error:'Oportunidade não encontrada.'});
        if (/LEAD_LOCKED|IDEMPOTENCY_CONFLICT/.test(m))
          return res.status(409).json({success:false,error:'Conflito ao excluir a oportunidade. Atualize o card e tente novamente.'});
        throw result.error;
      }
      return res.json({success:true,data:result.data});
    } catch { return boardError(res,'Não foi possível excluir a oportunidade.'); }
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
