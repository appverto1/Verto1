import type { Express } from 'express';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  checkPatientAccess: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
  enforcePayloadLimit: (req: any, res: any, maxBytes: number, label?: string) => boolean;
  canEditTherapeuticPlanScope: (plan: any, context: any) => boolean;
  filterTherapeuticPlanScopesForActor: (plans: any[], context: any) => any[];
  filterTherapeuticPlanProgramsForActor: (programs: any[], plans: any[], context: any) => any[];
};

type SemanticMeasurementResponse = Record<string, any>;

const SUMMARY_TABLES: Record<string,string> = {
  COUNT:'clinical_measurement_session_count_summaries_v3', RATE:'clinical_measurement_session_rate_summaries_v3',
  PROPORTION:'clinical_measurement_session_proportion_summaries_v3', DURATION:'clinical_measurement_session_temporal_summaries_v3',
  LATENCY:'clinical_measurement_session_temporal_summaries_v3', IRT:'clinical_measurement_session_temporal_summaries_v3',
  CONTINUOUS:'clinical_measurement_session_continuous_summaries_v3', INTERVAL:'clinical_measurement_session_interval_summaries_v3',
  ORDINAL:'clinical_measurement_session_ordinal_summaries_v3', CATEGORICAL:'clinical_measurement_session_categorical_summaries_v3',
  TASK_ANALYSIS:'clinical_measurement_session_task_analysis_summaries_v3'
};

const isoOr = (value:any,fallback:Date) => { const d=new Date(String(value||'')); return Number.isFinite(d.getTime())?d:fallback; };
const maxIso = (values:any[]) => values.filter(Boolean).map(String).sort().at(-1) || null;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THERAPEUTIC_PLAN_MANAGER_ROLES=new Set(['owner','admin','director','coordinator','supervisor']);
const isUuid=(value:any)=>UUID_RE.test(String(value||'').trim());
const directionalityFrom=(value:any)=>{
  const normalized=String(value||'').trim().toLowerCase();
  if(normalized==='higher_is_better') return 'INCREASE_IS_BETTER';
  if(normalized==='lower_is_better') return 'DECREASE_IS_BETTER';
  if(normalized==='target_value'||normalized==='target_range') return 'TARGET_RANGE_IS_BETTER';
  return 'NO_DIRECTIONAL_JUDGMENT';
};

