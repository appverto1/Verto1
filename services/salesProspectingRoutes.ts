import { registerSalesProspectingActivityRoutes } from './salesProspectingActivityRoutes';
import { registerSalesKanbanMovementRoutes } from './salesKanbanMovementRoutes';
import { registerSalesKanbanOpportunityCreationRoutes } from './salesKanbanOpportunityCreationRoutes';
import { registerSalesAcquisitionRoutes } from './salesAcquisitionRoutes';
import { registerSalesScriptRoutes } from './salesScriptRoutes';
import { registerSalesLossReasonsRoutes } from './salesLossReasonsRoutes';
import { registerOwnerDreCostRoutes } from './ownerDreCostRoutes';
import { registerOwnerLoyaltyDraftRoutes } from './ownerLoyaltyDraftRoutes';
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
  registerSalesLossReasonsRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid});
  // Owner financial endpoint uses the existing canonical platform-admin + TOTP guard.
  registerOwnerDreCostRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid});
  registerOwnerLoyaltyDraftRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid});

  registerSalesProspectingActivityRoutes(app,{supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString});

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
      let priorityLeads: any[] = [];
      if (req.query?.sitePriority === '1') {
        // Read-only, indexed and capped; owner authorization is enforced above.
        // This also covers website registrations beyond the first 100 CRM leads.
        const priority = await supabase.rpc('site_interest_prospecting_priority_v1');
        if (priority.error) throw priority.error;
        priorityLeads = (priority.data || []).map((lead: any) => ({
          id: lead.id, name: lead.name, email: lead.email, phone: lead.phone,
          clinicName: lead.clinic_name, status: lead.status,
          createdAt: lead.created_at, updatedAt: lead.updated_at,
          siteInterestAt: lead.site_interest_at,
        }));
      }
      return res.json({success: true, columns: columns.data || [], placements, overrides, priorityLeads});
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

  registerSalesKanbanMovementRoutes(app,{supabase,salesGuard,isUuid,sanitizeString,boardError});

  registerSalesKanbanOpportunityCreationRoutes(app, {supabase, salesGuard, sanitizeString, isUuid, boardError});

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

  // Dashboard drill-down returns the actual paginated leads, not currently loaded
  // Kanban cards. All filtering/permissions are enforced server-side and in SQL.
  app.get('/api/owner/sales/prospecting/analytics/drilldown', ...salesGuard, async (req: any, res: any) => {
    const actorId=sanitizeString(req.session?.user?.id,120);
    const days=Number(req.query?.days??90);
    const dimension=sanitizeString(req.query?.dimension,20);
    const value=sanitizeString(req.query?.value,40);
    const measure=sanitizeString(req.query?.measure,20);
    const offset=Number(req.query?.offset??0);
    if(!isUuid(actorId)||![7,30,90,365].includes(days)||
      !['stage','overview','daily','cumulative','hour','weekday','channel','attempt','loss_reason'].includes(dimension)||
      !['leads','calls','conversations','failures','messages','attempted'].includes(measure)||
      !value||value.length>40||!Number.isInteger(offset)||offset<0||offset>100000||
      (dimension==='loss_reason'&&(measure!=='leads'||(value!=='none'&&!isUuid(value)))))
      return res.status(400).json({success:false,error:'Filtro do gráfico inválido.'});
    try{
      if(dimension==='loss_reason'){
        const result=await supabase.rpc('sales_loss_reason_drilldown_v1',{
          p_actor_user_id:actorId,p_reason_id:value==='none'?null:value,p_offset:offset,p_limit:25
        });
        if(result.error)throw result.error;
        res.setHeader('Cache-Control','private, no-store');
        return res.json({success:true,data:result.data});
      }
      const result=await supabase.rpc('sales_prospecting_drilldown_v1',{
        p_actor_user_id:actorId,p_days:days,p_dimension:dimension,p_value:value,
        p_measure:measure,p_offset:offset,p_limit:25,
      });
      if(result.error){
        if(/INVALID_DRILLDOWN_FILTER/.test(String(result.error.message||'')))
          return res.status(400).json({success:false,error:'Filtro do gráfico inválido.'});
        throw result.error;
      }
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,data:result.data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível carregar os leads deste gráfico.'});}
  });

  app.get('/api/owner/sales/prospecting/analytics', ...salesGuard, async (req: any, res: any) => {
    const days = Number(req.query?.days || 90);
    if (![7,30,90,365].includes(days))
      return res.status(400).json({success:false,error:'Período inválido.'});
    try {
      const actorId=sanitizeString(req.session?.user?.id,120);
      if(!isUuid(actorId))return res.status(403).json({success:false,error:'Sem autorização.'});
      const [result,lossReasons]=await Promise.all([
        supabase.rpc('sales_prospecting_analytics_v1',{p_days:days}),
        supabase.rpc('sales_loss_reasons_analytics_v1',{p_actor_user_id:actorId})
      ]);
      if (result.error||lossReasons.error) throw result.error||lossReasons.error;
      res.setHeader('Cache-Control','no-store, private');
      return res.json({success:true,data:{...result.data,lossReasons:lossReasons.data||[]}});
    } catch { return boardError(res,'Inteligência comercial indisponível.'); }
  });

}
