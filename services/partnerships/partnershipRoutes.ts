import crypto from 'node:crypto';
import { registerPartnerMarketplaceRoutes } from './marketplaceRoutes';
import { rateLimit } from 'express-rate-limit';

const PARTNER_ACCOUNT_FIELDS = 'id,user_id,display_name,partner_kind,referral_code,referral_alias,status,compliance_approved,created_at';
const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safe = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const newCode = () => 'VERTO-' + crypto.randomBytes(9).toString('hex').toUpperCase();
const fail = (res: any) => res.status(503).json({success:false,error:'PARTNERSHIPS_UNAVAILABLE'});
const ownId = (req: any) => safe(req.session?.user?.id,120);
const isConflict = (error: any) => error?.code === '23505';
const isValidEmail = (v: string) => !v || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
const saveSession = (req:any) => new Promise<void>((resolve,reject) => {
  if (!req.session?.save) return reject(new Error('SESSION_NOT_AVAILABLE'));
  req.session.save((error:any) => error ? reject(error) : resolve());
});


type Deps = {supabase:any;checkAuth:any;checkPlatformAdmin:any};

/**
 * Isolated server boundary for commercial SaaS referrals. Never use the current
 * clinic from frontend payloads or auth.user_metadata to grant access.
 */
export function registerPartnershipRoutes(app:any, deps:Deps) {
  const {supabase,checkAuth,checkPlatformAdmin}=deps;
  const adminGuard=[checkAuth,checkPlatformAdmin];
  const partnerLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, error: 'TOO_MANY_LOGIN_ATTEMPTS' },
  });
  const partnerApplicationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, error: 'TOO_MANY_APPLICATION_ATTEMPTS' },
  });

  // A public application requires a fresh, verified Supabase identity.
  // Name is the only user-entered field; email is derived from the verified token.
  // Neither the browser nor the applicant can approve a partner or create a referral.
  app.post('/api/partnerships/apply',partnerApplicationLimiter,async(req:any,res:any)=>{
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
       ||Object.keys(req.body).some(k=>!['accessToken','displayName'].includes(k))
       ||typeof req.body.accessToken!=='string'
       ||req.body.accessToken.length<40||req.body.accessToken.length>8192
       ||typeof req.body.displayName!=='string'
       ||req.body.displayName.length>180)
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    const displayName=safe(req.body.displayName,180);
    if(displayName.length<2)return res.status(400).json({success:false,error:'INVALID_PARTNER'});
    if(req.session?.user?.id)
      return res.status(409).json({success:false,error:'CLINICAL_SESSION_ACTIVE'});
    try{
      const verified=await supabase.auth.getUser(req.body.accessToken);
      const identity=verified.data?.user;
      const email=safe(identity?.email,254).toLowerCase();
      if(verified.error||!uuid(identity?.id)||!identity?.email_confirmed_at
         ||!email||!isValidEmail(email))
        return res.status(401).json({success:false,error:'EMAIL_VERIFICATION_REQUIRED'});
      const created=await supabase.from('verto_partner_accounts')
        .insert({
          display_name:displayName,contact_email:email,
          partner_kind:'external',referral_code:newCode(),status:'pending',
          compliance_approved:false,
        }).select('status').single();
      if(!created.error){
        res.setHeader('Cache-Control','no-store');
        return res.status(201).json({success:true,status:'pending'});
      }
      if(!isConflict(created.error))throw created.error;
      // DB's unique normalized-email index makes concurrent submissions idempotent.
      // Never update an approved, suspended, or pending application from this route.
      const existing=await supabase.from('verto_partner_accounts')
        .select('status').eq('partner_kind','external')
        .eq('contact_email',email).maybeSingle();
      if(existing.error)throw existing.error;
      if(!existing.data)return res.status(409).json({success:false,error:'APPLICATION_EXISTS'});
      res.setHeader('Cache-Control','no-store');
      return res.json({success:true,status:existing.data.status,idempotent:true});
    }catch{return fail(res);}
  });

  // Isolated external login: a verified Supabase identity is matched ONLY against
  // a previously registered partner email; no clinic role or session is created.
  app.post('/api/partnerships/auth/session',partnerLoginLimiter,async(req:any,res:any)=>{
    if(!req.is('application/json') || !req.body || Array.isArray(req.body)
       || Object.keys(req.body).some(k=>k!=='accessToken')
       || typeof req.body.accessToken!=='string'
       || req.body.accessToken.length<40 || req.body.accessToken.length>8192)
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    try{
      const auth=await supabase.auth.getUser(req.body.accessToken);
      const identity=auth.data?.user;
      const email=safe(identity?.email,254).toLowerCase();
      if(auth.error || !uuid(identity?.id) || !email || !identity?.email_confirmed_at)
        return res.status(401).json({success:false,error:'EMAIL_VERIFICATION_REQUIRED'});
      // Prevent a partner login from silently changing an active clinical session.
      if(req.session?.user?.id)
        return res.status(409).json({success:false,error:'CLINICAL_SESSION_ACTIVE'});
      const found=await supabase.from('verto_partner_accounts')
        .select(PARTNER_ACCOUNT_FIELDS+',contact_email,partner_kind')
        .eq('partner_kind','external').eq('contact_email',email).maybeSingle();
      if(found.error)throw found.error;
      if(!found.data)return res.status(403).json({success:false,error:'PARTNER_NOT_REGISTERED'});
      if(found.data.status!=='approved'||found.data.compliance_approved!==true)
        return res.status(403).json({success:false,
          error:found.data.status==='pending'?'PARTNER_APPROVAL_PENDING':'PARTNER_ACCESS_DENIED'});
      if(!req.session)return fail(res);
      req.session.partnerAccountId=found.data.id;
      req.session.partnerAuthUserId=identity.id;
      req.session.partnerEmail=email;
      req.session.partnerAuthAt=Date.now();
      await saveSession(req);
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true});
    }catch{return fail(res);}
  });

  app.get('/api/partnerships/portal',async(req:any,res:any)=>{
    const id=safe(req.session?.partnerAccountId,120);
    const email=safe(req.session?.partnerEmail,254).toLowerCase();
    const authAt=Number(req.session?.partnerAuthAt);
    if(!uuid(id)||!uuid(req.session?.partnerAuthUserId)||!email || !Number.isFinite(authAt)
       || authAt > Date.now() || Date.now()-authAt > 12*60*60*1000)
      return res.status(401).json({success:false,error:'PARTNER_LOGIN_REQUIRED'});
    try{
      const found=await supabase.from('verto_partner_accounts')
        .select(PARTNER_ACCOUNT_FIELDS+',contact_email,partner_kind')
        .eq('id',id).eq('partner_kind','external').eq('contact_email',email).maybeSingle();
      if(found.error)throw found.error;
      if(!found.data||found.data.status!=='approved'||found.data.compliance_approved!==true)
        return res.status(403).json({success:false,error:'PARTNER_ACCESS_DENIED'});
      const overview=await supabase.rpc('verto_partner_referral_overview_v1',{
        p_partner_id:found.data.id,p_limit:50,p_offset:0
      });
      if(overview.error)throw overview.error;
      res.setHeader('Cache-Control','private, no-store');
      const {contact_email,partner_kind,...account}=found.data;
      return res.json({success:true,account,referrals:overview.data||[]});
    }catch{return fail(res);}
  });

  app.post('/api/partnerships/auth/logout',async(req:any,res:any)=>{
    if(req.session){
      delete req.session.partnerAccountId;
      delete req.session.partnerAuthUserId;
      delete req.session.partnerEmail;
      delete req.session.partnerAuthAt;
      try{await saveSession(req);}catch{return fail(res);}
    }
    res.setHeader('Cache-Control','no-store');
    return res.json({success:true});
  });

  app.get('/api/partnerships/me',checkAuth,async(req:any,res:any)=>{
    const userId=ownId(req);
    if(!uuid(userId))return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    try {
      const account=await supabase.from('verto_partner_accounts')
        .select(PARTNER_ACCOUNT_FIELDS).eq('user_id',userId).maybeSingle();
      if(account.error)throw account.error;
      if(!account.data)return res.json({success:true,account:null,referrals:[]});
      const overview=await supabase.rpc('verto_partner_referral_overview_v1',{p_partner_id:account.data.id,p_limit:50,p_offset:0});
      if(overview.error)throw overview.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,account:account.data,referrals:overview.data||[]});
    }catch{return fail(res);}
  });

  // A coupon is reserved once: existing links and attribution keep working forever.
  // The authenticated partner may claim their own alias, never a caller-supplied ID.
  const saveReferralAlias = async(req:any,res:any,mode:'external'|'professional'|'owner')=>{
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
       ||Object.keys(req.body).length!==1||typeof req.body.couponCode!=='string'
       ||req.body.couponCode.length>64)
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    const alias=req.body.couponCode.trim().replace(/\s+/g,'').toUpperCase();
    if(!/^[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/.test(alias) || alias.startsWith('VERTO-'))
      return res.status(400).json({success:false,error:'INVALID_REFERRAL_COUPON'});
    const external=mode==='external';
    const owner=mode==='owner';
    const identity=owner?safe(req.params?.id,120)
      :external?safe(req.session?.partnerAccountId,120):ownId(req);
    const email=safe(req.session?.partnerEmail,254).toLowerCase();
    const authAt=Number(req.session?.partnerAuthAt);
    if(!uuid(identity) || (external && (
       !uuid(req.session?.partnerAuthUserId)||!email||!Number.isFinite(authAt)
       ||authAt>Date.now()||Date.now()-authAt>12*60*60*1000
       ||req.session?.user?.id)))
      return res.status(owner?400:401).json({success:false,error:owner?'INVALID_REQUEST':'PARTNER_LOGIN_REQUIRED'});
    try{
      if(!external&&!owner){
        // Reconfirm current clinic membership; a stale clinical role alone is insufficient.
        const membership=await supabase.from('clinic_memberships').select('id')
          .eq('user_id',identity).eq('status','active')
          .in('role',['therapist','supervisor']).limit(1);
        if(membership.error)throw membership.error;
        if(!membership.data?.length)
          return res.status(403).json({success:false,error:'ACTIVE_PROFESSIONAL_REQUIRED'});
      }
      let lookup=supabase.from('verto_partner_accounts')
        .select('id,status,compliance_approved,referral_alias');
      lookup=owner?lookup.eq('id',identity)
        :external?lookup.eq('partner_kind','external').eq('id',identity).eq('contact_email',email)
        :lookup.eq('partner_kind','professional').eq('user_id',identity);
      const found=await lookup.maybeSingle();
      if(found.error)throw found.error;
      if(!found.data && owner)
        return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND'});
      if(!found.data || found.data.status!=='approved' || found.data.compliance_approved!==true)
        return res.status(403).json({success:false,error:'PARTNER_ACCESS_DENIED'});
      if(found.data.referral_alias){
        if(found.data.referral_alias!==alias)
          return res.status(409).json({success:false,error:'REFERRAL_COUPON_LOCKED'});
        return res.json({success:true,couponCode:alias,idempotent:true});
      }
      const updated=await supabase.from('verto_partner_accounts')
        .update({referral_alias:alias,updated_at:new Date().toISOString()})
        .eq('id',found.data.id).eq('status','approved').eq('compliance_approved',true)
        .is('referral_alias',null).select('referral_alias').maybeSingle();
      if(isConflict(updated.error))
        return res.status(409).json({success:false,error:'REFERRAL_COUPON_TAKEN'});
      if(updated.error)throw updated.error;
      if(!updated.data){
        const latest=await supabase.from('verto_partner_accounts')
          .select('referral_alias').eq('id',found.data.id).maybeSingle();
        if(latest.error)throw latest.error;
        if(latest.data?.referral_alias===alias)
          return res.json({success:true,couponCode:alias,idempotent:true});
        return res.status(409).json({success:false,error:'REFERRAL_COUPON_LOCKED'});
      }
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,couponCode:alias});
    }catch{return fail(res);}
  };
  app.patch('/api/partnerships/portal/referral-alias',
    (req:any,res:any)=>saveReferralAlias(req,res,'external'));
  app.patch('/api/partnerships/me/referral-alias',checkAuth,
    (req:any,res:any)=>saveReferralAlias(req,res,'professional'));

  app.post('/api/partnerships/me',checkAuth,async(req:any,res:any)=>{
    const userId=ownId(req);
    if(!uuid(userId))return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
       ||Object.keys(req.body).length!==0)return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    try{
      // Only a DB-confirmed active professional membership may self-register.
      // A user role from a session or URL is never sufficient.
      const [membership,user,existing]=await Promise.all([
        supabase.from('clinic_memberships').select('id').eq('user_id',userId)
          .eq('status','active').in('role',['therapist','supervisor']).limit(1),
        supabase.from('users').select('id,name,email').eq('id',userId).maybeSingle(),
        supabase.from('verto_partner_accounts').select(PARTNER_ACCOUNT_FIELDS).eq('user_id',userId).maybeSingle()
      ]);
      if(membership.error||user.error||existing.error)throw membership.error||user.error||existing.error;
      if(!membership.data?.length||!user.data)return res.status(403).json({success:false,error:'ACTIVE_PROFESSIONAL_REQUIRED'});
      if(existing.data)return res.json({success:true,account:existing.data,idempotent:true});
      const name=safe(user.data.name,180);
      if(name.length<2)return res.status(409).json({success:false,error:'PROFILE_NAME_REQUIRED'});
      let created:any=null;
      for(let i=0;i<2;i++){
        const result=await supabase.from('verto_partner_accounts').insert({
          user_id:userId,display_name:name,contact_email:safe(user.data.email,254).toLowerCase()||null,
          partner_kind:'professional',referral_code:newCode(),status:'pending',
          compliance_approved:false,created_by:userId,
        }).select(PARTNER_ACCOUNT_FIELDS).single();
        if(!result.error){created=result.data;break;}
        if(!isConflict(result.error))throw result.error;
        const stored=await supabase.from('verto_partner_accounts').select(PARTNER_ACCOUNT_FIELDS)
          .eq('user_id',userId).maybeSingle();
        if(stored.error)throw stored.error;
        if(stored.data)return res.json({success:true,account:stored.data,idempotent:true});
      }
      if(!created)return fail(res);
      res.setHeader('Cache-Control','private, no-store');
      return res.status(201).json({success:true,account:created});
    }catch{return fail(res);}
  });

  app.get('/api/owner/partnerships/accounts',...adminGuard,async(req:any,res:any)=>{
    try{
      const result=await supabase.from('verto_partner_accounts')
        .select(PARTNER_ACCOUNT_FIELDS+',contact_email')
        .order('created_at',{ascending:false}).limit(100);
      if(result.error)throw result.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,accounts:result.data||[]});
    }catch{return fail(res);}
  });

  app.post('/api/owner/partnerships/accounts',...adminGuard,async(req:any,res:any)=>{
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
      ||Object.keys(req.body).some(k=>!['displayName','contactEmail'].includes(k)))
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    const displayName=safe(req.body.displayName,180);
    const contactEmail=safe(req.body.contactEmail,254).toLowerCase();
    if(displayName.length<2||!contactEmail||!isValidEmail(contactEmail)
      ||(typeof req.body.displayName==='string'&&req.body.displayName.length>180)
      ||(typeof req.body.contactEmail==='string'&&req.body.contactEmail.length>254))
      return res.status(400).json({success:false,error:'INVALID_PARTNER'});
    const userId=ownId(req);
    if(!uuid(userId))return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    try{
      const result=await supabase.from('verto_partner_accounts')
        .insert({display_name:displayName,contact_email:contactEmail||null,
          partner_kind:'external',referral_code:newCode(),status:'pending',
          compliance_approved:false,created_by:userId})
        .select(PARTNER_ACCOUNT_FIELDS+',contact_email').single();
      if(result.error)throw result.error;
      return res.status(201).json({success:true,account:result.data});
    }catch(error:any){
      if(isConflict(error))return res.status(409).json({success:false,error:'PARTNER_EMAIL_ALREADY_REGISTERED'});
      return fail(res);
    }
  });

  app.patch('/api/owner/partnerships/accounts/:id',...adminGuard,async(req:any,res:any)=>{
    const id=safe(req.params?.id,120);
    if(!uuid(id)||!req.is('application/json')||!req.body||Array.isArray(req.body)
      ||Object.keys(req.body).some(k=>!['status','complianceApproved'].includes(k)))
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    const status=req.body.status, complianceApproved=req.body.complianceApproved;
    if(!['pending','approved','suspended'].includes(status)||typeof complianceApproved!=='boolean'
      ||(status==='approved'&&!complianceApproved))
      return res.status(400).json({success:false,error:'APPROVAL_REQUIRED'});
    try{
      const result=await supabase.from('verto_partner_accounts')
        .update({status,compliance_approved:complianceApproved,updated_at:new Date().toISOString()})
        .eq('id',id).select(PARTNER_ACCOUNT_FIELDS).maybeSingle();
      if(result.error)throw result.error;
      if(!result.data)return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND'});
      return res.json({success:true,account:result.data});
    }catch{return fail(res);}
  });

  app.patch('/api/owner/partnerships/accounts/:id/referral-alias',...adminGuard,
    (req:any,res:any)=>saveReferralAlias(req,res,'owner'));

  app.post('/api/owner/partnerships/referrals',...adminGuard,async(req:any,res:any)=>{
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
      ||Object.keys(req.body).some(k=>!['partnerId','leadId'].includes(k))
      ||!uuid(req.body.partnerId)||!uuid(req.body.leadId))
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    try{
      const result=await supabase.rpc('verto_owner_attach_partner_referral_v1',{
        p_partner_id:req.body.partnerId,p_lead_id:req.body.leadId
      });
      if(result.error)throw result.error;
      if(result.data!==true)return res.status(409).json({success:false,error:'REFERRAL_NOT_ELIGIBLE'});
      return res.json({success:true});
    }catch{return fail(res);}
  });
  registerPartnerMarketplaceRoutes(app,deps);
}
