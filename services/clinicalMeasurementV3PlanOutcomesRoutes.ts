import type { Express } from 'express';
import type { ClinicalMeasurementV3Deps } from './clinicalMeasurementV3Shared';
import { isUuid } from './clinicalMeasurementV3Shared';

export function registerClinicalMeasurementV3PlanOutcomesRoutes(app: Express, deps: ClinicalMeasurementV3Deps, routePath: string) {
  const {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    checkPatientAccess,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
    filterTherapeuticPlanScopesForActor,
    filterTherapeuticPlanProgramsForActor,
  } = deps;

  app.get(routePath,
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
