import {rateLimit} from 'express-rate-limit';

// Contacts for partner-led outreach are NOT sales leads or commission attribution.
const CONTACT_FIELDS='id,clinic_name,phone_e164,created_at';
const uuid=(value:unknown)=>typeof value==='string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normalizePhone=(value:unknown):string|null=>{
  if(typeof value!=='string'||value.length>32)return null;
  const digits=value.replace(/\D/g,'');
  const full=digits.length===10||digits.length===11?'55'+digits:digits;
  return /^55[1-9][0-9][2-9][0-9]{7,8}$/.test(full)?full:null;
};

type Deps={supabase:any;checkAuth:any};

export function registerPartnerWhatsappContactRoutes(app:any,{supabase,checkAuth}:Deps){
  const writeLimiter=rateLimit({
    windowMs:60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,
    message:{success:false,error:'TOO_MANY_CONTACTS'}
  });
  // Resolve access on every request. Never accept partner/clinic/user IDs from the browser.
  const authorizedPartner=async(req:any,mode:'external'|'professional')=>{
    let lookup=supabase.from('verto_partner_accounts').select('id')
      .eq('status','approved').eq('compliance_approved',true);
    if(mode==='external'){
      const id=req.session?.partnerAccountId;
      const email=req.session?.partnerEmail;
      const authAt=Number(req.session?.partnerAuthAt);
      if(!uuid(id)||!uuid(req.session?.partnerAuthUserId)
        ||typeof email!=='string'||!email||email.length>254
        ||!Number.isFinite(authAt)||authAt>Date.now()
        ||Date.now()-authAt>12*60*60*1000||req.session?.user?.id)
        return null;
      lookup=lookup.eq('partner_kind','external').eq('id',id)
        .eq('contact_email',email.trim().toLowerCase());
    }else{
      const userId=req.session?.user?.id;
      if(!uuid(userId))return null;
      const membership=await supabase.from('clinic_memberships').select('id')
        .eq('user_id',userId).eq('status','active')
        .in('role',['therapist','supervisor']).limit(1);
      if(membership.error)throw membership.error;
      if(!membership.data?.length)return null;
      lookup=lookup.eq('partner_kind','professional').eq('user_id',userId);
    }
    const found=await lookup.maybeSingle();
    if(found.error)throw found.error;
    return found.data?.id||null;
  };
  const list=async(req:any,res:any,mode:'external'|'professional')=>{
    try{
      const partnerId=await authorizedPartner(req,mode);
      if(!partnerId)return res.status(403).json({success:false,error:'PARTNER_ACCESS_DENIED'});
      const result=await supabase.from('verto_partner_whatsapp_contacts')
        .select(CONTACT_FIELDS).eq('partner_id',partnerId)
        .order('created_at',{ascending:false}).limit(25);
      if(result.error)throw result.error;
      res.setHeader('Cache-Control','private, no-store');
      return res.json({success:true,contacts:result.data||[]});
    }catch{return res.status(503).json({success:false,error:'PARTNERSHIPS_UNAVAILABLE'});}
  };
  const save=async(req:any,res:any,mode:'external'|'professional')=>{
    if(!req.is('application/json')||!req.body||Array.isArray(req.body)
      ||Object.keys(req.body).sort().join(',')!=='clinicName,phone'
      ||typeof req.body.clinicName!=='string'||req.body.clinicName.length>180){
      return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    }
    const clinicName=req.body.clinicName.trim();
    const phone=normalizePhone(req.body.phone);
    if(clinicName.length<2||!phone)
      return res.status(400).json({success:false,error:'INVALID_CONTACT'});
    try{
      const partnerId=await authorizedPartner(req,mode);
      if(!partnerId)return res.status(403).json({success:false,error:'PARTNER_ACCESS_DENIED'});
      const result=await supabase.from('verto_partner_whatsapp_contacts').upsert({
        partner_id:partnerId,clinic_name:clinicName,phone_e164:phone,
        updated_at:new Date().toISOString(),
      },{onConflict:'partner_id,phone_e164'}).select(CONTACT_FIELDS).single();
      if(result.error)throw result.error;
      res.setHeader('Cache-Control','private, no-store');
      // Saving a contact NEVER claims a referral, creates a sales lead, or marks WhatsApp as sent.
      return res.json({success:true,contact:result.data});
    }catch{return res.status(503).json({success:false,error:'PARTNERSHIPS_UNAVAILABLE'});}
  };
  app.get('/api/partnerships/portal/whatsapp-contacts',
    (req:any,res:any)=>list(req,res,'external'));
  app.post('/api/partnerships/portal/whatsapp-contacts',writeLimiter,
    (req:any,res:any)=>save(req,res,'external'));
  app.get('/api/partnerships/me/whatsapp-contacts',checkAuth,
    (req:any,res:any)=>list(req,res,'professional'));
  app.post('/api/partnerships/me/whatsapp-contacts',checkAuth,writeLimiter,
    (req:any,res:any)=>save(req,res,'professional'));
}
