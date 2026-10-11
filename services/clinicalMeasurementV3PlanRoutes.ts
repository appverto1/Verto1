import type { Express } from 'express';
import type { ClinicalMeasurementV3Deps } from './clinicalMeasurementV3Shared';
import {
  THERAPEUTIC_PLAN_MANAGER_ROLES,
  directionalityFrom,
  isUuid,
} from './clinicalMeasurementV3Shared';

export function registerClinicalMeasurementV3PlanRoutes(app: Express, deps: ClinicalMeasurementV3Deps) {
  const {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    checkPatientAccess,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
    enforcePayloadLimit,
    canEditTherapeuticPlanScope,
    filterTherapeuticPlanScopesForActor,
    filterTherapeuticPlanProgramsForActor,
  } = deps;

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
        const sessionId=sanitizeString(req.body?.sessionId||req.body?.session_id,180);
        const requestedSessionPlanId=sanitizeString(req.body?.therapeuticPlanId||req.body?.therapeutic_plan_id,120);
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
        const objectiveProgramsPromise=sourceKind==='THERAPEUTIC_OBJECTIVE'&&(Boolean(sessionId)||!THERAPEUTIC_PLAN_MANAGER_ROLES.has(actorRole))
          ? supabase.from('aba_programs').select('therapeutic_plan_id').eq('organization_id',clinicId).eq('patient_id',patientId).eq('therapeutic_objective_id',therapeuticObjectiveId).not('therapeutic_plan_id','is',null).limit(50)
          : Promise.resolve({data:[],error:null});
        const sessionPromise=sessionId
          ? supabase.from('aba_sessions')
              .select('id,patient_id,clinic_id,status,therapeutic_plan_id')
              .eq('id',sessionId).eq('clinic_id',clinicId).eq('patient_id',patientId).limit(1).maybeSingle()
          : Promise.resolve({data:null,error:null});
        const [membershipResult,linkResult,sourceResult,objectiveProgramsResult,sessionResult]=await Promise.all([membershipPromise,linkPromise,sourcePromise,objectiveProgramsPromise,sessionPromise]);
        if(membershipResult.error) throw membershipResult.error; if(linkResult.error) throw linkResult.error; if(sourceResult.error) throw sourceResult.error; if(objectiveProgramsResult.error) throw objectiveProgramsResult.error; if(sessionResult.error) throw sessionResult.error;
        if(!membershipResult.data?.id) return res.status(403).json({success:false,error:'CMV3_PLAN_WRITE_MEMBERSHIP_REQUIRED'});
        if(!sourceResult.data) return res.status(404).json({success:false,error:'CMV3_PLAN_WRITE_SOURCE_NOT_FOUND'});

        const sessionPlanId=sessionId?sanitizeString(sessionResult.data?.therapeutic_plan_id,120):'';
        if(sessionId&&!sessionResult.data) return res.status(404).json({success:false,error:'CMV3_SESSION_NOT_FOUND',message:'A sessão clínica não foi encontrada.'});
        if(sessionId&&!sessionPlanId) return res.status(409).json({success:false,error:'CMV3_SESSION_SPECIALTY_PLAN_REQUIRED',message:'A sessão não possui um plano por especialidade congelado.'});
        if(sessionId&&requestedSessionPlanId&&requestedSessionPlanId!==sessionPlanId) return res.status(409).json({success:false,error:'CMV3_SESSION_SPECIALTY_SCOPE_MISMATCH',message:'A sessão está vinculada a outro plano por especialidade.'});
        if(sessionId&&sourceKind==='PLAN_GOAL'&&planId!==sessionPlanId) return res.status(409).json({success:false,error:'CMV3_SESSION_SPECIALTY_SCOPE_MISMATCH',message:'Esta meta pertence a outra especialidade.'});
        if(sessionId&&sourceKind==='THERAPEUTIC_OBJECTIVE') {
          const objectivePlanIds=new Set((objectiveProgramsResult.data||[]).map((row:any)=>sanitizeString(row?.therapeutic_plan_id,120)).filter(Boolean));
          if(!objectivePlanIds.has(sessionPlanId)) return res.status(409).json({success:false,error:'CMV3_SESSION_SPECIALTY_SCOPE_MISMATCH',message:'Este objetivo pertence a outra especialidade.'});
        }

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
        return res.status(rpc.data?.status==='IDEMPOTENT_REPLAY'?200:201).json({success:true,data:rpc.data,idempotent:rpc.data?.status==='IDEMPOTENT_REPLAY'});
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

        const [planResult,linkResult,supervisionResult,programResult]=await Promise.all([
          supabase.from('patient_therapeutic_plans')
            .select('id,patient_id,organization_id,clinic_id,mode,specialty,responsible_professional_id,participant_professional_ids,participant_specialties,status')
            .eq('organization_id',clinicId).eq('patient_id',patientId).limit(250),
          supabase.from('patient_professional_links')
            .select('patient_id,professional_id,status,permissions')
            .eq('organization_id',clinicId).eq('patient_id',patientId).eq('status','active').limit(50),
          supabase.from('clinical_supervision_links')
            .select('clinic_id,patient_id,supervisor_user_id,supervised_user_id,status')
            .eq('clinic_id',clinicId).eq('patient_id',patientId).eq('supervisor_user_id',actorId).eq('status','active').limit(100),
          supabase.from('aba_programs')
            .select('id,patient_id,therapeutic_plan_id,therapeutic_objective_id,responsible_professional_ids,created_by')
            .eq('organization_id',clinicId).eq('patient_id',patientId).not('therapeutic_plan_id','is',null).limit(1000)
        ]);
        if(planResult.error) throw planResult.error; if(linkResult.error) throw linkResult.error; if(supervisionResult.error) throw supervisionResult.error; if(programResult.error) throw programResult.error;

        const allPlans=planResult.data||[];
        const accessContext={actorId,actorRole,professionalLinks:linkResult.data||[],supervisionLinks:supervisionResult.data||[]};
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
        const historyBindings=visibleProgramIds.length
          ? await supabase.from('aba_session_target_measurement_bindings')
            .select('session_id,target_id,program_version_id,program_version_snapshot,measurement_type_snapshot,target_status_snapshot')
            .eq('organization_id',clinicId).eq('patient_id',patientId)
            .in('program_id',visibleProgramIds)
            .gte('decision_at',dateFrom.toISOString()).lte('decision_at',dateTo.toISOString()).limit(5000)
          : {data:[],error:null};
        if(historyBindings.error) throw historyBindings.error;
        const historyBySessionTarget=new Map((historyBindings.data||[]).map((binding:any)=>[`${String(binding.session_id)}::${String(binding.target_id)}`,binding]));
        const rows=(rpc.data||[]).map((row:any)=>{
          if(String(row?.source_kind||'').toUpperCase()!=='ABA_TARGET') return row;
          const binding:any=historyBySessionTarget.get(`${String(row?.session_id||'')}::${String(row?.target_id||'')}`)||null;
          return {...row,target_status:binding?.target_status_snapshot||'LEGACY_UNVERSIONED',measurement_type:binding?.measurement_type_snapshot||null,program_version_id:binding?.program_version_id||null,program_version:binding?.program_version_snapshot||null,history_version_status:binding?.program_version_id?'VERSION_BOUND':'LEGACY_UNVERSIONED'};
        });

        return res.json({
          success:true,
          data:{rows},
          meta:{
            queryCount:5,
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



}
