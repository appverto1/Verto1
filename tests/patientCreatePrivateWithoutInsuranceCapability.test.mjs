import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');

// Private-pay classification is core patient data. Generic payer identity is
// shared master data (Finance OR TISS), while operational beneficiary fields
// remain protected by patient.insurance.*.
assert.match(
  coordinator,
  /: \{ insuranceType: "particular" \};/,
  'new patient without TISS must remain explicitly classified as private-pay',
);

assert.match(
  server,
  /function patientPayloadRequestsInsuranceCreateCapability\(body: any\): boolean/,
);
assert.match(
  server,
  /Generic payer identity \(type\/name\/payer id\) is shared master data/,
  'generic payer identity must not by itself request patient.insurance.create',
);
assert.match(
  server,
  /hasInsuranceCreatePayload = patientPayloadRequestsInsuranceCreateCapability\(req\.body\)/,
);
assert.match(
  server,
  /hasInsuranceCreatePayload && !context\.capabilities\.has\('patient\.insurance\.create'\)/,
  'operational TISS payload remains protected by capability enforcement',
);

for (const genericAlias of [
  'insurancePayerId',
  'convenioPayerId',
  'insuranceType',
  'convenioTipo',
  'insuranceName',
  'convenioNome',
]) {
  assert.match(
    server,
    new RegExp(`PATIENT_GENERIC_PAYER_PAYLOAD_KEYS[\\s\\S]{0,500}['"]${genericAlias}['"]`),
    `${genericAlias} must remain shared payer identity`,
  );
}

for (const tissAlias of [
  'convenioCarteirinha',
  'insuranceCardValidUntil',
  'insurancePlanCategory',
  'insuranceHolderCpf',
  'insuranceEligibilityNotes',
]) {
  assert.match(
    server,
    new RegExp(`PATIENT_INSURANCE_PAYLOAD_KEYS[\\s\\S]{0,800}['"]${tissAlias}['"]`),
    `${tissAlias} must remain TISS capability-protected`,
  );
}

console.log('patientCreatePrivateWithoutInsuranceCapability.test.mjs: ok');
