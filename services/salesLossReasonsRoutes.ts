// Owner-only editable catalog. The database owns row locks, uniqueness and audit.
type Deps={
  supabase:any;
  checkAuth:any;
  checkPlatformAdmin:any;
  isUuid:(value:string)=>boolean;
};
const cleanName=(value:unknown):string=>typeof value==='string'?value.trim():'';
export function registerSalesLossReasonsRoutes(app:any,{supabase,checkAuth,checkPlatformAdmin,isUuid}:Deps){
  const guard=[checkAuth,checkPlatformAdmin];
  app.get('/api/owner/sales/loss-reasons',...guard,async(_req:any,res:any)=>{
    try{
      const result=await supabase.from('sales_loss_reasons')
        .select('id,name,is_active,updated_at').order('is_active',{ascending:false})
        .order('name',{ascending:true}).limit(300);
      if(result.error)throw result.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,reasons:result.data||[]});
    }catch{return res.status(503).json({success:false,error:'Não foi possível carregar os motivos de perda.'});}
  });
  const save=async(req:any,res:any,editing:boolean)=>{
    const actorId=String(req.session?.user?.id||'').trim();
    const id=editing?String(req.params?.reasonId||'').trim():null;
    const name=cleanName(req.body?.name);
    const active=editing?req.body?.isActive:true;
    if(!isUuid(actorId)||(editing&&!isUuid(id||''))||name.length<2||name.length>100||
      typeof active!=='boolean'||!req.body||Array.isArray(req.body)||
      Object.keys(req.body).some(key=>!['name',...(editing?['isActive']:[])].includes(key)))
      return res.status(400).json({success:false,error:'Informe um motivo de 2 a 100 caracteres.'});
    try{
      const result=await supabase.rpc('save_sales_loss_reason_v1',{
        p_actor_user_id:actorId,p_reason_id:id,p_name:name,p_active:active
      });
      if(result.error){
        const message=String(result.error.message||'');
        if(/unique|duplicate|sales_loss_reasons_name_ci/i.test(message))
          return res.status(409).json({success:false,error:'Esse motivo de perda já está cadastrado.'});
        if(/LOSS_REASON_NOT_FOUND/.test(message))
          return res.status(404).json({success:false,error:'Motivo de perda não encontrado.'});
        if(/INVALID_LOSS_REASON|PLATFORM_ADMIN_REQUIRED/.test(message))
          return res.status(403).json({success:false,error:'Motivo ou autorização inválida.'});
        throw result.error;
      }
      return res.json({success:true,reason:result.data});
    }catch{return res.status(503).json({success:false,error:'Não foi possível salvar o motivo de perda.'});}
  };
  app.post('/api/owner/sales/loss-reasons',...guard,(req:any,res:any)=>save(req,res,false));
  app.patch('/api/owner/sales/loss-reasons/:reasonId',...guard,(req:any,res:any)=>save(req,res,true));
}
