import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HELP_MEDIA_BUCKET, publishedHelpProjection, resolveHelpMedia } from '../src/help/helpManifest';
import { publishedTutorialHelpProjection } from './helpTutorialCatalog';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  requireClinicCapability: (capability: string) => any;
  currentClinicId: (user: any) => string | null;
  projectArticles?: typeof publishedHelpProjection;
  resolveMedia?: typeof resolveHelpMedia;
  actionLimiter?: any;
  supportNumber?: () => string;
};

const setValues = (value:any): string[] => value instanceof Set ? Array.from(value).map(String) : Array.isArray(value) ? value.map(String) : [];

export function registerHelpCenterRoutes(app: Express, deps: Deps) {
  const { supabase, noStoreDynamicResponse, checkAuth, requireClinicCapability, currentClinicId } = deps;
  const projectArticles = deps.projectArticles || publishedTutorialHelpProjection;
  const resolveMedia = deps.resolveMedia || resolveHelpMedia;
  const helpContext = (req:any) => {
    const clinicId = currentClinicId(req.session?.user);
    const context = req.authorizationContext;
    const audience = String(context?.role || req.session?.user?.role || '').trim().toLowerCase();
    const capabilities = setValues(context?.capabilities);
    const modules = setValues(context?.modules);
    const clinicName = String(context?.clinicName || req.session?.user?.activeAccessContext?.clinicName || req.session?.user?.clinicName || 'Clínica atual');
    const userId=String(context?.userId||req.session?.user?.id||'');
    const membershipId=String(context?.membershipId||'');
    const contextKey=createHash('sha256').update(JSON.stringify([userId,clinicId,membershipId,audience,[...capabilities].sort(),[...modules].sort()])).digest('hex');
    return { clinicId, clinicName, audience, capabilities, modules, userId, membershipId, contextKey };
  };

  app.get('/api/help/catalog', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    const { clinicId, clinicName, audience, capabilities, modules, userId, contextKey } = helpContext(req);
    if (!clinicId) return res.status(403).json({ error: 'HELP_CLINIC_CONTEXT_REQUIRED' });
    const articles = projectArticles(audience, capabilities, modules);
    const tutorials=articles.filter(article=>article.contentRevision);
    let progress:any[]=[];
    if(tutorials.length){
      if(!userId)return res.status(403).json({error:'HELP_USER_CONTEXT_REQUIRED'});
      try{
        const result=await supabase.from('help_tutorial_progress').select('article_id,content_revision,completed_at')
          .eq('user_id',userId).eq('clinic_id',clinicId)
          .in('article_id',tutorials.map(a=>a.articleId)).in('content_revision',tutorials.map(a=>a.contentRevision))
          .limit(200);
        if(result.error)return res.status(503).json({error:'HELP_PROGRESS_UNAVAILABLE'});
        progress=(result.data||[]).filter((row:any)=>tutorials.some(a=>a.articleId===row.article_id&&a.contentRevision===row.content_revision))
          .map((row:any)=>({articleId:row.article_id,contentRevision:row.content_revision,completedAt:row.completed_at}));
      }catch{return res.status(503).json({error:'HELP_PROGRESS_UNAVAILABLE'});}
    }
    return res.json({ clinicId, clinicName, contextKey, articles, progress });
  });

  app.get('/api/help/tutorial-media/:mediaId', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), (req:any,res:any)=>{
    const {clinicId,audience,capabilities,modules}=helpContext(req);
    const id=String(req.params.mediaId||'');
    if(!clinicId||!/^verto-tutorial-[a-z0-9-]{1,100}$/.test(id)||
      !projectArticles(audience,capabilities,modules).some(a=>a.tutorialSteps?.some(s=>s.mediaId===id)))
      return res.status(404).json({error:'HELP_MEDIA_NOT_FOUND'});
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.type('image/jpeg');
    return res.sendFile(`${id}.jpg`,{root:fileURLToPath(new URL('./help-media/',import.meta.url))},(error:any)=>{
      if(error&&!res.headersSent)res.status(404).json({error:'HELP_MEDIA_UNAVAILABLE'});
    });
  });

  const validateAction=(req:any,res:any,next:any)=>{
    const origin=String(req.headers?.origin||'');
    let sameOrigin=true;
    try{if(origin)sameOrigin=new URL(origin).host===req.get('host');}catch{sameOrigin=false;}
    if(!sameOrigin||req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({error:'HELP_ORIGIN_DENIED'});
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)||JSON.stringify(req.body).length>1024)
      return res.status(400).json({error:'HELP_INVALID_REQUEST'});
    return next();
  };
  const actionLimiter=deps.actionLimiter||((_req:any,_res:any,next:any)=>next());
  const handleAction=(support:boolean)=>async(req:any,res:any)=>{
    const context=helpContext(req);
    if(!context.clinicId||!context.userId||!context.membershipId)return res.status(403).json({error:'HELP_CLINIC_CONTEXT_REQUIRED'});
    const allowed=new Set(['articleId','contentRevision','contextKey',...(support?[]:['completed'])]);
    if(Object.keys(req.body).some(key=>!allowed.has(key))||typeof req.body.articleId!=='string'||typeof req.body.contentRevision!=='string'||
      (!support&&typeof req.body.completed!=='boolean'))return res.status(400).json({error:'HELP_INVALID_REQUEST'});
    if(req.body.contextKey!==context.contextKey)return res.status(409).json({error:'HELP_CONTEXT_CHANGED'});
    const article=projectArticles(context.audience,context.capabilities,context.modules).find(a=>a.articleId===req.body.articleId&&a.contentRevision);
    if(!article)return res.status(404).json({error:'HELP_TOPIC_NOT_FOUND'});
    if(article.contentRevision!==req.body.contentRevision)return res.status(409).json({error:'HELP_TOPIC_UPDATED'});
    try{
      const params:any={p_user_id:context.userId,p_clinic_id:context.clinicId,p_membership_id:context.membershipId,p_role:context.audience,
        p_article_id:article.articleId,p_content_revision:article.contentRevision};
      if(!support)params.p_completed=req.body.completed;
      const result=await supabase.rpc(support?'get_help_tutorial_completion':'set_help_tutorial_completion',params);
      if(result.error){
        const denied=result.error.code==='42501';
        return res.status(denied?403:503).json({error:denied?'HELP_ACCESS_DENIED':'HELP_PROGRESS_UNAVAILABLE'});
      }
      const completedAt=result.data?.completedAt||null;
      if(!support)return res.json({contextKey:context.contextKey,articleId:article.articleId,contentRevision:article.contentRevision,completedAt});
      const tutorialUrl=`/ajuda?topico=${encodeURIComponent(article.articleId)}`;
      if(!completedAt)return res.json({contextKey:context.contextKey,completed:false,tutorialUrl,
        message:'Notei que esse assunto está no tutorial e parece que você ainda não marcou essa parte como concluída. Caso já tenha visto, marque como Concluído. Depois, responda novamente se ainda precisa de ajuda.'});
      // Keep this server-only; never use a sales number as a support fallback.
      const number=String(deps.supportNumber?.()??process.env.HELP_SUPPORT_WHATSAPP_NUMBER??'').trim();
      if(!/^\+?[0-9 ()-]{10,24}$/.test(number)||!/^\d{10,15}$/.test(number.replace(/\D/g,'')))
        return res.status(503).json({error:'HELP_SUPPORT_CONTACT_NOT_CONFIGURED'});
      return res.json({contextKey:context.contextKey,completed:true,
        message:`Envie uma mensagem para o WhatsApp ${number}. Informe sua clínica, o assunto “${article.title}” e especifique a sua dúvida.`});
    }catch{return res.status(503).json({error:'HELP_PROGRESS_UNAVAILABLE'});}
  };
  app.post('/api/help/tutorial-progress', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), actionLimiter, validateAction, handleAction(false));
  app.post('/api/help/support', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), actionLimiter, validateAction, handleAction(true));

  app.get('/api/help/media/:mediaId', noStoreDynamicResponse, checkAuth, requireClinicCapability('clinic.view'), async (req: any, res: any) => {
    const { clinicId, audience, capabilities, modules } = helpContext(req);
    if (!clinicId) return res.status(403).json({ error: 'HELP_CLINIC_CONTEXT_REQUIRED' });
    const mediaId = String(req.params.mediaId || '');
    const media = resolveMedia(mediaId);
    if (!media) return res.status(404).json({ error: 'HELP_MEDIA_NOT_FOUND' });
    const authorizedArticle = projectArticles(audience, capabilities, modules).find(article => article.mediaIds.includes(mediaId));
    if (!authorizedArticle) return res.status(404).json({ error: 'HELP_MEDIA_NOT_FOUND' });
    const { data, error } = await supabase.storage.from(HELP_MEDIA_BUCKET).createSignedUrl(media.objectKey, 60);
    if (error || !data?.signedUrl) return res.status(404).json({ error: 'HELP_MEDIA_UNAVAILABLE' });
    res.setHeader('Cache-Control', 'private, no-store');
    if (media.mimeType.startsWith('video/')) res.setHeader('Accept-Ranges', 'bytes');
    if (media.mimeType.startsWith('video/') && req.headers?.range) {
      res.setHeader('Location', data.signedUrl);
      return res.status(307).end();
    }
    return res.json({ mediaId: media.mediaId, mimeType: media.mimeType, url: data.signedUrl, expiresIn: 60, supportsRange: media.mimeType.startsWith('video/') });
  });
}
