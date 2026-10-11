import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasExplicitPatientTissOperationalPatch,
  omitImplicitPatientTissOperationalFields,
} from '../src/utils/patientInsuranceCorePatch';
import { serializePatientFinancialPlanForGenericFinancialPayload } from '../src/utils/patientFinancialPlan';

const app = fs.readFileSync('src/App.tsx','utf8');
const server = fs.readFileSync('server.ts','utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx','utf8');
const contaminated = {
  financialPlans: [{ id:'aa', serviceType:'SPEECH_THERAPY', billingMode:'PRIVATE', amountCents:10000 }],
  insuranceType: 'particular',
  insuranceCardNumber: 'EXISTING_CARD',
  insurancePlanCategory: 'EXISTING_TISS',
  anamnesisData: { medicalHistory:'untouched', insuranceCardNumber:'EXISTING_CARD' },
  anamnese: { notes:'untouched', convenioCarteirinha:'EXISTING_CARD' },
};
const cleaned = omitImplicitPatientTissOperationalFields(contaminated);
assert.equal(hasExplicitPatientTissOperationalPatch(contaminated),true);
assert.equal(hasExplicitPatientTissOperationalPatch({ insuranceType:'particular', financialPlans:[] }),false);
assert.equal(hasExplicitPatientTissOperationalPatch({ cardNumber: null }),true,'explicit clear remains a protected TISS mutation');
assert.equal(cleaned.insuranceCardNumber,undefined);
assert.equal(cleaned.insurancePlanCategory,undefined);
assert.equal(cleaned.anamnesisData.insuranceCardNumber,undefined);
assert.equal(cleaned.anamnese.convenioCarteirinha,undefined);
assert.equal(cleaned.anamnesisData.medicalHistory,'untouched');
assert.equal(cleaned.anamnese.notes,'untouched');
assert.equal(cleaned.insuranceType,'particular');
assert.deepEqual(cleaned.financialPlans,contaminated.financialPlans);
assert.equal(contaminated.insuranceCardNumber,'EXISTING_CARD','original clinical data must not be mutated');
const generic = serializePatientFinancialPlanForGenericFinancialPayload({
  serviceType:'SPEECH_THERAPY', billingMode:'PRIVATE', amountCents:15000,
  insuranceCardNumber:'should_not_echo', authorizationCode:'should_not_echo', dueDay:10
});
assert.equal(generic.amountCents,15000);
assert.equal(generic.dueDay,10);
assert.equal(Object.prototype.hasOwnProperty.call(generic,'insuranceCardNumber'),false);
assert.equal(Object.prototype.hasOwnProperty.call(generic,'authorizationCode'),false);
// Financial savings keep the backend authorization guard; no permission bypass.
assert.match(app,/hasExplicitPatientTissOperationalPatch\(updatedData\)/);
assert.match(app,/if \(!hasExplicitTissOperationalPatch\) \{[\s\S]{0,180}omitImplicitPatientTissOperationalFields/);
assert.match(coordinator,/serializePatientFinancialPlanForGenericFinancialPayload/);
assert.match(server,/PATIENT_INSURANCE_EDIT_CAPABILITY_REQUIRED/);
assert.match(server,/patientPayloadRequestsInsuranceOperationalOutsideFinancialPlans\(req\.body\)/);
// P0 29 and 30 canonical graph contracts must remain unchanged.
const pts=fs.readFileSync('tests/planPtsSessionGraphIntegrationP0.regression.test.mjs','utf8');
const graph=fs.readFileSync('tests/clinicalGraphRoleScopeP0.regression.test.ts','utf8');
assert.match(pts,/read_clinical_outcomes_converged_v3/);
assert.match(graph,/filterClinicalGraphPlanScopesForActor/);
console.log('PASS P0 financial core isolation and preserved graph scope');
