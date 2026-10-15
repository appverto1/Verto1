import assert from 'node:assert/strict';
import {
  availableClinicFinancialPlanServiceOptions,
  patientFinancialPlanClinicalScopeKey,
  patientFinancialPlanSelectionValue
} from '../src/utils/patientFinancialPlan.ts';
import { validateActiveClinicFinancialPlanSpecialties } from '../services/patientFinancialSpecialtyGuard.ts';

const clinicId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const active = ['Fonoaudiólogo', 'Terapeuta Ocupacional', 'Fonoaudiólogo'];
const options = availableClinicFinancialPlanServiceOptions(active);
assert.equal(options.length, 2);
assert.deepEqual(options.map(x => x.serviceType), ['SPEECH_THERAPY', 'OCCUPATIONAL_THERAPY']);
assert.equal(availableClinicFinancialPlanServiceOptions(['ABA', 'Terapia', ''] ).length, 0);
assert.deepEqual(availableClinicFinancialPlanServiceOptions(['Nutricionista']),
  [{value:'CUSTOM:Nutricionista',label:'Nutricionista',serviceType:'CUSTOM',customServiceName:'Nutricionista'}]);
assert.equal(patientFinancialPlanClinicalScopeKey({serviceType:'PSYCHOLOGY'}), 'psychotherapy');
assert.equal(patientFinancialPlanClinicalScopeKey({serviceType:'ABA'}), null);
assert.equal(patientFinancialPlanClinicalScopeKey({serviceType:'CUSTOM', customServiceName:'Nutricionista'}), 'nutrition');
assert.equal(patientFinancialPlanClinicalScopeKey({serviceType:'CUSTOM', customServiceName:'Qualquer coisa'}), null);
assert.equal(patientFinancialPlanSelectionValue({serviceType:'CUSTOM',customServiceName:'Nutricionista'}),'CUSTOM:Nutricionista');

function database(opts: {members?: any[]; prior?: any[]; membersError?: any; priorError?: any} = {}) {
  const queries: {table:string;filters:Record<string,any>}[] = [];
  const from = (table: string) => {
    const filters: Record<string, any> = {};
    const query = {
      select(_fields:string){return this},
      eq(column:string,value:any){filters[column]=value;return this},
      then(resolve:any,reject:any){
        queries.push({table, filters});
        const rows = table==='clinic_memberships'?opts.members||[]:opts.prior||[];
        const error = table==='clinic_memberships'?opts.membersError:opts.priorError;
        return Promise.resolve({data:error?null:rows,error:error||null}).then(resolve,reject);
      }
    };
    return query;
  };
  return {supabase:{from},queries};
}
const row = (service_type:string, custom_service_name:string|null=null, extras:any={})=>({
  id:'',client_plan_key:'plan-smoke-1',service_type,custom_service_name,...extras
});
{
  const db=database({members:[{specialty:'Fonoaudiólogo'}]});
  const result = await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('SPEECH_THERAPY')]
  });
  assert.deepEqual(result,{ok:true});
  assert.deepEqual(db.queries,[{table:'clinic_memberships',filters:{clinic_id:clinicId,role:'therapist',status:'active'}}]);
}
{
  const db=database({members:[{specialty:'Fonoaudiólogo'}]});
  const result=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('OCCUPATIONAL_THERAPY')]
  });
  assert.equal(result.ok,false);
  assert.equal((result as any).code,'FINANCIAL_PLAN_SPECIALTY_NOT_ACTIVE');
  assert.equal(db.queries[1].filters.organization_id,clinicId);
  assert.equal(db.queries[1].filters.patient_id,patientId);
}
{
  const db=database({members:[{specialty:'Fonoaudiólogo'}]});
  const result=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('ABA')]
  });
  assert.equal(result.ok,false);
}
{
  const db=database({members:[{specialty:'Fonoaudiólogo'}]});
  const result=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('CUSTOM','Terapia livre')]
  });
  assert.equal(result.ok,false);
}
{
  const db=database({
    members:[{specialty:'Fonoaudiólogo'}],
    prior:[{id:'33333333-3333-4333-8333-333333333333',client_plan_key:'legacy-plan',
      service_type:'OCCUPATIONAL_THERAPY',custom_service_name:null,status:'ACTIVE'}]
  });
  const result=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('OCCUPATIONAL_THERAPY',null,
      {id:'33333333-3333-4333-8333-333333333333',client_plan_key:'legacy-plan'})]
  });
  assert.deepEqual(result,{ok:true},'existing inactive specialty plan must remain readable/editable without specialty alteration');
  const changed=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('PSYCHOLOGY',null,{client_plan_key:'legacy-plan'})]
  });
  assert.equal(changed.ok,false,'old plan cannot be repurposed to unavailable specialty');
}
{
  const db=database({membersError:{message:'timeout'}});
  const result=await validateActiveClinicFinancialPlanSpecialties({
    supabase:db.supabase,clinicId,patientId,rows:[row('SPEECH_THERAPY')]
  });
  assert.equal(result.ok,false,'failure loading team must fail closed');
}

import {readFileSync} from 'node:fs';
const app = readFileSync(new URL('../src/components/CoordinatorDashboard.tsx',import.meta.url),'utf8');
const backend = readFileSync(new URL('../server.ts',import.meta.url),'utf8');
assert.match(app,/clinicFinancialPlanServiceOptions\.map\(/);
assert.doesNotMatch(app,/PATIENT_FINANCIAL_SERVICE_OPTIONS\.map\(/);
assert.match(backend,/await validateActiveClinicFinancialPlanSpecialties\(/);
assert.match(backend,/import \{ validateActiveClinicFinancialPlanSpecialties \} from '\.\/services\/patientFinancialSpecialtyGuard'/);

console.log('patient financial plan clinic specialty regression: PASS');
