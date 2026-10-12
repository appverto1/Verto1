import assert from 'node:assert/strict';
import {
  createClinicAuthorizationMeHandler,
  createUserFeatureAccessReadHandler,
  createUserFeatureAccessWriteHandler,
  createClinicCapabilityMembersReadHandler,
  createClinicCapabilityMembersWriteHandler,
  createClinicMemberAuthorizationReadHandler,
  createClinicMemberAuthorizationWriteHandler,
  createClinicMembersReadHandler,
  createClinicSupervisionEligibilityWriteHandler,
} from '../services/clinicAccessMembershipHandlers';
import {
  createClinicWorkScheduleReadHandler,
  createClinicWorkScheduleWriteHandler,
  createClinicWorkScheduleApplyHandler,
} from '../services/clinicWorkScheduleHandlers';

const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const member='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clinic='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validUuid=(x:any)=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(x??''));
const clean=(v:any,n=240)=>String(v??'').trim().slice(0,n);
const passed:string[]=[];
const baseContext={
 membershipId:member,clinicId:clinic,userId:actor,role:'director',canSupervise:false,
 overrides:[{permission_key:'team.view',effect:'allow'}],
 capabilities:new Set(['team.view','calendar.team.view','team.edit']),
 modules:new Set(['school_management']),moduleAccessMode:'legacy_full',entitlementVersion:1,
};
type CaseOptions={
  userId?:string;memberId?:string;permissionKey?:string;featureKey?:string;keys?:string;
  body?:any;context?:any;denyFeature?:boolean;denyModule?:boolean;
  payloadAllowed?:boolean;membership?:any;supervisionLink?:any;
  dbRows?:Record<string,any[]>;dbError?:boolean;rpcData?:any;
  schedule?:any; supervisor?:boolean;
};
async function scenario(
 label:string,
 factory:(getDeps:()=>any)=>(req:any,res:any)=>unknown,
 opts:CaseOptions,
 expectedStatus:number,
 expectedError?:string,
 inspect?:(value:{result:any;queries:any[];rpcs:any[];req:any})=>void,
){
 const queries:any[]=[],rpcs:any[]=[];
 const ctx=opts.context===undefined?{...baseContext}:opts.context;
 if(ctx && opts.supervisor) {ctx.canSupervise=true;ctx.role='therapist';}
 const dbRows=opts.dbRows||{};
 const supabase={
  from(table:string){
   const call={table,filters:[] as any[],select:''};
   queries.push(call);
   const q:any={
    select(s:string){call.select=s;return q;},
    eq(k:string,v:any){call.filters.push([k,v]);return q;},
    in(k:string,v:any){call.filters.push([k,v]);return q;},
    limit(){return q;},
    order(){return q;},
    not(k:string,op:string,v:any){call.filters.push([k,op,v]);return q;},
    neq(k:string,v:any){call.filters.push([k,v]);return q;},
    update(){return q;},
    upsert(){return q;},
    maybeSingle:async()=>({data:table==='clinical_supervision_links'?opts.supervisionLink??null:opts.membership??null,error:null}),
    then(resolve:any,reject:any){
      return Promise.resolve({data:dbRows[table]||[],error:opts.dbError?{message:'DB_REJECTED'}:null}).then(resolve,reject);
    },
   };
   return q;
  },
  async rpc(name:string,args:any){
   rpcs.push({name,args});
   return {data:opts.rpcData??{ended_supervision_assignments:0,first_accessed_at:'2026-10-11'},error:null};
  },
 };
 const req:any={
  params:{memberId:opts.memberId??member,featureKey:opts.featureKey??'clinic_notices',permissionKey:opts.permissionKey??'team.edit'},
  query:{keys:opts.keys??''},body:opts.body??{},session:{user:{id:opts.userId??actor,clinicId:clinic,role:'director'}},
  authorizationContext:ctx,
 };
 let status=200,result:any;
 const res:any={status(n:number){status=n;return res;},json(x:any){result=x;return res;}};
 const deps:any={
   currentClinicId:(user:any)=>user?.clinicId||null,
   getDefaultScopesForRole:()=>['ACTIVE_CLINIC'],
   resolveClinicCapabilityContext:async()=>ctx,
   sanitizeString:clean,sanitizeEmail:clean,
   sendRouteDbError:(response:any,route:string)=>response.status(500).json({error:'HANDLED_DB_ERROR',route}),
   logRouteDbError:()=>{},
   isUuid:validUuid,
   isKnownNewFeatureKey:(key:any)=>key==='clinic_notices',
   canAccessTrackedNewFeature:()=>!opts.denyFeature,
   isCapabilityKey:(key:any)=>key==='team.edit',
   isDelegableCapability:()=>true,
   isClinicBaseRole:(r:any)=>r==='director'||r==='therapist',
   moduleAllowsCapability:()=>!opts.denyModule,
   enforcePayloadLimit:(_req:any,response:any)=>{
     if(opts.payloadAllowed===false){response.status(413).json({error:'PAYLOAD_TOO_LARGE'});return false;}
     return true;
   },
   sanitizeTextField:clean,
   canDelegateClinicCapability:()=>true,
   canManageClinicRole:()=>true,
   getDefaultCapabilitiesForRole:()=>new Set(['team.view']),
   roleHasDefaultCapability:()=>true,
   resolveEffectiveClinicCapabilities:()=>({capabilities:new Set(['team.view','team.edit'])}),
   CAPABILITY_CATALOG:[],
   isMissingRelationError:()=>false,
   asSafeNumber:(v:any)=>Number(v)||0,
   buildDefaultProfessionalWorkingSchedule:()=>({}),
   buildProfessionalProfilePhotoViewUrl:()=>null,
   extractPatientPhotosStoragePath:()=>null,
   formatClinicAccessRoleLabel:(role:any)=>role,
   normalizeClinicalSpecialty:()=>null,
   readProfessionalTitleFromSource:()=>null,
   readProfessionalWorkingScheduleFromMetadata:()=>null,
   resolveProfessionalProfileSpecialty:()=>null,
   sanitizeProfessionalWorkingSchedule:(x:any)=>x,
   sanitizeSessionUrl:()=>null,
   supabase,
   fetchProfessionalWorkingSchedule:async()=>opts.schedule??null,
   assertClinicMemberForWorkSchedule:async()=>opts.membership??null,
   assertNoOtherWorkspaceScheduleOverlap:async()=>{},
   currentClinicTimeZone:()=> 'America/Sao_Paulo',
   extractMissingColumnName:()=>null,
   cleanObject:(v:any)=>v,
   professionalSchedulesOverlap:()=>false,
 };
 await factory(()=>deps)(req,res);
 assert.equal(status,expectedStatus,label+' status');
 if(expectedError)assert.equal(result?.error,expectedError,label+' error');
 inspect?.({result,queries,rpcs,req});
 passed.push(label);
}
await scenario('authorization context denied',createClinicAuthorizationMeHandler,{context:null},403,'CLINIC_AUTHORIZATION_CONTEXT_UNAVAILABLE',x=>assert.equal(x.queries.length,0));
await scenario('authorization context visible',createClinicAuthorizationMeHandler,{},200,undefined,x=>{
 assert.deepEqual(x.result.data.capabilities,['calendar.team.view','team.edit','team.view']);
 assert.equal(x.result.data.clinicId,clinic);
});
await scenario('feature read invalid user',createUserFeatureAccessReadHandler,{userId:'invalid',keys:'clinic_notices'},401,'FEATURE_DISCOVERY_USER_INVALID',x=>assert.equal(x.queries.length,0));
await scenario('feature read no keys',createUserFeatureAccessReadHandler,{keys:''},200,undefined,x=>assert.equal(x.queries.length,0));
await scenario('feature read denied entitlement',createUserFeatureAccessReadHandler,{keys:'clinic_notices',denyFeature:true},200,undefined,x=>assert.equal(x.queries.length,0));
await scenario('feature read scoped query',createUserFeatureAccessReadHandler,{keys:'clinic_notices',dbRows:{user_feature_access:[{feature_key:'clinic_notices',first_accessed_at:'2026-10-11'}]}},200,undefined,x=>{
 assert.equal(x.queries.length,1);
 assert.equal(x.queries[0].table,'user_feature_access');
 assert.deepEqual(x.queries[0].filters[0],['user_id',actor]);
 assert.deepEqual(x.queries[0].filters[1],['feature_key',['clinic_notices']]);
});
await scenario('feature write invalid user',createUserFeatureAccessWriteHandler,{userId:'invalid'},401,'FEATURE_DISCOVERY_USER_INVALID');
await scenario('feature write invalid feature',createUserFeatureAccessWriteHandler,{featureKey:'malicious'},400,'FEATURE_DISCOVERY_KEY_INVALID');
await scenario('feature write denied',createUserFeatureAccessWriteHandler,{denyFeature:true},403,'FEATURE_DISCOVERY_ACCESS_DENIED',x=>assert.equal(x.rpcs.length,0));
await scenario('feature write scoped RPC',createUserFeatureAccessWriteHandler,{},200,undefined,x=>{
 assert.equal(x.rpcs[0].name,'mark_user_feature_accessed_v1');
 assert.deepEqual(x.rpcs[0].args,{p_user_id:actor,p_feature_key:'clinic_notices'});
});
await scenario('capability list invalid permission',createClinicCapabilityMembersReadHandler,{permissionKey:'invalid'},400,'CLINIC_PERMISSION_INVALID',x=>assert.equal(x.queries.length,0));
await scenario('capability list without module',createClinicCapabilityMembersReadHandler,{denyModule:true},403,'CLINIC_MODULE_NOT_ENTITLED',x=>assert.equal(x.queries.length,0));
await scenario('capability bulk no members',createClinicCapabilityMembersWriteHandler,{body:{memberIds:[]}},400,'CLINIC_PERMISSION_MEMBERS_LIMIT',x=>assert.equal(x.queries.length,0));
await scenario('capability bulk invalid member',createClinicCapabilityMembersWriteHandler,{body:{memberIds:['bogus'],effect:'allow'}},400,'CLINIC_PERMISSION_MEMBER_INVALID');
await scenario('capability bulk payload denied',createClinicCapabilityMembersWriteHandler,{payloadAllowed:false},413,'PAYLOAD_TOO_LARGE');
await scenario('individual permission read bad member',createClinicMemberAuthorizationReadHandler,{memberId:'invalid'},400,'CLINIC_MEMBER_INVALID');
await scenario('individual permission read self-protection',createClinicMemberAuthorizationReadHandler,{memberId:actor},403,'SELF_PERMISSION_CHANGE_DENIED',x=>assert.equal(x.queries.length,0));
await scenario('individual permission write payload denied',createClinicMemberAuthorizationWriteHandler,{payloadAllowed:false},413,'PAYLOAD_TOO_LARGE');
await scenario('individual permission write invalid',createClinicMemberAuthorizationWriteHandler,{memberId:'bad'},400,'CLINIC_PERMISSION_INVALID');
await scenario('members listed only within clinic',createClinicMembersReadHandler,{},200,undefined,x=>{
 assert.equal(x.queries[0].table,'clinic_memberships');
 assert.ok(x.queries[0].filters.some((f:any)=>f[0]==='clinic_id'&&f[1]===clinic));
});
await scenario('supervision flag invalid payload',createClinicSupervisionEligibilityWriteHandler,{body:{canSupervise:'yes'}},400,'SUPERVISION_ELIGIBILITY_INVALID',x=>assert.equal(x.rpcs.length,0));
await scenario('supervision flag scoped RPC',createClinicSupervisionEligibilityWriteHandler,{body:{canSupervise:true}},200,undefined,x=>{
 assert.equal(x.rpcs[0].name,'set_clinic_member_supervision_eligibility_v1');
 assert.equal(x.rpcs[0].args.p_clinic_id,clinic);
 assert.equal(x.rpcs[0].args.p_member_id,member);
 assert.equal(x.rpcs[0].args.p_actor_id,actor);
});
await scenario('schedule read denied for other professional',createClinicWorkScheduleReadHandler,{context:{...baseContext,capabilities:new Set()},memberId:member},403,'Sem permissão para visualizar horários de trabalho.',x=>assert.equal(x.queries.length,0));
await scenario('schedule read nonexistent member',createClinicWorkScheduleReadHandler,{memberId:actor},404,'Profissional não encontrado nesta clínica.');
await scenario('schedule read own workspace',createClinicWorkScheduleReadHandler,{memberId:actor,schedule:{days:{}}},200,undefined,x=>assert.equal(x.result.data.days!==undefined,true));
await scenario('schedule write oversized',createClinicWorkScheduleWriteHandler,{payloadAllowed:false},413,'PAYLOAD_TOO_LARGE');
await scenario('schedule write missing membership',createClinicWorkScheduleWriteHandler,{},404,'Profissional não encontrado nesta clínica.');
await scenario('schedule write forbids other professional',createClinicWorkScheduleWriteHandler,{membership:{user_id:member},context:{...baseContext,capabilities:new Set()}},403,'WORK_SCHEDULE_WRITE_FORBIDDEN');
await scenario('schedule mass apply oversized',createClinicWorkScheduleApplyHandler,{payloadAllowed:false},413,'PAYLOAD_TOO_LARGE');
await scenario('schedule mass apply missing source member',createClinicWorkScheduleApplyHandler,{},404,'Profissional de origem não encontrado nesta clínica.');
await scenario('schedule mass apply requires target',createClinicWorkScheduleApplyHandler,{membership:{user_id:member},body:{targetMode:'selected',targetMemberIds:[]}},400,'Selecione pelo menos um profissional para receber a escala.');
console.log('clinicRouteBatch02Handlers.test: PASS ('+passed.length+' cases across 12 routes)');
