import { rateLimit } from 'express-rate-limit';

type Deps = {supabase:any;checkAuth:any;checkPlatformAdmin:any};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v:unknown):v is string => typeof v === 'string' && UUID.test(v);
const error = (res:any, code:string, status=400) => res.status(status).json({success:false,error:code});
const unavailable = (res:any) => error(res,'MARKETPLACE_UNAVAILABLE',503);
const clinicRole = new Set(['director','coordinator','therapist','supervisor']);
const manageRole = new Set(['director','coordinator']);
const allowedBody = (req:any, keys:string[]) =>
  req.is('application/json') && req.body && !Array.isArray(req.body)
  && Object.keys(req.body).every((k)=>keys.includes(k));
const textValue = (v:unknown, limit:number) =>
  typeof v==='string' && v.length<=limit ? v.trim() : null;
const validatedLogo = (v:unknown) => {
  if(v===null||v==='')return null;
  if(typeof v!=='string'||v.length>500)return undefined;
  try{
    const url=new URL(v);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!url.hostname.includes('.'))return undefined;
    return url.toString();
  }catch{return undefined;}
};

/** B2B directory. Neither browser clinic IDs nor session roles grant authority. */
export function registerPartnerMarketplaceRoutes(app:any,{supabase,checkAuth,checkPlatformAdmin}:Deps) {
  const interestLimiter=rateLimit({
    windowMs:60*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,
    message:{success:false,error:'TOO_MANY_INTEREST_REQUESTS'}
  });
  const accountFields='id,display_name,status,compliance_approved,partner_kind,contact_email';
  const membership=async(req:any,clinicId:unknown) => {
    const userId=req.session?.user?.id;
    if(!isUuid(userId)||!isUuid(clinicId))return null;
    const result=await supabase.from('clinic_memberships').select('role')
      .eq('user_id',userId).eq('clinic_id',clinicId).eq('status','active').limit(1);
    if(result.error)throw result.error;
    const role=result.data?.[0]?.role;
    return clinicRole.has(role)?{userId,clinicId,role,canManage:manageRole.has(role)}:null;
  };
  const partnerAccount=async(req:any) => {
    const clinicalUserId=req.session?.user?.id;
    if(isUuid(clinicalUserId)){
      const r=await supabase.from('verto_partner_accounts').select(accountFields)
        .eq('user_id',clinicalUserId).eq('partner_kind','professional').maybeSingle();
      if(r.error)throw r.error;
      if(r.data?.status==='approved'&&r.data.compliance_approved===true)return r.data;
      return null;
    }
    const session=req.session;
    if(!isUuid(session?.partnerAccountId)||!isUuid(session?.partnerAuthUserId)
       ||typeof session?.partnerEmail!=='string'
       ||!Number.isFinite(session?.partnerAuthAt)
       ||session.partnerAuthAt>Date.now()
       ||Date.now()-session.partnerAuthAt>12*60*60*1000)return null;
    const r=await supabase.from('verto_partner_accounts').select(accountFields)
      .eq('id',session.partnerAccountId).eq('partner_kind','external')
      .eq('contact_email',session.partnerEmail.toLowerCase()).maybeSingle();
    if(r.error)throw r.error;
    return r.data?.status==='approved'&&r.data.compliance_approved===true?r.data:null;
  };

  app.get('/api/partnerships/marketplace',checkAuth,async(req:any,res:any)=>{
    try{
      const member=await membership(req,req.query?.clinicId);
      if(!member)return error(res,'CLINIC_MEMBERSHIP_REQUIRED',403);
      const [directory,mine,contact,clinic]=await Promise.all([
        supabase.from('verto_partner_marketplace_services')
          .select('partner_id,service_name,category,description,logo_url,photo_url,partner:verto_partner_accounts!inner(display_name,status,compliance_approved)')
          .eq('is_published',true).eq('partner.status','approved')
          .eq('partner.compliance_approved',true).order('updated_at',{ascending:false}).limit(50),
        supabase.from('verto_partner_marketplace_leads')
          .select('id,partner_id,status,agreed_monthly_cents,clinic_confirmed_at')
          .eq('clinic_id',member.clinicId).order('created_at',{ascending:false}).limit(50),
        supabase.from('users').select('name,email').eq('id',member.userId).maybeSingle(),
        supabase.from('clinics').select('phone_commercial').eq('id',member.clinicId).maybeSingle()
      ]);
      if(directory.error||mine.error||contact.error||clinic.error)throw directory.error||mine.error||contact.error||clinic.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,services:directory.data||[],
        mine:member.canManage?(mine.data||[]):(mine.data||[]).filter((l:any)=>l.status==='active').map((l:any)=>({...l,agreed_monthly_cents:null})),
        canManage:member.canManage,contact:member.canManage?{name:contact.data?.name,email:contact.data?.email,phone:clinic.data?.phone_commercial}:null});
    }catch{return unavailable(res);}
  });

  app.get('/api/partnerships/marketplace/reviews/:partnerId',checkAuth,async(req:any,res:any)=>{
    try{
      if(!isUuid(req.params?.partnerId))return error(res,'INVALID_PARTNER');
      const member=await membership(req,req.query?.clinicId);
      if(!member)return error(res,'CLINIC_MEMBERSHIP_REQUIRED',403);
      const reviews=await supabase.from('verto_partner_marketplace_reviews')
        .select('rating,comment,created_at').eq('partner_id',req.params.partnerId)
        .order('created_at',{ascending:false}).limit(20);
      if(reviews.error)throw reviews.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,reviews:reviews.data||[]});
    }catch{return unavailable(res);}
  });

  app.post('/api/partnerships/marketplace/interest',checkAuth,interestLimiter,async(req:any,res:any)=>{
    if(!allowedBody(req,['clinicId','partnerId','consent'])||!isUuid(req.body.clinicId)
       ||!isUuid(req.body.partnerId)||req.body.consent!==true)
      return error(res,'CONTACT_SHARING_CONSENT_REQUIRED');
    try{
      const member=await membership(req,req.body.clinicId);
      if(!member)return error(res,'CLINIC_MEMBERSHIP_REQUIRED',403);
      if(!member.canManage)return error(res,'CLINIC_REPRESENTATIVE_REQUIRED',403);
      // Contact identity comes from DB, never from the caller's JSON.
      const [contact,clinic]=await Promise.all([
        supabase.from('users').select('name,email').eq('id',member.userId).maybeSingle(),
        supabase.from('clinics').select('phone_commercial').eq('id',member.clinicId).maybeSingle()
      ]);
      if(contact.error||clinic.error)throw contact.error||clinic.error;
      const name=textValue(contact.data?.name,180);
      const email=textValue(contact.data?.email,254);
      if(!name||name.length<2||!email||!email.includes('@'))return error(res,'CONTACT_PROFILE_INCOMPLETE',409);
      const requested=await supabase.rpc('verto_marketplace_request_v1',{
        p_clinic_id:member.clinicId,p_partner_id:req.body.partnerId,
        p_user_id:member.userId,p_contact_name:name,p_contact_email:email,
        p_contact_phone:clinic.data?.phone_commercial||null,
        p_consent_version:'marketplace-2026-11-v1'
      });
      if(requested.error)throw requested.error;
      if(!requested.data)return error(res,'INTEREST_ALREADY_REGISTERED_OR_NOT_ELIGIBLE',409);
      res.setHeader('Cache-Control','private, no-store');
      return res.status(201).json({success:true,leadId:requested.data});
    }catch{return unavailable(res);}
  });

  app.post('/api/partnerships/marketplace/clinic-confirm/:id',checkAuth,async(req:any,res:any)=>{
    if(!isUuid(req.params?.id)||!allowedBody(req,['clinicId'])||!isUuid(req.body.clinicId))
      return error(res,'INVALID_REQUEST');
    try{
      const member=await membership(req,req.body.clinicId);
      if(!member||!member.canManage)return error(res,'CLINIC_REPRESENTATIVE_REQUIRED',403);
      const result=await supabase.rpc('verto_marketplace_clinic_confirm_v1',{
        p_lead_id:req.params.id,p_clinic_id:member.clinicId,p_user_id:member.userId
      });
      if(result.error)throw result.error;
      if(result.data!==true)return error(res,'CONTRACT_NOT_CONFIRMABLE',409);
      return res.json({success:true});
    }catch{return unavailable(res);}
  });

  app.post('/api/partnerships/marketplace/review/:id',checkAuth,async(req:any,res:any)=>{
    if(!isUuid(req.params?.id)||!allowedBody(req,['clinicId','rating','comment'])
      ||!isUuid(req.body.clinicId)||!Number.isInteger(req.body.rating)
      ||req.body.rating<1||req.body.rating>5||typeof req.body.comment!=='string'
      ||req.body.comment.length>1000)return error(res,'INVALID_REVIEW');
    try{
      const member=await membership(req,req.body.clinicId);
      if(!member||!member.canManage)return error(res,'CLINIC_REPRESENTATIVE_REQUIRED',403);
      const lead=await supabase.from('verto_partner_marketplace_leads')
        .select('id').eq('id',req.params.id).eq('clinic_id',member.clinicId).eq('status','active').maybeSingle();
      if(lead.error)throw lead.error;
      if(!lead.data)return error(res,'VERIFIED_CONTRACT_REQUIRED',403);
      const result=await supabase.rpc('verto_marketplace_save_review_v1',{
        p_lead_id:req.params.id,p_user_id:member.userId,
        p_rating:req.body.rating,p_comment:req.body.comment.trim()
      });
      if(result.error)throw result.error;
      if(result.data!==true)return error(res,'REVIEW_NOT_ALLOWED',409);
      return res.json({success:true});
    }catch{return unavailable(res);}
  });

  app.get('/api/partnerships/marketplace/partner',async(req:any,res:any)=>{
    try{
      const partner=await partnerAccount(req);
      if(!partner)return error(res,'PARTNER_LOGIN_REQUIRED',401);
      const [profile,inbox]=await Promise.all([
        supabase.from('verto_partner_marketplace_services')
          .select('service_name,category,description,logo_url,photo_url,is_published')
          .eq('partner_id',partner.id).maybeSingle(),
        supabase.from('verto_partner_marketplace_leads')
          .select('id,contact_name,contact_email,contact_phone,status,agreed_monthly_cents,created_at,clinic:clinics(name)')
          .eq('partner_id',partner.id).order('created_at',{ascending:false}).limit(50)
      ]);
      if(profile.error||inbox.error)throw profile.error||inbox.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,profile:profile.data||null,inbox:inbox.data||[]});
    }catch{return unavailable(res);}
  });

  app.patch('/api/partnerships/marketplace/partner/profile',async(req:any,res:any)=>{
    if(!allowedBody(req,['serviceName','category','description','logoUrl','photoUrl']))return error(res,'INVALID_PROFILE');
    const serviceName=textValue(req.body.serviceName,120);
    const category=textValue(req.body.category,70);
    const description=textValue(req.body.description,2000);
    const logoUrl=validatedLogo(req.body.logoUrl??null);
    const photoUrl=validatedLogo(req.body.photoUrl??null);
    if(!serviceName||serviceName.length<2||!category||category.length<2
      ||!description||description.length<20||logoUrl===undefined||photoUrl===undefined)
      return error(res,'INVALID_PROFILE');
    try{
      const partner=await partnerAccount(req);
      if(!partner)return error(res,'PARTNER_LOGIN_REQUIRED',401);
      const result=await supabase.from('verto_partner_marketplace_services').upsert({
        partner_id:partner.id,service_name:serviceName,category,description,
        logo_url:logoUrl,photo_url:photoUrl,is_published:true,updated_at:new Date().toISOString()
      },{onConflict:'partner_id'}).select('service_name,category,description,logo_url,photo_url').single();
      if(result.error)throw result.error;
      return res.json({success:true,profile:result.data});
    }catch{return unavailable(res);}
  });

  app.post('/api/partnerships/marketplace/partner/confirm/:id',async(req:any,res:any)=>{
    if(!isUuid(req.params?.id)||!allowedBody(req,['monthlyCents'])
       ||!Number.isSafeInteger(req.body.monthlyCents)
       ||req.body.monthlyCents<1||req.body.monthlyCents>100000000)
      return error(res,'INVALID_AMOUNT');
    try{
      const partner=await partnerAccount(req);
      if(!partner)return error(res,'PARTNER_LOGIN_REQUIRED',401);
      const result=await supabase.rpc('verto_marketplace_partner_confirm_v1',{
        p_lead_id:req.params.id,p_partner_id:partner.id,p_monthly_cents:req.body.monthlyCents
      });
      if(result.error)throw result.error;
      if(result.data!==true)return error(res,'CONTRACT_NOT_CONFIRMABLE',409);
      return res.json({success:true});
    }catch{return unavailable(res);}
  });

  app.get('/api/owner/partnerships/marketplace',checkAuth,checkPlatformAdmin,async(_req:any,res:any)=>{
    try{
      const result=await supabase.from('verto_partner_marketplace_leads')
        .select('id,status,agreed_monthly_cents,created_at,clinic:clinics(name),partner:verto_partner_accounts(display_name)')
        .order('created_at',{ascending:false}).limit(100);
      if(result.error)throw result.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,leads:result.data||[]});
    }catch{return unavailable(res);}
  });
}
