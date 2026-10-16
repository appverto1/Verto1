import type {Express} from 'express';
import {clinicalSpecialtyScopeKey} from '../../src/utils/clinicalSpecialties';

/** Cookie-authenticated equivalent of the existing membership-only specialty read. */
export function registerClinicSchedulingSpecialtyRoute(app:Express,deps:any){
  app.get('/api/clinic/scheduling-specialties',deps.noStoreDynamicResponse,deps.checkAuth,
    deps.requireAnyClinicCapability('calendar.own.view','calendar.team.view','calendar.clinic.view','patient.demographics.edit'),
    async(req:any,res:any)=>{
      try{
        const clinicId=String(deps.currentClinicId(req.session?.user)||'');
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId))
          return res.status(403).json({success:false,error:'CLINIC_REQUIRED'});
        const {data,error}=await deps.supabase.from('clinic_memberships').select('user_id,specialty')
          .eq('clinic_id',clinicId).eq('status','active').eq('role','therapist').limit(1000);
        if(error)throw error;
        if(!Array.isArray(data)||data.length>=1000)throw Error('CLINIC_SPECIALTIES_INCOMPLETE');
        return res.json({success:true,clinicId,data:data.filter((row:any)=>clinicalSpecialtyScopeKey(row.specialty))});
      }catch{
        return res.status(503).json({success:false,error:'Não foi possível confirmar as especialidades ativas da clínica.'});
      }
    });
}
