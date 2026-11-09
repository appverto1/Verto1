import type {Express} from 'express';
import {groupSessionErrorMessage} from '../../src/utils/groupSessionApiErrors';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9:._-]{12,120}$/;
const value=(input:unknown)=>String(input??'').trim();
const identifiers=(input:unknown,min:number,max:number)=>Array.isArray(input)&&input.length>=min&&input.length<=max&&
  input.every(id=>typeof id==='string'&&UUID.test(id))&&new Set(input).size===input.length;

export function registerGroupSessionRoutes(app:Express,deps:any){
  const base=[deps.portalActionLimiter,deps.noStoreDynamicResponse,deps.checkAuth,
    deps.requireClinicModule('appointments_communication'),deps.requireClinicCapability('calendar.clinic.view'),
    deps.requireClinicCapability('patient.demographics.edit')];
  const scope=(req:any)=>({clinicId:value(deps.currentClinicId(req.session?.user)),actorId:value(req.session?.user?.id)});
  const fail=(res:any,error:any)=>{
    const databaseCode=value(error?.code);
    const match=value(error?.message).match(/\b(?:GROUP|PRIVATE_SESSION)_[A-Z0-9_]+\b/);
    const code=match?.[0]||(['40P01','40001'].includes(databaseCode)?databaseCode:
      ['42P01','42703','42883','PGRST202'].includes(databaseCode)?'GROUP_MIGRATION_REQUIRED':
      ['22P02','22007','22008','23514'].includes(databaseCode)?'GROUP_INPUT_INVALID':'GROUP_OPERATION_FAILED');
    const status=/OUT_OF_SCOPE|NOT_FOUND/.test(code)?404:/MIGRATION_REQUIRED/.test(code)?503:
      /INVALID|DUPLICATED|RECURRENCE_LIMIT/.test(code)?422:code==='GROUP_OPERATION_FAILED'?500:409;
    return res.status(status).json({success:false,code,error:groupSessionErrorMessage(code),retryable:['40P01','40001'].includes(code)});
  };
  const send=async(req:any,res:any,rpc:string,params:any,eventType:string,action:string)=>{
    const{clinicId,actorId}=scope(req);
    if(!UUID.test(clinicId)||!UUID.test(actorId))return res.status(403).json({success:false,code:'GROUP_ACTOR_OUT_OF_SCOPE'});
    if(!KEY.test(value(req.body?.idempotencyKey)))return res.status(422).json({success:false,code:'GROUP_INPUT_INVALID',error:groupSessionErrorMessage('GROUP_INPUT_INVALID')});
    const result=await deps.supabase.rpc(rpc,{...params,p_organization_id:clinicId,p_actor_id:actorId,p_idempotency_key:req.body.idempotencyKey});
    if(result.error)throw result.error;
    if(result.data?.success!==true||!Array.isArray(result.data?.appointments))throw Error('GROUP_PERSISTENCE_UNCONFIRMED');
    const items=result.data.appointments.map((row:any)=>{
      const item=deps.serializeGroupAppointment(row);
      // The calendar identity projection does not need the private quote payload.
      for(const key of ['privatePricingResolution','private_pricing_resolution'])delete item[key];
      return item;
    });
    const eventKeys=items.map((item:any)=>`${req.body.idempotencyKey}:${eventType}:${item.id}`);
    const events=eventKeys.length?await deps.supabase.from('appointment_domain_events')
      .select('id,event_type,clinic_id,patient_id,professional_id,appointment_id,created_by,idempotency_key,payload,created_at')
      .eq('organization_id',clinicId).in('idempotency_key',eventKeys).limit(120):{data:[]};
    const normalizedEvents=(events.data||[]).map((event:any)=>({eventId:event.id,eventType:event.event_type,
      clinicId:event.clinic_id,patientId:event.patient_id,professionalId:event.professional_id,appointmentId:event.appointment_id,
      createdBy:event.created_by,idempotencyKey:event.idempotency_key,payload:event.payload,createdAt:event.created_at}));
    if(!result.data.idempotent&&deps.onGroupAppointmentsPersisted){
      try{await deps.onGroupAppointmentsPersisted({appointments:result.data.appointments,action});}
      catch(error:any){console.warn('[GroupSessions] reminder refresh deferred',{code:String(error?.code||'GROUP_REMINDER_REFRESH_FAILED')});}
    }
    return res.json({...result.data,entity:'appointment',action,appointments:items,items,events:normalizedEvents,
      affected:{clinicId,organizationId:clinicId,appointmentIds:items.map((item:any)=>item.id),
        patientIds:[...new Set(items.map((item:any)=>item.patientId||item.patient_id))],queryKeys:['appointments','payments']}});
  };
  app.get('/api/appointments/groups',...base,deps.requireClinicCapability('finance.entries.view'),async(req:any,res:any)=>{
    try{
      const{clinicId}=scope(req);const from=value(req.query?.from),to=value(req.query?.to);
      const days=(Date.parse(to)-Date.parse(from))/86400000;
      if(!UUID.test(clinicId)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(days)||days<0||days>93)
        return res.status(422).json({success:false,code:'GROUP_RANGE_INVALID',error:groupSessionErrorMessage('GROUP_RANGE_INVALID')});
      const result=await deps.supabase.rpc('list_group_sessions_v1',{p_organization_id:clinicId,p_from:from,p_to:to});
      if(result.error)throw result.error;return res.json(result.data);
    }catch(error){return fail(res,error);}
  });
  app.get('/api/appointments/groups/:bookingId',...base,deps.requireClinicCapability('finance.entries.view'),async(req:any,res:any)=>{
    try{
      const{clinicId}=scope(req);const bookingId=value(req.params?.bookingId);
      if(!UUID.test(clinicId)||!UUID.test(bookingId))return res.status(404).json({success:false,code:'GROUP_BOOKING_NOT_FOUND'});
      const result=await deps.supabase.rpc('group_session_result_v1',{p_organization_id:clinicId,p_booking_ids:[bookingId]});
      if(result.error)throw result.error;
      if(!result.data?.bookings?.length)return res.status(404).json({success:false,code:'GROUP_BOOKING_NOT_FOUND'});
      const appointments=result.data.appointments.map((row:any)=>{
        const item=deps.serializeGroupAppointment(row);delete item.privatePricingResolution;delete item.private_pricing_resolution;return item;
      });
      return res.json({...result.data,appointments});
    }catch(error){return fail(res,error);}
  });
  app.post('/api/appointments/groups',...base,deps.requireClinicCapability('calendar.appointment.create'),
    deps.requireClinicCapability('finance.entries.manage'),async(req:any,res:any)=>{
      try{
        if(!deps.enforcePayloadLimit(req,res,16384,'Sessão em grupo'))return;
        if(!identifiers(req.body?.patientIds,2,30)||!identifiers(req.body?.professionalIds,1,8)||!UUID.test(value(req.body?.roomId)))
          throw Error('GROUP_INPUT_INVALID');
        return await send(req,res,'reserve_group_sessions_v1',{p_patient_ids:req.body.patientIds,p_professional_ids:req.body.professionalIds,
          p_specialty:value(req.body.specialty),p_room_id:req.body.roomId,p_local_slots:req.body.slots,
          p_duration_minutes:req.body.durationMinutes},'appointment.created','created');
      }catch(error){return fail(res,error);}
    });
  app.post('/api/appointments/groups/:bookingId/participants',...base,deps.requireClinicCapability('calendar.appointment.create'),
    deps.requireClinicCapability('finance.entries.manage'),async(req:any,res:any)=>{
      try{
        if(!deps.enforcePayloadLimit(req,res,8192,'Participantes da sessão'))return;
        if(!UUID.test(value(req.params?.bookingId))||!identifiers(req.body?.patientIds,1,30))throw Error('GROUP_INPUT_INVALID');
        return await send(req,res,'join_group_session_v1',{p_booking_id:req.params.bookingId,p_patient_ids:req.body.patientIds},'appointment.created','created');
      }catch(error){return fail(res,error);}
    });
  app.patch('/api/appointments/groups/:bookingId',...base,deps.requireClinicCapability('calendar.appointment.edit'),
    deps.requireClinicCapability('finance.entries.manage'),async(req:any,res:any)=>{
      try{
        if(!deps.enforcePayloadLimit(req,res,8192,'Remarcação da sessão em grupo'))return;
        if(!UUID.test(value(req.params?.bookingId))||!UUID.test(value(req.body?.roomId))||!identifiers(req.body?.professionalIds,1,8))throw Error('GROUP_INPUT_INVALID');
        return await send(req,res,'reschedule_group_session_v1',{p_booking_id:req.params.bookingId,p_local_date:req.body.date,
          p_local_time:req.body.time,p_duration_minutes:req.body.durationMinutes,p_room_id:req.body.roomId,
          p_professional_ids:req.body.professionalIds,p_reason:value(req.body.reason)},'appointment.updated','updated');
      }catch(error){return fail(res,error);}
    });
  app.post('/api/appointments/groups/:bookingId/cancel',...base,deps.requireClinicCapability('calendar.appointment.cancel'),
    deps.requireClinicCapability('finance.entries.manage'),async(req:any,res:any)=>{
      try{
        if(!deps.enforcePayloadLimit(req,res,16384,'Cancelamento da sessão em grupo'))return;
        if(!UUID.test(value(req.params?.bookingId))||(req.body?.patientIds!=null&&!identifiers(req.body.patientIds,1,30)))throw Error('GROUP_INPUT_INVALID');
        return await send(req,res,'cancel_group_session_v1',{p_booking_id:req.params.bookingId,p_patient_ids:req.body.patientIds??null,
          p_reason:value(req.body.reason),p_policy_amounts:req.body.policyAmounts??{},p_scope:req.body.scope??'single'},'appointment.status.updated','canceled');
      }catch(error){return fail(res,error);}
    });
}