export function registerClinicalMeasurementV3Routes(app: Express, deps: Deps) {
  const { supabase,noStoreDynamicResponse,checkAuth,checkPatientAccess,requireClinicCapability,sanitizeString,currentClinicId,enforcePayloadLimit,canEditTherapeuticPlanScope,filterTherapeuticPlanScopesForActor,filterTherapeuticPlanProgramsForActor }=deps;

  app.post('/api/clinical-measurement-v3/patients/:patientId/plan-measurements',
    noStoreDynamicResponse,checkAuth,requireClinicCapability('clinical.notes.create'),checkPatientAccess,
    async (req:any,res:any)=>{
      try {
        if(!enforcePayloadLimit(req,res,32*1024,'Medição clínica V3')) return;
        const patientId=sanitizeString(req.resolvedPatientId||req.params.patientId,120);
        const clinicId=sanitizeString(currentClinicId(req.session?.user||{}),120);
        const patientClinicId=sanitizeString(req.resolvedPatientClinicId,120);
        const actorId=sanitizeString(req.session?.user?.id||req.session?.user?.user_id,120);
        const actorRole=sanitizeString(req.effectiveClinicRole,40).toLowerCase();
        if(!isUuid(patientId)||!isUuid(clinicId)||!isUuid(actorId)) return res.status(400).json({success:false,error:'CMV3_PLAN_WRITE_SCOPE_REQUIRED'});
        if(patientClinicId&&patientClinicId!==clinicId) return res.status(404).json({success:false,error:'CMV3_PATIENT_SCOPE_MISMATCH'});

        const sourceKind=sanitizeString(req.body?.sourceKind||req.body?.source_kind,40).toUpperCase() || (isUuid(req.body?.therapeuticObjectiveId||req.body?.therapeutic_objective_id)?'THERAPEUTIC_OBJECTIVE':'PLAN_GOAL');
        const planId=sanitizeString(req.body?.planId||req.body?.plan_id,120);
        const goalId=sanitizeString(req.body?.goalId||req.body?.goal_id,100);
        const therapeuticObjectiveId=sanitizeString(req.body?.therapeuticObjectiveId||req.body?.therapeutic_objective_id,120);
        const contextPlanId=sanitizeString(req.body?.contextPlanId||req.body?.context_plan_id||req.body?.therapeuticPlanId||req.body?.therapeutic_plan_id,120);
        const abaSessionId=sanitizeString(req.body?.abaSessionId||req.body?.aba_session_id||req.body?.sessionId||req.body?.session_id,180);
        const clientEventId=sanitizeString(req.body?.idempotencyKey||req.body?.idempotency_key||req.body?.clientEventId||req.body?.client_event_id,160);
        const metricKey=sanitizeString(req.body?.metricKey||req.body?.metric_key,120).toLowerCase();
        const metricLabel=sanitizeString(req.body?.metricLabel||req.body?.metric_label,180);
        const metricType=sanitizeString(req.body?.metricType||req.body?.metric_type,40).toLowerCase();
        const unit=sanitizeString(req.body?.unit,40) || null;
        const directionality=directionalityFrom(req.body?.direction);
        const observedRaw=sanitizeString(req.body?.observedAt||req.body?.observed_at,50);
        if(observedRaw&&Number.isNaN(new Date(observedRaw).getTime())) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_OCCURRED_AT_INVALID',message:'Informe uma data válida para a medição.'});
        const observedDate=observedRaw?new Date(observedRaw):new Date();
        if(observedDate.getTime()>Date.now()+5*60_000||observedDate.getTime()<Date.now()-20*365*86_400_000) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_OCCURRED_AT_INVALID',message:'A data da medição está fora do intervalo permitido.'});
        if(clientEventId.length<16||!metricKey||!metricLabel) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_PAYLOAD_INVALID',message:'Revise a identificação e a métrica clínica.'});
        if(sourceKind==='PLAN_GOAL'&&(!isUuid(planId)||!goalId)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_PLAN_GOAL_REQUIRED',message:'Selecione uma meta válida do plano.'});
        if(sourceKind==='THERAPEUTIC_OBJECTIVE'&&!isUuid(therapeuticObjectiveId)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_THERAPEUTIC_OBJECTIVE_REQUIRED',message:'Selecione um objetivo terapêutico válido.'});
        if(contextPlanId&&!isUuid(contextPlanId)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_CONTEXT_PLAN_INVALID',message:'O plano clínico de contexto é inválido.'});
        if(abaSessionId&&abaSessionId.length>180) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_SESSION_INVALID',message:'A sessão clínica informada é inválida.'});
        if(!['PLAN_GOAL','THERAPEUTIC_OBJECTIVE'].includes(sourceKind)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_SOURCE_KIND_UNSUPPORTED'});

        let semanticFamily=''; let measurement:any={};
        const numericValue=Number(req.body?.numericValue??req.body?.numeric_value??req.body?.value);
        if(metricType==='correct_incorrect') {
          if(!Number.isFinite(numericValue)||![0,1].includes(numericValue)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_PROPORTION_VALUE_INVALID',message:'Informe acerto ou erro válido.'});
          semanticFamily='PROPORTION'; measurement={category_key:numericValue===1?'correct':'incorrect'};
        } else if(['numeric','percentage','scale'].includes(metricType)) {
          if(!Number.isFinite(numericValue)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_CONTINUOUS_VALUE_INVALID',message:'Informe um valor numérico válido.'});
          semanticFamily='CONTINUOUS'; measurement={numeric_value:numericValue};
        } else if(metricType==='frequency') {
          if(!Number.isSafeInteger(numericValue)||numericValue<0) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_COUNT_VALUE_INVALID',message:'Informe uma frequência inteira válida.'});
          semanticFamily='COUNT'; measurement={count_delta:numericValue};
        } else if(['binary','categorical'].includes(metricType)) {
          const rawCategory=req.body?.categoryKey??req.body?.category_key??req.body?.value;
          const categoryKey=sanitizeString(typeof rawCategory==='boolean'?(rawCategory?'true':'false'):rawCategory,180);
          if(!categoryKey) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_CATEGORY_VALUE_INVALID',message:'Informe uma categoria válida.'});
          semanticFamily='CATEGORICAL'; measurement={category_key:categoryKey};
        } else if(metricType==='rate') {
          const countDelta=Number(req.body?.countDelta??req.body?.count_delta??req.body?.value);
          const started=sanitizeString(req.body?.observationStartedAt||req.body?.observation_started_at,50);
          const ended=sanitizeString(req.body?.observationEndedAt||req.body?.observation_ended_at,50);
          if(!Number.isSafeInteger(countDelta)||countDelta<0||Number.isNaN(new Date(started).getTime())||Number.isNaN(new Date(ended).getTime())||new Date(ended)<=new Date(started)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_RATE_VALUE_INVALID',message:'Informe contagem e janela de observação válidas.'});
          semanticFamily='RATE'; measurement={count_delta:countDelta,observation_started_at:new Date(started).toISOString(),observation_ended_at:new Date(ended).toISOString()};
        } else if(['duration','latency','irt'].includes(metricType)) {
          const started=sanitizeString(req.body?.startedAt||req.body?.started_at,50);
          const ended=sanitizeString(req.body?.endedAt||req.body?.ended_at,50);
          if(Number.isNaN(new Date(started).getTime())||Number.isNaN(new Date(ended).getTime())||new Date(ended)<=new Date(started)) return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_TEMPORAL_VALUE_INVALID',message:'Informe início e fim válidos para esta medição temporal.'});
          semanticFamily=metricType.toUpperCase(); measurement={started_at:new Date(started).toISOString(),ended_at:new Date(ended).toISOString(),is_censored:req.body?.isCensored===true||req.body?.is_censored===true,censor_reason:sanitizeString(req.body?.censorReason||req.body?.censor_reason,180)||null};
        } else {
          return res.status(422).json({success:false,error:'CMV3_PLAN_WRITE_SEMANTICS_NOT_READY',message:'Este tipo de métrica ainda exige um contrato semântico específico antes de ser registrado no V3.'});
        }

        const membershipPromise=supabase.from('clinic_memberships').select('id,user_id,clinic_id,status').eq('user_id',actorId).eq('clinic_id',clinicId).eq('status','active').limit(1).maybeSingle();
        const linkPromise=supabase.from('patient_professional_links').select('patient_id,professional_id,status,permissions').eq('organization_id',clinicId).eq('patient_id',patientId).eq('professional_id',actorId).eq('status','active').limit(1).maybeSingle();
        const sourcePromise=sourceKind==='PLAN_GOAL'
          ? supabase.from('patient_therapeutic_plans').select('id,patient_id,organization_id,clinic_id,mode,specialty,participant_specialties,responsible_professional_id,participant_professional_ids,status').eq('id',planId).eq('organization_id',clinicId).eq('patient_id',patientId).limit(1).maybeSingle()
          : supabase.from('patient_therapeutic_objectives').select('id,organization_id,patient_id,status').eq('id',therapeuticObjectiveId).eq('organization_id',clinicId).eq('patient_id',patientId).limit(1).maybeSingle();
        const objectiveProgramsPromise=sourceKind==='THERAPEUTIC_OBJECTIVE'&&(Boolean(contextPlanId)||!THERAPEUTIC_PLAN_MANAGER_ROLES.has(actorRole))
          ? supabase.from('aba_programs').select('therapeutic_plan_id').eq('organization_id',clinicId).eq('patient_id',patientId).eq('therapeutic_objective_id',therapeuticObjectiveId).not('therapeutic_plan_id','is',null).limit(50)
          : Promise.resolve({data:[],error:null});
        const [membershipResult,linkResult,sourceResult,objectiveProgramsResult]=await Promise.all([membershipPromise,linkPromise,sourcePromise,objectiveProgramsPromise]);
        if(membershipResult.error) throw membershipResult.error; if(linkResult.error) throw linkResult.error; if(sourceResult.error) throw sourceResult.error; if(objectiveProgramsResult.error) throw objectiveProgramsResult.error;
        if(!membershipResult.data?.id) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_MEMBERSHIP_REQUIRED'});
        if(!sourceResult.data) return res.status(404).json({success:false,error:'CMV3_PLAN_WRITE_SOURCE_NOT_FOUND'});
        const accessContext={actorId,actorRole,professionalLinks:linkResult.data?[linkResult.data]:[]};
        if(sourceKind==='PLAN_GOAL'&&!canEditTherapeuticPlanScope(sourceResult.data,accessContext)) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_ACCESS_DENIED',message:'Você não possui permissão para registrar evidências neste plano.'});
        if(sourceKind==='THERAPEUTIC_OBJECTIVE'&&!THERAPEUTIC_PLAN_MANAGER_ROLES.has(actorRole)) {
          const objectivePlanIds=Array.from(new Set((objectiveProgramsResult.data||[]).map((row:any)=>sanitizeString(row?.therapeutic_plan_id,120)).filter(isUuid)));
          if(!objectivePlanIds.length) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_ACCESS_DENIED',message:'Este objetivo não pertence a um plano disponível para o seu vínculo.'});
          const objectivePlansResult=await supabase.from('patient_therapeutic_plans')
            .select('id,patient_id,organization_id,clinic_id,mode,specialty,participant_specialties,responsible_professional_id,participant_professional_ids,status')
            .eq('organization_id',clinicId).eq('patient_id',patientId).in('id',objectivePlanIds).limit(50);
          if(objectivePlansResult.error) throw objectivePlansResult.error;
          if(!(objectivePlansResult.data||[]).some((plan:any)=>canEditTherapeuticPlanScope(plan,accessContext))) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_ACCESS_DENIED',message:'Você não possui permissão para registrar evidências neste objetivo.'});
        }

        let contextPlan:any=null;
        if(sourceKind==='PLAN_GOAL'&&contextPlanId&&contextPlanId!==planId) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_CONTEXT_PLAN_MISMATCH',message:'A coleta não pertence ao plano informado.'});
        if(sourceKind==='THERAPEUTIC_OBJECTIVE'&&contextPlanId) {
          const objectivePlanIds=new Set((objectiveProgramsResult.data||[]).map((row:any)=>sanitizeString(row?.therapeutic_plan_id,120)).filter(isUuid));
          if(!objectivePlanIds.has(contextPlanId)) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_CONTEXT_PLAN_MISMATCH',message:'O objetivo terapêutico não pertence ao plano informado.'});
        }
        if(contextPlanId) {
          const contextPlanResult=await supabase.from('patient_therapeutic_plans')
            .select('id,patient_id,organization_id,clinic_id,mode,specialty,participant_specialties,responsible_professional_id,participant_professional_ids,status')
            .eq('id',contextPlanId).eq('organization_id',clinicId).eq('patient_id',patientId).limit(1).maybeSingle();
          if(contextPlanResult.error) throw contextPlanResult.error;
          contextPlan=contextPlanResult.data||null;
          if(!contextPlan) return res.status(404).json({success:false,error:'CMV3_PLAN_WRITE_CONTEXT_PLAN_NOT_FOUND'});
          if(!canEditTherapeuticPlanScope(contextPlan,accessContext)) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_CONTEXT_PLAN_ACCESS_DENIED',message:'Você não possui permissão para registrar evidências neste plano.'});
        }

        if(abaSessionId) {
          const abaSessionResult=await supabase.from('aba_sessions')
            .select('id,patient_id,clinic_id,status,started_at,ended_at,actual_end_at')
            .eq('id',abaSessionId).eq('patient_id',patientId).eq('clinic_id',clinicId).limit(1).maybeSingle();
          if(abaSessionResult.error) throw abaSessionResult.error;
          const abaSession=abaSessionResult.data||null;
          if(!abaSession) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_ABA_SESSION_SCOPE_INVALID',message:'A sessão clínica original não foi encontrada para esta coleta.'});
          const sessionStartedAt=new Date(String(abaSession.started_at||''));
          const sessionEndedRaw=abaSession.ended_at||abaSession.actual_end_at||null;
          const sessionEndedAt=sessionEndedRaw?new Date(String(sessionEndedRaw)):null;
          if(!Number.isNaN(sessionStartedAt.getTime())&&observedDate.getTime()<sessionStartedAt.getTime()-5*60_000) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_OCCURRED_BEFORE_ABA_SESSION',message:'A coleta não pertence ao intervalo da sessão informada.'});
          if(sessionEndedAt&&!Number.isNaN(sessionEndedAt.getTime())&&observedDate.getTime()>sessionEndedAt.getTime()+5*60_000) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_OCCURRED_AFTER_ABA_SESSION',message:'A coleta não pertence ao intervalo da sessão informada.'});
        }

        const rpc=await supabase.rpc('write_clinical_plan_measurement_v3',{
          p_organization_id:clinicId,p_patient_id:patientId,p_actor_membership_id:membershipResult.data.id,p_client_event_id:clientEventId,
          p_source_kind:sourceKind,p_plan_id:sourceKind==='PLAN_GOAL'?planId:null,p_goal_id:sourceKind==='PLAN_GOAL'?goalId:null,p_therapeutic_objective_id:sourceKind==='THERAPEUTIC_OBJECTIVE'?therapeuticObjectiveId:null,
          p_metric_key:metricKey,p_metric_label:metricLabel,p_semantic_family:semanticFamily,p_unit_code:unit,p_unit_label:unit,p_directionality:directionality,
          p_observed_at:observedDate.toISOString(),p_measurement:measurement
        });
        if(rpc.error) {
          const code=sanitizeString(rpc.error?.message||rpc.error?.code,300);
          if(code.includes('IDENTITY_NOT_FOUND')) return res.status(409).json({success:false,error:'CMV3_PLAN_IDENTITY_REQUIRED',message:'A meta ainda não possui identidade clínica V3 ativa. Salve o plano novamente e tente de novo.'});
          if(code.includes('SEMANTIC_FAMILY_CONFLICT')||code.includes('IDEMPOTENCY_SEMANTIC_COLLISION')) return res.status(409).json({success:false,error:'CMV3_PLAN_WRITE_SEMANTIC_CONFLICT',message:'A mesma métrica já possui outra semântica clínica. Crie uma nova métrica em vez de sobrescrever a anterior.'});
          throw rpc.error;
        }

        if((abaSessionId||contextPlanId)&&isUuid(rpc.data?.session_id)) {
          const contextLink=await supabase.rpc('link_clinical_plan_measurement_context_v1',{
            p_organization_id:clinicId,
            p_patient_id:patientId,
            p_actor_membership_id:membershipResult.data.id,
            p_cmv3_session_id:rpc.data.session_id,
            p_client_event_id:clientEventId,
            p_aba_session_id:abaSessionId||null,
            p_therapeutic_plan_id:contextPlanId||null
          });
          if(contextLink.error) throw contextLink.error;
        }

        return res.status(rpc.data?.status==='IDEMPOTENT_REPLAY'?200:201).json({success:true,data:{...rpc.data,aba_session_id:abaSessionId||null,context_plan_id:contextPlanId||null},idempotent:rpc.data?.status==='IDEMPOTENT_REPLAY'});
      } catch(error:any) {
        console.error('[ClinicalMeasurementV3PlanWriter]',{message:sanitizeString(error?.message||error,240),code:sanitizeString(error?.code,80)});
        return res.status(500).json({success:false,error:'CMV3_PLAN_WRITE_FAILED',message:'Não foi possível registrar a medição clínica V3 agora.'});
      }
    });

  app.get('/api/clinical-measurement-v3/patients/:patientId/plan-outcomes',
    noStoreDynamicResponse,checkAuth,requireClinicCapability('reports.clinical.indicators'),checkPatientAccess,
    async (req:any,res:any)=>{
      try {
        const patientId=sanitizeString(req.resolvedPatientId||req.params.patientId,120);
        const clinicId=sanitizeString(currentClinicId(req.session?.user||{}),120);
        const patientClinicId=sanitizeString(req.resolvedPatientClinicId,120);
        const actorId=sanitizeString(req.session?.user?.id||req.session?.user?.user_id,120);
        const actorRole=sanitizeString(req.effectiveClinicRole,40).toLowerCase();
        if(!isUuid(patientId)||!isUuid(clinicId)) return res.status(400).json({success:false,error:'CMV3_PLAN_READ_SCOPE_REQUIRED'});
        if(patientClinicId&&patientClinicId!==clinicId) return res.status(404).json({success:false,error:'CMV3_PATIENT_SCOPE_MISMATCH'});

        const requestedDays=Math.max(7,Math.min(730,Number(req.query?.days||90)||90));
        const dateTo=new Date();
        const dateFrom=new Date(dateTo.getTime()-(requestedDays-1)*86_400_000);
        const requestedPlanId=sanitizeString(req.query?.planId,120);
        if(requestedPlanId&&!isUuid(requestedPlanId)) return res.status(422).json({success:false,error:'CMV3_PLAN_READ_PLAN_INVALID'});

        const [planResult,linkResult,programResult]=await Promise.all([
          supabase.from('patient_therapeutic_plans')
            .select('id,patient_id,organization_id,clinic_id,mode,specialty,responsible_professional_id,participant_professional_ids,participant_specialties,status')
            .eq('organization_id',clinicId).eq('patient_id',patientId).limit(250),
          supabase.from('patient_professional_links')
            .select('patient_id,professional_id,status,permissions')
            .eq('organization_id',clinicId).eq('patient_id',patientId).eq('status','active').limit(50),
          supabase.from('aba_programs')
            .select('id,patient_id,therapeutic_plan_id,therapeutic_objective_id,responsible_professional_ids,created_by')
            .eq('organization_id',clinicId).eq('patient_id',patientId).not('therapeutic_plan_id','is',null).limit(1000)
        ]);
        if(planResult.error) throw planResult.error; if(linkResult.error) throw linkResult.error; if(programResult.error) throw programResult.error;

        const allPlans=planResult.data||[];
        const accessContext={actorId,actorRole,professionalLinks:linkResult.data||[]};
        let visiblePlans=filterTherapeuticPlanScopesForActor(allPlans,accessContext);
        if(requestedPlanId) visiblePlans=visiblePlans.filter((plan:any)=>String(plan.id)===requestedPlanId);
        const visiblePlanIds=Array.from(new Set(visiblePlans.map((plan:any)=>sanitizeString(plan?.id,120)).filter(isUuid)));
        const visiblePlanIdSet=new Set(visiblePlanIds);
        const visiblePrograms=filterTherapeuticPlanProgramsForActor(programResult.data||[],allPlans,accessContext)
          .filter((program:any)=>visiblePlanIdSet.has(String(program?.therapeutic_plan_id||'')));
        const visibleProgramIds=Array.from(new Set(visiblePrograms.map((program:any)=>sanitizeString(program?.id,180)).filter(Boolean)));
        const visibleObjectiveIds=Array.from(new Set(
          visiblePrograms.map((program:any)=>sanitizeString(program?.therapeutic_objective_id,120)).filter(isUuid)
        ));

        if(!visiblePlanIds.length&&!visibleObjectiveIds.length&&!visibleProgramIds.length) {
          return res.json({success:true,data:{rows:[]},meta:{queryCount:3,rpcCount:0,batched:true,periodDays:requestedDays,dateFrom:dateFrom.toISOString(),dateTo:dateTo.toISOString(),source:'CMV3_PLAN_PROJECTIONS_PLUS_ABA_V3_READ_MODEL'}});
        }

        const rpc=await supabase.rpc('read_clinical_outcomes_converged_v3',{
          p_organization_id:clinicId,
          p_patient_id:patientId,
          p_date_from:dateFrom.toISOString().slice(0,10),
          p_date_to:dateTo.toISOString().slice(0,10),
          p_plan_ids:visiblePlanIds,
          p_therapeutic_objective_ids:visibleObjectiveIds,
          p_program_ids:visibleProgramIds,
          p_limit:5000
        });
        if(rpc.error) throw rpc.error;

        return res.json({
          success:true,
          data:{rows:rpc.data||[]},
          meta:{
            queryCount:4,
            rpcCount:1,
            batched:true,
            periodDays:requestedDays,
            dateFrom:dateFrom.toISOString(),
            dateTo:dateTo.toISOString(),
            source:'CMV3_PLAN_PROJECTIONS_PLUS_ABA_V3_READ_MODEL',
            rawEventsRead:false,
            legacyClinicalRowsRead:false,
            visiblePlanCount:visiblePlanIds.length,
            visibleProgramCount:visibleProgramIds.length,
            visibleTherapeuticObjectiveCount:visibleObjectiveIds.length
          }
        });
      } catch(error:any) {
        console.error('[ClinicalMeasurementV3PlanReadModel]',{message:sanitizeString(error?.message||error,240),code:sanitizeString(error?.code,80)});
        return res.status(500).json({success:false,error:'CMV3_PLAN_READ_FAILED',message:'Não foi possível carregar as séries clínicas V3 agora.'});
      }
    });


  app.get('/api/clinical-measurement-v3/patients/:patientId/catalog',
    noStoreDynamicResponse,checkAuth,requireClinicCapability('clinical.history.view'),checkPatientAccess,
    async (req:any,res:any)=>{
      try {
        const patientId=sanitizeString(req.resolvedPatientId||req.params.patientId,120);
        const clinicId=sanitizeString(currentClinicId(req.session?.user||{}),120);
        const patientClinicId=sanitizeString(req.resolvedPatientClinicId,120);
        if(!patientId||!clinicId) return res.status(400).json({success:false,error:'CMV3_SCOPE_REQUIRED'});
        if(patientClinicId&&patientClinicId!==clinicId) return res.status(404).json({success:false,error:'CMV3_PATIENT_SCOPE_MISMATCH'});

        const targets=await supabase.from('clinical_measurement_targets_v3')
          .select('id,target_key,specialty,status,created_at')
          .eq('organization_id',clinicId).eq('patient_id',patientId).eq('status','ACTIVE')
          .order('created_at',{ascending:true}).limit(250);
        if(targets.error) throw targets.error;
        const targetRows=targets.data||[]; const targetIds=targetRows.map((row:any)=>row.id);
        if(!targetIds.length) return res.json({success:true,data:{targets:[]}});

        const definitions=await supabase.from('clinical_measurement_definitions_v3')
          .select('id,target_id,definition_key,semantic_family,status,created_at')
          .eq('organization_id',clinicId).eq('patient_id',patientId).eq('status','ACTIVE')
          .in('target_id',targetIds).order('created_at',{ascending:true}).limit(500);
        if(definitions.error) throw definitions.error;

        const definitionsByTarget=new Map<string,any[]>();
        for(const row of definitions.data||[]){
          const key=String(row.target_id);
          definitionsByTarget.set(key,[...(definitionsByTarget.get(key)||[]),{
            definition_id:row.id,definition_key:row.definition_key,semantic_family:row.semantic_family
          }]);
        }
        const catalog=targetRows.map((target:any)=>({
          target_id:target.id,target_name:target.target_key,specialty:target.specialty||null,
          definitions:definitionsByTarget.get(String(target.id))||[]
        })).filter((target:any)=>target.definitions.length>0);
        return res.json({success:true,data:{targets:catalog}});
      } catch(error:any){
        console.error('[ClinicalMeasurementV3Catalog]',{message:sanitizeString(error?.message||error,240),code:sanitizeString(error?.code,80)});
        return res.status(500).json({success:false,error:'CMV3_CATALOG_FAILED'});
      }
    });

  app.get('/api/clinical-measurement-v3/patients/:patientId/targets/:targetId/view',
    noStoreDynamicResponse,checkAuth,requireClinicCapability('clinical.history.view'),checkPatientAccess,
    async (req:any,res:any)=>{
      try {
        const patientId=sanitizeString(req.resolvedPatientId||req.params.patientId,120); const targetId=sanitizeString(req.params.targetId,120);
        const clinicId=sanitizeString(currentClinicId(req.session?.user||{}),120);
        const patientClinicId=sanitizeString(req.resolvedPatientClinicId,120);
        if(!patientId||!targetId||!clinicId) return res.status(400).json({success:false,error:'CMV3_SCOPE_REQUIRED'});
        if(patientClinicId&&patientClinicId!==clinicId) return res.status(404).json({success:false,error:'CMV3_PATIENT_SCOPE_MISMATCH'});
        const now=new Date(); const periodEnd=isoOr(req.query?.periodEnd,now); const defaultStart=new Date(periodEnd.getTime()-90*86400000);
        const periodStart=isoOr(req.query?.periodStart,defaultStart);
        if(periodStart>periodEnd || periodEnd.getTime()-periodStart.getTime()>366*86400000) return res.status(422).json({success:false,error:'CMV3_PERIOD_INVALID'});

        const targetResult=await supabase.from('clinical_measurement_targets_v3')
          .select('id,organization_id,patient_id,target_key,specialty,status').eq('id',targetId).eq('organization_id',clinicId).eq('patient_id',patientId).maybeSingle();
        if(targetResult.error) throw targetResult.error; if(!targetResult.data) return res.status(404).json({success:false,error:'CMV3_TARGET_NOT_FOUND'});

        let defQuery=supabase.from('clinical_measurement_definitions_v3')
          .select('id,definition_key,semantic_family,status').eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).eq('status','ACTIVE');
        const requestedDefinitionId=sanitizeString(req.query?.definitionId,120); if(requestedDefinitionId) defQuery=defQuery.eq('id',requestedDefinitionId);
        const defs=await defQuery.limit(2); if(defs.error) throw defs.error;
        if(!(defs.data||[]).length) return res.status(404).json({success:false,error:'CMV3_DEFINITION_NOT_FOUND'});
        if(!requestedDefinitionId && (defs.data||[]).length>1) return res.status(409).json({success:false,error:'CMV3_DEFINITION_SELECTION_REQUIRED'});
        const definition=(defs.data||[])[0]; const family=String(definition.semantic_family); const summaryTable=SUMMARY_TABLES[family];
        if(!summaryTable) return res.status(422).json({success:false,error:'CMV3_SEMANTIC_FAMILY_UNSUPPORTED'});

        const versions=await supabase.from('clinical_measurement_definition_versions_v3')
          .select('id,version,unit_code,unit_label,directionality,content,aggregation_policy,status,published_at')
          .eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).eq('definition_id',definition.id).order('version',{ascending:true}).limit(100);
        if(versions.error) throw versions.error; const versionRows=versions.data||[]; const versionIds=versionRows.map((r:any)=>r.id);
        if(!versionIds.length) return res.status(409).json({success:false,error:'CMV3_DEFINITION_VERSION_REQUIRED'});
        const latestVersion=versionRows.at(-1);

        const summaryColumns = family==='COUNT' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,total_count,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : family==='RATE' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,event_count,observation_duration_ms,rate_per_hour,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : family==='PROPORTION' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,projection_status,numerator,denominator,percent_value,no_eligible_opportunity_count,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : ['DURATION','LATENCY','IRT'].includes(family) ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,semantic_family,occurrence_count,censored_count,total_duration_ms,mean_duration_ms,min_duration_ms,max_duration_ms,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : family==='CONTINUOUS' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,observation_count,mean_value,min_value,max_value,latest_value,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : family==='ORDINAL' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,observation_count,latest_category_key,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : family==='TASK_ANALYSIS' ? 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,run_count,acquisition_eligible_count,acquisition_independent_count,maintenance_eligible_count,maintenance_independent_count,trainer_completed_count,not_eligible_count,acquisition_independence_percent,maintenance_independence_percent,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id'
          : 'expectation_id,session_id,phase_epoch_id,clinical_date,coverage_status,source_latest_occurred_at,source_latest_recorded_at,computed_at,definition_version_id';

        const summaries=await supabase.from(summaryTable).select(summaryColumns).eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId)
          .in('definition_version_id',versionIds).gte('clinical_date',periodStart.toISOString().slice(0,10)).lte('clinical_date',periodEnd.toISOString().slice(0,10)).order('clinical_date',{ascending:true}).limit(1000);
        if(summaries.error) throw summaries.error; const rows=summaries.data||[];
        const expectationIds=rows.map((r:any)=>r.expectation_id); const sessionIds=[...new Set(rows.map((r:any)=>r.session_id))];

        const [sessions,phases,criteria,state,audit,breakdowns,intervalBreakdowns,promptBreakdowns,taskSteps,taskExpectations]=await Promise.all([
          sessionIds.length?supabase.from('clinical_measurement_sessions_v3').select('id,started_at,clinical_date,timezone_snapshot').in('id',sessionIds):Promise.resolve({data:[],error:null}),
          supabase.from('clinical_measurement_phase_epochs_v3').select('id,phase_version_id,effective_from,effective_until,recorded_at').eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).is('superseded_at',null).order('effective_from',{ascending:true}).limit(100),
          supabase.from('clinical_measurement_criterion_epochs_v3').select('id,criterion_key,criterion_type,rule,effective_from,effective_until,recorded_at,phase_epoch_id').eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).is('superseded_at',null).order('effective_from',{ascending:true}).limit(100),
          supabase.from('clinical_measurement_target_states_v3').select('clinical_state,evidence_support_state,workflow_attention_state,latest_decision_event_id,latest_evidence_revision_id,updated_at').eq('target_id',targetId).maybeSingle(),
          supabase.from('clinical_measurement_session_projection_revisions_v3').select('id,expectation_id,revision_number,revision_reason,source_latest_recorded_at,computed_at,created_at').eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).in('revision_reason',['LATE_DATA_INCORPORATED','AUDIT_CORRECTION']).order('created_at',{ascending:false}).limit(100),
          expectationIds.length && ['PROPORTION','ORDINAL','CATEGORICAL'].includes(family)?supabase.from('clinical_measurement_session_category_breakdown_v3').select('expectation_id,category_domain,category_key,occurrence_count').in('expectation_id',expectationIds):Promise.resolve({data:[],error:null}),
          expectationIds.length && family==='INTERVAL'?supabase.from('clinical_measurement_session_interval_breakdown_v3').select('expectation_id,response_key,occurrence_count').in('expectation_id',expectationIds):Promise.resolve({data:[],error:null}),
          expectationIds.length && ['PROPORTION','TASK_ANALYSIS'].includes(family)?supabase.from('clinical_measurement_session_prompt_distribution_v3').select('expectation_id,source_kind,prompt_level_id,occurrence_count').in('expectation_id',expectationIds):Promise.resolve({data:[],error:null}),
          expectationIds.length && family==='TASK_ANALYSIS'?supabase.from('clinical_measurement_session_task_step_summaries_v3').select('expectation_id,step_definition_id,sequence_no,acquisition_observation_count,acquisition_independent_count,maintenance_observation_count,maintenance_independent_count,prompted_count,incorrect_count,no_response_count').in('expectation_id',expectationIds).order('sequence_no',{ascending:true}):Promise.resolve({data:[],error:null}),
          expectationIds.length && family==='TASK_ANALYSIS'?supabase.from('clinical_measurement_session_expectations_v3').select('id,protocol_snapshot_id').in('id',expectationIds):Promise.resolve({data:[],error:null})
        ] as any);
        for(const r of [sessions,phases,criteria,state,audit,breakdowns,intervalBreakdowns,promptBreakdowns,taskSteps,taskExpectations]) if(r?.error) throw r.error;
        const sessionMap=new Map((sessions.data||[]).map((s:any)=>[String(s.id),s]));
        const breakdownMap=new Map<string,any[]>(); for(const b of breakdowns.data||[]){const k=String(b.expectation_id);breakdownMap.set(k,[...(breakdownMap.get(k)||[]),b]);}
        const intervalMap=new Map<string,any[]>(); for(const b of intervalBreakdowns.data||[]){const k=String(b.expectation_id);intervalMap.set(k,[...(intervalMap.get(k)||[]),b]);}
        const promptMap=new Map<string,any[]>(); for(const b of promptBreakdowns.data||[]){const k=String(b.expectation_id);promptMap.set(k,[...(promptMap.get(k)||[]),b]);}
        const taskMap=new Map<string,any[]>(); for(const b of taskSteps.data||[]){const k=String(b.expectation_id);taskMap.set(k,[...(taskMap.get(k)||[]),b]);}
        const taskExpectationMap=new Map((taskExpectations.data||[]).map((e:any)=>[String(e.id),e]));
        const taskSnapshotIds=[...new Set((taskExpectations.data||[]).map((e:any)=>e.protocol_snapshot_id).filter(Boolean))];
        const taskSnapshots=taskSnapshotIds.length?await supabase.from('clinical_collection_protocol_snapshots_v3').select('id,snapshot').in('id',taskSnapshotIds):{data:[],error:null};
        if(taskSnapshots.error) throw taskSnapshots.error; const taskSnapshotMap=new Map((taskSnapshots.data||[]).map((sp:any)=>[String(sp.id),sp]));

        const measurementFor=(r:any)=>{
          if(family==='COUNT') return {kind:'COUNT',count:Number(r.total_count||0)};
          if(family==='RATE') return {kind:'RATE',event_count:Number(r.event_count||0),observation_duration:{value:Number(r.observation_duration_ms||0),unit:'MILLISECOND'},normalized_rate:{value:r.rate_per_hour==null?null:Number(r.rate_per_hour),unit:'EVENTS_PER_HOUR'}};
          if(family==='PROPORTION') return {kind:'PROPORTION',numerator:r.numerator==null?null:Number(r.numerator),denominator:r.denominator==null?null:Number(r.denominator),proportion:r.percent_value==null?null:Number(r.percent_value),categories:breakdownMap.get(String(r.expectation_id))||[]};
          if(['DURATION','LATENCY','IRT'].includes(family)) return {kind:family,occurrence_count:Number(r.occurrence_count||0),total_duration_ms:Number(r.total_duration_ms||0),mean_duration_ms:r.mean_duration_ms==null?null:Number(r.mean_duration_ms),min_duration_ms:r.min_duration_ms,max_duration_ms:r.max_duration_ms,censored_count:Number(r.censored_count||0)};
          if(family==='CONTINUOUS') return {kind:'CONTINUOUS',observation_count:Number(r.observation_count||0),latest_value:r.latest_value==null?null:Number(r.latest_value),mean_value:r.mean_value==null?null:Number(r.mean_value),min_value:r.min_value,max_value:r.max_value};
          if(family==='INTERVAL') return {kind:'INTERVAL',interval_count:Number(r.interval_count||0),categories:intervalMap.get(String(r.expectation_id))||[]};
          if(family==='ORDINAL') return {kind:'ORDINAL',level_key:r.latest_category_key,display_label:r.latest_category_key};
          if(family==='TASK_ANALYSIS') { const ex:any=taskExpectationMap.get(String(r.expectation_id)); const sp:any=ex?taskSnapshotMap.get(String(ex.protocol_snapshot_id)):null; return {kind:'TASK_ANALYSIS',protocol_snapshot_id:ex?.protocol_snapshot_id||null,chaining_strategy:sp?.snapshot?.chaining_strategy||sp?.snapshot?.chainingStrategy||null,steps:taskMap.get(String(r.expectation_id))||[],derived:{eligible_steps:Number(r.acquisition_eligible_count||0),independent_eligible_steps:Number(r.acquisition_independent_count||0)},maintenance:{eligible_steps:Number(r.maintenance_eligible_count||0),independent_eligible_steps:Number(r.maintenance_independent_count||0)}}; }
          return {kind:family,categories:breakdownMap.get(String(r.expectation_id))||[]};
        };
        const points=rows.map((r:any)=>{
          const s:any=sessionMap.get(String(r.session_id)); const occurred=r.source_latest_occurred_at||s?.started_at||`${r.clinical_date}T00:00:00Z`;
          if(r.coverage_status==='EXPECTED_NOT_COLLECTED') return {type:'EXPECTED_NOT_COLLECTED',id:r.expectation_id,session_id:r.session_id,occurred_at:occurred,clinical_date:r.clinical_date,phase_epoch_id:r.phase_epoch_id||null};
          if(r.coverage_status==='EXPLICIT_ABSENCE') return {type:['RATE','DURATION','LATENCY','IRT'].includes(family)?'NO_VALID_OBSERVATION_WINDOW':'NO_ELIGIBLE_OPPORTUNITY',id:r.expectation_id,session_id:r.session_id,occurred_at:occurred,clinical_date:r.clinical_date,phase_epoch_id:r.phase_epoch_id||null};
          const quality=family==='PROPORTION' && r.projection_status && r.projection_status!=='READY' ? [{code:r.projection_status,severity:'WARNING'}] : [];
          return {type:'OBSERVED',id:r.expectation_id,session_id:r.session_id,occurred_at:occurred,clinical_date:r.clinical_date,phase_epoch_id:r.phase_epoch_id||null,measurement:measurementFor(r),quality,reliability:{status:'NOT_PAIRED'}};
        });
        const groups=new Map<string,any[]>(); for(const p of points){const k=String(p.phase_epoch_id||'NO_PHASE');groups.set(k,[...(groups.get(k)||[]),p]);}
        const segments=[...groups.entries()].map(([phaseId,segmentPoints],i)=>({segment_id:`${targetId}:${definition.id}:${i+1}`,phase_epoch_id:phaseId==='NO_PHASE'?null:phaseId,points:segmentPoints}));

        const phaseVersionIds=[...new Set((phases.data||[]).map((p:any)=>p.phase_version_id).filter(Boolean))];
        const phaseVersions=phaseVersionIds.length?await supabase.from('clinical_measurement_phase_versions_v3').select('id,phase_type,label').in('id',phaseVersionIds):{data:[],error:null};
        if(phaseVersions.error) throw phaseVersions.error; const phaseVersionMap=new Map((phaseVersions.data||[]).map((v:any)=>[String(v.id),v]));
        const enrichedPhases=(phases.data||[]).map((p:any)=>({...p,phase_type:phaseVersionMap.get(String(p.phase_version_id))?.phase_type||null,label:phaseVersionMap.get(String(p.phase_version_id))?.label||null}));
        const queueStatus=await supabase.from('clinical_measurement_projection_queue_v3').select('status,generation,processed_generation,last_error').eq('organization_id',clinicId).eq('patient_id',patientId).eq('target_id',targetId).in('status',['PENDING','PROCESSING','FAILED']).limit(25);
        if(queueStatus.error) throw queueStatus.error; const staleRows=queueStatus.data||[];

        const criterionIds=(criteria.data||[]).map((c:any)=>c.id); const evidence=criterionIds.length?await supabase.from('clinical_measurement_evidence_revisions_v3').select('id,criterion_epoch_id,revision_number,evidence_support_state,evaluation_status,evaluation,projection_watermark,evaluated_at').in('criterion_epoch_id',criterionIds).order('revision_number',{ascending:false}).limit(500):{data:[],error:null};
        if(evidence.error) throw evidence.error; const evidenceByCriterion=new Map<string,any>(); for(const e of evidence.data||[]) if(!evidenceByCriterion.has(String(e.criterion_epoch_id))) evidenceByCriterion.set(String(e.criterion_epoch_id),e);
        const sourceWatermark=maxIso(rows.map((r:any)=>r.source_latest_recorded_at)); const projectionWatermark=maxIso(rows.map((r:any)=>r.computed_at));
        const response:SemanticMeasurementResponse={
          contract_version:'3.2.0', identity:{target_id:targetId,target_name:targetResult.data.target_key,definition_id:definition.id,definition_key:definition.definition_key,semantic_family:family,unit_code:latestVersion?.unit_code||null,unit_label:latestVersion?.unit_label||null},
          scope:{patient_id:patientId,analysis_grain:'SESSION',period_start:periodStart.toISOString(),period_end:periodEnd.toISOString(),effective_filters:{contexts:{mode:'ALL_AUTHORIZED'},providers:{mode:'ALL_AUTHORIZED'}}},
          authority:{level:'CANONICAL'}, semantics:{measurement:{family},interpretation:{directionality:latestVersion?.directionality||'NO_DIRECTIONAL_JUDGMENT'},aggregation:latestVersion?.aggregation_policy||{}},
          temporal_context:{clinical_date_policy:'SESSION_START_LOCAL_DATE'},
          phase_epochs:enrichedPhases, criterion_epochs:criteria.data||[], clinical_decision_rules:(criteria.data||[]).map((c:any)=>({...c,evaluation:evidenceByCriterion.get(String(c.id))||{status:'NOT_EVALUATED'}})),
          states:state.data||{clinical_state:'ACTIVE',evidence_support_state:'NOT_EVALUATED',workflow_attention_state:'NONE'},
          data:{primary_representation:{kind:family==='ORDINAL'?'ORDERED_CATEGORY_SERIES':family==='TASK_ANALYSIS'?'TASK_ANALYSIS_MATRIX':'TIME_SERIES',semantic_role:family,continuity_policy:'BREAK_ON_PHASE_EPOCH',segments},supplementary_representations:(promptBreakdowns.data||[]).length?[{kind:'PROMPT_COMPOSITION',items:promptBreakdowns.data}]:[]},
          rendering:{recommended_view:family==='TASK_ANALYSIS'?'TASK_ANALYSIS_EVOLUTION':'SINGLE_METRIC_EVOLUTION',capabilities:[{renderer:family==='TASK_ANALYSIS'?'TASK_ANALYSIS_MATRIX':family==='ORDINAL'?'ORDERED_CATEGORY_SERIES':'TIME_SERIES',availability:'READY'},{renderer:'SCATTER',availability:'REQUIRES_ANALYTICAL_DRILLDOWN'}]},
          warnings:staleRows.filter((q:any)=>q.status==='FAILED').map((q:any)=>({code:'PROJECTION_FAILED',severity:'WARNING',message:'A projeção clínica requer reprocessamento.'})), audit_events:(audit.data||[]).map((a:any)=>({type:a.revision_reason,id:a.id,expectation_id:a.expectation_id,revision_number:a.revision_number,recorded_at:a.created_at})),
          provenance:{computed_at:new Date().toISOString(),projection_watermark:projectionWatermark,source_watermark:sourceWatermark,is_stale:staleRows.length>0}
        };
        return res.json({success:true,data:response});
      } catch(error:any){ console.error('[ClinicalMeasurementV3]',{message:sanitizeString(error?.message||error,240),code:sanitizeString(error?.code,80)}); return res.status(500).json({success:false,error:'CMV3_VIEW_FAILED'}); }
    });
}
