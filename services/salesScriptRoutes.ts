import { randomUUID } from 'node:crypto';

// Commercial-only assets. Never use patient or clinic storage buckets.
const bucket='sales-script-assets-private';
const mimeExt:Record<string,string>={
  'application/pdf':'pdf','text/plain':'txt','image/png':'png',
  'image/jpeg':'jpg','image/webp':'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
};
type Dependencies={supabase:any;checkAuth:any;checkPlatformAdmin:any;isUuid:(s:string)=>boolean;sanitizeString:(v:unknown,n:number)=>string};
export function registerSalesScriptRoutes(app:any, deps:Dependencies){
  const {supabase,checkAuth,checkPlatformAdmin,isUuid,sanitizeString}=deps;
  const guards=[checkAuth,checkPlatformAdmin];
  const actor=(req:any)=>sanitizeString(req.session?.user?.id,120);
  const action=(req:any)=>{
    const value=sanitizeString(req.headers?.['x-idempotency-key'],120);
    return value.length>=12&&value.length<=120?value:null;
  };
  app.get('/api/owner/sales/scripts/active',...guards,async(_req:any,res:any)=>{
    try{
      const {data,error}=await supabase.from('sales_script_versions')
        .select('id,name,version_label').eq('is_active',true)
        .order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      return res.json({success:true,versions:data||[]});
    }catch{return res.status(503).json({success:false,error:'Fluxos comerciais indisponíveis.'});}
  });

  app.get('/api/owner/sales/scripts',...guards,async(req:any,res:any)=>{
    const days=Number(req.query?.days??0);
    if(![0,30,90,365].includes(days))return res.status(400).json({success:false,error:'Período inválido.'});
    try{
      const [list,stats]=await Promise.all([
        supabase.from('sales_script_versions')
          .select('id,name,version_label,source_kind,source_text,source_url,file_path,file_name,file_mime,file_bytes,is_active,created_at')
          .order('created_at',{ascending:false}).limit(200),
        supabase.rpc('sales_script_metrics_v1',{p_actor_user_id:actor(req),p_days:days}),
      ]);
      if(list.error||stats.error)throw list.error||stats.error;
      return res.json({success:true,versions:list.data||[],metrics:stats.data||[]});
    }catch{return res.status(503).json({success:false,error:'Não foi possível carregar os resultados dos fluxos.'});}
  });

  app.post('/api/owner/sales/scripts/upload-url',...guards,async(req:any,res:any)=>{
    const actorId=actor(req),fileName=sanitizeString(req.body?.fileName,181);
    const mime=sanitizeString(req.body?.mime,140),size=req.body?.size;
    const ext=mimeExt[mime];
    if(!isUuid(actorId)||!ext||!Number.isInteger(size)||size<1||size>4194304||
       !fileName||fileName.length>180||/[\/\\\x00-\x1f]/.test(fileName))
      return res.status(400).json({success:false,error:'Envie PDF, DOCX, TXT ou imagem de até 4 MB.'});
    try{
      const path=actorId+'/'+randomUUID()+'.'+ext;
      const {data,error}=await supabase.storage.from(bucket).createSignedUploadUrl(path,{upsert:false});
      if(error||!data?.token)throw error||Error('SIGNED_UPLOAD_UNAVAILABLE');
      return res.json({success:true,path,token:data.token});
    }catch{return res.status(503).json({success:false,error:'Upload privado indisponível.'});}
  });

  app.post('/api/owner/sales/scripts',...guards,async(req:any,res:any)=>{
    const actorId=actor(req),key=action(req),name=sanitizeString(req.body?.name,121);
    const version=sanitizeString(req.body?.versionLabel,41);
    const kind=sanitizeString(req.body?.sourceKind,20);
    const body=req.body||{};
    const text=typeof body.sourceText==='string'?body.sourceText.trim():null;
    const url=typeof body.sourceUrl==='string'?body.sourceUrl.trim():null;
    const path=typeof body.filePath==='string'?body.filePath.trim():null;
    const fileName=typeof body.fileName==='string'?body.fileName.trim():null;
    const fileMime=sanitizeString(body.fileMime,140),fileBytes=body.fileBytes;
    if(!isUuid(actorId)||!key||name.length<2||name.length>120||
       version.length<1||version.length>40||!['text','url','file'].includes(kind)||
       (kind==='text'&&(!text||text.length>20000))||
       (kind==='url'&&(!url||url.length>2000))||
       (kind==='file'&&(!path||!path.startsWith(actorId+'/')||
         !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|txt|png|jpg|webp|docx)$/.test(path)||
         !fileName||fileName.length>180||!mimeExt[fileMime]||
         !Number.isInteger(fileBytes)||fileBytes<1||fileBytes>4194304)))
      return res.status(400).json({success:false,error:'Nome, versão ou material inválido.'});
    if(kind==='url'){
      try{
        const candidate=new URL(url!);
        if(!['http:','https:'].includes(candidate.protocol)||candidate.username||candidate.password)
          throw Error('BAD_LINK');
      }catch{return res.status(400).json({success:false,error:'Informe um link HTTP ou HTTPS válido.'});}
    }
    try{
      if(kind==='file'){
        const filename=path!.split('/')[1];
        const {data,error}=await supabase.storage.from(bucket).list(actorId,{search:filename,limit:10});
        const object=(data||[]).find((o:any)=>o.name===filename);
        if(error||!object?.metadata||Number(object.metadata.size)!==fileBytes||
          String(object.metadata.mimetype||'').toLowerCase()!==fileMime)
          return res.status(409).json({success:false,error:'Arquivo não confirmado no armazenamento privado.'});
      }
      const row={
        name,version_label:version,source_kind:kind,
        source_text:kind==='text'?text:null,source_url:kind==='url'?url:null,
        file_path:kind==='file'?path:null,file_name:kind==='file'?fileName:null,
        file_mime:kind==='file'?fileMime:null,file_bytes:kind==='file'?fileBytes:null,
        created_by:actorId,client_action_key:key,
      };
      const {data,error}=await supabase.from('sales_script_versions').insert(row)
        .select('id,name,version_label,source_kind,is_active').single();
      if(error){
        if(String(error.code)==='23505'){
          const replay=await supabase.from('sales_script_versions')
            .select('id,name,version_label,source_kind,is_active,source_text,source_url,file_path,file_name,file_mime,file_bytes,created_by')
            .eq('client_action_key',key).maybeSingle();
          const prev=replay.data;
          if(!replay.error&&prev&&prev.created_by===actorId&&prev.name===name&&
            prev.version_label===version&&prev.source_kind===kind&&
            prev.source_text===row.source_text&&prev.source_url===row.source_url&&
            prev.file_path===row.file_path&&prev.file_name===row.file_name&&
            prev.file_mime===row.file_mime&&prev.file_bytes===row.file_bytes)
            return res.json({success:true,version:prev});
          return res.status(409).json({success:false,error:'Nome e versão já cadastrados ou chave de salvamento em conflito.'});
        }
        throw error;
      }
      return res.json({success:true,version:data});
    }catch{return res.status(503).json({success:false,error:'Falha ao salvar a versão comercial.'});}
  });

  app.patch('/api/owner/sales/scripts/:id/active',...guards,async(req:any,res:any)=>{
    const id=sanitizeString(req.params?.id,120);
    if(!isUuid(id)||typeof req.body?.active!=='boolean')
      return res.status(400).json({success:false,error:'Versão ou situação inválida.'});
    try{
      const {data,error}=await supabase.from('sales_script_versions')
        .update({is_active:req.body.active,updated_at:new Date().toISOString()})
        .eq('id',id).select('id,name,version_label,is_active').maybeSingle();
      if(error)throw error;
      if(!data)return res.status(404).json({success:false,error:'Versão não encontrada.'});
      return res.json({success:true,version:data});
    }catch{return res.status(503).json({success:false,error:'Falha ao atualizar a versão.'});}
  });

  app.get('/api/owner/sales/scripts/:id/file',...guards,async(req:any,res:any)=>{
    const id=sanitizeString(req.params?.id,120);
    if(!isUuid(id))return res.status(400).json({success:false,error:'Arquivo inválido.'});
    try{
      const {data:script,error}=await supabase.from('sales_script_versions')
        .select('file_path,file_name').eq('id',id).maybeSingle();
      if(error||!script?.file_path||!script?.file_name)
        return res.status(404).json({success:false,error:'Arquivo não encontrado.'});
      const {data,error:signedError}=await supabase.storage.from(bucket)
        .createSignedUrl(script.file_path,60,{download:script.file_name});
      if(signedError||!data?.signedUrl)throw signedError||Error('SIGNED_FILE_UNAVAILABLE');
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,url:data.signedUrl});
    }catch{return res.status(503).json({success:false,error:'Arquivo privado indisponível.'});}
  });
}
