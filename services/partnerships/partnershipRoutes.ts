import crypto from 'node:crypto';

const PARTNER_ACCOUNT_FIELDS = 'id,user_id,display_name,partner_kind,referral_code,status,compliance_approved,created_at';
const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safe = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const newCode = () => 'VERTO-' + crypto.randomBytes(9).toString('hex').toUpperCase();
const fail = (res: any) => res.status(503).json({success:false,error:'PARTNERSHIPS_UNAVAILABLE'});
const ownId = (req: any) => safe(req.session?.user?.id,120);
const isConflict = (error: any) => error?.code === '23505';
const isValidEmail = (v: string) => !v || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));

type Deps = {supabase:any;checkAuth:any;checkPlatformAdmin:any};

/**
 * Isolated server boundary for commercial SaaS referrals. Never use the current
 * clinic from frontend payloads or auth.user_metadata to grant access.
 */
export function registerPartnershipRoutes(app:any, deps:Deps) {
  const {supabase,checkAuth,checkPlatformAdmin}=deps;
  const adminGuard=[checkAuth,checkPlatformAdmin];

  app.get('/api/partnerships/me',checkAuth,async(req:any,res:any)=>{
    const userId=ownId(req);
    if(!uuid(userId))return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    try {
      const account=await supabase.from('verto_partner_accounts')
        .select(PARTNER_ACCOUNT_FIELDS).eq('user_id',userId).maybeSingle();
      if(account.error)throw account.error;
      if(!account.data)return res.json({success:true,account:null,referrals:[]});
      const overview=await supabase.rpc('verto_partner_referral_overview_v1',{p_user_id:userId,p_limit:50,p_offset:0});
      if(overview.error)throw overview.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,account:account.data,referrals:overview.data||[]});
    }catch{return fail(res);}
  });

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
    if(displayName.length<2||!isValidEmail(contactEmail)
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
    }catch{return fail(res);}
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
}
