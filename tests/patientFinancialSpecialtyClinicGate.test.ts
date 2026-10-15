import assert from 'node:assert/strict';
import {
  availableClinicFinancialPlanServiceOptions,
  patientFinancialPlanClinicalScopeKey,
  patientFinancialPlanSelectionValue
} from '../src/utils/patientFinancialPlan';
import { validateActiveClinicFinancialPlanSpecialties } from '../services/patientFinancialSpecialtyGuard';

const specialists = ['Fonoaudiólogo', 'Terapeuta Ocupacional', 'Psicoterapeuta', 'Musicoterapeuta'];
const choices = availableClinicFinancialPlanServiceOptions(specialists);
assert.deepEqual(choices.map((x) => x.label), specialists);
assert.ok(choices.some((x) => x.value === 'SPEECH_THERAPY'));
assert.ok(choices.some((x) => x.value === 'OCCUPATIONAL_THERAPY'));
assert.ok(choices.some((x) => x.value === 'PSYCHOLOGY'));
assert.ok(choices.some((x) => x.value === 'CUSTOM:Musicoterapeuta'));
assert.ok(!choices.some((x) => x.value === 'ABA' || x.value === 'THERAPY' || x.value === 'CUSTOM'));
assert.deepEqual(availableClinicFinancialPlanServiceOptions([]), []);
assert.equal(patientFinancialPlanSelectionValue({serviceType:'CUSTOM',customServiceName:'Musicoterapeuta'}), 'CUSTOM:Musicoterapeuta');

const CLINIC = '11111111-1111-4111-8111-111111111111';
const PATIENT = '22222222-2222-4222-8222-222222222222';
const plan = (type: string, custom='', clientId='new') => ({
  id: null, client_plan_key: clientId, service_type: type,
  custom_service_name: custom, status: 'ACTIVE'
});

const mockClient = (members: any[], existing: any[] = [], fail = false) => ({
  from(name: string) {
    const filters: Array<[string, any]> = [];
    const query: any = {
      select() { return this; },
      eq(key: string, value: any) { filters.push([key, value]); return this; },
      then(resolve: any) {
        const fixtures = name === 'clinic_memberships' ? members : existing;
        const data = fixtures.filter((row: any) =>
          filters.every(([key,val]) => String(row[key]) === String(val))
        );
        return Promise.resolve({data:fail?null:data,error:fail?new Error('DB unavailable'):null}).then(resolve);
      },
    };
    return query;
  }
});

async function validate(rows: any[], memberships: any[], older: any[] = [], fail = false) {
  return validateActiveClinicFinancialPlanSpecialties({
    supabase:mockClient(memberships,older,fail),clinicId:CLINIC,patientId:PATIENT,rows
  });
}
const fonoActive = [{clinic_id:CLINIC,role:'therapist',status:'active',specialty:'Fonoaudiólogo'}];
const fonoPending = [{clinic_id:CLINIC,role:'therapist',status:'pending',specialty:'Fonoaudiólogo'}];
const fonoOtherClinic = [{clinic_id:'99999999-9999-4999-8999-999999999999',role:'therapist',status:'active',specialty:'Fonoaudiólogo'}];
const fonoAdmin = [{clinic_id:CLINIC,role:'director',status:'active',specialty:'Fonoaudiólogo'}];

assert.equal((await validate([plan('SPEECH_THERAPY')],fonoActive)).ok,true);
assert.equal((await validate([plan('SPEECH_THERAPY')],fonoPending)).ok,false);
assert.equal((await validate([plan('SPEECH_THERAPY')],fonoOtherClinic)).ok,false);
assert.equal((await validate([plan('SPEECH_THERAPY')],fonoAdmin)).ok,false);
assert.equal((await validate([plan('ABA')],fonoActive)).ok,false);
assert.equal((await validate([plan('THERAPY')],fonoActive)).ok,false);
assert.equal((await validate([plan('CUSTOM','Musicoterapeuta')],fonoActive)).ok,false);
assert.equal((await validate([plan('CUSTOM','Fonoaudiólogo')],fonoActive)).ok,true);
assert.equal((await validate([],[],[],true)).ok,true,'empty plans valid');
assert.equal((await validate([plan('SPEECH_THERAPY')],[],[],true)).ok,false,'backend fails closed');
// Historical plan remains persistable only while its identity and specialty are unchanged.
const previous = [{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_plan_key:'old-plan',
  service_type:'OCCUPATIONAL_THERAPY', custom_service_name:null, status:'ACTIVE',
  organization_id:CLINIC,patient_id:PATIENT }];
assert.equal((await validate([plan('OCCUPATIONAL_THERAPY','','old-plan')],fonoActive,previous)).ok,true);
assert.equal((await validate([plan('OCCUPATIONAL_THERAPY','','new-plan')],fonoActive,previous)).ok,false);
assert.equal((await validate([plan('CUSTOM','Musicoterapeuta','old-plan')],fonoActive,previous)).ok,false);
console.log('patientFinancialSpecialtyClinicGate: PASS');
