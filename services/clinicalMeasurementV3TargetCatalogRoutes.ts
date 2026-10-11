import type { Express } from 'express';
import type { ClinicalMeasurementV3Deps } from './clinicalMeasurementV3Shared';

export function registerClinicalMeasurementV3TargetCatalogRoutes(app: Express, deps: ClinicalMeasurementV3Deps) {
  const {
    supabase,
    noStoreDynamicResponse,
    checkAuth,
    checkPatientAccess,
    requireClinicCapability,
    sanitizeString,
    currentClinicId,
  } = deps;

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
}
