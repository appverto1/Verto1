import assert from 'node:assert/strict';
import { resolveGroupPatientRates } from '../services/groupSessions/groupSessionFinancialValidation';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const outside = 'd745a2f6-3e82-455c-b7bb-5853bf53e15b';
const first = '5502e3c5-f4c1-4a18-ae65-714180e38b92';
const second = '46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const plans = [
  { id:'98100c4d-23f4-4a5c-87ad-2778df202d9d', organization_id:clinic, patient_id:first, service_type:'SPEECH_THERAPY', billing_mode:'PRIVATE', status:'ACTIVE', amount_cents:15000, group_amount_cents:8000 },
  { id:'ab64e1e1-9aba-4287-822a-038539d9fb95', organization_id:clinic, patient_id:second, service_type:'SPEECH_THERAPY', billing_mode:'PRIVATE', status:'ACTIVE', amount_cents:15000, group_amount_cents:7000 },
];
const input = { authenticatedClinicId:clinic, specialty:'Fonoaudiólogo', patientIds:[first,second], activeFinancialPlanRows:plans };
const valid = resolveGroupPatientRates(input);
assert.equal(valid.ok,true);
if (valid.ok) assert.deepEqual(valid.rates.map(row=>row.amountCents),[8000,7000]);

for (const changes of [
  { patientIds:[first, first] },
  { specialty:'Terapia Ocupacional' },
  { activeFinancialPlanRows:plans.slice(0,1) },
  { activeFinancialPlanRows:[...plans, {...plans[0]}] },
  { activeFinancialPlanRows:plans.map(row=>({...row,group_amount_cents:0})) },
  { activeFinancialPlanRows:plans.map(row=>({...row,organization_id:outside})) },
  { activeFinancialPlanRows:plans.map(row=>({...row,billing_mode:'INSURANCE'})) },
]) assert.equal(resolveGroupPatientRates({...input,...changes}).ok,false,JSON.stringify(changes));
const dated = {
  ...input,
  scheduledStartAt: '2026-11-02T13:00:00Z',
  localDate: '2026-11-02',
};
const inWindow = plans.map(plan => ({
  ...plan,
  valid_from: '2026-10-01T00:00:00Z',
  valid_until: '2026-11-03T00:00:00Z',
  package_valid_until: '2026-11-02'
}));
assert.equal(resolveGroupPatientRates({...dated, activeFinancialPlanRows:inWindow}).ok, true,
  'group preview accepts a financial plan effective on the booking date');
for (const change of [
  { valid_from:'2026-11-03T00:00:00Z' },
  { valid_until:'2026-11-02T13:00:00Z' },
  { package_valid_until:'2026-11-01' },
]) {
  const decision = resolveGroupPatientRates({
    ...dated, activeFinancialPlanRows:inWindow.map((plan,index) => index === 0 ? {...plan,...change} : plan)
  });
  assert.deepEqual(decision,{ok:false,code:'GROUP_PRICING_PLAN_NOT_VALID_AT_DATE',patientId:first},
    'expired, not-yet-active or package-expired plans must not produce a misleading quote');
}
const successiveVersions = [
  {...inWindow[0],id:'2c4100dc-2f18-438f-9a06-76144ea5e3d8',valid_until:'2026-11-01T00:00:00Z'},
  ...inWindow,
];
const oneEffective = resolveGroupPatientRates({...dated,activeFinancialPlanRows:successiveVersions});
assert.equal(oneEffective.ok,true,'historical and current versions of the same plan must not look ambiguous');
assert.equal(resolveGroupPatientRates({
  ...dated, activeFinancialPlanRows:[...inWindow,{...inWindow[0],id:'2c4100dc-2f18-438f-9a06-76144ea5e3d8'}]
}).ok,false,'two simultaneously effective plans must still fail closed');

console.log('groupSessionFinancialValidation.test.ts: ok');
