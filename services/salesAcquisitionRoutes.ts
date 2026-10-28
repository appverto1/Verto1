// Dedicated Super Admin CRM acquisition channels; no clinic/patient permissions involved.
type Deps={
  supabase:any;checkAuth:any;checkPlatformAdmin:any;
  isUuid:(value:string)=>boolean;
  sanitizeString:(value:unknown,limit:number)=>string;
};
export function registerSalesAcquisitionRoutes(app:any,deps:Deps){
  const {supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString}=deps;
  const guard=[checkAuth,checkPlatformAdmin];
  const actor=(req:any)=>sanitizeString(req.session?.user?.id,120);

  app.get('/api/owner/sales/acquisition/board',...guard,async(req:any,res:any)=>{
    const ids=[...new Set(String(req.query?.leadIds||'').split(',').filter(Boolean))];
    if(ids.length>100||ids.some(id=>!isUuid(id)))
      return res.status(400).json({success:false,error:'Lista de oportunidades inválida.'});
    try{
      const [channels,links]=await Promise.all([
        supabase.from('sales_acquisition_channels')
          .select('id,name,is_active').order('name').limit(150),
        ids.length?supabase.from('sales_lead_acquisition_channels')
          .select('lead_id,channel_id').in('lead_id',ids).limit(2000):
          Promise.resolve({data:[],error:null}),
      ]);
      if(channels.error||links.error)throw channels.error||links.error;
      return res.json({success:true,channels:channels.data||[],links:links.data||[]});
    }catch{return res.status(503).json({success:false,error:'Não foi possível carregar os canais de aquisição.'});}
  });

  app.get('/api/owner/sales/acquisition/metrics',...guard,async(req:any,res:any)=>{
    try{
      const {data,error}=await supabase.rpc('sales_acquisition_channel_metrics_v1',{
        p_actor_user_id:actor(req),
      });
      if(error)throw error;
      return res.json({success:true,metrics:data||[]});
    }catch{return res.status(503).json({success:false,error:'Indicadores dos canais indisponíveis.'});}
  });

  app.post('/api/owner/sales/acquisition/channels',...guard,async(req:any,res:any)=>{
    if(typeof req.body?.name!=='string'||req.body.name.trim().length<2||
      req.body.name.trim().length>80)
      return res.status(400).json({success:false,error:'Nome do canal deve ter de 2 a 80 caracteres.'});
    const name=req.body.name.trim();
    try{
      const {data,error}=await supabase.from('sales_acquisition_channels')
        .insert({name}).select('id,name,is_active').single();
      if(error){
        if(String(error.code)==='23505')
          return res.status(409).json({success:false,error:'Esse canal já existe.'});
        throw error;
      }
      return res.json({success:true,channel:data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível cadastrar o canal.'});}
  });

  app.patch('/api/owner/sales/acquisition/channels/:channelId',...guard,async(req:any,res:any)=>{
    const id=sanitizeString(req.params?.channelId,120);
    if(!isUuid(id)||typeof req.body?.active!=='boolean')
      return res.status(400).json({success:false,error:'Canal ou status inválido.'});
    try{
      const {data,error}=await supabase.from('sales_acquisition_channels')
        .update({is_active:req.body.active,updated_at:new Date().toISOString()})
        .eq('id',id).select('id,name,is_active').maybeSingle();
      if(error)throw error;
      if(!data)return res.status(404).json({success:false,error:'Canal não encontrado.'});
      return res.json({success:true,channel:data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível alterar o canal.'});}
  });

  // Atomic selection for existing Kanban cards; all selections succeed or none.
  app.put('/api/owner/sales/acquisition/leads/bulk',...guard,async(req:any,res:any)=>{
    const actorId=actor(req);
    const key=sanitizeString(req.headers?.['x-idempotency-key'],121);
    const selections=req.body?.selections;
    if(!isUuid(actorId)||key.length<12||key.length>120||
      !Array.isArray(selections)||selections.length<1||selections.length>100||
      selections.some((item:any)=>!item||!isUuid(item.leadId)||
        !Array.isArray(item.channelIds)||item.channelIds.length>20||
        item.channelIds.some((id:unknown)=>typeof id!=='string'||!isUuid(id))||
        new Set(item.channelIds).size!==item.channelIds.length)||
      new Set(selections.map((item:any)=>item.leadId)).size!==selections.length)
      return res.status(400).json({success:false,error:'Revise os cards selecionados e seus canais.'});
    try{
      const {data,error}=await supabase.rpc('save_sales_lead_acquisition_channels_bulk_v1',{
        p_actor_user_id:actorId,p_items:selections,p_action_key:key,
      });
      if(error){
        const msg=String(error.message||'');
        if(/ACQUISITION_CHANNEL_UNAVAILABLE|LEAD_NOT_FOUND|IDEMPOTENCY_CONFLICT/.test(msg))
          return res.status(409).json({success:false,error:'Um dos cards ou canais não está disponível. Nenhuma seleção foi alterada.'});
        if(/INVALID_ACQUISITION_BATCH|DUPLICATE_ACQUISITION_LEAD|DUPLICATE_BATCH_CHANNEL/.test(msg))
          return res.status(400).json({success:false,error:'Seleção de canais inválida.'});
        throw error;
      }
      return res.json({success:true,selections:data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível atribuir os canais em lote.'});}
  });

  app.put('/api/owner/sales/acquisition/leads/:leadId',...guard,async(req:any,res:any)=>{
    const leadId=sanitizeString(req.params?.leadId,120);
    const actorId=actor(req);
    const raw=req.body?.channelIds;
    const key=sanitizeString(req.headers?.['x-idempotency-key'],121);
    if(!isUuid(leadId)||!isUuid(actorId)||!Array.isArray(raw)||raw.length>20||
      raw.some((x:unknown)=>typeof x!=='string'||!isUuid(x))||
      key.length<12||key.length>120)
      return res.status(400).json({success:false,error:'Seleção inválida de canais.'});
    try{
      const {data,error}=await supabase.rpc('save_sales_lead_acquisition_channels_v1',{
        p_lead_id:leadId,p_actor_user_id:actorId,p_channel_ids:raw,p_action_key:key,
      });
      if(error){
        const message=String(error.message||'');
        if(/LEAD_NOT_FOUND/.test(message))
          return res.status(404).json({success:false,error:'Oportunidade não encontrada.'});
        if(/ACQUISITION_CHANNEL_UNAVAILABLE|IDEMPOTENCY_CONFLICT/.test(message))
          return res.status(409).json({success:false,error:'Canal desativado, desconhecido ou salvamento em conflito.'});
        if(/INVALID_ACQUISITION_SELECTION/.test(message))
          return res.status(400).json({success:false,error:'Seleção de canais inválida.'});
        throw error;
      }
      return res.json({success:true,selection:data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível salvar os canais.'});}
  });
}
