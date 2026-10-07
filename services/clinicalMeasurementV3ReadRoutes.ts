import type { Express } from 'express';

type Deps = {
  supabase: any;
  noStoreDynamicResponse: any;
  checkAuth: any;
  checkPatientAccess: any;
  requireClinicCapability: (capability: any) => any;
  sanitizeString: (value: any, max?: number) => string;
  currentClinicId: (user: any) => string | null;
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

/**
 * Read-only Clinical Measurement V3 HTTP surface.
 * Extracted without changing route paths, auth/capability middleware,
 * patient/clinic scoping, RPC/table reads, or response contracts.
 */
export function registerClinicalMeasurementV3ReadRoutes(app: Express, deps: Deps) {
  const { supabase,noStoreDynamicResponse,checkAuth,checkPatientAccess,requireClinicCapability,sanitizeString,currentClinicId }=deps;

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
