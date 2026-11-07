import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterTherapeuticPlanScopesForActor, resolveTherapeuticPlanScopeAccess } from '../src/utils/therapeuticPlanAccess';

const server = fs.readFileSync('server.ts','utf8');
const auth = fs.readFileSync('src/constants/authorizationModel.ts','utf8');
const postStart = server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'");
const patchStart = server.indexOf("app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId'");
assert.ok(postStart > 0 && patchStart > postStart);
const post = fs.readFileSync('services/therapeuticPlanCreateHandler.ts', 'utf8');
assert.match(server, /createTherapeuticPlanCreateHandler\(\(\) => \(\{/);
assert.match(server,/const requireScopedTherapeuticPlanCapability = \(operation: 'create' \| 'edit'\)/);
assert.match(server,/ctx\?\.role === 'therapist'/);
assert.match(server,/ctx\.capabilities\.has\('clinical\.record\.view'\)/);
assert.match(server,/!denied\('treatment_plan\.create'\)/);
assert.match(server,/!denied\('treatment_plan\.edit'\)/);
assert.match(server,/req\.effectiveClinicRole = ctx\.role;/);
assert.match(server,/requireScopedTherapeuticPlanCapability\('create'\), checkPatientAccess/);
assert.match(server,/requireScopedTherapeuticPlanCapability\('edit'\), checkPatientAccess/);
assert.match(post,/responsibleProfessionalId !== actorId/);
assert.match(post,/\.eq\('status', 'active'\)/);
assert.match(post,/THERAPEUTIC_PLAN_PROFESSIONAL_NOT_LINKED/);
assert.match(post,/\.eq\('clinic_id', clinicId\)/);
assert.match(post,/membershipByProfessional\.get\(responsibleProfessionalId\)/);
assert.match(post,/THERAPEUTIC_PLAN_SPECIALTY_MISMATCH/);
assert.match(post,/actorLink\?\.permissions\?\.write === false/);
assert.match(post,/THERAPEUTIC_PLAN_IDEMPOTENCY_CONFLICT/);
assert.match(auth,/therapist: internal\([\s\S]*?'treatment_plan\.create'/);

const patientId='case-patient', clinicId='clinic-1';
const specialties=['Fonoaudiólogo','Terapeuta Ocupacional','Psicoterapeuta'];
const plans=specialties.map((specialty,i)=>({
 id:'plan-'+i,patient_id:patientId,clinic_id:clinicId,mode:'specialty',specialty,
 responsible_professional_id:'professional-'+i,participant_professional_ids:['professional-'+i]
}));
const links=plans.map((scope,i)=>({
 patient_id:patientId,professional_id:'professional-'+i,status:'active',
 permissions:{read:true,write:true}
}));
for(let i=0;i<plans.length;i++){
 const ctx={actorId:'professional-'+i,actorRole:'therapist',professionalLinks:links};
 assert.deepEqual(filterTherapeuticPlanScopesForActor(plans,ctx).map(p=>p.id),['plan-'+i]);
 assert.equal(resolveTherapeuticPlanScopeAccess(plans[i],ctx).canEdit,true);
 for(let j=0;j<plans.length;j++)if(i!==j)assert.equal(resolveTherapeuticPlanScopeAccess(plans[j],ctx).canRead,false);
}
assert.equal(filterTherapeuticPlanScopesForActor(plans,{actorId:'director-1',actorRole:'director'}).length,3);
assert.equal(filterTherapeuticPlanScopesForActor(plans,{actorId:'coordinator-1',actorRole:'coordinator'}).length,3);
assert.deepEqual(filterTherapeuticPlanScopesForActor(plans,{actorId:'supervisor-1',actorRole:'supervisor',supervisionLinks:[{
 supervisor_user_id:'supervisor-1',clinic_id:clinicId,patient_id:patientId,
 supervised_user_id:'professional-0',status:'active'
}]}).map(x=>x.id),plans.map(x=>x.id)); // patient-specific supervision grants this case
assert.equal(filterTherapeuticPlanScopesForActor([{...plans[0],patient_id:'other-patient'}],{
 actorId:'supervisor-1',actorRole:'supervisor',supervisionLinks:[{supervisor_user_id:'supervisor-1',clinic_id:clinicId,patient_id:patientId,supervised_user_id:'professional-0',status:'active'}]
}).length,0);
console.log('therapeuticPlanCaseProfessionalCapability.regression.test.mjs: PASS');
