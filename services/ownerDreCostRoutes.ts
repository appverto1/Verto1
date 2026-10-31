// Owner DRE costs: server-session TOTP authority, not Supabase browser JWT AAL.
// The bridge supplies its existing DB-backed checkPlatformAdmin + verified TOTP guard.
type Deps={supabase:any;checkAuth:any;checkPlatformAdmin:any;isUuid:(value:string)=>boolean};
const month=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'}).slice(0,7);
const permitted=['name','costType','category','amountCents','rateBasisPoints','startsMonth','requestId'];
const parseRule=(input:any,isCreate:boolean)=>{
  if(!input || Array.isArray(input) || typeof input!=='object' ||
     Object.keys(input).some(key=>!permitted.includes(key))) return null;
  const name=typeof input.name==='string'?input.name.trim():'';
  const type=input.costType,category=input.category,amount=input.amountCents,rate=input.rateBasisPoints;
  const starts=input.startsMonth,requestId=input.requestId;
  if(name.length<2 || name.length>120 || !['fixed','variable'].includes(type) ||
    !['operating','below_ebitda'].includes(category) ||
    !Number.isSafeInteger(amount) || amount<0 || amount>100000000 ||
    !Number.isSafeInteger(rate) || rate<0 || rate>10000 || amount+rate===0 ||
    typeof starts!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(starts)||starts<month()||
    (isCreate && (typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId))))return null;
  return {name,costType:type,category,amountCents:amount,rateBasisPoints:rate,
    startsMonth:starts,...(isCreate?{requestId}:{} )};
};
export function registerOwnerDreCostRoutes(app:any,{supabase,checkAuth,checkPlatformAdmin,isUuid}:Deps){
  const guard=[checkAuth,checkPlatformAdmin];
  const save=async(req:any,res:any,action:'create'|'update'|'stop')=>{
    const actorId=String(req.session?.user?.id||'').trim();
    const ruleId=action==='create'?null:String(req.params?.ruleId||'').trim();
    if(!isUuid(actorId)||(ruleId!==null&&!isUuid(ruleId))){
      return res.status(400).json({success:false,error:'Identificador inválido.'});
    }
    const rule=action==='stop'?
      (req.body && !Array.isArray(req.body) && Object.keys(req.body).length===0?{}:null):
      parseRule(req.body,action==='create');
    if(!rule){
      return res.status(400).json({success:false,error:'Revise nome, valores, porcentagem e início da vigência.'});
    }
    try{
      // Actor ID is ALWAYS taken from the trusted Express session, never the request body.
      // DB checks active platform_admins again. Idempotency and row locking stay atomic in SQL.
      const {data,error}=await supabase.rpc('save_owner_dre_cost_rule_v1',{
        p_action:action,p_payload:{...rule,actorId},p_rule_id:ruleId,
      });
      if(error){
        const code=String(error.code||'');
        const details=String(error.message||'');
        if(code==='23505'||details.includes('DRE_IDEMPOTENCY_CONFLICT'))
          return res.status(409).json({success:false,error:'Essa tentativa de gravação já foi usada com valores diferentes.'});
        if(details.includes('DRE_RULE_NOT_FOUND'))
          return res.status(404).json({success:false,error:'Custo não encontrado.'});
        if(details.includes('DRE_CLOSED_PERIOD_IMMUTABLE'))
          return res.status(409).json({success:false,error:'O período já foi encerrado. Cadastre nova vigência.'});
        if(code==='42501'||details.includes('DRE_ACCESS_DENIED'))
          return res.status(403).json({success:false,error:'Acesso restrito ao Super Admin autenticado.'});
        if(code==='22023'||details.includes('DRE_INVALID'))
          return res.status(400).json({success:false,error:'Os dados do custo são inválidos.'});
        throw error;
      }
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,id:data});
    }catch(error:any){
      // No payload/PHI/secrets in logs.
      console.error('[Owner DRE] failed to save rule',{code:String(error?.code||'unknown').slice(0,20)});
      return res.status(503).json({success:false,error:'Não foi possível salvar o custo agora.'});
    }
  };
  app.post('/api/owner/dre/costs',...guard,(req:any,res:any)=>save(req,res,'create'));
  app.patch('/api/owner/dre/costs/:ruleId',...guard,(req:any,res:any)=>{
    const body=req.body;
    if(!body||Array.isArray(body)||typeof body!=='object'||
       !['update','stop'].includes(body.action))return res.status(400).json({success:false,error:'Ação inválida.'});
    const {action,...payload}=body;
    req.body=payload;
    return save(req,res,action);
  });
}
