import assert from 'node:assert/strict';
import { canActivateSpecialtyPlanForCase, isSelfAuthoredSpecialtyPlan } from '../services/therapeuticSpecialistActivation';
import { readFileSync } from 'node:fs';

const clinic='11111111-1111-4111-8111-111111111111';
const patient='22222222-2222-4222-8222-222222222222';
const specialist='33333333-3333-4333-8333-333333333333';
const plan={mode:'specialty',responsible_professional_id:specialist,patient_id:patient,clinic_id:clinic,organization_id:clinic,status:'active',specialty:'Fonoaudiólogo'};
const membership={user_id:specialist,clinic_id:clinic,role:'therapist',status:'active',specialty:'Fonoaudiologia'};
const link={professional_id:specialist,patient_id:patient,organization_id:clinic,status:'active',permissions:{write:true}};
const p={actorId:specialist,actorRole:'therapist',mode:plan.mode,responsibleProfessionalId:specialist,membership,patientLink:link,specialty:plan.specialty,clinicId:clinic,organizationId:clinic,patientId:patient};
assert.equal(isSelfAuthoredSpecialtyPlan(p),true,'same clinic, same patient, same specialty active specialist may activate');
for(const delta of [
 {actorRole:'director'}, {actorRole:'receptionist'}, {mode:'interdisciplinary'},
 {responsibleProfessionalId:'another'}, {membership:{...membership,status:'pending'}},
 {membership:{...membership,role:'director'}},
 {membership:{...membership,clinic_id:'other'}},
 {membership:{...membership,specialty:'Terapeuta Ocupacional'}},
 {membership:{...membership,specialty:'ABA'}},
 {patientLink:{...link,status:'inactive'}},
 {patientLink:{...link,permissions:{write:false}}},
 {patientLink:{...link,organization_id:'another'}},
 {patientLink:{...link,patient_id:'another'}},
 {clinicId:'another'}, {patientId:'another'}, {organizationId:'another'},
]) assert.equal(isSelfAuthoredSpecialtyPlan({...p,...delta}),false,JSON.stringify(delta));

const calls:string[]=[];
const client=(m:any=membership,l:any=link)=>({
 from(name:string){
   calls.push(name);
   const item=name==='clinic_memberships'?m:l;
   const filters:Array<[string,string]>=[];
   const q:any={
     select(){return this},eq(k:string,v:string){filters.push([k,v]);return this},
     limit(){return this},maybeSingle(){
       if (!item || filters.some(([k,v])=>String(item[k])!==String(v))) return Promise.resolve({data:null,error:null});
       return Promise.resolve({data:item,error:null});
     }
   };
   return q;
 }
});
const check=(override:Record<string,any>={},m:any=membership,l:any=link)=>
 canActivateSpecialtyPlanForCase({supabase:client(m,l),clinicId:clinic,organizationId:clinic,patientId:patient,actorId:specialist,actorRole:'therapist',plan,...override});
assert.equal(await check(),true);
assert.equal(await check({},null,link),false,'revoked member denied');
assert.equal(await check({},membership,null),false,'revoked patient link denied');
assert.equal(await check({plan:{...plan,mode:'interdisciplinary'}}),false,'PTS cannot use specialist automatic path');
assert.equal(await check({plan:{...plan,status:'archived'}}),false,'archived plan cannot reactivate');
assert.equal(await check({actorRole:'coordinator'}),false,'manager approval policy stays separate');

const server=readFileSync('server.ts','utf8');
const panel=readFileSync('src/components/TherapeuticPlanPanel.tsx','utf8');
// Check the extracted implementation, while route authorization remains in server.ts.
const creation=readFileSync('services/therapeuticPlanCreateHandler.ts','utf8');
assert.match(creation,/role === 'therapist' && responsibleProfessionalId === actorId && !startAsDraft \? 'active' : 'draft'/,'self-authored specialist plan activates immediately unless deliberately preparing a future draft');
assert.match(creation,/patient_professional_links/,'case membership still required at plan creation');
assert.match(creation,/clinic_memberships/,'clinic membership and specialty still required');
const start=server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-programs'");
const end=server.indexOf("app.patch('/api/aba/patients/:patientId/therapeutic-programs/:programId/status'",start);
const program=readFileSync('services/therapeuticProgramWriteHandlers.ts','utf8');
assert.match(program,/specialistCanActivate \? 'teaching' : 'draft'/,'new authorized specialist programs become active, not awaiting_approval');
assert.doesNotMatch(program,/requestedStatus === 'draft' \? 'draft' : 'awaiting_approval'/);
const statusRoute=program;
assert.match(statusRoute,/canActivateSpecialtyPlanForCase/,'previous awaiting_approval may be activated by owning specialist only');
assert.match(statusRoute,/if \(parentPlanStatus !== 'active'\)/,'parent must already be active');
assert.match(statusRoute,/THERAPEUTIC_SPECIALIST_ACTIVATION_DENIED/);
assert.match(panel,/Ativar para sessão/);
assert.match(panel,/Ativar para sessões/);
assert.doesNotMatch(panel,/Enviar para aprovação/);
console.log('therapeuticSpecialistActivation: role, clinic, specialty, parent and session gates PASS');
