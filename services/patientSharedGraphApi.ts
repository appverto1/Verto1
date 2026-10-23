import { clinicalSpecialtiesMatch } from '../src/utils/clinicalSpecialties';

type Scope = {
  id: string;
  clinicId: string;
  globalId: string;
  active: boolean;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const clean = (value: unknown, max = 180) => String(value ?? '').trim().slice(0, max);
export const encodeSharedClinicalMetric = (specialty: unknown, metric: unknown) =>
  `${encodeURIComponent(clean(specialty || 'GERAL'))}::${encodeURIComponent(clean(metric))}`;
export const decodeSharedClinicalMetric = (key: unknown) => {
  const parts = clean(key).split('::');
  if (parts.length !== 2) return null;
  try {
    const specialty = decodeURIComponent(parts[0]), metric = decodeURIComponent(parts[1]);
    return specialty.length > 0 && metric.length > 0 ? { specialty, metric } : null;
  } catch { return null; }
};
export const sharedGraphOwnerIsLive = (owner: any, publication: any) =>
  Boolean(owner?.id && owner.id === publication?.patient_id &&
    owner.clinic_id === publication?.clinic_id &&
    owner.global_patient_identity_id === publication?.global_patient_identity_id &&
    owner.is_active === true && !owner.deleted_at && !owner.archived_at &&
    !['ended','inactive','terminated','revoked'].includes(clean(owner.relationship_status).toLowerCase()));

export function createPatientSharedGraphApi(deps: {
  supabase: any;
  currentClinicId: (user: any) => string | null;
  resolveClinicCapabilityContext: (user: any) => Promise<any>;
}) {
  const { supabase, currentClinicId, resolveClinicCapabilityContext } = deps;
  const readScope = async (patientId: string, clinicId?: string): Promise<Scope | null> => {
    if (!uuid(patientId)) return null;
    let query = supabase.from('patients')
      .select('id,clinic_id,global_patient_identity_id,is_active,deleted_at,archived_at,relationship_status')
      .eq('id',patientId);
    if (clinicId) query = query.eq('clinic_id',clinicId);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,clinicId: data.clinic_id,globalId: data.global_patient_identity_id,
      active: Boolean(data.is_active === true && !data.deleted_at && !data.archived_at &&
        !['ended','inactive','terminated','revoked'].includes(clean(data.relationship_status).toLowerCase()))
    };
  };
  const readPublication = async (globalId: string) => {
    if (!uuid(globalId)) return null;
    const { data,error } = await supabase.from('patient_shared_graph_publications')
      .select('global_patient_identity_id,clinic_id,patient_id,graph_type,graph_key,status,version,updated_at')
      .eq('global_patient_identity_id',globalId).limit(1).maybeSingle();
    if(error) throw error;
    return data;
  };
  const ownerIsActive = async (publication: any) => {
    if (!publication || publication.status !== 'ACTIVE') return false;
    const owner = await readScope(publication.patient_id, publication.clinic_id);
    return Boolean(owner?.active && owner.globalId === publication.global_patient_identity_id);
  };
  const sendError = (res: any, error: any) => {
    const msg = clean(error?.message || error,240);
    if (/SHARED_GRAPH_(VERSION_CONFLICT|OTHER_CLINIC_OWNS_PUBLICATION)/.test(msg)) {
      return res.status(409).json({success:false,error:msg.includes('VERSION_CONFLICT')?'GRAPH_VERSION_CONFLICT':'GRAPH_OWNED_BY_OTHER_CLINIC'});
    }
    if (/SHARED_GRAPH_(PATIENT_NOT_LINKED|INVALID_REQUEST|INVALID_GRAPH)/.test(msg)) {
      return res.status(403).json({success:false,error:'GRAPH_PUBLICATION_NOT_ALLOWED'});
    }
    console.error('[PatientGraphSharing] operation failed',clean(error?.code || error?.message,150));
    return res.status(503).json({success:false,error:'GRAPH_SHARING_UNAVAILABLE',message:'Não foi possível concluir esta operação agora.'});
  };
  const clinicContext = async (req:any, res:any) => {
    const user=req.session?.user;
    const ctx=req.authorizationContext || await resolveClinicCapabilityContext(user);
    const clinicId=clean(currentClinicId(user),80);
    const patientId=clean(req.resolvedPatientId || req.params?.patientId,80);
    if (!ctx || ctx.clinicId!==clinicId || !ctx.capabilities?.has('aba.analytics.view')) {
      res.status(403).json({success:false,error:'GRAPH_CLINIC_ACCESS_DENIED'});return null;
    }
    const scope=await readScope(patientId,clinicId);
    if (!scope?.active) {res.status(404).json({success:false,error:'GRAPH_PATIENT_NOT_ACTIVE'});return null;}
    const leader = ['director','coordinator'].includes(ctx.role)
      || ((ctx.role==='supervisor'||ctx.canSupervise===true) && Boolean(req.patientSupervisionLink));
    const hasCaseLink=Boolean(req.patientProfessionalLink);
    let delegated=false;
    if (!leader && hasCaseLink) {
      const {data,error}=await supabase.from('patient_shared_graph_delegations').select('professional_user_id')
        .eq('patient_id',patientId).eq('clinic_id',clinicId).eq('professional_user_id',ctx.userId)
        .is('revoked_at',null).limit(1).maybeSingle();
      if(error) throw error;
      delegated=Boolean(data);
    }
    return {ctx,clinicId,patientId,scope,leader,canPublish:leader||delegated,hasCaseLink};
  };
  const listCandidates = async (context:any, actorSpecialty:unknown) => {
    const items:any[] = [
      { graphType:'protocol_comparison', graphKey:'', label:'Comparativo por protocolo' },
      { graphType:'mastery_growth', graphKey:'', label:'Crescimento acumulado de habilidades' },
    ];
    const {data,error}=await supabase.from('clinical_observations')
      .select('metric_key,metric_label,specialty,observed_at')
      .eq('organization_id',context.clinicId).eq('patient_id',context.patientId)
      .not('metric_key','is',null).order('observed_at',{ascending:false}).limit(500);
    if (error) throw error;
    const seen=new Set<string>();
    for(const row of data||[]){
      if(!row.metric_key) continue;
      if(!context.leader && actorSpecialty &&
         !clinicalSpecialtiesMatch(actorSpecialty,row.specialty)) continue;
      if(!context.leader && !actorSpecialty) continue;
      const graphKey=encodeSharedClinicalMetric(row.specialty,row.metric_key);
      if(graphKey.length>180||seen.has(graphKey)) continue;
      seen.add(graphKey);
      items.push({graphType:'clinical_metric',graphKey,label:clean(`${row.metric_label||row.metric_key} · ${row.specialty||'Clínico'}`,200)});
    }
    return items;
  };

  const registerClinicRoutes = (app:any,middlewares:any) => {
    const guard=[middlewares.checkAuth,middlewares.requireClinicCapability('aba.analytics.view'),middlewares.checkPatientAccess];
    app.get('/api/patients/:patientId/shared-graph/manage',...guard,async(req:any,res:any)=>{
      try {
        const context=await clinicContext(req,res);if(!context)return;
        const current=uuid(context.scope.globalId)?await readPublication(context.scope.globalId):null;
        const owned=current?.status==='ACTIVE'&&await ownerIsActive(current);
        const activeOtherClinic=Boolean(owned && current.clinic_id!==context.clinicId);
        const candidates=await listCandidates(context,req.patientActorSpecialty);
        let professionals:any[]=[];
        let delegatedIds:string[]=[];
        if(context.leader){
          const {data:links,error:linksError}=await supabase.from('patient_professional_links')
            .select('professional_id').eq('patient_id',context.patientId)
            .eq('organization_id',context.clinicId).eq('status','active').limit(100);
          if(linksError)throw linksError;
          const ids=Array.from(new Set((links||[]).map((x:any)=>x.professional_id).filter(uuid))) as string[];
          if(ids.length){
            const [{data:members,error:memberError},{data:profiles,error:profileError},{data:grants,error:grantError}]=await Promise.all([
              supabase.from('clinic_memberships').select('user_id,role,status')
                .eq('clinic_id',context.clinicId).eq('status','active').in('user_id',ids),
              supabase.from('professional_profiles').select('user_id,full_name').in('user_id',ids),
              supabase.from('patient_shared_graph_delegations').select('professional_user_id')
                .eq('patient_id',context.patientId).eq('clinic_id',context.clinicId).is('revoked_at',null),
            ]);
            if(memberError||profileError||grantError)throw memberError||profileError||grantError;
            delegatedIds=(grants||[]).map((g:any)=>g.professional_user_id);
            professionals=(members||[]).filter((m:any)=>['therapist','supervisor'].includes(m.role))
              .map((m:any)=>({id:m.user_id,name:(profiles||[]).find((p:any)=>p.user_id===m.user_id)?.full_name||'Profissional',delegated:delegatedIds.includes(m.user_id)}));
          }
        }
        return res.set('Cache-Control','no-store').json({success:true,data:{
          canPublish:context.canPublish,canDelegate:context.leader,
          identityReady:uuid(context.scope.globalId),
          publication:activeOtherClinic?null:(owned?current:null),
          ownedByOtherClinic:activeOtherClinic,
          version:current?.version||0, candidates:context.canPublish?candidates:[],
          professionals,
        }});
      }catch(error){return sendError(res,error);}
    });
    app.post('/api/patients/:patientId/shared-graph/publication',...guard,async(req:any,res:any)=>{
      try{
        const context=await clinicContext(req,res);if(!context)return;
        if(!context.canPublish)return res.status(403).json({success:false,error:'GRAPH_PUBLICATION_NOT_DELEGATED'});
        if(!uuid(context.scope.globalId))return res.status(409).json({success:false,error:'GLOBAL_PATIENT_IDENTITY_NOT_CONFIRMED'});
        const action=clean(req.body?.action,20).toUpperCase(),kind=clean(req.body?.graphType,50);
        const graphKey=clean(req.body?.graphKey,180),version=req.body?.expectedVersion;
        if(!['PUBLISH','DISABLE'].includes(action) || !Number.isSafeInteger(version) || version<0)
          return res.status(400).json({success:false,error:'GRAPH_PUBLICATION_INVALID_PAYLOAD'});
        if(action==='PUBLISH'){
          const catalog=await listCandidates(context,req.patientActorSpecialty);
          if(!catalog.some((row:any)=>row.graphType===kind&&row.graphKey===graphKey))
            return res.status(403).json({success:false,error:'GRAPH_NOT_IN_AUTHORIZED_CATALOG'});
        }
        const {data,error}=await supabase.rpc('set_patient_shared_graph_v1',{
          p_identity_id:context.scope.globalId,p_clinic_id:context.clinicId,p_patient_id:context.patientId,
          p_actor_id:context.ctx.userId,p_action:action,p_graph_type:action==='PUBLISH'?kind:null,
          p_graph_key:action==='PUBLISH'?graphKey:null,p_expected_version:version,
        });
        if(error)throw error;
        return res.set('Cache-Control','no-store').json({success:true,data:Array.isArray(data)?data[0]:data});
      }catch(error){return sendError(res,error);}
    });
    app.post('/api/patients/:patientId/shared-graph/delegations',...guard,async(req:any,res:any)=>{
      try{
        const context=await clinicContext(req,res);if(!context)return;
        if(!context.leader)return res.status(403).json({success:false,error:'GRAPH_LEADERSHIP_REQUIRED'});
        const target=clean(req.body?.professionalId,80),allowed=req.body?.allowed;
        if(!uuid(target)||typeof allowed!=='boolean'||target===context.ctx.userId)
          return res.status(400).json({success:false,error:'GRAPH_INVALID_DELEGATION'});
        const [{data:link,error:linkError},{data:member,error:membershipError}]=await Promise.all([
          supabase.from('patient_professional_links').select('professional_id')
            .eq('patient_id',context.patientId).eq('organization_id',context.clinicId)
            .eq('professional_id',target).eq('status','active').limit(1).maybeSingle(),
          supabase.from('clinic_memberships').select('user_id,role')
            .eq('clinic_id',context.clinicId).eq('user_id',target).eq('status','active').limit(1).maybeSingle(),
        ]);
        if(linkError||membershipError)throw linkError||membershipError;
        if(!link||!member||!['therapist','supervisor'].includes(member.role))
          return res.status(403).json({success:false,error:'GRAPH_PROFESSIONAL_NOT_ON_CASE'});
        const {error}=await supabase.rpc('set_patient_shared_graph_delegation_v1',{
          p_patient_id:context.patientId,p_clinic_id:context.clinicId,
          p_professional_id:target,p_actor_id:context.ctx.userId,p_allow:allowed,
        });
        if(error)throw error;
        return res.set('Cache-Control','no-store').json({success:true});
      }catch(error){return sendError(res,error);}
    });
  };

  const registerPortalRoutes = (app:any,middlewares:any) => {
    const guard=[middlewares.checkAuth,middlewares.requireRoles('patient'),middlewares.requirePatientPortalModule('clinical_core')];
    const loadPortal = async (req:any,res:any) => {
      const portal=await middlewares.resolvePatientPortalContext(req.session.user);
      const requested=clean(req.params.patientId,80);
      const allowed=new Set((portal?.patientIds||[]).map((x:any)=>clean(x,80)));
      if(!uuid(requested)||!allowed.has(requested))
        {res.status(403).json({success:false,error:'GRAPH_PORTAL_PATIENT_DENIED'});return null;}
      const scope=await readScope(requested);
      if(!scope?.active || !uuid(scope.globalId))
        return {publication:null,scope};
      const publication=await readPublication(scope.globalId);
      // A verified global identity is not consent for a *different* clinic's
      // clinical graph. This portal scope must own the publication itself.
      if (publication?.clinic_id !== scope.clinicId || publication?.patient_id !== scope.id
          || !await ownerIsActive(publication)) return {publication:null,scope};
      return {publication,scope};
    };
    app.get('/api/portal/patients/:patientId/shared-graph',...guard,async(req:any,res:any)=>{
      try {
        const context=await loadPortal(req,res);if(!context)return;
        const item=context.publication;
        if(!item)return res.set('Cache-Control','no-store').json({success:true,data:null});
        let data:any={graphType:item.graph_type,graphKey:item.graph_key};
        if(item.graph_type==='clinical_metric'){
          const parts=decodeSharedClinicalMetric(item.graph_key);
          if(!parts) return res.set('Cache-Control','no-store').json({success:true,data:null});
          const query=supabase.from('clinical_observations')
            .select('observed_at,metric_label,metric_key,value')
            .eq('organization_id',item.clinic_id).eq('patient_id',item.patient_id)
            .eq('metric_key',parts.metric);
          const result=parts.specialty==='GERAL'?await query.is('specialty',null).order('observed_at',{ascending:true}).limit(300):
            await query.eq('specialty',parts.specialty).order('observed_at',{ascending:true}).limit(300);
          if(result.error)throw result.error;
          const rows=(result.data||[]).filter((r:any)=>r.value!==null&&Number.isFinite(Number(r.value)));
          data={...data,title:clean(rows[0]?.metric_label||parts.metric),points:rows.map((r:any)=>({
            at:r.observed_at,value:Number(r.value)
          }))};
        }
        return res.set('Cache-Control','no-store').json({success:true,data});
      } catch(error){return sendError(res,error);}
    });
    // The old direct growth endpoint stays accessible only for the explicitly
    // authorized mastery graph, not as a side door to hidden clinical charts.
    return { loadPortal };
  };
  return {registerClinicRoutes,registerPortalRoutes};
}
